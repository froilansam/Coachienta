import { NextResponse } from 'next/server'
import { z } from 'zod'
import { resolvePhoto } from '@/lib/ai/resolvePhoto'
import {
  responseForReading,
  type ResolvePhotoResponse,
} from '@/lib/food/readingResponse'

export type { LabelReading, PhotoItem, ResolvePhotoResponse } from '@/lib/food/readingResponse'

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

export async function POST(req: Request) {
  const parsed = Body.safeParse(await req.json().catch(() => null))
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues }, { status: 400 })
  }

  const vision = await resolvePhoto(parsed.data.image, parsed.data.mimeType)
  const body = await responseForReading(
    vision,
    vision.error
      ? 'Could not read that photo. Type the food instead.'
      : "Couldn't find food or a nutrition panel. Type it instead?",
  )
  return NextResponse.json<ResolvePhotoResponse>(body)
}
