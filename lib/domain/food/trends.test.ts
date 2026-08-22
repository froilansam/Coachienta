import { describe, expect, it } from 'vitest'
import {
  adherenceTone,
  kcalSeries,
  macroSplit,
  proteinStreak,
  qualitySlices,
  type DayBucket,
} from './trends'

const day = (o: Partial<DayBucket> & Pick<DayBucket, 'bucket'>): DayBucket => ({
  is_gym_day: false,
  kcal: 2000,
  protein_g: 150,
  carbs_g: 200,
  fat_g: 60,
  entry_count: 3,
  kcal_target_low: 1800,
  kcal_target_high: 2200,
  protein_target: 140,
  ...o,
})

describe('proteinStreak', () => {
  it('counts consecutive newest days that hit the target', () => {
    expect(
      proteinStreak([
        day({ bucket: '2026-08-01', protein_g: 150 }),
        day({ bucket: '2026-08-02', protein_g: 145 }),
        day({ bucket: '2026-08-03', protein_g: 100 }),
      ]),
    ).toBe(0)
    expect(
      proteinStreak([
        day({ bucket: '2026-08-01', protein_g: 150 }),
        day({ bucket: '2026-08-02', protein_g: 145 }),
        day({ bucket: '2026-08-03', protein_g: 160 }),
      ]),
    ).toBe(3)
  })

  it('breaks on a miss even if older days were fine', () => {
    expect(
      proteinStreak([
        day({ bucket: '2026-08-03', protein_g: 100 }),
        day({ bucket: '2026-08-02', protein_g: 200 }),
      ]),
    ).toBe(0)
  })
})

describe('adherenceTone', () => {
  it('marks filler empty and unlogged days missed', () => {
    expect(adherenceTone(null, true)).toBe('empty')
    expect(adherenceTone(null, false)).toBe('missed')
    expect(adherenceTone(day({ bucket: '2026-08-01', entry_count: 0 }), false)).toBe('missed')
  })

  it('marks on-band days on_target', () => {
    expect(adherenceTone(day({ bucket: '2026-08-01', kcal: 2000 }), false)).toBe('on_target')
    expect(adherenceTone(day({ bucket: '2026-08-01', kcal: 3000 }), false)).toBe('logged')
  })
})

describe('kcalSeries / macroSplit / qualitySlices', () => {
  it('maps buckets and averages without inventing density', () => {
    expect(kcalSeries([day({ bucket: '2026-08-01' })])[0]).toMatchObject({
      on: '2026-08-01',
      kcal: 2000,
      low: 1800,
      high: 2200,
    })
    expect(macroSplit({ protein_mean: 150, carbs_mean: 200, fat_mean: 50 }).total).toBe(400)
  })

  it('drops zero confidence bands from the quality strip', () => {
    const slices = qualitySlices({ high: 8, medium: 2, low: 0, user_verified: 0 })
    expect(slices.map((s) => s.key)).toEqual(['high', 'medium'])
    expect(slices[0]!.pct).toBe(80)
  })
})
