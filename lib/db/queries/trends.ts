import 'server-only'
import { db } from '@/lib/db/client'
import {
  nutritionAverages,
  nutritionSummary,
  type NutritionAverages,
  type NutritionBucket,
} from '@/lib/db/queries/coach'
import { addDays, todayLocal } from '@/lib/domain/date'
import type { ConfidenceCounts } from '@/lib/domain/food/trends'

/**
 * Training + nutrition trends. Every figure is computed on read — there are no
 * stored snapshots, which is what stopped the spreadsheet's Next Session Targets
 * tab going 57 days stale (§3.4). Nutrition reuses the coach RPCs so a chart and
 * a coaching answer cannot disagree (PRD-003 §5.3).
 */
export interface MuscleWeek {
  week_start: string
  muscle_group: string
  volume_kg: number
  set_count: number
}
export interface TotalWeek {
  week_start: string
  volume_kg: number
  set_count: number
}
export interface PrRow {
  performed_on: string
  exercise_name: string
  muscle_group: string
  pr_kinds: string[]
  /** `all_time` (best of any set) or `set` (best at this position). */
  pr_scope: string
  /** The position it was judged at — rank among that day's working sets. */
  set_ordinal: number
  weight_kg: number | null
  reps: number | null
}
export interface TopSet {
  exercise_id: string
  exercise_name: string
  muscle_group: string
  load_type: string
  gym_id: string | null
  gym_name: string | null
  performed_on: string
  weight_kg: number | null
  reps: number | null
  duration_sec: number | null
}
export interface SessionSummary {
  id: string
  performed_on: string
  name: string | null
  gym_name: string | null
  started_at: string | null
  completed_at: string | null
  set_count: number
  volume_kg: number
  pr_count: number
}
export interface ShareRow {
  rank: number
  muscle_group: string
  volume_kg: number
  share_pct: number
}

const num = (v: unknown): number => (v === null || v === undefined ? 0 : Number(v))

export async function trainingTrends(gymId: string, days = 84) {
  const [muscle, total, prs, share, tops, sessions] = await Promise.all([
    db.rpc('volume_by_muscle', { p_gym: gymId, p_days: days }),
    db.rpc('volume_total', { p_gym: gymId, p_days: days }),
    db.rpc('pr_timeline', { p_gym: gymId, p_days: 180 }),
    db.rpc('priority_volume_share', { p_days: 30 }),
    // Not gym-scoped: §4.4 wants one LINE per gym, so both gyms' rows are needed.
    db.rpc('strength_progression', { p_days: 180 }),
    db.rpc('session_list', { p_limit: 120 }),
  ])

  for (const r of [muscle, total, prs, share, tops, sessions]) {
    if (r.error) throw new Error(r.error.message)
  }

  return {
    muscle: ((muscle.data ?? []) as MuscleWeek[]).map((r) => ({
      ...r,
      volume_kg: num(r.volume_kg),
      set_count: num(r.set_count),
    })),
    total: ((total.data ?? []) as TotalWeek[]).map((r) => ({
      ...r,
      volume_kg: num(r.volume_kg),
      set_count: num(r.set_count),
    })),
    prs: ((prs.data ?? []) as PrRow[]).map((r) => ({
      ...r,
      set_ordinal: Number(r.set_ordinal),
      weight_kg: r.weight_kg === null ? null : Number(r.weight_kg),
    })),
    tops: ((tops.data ?? []) as TopSet[]).map((r) => ({
      ...r,
      weight_kg: r.weight_kg === null ? null : Number(r.weight_kg),
    })),
    sessions: ((sessions.data ?? []) as SessionSummary[]).map((r) => ({
      ...r,
      volume_kg: num(r.volume_kg),
      set_count: num(r.set_count),
      pr_count: num(r.pr_count),
    })),
    share: ((share.data ?? []) as ShareRow[]).map((r) => ({
      ...r,
      volume_kg: num(r.volume_kg),
      share_pct: num(r.share_pct),
    })),
  }
}

export type TrainingTrends = Awaited<ReturnType<typeof trainingTrends>>

export interface NutritionTrends {
  days: NutritionBucket[]
  averages: NutritionAverages
  confidence: ConfidenceCounts
  start: string
  end: string
}

/** Entry counts by confidence for the data-quality strip. */
async function confidenceCounts(start: string, end: string): Promise<ConfidenceCounts> {
  const { data, error } = await db
    .from('food_log_entries')
    .select('confidence')
    .gte('logged_on', start)
    .lte('logged_on', end)
  if (error) throw new Error(error.message)
  const counts: ConfidenceCounts = { high: 0, medium: 0, low: 0, user_verified: 0 }
  for (const row of data ?? []) {
    const c = row.confidence as keyof ConfidenceCounts
    if (c in counts) counts[c] += 1
  }
  return counts
}

export async function nutritionTrends(days = 84): Promise<NutritionTrends> {
  const end = todayLocal()
  const start = addDays(end, -(Number.isFinite(days) ? days : 84) + 1)
  const [summary, averages, confidence] = await Promise.all([
    nutritionSummary(start, end, 'day'),
    nutritionAverages(start, end),
    confidenceCounts(start, end),
  ])
  return {
    days: summary.buckets,
    averages,
    confidence,
    start,
    end,
  }
}
