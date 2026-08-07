import 'server-only'
import { db } from '@/lib/db/client'
import { env } from '@/lib/env'
import { CAPS, MODELS, QUOTA_TZ, type AiJob, type Provider } from './models'
import { chooseRoute, type Usage } from '@/lib/domain/ai/models'
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

/**
 * Everything spent today, by model, in one query.
 *
 * One round trip regardless of how deep the fallback chain goes — the previous version
 * queried per hop, which also meant it only ever looked at one.
 */
async function usageToday(provider: Provider, ids: readonly string[]): Promise<Record<string, Usage>> {
  const { data } = await db
    .from('ai_usage_daily')
    .select('model, requests, input_tokens, output_tokens')
    .eq('usage_date', usageDate(provider))
    .in('model', [...ids])

  const usage: Record<string, Usage> = {}
  for (const row of data ?? []) {
    usage[String(row.model)] = {
      tokens: Number(row.input_tokens ?? 0) + Number(row.output_tokens ?? 0),
      requests: Number(row.requests ?? 0),
    }
  }
  return usage
}

/** The models a job may land on, primary first. */
function chainFor(job: AiJob): AiJob[] {
  const chain: AiJob[] = [job]
  for (let next = FALLBACK[job]; next && !chain.includes(next); next = FALLBACK[next]) {
    chain.push(next)
  }
  return chain
}

/**
 * Pick a model for a job, degrading before the free tier hard-stops us.
 *
 * Never throws on exhaustion — the caller decides how to degrade. Logging food must
 * never be blocked by AI (PRD-000 Principle 1).
 *
 * The decision itself is `chooseRoute`, which is pure and tested. This function only
 * gathers what it needs: which models are in play, and what they have spent.
 */
export async function route(job: AiJob): Promise<Route> {
  const chain = chainFor(job)
  // `string[]`, not the literal union `MODELS` infers — `chooseRoute` is generic over
  // ids by design so it can be tested without the registry.
  const ids: string[] = chain.map((j) => MODELS[j].id)

  /**
   * Usage is bucketed in the PROVIDER's timezone, so a chain that crosses providers
   * cannot share one query. In practice every chain here is one provider deep or two;
   * the group-by keeps it correct either way.
   */
  const byProvider = new Map<Provider, string[]>()
  for (const j of chain) {
    const { provider, id } = MODELS[j]
    byProvider.set(provider, [...(byProvider.get(provider) ?? []), id])
  }
  const usages = await Promise.all(
    [...byProvider].map(([provider, models]) => usageToday(provider, models)),
  )
  const usage: Record<string, Usage> = {}
  for (const part of usages) Object.assign(usage, part)

  const decision = chooseRoute(ids, usage, CAPS, env.AI_QUOTA_SAFETY_MARGIN)
  const landed = chain[ids.indexOf(decision.id)] ?? job

  return {
    provider: MODELS[landed].provider,
    id: MODELS[landed].id,
    degraded: decision.degraded,
    ...(decision.reason ? { reason: decision.reason } : {}),
  }
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
