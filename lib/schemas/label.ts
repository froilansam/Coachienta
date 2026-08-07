import { z } from 'zod'
import { Confidence, UnitBasis } from './domain'

/**
 * A nutrition label, transcribed. Printed characters only — no arithmetic.
 *
 * This is the contract between the vision model and `lib/domain/food/label.ts`.
 * The split is the whole point: the model's job is OCR and structure, and every
 * number derived from these fields comes from a pure function. Same photo in,
 * same macros out, and the maths is testable without a model (PRD-003 §3.3b).
 */

/**
 * Which rounding regime the label follows. It decides how much slack the
 * consistency check must allow, and the two regimes are not close: JP rounds
 * energy to 1 kcal, the US to the nearest 10 above 50 kcal.
 */
export const LabelRegime = z.enum(['jp', 'us', 'unknown'])
export type LabelRegime = z.infer<typeof LabelRegime>

/**
 * One column of a label. Labels commonly print two — per 100 g and per serving —
 * and comparing them is the strongest error check available, so both are kept.
 */
export const LabelColumn = z.object({
  /** What the column is per: 100 g, one serving, one package. */
  basis_unit: UnitBasis,
  basis_amount: z.number().positive(),
  /**
   * Grams (or ml) in this basis when the label states it — "1食分 (40g)" → 40.
   * Null for a bare "1本" with no weight, which is why we never invent one.
   */
  basis_mass: z.number().positive().nullable(),
  kcal: z.number().min(0),
  protein_g: z.number().min(0),
  fat_g: z.number().min(0),
  /**
   * Total carbohydrate — US "Total Carbohydrate", JP 炭水化物. INCLUDES fiber.
   * Null when the label prints only the 糖質 / 食物繊維 breakdown, which is
   * normal on Japanese protein and diet products.
   */
  carbohydrate_g: z.number().min(0).nullable(),
  /**
   * JP 糖質 — available carbohydrate, i.e. total MINUS fiber. Not sugars.
   * Reading this as total carbohydrate undercounts every fibre-containing food.
   */
  net_carbs_g: z.number().min(0).nullable(),
  fiber_g: z.number().min(0).nullable(),
  /** US "Total Sugars", JP 糖類. A subset of net carbs; not used for energy. */
  sugars_g: z.number().min(0).nullable(),
  /** JP 食塩相当量 in g. Sodium is converted to this, never stored as mg. */
  salt_g: z.number().min(0).nullable(),
  sodium_mg: z.number().min(0).nullable(),
})
export type LabelColumn = z.infer<typeof LabelColumn>

export const NutritionLabel = z.object({
  /** Product name as printed. Not a guess from the packaging design. */
  product_name: z.string().nullable(),
  brand: z.string().nullable(),
  regime: LabelRegime,
  /** Written language of the panel, for the reader's benefit only. */
  language: z.string().nullable(),
  columns: z.array(LabelColumn).min(1).max(3),
  /** "5 servings per container" — cross-checks against net weight. */
  servings_per_container: z.number().positive().nullable(),
  /** Net weight of the package as printed, in g or ml. */
  net_mass: z.number().positive().nullable(),
  /** Anything printed that the reader could not place. Shown, never used. */
  unreadable_notes: z.string().max(200).nullable(),
})
export type NutritionLabel = z.infer<typeof NutritionLabel>

/** Why a label is not trustworthy, or needs the user's eye. */
export const LabelFlag = z.enum([
  /** Printed energy cannot be reconciled with printed macros, even allowing for
   *  legal rounding. One of the numbers was misread or the label is wrong. */
  'energy_disagrees',
  /** Two columns on the same label do not scale to each other. */
  'columns_disagree',
  /** Only 糖質 was printed, so fiber is unknown and carbs may be understated. */
  'fiber_unknown',
  /** Macro mass exceeds the basis mass — impossible. */
  'mass_exceeds_basis',
  /** No gram or ml weight for the basis, so this is stored per piece. */
  'basis_mass_missing',
  /** servings × serving size does not match the printed net weight. */
  'servings_disagree',
  /** Salt and sodium were both printed and do not convert to each other. */
  'salt_disagrees',
])
export type LabelFlag = z.infer<typeof LabelFlag>

/** What the arithmetic concluded. Every field here is derived, none transcribed. */
export const LabelVerdict = z.object({
  flags: z.array(LabelFlag),
  confidence: Confidence,
  /** Energy printed on the label. */
  printed_kcal: z.number(),
  /** Range the macros imply, once legal rounding is allowed for. */
  implied_kcal: z.object({ low: z.number(), high: z.number() }),
  /** How total carbohydrate was arrived at. Shown to the user verbatim. */
  carbs_basis: z.enum(['printed', 'net_plus_fiber', 'net_only']),
})
export type LabelVerdict = z.infer<typeof LabelVerdict>
