import 'server-only'
import { db } from '@/lib/db/client'
import { latestOf, trendOf, type Measurement } from '@/lib/domain/body'

/**
 * The read-only queries behind the coach's tools (PRD-005 §3.2).
 *
 * Every one of these returns an **aggregate plus the row count it aggregated over**.
 * The count is not decoration: it is what lets the model say "across 7 logged days"
 * instead of averaging two days and calling it a week. PRD-005 §3.2 makes it a rule,
 * and the spreadsheet's coach breaking it is the reason the rule exists.
 *
 * Nothing here takes free-form SQL. The model picks a tool and supplies validated
 * parameters; it cannot reach the database any other way (AC-3.12).
 */
const num = (v: unknown): number => (v === null || v === undefined ? 0 : Number(v))
const nullableNum = (v: unknown): number | null =>
  v === null || v === undefined ? null : Number(v)

/** Every tool result carries this, so an empty range is a fact rather than an error. */
export interface Counted {
  row_count: number
}

async function rpc<T>(fn: string, args: Record<string, unknown>): Promise<T[]> {
  const { data, error } = await db.rpc(fn, args)
  if (error) throw new Error(`${fn}: ${error.message}`)
  return (data ?? []) as T[]
}

// ---------------------------------------------------------------------------
// Nutrition
// ---------------------------------------------------------------------------
export interface NutritionAverages extends Counted {
  logged_days: number
  entry_count: number
  kcal_mean: number
  kcal_sd: number
  protein_mean: number
  protein_median: number
  protein_sd: number
  carbs_mean: number
  fat_mean: number
  protein_target: number | null
  days_protein_met: number
  /** Share of entries at `high` confidence — an average of estimates is not measured. */
  verified_pct: number
}

export async function nutritionAverages(start: string, end: string): Promise<NutritionAverages> {
  const [row] = await rpc<Record<string, unknown>>('nutrition_averages', {
    p_start: start,
    p_end: end,
  })
  const logged_days = num(row?.logged_days)
  return {
    row_count: logged_days,
    logged_days,
    entry_count: num(row?.entry_count),
    kcal_mean: num(row?.kcal_mean),
    kcal_sd: num(row?.kcal_sd),
    protein_mean: num(row?.protein_mean),
    protein_median: num(row?.protein_median),
    protein_sd: num(row?.protein_sd),
    carbs_mean: num(row?.carbs_mean),
    fat_mean: num(row?.fat_mean),
    protein_target: nullableNum(row?.protein_target),
    days_protein_met: num(row?.days_protein_met),
    verified_pct: num(row?.verified_pct),
  }
}

export interface NutritionBucket {
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

export async function nutritionSummary(
  start: string,
  end: string,
  groupBy: 'day' | 'week',
): Promise<{ buckets: NutritionBucket[] } & Counted> {
  const rows = await rpc<Record<string, unknown>>('nutrition_summary', {
    p_start: start,
    p_end: end,
    p_group_by: groupBy,
  })
  const buckets = rows.map((r) => ({
    bucket: String(r.bucket),
    is_gym_day: Boolean(r.is_gym_day),
    kcal: num(r.kcal),
    protein_g: num(r.protein_g),
    carbs_g: num(r.carbs_g),
    fat_g: num(r.fat_g),
    entry_count: num(r.entry_count),
    kcal_target_low: nullableNum(r.kcal_target_low),
    kcal_target_high: nullableNum(r.kcal_target_high),
    protein_target: nullableNum(r.protein_target),
  }))
  return { buckets, row_count: buckets.length }
}

export interface FoodFrequencyRow {
  food_name: string
  times_logged: number
  total_kcal: number
  total_protein_g: number
  kcal_share_pct: number
}

export async function foodFrequency(
  start: string,
  end: string,
  limit: number,
): Promise<{ foods: FoodFrequencyRow[] } & Counted> {
  const rows = await rpc<Record<string, unknown>>('food_frequency', {
    p_start: start,
    p_end: end,
    p_limit: limit,
  })
  const foods = rows.map((r) => ({
    food_name: String(r.food_name),
    times_logged: num(r.times_logged),
    total_kcal: num(r.total_kcal),
    total_protein_g: num(r.total_protein_g),
    kcal_share_pct: num(r.kcal_share_pct),
  }))
  return { foods, row_count: foods.length }
}

// ---------------------------------------------------------------------------
// Training
// ---------------------------------------------------------------------------
/**
 * `session_list` is not date-parameterised, so the window is applied here.
 *
 * Deliberately not "fixed" by adding date arguments to the RPC: the same function
 * feeds the Train screen's history list, and a coach-shaped signature there would be
 * two callers pulling one function in two directions.
 */
export async function sessionSummary(
  start: string,
  end: string,
): Promise<{ sessions: Array<Record<string, unknown>>; total_volume_kg: number; total_sets: number } & Counted> {
  const rows = await rpc<Record<string, unknown>>('session_list', { p_limit: 200 })
  const sessions = rows
    .filter((r) => String(r.performed_on) >= start && String(r.performed_on) <= end)
    .map((r) => ({
      performed_on: String(r.performed_on),
      name: r.name ?? null,
      gym: r.gym_name ?? null,
      set_count: num(r.set_count),
      volume_kg: num(r.volume_kg),
      pr_count: num(r.pr_count),
    }))
  return {
    sessions,
    total_volume_kg: sessions.reduce((n, s) => n + num(s.volume_kg), 0),
    total_sets: sessions.reduce((n, s) => n + num(s.set_count), 0),
    row_count: sessions.length,
  }
}

export interface ProgressionPoint {
  performed_on: string
  gym: string | null
  weight_kg: number | null
  reps: number | null
  duration_sec: number | null
  /** Epley, so a heavy triple and a light twelve are comparable. */
  est_1rm: number | null
}

/**
 * Top set per day for one exercise, newest last.
 *
 * Matched loosely by name, in both directions, because that is what the user says:
 * "lateral raise" has to find `Lateral Raises` and "Lateral Raises" has to find it too.
 * A coach that answers "no such exercise" about a real exercise is useless.
 */
export async function exerciseProgression(
  name: string,
  limit: number,
): Promise<{ exercise: string | null; load_type: string | null; points: ProgressionPoint[] } & Counted> {
  const rows = await rpc<Record<string, unknown>>('strength_progression', { p_days: 365 })

  const needle = name.trim().toLowerCase()
  const matches = rows.filter((r) => {
    const n = String(r.exercise_name).toLowerCase()
    return n.includes(needle) || needle.includes(n)
  })
  if (matches.length === 0) return { exercise: null, load_type: null, points: [], row_count: 0 }

  // Several library rows can match a loose phrase; take the one with the most history.
  const byExercise = new Map<string, Record<string, unknown>[]>()
  for (const r of matches) {
    const key = String(r.exercise_id)
    byExercise.set(key, [...(byExercise.get(key) ?? []), r])
  }
  const best = [...byExercise.values()].sort((a, b) => b.length - a.length)[0]!
  const sorted = [...best].sort((a, b) => String(a.performed_on).localeCompare(String(b.performed_on)))
  const points = sorted.slice(-limit).map((r) => {
    const weight = nullableNum(r.weight_kg)
    const reps = nullableNum(r.reps)
    return {
      performed_on: String(r.performed_on),
      gym: (r.gym_name as string | null) ?? null,
      weight_kg: weight,
      reps,
      duration_sec: nullableNum(r.duration_sec),
      est_1rm:
        weight !== null && reps !== null && reps > 0
          ? Math.round(weight * (1 + reps / 30) * 10) / 10
          : null,
    }
  })

  return {
    exercise: String(best[0]!.exercise_name),
    load_type: String(best[0]!.load_type),
    points,
    row_count: points.length,
  }
}

export async function volumeByMuscleGroup(
  gymId: string,
  days: number,
): Promise<{ groups: Array<{ muscle_group: string; volume_kg: number; set_count: number }>; total_volume_kg: number; unattributed_kg: number } & Counted> {
  const [muscle, total] = await Promise.all([
    rpc<Record<string, unknown>>('volume_by_muscle', { p_gym: gymId, p_days: days }),
    rpc<Record<string, unknown>>('volume_total', { p_gym: gymId, p_days: days }),
  ])

  const byGroup = new Map<string, { volume_kg: number; set_count: number }>()
  for (const r of muscle) {
    const key = String(r.muscle_group)
    const found = byGroup.get(key) ?? { volume_kg: 0, set_count: 0 }
    byGroup.set(key, {
      volume_kg: found.volume_kg + num(r.volume_kg),
      set_count: found.set_count + num(r.set_count),
    })
  }
  const groups = [...byGroup.entries()]
    .map(([muscle_group, v]) => ({ muscle_group, ...v }))
    .sort((a, b) => b.volume_kg - a.volume_kg)

  const declared = total.reduce((n, r) => n + num(r.volume_kg), 0)
  const summed = groups.reduce((n, g) => n + g.volume_kg, 0)

  return {
    groups,
    total_volume_kg: Math.round(declared * 10) / 10,
    // Reported even when zero — AC-2.14's rule, and the coach should be able to say
    // the parts add up rather than leaving it implied.
    unattributed_kg: Math.round((declared - summed) * 10) / 10,
    row_count: groups.length,
  }
}

export async function prs(
  gymId: string,
  days: number,
): Promise<{ prs: Array<Record<string, unknown>> } & Counted> {
  const rows = await rpc<Record<string, unknown>>('pr_timeline', { p_gym: gymId, p_days: days })
  const out = rows.map((r) => ({
    performed_on: String(r.performed_on),
    exercise: String(r.exercise_name),
    muscle_group: String(r.muscle_group),
    kinds: (r.pr_kinds as string[]) ?? [],
    weight_kg: nullableNum(r.weight_kg),
    reps: nullableNum(r.reps),
  }))
  return { prs: out, row_count: out.length }
}

export async function priorityAdherence(
  days: number,
): Promise<{ priorities: Array<{ rank: number; muscle_group: string; share_pct: number }> } & Counted> {
  const rows = await rpc<Record<string, unknown>>('priority_volume_share', { p_days: days })
  const priorities = rows.map((r) => ({
    rank: num(r.rank),
    muscle_group: String(r.muscle_group),
    share_pct: num(r.share_pct),
  }))
  return { priorities, row_count: priorities.length }
}

// ---------------------------------------------------------------------------
// Body
// ---------------------------------------------------------------------------
/**
 * Weight / body-fat / waist over a window, with the fitted weekly rate.
 *
 * Reuses `lib/domain/body.ts` rather than re-deriving: `trendOf` already withholds a
 * weekly rate under 7 days of spread instead of extrapolating scale noise, and the
 * coach must not be able to quote a rate the profile screen refuses to show.
 */
export async function bodyTrend(
  start: string,
  end: string,
): Promise<Record<string, unknown> & Counted> {
  const { data, error } = await db
    .from('body_measurements')
    .select('measured_on, weight_kg, waist_cm, body_fat_pct, bmr_kcal, source')
    .gte('measured_on', start)
    .lte('measured_on', end)
    .order('measured_on', { ascending: false })
  if (error) throw new Error(`bodyTrend: ${error.message}`)

  const rows = (data ?? []) as Measurement[]
  const weight = latestOf(rows, 'weight_kg')
  const trend = trendOf(rows, 'weight_kg')

  return {
    row_count: rows.length,
    readings: rows.length,
    latest_weight_kg: weight?.value ?? null,
    latest_weight_on: weight?.on ?? null,
    latest_body_fat_pct: latestOf(rows, 'body_fat_pct')?.value ?? null,
    latest_waist_cm: latestOf(rows, 'waist_cm')?.value ?? null,
    /** Null when the readings span under a week — not zero, and not a guess. */
    weekly_rate_kg: trend?.perWeek ?? null,
  }
}
