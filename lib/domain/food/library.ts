import { derivedKcal, validateMacroRate } from '@/lib/domain/macros'
import type { Confidence, MacroRate, ResolutionSource } from '@/lib/schemas/domain'
import type { FoodRow } from '@/lib/schemas/food'

/**
 * Pure logic for the food library: how much to trust a row, whether two rows can
 * be merged, and what a correction would mean.
 *
 * No I/O, no React. Everything the screen displays is a finished string produced
 * here, so the components stay JSX-only and the wording is testable.
 */

// ---------------------------------------------------------------------------
// Trust
// ---------------------------------------------------------------------------

/**
 * What a row's provenance actually entitles it to claim.
 *
 * The previous chip mapped BOTH `high` and `user_verified` to a green
 * "Verified", which made 94 rows nobody has ever looked at claim human approval —
 * including a USDA sweetener recorded as 0 kcal with 100 g of carbohydrate. That
 * is precisely the "dishonest precision" PRD-002 §10 forbids: it spends the
 * user's trust on rows that have not earned it, and leaves nothing to say about
 * the rows that have.
 *
 * So `VERIFIED` now means one thing only: you checked it. Everything else names
 * its source and lets the user judge.
 */
export interface Trust {
  label: string
  tone: 'pos' | 'neutral' | 'warn'
  /** One sentence, shown in the editor. */
  explain: string
}

export function trustOf(confidence: Confidence, source: ResolutionSource): Trust {
  if (confidence === 'user_verified') {
    return { label: 'VERIFIED', tone: 'pos', explain: 'You checked these numbers yourself.' }
  }
  if (confidence === 'low') {
    return {
      label: 'UNVERIFIED',
      tone: 'warn',
      explain: 'The calories do not match the macros. Worth correcting.',
    }
  }
  if (source === 'photo') {
    return { label: 'LABEL', tone: 'pos', explain: "Read from a packet's printed panel." }
  }
  if (confidence === 'high') {
    switch (source) {
      case 'usda':
        return { label: 'USDA', tone: 'neutral', explain: 'From USDA FoodData Central.' }
      case 'openfoodfacts':
        return { label: 'OFF', tone: 'neutral', explain: 'From Open Food Facts, crowd-sourced.' }
      case 'library':
        return { label: 'IMPORTED', tone: 'neutral', explain: 'Came from your spreadsheet.' }
      default:
        return { label: 'DB', tone: 'neutral', explain: 'From a nutrition database.' }
    }
  }
  return {
    label: 'EST',
    tone: 'warn',
    explain:
      source === 'ai_estimate'
        ? 'An AI estimate. Plausible, not measured.'
        : 'An estimate. Nobody has confirmed it.',
  }
}

// ---------------------------------------------------------------------------
// Filters
// ---------------------------------------------------------------------------

export const LIBRARY_FILTERS = ['all', 'checking', 'unlogged', 'label'] as const
export type LibraryFilter = (typeof LIBRARY_FILTERS)[number]

export interface LibraryCounts {
  all: number
  checking: number
  unlogged: number
  label: number
}

/** Short enough for a segmented control on a 390px screen, with the live count. */
export function filterOptions(
  counts: LibraryCounts,
): Array<{ value: LibraryFilter; label: string }> {
  return [
    { value: 'all', label: `ALL ${counts.all}` },
    { value: 'checking', label: `CHECK ${counts.checking}` },
    { value: 'unlogged', label: `UNUSED ${counts.unlogged}` },
    { value: 'label', label: `LABELS ${counts.label}` },
  ]
}

/** Why a filter exists, in the user's terms. Shown above the list, not in a tooltip. */
export const FILTER_BLURB: Record<LibraryFilter, string | null> = {
  all: null,
  checking: 'Estimates and rows whose calories do not add up. Correcting one makes it verified for good.',
  unlogged: 'Looking a food up saves it, so searches leave these behind. Nothing here has ever been eaten.',
  label: 'Read from a photographed nutrition panel. The most exact source in the library.',
}

// ---------------------------------------------------------------------------
// Editing
// ---------------------------------------------------------------------------

/** Live feedback while typing in the editor — the same arithmetic as the gate. */
export interface MacroCheck {
  tone: 'pos' | 'warn'
  headline: string
  detail: string
}

export function checkMacros(rate: MacroRate): MacroCheck {
  const implied = derivedKcal(rate)
  const { flags } = validateMacroRate(rate)

  if (flags.includes('mass_exceeds_basis')) {
    return {
      tone: 'warn',
      headline: 'That weighs more than the serving',
      detail: `Protein + carbs + fat come to more than ${rate.basis_amount} ${rate.basis_unit}.`,
    }
  }
  if (flags.includes('kcal_mismatch')) {
    return {
      tone: 'warn',
      headline: 'The calories do not match the macros',
      detail: `You entered ${rate.kcal} kcal; these macros imply ${implied}.`,
    }
  }
  return {
    tone: 'pos',
    headline: 'The numbers add up',
    detail: `${rate.kcal} kcal entered; the macros imply ${implied}.`,
  }
}

/** A name is the library key — an empty one makes the row unfindable. */
export const canSaveFood = (name: string, rate: MacroRate): boolean =>
  name.trim() !== '' && rate.basis_amount > 0

// ---------------------------------------------------------------------------
// Deleting
// ---------------------------------------------------------------------------

/**
 * Whether a food can be deleted, and what to tell the user either way.
 *
 * Gated on `entry_count` — the real number of log entries pointing at the row —
 * and never on `times_logged`. Those answer different questions and the numbers
 * genuinely differ: `White rice (cooked)` carries 187 lifetime logs imported from
 * the spreadsheet while only 5 entries exist. Gating on the counter refused 221 of
 * 282 foods nothing referenced, and told the user a food was "in 1 past entry"
 * after that entry had been deleted.
 *
 * `entry_count` absent means we were handed a row from a query that does not
 * report it, so we block: refusing a safe delete is recoverable, orphaning
 * history is not.
 */
export interface DeleteGuard {
  allowed: boolean
  /** Why it is blocked. Null when allowed. */
  reason: string | null
  /** Shown when allowed but the food has a usage history worth pausing over. */
  warning: string | null
}

export function deleteGuard(food: FoodRow): DeleteGuard {
  const entries = food.entry_count
  if (entries === undefined || entries === null) {
    return { allowed: false, reason: 'Cannot tell what depends on this yet.', warning: null }
  }
  if (entries > 0) {
    return {
      allowed: false,
      reason: `${entries} logged ${entries === 1 ? 'entry uses' : 'entries use'} this food, and deleting it would orphan ${entries === 1 ? 'it' : 'them'}. Merge it into another food instead.`,
      warning: null,
    }
  }
  if (food.times_logged > 0) {
    // Safe, but not obviously wise: the counter is imported history, so this is
    // something the user has eaten even though no entry row survives.
    return {
      allowed: true,
      reason: null,
      warning: `Nothing in your log points at this, but it was eaten ${food.times_logged}× before your history was imported.`,
    }
  }
  return { allowed: true, reason: null, warning: null }
}

// ---------------------------------------------------------------------------
// Merging
// ---------------------------------------------------------------------------

/**
 * Cross-basis merges are refused, not converted.
 *
 * Folding a per-piece row into a per-100 g row would reinterpret every
 * historical amount on the entries being repointed, and there is no density to
 * convert with. Same rule as `scaleMacros`: ask rather than guess (§4.1).
 */
export function mergeBlocker(survivor: FoodRow, loser: FoodRow): string | null {
  if (survivor.id === loser.id) return 'Pick a different food.'
  if (survivor.basis_unit !== loser.basis_unit) {
    return `Cannot merge a per-${loser.basis_unit} food into a per-${survivor.basis_unit} one — there is no weight to convert with.`
  }
  return null
}

/** Exactly what the merge will do, stated before it happens. */
export function mergePlan(survivor: FoodRow, loser: FoodRow): string[] {
  const lines = [
    `"${loser.name}" disappears; "${survivor.name}" stays.`,
    `${survivor.name} will show ${survivor.times_logged + loser.times_logged}× logged.`,
    `"${loser.name}" becomes an alias, so searching it still finds ${survivor.name}.`,
  ]
  if (loser.times_logged > 0) {
    lines.push(
      `${loser.times_logged} past ${loser.times_logged === 1 ? 'entry' : 'entries'} point at ${survivor.name} instead — their macros do not change.`,
    )
  }
  return lines
}

// ---------------------------------------------------------------------------
// Row display
// ---------------------------------------------------------------------------

/** `per 100 g · P 2.3 C 28.2 F 0` — the whole row, one string, no JSX maths. */
export function describeRow(f: FoodRow): string {
  const basis = f.basis_unit === 'piece' ? `per ${f.basis_amount} piece` : `per ${f.basis_amount} ${f.basis_unit}`
  return `${basis} · P ${f.protein_g} C ${f.carbs_g} F ${f.fat_g}`
}

/** A food's rate, pulled out of the row it lives on. */
export const rateOf = (f: FoodRow): MacroRate => ({
  basis_unit: f.basis_unit,
  basis_amount: f.basis_amount,
  kcal: f.kcal,
  protein_g: f.protein_g,
  carbs_g: f.carbs_g,
  fat_g: f.fat_g,
  fiber_g: f.fiber_g,
})
