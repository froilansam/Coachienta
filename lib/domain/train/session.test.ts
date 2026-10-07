import { describe, expect, it } from 'vitest'
import {
  blankSet, formatDuration, inputsFor, isComplete, nextSetIndex,
  prevAtPosition, recordAtPosition, setLabel, setOrdinal, totals, type SetRow,
} from './session'
import type { PriorSet } from './detectPr'

const row = (o: Partial<SetRow> = {}): SetRow => ({
  id: 'r', exercise_id: 'e1', position: 1, set_index: 1, kind: 'working',
  weight_kg: 10, reps: 12, duration_sec: null, side: null, committed: true, derived: false, ...o,
})

// ---------------------------------------------------------------------------
// AC-2.3 / AC-2.4 — volume only where it means something
// ---------------------------------------------------------------------------
describe('totals (AC-2.4)', () => {
  const loadTypes: Record<string, string> = {
    press: 'external_weight', plank: 'duration', assisted: 'assisted',
    pullup: 'bodyweight', dip: 'bodyweight',
  }
  const of = (id: string) => loadTypes[id] ?? 'external_weight'

  it('sums only eligible sets, and counts the rest', () => {
    /**
     * The spreadsheet pooled everything and Abs/Core out-ranked Chest. A plank is
     * real training and is counted as a SET — never as kilograms.
     */
    const t = totals(
      [
        row({ exercise_id: 'press', weight_kg: 50, reps: 10 }),
        row({ exercise_id: 'plank', weight_kg: null, reps: null, duration_sec: 60 }),
        row({ exercise_id: 'assisted', weight_kg: 20, reps: 8 }),
      ],
      of,
    )
    expect(t.volumeKg).toBe(500)
    expect(t.sets).toBe(3)
    expect(t.volumelessSets).toBe(2)
  })

  it('counts an unweighted bodyweight set without volume', () => {
    // No added weight means no product to take — but it is still a set.
    const t = totals([row({ exercise_id: 'pullup', weight_kg: null, reps: 8 })], of)
    expect(t.volumeKg).toBe(0)
    expect(t.sets).toBe(1)
    expect(t.volumelessSets).toBe(1)
  })

  it('counts a weighted bodyweight set as volume', () => {
    const t = totals([row({ exercise_id: 'dip', weight_kg: 20, reps: 8 })], of)
    expect(t.volumeKg).toBe(160)
    expect(t.volumelessSets).toBe(0)
  })

  it('ignores uncommitted rows entirely', () => {
    // A half-typed row must never move the session total.
    const t = totals([row({ exercise_id: 'press', committed: false })], of)
    expect(t).toEqual({ volumeKg: 0, sets: 0, volumelessSets: 0 })
  })
})

describe('inputsFor', () => {
  it('shows seconds for a plank and no weight at all', () => {
    expect(inputsFor('duration')).toMatchObject({ weight: false, reps: false, duration: true })
  })

  it('names the assisted column ASSIST, because it is not load', () => {
    expect(inputsFor('assisted').weightLabel).toBe('ASSIST')
  })

  it('names bodyweight added load +KG', () => {
    expect(inputsFor('bodyweight').weightLabel).toBe('+KG')
  })
})

describe('isComplete', () => {
  it('needs weight and reps for external weight', () => {
    expect(isComplete(row({ weight_kg: 10, reps: 8 }), 'external_weight')).toBe(true)
    expect(isComplete(row({ weight_kg: null, reps: 8 }), 'external_weight')).toBe(false)
    expect(isComplete(row({ weight_kg: 10, reps: null }), 'external_weight')).toBe(false)
  })

  it('needs only reps for bodyweight — added weight is optional', () => {
    expect(isComplete(row({ weight_kg: null, reps: 8 }), 'bodyweight')).toBe(true)
  })

  it('needs only seconds for a plank', () => {
    expect(isComplete(row({ weight_kg: null, reps: null, duration_sec: 45 }), 'duration')).toBe(true)
    expect(isComplete(row({ weight_kg: null, reps: null, duration_sec: null }), 'duration')).toBe(false)
  })

  it('rejects zero, which is not a logged set', () => {
    expect(isComplete(row({ reps: 0 }), 'external_weight')).toBe(false)
  })
})

describe('blankSet', () => {
  it('carries the previous weight forward — the biggest time saver on the screen', () => {
    const next = blankSet('e1', 1, [row({ weight_kg: 22.5, reps: 10 })])
    expect(next.weight_kg).toBe(22.5)
    expect(next.reps).toBeNull()
    expect(next.set_index).toBe(2)
    expect(next.committed).toBe(false)
  })

  it('numbers each side independently for unilateral work (AC-2.12)', () => {
    const existing = [row({ side: 'left', set_index: 1 }), row({ side: 'right', set_index: 1 })]
    expect(blankSet('e1', 1, existing, 'left').set_index).toBe(2)
    expect(blankSet('e1', 1, existing, 'right').set_index).toBe(2)
  })

  it('takes a deterministic id when one is given, and marks the row derived', () => {
    /**
     * `derived` is what stops that readable id reaching the database. `workout_sets.id`
     * is a uuid, and committing `draft:3` as the primary key was rejected with a 400 —
     * a real uuid is minted at commit time instead.
     */
    const virtual = blankSet('e1', 3, [], null, 'draft:3')
    expect(virtual.id).toBe('draft:3')
    expect(virtual.derived).toBe(true)
    expect(blankSet('e1', 3, []).derived).toBe(false)
  })
})

describe('nextSetIndex / setLabel', () => {
  it('continues from the highest index', () => {
    expect(nextSetIndex([row({ set_index: 1 }), row({ set_index: 4 })])).toBe(5)
    expect(nextSetIndex([])).toBe(1)
  })

  it('renders a warmup as W, not as set 1 of the work', () => {
    expect(setLabel(row({ kind: 'warmup', set_index: 1 }))).toBe('W')
    expect(setLabel(row({ kind: 'working', set_index: 2 }))).toBe('2')
  })
})

describe('formatDuration', () => {
  it('reads mm:ss under an hour and h:mm:ss over', () => {
    expect(formatDuration(42 * 60_000 + 18_000)).toBe('42:18')
    expect(formatDuration(3_738_000)).toBe('1:02:18')
    expect(formatDuration(0)).toBe('0:00')
  })

  it('never goes negative', () => {
    expect(formatDuration(-5000)).toBe('0:00')
  })
})

// ---------------------------------------------------------------------------
// Set positions — what a PR is judged at, and what PREV shows
// ---------------------------------------------------------------------------
describe('setOrdinal', () => {
  it('numbers the working sets, skipping the warmups between them', () => {
    /**
     * The whole reason this is not `set_index`. Warmups occupy an index — the unique
     * constraint requires it — so a day with a warmup would otherwise call its first
     * working set "set 2" and grade it against a different set entirely.
     */
    const rows = [
      row({ id: 'w', set_index: 1, kind: 'warmup' }),
      row({ id: 'a', set_index: 2 }),
      row({ id: 'b', set_index: 3 }),
    ]
    expect(setOrdinal(rows[1]!, rows)).toBe(1)
    expect(setOrdinal(rows[2]!, rows)).toBe(2)
  })

  it('gives a warmup no position at all', () => {
    const rows = [row({ id: 'w', set_index: 1, kind: 'warmup' })]
    expect(setOrdinal(rows[0]!, rows)).toBe(0)
  })

  it('numbers each side independently', () => {
    const rows = [
      row({ id: 'l1', set_index: 1, side: 'left' }),
      row({ id: 'r1', set_index: 1, side: 'right' }),
      row({ id: 'l2', set_index: 2, side: 'left' }),
    ]
    expect(setOrdinal(rows[1]!, rows)).toBe(1)
    expect(setOrdinal(rows[2]!, rows)).toBe(2)
  })

  it('does not depend on the order sets were committed in', () => {
    // Committing set 2 before set 1 must not renumber set 2 as set 1.
    const rows = [row({ id: 'a', set_index: 1 }), row({ id: 'b', set_index: 2 })]
    expect(setOrdinal(rows[1]!, rows)).toBe(2)
  })
})

describe('prevAtPosition (US-2.4)', () => {
  const p = (o: Partial<PriorSet> = {}): PriorSet => ({
    performed_on: '2026-06-09', set_ordinal: 1, side: null,
    weight_kg: 10, reps: 13, duration_sec: null, ...o,
  })

  it('is never blank — an em dash when this position has no history', () => {
    expect(prevAtPosition([], 'external_weight', 1, null)).toBe('—')
  })

  it('shows the value without its date, which the column has no room for', () => {
    expect(prevAtPosition([p()], 'external_weight', 1, null)).toBe('10 kg × 13')
  })

  it('shows THIS set, not the exercise top set', () => {
    /**
     * The change that makes back-off progress visible: set 3 chases set 3. Pointing
     * every row at set 1's number gave the later sets a target they were never meant
     * to hit — the same reason their progress never counted as a record.
     */
    const priors = [
      p({ set_ordinal: 1, weight_kg: 80, reps: 8 }),
      p({ set_ordinal: 3, weight_kg: 60, reps: 8 }),
    ]
    expect(prevAtPosition(priors, 'external_weight', 3, null)).toBe('60 kg × 8')
  })

  it('takes the most recent one at that position', () => {
    const priors = [
      p({ performed_on: '2026-06-01', weight_kg: 60, reps: 8 }),
      p({ performed_on: '2026-07-01', weight_kg: 65, reps: 8 }),
    ]
    expect(prevAtPosition(priors, 'external_weight', 1, null)).toBe('65 kg × 8')
  })

  it('shows seconds for duration work', () => {
    expect(prevAtPosition([p({ duration_sec: 45 })], 'duration', 1, null)).toBe('45 s')
  })

  it('drops the load for unweighted bodyweight, where `0 kg × 10` reads as broken', () => {
    expect(prevAtPosition([p({ weight_kg: 0, reps: 10 })], 'bodyweight', 1, null)).toBe('10 reps')
  })

  it('does not cross sides', () => {
    expect(prevAtPosition([p({ side: 'left' })], 'external_weight', 1, 'right')).toBe('—')
  })
})

describe('recordAtPosition', () => {
  const p = (o: Partial<PriorSet> = {}): PriorSet => ({
    performed_on: '2026-06-09', set_ordinal: 1, side: null,
    weight_kg: 10, reps: 13, duration_sec: null, ...o,
  })

  it('is null, not a dash, before a record exists — PREV already says so', () => {
    expect(recordAtPosition([], 'external_weight', 1, null)).toBeNull()
  })

  it('shows the best ever while PREV shows the last session', () => {
    const priors = [p({ performed_on: '2026-06-01', weight_kg: 65, reps: 8 }), p({ performed_on: '2026-06-08', weight_kg: 60, reps: 8 })]
    expect(recordAtPosition(priors, 'external_weight', 1, null)).toBe('65 kg × 8')
    expect(prevAtPosition(priors, 'external_weight', 1, null)).toBe('60 kg × 8')
  })

  it('formats like PREV for bodyweight and duration', () => {
    expect(recordAtPosition([p({ weight_kg: 0, reps: 12 })], 'bodyweight', 1, null)).toBe('12 reps')
    expect(recordAtPosition([p({ weight_kg: null, reps: null, duration_sec: 60 })], 'duration', 1, null)).toBe('60 s')
  })
})
