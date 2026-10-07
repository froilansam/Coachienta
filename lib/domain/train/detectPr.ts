/**
 * Personal records. Pure, and run **on the client at commit time** (§4.3).
 *
 * That placement is the point. A set has to lock in under 200 ms with no signal
 * (AC-2.1), so a PR cannot be decided by a server round trip — Postgres supplies
 * the prior sets, this function decides, and the verdict rides along in the queued
 * payload as `is_pr` / `pr_kinds` / `pr_scope`.
 *
 * ## A record is judged per set POSITION
 *
 * Set 1 competes with every set 1 on record, set 2 with every set 2. Pooling every
 * set of an exercise together — which is what this did before — means only the top
 * set can ever be a record:
 *
 *   set 1  80 kg × 8   ← the only set that could win
 *   set 2  70 kg × 8
 *   set 3  60 kg × 8   ← 60 → 65 here is overload that nothing recorded
 *
 * The back-off sets creeping up is real progress, and it was invisible. Position is
 * the **gate**; beating the all-time best as well is a rank on top (`scope`), never
 * a way in. 50 kg × 11 is not progress at a position that has already held 60 kg × 20,
 * however it compares against the rest of the exercise.
 *
 * ## Why the rules differ per load type
 *
 * The spreadsheet flagged **335 PRs across ~41 sessions**, on a free-text `PR Flag`
 * column holding 15 distinct values including the number `80`. Every set was a
 * record, so the word meant nothing. Two things fix that: a real boolean, and a
 * definition that can actually be false.
 */
export type PrKind = 'weight' | 'reps_at_weight' | 'volume_set' | 'duration' | 'first_time'

/**
 * How far the record reaches.
 *
 * `set` — the best this position has ever produced. `all_time` — the best the
 * exercise has ever produced, from any position. Every `all_time` record has already
 * cleared its own position, because position is the gate.
 */
export type PrScope = 'all_time' | 'set'

/** One prior set at the same gym. Warmups are excluded upstream. */
export interface PriorSet {
  performed_on: string
  /**
   * Rank among that session's WORKING sets for this exercise and side, 1-based.
   *
   * Not `set_index`: warmups occupy an index, so the first working set sits at index
   * 2 on a day with a warmup and index 1 on a day without one. Comparing those as
   * positions would re-align the whole history every time the warmup count changed.
   */
  set_ordinal: number
  side: 'left' | 'right' | null
  weight_kg: number | null
  reps: number | null
  duration_sec: number | null
}

export interface Candidate {
  set_ordinal: number
  side: 'left' | 'right' | null
  weight_kg: number | null
  reps: number | null
  duration_sec: number | null
}

export interface PrVerdict {
  /** Stored as a real boolean. `first_time` is deliberately NOT a PR. */
  isPr: boolean
  kinds: PrKind[]
  /** Null when this is not a record. */
  scope: PrScope | null
  /** The position this was judged at, so the stamp can name it. */
  setOrdinal: number
  /** The best set at this POSITION — what the candidate was actually measured against. */
  previousBest: PriorSet | null
  /** One sentence naming what was beaten, for the stamp's tooltip and the timeline. */
  basis: string | null
}

/** What one comparison against one pool concluded. */
interface Beat {
  kinds: PrKind[]
  previousBest: PriorSet | null
  basis: string | null
}

const NOTHING: Beat = { kinds: [], previousBest: null, basis: null }

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
  const ordinal = candidate.set_ordinal
  const base = { setOrdinal: ordinal, isPr: false as const, scope: null }

  /**
   * The pool: every set ever done at THIS position, at this gym, on this side —
   * the whole record, not the last session.
   */
  const atPosition = history.filter(
    (s) => s.set_ordinal === ordinal && s.side === candidate.side,
  )

  /**
   * Nothing at this position is a **baseline, not a record** — the rule that stops
   * every first session being a wall of PRs, and the direct fix for the spreadsheet's
   * 335 flags. It now covers a fourth set added to a three-set exercise as well: there
   * is no set 4 to beat, so set 4 does not get a stamp for existing.
   */
  if (atPosition.length === 0) {
    return {
      ...base,
      kinds: ['first_time'],
      previousBest: null,
      basis:
        history.length === 0
          ? 'first time at this gym'
          : `first set ${ordinal} for this exercise at this gym`,
    }
  }

  // Position is the gate. Losing here ends it, whatever the rest of the record holds.
  const positional = compare(candidate, atPosition, loadType)
  if (positional.kinds.length === 0) {
    return { ...base, kinds: [], previousBest: positional.previousBest, basis: null }
  }

  // And then the rank: does it also beat every set of this exercise, from any position?
  const overall = compare(candidate, history, loadType)
  const allTime = overall.kinds.length > 0

  return {
    isPr: true,
    setOrdinal: ordinal,
    scope: allTime ? 'all_time' : 'set',
    kinds: allTime ? overall.kinds : positional.kinds,
    previousBest: positional.previousBest,
    basis: allTime
      ? `${overall.basis} — best of any set`
      : `set ${ordinal}: ${positional.basis}`,
  }
}

/**
 * The record standing at one position: the record to beat, shown on the row.
 *
 * Replayed through the same `compare` the stamp uses, oldest first. The first set
 * ever done here is the baseline; after that the record moves only to a set that beat
 * everything before it at this position. So it is constant across sessions until a
 * stamp is earned, and moves on exactly that set. A "best" picked by one axis (say
 * heaviest) would disagree with a volume or reps stamp, which is the same word for
 * two different things.
 */
export function standingRecord(
  history: readonly PriorSet[],
  ordinal: number,
  side: 'left' | 'right' | null,
  loadType: string,
): PriorSet | null {
  const atPosition = history
    // An incomplete row as the baseline could never be beaten — `compare` finds no
    // best in a pool of nulls — so it would freeze the record forever.
    .filter((s) => s.set_ordinal === ordinal && s.side === side && measured(s, loadType))
    // Stable sort, and ISO dates order lexicographically — no Date, no timezone.
    .sort((a, b) => (a.performed_on < b.performed_on ? -1 : a.performed_on > b.performed_on ? 1 : 0))

  let record: PriorSet | null = null
  for (const [i, s] of atPosition.entries()) {
    if (i === 0 || compare(s, atPosition.slice(0, i), loadType).kinds.length > 0) record = s
  }
  return record
}

const measured = (s: PriorSet, loadType: string): boolean =>
  loadType === 'duration'
    ? s.duration_sec !== null
    : loadType === 'bodyweight'
      ? s.reps !== null
      : s.weight_kg !== null && s.reps !== null

/**
 * The comparison itself, against whichever pool it is handed. Knows nothing about
 * positions — `detectPr` runs it twice, once per pool, and ranks the answers.
 */
function compare(candidate: Candidate, pool: readonly PriorSet[], loadType: string): Beat {
  if (pool.length === 0) return NOTHING

  if (loadType === 'duration') {
    const longest = pool.reduce<PriorSet | null>(
      (b, s) => (s.duration_sec !== null && (b === null || s.duration_sec > (b.duration_sec ?? 0)) ? s : b),
      null,
    )
    const held = candidate.duration_sec
    if (held === null || longest === null) return NOTHING
    if (held <= (longest.duration_sec ?? 0)) return { ...NOTHING, previousBest: longest }
    return {
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
    const lightest = pool.reduce<PriorSet | null>(
      (b, s) => (s.weight_kg !== null && (b === null || s.weight_kg < (b.weight_kg ?? Infinity)) ? s : b),
      null,
    )
    const assist = candidate.weight_kg
    const reps = candidate.reps
    if (assist === null || reps === null || lightest === null) return NOTHING

    const kinds: PrKind[] = []
    if (assist < (lightest.weight_kg ?? Infinity) && reps >= (lightest.reps ?? 0)) kinds.push('weight')
    else if (assist === lightest.weight_kg && reps > (lightest.reps ?? 0)) kinds.push('reps_at_weight')

    if (kinds.length === 0) return { ...NOTHING, previousBest: lightest }
    return {
      kinds,
      previousBest: lightest,
      basis: `${kg(assist)} assist × ${reps} beats ${kg(lightest.weight_kg!)} × ${lightest.reps} from ${lightest.performed_on}`,
    }
  }

  if (loadType === 'bodyweight') {
    // Reps are the axis when there is no external load; added weight, when present,
    // is compared as a weighted set.
    const anyWeighted = pool.some((s) => (s.weight_kg ?? 0) > 0)
    if (!anyWeighted && (candidate.weight_kg ?? 0) === 0) {
      const mostReps = pool.reduce<PriorSet | null>(
        (b, s) => (s.reps !== null && (b === null || s.reps > (b.reps ?? 0)) ? s : b),
        null,
      )
      const reps = candidate.reps
      if (reps === null || mostReps === null) return NOTHING
      if (reps <= (mostReps.reps ?? 0)) return { ...NOTHING, previousBest: mostReps }
      return {
        kinds: ['reps_at_weight'],
        previousBest: mostReps,
        basis: `${reps} reps beats ${mostReps.reps} from ${mostReps.performed_on}`,
      }
    }
    // Falls through to the weighted rules below.
  }

  // external_weight, and weighted bodyweight.
  const best = bestByWeight(pool)
  const weight = candidate.weight_kg
  const reps = candidate.reps
  if (weight === null || reps === null || best === null) return NOTHING

  const kinds: PrKind[] = []

  // A heavier set at this position, at any rep count.
  if (weight > best.weight_kg!) kinds.push('weight')

  /**
   * More reps at an equal-or-higher weight than the previous best AT THAT WEIGHT.
   * Compared against the best at this exact load rather than the overall best, or
   * a light set could never be a record no matter how many reps it carried.
   */
  const bestAtThisWeight = pool
    .filter((s) => s.weight_kg !== null && s.weight_kg === weight)
    .reduce<PriorSet | null>((b, s) => (b === null || (s.reps ?? 0) > (b.reps ?? 0) ? s : b), null)
  if (bestAtThisWeight !== null && reps > (bestAtThisWeight.reps ?? 0)) kinds.push('reps_at_weight')

  // A heavier single set by volume, which catches a rep jump at the same load that
  // the rule above misses when this exact weight has never been used.
  const bestVolume = pool.reduce((max, s) => Math.max(max, (s.weight_kg ?? 0) * (s.reps ?? 0)), 0)
  if (weight * reps > bestVolume) kinds.push('volume_set')

  if (kinds.length === 0) return { ...NOTHING, previousBest: best }

  return {
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

/**
 * `All-time record: New weight` / `Set 3 record: More reps`.
 *
 * The scope is spoken first because it is the part that carries weight. Four stamps
 * in one session all reading "Personal record" is how the word stopped meaning
 * anything in the spreadsheet; "set 3 record" is a smaller and truer claim.
 */
export function describeVerdict(verdict: PrVerdict): string {
  const what = describeKinds(verdict.kinds)
  return verdict.scope === 'all_time'
    ? `All-time record: ${what}`
    : `Set ${verdict.setOrdinal} record: ${what}`
}
