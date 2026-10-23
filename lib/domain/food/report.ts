/**
 * The food report: what you ate, what the program asked for, and what the scale
 * says that intake was worth.
 *
 * TDEE here is not a formula. Intake over finished weeks, adjusted by the weight
 * change across the same weeks, at 7,700 kcal per kilogram. The Mifflin figure is
 * shown beside it as a check, and it is blocked when age, height, or sex is
 * missing — a guessed age must not become a calorie target.
 *
 * The window is `finishedFoodWindow`, the same one as the weekly average, so the
 * protein on this report and the protein on the strip cannot disagree.
 */

import { estimateEnergy, type ActivityLevel } from '@/lib/domain/coach/energy'
import { atLocalMidnight } from '@/lib/domain/date'
import { finishedFoodWindow, foodWeeklyAverage, type DayBucket } from '@/lib/domain/food/trends'

/** Energy in one kilogram of body tissue. The usual dietetic constant. */
const KCAL_PER_KG = 7700

export interface ReportWeight {
  measured_on: string
  weight_kg: number
}

export interface ReportSession {
  performed_on: string
  completed_at: string | null
  /** A session with sets is training even when finish was never stamped. */
  set_count?: number
}

export interface ReportProfile {
  birthDate: string | null
  heightCm: number | null
  sex: 'male' | 'female' | null
}

export interface ReportPhase {
  label: string
  rateKgPerWeek: number | null
}

export interface ReportTargets {
  phaseLabel: string
  proteinG: number
  kcalGymLow: number | null
  kcalGymHigh: number | null
  kcalRestLow: number | null
  kcalRestHigh: number | null
}

export interface FoodReportInput {
  today: string
  rangeDays: number
  days: readonly DayBucket[]
  sessions: readonly ReportSession[]
  weights: readonly ReportWeight[]
  profile: ReportProfile
  phase: ReportPhase | null
  targets: ReportTargets | null
}

export type ReportTone = 'primary' | 'pos' | 'warn' | 'neg'

export interface ReportLine {
  label: string
  value: string
  detail: string
  tone: ReportTone
}

const num = (n: number): string => Math.round(n).toLocaleString('en-US')
const kcal = (n: number): string => `${num(n)} kcal`

const oneDecimal = (n: number): string => {
  const r = Math.round(n * 10) / 10
  return Number.isInteger(r) ? String(r) : r.toFixed(1)
}

const daySpan = (from: string, to: string): number =>
  Math.round((atLocalMidnight(to).getTime() - atLocalMidnight(from).getTime()) / 86_400_000)

/** Sessions per week → the coarse multiplier `tdee` already uses. */
export function activityLevelFor(sessionsPerWeek: number): ActivityLevel {
  if (sessionsPerWeek >= 6) return 'active'
  if (sessionsPerWeek >= 4) return 'moderate'
  if (sessionsPerWeek >= 2) return 'light'
  return 'sedentary'
}

function programName(phase: ReportPhase | null, targets: ReportTargets | null): string {
  const name = targets?.phaseLabel || phase?.label || 'No program set'
  const rate = phase?.rateKgPerWeek
  if (rate === null || rate === undefined) return name
  const pace =
    rate < 0 && rate >= -0.25 ? 'micro deficit' : rate < -0.25 ? 'deficit' : rate > 0.05 ? 'surplus' : 'maintenance'
  if (name.toLowerCase().includes(pace)) return name
  return `${name} · ${pace}`
}

function band(low: number | null, high: number | null): string | null {
  if (low === null || high === null) return null
  return `${low.toLocaleString('en-US')}–${high.toLocaleString('en-US')}`
}

function mid(low: number | null, high: number | null): number | null {
  if (low === null && high === null) return null
  if (low === null) return high
  if (high === null) return low
  return (low + high) / 2
}

/**
 * Four lines: expenditure, the program, training, protein.
 * An empty list means there is nothing logged in a finished week.
 */
export function foodReport(input: FoodReportInput): ReportLine[] {
  const window = finishedFoodWindow(input.days, input.today, input.rangeDays)
  if (!window) {
    return [
      {
        label: 'Report',
        value: '—',
        detail: 'Not a full week on record yet — an average needs a finished week.',
        tone: 'primary',
      },
    ]
  }

  const avg = foodWeeklyAverage(input.days, input.today, input.rangeDays)
  const logged = window.logged
  const intake = avg.kcal

  const weights = input.weights
    .filter((w) => w.measured_on >= window.from && w.measured_on <= window.until)
    .sort((a, b) => a.measured_on.localeCompare(b.measured_on))
  const first = weights[0]
  const last = weights[weights.length - 1]
  const span = first && last ? daySpan(first.measured_on, last.measured_on) : 0

  let tdeeLine: ReportLine
  if (!first || !last || first.measured_on === last.measured_on || span < 7) {
    tdeeLine = {
      label: 'TDEE',
      value: '—',
      detail:
        'Needs two weigh-ins at least a week apart inside these finished weeks. Intake alone cannot say what you burn.',
      tone: 'primary',
    }
  } else {
    const delta = last.weight_kg - first.weight_kg
    const perWeek = (delta / span) * 7
    const observed = Math.round(intake - (delta * KCAL_PER_KG) / span)
    const change =
      Math.abs(delta) < 0.05
        ? 'weight held'
        : `${delta < 0 ? 'down' : 'up'} ${oneDecimal(Math.abs(perWeek))} kg/week`
    tdeeLine = {
      label: 'TDEE',
      value: kcal(observed),
      detail: `${kcal(intake)} eaten per logged day, ${change} (${first.weight_kg} kg on ${first.measured_on} to ${last.weight_kg} kg on ${last.measured_on}). 7,700 kcal per kg.`,
      tone: 'primary',
    }
  }

  const sessions = input.sessions.filter((s) => {
    const on = s.performed_on.slice(0, 10)
    const worked = s.completed_at !== null || (s.set_count ?? 0) > 0
    return worked && on >= window.from && on <= window.until
  })
  const perWeek = sessions.length / window.weeks
  const level = activityLevelFor(perWeek)
  const energy = estimateEnergy({
    weightKg: last?.weight_kg ?? first?.weight_kg ?? null,
    heightCm: input.profile.heightCm,
    birthDate: input.profile.birthDate,
    sex: input.profile.sex,
    today: input.today,
    activity: level,
  })
  if (energy.ok) {
    const formula = `Formula estimate ${kcal(energy.tdee)} (BMR ${num(energy.bmr)}, ${level}, ${oneDecimal(perWeek)} sessions a week).`
    tdeeLine = { ...tdeeLine, detail: `${tdeeLine.detail} ${formula}` }
  } else if (tdeeLine.value !== '—') {
    tdeeLine = { ...tdeeLine, detail: `${tdeeLine.detail} ${energy.blocked}` }
  }

  const gymDays = logged.filter((d) => d.is_gym_day).length
  const restDays = logged.length - gymDays
  const activity: ReportLine = {
    label: 'Activity',
    value: `${oneDecimal(perWeek)} / week`,
    detail: `${sessions.length} session${sessions.length === 1 ? '' : 's'} with logged work over ${window.weeks} week${window.weeks === 1 ? '' : 's'}. Of the days you logged food, ${gymDays} were gym days and ${restDays} were rest days.`,
    tone: 'primary',
  }

  const targeted = logged.filter((d) => mid(d.kcal_target_low, d.kcal_target_high) !== null)
  const programMean =
    targeted.length === 0
      ? null
      : Math.round(
          targeted.reduce((n, d) => n + (mid(d.kcal_target_low, d.kcal_target_high) ?? 0), 0) /
            targeted.length,
        )
  const inside = logged.filter((d) => {
    const { kcal_target_low: low, kcal_target_high: high, kcal: eaten } = d
    return low !== null && high !== null && eaten >= low && eaten <= high
  }).length
  const gymBand = band(input.targets?.kcalGymLow ?? null, input.targets?.kcalGymHigh ?? null)
  const restBand = band(input.targets?.kcalRestLow ?? null, input.targets?.kcalRestHigh ?? null)
  const bands =
    gymBand && restBand ? `Gym ${gymBand}, rest ${restBand}.` : 'No gym and rest bands on the current program.'

  let program: ReportLine
  if (programMean === null) {
    program = {
      label: 'Program',
      value: '—',
      detail: `${programName(input.phase, input.targets)}. ${bands} These days have no calorie band to score against.`,
      tone: 'primary',
    }
  } else {
    const gap = intake - programMean
    const on = inside / logged.length >= 0.5
    const rate = input.phase?.rateKgPerWeek
    const moved =
      first && last && span >= 7
        ? Math.round((((last.weight_kg - first.weight_kg) / span) * 7) * 10) / 10
        : null
    const scale =
      moved === null
        ? ''
        : `${
            moved === 0
              ? ' The scale held flat'
              : ` The scale is ${moved < 0 ? 'down' : 'up'} ${Math.abs(moved)} kg/week`
          }${rate === null || rate === undefined ? '' : ` against a phase target of ${rate} kg/week`}.`
    program = {
      label: 'Program',
      value: on ? 'On the program' : gap < 0 ? `${Math.abs(gap)} kcal under` : `${gap} kcal over`,
      detail: `${programName(input.phase, input.targets)}. ${bands} Logged days were aimed at ${kcal(programMean)} and averaged ${kcal(intake)}. ${inside} of ${logged.length} landed inside that day's band.${scale}`,
      tone: on ? 'pos' : gap < 0 ? 'warn' : 'neg',
    }
  }

  const withProteinTarget = logged.filter((d) => d.protein_target !== null)
  const proteinTarget =
    withProteinTarget.length === 0
      ? null
      : Math.round(
          withProteinTarget.reduce((n, d) => n + (d.protein_target ?? 0), 0) / withProteinTarget.length,
        )
  const hits = withProteinTarget.filter((d) => d.protein_g >= (d.protein_target ?? 0)).length

  let protein: ReportLine
  if (proteinTarget === null) {
    protein = {
      label: 'Protein',
      value: `${avg.proteinG} g`,
      detail: 'Per logged day. No protein target on these days.',
      tone: 'primary',
    }
  } else {
    const met = avg.proteinG >= proteinTarget
    const relation = avg.proteinG > proteinTarget ? 'Above the target.' : met ? 'At the target.' : 'Short of the target.'
    protein = {
      label: 'Protein',
      value: `${avg.proteinG} / ${proteinTarget} g`,
      detail: `Per logged day, over ${window.weeks} finished week${window.weeks === 1 ? '' : 's'}. ${hits} of ${withProteinTarget.length} days hit it. ${relation}`,
      tone: met ? 'pos' : 'warn',
    }
  }

  return [tdeeLine, program, activity, protein]
}
