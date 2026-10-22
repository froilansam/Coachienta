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
  /**
   * A finished-session read. `llama-3.3-70b-versatile` returned 404 on this account
   * on 2026-10-19 ("does not exist or you do not have access"), so the read cannot
   * ride `plan`. `openai/gpt-oss-120b` answers `generateText` with a JSON object in
   * `content`. No Gemini fallback: that pool is the 20 calls a day photo logging uses.
   */
  review: { provider: 'groq', id: 'openai/gpt-oss-120b' },
  /**
   * Pasted text → foods. Same model as a session read: `llama-3.3-70b-versatile`
   * 404s here, and Gemini's 20-a-day pool is the photo one. `generateText`, not
   * `generateObject` — Groq will not honour `json_schema`.
   */
  paste: { provider: 'groq', id: 'openai/gpt-oss-120b' },
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
 * What each model is allowed per period, in the unit the provider actually meters.
 *
 * **One table, deliberately.** This replaced a `DAILY_TOKEN_CAP` and a
 * `DAILY_REQUEST_CAP` sitting side by side, of which `route()` consulted only the
 * first — so every request-capped model was invisible to the quota router and
 * `vision` could never degrade at all. Two parallel tables and a check that knows
 * about one is the shape of that bug; a second `if` would have reproduced it the next
 * time a cap kind appeared.
 *
 * A model absent from this table is uncapped as far as we know, and the router leaves
 * it alone rather than guessing a limit.
 */
export interface Cap {
  /** The unit the provider counts. Reporting the wrong one is worse than reporting
   *  nothing: 3 of 20 requests looks comfortable, 3 of 20 *tokens* looks broken. */
  kind: 'tokens' | 'requests'
  period: 'day' | 'month'
  limit: number
}

export const CAPS: Record<string, Cap> = {
  // Verified 2026-08-07 by probe: `GenerateRequestsPerDayPerProjectPerModel-FreeTier`
  // — per MODEL, not per account, which is why splitting jobs across models works.
  'gemini-3.6-flash': { kind: 'requests', period: 'day', limit: 20 },

  'llama-3.3-70b-versatile': { kind: 'tokens', period: 'day', limit: 100_000 },
  'llama-3.1-8b-instant': { kind: 'tokens', period: 'day', limit: 500_000 },
  'qwen/qwen3.6-27b': { kind: 'tokens', period: 'day', limit: 200_000 },
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
