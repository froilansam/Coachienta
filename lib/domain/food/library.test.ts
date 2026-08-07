import { describe, expect, it } from 'vitest'
import { checkMacros, deleteGuard, mergeBlocker, mergePlan, trustOf } from './library'
import type { FoodRow } from '@/lib/schemas/food'

const food = (o: Partial<FoodRow> & { id: string }): FoodRow => ({
  name: 'Test food',
  brand: null,
  basis_unit: 'g',
  basis_amount: 100,
  kcal: 100,
  protein_g: 5,
  carbs_g: 15,
  fat_g: 2,
  fiber_g: null,
  confidence: 'medium',
  source: 'library',
  version: 1,
  times_logged: 0,
  usual_amount: null,
  ...o,
})

// ---------------------------------------------------------------------------
// AC-1.27 — "VERIFIED" must mean a human checked it
// ---------------------------------------------------------------------------
describe('trustOf (AC-1.27)', () => {
  it('reserves VERIFIED for a row the user confirmed', () => {
    expect(trustOf('user_verified', 'usda').label).toBe('VERIFIED')
    expect(trustOf('user_verified', 'ai_estimate').label).toBe('VERIFIED')
  })

  it('never says VERIFIED for a database row nobody has looked at', () => {
    /**
     * The regression. The old chip mapped `high` to a green "Verified", so 94
     * untouched rows claimed human approval — including a USDA sweetener recorded
     * as 0 kcal with 100 g of carbohydrate.
     */
    for (const source of ['usda', 'openfoodfacts', 'library'] as const) {
      expect(trustOf('high', source).label).not.toBe('VERIFIED')
    }
    expect(trustOf('high', 'usda').label).toBe('USDA')
    expect(trustOf('high', 'openfoodfacts').label).toBe('OFF')
    expect(trustOf('high', 'library').label).toBe('IMPORTED')
  })

  it('marks a photographed panel as the strongest non-user source', () => {
    const t = trustOf('high', 'photo')
    expect(t.label).toBe('LABEL')
    expect(t.tone).toBe('pos')
  })

  it('warns on anything unconfirmed', () => {
    expect(trustOf('medium', 'ai_estimate').tone).toBe('warn')
    expect(trustOf('low', 'usda').label).toBe('UNVERIFIED')
    expect(trustOf('low', 'usda').tone).toBe('warn')
  })

  it('always explains itself in one sentence', () => {
    for (const c of ['user_verified', 'high', 'medium', 'low'] as const) {
      expect(trustOf(c, 'usda').explain.length).toBeGreaterThan(10)
    }
  })
})

// ---------------------------------------------------------------------------
// AC-1.24 / AC-1.25 — deletion is gated on references, never on a counter
// ---------------------------------------------------------------------------
describe('deleteGuard (AC-1.24, AC-1.25)', () => {
  it('blocks a food that log entries point at', () => {
    const g = deleteGuard(food({ id: 'a', entry_count: 3, times_logged: 3 }))
    expect(g.allowed).toBe(false)
    expect(g.reason).toContain('3 logged entries')
  })

  it('allows a food nothing references, even when the usage counter is high', () => {
    /**
     * The reported bug, in one assertion. `times_logged` is lifetime usage seeded
     * from the spreadsheet — 67 logs against 0 surviving entries — so gating on it
     * refused 221 of 282 foods and reported entries that did not exist.
     */
    const g = deleteGuard(food({ id: 'a', entry_count: 0, times_logged: 67 }))
    expect(g.allowed).toBe(true)
    expect(g.reason).toBeNull()
    // Allowed, but it says why you might not want to.
    expect(g.warning).toContain('67')
  })

  it('allows a genuine leftover with no warning at all', () => {
    const g = deleteGuard(food({ id: 'a', entry_count: 0, times_logged: 0 }))
    expect(g).toEqual({ allowed: true, reason: null, warning: null })
  })

  it('blocks when the reference count is unknown, because refusing is recoverable', () => {
    // A row from `search_foods`, which does not report `entry_count`. Orphaning
    // history is not recoverable; a refused delete is.
    expect(deleteGuard(food({ id: 'a', times_logged: 0 })).allowed).toBe(false)
  })

  it('uses singular wording for exactly one entry', () => {
    expect(deleteGuard(food({ id: 'a', entry_count: 1 })).reason).toContain('1 logged entry uses')
  })
})

// ---------------------------------------------------------------------------
// AC-1.26 — a cross-basis merge is refused, not converted
// ---------------------------------------------------------------------------
describe('mergeBlocker (AC-1.26)', () => {
  const grams = food({ id: 'g', basis_unit: 'g', name: 'Eggs' })
  const pieces = food({ id: 'p', basis_unit: 'piece', name: 'Egg' })

  it('allows a merge within one basis', () => {
    expect(mergeBlocker(grams, food({ id: 'g2', basis_unit: 'g' }))).toBeNull()
  })

  it('refuses across bases rather than guessing a density', () => {
    const why = mergeBlocker(grams, pieces)
    expect(why).not.toBeNull()
    expect(why).toContain('no weight to convert with')
  })

  it('refuses to merge a food into itself', () => {
    expect(mergeBlocker(grams, grams)).toBe('Pick a different food.')
  })
})

describe('mergePlan (AC-1.13)', () => {
  const survivor = food({ id: 's', name: 'Sunny side up eggs', times_logged: 27 })
  const loser = food({ id: 'l', name: 'Sunny side up egg', times_logged: 10 })

  it('states the outcome before it happens', () => {
    const lines = mergePlan(survivor, loser).join(' ')
    expect(lines).toContain('"Sunny side up egg" disappears')
    // 27 + 10 — the summed counter is the thing a user would otherwise check after.
    expect(lines).toContain('37×')
    expect(lines).toContain('becomes an alias')
    expect(lines).toContain('10 past entries')
  })

  it('omits the entry line when the loser has no history', () => {
    const lines = mergePlan(survivor, food({ id: 'l', name: 'x', times_logged: 0 }))
    expect(lines.join(' ')).not.toContain('past entr')
  })
})

// ---------------------------------------------------------------------------
// The editor's live check
// ---------------------------------------------------------------------------
describe('checkMacros', () => {
  it('confirms a rate that adds up, and shows its working', () => {
    const c = checkMacros({
      basis_unit: 'g', basis_amount: 100, kcal: 126, protein_g: 2.3, carbs_g: 28.2, fat_g: 0, fiber_g: null,
    })
    expect(c.tone).toBe('pos')
    expect(c.detail).toContain('126 kcal entered')
  })

  it('names a calorie mismatch with both numbers', () => {
    const c = checkMacros({
      basis_unit: 'g', basis_amount: 100, kcal: 0, protein_g: 0, carbs_g: 100, fat_g: 0, fiber_g: null,
    })
    expect(c.tone).toBe('warn')
    expect(c.headline).toContain('do not match')
    // The real SWEET'N LOW row: 0 kcal declared, 100 g of carbohydrate.
    expect(c.detail).toContain('400')
  })

  it('clears once fibre explains the gap', () => {
    // 100 g of pure fibre is 200 kcal, not 400 — so declaring 200 is correct.
    const c = checkMacros({
      basis_unit: 'g', basis_amount: 100, kcal: 200, protein_g: 0, carbs_g: 100, fat_g: 0, fiber_g: 100,
    })
    expect(c.tone).toBe('pos')
  })

  it('catches macros heavier than the basis', () => {
    const c = checkMacros({
      basis_unit: 'g', basis_amount: 100, kcal: 900, protein_g: 50, carbs_g: 50, fat_g: 40, fiber_g: null,
    })
    expect(c.headline).toContain('weighs more')
  })
})
