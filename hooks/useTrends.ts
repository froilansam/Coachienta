'use client'
import { useQuery } from '@tanstack/react-query'
import { useMemo, useState } from 'react'
import type { TrendsPayload } from '@/app/api/data/trends/route'
import type { BandPoint } from '@/components/patterns/BandLine'
import type { AxisMarker, Line } from '@/components/patterns/LineSet'
import type { Bar } from '@/components/patterns/StackedBars'
import type { TickBar } from '@/components/patterns/TickBars'
import type { Dot, Lane } from '@/components/patterns/DotPlot'
import type { GridRow } from '@/components/patterns/WeekGrid'
import { labelOf } from '@/lib/domain/coach/priorities'
import { todayLocal } from '@/lib/domain/date'
import type { Metric } from '@/components/patterns/MetricStrip'
import { foodReport, type ReportLine } from '@/lib/domain/food/report'
import {
  foodCalendar,
  foodWeeklyAverage,
  kcalSeries,
  macroSplit,
  proteinBars,
  proteinStreak,
  qualitySlices,
  qualitySummary,
  toneToCount,
  type QualitySlice,
} from '@/lib/domain/food/trends'
import {
  adherence,
  adherenceSummary,
  calendar,
  frequencySummary,
  gymSwitchMarkers,
  leadKind,
  progressionLines,
  progressionSubjects,
  PR_KIND_LABEL,
  rampOrder,
  stackByWeek,
  weeklyAverage,
  weekLabel,
  type AdherenceRow,
  type CalendarWeek,
  type ProgressionSubject,
} from '@/lib/domain/train/trends'

/**
 * The trends screen, as one flat view-model.
 *
 * Food and train share one payload and one range control. Switching the domain
 * re-derives charts with no second request for the inactive side — both arrive
 * together so the segment control never shows a spinner mid-tap.
 */
export type Measure = 'volume_kg' | 'set_count'
export type Range = '28' | '84' | '168'
export type TrendsDomain = 'food' | 'train'

export interface TrendsView {
  isLoading: boolean
  loadError: boolean
  retry: () => void

  domain: TrendsDomain
  setDomain: (d: TrendsDomain) => void
  range: Range
  setRange: (r: Range) => void

  // -- train ----------------------------------------------------------------
  trainEmpty: boolean
  gymId: string | null
  gymName: string
  gymOptions: Array<{ value: string; label: string }>
  setGymId: (id: string) => void

  measure: Measure
  setMeasure: (m: Measure) => void
  bars: Bar[]
  legend: Array<{ key: string; label: string; value: number; tint: number }>
  measureUnit: string
  leak: string | null

  subjects: ProgressionSubject[]
  subjectId: string | null
  setSubjectId: (id: string) => void
  lines: Line[]
  lineMarkers: AxisMarker[]
  lineUnit: string
  betterIsDown: boolean

  prDots: Dot[]
  prLanes: Lane[]
  prCount: number

  weeks: GridRow[]
  weekdayLabels: string[]
  target: number
  frequency: string

  adherenceRows: AdherenceRow[]
  adherenceNote: string | null

  /** `SESSIONS 3.2  VOLUME 12,400 kg  SETS 58` — a normal week, averaged. */
  trainWeeklyMetrics: Metric[]
  trainWeeklyNote: string

  // -- food -----------------------------------------------------------------
  foodEmpty: boolean
  kcalPoints: BandPoint[]
  proteinTickBars: TickBar[]
  proteinStreakDays: number
  proteinCaption: string
  macroBars: Bar[]
  macroLegend: Array<{ key: string; label: string; value: number; tint: number }>
  foodWeeks: GridRow[]
  quality: QualitySlice[]
  qualityNote: string
  averagesCaption: string
  /** `DAYS LOGGED 5.4  KCAL 2,140  PROTEIN 148 g` — a normal week, averaged. */
  foodWeeklyMetrics: Metric[]
  foodWeeklyNote: string
  reportLines: ReportLine[]
}

const WEEKDAYS = ['M', 'T', 'W', 'T', 'F', 'S', 'S']
const TARGET = 4

const dayLabel = (iso: string): string =>
  new Date(`${iso}T00:00:00`).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' })

const shortDay = (iso: string): string =>
  new Date(`${iso}T00:00:00`).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })

export function useTrends(): TrendsView {
  const [domain, setDomain] = useState<TrendsDomain>('train')
  const [range, setRange] = useState<Range>('84')
  const [measure, setMeasure] = useState<Measure>('volume_kg')
  const [picked, setPicked] = useState<string | null>(null)
  const [gymOverride, setGymOverride] = useState<string | null>(null)

  const q = useQuery<TrendsPayload>({
    queryKey: ['trends', range, gymOverride],
    queryFn: async () => {
      const params = new URLSearchParams({ days: range })
      if (gymOverride) params.set('gym', gymOverride)
      const res = await fetch(`/api/data/trends?${params}`)
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
  const nutritionDays = useMemo(() => data?.nutrition.days ?? [], [data])

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
  const lineMarkers = useMemo(() => gymSwitchMarkers(progression.lines), [progression.lines])

  // -- PR timeline ----------------------------------------------------------
  const prDots = useMemo<Dot[]>(
    () =>
      (data?.prs ?? []).map((pr, i) => ({
        key: `${pr.performed_on}-${pr.exercise_name}-${i}`,
        on: pr.performed_on,
        lane: leadKind(pr.pr_kinds),
        /**
         * Emphasis marks an ALL-TIME record now, not a weight one. Records are judged
         * per set position, so four can land in a session and the timeline needs to
         * say which one was the best of any set — otherwise it is the spreadsheet's
         * `PR Flag` column again: a mark on everything, meaning nothing.
         */
        emphasis: pr.pr_scope === 'all_time',
        label: [
          pr.exercise_name,
          `set ${pr.set_ordinal}`,
          pr.weight_kg === null ? null : `${pr.weight_kg} kg × ${pr.reps ?? 0}`,
        ]
          .filter(Boolean)
          .join(' · '),
      })),
    [data],
  )
  const prLanes = useMemo<Lane[]>(
    () => Object.entries(PR_KIND_LABEL).map(([key, label]) => ({ key, label })),
    [],
  )

  // -- weekly average -------------------------------------------------------
  /**
   * The range is the window; the average is taken over the COMPLETE weeks inside it
   * that follow your first logged one. `weeklyAverage` returns that week count so the
   * note can say what it divided by — an average whose denominator is invisible is
   * how the spreadsheet's dashboard stayed wrong for months.
   */
  const trainWeek = useMemo(
    () => weeklyAverage(sessions, today, Number(range)),
    [sessions, today, range],
  )
  const trainWeeklyMetrics = useMemo<Metric[]>(
    () => [
      { label: 'SESSIONS', value: trainWeek.sessions },
      { label: 'VOLUME', value: trainWeek.volumeKg, unit: 'kg' },
      { label: 'SETS', value: trainWeek.sets },
    ],
    [trainWeek],
  )

  const foodWeek = useMemo(
    () => foodWeeklyAverage(nutritionDays, today, Number(range)),
    [nutritionDays, today, range],
  )
  const foodWeeklyMetrics = useMemo<Metric[]>(
    () => [
      { label: 'DAYS LOGGED', value: foodWeek.daysLogged },
      { label: 'KCAL', value: foodWeek.kcal },
      { label: 'PROTEIN', value: foodWeek.proteinG, unit: 'g' },
    ],
    [foodWeek],
  )
  const reportLines = useMemo(
    () =>
      foodReport({
        today,
        rangeDays: Number(range),
        days: nutritionDays,
        sessions,
        weights: data?.nutrition.weights ?? [],
        profile: data?.nutrition.profile ?? { birthDate: null, heightCm: null, sex: null },
        phase: data?.nutrition.phase ?? null,
        targets: data?.nutrition.targets ?? null,
      }),
    [today, range, nutritionDays, sessions, data],
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

  const adherenceRows = useMemo(() => adherence(data?.share ?? []), [data])

  // -- food -----------------------------------------------------------------
  const kcalPoints = useMemo<BandPoint[]>(
    () =>
      kcalSeries(nutritionDays).map((p) => ({
        on: p.on,
        value: p.kcal,
        low: p.low,
        high: p.high,
        label: `${Math.round(p.kcal)} kcal`,
      })),
    [nutritionDays],
  )

  const proteinTickBars = useMemo<TickBar[]>(
    () =>
      proteinBars(nutritionDays)
        .slice(-21)
        .map((p) => ({
          key: p.on,
          label: shortDay(p.on),
          value: p.protein,
          tick: p.target,
          met: p.met,
        })),
    [nutritionDays],
  )

  const streak = useMemo(() => proteinStreak(nutritionDays), [nutritionDays])
  const avg = data?.nutrition.averages
  const split = useMemo(
    () =>
      avg
        ? macroSplit({
            protein_mean: avg.protein_mean,
            carbs_mean: avg.carbs_mean,
            fat_mean: avg.fat_mean,
          })
        : { protein: 0, carbs: 0, fat: 0, total: 0 },
    [avg],
  )

  const macroBars = useMemo<Bar[]>(() => {
    if (split.total <= 0) return []
    const segs = [
      { key: 'protein', label: 'Protein', value: split.protein, tint: 0 },
      { key: 'carbs', label: 'Carbs', value: split.carbs, tint: 1 },
      { key: 'fat', label: 'Fat', value: split.fat, tint: 2 },
    ]
    return [
      {
        key: 'avg',
        label: 'AVG/DAY',
        total: split.total,
        segments: segs,
      },
    ]
  }, [split])

  const macroLegend = useMemo(
    () =>
      macroBars[0]?.segments.map((s) => ({
        key: s.key,
        label: s.label,
        value: s.value,
        tint: s.tint,
      })) ?? [],
    [macroBars],
  )

  const foodCal = useMemo(() => foodCalendar(nutritionDays, today, 12), [nutritionDays, today])
  const foodWeeks = useMemo<GridRow[]>(
    () =>
      foodCal.map((w) => ({
        key: w.week_start,
        label: weekLabel(w.week_start),
        met: w.onTargetDays >= 5,
        count: w.onTargetDays,
        cells: w.days.map((d) => ({
          key: d.on,
          count: toneToCount(d.tone),
          filler: d.filler,
          label: d.filler
            ? null
            : d.tone === 'missed'
              ? `${dayLabel(d.on)} — not logged`
              : d.tone === 'on_target'
                ? `${dayLabel(d.on)} — on target`
                : `${dayLabel(d.on)} — logged`,
        })),
      })),
    [foodCal],
  )

  const quality = useMemo(
    () => qualitySlices(data?.nutrition.confidence ?? { high: 0, medium: 0, low: 0, user_verified: 0 }),
    [data],
  )

  const gymOptions = useMemo(
    () => (data?.gyms ?? []).map((g) => ({ value: g.id, label: g.name })),
    [data],
  )

  return {
    isLoading: q.isPending,
    loadError: q.isError,
    retry: () => void q.refetch(),

    domain,
    setDomain,
    range,
    setRange,

    trainEmpty: sessions.length === 0,
    gymId: data?.gymId ?? null,
    gymName: data?.gyms.find((g) => g.id === data.gymId)?.name ?? '—',
    gymOptions,
    setGymId: setGymOverride,

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
    lineMarkers,
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

    trainWeeklyMetrics,
    trainWeeklyNote: weeklyNote(
      trainWeek.weeks,
      'Blank weeks count — a skipped week is part of an average, and leaving it out would report a personal best instead.',
    ),


    foodEmpty: nutritionDays.length === 0,
    kcalPoints,
    proteinTickBars,
    proteinStreakDays: streak,
    proteinCaption:
      streak === 0
        ? 'No current protein streak — a miss or a gap resets the count.'
        : `${streak} day${streak === 1 ? '' : 's'} in a row at or above target.`,
    macroBars,
    macroLegend,
    foodWeeks,
    quality,
    qualityNote: qualitySummary(quality),
    averagesCaption: avg
      ? `Across ${avg.logged_days} logged day${avg.logged_days === 1 ? '' : 's'} · mean ${Math.round(avg.kcal_mean)} kcal · protein ${avg.protein_mean} g`
      : 'No averages yet.',
    foodWeeklyMetrics,
    foodWeeklyNote: weeklyNote(
      foodWeek.weeks,
      'Calories and protein are per LOGGED day — an unlogged day is missing data, not a day of eating nothing.',
    ),
    reportLines,
  }
}

/**
 * `Averaged over 9 complete weeks. This week is excluded — it is not over.`
 *
 * States the denominator and the one exclusion that would otherwise look like a
 * slump every Monday.
 */
function weeklyNote(weeks: number, extra: string): string {
  if (weeks === 0) return 'Not a full week on record yet — an average needs a finished week.'
  return `Averaged over ${weeks} complete week${weeks === 1 ? '' : 's'}; this week is excluded because it is not over. ${extra}`
}
