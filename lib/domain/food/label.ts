import type {
  LabelColumn,
  LabelFlag,
  LabelRegime,
  LabelVerdict,
  NutritionLabel,
} from '@/lib/schemas/label'
import type { Confidence, MacroRate } from '@/lib/schemas/domain'

/**
 * Turns a transcribed label into a stored macro rate, and decides whether the
 * printed numbers are self-consistent.
 *
 * No I/O, no model, no React. The vision model only reads characters; everything
 * numeric happens here, which is what makes a photo of a label give the same
 * answer every time (PRD-003 §3.3b).
 *
 * ## Why the energy check is an interval and not a percentage
 *
 * Printed values are rounded by law before they reach the package, so a label is
 * never exact and cannot be checked as if it were:
 *
 * - **JP** (食品表示基準): energy to 1 kcal, protein/fat/carbohydrate to 1 g,
 *   salt to 0.1 g.
 * - **US** (21 CFR 101.9): energy to the nearest **5 below 50 kcal and 10 above**;
 *   fat to 0.5 g under 5 g and 1 g at or above; protein, carbohydrate and fiber
 *   to 1 g.
 *
 * A 30 kcal item with whole-gram macros therefore carries up to ±8.5 kcal of
 * legal slack — 28% — which the flat 20% Atwater test in `validateMacroRate`
 * would report as a bad label. So we compute the energy range the printed macros
 * could represent and ask only whether the printed energy falls inside it. Same
 * class of mistake as reading USDA's fiber-inclusive carbohydrate naively, and it
 * fails in the same direction: rejecting food that is fine.
 */

/** Half-width of the rounding interval around a printed value. */
interface Slack {
  kcal: number
  protein: number
  fat: number
  carbs: number
  fiber: number
}

function slackFor(regime: LabelRegime, column: LabelColumn): Slack {
  if (regime === 'jp') {
    return { kcal: 0.5, protein: 0.5, fat: 0.5, carbs: 0.5, fiber: 0.5 }
  }
  // US, and 'unknown' — the wider of the two regimes, so an unrecognised label
  // is given the benefit of the doubt rather than flagged.
  return {
    kcal: column.kcal > 50 ? 5 : 2.5,
    protein: 0.5,
    fat: column.fat_g >= 5 ? 0.5 : 0.25,
    carbs: 0.5,
    fiber: 0.5,
  }
}

/**
 * Total carbohydrate, however the label chose to express it.
 *
 * Japanese labels routinely print 糖質 (available carbohydrate) and 食物繊維
 * instead of a 炭水化物 line. 炭水化物 = 糖質 + 食物繊維, so the total is
 * recoverable — but only when both are present. With 糖質 alone, fiber is
 * genuinely unknown and we say so rather than assume zero.
 */
export function totalCarbs(column: LabelColumn): {
  carbs_g: number
  fiber_g: number | null
  basis: LabelVerdict['carbs_basis']
} | null {
  if (column.carbohydrate_g !== null) {
    return { carbs_g: column.carbohydrate_g, fiber_g: column.fiber_g, basis: 'printed' }
  }
  if (column.net_carbs_g !== null && column.fiber_g !== null) {
    return {
      carbs_g: column.net_carbs_g + column.fiber_g,
      fiber_g: column.fiber_g,
      basis: 'net_plus_fiber',
    }
  }
  if (column.net_carbs_g !== null) {
    // Understates total carbohydrate by however much fiber there is. Energy is
    // unaffected — net carbs is exactly what the 4 kcal/g factor applies to.
    return { carbs_g: column.net_carbs_g, fiber_g: null, basis: 'net_only' }
  }
  return null
}

/** Atwater energy, fiber-aware: 4·protein + 4·netCarbs + 9·fat + 2·fiber. */
function energyOf(protein: number, carbs: number, fat: number, fiber: number): number {
  const net = Math.max(carbs - fiber, 0)
  return 4 * protein + 4 * net + 9 * fat + 2 * fiber
}

/**
 * The energy range the printed macros could represent.
 *
 * Energy rises with protein, carbohydrate and fat and FALLS with fiber (2 kcal/g
 * displacing 4), so the extremes sit at opposite corners of the interval box —
 * lowest macros with highest fiber, and the reverse.
 */
function impliedEnergy(
  protein: number,
  carbs: number,
  fat: number,
  fiber: number,
  s: Slack,
): { low: number; high: number } {
  const low = energyOf(
    Math.max(protein - s.protein, 0),
    Math.max(carbs - s.carbs, 0),
    Math.max(fat - s.fat, 0),
    fiber + s.fiber,
  )
  const high = energyOf(
    protein + s.protein,
    carbs + s.carbs,
    fat + s.fat,
    Math.max(fiber - s.fiber, 0),
  )
  return { low: round1(Math.max(low, 0)), high: round1(high) }
}

const round1 = (n: number) => Math.round(n * 10) / 10

/** 食塩相当量(g) = ナトリウム(mg) × 2.54 ÷ 1000, per 食品表示基準. */
export const sodiumToSalt = (sodium_mg: number): number => round1((sodium_mg * 2.54) / 1000)
export const saltToSodium = (salt_g: number): number => Math.round((salt_g * 1000) / 2.54)

/**
 * Which column to store from.
 *
 * Per-100 basis wins when present: it is the app's dominant basis, it scales to
 * any amount without a density, and it is the column least likely to have been
 * mis-transcribed (round numbers, printed first).
 */
export function preferredColumn(label: NutritionLabel): LabelColumn | null {
  const per100 = label.columns.find((c) => c.basis_amount === 100 && c.basis_unit !== 'piece')
  return per100 ?? label.columns[0] ?? null
}

/**
 * Does a second column scale to the first?
 *
 * A per-serving column must equal the per-100 column times serving/100, within
 * the rounding slack of both. This catches transcription errors that energy
 * arithmetic cannot — a digit read wrong in one column only.
 */
function columnsAgree(a: LabelColumn, b: LabelColumn, regime: LabelRegime): boolean {
  if (a.basis_unit !== b.basis_unit) return true // Not comparable; not a disagreement.
  const massA = a.basis_mass ?? (a.basis_unit === 'piece' ? null : a.basis_amount)
  const massB = b.basis_mass ?? (b.basis_unit === 'piece' ? null : b.basis_amount)
  if (massA === null || massB === null || massA === 0) return true

  const factor = massB / massA
  const sa = slackFor(regime, a)
  const sb = slackFor(regime, b)
  const carbsA = totalCarbs(a)
  const carbsB = totalCarbs(b)

  const pairs: Array<[number, number, number]> = [
    [a.kcal, b.kcal, sa.kcal * factor + sb.kcal],
    [a.protein_g, b.protein_g, sa.protein * factor + sb.protein],
    [a.fat_g, b.fat_g, sa.fat * factor + sb.fat],
  ]
  if (carbsA && carbsB) pairs.push([carbsA.carbs_g, carbsB.carbs_g, sa.carbs * factor + sb.carbs])

  return pairs.every(([va, vb, tol]) => Math.abs(va * factor - vb) <= tol + 0.05)
}

/**
 * Reads a transcribed label into a storable rate plus a verdict on the numbers.
 *
 * Returns null only when the chosen column has no recoverable carbohydrate
 * figure — at that point there is nothing to store and the user should type it.
 */
export function readLabel(
  label: NutritionLabel,
): { rate: MacroRate; verdict: LabelVerdict } | null {
  const column = preferredColumn(label)
  if (!column) return null
  const carbs = totalCarbs(column)
  if (!carbs) return null

  const flags: LabelFlag[] = []
  if (carbs.basis === 'net_only') flags.push('fiber_unknown')

  const s = slackFor(label.regime, column)
  const fiber = carbs.fiber_g ?? 0
  const implied = impliedEnergy(column.protein_g, carbs.carbs_g, column.fat_g, fiber, s)
  if (column.kcal < implied.low - s.kcal || column.kcal > implied.high + s.kcal) {
    flags.push('energy_disagrees')
  }

  /**
   * The basis we store against. A stated gram weight is used even when the label
   * calls the column "1 serving", because grams scale and servings do not. With
   * no weight printed we store per piece rather than invent a density.
   */
  const basis_mass = column.basis_mass
  const isMass = column.basis_unit === 'g' || column.basis_unit === 'ml'
  const basis_unit = isMass ? column.basis_unit : basis_mass !== null ? 'g' : 'piece'
  const basis_amount = isMass ? column.basis_amount : (basis_mass ?? 1)
  if (!isMass && basis_mass === null) flags.push('basis_mass_missing')

  const mass = column.protein_g + carbs.carbs_g + column.fat_g
  if (basis_unit === 'g' && mass > basis_amount * 1.05) flags.push('mass_exceeds_basis')

  // Two columns that do not scale to each other mean one was misread.
  const others = label.columns.filter((c) => c !== column)
  if (others.some((o) => !columnsAgree(column, o, label.regime))) flags.push('columns_disagree')

  // servings × serving size should account for the package.
  if (label.servings_per_container !== null && label.net_mass !== null) {
    const serving = label.columns.find((c) => c.basis_mass !== null)?.basis_mass
    if (serving !== undefined && serving !== null) {
      const expected = serving * label.servings_per_container
      if (Math.abs(expected - label.net_mass) > Math.max(label.net_mass * 0.1, 2)) {
        flags.push('servings_disagree')
      }
    }
  }

  if (column.salt_g !== null && column.sodium_mg !== null) {
    if (Math.abs(sodiumToSalt(column.sodium_mg) - column.salt_g) > 0.15) {
      flags.push('salt_disagrees')
    }
  }

  return {
    rate: {
      basis_unit,
      basis_amount,
      kcal: column.kcal,
      protein_g: column.protein_g,
      carbs_g: carbs.carbs_g,
      fat_g: column.fat_g,
      fiber_g: carbs.fiber_g,
    },
    verdict: {
      flags,
      confidence: gradeLabel(flags),
      printed_kcal: column.kcal,
      implied_kcal: implied,
      carbs_basis: carbs.basis,
    },
  }
}

/**
 * A label that reconciles is the best non-user source there is — better than a
 * database guess, because it is the manufacturer's own declaration.
 *
 * Only a failure to reconcile the printed numbers drops it to `low`; the softer
 * flags are notes for the reader, not doubts about the macros.
 */
export function gradeLabel(flags: readonly LabelFlag[]): Confidence {
  if (flags.includes('energy_disagrees') || flags.includes('mass_exceeds_basis')) return 'low'
  if (flags.includes('columns_disagree') || flags.includes('fiber_unknown')) return 'medium'
  return 'high'
}

/** Human-readable, one line each. The UI shows these verbatim. */
export const FLAG_TEXT: Record<LabelFlag, string> = {
  energy_disagrees: 'The calories printed do not match the macros printed. Check both.',
  columns_disagree: 'The two columns on this label do not scale to each other.',
  fiber_unknown: 'Only 糖質 was printed, so fibre is unknown — carbs may be understated.',
  mass_exceeds_basis: 'The macros weigh more than the serving does. Something was misread.',
  basis_mass_missing: 'No weight printed for the serving, so this is stored per piece.',
  servings_disagree: 'Servings × serving size does not match the printed net weight.',
  salt_disagrees: 'Salt and sodium were both printed and do not convert to each other.',
}

/** "per 100 g", "per 1 piece" — the label's own words, not ours. */
export function describeBasis(rate: MacroRate): string {
  return rate.basis_unit === 'piece'
    ? `per ${rate.basis_amount} piece${rate.basis_amount === 1 ? '' : 's'}`
    : `per ${rate.basis_amount} ${rate.basis_unit}`
}

/**
 * Everything the review screen displays, as finished strings.
 *
 * Built here rather than in the component so no arithmetic or formatting happens
 * in JSX, and so the wording is testable without rendering anything.
 */
export interface LabelDisplay {
  basisLabel: string
  /** The panel as printed, in reading order. Nothing derived, nothing omitted. */
  rows: Array<{ label: string; value: string }>
  verdict: { tone: 'pos' | 'warn' | 'neg'; headline: string; detail: string | null }
  /** Softer flags, one sentence each. */
  notes: string[]
}

const g = (v: number | null): string | null => (v === null ? null : `${round1(v)} g`)

/** Japanese term alongside the English one, but only on a Japanese panel. */
const term = (en: string, jp: string, regime: LabelRegime) =>
  regime === 'jp' ? `${en} · ${jp}` : en

export function describeLabel(
  label: NutritionLabel,
  verdict: LabelVerdict,
  rate: MacroRate,
): LabelDisplay {
  const column = preferredColumn(label)
  const r = label.regime

  const printed: Array<[string, string | null]> = column
    ? [
        [term('Energy', '熱量', r), `${round1(column.kcal)} kcal`],
        [term('Protein', 'たんぱく質', r), g(column.protein_g)],
        [term('Fat', '脂質', r), g(column.fat_g)],
        [term('Carbohydrate', '炭水化物', r), g(column.carbohydrate_g)],
        [term('of which net carbs', '糖質', r), g(column.net_carbs_g)],
        [term('of which fibre', '食物繊維', r), g(column.fiber_g)],
        [term('of which sugars', '糖類', r), g(column.sugars_g)],
        [term('Salt', '食塩相当量', r), g(column.salt_g)],
        ['Sodium', column.sodium_mg === null ? null : `${round1(column.sodium_mg)} mg`],
      ]
    : []

  const hard = verdict.flags.includes('energy_disagrees')
    ? 'energy_disagrees'
    : verdict.flags.includes('mass_exceeds_basis')
      ? 'mass_exceeds_basis'
      : null

  const { low, high } = verdict.implied_kcal
  const range = low === high ? `${low}` : `${low}–${high}`

  return {
    basisLabel: describeBasis(rate),
    rows: printed.filter((p): p is [string, string] => p[1] !== null).map(([l, v]) => ({
      label: l,
      value: v,
    })),
    verdict: hard
      ? { tone: 'neg', headline: 'These numbers do not agree', detail: FLAG_TEXT[hard] }
      : {
          tone: verdict.flags.length > 0 ? 'warn' : 'pos',
          headline: 'The numbers add up',
          // The whole point of the feature, in one line: printed energy sits
          // inside the range the printed macros allow.
          detail: `${round1(verdict.printed_kcal)} kcal printed; the macros imply ${range} kcal`,
        },
    notes: verdict.flags.filter((f) => f !== hard).map((f) => FLAG_TEXT[f]),
  }
}
