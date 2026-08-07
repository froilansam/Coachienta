import { describe, expect, it } from 'vitest'
import { describeSources, labelFor, thinkingLabel, type ToolCall } from './provenance'

const call = (over: Partial<ToolCall> = {}): ToolCall => ({
  name: 'get_nutrition_averages',
  input: { start_date: '2026-07-30', end_date: '2026-08-05' },
  rowCount: 7,
  ...over,
})

describe('describeSources', () => {
  it('names the tool, the range it chose, and what it covered', () => {
    // The range matters most: the model resolves "last week" itself, and two runs of
    // the same question picked different weeks. Without this the answer is unauditable.
    expect(describeSources([call()])).toEqual([
      { tool: 'Nutrition averages', detail: '2026-07-30 → 2026-08-05', count: '7 logged days' },
    ])
  })

  it('says "no data" rather than "0 rows"', () => {
    // An empty range is the honest answer to plenty of questions (AC-3.13); it must
    // read as an answer, not as a failure.
    expect(describeSources([call({ rowCount: 0 })])[0]!.count).toBe('no data')
  })

  it('marks a call that has not returned yet', () => {
    expect(describeSources([call({ rowCount: null })])[0]!.count).toBe('running…')
  })

  it('singularises a count of one', () => {
    expect(describeSources([call({ rowCount: 1 })])[0]!.count).toBe('1 logged day')
  })

  it('uses the named argument when there is no date range', () => {
    const line = describeSources([
      call({ name: 'get_exercise_progression', input: { exercise_name: 'Lateral Raises' }, rowCount: 4 }),
    ])[0]!
    expect(line).toEqual({ tool: 'Exercise progression', detail: 'Lateral Raises', count: '4 sets' })
  })

  it('falls back to a dash rather than inventing a detail', () => {
    expect(describeSources([call({ name: 'get_coach_rules', input: {}, rowCount: 20 })])[0]!).toEqual({
      tool: 'Coach rules',
      detail: '—',
      count: '20 rules',
    })
  })
})

describe('labelFor', () => {
  it('reads an unknown tool as words rather than an identifier', () => {
    expect(labelFor('get_something_new')).toBe('get something new')
  })
})

describe('thinkingLabel', () => {
  it('names the tool and its range, not "Thinking…"', () => {
    // Four seconds of generic filler reads as broken, and it hides a wrong tool choice.
    expect(thinkingLabel(call())).toBe(
      'Reading nutrition averages: 2026-07-30 → 2026-08-05…',
    )
  })

  it('drops the detail when there is none', () => {
    expect(thinkingLabel(call({ name: 'get_coach_rules', input: {} }))).toBe(
      'Reading your coach rules…',
    )
  })

  it('falls back before any tool has been chosen', () => {
    expect(thinkingLabel(null)).toBe('Thinking…')
  })
})
