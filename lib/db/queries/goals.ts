import 'server-only'
import { db } from '@/lib/db/client'
import type { Rule } from '@/lib/domain/coach/prompt'
import type { VolumeShare } from '@/lib/domain/coach/consistency'

/**
 * Goal edits. Every one is a supersede — see `0013_goal_editing.sql` for why they
 * are RPCs (the `one_active_*` indexes forbid two open rows for an instant).
 */
export interface TargetsInput {
  effective_from: string
  phase_label: string
  kcal_gym_low: number | null
  kcal_gym_high: number | null
  kcal_rest_low: number | null
  kcal_rest_high: number | null
  protein_g: number
  carbs_gym_low: number | null
  carbs_gym_high: number | null
  carbs_rest_low: number | null
  carbs_rest_high: number | null
  fat_low: number | null
  fat_high: number | null
  kcal_floor: number | null
  rationale: string | null
}

export async function supersedeTargets(t: TargetsInput): Promise<void> {
  const { error } = await db.rpc('supersede_nutrition_targets', {
    p_effective_from: t.effective_from,
    p_phase_label: t.phase_label,
    p_kcal_gym_low: t.kcal_gym_low,
    p_kcal_gym_high: t.kcal_gym_high,
    p_kcal_rest_low: t.kcal_rest_low,
    p_kcal_rest_high: t.kcal_rest_high,
    p_protein_g: t.protein_g,
    p_carbs_gym_low: t.carbs_gym_low,
    p_carbs_gym_high: t.carbs_gym_high,
    p_carbs_rest_low: t.carbs_rest_low,
    p_carbs_rest_high: t.carbs_rest_high,
    p_fat_low: t.fat_low,
    p_fat_high: t.fat_high,
    p_kcal_floor: t.kcal_floor,
    p_rationale: t.rationale,
  })
  if (error) throw new Error(error.message)
}

export interface PhaseInput {
  effective_from: string
  label: string
  goal_kind: string
  target_weight_kg: number | null
  target_rate_kg_per_week: number | null
  bf_ceiling_pct: number | null
  notes: string | null
}

export async function supersedePhase(p: PhaseInput): Promise<void> {
  const { error } = await db.rpc('supersede_training_phase', {
    p_effective_from: p.effective_from,
    p_label: p.label,
    p_goal_kind: p.goal_kind,
    p_target_weight_kg: p.target_weight_kg,
    p_target_rate_kg_per_week: p.target_rate_kg_per_week,
    p_bf_ceiling_pct: p.bf_ceiling_pct,
    p_notes: p.notes,
  })
  if (error) throw new Error(error.message)
}

export interface RuleInput {
  category: string
  title: string
  content: string
  priority: number
  is_critical: boolean
}

export async function addRule(r: RuleInput): Promise<void> {
  const { error } = await db.from('coach_rules').insert({ ...r, source: 'added in app' })
  if (error) throw new Error(error.message)
}

export async function supersedeRule(oldId: string, r: RuleInput): Promise<void> {
  const { error } = await db.rpc('supersede_coach_rule', {
    p_old_id: oldId,
    p_category: r.category,
    p_title: r.title,
    p_content: r.content,
    p_priority: r.priority,
    p_is_critical: r.is_critical,
  })
  if (error) throw new Error(error.message)
}

export async function retireRule(id: string): Promise<void> {
  const { error } = await db.rpc('retire_coach_rule', { p_id: id })
  if (error) throw new Error(error.message)
}

/** Full rule text, needed to assemble a prompt (titles alone are not the rule). */
export async function getActiveRules(): Promise<Array<Rule & { id: string }>> {
  const { data, error } = await db
    .from('coach_rules')
    .select('id, category, title, content, priority, is_critical')
    .eq('is_active', true)
    .is('superseded_by', null)
    .order('priority')
  if (error) throw new Error(error.message)
  return (data ?? []) as Array<Rule & { id: string }>
}

/** Retired rules stay visible in history and out of the prompt (AC-4.9). */
export async function getRetiredRules(): Promise<Array<Rule & { id: string }>> {
  const { data, error } = await db
    .from('coach_rules')
    .select('id, category, title, content, priority, is_critical')
    .eq('is_active', false)
    .order('priority')
  if (error) throw new Error(error.message)
  return (data ?? []) as Array<Rule & { id: string }>
}

/**
 * Replaces the whole priority list. One statement cannot swap two ranks — `rank` is
 * the primary key and `muscle_group` is unique, so every intermediate state
 * collides. See `0014_reorder_priorities.sql`.
 */
export async function reorderPriorities(
  items: ReadonlyArray<{ muscle_group: string; note: string | null }>,
): Promise<void> {
  const { error } = await db.rpc('reorder_physique_priorities', {
    p_groups: items.map((i) => i.muscle_group),
    p_notes: items.map((i) => i.note ?? ''),
  })
  if (error) throw new Error(error.message)
}

/** Empty until sets exist — check 8 stays silent rather than reporting 0%. */
export async function getVolumeShare(days = 30): Promise<VolumeShare[]> {
  const { data, error } = await db.rpc('priority_volume_share', { p_days: days })
  if (error) throw new Error(error.message)
  return (data ?? []) as VolumeShare[]
}
