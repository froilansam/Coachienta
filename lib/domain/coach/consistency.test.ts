import { describe, expect, it } from 'vitest'
import { isBlocked, runChecks, targetKcalFromMacros, type Phase, type Targets } from './consistency'
import type { Measurement } from '@/lib/domain/body'

/**
 * All eight checks, including the passing case for each (AC-4.15).
 *
 * Every one of these contradictions actually existed in the spreadsheet, which is
 * why the check exists. The passing cases matter as much as the failing ones — a
 * check that fires on everything is noise, and noise gets ignored.
 */
const m = (o: Partial<Measurement> & { measured_on: string }): Measurement => ({
  weight_kg: null, waist_cm: null, body_fat_pct: null, bmr_kcal: null, source: null, ...o,
})

/** The real seeded targets: 2,300–2,400 kcal, 160 g protein, 290 g carbs, 75 g fat. */
const targets = (o: Partial<Targets> = {}): Targets => ({
  kcal_gym_low: 2300, kcal_gym_high: 2400,
  kcal_rest_low: 2300, kcal_rest_high: 2400,
  protein_g: 160,
  carbs_gym_low: 290, carbs_gym_high: 315,
  carbs_rest_low: 230, carbs_rest_high: 250,
  fat_low: 65, fat_high: 75,
  kcal_floor: 1800,
  ...o,
})

const phase = (o: Partial<Phase> = {}): Phase => ({
  target_rate_kg_per_week: 0,
  bf_ceiling_pct: 15,
  ...o,
})

const TODAY = '2026-08-06'
/** A weigh-in two days old, on target, under the ceiling. */
const clean: Measurement[] = [m({ measured_on: '2026-08-04', weight_kg: 70, body_fat_pct: 12 })]

describe('the quiet case', () => {
  it('reports nothing when everything agrees', () => {
    const out = runChecks({ targets: targets(), phase: phase(), measurements: clean, today: TODAY })
    expect(out).toEqual([])
  })
})

// 4 ------------------------------------------------------------------------
describe('check 4 — calorie floor (AC-4.10)', () => {
  it('BLOCKS a target under the floor', () => {
    const out = runChecks({
      targets: targets({ kcal_gym_low: 1700, kcal_rest_low: 1700 }),
      phase: phase(),
      measurements: clean,
      today: TODAY,
    })
    const f = out.find((x) => x.id === 'kcal_below_floor')!
    // The only hard stop in the whole set — it is a safety rule, not a preference.
    expect(f.severity).toBe('block')
    expect(f.message).toContain('1700')
    expect(f.message).toContain('1800')
    expect(isBlocked(out)).toBe(true)
  })

  it('accepts a target exactly at the floor', () => {
    const out = runChecks({
      targets: targets({ kcal_gym_low: 1800, kcal_rest_low: 1800, kcal_gym_high: 1900, kcal_rest_high: 1900, carbs_gym_low: 150, carbs_rest_low: 150, fat_low: 60, protein_g: 160 }),
      phase: phase(),
      measurements: clean,
      today: TODAY,
    })
    expect(out.some((x) => x.id === 'kcal_below_floor')).toBe(false)
  })

  it('is the only thing that ever blocks', () => {
    const out = runChecks({
      targets: targets({ protein_g: 60, carbs_gym_low: 600 }),
      phase: phase({ bf_ceiling_pct: 5 }),
      measurements: [m({ measured_on: '2026-01-01', weight_kg: 70, body_fat_pct: 30 })],
      today: TODAY,
    })
    expect(out.length).toBeGreaterThan(2)
    expect(isBlocked(out)).toBe(false)
  })
})

// 5 ------------------------------------------------------------------------
describe('check 5 — macros against the calorie ceiling (AC-4.11)', () => {
  it('names both figures when the macros overshoot', () => {
    /**
     * The spreadsheet's own error: 290 g carbs + 160 g protein + 75 g fat is
     * 2,475 kcal against a stated 2,400 ceiling, and nothing noticed.
     */
    const out = runChecks({
      targets: targets({ fat_low: 75 }),
      phase: phase(),
      measurements: clean,
      today: TODAY,
    })
    const f = out.find((x) => x.id === 'macros_exceed_kcal')!
    expect(f.message).toContain('2475')
    expect(f.message).toContain('2400')
    expect(f.severity).toBe('warn')
  })

  it('uses the LOW end of each range, so a passing check means the whole range passes', () => {
    // 4·160 + 4·290 + 9·65 = 2,385, inside 2,400.
    expect(targetKcalFromMacros(targets(), 'gym')).toBe(2385)
    const out = runChecks({ targets: targets(), phase: phase(), measurements: clean, today: TODAY })
    expect(out.some((x) => x.id === 'macros_exceed_kcal')).toBe(false)
  })

  it('checks gym and rest days separately', () => {
    const out = runChecks({
      targets: targets({ carbs_rest_low: 400 }),
      phase: phase(),
      measurements: clean,
      today: TODAY,
    })
    const hits = out.filter((x) => x.id === 'macros_exceed_kcal')
    expect(hits).toHaveLength(1)
    expect(hits[0]!.message).toContain('rest')
  })

  it('says nothing when a macro is not set', () => {
    expect(targetKcalFromMacros(targets({ fat_low: null }), 'gym')).toBeNull()
  })
})

// 3 ------------------------------------------------------------------------
describe('check 3 — protein per kg', () => {
  it('warns below 1.6 g/kg, quoting the ratio at the real bodyweight', () => {
    const out = runChecks({
      targets: targets({ protein_g: 100 }),
      phase: phase(),
      measurements: clean,
      today: TODAY,
    })
    const f = out.find((x) => x.id === 'protein_per_kg_low')!
    expect(f.message).toContain('1.4 g/kg')
  })

  it('passes at 160 g for 70 kg — 2.3 g/kg', () => {
    const out = runChecks({ targets: targets(), phase: phase(), measurements: clean, today: TODAY })
    expect(out.some((x) => x.id === 'protein_per_kg_low')).toBe(false)
  })

  it('is skipped with no weight to compare against, rather than guessed', () => {
    const out = runChecks({ targets: targets({ protein_g: 10 }), phase: phase(), measurements: [], today: TODAY })
    expect(out.some((x) => x.id === 'protein_per_kg_low')).toBe(false)
  })
})

// 1 ------------------------------------------------------------------------
describe('check 1 — body fat over the phase ceiling', () => {
  it('warns on a breached stop-condition', () => {
    // The real one: 20% against a 15% ceiling, which lived in a separate tab.
    const out = runChecks({
      targets: targets(),
      phase: phase(),
      measurements: [m({ measured_on: '2026-08-04', weight_kg: 70, body_fat_pct: 20 })],
      today: TODAY,
    })
    expect(out.find((x) => x.id === 'bf_over_ceiling')!.message).toContain('20%')
  })

  it('passes at exactly the ceiling', () => {
    const out = runChecks({
      targets: targets(),
      phase: phase({ bf_ceiling_pct: 20 }),
      measurements: [m({ measured_on: '2026-08-04', weight_kg: 70, body_fat_pct: 20 })],
      today: TODAY,
    })
    expect(out.some((x) => x.id === 'bf_over_ceiling')).toBe(false)
  })
})

// 2 ------------------------------------------------------------------------
describe('check 2 — weight trend against the phase rate', () => {
  const drifting = [
    m({ measured_on: '2026-07-20', weight_kg: 68 }),
    m({ measured_on: '2026-08-04', weight_kg: 70 }),
  ]

  it('warns when the scale contradicts the stated rate', () => {
    const out = runChecks({ targets: targets(), phase: phase(), measurements: drifting, today: TODAY })
    expect(out.find((x) => x.id === 'weight_off_target_rate')!.message).toContain('kg/wk')
  })

  it('passes when the trend matches the target', () => {
    const out = runChecks({
      targets: targets(),
      phase: phase({ target_rate_kg_per_week: 0.93 }),
      measurements: drifting,
      today: TODAY,
    })
    expect(out.some((x) => x.id === 'weight_off_target_rate')).toBe(false)
  })

  it('is skipped when the readings are under a week apart', () => {
    // No weekly rate exists, so there is nothing to compare — see `trendOf`.
    const out = runChecks({
      targets: targets(),
      phase: phase(),
      measurements: [
        m({ measured_on: '2026-08-03', weight_kg: 68 }),
        m({ measured_on: '2026-08-04', weight_kg: 70 }),
      ],
      today: TODAY,
    })
    expect(out.some((x) => x.id === 'weight_off_target_rate')).toBe(false)
  })
})

// 6, 7 --------------------------------------------------------------------
describe('checks 6 and 7 — missing target, stale weight', () => {
  it('warns about a phase with no active target', () => {
    const out = runChecks({ targets: null, phase: phase(), measurements: clean, today: TODAY })
    expect(out.some((x) => x.id === 'phase_without_target')).toBe(true)
  })

  it('does not warn when there is no phase either', () => {
    const out = runChecks({ targets: null, phase: null, measurements: clean, today: TODAY })
    expect(out.some((x) => x.id === 'phase_without_target')).toBe(false)
  })

  it('warns past 14 days without a weigh-in, and quotes the number', () => {
    const out = runChecks({
      targets: targets(),
      phase: phase(),
      measurements: [m({ measured_on: '2026-07-01', weight_kg: 70 })],
      today: TODAY,
    })
    expect(out.find((x) => x.id === 'weigh_in_stale')!.message).toContain('36 days')
  })

  it('stays quiet at exactly 14 days', () => {
    const out = runChecks({
      targets: targets(),
      phase: phase(),
      measurements: [m({ measured_on: '2026-07-23', weight_kg: 70 })],
      today: TODAY,
    })
    expect(out.some((x) => x.id === 'weigh_in_stale')).toBe(false)
  })
})

// 8 ------------------------------------------------------------------------
describe('check 8 — priority order against actual volume', () => {
  it('warns when the #1 priority is out-trained by something lower', () => {
    const out = runChecks({
      targets: targets(),
      phase: phase(),
      measurements: clean,
      today: TODAY,
      volumeShare: [
        { rank: 1, muscle_group: 'shoulders_side', share_pct: 18 },
        { rank: 2, muscle_group: 'back_lats', share_pct: 31 },
      ],
    })
    const f = out.find((x) => x.id === 'priority_volume_mismatch')!
    expect(f.message).toContain('18%')
    expect(f.message).toContain('31%')
  })

  it('passes when the top priority got the most volume', () => {
    const out = runChecks({
      targets: targets(),
      phase: phase(),
      measurements: clean,
      today: TODAY,
      volumeShare: [
        { rank: 1, muscle_group: 'shoulders_side', share_pct: 40 },
        { rank: 2, muscle_group: 'back_lats', share_pct: 20 },
      ],
    })
    expect(out.some((x) => x.id === 'priority_volume_mismatch')).toBe(false)
  })

  it('stays silent before any training exists', () => {
    /**
     * With no sets logged, every share is 0%. Reporting "shoulders received 0% of
     * volume" would read as neglect when the truth is "you have not trained yet".
     */
    const out = runChecks({ targets: targets(), phase: phase(), measurements: clean, today: TODAY, volumeShare: [] })
    expect(out.some((x) => x.id === 'priority_volume_mismatch')).toBe(false)
  })
})
