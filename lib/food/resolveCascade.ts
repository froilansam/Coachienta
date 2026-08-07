import 'server-only'
import { resolveFoodWithAi } from '@/lib/ai/resolveFood'
import { searchLibrary, upsertFood, type FoodRow } from '@/lib/db/queries/foods'
import { validateMacroRate } from '@/lib/domain/macros'
import { isRelevant } from '@/lib/domain/food/relevance'
import { searchExternal } from '@/lib/nutrition'
import type { FoodCandidate } from '@/lib/nutrition/types'
import type { Confidence } from '@/lib/schemas/domain'

/**
 * The resolution cascade as a function, so the text route and the photo route
 * share one implementation rather than two that drift.
 *
 *   library (exact/alias/partial, or fuzzy with full token overlap)
 *   → USDA + Open Food Facts
 *   → LLM estimate
 */
export type ResolveStage = 'library' | 'external' | 'ai' | 'none'

export interface CascadeResult {
  stage: ResolveStage
  results: FoodRow[]
  /** Fuzzy library hits that were not confident enough to stop the cascade. */
  suggestions: FoodRow[]
  degraded?: boolean
}

/** Grades an external/AI candidate before storage — never trusted as given. */
export function grade(c: FoodCandidate): FoodCandidate {
  const { ok, flags } = validateMacroRate(c.rate)
  if (ok) return c
  return {
    ...c,
    // Individually-plausible numbers that do not add up. Downgraded and shown
    // as UNVERIFIED rather than silently stored (AC-1.5).
    confidence: 'low' as Confidence,
    citation: {
      ...c.citation,
      detail: [c.citation.detail, `flags: ${flags.join(', ')}`].filter(Boolean).join(' · '),
    },
  }
}

/** Keeps the first (best-ranked) occurrence of each id. */
export const dedupeById = (rows: FoodRow[]): FoodRow[] => {
  const seen = new Set<string>()
  return rows.filter((r) => (seen.has(r.id) ? false : (seen.add(r.id), true)))
}

export interface CascadeOptions {
  limit?: number
  /** Skip external lookup — offline, or quota exhausted. */
  libraryOnly?: boolean
  /** Skip the LLM tier. Used by the photo flow, which already spent a vision call. */
  skipAi?: boolean
}

export async function resolveCascade(
  query: string,
  { limit = 8, libraryOnly = false, skipAi = false }: CascadeOptions = {},
): Promise<CascadeResult> {
  const fromLibrary = await searchLibrary(query, limit)

  /**
   * A fuzzy hit whose tokens all match IS confident — word order differs, the
   * food does not. Without this, "raw broccoli" never matched the cached
   * "Broccoli, raw" and re-hit USDA on every repeat.
   */
  const confident = fromLibrary.filter((r) => r.match_kind !== 'fuzzy' || isRelevant(query, r.name))
  const suggestions = fromLibrary.filter((r) => !confident.includes(r))

  if (confident.length > 0) return { stage: 'library', results: confident, suggestions: [] }
  if (libraryOnly) {
    return { stage: suggestions.length ? 'library' : 'none', results: suggestions, suggestions: [] }
  }

  const external = await searchExternal(query, limit)
  if (external.length > 0) {
    const rows = await Promise.all(external.map((c) => upsertFood(grade(c))))
    // A cached external food can appear in both lists, so dedupe by id.
    return { stage: 'external', results: dedupeById([...rows, ...suggestions]), suggestions: [] }
  }

  if (suggestions.length > 0) return { stage: 'library', results: suggestions, suggestions: [] }
  if (skipAi) return { stage: 'none', results: [], suggestions: [] }

  const ai = await resolveFoodWithAi(query)
  if (!ai.candidate) return { stage: 'none', results: [], suggestions: [], degraded: true }

  return {
    stage: 'ai',
    results: [await upsertFood(grade(ai.candidate))],
    suggestions: [],
    degraded: ai.degraded,
  }
}
