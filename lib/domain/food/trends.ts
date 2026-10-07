/**
 * Nutrition trends — pure transforms over the same SQL the coach uses
 * (`nutrition_summary` / `nutrition_averages`). Charts and coach answers must
 * never disagree (PRD-003 §5.3).
 */

import { addDays, mondayOf } from '@/lib/domain/date'

export interface DayBucket {
  bucket: string
  is_gym_day: boolean
  kcal: number
  protein_g: number
  carbs_g: number
  fat_g: number
  entry_count: number
  kcal_target_low: number | null
  kcal_target_high: number | null
  protein_target: number | null
}

export interface ConfidenceCounts {
  high: number
  medium: number
  low: number
  user_verified: number
}

/** A day on the kcal chart: intake plus the target band for that day. */
export interface KcalDay {
  on: string
  kcal: number
  low: number | null
  high: number | null
  isGym: boolean
}

export function kcalSeries(days: readonly DayBucket[]): KcalDay[] {
  return days.map((d) => ({
    on: d.bucket,
    kcal: d.kcal,
    low: d.kcal_target_low,
    high: d.kcal_target_high,
    isGym: d.is_gym_day,
  }))
}

/**
 * Consecutive days (newest first among logged days) that hit protein target.
 * A gap or a miss breaks the streak — unlogged days are not free passes.
 */
export function proteinStreak(days: readonly DayBucket[]): number {
  const sorted = [...days].sort((a, b) => b.bucket.localeCompare(a.bucket))
  let n = 0
  for (const d of sorted) {
    if (d.protein_target === null || d.protein_g < d.protein_target) break
    n += 1
  }
  return n
}

export interface ProteinBar {
  on: string
  protein: number
  target: number | null
  met: boolean
}

export function proteinBars(days: readonly DayBucket[]): ProteinBar[] {
  return days.map((d) => ({
    on: d.bucket,
    protein: d.protein_g,
    target: d.protein_target,
    met: d.protein_target !== null && d.protein_g >= d.protein_target,
  }))
}

export type AdherenceTone = 'on_target' | 'logged' | 'missed' | 'empty'

/**
 * Calendar cell for one day in the range.
 * - on_target: logged and kcal inside the band (when a band exists)
 * - logged: logged but off-band or no band
 * - missed: in range, no entries
 * - empty: filler outside the range (WeekGrid spacer)
 */
export function adherenceTone(d: DayBucket | null, filler: boolean): AdherenceTone {
  if (filler) return 'empty'
  if (d === null || d.entry_count === 0) return 'missed'
  const { kcal, kcal_target_low: low, kcal_target_high: high } = d
  if (low !== null && high !== null && kcal >= low && kcal <= high) return 'on_target'
  return 'logged'
}

export interface MacroSplit {
  protein: number
  carbs: number
  fat: number
  total: number
}

/** Average grams across logged days — same basis as `nutrition_averages`. */
export function macroSplit(avg: {
  protein_mean: number
  carbs_mean: number
  fat_mean: number
}): MacroSplit {
  const protein = avg.protein_mean
  const carbs = avg.carbs_mean
  const fat = avg.fat_mean
  return { protein, carbs, fat, total: protein + carbs + fat }
}

export interface QualitySlice {
  key: string
  label: string
  count: number
  pct: number
}

/** Share of entries by confidence — "am I measuring or guessing?" */
export function qualitySlices(counts: ConfidenceCounts): QualitySlice[] {
  const total =
    counts.high + counts.medium + counts.low + counts.user_verified
  if (total === 0) return []
  const rows: Array<{ key: keyof ConfidenceCounts; label: string }> = [
    { key: 'user_verified', label: 'Verified' },
    { key: 'high', label: 'High' },
    { key: 'medium', label: 'Medium' },
    { key: 'low', label: 'Low' },
  ]
  return rows
    .map(({ key, label }, tint) => ({
      key,
      label,
      count: counts[key],
      pct: (counts[key] / total) * 100,
      tint,
    }))
    .filter((r) => r.count > 0)
    .map(({ tint: _t, ...rest }) => rest)
}

export function qualitySummary(slices: readonly QualitySlice[]): string {
  if (slices.length === 0) return 'No entries in this range.'
  const verified = slices.find((s) => s.key === 'user_verified' || s.key === 'high')
  const low = slices.find((s) => s.key === 'low')
  const parts: string[] = []
  if (verified) parts.push(`${Math.round(verified.pct)}% high or verified`)
  if (low) parts.push(`${Math.round(low.pct)}% low confidence`)
  return parts.length > 0 ? parts.join(' · ') : 'All entries graded medium.'
}

// `mondayOf` lives in `lib/domain/date.ts`. It had a third copy here and a second in
// the training trends, which is two more places for the week boundary to drift.

export interface FoodCalendarDay {
  on: string
  tone: AdherenceTone
  filler: boolean
}

export interface FoodCalendarWeek {
  week_start: string
  days: FoodCalendarDay[]
  /** Days on target this week. */
  onTargetDays: number
}

/**
 * Monday-aligned adherence grid. Maps onto WeekGrid via count encoding:
 * on_target→2, logged→1, missed→0, empty→filler.
 */
export function foodCalendar(
  buckets: readonly DayBucket[],
  today: string,
  weeks = 12,
): FoodCalendarWeek[] {
  const byDay = new Map(buckets.map((b) => [b.bucket, b]))
  const end = mondayOf(today)
  const out: FoodCalendarWeek[] = []
  for (let w = weeks - 1; w >= 0; w--) {
    const start = addDays(end, -7 * w)
    const days: FoodCalendarDay[] = []
    let onTargetDays = 0
    for (let d = 0; d < 7; d++) {
      const on = addDays(start, d)
      const filler = on > today
      const bucket = byDay.get(on) ?? null
      const tone = adherenceTone(bucket, filler)
      if (tone === 'on_target') onTargetDays += 1
      days.push({ on, tone, filler })
    }
    out.push({ week_start: start, days, onTargetDays })
  }
  return out
}

// ---------------------------------------------------------------------------
// Weekly average
// ---------------------------------------------------------------------------
/**
 * What a normal week of eating looks like. Same three rules as the training one
 * (`lib/domain/train/trends.ts`): the current week is excluded because it is not
 * over, the window starts at your first logged week rather than at the start of the
 * range, and blank weeks in between still count.
 *
 * **Calories and protein are per LOGGED day, not per calendar day.** An unlogged day
 * is a day with no data, not a day of eating nothing, and dividing by seven would
 * quietly report a crash diet every time a week went half-logged — the same failure
 * direction as a failed day fetch rendering as an empty day. `daysLogged` is
 * returned alongside so the reader can see how much the mean is worth.
 */
export interface FoodWeeklyAverage {
  weeks: number
  /** Days with at least one entry, per week. */
  daysLogged: number
  /** Per logged day. */
  kcal: number
  proteinG: number
}

export function foodWeeklyAverage(
  buckets: readonly DayBucket[],
  today: string,
  rangeDays: number,
): FoodWeeklyAverage {
  const none: FoodWeeklyAverage = { weeks: 0, daysLogged: 0, kcal: 0, proteinG: 0 }
  const from = mondayOf(addDays(today, -rangeDays + 1))
  const lastWeekStart = addDays(mondayOf(today), -7)
  const until = addDays(lastWeekStart, 6)

  const logged = buckets.filter(
    (b) => b.entry_count > 0 && b.bucket >= from && b.bucket <= until,
  )
  if (logged.length === 0) return none

  const earliest = logged.reduce((m, b) => (b.bucket < m ? b.bucket : m), until)
  let weeks = 0
  for (let w = mondayOf(earliest); w <= lastWeekStart; w = addDays(w, 7)) weeks += 1
  if (weeks === 0) return none

  const kcal = logged.reduce((n, b) => n + b.kcal, 0)
  const protein = logged.reduce((n, b) => n + b.protein_g, 0)
  return {
    weeks,
    daysLogged: Math.round((logged.length / weeks) * 10) / 10,
    kcal: Math.round(kcal / logged.length),
    proteinG: Math.round(protein / logged.length),
  }
}

/** WeekGrid count encoding for food adherence tones. */
export function toneToCount(tone: AdherenceTone): number {
  switch (tone) {
    case 'on_target':
      return 2
    case 'logged':
      return 1
    case 'missed':
    case 'empty':
      return 0
  }
}
