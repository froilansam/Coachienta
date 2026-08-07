/**
 * Relevance gate for external database results.
 *
 * USDA and Open Food Facts both return loosely-related rows for a multi-word
 * query, and any single result would stop the cascade before the LLM. Verified:
 * "lola's chicken adobo with coconut milk" returned USDA's
 * "Beverages, coconut milk, sweetened" — real token overlap, wrong food.
 *
 * So a candidate must share enough of the query's SIGNIFICANT tokens to count.
 */

/**
 * Words that carry no discriminating power in a food name.
 *
 * `raw`, `cooked`, `fresh`, `whole` and `plain` are deliberately NOT here: in a
 * food name they are the whole point. Treating "raw" as noise made
 * "raw broccoli" match "Broccoli (cooked)" at 1.0 and rank it above the actual
 * raw entry — a 39 vs 35 kcal difference and a different food.
 */
const STOP = new Set([
  'a', 'an', 'the', 'of', 'with', 'and', 'in', 'on', 'for',
  'my', 'his', 'her', 'style', 'homemade',
])

export function significantTokens(s: string): string[] {
  return s
    .toLowerCase()
    .normalize('NFKC')
    // Keep latin word chars and CJK; drop punctuation and possessives.
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .split(/\s+/)
    .filter((t) => t.length > 2 && !STOP.has(t))
}

/**
 * Fraction of the query's significant tokens present in the candidate name.
 * 1.0 = every meaningful word matched.
 */
export function tokenOverlap(query: string, candidateName: string): number {
  const q = significantTokens(query)
  if (q.length === 0) return 1
  const c = new Set(significantTokens(candidateName))
  // Substring match so "broccoli" hits "broccoli," and plurals mostly work.
  const hits = q.filter((t) => c.has(t) || [...c].some((x) => x.includes(t) || t.includes(x)))
  return hits.length / q.length
}

/**
 * 0.6 threshold, chosen against real results:
 *   "raw broccoli"                → "Broccoli, raw"                 1.00  keep
 *   "cooked quinoa"               → "Quinoa, cooked"                1.00  keep
 *   "chicken adobo coconut milk"  → "Beverages, coconut milk…"      0.50  drop
 */
export const MIN_OVERLAP = 0.6

export const isRelevant = (query: string, candidateName: string): boolean =>
  tokenOverlap(query, candidateName) >= MIN_OVERLAP
