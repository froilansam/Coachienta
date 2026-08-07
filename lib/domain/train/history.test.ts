import { describe, expect, it } from 'vitest'
import type { SessionSummaryRow } from '@/lib/db/queries/plan'
import { dayLabel, decorate, deleteCopy, durationLabel, groupByDate, summarise } from './history'

const s = (over: Partial<SessionSummaryRow> = {}): SessionSummaryRow => ({
  id: 'a',
  performed_on: '2026-08-04',
  name: 'Leg Day',
  gym_name: 'Anytime Shinjuku',
  started_at: '2026-08-04T10:00:00Z',
  completed_at: '2026-08-04T10:42:00Z',
  set_count: 14,
  volume_kg: 4180,
  pr_count: 2,
  ...over,
})

describe('summarise', () => {
  it('reads like the mock in §4.3a', () => {
    expect(summarise(s())).toBe('4,180 kg · 14 sets · 42m · 2 PR')
  })

  it('omits the duration rather than inventing one', () => {
    // Every session imported from the spreadsheet has no start time.
    expect(summarise(s({ started_at: null }))).toBe('4,180 kg · 14 sets · 2 PR')
  })

  it('omits volume when nothing carried any', () => {
    // A plank-and-abs session is real work with no kilograms — showing `0 kg` would
    // read as a bug rather than as a definition.
    expect(summarise(s({ volume_kg: 0, set_count: 6, pr_count: 0 }))).toBe('6 sets · 42m')
  })

  it('says an empty session is empty', () => {
    expect(summarise(s({ set_count: 0, volume_kg: 0, pr_count: 0 }))).toBe('nothing logged')
  })

  it('refuses a negative duration', () => {
    // A clock that went backwards is not a 0-minute session.
    expect(summarise(s({ completed_at: '2026-08-04T09:00:00Z' }))).toBe('4,180 kg · 14 sets · 2 PR')
  })
})

describe('durationLabel', () => {
  it('switches to hours past sixty minutes', () => {
    expect(durationLabel(42)).toBe('42m')
    expect(durationLabel(95)).toBe('1h 35m')
    expect(durationLabel(60)).toBe('1h 00m')
  })
})

describe('groupByDate', () => {
  it('groups by performed_on, newest day as the query gave it', () => {
    const groups = groupByDate(
      [s({ id: '1', performed_on: '2026-08-06' }), s({ id: '2', performed_on: '2026-08-05' })],
      '2026-08-06',
    )
    expect(groups.map((g) => g.label)).toEqual(['TODAY', 'YESTERDAY'])
  })

  it('AC-2.21 — two sessions on one day are two rows, never merged', () => {
    const groups = groupByDate(
      [s({ id: '1', name: 'Push' }), s({ id: '2', name: 'Legs' })],
      '2026-08-06',
    )
    expect(groups).toHaveLength(1)
    // The spreadsheet had duplicate-date rows that double-counted instead.
    expect(groups[0]!.rows.map((r) => r.name)).toEqual(['Push', 'Legs'])
  })

  it('names an older day by weekday', () => {
    expect(dayLabel('2026-08-04', '2026-08-06')).toBe('TUE 4 AUG')
  })
})

describe('decorate', () => {
  it('marks an unfinished session live', () => {
    expect(decorate(s({ completed_at: null })).isLive).toBe(true)
    expect(decorate(s()).isLive).toBe(false)
  })
})

describe('deleteCopy', () => {
  it('states exactly how many sets will disappear', () => {
    // The only warning there is: the cloud is the truth and there is no undo (§6).
    expect(deleteCopy(decorate(s()))).toBe(
      'Delete Leg Day · 4 Aug? 14 sets will be removed. This cannot be undone.',
    )
  })

  it('says an in-progress session is being abandoned', () => {
    expect(deleteCopy(decorate(s({ completed_at: null, set_count: 3 })))).toContain('in progress')
  })

  it('does not threaten to remove sets that do not exist', () => {
    expect(deleteCopy(decorate(s({ set_count: 0 })))).toContain('no sets logged')
  })
})
