import type { UnitBasis } from '@/lib/schemas/domain'

export interface ParsedFoodInput {
  amount: number | null
  unit: UnitBasis | null
  query: string
  raw: string
}

/**
 * Deterministic. Never an AI call — routing "200g white rice" through a model
 * would make every log slow, cost quota, and need a network, for a job ordinary
 * code does in microseconds (PRD-003 §3.1).
 */

/** Mass/volume wins over a count when both appear: grams are the precise figure. */
const MASS_VOLUME = /(\d+(?:\.\d+)?)\s*(kg|g|grams?|ml|l|litres?|liters?)\b/i

/** A leading or trailing bare count: "2 pancakes", "pancakes x2". */
const LEADING_COUNT = /^(\d+(?:\.\d+)?)\s+/
const TRAILING_COUNT = /\s*[x×]\s*(\d+(?:\.\d+)?)\s*$/i

/** Words that mean "one portion of an unmeasured thing". */
const SERVING_WORDS =
  /\b(scoops?|servings?|packs?|packets?|bottles?|cans?|cups?|bowls?|plates?|sachets?|sticks?|tbsps?|tsps?|tablespoons?|teaspoons?)\b/i

/** Countable physical items — "3 eggs" is 3 pieces, not 3 servings. */
const PIECE_WORDS =
  /\b(pcs?|pieces?|eggs?|slices?|buns?|bananas?|pancakes?|apples?|onigiri|rolls?|wings?|nuggets?|balls?)\b/i

const TO_GRAMS: Record<string, { unit: UnitBasis; factor: number }> = {
  kg: { unit: 'g', factor: 1000 },
  g: { unit: 'g', factor: 1 },
  gram: { unit: 'g', factor: 1 },
  grams: { unit: 'g', factor: 1 },
  ml: { unit: 'ml', factor: 1 },
  l: { unit: 'ml', factor: 1000 },
  litre: { unit: 'ml', factor: 1000 },
  litres: { unit: 'ml', factor: 1000 },
  liter: { unit: 'ml', factor: 1000 },
  liters: { unit: 'ml', factor: 1000 },
}

const tidy = (s: string) =>
  s
    .replace(/\s+/g, ' ')
    // Strip separators left behind after removing a quantity, e.g. "1 cup / 125 g yogurt".
    .replace(/^[\s,/+·・-]+|[\s,/+·・-]+$/g, '')
    .trim()

export function parseQuantity(raw: string): ParsedFoodInput {
  const input = raw.trim()
  const base: ParsedFoodInput = { amount: null, unit: null, query: tidy(input), raw: input }
  if (!input) return base

  // ── 1. explicit mass or volume anywhere in the string ────────────────────
  const mv = MASS_VOLUME.exec(input)
  if (mv) {
    const conv = TO_GRAMS[mv[2]!.toLowerCase()]
    if (conv) {
      // Remove every quantity fragment, not just the matched one, so
      // "1 cup / 125 g yogurt" leaves "yogurt" rather than "1 cup / yogurt".
      const query = tidy(
        input
          .replace(mv[0], ' ')
          .replace(new RegExp(`\\d+(?:\\.\\d+)?\\s*${SERVING_WORDS.source}`, 'gi'), ' ')
          .replace(LEADING_COUNT, ' '),
      )
      return {
        amount: Math.round(Number(mv[1]) * conv.factor * 100) / 100,
        unit: conv.unit,
        query: query || base.query,
        raw: input,
      }
    }
  }

  // ── 2. a count with a unit noun ("1 scoop whey", "2 pcs pancake") ────────
  const lead = LEADING_COUNT.exec(input)
  const trail = TRAILING_COUNT.exec(input)
  const count = lead ? Number(lead[1]) : trail ? Number(trail[1]) : null

  if (count !== null) {
    const rest = tidy(input.replace(lead ? lead[0] : trail![0], ' '))
    // Piece before serving: "3 eggs" is 3 items; "1 cup" is one portion.
    const unit: UnitBasis = PIECE_WORDS.test(rest)
      ? 'piece'
      : SERVING_WORDS.test(rest)
        ? 'serving'
        : 'piece'
    // Drop the unit noun only when it carries no food name with it.
    const query = tidy(rest.replace(SERVING_WORDS, ' ')) || rest
    return { amount: count, unit, query, raw: input }
  }

  // ── 3. no quantity — the UI asks, prefilled from foods.usual_amount ──────
  return base
}

/**
 * Split a multi-item input into single items (US-1.8 / AC-1.10).
 *
 * Only splits on separators that are unambiguous between foods. A bare "/" is
 * NOT one — "1 cup / 125 g yogurt" is a single item expressed two ways, so it
 * must survive intact.
 */
export function splitMultiItem(raw: string): string[] {
  return raw
    .split(/\s*(?:,|、|\+|and\s+)\s*/i)
    .map((s) => s.trim())
    .filter(Boolean)
}

/**
 * Rejects non-food input before it pollutes a day. The spreadsheet had exactly
 * one such row ("Nutrition planning session") logged as a 0 kcal day flagged
 * "Low protein" (PRD-003 §7).
 */
const NON_FOOD = /\b(session|plan(ning)?|note|reminder|todo|meeting|workout|weigh-?in)\b/i

export const looksLikeFood = (query: string): boolean =>
  query.trim().length > 1 && !NON_FOOD.test(query)
