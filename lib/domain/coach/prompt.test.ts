import { describe, expect, it } from 'vitest'
import { buildCoachPrompt, estimateTokens, orderRules, type PromptContext, type Rule } from './prompt'

const rule = (o: Partial<Rule> & { title: string }): Rule => ({
  category: 'training', content: 'do the thing', priority: 100, is_critical: false, ...o,
})

const ctx = (o: Partial<PromptContext> = {}): PromptContext => ({
  displayName: 'Froye',
  phaseLabel: '4-week weight-maintenance recomp',
  weightKg: 70,
  weightOn: '2026-08-04',
  targetSummary: '2300–2400 kcal, 160 g protein',
  priorities: ['shoulders side', 'back lats'],
  medicalNotes: 'No Valsalva on heavy compounds.',
  today: '2026-08-06',
  ...o,
})

describe('orderRules', () => {
  it('puts persona first and output format last', () => {
    // Persona frames everything after it; output format sits closest to where the
    // model starts writing.
    const ordered = orderRules([
      rule({ title: 'format', category: 'output_format' }),
      rule({ title: 'who', category: 'persona' }),
      rule({ title: 'lift', category: 'training' }),
    ])
    expect(ordered.map((r) => r.title)).toEqual(['who', 'lift', 'format'])
  })

  it('leads with criticals inside a category (AC-4.8)', () => {
    const ordered = orderRules([
      rule({ title: 'soft', category: 'safety', priority: 10 }),
      rule({ title: 'hard', category: 'safety', priority: 90, is_critical: true }),
    ])
    // Priority 90 still comes first, because critical outranks it — a model
    // attends to what it reads first.
    expect(ordered.map((r) => r.title)).toEqual(['hard', 'soft'])
  })

  it('sorts an unknown category after every known one', () => {
    const ordered = orderRules([
      rule({ title: 'mystery', category: 'not_a_category' }),
      rule({ title: 'who', category: 'persona' }),
    ])
    expect(ordered.map((r) => r.title)).toEqual(['who', 'mystery'])
  })

  it('does not mutate its input', () => {
    const input = [rule({ title: 'b', category: 'output_format' }), rule({ title: 'a', category: 'persona' })]
    orderRules(input)
    expect(input.map((r) => r.title)).toEqual(['b', 'a'])
  })
})

describe('buildCoachPrompt (AC-4.12)', () => {
  it('states the facts the coach may cite, each one stored', () => {
    const p = buildCoachPrompt([], ctx())
    expect(p).toContain('Today is 2026-08-06.')
    expect(p).toContain('Current weight 70 kg (measured 2026-08-04).')
    expect(p).toContain('Active phase: 4-week weight-maintenance recomp.')
    expect(p).toContain('shoulders side > back lats')
    expect(p).toContain('No Valsalva on heavy compounds.')
  })

  it('omits a fact rather than inventing one', () => {
    const p = buildCoachPrompt([], ctx({ weightKg: null, medicalNotes: null, phaseLabel: null }))
    expect(p).not.toContain('Current weight')
    expect(p).not.toContain('Medical constraints')
    expect(p).not.toContain('Active phase')
    // The date always survives, since every relative claim depends on it.
    expect(p).toContain('Today is')
  })

  it('marks critical rules inline so the instruction carries its own weight', () => {
    const p = buildCoachPrompt(
      [rule({ title: 'No heavy oblique work', category: 'safety', is_critical: true })],
      ctx(),
    )
    expect(p).toContain('[CRITICAL] No heavy oblique work: do the thing')
    expect(p).toContain('SAFETY — NON-NEGOTIABLE')
  })

  it('writes one heading per category, in order', () => {
    const p = buildCoachPrompt(
      [
        rule({ title: 'a', category: 'persona' }),
        rule({ title: 'b', category: 'persona' }),
        rule({ title: 'c', category: 'training' }),
      ],
      ctx(),
    )
    expect(p.match(/WHO YOU ARE/g)).toHaveLength(1)
    expect(p.indexOf('WHO YOU ARE')).toBeLessThan(p.indexOf('TRAINING'))
  })

  it('is deterministic — the preview cannot differ from what is sent', () => {
    const rules = [
      rule({ title: 'z', category: 'training' }),
      rule({ title: 'a', category: 'safety', is_critical: true }),
    ]
    const first = buildCoachPrompt(rules, ctx())
    for (let i = 0; i < 5; i++) expect(buildCoachPrompt(rules, ctx())).toBe(first)
    // Input order must not change the output either.
    expect(buildCoachPrompt([...rules].reverse(), ctx())).toBe(first)
  })

  it('excludes nothing it was given — filtering retired rules is the caller job', () => {
    const p = buildCoachPrompt([rule({ title: 'included' })], ctx())
    expect(p).toContain('included')
  })
})

describe('estimateTokens', () => {
  it('is roughly four characters per token', () => {
    expect(estimateTokens('a'.repeat(400))).toBe(100)
    expect(estimateTokens('')).toBe(0)
  })
})
