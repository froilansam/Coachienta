import { todayLocal } from '@/lib/domain/date'
import { scaleMacros } from '@/lib/domain/macros'
import type { FoodRow } from '@/lib/schemas/food'
import type { Confidence, Macros, ResolutionSource, UnitBasis } from '@/lib/schemas/domain'

/**
 * Pure basket maths. No React, no I/O — so the hook stays thin and this is
 * trivially testable.
 */

export interface DraftItem {
  /** Client-generated. Becomes the row primary key, so replays upsert. */
  id: string
  food: FoodRow
  amount: number
  unit: UnitBasis
  macros: Macros
}

/** Amount to pre-fill: what you usually take, else the food's own basis. */
export const defaultAmount = (food: FoodRow): number =>
  food.usual_amount ?? food.basis_amount

/**
 * Sensible one-tap presets around the default. Gram foods step in useful
 * kitchen amounts; counted foods step by one (PRD-007 §3.7).
 */
export function presetsFor(food: FoodRow): number[] {
  const base = defaultAmount(food)
  if (food.basis_unit === 'piece' || food.basis_unit === 'serving') {
    return [1, 2, 3, 4].filter((n) => n !== base).slice(0, 3).concat(base).sort((a, b) => a - b)
  }
  const step = base >= 200 ? 50 : 25
  return [base - step, base, base + step, base + step * 2].filter((n) => n > 0)
}

export const stepFor = (food: FoodRow): number =>
  food.basis_unit === 'piece' || food.basis_unit === 'serving' ? 1 : 10

export function buildDraftItem(food: FoodRow, amount: number, id: string): DraftItem {
  return {
    id,
    food,
    amount,
    unit: food.basis_unit,
    macros: scaleMacros(food, amount, food.basis_unit),
  }
}

export const emptyMacros: Macros = { kcal: 0, protein_g: 0, carbs_g: 0, fat_g: 0 }

export const sumMacros = (items: readonly DraftItem[]): Macros =>
  items.reduce<Macros>(
    (t, i) => ({
      kcal: Math.round((t.kcal + i.macros.kcal) * 10) / 10,
      protein_g: Math.round((t.protein_g + i.macros.protein_g) * 10) / 10,
      carbs_g: Math.round((t.carbs_g + i.macros.carbs_g) * 10) / 10,
      fat_g: Math.round((t.fat_g + i.macros.fat_g) * 10) / 10,
    }),
    emptyMacros,
  )

/**
 * The row written to `food_log_entries`.
 *
 * Macros are FROZEN here, not referenced. Correcting a food's rate later must
 * never rewrite what this day says you ate (PRD-000 Principle 7, AC-1.6).
 */
export interface LogEntryPayload {
  logged_on: string
  meal: string | null
  food_id: string
  food_name: string
  amount: number
  unit: UnitBasis
  kcal: number
  protein_g: number
  carbs_g: number
  fat_g: number
  food_version: number
  confidence: Confidence
  resolved_by: ResolutionSource
  notes: string | null
}

export function toLogEntry(item: DraftItem, loggedOn: string, meal: string | null): LogEntryPayload {
  return {
    logged_on: loggedOn,
    meal,
    food_id: item.food.id,
    food_name: item.food.name,
    amount: item.amount,
    unit: item.unit,
    ...item.macros,
    food_version: item.food.version,
    confidence: item.food.confidence,
    resolved_by: item.food.source,
    notes: null,
  }
}


/** Re-exported so existing callers keep one import; the implementation and the
 *  timezone reasoning now live in `lib/domain/date.ts`. */
export { todayLocal }

/** Meal suggested from the clock — a starting point, always editable. */
export function mealForHour(hour: number): string {
  if (hour < 10) return 'Breakfast'
  if (hour < 15) return 'Lunch'
  if (hour < 18) return 'Snack'
  return 'Dinner'
}
