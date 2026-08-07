/**
 * `▸ DATA USED (2 sources)` — turning the tool calls that actually ran into something
 * checkable (PRD-005 §3.6).
 *
 * Pure, and derived from the **real** calls rather than a parallel channel the route
 * maintains by hand. That distinction is the point: a provenance panel that is
 * assembled separately from the queries can drift from them, and then it is worse than
 * nothing — it is a receipt for work that may not have happened.
 *
 * §3.6 calls this non-negotiable, and the reason is specific: the spreadsheet's coach
 * spent two months confidently coaching from a 64 kg bodyweight because nothing ever
 * showed its workings.
 */
export interface ToolCall {
  name: string
  input: Record<string, unknown>
  /** How many rows the tool aggregated over. Null while the call is still running. */
  rowCount: number | null
}

export interface SourceLine {
  tool: string
  /** The range or argument the model chose — the part worth auditing. */
  detail: string
  /** `7 days`, `3 matches`, or `no data`. */
  count: string
}

/** Human labels. The tool name is an identifier; this is what a person reads. */
const LABEL: Record<string, string> = {
  get_nutrition_summary: 'Nutrition by day',
  get_nutrition_averages: 'Nutrition averages',
  get_food_frequency: 'Most-logged foods',
  get_session_summary: 'Sessions',
  get_exercise_progression: 'Exercise progression',
  get_volume_by_muscle_group: 'Volume by muscle group',
  get_prs: 'Personal records',
  get_priority_adherence: 'Priority adherence',
  get_body_trend: 'Body measurements',
  get_coach_rules: 'Coach rules',
}

export const labelFor = (tool: string): string => LABEL[tool] ?? tool.replace(/_/g, ' ')

/** What the model chose, in the words it chose them. */
function detailOf(input: Record<string, unknown>): string {
  const start = input.start_date
  const end = input.end_date
  if (typeof start === 'string' && typeof end === 'string') return `${start} → ${end}`

  const named = input.exercise_name ?? input.category ?? input.query
  if (typeof named === 'string' && named.trim() !== '') return named

  const days = input.days
  if (typeof days === 'number') return `last ${days} days`
  return '—'
}

/**
 * `no data` rather than `0 rows`.
 *
 * A range with nothing in it is the honest answer to a lot of questions here, and it
 * must read as an answer rather than as a failure (AC-3.13).
 */
function countOf(rowCount: number | null, unit: string): string {
  if (rowCount === null) return 'running…'
  if (rowCount === 0) return 'no data'
  return `${rowCount} ${unit}${rowCount === 1 ? '' : 's'}`
}

const UNIT: Record<string, string> = {
  get_nutrition_summary: 'day',
  get_nutrition_averages: 'logged day',
  get_food_frequency: 'food',
  get_session_summary: 'session',
  get_exercise_progression: 'set',
  get_volume_by_muscle_group: 'group',
  get_prs: 'record',
  get_priority_adherence: 'priority',
  get_body_trend: 'reading',
  get_coach_rules: 'rule',
}

export function describeSources(calls: readonly ToolCall[]): SourceLine[] {
  return calls.map((c) => ({
    tool: labelFor(c.name),
    detail: detailOf(c.input),
    count: countOf(c.rowCount, UNIT[c.name] ?? 'row'),
  }))
}

/**
 * `Reading your last 7 logged days…` — the thinking line, naming the current tool.
 *
 * §3.8: four seconds of silence reads as broken, and generic filler ("Thinking…")
 * tells you nothing about whether it is doing the right thing. Naming the tool also
 * makes a wrong tool choice visible while it happens rather than afterwards.
 */
export function thinkingLabel(call: ToolCall | null): string {
  if (call === null) return 'Thinking…'
  const detail = detailOf(call.input)
  const what = labelFor(call.name).toLowerCase()
  return detail === '—' ? `Reading your ${what}…` : `Reading ${what}: ${detail}…`
}
