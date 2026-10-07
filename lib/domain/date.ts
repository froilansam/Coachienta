/**
 * Local calendar dates as `YYYY-MM-DD` strings.
 *
 * Everything here works on the string's Y/M/D parts and constructs dates with the
 * local-time `Date(y, m, d)` constructor. Nothing goes near `toISOString()` or
 * UTC, because that is where day boundaries get silently wrong: in JST,
 * `new Date('2026-08-04').toISOString()` is `2026-08-03`. The same trap already
 * cost time on the Postgres side — see `scripts/db.ts`, which disables node-pg's
 * DATE parser for exactly this reason.
 */

/** Today, in the device's own timezone. */
export function todayLocal(now = new Date()): string {
  const y = now.getFullYear()
  const m = String(now.getMonth() + 1).padStart(2, '0')
  const d = String(now.getDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}

/** Splits `2026-08-06` without parsing it as a date first. */
function parts(iso: string): { y: number; m: number; d: number } {
  const [y, m, d] = iso.split('-').map(Number)
  return { y: y ?? 1970, m: m ?? 1, d: d ?? 1 }
}

/**
 * Steps a date by whole days. `Date(y, m-1, d + delta)` normalises month and year
 * rollover for us, including leap days, so there is no arithmetic to get wrong.
 */
export function addDays(iso: string, delta: number): string {
  const { y, m, d } = parts(iso)
  return todayLocal(new Date(y, m - 1, d + delta))
}

/** A real Date at LOCAL midnight, for formatting only. */
export const atLocalMidnight = (iso: string): Date => {
  const { y, m, d } = parts(iso)
  return new Date(y, m - 1, d)
}

export const isToday = (iso: string, today = todayLocal()): boolean => iso === today
export const isFuture = (iso: string, today = todayLocal()): boolean => iso > today

/**
 * ISO date of the Monday on or before `iso`. Weeks start Monday everywhere here —
 * `date_trunc('week', …)` in Postgres does the same, so the SQL rollups and these
 * client-side ones cannot disagree about which week a Sunday belongs to.
 */
export const mondayOf = (iso: string): string =>
  addDays(iso, -((atLocalMidnight(iso).getDay() + 6) % 7))

/** `06 AUG · THU` — the instrument-panel form used across the app. */
export function dayLabel(iso: string): string {
  const parts = atLocalMidnight(iso)
    .toLocaleDateString('en-GB', { day: '2-digit', month: 'short', weekday: 'short' })
    .toUpperCase()
    .replace(/,/g, '')
    .split(' ')
  // en-GB gives "THU 06 AUG"; we want the date first, weekday as the qualifier.
  const [weekday, day, month] = parts
  return `${day} ${month} · ${weekday}`
}

/**
 * Names the day when naming it is more useful than dating it.
 *
 * "YESTERDAY" beats "05 AUG · WED" when you are checking whether you hit protein
 * last night — you think in relative days for the last couple, and in dates after
 * that.
 */
export function relativeDayLabel(iso: string, today = todayLocal()): string {
  if (iso === today) return 'TODAY'
  if (iso === addDays(today, -1)) return 'YESTERDAY'
  if (iso === addDays(today, 1)) return 'TOMORROW'
  return dayLabel(iso)
}

/** Long form for the screen heading: `Thursday 6 August`. */
export const longDayLabel = (iso: string): string =>
  atLocalMidnight(iso).toLocaleDateString('en-GB', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
  })
