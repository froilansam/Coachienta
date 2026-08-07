import { NextResponse } from 'next/server'
import { z } from 'zod'
import { coachContext } from '@/lib/ai/coachContext'
import { getProfile } from '@/lib/db/queries/profile'
import {
  addRule,
  reorderPriorities,
  retireRule,
  supersedePhase,
  supersedeRule,
  supersedeTargets,
} from '@/lib/db/queries/goals'
import { isBlocked, runChecks, type Finding } from '@/lib/domain/coach/consistency'
import type { Rule } from '@/lib/domain/coach/prompt'
import { todayLocal } from '@/lib/domain/date'

/**
 * Goal editing, the rules registry, and the prompt preview.
 *
 * GET returns the full rule text (active and retired), the assembled prompt, and
 * the consistency findings. POST carries the edits, discriminated by `action`.
 *
 * **The calorie floor is enforced here, not only in the UI.** A client can be
 * bypassed; a safety rule that only lives in a form is not a rule (AC-4.10).
 */
const RULE_CATEGORIES = [
  'persona', 'output_format', 'nutrition', 'training', 'exercise_order',
  'planning', 'progression', 'logging', 'phase', 'safety', 'interaction',
] as const

const nullableInt = z.number().int().nullable()

const TargetsBody = z.object({
  action: z.literal('targets'),
  effective_from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  phase_label: z.string().trim().min(1).max(120),
  kcal_gym_low: nullableInt,
  kcal_gym_high: nullableInt,
  kcal_rest_low: nullableInt,
  kcal_rest_high: nullableInt,
  protein_g: z.number().int().positive(),
  carbs_gym_low: nullableInt,
  carbs_gym_high: nullableInt,
  carbs_rest_low: nullableInt,
  carbs_rest_high: nullableInt,
  fat_low: nullableInt,
  fat_high: nullableInt,
  kcal_floor: nullableInt,
  rationale: z.string().trim().max(1000).nullable().default(null),
})

const PhaseBody = z.object({
  action: z.literal('phase'),
  effective_from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  label: z.string().trim().min(1).max(120),
  goal_kind: z.enum(['cut', 'lean_bulk', 'maintenance', 'recomp', 'peak']),
  target_weight_kg: z.number().positive().max(400).nullable(),
  target_rate_kg_per_week: z.number().min(-2).max(2).nullable(),
  bf_ceiling_pct: z.number().min(0).max(80).nullable(),
  notes: z.string().trim().max(1000).nullable().default(null),
})

const RuleFields = {
  category: z.enum(RULE_CATEGORIES),
  title: z.string().trim().min(1).max(120),
  content: z.string().trim().min(1).max(2000),
  priority: z.number().int().min(1).max(999),
  is_critical: z.boolean(),
}

const PrioritiesBody = z.object({
  action: z.literal('priorities'),
  items: z
    .array(
      z.object({
        muscle_group: z.enum([
          'shoulders_side', 'shoulders_rear', 'shoulders_front', 'back_lats', 'back_mid',
          'chest', 'biceps', 'triceps', 'quads', 'hamstrings', 'glutes', 'calves',
          'abs_core', 'forearms', 'other',
        ]),
        note: z.string().trim().max(200).nullable(),
      }),
    )
    .min(1)
    .max(15),
})

const Body = z.discriminatedUnion('action', [
  TargetsBody,
  PhaseBody,
  PrioritiesBody,
  z.object({ action: z.literal('rule_add'), ...RuleFields }),
  z.object({ action: z.literal('rule_supersede'), id: z.uuid(), ...RuleFields }),
  z.object({ action: z.literal('rule_retire'), id: z.uuid() }),
])

export interface GoalsResponse {
  activeRules: Array<Rule & { id: string }>
  retiredRules: Array<Rule & { id: string }>
  /** Byte-for-byte what the coach will be sent (AC-4.12). */
  prompt: string
  promptTokens: number
  findings: Finding[]
}

/**
 * The prompt is assembled by `coachContext()` and nowhere else, so the preview
 * cannot drift from what the plan builder and the chat route actually send.
 */
async function assemble(): Promise<GoalsResponse> {
  const { activeRules, retiredRules, prompt, promptTokens, findings } = await coachContext()
  return { activeRules, retiredRules, prompt, promptTokens, findings }
}

export async function GET() {
  return NextResponse.json(await assemble())
}

export async function POST(req: Request) {
  const parsed = Body.safeParse(await req.json().catch(() => null))
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues }, { status: 400 })
  }
  const body = parsed.data

  try {
    if (body.action === 'targets') {
      const { action: _t, ...targets } = body
      /**
       * Re-run the checks server-side against the proposed row. The UI shows the
       * same findings live, but the floor has to hold even if the request did not
       * come from the UI.
       */
      const profile = await getProfile()
      const findings = runChecks({
        targets,
        phase: profile.phase,
        measurements: profile.measurements,
        today: todayLocal(),
      })
      if (isBlocked(findings)) {
        return NextResponse.json(
          { error: findings.find((f) => f.severity === 'block')!.message, findings },
          { status: 422 },
        )
      }
      await supersedeTargets(targets)
    } else if (body.action === 'priorities') {
      await reorderPriorities(body.items)
    } else if (body.action === 'phase') {
      const { action: _p, ...phase } = body
      await supersedePhase(phase)
    } else if (body.action === 'rule_add') {
      const { action: _a, ...rule } = body
      await addRule(rule)
    } else if (body.action === 'rule_supersede') {
      const { action: _s, id, ...rule } = body
      await supersedeRule(id, rule)
    } else {
      await retireRule(body.id)
    }
  } catch (err) {
    // The RPCs raise on a backdated supersede or a missing row. That is a refusal
    // with a usable reason, not a server fault.
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'That edit was refused.' },
      { status: 422 },
    )
  }

  return NextResponse.json(await assemble())
}
