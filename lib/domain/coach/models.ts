/**
 * Which model answers, and how much of its day is left (US-3.7).
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
