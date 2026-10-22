'use client'
import { useCallback, useState } from 'react'
import type { LabelFoodResponse } from '@/app/api/data/label-food/route'
import type {
  LabelReading,
  PhotoItem,
  ResolvePhotoResponse,
} from '@/app/api/data/resolve-photo/route'
import type { PhotoKind } from '@/lib/ai/resolvePhoto'
import { describeLabel, type LabelDisplay } from '@/lib/domain/food/label'
import { prepareImage } from '@/lib/domain/food/photo'
import { scaleMacros } from '@/lib/domain/macros'
import type { Macros, MacroRate } from '@/lib/schemas/domain'
import type { FoodRow } from '@/lib/schemas/food'

/**
 * Capture or paste → classify → review. Owns both ways in.
 *
 * It deliberately stops at "reviewed": committing is `useLogDraft`'s job, so
 * there is one commit path in the app and photo entries land in the same offline
 * queue as typed ones.
 *
 * The two review shapes are kept apart rather than merged into one list. A plate
 * is several estimates whose grams need correcting; a label is one printed fact
 * whose NAME needs approving before it becomes a library row. Sharing a structure
 * between them would make every field optional in both.
 */
export interface ReviewItem extends PhotoItem {
  /** Editable. Vision is poor at portions, so this is the number the user owns. */
  amount: number
  /** Null when no database recognised the name. */
  macros: Macros | null
  included: boolean
}

/** A read label, still unsaved. Nothing exists in the database until `saveLabel`. */
export interface LabelDraft {
  reading: LabelReading
  display: LabelDisplay
  /** Editable — this is the string next week's search has to match. */
  name: string
  brand: string
  amount: number
  /** For the amount currently entered, from the server-derived rate. */
  macros: Macros | null
  /** An empty name is the one thing that makes a row unfindable, so it blocks save. */
  canSave: boolean
}

export type PhotoPhase = 'idle' | 'preparing' | 'identifying' | 'review' | 'saving' | 'error'

export interface PhotoDraft {
  phase: PhotoPhase
  /**
   * What the photo turned out to be. A plate is an estimate the user corrects; a
   * label is a transcription the user confirms. Different screens, one shutter.
   */
  kind: PhotoKind
  /** Which capture produced the current reading. Drives the review copy. */
  source: 'photo' | 'text' | null
  /** The note waiting to be sorted. Kept across a failure so it can be edited. */
  text: string
  previewUrl: string | null
  dishName: string | null
  items: ReviewItem[]
  label: LabelDraft | null
  total: Macros
  notice: string | null
  /** Items whose name matched nothing — the user must handle them by hand. */
  unmatchedCount: number

  capture: (file: File) => Promise<void>
  setText: (text: string) => void
  submitText: () => Promise<void>
  setAmount: (key: string, amount: number | null) => void
  toggle: (key: string) => void
  remove: (key: string) => void
  setLabelName: (name: string) => void
  setLabelBrand: (brand: string) => void
  setLabelAmount: (amount: number | null) => void
  /**
   * Writes the food row under the approved name and returns it, so the caller can
   * put it in the basket. Null on failure, with `notice` explaining why.
   */
  saveLabel: () => Promise<FoodRow | null>
  reset: () => void
}

const ZERO: Macros = { kcal: 0, protein_g: 0, carbs_g: 0, fat_g: 0 }
const round1 = (n: number) => Math.round(n * 10) / 10

/** Recomputes macros for one plate item at its current amount. */
function withMacros(item: ReviewItem): ReviewItem {
  if (!item.food) return { ...item, macros: null }
  try {
    return { ...item, macros: scaleMacros(item.food, item.amount, item.unit) }
  } catch {
    // Unit mismatch (a per-piece food matched to a gram estimate). We refuse to
    // guess a density, so the user sets the amount in the food's own unit.
    return { ...item, macros: null }
  }
}

/**
 * A label's amount is always entered in the rate's own unit, so this cannot
 * mismatch — but a zero basis from a misread panel would divide by zero.
 */
function safeScale(rate: MacroRate, amount: number): Macros | null {
  try {
    return scaleMacros(rate, amount, rate.basis_unit)
  } catch {
    return null
  }
}

/** Everything one photo produced. One value, because it all arrives at once. */
interface Reading {
  kind: PhotoKind
  dishName: string | null
  items: ReviewItem[]
  label: { reading: LabelReading; name: string; brand: string; amount: number } | null
  notice: string | null
}

const BLANK: Reading = { kind: 'neither', dishName: null, items: [], label: null, notice: null }

export function usePhotoDraft(): PhotoDraft {
  const [phase, setPhase] = useState<PhotoPhase>('idle')
  const [source, setSource] = useState<'photo' | 'text' | null>(null)
  const [text, setText] = useState('')
  const [previewUrl, setPreviewUrl] = useState<string | null>(null)
  const [read, setRead] = useState<Reading>(BLANK)

  const applyReading = useCallback((data: ResolvePhotoResponse) => {
    setRead({
      kind: data.kind,
      dishName: data.dishName,
      notice: data.notice ?? null,
      items: data.items.map((i) => withMacros({ ...i, macros: null, included: true })),
      label: data.label
        ? {
            reading: data.label,
            name: data.label.proposedName,
            brand: data.label.proposedBrand ?? '',
            // One basis is the honest default: the label describes 100 g or one
            // serving, and it cannot know how much of it you ate.
            amount: data.label.rate.basis_amount,
          }
        : null,
    })
    setPhase(data.items.length === 0 && !data.label ? 'error' : 'review')
  }, [])

  const capture = useCallback(async (file: File) => {
    setSource('photo')
    setRead(BLANK)
    setPhase('preparing')
    try {
      const prepared = await prepareImage(file)
      setPreviewUrl(`data:${prepared.mimeType};base64,${prepared.base64}`)

      setPhase('identifying')
      const res = await fetch('/api/data/resolve-photo', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ image: prepared.base64, mimeType: prepared.mimeType }),
      })
      if (!res.ok) throw new Error(`${res.status}`)
      applyReading((await res.json()) as ResolvePhotoResponse)
    } catch {
      setRead({ ...BLANK, notice: 'Could not read that photo. Type the food instead.' })
      setPhase('error')
    }
  }, [applyReading])

  const submitText = useCallback(async () => {
    const note = text.trim()
    if (note === '') return
    setSource('text')
    setPreviewUrl(null)
    setRead(BLANK)
    setPhase('identifying')
    try {
      const res = await fetch('/api/data/resolve-paste', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: note }),
      })
      if (!res.ok) throw new Error(`${res.status}`)
      applyReading((await res.json()) as ResolvePhotoResponse)
    } catch {
      setRead({ ...BLANK, notice: 'Could not sort that text. Type the foods instead.' })
      setPhase('error')
    }
  }, [applyReading, text])

  /** Every plate mutation touches only `items`, so they share one updater. */
  const mapItems = useCallback((fn: (items: ReviewItem[]) => ReviewItem[]) => {
    setRead((prev) => ({ ...prev, items: fn(prev.items) }))
  }, [])

  const setAmount = useCallback(
    (key: string, amount: number | null) => {
      if (amount === null || amount <= 0) return
      mapItems((items) => items.map((i) => (i.key === key ? withMacros({ ...i, amount }) : i)))
    },
    [mapItems],
  )

  const toggle = useCallback(
    (key: string) => {
      mapItems((items) => items.map((i) => (i.key === key ? { ...i, included: !i.included } : i)))
    },
    [mapItems],
  )

  const remove = useCallback(
    (key: string) => {
      mapItems((items) => items.filter((i) => i.key !== key))
    },
    [mapItems],
  )

  /** The three label edits differ only in which field they replace. */
  const patchLabel = useCallback(
    (patch: Partial<{ name: string; brand: string; amount: number }>) => {
      setRead((prev) => (prev.label ? { ...prev, label: { ...prev.label, ...patch } } : prev))
    },
    [],
  )

  const setLabelName = useCallback((name: string) => patchLabel({ name }), [patchLabel])
  const setLabelBrand = useCallback((brand: string) => patchLabel({ brand }), [patchLabel])
  const setLabelAmount = useCallback(
    (amount: number | null) => {
      if (amount !== null && amount > 0) patchLabel({ amount })
    },
    [patchLabel],
  )

  const saveLabel = useCallback(async (): Promise<FoodRow | null> => {
    const draft = read.label
    if (!draft || draft.name.trim() === '') return null
    setPhase('saving')
    try {
      const res = await fetch('/api/data/label-food', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          // The transcription goes back, not the macros — the server re-derives
          // the rate, so it can never be fabricated here.
          transcription: draft.reading.transcription,
          name: draft.name.trim(),
          brand: draft.brand.trim() === '' ? null : draft.brand.trim(),
        }),
      })
      const body = (await res.json()) as LabelFoodResponse
      if (!res.ok || !('food' in body)) throw new Error('save failed')
      return body.food
    } catch {
      // Stay on the review screen. The transcription is still on it and retrying
      // costs nothing, whereas losing it means shooting the packet again.
      setRead((prev) => ({ ...prev, notice: 'Could not save that. Tap add again.' }))
      setPhase('review')
      return null
    }
  }, [read.label])

  const reset = useCallback(() => {
    setPhase('idle')
    setSource(null)
    setText('')
    setPreviewUrl(null)
    setRead(BLANK)
  }, [])

  const total = read.items
    .filter((i) => i.included && i.macros)
    .reduce<Macros>(
      (t, i) => ({
        kcal: round1(t.kcal + i.macros!.kcal),
        protein_g: round1(t.protein_g + i.macros!.protein_g),
        carbs_g: round1(t.carbs_g + i.macros!.carbs_g),
        fat_g: round1(t.fat_g + i.macros!.fat_g),
      }),
      ZERO,
    )

  const label: LabelDraft | null = read.label
    ? {
        reading: read.label.reading,
        name: read.label.name,
        brand: read.label.brand,
        amount: read.label.amount,
        display: describeLabel(
          read.label.reading.transcription,
          read.label.reading.verdict,
          read.label.reading.rate,
        ),
        macros: safeScale(read.label.reading.rate, read.label.amount),
        canSave: read.label.name.trim() !== '',
      }
    : null

  return {
    phase,
    kind: read.kind,
    source,
    text,
    previewUrl,
    dishName: read.dishName,
    items: read.items,
    label,
    total,
    notice: read.notice,
    unmatchedCount: read.items.filter((i) => i.included && !i.food).length,
    capture,
    setText,
    submitText,
    setAmount,
    toggle,
    remove,
    setLabelName,
    setLabelBrand,
    setLabelAmount,
    saveLabel,
    reset,
  }
}
