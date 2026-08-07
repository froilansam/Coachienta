import { NextResponse } from 'next/server'
import { z } from 'zod'
import { db } from '@/lib/db/client'
import { bumpFoodUsage, unbumpFoodUsage } from '@/lib/db/queries/foods'

const Mutation = z.object({
  id: z.uuid(),
  table: z.enum(['food_log_entries', 'workout_sessions', 'workout_sets', 'body_measurements']),
  op: z.enum(['insert', 'update', 'delete']),
  payload: z.record(z.string(), z.unknown()),
})

/**
 * Single write choke point. The client-generated `id` is the row's primary key,
 * so a replayed flush upserts instead of duplicating (PRD-001 §4.2).
 */
export async function POST(req: Request) {
  const parsed = Mutation.safeParse(await req.json())
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues }, { status: 400 })
  }
  const { id, table, op, payload } = parsed.data

  /**
   * Read the food before deleting it, because a delete payload carries no
   * `food_id` — and without it the usage counter can never be undone.
   */
  const deletedFoodId =
    table === 'food_log_entries' && op === 'delete'
      ? ((await db.from(table).select('food_id').eq('id', id).maybeSingle()).data?.food_id ?? null)
      : null

  const { error } =
    op === 'delete'
      ? await db.from(table).delete().eq('id', id)
      : await db.from(table).upsert({ ...payload, id }, { onConflict: 'id' })

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  /**
   * Keep `recent_foods` ordered by actual use, and let `usual_amount` learn the
   * portion you normally take — that is what makes the next log two taps.
   * Best-effort: a failed counter must never fail the write.
   */
  if (table === 'food_log_entries' && op === 'insert') {
    const foodId = payload.food_id
    const amount = payload.amount
    if (typeof foodId === 'string') {
      await bumpFoodUsage(foodId, typeof amount === 'number' ? amount : null).catch(() => {})
    }
  }

  /**
   * And undo it on delete. Logging a food by mistake and removing it must not
   * leave the food permanently promoted in `recent_foods` — which is what
   * happened before, and it also made the library report entries that no longer
   * existed.
   */
  if (typeof deletedFoodId === 'string') {
    await unbumpFoodUsage(deletedFoodId).catch(() => {})
  }

  return NextResponse.json({ ok: true, id })
}
