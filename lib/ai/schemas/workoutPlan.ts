import { z } from 'zod'

/**
 * What the model is allowed to return for a day plan (PRD-004 §4.2a).
 *
 * ## The model picks; the database supplies numbers
 *
 * There is deliberately **no `today_target`, no LAST and no BEST here**, though
 * §4.2a's draft schema listed the first. Its very next sentence is the reason: *"do
 * not let the model invent history numbers"*. Those three come from `exercise_history()`
 * and `suggestTarget()` on the rows already loaded by the plan screen, exactly as
 * they do for a template plan — one code path, and a number that cannot be
 * fabricated. Same split as a nutrition label: the model transcribes structure, code
 * does the arithmetic.
 *
 * ## Prose is not bounded here
 *
 * `rationale` and `why` are plain strings with no `.max()`. A 430-character rationale
 * on an otherwise perfect plan was rejected outright by a `max(400)` during
 * development — the same failure direction as the label reader refusing legally-rounded
 * macros. `clampProse` cuts them when the response is mapped; the items are the
 * payload and the prose is commentary.
 *
 * ## Why `exercise_id` and not a name
 *
 * A name invites invention. An id can be checked against the library, and the route
 * drops any item whose id was not in the catalogue it was given (AC-2.15). The model
 * therefore cannot add a machine this gym does not have, however plausible.
 */
export const AiWorkoutPlanSchema = z.object({
  title: z.string().max(60).describe('Short session name, e.g. "Pull + Legs".'),
  rationale: z
    .string()
    .describe('Which coach rules and priorities drove these choices. Two or three sentences.'),
  notice: z
    .string()
    .nullable()
    .describe(
      'Set only when something asked for could NOT be honoured, e.g. "No rear-delt isolation in the library — used face pulls". Null when nothing was compromised.',
    ),
  items: z
    .array(
      z.object({
        exercise_id: z.string().describe('Must be an id from the catalogue. Never invent one.'),
        position: z.number().int().positive().describe('1 = first exercise performed.'),
        target_sets: z.number().int().min(1).max(10),
        target_rep_low: z.number().int().positive(),
        target_rep_high: z.number().int().positive(),
        why: z.string().nullable().describe('One short line, or null.'),
      }),
    )
    .min(1)
    .max(12),
})

export type AiWorkoutPlan = z.infer<typeof AiWorkoutPlanSchema>
export type AiWorkoutPlanItem = AiWorkoutPlan['items'][number]
