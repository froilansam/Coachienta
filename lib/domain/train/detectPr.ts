/**
 * Personal records. Pure, and run **on the client at commit time** (§4.3).
 *
 * That placement is the point. A set has to lock in under 200 ms with no signal
 * (AC-2.1), so a PR cannot be decided by a server round trip — Postgres supplies
 * the prior sets, this function decides, and the verdict rides along in the queued
 * payload as `is_pr` / `pr_kinds`.
 *
 * ## Why the rules differ per load type
 *
 * The spreadsheet flagged **335 PRs across ~41 sessions**, on a free-text `PR Flag`
 * column holding 15 distinct values including the number `80`. Every set was a
 * record, so the word meant nothing. Two things fix that: a real boolean, and a
 * definition that can actually be false.
 */
export type PrKind = 'weight' | 'reps_at_weight' | 'volume_set' | 'duration' | 'first_time'

/** One prior set at the same gym. Warmups are excluded upstream. */
export interface PriorSet {
  performed_on: string
  weight_kg: number | null
  reps: number | null
  duration_sec: number | null
}

export interface Candidate {
  weight_kg: number | null
  reps: number | null
  duration_sec: number | null
}

export interface PrVerdict {
  /** Stored as a real boolean. `first_time` is deliberately NOT a PR. */
  isPr: boolean
  kinds: PrKind[]
  previousBest: PriorSet | null
  /** One sentence naming what was beaten, for the stamp's tooltip and the timeline. */
  basis: string | null
}

const NONE: PrVerdict = { isPr: false, kinds: [], previousBest: null, basis: null }

const kg = (n: number): string => `${Number.isInteger(n) ? n : n.toFixed(1)} kg`

/** Heaviest, then most reps at that weight — the set a weight PR must beat. */
function bestByWeight(history: readonly PriorSet[]): PriorSet | null {
  return history.reduce<PriorSet | null>((best, s) => {
    if (s.weight_kg === null || s.reps === null) return best
    if (best === null) return s
    if (s.weight_kg > best.weight_kg!) return s
    if (s.weight_kg === best.weight_kg && (s.reps ?? 0) > (best.reps ?? 0)) return s
    return best
  }, null)
}

export function detectPr(
  candidate: Candidate,
  history: readonly PriorSet[],
  loadType: string,
): PrVerdict {
  /**
   * No history at this gym is a **baseline, not a record** — the single rule that
   * stops every first session being a wall of PRs, and the direct fix for the
   * spreadsheet's 335 flags. A gym switch produces this too (AC-2.5).
   */
  if (history.length === 0) {
    return { isPr: false, kinds: ['first_time'], previousBest: null, basis: 'first time at this gym' }
  }

  if (loadType === 'duration') {
    const longest = history.reduce<PriorSet | null>(
      (b, s) => (s.duration_sec !== null && (b === null || s.duration_sec > (b.duration_sec ?? 0)) ? s : b),
      null,
    )
    const held = candidate.duration_sec
    if (held === null || longest === null) return NONE
    if (held <= (longest.duration_sec ?? 0)) return { ...NONE, previousBest: longest }
    return {
      isPr: true,
      kinds: ['duration'],
      previousBest: longest,
      basis: `${held} s beats ${longest.duration_sec} s from ${longest.performed_on}`,
    }
  }

  if (loadType === 'assisted') {
    /**
     * Inverted: **less assist is stronger.** A naive max would call the heaviest
     * assist a record, which is exactly backwards — the same inversion that makes
     * `volume_kg` null for this load type (§3.1).
     */
    const lightest = history.reduce<PriorSet | null>(
      (b, s) => (s.weight_kg !== null && (b === null || s.weight_kg < (b.weight_kg ?? Infinity)) ? s : b),
      null,
    )
    const assist = candidate.weight_kg
    const reps = candidate.reps
    if (assist === null || reps === null || lightest === null) return NONE

    const kinds: PrKind[] = []
    if (assist < (lightest.weight_kg ?? Infinity) && reps >= (lightest.reps ?? 0)) kinds.push('weight')
    else if (assist === lightest.weight_kg && reps > (lightest.reps ?? 0)) kinds.push('reps_at_weight')

    if (kinds.length === 0) return { ...NONE, previousBest: lightest }
    return {
      isPr: true,
      kinds,
      previousBest: lightest,
      basis: `${kg(assist)} assist × ${reps} beats ${kg(lightest.weight_kg!)} × ${lightest.reps} from ${lightest.performed_on}`,
    }
  }

  if (loadType === 'bodyweight') {
    // Reps are the axis when there is no external load; added weight, when present,
    // is compared as a weighted set.
    const anyWeighted = history.some((s) => (s.weight_kg ?? 0) > 0)
    if (!anyWeighted && (candidate.weight_kg ?? 0) === 0) {
      const mostReps = history.reduce<PriorSet | null>(
        (b, s) => (s.reps !== null && (b === null || s.reps > (b.reps ?? 0)) ? s : b),
        null,
      )
      const reps = candidate.reps
      if (reps === null || mostReps === null) return NONE
      if (reps <= (mostReps.reps ?? 0)) return { ...NONE, previousBest: mostReps }
      return {
        isPr: true,
        kinds: ['reps_at_weight'],
        previousBest: mostReps,
        basis: `${reps} reps beats ${mostReps.reps} from ${mostReps.performed_on}`,
      }
    }
    // Falls through to the weighted rules below.
  }

  // external_weight, and weighted bodyweight.
  const best = bestByWeight(history)
  const weight = candidate.weight_kg
  const reps = candidate.reps
  if (weight === null || reps === null || best === null) return NONE

  const kinds: PrKind[] = []

  // A heavier top set, at any rep count.
  if (weight > best.weight_kg!) kinds.push('weight')

  /**
   * More reps at an equal-or-higher weight than the previous best AT THAT WEIGHT.
   * Compared against the best at this exact load rather than the overall best, or
   * a light set could never be a record no matter how many reps it carried.
   */
  const bestAtThisWeight = history
    .filter((s) => s.weight_kg !== null && s.weight_kg === weight)
    .reduce<PriorSet | null>((b, s) => (b === null || (s.reps ?? 0) > (b.reps ?? 0) ? s : b), null)
  if (bestAtThisWeight !== null && reps > (bestAtThisWeight.reps ?? 0)) kinds.push('reps_at_weight')

  // A heavier single set by volume, which catches a rep jump at the same load that
  // the rule above misses when this exact weight has never been used.
  const bestVolume = history.reduce(
    (max, s) => Math.max(max, (s.weight_kg ?? 0) * (s.reps ?? 0)),
    0,
  )
  if (weight * reps > bestVolume) kinds.push('volume_set')

  if (kinds.length === 0) return { ...NONE, previousBest: best }

  return {
    isPr: true,
    kinds,
    previousBest: best,
    basis: `${kg(weight)} × ${reps} beats ${kg(best.weight_kg!)} × ${best.reps} from ${best.performed_on}`,
  }
}

/** `New weight · More reps` — for the stamp's accessible name and the timeline. */
export const describeKinds = (kinds: readonly PrKind[]): string =>
  kinds
    .map((k) =>
      k === 'weight'
        ? 'New weight'
        : k === 'reps_at_weight'
          ? 'More reps'
          : k === 'volume_set'
            ? 'Best set volume'
            : k === 'duration'
              ? 'Longest hold'
              : 'First time',
    )
    .join(' · ')
