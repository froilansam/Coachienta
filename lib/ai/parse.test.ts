import { describe, expect, it } from 'vitest'
import { clampProse, describeAiFailure, extractJson } from './parse'

describe('extractJson', () => {
  it('reads a bare object', () => {
    expect(extractJson('{"a":1}')).toEqual({ a: 1 })
  })

  it('strips a ```json fence', () => {
    // Groq's 70B adds one perhaps a third of the time. Discarding a whole plan over a
    // code fence would be absurd.
    expect(extractJson('```json\n{"a":1}\n```')).toEqual({ a: 1 })
    expect(extractJson('```\n{"a":1}\n```')).toEqual({ a: 1 })
  })

  it('ignores a sentence before or after the object', () => {
    expect(extractJson('Here is your plan:\n{"a":1}\nHope that helps!')).toEqual({ a: 1 })
  })

  it('keeps nested braces intact', () => {
    expect(extractJson('{"items":[{"b":2}]}')).toEqual({ items: [{ b: 2 }] })
  })

  it('returns null rather than throwing on nonsense', () => {
    expect(extractJson('not json at all')).toBeNull()
    expect(extractJson('')).toBeNull()
    expect(extractJson('{"a":')).toBeNull()
  })
})

describe('clampProse', () => {
  it('leaves prose that fits exactly as written', () => {
    expect(clampProse('  Shoulders first.  ', 400)).toBe('Shoulders first.')
  })

  it('clamps instead of rejecting — the whole point', () => {
    // A 430-char rationale on an otherwise perfect plan was thrown away by a
    // `max(400)` during development. Same failure direction as rejecting a
    // legally-rounded nutrition label.
    const long = `${'word '.repeat(120)}end`
    const out = clampProse(long, 400)!
    expect(out.length).toBeLessThanOrEqual(400)
    expect(out.endsWith('…')).toBe(true)
  })

  it('cuts at a word boundary', () => {
    expect(clampProse('alpha beta gamma delta', 12)).toBe('alpha beta…')
  })

  it('treats blank prose as absent, never as an empty label', () => {
    expect(clampProse('   ', 400)).toBeNull()
    expect(clampProse(null, 400)).toBeNull()
  })
})

describe('describeAiFailure', () => {
  const RATE_LIMIT =
    'Failed after 3 attempts. Last error: AI_APICallError: You exceeded your current quota. Quota exceeded for metric: generativelanguage.googleapis.com/generate_content_free_tier_requests, limit: 20, model: gemini-3.6-flash.'

  it('names what still works, and never which provider failed', () => {
    const out = describeAiFailure(RATE_LIMIT, 'use a template')
    expect(out).toBe('Out of AI quota for the moment. Try again later, or use a template.')
    expect(out).not.toMatch(/gemini|google|groq|generativelanguage|AI_APICallError/i)
  })

  it('distinguishes unreachable from out of quota', () => {
    expect(describeAiFailure('fetch failed', 'use a template')).toBe(
      'The AI could not be reached. Use a template instead.',
    )
  })

  it('recognises a bare 429', () => {
    expect(describeAiFailure('status 429', 'use a template')).toContain('Out of AI quota')
  })
})
