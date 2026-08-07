import { NextResponse } from 'next/server'
import { CAPS, MODELS, QUOTA_TZ } from '@/lib/ai/models'
import { db } from '@/lib/db/client'
import {
  LABEL,
  MODEL_CHOICES,
  type ModelOption,
  type Quota,
} from '@/lib/domain/ai/models'

/**
 * Which models the coach can use, and how much of each one's day is spent (US-3.7).
 *
 * Switching model here is a **quota** decision, not a taste one: the three options draw
 * on three unrelated pools. Showing the figures is the point — the reason to switch is
 * that one is nearly gone, and without the numbers that is invisible until a reply fails.
 *
 * Read-only. The choice itself lives on the client and travels with each message.
 */
export interface ModelsPayload {
  options: ModelOption[]
}

/** Provider-local calendar day — counting on our own timezone would reset early. */
const usageDate = (provider: string) =>
  new Intl.DateTimeFormat('en-CA', { timeZone: QUOTA_TZ[provider as 'groq'] ?? 'UTC' }).format(
    new Date(),
  )

export async function GET() {
  const { data } = await db
    .from('ai_usage_daily')
    .select('usage_date, provider, model, requests, input_tokens, output_tokens')

  const rows = data ?? []

  const options: ModelOption[] = MODEL_CHOICES.map((choice) => {
    const { provider, id } = MODELS[choice]
    const today = rows.find(
      (r) => r.model === id && r.provider === provider && r.usage_date === usageDate(provider),
    )

    /**
     * One lookup, one unit — `CAPS` already knows which one this model is metered in.
     * The branch this replaced could report the wrong unit, and 3 of 20 requests looks
     * comfortable where 3 of 20 *tokens* looks broken.
     */
    const cap = CAPS[id]
    const quota: Quota =
      cap?.kind === 'requests'
        ? { kind: 'requests', used: Number(today?.requests ?? 0), cap: cap.limit }
        : {
            kind: 'tokens',
            used: Number(today?.input_tokens ?? 0) + Number(today?.output_tokens ?? 0),
            cap: cap?.limit ?? 0,
          }

    return { choice, id, quota, ...LABEL[choice] }
  })

  return NextResponse.json<ModelsPayload>({ options })
}
