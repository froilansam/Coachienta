'use client'
import { useCallback, useMemo, useState } from 'react'
import {
  buildDraftItem,
  defaultAmount,
  mealForHour,
  sumMacros,
  todayLocal,
  toDayEntry,
  toLogEntry,
  type DraftItem,
} from '@/lib/domain/food/draft'
import { enqueue } from '@/lib/offline/sync'
import type { FoodRow } from '@/lib/schemas/food'
import type { Macros } from '@/lib/schemas/domain'

/**
 * Owns the basket: what is being logged, when, and committing it.
 *
 * Commit goes through `enqueue()` — Dexie first, upload later — so logging works
 * with no signal and never blocks on the network (PRD-000 Principle 5, AC-1.1).
 */
export interface LogDraft {
  /** Food currently being portioned, before it joins the basket. */
  pending: DraftItem | null
  items: DraftItem[]
  totals: Macros
  loggedOn: string
  meal: string
  isCommitting: boolean

  select: (food: FoodRow, amount?: number) => void
  setPendingAmount: (amount: number | null) => void
  confirmPending: () => void
  cancelPending: () => void
  /** Adds a resolved food straight to the basket, skipping the portion editor.
   *  Used by the photo flow, where several items are confirmed at once. */
  addResolved: (food: FoodRow, amount: number) => void
  remove: (id: string) => void
  setLoggedOn: (day: string) => void
  setMeal: (meal: string) => void
  commit: () => Promise<number>
}

/**
 * `day` seeds the date chip. Passed by the Today screen so logging while looking
 * at a past day lands on that day — the alternative is entries silently going to
 * today, which is the spreadsheet's mis-dating problem in a new form.
 */
export function useLogDraft(onCommitted?: () => void, day?: string): LogDraft {
  const [pending, setPending] = useState<DraftItem | null>(null)
  const [items, setItems] = useState<DraftItem[]>([])
  const [loggedOn, setLoggedOn] = useState(() => day ?? todayLocal())
  const [lastDay, setLastDay] = useState(day)
  const [meal, setMeal] = useState(() => mealForHour(new Date().getHours()))
  const [isCommitting, setIsCommitting] = useState(false)

  /**
   * Follow the screen when it changes day.
   *
   * The initialiser alone is not enough: this hook mounts with the Today screen
   * and lives across every open of the sheet, so a `day` captured at mount would
   * still say "today" after navigating to yesterday. Adjusted during render
   * rather than in an effect — the documented pattern, and it avoids one frame
   * showing the wrong date. Safe to overwrite `loggedOn` because the sheet covers
   * the screen: the user cannot change day while it is open.
   */
  if (day !== undefined && day !== lastDay) {
    setLastDay(day)
    setLoggedOn(day)
  }

  const totals = useMemo(() => sumMacros(items), [items])

  /** Tapping a result opens the portion editor prefilled with your usual amount. */
  const select = useCallback((food: FoodRow, amount?: number) => {
    setPending(buildDraftItem(food, amount ?? defaultAmount(food), crypto.randomUUID()))
  }, [])

  const setPendingAmount = useCallback((amount: number | null) => {
    setPending((p) => (p && amount !== null && amount > 0 ? buildDraftItem(p.food, amount, p.id) : p))
  }, [])

  /**
   * Two separate updates, deliberately.
   *
   * Calling `setItems` from inside a `setPending` updater is a side effect in a
   * place React requires to be pure — StrictMode invokes updaters twice in dev,
   * so the item was appended twice with the same id and React reported duplicate
   * keys. Production hid it, which is exactly what StrictMode is for.
   */
  const confirmPending = useCallback(() => {
    if (!pending) return
    setItems((prev) => [...prev, pending])
    setPending(null)
  }, [pending])

  const cancelPending = useCallback(() => setPending(null), [])

  const addResolved = useCallback((food: FoodRow, amount: number) => {
    setItems((prev) => [...prev, buildDraftItem(food, amount, crypto.randomUUID())])
  }, [])

  const remove = useCallback((id: string) => {
    setItems((prev) => prev.filter((i) => i.id !== id))
  }, [])

  /** Returns how many entries were written, so the caller can toast it. */
  const commit = useCallback(async (): Promise<number> => {
    if (items.length === 0) return 0
    setIsCommitting(true)
    try {
      for (const item of items) {
        await enqueue(
          {
            id: item.id,
            table: 'food_log_entries',
            op: 'insert',
            payload: toLogEntry(item, loggedOn, meal),
          },
          { day: loggedOn, data: toDayEntry(item, meal, new Date().toISOString()) },
        )
      }
      const n = items.length
      setItems([])
      onCommitted?.()
      return n
    } finally {
      setIsCommitting(false)
    }
  }, [items, loggedOn, meal, onCommitted])

  return {
    pending, items, totals, loggedOn, meal, isCommitting,
    select, setPendingAmount, confirmPending, cancelPending, addResolved, remove,
    setLoggedOn, setMeal, commit,
  }
}
