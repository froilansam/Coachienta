import { z } from 'zod'

/**
 * Single source of truth for domain vocabulary. These mirror the Postgres enums
 * in supabase/migrations 1:1 — change both together or the insert fails, which
 * is the point (PRD-001 §3.1).
 */

export const UnitBasis = z.enum(['g', 'ml', 'piece', 'serving'])

export const MuscleGroup = z.enum([
  'chest', 'back_lats', 'back_mid',
  'shoulders_side', 'shoulders_front', 'shoulders_rear',
  'biceps', 'triceps', 'quads', 'hamstrings', 'glutes', 'calves',
  'abs_core', 'forearms', 'other',
])

export const MovementPattern = z.enum([
  'horizontal_push', 'vertical_push', 'horizontal_pull', 'vertical_pull',
  'hinge', 'squat', 'lunge', 'carry', 'isolation', 'core', 'other',
])

/** Determines which metrics are meaningful. The volume-distortion fix (PRD-004 §3.1). */
export const LoadType = z.enum(['external_weight', 'bodyweight', 'assisted', 'duration', 'distance'])

export const SetKind = z.enum(['warmup', 'ramp', 'working', 'top', 'backoff', 'dropset', 'rest_pause'])

export const Confidence = z.enum(['high', 'medium', 'low', 'user_verified'])

export const ResolutionSource = z.enum(['library', 'usda', 'openfoodfacts', 'ai_estimate', 'photo', 'manual'])

export const RuleCategory = z.enum([
  'persona', 'output_format', 'nutrition', 'training', 'exercise_order',
  'planning', 'progression', 'logging', 'phase', 'safety', 'interaction',
])

export const DocKind = z.enum([
  'day_nutrition', 'workout_session', 'body_trend', 'profile', 'coach_rule', 'note',
])

export type UnitBasis = z.infer<typeof UnitBasis>
export type MuscleGroup = z.infer<typeof MuscleGroup>
export type MovementPattern = z.infer<typeof MovementPattern>
export type LoadType = z.infer<typeof LoadType>
export type SetKind = z.infer<typeof SetKind>
export type Confidence = z.infer<typeof Confidence>
export type ResolutionSource = z.infer<typeof ResolutionSource>
export type RuleCategory = z.infer<typeof RuleCategory>
export type DocKind = z.infer<typeof DocKind>

/** Volume is only meaningful for these. Everything else stores null. */
export const VOLUME_ELIGIBLE: readonly LoadType[] = ['external_weight', 'bodyweight']

/** Macro rate per basis amount — never a per-entry total (PRD-000 Principle 2). */
export const MacroRate = z.object({
  basis_unit: UnitBasis,
  basis_amount: z.number().positive(),
  kcal: z.number().min(0),
  protein_g: z.number().min(0),
  carbs_g: z.number().min(0),
  fat_g: z.number().min(0),
  fiber_g: z.number().min(0).nullable().default(null),
})
export type MacroRate = z.infer<typeof MacroRate>

export const Macros = z.object({
  kcal: z.number().min(0),
  protein_g: z.number().min(0),
  carbs_g: z.number().min(0),
  fat_g: z.number().min(0),
})
export type Macros = z.infer<typeof Macros>
