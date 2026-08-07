import 'server-only'
import { db } from '@/lib/db/client'
import type { Measurement } from '@/lib/domain/body'

/**
 * Everything the profile screen reads, and the one thing it writes.
 *
 * Weigh-ins are append-only: a new reading is a new row, never an update
 * (AC-4.4). Current weight is derived from the rows, so there is no second place
 * for it to be wrong.
 */
export interface ProfileRow {
  display_name: string | null
  birth_date: string | null
  height_cm: number | null
  sex: 'male' | 'female' | null
  timezone: string | null
  unit_pref: string | null
  medical_notes: string | null
}

export interface PhaseRow {
  label: string
  goal_kind: string
  effective_from: string
  target_weight_kg: number | null
  target_rate_kg_per_week: number | null
  bf_ceiling_pct: number | null
  notes: string | null
}

export interface TargetRow {
  phase_label: string
  effective_from: string
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
}

export interface PriorityRow {
  rank: number
  muscle_group: string
  note: string | null
}

export interface RuleSummary {
  category: string
  title: string
  is_critical: boolean
  priority: number
}

export interface ProfilePayload {
  profile: ProfileRow | null
  measurements: Measurement[]
  phase: PhaseRow | null
  targets: TargetRow | null
  priorities: PriorityRow[]
  rules: RuleSummary[]
  retiredRuleCount: number
}

/** One round trip per table, all in parallel — none depends on another. */
export async function getProfile(): Promise<ProfilePayload> {
  const [prof, meas, phase, targets, priorities, rules, retired] = await Promise.all([
    db.from('profile').select('*').maybeSingle(),
    db
      .from('body_measurements')
      .select('measured_on, weight_kg, waist_cm, body_fat_pct, bmr_kcal, source')
      .order('measured_on', { ascending: false })
      .limit(400),
    db.from('training_phases').select('*').is('effective_to', null).maybeSingle(),
    db.from('nutrition_targets').select('*').is('effective_to', null).maybeSingle(),
    db.from('physique_priorities').select('rank, muscle_group, note').order('rank'),
    db
      .from('coach_rules')
      .select('category, title, is_critical, priority')
      .eq('is_active', true)
      .is('superseded_by', null)
      .order('priority'),
    db
      .from('coach_rules')
      .select('id', { count: 'exact', head: true })
      .not('superseded_by', 'is', null),
  ])

  const num = (v: unknown): number | null => (v === null || v === undefined ? null : Number(v))

  return {
    profile: prof.data
      ? {
          display_name: prof.data.display_name,
          birth_date: prof.data.birth_date,
          height_cm: num(prof.data.height_cm),
          sex: prof.data.sex,
          timezone: prof.data.timezone,
          unit_pref: prof.data.unit_pref,
          medical_notes: prof.data.medical_notes,
        }
      : null,
    measurements: (meas.data ?? []).map((r) => ({
      measured_on: r.measured_on as string,
      weight_kg: num(r.weight_kg),
      waist_cm: num(r.waist_cm),
      body_fat_pct: num(r.body_fat_pct),
      bmr_kcal: num(r.bmr_kcal),
      source: (r.source as string | null) ?? null,
    })),
    phase: phase.data
      ? {
          label: phase.data.label,
          goal_kind: phase.data.goal_kind,
          effective_from: phase.data.effective_from,
          target_weight_kg: num(phase.data.target_weight_kg),
          target_rate_kg_per_week: num(phase.data.target_rate_kg_per_week),
          bf_ceiling_pct: num(phase.data.bf_ceiling_pct),
          notes: phase.data.notes,
        }
      : null,
    targets: targets.data
      ? {
          phase_label: targets.data.phase_label,
          effective_from: targets.data.effective_from,
          kcal_gym_low: targets.data.kcal_gym_low,
          kcal_gym_high: targets.data.kcal_gym_high,
          kcal_rest_low: targets.data.kcal_rest_low,
          kcal_rest_high: targets.data.kcal_rest_high,
          protein_g: targets.data.protein_g,
          carbs_gym_low: targets.data.carbs_gym_low,
          carbs_gym_high: targets.data.carbs_gym_high,
          carbs_rest_low: targets.data.carbs_rest_low,
          carbs_rest_high: targets.data.carbs_rest_high,
          fat_low: targets.data.fat_low,
          fat_high: targets.data.fat_high,
          kcal_floor: targets.data.kcal_floor,
        }
      : null,
    priorities: (priorities.data ?? []) as PriorityRow[],
    rules: (rules.data ?? []) as RuleSummary[],
    retiredRuleCount: retired.count ?? 0,
  }
}

/** Profile is exactly one row, keyed `id = true` — see `0001_init.sql`. */
export async function updateProfile(patch: Partial<ProfileRow>): Promise<void> {
  const { error } = await db.from('profile').update(patch).eq('id', true)
  if (error) throw new Error(`updateProfile: ${error.message}`)
}

/**
 * Append-only. `measured_on` is unique, so re-weighing on the same day corrects
 * that day rather than creating a second reading for it.
 *
 * Deliberately update-or-insert rather than a PostgREST `upsert` on
 * `measured_on`. Two reasons, both learned the hard way:
 *
 * 1. **`body_measurements.id` has no `default gen_random_uuid()`.** Like
 *    `food_log_entries`, this table follows the client-generated-uuid pattern
 *    (PRD-001 §4.2), so an insert that omits `id` violates the not-null primary
 *    key.
 * 2. An `upsert` carrying a fresh uuid would, on conflict, **rewrite the existing
 *    row's primary key**. Correcting today's weight must not change the identity
 *    of today's reading.
 */
export async function saveWeighIn(row: {
  measured_on: string
  weight_kg: number
  waist_cm: number | null
  body_fat_pct: number | null
  notes: string | null
}): Promise<void> {
  const { measured_on, ...values } = row

  const existing = await db
    .from('body_measurements')
    .select('id')
    .eq('measured_on', measured_on)
    .maybeSingle()
  if (existing.error) throw new Error(`saveWeighIn lookup: ${existing.error.message}`)

  const { error } = existing.data
    ? await db
        .from('body_measurements')
        .update({ ...values, source: 'manual' })
        .eq('id', existing.data.id)
    : await db
        .from('body_measurements')
        .insert({ id: crypto.randomUUID(), measured_on, ...values, source: 'manual' })

  if (error) throw new Error(`saveWeighIn: ${error.message}`)
}
