import { NextResponse } from 'next/server'
import { z } from 'zod'
import {
  getProfile,
  saveWeighIn,
  updateProfile,
  type ProfilePayload,
} from '@/lib/db/queries/profile'

/**
 * The profile screen's data, its edits, and weigh-ins.
 *
 * One route because it is one screen over one small cluster of tables — same shape
 * as `/api/data/library`. GET reads everything the screen shows, PATCH edits the
 * single profile row, POST appends a weigh-in.
 */
const ProfilePatch = z.object({
  display_name: z.string().trim().max(80).nullable().optional(),
  /** Age is derived from this, so it is the input that unblocks BMR (AC-4.6). */
  birth_date: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .nullable()
    .optional(),
  height_cm: z.number().positive().max(260).nullable().optional(),
  sex: z.enum(['male', 'female']).nullable().optional(),
  timezone: z.string().max(64).nullable().optional(),
  medical_notes: z.string().max(2000).nullable().optional(),
})

/**
 * `waist_cm` and `body_fat_pct` are optional and a blank one still saves
 * (AC-4.4a). The real log holds a partial reading noted *"blanks are honest"* —
 * requiring a number there would have meant inventing one.
 */
const WeighIn = z.object({
  measured_on: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  weight_kg: z.number().positive().max(400),
  waist_cm: z.number().positive().max(300).nullable().default(null),
  body_fat_pct: z.number().min(0).max(80).nullable().default(null),
  notes: z.string().trim().max(500).nullable().default(null),
})

export type { ProfilePayload }

export async function GET() {
  return NextResponse.json(await getProfile())
}

export async function PATCH(req: Request) {
  const parsed = ProfilePatch.safeParse(await req.json().catch(() => null))
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues }, { status: 400 })
  }
  await updateProfile(parsed.data)
  return NextResponse.json({ ok: true })
}

export async function POST(req: Request) {
  const parsed = WeighIn.safeParse(await req.json().catch(() => null))
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues }, { status: 400 })
  }
  await saveWeighIn(parsed.data)
  return NextResponse.json({ ok: true })
}
