import 'server-only'
import { db } from '@/lib/db/client'
import type { LibraryCounts, LibraryFilter } from '@/lib/domain/food/library'
import type { MacroRate } from '@/lib/schemas/domain'
import type { FoodRow } from './foods'

/**
 * Library management. Every write is an RPC — see `0010_food_library.sql` for why
 * (atomicity, and `version = version + 1` is an expression supabase-js cannot
 * send).
 */

export async function listLibrary(
  query: string,
  filter: LibraryFilter,
  limit = 200,
): Promise<FoodRow[]> {
  const { data, error } = await db.rpc('library_foods', {
    p_query: query,
    p_filter: filter,
    p_limit: limit,
  })
  if (error) throw new Error(`library_foods: ${error.message}`)
  return (data ?? []) as FoodRow[]
}

export async function libraryCounts(): Promise<LibraryCounts> {
  const { data, error } = await db.rpc('library_counts')
  if (error) throw new Error(`library_counts: ${error.message}`)
  // A `returns table` function comes back as a one-row array.
  const row = (data as Array<Record<string, number>> | null)?.[0]
  return {
    all: row?.all_count ?? 0,
    checking: row?.checking_count ?? 0,
    unlogged: row?.unlogged_count ?? 0,
    label: row?.label_count ?? 0,
  }
}

/**
 * A correction. Bumps `version`, marks the row `user_verified`, and leaves every
 * existing `food_log_entries` row alone — history never moves (AC-1.6).
 */
export async function correctFood(
  id: string,
  name: string,
  brand: string | null,
  rate: MacroRate,
): Promise<FoodRow> {
  const { data, error } = await db.rpc('update_food_macros', {
    p_id: id,
    p_name: name,
    p_brand: brand,
    p_basis_unit: rate.basis_unit,
    p_basis_amount: rate.basis_amount,
    p_kcal: rate.kcal,
    p_protein_g: rate.protein_g,
    p_carbs_g: rate.carbs_g,
    p_fat_g: rate.fat_g,
    p_fiber_g: rate.fiber_g,
  })
  if (error) throw new Error(`update_food_macros: ${error.message}`)
  return data as FoodRow
}

/** Returns how many rows went, so the UI can say it rather than guess. */
export async function pruneUnlogged(): Promise<number> {
  const { data, error } = await db.rpc('prune_unlogged_foods')
  if (error) throw new Error(`prune_unlogged_foods: ${error.message}`)
  return (data as number | null) ?? 0
}

export async function mergeFoods(survivorId: string, loserId: string): Promise<FoodRow> {
  const { data, error } = await db.rpc('merge_foods', {
    p_survivor: survivorId,
    p_loser: loserId,
  })
  if (error) throw new Error(`merge_foods: ${error.message}`)
  return data as FoodRow
}

/**
 * Deletes only if no log entry points at the row. Returns false when something
 * does, so the caller can offer merge instead of reporting a fault.
 *
 * The guard is referential, NOT `times_logged = 0`. Gating on the counter refused
 * 221 of 282 foods that nothing referenced, because the counter carries imported
 * history (migration 0011).
 */
export async function deleteFoodIfUnreferenced(id: string): Promise<boolean> {
  const { data, error } = await db.rpc('delete_food_if_unreferenced', { p_id: id })
  if (error) throw new Error(`delete_food_if_unreferenced: ${error.message}`)
  return data === true
}
