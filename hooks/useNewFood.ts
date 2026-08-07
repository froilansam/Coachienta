'use client'
import { useCallback, useState } from 'react'
import type { CreateFoodResponse } from '@/app/api/data/library/route'
import type { FoodRow } from '@/lib/db/queries/foods'
import { canSaveFood } from '@/lib/domain/food/library'
import type { MacroRate } from '@/lib/schemas/domain'

/**
 * Creating a food by hand — the state, shared by the two places it can start from.
 *
 * Reuses `canSaveFood` rather than re-deriving the gate: the library editor already
 * decides what counts as saveable, and two answers to that question would eventually
 * disagree.
 */
export interface NewFoodView {
  isOpen: boolean
  name: string
  brand: string
  rate: MacroRate
  setName: (v: string) => void
  setBrand: (v: string) => void
  setRate: (patch: Partial<MacroRate>) => void

  canSave: boolean
  isSaving: boolean
  error: string | null
  /** True after a save that matched an existing food rather than creating one. */
  existed: boolean

  /** `prefill` is the search text, so a failed search becomes the start of a food. */
  open: (prefill?: string) => void
  close: () => void
  save: () => Promise<FoodRow | null>
}

/** 100 g is the basis nearly everything is labelled in; fibre starts unknown, not zero. */
const BLANK: MacroRate = {
  basis_unit: 'g',
  basis_amount: 100,
  kcal: 0,
  protein_g: 0,
  carbs_g: 0,
  fat_g: 0,
  fiber_g: null,
}

export function useNewFood(): NewFoodView {
  const [isOpen, setIsOpen] = useState(false)
  const [name, setName] = useState('')
  const [brand, setBrand] = useState('')
  const [rate, setRateState] = useState<MacroRate>(BLANK)
  const [isSaving, setIsSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [existed, setExisted] = useState(false)

  const open = useCallback((prefill?: string) => {
    setName(prefill?.trim() ?? '')
    setBrand('')
    setRateState(BLANK)
    setError(null)
    setExisted(false)
    setIsOpen(true)
  }, [])

  const save = useCallback(async (): Promise<FoodRow | null> => {
    if (!canSaveFood(name, rate)) return null
    setIsSaving(true)
    setError(null)
    try {
      const res = await fetch('/api/data/library', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, brand: brand.trim() === '' ? null : brand, rate }),
      })
      const json = (await res.json()) as CreateFoodResponse & { error?: unknown }
      if (!res.ok) throw new Error(typeof json.error === 'string' ? json.error : 'Could not save that food.')

      /**
       * `existed` is surfaced rather than swallowed. The row comes back either way and
       * the caller can use it, but the user should know their numbers were not applied
       * to a food that already had its own — that is the difference between "saved" and
       * "found what you meant".
       */
      setExisted(json.existed)
      setIsOpen(false)
      return json.food
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save that food.')
      return null
    } finally {
      setIsSaving(false)
    }
  }, [name, brand, rate])

  return {
    isOpen,
    name,
    brand,
    rate,
    setName,
    setBrand,
    setRate: (patch) => setRateState((prev) => ({ ...prev, ...patch })),
    canSave: canSaveFood(name, rate) && !isSaving,
    isSaving,
    error,
    existed,
    open,
    close: () => setIsOpen(false),
    save,
  }
}
