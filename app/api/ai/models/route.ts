import { NextResponse } from 'next/server'
import { DAILY_REQUEST_CAP, DAILY_TOKEN_CAP, MODELS, QUOTA_TZ } from '@/lib/ai/models'
import { db } from '@/lib/db/client'
import {
  LABEL,
  MODEL_CHOICES,
  type ModelOption,
  type Quota,
} from '@/lib/domain/coach/models'

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

    const tokenCap = DAILY_TOKEN_CAP[id]
    const requestCap = DAILY_REQUEST_CAP[id]

    /**
     * Tokens where the provider limits tokens, requests where it limits calls. Reporting
     * the wrong unit would be worse than reporting nothing: 3 of 20 requests looks
     * comfortable, and 3 of 20 *tokens* looks broken.
     */
    const quota: Quota =
      requestCap !== undefined
        ? { kind: 'requests', used: Number(today?.requests ?? 0), cap: requestCap }
        : {
            kind: 'tokens',
            used: Number(today?.input_tokens ?? 0) + Number(today?.output_tokens ?? 0),
            cap: tokenCap ?? 0,
          }

    return { choice, id, quota, ...LABEL[choice] }
  })

  return NextResponse.json<ModelsPayload>({ options })
}
