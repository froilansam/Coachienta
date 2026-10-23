import { describe, expect, it } from 'vitest'
import type { DayBucket } from './trends'
import { foodReport, type FoodReportInput } from './report'

const day = (o: Partial<DayBucket> & Pick<DayBucket, 'bucket'>): DayBucket => ({
  is_gym_day: false,
  kcal: 2000,
  protein_g: 150,
  carbs_g: 200,
  fat_g: 60,
  entry_count: 2,
  kcal_target_low: 1900,
  kcal_target_high: 2100,
  protein_target: 170,
  ...o,
})

const daysBetween = (from: string, to: string): DayBucket[] => {
  const out: DayBucket[] = []
  for (let on = from; on <= to; on = next(on)) out.push(day({ bucket: on }))
  return out
}

const next = (iso: string): string => {
  const [y = 0, m = 1, d = 1] = iso.split('-').map(Number)
  const dt = new Date(y, m - 1, d + 1)
  const mm = String(dt.getMonth() + 1).padStart(2, '0')
  const dd = String(dt.getDate()).padStart(2, '0')
  return `${dt.getFullYear()}-${mm}-${dd}`
}

const base = (over: Partial<FoodReportInput> = {}): FoodReportInput => ({
  today: '2026-10-21',
  rangeDays: 28,
  days: daysBetween('2026-10-05', '2026-10-18'),
  sessions: [],
  weights: [
    { measured_on: '2026-10-05', weight_kg: 70 },
    { measured_on: '2026-10-18', weight_kg: 69.3 },
  ],
  profile: { birthDate: '1990-01-01', heightCm: 175, sex: 'male' },
  phase: { label: 'Body recomp', rateKgPerWeek: -0.15 },
  targets: {
    phaseLabel: 'Body recomp',
    proteinG: 170,
    kcalGymLow: 2200,
    kcalGymHigh: 2400,
    kcalRestLow: 1900,
    kcalRestHigh: 2100,
  },
  ...over,
})

describe('foodReport', () => {
  it('turns intake and weight loss into a TDEE above intake', () => {
    const lines = foodReport(base())
    const tdee = lines.find((l) => l.label === 'TDEE')
    // 2,000 eaten. −0.7 kg over 13 days is 415 kcal/day of tissue, so expenditure is 2,415.
    expect(tdee?.value).toBe('2,415 kcal')
    expect(tdee?.detail).toContain('2,000 kcal eaten')
    expect(tdee?.detail).toContain('down 0.4 kg/week')
    expect(tdee?.detail).toContain('Formula estimate')
  })

  it('ignores an unlogged day instead of treating it as zero', () => {
    const lines = foodReport(
      base({
        days: [
          ...daysBetween('2026-10-05', '2026-10-18'),
          day({ bucket: '2026-10-06', entry_count: 0, kcal: 0, protein_g: 0 }),
        ],
      }),
    )
    expect(lines.find((l) => l.label === 'TDEE')?.detail).toContain('2,000 kcal eaten')
  })

  it('names a small negative rate as a micro deficit and scores the band', () => {
    const program = foodReport(base()).find((l) => l.label === 'Program')
    expect(program?.detail).toContain('Body recomp · micro deficit')
    expect(program?.detail).toContain('Gym 2,200–2,400, rest 1,900–2,100')
    expect(program?.value).toBe('On the program')
    expect(program?.tone).toBe('pos')
  })

  it('says when protein is short of the weekly target', () => {
    const protein = foodReport(base()).find((l) => l.label === 'Protein')
    expect(protein?.value).toBe('150 / 170 g')
    expect(protein?.tone).toBe('warn')
    expect(protein?.detail).toContain('Short of the target')
    expect(protein?.detail).toContain('0 of 14 days')
  })

  it('counts a finished session inside the window and skips one that is still open', () => {
    const activity = foodReport(
      base({
        sessions: [
          { performed_on: '2026-10-06', completed_at: '2026-10-06T10:00:00' },
          { performed_on: '2026-10-08', completed_at: '2026-10-08T10:00:00' },
          { performed_on: '2026-10-13', completed_at: '2026-10-13T10:00:00' },
          { performed_on: '2026-10-15', completed_at: '2026-10-15T10:00:00' },
          { performed_on: '2026-10-20', completed_at: '2026-10-20T10:00:00', set_count: 10 },
          { performed_on: '2026-10-07', completed_at: null, set_count: 17 },
          { performed_on: '2026-10-09', completed_at: null, set_count: 0 },
        ],
      }),
    ).find((l) => l.label === 'Activity')
    expect(activity?.value).toBe('2.5 / week')
    expect(activity?.detail).toContain('5 sessions with logged work over 2 weeks')
  })

  it('refuses a TDEE when the weigh-ins are under a week apart', () => {
    const tdee = foodReport(
      base({
        weights: [
          { measured_on: '2026-10-12', weight_kg: 70 },
          { measured_on: '2026-10-16', weight_kg: 69.5 },
        ],
      }),
    ).find((l) => l.label === 'TDEE')
    expect(tdee?.value).toBe('—')
    expect(tdee?.detail).toContain('at least a week apart')
  })

  it('asks for a finished week when everything logged is still this week', () => {
    const lines = foodReport(base({ days: [day({ bucket: '2026-10-20' })], weights: [] }))
    expect(lines).toHaveLength(1)
    expect(lines[0]?.detail).toContain('finished week')
  })
})
