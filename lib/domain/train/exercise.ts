import { labelOf as muscleLabel, MUSCLE_GROUPS, type MuscleGroup } from '@/lib/domain/coach/priorities'

/**
 * The exercise library: what an exercise is, what its numbers mean, and which
 * rows look wrong.
 *
 * Pure — no I/O, no React. `muscle_group` is not cosmetic: it is what
 * `priority_volume_share()` groups by, so a mis-tagged exercise silently corrupts
 * the V-taper adherence measurement the priority order exists to enable (AC-4.14,
 * AC-2.14). Getting these labels and checks right is the point of the screen.
 */
export { MUSCLE_GROUPS, muscleLabel }
export type { MuscleGroup }

export const MOVEMENT_PATTERNS = [
  'horizontal_push',
  'vertical_push',
  'horizontal_pull',
  'vertical_pull',
  'hinge',
  'squat',
  'lunge',
  'carry',
  'isolation',
  'core',
  'other',
] as const
export type MovementPattern = (typeof MOVEMENT_PATTERNS)[number]

export const LOAD_TYPES = ['external_weight', 'bodyweight', 'assisted', 'duration', 'distance'] as const
export type LoadType = (typeof LOAD_TYPES)[number]

export interface Exercise {
  id: string
  name: string
  aliases: string[]
  muscle_group: string
  movement_pattern: string
  load_type: string
  is_unilateral: boolean
  equipment: string | null
  is_active: boolean
  set_count: number
  last_performed_on: string | null
}

export const patternLabel = (p: string): string => p.replace(/_/g, ' ')

/**
 * What each load type actually measures, and why.
 *
 * Shown in the editor because changing this field changes the meaning of every
 * set already logged against the exercise — `assisted` has no volume at all,
 * since lower assist is better and multiplying would invert the direction of
 * progress (PRD-004 §3.1).
 */
export const LOAD_TYPE_META: Record<
  LoadType,
  { label: string; inputs: string; volume: string; progression: string }
> = {
  external_weight: {
    label: 'External weight',
    inputs: 'weight + reps',
    volume: 'weight × reps',
    progression: 'load, then reps',
  },
  bodyweight: {
    label: 'Bodyweight',
    inputs: 'reps, optional added weight',
    volume: 'only when weight is added',
    progression: 'reps',
  },
  assisted: {
    label: 'Assisted',
    inputs: 'assist weight + reps',
    volume: 'none — lower assist is better, so a product would invert it',
    progression: 'reduce assist, then reps',
  },
  duration: {
    label: 'Duration',
    inputs: 'seconds',
    volume: 'none',
    progression: 'seconds',
  },
  distance: {
    label: 'Distance',
    inputs: 'metres, optional time',
    volume: 'none',
    progression: 'distance or pace',
  },
}

/** True when sets of this type can carry a volume figure at all (AC-2.3). */
export const hasVolume = (loadType: string): boolean =>
  loadType === 'external_weight' || loadType === 'bodyweight'

// ---------------------------------------------------------------------------
// Auditing
// ---------------------------------------------------------------------------

/**
 * Movement patterns that make sense for each muscle group.
 *
 * Deliberately generous — the goal is to catch an import error, not to police
 * exercise selection. `isolation` and `other` are allowed everywhere because
 * almost anything can be isolated.
 */
const PLAUSIBLE: Record<string, readonly string[]> = {
  chest: ['horizontal_push', 'vertical_push'],
  shoulders_front: ['vertical_push', 'horizontal_push'],
  shoulders_side: [],
  shoulders_rear: ['horizontal_pull'],
  back_lats: ['vertical_pull', 'horizontal_pull'],
  back_mid: ['horizontal_pull', 'vertical_pull'],
  biceps: ['vertical_pull', 'horizontal_pull'],
  triceps: ['horizontal_push', 'vertical_push'],
  quads: ['squat', 'lunge'],
  hamstrings: ['hinge', 'lunge'],
  glutes: ['hinge', 'squat', 'lunge'],
  calves: [],
  abs_core: ['core'],
  forearms: ['carry'],
  other: [],
}
const ALWAYS_OK = ['isolation', 'other'] as const

export type ExerciseFlag = 'pattern_implausible' | 'superset_in_name' | 'no_equipment'

export interface Audit {
  flags: ExerciseFlag[]
  /** One sentence per flag, in the user's terms. */
  messages: string[]
}

/**
 * Flags a row that looks mis-imported.
 *
 * PRD-004 §4.1 claims the superset names were split and the mis-tagged chest
 * presses "corrected on import; flagged in the migration report". Against the live
 * data neither is true: all three `Chest Press Machine` variants are
 * `vertical_pull` (a chest press is a horizontal push), and the superset prefixes
 * are still in the names. The claim was written; the fix was not applied. This is
 * how the screen surfaces that instead of the PRD hiding it.
 */
export function auditExercise(e: Pick<Exercise, 'name' | 'muscle_group' | 'movement_pattern' | 'equipment'>): Audit {
  const flags: ExerciseFlag[] = []
  const messages: string[] = []

  const allowed = PLAUSIBLE[e.muscle_group]
  if (
    allowed !== undefined &&
    !ALWAYS_OK.includes(e.movement_pattern as (typeof ALWAYS_OK)[number]) &&
    allowed.length > 0 &&
    !allowed.includes(e.movement_pattern)
  ) {
    flags.push('pattern_implausible')
    messages.push(
      `A ${muscleLabel(e.muscle_group)} exercise is rarely a ${patternLabel(e.movement_pattern)}. Check the pattern, or the muscle group.`,
    )
  }

  if (/superset/i.test(e.name)) {
    flags.push('superset_in_name')
    messages.push(
      'A superset is a grouping within a session, not part of a name. Rename this to the movement itself.',
    )
  }

  if (e.equipment === null || e.equipment.trim() === '') {
    flags.push('no_equipment')
    messages.push('No equipment recorded — useful for filtering once it is set.')
  }

  return { flags, messages }
}

/** `no_equipment` is true of every seeded row, so it never counts as attention. */
export const needsAttention = (a: Audit): boolean =>
  a.flags.some((f) => f !== 'no_equipment')

// ---------------------------------------------------------------------------
// Searching and grouping
// ---------------------------------------------------------------------------

const norm = (s: string) => s.toLowerCase().replace(/\s+/g, ' ').trim()

/** Name, alias, equipment or muscle group — whatever you happen to remember. */
export function matches(e: Exercise, query: string): boolean {
  const q = norm(query)
  if (q === '') return true
  return (
    norm(e.name).includes(q) ||
    e.aliases.some((a) => norm(a).includes(q)) ||
    norm(muscleLabel(e.muscle_group)).includes(q) ||
    norm(e.equipment ?? '').includes(q)
  )
}

export type GroupBy = 'muscle' | 'alpha'

export interface Group {
  key: string
  label: string
  exercises: Exercise[]
}

/**
 * Sections for the list.
 *
 * **No A–Z scrubber**, deliberately, despite PRD-002 §0 adopting one from
 * Gymshark. Gymshark indexes thousands of movements; this library has 57, and the
 * largest muscle group holds 10. A scrubber for a list you can see the end of is
 * chrome that costs a permanent 20px gutter on a 390px screen.
 */
export function group(exercises: readonly Exercise[], by: GroupBy): Group[] {
  if (by === 'alpha') {
    const letters = new Map<string, Exercise[]>()
    for (const e of [...exercises].sort((a, b) => a.name.localeCompare(b.name))) {
      const key = (e.name[0] ?? '#').toUpperCase()
      const bucket = letters.get(key)
      if (bucket) bucket.push(e)
      else letters.set(key, [e])
    }
    return [...letters].map(([key, list]) => ({ key, label: key, exercises: list }))
  }

  // Muscle order follows the priority list's own order, so the group you care
  // most about is the one you reach first.
  const order = MUSCLE_GROUPS as readonly string[]
  const groups = new Map<string, Exercise[]>()
  for (const e of exercises) {
    const bucket = groups.get(e.muscle_group)
    if (bucket) bucket.push(e)
    else groups.set(e.muscle_group, [e])
  }
  return [...groups]
    .sort(([a], [b]) => order.indexOf(a) - order.indexOf(b))
    .map(([key, list]) => ({
      key,
      label: muscleLabel(key),
      exercises: [...list].sort((x, y) => x.name.localeCompare(y.name)),
    }))
}

/**
 * `Chest · horizontal push · Cable` — the row's second line.
 *
 * Takes only the fields it reads, so the live session can pass its lighter
 * exercise shape without padding it with `aliases` and counters it does not have.
 */
export const describeExercise = (
  e: Pick<Exercise, 'muscle_group' | 'movement_pattern' | 'is_unilateral' | 'equipment'>,
): string =>
  [
    muscleLabel(e.muscle_group),
    patternLabel(e.movement_pattern),
    e.is_unilateral ? 'per side' : null,
    e.equipment,
  ]
    .filter(Boolean)
    .join(' · ')

// ---------------------------------------------------------------------------
// Editing
// ---------------------------------------------------------------------------

export interface ExerciseDraft {
  name: string
  muscle_group: string
  movement_pattern: string
  load_type: string
  is_unilateral: boolean
  equipment: string
}

export const canSaveExercise = (d: ExerciseDraft): boolean => d.name.trim() !== ''

/**
 * What changing `load_type` would do to sets already logged.
 *
 * Returned as a warning rather than a block: you may genuinely have mis-declared
 * an exercise, and refusing the correction would leave the wrong metric in place
 * forever. But it must be said out loud, with the count (PRD-004 §4.1).
 */
export function loadTypeWarning(
  from: string,
  to: string,
  setCount: number,
): string | null {
  if (from === to || setCount === 0) return null
  const gained = !hasVolume(from) && hasVolume(to)
  const lost = hasVolume(from) && !hasVolume(to)
  const detail = gained
    ? `${setCount} logged ${setCount === 1 ? 'set' : 'sets'} would start counting toward volume`
    : lost
      ? `${setCount} logged ${setCount === 1 ? 'set' : 'sets'} would stop counting toward volume`
      : `${setCount} logged ${setCount === 1 ? 'set' : 'sets'} would be read differently`
  return `${detail}. ${LOAD_TYPE_META[to as LoadType]?.volume ?? ''}`.trim()
}
