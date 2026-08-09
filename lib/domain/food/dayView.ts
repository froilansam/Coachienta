import type { Macros } from '@/lib/schemas/domain'

/**
 * Pure view model for the Today screen. No React, no I/O.
 *
 * The subtle part is that the four numbers do NOT mean the same thing:
 * protein is a floor to reach, fat is a ceiling not to cross, carbs is a
 * minimum, and calories is a band to land inside. Encoding that here — rather
 * than in JSX — is what stops a green arrow celebrating a calorie overshoot
 * (PRD-006 §3.3, PRD-007 §4.2).
 */

export interface DayEntry {
  id: string
  meal: string | null
  foodName: string
  amount: number
  unit: string
  kcal: number
  proteinG: number
  carbsG: number
  fatG: number
  confidence: 'high' | 'medium' | 'low' | 'user_verified'
  loggedAt: string | null
  /** How the macros were resolved — the provenance the detail view shows. */
  resolvedBy: 'library' | 'usda' | 'openfoodfacts' | 'ai_estimate' | 'photo' | 'manual' | null
  /** The `foods.version` in force when this was logged. Entries never move with it. */
  foodVersion: number | null
  notes: string | null
  /** True while the row is still only in IndexedDB. */
  pending?: boolean
}

export interface NutritionTargets {
  kcalGymLow: number | null
  kcalGymHigh: number | null
  kcalRestLow: number | null
  kcalRestHigh: number | null
  proteinG: number
  carbsGymLow: number | null
  carbsRestLow: number | null
  fatHigh: number | null
  phaseLabel: string
}

export type GoalKind = 'band' | 'floor' | 'ceiling'

export interface MacroRow {
  label: string
  value: number
  unit: string
  target: number
  delta: { value: number; direction: 'up' | 'down' | 'flat'; state: 'good' | 'bad' | 'neutral' }
}

const round1 = (n: number) => Math.round(n * 10) / 10
const mid = (lo: number | null, hi: number | null): number | null =>
  lo !== null && hi !== null ? (lo + hi) / 2 : (lo ?? hi)

export const sumEntries = (entries: readonly DayEntry[]): Macros =>
  entries.reduce<Macros>(
    (t, e) => ({
      kcal: round1(t.kcal + e.kcal),
      protein_g: round1(t.protein_g + e.proteinG),
      carbs_g: round1(t.carbs_g + e.carbsG),
      fat_g: round1(t.fat_g + e.fatG),
    }),
    { kcal: 0, protein_g: 0, carbs_g: 0, fat_g: 0 },
  )

/**
 * `band`   — inside is good, either side is not (calories)
 * `floor`  — at or above is good (protein, carbs)
 * `ceiling`— at or below is good (fat)
 */
export function gradeMacro(
  label: string,
  value: number,
  target: number,
  kind: GoalKind,
  unit = 'g',
  tolerance = 0,
): MacroRow {
  const diff = round1(value - target)
  const within = Math.abs(diff) <= tolerance

  const direction = within ? 'flat' : diff > 0 ? 'up' : 'down'
  const state: MacroRow['delta']['state'] = within
    ? 'good'
    : kind === 'floor'
      ? diff > 0 ? 'good' : 'bad'
      : kind === 'ceiling'
        ? diff > 0 ? 'bad' : 'good'
        : 'bad' // band: outside it either way

  return { label, value, unit, target, delta: { value: diff, direction, state } }
}

/** Calories get a tolerance so landing inside the target band reads as on-target. */
export function macroRows(
  totals: Macros,
  t: NutritionTargets,
  isGymDay: boolean,
): { kcal: MacroRow; rows: MacroRow[] } {
  const kcalLow = isGymDay ? t.kcalGymLow : t.kcalRestLow
  const kcalHigh = isGymDay ? t.kcalGymHigh : t.kcalRestHigh
  const kcalTarget = mid(kcalLow, kcalHigh) ?? 0
  const kcalTolerance = kcalHigh !== null && kcalLow !== null ? (kcalHigh - kcalLow) / 2 : 0

  const carbsTarget = (isGymDay ? t.carbsGymLow : t.carbsRestLow) ?? 0

  return {
    kcal: gradeMacro('KCAL', totals.kcal, kcalTarget, 'band', 'kcal', kcalTolerance),
    rows: [
      gradeMacro('PRO', totals.protein_g, t.proteinG, 'floor'),
      gradeMacro('CHO', totals.carbs_g, carbsTarget, 'floor'),
      gradeMacro('FAT', totals.fat_g, t.fatHigh ?? 0, 'ceiling'),
    ],
  }
}

export interface MealGroup {
  meal: string
  entries: DayEntry[]
  totals: Macros
}

/** Groups in the order meals were first logged — not alphabetically. */
export function groupByMeal(entries: readonly DayEntry[]): MealGroup[] {
  const order: string[] = []
  const buckets = new Map<string, DayEntry[]>()

  for (const e of entries) {
    const key = e.meal?.trim() || 'Unspecified'
    if (!buckets.has(key)) {
      buckets.set(key, [])
      order.push(key)
    }
    buckets.get(key)!.push(e)
  }

  return order.map((meal) => {
    const group = buckets.get(meal)!
    return { meal, entries: group, totals: sumEntries(group) }
  })
}

/** `2,350 GOAL − 2,090 FOOD = 260 REMAINING` (MyFitnessPal's visible arithmetic). */
/**
 * `2,350 GOAL − 2,090 FOOD = 260 LEFT`, or on an overshoot `… = 225 OVER`.
 *
 * A negative remainder is stated as a positive number under a different word.
 * `-225 LEFT` makes you decode a minus sign to learn something the label could
 * just say — and browsing past days means seeing overshoot days often, since going
 * over is the common failure. The sign carries the tone too: `neg` when over.
 *
 * Whole calories throughout. `-225.4` beside `2,350` was mixing precisions in one
 * line for a number nobody eats to a tenth of a calorie.
 */
export function remainingTerms(consumed: number, goal: number) {
  const diff = goal - consumed
  const over = diff < 0
  return [
    { label: 'GOAL', value: goal },
    { label: 'FOOD', value: Math.round(consumed), operator: '−' as const },
    {
      label: over ? 'OVER' : 'LEFT',
      value: Math.round(Math.abs(diff)),
      operator: '=' as const,
      tone: over ? ('neg' as const) : ('accent' as const),
    },
  ]
}

export const pctOf = (value: number, target: number): number =>
  target <= 0 ? 0 : Math.round((value / target) * 100)
