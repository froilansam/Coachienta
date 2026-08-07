import { MacroRate, Macros, type UnitBasis } from '@/lib/schemas/domain'

/** Thrown when a unit conversion has no known factor. We ask rather than guess. */
export class UnitMismatchError extends Error {
  constructor(from: UnitBasis, to: UnitBasis) {
    super(`No conversion from ${from} to ${to}`)
    this.name = 'UnitMismatchError'
  }
}

const round1 = (n: number) => Math.round(n * 10) / 10

/**
 * Scale a stored macro *rate* to an actual amount.
 * Cross-unit conversion is refused, not guessed — a silently wrong density
 * poisons every downstream average (PRD-003 §4.1).
 */
export function scaleMacros(rate: MacroRate, amount: number, unit: UnitBasis): Macros {
  if (unit !== rate.basis_unit) throw new UnitMismatchError(rate.basis_unit, unit)
  const f = amount / rate.basis_amount
  return {
    kcal: round1(rate.kcal * f),
    protein_g: round1(rate.protein_g * f),
    carbs_g: round1(rate.carbs_g * f),
    fat_g: round1(rate.fat_g * f),
  }
}

export type MacroFlag = 'kcal_mismatch' | 'mass_exceeds_basis'

/**
 * Energy the macros imply, fiber-aware: 4·protein + 4·netCarbs + 9·fat + 2·fiber.
 *
 * Exported so the library editor can show its working while you type, rather than
 * only reporting a verdict after the fact — same number the validator uses, so
 * the two can never disagree.
 */
export function derivedKcal(rate: MacroRate): number {
  const fiber = rate.fiber_g ?? 0
  const netCarbs = Math.max(rate.carbs_g - fiber, 0)
  return round1(4 * rate.protein_g + 4 * netCarbs + 9 * rate.fat_g + 2 * fiber)
}

/**
 * Atwater consistency check: 4·protein + 4·carbs + 9·fat should ≈ kcal.
 *
 * This is the cheapest defence against an LLM or a bad database row returning
 * four individually-plausible numbers that don't add up. Pure arithmetic — it
 * needs no knowledge of the food (PRD-003 §3.2).
 */
export function validateMacroRate(rate: MacroRate): { ok: boolean; flags: MacroFlag[] } {
  const flags: MacroFlag[] = []

  /**
   * Fiber-aware Atwater.
   *
   * USDA reports "Carbohydrate, by difference", which INCLUDES fiber — but fiber
   * yields ~2 kcal/g, not 4. Using the naive 4·carbs formula overestimates every
   * high-fiber food, so vegetables, legumes and whole grains were all being
   * wrongly flagged UNVERIFIED. Verified on raw broccoli: 24% off naive, 8% off
   * fiber-aware.
   */
  const derived = derivedKcal(rate)

  if (Math.abs(derived - rate.kcal) / Math.max(rate.kcal, 1) > 0.2) flags.push('kcal_mismatch')

  // Total macro mass cannot exceed the basis mass. Only meaningful for grams —
  // a "serving" has no implied mass.
  const mass = rate.protein_g + rate.carbs_g + rate.fat_g
  if (rate.basis_unit === 'g' && mass > rate.basis_amount * 1.05) flags.push('mass_exceeds_basis')

  return { ok: flags.length === 0, flags }
}
