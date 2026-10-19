import { NextResponse } from 'next/server'
import { z } from 'zod'
import { coachContext } from '@/lib/ai/coachContext'
import { reviewSessionWithAi } from '@/lib/ai/sessionReview'
import {
  getSession,
  getSessionSets,
  historyByExercise,
  priorSetsByExercise,
  saveSessionReview,
} from '@/lib/db/queries/plan'
import {
  buildReviewBrief,
  reviewFingerprint,
  type ReviewLoggedSet,
} from '@/lib/domain/train/review'

/**
 * A coach's read of a finished session.
 *
 * Idempotent for a given set of logged sets: a second open returns the stored
 * read and does not call the model again. The client asks when a finished
 * session is on screen, so a session finished weeks ago is read the first time
 * it is opened.
 */
const Body = z.object({ id: z.uuid() })

export async function POST(req: Request) {
  const parsed = Body.safeParse(await req.json().catch(() => null))
  if (!parsed.success) {
    return NextResponse.json({ error: 'That session could not be read.' }, { status: 400 })
  }

  const session = await getSession(parsed.data.id)
  if (!session) return NextResponse.json({ error: 'not found' }, { status: 404 })
  if (!session.completed_at) {
    return NextResponse.json({ error: 'Finish the session first.' }, { status: 409 })
  }

  const sets = await getSessionSets(session.id)
  const logged: ReviewLoggedSet[] = sets.map((s) => ({
    position: s.position,
    exerciseId: s.exercise_id,
    setIndex: s.set_index,
    kind: s.kind,
    side: s.side,
    weightKg: s.weight_kg,
    reps: s.reps,
    durationSec: s.duration_sec,
    isPr: s.is_pr,
    prScope: s.pr_scope,
  }))
  const fingerprint = reviewFingerprint(logged)
  if (fingerprint === '') {
    return NextResponse.json(
      { error: 'Nothing was logged, so there is nothing to read.' },
      { status: 422 },
    )
  }

  if (session.review && session.reviewFingerprint === fingerprint) {
    return NextResponse.json({ review: session.review, fingerprint })
  }

  const [history, priorSets, coach] = await Promise.all([
    session.gym_id ? historyByExercise(session.gym_id) : Promise.resolve({}),
    session.gym_id ? priorSetsByExercise(session.gym_id, session.id) : Promise.resolve({}),
    coachContext(),
  ])

  const brief = buildReviewBrief({
    name: session.name,
    performedOn: session.performed_on,
    gymName: session.gym_name ?? 'this gym',
    exercises: session.items.map((item) => ({
      position: item.position,
      exerciseId: item.exercise_id,
      name: item.name,
      muscleGroup: item.exercise?.muscle_group ?? 'other',
      loadType: item.exercise?.load_type ?? 'external_weight',
    })),
    sets: logged,
    history,
    priorSets,
  })

  const result = await reviewSessionWithAi(coach.prompt, brief)
  if (!result.review) {
    return NextResponse.json({ review: null, error: result.error ?? 'The coach could not read this session.' })
  }

  await saveSessionReview(session.id, result.review, fingerprint)
  return NextResponse.json({ review: result.review, fingerprint })
}
