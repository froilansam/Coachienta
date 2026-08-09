import 'server-only'
import { db } from '@/lib/db/client'
import type { DayEntry, NutritionTargets } from '@/lib/domain/food/dayView'

/**
 * Everything a day needs, in three queries.
 *
 * Targets come from `nutrition_targets` — never a constant. Changing that row
 * changes the screen with no code change (AC-1.8), which is the direct fix for the
 * spreadsheet's hardcoded 2,500 on a day whose real target was 2,350.
 *
 * **Which row, though, depends on the date being viewed.** Once past days are
 * browsable, reading `effective_to is null` would judge August's entries against
 * whatever target is current when you happen to look — so a phase change would
 * silently rewrite how every earlier day scored. The row whose validity window
 * contains `date` is the only honest answer, and it is the same row for today.
 *
 * A date before the earliest `effective_from` returns null targets. The screen
 * says so rather than inventing a comparison (AC-1.29).
 */
export interface DayPayload {
  date: string
  entries: DayEntry[]
  targets: NutritionTargets | null
  isGymDay: boolean
}

export async function getDay(date: string): Promise<DayPayload> {
  const [entriesRes, targetsRes, sessionRes] = await Promise.all([
    db
      .from('food_log_entries')
      .select('id, meal, food_name, amount, unit, kcal, protein_g, carbs_g, fat_g, confidence, logged_at, resolved_by, food_version, notes')
      .eq('logged_on', date)
      .order('logged_at', { ascending: true }),
    db
      .from('nutrition_targets')
      .select('*')
      .lte('effective_from', date)
      .or(`effective_to.is.null,effective_to.gte.${date}`)
      .order('effective_from', { ascending: false })
      .limit(1)
      .maybeSingle(),
    db
      .from('workout_sessions')
      .select('id', { count: 'exact', head: true })
      .eq('performed_on', date),
  ])

  if (entriesRes.error) throw new Error(`getDay entries: ${entriesRes.error.message}`)

  const entries: DayEntry[] = (entriesRes.data ?? []).map((r) => ({
    id: r.id as string,
    meal: r.meal as string | null,
    foodName: r.food_name as string,
    amount: Number(r.amount),
    unit: r.unit as string,
    kcal: Number(r.kcal),
    proteinG: Number(r.protein_g),
    carbsG: Number(r.carbs_g),
    fatG: Number(r.fat_g),
    confidence: r.confidence as DayEntry['confidence'],
    loggedAt: r.logged_at as string | null,
    resolvedBy: (r.resolved_by as DayEntry['resolvedBy']) ?? null,
    foodVersion: (r.food_version as number | null) ?? null,
    notes: (r.notes as string | null) ?? null,
  }))

  const t = targetsRes.data
  const targets: NutritionTargets | null = t
    ? {
        kcalGymLow: t.kcal_gym_low, kcalGymHigh: t.kcal_gym_high,
        kcalRestLow: t.kcal_rest_low, kcalRestHigh: t.kcal_rest_high,
        proteinG: t.protein_g,
        carbsGymLow: t.carbs_gym_low, carbsRestLow: t.carbs_rest_low,
        fatHigh: t.fat_high,
        phaseLabel: t.phase_label,
      }
    : null

  return { date, entries, targets, isGymDay: (sessionRes.count ?? 0) > 0 }
}
