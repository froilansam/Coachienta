import { describe, expect, it } from 'vitest'
import {
  entryFromMirror, gradeMacro, groupByMeal, macroRows, pctOf, remainingTerms, sumEntries,
  type DayEntry, type NutritionTargets,
} from './dayView'

const entry = (o: Partial<DayEntry> & { id: string }): DayEntry => ({
  meal: 'Lunch', foodName: 'x', amount: 100, unit: 'g',
  kcal: 0, proteinG: 0, carbsG: 0, fatG: 0,
  confidence: 'high', loggedAt: null, resolvedBy: null, foodVersion: null, notes: null, ...o,
})

/** The real seeded targets (PRD-006 §3.3). */
const targets: NutritionTargets = {
  kcalGymLow: 2300, kcalGymHigh: 2400, kcalRestLow: 2300, kcalRestHigh: 2400,
  proteinG: 160, carbsGymLow: 290, carbsRestLow: 230, fatHigh: 75,
  phaseLabel: '4-week weight-maintenance recomp',
}

describe('entryFromMirror', () => {
  it('reads a full logged entry back unchanged', () => {
    const logged = entry({
      id: 'ignored', meal: 'Dinner', foodName: 'White rice (cooked)',
      amount: 200, unit: 'g', kcal: 252, proteinG: 4.6, carbsG: 56.4, fatG: 0.4,
      confidence: 'high', loggedAt: '2026-08-06T03:00:00.000Z',
      resolvedBy: 'library', foodVersion: 1,
    })
    expect(entryFromMirror('row-1', logged)).toEqual({ ...logged, id: 'row-1' })
  })

  it('still reads an older mirror that only stored the name and the calories', () => {
    expect(entryFromMirror('row-1', { food_name: 'White rice (cooked)', kcal: 252 })).toMatchObject({
      id: 'row-1', foodName: 'White rice (cooked)', kcal: 252, amount: 0, proteinG: 0,
    })
  })
})

describe('sumEntries', () => {
  it('adds without float noise', () => {
    expect(sumEntries([
      entry({ id: 'a', kcal: 216, proteinG: 18.9, carbsG: 1.2, fatG: 15 }),
      entry({ id: 'b', kcal: 252, proteinG: 4.6, carbsG: 56.4, fatG: 0.4 }),
    ])).toEqual({ kcal: 468, protein_g: 23.5, carbs_g: 57.6, fat_g: 15.4 })
  })
  it('is zero when empty', () => {
    expect(sumEntries([])).toEqual({ kcal: 0, protein_g: 0, carbs_g: 0, fat_g: 0 })
  })
})

describe('gradeMacro — the four numbers do not mean the same thing', () => {
  it('floor: above target is GOOD', () => {
    expect(gradeMacro('PRO', 168.3, 160, 'floor').delta)
      .toEqual({ value: 8.3, direction: 'up', state: 'good' })
  })
  it('floor: below target is BAD', () => {
    expect(gradeMacro('CHO', 196.7, 290, 'floor').delta)
      .toEqual({ value: -93.3, direction: 'down', state: 'bad' })
  })
  it('ceiling: above target is BAD — a green arrow here would be a lie', () => {
    expect(gradeMacro('FAT', 97, 75, 'ceiling').delta)
      .toEqual({ value: 22, direction: 'up', state: 'bad' })
  })
  it('ceiling: below target is GOOD', () => {
    expect(gradeMacro('FAT', 70.4, 75, 'ceiling').delta.state).toBe('good')
  })
  it('band: outside is bad in EITHER direction', () => {
    expect(gradeMacro('KCAL', 3000, 2350, 'band', 'kcal', 50).delta.state).toBe('bad')
    expect(gradeMacro('KCAL', 1200, 2350, 'band', 'kcal', 50).delta.state).toBe('bad')
  })
  it('band: inside the tolerance reads as on-target', () => {
    expect(gradeMacro('KCAL', 2380, 2350, 'band', 'kcal', 50).delta)
      .toEqual({ value: 30, direction: 'flat', state: 'good' })
  })
})

describe('macroRows', () => {
  it('uses gym-day carbs on a training day', () => {
    const { rows } = macroRows({ kcal: 0, protein_g: 0, carbs_g: 0, fat_g: 0 }, targets, true)
    expect(rows.find((r) => r.label === 'CHO')!.target).toBe(290)
  })
  it('uses rest-day carbs otherwise', () => {
    const { rows } = macroRows({ kcal: 0, protein_g: 0, carbs_g: 0, fat_g: 0 }, targets, false)
    expect(rows.find((r) => r.label === 'CHO')!.target).toBe(230)
  })
  it('takes the midpoint of the calorie band as the target', () => {
    const { kcal } = macroRows({ kcal: 2090, protein_g: 0, carbs_g: 0, fat_g: 0 }, targets, true)
    expect(kcal.target).toBe(2350)
    expect(kcal.delta.state).toBe('bad')   // 2090 is below the 2300-2400 band
  })
  it('treats a value inside the band as on-target', () => {
    const { kcal } = macroRows({ kcal: 2350, protein_g: 0, carbs_g: 0, fat_g: 0 }, targets, true)
    expect(kcal.delta.direction).toBe('flat')
  })
})

describe('groupByMeal', () => {
  it('keeps first-logged order, not alphabetical', () => {
    const g = groupByMeal([
      entry({ id: 'a', meal: 'Lunch' }),
      entry({ id: 'b', meal: 'Breakfast' }),
      entry({ id: 'c', meal: 'Lunch' }),
    ])
    expect(g.map((x) => x.meal)).toEqual(['Lunch', 'Breakfast'])
    expect(g[0]!.entries).toHaveLength(2)
  })
  it('buckets a missing meal rather than dropping the entry', () => {
    expect(groupByMeal([entry({ id: 'a', meal: null })])[0]!.meal).toBe('Unspecified')
  })
  it('subtotals each meal', () => {
    const g = groupByMeal([
      entry({ id: 'a', meal: 'Breakfast', kcal: 216 }),
      entry({ id: 'b', meal: 'Breakfast', kcal: 252 }),
    ])
    expect(g[0]!.totals.kcal).toBe(468)
  })
})

describe('remainingTerms / pctOf', () => {
  it('shows the arithmetic', () => {
    expect(remainingTerms(2090, 2350)).toEqual([
      { label: 'GOAL', value: 2350 },
      { label: 'FOOD', value: 2090, operator: '−' },
      { label: 'LEFT', value: 260, operator: '=', tone: 'accent' },
    ])
  })
  it('states an overshoot as OVER rather than a negative LEFT', () => {
    // `-150 LEFT` makes the reader decode a minus sign to learn something the
    // label can just say. Browsing past days means seeing this often.
    expect(remainingTerms(2500, 2350)[2]).toEqual({
      label: 'OVER',
      value: 150,
      operator: '=',
      tone: 'neg',
    })
  })
  it('reports whole calories, so the line does not mix precisions', () => {
    expect(remainingTerms(2575.4, 2350)[1]!.value).toBe(2575)
    expect(remainingTerms(2575.4, 2350)[2]!.value).toBe(225)
  })
  it('never divides by zero', () => {
    expect(pctOf(100, 0)).toBe(0)
  })
})
