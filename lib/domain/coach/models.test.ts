import { describe, expect, it } from 'vitest'
import {
  describeQuota,
  firstUsable,
  isModelChoice,
  percentUsed,
  quotaState,
  type ModelOption,
} from './models'

const option = (choice: ModelOption['choice'], used: number, cap: number): ModelOption => ({
  choice,
  label: choice,
  id: choice,
  note: '',
  quota: { kind: 'tokens', used, cap },
})

describe('isModelChoice', () => {
  it('accepts only the three known choices', () => {
    // The client sends a job key, never a raw model id — an allowlist, like the tools.
    expect(isModelChoice('chat')).toBe(true)
    expect(isModelChoice('cheap')).toBe(true)
    expect(isModelChoice('llama-3.3-70b-versatile')).toBe(false)
    expect(isModelChoice(undefined)).toBe(false)
  })
})

describe('quotaState', () => {
  it('turns amber at 80%, where the router starts degrading', () => {
    // Same threshold as AI_QUOTA_SAFETY_MARGIN, so the badge and the router agree.
    expect(quotaState({ kind: 'tokens', used: 79_000, cap: 100_000 })).toBe('ok')
    expect(quotaState({ kind: 'tokens', used: 80_000, cap: 100_000 })).toBe('low')
  })

  it('is spent at the cap, not merely low', () => {
    expect(quotaState({ kind: 'requests', used: 20, cap: 20 })).toBe('spent')
    expect(quotaState({ kind: 'requests', used: 19, cap: 20 })).toBe('low')
  })
})

describe('percentUsed', () => {
  it('never exceeds 100, even when the provider counted more than we did', () => {
    // Our accounting once undercounted by half; it can also overshoot a stale cap.
    expect(percentUsed({ kind: 'tokens', used: 250_000, cap: 100_000 })).toBe(100)
  })

  it('does not divide by a zero cap', () => {
    expect(percentUsed({ kind: 'tokens', used: 10, cap: 0 })).toBe(0)
  })
})

describe('describeQuota', () => {
  it('states the figure, with units', () => {
    expect(describeQuota({ kind: 'tokens', used: 62_400, cap: 100_000 })).toBe(
      '62,400 / 100,000 tokens',
    )
    expect(describeQuota({ kind: 'requests', used: 18, cap: 20 })).toBe('18 / 20 requests')
  })
})

describe('firstUsable', () => {
  it('skips a spent pool for one with room', () => {
    const usable = firstUsable([option('chat', 100_000, 100_000), option('cheap', 10, 500_000)])
    expect(usable?.choice).toBe('cheap')
  })

  it('returns null when every pool is gone, rather than a spent one', () => {
    expect(firstUsable([option('chat', 100_000, 100_000)])).toBeNull()
  })
})
