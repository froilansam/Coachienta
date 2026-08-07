import { describe, expect, it } from 'vitest'
import { looksLikeFood, parseQuantity, splitMultiItem } from './parseQuantity'

/** Every row from the PRD-003 §3.1 table, verbatim. This is AC-1.2. */
describe('parseQuantity — the PRD table', () => {
  const cases: Array<[string, number | null, string | null, string]> = [
    ['200g white rice', 200, 'g', 'white rice'],
    ['white rice 200g', 200, 'g', 'white rice'],
    ['2 pancakes', 2, 'piece', 'pancakes'],
    ['1 cup / 125 g yogurt', 125, 'g', 'yogurt'],
    ['1 scoop whey', 1, 'serving', 'whey'],
    ['3 eggs', 3, 'piece', 'eggs'],
    ['250ml milk', 250, 'ml', 'milk'],
    ['kimchi', null, null, 'kimchi'],
  ]

  for (const [input, amount, unit, query] of cases) {
    it(`${input} → ${amount ?? 'null'} ${unit ?? ''} "${query}"`.trim(), () => {
      const r = parseQuantity(input)
      expect({ amount: r.amount, unit: r.unit, query: r.query }).toEqual({ amount, unit, query })
    })
  }
})

describe('parseQuantity — units and normalisation', () => {
  it('normalises kg to grams', () => {
    expect(parseQuantity('1.2kg chicken')).toMatchObject({ amount: 1200, unit: 'g', query: 'chicken' })
  })

  it('normalises litres to ml', () => {
    expect(parseQuantity('1.5 L water')).toMatchObject({ amount: 1500, unit: 'ml', query: 'water' })
  })

  it('accepts a spelled-out unit', () => {
    expect(parseQuantity('150 grams tofu')).toMatchObject({ amount: 150, unit: 'g', query: 'tofu' })
  })

  it('handles decimals', () => {
    expect(parseQuantity('12.5g peanut butter')).toMatchObject({ amount: 12.5, unit: 'g' })
  })

  it('reads a trailing count', () => {
    expect(parseQuantity('onigiri x2')).toMatchObject({ amount: 2, unit: 'piece', query: 'onigiri' })
  })

  it('prefers mass over a count when both appear', () => {
    // Grams are the precise figure; the cup is decoration.
    expect(parseQuantity('2 cups / 300g rice')).toMatchObject({ amount: 300, unit: 'g', query: 'rice' })
  })

  it('treats an unmeasured portion word as a serving', () => {
    expect(parseQuantity('1 pack yakisoba')).toMatchObject({ amount: 1, unit: 'serving' })
    expect(parseQuantity('2 bottles savas')).toMatchObject({ amount: 2, unit: 'serving' })
  })

  it('treats a countable item as pieces', () => {
    expect(parseQuantity('4 nuggets')).toMatchObject({ amount: 4, unit: 'piece' })
  })

  it('defaults a bare count to pieces', () => {
    expect(parseQuantity('2 gyoza')).toMatchObject({ amount: 2, unit: 'piece', query: 'gyoza' })
  })

  it('preserves Japanese names intact (AC-1.14)', () => {
    expect(parseQuantity('150g 焼豚チャーハン')).toMatchObject({
      amount: 150, unit: 'g', query: '焼豚チャーハン',
    })
    expect(parseQuantity('おにぎり')).toMatchObject({ amount: null, query: 'おにぎり' })
  })

  it('keeps the raw input for audit', () => {
    expect(parseQuantity('  200g  rice ').raw).toBe('200g  rice')
  })

  it('returns null amount for an empty string rather than throwing', () => {
    expect(parseQuantity('')).toMatchObject({ amount: null, unit: null, query: '' })
  })

  it('does not treat a number inside a name as a quantity unit', () => {
    // "SAVAS Milk Protein 200ml" has a real volume; that IS the quantity.
    expect(parseQuantity('SAVAS Milk Protein 200ml')).toMatchObject({ amount: 200, unit: 'ml' })
  })
})

describe('splitMultiItem — AC-1.10', () => {
  it('splits on commas', () => {
    expect(splitMultiItem('200g tofu, 140g rice')).toEqual(['200g tofu', '140g rice'])
  })

  it('splits on a Japanese comma', () => {
    expect(splitMultiItem('200g 豆腐、140g ごはん')).toEqual(['200g 豆腐', '140g ごはん'])
  })

  it('splits on "and" and on "+"', () => {
    expect(splitMultiItem('3 eggs and 2 pancakes')).toEqual(['3 eggs', '2 pancakes'])
    expect(splitMultiItem('whey + banana')).toEqual(['whey', 'banana'])
  })

  it('does NOT split on a bare slash', () => {
    // "1 cup / 125 g yogurt" is one item expressed two ways. Splitting it here
    // would silently become two bogus entries.
    expect(splitMultiItem('1 cup / 125 g yogurt')).toEqual(['1 cup / 125 g yogurt'])
  })

  it('drops empty fragments from trailing separators', () => {
    expect(splitMultiItem('rice, ')).toEqual(['rice'])
  })

  it('returns a single item unchanged', () => {
    expect(splitMultiItem('200g white rice')).toEqual(['200g white rice'])
  })
})

describe('looksLikeFood — keeps non-events out of the log', () => {
  it('rejects the exact row that polluted the spreadsheet', () => {
    expect(looksLikeFood('Nutrition planning session')).toBe(false)
  })

  it('rejects other non-food notes', () => {
    for (const s of ['weigh-in', 'workout', 'reminder to eat', 'meeting notes']) {
      expect(looksLikeFood(s)).toBe(false)
    }
  })

  it('rejects a single character', () => {
    expect(looksLikeFood('x')).toBe(false)
  })

  it('accepts real foods, including Japanese', () => {
    for (const s of ['white rice', 'おにぎり', 'chicken breast', 'kimchi']) {
      expect(looksLikeFood(s)).toBe(true)
    }
  })
})
