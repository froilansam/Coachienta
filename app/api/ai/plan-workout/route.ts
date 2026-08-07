import { NextResponse } from 'next/server'
import { z } from 'zod'
import { coachContext } from '@/lib/ai/coachContext'
import { planWorkoutWithAi } from '@/lib/ai/planWorkout'
import { listExercises } from '@/lib/db/queries/exercises'
import { historyByExercise, listGyms } from '@/lib/db/queries/plan'
import { todayLocal } from '@/lib/domain/date'
import type { CriticalRule } from '@/lib/domain/train/plan'
import {
  buildPlanPrompt,
  catalogue,
  draftNotice,
  enforceCriticalOrder,
  hydrate,
  keepKnownExercises,
} from '@/lib/domain/train/planPrompt'

/**
 * A prompt in, a draft plan out (PRD-004 §4.2a).
 *
 * **Every fact is assembled here, never taken from the client.** The request carries
 * only the sentence the user typed and which gym it is for; the library, the history,
 * the coach rules and the priority order are all read server-side. A client that
 * could supply the catalogue could supply an exercise that does not exist.
 *
 * **This route writes nothing.** No `workout_sessions` row, no plan row — `START
 * SESSION` remains an explicit second step (AC-2.17), exactly as a food photo yields
 * candidates without logging anything (AC-1.9).
 *
 * The response is a list of exercise ids with set counts and rep ranges. LAST, BEST
 * and today's target are attached by the plan screen from SQL, which is why the model
 * is never asked for a weight.
 */
const Body = z.object({
  prompt: z.string().trim().min(2).max(300),
  gym_id: z.uuid().nullable().default(null),
})

export interface AiPlanItem {
  exercise_id: string
  /**
   * The library's own name for that id. The client does not need it — it resolves the
   * exercise itself — but `npm run probe:plan` does, and plan QUALITY is only ever
   * judged by a human reading this list. A response of bare uuids cannot be judged.
   */
  name: string
  target_sets: number
  rep_low: number
  rep_high: number
  /** The model's one-line reason, or null. Display only. */
  why: string | null
}

export interface AiPlanResponse {
  title: string
  rationale: string
  items: AiPlanItem[]
  /**
   * Everything the model could not honour, plus anything the server corrected —
   * invented exercises dropped, duplicates collapsed, an order violation reordered.
   * A draft silently edited on the way out is a draft you cannot reason about.
   */
  notice: string | null
  /** True when the primary model was out of quota and the fallback answered. */
  degraded: boolean
}

export async function POST(req: Request) {
  const parsed = Body.safeParse(await req.json().catch(() => null))
  if (!parsed.success) {
    return NextResponse.json({ error: 'A short description of the session is required.' }, { status: 400 })
  }

  const [{ prompt, gym_id }, gyms, exercises, coach] = await Promise.all([
    Promise.resolve(parsed.data),
    listGyms(),
    listExercises(),
    coachContext(),
  ])

  const gymId = gym_id ?? gyms.find((g) => g.is_current)?.id ?? gyms[0]?.id ?? null
  if (gymId === null) {
    return NextResponse.json({ error: 'No gym is set up yet.' }, { status: 422 })
  }

  // Gym-scoped, like every other history read — a 45 kg cable stack at one gym is not
  // 45 kg at another (§3.2).
  const history = await historyByExercise(gymId)

  const system = buildPlanPrompt({
    coachPrompt: coach.prompt,
    catalogue: catalogue(exercises, history),
    gymName: gyms.find((g) => g.id === gymId)?.name ?? 'Unknown gym',
    today: todayLocal(),
  })

  const { plan, degraded, error } = await planWorkoutWithAi(system, prompt)
  if (plan === null) {
    // A visible, recoverable refusal — Template and Empty are untouched (AC-2.20).
    return NextResponse.json(
      { error: error ?? 'The plan builder is unavailable.', degraded },
      { status: 503 },
    )
  }

  const byId = new Map(exercises.map((e) => [e.id, e]))

  // Guard 1 (AC-2.15): nothing that is not in the library survives.
  const kept = keepKnownExercises(plan.items, byId)

  // Guard 2 (AC-2.16): a critical order rule cannot come out of here broken. Same
  // checker the plan screen warns with, so the two cannot disagree.
  const criticalRules: CriticalRule[] = coach.activeRules
    .filter((r) => r.is_critical)
    .map((r) => ({ title: r.title, content: r.content, category: r.category }))
  const ordered = enforceCriticalOrder(hydrate(kept.items, byId), criticalRules)

  if (ordered.items.length === 0) {
    return NextResponse.json(
      {
        error:
          'Nothing in your library matched that. Try naming a muscle group, or add exercises by hand.',
        degraded,
      },
      { status: 422 },
    )
  }

  return NextResponse.json<AiPlanResponse>({
    title: plan.title,
    rationale: plan.rationale,
    items: ordered.items.map((item) => ({
      exercise_id: item.exercise.id,
      name: item.exercise.name,
      target_sets: item.target_sets,
      rep_low: item.rep_low ?? 8,
      rep_high: item.rep_high ?? 12,
      why: item.progression_rule,
    })),
    notice: draftNotice({
      modelNotice: plan.notice,
      invented: kept.invented,
      duplicates: kept.duplicates,
      moved: ordered.moved,
      unresolved: ordered.unresolved,
    }),
    degraded,
  })
}
