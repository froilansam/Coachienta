import { NextResponse } from 'next/server'
import { z } from 'zod'
import {
  correctFood,
  deleteFoodIfUnreferenced,
  libraryCounts,
  listLibrary,
  mergeFoods,
  pruneUnlogged,
} from '@/lib/db/queries/library'
import type { FoodRow } from '@/lib/db/queries/foods'
import { LIBRARY_FILTERS, type LibraryCounts } from '@/lib/domain/food/library'
import { MacroRate } from '@/lib/schemas/domain'

/**
 * Everything the food library does: list, correct, prune, merge, delete.
 *
 * One route rather than five because they are one screen's worth of behaviour
 * over one table, and splitting them would mean five files repeating the same
 * parse-validate-respond shell. GET reads; PATCH corrects one row; POST carries
 * the destructive actions, which are named in the body so they can never be
 * triggered by a stray GET.
 */
const Correction = z.object({
  id: z.uuid(),
  name: z.string().trim().min(1).max(200),
  brand: z
    .string()
    .trim()
    .max(120)
    .nullable()
    .transform((b) => (b === '' ? null : b)),
  rate: MacroRate,
})

const Action = z.discriminatedUnion('action', [
  z.object({ action: z.literal('prune') }),
  z.object({ action: z.literal('merge'), survivorId: z.uuid(), loserId: z.uuid() }),
  z.object({ action: z.literal('delete'), id: z.uuid() }),
])

export interface LibraryListResponse {
  foods: FoodRow[]
  counts: LibraryCounts
}

export async function GET(req: Request) {
  const url = new URL(req.url)
  const query = url.searchParams.get('q')?.trim() ?? ''
  const filter = z.enum(LIBRARY_FILTERS).catch('all').parse(url.searchParams.get('filter'))

  // Both in parallel: the counts drive the filter chips and must not wait on the
  // list, which is the bigger query.
  const [foods, counts] = await Promise.all([listLibrary(query, filter), libraryCounts()])
  return NextResponse.json<LibraryListResponse>({ foods, counts })
}

export async function PATCH(req: Request) {
  const parsed = Correction.safeParse(await req.json().catch(() => null))
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues }, { status: 400 })
  }
  const { id, name, brand, rate } = parsed.data
  const food = await correctFood(id, name, brand, rate)
  return NextResponse.json({ food })
}

export async function POST(req: Request) {
  const parsed = Action.safeParse(await req.json().catch(() => null))
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues }, { status: 400 })
  }
  const body = parsed.data

  if (body.action === 'prune') {
    return NextResponse.json({ deleted: await pruneUnlogged() })
  }
  if (body.action === 'delete') {
    const gone = await deleteFoodIfUnreferenced(body.id)
    return gone
      ? NextResponse.json({ deleted: 1 })
      : NextResponse.json(
          { error: 'Past entries still point at that food. Merge it instead.' },
          { status: 409 },
        )
  }

  try {
    return NextResponse.json({ food: await mergeFoods(body.survivorId, body.loserId) })
  } catch (err) {
    // The SQL function raises on a cross-basis merge or a missing row. That is a
    // refusal to guess, not a server fault, so it comes back as a 422 the UI can
    // show verbatim.
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Merge failed' },
      { status: 422 },
    )
  }
}
