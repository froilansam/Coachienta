import { describe, expect, it } from 'vitest'
import { PASTE_ITEM_CAP, tidyPastedFoods, type PastedFood } from './paste'

const food = (name: string, amount = 100): PastedFood => ({
  name,
  estimated_amount: amount,
  estimated_unit: 'g',
  portion_reasoning: 'written in the text',
  confidence: 'high',
})

describe('tidyPastedFoods', () => {
  it('drops a blank name and a non-positive amount', () => {
    const kept = tidyPastedFoods([food('  rice  '), food('   ', 50), food('egg', 0), food('milk', -1)])
    expect(kept.map((i) => i.name)).toEqual(['rice'])
  })

  it('stops at the cap so a long paste cannot fire a search per line', () => {
    const many = Array.from({ length: PASTE_ITEM_CAP + 3 }, (_, i) => food(`food ${i}`))
    expect(tidyPastedFoods(many)).toHaveLength(PASTE_ITEM_CAP)
    expect(tidyPastedFoods(many).at(-1)?.name).toBe(`food ${PASTE_ITEM_CAP - 1}`)
  })
})
