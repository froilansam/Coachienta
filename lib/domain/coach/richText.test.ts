import { describe, expect, it } from 'vitest'
import { parseBlocks, parseSpans } from './richText'

describe('parseSpans', () => {
  it('bolds the numbers the coach is told to bold', () => {
    expect(parseSpans('You averaged **171.4 g** against **160 g**.')).toEqual([
      { text: 'You averaged ', bold: false },
      { text: '171.4 g', bold: true },
      { text: ' against ', bold: false },
      { text: '160 g', bold: true },
      { text: '.', bold: false },
    ])
  })

  it('leaves an unmatched marker as literal text rather than eating the rest', () => {
    // A stray `*` must never swallow an answer.
    expect(parseSpans('2 ** 3 is not bold')).toEqual([{ text: '2 ** 3 is not bold', bold: false }])
  })

  it('handles plain text and empty input', () => {
    expect(parseSpans('nothing special')).toEqual([{ text: 'nothing special', bold: false }])
    expect(parseSpans('')).toEqual([])
  })

  it('does not treat **** as an empty bold run', () => {
    expect(parseSpans('****')).toEqual([{ text: '****', bold: false }])
  })
})

describe('parseBlocks', () => {
  it('reads bullets, headings and paragraphs', () => {
    const blocks = parseBlocks(
      ['## Protein', '', 'You averaged **171 g**.', '- Lowest **148 g** on 2 Aug', '* Highest **193 g**'].join('\n'),
    )
    expect(blocks.map((b) => b.kind)).toEqual(['heading', 'paragraph', 'bullet', 'bullet'])
    expect(blocks[2]!.spans[1]).toEqual({ text: '148 g', bold: true })
  })

  it('joins hard-wrapped lines into one paragraph', () => {
    // The model wraps prose; rendering each wrapped line separately breaks the sentence.
    const blocks = parseBlocks('Across 7 logged days you\naveraged 171 g protein.')
    expect(blocks).toHaveLength(1)
    expect(blocks[0]!.spans[0]!.text).toBe('Across 7 logged days you averaged 171 g protein.')
  })

  it('treats a blank line as a paragraph break', () => {
    expect(parseBlocks('one\n\ntwo').map((b) => b.kind)).toEqual(['paragraph', 'paragraph'])
  })

  it('reads a numbered list as bullets', () => {
    expect(parseBlocks('1. first\n2) second').map((b) => b.kind)).toEqual(['bullet', 'bullet'])
  })

  it('returns nothing for empty output rather than an empty block', () => {
    expect(parseBlocks('')).toEqual([])
    expect(parseBlocks('   \n  ')).toEqual([])
  })
})
