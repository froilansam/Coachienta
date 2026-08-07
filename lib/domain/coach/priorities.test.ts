import { describe, expect, it } from 'vitest'
import { add, isChanged, labelOf, move, remaining, remove, setNote, validate, type PriorityItem } from './priorities'

/** The seeded order, which is the V-taper argument made measurable. */
const seeded: PriorityItem[] = [
  { muscle_group: 'shoulders_side', note: 'Capped side delts' },
  { muscle_group: 'back_lats', note: 'Lat width' },
  { muscle_group: 'chest', note: null },
  { muscle_group: 'biceps', note: null },
  { muscle_group: 'quads', note: null },
]
const groups = (items: readonly PriorityItem[]) => items.map((i) => i.muscle_group)

describe('move', () => {
  it('swaps with the neighbour above', () => {
    expect(groups(move(seeded, 1, -1))).toEqual([
      'back_lats', 'shoulders_side', 'chest', 'biceps', 'quads',
    ])
  })

  it('swaps with the neighbour below', () => {
    expect(groups(move(seeded, 0, 1))).toEqual([
      'back_lats', 'shoulders_side', 'chest', 'biceps', 'quads',
    ])
  })

  it('clamps at both ends instead of wrapping', () => {
    // Wrapping would silently demote your top priority to last on a stray tap.
    expect(groups(move(seeded, 0, -1))).toEqual(groups(seeded))
    expect(groups(move(seeded, 4, 1))).toEqual(groups(seeded))
  })

  it('ignores an out-of-range index', () => {
    expect(groups(move(seeded, 9, -1))).toEqual(groups(seeded))
  })

  it('carries notes with the row', () => {
    expect(move(seeded, 1, -1)[0]).toEqual({ muscle_group: 'back_lats', note: 'Lat width' })
  })

  it('does not mutate its input', () => {
    move(seeded, 0, 1)
    expect(groups(seeded)[0]).toBe('shoulders_side')
  })
})

describe('add and remove', () => {
  it('appends, because a new priority is the least important until moved', () => {
    expect(groups(add(seeded, 'calves')).at(-1)).toBe('calves')
  })

  it('refuses a duplicate — the RPC would truncate the table on one', () => {
    expect(groups(add(seeded, 'chest'))).toEqual(groups(seeded))
  })

  it('removes by index', () => {
    expect(groups(remove(seeded, 2))).toEqual(['shoulders_side', 'back_lats', 'biceps', 'quads'])
  })

  it('will not empty the list', () => {
    const one: PriorityItem[] = [{ muscle_group: 'chest', note: null }]
    expect(remove(one, 0)).toEqual(one)
  })
})

describe('remaining', () => {
  it('offers only groups not already ranked', () => {
    const left = remaining(seeded)
    expect(left).not.toContain('chest')
    expect(left).toContain('calves')
  })
})

describe('setNote', () => {
  it('stores a note and normalises blank to null', () => {
    expect(setNote(seeded, 2, ' Upper chest ')[2]!.note).toBe(' Upper chest ')
    expect(setNote(seeded, 0, '   ')[0]!.note).toBeNull()
  })
})

describe('validate', () => {
  it('passes the seeded order', () => {
    expect(validate(seeded)).toBeNull()
  })
  it('rejects an empty list and a duplicate', () => {
    expect(validate([])).toContain('at least one')
    expect(validate([{ muscle_group: 'chest', note: null }, { muscle_group: 'chest', note: null }]))
      .toContain('only once')
  })
})

describe('isChanged', () => {
  it('is false for an identical list, so SAVE stays inert', () => {
    expect(isChanged(seeded, [...seeded])).toBe(false)
  })
  it('notices a reorder and a note edit', () => {
    expect(isChanged(move(seeded, 0, 1), seeded)).toBe(true)
    expect(isChanged(setNote(seeded, 2, 'now noted'), seeded)).toBe(true)
  })
  it('treats null and empty-string notes as the same', () => {
    const withEmpty = seeded.map((i, n) => (n === 2 ? { ...i, note: '' } : i))
    expect(isChanged(withEmpty, seeded)).toBe(false)
  })
})

describe('labelOf', () => {
  it('reads as English, not as a database enum', () => {
    expect(labelOf('shoulders_side')).toBe('Shoulders (side)')
    expect(labelOf('back_lats')).toBe('Back / lats')
  })
  it('degrades legibly for an unmapped value', () => {
    expect(labelOf('some_new_group')).toBe('some new group')
  })
})
