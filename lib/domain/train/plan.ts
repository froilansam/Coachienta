import type { Exercise } from './exercise'

/**
 * A day plan, before it becomes a session. Pure.
 *
 * `position` is not cosmetic: it is what makes the critical coach rule
 * "shoulder press before chest" enforceable rather than merely stated (§4.2,
 * AC-2.11, AC-2.16). Reordering is therefore a first-class operation, not a nicety.
 */
export interface PlanItem {
  exercise: Exercise
  target_sets: number
  rep_low: number | null
  rep_high: number | null
  /** Carried from the template so the reason for the range survives into the day. */
  progression_rule: string | null
}

export const DEFAULT_SETS = 3

/** A picked exercise with no template behind it still needs a sane starting point. */
export function itemFor(exercise: Exercise): PlanItem {
  const duration = exercise.load_type === 'duration'
  return {
    exercise,
    target_sets: DEFAULT_SETS,
    rep_low: duration ? 30 : 8,
    rep_high: duration ? 60 : 12,
    progression_rule: null,
  }
}

export function move(items: readonly PlanItem[], index: number, delta: number): PlanItem[] {
  const to = index + delta
  if (index < 0 || index >= items.length || to < 0 || to >= items.length) return [...items]
  const next = [...items]
  const [moved] = next.splice(index, 1)
  next.splice(to, 0, moved!)
  return next
}

export const remove = (items: readonly PlanItem[], index: number): PlanItem[] =>
  items.filter((_, i) => i !== index)

export function patch(
  items: readonly PlanItem[],
  index: number,
  fields: Partial<Omit<PlanItem, 'exercise'>>,
): PlanItem[] {
  return items.map((it, i) => (i === index ? { ...it, ...fields } : it))
}

/** Appending: a newly picked exercise goes last until it is moved. */
export function add(items: readonly PlanItem[], exercise: Exercise): PlanItem[] {
  return [...items, itemFor(exercise)]
}

// ---------------------------------------------------------------------------
// Critical coach rules (AC-2.11)
// ---------------------------------------------------------------------------

export interface CriticalRule {
  title: string
  content: string
  category: string
}

/**
 * Order rules the plan can actually be checked against.
 *
 * Deliberately narrow: it matches only rules whose text names two muscle groups in
 * a "X before Y" shape, because a general-purpose rule interpreter would produce
 * confident nonsense. A rule it cannot parse is left to the user rather than
 * silently treated as satisfied — `unchecked` says which those are.
 */
const ORDER_PATTERN = /\b(shoulder|ohp|overhead)\b[^.]*\bbefore\b[^.]*\b(chest|press)\b/i

export interface RuleCheck {
  /** Rules this plan appears to break, with the rule named (AC-2.11). */
  violations: Array<{ title: string; detail: string }>
  /** Critical rules that could not be checked mechanically. Shown, not hidden. */
  unchecked: string[]
}

export function checkRules(items: readonly PlanItem[], rules: readonly CriticalRule[]): RuleCheck {
  const violations: RuleCheck['violations'] = []
  const unchecked: string[] = []

  const firstIndexOf = (test: (e: Exercise) => boolean) => items.findIndex((it) => test(it.exercise))

  /**
   * A shoulder press, identified WITHOUT trusting `movement_pattern`.
   *
   * The seeded `Shoulder Press Machine` is stored `vertical_pull` — the same import
   * fault as the chest presses. Requiring `vertical_push` meant the checker silently
   * found no shoulder press and reported no violation, so a rule the user marked
   * CRITICAL was quietly unenforced. `muscle_group` is the field that is reliable
   * here, and the name confirms it is a press rather than a raise.
   */
  const isShoulderPress = (e: Exercise) =>
    e.muscle_group === 'shoulders_front' &&
    (e.movement_pattern === 'vertical_push' ||
      e.movement_pattern === 'horizontal_push' ||
      /\b(press|ohp)\b/i.test(e.name))

  for (const rule of rules) {
    if (ORDER_PATTERN.test(rule.content) || ORDER_PATTERN.test(rule.title)) {
      const shoulder = firstIndexOf(isShoulderPress)
      const chest = firstIndexOf((e) => e.muscle_group === 'chest')
      if (shoulder !== -1 && chest !== -1 && chest < shoulder) {
        violations.push({
          title: rule.title,
          detail: `${items[chest]!.exercise.name} is at ${chest + 1}, before ${items[shoulder]!.exercise.name} at ${shoulder + 1}.`,
        })
      }
      continue
    }

    // A safety rule about what NOT to train is checkable by muscle group.
    if (rule.category === 'safety' && /oblique/i.test(rule.content)) {
      const offending = items.find(
        (it) => it.exercise.muscle_group === 'abs_core' && it.exercise.load_type !== 'duration',
      )
      if (offending) {
        violations.push({
          title: rule.title,
          detail: `${offending.exercise.name} is loaded core work. This rule allows plank-based work only.`,
        })
      }
      continue
    }

    unchecked.push(rule.title)
  }

  return { violations, unchecked }
}

/** `5 exercises · 15 sets` — the plan's own summary line. */
export function summarise(items: readonly PlanItem[]): string {
  const sets = items.reduce((n, i) => n + i.target_sets, 0)
  return `${items.length} exercise${items.length === 1 ? '' : 's'} · ${sets} set${sets === 1 ? '' : 's'}`
}

export const canStart = (items: readonly PlanItem[]): boolean => items.length > 0
