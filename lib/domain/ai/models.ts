/**
 * Which model answers, how much of its allowance is left, and when to degrade off it.
 *
 * Pure, and that is the point of the file. The degrade decision used to live inside a
 * `server-only` async function with no test, which is how it went unnoticed that it
 * consulted one of two cap tables and therefore could never degrade a request-capped
 * model. Decisions that can be wrong belong somewhere they can be asserted.
 *
 * (US-3.7)
 *
 * Switching model is not a preference here — it is a **quota** decision. The three
 * options draw on three unrelated pools, so when one is spent the others are untouched:
 *
 * | Option   | Pool                    | Trade                                        |
 * |----------|-------------------------|----------------------------------------------|
 * | Balanced | 100k tokens/day (Groq)  | Best tool selection. ~15 coaching turns.     |
 * | Backup   | 20 requests/day (Google)| Shared with photo logging — spend carefully. |
 * | Light    | 500k tokens/day (Groq)  | Effectively unlimited, much weaker at tools. |
 *
 * Pure: the option list and how a quota reads. The counting happens server-side.
 */
export type ModelChoice = 'chat' | 'chatFallback' | 'cheap'

export const MODEL_CHOICES: readonly ModelChoice[] = ['chat', 'chatFallback', 'cheap']

export const isModelChoice = (v: unknown): v is ModelChoice =>
  typeof v === 'string' && (MODEL_CHOICES as readonly string[]).includes(v)

export interface ModelOption {
  choice: ModelChoice
  /** Short label for the picker. */
  label: string
  /** The actual model, so the answer can be attributed. */
  id: string
  /** What you give up or gain by choosing it. */
  note: string
  quota: Quota
}

export interface Quota {
  kind: 'tokens' | 'requests'
  used: number
  cap: number
}

export const LABEL: Record<ModelChoice, { label: string; note: string }> = {
  chat: { label: 'Balanced', note: 'Best at choosing the right query. ~15 turns a day.' },
  chatFallback: { label: 'Backup', note: 'Shares its 20 daily calls with photo logging.' },
  cheap: { label: 'Light', note: 'Near-unlimited, but much weaker at picking queries.' },
}

/** `62,400 / 100,000 tokens` — the figure, not a bar. */
export function describeQuota(q: Quota): string {
  return `${q.used.toLocaleString()} / ${q.cap.toLocaleString()} ${q.kind}`
}

export const percentUsed = (q: Quota): number =>
  q.cap === 0 ? 0 : Math.min(100, Math.round((q.used / q.cap) * 100))

/**
 * `low` past 80%, `spent` at the cap.
 *
 * 80% matches `AI_QUOTA_SAFETY_MARGIN`, which is where the router starts degrading — so
 * the badge turns amber at exactly the point the app stops trusting that pool, rather
 * than at a separate number that would eventually disagree with it.
 */
export function quotaState(q: Quota): 'ok' | 'low' | 'spent' {
  const pct = percentUsed(q)
  if (q.used >= q.cap) return 'spent'
  return pct >= 80 ? 'low' : 'ok'
}

/** The option to fall back to when the chosen one is spent, or null if none is left. */
export function firstUsable(options: readonly ModelOption[]): ModelOption | null {
  return options.find((o) => quotaState(o.quota) !== 'spent') ?? null
}

// ---------------------------------------------------------------------------
// Choosing a model — the decision the router used to make untested
// ---------------------------------------------------------------------------
/** What a model has spent, in whichever unit its provider meters. */
export interface Usage {
  tokens: number
  requests: number
}

export interface CapLike {
  kind: 'tokens' | 'requests'
  period: 'day' | 'month'
  limit: number
}

export interface RouteDecision {
  id: string
  degraded: boolean
  reason?: 'quota'
  /** Every model tried and rejected, so a failure can say what it walked past. */
  exhausted: string[]
}

/**
 * Walks a fallback chain and returns the first model with allowance left.
 *
 * **Walks the whole chain, not one hop.** With more than one pool per task it is
 * genuinely possible for a model and its fallback to both be spent, and the previous
 * one-hop version would hand back an equally-dead model flagged `degraded: true` —
 * a wrong answer that looks like a handled one.
 *
 * A model with no cap entry is treated as having room. Guessing a limit for something
 * we have not measured would be inventing a number, and the whole quota surface exists
 * because invented numbers are what went wrong before.
 */
export function chooseRoute(
  chain: readonly string[],
  usage: Readonly<Record<string, Usage>>,
  caps: Readonly<Record<string, CapLike>>,
  margin: number,
): RouteDecision {
  const exhausted: string[] = []

  for (const [i, id] of chain.entries()) {
    const cap = caps[id]
    const spent = usage[id] ?? { tokens: 0, requests: 0 }
    const used = cap?.kind === 'requests' ? spent.requests : spent.tokens

    if (cap === undefined || used < cap.limit * margin) {
      return { id, degraded: i > 0, ...(i > 0 ? { reason: 'quota' as const } : {}), exhausted }
    }
    exhausted.push(id)
  }

  /**
   * Everything is spent. Return the FIRST model rather than nothing: the caller's job
   * is to attempt and degrade gracefully, and a real 429 carrying the provider's own
   * reset time is more useful to the user than our refusal to try.
   */
  return { id: chain[0] ?? '', degraded: true, reason: 'quota', exhausted }
}
