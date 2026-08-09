'use client'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useLiveQuery } from 'dexie-react-hooks'
import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  groupByMeal, macroRows, pctOf, remainingTerms, sumEntries,
  type DayEntry, type MacroRow, type MealGroup, type NutritionTargets,
} from '@/lib/domain/food/dayView'
import { addDays, longDayLabel, relativeDayLabel, todayLocal } from '@/lib/domain/date'
import { local } from '@/lib/offline/db'
import { SYNCED_EVENT, enqueue } from '@/lib/offline/sync'
import type { Macros } from '@/lib/schemas/domain'

interface DayPayload {
  date: string
  entries: DayEntry[]
  targets: NutritionTargets | null
  isGymDay: boolean
}

/**
 * The whole Today screen as one flat view model.
 *
 * Server rows and still-unsynced local rows are merged, so a food logged with no
 * signal appears immediately rather than after the next upload
 * (PRD-000 Principle 5).
 */
export interface TodayView {
  date: string
  setDate: (d: string) => void
  isLoading: boolean
  hasTargets: boolean
  phaseLabel: string | null
  isGymDay: boolean

  totals: Macros
  kcal: MacroRow | null
  macros: MacroRow[]
  equation: Array<{ label: string; value: number; operator?: '−' | '=' }>
  pct: number

  mealGroups: MealGroup[]
  entryCount: number

  remove: (id: string) => Promise<void>
  refresh: () => void

  // -- which day is on screen ----------------------------------------------
  /** `TODAY`, `YESTERDAY`, or `05 AUG · WED`. */
  dayLabel: string
  /** `Thursday 6 August`, for the screen heading. */
  longLabel: string
  isToday: boolean
  /** False on today — you cannot have eaten tomorrow. */
  canGoForward: boolean

  /**
   * Set when the day could not be loaded at all. Distinct from "no entries" on
   * purpose: an empty day and an unreachable server look identical otherwise, and
   * the user cannot act on the difference they cannot see.
   */
  loadError: 'locked' | 'unreachable' | null
  retry: () => void
  stepDay: (delta: number) => void
  goToDay: (iso: string) => void
  goToToday: () => void
}

export function useToday(): TodayView {
  const [date, setDate] = useState(() => todayLocal())
  /**
   * Captured once per render rather than per call, so the label, the forward
   * guard and the TODAY jump all agree even if the clock crosses midnight
   * mid-session.
   */
  const today = todayLocal()
  const qc = useQueryClient()

  const { data, isLoading, error, refetch } = useQuery<DayPayload>({
    queryKey: ['day', date],
    queryFn: async () => {
      const res = await fetch(`/api/data/day?date=${date}`)
      /**
       * 404 means the access cookie is missing or stale — the proxy returns it
       * deliberately so anonymous callers learn nothing (`proxy.ts`). It must be
       * named, not swallowed: a silent failure here renders as an empty day, which
       * is exactly what made a dropped cookie on the phone look like a database
       * outage.
       */
      if (res.status === 404) throw new Error('LOCKED')
      if (!res.ok) throw new Error('UNREACHABLE')
      return res.json() as Promise<DayPayload>
    },
  })

  /** Rows still queued in IndexedDB — shown so an offline log is visible at once. */
  const pendingRows = useLiveQuery(
    () => local.rows.where('[table+day]').equals(['food_log_entries', date]).toArray(),
    [date],
    [],
  )

  /**
   * Deletions that have not reached the server yet.
   *
   * Without this the row reappears: `remove()` refetches immediately, the delete
   * is still sitting in the queue, and the server happily returns the row again.
   * It also makes deleting work with no signal at all.
   */
  const pendingDeleteIds = useLiveQuery(
    async () => {
      const queued = await local.queue.where('state').notEqual('synced').toArray()
      return new Set(queued.filter((m) => m.op === 'delete').map((m) => m.id))
    },
    [],
    new Set<string>(),
  )

  const entries = useMemo<DayEntry[]>(() => {
    const server = (data?.entries ?? []).filter((e) => !pendingDeleteIds?.has(e.id))
    const serverIds = new Set(server.map((e) => e.id))

    const localOnly: DayEntry[] = (pendingRows ?? [])
      .filter((r) => r.state !== 'synced' && !serverIds.has(r.id))
      .map((r) => {
        const d = r.data as { food_name?: string; kcal?: number }
        return {
          id: r.id,
          meal: null,
          foodName: d.food_name ?? 'Pending entry',
          amount: 0,
          unit: 'g',
          kcal: d.kcal ?? 0,
          proteinG: 0,
          carbsG: 0,
          fatG: 0,
          confidence: 'medium' as const,
          loggedAt: null,
          // A queued row has no provenance yet — it has not been resolved server-side.
          resolvedBy: null,
          foodVersion: null,
          notes: null,
          pending: true,
        }
      })

    return [...server, ...localOnly]
  }, [data?.entries, pendingRows, pendingDeleteIds])

  const totals = useMemo(() => sumEntries(entries), [entries])
  const targets = data?.targets ?? null
  const isGymDay = data?.isGymDay ?? false

  const graded = useMemo(
    () => (targets ? macroRows(totals, targets, isGymDay) : null),
    [totals, targets, isGymDay],
  )

  /** Refetch once a write actually lands, closing the delete/refetch race. */
  useEffect(() => {
    const onSynced = () => void qc.invalidateQueries({ queryKey: ['day', date] })
    window.addEventListener(SYNCED_EVENT, onSynced)
    return () => window.removeEventListener(SYNCED_EVENT, onSynced)
  }, [qc, date])

  const remove = useCallback(
    async (id: string) => {
      await enqueue({ id, table: 'food_log_entries', op: 'delete', payload: {} })
      await local.rows.delete(id)
      await qc.invalidateQueries({ queryKey: ['day', date] })
    },
    [qc, date],
  )

  return {
    date,
    setDate,
    isLoading,
    hasTargets: targets !== null,
    phaseLabel: targets?.phaseLabel ?? null,
    isGymDay,
    totals,
    kcal: graded?.kcal ?? null,
    macros: graded?.rows ?? [],
    equation: graded ? remainingTerms(totals.kcal, graded.kcal.target) : [],
    pct: graded ? pctOf(totals.kcal, graded.kcal.target) : 0,
    mealGroups: useMemo(() => groupByMeal(entries), [entries]),
    entryCount: entries.length,
    remove,
    refresh: () => void qc.invalidateQueries({ queryKey: ['day', date] }),

    loadError: error ? (error.message === 'LOCKED' ? 'locked' : 'unreachable') : null,
    retry: () => void refetch(),

    dayLabel: relativeDayLabel(date, today),
    longLabel: longDayLabel(date),
    isToday: date === today,
    canGoForward: date < today,
    stepDay: (delta: number) => setDate((d) => addDays(d, delta)),
    goToDay: setDate,
    goToToday: () => setDate(today),
  }
}
