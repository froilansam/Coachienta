import { describe, expect, it } from 'vitest'
import type { MacroRate } from '@/lib/schemas/domain'
import { UnitMismatchError, scaleMacros, validateMacroRate } from './macros'

/** Cooked white rice per 100 g — the real seeded value. */
const rice: MacroRate = {
  basis_unit: 'g', basis_amount: 100,
  kcal: 126, protein_g: 2.3, carbs_g: 28.2, fat_g: 0.2, fiber_g: null,
}

describe('scaleMacros', () => {
  it('scales linearly within the same unit', () => {
    expect(scaleMacros(rice, 200, 'g')).toEqual({
      kcal: 252, protein_g: 4.6, carbs_g: 56.4, fat_g: 0.4,
    })
  })

  it('scales down as well as up', () => {
    expect(scaleMacros(rice, 50, 'g')).toEqual({
      kcal: 63, protein_g: 1.2, carbs_g: 14.1, fat_g: 0.1,
    })
  })

  it('handles a per-piece basis', () => {
    const egg: MacroRate = {
      basis_unit: 'piece', basis_amount: 1,
      kcal: 72, protein_g: 6.3, carbs_g: 0.4, fat_g: 5, fiber_g: null,
    }
    expect(scaleMacros(egg, 3, 'piece').kcal).toBe(216)
  })

  it('REFUSES cross-unit conversion instead of guessing a density', () => {
    // A guessed density is a wrong number indistinguishable from a right one,
    // and it would poison every downstream average (PRD-003 §4.1).
    expect(() => scaleMacros(rice, 1, 'piece')).toThrow(UnitMismatchError)
  })

  it('is exact at the basis amount', () => {
    expect(scaleMacros(rice, 100, 'g')).toEqual({
      kcal: 126, protein_g: 2.3, carbs_g: 28.2, fat_g: 0.2,
    })
  })
})

describe('validateMacroRate — Atwater consistency', () => {
  it('passes a self-consistent set', () => {
    // 4(2.3) + 4(28.2) + 9(0.2) = 123.8 vs stated 126 → within 20%
    expect(validateMacroRate(rice)).toEqual({ ok: true, flags: [] })
  })

  it('catches individually-plausible numbers that do not add up', () => {
    // This is the LLM's most common nutrition failure: every field looks
    // reasonable, the set is internally impossible.
    const bad: MacroRate = { ...rice, kcal: 450 }
    const r = validateMacroRate(bad)
    expect(r.ok).toBe(false)
    expect(r.flags).toContain('kcal_mismatch')
  })

  it('catches macro mass exceeding the basis mass', () => {
    const impossible: MacroRate = {
      basis_unit: 'g', basis_amount: 100,
      kcal: 600, protein_g: 60, carbs_g: 60, fat_g: 20, fiber_g: null,
    }
    expect(validateMacroRate(impossible).flags).toContain('mass_exceeds_basis')
  })

  it('does not apply the mass check to non-gram bases', () => {
    // A "serving" has no implied mass, so 60+60+20 g is not a contradiction.
    const drink: MacroRate = {
      basis_unit: 'serving', basis_amount: 1,
      kcal: 620, protein_g: 60, carbs_g: 60, fat_g: 20, fiber_g: null,
    }
    expect(validateMacroRate(drink).flags).not.toContain('mass_exceeds_basis')
  })

  it('does not punish high-fiber foods (regression)', () => {
    // Real USDA raw broccoli. "Carbohydrate, by difference" includes fiber, and
    // fiber is ~2 kcal/g not 4 — the naive formula put this 24% out and flagged
    // every vegetable UNVERIFIED.
    const broccoli: MacroRate = {
      basis_unit: 'g', basis_amount: 100,
      kcal: 31, protein_g: 2.57, carbs_g: 6.27, fat_g: 0.34, fiber_g: 2.4,
    }
    expect(validateMacroRate(broccoli)).toEqual({ ok: true, flags: [] })
  })

  it('still catches a genuine mismatch on a high-fiber food', () => {
    // Fiber-awareness must not become a blanket excuse.
    const bogus: MacroRate = {
      basis_unit: 'g', basis_amount: 100,
      kcal: 300, protein_g: 2.57, carbs_g: 6.27, fat_g: 0.34, fiber_g: 2.4,
    }
    expect(validateMacroRate(bogus).flags).toContain('kcal_mismatch')
  })

  it('falls back to the naive formula when fiber is unknown', () => {
    const noFiber: MacroRate = {
      basis_unit: 'g', basis_amount: 100,
      kcal: 126, protein_g: 2.3, carbs_g: 28.2, fat_g: 0.2, fiber_g: null,
    }
    expect(validateMacroRate(noFiber).ok).toBe(true)
  })

  it('tolerates zero-calorie foods without dividing by zero', () => {
    const water: MacroRate = {
      basis_unit: 'ml', basis_amount: 100,
      kcal: 0, protein_g: 0, carbs_g: 0, fat_g: 0, fiber_g: null,
    }
    expect(validateMacroRate(water).ok).toBe(true)
  })
})
