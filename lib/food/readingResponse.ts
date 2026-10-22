import 'server-only'
import type { PhotoKind, ResolvePhotoResult } from '@/lib/ai/resolvePhoto'
import type { FoodRow } from '@/lib/db/queries/foods'
import { readLabel } from '@/lib/domain/food/label'
import { resolveCascade } from '@/lib/food/resolveCascade'
import type { MacroRate, UnitBasis } from '@/lib/schemas/domain'
import type { LabelVerdict, NutritionLabel } from '@/lib/schemas/label'

export interface PhotoItem {
  /** Client-side key; stable across edits. */
  key: string
  name: string
  amount: number
  unit: UnitBasis
  reasoning: string
  visionConfidence: 'high' | 'medium' | 'low'
  /** Null when no database recognised the name — the user types it in. */
  food: FoodRow | null
}

/** A label, read but not yet saved — the user still owns the name. */
export interface LabelReading {
  transcription: NutritionLabel
  verdict: LabelVerdict
  /** Derived server-side from the transcription, so the client cannot fabricate it. */
  rate: MacroRate
  proposedName: string
  proposedBrand: string | null
}

export interface ResolvePhotoResponse {
  kind: PhotoKind
  dishName: string | null
  items: PhotoItem[]
  label: LabelReading | null
  sceneNotes: string | null
  degraded: boolean
  notice?: string
}

const NOTHING = {
  kind: 'neither' as const,
  dishName: null,
  items: [] as PhotoItem[],
  label: null,
}

/**
 * One reading, whichever way it arrived. A photo and a pasted note produce the
 * same two shapes, and the label arithmetic must not be copied into a second route.
 */
export async function responseForReading(
  vision: ResolvePhotoResult,
  whenEmpty: string,
): Promise<ResolvePhotoResponse> {
  const common = { sceneNotes: vision.sceneNotes, degraded: vision.degraded }

  if (vision.kind === 'label' && vision.label) {
    const read = readLabel(vision.label)
    if (!read) {
      return {
        ...NOTHING,
        ...common,
        kind: 'label',
        notice: 'Read the panel but found no carbohydrate figure. Type this one instead.',
      }
    }

    return {
      ...common,
      kind: 'label',
      dishName: vision.label.product_name,
      items: [],
      label: {
        transcription: vision.label,
        verdict: read.verdict,
        rate: read.rate,
        proposedName: vision.label.product_name ?? '',
        proposedBrand: vision.label.brand,
      },
    }
  }

  if (vision.kind !== 'plate' || vision.items.length === 0) {
    return { ...NOTHING, ...common, notice: whenEmpty }
  }

  // Sequential, not parallel: each miss may hit USDA and Open Food Facts, and OFF
  // allows only 10 searches a minute (PRD-003 §3.1a).
  const items: PhotoItem[] = []
  for (const [i, c] of vision.items.entries()) {
    const { results } = await resolveCascade(c.name, { limit: 8, skipAi: true })
    // A per-piece egg matched to a per-100 g row would be scaled as grams. Only a
    // row in the same unit can be shown; anything else is left unmatched.
    const food = results.find((r) => r.basis_unit === c.estimated_unit) ?? null
    items.push({
      key: `${i}-${c.name}`,
      name: c.name,
      amount: c.estimated_amount,
      unit: c.estimated_unit,
      reasoning: c.portion_reasoning,
      visionConfidence: c.confidence,
      food,
    })
  }

  return { ...common, kind: 'plate', dishName: vision.dishName, label: null, items }
}
