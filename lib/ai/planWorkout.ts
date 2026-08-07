import 'server-only'
import { generateText } from 'ai'
import { z } from 'zod'
import { MIN_OUTPUT_TOKENS } from './models'
import { clampProse, describeAiFailure, extractJson } from './parse'
import { recordUsage, routedModel } from './router'
import { AiWorkoutPlanSchema, type AiWorkoutPlan } from './schemas/workoutPlan'

/**
 * `PULL LEGS!` → a draft day plan (PRD-004 §4.2a).
 *
 * The one call to a model. Everything checkable happens around it: the catalogue and
 * instructions are assembled by `lib/domain/train/planPrompt.ts`, and the guards run
 * over the result in the route. This function only talks to the provider.
 *
 * ## Why not `generateObject`
 *
 * Because Groq cannot. No model in the registry supports `json_schema` (verified live
 * — see the `plan` note in `models.ts`), and Groq is the right primary here: 100k
 * tokens a day against Google's 20 REQUESTS a day, which photo logging already needs.
 *
 * So the shape is asked for in the prompt and validated on the way back. **Zod stays
 * the single source of truth** either way — the JSON shape in the prompt is generated
 * from `AiWorkoutPlanSchema` rather than written out by hand, so it cannot drift from
 * what is parsed. One code path, and it works on both providers.
 *
 * **Never throws**, like every other AI call in this app. A plan is a convenience;
 * Template and Empty still create a session with the model completely unavailable
 * (AC-2.20, PRD-000 Principle 1).
 */
export interface PlanWorkoutResult {
  plan: AiWorkoutPlan | null
  degraded: boolean
  /** Already a sentence for the user — never the provider's own text. */
  error?: string
}

/** Derived from the schema, so the instruction and the validator cannot disagree. */
const SHAPE = JSON.stringify(z.toJSONSchema(AiWorkoutPlanSchema))

const RATIONALE_MAX = 400
const WHY_MAX = 120

/** What the user can still do. Named once — it appears in three failure messages. */
const FALLBACK_PATH = 'use a template'

export async function planWorkoutWithAi(
  system: string,
  userPrompt: string,
): Promise<PlanWorkoutResult> {
  try {
    const { model, route } = await routedModel('plan')

    const { text, usage } = await generateText({
      model,
      system: `${system}

REPLY FORMAT
Reply with ONE JSON object and nothing else — no prose around it, no code fence.
It must match this schema:
${SHAPE}`,
      prompt: `Build today's session for this request: ${userPrompt}`,
      // Gemini 3.x Flash is the fallback and it is a thinking model — ~800 output
      // tokens of overhead measured, and too low a cap returns an EMPTY response with
      // no error at all (PRD-001 §2.2). A 12-item plan needs room on top of that.
      maxOutputTokens: MIN_OUTPUT_TOKENS * 2,
      // Low, not zero: the same prompt on two days need not produce a byte-identical
      // plan, but this is selection from a fixed list, not writing.
      temperature: 0.3,
    })

    void recordUsage(
      route.provider,
      route.id,
      usage.inputTokens ?? 0,
      usage.outputTokens ?? 0,
    ).catch(() => {
      /* accounting must never fail the request */
    })

    const parsed = AiWorkoutPlanSchema.safeParse(extractJson(text))
    if (!parsed.success) {
      return {
        plan: null,
        degraded: true,
        error: `The plan builder returned something unusable. Try again, or ${FALLBACK_PATH}.`,
      }
    }

    // Prose is clamped, not rejected — see `clampProse`.
    return {
      degraded: route.degraded,
      plan: {
        ...parsed.data,
        rationale: clampProse(parsed.data.rationale, RATIONALE_MAX) ?? '',
        notice: clampProse(parsed.data.notice, RATIONALE_MAX),
        items: parsed.data.items.map((item) => ({ ...item, why: clampProse(item.why, WHY_MAX) })),
      },
    }
  } catch (err) {
    return {
      plan: null,
      degraded: true,
      error: describeAiFailure(err instanceof Error ? err.message : String(err), FALLBACK_PATH),
    }
  }
}
