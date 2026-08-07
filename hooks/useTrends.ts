'use client'
import { useQuery } from '@tanstack/react-query'
import { useMemo, useState } from 'react'
import type { TrendsPayload } from '@/app/api/data/trends/route'
import { labelOf } from '@/lib/domain/coach/priorities'
import { todayLocal } from '@/lib/domain/date'
import {
  adherence,
  adherenceSummary,
  calendar,
  frequencySummary,
  leadKind,
  progressionLines,
  progressionSubjects,
  PR_KIND_LABEL,
  rampOrder,
  stackByWeek,
  weekLabel,
  type AdherenceRow,
  type CalendarWeek,
  type ProgressionSubject,
} from '@/lib/domain/train/trends'
import type { Bar } from '@/components/patterns/StackedBars'
import type { Dot, Lane } from '@/components/patterns/DotPlot'
import type { Line } from '@/components/patterns/LineSet'
import type { GridRow } from '@/components/patterns/WeekGrid'

/**
 * The trends screen, as one flat view-model.
 *
 * Every number here is derived — the hook fetches once and the two switches
 * (`volume`/`sets`, and which exercise) re-derive from the same payload with no
 * second request. Six charts behind six spinners would be a worse screen than six
 * charts that appear together.
 */
export type Measure = 'volume_kg' | 'set_count'
export type Range = '28' | '84' | '168'

export interface TrendsView {
  isLoading: boolean
  loadError: boolean
  retry: () => void
  isEmpty: boolean

  range: Range
  setRange: (r: Range) => void
  gymName: string

  // -- volume / sets by muscle group ---------------------------------------
  measure: Measure
  setMeasure: (m: Measure) => void
  bars: Bar[]
  legend: Array<{ key: string; label: string; value: number; tint: number }>
  measureUnit: string
  /** Non-null only when the parts do not add up — AC-2.14's visible failure. */
  leak: string | null

  // -- strength progression -------------------------------------------------
  subjects: ProgressionSubject[]
  subjectId: string | null
  setSubjectId: (id: string) => void
  lines: Line[]
  lineUnit: string
  betterIsDown: boolean

  // -- PR timeline ----------------------------------------------------------
  prDots: Dot[]
  prLanes: Lane[]
  prCount: number

  // -- session frequency ----------------------------------------------------
  weeks: GridRow[]
  weekdayLabels: string[]
  target: number
  frequency: string

  // -- priority adherence ---------------------------------------------------
  adherenceRows: AdherenceRow[]
  adherenceNote: string | null
}

const WEEKDAYS = ['M', 'T', 'W', 'T', 'F', 'S', 'S']
const TARGET = 4

const dayLabel = (iso: string): string =>
  new Date(`${iso}T00:00:00`).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' })

export function useTrends(): TrendsView {
  const [range, setRange] = useState<Range>('84')
  const [measure, setMeasure] = useState<Measure>('volume_kg')
  const [picked, setPicked] = useState<string | null>(null)

  const q = useQuery<TrendsPayload>({
    queryKey: ['trends', range],
    queryFn: async () => {
      const res = await fetch(`/api/data/trends?days=${range}`)
      if (!res.ok) throw new Error(`trends: ${res.status}`)
      return res.json()
    },
  })

  const data = q.data
  const today = todayLocal()

  const muscle = useMemo(() => data?.muscle ?? [], [data])
  const total = useMemo(() => data?.total ?? [], [data])
  const tops = useMemo(() => data?.tops ?? [], [data])
  const sessions = useMemo(() => data?.sessions ?? [], [data])

  // -- stacked bars ---------------------------------------------------------
  const order = useMemo(() => rampOrder(muscle, measure), [muscle, measure])
  const tintOf = useMemo(() => new Map(order.map((k, i) => [k, i])), [order])

  const stacked = useMemo(() => stackByWeek(muscle, total, measure), [muscle, total, measure])

  const bars = useMemo<Bar[]>(
    () =>
      stacked.map((w) => ({
        key: w.week_start,
        label: weekLabel(w.week_start),
        total: w.total,
        unattributed: w.unattributed,
        segments: w.segments.map((sg) => ({ ...sg, tint: tintOf.get(sg.key) ?? 0 })),
      })),
    [stacked, tintOf],
  )

  const legend = useMemo(
    () =>
      order
        .map((key, tint) => ({
          key,
          tint,
          label: labelOf(key),
          value: muscle.filter((m) => m.muscle_group === key).reduce((n, m) => n + m[measure], 0),
        }))
        /**
         * A zero is dropped, not listed. `volume_by_muscle` returns abs/core with
         * `0` because the sets exist, but "Abs / core — 0 kg" in a legend reads as a
         * broken total rather than as a definition; the same reason `NumericValue`
         * renders null as a dash and never as 0. Switch to SETS and it reappears
         * with a real number.
         */
        .filter((it) => it.value > 0),
    [order, muscle, measure],
  )

  const leak = useMemo(() => {
    const missing = stacked.reduce((n, w) => n + Math.abs(w.unattributed), 0)
    if (missing < 0.05) return null
    return `${Math.round(missing).toLocaleString()} ${measure === 'volume_kg' ? 'kg' : 'sets'} could not be attributed to a muscle group.`
  }, [stacked, measure])

  // -- strength progression -------------------------------------------------
  const subjects = useMemo(() => progressionSubjects(tops), [tops])
  const subjectId = picked ?? subjects[0]?.id ?? null
  const progression = useMemo(
    () =>
      subjectId === null
        ? { lines: [], unit: 'kg', betterIsDown: false }
        : progressionLines(tops, subjectId),
    [tops, subjectId],
  )

  // -- PR timeline ----------------------------------------------------------
  const prDots = useMemo<Dot[]>(
    () =>
      (data?.prs ?? []).map((pr, i) => ({
        key: `${pr.performed_on}-${pr.exercise_name}-${i}`,
        on: pr.performed_on,
        lane: leadKind(pr.pr_kinds),
        emphasis: pr.pr_kinds.includes('weight'),
        label:
          pr.weight_kg === null
            ? pr.exercise_name
            : `${pr.exercise_name} · ${pr.weight_kg} kg × ${pr.reps ?? 0}`,
      })),
    [data],
  )
  const prLanes = useMemo<Lane[]>(
    () => Object.entries(PR_KIND_LABEL).map(([key, label]) => ({ key, label })),
    [],
  )

  // -- frequency ------------------------------------------------------------
  const cal = useMemo<CalendarWeek[]>(() => calendar(sessions, today, 12), [sessions, today])
  const weeks = useMemo<GridRow[]>(
    () =>
      cal.map((w) => ({
        key: w.week_start,
        label: weekLabel(w.week_start),
        met: w.onTarget,
        count: w.sessions,
        cells: w.days.map((d) => ({
          key: d.on,
          count: d.sessions,
          filler: d.filler,
          label: d.filler
            ? null
            : d.sessions === 0
              ? `${dayLabel(d.on)} — rest`
              : `${dayLabel(d.on)} — ${d.sessions} session${d.sessions > 1 ? 's' : ''}`,
        })),
      })),
    [cal],
  )

  // -- adherence ------------------------------------------------------------
  const adherenceRows = useMemo(() => adherence(data?.share ?? []), [data])

  return {
    isLoading: q.isPending,
    loadError: q.isError,
    retry: () => void q.refetch(),
    isEmpty: sessions.length === 0,

    range,
    setRange,
    gymName: data?.gyms.find((g) => g.id === data.gymId)?.name ?? '—',

    measure,
    setMeasure,
    bars,
    legend,
    measureUnit: measure === 'volume_kg' ? 'kg' : 'sets',
    leak,

    subjects,
    subjectId,
    setSubjectId: setPicked,
    lines: progression.lines,
    lineUnit: progression.unit,
    betterIsDown: progression.betterIsDown,

    prDots,
    prLanes,
    prCount: prDots.length,

    weeks,
    weekdayLabels: WEEKDAYS,
    target: TARGET,
    frequency: frequencySummary(cal),

    adherenceRows,
    adherenceNote: adherenceSummary(adherenceRows),
  }
}
