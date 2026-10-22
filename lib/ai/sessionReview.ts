import 'server-only'
import { generateText } from 'ai'
import { z } from 'zod'
import { SessionReviewSchema, type SessionReview } from '@/lib/domain/train/review'
import { MIN_OUTPUT_TOKENS } from './models'
import { clampProse, describeAiFailure, extractJson } from './parse'
import { recordUsage, routedModel } from './router'

/**
 * One coach's read of a finished session.
 *
 * Same path as a plan: Groq cannot do `json_schema`, so the shape is asked for in
 * the prompt and checked with Zod on the way back. The job is `review`
 * (`openai/gpt-oss-120b`). The plan route's 70B is gone from this account, and
 * Google's daily pool is reserved for photos, so a failed read stays a failed read.
 *
 * Never throws. A missing read leaves the session exactly as logged.
 */
export interface SessionReviewResult {
  review: SessionReview | null
  error?: string
}

const SHAPE = JSON.stringify(z.toJSONSchema(SessionReviewSchema))
const HEADLINE_MAX = 120
const READ_MAX = 700
const REC_MAX = 180

const TASK = `THIS TURN
You are reading one finished session, not chatting and not calling tools. The session brief is the only evidence. Every weight, rep count, and record you mention must appear in it. If a number is not in the brief, you do not know it, so you do not say it.

Exercise order is part of the evidence. The first exercise is done fresh, so a record there is the easiest kind of record — say that it was first. An exercise later in the session is done after everything listed above it. Holding or beating a previous load in a later slot is more meaningful than the same load done first. Do not call a later exercise a failure for being lighter than it is when fresh.

A set marked PR is a record. Do not award one that is not marked. A warmup is not a working set. Working sets are under 12 reps. 12 or more at a load means that load was light enough to go up next time, but only when the PR at that exercise also reached 12 — otherwise stay at the heavier of the last session and the PR. A lighter high-rep set is not the working weight when a heavier set of the same exercise followed it.

verdict:
- progress — a working load or a record moved, and where it sat in the order makes that believable
- mixed — some exercises moved and some did not
- flat — nothing that matters moved

recommendations: two or three concrete next steps. Name the exercise and the load.

REPLY FORMAT
Reply with ONE JSON object and nothing else — no prose around it, no code fence.
It must match this schema:
${SHAPE}`

export async function reviewSessionWithAi(coachPrompt: string, brief: string): Promise<SessionReviewResult> {
  try {
    const { model, route } = await routedModel('review')
    const { text, usage } = await generateText({
      model,
      system: `${coachPrompt}\n\n${TASK}`,
      prompt: brief,
      maxOutputTokens: MIN_OUTPUT_TOKENS * 2,
      temperature: 0.3,
    })

    void recordUsage(route.provider, route.id, usage.inputTokens ?? 0, usage.outputTokens ?? 0).catch(() => {
      /* accounting must never fail the request */
    })

    const parsed = SessionReviewSchema.safeParse(extractJson(text))
    if (!parsed.success) {
      return { review: null, error: 'The coach returned something unusable. Try again.' }
    }

    const recommendations = parsed.data.recommendations
      .map((line) => clampProse(line, REC_MAX))
      .filter((line): line is string => line !== null)
      .slice(0, 3)
    const headline = clampProse(parsed.data.headline, HEADLINE_MAX)
    const read = clampProse(parsed.data.read, READ_MAX)
    if (headline === null || read === null || recommendations.length === 0) {
      return { review: null, error: 'The coach returned something unusable. Try again.' }
    }

    return { review: { verdict: parsed.data.verdict, headline, read, recommendations } }
  } catch (err) {
    return {
      review: null,
      error: describeAiFailure(err instanceof Error ? err.message : String(err), 'read the sets yourself'),
    }
  }
}
