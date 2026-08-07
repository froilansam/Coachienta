import 'server-only'
import { db } from '@/lib/db/client'
import type { FoodCandidate } from '@/lib/nutrition/types'
import { normalizeFoodName } from '@/lib/domain/food/normalizeName'
import type { Confidence, ResolutionSource, UnitBasis } from '@/lib/schemas/domain'

/** Shape returned by the `search_foods` SQL function. */
export interface FoodRow {
  id: string
  name: string
  brand: string | null
  basis_unit: UnitBasis
  basis_amount: number
  kcal: number
  protein_g: number
  carbs_g: number
  fat_g: number
  fiber_g: number | null
  confidence: Confidence
  source: ResolutionSource
  version: number
  times_logged: number
  usual_amount: number | null
  match_kind?: string
  score?: number
  /**
   * How many `food_log_entries` actually point at this row. Only `library_foods`
   * returns it. Deletion is gated on THIS, never on `times_logged` — that is a
   * lifetime usage counter seeded from imported history and is not a reference
   * count (migration 0011).
   */
  entry_count?: number
  /** Provenance, straight from the `citations` jsonb column (AC-1.3). */
  citations?: Array<{ ref: string; url: string | null; detail: string | null }>
}

/** Steps 2-4 of the cascade, one round trip (PRD-003 §3). */
export async function searchLibrary(query: string, limit = 8): Promise<FoodRow[]> {
  const { data, error } = await db.rpc('search_foods', { p_query: query, p_limit: limit })
  if (error) throw new Error(`search_foods: ${error.message}`)
  return (data ?? []) as FoodRow[]
}

/** The default list with an empty search box — the two-tap path (AC-1.1). */
export async function recentFoods(limit = 8): Promise<FoodRow[]> {
  const { data, error } = await db.rpc('recent_foods', { p_limit: limit })
  if (error) throw new Error(`recent_foods: ${error.message}`)
  return (data ?? []) as FoodRow[]
}

/**
 * Persist a resolved candidate so the next lookup is free (PRD-000 Principle 3).
 *
 * `onConflict` on (name_norm, brand) makes this idempotent — resolving the same
 * food twice must never create a second row (AC-1.4). Requires the
 * `nulls not distinct` index from migration 0002.
 */
export async function upsertFood(c: FoodCandidate): Promise<FoodRow> {
  const { data, error } = await db
    .from('foods')
    .upsert(
      {
        name: c.name,
        name_norm: normalizeFoodName(c.name),
        brand: c.brand,
        basis_unit: c.rate.basis_unit,
        basis_amount: c.rate.basis_amount,
        kcal: c.rate.kcal,
        protein_g: c.rate.protein_g,
        carbs_g: c.rate.carbs_g,
        fat_g: c.rate.fat_g,
        fiber_g: c.rate.fiber_g,
        confidence: c.confidence,
        source: c.source,
        citations: [c.citation],
      },
      { onConflict: 'name_norm,brand', ignoreDuplicates: false },
    )
    .select()
    .single()

  if (error) throw new Error(`upsertFood: ${error.message}`)
  return data as FoodRow
}

/** Called after a successful log so `recent_foods` stays ordered by real use. */
export async function bumpFoodUsage(id: string, amount: number | null): Promise<void> {
  await db.rpc('bump_food_usage', { p_id: id, p_amount: amount })
}

/** The mirror image, for a deleted entry. Floors at zero — see migration 0011. */
export async function unbumpFoodUsage(id: string): Promise<void> {
  await db.rpc('unbump_food_usage', { p_id: id })
}
