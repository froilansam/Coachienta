'use client'
import { useCallback, useEffect, useRef, useState } from 'react'
import { ResolveResponse } from '@/lib/schemas/food'
import type { FoodRow } from '@/lib/schemas/food'

/**
 * Owns everything about finding a food: debounce, the fetch, offline handling,
 * and the recent-foods default list.
 *
 * The 350 ms debounce is not cosmetic — Open Food Facts allows 10 searches a
 * minute and warns against search-as-you-type. Library hits are instant anyway;
 * only the external tiers pay the delay (PRD-003 §3.1a).
 */
const DEBOUNCE_MS = 350

/**
 * Everything one lookup produced, held as a single value.
 *
 * These six fields always arrive together from one response and are always
 * cleared together, so six `useState`s only created six chances to update five
 * of them.
 */
interface Resolution {
  results: FoodRow[]
  stage: ResolveResponse['stage']
  parsedAmount: number | null
  segments: string[] | null
  notice: string | null
  rejected: string | null
  /** The request never completed. Distinct from completing with no results. */
  failed: boolean
}

const NOTHING: Resolution = {
  results: [],
  stage: 'none',
  parsedAmount: null,
  segments: null,
  notice: null,
  rejected: null,
  failed: false,
}

export interface FoodResolveState {
  query: string
  setQuery: (v: string) => void
  results: FoodRow[]
  /** Which tier answered — drives the "did you mean" vs "found it" framing. */
  stage: ResolveResponse['stage']
  /** Amount parsed out of the query, e.g. 200 from "200g rice". */
  parsedAmount: number | null
  /** Several foods in one input; the caller resolves each (AC-1.10). */
  segments: string[] | null
  isSearching: boolean
  notice: string | null
  rejected: string | null
  /**
   * Set when the lookup itself failed, as opposed to succeeding and finding
   * nothing. AC-1.3 requires a *visible* failure with a retry — "NO MATCH" for a
   * dead network is a lie, because the food may well exist.
   */
  failed: boolean
  retry: () => void
  reset: () => void
}

export function useFoodResolve(): FoodResolveState {
  const [query, setQueryState] = useState('')
  const [res, setRes] = useState<Resolution>(NOTHING)
  const [isSearching, setIsSearching] = useState(false)

  // Discard responses from superseded queries — typing fast must not flash an
  // older result set over a newer one.
  const seq = useRef(0)

  const loadRecent = useCallback(async () => {
    const mine = ++seq.current
    const res = await fetch('/api/data/resolve-food')
    if (!res.ok || mine !== seq.current) return
    const json = (await res.json()) as { results: unknown }
    const parsed = ResolveResponse.shape.results.safeParse(json.results)
    if (parsed.success && mine === seq.current) {
      setRes({ ...NOTHING, results: parsed.data, stage: 'library' })
    }
  }, [])

  const search = useCallback(async (raw: string) => {
    const mine = ++seq.current
    setIsSearching(true)
    try {
      const response = await fetch('/api/data/resolve-food', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ input: raw, libraryOnly: !navigator.onLine }),
      })
      if (mine !== seq.current) return
      if (!response.ok) {
        // Keep whatever is on screen — the library half of the cascade is local
        // and still valid — but say plainly that the lookup did not happen.
        setRes((prev) => ({
          ...prev,
          failed: true,
          notice: 'Lookup failed. Your library still works.',
        }))
        return
      }
      const parsed = ResolveResponse.safeParse(await response.json())
      if (!parsed.success || mine !== seq.current) {
        if (mine === seq.current) setRes((prev) => ({ ...prev, failed: true }))
        return
      }

      const d = parsed.data
      setRes({
        results: d.results,
        stage: d.stage,
        parsedAmount: d.parsed.amount,
        segments: d.segments ?? null,
        notice: d.notice ?? null,
        rejected: d.rejected ?? null,
        failed: false,
      })
    } catch {
      // A thrown fetch (offline, DNS, aborted) is the same class of event as a
      // non-ok response: the question was never answered.
      if (mine === seq.current) {
        setRes((prev) => ({ ...prev, failed: true, notice: 'Could not reach the lookup.' }))
      }
    } finally {
      if (mine === seq.current) setIsSearching(false)
    }
  }, [])

  /**
   * Clearing the box is an event, not a synchronisation, so it happens here in
   * the setter rather than in the effect below. The effect is then only ever
   * about the debounce timer.
   */
  const setQuery = useCallback(
    (v: string) => {
      setQueryState(v)
      if (v.trim() === '') {
        setRes(NOTHING)
        void loadRecent()
      }
    },
    [loadRecent],
  )

  // Mount: show what you log most, before you type anything.
  useEffect(() => {
    void loadRecent()
  }, [loadRecent])

  useEffect(() => {
    const q = query.trim()
    if (!q) return
    const t = setTimeout(() => void search(q), DEBOUNCE_MS)
    return () => clearTimeout(t)
  }, [query, search])

  /** Re-runs the current query. Bypasses the debounce — the user just asked. */
  const retry = useCallback(() => {
    const q = query.trim()
    if (q) void search(q)
    else void loadRecent()
  }, [query, search, loadRecent])

  const reset = useCallback(() => {
    setQueryState('')
    setRes(NOTHING)
    void loadRecent()
  }, [loadRecent])

  return {
    query,
    setQuery,
    results: res.results,
    stage: res.stage,
    failed: res.failed,
    retry,
    parsedAmount: res.parsedAmount,
    segments: res.segments,
    isSearching,
    notice: res.notice,
    rejected: res.rejected,
    reset,
  }
}
