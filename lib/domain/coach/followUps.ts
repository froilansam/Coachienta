/**
 * The chips above the input (PRD-005 §3.8).
 *
 * §3.8 requires these to be "generated from the answer's context, not a static list".
 * They are derived from **which tools the last answer actually called**, which is
 * context the client already has — no second model call, no extra tokens, and it cannot
 * suggest a follow-up about data the coach did not look at.
 *
 * Pure.
 */

/** Question openers, by the tool that just ran. First entry is the strongest follow-on. */
const AFTER: Record<string, string[]> = {
  get_nutrition_averages: ['What about my carbs?', 'Compare that to the month before', 'Which days missed?'],
  get_nutrition_summary: ['Which day was highest?', 'How did that track against target?'],
  get_food_frequency: ['Where are most of my calories coming from?', 'What should I swap?'],
  get_session_summary: ['How does that compare to last month?', 'Which muscle groups did I hit?'],
  get_exercise_progression: ['What should I lift next session?', 'Am I plateauing?'],
  get_volume_by_muscle_group: ['Am I training my priorities?', 'What is under-trained?'],
  get_prs: ['What is closest to a new PR?', 'Show me my progression there'],
  get_priority_adherence: ['How do I fix that split?', 'What should next week look like?'],
  get_body_trend: ['Is that on track for my phase?', 'What should I change?'],
  get_coach_rules: ['Which rules are critical?', 'Does that conflict with anything?'],
}

/** Shown before the first question, and whenever nothing better can be derived. */
export const OPENING_PROMPTS = [
  'What was my average protein last week?',
  'Am I progressing on lateral raises?',
  'Am I training what I said I would?',
  'How am I doing?',
] as const

const normalise = (s: string): string => s.trim().toLowerCase().replace(/[?.!]+$/, '')

/**
 * Never more than three: the row scrolls horizontally, and a fourth chip is one nobody
 * reads. Deduplicated across tools, because two nutrition tools in one turn otherwise
 * suggest the same follow-up twice.
 *
 * `asked` removes questions already put to the coach in this thread. Without it, an
 * answer that used no tools re-offered the very chip just tapped — which reads as the
 * tap not having worked.
 */
export function followUpsFor(
  toolNames: readonly string[],
  asked: readonly string[] = [],
  limit = 3,
): string[] {
  const used = new Set(asked.map(normalise))
  const fresh = (list: readonly string[]) => list.filter((q) => !used.has(normalise(q)))

  if (toolNames.length === 0) return fresh(OPENING_PROMPTS).slice(0, limit)

  const seen = new Set<string>()
  const out: string[] = []

  // Breadth first: one suggestion per tool before a second from any of them, so a
  // multi-tool answer offers follow-ups across both subjects rather than both about one.
  for (let depth = 0; depth < 3 && out.length < limit; depth++) {
    for (const name of toolNames) {
      const candidate = AFTER[name]?.[depth]
      if (candidate === undefined || seen.has(candidate) || used.has(normalise(candidate))) continue
      seen.add(candidate)
      out.push(candidate)
      if (out.length >= limit) break
    }
  }

  return out.length > 0 ? out : fresh(OPENING_PROMPTS).slice(0, limit)
}
