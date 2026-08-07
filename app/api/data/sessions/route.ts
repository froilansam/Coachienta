import { NextResponse } from 'next/server'
import { listExercises } from '@/lib/db/queries/exercises'
import { listSessions, type SessionSummaryRow } from '@/lib/db/queries/plan'
import type { Exercise } from '@/lib/domain/train/exercise'

/**
 * The Train home list (AC-2.21). Read-only.
 *
 * Deletion is NOT here — it goes through the offline queue like a food delete, so
 * removing a session works with no signal and the UI does not have to wait
 * (§4.3a). `workout_sets` cascade at the database, so one delete is enough.
 */
export interface SessionsPayload {
  sessions: SessionSummaryRow[]
  /** Sent along so the mid-session picker has a library without a second request. */
  exercises: Exercise[]
}

export async function GET() {
  const [sessions, exercises] = await Promise.all([listSessions(), listExercises()])
  return NextResponse.json<SessionsPayload>({ sessions, exercises })
}
