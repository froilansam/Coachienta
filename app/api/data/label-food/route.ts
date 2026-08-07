import { NextResponse } from 'next/server'
import { z } from 'zod'
import { upsertFood, type FoodRow } from '@/lib/db/queries/foods'
import { readLabel } from '@/lib/domain/food/label'
import { NutritionLabel } from '@/lib/schemas/label'

/**
 * Saves a photographed nutrition label as a food row, under the name the user
 * approved.
 *
 * Split from `/resolve-photo` on purpose. A label's name is its library
 * identity — the string that decides whether next week's search finds it — and
 * OCR misreads names far more often than digits, especially half-width Japanese
 * katakana. Writing the row at read time would mean every scan risked leaving a
 * permanently unfindable entry behind. So reading and saving are two steps, and
 * the name is the user's to fix in between (PRD-003 §3.3b, AC-1.21).
 *
 * The client sends the transcription back rather than the macros: `readLabel`
 * runs again here, so the stored rate is always derived server-side from what was
 * transcribed. A client cannot post arbitrary macros under a label's authority.
 */
const Body = z.object({
  transcription: NutritionLabel,
  /** Trimmed and required — an empty name would be unfindable, which is the bug. */
  name: z.string().trim().min(1).max(200),
  brand: z
    .string()
    .trim()
    .max(120)
    .nullable()
    .transform((b) => (b === '' ? null : b)),
})

export type LabelFoodResponse = { food: FoodRow } | { error: string }

export async function POST(req: Request) {
  const parsed = Body.safeParse(await req.json().catch(() => null))
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues }, { status: 400 })
  }
  const { transcription, name, brand } = parsed.data

  const read = readLabel(transcription)
  if (!read) {
    return NextResponse.json<LabelFoodResponse>(
      { error: 'That label has no recoverable carbohydrate figure.' },
      { status: 422 },
    )
  }

  /**
   * Upserting on `(name_norm, brand)` gives the rename-into-an-existing-row case
   * the behaviour the user is actually asking for: correcting a garbled name to
   * one already in the library resolves to THAT row rather than creating a
   * near-duplicate. The printed label then updates its macros, which is right —
   * the packet outranks any earlier estimate.
   */
  const food = await upsertFood({
    name,
    brand,
    rate: read.rate,
    confidence: read.verdict.confidence,
    source: 'photo',
    // The citation IS the packet. No URL exists, and inventing one would make a
    // photographed label look like a web source.
    citation: {
      ref: 'nutrition label photo',
      url: null,
      detail: `${transcription.regime} panel, read from a photo`,
    },
  })

  return NextResponse.json<LabelFoodResponse>({ food })
}
