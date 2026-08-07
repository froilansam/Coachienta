import 'server-only'
import { db } from '@/lib/db/client'
import type { LibraryCounts, LibraryFilter } from '@/lib/domain/food/library'
import { normalizeFoodName } from '@/lib/domain/food/normalizeName'
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

/**
 * A food the user typed in themselves.
 *
 * ## Why not `upsertFood`
 *
 * That upserts on `(name_norm, brand)`. A user typing a name that normalises onto an
 * existing row would therefore **silently overwrite that food's macros** — including a
 * row with 187 logs behind it — with no version bump and no audit trail. Creating and
 * correcting are different operations and must not share a code path that quietly
 * converts one into the other.
 *
 * So: a plain insert. On a unique violation the existing row is returned instead, and
 * `existed` says which happened. The caller selects that row into the basket, which is
 * what the user wanted anyway — they were reaching for a food, and it turned out to
 * already be there.
 *
 * Recorded as `source: 'manual'` and `confidence: 'user_verified'`. Both enum values
 * already existed and were unused; `trustOf` renders that pair as VERIFIED / "You
 * checked these numbers yourself", which is exactly true here. `citations` stays empty
 * because `SourceList` already says "entered by hand" for an empty array — inventing a
 * citation would be strictly worse than having none.
 */
export interface CreatedFood {
  food: FoodRow
  existed: boolean
}

export async function createManualFood(
  name: string,
  brand: string | null,
  rate: MacroRate,
): Promise<CreatedFood> {
  const trimmed = name.trim()
  const row = {
    name: trimmed,
    // `name_norm` is NOT NULL with no default — it is what search and the uniqueness
    // constraint both key on, so it must be derived here exactly as `upsertFood` does.
    name_norm: normalizeFoodName(trimmed),
    brand: brand?.trim() || null,
    basis_unit: rate.basis_unit,
    basis_amount: rate.basis_amount,
    kcal: rate.kcal,
    protein_g: rate.protein_g,
    carbs_g: rate.carbs_g,
    fat_g: rate.fat_g,
    fiber_g: rate.fiber_g,
    confidence: 'user_verified' as const,
    source: 'manual' as const,
    citations: [],
  }

  const { data, error } = await db.from('foods').insert(row).select('*').maybeSingle()

  if (error) {
    // 23505 — unique violation on (name_norm, brand). Not a failure: the food exists.
    if (error.code !== '23505') throw new Error(`createManualFood: ${error.message}`)

    /**
     * Match the brand in JS rather than in the query. `(name_norm, brand)` is unique
     * with a NULLable brand, and expressing "brand is null" and "brand = x" as one
     * PostgREST filter is the kind of cleverness that silently matches the wrong row.
     */
    const { data: candidates } = await db
      .from('foods')
      .select('*')
      .eq('name_norm', normalizeFoodName(row.name))

    const existing = (candidates ?? []).find(
      (f) => ((f as { brand: string | null }).brand ?? null) === row.brand,
    )
    if (!existing) throw new Error('That food already exists, but could not be read back.')
    return { food: existing as FoodRow, existed: true }
  }

  if (!data) throw new Error('createManualFood: insert returned no row')
  return { food: data as FoodRow, existed: false }
}
