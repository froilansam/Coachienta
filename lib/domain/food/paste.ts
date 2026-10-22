/**
 * What a pasted note is allowed to become, before any database is asked.
 *
 * The model splits the text. This only throws away rows that cannot be logged:
 * a blank name, a zero amount, and anything past the cap. The cap is the Open
 * Food Facts rate limit — each remaining name may search, and they search one
 * at a time.
 */
export const PASTE_ITEM_CAP = 8

export interface PastedFood {
  name: string
  estimated_amount: number
  estimated_unit: 'g' | 'ml' | 'piece' | 'serving'
  portion_reasoning: string
  confidence: 'high' | 'medium' | 'low'
}

export function tidyPastedFoods(items: readonly PastedFood[]): PastedFood[] {
  const out: PastedFood[] = []
  for (const item of items) {
    const name = item.name.trim()
    if (name === '' || !(item.estimated_amount > 0)) continue
    out.push({ ...item, name })
    if (out.length === PASTE_ITEM_CAP) break
  }
  return out
}
