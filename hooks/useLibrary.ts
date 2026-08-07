'use client'
import { useCallback, useEffect, useState } from 'react'
import type { LibraryListResponse } from '@/app/api/data/library/route'
import {
  type LibraryCounts,
  type LibraryFilter,
  mergeBlocker,
  rateOf,
} from '@/lib/domain/food/library'
import type { MacroRate } from '@/lib/schemas/domain'
import type { FoodRow } from '@/lib/schemas/food'

/**
 * The food library screen, whole. Search, filter, correct, prune, merge.
 *
 * Reads go straight to the server rather than through the Dexie mirror: this is a
 * maintenance screen, it is never on the logging critical path, and showing a
 * stale library while deleting rows from it would be worse than showing nothing.
 */
const DEBOUNCE_MS = 250

/** What the editor is working on, and what it has become. */
export interface FoodEdit {
  food: FoodRow
  name: string
  brand: string
  rate: MacroRate
}

export interface LibraryView {
  /** Re-reads the list. Needed so a newly created food appears without a reload. */
  refresh: () => void
  query: string
  setQuery: (v: string) => void
  filter: LibraryFilter
  setFilter: (f: LibraryFilter) => void
  foods: FoodRow[]
  counts: LibraryCounts
  isLoading: boolean
  isBusy: boolean
  notice: string | null

  /** Non-null while a row is open in the editor. */
  edit: FoodEdit | null
  open: (food: FoodRow) => void
  close: () => void
  setName: (v: string) => void
  setBrand: (v: string) => void
  setRate: (patch: Partial<MacroRate>) => void
  save: () => Promise<void>

  /** True once MERGE is tapped — the sheet swaps from editor to picker. */
  mergePicking: boolean
  startMerge: () => void
  /** Non-null once the other food has been chosen. */
  mergeWith: FoodRow | null
  /** The picker searches independently — the list behind the sheet must not move. */
  mergeQuery: string
  setMergeQuery: (v: string) => void
  mergeCandidates: FoodRow[]
  pickMerge: (candidate: FoodRow | null) => void
  mergeError: string | null
  /** `survivor` is which of the two keeps its identity. */
  survivorId: string | null
  setSurvivorId: (id: string) => void
  confirmMerge: () => Promise<void>

  prune: () => Promise<void>
  remove: (food: FoodRow) => Promise<void>
}

export function useLibrary(): LibraryView {
  const [query, setQuery] = useState('')
  const [filter, setFilter] = useState<LibraryFilter>('all')
  const [foods, setFoods] = useState<FoodRow[]>([])
  const [counts, setCounts] = useState<LibraryCounts>({
    all: 0,
    checking: 0,
    unlogged: 0,
    label: 0,
  })
  const [isLoading, setIsLoading] = useState(true)
  const [isBusy, setIsBusy] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)

  const [edit, setEdit] = useState<FoodEdit | null>(null)
  const [mergePicking, setMergePicking] = useState(false)
  const [mergeWith, setMergeWith] = useState<FoodRow | null>(null)
  const [mergeQuery, setMergeQuery] = useState('')
  const [mergeCandidates, setMergeCandidates] = useState<FoodRow[]>([])
  const [survivorId, setSurvivorId] = useState<string | null>(null)

  const load = useCallback(async (q: string, f: LibraryFilter) => {
    setIsLoading(true)
    try {
      const res = await fetch(`/api/data/library?q=${encodeURIComponent(q)}&filter=${f}`)
      if (!res.ok) throw new Error(`${res.status}`)
      const data = (await res.json()) as LibraryListResponse
      setFoods(data.foods)
      setCounts(data.counts)
      setNotice(null)
    } catch {
      setNotice('Could not load your library.')
    } finally {
      setIsLoading(false)
    }
  }, [])

  // One effect, one job: keep the list in step with the query and filter.
  useEffect(() => {
    const t = setTimeout(() => void load(query.trim(), filter), DEBOUNCE_MS)
    return () => clearTimeout(t)
  }, [query, filter, load])

  const refresh = useCallback(() => load(query.trim(), filter), [load, query, filter])

  /**
   * Merge candidates, searched separately from the main list so opening the
   * picker never disturbs what is behind the sheet. The row being merged is
   * filtered out — offering to merge a food into itself is noise.
   */
  const mergeTargetId = edit?.food.id
  useEffect(() => {
    if (!mergePicking || mergeTargetId === undefined) return
    const t = setTimeout(async () => {
      const res = await fetch(
        `/api/data/library?filter=all&q=${encodeURIComponent(mergeQuery.trim())}`,
      )
      if (!res.ok) return
      const data = (await res.json()) as LibraryListResponse
      setMergeCandidates(data.foods.filter((f) => f.id !== mergeTargetId).slice(0, 20))
    }, DEBOUNCE_MS)
    return () => clearTimeout(t)
  }, [mergePicking, mergeQuery, mergeTargetId])

  // -- editing --------------------------------------------------------------

  const open = useCallback((food: FoodRow) => {
    setEdit({ food, name: food.name, brand: food.brand ?? '', rate: rateOf(food) })
    setMergePicking(false)
    setMergeWith(null)
    setMergeQuery('')
    setSurvivorId(null)
  }, [])

  /**
   * Seeds the search with this food's own name, because near-duplicates share
   * most of it — `Sunny side up egg` surfaces `Sunny side up eggs` immediately.
   */
  const startMerge = useCallback(() => {
    setMergePicking(true)
    setMergeQuery(edit?.food.name ?? '')
  }, [edit])

  const close = useCallback(() => {
    setEdit(null)
    setMergePicking(false)
    setMergeWith(null)
    setMergeQuery('')
    setMergeCandidates([])
    setSurvivorId(null)
  }, [])

  const setName = useCallback((v: string) => {
    setEdit((e) => (e ? { ...e, name: v } : e))
  }, [])

  const setBrand = useCallback((v: string) => {
    setEdit((e) => (e ? { ...e, brand: v } : e))
  }, [])

  const setRate = useCallback((patch: Partial<MacroRate>) => {
    setEdit((e) => (e ? { ...e, rate: { ...e.rate, ...patch } } : e))
  }, [])

  /** Wraps a write so every one of them reports the same way. */
  const run = useCallback(
    async (fn: () => Promise<string>) => {
      setIsBusy(true)
      try {
        const message = await fn()
        await refresh()
        setNotice(message)
      } catch (err) {
        setNotice(err instanceof Error ? err.message : 'That did not work.')
      } finally {
        setIsBusy(false)
      }
    },
    [refresh],
  )

  const save = useCallback(async () => {
    if (!edit) return
    await run(async () => {
      const res = await fetch('/api/data/library', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: edit.food.id,
          name: edit.name.trim(),
          brand: edit.brand.trim() === '' ? null : edit.brand.trim(),
          rate: edit.rate,
        }),
      })
      if (!res.ok) throw new Error('Could not save that correction.')
      close()
      return `${edit.name.trim()} is now verified. Past entries are unchanged.`
    })
  }, [edit, run, close])

  // -- merging --------------------------------------------------------------

  const pickMerge = useCallback(
    (candidate: FoodRow | null) => {
      setMergeWith(candidate)
      // Default to keeping the more-logged row: it is the name the user has
      // actually been using, so its aliases and history already point the right
      // way. Still explicit in the UI — this is a destructive choice.
      if (candidate && edit) {
        setSurvivorId(
          candidate.times_logged > edit.food.times_logged ? candidate.id : edit.food.id,
        )
      }
    },
    [edit],
  )

  const mergeError =
    edit && mergeWith
      ? mergeBlocker(
          survivorId === mergeWith.id ? mergeWith : edit.food,
          survivorId === mergeWith.id ? edit.food : mergeWith,
        )
      : null

  const confirmMerge = useCallback(async () => {
    if (!edit || !mergeWith || !survivorId || mergeError) return
    const loser = survivorId === mergeWith.id ? edit.food : mergeWith
    const survivor = survivorId === mergeWith.id ? mergeWith : edit.food
    await run(async () => {
      const res = await fetch('/api/data/library', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'merge', survivorId: survivor.id, loserId: loser.id }),
      })
      const body = (await res.json()) as { food?: FoodRow; error?: string }
      if (!res.ok) throw new Error(body.error ?? 'Merge failed.')
      close()
      const moved = loser.times_logged
      return moved > 0
        ? `Merged into ${survivor.name} — ${moved} ${moved === 1 ? 'entry' : 'entries'} moved.`
        : `Merged into ${survivor.name}.`
    })
  }, [edit, mergeWith, survivorId, mergeError, run, close])

  // -- pruning --------------------------------------------------------------

  const prune = useCallback(async () => {
    await run(async () => {
      const res = await fetch('/api/data/library', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'prune' }),
      })
      if (!res.ok) throw new Error('Could not clear those.')
      const { deleted } = (await res.json()) as { deleted: number }
      return `Removed ${deleted} food${deleted === 1 ? '' : 's'} you had never eaten.`
    })
  }, [run])

  const remove = useCallback(
    async (food: FoodRow) => {
      await run(async () => {
        const res = await fetch('/api/data/library', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'delete', id: food.id }),
        })
        if (!res.ok) {
          // The server repeats the referential check, so its refusal is the
          // authoritative one — show it rather than a generic failure.
          const body = (await res.json().catch(() => null)) as { error?: string } | null
          throw new Error(body?.error ?? 'Could not delete that.')
        }
        close()
        return `Deleted ${food.name}.`
      })
    },
    [run, close],
  )

  return {
    refresh,
    query,
    setQuery,
    filter,
    setFilter,
    foods,
    counts,
    isLoading,
    isBusy,
    notice,
    edit,
    open,
    close,
    setName,
    setBrand,
    setRate,
    save,
    mergePicking,
    startMerge,
    mergeWith,
    mergeQuery,
    setMergeQuery,
    mergeCandidates,
    pickMerge,
    mergeError,
    survivorId,
    setSurvivorId,
    confirmMerge,
    prune,
    remove,
  }
}
