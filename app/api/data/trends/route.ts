import { NextResponse } from 'next/server'
import { listGyms, type GymRow } from '@/lib/db/queries/plan'
import { trainingTrends, type TrainingTrends } from '@/lib/db/queries/trends'

/**
 * Everything the trends screen draws, in one round trip.
 *
 * Read-only by design — there is no POST here. A trend is a question the database
 * answers on the spot, never a stored snapshot: the spreadsheet's Next Session
 * Targets tab was 57 days stale while the coach was told to read it first (§3.4).
 * Nothing on this screen can go stale because nothing on it is saved.
 */
export interface TrendsPayload extends TrainingTrends {
  gyms: GymRow[]
  gymId: string | null
  /** Ranked physique priorities, for the adherence chart (AC-4.14). */
  days: number
}

export async function GET(req: Request) {
  const url = new URL(req.url)
  const gymParam = url.searchParams.get('gym')
  const days = Number(url.searchParams.get('days') ?? 84)

  const gyms = await listGyms()
  const gymId = gymParam ?? gyms.find((g) => g.is_current)?.id ?? gyms[0]?.id ?? null

  if (gymId === null) {
    return NextResponse.json<TrendsPayload>({
      gyms,
      gymId: null,
      days,
      muscle: [],
      total: [],
      prs: [],
      tops: [],
      sessions: [],
      share: [],
    })
  }

  const trends = await trainingTrends(gymId, Number.isFinite(days) ? days : 84)
  return NextResponse.json<TrendsPayload>({ ...trends, gyms, gymId, days })
}
