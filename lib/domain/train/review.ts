import { z } from 'zod'
import type { PriorSet } from './detectPr'
import type { History } from './progression'

/**
 * A coach's read of one finished session.
 *
 * The model writes the sentences. The brief they are written from is assembled
 * here, so the order of the exercises and the previous session's sets cannot be
 * invented and cannot be left out.
 */
export const SessionReviewSchema = z.object({
  verdict: z.enum(['progress', 'mixed', 'flat']),
  headline: z.string(),
  read: z.string(),
  recommendations: z.array(z.string()),
})

export type SessionReview = z.infer<typeof SessionReviewSchema>

export interface ReviewExercise {
  position: number
  exerciseId: string
  name: string
  muscleGroup: string
  loadType: string
}

export interface ReviewLoggedSet {
  position: number
  exerciseId: string
  setIndex: number
  kind: string
  side: string | null
  weightKg: number | null
  reps: number | null
  durationSec: number | null
  isPr: boolean
  prScope: string | null
}

/**
 * Identity of the sets the read was written against.
 *
 * Order-independent, so a refetch that returns the rows differently does not
 * look like a new session and spend another call.
 */
export function reviewFingerprint(sets: readonly ReviewLoggedSet[]): string {
  return [...sets]
    .sort(
      (a, b) =>
        a.position - b.position ||
        a.setIndex - b.setIndex ||
        (a.side ?? '').localeCompare(b.side ?? ''),
    )
    .map((s) =>
      [
        s.position,
        s.exerciseId,
        s.setIndex,
        s.side ?? '',
        s.kind,
        s.weightKg ?? '',
        s.reps ?? '',
        s.durationSec ?? '',
        s.isPr ? '1' : '0',
        s.prScope ?? '',
      ].join(':'),
    )
    .join('|')
}

const kg = (n: number): string => `${Number.isInteger(n) ? n : n.toFixed(1)} kg`

function formatSet(s: { weightKg: number | null; reps: number | null; durationSec: number | null }): string {
  if (s.durationSec !== null && s.weightKg === null) return `${s.durationSec} s`
  if (s.weightKg === null && s.reps !== null) return `${s.reps} reps`
  if (s.weightKg === null) return 'unrecorded'
  if (s.reps === null) return kg(s.weightKg)
  return `${kg(s.weightKg)} × ${s.reps}`
}

/** The latest day at this gym, in set order. Older days are the best line's job. */
function previousDay(priors: readonly PriorSet[]): { on: string; lines: string[] } | null {
  const latest = priors.reduce((b, p) => (p.performed_on > b ? p.performed_on : b), '')
  if (latest === '') return null
  const lines = priors
    .filter((p) => p.performed_on === latest)
    .sort((a, b) => a.set_ordinal - b.set_ordinal || (a.side ?? '').localeCompare(b.side ?? ''))
    .map((p) => {
      const side = p.side ? ` ${p.side}` : ''
      return `set ${p.set_ordinal}${side} ${formatSet({ weightKg: p.weight_kg, reps: p.reps, durationSec: p.duration_sec })}`
    })
  return { on: latest, lines }
}

/**
 * The evidence for one read. Exercise order is stated on every row, because a
 * record on the first exercise and the same record third are not the same feat.
 */
export function buildReviewBrief(input: {
  name: string
  performedOn: string
  gymName: string
  exercises: readonly ReviewExercise[]
  sets: readonly ReviewLoggedSet[]
  history: Readonly<Record<string, History>>
  priorSets: Readonly<Record<string, readonly PriorSet[]>>
}): string {
  const total = input.exercises.length
  const lines: string[] = [
    `SESSION ${input.name} on ${input.performedOn} at ${input.gymName}.`,
    `${total} exercises, in the order they were done.`,
    '',
  ]

  for (const exercise of [...input.exercises].sort((a, b) => a.position - b.position)) {
    const before = input.exercises
      .filter((e) => e.position < exercise.position)
      .sort((a, b) => a.position - b.position)
      .map((e) => e.name)
    const place =
      exercise.position === 1
        ? 'first — done fresh'
        : `exercise ${exercise.position} of ${total}, after ${before.join(', ')}`
    lines.push(`${exercise.position}. ${exercise.name} (${exercise.muscleGroup}, ${exercise.loadType}) — ${place}`)

    const mine = input.sets
      .filter((s) => s.position === exercise.position)
      .sort((a, b) => a.setIndex - b.setIndex || (a.side ?? '').localeCompare(b.side ?? ''))
    if (mine.length === 0) {
      lines.push('   today: not logged')
    } else {
      const today = mine.map((s) => {
        const side = s.side ? ` ${s.side}` : ''
        const pr = s.isPr ? ` PR${s.prScope ? ` ${s.prScope}` : ''}` : ''
        return `set ${s.setIndex}${side} ${s.kind} ${formatSet(s)}${pr}`
      })
      lines.push(`   today: ${today.join('; ')}`)
    }

    const prev = previousDay(input.priorSets[exercise.exerciseId] ?? [])
    lines.push(prev ? `   previous ${prev.on}: ${prev.lines.join('; ')}` : '   previous: none at this gym')

    const h = input.history[exercise.exerciseId]
    if (h?.best_weight_kg != null && h.best_on) {
      lines.push(`   best weight: ${kg(h.best_weight_kg)} × ${h.best_reps ?? '?'} on ${h.best_on}`)
    }
    lines.push('')
  }

  return lines.join('\n').trimEnd()
}
