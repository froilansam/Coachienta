import { NextResponse } from 'next/server'
import { z } from 'zod'
import { getActiveRules } from '@/lib/db/queries/goals'
import { listExercises } from '@/lib/db/queries/exercises'
import {
  historyByExercise,
  listGyms,
  listTemplates,
  startSession,
  type GymRow,
  type TemplateRow,
} from '@/lib/db/queries/plan'
import type { Exercise } from '@/lib/domain/train/exercise'
import type { CriticalRule } from '@/lib/domain/train/plan'
import type { History } from '@/lib/domain/train/progression'

/**
 * Everything the day-plan screen needs, and the one write it makes.
 *
 * The critical coach rules come down with the rest so the plan can warn about an
 * order violation before you start (AC-2.11). They are read server-side from the
 * same `coach_rules` rows the prompt uses — there is no second copy to drift.
 */
export interface PlanPayload {
  gyms: GymRow[]
  templates: TemplateRow[]
  exercises: Exercise[]
  history: Record<string, History>
  criticalRules: CriticalRule[]
}

const StartBody = z.object({
  session_id: z.uuid(),
  name: z.string().trim().min(1).max(120),
  performed_on: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  gym_id: z.uuid(),
  items: z
    .array(
      z.object({
        exercise_id: z.uuid(),
        target_sets: z.number().int().min(1).max(20),
        rep_low: z.number().int().min(1).max(600).nullable(),
        rep_high: z.number().int().min(1).max(600).nullable(),
      }),
    )
    .min(1),
})

export async function GET(req: Request) {
  const gymParam = new URL(req.url).searchParams.get('gym')
  const [gyms, templates, exercises, rules] = await Promise.all([
    listGyms(),
    listTemplates(),
    listExercises(),
    getActiveRules(),
  ])

  const gymId = gymParam ?? gyms.find((g) => g.is_current)?.id ?? gyms[0]?.id ?? null

  return NextResponse.json<PlanPayload>({
    gyms,
    templates,
    exercises,
    history: gymId ? await historyByExercise(gymId) : {},
    criticalRules: rules
      .filter((r) => r.is_critical)
      .map((r) => ({ title: r.title, content: r.content, category: r.category })),
  })
}

export async function POST(req: Request) {
  const parsed = StartBody.safeParse(await req.json().catch(() => null))
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues }, { status: 400 })
  }
  try {
    return NextResponse.json({ session: await startSession(parsed.data) })
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Could not start that session.' },
      { status: 422 },
    )
  }
}
