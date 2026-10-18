import { describe, expect, it } from 'vitest'
import type { FoodRow } from '@/lib/schemas/food'
import {
  buildDraftItem, defaultAmount, mealForHour, presetsFor,
  stepFor, sumMacros, todayLocal, toDayEntry, toLogEntry,
} from './draft'

const rice: FoodRow = {
  id: 'f1', name: 'White rice (cooked)', brand: null,
  basis_unit: 'g', basis_amount: 100,
  kcal: 126, protein_g: 2.3, carbs_g: 28.2, fat_g: 0.2, fiber_g: 0.4,
  confidence: 'high', source: 'library', version: 1, times_logged: 110, usual_amount: 200,
}
const egg: FoodRow = { ...rice, id: 'f2', name: 'Sunny side up eggs', basis_unit: 'piece',
  basis_amount: 1, kcal: 85, protein_g: 7.2, carbs_g: 0.1, fat_g: 6, usual_amount: 2 }

describe('defaults and presets', () => {
  it('prefills what you usually take', () => {
    expect(defaultAmount(rice)).toBe(200)
  })
  it('falls back to the basis when there is no habit', () => {
    expect(defaultAmount({ ...rice, usual_amount: null })).toBe(100)
  })
  it('steps grams by 10 and counts by 1', () => {
    expect(stepFor(rice)).toBe(10)
    expect(stepFor(egg)).toBe(1)
  })
  it('offers kitchen-sized gram presets around the default', () => {
    expect(presetsFor(rice)).toEqual([150, 200, 250, 300])
  })
  it('offers small counts for counted foods', () => {
    expect(presetsFor(egg)).toEqual([1, 2, 3, 4])
  })
  it('never offers a non-positive preset', () => {
    expect(presetsFor({ ...rice, usual_amount: 25 }).every((n) => n > 0)).toBe(true)
  })
})

describe('basket', () => {
  it('scales macros for the chosen amount', () => {
    const i = buildDraftItem(rice, 200, 'a')
    expect(i.macros).toEqual({ kcal: 252, protein_g: 4.6, carbs_g: 56.4, fat_g: 0.4 })
  })
  it('totals several items', () => {
    const items = [buildDraftItem(rice, 200, 'a'), buildDraftItem(egg, 3, 'b')]
    expect(sumMacros(items)).toEqual({ kcal: 507, protein_g: 26.2, carbs_g: 56.7, fat_g: 18.4 })
  })
  it('totals to zero when empty', () => {
    expect(sumMacros([])).toEqual({ kcal: 0, protein_g: 0, carbs_g: 0, fat_g: 0 })
  })
})

describe('toLogEntry — history must be immutable', () => {
  it('freezes the computed macros and the food version', () => {
    const e = toLogEntry(buildDraftItem(rice, 200, 'a'), '2026-08-06', 'Lunch')
    expect(e).toMatchObject({
      logged_on: '2026-08-06', meal: 'Lunch', food_id: 'f1',
      food_name: 'White rice (cooked)', amount: 200, unit: 'g',
      kcal: 252, food_version: 1, confidence: 'high', resolved_by: 'library',
    })
  })
})

describe('toDayEntry — a log is complete the moment it is written', () => {
  it('carries the portion and every macro, not a name and a calorie stub', () => {
    const e = toDayEntry(buildDraftItem(rice, 200, 'a'), 'Lunch', '2026-08-06T03:00:00.000Z')
    expect(e).toMatchObject({
      id: 'a', meal: 'Lunch', foodName: 'White rice (cooked)',
      amount: 200, unit: 'g', kcal: 252, proteinG: 4.6, carbsG: 56.4, fatG: 0.4,
      confidence: 'high', loggedAt: '2026-08-06T03:00:00.000Z',
      resolvedBy: 'library', foodVersion: 1,
    })
  })
})

describe('todayLocal — a log day is a date, not an instant', () => {
  it('uses local calendar parts, not UTC', () => {
    // 23:30 local on the 6th must stay the 6th, even though it is the 7th in UTC.
    expect(todayLocal(new Date(2026, 7, 6, 23, 30))).toBe('2026-08-06')
  })
  it('zero-pads', () => {
    expect(todayLocal(new Date(2026, 0, 5))).toBe('2026-01-05')
  })
})

describe('mealForHour', () => {
  it('maps the clock to a sensible default', () => {
    expect(mealForHour(7)).toBe('Breakfast')
    expect(mealForHour(12)).toBe('Lunch')
    expect(mealForHour(16)).toBe('Snack')
    expect(mealForHour(20)).toBe('Dinner')
  })
})
