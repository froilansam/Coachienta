import 'server-only'
import { db } from '@/lib/db/client'
import { env } from '@/lib/env'
import { DAILY_TOKEN_CAP, MODELS, QUOTA_TZ, type AiJob, type Provider } from './models'
import { model } from './providers'

export interface Route {
  provider: Provider
  id: string
  degraded: boolean
  reason?: 'quota' | 'error'
}

/** Provider-local calendar day. Counting on our own timezone would reset early. */
const usageDate = (provider: Provider) =>
  new Intl.DateTimeFormat('en-CA', { timeZone: QUOTA_TZ[provider] }).format(new Date())

/**
 * Jobs with a usable second model. A fallback has to be able to serve the same CALL —
 * `vision` deliberately has none, because `resolvePhoto` needs structured output and
 * no Groq model in the registry can do it (see `models.ts`). Degrading into a
 * guaranteed capability error would replace a truthful "quota" message with a
 * confusing one.
 */
const FALLBACK: Partial<Record<AiJob, AiJob>> = {
  chat: 'chatFallback',
  plan: 'planFallback',
}

async function tokensUsedToday(provider: Provider, id: string): Promise<number> {
  const { data } = await db
    .from('ai_usage_daily')
    .select('input_tokens, output_tokens')
    .eq('usage_date', usageDate(provider))
    .eq('provider', provider)
    .eq('model', id)
    .maybeSingle()

  return (data?.input_tokens ?? 0) + (data?.output_tokens ?? 0)
}

/**
 * Pick a model for a job, degrading before the free tier hard-stops us.
 *
 * Never throws on exhaustion — the caller decides how to degrade. Logging food
 * must never be blocked by AI (PRD-000 Principle 1).
 */
export async function route(job: AiJob): Promise<Route> {
  const primary = MODELS[job]
  const cap = DAILY_TOKEN_CAP[primary.id]

  if (cap) {
    const used = await tokensUsedToday(primary.provider, primary.id)
    if (used >= cap * env.AI_QUOTA_SAFETY_MARGIN) {
      const alt = FALLBACK[job]
      if (alt) {
        return { provider: MODELS[alt].provider, id: MODELS[alt].id, degraded: true, reason: 'quota' }
      }
    }
  }

  return { provider: primary.provider, id: primary.id, degraded: false }
}

/** Resolve a route to a callable model handle. */
export const routedModel = async (job: AiJob) => {
  const r = await route(job)
  return { model: model(r.provider, r.id), route: r }
}

/** Fire-and-forget usage accounting. Failure here must not fail the request. */
export async function recordUsage(
  provider: Provider,
  id: string,
  inputTokens: number,
  outputTokens: number,
): Promise<void> {
  await db.rpc('bump_ai_usage', {
    p_usage_date: usageDate(provider),
    p_provider: provider,
    p_model: id,
    p_input: inputTokens,
    p_output: outputTokens,
  })
}
