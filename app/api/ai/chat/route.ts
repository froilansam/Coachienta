import { convertToModelMessages, stepCountIs, streamText, type UIMessage } from 'ai'
import { z } from 'zod'
import { buildCoachPrompt, systemPromptWarning } from '@/lib/ai/coachChat'
import { describeAiFailure } from '@/lib/ai/parse'
import { model as modelFor } from '@/lib/ai/providers'
import { recordUsage, route as routeFor } from '@/lib/ai/router'
import { coachTools } from '@/lib/ai/tools/coach'
import { isTrivial, trimHistory, type Turn } from '@/lib/domain/coach/budget'

/**
 * The coach (PRD-005 §3).
 *
 * A tool-calling agent, not a retrieval pipeline. The model decides which SQL tool to
 * call and over what dates; Postgres does the arithmetic. That split is the feature —
 * "most similar" and "all of them" are different ideas, and an average needs the second.
 *
 * **Streams**, because four seconds of silence reads as broken (AC-3.5; first token
 * measured at ~940 ms on the primary). The client renders tool calls as they happen,
 * which is where both the `Thinking…` line and the `DATA USED` panel come from — derived
 * from the calls that actually ran rather than a channel this route maintains by hand.
 */
const Body = z.object({
  messages: z.array(z.unknown()).min(1).max(200),
  /**
   * A JOB KEY, never a raw model id — the same allowlist principle as the tools. A
   * client that could name any model could name one we have not paid for or vetted.
   */
  model: z.enum(['chat', 'chatFallback', 'cheap']).optional(),
})

/** The last six exchanges, verbatim; older ones dropped (§3.4). */
function trim(messages: UIMessage[]): { messages: UIMessage[]; dropped: number } {
  const turns: Turn[] = messages.map((m) => ({
    role: m.role === 'assistant' ? 'assistant' : 'user',
    text: m.parts
      .filter((p): p is { type: 'text'; text: string } => p.type === 'text')
      .map((p) => p.text)
      .join(' '),
  }))
  const { dropped } = trimHistory(turns)
  return { messages: dropped > 0 ? messages.slice(dropped) : messages, dropped }
}

export async function POST(req: Request) {
  const parsed = Body.safeParse(await req.json().catch(() => null))
  if (!parsed.success) {
    return Response.json({ error: 'A message is required.' }, { status: 400 })
  }
  const incoming = parsed.data.messages as UIMessage[]

  let prompt: Awaited<ReturnType<typeof buildCoachPrompt>>
  try {
    prompt = await buildCoachPrompt()
  } catch {
    /**
     * The prompt is assembled from the database. If that fails the coach must not
     * answer from nothing — an unanchored coach is exactly the spreadsheet's failure.
     */
    return Response.json(
      { error: 'Your profile and rules could not be read, so the coach has nothing to answer from.' },
      { status: 503 },
    )
  }

  const warning = systemPromptWarning(prompt.system)
  if (warning) console.warn(`[coach] ${warning}`)

  const { messages, dropped } = trim(incoming)

  /**
   * A bare "thanks" goes to the 8B, which has 500k tokens/day — effectively unlimited.
   * Only substantive turns spend the 70B's 100k (§3.4).
   *
   * **And it gets no tools.** Measured: with the catalogue attached, the 8B answered
   * "thanks" by calling five tools over 120 seconds. It is a much weaker tool-selector
   * than the 70B, and an acknowledgement needs no data at all. `isTrivial` is
   * deliberately narrow — no digits, no question mark, under 40 characters — so the cost
   * of a misfire is that the user asks again, which is far cheaper than two minutes of
   * fishing on every "ok".
   */
  const last = messages[messages.length - 1]
  const lastText =
    last?.parts
      .filter((p): p is { type: 'text'; text: string } => p.type === 'text')
      .map((p) => p.text)
      .join(' ') ?? ''
  /**
   * A trivial turn always goes to the small model whatever is selected — it needs no
   * reasoning and no data, and spending the 70B on "thanks" is what the routing exists to
   * prevent. Otherwise the user's choice decides the pool (US-3.7).
   *
   * The chosen job still passes through `routeFor`, so the quota router can degrade off
   * it when that pool is nearly spent (AC-3.9). Manual selection picks the starting
   * point; it does not switch off the safety margin.
   */
  const trivial = isTrivial(lastText)
  const chosen = await routeFor(trivial ? 'cheap' : (parsed.data.model ?? 'chat'))

  try {
    const result = streamText({
      model: modelFor(chosen.provider, chosen.id),
      system: trivial
        ? 'You are Coachienta. Acknowledge this briefly — one short sentence, no data, no questions back.'
        : prompt.system,
      messages: await convertToModelMessages(messages),
      ...(trivial
        ? {}
        : {
            tools: coachTools({ today: prompt.today, gymId: prompt.gymId }),
            // Multi-hop: a question spanning food and training needs several tools in
            // one turn (§6). Five is the cap so a confused model cannot loop the budget
            // away.
            stopWhen: stepCountIs(5),
          }),
      // Low. This is a numbers job, not a writing one.
      temperature: 0.4,
      /**
       * `totalUsage`, NOT `usage`.
       *
       * `usage` is the FINAL step only. On a multi-step tool turn every earlier step
       * goes unrecorded — measured: 52,126 tokens recorded against Groq's own count of
       * ~98,000 for the same day, roughly half. That blinded the quota router, which is
       * the thing meant to degrade to Gemini *before* Groq hard-stops (AC-3.9). It
       * cannot pre-empt a limit it cannot see.
       *
       * Single-call sites (`resolveFood`, `resolvePhoto`, `planWorkout`) are unaffected:
       * with one step, `usage` and `totalUsage` are the same.
       */
      onFinish: ({ totalUsage }) => {
        void recordUsage(
          chosen.provider,
          chosen.id,
          totalUsage.inputTokens ?? 0,
          totalUsage.outputTokens ?? 0,
        ).catch(() => {
          /* accounting must never fail the reply */
        })
      },
    })

    return result.toUIMessageStreamResponse({
      /**
       * Which model answered, and whether the thread was shortened. Both are things the
       * user is entitled to know: the fallback is a different model with different
       * judgement, and a silently truncated thread explains a coach that "forgot".
       */
      messageMetadata: () => ({
        model: chosen.id,
        degraded: chosen.degraded,
        droppedTurns: dropped,
      }),
      /**
       * The user gets a sentence; the server logs the truth. A friendly message that
       * replaces the diagnosis everywhere is how a provider fault becomes unfindable.
       */
      onError: (error) => {
        const raw = error instanceof Error ? (error.stack ?? error.message) : String(error)
        console.error('[coach] stream failed:', raw)
        return describeAiFailure(raw, 'try again shortly')
      },
    })
  } catch (err) {
    // The rest of the app stays usable with the coach completely unavailable (AC-3.10).
    return Response.json(
      { error: describeAiFailure(err instanceof Error ? err.message : String(err), 'try again shortly') },
      { status: 503 },
    )
  }
}
