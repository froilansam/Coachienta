import { NextResponse } from 'next/server'
import { z } from 'zod'
import { resolvePaste } from '@/lib/ai/resolvePaste'
import { responseForReading, type ResolvePhotoResponse } from '@/lib/food/readingResponse'

/**
 * Pasted text → things you can log. Same two shapes as a photo.
 *
 * Nothing is written here. A meal is names plus amounts, resolved through the
 * cascade with no further model call. A copied nutrition panel is transcribed
 * and the macros are derived in `readLabel`, then saved only when the user
 * approves the name.
 */
const Body = z.object({
  text: z.string().trim().min(1).max(4_000),
})

export async function POST(req: Request) {
  const parsed = Body.safeParse(await req.json().catch(() => null))
  if (!parsed.success) {
    return NextResponse.json({ error: 'Paste the food, then sort it.' }, { status: 400 })
  }

  const reading = await resolvePaste(parsed.data.text)
  const body = await responseForReading(
    reading,
    reading.error ?? "Couldn't find food in that text. Type it instead?",
  )
  return NextResponse.json<ResolvePhotoResponse>(body)
}
