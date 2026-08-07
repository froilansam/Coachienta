import { describe, expect, it } from 'vitest'
import {
  chooseRoute,
  describeQuota,
  firstUsable,
  isModelChoice,
  percentUsed,
  quotaState,
  type CapLike,
  type ModelOption,
  type Usage,
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

// ---------------------------------------------------------------------------
const CAPS: Record<string, CapLike> = {
  groqBig: { kind: 'tokens', period: 'day', limit: 100_000 },
  googleFlash: { kind: 'requests', period: 'day', limit: 20 },
  googleLite: { kind: 'requests', period: 'day', limit: 20 },
}
const spend = (over: Record<string, Usage>): Record<string, Usage> => over

describe('chooseRoute', () => {
  it('stays on the primary while it has room', () => {
    const d = chooseRoute(['groqBig', 'googleFlash'], spend({ groqBig: { tokens: 10_000, requests: 3 } }), CAPS, 0.8)
    expect(d).toMatchObject({ id: 'groqBig', degraded: false })
    expect(d.reason).toBeUndefined()
  })

  it('degrades at the safety margin, not at the hard cap', () => {
    // 80% is where the router stops trusting a pool; waiting for 100% means the
    // provider 429s first and the fallback never gets used.
    const d = chooseRoute(['groqBig', 'googleFlash'], spend({ groqBig: { tokens: 80_000, requests: 0 } }), CAPS, 0.8)
    expect(d).toMatchObject({ id: 'googleFlash', degraded: true, reason: 'quota' })
  })

  it('counts REQUESTS for a request-capped model — the bug this file exists for', () => {
    /**
     * `route()` consulted only a token table, so a model metered in requests looked
     * unused forever and `vision` could never fall back. 18 of 20 requests is past the
     * margin even though its token count is zero.
     */
    const d = chooseRoute(
      ['googleFlash', 'googleLite'],
      spend({ googleFlash: { tokens: 0, requests: 18 } }),
      CAPS,
      0.8,
    )
    expect(d).toMatchObject({ id: 'googleLite', degraded: true })
  })

  it('walks the WHOLE chain, not one hop', () => {
    // Two spent pools used to yield an equally-dead model flagged `degraded: true` —
    // a wrong answer wearing the costume of a handled one.
    const d = chooseRoute(
      ['groqBig', 'googleFlash', 'googleLite'],
      spend({
        groqBig: { tokens: 100_000, requests: 0 },
        googleFlash: { tokens: 0, requests: 20 },
      }),
      CAPS,
      0.8,
    )
    expect(d.id).toBe('googleLite')
    expect(d.exhausted).toEqual(['groqBig', 'googleFlash'])
  })

  it('treats an uncapped model as having room rather than guessing a limit', () => {
    const d = chooseRoute(['unmetered'], {}, CAPS, 0.8)
    expect(d).toMatchObject({ id: 'unmetered', degraded: false })
  })

  it('returns the primary when everything is spent, so the caller still tries', () => {
    /**
     * A real 429 carries the provider's own reset time. That is more use to the user
     * than our refusal to attempt the call.
     */
    const d = chooseRoute(
      ['googleFlash', 'googleLite'],
      spend({ googleFlash: { tokens: 0, requests: 20 }, googleLite: { tokens: 0, requests: 20 } }),
      CAPS,
      0.8,
    )
    expect(d).toMatchObject({ id: 'googleFlash', degraded: true, reason: 'quota' })
    expect(d.exhausted).toHaveLength(2)
  })

  it('never loops on a chain that repeats a model', () => {
    expect(chooseRoute([], {}, CAPS, 0.8).id).toBe('')
  })
})
