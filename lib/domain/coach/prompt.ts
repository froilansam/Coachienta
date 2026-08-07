/**
 * Assembles the coach's system prompt from the rules registry.
 *
 * **This function is the only place a prompt is built** (AC-4.12). The preview on
 * `/profile` renders exactly this string, so what you inspect is byte-for-byte
 * what `/api/ai/chat` will send in P4. A preview built by a second code path would
 * be a mock-up that drifts, and an unverifiable prompt is how the spreadsheet's
 * "Coach Agent" tab ended up describing behaviour the agent never had.
 *
 * Pure: rules in, string out. No model, no I/O, no React.
 */
export interface Rule {
  category: string
  title: string
  content: string
  priority: number
  is_critical: boolean
}

export interface PromptContext {
  displayName: string | null
  /** Only what the coach is entitled to cite — all of it stored, none inferred. */
  phaseLabel: string | null
  weightKg: number | null
  weightOn: string | null
  targetSummary: string | null
  priorities: string[]
  medicalNotes: string | null
  today: string
}

/**
 * Categories in the order they belong in a prompt.
 *
 * Persona first because it frames everything after it; safety second because a
 * constraint stated after the instruction it constrains reads as an afterthought.
 * Output format last, closest to where the model starts writing.
 */
const CATEGORY_ORDER = [
  'persona',
  'safety',
  'nutrition',
  'training',
  'exercise_order',
  'progression',
  'planning',
  'phase',
  'logging',
  'interaction',
  'output_format',
] as const

const rank = (category: string): number => {
  const i = CATEGORY_ORDER.indexOf(category as (typeof CATEGORY_ORDER)[number])
  // An unknown category sorts after every known one rather than silently first.
  return i === -1 ? CATEGORY_ORDER.length : i
}

/**
 * Critical rules first within a category, then by stored priority.
 *
 * Criticals lead because AC-4.8 requires them to be *enforced*, not merely
 * present — and a model attends to what comes first.
 */
export function orderRules(rules: readonly Rule[]): Rule[] {
  return [...rules].sort(
    (a, b) =>
      rank(a.category) - rank(b.category) ||
      Number(b.is_critical) - Number(a.is_critical) ||
      a.priority - b.priority ||
      a.title.localeCompare(b.title),
  )
}

const HEADING: Record<string, string> = {
  persona: 'WHO YOU ARE',
  safety: 'SAFETY — NON-NEGOTIABLE',
  nutrition: 'NUTRITION',
  training: 'TRAINING',
  exercise_order: 'EXERCISE ORDER',
  progression: 'PROGRESSION',
  planning: 'PLANNING',
  phase: 'CURRENT PHASE',
  logging: 'LOGGING',
  interaction: 'HOW TO TALK',
  output_format: 'OUTPUT FORMAT',
}

export function buildCoachPrompt(rules: readonly Rule[], ctx: PromptContext): string {
  const lines: string[] = []

  const facts: string[] = [`Today is ${ctx.today}.`]
  if (ctx.displayName) facts.push(`You are coaching ${ctx.displayName}.`)
  if (ctx.weightKg !== null) {
    facts.push(`Current weight ${ctx.weightKg} kg${ctx.weightOn ? ` (measured ${ctx.weightOn})` : ''}.`)
  }
  if (ctx.phaseLabel) facts.push(`Active phase: ${ctx.phaseLabel}.`)
  if (ctx.targetSummary) facts.push(`Active targets: ${ctx.targetSummary}.`)
  if (ctx.priorities.length > 0) {
    facts.push(`Physique priority order: ${ctx.priorities.join(' > ')}.`)
  }
  if (ctx.medicalNotes) facts.push(`Medical constraints: ${ctx.medicalNotes}`)

  lines.push('FACTS')
  // Dated and sourced, so the model cites rather than invents. Every one of these
  // is a stored row, which is what makes the answers checkable.
  for (const f of facts) lines.push(`- ${f}`)

  let current: string | null = null
  for (const rule of orderRules(rules)) {
    if (rule.category !== current) {
      current = rule.category
      lines.push('', HEADING[current] ?? current.replace(/_/g, ' ').toUpperCase())
    }
    lines.push(`- ${rule.is_critical ? '[CRITICAL] ' : ''}${rule.title}: ${rule.content}`)
  }

  return lines.join('\n')
}

/** Rough token count for the preview. Four characters per token is close enough
 *  to answer "is this prompt getting out of hand?" and nothing finer is needed. */
export const estimateTokens = (prompt: string): number => Math.ceil(prompt.length / 4)
