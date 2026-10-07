import { describe, expect, it } from 'vitest'
import {
  describeKinds,
  describeVerdict,
  detectPr,
  standingRecord,
  type Candidate,
  type PriorSet,
} from './detectPr'

const s = (o: Partial<PriorSet> = {}): PriorSet => ({
  performed_on: '2026-06-01',
  set_ordinal: 1,
  side: null,
  weight_kg: 10,
  reps: 10,
  duration_sec: null,
  ...o,
})

const c = (o: Partial<Candidate> = {}): Candidate => ({
  set_ordinal: 1,
  side: null,
  weight_kg: null,
  reps: null,
  duration_sec: null,
  ...o,
})

/**
 * The spreadsheet flagged 335 PRs across ~41 sessions on a free-text column holding
 * 15 values including the number 80. Every set was a record, so the word meant
 * nothing. These tests are mostly about the cases that must be FALSE.
 */
describe('first time is a baseline, not a PR (AC-2.5)', () => {
  it('reports first_time without claiming a record', () => {
    const v = detectPr(c({ weight_kg: 50, reps: 10 }), [], 'external_weight')
    expect(v.isPr).toBe(false)
    expect(v.kinds).toEqual(['first_time'])
    expect(v.basis).toBe('first time at this gym')
  })

  it('applies to a gym switch too — history is passed in already gym-scoped', () => {
    // The caller filters by gym; an empty list IS the new-gym case.
    expect(detectPr(c({ weight_kg: 200, reps: 20 }), [], 'bodyweight').isPr).toBe(false)
  })

  it('a set POSITION never used before is a baseline as well', () => {
    /**
     * A fourth set added to an exercise you have only ever done three sets of has
     * nothing to beat. Without this it would stamp for existing — the same failure as
     * a first session being a wall of records, one position down.
     */
    const history = [s({ set_ordinal: 1 }), s({ set_ordinal: 2 }), s({ set_ordinal: 3 })]
    const v = detectPr(c({ set_ordinal: 4, weight_kg: 200, reps: 20 }), history, 'external_weight')
    expect(v.isPr).toBe(false)
    expect(v.kinds).toEqual(['first_time'])
    expect(v.basis).toBe('first set 4 for this exercise at this gym')
  })

  it('treats each side as its own position', () => {
    // Unilateral work numbers left and right independently, so a first right-hand set
    // is not measured against the left.
    const history = [s({ set_ordinal: 1, side: 'left', weight_kg: 20, reps: 10 })]
    const v = detectPr(
      c({ set_ordinal: 1, side: 'right', weight_kg: 20, reps: 11 }),
      history,
      'external_weight',
    )
    expect(v.kinds).toEqual(['first_time'])
  })
})

/**
 * The reason this rule exists. Pooling every set of an exercise means only the top
 * set can ever be a record, and the back-off sets creeping up — which is the bulk of
 * progressive overload — goes unrecorded forever.
 */
describe('a record is judged per set POSITION', () => {
  const history = [
    s({ set_ordinal: 1, weight_kg: 80, reps: 8 }),
    s({ set_ordinal: 2, weight_kg: 70, reps: 8 }),
    s({ set_ordinal: 3, weight_kg: 60, reps: 8 }),
  ]

  it('set 3 beating set 3 is a record, far below the top set', () => {
    const v = detectPr(c({ set_ordinal: 3, weight_kg: 65, reps: 8 }), history, 'external_weight')
    expect(v.isPr).toBe(true)
    expect(v.kinds).toContain('weight')
    // 65 kg would have lost to set 1's 80 kg under the old pooled comparison.
    expect(v.scope).toBe('set')
    expect(v.basis).toBe('set 3: 65 kg × 8 beats 60 kg × 8 from 2026-06-01')
  })

  it('and beating the whole record ranks it up to all-time', () => {
    const v = detectPr(c({ set_ordinal: 3, weight_kg: 85, reps: 8 }), history, 'external_weight')
    expect(v.isPr).toBe(true)
    expect(v.scope).toBe('all_time')
    expect(v.basis).toContain('best of any set')
  })

  it('set 1 does not win on set 3 numbers', () => {
    // 70 kg beats every set 3 on record and loses to every set 1. It is set 1.
    const v = detectPr(c({ set_ordinal: 1, weight_kg: 70, reps: 8 }), history, 'external_weight')
    expect(v.isPr).toBe(false)
    expect(v.previousBest?.weight_kg).toBe(80)
  })

  it('position is the GATE, not a tie-breaker', () => {
    /**
     * 50 × 11 beats the 50 × 10 sitting at set 1, so the old rule called it a reps
     * record. At its own position it is behind 60 × 20 and it is not progress. The
     * all-time comparison never runs unless the positional one has already passed.
     */
    const mixed = [
      s({ set_ordinal: 1, weight_kg: 50, reps: 10 }),
      s({ set_ordinal: 2, weight_kg: 60, reps: 20 }),
    ]
    const v = detectPr(c({ set_ordinal: 2, weight_kg: 50, reps: 11 }), mixed, 'external_weight')
    expect(v.isPr).toBe(false)
    expect(v.scope).toBeNull()
  })

  it('reads the WHOLE record at that position, not the last session', () => {
    // June was heavier than July. A record has to clear June too.
    const drifting = [
      s({ set_ordinal: 2, weight_kg: 60, reps: 10, performed_on: '2026-06-01' }),
      s({ set_ordinal: 2, weight_kg: 50, reps: 10, performed_on: '2026-07-01' }),
    ]
    expect(detectPr(c({ set_ordinal: 2, weight_kg: 55, reps: 10 }), drifting, 'external_weight').isPr)
      .toBe(false)
    expect(detectPr(c({ set_ordinal: 2, weight_kg: 65, reps: 10 }), drifting, 'external_weight').isPr)
      .toBe(true)
  })
})

describe('external_weight', () => {
  const history = [
    s({ weight_kg: 10, reps: 12 }),
    s({ weight_kg: 12.5, reps: 8, performed_on: '2026-06-08' }),
  ]

  it('a heavier top set is a weight PR', () => {
    const v = detectPr(c({ weight_kg: 15, reps: 5 }), history, 'external_weight')
    expect(v.isPr).toBe(true)
    expect(v.kinds).toContain('weight')
    expect(v.basis).toContain('15 kg × 5 beats 12.5 kg × 8 from 2026-06-08')
  })

  it('more reps at a weight already used is a reps PR', () => {
    const v = detectPr(c({ weight_kg: 10, reps: 13 }), history, 'external_weight')
    expect(v.isPr).toBe(true)
    expect(v.kinds).toContain('reps_at_weight')
  })

  it('is NOT a PR when it matches the previous best exactly', () => {
    expect(detectPr(c({ weight_kg: 12.5, reps: 8 }), history, 'external_weight').isPr).toBe(false)
  })

  it('is NOT a PR for a lighter set with fewer reps', () => {
    const v = detectPr(c({ weight_kg: 10, reps: 10 }), history, 'external_weight')
    expect(v.isPr).toBe(false)
    // It still reports what it was measured against.
    expect(v.previousBest?.weight_kg).toBe(12.5)
  })

  it('catches a rep jump at an unused weight via set volume', () => {
    /**
     * 11 kg has never been used, so the reps-at-weight rule cannot fire — but
     * 11 × 15 = 165 beats every prior set's 120. Without this the set would go
     * unrecognised.
     */
    const v = detectPr(c({ weight_kg: 11, reps: 15 }), history, 'external_weight')
    expect(v.kinds).toContain('volume_set')
    expect(v.isPr).toBe(true)
  })

  it('can report more than one kind at once', () => {
    const v = detectPr(c({ weight_kg: 20, reps: 20 }), history, 'external_weight')
    expect(v.kinds).toEqual(expect.arrayContaining(['weight', 'volume_set']))
  })

  it('is not a PR when the set is incomplete', () => {
    expect(detectPr(c({ weight_kg: null, reps: 10 }), history, 'external_weight').isPr).toBe(false)
  })
})

describe('assisted — lower assist is better', () => {
  const history = [
    s({ weight_kg: 30, reps: 8 }),
    s({ weight_kg: 25, reps: 6, performed_on: '2026-06-08' }),
  ]

  it('less assist at equal-or-more reps is a PR', () => {
    /**
     * The inversion that makes `volume_kg` null for this load type. A naive maximum
     * would call the HEAVIEST assist a record, which is precisely backwards.
     */
    const v = detectPr(c({ weight_kg: 20, reps: 6 }), history, 'assisted')
    expect(v.isPr).toBe(true)
    expect(v.kinds).toContain('weight')
  })

  it('more reps at the same assist is a PR', () => {
    const v = detectPr(c({ weight_kg: 25, reps: 8 }), history, 'assisted')
    expect(v.isPr).toBe(true)
    expect(v.kinds).toContain('reps_at_weight')
  })

  it('MORE assist is never a PR, however many reps', () => {
    expect(detectPr(c({ weight_kg: 40, reps: 20 }), history, 'assisted').isPr).toBe(false)
  })

  it('less assist but fewer reps is not claimed', () => {
    expect(detectPr(c({ weight_kg: 20, reps: 3 }), history, 'assisted').isPr).toBe(false)
  })

  it('the inversion holds per position too', () => {
    // Set 2 usually needs more help than set 1. It is graded against set 2.
    const byPosition = [
      s({ set_ordinal: 1, weight_kg: 20, reps: 8 }),
      s({ set_ordinal: 2, weight_kg: 35, reps: 8 }),
    ]
    const v = detectPr(c({ set_ordinal: 2, weight_kg: 30, reps: 8 }), byPosition, 'assisted')
    expect(v.isPr).toBe(true)
    expect(v.scope).toBe('set')
  })
})

describe('bodyweight', () => {
  const unweighted = [
    s({ weight_kg: 0, reps: 8 }),
    s({ weight_kg: 0, reps: 10, performed_on: '2026-06-08' }),
  ]

  it('more reps than the previous max is a PR', () => {
    const v = detectPr(c({ weight_kg: 0, reps: 11 }), unweighted, 'bodyweight')
    expect(v.isPr).toBe(true)
    expect(v.basis).toContain('11 reps beats 10 from 2026-06-08')
  })

  it('equalling the max is not a PR', () => {
    expect(detectPr(c({ weight_kg: 0, reps: 10 }), unweighted, 'bodyweight').isPr).toBe(false)
  })

  it('adding weight is judged as a weighted set', () => {
    // Once there is external load, reps alone stop being the axis.
    const v = detectPr(c({ weight_kg: 10, reps: 5 }), unweighted, 'bodyweight')
    expect(v.isPr).toBe(true)
    expect(v.kinds).toContain('weight')
  })
})

describe('duration', () => {
  const history = [
    s({ weight_kg: null, reps: null, duration_sec: 45 }),
    s({ weight_kg: null, reps: null, duration_sec: 60, performed_on: '2026-06-08' }),
  ]

  it('a longer hold is a PR', () => {
    const v = detectPr(c({ duration_sec: 75 }), history, 'duration')
    expect(v.isPr).toBe(true)
    expect(v.kinds).toEqual(['duration'])
    expect(v.basis).toContain('75 s beats 60 s from 2026-06-08')
  })

  it('an equal hold is not', () => {
    expect(detectPr(c({ duration_sec: 60 }), history, 'duration').isPr).toBe(false)
  })

  it('never claims a weight PR for a plank', () => {
    const v = detectPr(c({ duration_sec: 90 }), history, 'duration')
    expect(v.kinds).not.toContain('weight')
    expect(v.kinds).not.toContain('volume_set')
  })

  it('a second, shorter hold is graded against second holds', () => {
    const byPosition = [
      s({ set_ordinal: 1, weight_kg: null, reps: null, duration_sec: 90 }),
      s({ set_ordinal: 2, weight_kg: null, reps: null, duration_sec: 45 }),
    ]
    const v = detectPr(c({ set_ordinal: 2, duration_sec: 50 }), byPosition, 'duration')
    expect(v.isPr).toBe(true)
    expect(v.scope).toBe('set')
  })
})

describe('describing a verdict', () => {
  it('reads as English, not as enum values', () => {
    expect(describeKinds(['weight', 'reps_at_weight'])).toBe('New weight · More reps')
    expect(describeKinds(['first_time'])).toBe('First time')
    expect(describeKinds(['duration'])).toBe('Longest hold')
  })

  it('names the scope first, because that is the part that carries weight', () => {
    const history = [
      s({ set_ordinal: 1, weight_kg: 80, reps: 8 }),
      s({ set_ordinal: 3, weight_kg: 60, reps: 8 }),
    ]
    expect(describeVerdict(detectPr(c({ set_ordinal: 3, weight_kg: 65, reps: 8 }), history, 'external_weight')))
      .toBe('Set 3 record: New weight · Best set volume')
    expect(describeVerdict(detectPr(c({ set_ordinal: 3, weight_kg: 85, reps: 8 }), history, 'external_weight')))
      .toContain('All-time record:')
  })
})

/**
 * The record on the row is constant until it is beaten. It used to read as "per
 * session" because the only reference the row carried was PREV, which moves every time.
 */
describe('standingRecord', () => {
  const week = (performed_on: string, weight_kg: number, reps: number) =>
    s({ performed_on, weight_kg, reps })

  it('is null with no history at this position', () => {
    expect(standingRecord([], 1, null, 'external_weight')).toBeNull()
    expect(standingRecord([week('2026-06-01', 60, 8)], 2, null, 'external_weight')).toBeNull()
  })

  it('does not move on a session that fails to beat it', () => {
    const history = [week('2026-06-01', 60, 10), week('2026-06-08', 55, 8), week('2026-06-15', 57.5, 9)]
    expect(standingRecord(history, 1, null, 'external_weight')).toMatchObject({ performed_on: '2026-06-01' })
  })

  it('moves to the set that beat it, and holds there', () => {
    const history = [week('2026-06-01', 60, 10), week('2026-06-08', 62.5, 8), week('2026-06-15', 60, 9)]
    expect(standingRecord(history, 1, null, 'external_weight')).toMatchObject({ weight_kg: 62.5, reps: 8 })
  })

  it('moves exactly when detectPr would stamp — a reps record counts too', () => {
    const history = [week('2026-06-01', 60, 10), week('2026-06-08', 60, 12)]
    expect(detectPr(c({ weight_kg: 60, reps: 12 }), history.slice(0, 1), 'external_weight').isPr).toBe(true)
    expect(standingRecord(history, 1, null, 'external_weight')).toMatchObject({ reps: 12 })
  })

  it('is judged in date order, whatever order the rows arrive in', () => {
    const history = [week('2026-06-15', 60, 9), week('2026-06-01', 60, 10)]
    expect(standingRecord(history, 1, null, 'external_weight')).toMatchObject({ performed_on: '2026-06-01' })
  })

  it('stays at its own position and side', () => {
    const history = [s({ set_ordinal: 2, weight_kg: 100 }), s({ side: 'left', weight_kg: 90 }), s({ weight_kg: 50 })]
    expect(standingRecord(history, 1, null, 'external_weight')).toMatchObject({ weight_kg: 50 })
  })

  it('never takes an incomplete row as the baseline, or nothing could beat it', () => {
    const history = [s({ performed_on: '2026-06-01', reps: null }), s({ performed_on: '2026-06-08', weight_kg: 40, reps: 8 })]
    expect(standingRecord(history, 1, null, 'external_weight')).toMatchObject({ weight_kg: 40 })
  })

  it('inverts for assisted — less assist is the record', () => {
    const history = [
      s({ performed_on: '2026-06-01', weight_kg: 30, reps: 8 }),
      s({ performed_on: '2026-06-08', weight_kg: 40, reps: 8 }),
      s({ performed_on: '2026-06-15', weight_kg: 25, reps: 8 }),
    ]
    expect(standingRecord(history, 1, null, 'assisted')).toMatchObject({ weight_kg: 25 })
  })

  it('uses the longest hold for duration', () => {
    const hold = (performed_on: string, duration_sec: number) =>
      s({ performed_on, weight_kg: null, reps: null, duration_sec })
    const history = [hold('2026-06-01', 45), hold('2026-06-08', 40), hold('2026-06-15', 50)]
    expect(standingRecord(history, 1, null, 'duration')).toMatchObject({ duration_sec: 50 })
  })
})
