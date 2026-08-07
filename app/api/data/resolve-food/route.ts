import { NextResponse } from 'next/server'
import { z } from 'zod'
import { recentFoods, type FoodRow } from '@/lib/db/queries/foods'
import { looksLikeFood, parseQuantity, splitMultiItem } from '@/lib/domain/food/parseQuantity'
import { resolveCascade, type ResolveStage } from '@/lib/food/resolveCascade'

/**
 * Thin. The cascade itself lives in `lib/food/resolveCascade.ts` so the photo
 * route shares one implementation (PRD-003 §3).
 */
const Body = z.object({
  input: z.string().min(1).max(200),
  libraryOnly: z.boolean().default(false),
  limit: z.number().int().min(1).max(20).default(8),
})

export interface ResolveResponse {
  parsed: { amount: number | null; unit: string | null; query: string }
  stage: ResolveStage
  results: FoodRow[]
  /** Several foods in one input; the client resolves each (AC-1.10). */
  segments?: string[]
  rejected?: string
  degraded?: boolean
  notice?: string
}

export async function POST(req: Request) {
  const parsedBody = Body.safeParse(await req.json().catch(() => null))
  if (!parsedBody.success) {
    return NextResponse.json({ error: parsedBody.error.issues }, { status: 400 })
  }
  const { input, libraryOnly, limit } = parsedBody.data

  // Resolving the whole string would mis-parse: "200g tofu, 140g rice" matched
  // an Open Food Facts product literally named "140g".
  const segments = splitMultiItem(input)
  if (segments.length > 1) {
    return NextResponse.json<ResolveResponse>({
      parsed: { amount: null, unit: null, query: input },
      stage: 'none',
      results: [],
      segments,
    })
  }

  const parsed = parseQuantity(input)
  const base = { amount: parsed.amount, unit: parsed.unit, query: parsed.query }

  if (!parsed.query) {
    return NextResponse.json<ResolveResponse>({ parsed: base, stage: 'none', results: [] })
  }

  if (!looksLikeFood(parsed.query)) {
    return NextResponse.json<ResolveResponse>({
      parsed: base,
      stage: 'none',
      results: [],
      rejected: "That doesn't look like a food.",
    })
  }

  const { stage, results, degraded } = await resolveCascade(parsed.query, { limit, libraryOnly })

  return NextResponse.json<ResolveResponse>({
    parsed: base,
    stage,
    results,
    degraded,
    notice:
      libraryOnly && results.length === 0
        ? 'Offline — searching your library only.'
        : stage === 'none'
          ? 'Could not look that up. Enter the macros yourself, or try a simpler name.'
          : undefined,
  })
}

/** Empty search box → the two-tap default list. */
export async function GET() {
  return NextResponse.json({ results: await recentFoods(8) })
}
