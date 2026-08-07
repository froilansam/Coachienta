import { NextResponse } from 'next/server'
import { z } from 'zod'
import {
  addSessionExercise,
  finishSession,
  getSession,
  getSessionSets,
  historyByExercise,
  priorSetsByExercise,
  removeSessionExercise,
  type LoggedSet,
  type SessionView,
} from '@/lib/db/queries/plan'
import type { PriorSet } from '@/lib/domain/train/detectPr'
import type { History } from '@/lib/domain/train/progression'

/**
 * One round trip for everything the live session screen needs: the plan it was
 * started from, the sets already logged, and per-exercise history at its gym.
 *
 * Sets are NOT written here — they go through `/api/data/sync` via the offline
 * queue, so a set lands in IndexedDB first and uploads later (AC-2.1, AC-2.9). This
 * route is the initial read and the finish stamp.
 */
export interface SessionPayload {
  session: SessionView
  sets: LoggedSet[]
  history: Record<string, History>
  /** Prior sets per exercise at this gym — PR detection runs on these, locally. */
  priorSets: Record<string, PriorSet[]>
}

export async function GET(req: Request) {
  const id = new URL(req.url).searchParams.get('id')
  if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 })

  const session = await getSession(id)
  if (!session) return NextResponse.json({ error: 'not found' }, { status: 404 })

  const [sets, history, priorSets] = await Promise.all([
    getSessionSets(id),
    session.gym_id ? historyByExercise(session.gym_id) : Promise.resolve({}),
    session.gym_id ? priorSetsByExercise(session.gym_id, id) : Promise.resolve({}),
  ])

  return NextResponse.json<SessionPayload>({ session, sets, history, priorSets })
}

const FinishBody = z.object({ id: z.uuid() })

export async function POST(req: Request) {
  const parsed = FinishBody.safeParse(await req.json().catch(() => null))
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues }, { status: 400 })
  }
  await finishSession(parsed.data.id)
  return NextResponse.json({ ok: true })
}

/**
 * Mid-session exercise editing (US-2.18, AC-2.23).
 *
 * Not on the offline queue, and the reason is worth stating: `plan_exercises` has no
 * Dexie mirror, so an exercise added while offline would show a block whose sets
 * survive a reload and whose heading does not. The SETS stay local-first — that is
 * the part that has to work in a basement — and this asks for a connection.
 */
const EditBody = z.discriminatedUnion('op', [
  z.object({
    op: z.literal('add_exercise'),
    session_id: z.uuid(),
    exercise_id: z.uuid(),
    target_sets: z.number().int().min(1).max(20).default(3),
    rep_low: z.number().int().min(1).max(600).nullable().default(null),
    rep_high: z.number().int().min(1).max(600).nullable().default(null),
  }),
  z.object({
    op: z.literal('remove_exercise'),
    session_id: z.uuid(),
    position: z.number().int().min(1),
  }),
])

export async function PATCH(req: Request) {
  const parsed = EditBody.safeParse(await req.json().catch(() => null))
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues }, { status: 400 })
  }
  const body = parsed.data
  try {
    if (body.op === 'add_exercise') {
      const position = await addSessionExercise(
        body.session_id,
        body.exercise_id,
        body.target_sets,
        body.rep_low,
        body.rep_high,
      )
      return NextResponse.json({ ok: true, position })
    }
    await removeSessionExercise(body.session_id, body.position)
    return NextResponse.json({ ok: true })
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Could not change that session.' },
      { status: 422 },
    )
  }
}
