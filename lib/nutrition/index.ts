import 'server-only'
import { validateMacroRate } from '@/lib/domain/macros'
import { normalizeFoodName } from '@/lib/domain/food/normalizeName'
import { isRelevant } from '@/lib/domain/food/relevance'
import { openFoodFacts } from './openFoodFacts'
import { usda } from './usda'
import type { FoodCandidate } from './types'

export { usda, openFoodFacts }
export type { FoodCandidate, NutritionSource } from './types'

/** Branded/packaged items resolve better from OFF; generics from USDA. */
const looksBranded = (q: string) =>
  /[぀-ヿ一-龯]/.test(q) || /®|™|\d{3,}/.test(q)

/**
 * Steps 6–7 of the resolution cascade (PRD-003 §3). The local library (steps
 * 1–5) and the LLM fallback (step 8) are handled by the caller — this module
 * only knows about external structured databases.
 *
 * Both sources are queried in parallel: they're independent, and the slower one
 * costs nothing extra.
 */
export async function searchExternal(query: string, limit = 5): Promise<FoodCandidate[]> {
  const settled = await Promise.allSettled([
    usda.search(query, limit),
    openFoodFacts.search(query, limit),
  ])

  /**
   * Surface rejections. A persistent client bug is indistinguishable from "no
   * results" once allSettled swallows it — Open Food Facts silently returned
   * nothing for days because `brands` can be an array and `.split()` threw.
   */
  settled.forEach((r, i) => {
    if (r.status === 'rejected') {
      console.error(`[nutrition] ${i === 0 ? 'usda' : 'openfoodfacts'} failed:`, r.reason)
    }
  })

  const [usdaHits, offHits] = settled.map((r) => (r.status === 'fulfilled' ? r.value : []))

  // Anything failing the Atwater check is downgraded, not discarded — the user
  // can still accept it, but it is visibly marked.
  const ordered = (looksBranded(query) ? [...offHits!, ...usdaHits!] : [...usdaHits!, ...offHits!])
    // Both APIs answer loosely. Without this gate a coconut-milk beverage
    // "answered" a chicken adobo query and stopped the cascade before the LLM.
    .filter((c) => isRelevant(query, c.name))

  // Collapse duplicates across sources. They share a (name_norm, brand) key, so
  // upsert would merge them anyway — offering both just looks like a bug.
  const seen = new Set<string>()
  const deduped = ordered.filter((c) => {
    const key = `${normalizeFoodName(c.name)}|${c.brand ?? ''}`
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })

  // Failing the Atwater check downgrades rather than discards — the user can
  // still accept it, but it is visibly marked UNVERIFIED.
  return deduped
    .map((c) => (validateMacroRate(c.rate).ok ? c : { ...c, confidence: 'low' as const }))
    .slice(0, limit)
}
