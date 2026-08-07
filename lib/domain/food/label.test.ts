import { describe, expect, it } from 'vitest'
import { gradeLabel, readLabel, sodiumToSalt, totalCarbs } from './label'
import type { LabelColumn, NutritionLabel } from '@/lib/schemas/label'

/**
 * The whole point of the label path is that it is deterministic: the model only
 * transcribes, and every number is derived here. So these tests need no model, no
 * network and no browser — which is exactly why they are the cheapest coverage in
 * the project (PRD-003 §3.3b).
 */
const col = (o: Partial<LabelColumn>): LabelColumn => ({
  basis_unit: 'g',
  basis_amount: 100,
  basis_mass: 100,
  kcal: 0,
  protein_g: 0,
  fat_g: 0,
  carbohydrate_g: null,
  net_carbs_g: null,
  fiber_g: null,
  sugars_g: null,
  salt_g: null,
  sodium_mg: null,
  ...o,
})

const label = (o: Partial<NutritionLabel> & { columns: LabelColumn[] }): NutritionLabel => ({
  product_name: 'Test',
  brand: null,
  regime: 'jp',
  language: 'ja',
  servings_per_container: null,
  net_mass: null,
  unreadable_notes: null,
  ...o,
})

// ---------------------------------------------------------------------------
// AC-1.17 — the Japanese carbohydrate trap
// ---------------------------------------------------------------------------
describe('totalCarbs (AC-1.17)', () => {
  it('uses 炭水化物 when it is printed', () => {
    expect(totalCarbs(col({ carbohydrate_g: 28, fiber_g: 2 }))).toEqual({
      carbs_g: 28,
      fiber_g: 2,
      basis: 'printed',
    })
  })

  it('reconstructs 炭水化物 from 糖質 + 食物繊維 when there is no total row', () => {
    // The common shape on a Japanese protein bar. 糖質 is net carbs, so the total
    // is recoverable exactly — reading 糖質 as "carbs" would lose the fibre.
    expect(totalCarbs(col({ net_carbs_g: 20, fiber_g: 8 }))).toEqual({
      carbs_g: 28,
      fiber_g: 8,
      basis: 'net_plus_fiber',
    })
  })

  it('never treats a lone 糖質 as the total, and says fibre is unknown', () => {
    const r = totalCarbs(col({ net_carbs_g: 20 }))
    expect(r).toEqual({ carbs_g: 20, fiber_g: null, basis: 'net_only' })
    // The flag is what stops this silently understating carbohydrate.
    expect(readLabel(label({ columns: [col({ kcal: 80, net_carbs_g: 20 })] }))?.verdict.flags).toContain(
      'fiber_unknown',
    )
  })

  it('gives up rather than guessing when no carbohydrate figure is printed at all', () => {
    expect(totalCarbs(col({ kcal: 100, protein_g: 5 }))).toBeNull()
    expect(readLabel(label({ columns: [col({ kcal: 100 })] }))).toBeNull()
  })
})

// ---------------------------------------------------------------------------
// AC-1.18 — energy checked as an interval, because labels are rounded by law
// ---------------------------------------------------------------------------
describe('energy reconciliation (AC-1.18)', () => {
  it('accepts a low-calorie JP label that a flat 20% test would reject', () => {
    /**
     * The regression this test exists for. 食品表示基準 rounds macros to 1 g, so
     * P1/F1/C4 carries ±0.5 g each — up to ±8.5 kcal of legal slack. On a 30 kcal
     * item that is 28%, and `validateMacroRate`'s flat 20% gate would call a
     * perfectly legal label broken.
     */
    const read = readLabel(
      label({ regime: 'jp', columns: [col({ kcal: 30, protein_g: 1, fat_g: 1, carbohydrate_g: 4 })] }),
    )
    expect(read).not.toBeNull()
    expect(read!.verdict.flags).not.toContain('energy_disagrees')
    expect(read!.verdict.confidence).toBe('high')
    // The implied range is reported so the UI can show its working.
    expect(read!.verdict.implied_kcal.low).toBeLessThan(30)
    expect(read!.verdict.implied_kcal.high).toBeGreaterThan(30)
  })

  it('flags energy that is genuinely outside the range the macros allow', () => {
    // 20 P / 30 C / 10 F implies ~290 kcal. 450 is not a rounding artefact.
    const read = readLabel(
      label({ columns: [col({ kcal: 450, protein_g: 20, carbohydrate_g: 30, fat_g: 10 })] }),
    )
    expect(read!.verdict.flags).toContain('energy_disagrees')
    expect(read!.verdict.confidence).toBe('low')
  })

  it('allows the US regime more slack on energy, because it rounds to 10 kcal', () => {
    // 220 kcal declared; macros imply 210. Legal under 21 CFR 101.9 rounding.
    const cols = [col({ kcal: 220, protein_g: 10, carbohydrate_g: 20, fat_g: 10 })]
    expect(readLabel(label({ regime: 'us', columns: cols }))!.verdict.flags).not.toContain(
      'energy_disagrees',
    )
  })

  it('treats fibre as 2 kcal/g, so a high-fibre label still reconciles', () => {
    // 30 g carbohydrate of which 15 g fibre: 4·15 + 2·15 = 90, not 4·30 = 120.
    const read = readLabel(
      label({ columns: [col({ kcal: 90, carbohydrate_g: 30, fiber_g: 15 })] }),
    )
    expect(read!.verdict.flags).not.toContain('energy_disagrees')
  })

  it('catches macros that weigh more than the serving', () => {
    const read = readLabel(
      label({ columns: [col({ basis_amount: 100, kcal: 900, protein_g: 50, carbohydrate_g: 50, fat_g: 40 })] }),
    )
    expect(read!.verdict.flags).toContain('mass_exceeds_basis')
    expect(read!.verdict.confidence).toBe('low')
  })
})

// ---------------------------------------------------------------------------
// AC-1.19 — the basis, and never inventing a weight
// ---------------------------------------------------------------------------
describe('storage basis (AC-1.19)', () => {
  it('prefers a per-100 column over a per-serving one', () => {
    const read = readLabel(
      label({
        columns: [
          col({ basis_unit: 'piece', basis_amount: 1, basis_mass: 40, kcal: 160, protein_g: 4, carbohydrate_g: 20, fat_g: 6 }),
          col({ basis_amount: 100, kcal: 400, protein_g: 10, carbohydrate_g: 50, fat_g: 15 }),
        ],
      }),
    )
    expect(read!.rate.basis_unit).toBe('g')
    expect(read!.rate.basis_amount).toBe(100)
  })

  it('uses the stated gram weight of a serving, because grams scale and servings do not', () => {
    const read = readLabel(
      label({
        columns: [col({ basis_unit: 'serving', basis_amount: 1, basis_mass: 40, kcal: 160, protein_g: 4, carbohydrate_g: 20, fat_g: 6 })],
      }),
    )
    expect(read!.rate.basis_unit).toBe('g')
    expect(read!.rate.basis_amount).toBe(40)
    expect(read!.verdict.flags).not.toContain('basis_mass_missing')
  })

  it('falls back to per-piece rather than inventing a weight', () => {
    const read = readLabel(
      label({
        columns: [col({ basis_unit: 'piece', basis_amount: 1, basis_mass: null, kcal: 80, protein_g: 2, carbohydrate_g: 10, fat_g: 3 })],
      }),
    )
    expect(read!.rate.basis_unit).toBe('piece')
    expect(read!.rate.basis_amount).toBe(1)
    expect(read!.verdict.flags).toContain('basis_mass_missing')
    // A missing weight is a note, not a reason to distrust the printed numbers.
    expect(read!.verdict.confidence).toBe('high')
  })

  it('notices two columns that do not scale to each other', () => {
    const read = readLabel(
      label({
        columns: [
          // Internally consistent: 4·10 + 4·50 + 9·15 = 375.
          col({ basis_amount: 100, kcal: 375, protein_g: 10, carbohydrate_g: 50, fat_g: 15 }),
          // Half the mass should be ~188 kcal. 250 is a misread digit, and no
          // amount of legal rounding closes that gap.
          col({ basis_amount: 50, basis_mass: 50, kcal: 250, protein_g: 5, carbohydrate_g: 25, fat_g: 7 }),
        ],
      }),
    )
    expect(read!.verdict.flags).toContain('columns_disagree')
    // A cross-column disagreement is a transcription doubt, not a broken label —
    // the energy on the stored column still reconciles.
    expect(read!.verdict.flags).not.toContain('energy_disagrees')
    expect(read!.verdict.confidence).toBe('medium')
  })
})

describe('grading and conversions', () => {
  it('treats a reconciled label as the strongest non-user source', () => {
    expect(gradeLabel([])).toBe('high')
    expect(gradeLabel(['basis_mass_missing'])).toBe('high')
    expect(gradeLabel(['fiber_unknown'])).toBe('medium')
    expect(gradeLabel(['energy_disagrees'])).toBe('low')
  })

  it('converts sodium to salt by the 食品表示基準 formula', () => {
    // 食塩相当量(g) = ナトリウム(mg) × 2.54 ÷ 1000
    expect(sodiumToSalt(1000)).toBe(2.5)
    expect(sodiumToSalt(0)).toBe(0)
  })

  it('flags salt and sodium that contradict each other', () => {
    const read = readLabel(
      label({ columns: [col({ kcal: 100, carbohydrate_g: 25, salt_g: 5, sodium_mg: 100 })] }),
    )
    expect(read!.verdict.flags).toContain('salt_disagrees')
  })
})

// ---------------------------------------------------------------------------
// AC-1.16 — determinism
// ---------------------------------------------------------------------------
describe('determinism (AC-1.16)', () => {
  it('gives byte-identical output for the same transcription, every time', () => {
    const l = label({
      regime: 'jp',
      columns: [col({ kcal: 44, protein_g: 7, fat_g: 0, net_carbs_g: 4, fiber_g: 0.2, salt_g: 0.2 })],
    })
    const first = JSON.stringify(readLabel(l))
    for (let i = 0; i < 5; i++) expect(JSON.stringify(readLabel(l))).toBe(first)
  })
})
