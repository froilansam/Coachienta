import { describe, expect, it } from 'vitest'
import { describeBest, describeLast, suggestTarget, type History } from './progression'

const h = (o: Partial<History> = {}): History => ({
  last_performed_on: '2026-08-04', last_weight_kg: 10, last_reps: 12,
  last_duration_sec: null, best_weight_kg: 12.5, best_reps: 10,
  best_on: '2026-07-01', sessions_since: 0, ...o,
})

/**
 * Double progression, per PRD-004 §3.4's table. Every case asserts the `basis`
 * too — a suggestion without its evidence is unauditable (AC-2.8), and that is
 * exactly how the spreadsheet's targets went 57 days stale unnoticed.
 */
describe('suggestTarget — the four situations in §3.4', () => {
  it('at the top of the range: add load, drop to the bottom', () => {
    const t = suggestTarget(h({ last_reps: 15 }), 10, 15, 'external_weight')
    expect(t.kind).toBe('add_load')
    expect(t.suggestion).toBe('12.5 kg × 10')
    expect(t.basis).toBe('from 2026-08-04: 10 kg × 15, top of 10–15 range')
  })

  it('inside the range: add one rep at the same load', () => {
    const t = suggestTarget(h({ last_reps: 12 }), 10, 15, 'external_weight')
    expect(t.kind).toBe('add_reps')
    expect(t.suggestion).toBe('10 kg × 13')
    expect(t.basis).toContain('inside 10–15 range')
  })

  it('below the range: hold the load, chase the bottom', () => {
    const t = suggestTarget(h({ last_reps: 7 }), 10, 15, 'external_weight')
    expect(t.kind).toBe('hold')
    expect(t.suggestion).toBe('10 kg × 10')
    expect(t.basis).toContain('below 10–15 range')
  })

  it('three sessions without regaining the best: call it a plateau', () => {
    // "Add a rep" is bad advice after three sessions of not adding one.
    const t = suggestTarget(h({ last_weight_kg: 10, best_weight_kg: 12.5, sessions_since: 3 }), 10, 15, 'external_weight')
    expect(t.kind).toBe('plateau')
    expect(t.suggestion).toContain('back-off week')
    expect(t.basis).toContain('best 12.5 kg on 2026-07-01, 3 sessions since')
  })

  it('a plateau outranks the rep range', () => {
    // Top of the range AND stalled — the stall is the more useful thing to say.
    const t = suggestTarget(h({ last_reps: 15, last_weight_kg: 10, best_weight_kg: 12.5, sessions_since: 4 }), 10, 15, 'external_weight')
    expect(t.kind).toBe('plateau')
  })
})

describe('suggestTarget — no history (AC-2.5, §3.3)', () => {
  it('is a baseline, never a PR and never a failure', () => {
    const t = suggestTarget(null, 8, 12, 'external_weight')
    expect(t.kind).toBe('baseline')
    expect(t.suggestion).toContain('Establish a baseline')
    expect(t.basis).toBe('no history for this exercise at this gym')
  })

  it('phrases a duration baseline in seconds', () => {
    expect(suggestTarget(null, 30, 60, 'duration').suggestion).toContain('30 s')
  })
})

describe('suggestTarget — duration work (US-2.9)', () => {
  const plank = h({ last_weight_kg: null, last_reps: null, last_duration_sec: 40, best_weight_kg: null, best_reps: null })

  it('adds seconds, never weight × reps', () => {
    const t = suggestTarget(plank, 30, 60, 'duration')
    expect(t.suggestion).toBe('Hold 45 s')
    expect(t.basis).toBe('from 2026-08-04: 40 s, target 30–60 s')
  })

  it('caps at the top of the range, then asks for load or a harder variation', () => {
    const t = suggestTarget({ ...plank, last_duration_sec: 60 }, 30, 60, 'duration')
    expect(t.suggestion).toContain('then add load')
  })
})

describe('suggestTarget — incomplete records', () => {
  it('asks for a clean record rather than inventing a target', () => {
    const t = suggestTarget(h({ last_weight_kg: null, last_reps: null }), 8, 12, 'external_weight')
    expect(t.kind).toBe('hold')
    expect(t.suggestion).toContain('record weight and reps')
  })

  it('copes with a missing rep range', () => {
    const t = suggestTarget(h({ last_reps: 12 }), null, null, 'external_weight')
    expect(t.suggestion).toBe('10 kg × 13')
    expect(t.basis).toContain('inside the range')
  })
})

describe('describeLast / describeBest (AC-2.19)', () => {
  it('renders an em dash when there is no history at this gym', () => {
    expect(describeLast(null, 'external_weight')).toBe('—')
    expect(describeBest(null, 'external_weight')).toBe('—')
  })

  it('shows weight × reps with the date', () => {
    expect(describeLast(h(), 'external_weight')).toBe('10 kg × 12 · 2026-08-04')
    expect(describeBest(h(), 'external_weight')).toBe('12.5 kg × 10 · 2026-07-01')
  })

  it('shows seconds for duration work', () => {
    expect(describeLast(h({ last_duration_sec: 45 }), 'duration')).toBe('45 s · 2026-08-04')
  })

  it('does not print a trailing .0 on whole kilos', () => {
    expect(describeLast(h({ last_weight_kg: 10 }), 'external_weight')).toContain('10 kg')
    expect(describeLast(h({ last_weight_kg: 12.5 }), 'external_weight')).toContain('12.5 kg')
  })
})
