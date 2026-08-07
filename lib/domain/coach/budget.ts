import { estimateTokens } from './prompt'

/**
 * The token budget, and the trimming that keeps a turn inside it (PRD-005 §3.4).
 *
 * Groq's free tier is 100,000 tokens a day. A naive chat resends the whole
 * conversation plus the system prompt plus every retrieved row each turn, which
 * exhausts that in roughly twenty exchanges. The budget below is what makes ~16 real
 * coaching conversations a day possible instead.
 *
 * Pure, so AC-3.11 ("total input tokens per turn ≤ 6,200") is a unit test rather than
 * a hope.
 */
export const BUDGET = {
  system: 1_200,
  history: 1_500,
  tools: 2_000,
  vector: 1_500,
  total: 6_200,
} as const

/** Turns kept verbatim before the rest is dropped (§3.4). */
export const VERBATIM_TURNS = 6

export interface Turn {
  role: 'user' | 'assistant'
  text: string
}

export interface TrimmedHistory {
  kept: Turn[]
  /** How many older turns were left out, so the UI can say the thread was shortened. */
  dropped: number
}

/**
 * Keeps the last `VERBATIM_TURNS` exchanges, then trims from the front until the
 * remainder fits the history budget.
 *
 * Drops whole turns rather than truncating text mid-sentence: half an answer is worse
 * context than no answer, because the model treats the fragment as complete.
 */
export function trimHistory(
  turns: readonly Turn[],
  maxTokens: number = BUDGET.history,
  verbatim: number = VERBATIM_TURNS,
): TrimmedHistory {
  // A "turn" here is one message; six exchanges is twelve of them.
  let kept = turns.slice(-verbatim * 2)
  let dropped = turns.length - kept.length

  while (kept.length > 2 && tokensOf(kept) > maxTokens) {
    kept = kept.slice(1)
    dropped += 1
  }

  return { kept: [...kept], dropped }
}

export const tokensOf = (turns: readonly Turn[]): number =>
  turns.reduce((n, t) => n + estimateTokens(t.text) + 4, 0)

export interface BudgetReport {
  system: number
  history: number
  tools: number
  total: number
  withinBudget: boolean
  /** Which component blew it, so a failure names its own cause. */
  over: string[]
}

export function budgetReport(parts: {
  system: string
  history: readonly Turn[]
  toolResults: readonly string[]
}): BudgetReport {
  const system = estimateTokens(parts.system)
  const history = tokensOf(parts.history)
  const tools = parts.toolResults.reduce((n, r) => n + estimateTokens(r), 0)
  const total = system + history + tools

  const over: string[] = []
  if (system > BUDGET.system) over.push('system')
  if (history > BUDGET.history) over.push('history')
  if (tools > BUDGET.tools) over.push('tools')
  if (total > BUDGET.total) over.push('total')

  return { system, history, tools, total, withinBudget: over.length === 0, over }
}

/**
 * Trivial turns route to the small model (§3.4).
 *
 * `llama-3.1-8b-instant` has 500k tokens/day — effectively unlimited — so "thanks"
 * should never cost a slice of the 70B's 100k. Deliberately conservative: it only
 * matches short messages with no question and no numbers, because misrouting a real
 * coaching question to the small model is far worse than paying for a "thanks".
 */
export function isTrivial(message: string): boolean {
  const text = message.trim().toLowerCase()
  if (text.length === 0 || text.length > 40) return false
  if (/[?0-9]/.test(text)) return false
  return /^(thanks|thank you|thx|ok|okay|got it|nice|cool|great|sige|salamat|yep|yes|no|sure)[\s!.]*$/.test(
    text,
  )
}
