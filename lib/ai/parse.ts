/**
 * Making a model's raw output usable — the two pure pieces of it.
 *
 * Its own module with **no imports**: everything else under `lib/ai` is `server-only`
 * and reaches `lib/env`, which would put this out of reach of `npm test` (pure
 * functions only). Both of these have bitten in a way a test would have caught.
 */

/**
 * The JSON object out of a text response.
 *
 * Needed because no Groq model in this registry supports `json_schema` (see the note
 * on `plan` in `models.ts`), so a plan comes back as text that has to be parsed here.
 * Models wrap JSON in ```json fences perhaps a third of the time, and will occasionally
 * add a sentence before it — both are recoverable, and throwing the whole plan away
 * over a code fence would be absurd.
 *
 * Returns `null` rather than throwing: the caller already has a degrade path.
 */
export function extractJson(text: string): unknown {
  const withoutFence = text
    .trim()
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/```\s*$/, '')
    .trim()

  // A leading apology or trailing note: take the outermost braces and ignore the rest.
  const first = withoutFence.indexOf('{')
  const last = withoutFence.lastIndexOf('}')
  const candidate = first === -1 || last <= first ? withoutFence : withoutFence.slice(first, last + 1)

  try {
    return JSON.parse(candidate)
  } catch {
    return null
  }
}

/**
 * Prose the model wrote, cut to a length the UI can hold.
 *
 * **Clamped, never rejected.** A 430-character rationale on an otherwise perfect plan
 * was thrown away by a `z.string().max(400)` during development — the same failure
 * direction as the label reader rejecting legally-rounded macros: refusing good data
 * over a cosmetic bound. The items are the payload; the prose is commentary.
 */
export function clampProse(value: string | null, max: number): string | null {
  if (value === null) return null
  const trimmed = value.trim()
  if (trimmed === '') return null
  if (trimmed.length <= max) return trimmed
  // Cut at a word boundary so it does not end mid-syllable.
  const cut = trimmed.slice(0, max - 1)
  const space = cut.lastIndexOf(' ')
  return `${(space > max * 0.6 ? cut.slice(0, space) : cut).trimEnd()}…`
}

/**
 * Provider error → something worth reading.
 *
 * The raw text is unusable in a notice: a rate limit arrives as *"Failed after 3
 * attempts. Last error: AI_APICallError: You exceeded your current quota… Quota
 * exceeded for metric: generativelanguage.googleapis.com/generate_content_free_tier_requests,
 * limit: 20"*. That is a log line, not a message, and it leaks which provider is
 * behind the app.
 *
 * The distinction that matters is only ever **wait, or do it another way**.
 */
export function describeAiFailure(raw: string, stillWorks: string): string {
  const quota = /quota|rate.?limit|429|resource_exhausted/i.test(raw)
  return quota
    ? `Out of AI quota for the moment. Try again later, or ${stillWorks}.`
    : `The AI could not be reached. ${stillWorks[0]!.toUpperCase()}${stillWorks.slice(1)} instead.`
}
