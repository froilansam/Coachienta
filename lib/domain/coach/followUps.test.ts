import { describe, expect, it } from 'vitest'
import { followUpsFor, OPENING_PROMPTS } from './followUps'

describe('followUpsFor', () => {
  it('offers the opening prompts before anything has been asked', () => {
    expect(followUpsFor([])).toEqual([...OPENING_PROMPTS].slice(0, 3))
  })

  it('derives follow-ups from the tool that actually ran', () => {
    // Not a static list: a nutrition answer must not offer a training follow-up.
    const chips = followUpsFor(['get_nutrition_averages'])
    expect(chips[0]).toBe('What about my carbs?')
    expect(chips).toHaveLength(3)
  })

  it('spreads across subjects when one turn used two tools', () => {
    // One per tool before a second from either, so a food-and-training answer offers
    // follow-ups on both rather than three about food.
    const chips = followUpsFor(['get_nutrition_averages', 'get_session_summary'])
    expect(chips[0]).toBe('What about my carbs?')
    expect(chips[1]).toBe('How does that compare to last month?')
  })

  it('never repeats a suggestion when two tools share one', () => {
    const chips = followUpsFor(['get_nutrition_averages', 'get_nutrition_averages'])
    expect(new Set(chips).size).toBe(chips.length)
  })

  it('caps at three, because a fourth chip is one nobody reads', () => {
    expect(followUpsFor(['get_prs', 'get_body_trend', 'get_coach_rules', 'get_food_frequency'])).toHaveLength(3)
  })

  it('falls back to the openers for a tool it has no follow-up for', () => {
    expect(followUpsFor(['get_something_unknown'])).toEqual([...OPENING_PROMPTS].slice(0, 3))
  })

  it('never re-offers a question already asked in this thread', () => {
    // Re-offering the chip just tapped reads as the tap not having worked.
    const chips = followUpsFor([], [OPENING_PROMPTS[0]])
    expect(chips).not.toContain(OPENING_PROMPTS[0])
    expect(chips).toHaveLength(3)
  })

  it('matches an asked question regardless of case or trailing punctuation', () => {
    const chips = followUpsFor(['get_nutrition_averages'], ['what about my CARBS'])
    expect(chips).not.toContain('What about my carbs?')
  })
})
