import { labelOf as muscleLabel } from '@/lib/domain/coach/priorities'
import type { MuscleWeek, SessionSummary, ShareRow, TopSet, TotalWeek } from '@/lib/db/queries/trends'

/**
 * Turns the trend queries into things a chart can draw, and states the one
 * arithmetic check that matters.
 *
 * Pure. No React, no I/O.
 */
export interface StackedWeek {
  week_start: string
  segments: Array<{ key: string; label: string; value: number }>
  total: number
  /**
   * Total minus the sum of the parts (AC-2.14).
   *
   * It should always be zero — `exercises.muscle_group` is a NOT NULL enum, so
   * every set attributes somewhere. It is returned anyway because the spreadsheet
   * lost 1,802 kg to text in its volume column and nothing noticed. A leak that has
   * a named bucket cannot hide behind a "0"; one with no bucket can.
   */
  unattributed: number
}

/** Weekly stacked bars: one segment per muscle group, largest first. */
export function stackByWeek(
  muscle: readonly MuscleWeek[],
  total: readonly TotalWeek[],
  field: 'volume_kg' | 'set_count',
): StackedWeek[] {
  const weeks = [...new Set([...muscle.map((m) => m.week_start), ...total.map((t) => t.week_start)])].sort()

  return weeks.map((week_start) => {
    const rows = muscle.filter((m) => m.week_start === week_start)
    const segments = rows
      .map((r) => ({ key: r.muscle_group, label: muscleLabel(r.muscle_group), value: r[field] }))
      .filter((sg) => sg.value > 0)
      .sort((a, b) => b.value - a.value)

    const declared = total.find((t) => t.week_start === week_start)?.[field] ?? 0
    const summed = segments.reduce((n, sg) => n + sg.value, 0)
    return {
      week_start,
      segments,
      total: declared,
      unattributed: Math.round((declared - summed) * 10) / 10,
    }
  })
}

/** True when every week's parts add up to its total — the AC-2.14 assertion. */
export const isFullyAttributed = (weeks: readonly StackedWeek[]): boolean =>
  weeks.every((w) => Math.abs(w.unattributed) < 0.05

  )

/**
 * Priority adherence: what you said you wanted, against where the volume went.
 *
 * PRD-004 §4.4 calls this "the one the spreadsheet couldn't produce and the one
 * most likely to change behaviour". Ranked order in, actual share alongside, and a
 * verdict per row so it reads as an answer rather than a table.
 */
export interface AdherenceRow {
  rank: number
  label: string
  sharePct: number
  /** Where this group actually sits when ordered by volume. */
  actualRank: number
  verdict: 'on' | 'under' | 'over'
}

export function adherence(share: readonly ShareRow[]): AdherenceRow[] {
  const byVolume = [...share].sort((a, b) => b.share_pct - a.share_pct)
  return [...share]
    .sort((a, b) => a.rank - b.rank)
    .map((r) => {
      const actualRank = byVolume.findIndex((x) => x.muscle_group === r.muscle_group) + 1
      const drift = actualRank - r.rank
      return {
        rank: r.rank,
        label: muscleLabel(r.muscle_group),
        sharePct: r.share_pct,
        actualRank,
        /**
         * A ranked group that received NO volume is under-served, whatever its rank
         * drift says. Ties at 0% put every untrained group within one place of its
         * rank, so the drift rule alone labelled two 0% groups "ON ORDER" — which
         * claims the order was honoured by not training them at all.
         */
        verdict:
          r.share_pct === 0 ? 'under' : drift <= -2 ? 'over' : drift >= 2 ? 'under' : 'on',
      }
    })
}

/** `Shoulders (side) is #1 but got the 3rd most volume.` — the sentence version. */
export function adherenceSummary(rows: readonly AdherenceRow[]): string | null {
  const worst = rows.find((r) => r.verdict === 'under')
  if (!worst) return rows.length === 0 ? null : 'Volume matches your priority order.'
  return `${worst.label} is ranked #${worst.rank} but received the ${ordinal(worst.actualRank)} most volume (${worst.sharePct}%).`
}

const ordinal = (n: number): string => {
  const suffix = n % 10 === 1 && n !== 11 ? 'st' : n % 10 === 2 && n !== 12 ? 'nd' : n % 10 === 3 && n !== 13 ? 'rd' : 'th'
  return `${n}${suffix}`
}

/** Epley: an estimated one-rep max, so sets at different rep counts are comparable. */
export const epley1rm = (weightKg: number, reps: number): number =>
  reps <= 0 ? 0 : Math.round(weightKg * (1 + reps / 30) * 10) / 10

/** `WEEK OF 3 AUG` — a bar's label. */
export const weekLabel = (iso: string): string =>
  new Date(`${iso}T00:00:00`).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })

// ---------------------------------------------------------------------------
// Stable segment order
// ---------------------------------------------------------------------------
/**
 * One ramp position per muscle group for the whole range, biggest first.
 *
 * Ordering each bar independently would move a group's shade week to week, so the
 * same colour would mean chest in one row and back in the next. The ramp is decided
 * once, from the range total.
 */
export const rampOrder = (muscle: readonly MuscleWeek[], field: 'volume_kg' | 'set_count'): string[] => {
  const totals = new Map<string, number>()
  for (const r of muscle) totals.set(r.muscle_group, (totals.get(r.muscle_group) ?? 0) + r[field])
  return [...totals.entries()].sort((a, b) => b[1] - a[1]).map(([k]) => k)
}

// ---------------------------------------------------------------------------
// Strength progression
// ---------------------------------------------------------------------------
export interface ProgressionPoint {
  on: string
  value: number
  label: string
}
export interface ProgressionLine {
  key: string
  label: string
  points: ProgressionPoint[]
}
export interface ProgressionSubject {
  id: string
  name: string
  loadType: string
  days: number
}

/** Exercises with enough history to draw, most-logged first. */
export function progressionSubjects(tops: readonly TopSet[]): ProgressionSubject[] {
  const by = new Map<string, ProgressionSubject>()
  for (const t of tops) {
    const found = by.get(t.exercise_id)
    if (found) found.days += 1
    else by.set(t.exercise_id, { id: t.exercise_id, name: t.exercise_name, loadType: t.load_type, days: 1 })
  }
  return [...by.values()]
    // A single data point is not a progression — it is a dot with no story.
    .filter((s) => s.days >= 2)
    .sort((a, b) => b.days - a.days || a.name.localeCompare(b.name))
}

/**
 * One line per gym for a single exercise.
 *
 * Estimated 1RM rather than raw weight, so a 5-rep set and a 12-rep set sit on the
 * same axis — otherwise dropping the reps to add load reads as a regression.
 * `duration` and `assisted` are plotted on their own honest axis instead: seconds
 * held, and assistance needed (where **down is better**, §3.1).
 */
export function progressionLines(
  tops: readonly TopSet[],
  exerciseId: string,
): { lines: ProgressionLine[]; unit: string; betterIsDown: boolean } {
  const rows = tops.filter((t) => t.exercise_id === exerciseId)
  const loadType = rows[0]?.load_type ?? 'external_weight'

  const measure = (t: TopSet): ProgressionPoint | null => {
    if (loadType === 'duration') {
      return t.duration_sec === null ? null : { on: t.performed_on, value: t.duration_sec, label: `${t.duration_sec} s` }
    }
    if (loadType === 'assisted') {
      return t.weight_kg === null
        ? null
        : { on: t.performed_on, value: t.weight_kg, label: `${t.weight_kg} kg assist × ${t.reps ?? 0}` }
    }
    if ((t.weight_kg ?? 0) === 0) {
      return t.reps === null ? null : { on: t.performed_on, value: t.reps, label: `${t.reps} reps` }
    }
    if (t.reps === null) return null
    return {
      on: t.performed_on,
      value: epley1rm(t.weight_kg!, t.reps),
      label: `${t.weight_kg} kg × ${t.reps}`,
    }
  }

  const byGym = new Map<string, ProgressionLine>()
  for (const t of rows) {
    const point = measure(t)
    if (point === null) continue
    const key = t.gym_id ?? 'unknown'
    const line = byGym.get(key) ?? { key, label: t.gym_name ?? 'Unknown gym', points: [] }
    line.points.push(point)
    byGym.set(key, line)
  }
  for (const line of byGym.values()) line.points.sort((a, b) => a.on.localeCompare(b.on))

  const unit =
    loadType === 'duration' ? 's' : loadType === 'assisted' ? 'kg assist' : (rows[0]?.weight_kg ?? 1) === 0 ? 'reps' : 'kg e1RM'

  return { lines: [...byGym.values()], unit, betterIsDown: loadType === 'assisted' }
}

/**
 * First day of every gym line except the earliest overall — dashed markers on
 * the progression chart so a gym change is visible without inventing a bridge
 * between incompatible cable stacks (PRD-004 §4.4 ⚠️).
 */
export function gymSwitchMarkers(
  lines: readonly ProgressionLine[],
): Array<{ on: string; label: string }> {
  const starts = lines
    .map((l) => {
      const first = l.points[0]
      return first ? { on: first.on, label: l.label } : null
    })
    .filter((m): m is { on: string; label: string } => m !== null)
    .sort((a, b) => a.on.localeCompare(b.on))
  return starts.slice(1)
}

// ---------------------------------------------------------------------------
// Session frequency
// ---------------------------------------------------------------------------
export interface CalendarDay {
  on: string
  sessions: number
  volume: number
  /** Outside the requested range — rendered as a spacer so weeks line up. */
  filler: boolean
}
export interface CalendarWeek {
  week_start: string
  days: CalendarDay[]
  sessions: number
  /** Met the 4-day target (§2 goal: 4 sessions a week). */
  onTarget: boolean
}

export const WEEKLY_TARGET = 4

/**
 * A Monday-aligned grid of the last `weeks` weeks.
 *
 * Built from the session list rather than a `group by week` query, because a weekly
 * count cannot show WHICH days — and "four sessions, all on the weekend" is a
 * different week from "four sessions spread out", which is the point of a calendar.
 */
export function calendar(
  sessions: readonly SessionSummary[],
  today: string,
  weeks = 12,
): CalendarWeek[] {
  const byDay = new Map<string, { sessions: number; volume: number }>()
  for (const s of sessions) {
    const found = byDay.get(s.performed_on) ?? { sessions: 0, volume: 0 }
    byDay.set(s.performed_on, { sessions: found.sessions + 1, volume: found.volume + s.volume_kg })
  }

  const end = mondayOf(today)
  const out: CalendarWeek[] = []
  for (let w = weeks - 1; w >= 0; w--) {
    const start = addDays(end, -7 * w)
    const days: CalendarDay[] = []
    for (let d = 0; d < 7; d++) {
      const on = addDays(start, d)
      const hit = byDay.get(on)
      days.push({
        on,
        sessions: hit?.sessions ?? 0,
        volume: hit?.volume ?? 0,
        filler: on > today,
      })
    }
    const count = days.reduce((n, d) => n + d.sessions, 0)
    out.push({ week_start: start, days, sessions: count, onTarget: count >= WEEKLY_TARGET })
  }
  return out
}

/** ISO date of the Monday on or before `iso`. */
export function mondayOf(iso: string): string {
  const d = new Date(`${iso}T00:00:00`)
  const shift = (d.getDay() + 6) % 7
  return addDays(iso, -shift)
}

export function addDays(iso: string, n: number): string {
  const d = new Date(`${iso}T00:00:00`)
  d.setDate(d.getDate() + n)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

/** `3 of the last 12 weeks hit 4 sessions.` — the honest headline. */
export const frequencySummary = (weeks: readonly CalendarWeek[]): string => {
  const past = weeks.filter((w) => w.days.some((d) => !d.filler))
  const hit = past.filter((w) => w.onTarget).length
  const avg = past.length === 0 ? 0 : past.reduce((n, w) => n + w.sessions, 0) / past.length
  return `${hit} of ${past.length} weeks hit ${WEEKLY_TARGET} · ${avg.toFixed(1)} a week on average`
}

// ---------------------------------------------------------------------------
// PR timeline
// ---------------------------------------------------------------------------
export const PR_KIND_LABEL: Record<string, string> = {
  weight: 'Weight',
  reps_at_weight: 'Reps',
  volume_set: 'Set volume',
  duration: 'Hold',
  first_time: 'First time',
}

/** The kind a dot is coloured by: the strongest claim the set makes. */
export const leadKind = (kinds: readonly string[]): string =>
  kinds.find((k) => k === 'weight') ?? kinds.find((k) => k === 'duration') ?? kinds[0] ?? 'volume_set'
