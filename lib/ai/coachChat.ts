import 'server-only'
import { coachContext } from './coachContext'
import { listGyms } from '@/lib/db/queries/plan'
import { todayLocal } from '@/lib/domain/date'
import { BUDGET } from '@/lib/domain/coach/budget'
import type { Finding } from '@/lib/domain/coach/consistency'

/**
 * The coach's system prompt, assembled fresh on every turn (PRD-005 §3.1).
 *
 * ## Why fresh, every time
 *
 * This is the direct fix for the spreadsheet's worst defect. Its Coach Agent tab
 * hardcoded `Current Weight | 64kg` and derived every calorie figure from it. Actual
 * weight was 70 kg — so every number in the coach's instructions was wrong, while that
 * same tab was labelled "source of truth".
 *
 * Facts here are **queried, never written as prose**. The coach cannot cite a stale
 * weight because no stale weight exists anywhere it can reach. `coachContext()` does the
 * querying and is the single assembly path shared with `/profile`'s prompt preview and
 * the plan builder (AC-4.12) — so what you inspect on that screen is what is sent.
 */
export interface CoachPrompt {
  system: string
  today: string
  gymId: string | null
  findings: Finding[]
}

/**
 * Instructions, not decoration. Each line here exists because of an observed failure:
 *
 * - **State coverage** — the model averaged whatever it was handed and called it a week.
 * - **State the range you chose** — asked twice for "last week", it picked two different
 *   seven-day windows. Neither was wrong; both needed saying (§6).
 * - **No padding** — during probing it appended "Today is day 220 of the year 2026",
 *   invented and unrequested. A coach that embellishes cannot be trusted on the numbers
 *   either.
 */
const CONTRACT = `HOW TO ANSWER

1. Any claim about a number comes from a tool. Never estimate, never recall a figure
   from earlier in the conversation as if it were fresh — call the tool again.
2. STATE YOUR COVERAGE. Every tool returns \`row_count\` / \`logged_days\`. Say it:
   "across 7 logged days", "over the 2 days you logged". Averaging two days and calling
   it a week is the single worst thing you can do here.
3. When the user's date phrase is vague ("recently", "last week"), resolve it against
   TODAY, then SAY WHICH RANGE YOU USED in the answer.
4. A tool returning no rows means there is no data. Say so plainly and suggest what to
   log. Never fill the gap with a plausible number.
5. Flag estimates as estimates. \`verified_pct\` tells you how much of an average rests
   on unconfirmed entries — if it is low, say the average is approximate.
6. Obey every [CRITICAL] rule above. If the user asks for something one forbids, name the
   rule and ask whether it changed. Do not silently override it, and do not silently
   comply.
7. Be specific with advice. "Add 2 tbsp peanut butter: +190 kcal, 8 g protein" — never
   "eat more calorie-dense foods".
8. No padding. No preamble, no restating the question, no invented flourishes about the
   date or the weather. Lead with the answer.
9. Bold the numbers that matter. Keep it under 200 words unless asked for more.`

/** Contradictions already computed for `/profile`, injected so the coach can raise them. */
function findingsBlock(findings: readonly Finding[]): string {
  if (findings.length === 0) return ''
  const lines = findings.map((f) => `- [${f.severity.toUpperCase()}] ${f.message}`)
  return `\nCONTRADICTIONS ALREADY DETECTED IN THE USER'S OWN DATA
These come from stored rows, not from you. Raise the relevant one when it bears on the
question — this is the most useful thing you do (§3.7). Do not repeat one that does not.
${lines.join('\n')}`
}

export async function buildCoachPrompt(): Promise<CoachPrompt> {
  const [coach, gyms] = await Promise.all([coachContext(), listGyms()])
  const today = todayLocal()
  const gymId = gyms.find((g) => g.is_current)?.id ?? gyms[0]?.id ?? null
  const gymName = gyms.find((g) => g.id === gymId)?.name ?? null

  const system = [
    coach.prompt,
    '',
    `TODAY IS ${today}.${gymName ? ` The current gym is ${gymName}.` : ''}`,
    'Training figures — volume, PRs, priorities — are scoped to that gym; a load at one gym is not the same load at another.',
    findingsBlock(coach.findings),
    '',
    CONTRACT,
  ]
    .filter((part) => part !== '')
    .join('\n')

  return { system, today, gymId, findings: coach.findings }
}

/**
 * A guard, not a hope (AC-3.11).
 *
 * The system prompt is the one component whose size we control completely, and it grows
 * silently: every new coach rule the user adds lands in it. If it ever exceeds its
 * share of the budget the route logs it rather than letting the whole turn quietly cost
 * double.
 */
export const systemPromptWarning = (system: string): string | null => {
  const tokens = Math.ceil(system.length / 4)
  return tokens > BUDGET.system
    ? `system prompt is ~${tokens} tokens, over its ${BUDGET.system} budget — trim coach rules`
    : null
}
