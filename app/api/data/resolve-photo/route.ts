import { NextResponse } from 'next/server'
import { z } from 'zod'
import { resolvePhoto, type PhotoKind } from '@/lib/ai/resolvePhoto'
import type { FoodRow } from '@/lib/db/queries/foods'
import { readLabel } from '@/lib/domain/food/label'
import { resolveCascade } from '@/lib/food/resolveCascade'
import type { MacroRate, UnitBasis } from '@/lib/schemas/domain'
import type { LabelVerdict, NutritionLabel } from '@/lib/schemas/label'

/**
 * Photo → things you can log. Two shapes, decided by what the photo turned out
 * to be.
 *
 * **A plate** goes through the shared cascade: vision names each food, then the
 * databases find macros for each name. `skipAi` is deliberate — one vision call
 * per photo is enough spend; a name nothing recognises comes back unmatched and
 * the user types it rather than us firing N more LLM calls.
 *
 * **A label** skips the cascade entirely. There is nothing to search for: the
 * macros are printed on the packet. The transcription goes straight into
 * `readLabel`, which is pure arithmetic (PRD-003 §3.3b).
 *
 * Nothing is written here. The label's NAME is its library identity — the string
 * that decides whether next week's search finds it — and OCR gets names wrong far
 * more often than it gets digits wrong. So the row is created only once the user
 * has approved the name, by `POST /api/data/label-food`.
 */
const Body = z.object({
  /** Bare base64, no data: prefix. Client downscales before sending. */
  image: z.string().min(64).max(8_000_000),
  mimeType: z.enum(['image/jpeg', 'image/png', 'image/webp']).default('image/jpeg'),
})

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

export async function POST(req: Request) {
  const parsed = Body.safeParse(await req.json().catch(() => null))
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues }, { status: 400 })
  }

  const vision = await resolvePhoto(parsed.data.image, parsed.data.mimeType)
  const common = { sceneNotes: vision.sceneNotes, degraded: vision.degraded }

  if (vision.kind === 'label' && vision.label) {
    const read = readLabel(vision.label)
    if (!read) {
      return NextResponse.json<ResolvePhotoResponse>({
        ...NOTHING,
        ...common,
        kind: 'label',
        notice: 'Read the panel but found no carbohydrate figure. Type this one instead.',
      })
    }

    return NextResponse.json<ResolvePhotoResponse>({
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
    })
  }

  if (vision.kind !== 'plate' || vision.items.length === 0) {
    return NextResponse.json<ResolvePhotoResponse>({
      ...NOTHING,
      ...common,
      notice: vision.error
        ? 'Could not read that photo. Type the food instead.'
        : "Couldn't find food or a nutrition panel. Type it instead?",
    })
  }

  // Sequential, not parallel: each miss may hit USDA and Open Food Facts, and OFF
  // allows only 10 searches a minute (PRD-003 §3.1a).
  const items: PhotoItem[] = []
  for (const [i, c] of vision.items.entries()) {
    const { results } = await resolveCascade(c.name, { limit: 1, skipAi: true })
    items.push({
      key: `${i}-${c.name}`,
      name: c.name,
      amount: c.estimated_amount,
      unit: c.estimated_unit,
      reasoning: c.portion_reasoning,
      visionConfidence: c.confidence,
      food: results[0] ?? null,
    })
  }

  return NextResponse.json<ResolvePhotoResponse>({
    ...common,
    kind: 'plate',
    dishName: vision.dishName,
    label: null,
    items,
  })
}
