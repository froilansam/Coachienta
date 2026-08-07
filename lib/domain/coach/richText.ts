/**
 * The small subset of Markdown the coach actually emits, parsed to a structure.
 *
 * A Markdown library would be ~40 kB to render bold text and bullets, and it would
 * arrive with an HTML sanitiser to configure. The model is instructed to bold numbers
 * and keep answers short; this handles exactly that and returns data, never HTML — so
 * there is no `dangerouslySetInnerHTML` anywhere near model output.
 *
 * Pure. Anything it does not recognise passes through as plain text rather than being
 * swallowed, because a stray `*` must never eat the rest of an answer.
 */
export interface TextSpan {
  text: string
  bold: boolean
}

export type Block =
  | { kind: 'paragraph'; spans: TextSpan[] }
  | { kind: 'bullet'; spans: TextSpan[] }
  | { kind: 'heading'; spans: TextSpan[] }

/** Splits on `**bold**`. Unmatched markers stay as literal text. */
export function parseSpans(line: string): TextSpan[] {
  const spans: TextSpan[] = []
  // Non-greedy, and requires content, so `****` is not treated as an empty bold run.
  const pattern = /\*\*(.+?)\*\*/g
  let cursor = 0

  for (const match of line.matchAll(pattern)) {
    const at = match.index
    if (at > cursor) spans.push({ text: line.slice(cursor, at), bold: false })
    spans.push({ text: match[1]!, bold: true })
    cursor = at + match[0].length
  }
  if (cursor < line.length) spans.push({ text: line.slice(cursor), bold: false })

  return spans.filter((s) => s.text !== '')
}

const BULLET = /^\s*(?:[-*•]|\d+[.)])\s+/

export function parseBlocks(markdown: string): Block[] {
  const blocks: Block[] = []
  let paragraph: string[] = []

  const flush = () => {
    if (paragraph.length === 0) return
    blocks.push({ kind: 'paragraph', spans: parseSpans(paragraph.join(' ')) })
    paragraph = []
  }

  for (const raw of markdown.split('\n')) {
    const line = raw.trimEnd()

    if (line.trim() === '') {
      flush()
      continue
    }
    if (BULLET.test(line)) {
      flush()
      blocks.push({ kind: 'bullet', spans: parseSpans(line.replace(BULLET, '')) })
      continue
    }
    if (/^#{1,6}\s+/.test(line)) {
      flush()
      blocks.push({ kind: 'heading', spans: parseSpans(line.replace(/^#{1,6}\s+/, '')) })
      continue
    }
    // Consecutive plain lines join into one paragraph: the model hard-wraps prose, and
    // rendering each wrapped line as its own block breaks the sentence visually.
    paragraph.push(line.trim())
  }
  flush()

  return blocks
}
