import { computeVolume, isVolumeEligible } from '@/lib/domain/volume'
import type { LoadType } from '@/lib/schemas/domain'
import { describeLast, type History } from './progression'

/**
 * The live session: what each set row holds, what it means, and what totals it
 * rolls up to.
 *
 * Pure — no I/O, no React, no Dexie. That matters more here than anywhere else in
 * the app: AC-2.1 requires a set to save and render locked in under 200 ms with no
 * signal, so the commit path has to be local arithmetic plus one IndexedDB write,
 * with nothing to await.
 */
export type SetKind = 'warmup' | 'ramp' | 'working' | 'top' | 'backoff' | 'dropset' | 'rest_pause'

export interface SetRow {
  /** Client-generated. The row's primary key, so a replayed flush upserts. */
  id: string
  exercise_id: string
  /** Plan position, 1-based. Groups rows under their exercise. */
  position: number
  set_index: number
  kind: SetKind
  weight_kg: number | null
  reps: number | null
  duration_sec: number | null
  /** `left` / `right` for unilateral work — numbers per side, never free text. */
  side: 'left' | 'right' | null
  /** Committed rows are locked; a draft row is still being typed into. */
  committed: boolean
  /**
   * True while `id` is only a React key, not a database key.
   *
   * The first row of each exercise is derived rather than seeded into state, so it
   * needs a STABLE id across renders — but a readable one like `draft:1` is not a
   * uuid, and committing it as the row's primary key was rejected by the sync route
   * with a 400. A real uuid is minted at commit time.
   */
  derived: boolean
}

/** Which inputs a set row shows. Driven entirely by `load_type` (§3.1). */
export interface SetInputs {
  weight: boolean
  reps: boolean
  duration: boolean
  /** The label for the weight column — assist weight is not the same as load. */
  weightLabel: string
}

export function inputsFor(loadType: string): SetInputs {
  switch (loadType) {
    case 'duration':
      return { weight: false, reps: false, duration: true, weightLabel: 'KG' }
    case 'distance':
      return { weight: false, reps: false, duration: true, weightLabel: 'KG' }
    case 'assisted':
      // Lower is better, so the column is named for what it is.
      return { weight: true, reps: true, duration: false, weightLabel: 'ASSIST' }
    case 'bodyweight':
      // Added weight is optional; an empty field means bodyweight only.
      return { weight: true, reps: true, duration: false, weightLabel: '+KG' }
    default:
      return { weight: true, reps: true, duration: false, weightLabel: 'KG' }
  }
}

/** A set is worth committing only once it carries the numbers its type needs. */
export function isComplete(row: SetRow, loadType: string): boolean {
  const inputs = inputsFor(loadType)
  if (inputs.duration) return row.duration_sec !== null && row.duration_sec > 0
  if (loadType === 'bodyweight') return row.reps !== null && row.reps > 0
  return row.reps !== null && row.reps > 0 && row.weight_kg !== null
}

/**
 * The next set's index for one exercise.
 *
 * Warmups are numbered too — they occupy an index so `unique (session_id,
 * position, set_index, side)` holds — but they RENDER as `W` (§4.3).
 */
export const nextSetIndex = (rows: readonly SetRow[]): number =>
  rows.reduce((max, r) => Math.max(max, r.set_index), 0) + 1

export const setLabel = (row: SetRow): string => (row.kind === 'warmup' ? 'W' : String(row.set_index))

/**
 * A blank row seeded from the previous one.
 *
 * Copying the last weight is the single biggest time saver on this screen: the
 * common case is the same load for the next set, and typing it again three times
 * per exercise is the friction that makes people log on paper instead.
 */
export function blankSet(
  exerciseId: string,
  position: number,
  rows: readonly SetRow[],
  side: 'left' | 'right' | null = null,
  /**
   * A deterministic id for a row that has not been typed into yet.
   *
   * The first row of each exercise is *derived*, not seeded into state by an effect
   * — so it needs a stable React key across renders. It only becomes real state
   * when the user edits it.
   */
  id?: string,
): SetRow {
  const previous = [...rows].reverse().find((r) => r.side === side) ?? rows[rows.length - 1]
  return {
    id: id ?? crypto.randomUUID(),
    exercise_id: exerciseId,
    position,
    set_index: nextSetIndex(rows.filter((r) => r.side === side)),
    kind: 'working',
    weight_kg: previous?.weight_kg ?? null,
    reps: null,
    duration_sec: previous?.duration_sec ?? null,
    side,
    committed: false,
    derived: id !== undefined,
  }
}

// ---------------------------------------------------------------------------
// Totals
// ---------------------------------------------------------------------------

export interface Totals {
  volumeKg: number
  sets: number
  /** Sets that carry no volume by definition — shown so the total is explicable. */
  volumelessSets: number
}

/**
 * Session totals over COMMITTED sets only.
 *
 * Volume sums only eligible load types (AC-2.4). Ab machine and plank work is real
 * training and is counted as sets, but it never enters a volume total where it
 * would out-rank the chest — which is exactly what the spreadsheet did.
 */
export function totals(
  rows: readonly SetRow[],
  loadTypeOf: (exerciseId: string) => string,
): Totals {
  let volumeKg = 0
  let sets = 0
  let volumelessSets = 0

  for (const row of rows) {
    if (!row.committed) continue
    sets += 1
    const loadType = loadTypeOf(row.exercise_id) as LoadType
    if (!isVolumeEligible(loadType)) {
      volumelessSets += 1
      continue
    }
    const v = computeVolume(loadType, row.weight_kg, row.reps)
    if (v === null) volumelessSets += 1
    else volumeKg += v
  }

  return { volumeKg: Math.round(volumeKg * 100) / 100, sets, volumelessSets }
}

/** `42:18`, or `1:02:18` past an hour. */
export function formatDuration(ms: number): string {
  const total = Math.max(Math.floor(ms / 1000), 0)
  const h = Math.floor(total / 3600)
  const m = Math.floor((total % 3600) / 60)
  const s = total % 60
  const pad = (n: number) => String(n).padStart(2, '0')
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`
}

/**
 * The `PREV` cell for one set row.
 *
 * **Always returns something** — `—` when there is no history at this gym. US-2.4
 * calls this non-negotiable, and Hevy keeps its `PREVIOUS` column populated for the
 * same reason: a column that disappears is a column you stop reading.
 */
export function prevLabel(
  history: History | null,
  loadType: string,
  setIndex: number,
): string {
  if (!history || history.last_performed_on === null) return '—'
  // Per-set history is not stored yet, so every row shows the last top set. Better
  // than a blank column, and honest — it is labelled PREV, not "your set 3".
  void setIndex
  const described = describeLast(history, loadType)
  return described.split(' · ')[0] ?? '—'
}

/** Rest presets in seconds. Planks and heavy compounds need different rests. */
export const REST_OPTIONS = [0, 45, 60, 90, 120, 180] as const
export const restLabel = (sec: number): string => (sec === 0 ? 'Off' : `${sec}s`)
