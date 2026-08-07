/**
 * Body measurements: what your current numbers are, and which way they are going.
 *
 * Pure. No I/O, no React.
 */

export interface Measurement {
  measured_on: string
  weight_kg: number | null
  waist_cm: number | null
  body_fat_pct: number | null
  /** The scale's own BMR figure, when it reported one. Not ours to compute. */
  bmr_kcal: number | null
  source: string | null
}

/** One current value, and the reading it actually came from. */
export interface Latest {
  value: number
  on: string
}

/**
 * The newest non-null value for one field, with its own date.
 *
 * **Latest wins per FIELD, not per row.** The real data proves why: the newest
 * weigh-in (2026-08-04) recorded 70.0 kg with `waist_cm` null — *"partial reading;
 * blanks are honest"* — while a real 80.0 cm waist exists from a week earlier.
 * Reading the newest row wholesale would show a blank waist when a measurement
 * exists, and AC-4.4b asks for each value "with the date of the reading that
 * produced it" precisely because those dates differ.
 */
export function latestOf(
  rows: readonly Measurement[],
  field: 'weight_kg' | 'waist_cm' | 'body_fat_pct' | 'bmr_kcal',
): Latest | null {
  // Newest first; the input order is not trusted.
  const sorted = [...rows].sort((a, b) => b.measured_on.localeCompare(a.measured_on))
  for (const r of sorted) {
    const v = r[field]
    if (v !== null && v !== undefined) return { value: v, on: r.measured_on }
  }
  return null
}

/** Chronological, oldest first — the order a chart draws in. */
export const chronological = (rows: readonly Measurement[]): Measurement[] =>
  [...rows].sort((a, b) => a.measured_on.localeCompare(b.measured_on))

const DAY_MS = 86_400_000
const daysBetween = (from: string, to: string): number =>
  Math.round(
    (new Date(`${to}T00:00:00`).getTime() - new Date(`${from}T00:00:00`).getTime()) / DAY_MS,
  )

export interface Trend {
  from: number
  to: number
  /** Change per week over the span. Null when the span is under a week. */
  perWeek: number | null
  /** Direction of the change, before any judgement about whether it is good. */
  direction: 'up' | 'down' | 'flat'
}

/**
 * Rate of change across a field's own readings.
 *
 * Uses first-to-last over the elapsed days rather than a fitted slope: with three
 * or four weigh-ins a regression is a false precision, and the phase target is
 * itself expressed as kg per week.
 *
 * Returns `perWeek: null` under seven days apart — extrapolating "+1.4 kg/week"
 * from two days of scale noise is exactly the kind of confident nonsense the
 * phase note warns about ("judge by average weight, waist and strength — not
 * day-to-day scale noise").
 */
export function trendOf(
  rows: readonly Measurement[],
  field: 'weight_kg' | 'waist_cm' | 'body_fat_pct',
): Trend | null {
  const points = chronological(rows).filter((r) => r[field] !== null)
  const first = points[0]
  const last = points[points.length - 1]
  if (!first || !last || first === last) return null

  const from = first[field]!
  const to = last[field]!
  const days = daysBetween(first.measured_on, last.measured_on)
  const delta = to - from

  return {
    from,
    to,
    perWeek: days >= 7 ? Math.round((delta / days) * 7 * 100) / 100 : null,
    direction: Math.abs(delta) < 0.05 ? 'flat' : delta > 0 ? 'up' : 'down',
  }
}

/**
 * Points for a chart. Nulls are **dropped, not zeroed** (AC-4.4c) — a missing
 * body-fat reading is unknown, and plotting it as 0% would draw a cliff that
 * never happened.
 */
export interface Series {
  points: Array<{ on: string; value: number }>
  min: number
  max: number
}

export function seriesOf(
  rows: readonly Measurement[],
  field: 'weight_kg' | 'waist_cm' | 'body_fat_pct',
): Series | null {
  const points = chronological(rows)
    .filter((r) => r[field] !== null)
    .map((r) => ({ on: r.measured_on, value: r[field]! }))
  if (points.length === 0) return null

  const values = points.map((p) => p.value)
  return { points, min: Math.min(...values), max: Math.max(...values) }
}

/** Keeps only readings within `days` of the newest one. */
export function withinDays(rows: readonly Measurement[], days: number): Measurement[] {
  const sorted = chronological(rows)
  const newest = sorted[sorted.length - 1]
  if (!newest) return []
  return sorted.filter((r) => daysBetween(r.measured_on, newest.measured_on) <= days)
}

/** How stale the newest reading is — coach advice depends on current weight. */
export function daysSinceWeighIn(rows: readonly Measurement[], today: string): number | null {
  const latest = latestOf(rows, 'weight_kg')
  return latest ? daysBetween(latest.on, today) : null
}
