import { describe, expect, it } from 'vitest'
import { isRelevant, significantTokens, tokenOverlap } from './relevance'

describe('significantTokens', () => {
  it('drops stop words and short tokens', () => {
    expect(significantTokens("lola's chicken adobo with coconut milk"))
      .toEqual(['lola', 'chicken', 'adobo', 'coconut', 'milk'])
  })
  it('KEEPS preparation words — they change the food', () => {
    // Regression: treating "raw" as noise made "raw broccoli" match
    // "Broccoli (cooked)" perfectly and outrank the real raw entry.
    expect(significantTokens('raw broccoli')).toEqual(['raw', 'broccoli'])
    expect(significantTokens('cooked quinoa')).toEqual(['cooked', 'quinoa'])
  })
  it('drops punctuation but keeps CJK', () => {
    expect(significantTokens('焼豚チャーハン (chashu)')).toContain('焼豚チャーハン')
  })
})

describe('tokenOverlap / isRelevant — real cases from the probe', () => {
  it('keeps an exact ingredient match', () => {
    expect(tokenOverlap('raw broccoli', 'Broccoli, raw')).toBe(1)
    expect(isRelevant('raw broccoli', 'Broccoli, raw')).toBe(true)
  })

  it('keeps a reordered match', () => {
    expect(isRelevant('cooked quinoa', 'Quinoa, cooked')).toBe(true)
  })

  it('does not confuse raw with cooked', () => {
    expect(isRelevant('raw broccoli', 'Broccoli (cooked)')).toBe(false)
    expect(isRelevant('raw broccoli', 'Broccoli, raw')).toBe(true)
  })

  it('DROPS the wrong food that shares only trailing words', () => {
    // The exact regression: USDA answered a chicken dish with a coconut drink,
    // which stopped the cascade before the LLM could estimate it.
    expect(isRelevant("lola's chicken adobo with coconut milk",
                      'Beverages, coconut milk, sweetened, fortified')).toBe(false)
  })

  it('drops a branded snack answering a generic vegetable query', () => {
    expect(isRelevant('raw broccoli', "Brad's, Raw Broccoli Poppers, Garlic-Ity")).toBe(true)
    // (contains both tokens — acceptable; ordering by source still puts USDA first)
    expect(isRelevant('broccoli', 'Chicken breast patty')).toBe(false)
  })

  it('is permissive when the query has no significant tokens', () => {
    expect(tokenOverlap('of the', 'anything')).toBe(1)
  })
})
