import 'server-only'
import { db } from '@/lib/db/client'
import type { History } from '@/lib/domain/train/progression'
import type { PriorSet } from '@/lib/domain/train/detectPr'

/**
 * The day plan: templates, per-gym history, and opening a session.
 */
export interface TemplateRow {
  id: string
  name: string
  day_label: string | null
  items: Array<{
    position: number
    exercise_id: string
    target_sets: number | null
    target_rep_low: number | null
    target_rep_high: number | null
    progression_rule: string | null
  }>
}

export interface GymRow {
  id: string
  name: string
  is_current: boolean
}

export async function listGyms(): Promise<GymRow[]> {
  const { data, error } = await db.from('gyms').select('id, name, is_current').order('name')
  if (error) throw new Error(`listGyms: ${error.message}`)
  return (data ?? []) as GymRow[]
}

export async function listTemplates(): Promise<TemplateRow[]> {
  const { data, error } = await db
    .from('workout_plans')
    .select(
      'id, name, day_label, plan_exercises(position, exercise_id, target_sets, target_rep_low, target_rep_high, progression_rule)',
    )
    .eq('is_template', true)
    .order('name')
  if (error) throw new Error(`listTemplates: ${error.message}`)

  return (data ?? []).map((p) => ({
    id: p.id as string,
    name: p.name as string,
    day_label: (p.day_label as string | null) ?? null,
    items: ((p.plan_exercises ?? []) as TemplateRow['items'])
      .slice()
      .sort((a, b) => a.position - b.position),
  }))
}

/** Keyed by exercise id, so the plan can look up each row's LAST and BEST. */
export async function historyByExercise(gymId: string): Promise<Record<string, History>> {
  const { data, error } = await db.rpc('exercise_history', { p_gym: gymId })
  if (error) throw new Error(`exercise_history: ${error.message}`)

  const out: Record<string, History> = {}
  for (const r of (data ?? []) as Array<History & { exercise_id: string }>) {
    const { exercise_id, ...rest } = r
    out[exercise_id] = {
      ...rest,
      last_weight_kg: rest.last_weight_kg === null ? null : Number(rest.last_weight_kg),
      best_weight_kg: rest.best_weight_kg === null ? null : Number(rest.best_weight_kg),
    }
  }
  return out
}

export interface StartSessionInput {
  session_id: string
  name: string
  performed_on: string
  gym_id: string
  items: Array<{ exercise_id: string; target_sets: number; rep_low: number | null; rep_high: number | null }>
}

export interface SessionView {
  id: string
  name: string
  performed_on: string
  gym_id: string | null
  gym_name: string | null
  /** Null for sessions imported from the spreadsheet — render a dash, not 0. */
  started_at: string | null
  completed_at: string | null
  items: Array<{
    exercise_id: string
    name: string
    /** The whole row, so the session screen knows which inputs to render. */
    exercise: ExerciseLite | null
    target_sets: number | null
    target_rep_low: number | null
    target_rep_high: number | null
  }>
}

/** Just enough of an exercise for the live session to render its inputs. */
export interface ExerciseLite {
  id: string
  name: string
  muscle_group: string
  movement_pattern: string
  load_type: string
  is_unilateral: boolean
  equipment: string | null
}

/** The started session and the plan it copied, for the run sheet. */
export async function getSession(id: string): Promise<SessionView | null> {
  const { data, error } = await db
    .from('workout_sessions')
    .select('id, name, performed_on, gym_id, started_at, completed_at, gyms(name), workout_plans(plan_exercises(position, exercise_id, target_sets, target_rep_low, target_rep_high, exercises(id, name, muscle_group, movement_pattern, load_type, is_unilateral, equipment)))')
    .eq('id', id)
    .maybeSingle()
  if (error) throw new Error(`getSession: ${error.message}`)
  if (!data) return null

  type Row = {
    position: number
    exercise_id: string
    target_sets: number | null
    target_rep_low: number | null
    target_rep_high: number | null
    exercises: ExerciseLite | ExerciseLite[] | null
  }
  /**
   * PostgREST hands back an embedded relation as an ARRAY even when it is to-one,
   * so both `gyms` and `workout_plans` have to be unwrapped rather than cast.
   */
  const one = <T,>(v: T | T[] | null): T | null => (Array.isArray(v) ? (v[0] ?? null) : v)

  const plan = one(data.workout_plans as { plan_exercises?: Row[] } | { plan_exercises?: Row[] }[] | null)
  const rows = (plan?.plan_exercises ?? []).slice().sort((a, b) => a.position - b.position)

  return {
    id: data.id as string,
    name: data.name as string,
    performed_on: data.performed_on as string,
    gym_id: (data.gym_id as string | null) ?? null,
    started_at: (data.started_at as string | null) ?? null,
    completed_at: (data.completed_at as string | null) ?? null,
    gym_name: one(data.gyms as { name: string } | { name: string }[] | null)?.name ?? null,
    items: rows.map((r) => ({
      exercise_id: r.exercise_id,
      name: one(r.exercises)?.name ?? 'Unknown exercise',
      exercise: one(r.exercises),
      target_sets: r.target_sets,
      target_rep_low: r.target_rep_low,
      target_rep_high: r.target_rep_high,
    })),
  }
}

export interface LoggedSet {
  id: string
  exercise_id: string
  position: number
  set_index: number
  kind: string
  weight_kg: number | null
  reps: number | null
  duration_sec: number | null
  side: string | null
  is_pr: boolean
  pr_kinds: string[]
  volume_kg: number | null
}

/** Everything already logged against a session. */
export async function getSessionSets(sessionId: string): Promise<LoggedSet[]> {
  const { data, error } = await db.rpc('session_sets', { p_session_id: sessionId })
  if (error) throw new Error(`session_sets: ${error.message}`)
  const num = (v: unknown) => (v === null || v === undefined ? null : Number(v))
  return ((data ?? []) as LoggedSet[]).map((r) => ({
    ...r,
    weight_kg: num(r.weight_kg),
    volume_kg: num(r.volume_kg),
  }))
}

/**
 * Prior working sets at this gym, grouped by exercise — the evidence PR detection
 * compares against. Sent with the session so the verdict can be computed on the
 * client at commit time with no round trip (§4.3).
 */
export async function priorSetsByExercise(
  gymId: string,
  excludeSessionId: string,
): Promise<Record<string, PriorSet[]>> {
  const { data, error } = await db.rpc('prior_sets', {
    p_gym: gymId,
    p_before_session: excludeSessionId,
  })
  if (error) throw new Error(`prior_sets: ${error.message}`)

  const out: Record<string, PriorSet[]> = {}
  for (const r of (data ?? []) as Array<PriorSet & { exercise_id: string }>) {
    const list = out[r.exercise_id] ?? (out[r.exercise_id] = [])
    list.push({
      performed_on: r.performed_on,
      weight_kg: r.weight_kg === null ? null : Number(r.weight_kg),
      reps: r.reps,
      duration_sec: r.duration_sec,
    })
  }
  return out
}

export async function finishSession(sessionId: string): Promise<void> {
  const { error } = await db.rpc('finish_session', { p_session_id: sessionId })
  if (error) throw new Error(error.message)
}

/** Plan rows and the session row in one transaction — see the RPC for why. */
export async function startSession(input: StartSessionInput): Promise<{ id: string }> {
  const { data, error } = await db.rpc('create_session_from_plan', {
    p_session_id: input.session_id,
    p_name: input.name,
    p_performed_on: input.performed_on,
    p_gym_id: input.gym_id,
    p_exercise_ids: input.items.map((i) => i.exercise_id),
    p_target_sets: input.items.map((i) => i.target_sets),
    p_rep_low: input.items.map((i) => i.rep_low),
    p_rep_high: input.items.map((i) => i.rep_high),
  })
  if (error) throw new Error(error.message)
  return data as { id: string }
}

/**
 * Mid-session exercise editing (AC-2.23). Both hit an RPC so `position` can never be
 * left with a gap — see `0021_session_edits.sql`.
 */
export async function addSessionExercise(
  sessionId: string,
  exerciseId: string,
  sets: number,
  repLow: number | null,
  repHigh: number | null,
): Promise<number> {
  const { data, error } = await db.rpc('session_add_exercise', {
    p_session: sessionId,
    p_exercise: exerciseId,
    p_sets: sets,
    p_rep_low: repLow,
    p_rep_high: repHigh,
  })
  if (error) throw new Error(`session_add_exercise: ${error.message}`)
  return Number(data)
}

export async function removeSessionExercise(sessionId: string, position: number): Promise<void> {
  const { error } = await db.rpc('session_remove_exercise', {
    p_session: sessionId,
    p_position: position,
  })
  if (error) throw new Error(`session_remove_exercise: ${error.message}`)
}

export interface SessionSummaryRow {
  id: string
  performed_on: string
  name: string | null
  gym_name: string | null
  /** Null for every session imported from the spreadsheet — render a dash, not 0. */
  started_at: string | null
  completed_at: string | null
  set_count: number
  volume_kg: number
  pr_count: number
}

/** Sessions newest-first, for the Train home list (AC-2.21). */
export async function listSessions(limit = 60): Promise<SessionSummaryRow[]> {
  const { data, error } = await db.rpc('session_list', { p_limit: limit })
  if (error) throw new Error(`session_list: ${error.message}`)
  const num = (v: unknown) => (v === null || v === undefined ? 0 : Number(v))
  return ((data ?? []) as SessionSummaryRow[]).map((r) => ({
    ...r,
    set_count: num(r.set_count),
    volume_kg: num(r.volume_kg),
    pr_count: num(r.pr_count),
  }))
}
