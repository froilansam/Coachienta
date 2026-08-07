import { NextResponse } from 'next/server'
import { z } from 'zod'
import { getDay } from '@/lib/db/queries/day'

const Query = z.object({ date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/) })

export async function GET(req: Request) {
  const parsed = Query.safeParse({ date: new URL(req.url).searchParams.get('date') })
  if (!parsed.success) {
    return NextResponse.json({ error: 'date must be YYYY-MM-DD' }, { status: 400 })
  }
  return NextResponse.json(await getDay(parsed.data.date))
}
