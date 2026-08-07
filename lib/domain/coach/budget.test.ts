import { describe, expect, it } from 'vitest'
import { BUDGET, budgetReport, isTrivial, tokensOf, trimHistory, type Turn } from './budget'

const turn = (role: Turn['role'], text: string): Turn => ({ role, text })
const exchange = (n: number, size = 20): Turn[] => [
  turn('user', `question ${n} `.repeat(size)),
  turn('assistant', `answer ${n} `.repeat(size)),
]

describe('trimHistory', () => {
  it('keeps the last six exchanges verbatim', () => {
    const turns = Array.from({ length: 10 }, (_, i) => exchange(i, 1)).flat()
    const { kept, dropped } = trimHistory(turns, 10_000)
    expect(kept).toHaveLength(12)
    expect(dropped).toBe(8)
    expect(kept[0]!.text).toContain('question 4')
  })

  it('keeps everything when the thread is short', () => {
    const turns = exchange(1, 1)
    expect(trimHistory(turns).kept).toHaveLength(2)
    expect(trimHistory(turns).dropped).toBe(0)
  })

  it('AC-3.11 — trims further when six exchanges still exceed the budget', () => {
    // Six long exchanges blow 1,500 tokens on their own, so turn count alone is not
    // enough of a guard.
    const turns = Array.from({ length: 6 }, (_, i) => exchange(i, 200)).flat()
    const { kept, dropped } = trimHistory(turns)
    expect(tokensOf(kept)).toBeLessThanOrEqual(BUDGET.history)
    expect(dropped).toBeGreaterThan(0)
  })

  it('drops whole turns rather than truncating one', () => {
    // Half an answer is worse context than none: the model reads the fragment as
    // complete and reasons from it.
    const turns = Array.from({ length: 6 }, (_, i) => exchange(i, 300)).flat()
    const { kept } = trimHistory(turns)
    const originals = turns.map((t) => t.text)
    for (const k of kept) expect(originals).toContain(k.text)
  })

  it('never trims below the current exchange', () => {
    const turns = [turn('user', 'x'.repeat(40_000)), turn('assistant', 'y'.repeat(40_000))]
    expect(trimHistory(turns).kept).toHaveLength(2)
  })
})

describe('budgetReport', () => {
  it('passes a normal turn and names the total', () => {
    const report = budgetReport({
      system: 'a'.repeat(3_000),
      history: exchange(1, 5),
      toolResults: [JSON.stringify({ protein_mean: 171.4, row_count: 7 })],
    })
    expect(report.withinBudget).toBe(true)
    expect(report.total).toBeLessThanOrEqual(BUDGET.total)
  })

  it('names which component blew the budget, not just that one did', () => {
    const report = budgetReport({
      system: 'a'.repeat(40_000),
      history: [],
      toolResults: [],
    })
    expect(report.withinBudget).toBe(false)
    expect(report.over).toContain('system')
    expect(report.over).toContain('total')
  })

  it('a per-component cap bites before the total does, so the cause is named', () => {
    // 12k characters is ~3k tokens: over the 2k tool cap, still under the 6.2k total.
    // That ordering is the useful property — the report says WHICH part ran away
    // rather than only that the turn was too big.
    const report = budgetReport({ system: '', history: [], toolResults: ['x'.repeat(12_000)] })
    expect(report.over).toEqual(['tools'])
    expect(report.tools).toBeGreaterThan(BUDGET.tools)
    expect(report.total).toBeLessThan(BUDGET.total)
  })
})

describe('isTrivial', () => {
  it('routes an acknowledgement to the small model', () => {
    for (const text of ['thanks', 'Thanks!', 'ok', 'got it', 'salamat', 'sige']) {
      expect(isTrivial(text)).toBe(true)
    }
  })

  it('never routes a real question there, however short', () => {
    // Misrouting a coaching question is far worse than paying for a "thanks".
    for (const text of ['protein?', 'am i progressing', 'how many sets last week', '160 g ok?']) {
      expect(isTrivial(text)).toBe(false)
    }
  })

  it('treats anything with a digit or a question mark as substantive', () => {
    expect(isTrivial('ok 2')).toBe(false)
    expect(isTrivial('ok?')).toBe(false)
  })
})
