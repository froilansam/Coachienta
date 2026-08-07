/**
 * Verified live 2026-08-06 against the real account. Do not substitute from
 * memory — `gemini-2.5-*` returns 404 (retired for new accounts) and Gemini Pro
 * has no free quota (PRD-001 §2.2).
 */
export const MODELS = {
  chat: { provider: 'groq', id: 'llama-3.3-70b-versatile' },
  chatFallback: { provider: 'google', id: 'gemini-3.6-flash' },
  /**
   * The workout-plan builder. Same pair as chat, per PRD-004 §4.2a — but it reaches
   * the model through `generateText` + Zod, NOT `generateObject`. Verified live
   * 2026-08-06:
   *
   * - **No Groq model here supports `json_schema`.** `llama-3.3-70b-versatile` and
   *   `qwen/qwen3.6-27b` both refuse a two-field flat schema as readily as this one, so
   *   it is a capability and not a schema shape, and `mode: 'json'` does not help.
   *   `openai/gpt-oss-120b` accepts it but nested `items` inside a second `items`
   *   object, rejected non-retryably, and caps at 8k tokens/minute.
   * - **Google's free tier is 20 requests per DAY per model**
   *   (`GenerateRequestsPerDayPerProjectPerModel-FreeTier`), shared with photo logging.
   *   Its `retryDelay: 49s` hint reads like a per-minute limit and is not one.
   *
   * So Google as primary would let a once-a-session convenience consume the daily
   * quota that photo logging depends on. Groq's 100k tokens/day is ~120 plans at the
   * ~600 tokens a call measured, and the 70B follows the critical rules well. Google
   * stays as the fallback the router can actually reach, because the 70B has a
   * `DAILY_TOKEN_CAP` entry to pre-empt on.
   */
  plan: { provider: 'groq', id: 'llama-3.3-70b-versatile' },
  planFallback: { provider: 'google', id: 'gemini-3.6-flash' },
  cheap: { provider: 'groq', id: 'llama-3.1-8b-instant' },
  vision: { provider: 'google', id: 'gemini-3.6-flash' },
  /**
   * `visionFallback` is GONE, for the same reason (found while registering `plan`).
   * `resolvePhoto` calls `generateObject`, and `qwen/qwen3.6-27b` cannot do structured
   * output — so degrading to it on a Google quota exhaustion replaced a truthful
   * "quota" failure with a misleading schema error. A fallback that cannot serve the
   * call is worse than none.
   */
  estimate: { provider: 'google', id: 'gemini-3.6-flash' },
  embed: { provider: 'google', id: 'gemini-embedding-001' },
} as const

export type AiJob = keyof typeof MODELS
export type Provider = (typeof MODELS)[AiJob]['provider']

/**
 * Free-tier daily REQUEST caps, where the provider limits calls rather than tokens.
 *
 * Google's is the one that surprises: 20 requests per day per model
 * (`GenerateRequestsPerDayPerProjectPerModel-FreeTier`), shared across every Google job
 * — vision, label reading, and the coach fallback all draw on the same 20.
 */
export const DAILY_REQUEST_CAP: Record<string, number> = {
  'gemini-3.6-flash': 20,
}

/** Free-tier daily token caps. The 70B's 100k/day is the binding constraint. */
export const DAILY_TOKEN_CAP: Record<string, number> = {
  'llama-3.3-70b-versatile': 100_000,
  'llama-3.1-8b-instant': 500_000,
  'qwen/qwen3.6-27b': 200_000,
}

/**
 * Quota reset boundaries are the PROVIDER's, not ours. Bucketing usage on
 * Asia/Tokyo would reset the counter 16h before Google does.
 */
export const QUOTA_TZ: Record<Provider, string> = {
  google: 'America/Los_Angeles',
  groq: 'UTC',
}

/** 3.x Flash models spend output tokens thinking (~800 measured). Too low → empty response. */
export const MIN_OUTPUT_TOKENS = 2000

export const EMBED_DIMS = 768
