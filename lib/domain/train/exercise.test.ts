import { describe, expect, it } from 'vitest'
import {
  auditExercise, canSaveExercise, describeExercise, group, hasVolume,
  loadTypeWarning, matches, needsAttention, type Exercise,
} from './exercise'

const ex = (o: Partial<Exercise> & { name: string }): Exercise => ({
  id: o.name, aliases: [], muscle_group: 'chest', movement_pattern: 'horizontal_push',
  load_type: 'external_weight', is_unilateral: false, equipment: 'Machine',
  is_active: true, set_count: 0, last_performed_on: null, ...o,
})

// ---------------------------------------------------------------------------
// AC-2.3 / AC-2.4 — volume only where it means something
// ---------------------------------------------------------------------------
describe('hasVolume (AC-2.3)', () => {
  it('allows volume only for weighted work', () => {
    expect(hasVolume('external_weight')).toBe(true)
    expect(hasVolume('bodyweight')).toBe(true)
  })

  it('refuses it for assisted, duration and distance', () => {
    /**
     * `assisted` is the interesting one: lower assist is better, so weight × reps
     * would make progress look like regression (PRD-004 §3.1).
     */
    expect(hasVolume('assisted')).toBe(false)
    expect(hasVolume('duration')).toBe(false)
    expect(hasVolume('distance')).toBe(false)
  })
})

describe('loadTypeWarning', () => {
  it('says nothing when nothing changed or nothing is logged', () => {
    expect(loadTypeWarning('external_weight', 'external_weight', 42)).toBeNull()
    expect(loadTypeWarning('external_weight', 'duration', 0)).toBeNull()
  })

  it('names how many sets would stop counting toward volume', () => {
    const w = loadTypeWarning('external_weight', 'assisted', 42)!
    expect(w).toContain('42 logged sets')
    expect(w).toContain('stop counting toward volume')
  })

  it('names how many would start counting', () => {
    expect(loadTypeWarning('duration', 'external_weight', 3)!).toContain('start counting')
  })

  it('uses the singular for one set', () => {
    expect(loadTypeWarning('external_weight', 'duration', 1)!).toContain('1 logged set would')
  })

  it('still warns for a change between two volume-less types', () => {
    expect(loadTypeWarning('duration', 'distance', 5)!).toContain('read differently')
  })
})

// ---------------------------------------------------------------------------
// The audit — the live import faults
// ---------------------------------------------------------------------------
describe('auditExercise', () => {
  it('flags the real chest-press fault in the seeded data', () => {
    /**
     * All three `Chest Press Machine` variants are stored as `vertical_pull`.
     * PRD-004 §4.1 claims they were "corrected on import"; they were not. Muscle
     * group is what per-muscle volume groups by, so this is not cosmetic.
     */
    const a = auditExercise({
      name: 'Chest Press Machine', muscle_group: 'chest',
      movement_pattern: 'vertical_pull', equipment: null,
    })
    expect(a.flags).toContain('pattern_implausible')
    expect(a.messages.join(' ')).toContain('Chest')
    expect(needsAttention(a)).toBe(true)
  })

  it('flags a superset prefix still in a name', () => {
    // §4.1: a superset is a session-level grouping, never part of a name.
    const a = auditExercise({
      name: 'Arms Superset — DB Bicep Curl', muscle_group: 'biceps',
      movement_pattern: 'isolation', equipment: null,
    })
    expect(a.flags).toContain('superset_in_name')
  })

  it('accepts a correct row', () => {
    const a = auditExercise({
      name: 'Bench Press', muscle_group: 'chest',
      movement_pattern: 'horizontal_push', equipment: 'Barbell',
    })
    expect(needsAttention(a)).toBe(false)
    expect(a.flags).toEqual([])
  })

  it('treats isolation as plausible anywhere — almost anything can be isolated', () => {
    for (const mg of ['chest', 'back_lats', 'quads', 'abs_core']) {
      const a = auditExercise({ name: 'x', muscle_group: mg, movement_pattern: 'isolation', equipment: 'Cable' })
      expect(a.flags).not.toContain('pattern_implausible')
    }
  })

  it('never flags a group with no meaningful compound pattern', () => {
    // Side delts and calves have no compound pattern worth asserting.
    const a = auditExercise({ name: 'Lateral Raises', muscle_group: 'shoulders_side', movement_pattern: 'squat', equipment: 'DB' })
    expect(a.flags).not.toContain('pattern_implausible')
  })

  it('does not let a missing equipment field count as needing attention', () => {
    // Every seeded row has null equipment; if it counted, the filter would be noise.
    const a = auditExercise({ name: 'x', muscle_group: 'chest', movement_pattern: 'horizontal_push', equipment: null })
    expect(a.flags).toEqual(['no_equipment'])
    expect(needsAttention(a)).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// Search and grouping
// ---------------------------------------------------------------------------
describe('matches', () => {
  const e = ex({ name: 'Lat Pulldown', aliases: ['Pulldown'], muscle_group: 'back_lats', equipment: 'Cable' })

  it('matches on whatever you happen to remember', () => {
    expect(matches(e, 'pulldown')).toBe(true)
    expect(matches(e, 'LAT PULL')).toBe(true)
    expect(matches(e, 'back')).toBe(true)     // muscle group label
    expect(matches(e, 'cable')).toBe(true)    // equipment
  })

  it('is whitespace and case insensitive', () => {
    expect(matches(e, '  lat   pulldown ')).toBe(true)
  })

  it('rejects a real miss, and an empty query matches everything', () => {
    expect(matches(e, 'squat')).toBe(false)
    expect(matches(e, '')).toBe(true)
  })
})

describe('group', () => {
  const list = [
    ex({ name: 'Bench Press', muscle_group: 'chest' }),
    ex({ name: 'Lat Pulldown', muscle_group: 'back_lats' }),
    ex({ name: 'Arnold Press', muscle_group: 'shoulders_front' }),
  ]

  it('orders muscle sections by the priority list order, not alphabetically', () => {
    // So the group you care most about is the one you reach first.
    expect(group(list, 'muscle').map((g) => g.key)).toEqual([
      'shoulders_front', 'back_lats', 'chest',
    ])
  })

  it('sorts names inside a section', () => {
    const two = [ex({ name: 'Zzz Fly', muscle_group: 'chest' }), ex({ name: 'Aaa Press', muscle_group: 'chest' })]
    expect(group(two, 'muscle')[0]!.exercises.map((e) => e.name)).toEqual(['Aaa Press', 'Zzz Fly'])
  })

  it('buckets by first letter in alpha mode', () => {
    const g = group(list, 'alpha')
    expect(g.map((s) => s.key)).toEqual(['A', 'B', 'L'])
    expect(g[0]!.exercises[0]!.name).toBe('Arnold Press')
  })

  it('returns nothing for an empty library rather than an empty section', () => {
    expect(group([], 'muscle')).toEqual([])
    expect(group([], 'alpha')).toEqual([])
  })
})

describe('describeExercise', () => {
  it('reads as a sentence fragment, not an enum dump', () => {
    expect(describeExercise(ex({ name: 'x', muscle_group: 'back_lats', movement_pattern: 'vertical_pull', equipment: 'Cable' })))
      .toBe('Back / lats · vertical pull · Cable')
  })

  it('marks per-side work and omits missing equipment', () => {
    const d = describeExercise(ex({ name: 'x', is_unilateral: true, equipment: null }))
    expect(d).toContain('per side')
    expect(d.endsWith('per side')).toBe(true)
  })
})

describe('canSaveExercise', () => {
  it('requires a name', () => {
    const base = { muscle_group: 'chest', movement_pattern: 'isolation', load_type: 'external_weight', is_unilateral: false, equipment: '' }
    expect(canSaveExercise({ ...base, name: 'Fly' })).toBe(true)
    expect(canSaveExercise({ ...base, name: '   ' })).toBe(false)
  })
})
