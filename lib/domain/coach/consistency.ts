/**
 * The eight self-consistency checks (PRD-006 §3.7, AC-4.15).
 *
 * They exist because the spreadsheet's own numbers contradicted each other and
 * nothing noticed: its carb and protein targets summed above its stated calorie
 * ceiling, a 15% body-fat ceiling sat in one tab while a 20% reading sat in
 * another, and a rule requiring BMR recalculation on weight change was never
 * executed. Every check below is a contradiction that actually existed.
 *
 * **They warn, they do not block** — with one exception. A calorie target under
 * the phase's `kcal_floor` is a safety rule, not a preference, so it is the only
 * hard stop (AC-4.10).
 *
 * Pure: no I/O, no React. Runs on save and on profile load, so the same code
 * answers "may I save this?" and "is what I already saved still coherent?".
 */
import type { Measurement } from '@/lib/domain/body'
import { daysSinceWeighIn, latestOf, trendOf } from '@/lib/domain/body'

export type CheckId =
  | 'bf_over_ceiling'
  | 'weight_off_target_rate'
  | 'protein_per_kg_low'
  | 'kcal_below_floor'
  | 'macros_exceed_kcal'
  | 'phase_without_target'
  | 'weigh_in_stale'
  | 'priority_volume_mismatch'

export interface Finding {
  id: CheckId
  /** `block` refuses the save. `warn` is information the user may accept. */
  severity: 'block' | 'warn'
  message: string
}

export interface Targets {
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

export interface Phase {
  target_rate_kg_per_week: number | null
  bf_ceiling_pct: number | null
}

export interface VolumeShare {
  rank: number
  muscle_group: string
  share_pct: number
}

export interface CheckInput {
  targets: Targets | null
  phase: Phase | null
  measurements: readonly Measurement[]
  today: string
  /** Empty before any training is logged — check 8 then reports nothing. */
  volumeShare?: readonly VolumeShare[]
}

/** Protein below this is low for a physique goal, per §3.7. */
const MIN_PROTEIN_G_PER_KG = 1.6
/** Beyond this the weight trend contradicts the phase's stated rate. */
const RATE_TOLERANCE = 0.1
const STALE_WEIGH_IN_DAYS = 14

const round1 = (n: number) => Math.round(n * 10) / 10

/**
 * Atwater on the target itself: 4·protein + 4·carbs + 9·fat against the calorie
 * ceiling. Uses the LOW ends of the carb and fat ranges, because if even the
 * bottom of the range breaks the ceiling then every point in it does.
 */
export function targetKcalFromMacros(t: Targets, day: 'gym' | 'rest'): number | null {
  const carbs = day === 'gym' ? t.carbs_gym_low : t.carbs_rest_low
  if (carbs === null || t.fat_low === null) return null
  return 4 * t.protein_g + 4 * carbs + 9 * t.fat_low
}

export function runChecks(input: CheckInput): Finding[] {
  const { targets, phase, measurements, today } = input
  const out: Finding[] = []

  const weight = latestOf(measurements, 'weight_kg')
  const bf = latestOf(measurements, 'body_fat_pct')

  // 4 — the only hard block. Checked first so a refusal is never buried.
  if (targets?.kcal_floor !== null && targets !== null) {
    const lowest = Math.min(
      ...[targets.kcal_gym_low, targets.kcal_rest_low].filter((v): v is number => v !== null),
    )
    if (Number.isFinite(lowest) && lowest < targets.kcal_floor!) {
      out.push({
        id: 'kcal_below_floor',
        severity: 'block',
        message: `${lowest} kcal is below your ${targets.kcal_floor} kcal floor. The floor is a safety rule, not a preference.`,
      })
    }
  }

  // 5 — macro grams versus the calorie ceiling. The spreadsheet's actual error.
  if (targets) {
    for (const day of ['gym', 'rest'] as const) {
      const implied = targetKcalFromMacros(targets, day)
      const ceiling = day === 'gym' ? targets.kcal_gym_high : targets.kcal_rest_high
      if (implied !== null && ceiling !== null && implied > ceiling) {
        const carbs = day === 'gym' ? targets.carbs_gym_low : targets.carbs_rest_low
        out.push({
          id: 'macros_exceed_kcal',
          severity: 'warn',
          message: `On ${day} days ${carbs} g carbs + ${targets.protein_g} g protein + ${targets.fat_low} g fat ≈ ${implied} kcal, above your ${ceiling} kcal ceiling.`,
        })
      }
    }
  }

  // 3 — protein relative to bodyweight, not an absolute.
  if (targets && weight) {
    const perKg = round1(targets.protein_g / weight.value)
    if (perKg < MIN_PROTEIN_G_PER_KG) {
      out.push({
        id: 'protein_per_kg_low',
        severity: 'warn',
        message: `${targets.protein_g} g is ${perKg} g/kg at ${weight.value} kg — below ${MIN_PROTEIN_G_PER_KG} g/kg is low for your goal.`,
      })
    }
  }

  // 1 — a breached stop-condition, which the spreadsheet kept in another tab.
  if (bf && phase?.bf_ceiling_pct !== null && phase !== null) {
    if (bf.value > phase.bf_ceiling_pct!) {
      out.push({
        id: 'bf_over_ceiling',
        severity: 'warn',
        message: `Last reading ${bf.value}% exceeds your ${phase.bf_ceiling_pct}% ceiling for this phase.`,
      })
    }
  }

  // 2 — is the scale doing what the phase says it should?
  const trend = trendOf(measurements, 'weight_kg')
  if (trend?.perWeek !== null && trend !== null && phase?.target_rate_kg_per_week !== null && phase !== null) {
    const target = phase.target_rate_kg_per_week!
    if (Math.abs(trend.perWeek - target) > RATE_TOLERANCE) {
      out.push({
        id: 'weight_off_target_rate',
        severity: 'warn',
        message: `Trending ${trend.perWeek > 0 ? '+' : ''}${trend.perWeek} kg/wk against a ${target} kg/wk target.`,
      })
    }
  }

  // 6 — a phase with nothing to measure it by.
  if (phase && !targets) {
    out.push({
      id: 'phase_without_target',
      severity: 'warn',
      message: 'Phase set but no nutrition target active.',
    })
  }

  // 7 — stale weight makes every derived figure stale with it.
  const stale = daysSinceWeighIn(measurements, today)
  if (stale !== null && stale > STALE_WEIGH_IN_DAYS) {
    out.push({
      id: 'weigh_in_stale',
      severity: 'warn',
      message: `Last weigh-in was ${stale} days ago. Coach advice depends on current weight.`,
    })
  }

  /**
   * 8 — stated priority versus where the volume actually went. Reported only when
   * training exists: before that, every share is 0% and "shoulders received 0% of
   * volume" would read as neglect when the truth is "you have not trained yet".
   */
  const shares = input.volumeShare ?? []
  if (shares.length > 0) {
    const top = shares.find((s) => s.rank === 1)
    const biggest = [...shares].sort((a, b) => b.share_pct - a.share_pct)[0]
    if (top && biggest && biggest.muscle_group !== top.muscle_group && biggest.share_pct > top.share_pct) {
      out.push({
        id: 'priority_volume_mismatch',
        severity: 'warn',
        message: `${label(top.muscle_group)} is ranked #1 but received ${top.share_pct}% of volume, behind ${label(biggest.muscle_group)} at ${biggest.share_pct}%.`,
      })
    }
  }

  return out
}

const label = (mg: string): string => mg.replace(/_/g, ' ')

/** True when nothing may be saved. Only the calorie floor can produce this. */
export const isBlocked = (findings: readonly Finding[]): boolean =>
  findings.some((f) => f.severity === 'block')
