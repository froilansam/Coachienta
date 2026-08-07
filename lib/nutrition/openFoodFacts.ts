import 'server-only'
import type { FoodCandidate, NutritionSource } from './types'

/** Mandatory. Requests without an identifying User-Agent are blocked. */
const UA = 'Coachienta/0.1 (froye@example.com)'

/**
 * ⚠️ Full-text search lives on the separate Search-a-licious service.
 * `world.openfoodfacts.org/api/v2/search?q=` accepts `q`, returns HTTP 200, and
 * **silently ignores it** — every query comes back with the entire 4.6M-row
 * database. Verified 2026-08-06 (PRD-003 §3.1a).
 */
const SEARCH = 'https://search.openfoodfacts.org/search'
const PRODUCT = 'https://world.openfoodfacts.org/api/v2/product'

type Nutriments = Record<string, number | string | undefined>
type OffProduct = {
  code?: string
  product_name?: string
  /** OFF returns this as a comma-joined string OR an array, inconsistently. */
  brands?: string | string[]
  nutriments?: Nutriments
}

const num = (v: unknown): number | null =>
  typeof v === 'number' && Number.isFinite(v) ? v : null

/** `brands` arrives as a string on some products and an array on others. */
const firstBrand = (b: OffProduct['brands']): string | null => {
  const raw = Array.isArray(b) ? b[0] : b?.split(',')[0]
  return raw?.trim() || null
}

/** OFF is crowd-sourced; partial records are common and must be rejected outright. */
function toCandidate(p: OffProduct): FoodCandidate | null {
  const n = p.nutriments ?? {}
  const kcal = num(n['energy-kcal_100g'])
  const protein = num(n.proteins_100g)
  const carbs = num(n.carbohydrates_100g)
  const fat = num(n.fat_100g)
  const name = p.product_name?.trim()

  if (!name || kcal === null || protein === null || carbs === null || fat === null) return null

  return {
    name,
    brand: firstBrand(p.brands),
    rate: {
      basis_unit: 'g',
      basis_amount: 100,
      kcal, protein_g: protein, carbs_g: carbs, fat_g: fat,
      fiber_g: num(n.fiber_100g),
    },
    confidence: 'high',
    source: 'openfoodfacts',
    citation: {
      ref: p.code ?? '',
      url: p.code ? `https://world.openfoodfacts.org/product/${p.code}` : null,
      detail: 'Open Food Facts',
    },
  }
}

const FIELDS = 'code,product_name,brands,nutriments'

export const openFoodFacts: NutritionSource & {
  byBarcode(code: string): Promise<FoodCandidate | null>
} = {
  name: 'openfoodfacts',

  async search(query, limit = 5): Promise<FoodCandidate[]> {
    const url = new URL(SEARCH)
    url.searchParams.set('q', query)
    url.searchParams.set('page_size', String(limit))
    url.searchParams.set('fields', FIELDS)

    const res = await fetch(url, {
      headers: { 'User-Agent': UA },
      signal: AbortSignal.timeout(6000),
    })
    // 429 (10/min) and transient 503s are expected — fall through, never retry here.
    if (!res.ok) return []

    const json = (await res.json()) as { hits?: OffProduct[] }
    return (json.hits ?? []).map(toCandidate).filter((c): c is FoodCandidate => c !== null)
  },

  async byBarcode(code: string): Promise<FoodCandidate | null> {
    const res = await fetch(`${PRODUCT}/${encodeURIComponent(code)}?fields=${FIELDS}`, {
      headers: { 'User-Agent': UA },
      signal: AbortSignal.timeout(6000),
    })
    if (!res.ok) return null
    const json = (await res.json()) as { product?: OffProduct }
    return json.product ? toCandidate(json.product) : null
  },
}
