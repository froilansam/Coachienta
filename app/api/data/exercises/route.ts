import { NextResponse } from 'next/server'
import { z } from 'zod'
import {
  addExercise,
  listExercises,
  setExerciseActive,
  updateExercise,
} from '@/lib/db/queries/exercises'
import {
  LOAD_TYPES,
  MOVEMENT_PATTERNS,
  MUSCLE_GROUPS,
  type Exercise,
} from '@/lib/domain/train/exercise'

/**
 * The exercise library: list, edit, add, retire.
 *
 * The enums are validated here as well as by Postgres. A muscle group outside the
 * enum must fail (AC-2.6), and failing at the API boundary gives a usable message
 * rather than a raw constraint violation.
 */
const Draft = {
  name: z.string().trim().min(1).max(120),
  muscle_group: z.enum(MUSCLE_GROUPS),
  movement_pattern: z.enum(MOVEMENT_PATTERNS),
  load_type: z.enum(LOAD_TYPES),
  is_unilateral: z.boolean(),
  equipment: z.string().trim().max(80),
}

const Body = z.discriminatedUnion('action', [
  z.object({ action: z.literal('add'), ...Draft }),
  z.object({ action: z.literal('update'), id: z.uuid(), ...Draft }),
  z.object({ action: z.literal('set_active'), id: z.uuid(), is_active: z.boolean() }),
])

export interface ExerciseListResponse {
  exercises: Exercise[]
}

export async function GET(req: Request) {
  const includeInactive = new URL(req.url).searchParams.get('inactive') === '1'
  return NextResponse.json<ExerciseListResponse>({
    exercises: await listExercises(includeInactive),
  })
}

export async function POST(req: Request) {
  const parsed = Body.safeParse(await req.json().catch(() => null))
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues }, { status: 400 })
  }
  const body = parsed.data

  try {
    if (body.action === 'add') {
      const { action: _a, ...draft } = body
      await addExercise(draft)
    } else if (body.action === 'update') {
      const { action: _u, id, ...draft } = body
      await updateExercise(id, draft)
    } else {
      await setExerciseActive(body.id, body.is_active)
    }
  } catch (err) {
    // A duplicate name violates the unique index on `name_norm` — a refusal with a
    // usable reason, not a fault.
    const message = err instanceof Error ? err.message : 'That edit was refused.'
    return NextResponse.json(
      {
        error: /duplicate key/i.test(message)
          ? 'An exercise with that name already exists.'
          : message,
      },
      { status: 422 },
    )
  }

  return NextResponse.json<ExerciseListResponse>({ exercises: await listExercises(true) })
}
