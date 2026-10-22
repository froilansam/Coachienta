/**
 * Double progression: what to aim for next session, and the evidence for it.
 *
 * PRD-004 §3.4 specifies this as a SQL function, `next_session_targets(p_gym)`.
 * It is split here: SQL supplies the **evidence** (`exercise_history`), and this
 * pure function turns it into a suggestion. Two reasons —
 *
 * 1. §3.4 says the suggestion is "driven by the plan's own rep range", and that
 *    signature cannot see the plan. Passing the range in is the only honest way.
 * 2. Double progression is a rule with edge cases; as a pure function every one of
 *    them is testable with no database and no session data.
 *
 * The stale-snapshot problem §3.4 was solving is unaffected: nothing is stored.
 * Both halves are computed on read, so neither can go 57 days out of date the way
 * the spreadsheet's Next Session Targets tab did.
 */
export interface History {
  last_performed_on: string | null
  last_weight_kg: number | null
  last_reps: number | null
  last_duration_sec: number | null
  best_weight_kg: number | null
  best_reps: number | null
  best_on: string | null
  /** Sessions logged at this gym since the last time this exercise appeared. */
  sessions_since: number | null
}

export interface Target {
  /** What to do. One sentence, imperative. */
  suggestion: string
  /**
   * The evidence, always. A suggestion without its basis is unauditable — the
   * spreadsheet's targets had no basis and nobody could tell they were 57 days old
   * (§3.4, AC-2.8).
   */
  basis: string
  kind: 'baseline' | 'add_load' | 'add_reps' | 'hold' | 'plateau'
  /**
   * Kg to put on set 1. Null when there is no load to copy (a baseline, a
   * hold, a plank). The live session prefills the first empty set from this.
   */
  loadKg: number | null
}

/** Smallest usable jump. Machines and dumbbells rarely offer less. */
const INCREMENT_KG = 2.5
/** Sessions without progress before it stops being a bad day and starts being a wall. */
const PLATEAU_SESSIONS = 3
/**
 * A working set is under this many reps. At or above it the load was light
 * enough to suggest going up — but only when the PR cleared it too.
 */
const WORKING_REP_CAP = 12

const kg = (n: number): string => `${Number.isInteger(n) ? n : n.toFixed(1)} kg`

/**
 * `repLow`/`repHigh` come from the plan row, so the same exercise can carry a
 * different target on a strength day and a specialisation day.
 */
export function suggestTarget(
  history: History | null,
  repLow: number | null,
  repHigh: number | null,
  loadType: string,
): Target {
  // No history at this gym is not a failure and not a PR — it is a baseline (§3.3).
  if (!history || history.last_performed_on === null) {
    return {
      kind: 'baseline',
      loadKg: null,
      suggestion:
        loadType === 'duration'
          ? `Establish a baseline — hold for ${repLow ?? 30} s and note how it felt`
          : 'Establish a baseline — find a working weight',
      basis: 'no history for this exercise at this gym',
    }
  }

  const on = history.last_performed_on
  const since = history.sessions_since ?? 0

  if (loadType === 'duration') {
    const last = history.last_duration_sec ?? 0
    const top = repHigh ?? last + 10
    const next = Math.min(last + 5, top)
    return {
      kind: last >= top ? 'add_load' : 'add_reps',
      loadKg: null,
      suggestion: last >= top ? `Hold ${top} s, then add load or a harder variation` : `Hold ${next} s`,
      basis: `from ${on}: ${last} s${repLow && repHigh ? `, target ${repLow}–${repHigh} s` : ''}`,
    }
  }

  const lastWeight = history.last_weight_kg
  const lastReps = history.last_reps
  if (lastWeight === null || lastReps === null) {
    return {
      kind: 'hold',
      loadKg: null,
      suggestion: 'Repeat last session and record weight and reps',
      basis: `from ${on}: incomplete record`,
    }
  }

  /**
   * Weighted work progresses on a fixed rep cap, not the plan's range.
   *
   * The heaviest set is what `exercise_history` already hands in, so a lighter
   * high-rep set never becomes next session's set 1 on its own. The load goes
   * up one increment only when BOTH that last set and the PR reached the cap.
   * Otherwise set 1 stays at the heavier of the two — a 12-rep day below your
   * PR does not jump past a PR that is still under 12, and a light last session
   * does not forget the PR.
   *
   *   last 15 kg × 11, PR 15 kg × 8   →  15 kg
   *   last 15 kg × 12, PR 20 kg × 8   →  20 kg
   *   last 15 kg × 12, PR 15 kg × 12  →  17.5 kg
   */
  if (loadType === 'external_weight' || (loadType === 'bodyweight' && lastWeight > 0)) {
    const bestWeight = history.best_weight_kg
    const bestReps = history.best_reps
    const hasPr = bestWeight !== null && bestReps !== null
    const lastCleared = lastReps >= WORKING_REP_CAP
    const prCleared = hasPr && bestReps >= WORKING_REP_CAP
    const heavier = hasPr ? Math.max(lastWeight, bestWeight) : lastWeight
    const goUp = lastCleared && (!hasPr || prCleared)
    const next = goUp ? heavier + INCREMENT_KG : heavier
    const lastBit = `last ${on}: ${kg(lastWeight)} × ${lastReps}`
    const prBit = hasPr ? `; PR ${kg(bestWeight)} × ${bestReps} on ${history.best_on}` : ''
    return {
      kind: goUp ? 'add_load' : 'hold',
      loadKg: next,
      suggestion: `${kg(next)} on set 1`,
      basis: goUp
        ? hasPr
          ? `${lastBit}${prBit} — ${WORKING_REP_CAP} reps or more on both, add load`
          : `${lastBit} — ${WORKING_REP_CAP} reps or more, add load`
        : `${lastBit}${prBit} — under ${WORKING_REP_CAP}, stay at ${kg(next)}`,
    }
  }

  const evidence = `from ${on}: ${kg(lastWeight)} × ${lastReps}`
  const range = repLow !== null && repHigh !== null ? `${repLow}–${repHigh} range` : null

  /**
   * A plateau is judged before the rep range, because "add a rep" is bad advice
   * after three sessions of not adding one.
   */
  if (since >= PLATEAU_SESSIONS && history.best_weight_kg !== null && lastWeight < history.best_weight_kg) {
    return {
      kind: 'plateau',
      loadKg: null,
      suggestion: 'Plateau — take a back-off week or switch to a variation',
      basis: `${evidence}; best ${kg(history.best_weight_kg)} on ${history.best_on}, ${since} sessions since`,
    }
  }

  if (repHigh !== null && lastReps >= repHigh) {
    // Top of the range: the load goes up and the reps reset to the bottom.
    const next = lastWeight + INCREMENT_KG
    return {
      kind: 'add_load',
      loadKg: null,
      suggestion: `${kg(next)} × ${repLow ?? repHigh}`,
      basis: `${evidence}, top of ${range ?? 'the range'}`,
    }
  }

  if (repLow !== null && lastReps < repLow) {
    // Below the range: hold the load and chase the bottom of it.
    return {
      kind: 'hold',
      loadKg: null,
      suggestion: `${kg(lastWeight)} × ${repLow}`,
      basis: `${evidence}, below ${range ?? 'the range'}`,
    }
  }

  return {
    kind: 'add_reps',
    loadKg: null,
    suggestion: `${kg(lastWeight)} × ${lastReps + 1}`,
    basis: `${evidence}, inside ${range ?? 'the range'}`,
  }
}

/** `10 kg × 13 · 2026-06-09`, or `—` when there is nothing at this gym (US-2.15). */
export function describeLast(h: History | null, loadType: string): string {
  if (!h || h.last_performed_on === null) return '—'
  if (loadType === 'duration') return `${h.last_duration_sec ?? 0} s · ${h.last_performed_on}`
  if (h.last_weight_kg === null || h.last_reps === null) return `— · ${h.last_performed_on}`
  return `${kg(h.last_weight_kg)} × ${h.last_reps} · ${h.last_performed_on}`
}

export function describeBest(h: History | null, loadType: string): string {
  if (!h || h.best_on === null) return '—'
  if (loadType === 'duration') return `${h.last_duration_sec ?? 0} s · ${h.best_on}`
  if (h.best_weight_kg === null || h.best_reps === null) return `— · ${h.best_on}`
  return `${kg(h.best_weight_kg)} × ${h.best_reps} · ${h.best_on}`
}
