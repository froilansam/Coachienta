import { describe, expect, it } from 'vitest'
import { addDays, dayLabel, isFuture, isToday, relativeDayLabel, todayLocal } from './date'

describe('addDays', () => {
  it('steps within a month', () => {
    expect(addDays('2026-08-06', -1)).toBe('2026-08-05')
    expect(addDays('2026-08-06', 1)).toBe('2026-08-07')
  })
  it('rolls back over a month boundary', () => {
    expect(addDays('2026-08-01', -1)).toBe('2026-07-31')
  })
  it('rolls over a year boundary', () => {
    expect(addDays('2026-01-01', -1)).toBe('2025-12-31')
    expect(addDays('2025-12-31', 1)).toBe('2026-01-01')
  })
  it('handles a leap day', () => {
    expect(addDays('2028-02-28', 1)).toBe('2028-02-29')
    expect(addDays('2028-02-29', 1)).toBe('2028-03-01')
    // 2026 is not a leap year.
    expect(addDays('2026-02-28', 1)).toBe('2026-03-01')
  })
  it('is reversible', () => {
    for (const d of ['2026-08-06', '2026-01-01', '2026-12-31', '2028-02-29']) {
      expect(addDays(addDays(d, -7), 7)).toBe(d)
    }
  })
})

describe('todayLocal', () => {
  /**
   * The regression this file exists for. `toISOString()` on a JST-local date
   * returns the PREVIOUS day, which is how `2026-08-04` became `2026-08-03` in
   * `scripts/db.ts`. Anything here must read the local Y/M/D.
   */
  it('reads local calendar parts, not UTC', () => {
    // 1 Jan 2026, 00:30 local. In any timezone east of UTC this is still 31 Dec
    // in UTC — the date must not shift.
    const localNewYear = new Date(2026, 0, 1, 0, 30)
    expect(todayLocal(localNewYear)).toBe('2026-01-01')
  })
  it('pads single digits', () => {
    expect(todayLocal(new Date(2026, 8, 5))).toBe('2026-09-05')
  })
})

describe('labels', () => {
  const today = '2026-08-06'
  it('names the near days instead of dating them', () => {
    expect(relativeDayLabel('2026-08-06', today)).toBe('TODAY')
    expect(relativeDayLabel('2026-08-05', today)).toBe('YESTERDAY')
    expect(relativeDayLabel('2026-08-07', today)).toBe('TOMORROW')
  })
  it('dates anything further out', () => {
    expect(relativeDayLabel('2026-08-01', today)).toBe(dayLabel('2026-08-01'))
    expect(dayLabel('2026-08-06')).toBe('06 AUG · THU')
  })
})

describe('comparisons', () => {
  it('compares as plain strings, which sorts correctly for ISO dates', () => {
    expect(isToday('2026-08-06', '2026-08-06')).toBe(true)
    expect(isFuture('2026-08-07', '2026-08-06')).toBe(true)
    expect(isFuture('2026-08-06', '2026-08-06')).toBe(false)
    expect(isFuture('2025-12-31', '2026-01-01')).toBe(false)
  })
})
