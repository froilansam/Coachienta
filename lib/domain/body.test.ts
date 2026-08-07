import { describe, expect, it } from 'vitest'
import { daysSinceWeighIn, latestOf, seriesOf, trendOf, withinDays, type Measurement } from './body'

const m = (o: Partial<Measurement> & { measured_on: string }): Measurement => ({
  weight_kg: null, waist_cm: null, body_fat_pct: null, bmr_kcal: null, source: null, ...o,
})

/** The three real seeded readings, including the partial one. */
const real: Measurement[] = [
  m({ measured_on: '2026-07-27', weight_kg: 68.9, waist_cm: 81, body_fat_pct: 19.5, bmr_kcal: 1587 }),
  m({ measured_on: '2026-07-28', weight_kg: 69.1, waist_cm: 80, body_fat_pct: 18.6, bmr_kcal: 1605 }),
  // "Partial reading; blanks are honest" — newest weight, but no waist.
  m({ measured_on: '2026-08-04', weight_kg: 70.0, body_fat_pct: 20.0 }),
]

describe('latestOf (AC-4.4, AC-4.4b)', () => {
  it('takes the newest value per FIELD, not per row', () => {
    /**
     * The whole reason this function exists. The newest row has weight but no
     * waist; reading that row wholesale would blank a waist measurement that
     * exists, so each field carries its own date.
     */
    expect(latestOf(real, 'weight_kg')).toEqual({ value: 70.0, on: '2026-08-04' })
    expect(latestOf(real, 'waist_cm')).toEqual({ value: 80, on: '2026-07-28' })
    expect(latestOf(real, 'body_fat_pct')).toEqual({ value: 20.0, on: '2026-08-04' })
  })

  it('does not trust the input order', () => {
    expect(latestOf([...real].reverse(), 'weight_kg')?.on).toBe('2026-08-04')
  })

  it('returns null for a field never recorded', () => {
    expect(latestOf([m({ measured_on: '2026-08-01', weight_kg: 70 })], 'waist_cm')).toBeNull()
  })
})

describe('trendOf', () => {
  it('reports change per week across a field own readings', () => {
    const t = trendOf(real, 'weight_kg')!
    expect(t.from).toBe(68.9)
    expect(t.to).toBe(70.0)
    expect(t.direction).toBe('up')
    // +1.1 kg over 8 days ≈ +0.96/wk.
    expect(t.perWeek).toBeCloseTo(0.96, 1)
  })

  it('refuses to extrapolate a weekly rate from under a week', () => {
    // The phase note warns against exactly this: "not day-to-day scale noise".
    const t = trendOf(
      [m({ measured_on: '2026-08-01', weight_kg: 70 }), m({ measured_on: '2026-08-03', weight_kg: 70.4 })],
      'weight_kg',
    )!
    expect(t.perWeek).toBeNull()
    expect(t.direction).toBe('up')
  })

  it('ignores readings where the field is null', () => {
    const t = trendOf(real, 'waist_cm')!
    expect(t.from).toBe(81)
    expect(t.to).toBe(80)
    expect(t.direction).toBe('down')
  })

  it('calls a negligible change flat rather than picking a direction', () => {
    const t = trendOf(
      [m({ measured_on: '2026-07-01', weight_kg: 70 }), m({ measured_on: '2026-08-01', weight_kg: 70.02 })],
      'weight_kg',
    )!
    expect(t.direction).toBe('flat')
  })

  it('returns null with fewer than two readings', () => {
    expect(trendOf([m({ measured_on: '2026-08-01', weight_kg: 70 })], 'weight_kg')).toBeNull()
    expect(trendOf([], 'weight_kg')).toBeNull()
  })
})

describe('seriesOf (AC-4.4c)', () => {
  it('drops null points instead of zeroing them', () => {
    /**
     * A missing body-fat reading is unknown. Plotting it as 0% would draw a cliff
     * that never happened.
     */
    const rows = [
      m({ measured_on: '2026-08-01', body_fat_pct: 20 }),
      m({ measured_on: '2026-08-02' }),
      m({ measured_on: '2026-08-03', body_fat_pct: 19.5 }),
    ]
    const s = seriesOf(rows, 'body_fat_pct')!
    expect(s.points).toHaveLength(2)
    expect(s.points.map((p) => p.value)).toEqual([20, 19.5])
    expect(s.min).toBe(19.5)
    expect(s.max).toBe(20)
  })

  it('is chronological regardless of input order', () => {
    expect(seriesOf(real, 'weight_kg')!.points.map((p) => p.on)).toEqual([
      '2026-07-27', '2026-07-28', '2026-08-04',
    ])
  })

  it('returns null when nothing was ever recorded', () => {
    expect(seriesOf(real, 'waist_cm')!.points).toHaveLength(2)
    expect(seriesOf([m({ measured_on: '2026-08-01' })], 'weight_kg')).toBeNull()
  })
})

describe('withinDays', () => {
  it('measures the window from the newest reading, not from today', () => {
    // Otherwise a stale log would render an empty chart rather than its history.
    expect(withinDays(real, 7).map((r) => r.measured_on)).toEqual(['2026-07-28', '2026-08-04'])
    expect(withinDays(real, 30)).toHaveLength(3)
  })
})

describe('daysSinceWeighIn', () => {
  it('counts from the newest weight reading', () => {
    expect(daysSinceWeighIn(real, '2026-08-06')).toBe(2)
  })
  it('is null with no weight ever logged', () => {
    expect(daysSinceWeighIn([], '2026-08-06')).toBeNull()
  })
})
