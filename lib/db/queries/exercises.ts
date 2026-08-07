import 'server-only'
import { db } from '@/lib/db/client'
import type { Exercise, ExerciseDraft } from '@/lib/domain/train/exercise'

/**
 * The exercise library. See `0016_exercise_library.sql` — the list comes from an
 * RPC because every row carries its `set_count`, and the editor cannot warn about
 * reinterpreting logged sets without knowing how many there are.
 */
export async function listExercises(includeInactive = false): Promise<Exercise[]> {
  const { data, error } = await db.rpc('exercise_library', {
    p_include_inactive: includeInactive,
  })
  if (error) throw new Error(`exercise_library: ${error.message}`)
  return (data ?? []) as Exercise[]
}

export async function updateExercise(id: string, d: ExerciseDraft): Promise<void> {
  const { error } = await db.rpc('update_exercise', {
    p_id: id,
    p_name: d.name,
    p_muscle_group: d.muscle_group,
    p_movement_pattern: d.movement_pattern,
    p_load_type: d.load_type,
    p_is_unilateral: d.is_unilateral,
    p_equipment: d.equipment,
  })
  if (error) throw new Error(error.message)
}

export async function addExercise(d: ExerciseDraft): Promise<void> {
  const { error } = await db.rpc('add_exercise', {
    p_name: d.name,
    p_muscle_group: d.muscle_group,
    p_movement_pattern: d.movement_pattern,
    p_load_type: d.load_type,
    p_is_unilateral: d.is_unilateral,
    p_equipment: d.equipment,
  })
  if (error) throw new Error(error.message)
}

/** Retire rather than delete: history that references it must stay readable. */
export async function setExerciseActive(id: string, active: boolean): Promise<void> {
  const { error } = await db.rpc('set_exercise_active', { p_id: id, p_active: active })
  if (error) throw new Error(error.message)
}
