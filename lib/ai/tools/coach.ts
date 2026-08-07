import 'server-only'
import { tool } from 'ai'
import { z } from 'zod'
import {
  bodyTrend,
  exerciseProgression,
  foodFrequency,
  nutritionAverages,
  nutritionSummary,
  priorityAdherence,
  prs,
  sessionSummary,
  volumeByMuscleGroup,
} from '@/lib/db/queries/coach'
import { getActiveRules } from '@/lib/db/queries/goals'

/**
 * The coach's calculator (PRD-005 §3.2).
 *
 * ## Why tools rather than retrieval
 *
 * Most fitness questions are arithmetic questions, and arithmetic needs **every** row,
 * exactly. Vector search returns the most *similar* rows — a different idea entirely.
 * Ask "average protein last week" of a pure-RAG coach and it averages the four days it
 * happened to retrieve, then states a precise number with total confidence. These tools
 * make the number exact by construction.
 *
 * ## Why the model cannot write SQL
 *
 * It would be more flexible and it would be a hole: a model that can write queries can
 * eventually be talked into writing a destructive one. It may only call these functions
 * with Zod-validated parameters (AC-3.12) — a vending machine, not the keys to the
 * warehouse.
 *
 * ## Two rules every tool here obeys
 *
 * - **Return the row count.** The model is instructed to state its coverage, and it
 *   cannot do that honestly without knowing it. "Across 7 logged days" and "across the
 *   2 days you logged" are different answers to the same question.
 * - **Empty is a result, not an error.** `{ row_count: 0 }` lets the coach say "nothing
 *   logged in that range" instead of inventing a number (AC-3.13).
 *
 * Both behaviours are applied by `readOnly()` rather than repeated in ten tools.
 */
const DateStr = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .describe('ISO date, YYYY-MM-DD. Resolve relative phrases against the date in the prompt.')

/** Days-back, for the training RPCs that anchor on `current_date` rather than a range. */
const daysBack = (start: string, today: string): number => {
  const ms = new Date(`${today}T00:00:00Z`).getTime() - new Date(`${start}T00:00:00Z`).getTime()
  return Math.max(Math.ceil(ms / 86_400_000), 1)
}

export interface CoachToolContext {
  /** Injected, never assumed by the model (§3.2). */
  today: string
  /** PRs, volume and priorities are all gym-scoped (PRD-004 §3.2). */
  gymId: string | null
}

export function coachTools(ctx: CoachToolContext) {
  /**
   * Per-turn memo and empty-result annotation, wrapped around every tool.
   *
   * Two behaviours, both found by probing the real model:
   *
   * 1. **Identical calls are answered once.** Asked "how many sessions this month" it
   *    called `get_session_summary` twice with byte-identical arguments — models retry
   *    when a result comes back empty. The retry still costs a model round trip, but it
   *    no longer costs a second query.
   * 2. **An empty result says it is final.** `{ row_count: 0 }` alone reads to the model
   *    as "maybe try again"; saying so explicitly is what stops the loop. This is also
   *    what makes AC-3.13 hold — the coach reports the absence instead of filling it.
   *
   * The Map lives in this closure, so its lifetime is exactly one request.
   */
  const answered = new Map<string, Promise<object>>()

  const readOnly = <A extends object>(
    name: string,
    run: (args: A) => Promise<object>,
  ): ((args: A) => Promise<object>) => {
    return (args: A) => {
      const key = `${name}:${JSON.stringify(args)}`
      const cached = answered.get(key)
      if (cached) return cached

      const pending = run(args).then((result) => {
        const count = (result as { row_count?: unknown }).row_count
        return count === 0
          ? {
              ...result,
              note: 'No rows exist for those parameters. This is the complete and final answer — do not call this tool again for the same range. Tell the user there is no data logged there.',
            }
          : result
      })
      answered.set(key, pending)
      return pending
    }
  }

  /**
   * Gym-scoped tools degrade to an empty result rather than throwing.
   *
   * Annotated `Promise<object>` deliberately: a union of "the real shape" and "the
   * empty shape" gives the tool helper nothing concrete to infer an output type from.
   * Tool results are JSON the model reads structurally, so the wider type costs
   * nothing here and keeps every gym-scoped tool on one path.
   */
  const needGym = (run: (gymId: string) => Promise<object>): Promise<object> =>
    ctx.gymId === null
      ? Promise.resolve({ row_count: 0, note: 'No gym is set up, so training data is not scoped yet.' })
      : run(ctx.gymId)

  return {
    // -- nutrition ----------------------------------------------------------
    get_nutrition_averages: tool({
      description:
        'Exact mean, median and standard deviation per macro across a date range, with the number of logged days and the share of entries that are verified rather than estimated. Use this for ANY average, typical or "how have I been eating" question.',
      inputSchema: z.object({ start_date: DateStr, end_date: DateStr }),
      execute: readOnly('get_nutrition_averages', ({ start_date, end_date }) => nutritionAverages(start_date, end_date)),
    }),

    get_nutrition_summary: tool({
      description:
        'Per-day (or per-week) kcal and macro totals with the target that applied on each day, and whether it was a gym day. Use this to compare days, find the highest or lowest, or show a trend.',
      inputSchema: z.object({
        start_date: DateStr,
        end_date: DateStr,
        group_by: z.enum(['day', 'week']).default('day'),
      }),
      execute: readOnly('get_nutrition_summary', ({ start_date, end_date, group_by }) =>
        nutritionSummary(start_date, end_date, group_by)),
    }),

    get_food_frequency: tool({
      description:
        'The most-logged foods in a range, with how much of total calories each accounts for. Use this for "what am I actually eating" and for finding where calories come from.',
      inputSchema: z.object({
        start_date: DateStr,
        end_date: DateStr,
        limit: z.number().int().min(1).max(25).default(10),
      }),
      execute: readOnly('get_food_frequency', ({ start_date, end_date, limit }) => foodFrequency(start_date, end_date, limit)),
    }),

    // -- training -----------------------------------------------------------
    get_session_summary: tool({
      description:
        'Workout sessions in a range with set count, volume-eligible kilograms, PR count and gym. Use this for "how many sessions", "how much did I train", or session-level comparisons.',
      inputSchema: z.object({ start_date: DateStr, end_date: DateStr }),
      execute: readOnly('get_session_summary', ({ start_date, end_date }) => sessionSummary(start_date, end_date)),
    }),

    get_exercise_progression: tool({
      description:
        'Chronological top sets for one exercise with an estimated 1RM per session, so progression is visible. Use this for "am I progressing on X". Name the exercise as the user said it.',
      inputSchema: z.object({
        exercise_name: z.string().min(2).describe('e.g. "lateral raises", "lat pulldown"'),
        limit: z.number().int().min(2).max(30).default(12),
      }),
      execute: readOnly('get_exercise_progression', ({ exercise_name, limit }) => exerciseProgression(exercise_name, limit)),
    }),

    get_volume_by_muscle_group: tool({
      description:
        'Volume-eligible kilograms and set count per muscle group, plus an `unattributed_kg` figure that must be zero. Timed, assisted and unweighted work carries no kilograms by definition — it is counted as sets.',
      inputSchema: z.object({ start_date: DateStr, end_date: DateStr }),
      execute: readOnly('get_volume_by_muscle_group', ({ start_date }: { start_date: string }) =>
        needGym((gymId) => volumeByMuscleGroup(gymId, daysBack(start_date, ctx.today))),
      ),
    }),

    get_prs: tool({
      description:
        'Personal records in a range, with what was beaten. A first attempt at an exercise is a baseline, not a record, and does not appear here.',
      inputSchema: z.object({ start_date: DateStr, end_date: DateStr }),
      execute: readOnly('get_prs', ({ start_date }) => needGym((gymId) => prs(gymId, daysBack(start_date, ctx.today)))),
    }),

    get_priority_adherence: tool({
      description:
        'The stated physique priority order against the share of volume each group actually received. Use this for "am I training what I said I would".',
      inputSchema: z.object({ start_date: DateStr, end_date: DateStr }),
      execute: readOnly('get_priority_adherence', ({ start_date }) => priorityAdherence(daysBack(start_date, ctx.today))),
    }),

    // -- body & policy ------------------------------------------------------
    get_body_trend: tool({
      description:
        'Weight, body-fat and waist readings in a range with the fitted weekly rate of change. The rate is null when the readings span under a week — say so rather than estimating one.',
      inputSchema: z.object({ start_date: DateStr, end_date: DateStr }),
      execute: readOnly('get_body_trend', ({ start_date, end_date }) => bodyTrend(start_date, end_date)),
    }),

    get_coach_rules: tool({
      description:
        'Active coach rules, optionally filtered by category. The critical ones are already in your instructions; use this to quote a rule exactly or to check a category you were not given.',
      inputSchema: z.object({
        category: z
          .string()
          .optional()
          .describe('e.g. "safety", "exercise_order", "progression", "nutrition"'),
      }),
      execute: readOnly('get_coach_rules', async ({ category }: { category?: string }) => {
        const rules = await getActiveRules()
        const matched = category
          ? rules.filter((r) => r.category === category.toLowerCase())
          : rules
        return {
          row_count: matched.length,
          rules: matched.map((r) => ({
            category: r.category,
            title: r.title,
            content: r.content,
            is_critical: r.is_critical,
          })),
        }
      }),
    }),
  }
}

export type CoachToolName = keyof ReturnType<typeof coachTools>
