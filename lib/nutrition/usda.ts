import 'server-only'
import { env } from '@/lib/env'
import { normalizeFoodName } from '@/lib/domain/food/normalizeName'
import type { FoodCandidate, NutritionSource } from './types'

const BASE = 'https://api.nal.usda.gov/fdc/v1/foods/search'

/**
 * Preference order, applied CLIENT-SIDE.
 *
 * ⚠️ Do NOT send `dataType` as a query param. `URLSearchParams` percent-encodes
 * the commas and parentheses ("Survey (FNDDS)" → "Survey+%28FNDDS%29") and
 * USDA's parser rejects the whole parameter, returning **zero results** rather
 * than an error. Verified: with any dataType filter → 0 foods; without → 2.
 * That silently disabled USDA lookup entirely.
 */
const RANK: Record<string, number> = {
  Foundation: 0, // lab-analysed, best for generic ingredients
  'SR Legacy': 1,
  'Survey (FNDDS)': 2, // good for prepared foods
  Branded: 3, // Open Food Facts covers branded better
}

const NUTRIENT_MAP = {
  Energy: 'kcal',
  Protein: 'protein_g',
  'Carbohydrate, by difference': 'carbs_g',
  'Total lipid (fat)': 'fat_g',
  'Fiber, total dietary': 'fiber_g',
} as const

type UsdaNutrient = { nutrientName?: string; value?: number; unitName?: string }
type UsdaFood = {
  fdcId?: number
  description?: string
  brandOwner?: string
  dataType?: string
  foodNutrients?: UsdaNutrient[]
}

function toCandidate(f: UsdaFood, fallbackName: string): FoodCandidate | null {
  const macros: Partial<Record<string, number>> = {}
  for (const n of f.foodNutrients ?? []) {
    const key = NUTRIENT_MAP[n.nutrientName as keyof typeof NUTRIENT_MAP]
    if (!key || n.value === undefined) continue
    // Energy appears in both KCAL and KJ; take only KCAL.
    if (key === 'kcal' && n.unitName?.toUpperCase() !== 'KCAL') continue
    macros[key] = n.value
  }

  // Incomplete record → not a result. Fall through to the next source.
  const required = ['kcal', 'protein_g', 'carbs_g', 'fat_g'] as const
  if (required.some((k) => macros[k] === undefined)) return null

  return {
    name: f.description ?? fallbackName,
    brand: f.brandOwner ?? null,
    rate: {
      basis_unit: 'g',
      basis_amount: 100, // USDA search values are always per 100 g
      kcal: macros.kcal!,
      protein_g: macros.protein_g!,
      carbs_g: macros.carbs_g!,
      fat_g: macros.fat_g!,
      fiber_g: macros.fiber_g ?? null,
    },
    confidence: 'high',
    source: 'usda',
    citation: {
      ref: String(f.fdcId ?? ''),
      url: f.fdcId ? `https://fdc.nal.usda.gov/food-details/${f.fdcId}` : null,
      detail: f.dataType ?? null,
    },
  }
}

export const usda: NutritionSource = {
  name: 'usda',

  async search(query, limit = 5): Promise<FoodCandidate[]> {
    const url = new URL(BASE)
    url.searchParams.set('query', query)
    // Over-fetch so client-side ranking and de-duplication have material to work
    // with — USDA returns the same description several times across dataTypes.
    url.searchParams.set('pageSize', String(Math.min(limit * 5, 50)))
    url.searchParams.set('api_key', env.USDA_FDC_API_KEY)

    const res = await fetch(url, { signal: AbortSignal.timeout(6000) })
    if (!res.ok) return []

    const json = (await res.json()) as { foods?: UsdaFood[] }
    const foods = json.foods ?? []

    // Best dataType wins per distinct name; three "Broccoli, raw" rows with
    // different energy values would otherwise all be offered and all collapse
    // onto one row at upsert time anyway.
    const best = new Map<string, { food: UsdaFood; rank: number }>()
    for (const f of foods) {
      if (!f.description) continue
      const key = normalizeFoodName(f.description)
      const rank = RANK[f.dataType ?? ''] ?? 9
      const prev = best.get(key)
      if (!prev || rank < prev.rank) best.set(key, { food: f, rank })
    }

    return [...best.values()]
      .sort((a, b) => a.rank - b.rank)
      .flatMap(({ food }) => {
        const c = toCandidate(food, query)
        return c ? [c] : []
      })
      .slice(0, limit)
  },
}
