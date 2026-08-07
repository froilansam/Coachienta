import { labelOf } from '@/lib/domain/coach/priorities'
import type { Exercise } from './exercise'
import { checkRules, itemFor, type CriticalRule, type PlanItem } from './plan'
import type { History } from './progression'

/**
 * Turning a prompt like `PULL LEGS!` into a draft plan — the pure half.
 *
 * Everything here is testable without a model: the catalogue the model chooses from,
 * the instructions it is given, and the two guards applied to whatever comes back.
 * The guards are the point. A prompt asking the model to behave is a request; code
 * that drops an invented id and reorders a rule violation is a guarantee.
 */

// ---------------------------------------------------------------------------
// The catalogue
// ---------------------------------------------------------------------------
/**
 * One line per exercise: the id to quote, what it trains, and what was last done.
 *
 * Compact on purpose. The library is 57 rows and the whole catalogue rides in every
 * request against a 100k/day token cap, so a line is `id | name | group | pattern |
 * load` plus history only when there is any. Sending JSON per exercise roughly
 * tripled it for no gain in the model's accuracy at quoting an id.
 */
export function catalogueLine(exercise: Exercise, history: History | null): string {
  const base = [
    exercise.id,
    exercise.name,
    labelOf(exercise.muscle_group),
    exercise.movement_pattern,
    exercise.load_type,
  ].join(' | ')

  if (history === null || history.last_performed_on === null) return `${base} | never logged here`

  const last =
    history.last_duration_sec !== null
      ? `${history.last_duration_sec}s`
      : history.last_weight_kg !== null
        ? `${history.last_weight_kg}kg×${history.last_reps ?? '?'}`
        : `${history.last_reps ?? '?'} reps`
  const best = history.best_weight_kg !== null ? `, best ${history.best_weight_kg}kg` : ''
  const since = history.sessions_since !== null ? `, ${history.sessions_since} sessions ago` : ''

  return `${base} | last ${last} on ${history.last_performed_on}${best}${since}`
}

export function catalogue(
  exercises: readonly Exercise[],
  history: Readonly<Record<string, History>>,
): string {
  return exercises.map((e) => catalogueLine(e, history[e.id] ?? null)).join('\n')
}

// ---------------------------------------------------------------------------
// The prompt
// ---------------------------------------------------------------------------
/**
 * The five hard rules from §4.2a, stated as constraints rather than suggestions.
 *
 * Rule 1 is repeated in code (`keepKnownExercises`) and rule 2 is repeated in code
 * (`enforceCriticalOrder`) — deliberately. A model that ignores an instruction is
 * normal; a route that ships the result anyway is a bug.
 */
const HARD_RULES = `HOW TO BUILD THE PLAN

1. Choose ONLY from the catalogue, by exercise_id. Never invent a movement. If the
   library cannot cover the request, return fewer items and say so in \`notice\` —
   a short honest plan beats a plausible fictional one.
2. Obey every [CRITICAL] rule above. They are constraints, not preferences. A soft
   preference belongs in \`rationale\`, never in the item list.
3. Favour mechanical tension and progressive overload: compounds and high-tension
   choices first, and rep ranges that leave a clear target to beat next time.
4. Honour the physique priority order. Higher-ranked groups that fit the request get
   the volume first; do not bury them under work the prompt did not ask for.
5. Return a DRAFT only. It will be edited before anything is started, so do not
   apologise for it or hedge — pick.

REP RANGES
- Weighted work: a range about 4 reps wide, e.g. 8–12.
- A \`duration\` exercise is measured in SECONDS, not reps — use a range like 30–60.
- Never suggest a load or a weight. History numbers are attached by the database
  after you answer.`

export interface PlanPromptContext {
  /** The coach's own system prompt — rules, priorities, phase, facts. */
  coachPrompt: string
  catalogue: string
  gymName: string
  today: string
}

export function buildPlanPrompt(ctx: PlanPromptContext): string {
  return [
    ctx.coachPrompt,
    '',
    `TODAY IS ${ctx.today}. THE SESSION IS AT: ${ctx.gymName}.`,
    '',
    HARD_RULES,
    '',
    'EXERCISE CATALOGUE — id | name | muscle group | movement pattern | load type | history',
    ctx.catalogue,
  ].join('\n')
}

// ---------------------------------------------------------------------------
// Guard 1 — only exercises that exist (AC-2.15)
// ---------------------------------------------------------------------------
export interface DraftItem {
  exercise_id: string
  position: number
  target_sets: number
  target_rep_low: number
  target_rep_high: number
  why: string | null
}

export interface KeptItems {
  items: DraftItem[]
  /** Ids the model returned that are not in the library. Reported, never silent. */
  invented: string[]
  /** Names it listed twice. Kept once, at its first position. */
  duplicates: string[]
}

/**
 * Drops anything the library does not contain, de-duplicates, and renumbers.
 *
 * Renumbering matters: the model's `position` values arrive with gaps once an item is
 * dropped, and `position` is what the critical order rule is checked against.
 */
export function keepKnownExercises(
  items: readonly DraftItem[],
  byId: ReadonlyMap<string, Exercise>,
): KeptItems {
  const invented: string[] = []
  const duplicates: string[] = []
  const seen = new Set<string>()
  const kept: DraftItem[] = []

  for (const item of [...items].sort((a, b) => a.position - b.position)) {
    const exercise = byId.get(item.exercise_id)
    if (!exercise) {
      invented.push(item.exercise_id)
      continue
    }
    if (seen.has(item.exercise_id)) {
      duplicates.push(exercise.name)
      continue
    }
    seen.add(item.exercise_id)
    kept.push({ ...item, position: kept.length + 1 })
  }

  return { items: kept, invented, duplicates }
}

/** Turns kept draft items into the same `PlanItem[]` a template produces. */
export function hydrate(
  items: readonly DraftItem[],
  byId: ReadonlyMap<string, Exercise>,
): PlanItem[] {
  return items.flatMap((item) => {
    const exercise = byId.get(item.exercise_id)
    if (!exercise) return []
    const low = Math.min(item.target_rep_low, item.target_rep_high)
    const high = Math.max(item.target_rep_low, item.target_rep_high)
    return [
      {
        ...itemFor(exercise),
        target_sets: item.target_sets,
        rep_low: low,
        rep_high: high,
        // The model's own one-liner, so a draft row can say why it is there.
        progression_rule: item.why,
      },
    ]
  })
}

// ---------------------------------------------------------------------------
// Guard 2 — a critical order rule cannot appear broken (AC-2.16)
// ---------------------------------------------------------------------------
/**
 * Reorders until `checkRules` reports no violation, or gives up and says so.
 *
 * Uses the SAME checker the plan screen warns with, so there is one definition of
 * "shoulder press before chest" — a second implementation here would eventually
 * disagree with the warning banner, and then one of them would be lying.
 *
 * The move is minimal: the offending item goes to just after the item it should
 * follow. Bounded by the item count, because a rule pair that cannot be satisfied
 * would otherwise loop.
 */
export function enforceCriticalOrder(
  items: readonly PlanItem[],
  rules: readonly CriticalRule[],
): { items: PlanItem[]; moved: string[]; unresolved: string[] } {
  let current = [...items]
  const moved: string[] = []

  for (let pass = 0; pass < current.length; pass++) {
    const { violations } = checkRules(current, rules)
    if (violations.length === 0) return { items: current, moved, unresolved: [] }

    /**
     * `checkRules` names the offender and its blocker as `"<A> is at 1, before <B> at
     * 3."`. Reading them back out of the sentence keeps the two functions from
     * needing a second, parallel data channel to agree on.
     */
    const detail = violations[0]!.detail
    const match = detail.match(/^(.+?) is at (\d+), before (.+?) at (\d+)\.$/)
    if (!match) break

    const from = Number(match[2]) - 1
    const to = Number(match[4]) - 1
    // A violation always means the offender sits BEFORE its blocker. Anything else is
    // a checker change this function has not been taught, so it stops rather than
    // shuffling on a guess.
    if (from < 0 || to >= current.length || from >= to) break

    const next = [...current]
    const [offender] = next.splice(from, 1)
    /**
     * Inserted at `to`, not `to - 1`. Removing the earlier offender shifted the
     * blocker up one index, so `to` is now the slot immediately AFTER it — which is
     * the minimal move that satisfies the rule.
     */
    next.splice(to, 0, offender!)
    current = next
    moved.push(offender!.exercise.name)
  }

  const { violations } = checkRules(current, rules)
  return { items: current, moved, unresolved: violations.map((v) => v.title) }
}

// ---------------------------------------------------------------------------
/**
 * One sentence naming everything that was corrected or could not be honoured.
 *
 * Shown to the user rather than logged. A draft that was quietly edited by the server
 * is a draft you cannot reason about, and "the AI suggested this" has to mean it.
 */
export function draftNotice(parts: {
  modelNotice: string | null
  invented: readonly string[]
  duplicates: readonly string[]
  moved: readonly string[]
  unresolved: readonly string[]
}): string | null {
  const notes = [
    parts.modelNotice,
    parts.invented.length > 0
      ? `${parts.invented.length} suggested exercise${parts.invented.length === 1 ? '' : 's'} not in your library — dropped.`
      : null,
    parts.duplicates.length > 0 ? `Listed twice, kept once: ${parts.duplicates.join(', ')}.` : null,
    parts.moved.length > 0 ? `Reordered to satisfy a critical rule: ${parts.moved.join(', ')}.` : null,
    parts.unresolved.length > 0
      ? `Still breaks: ${parts.unresolved.join(', ')} — reorder before you start.`
      : null,
  ].filter((n): n is string => n !== null && n.trim() !== '')

  return notes.length === 0 ? null : notes.join(' ')
}
