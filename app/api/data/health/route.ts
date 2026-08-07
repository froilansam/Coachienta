import { NextResponse } from 'next/server'
import { db } from '@/lib/db/client'

/** Proves the server→DB path and env validation work end to end. */
export async function GET() {
  const { count, error } = await db.from('foods').select('*', { count: 'exact', head: true })
  return NextResponse.json(
    error ? { ok: false, error: error.message } : { ok: true, foods: count ?? 0 },
    { status: error ? 500 : 200 },
  )
}
