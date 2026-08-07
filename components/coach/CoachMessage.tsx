'use client'
import { ChevronRight } from 'lucide-react'
import { useState } from 'react'
import { Chip } from '@/components/ui/Chip'
import { Rule } from '@/components/ui/Rule'
import { Text } from '@/components/ui/Text'
import { cn } from '@/lib/cn'
import type { CoachTurn } from '@/hooks/useCoach'
import type { Block } from '@/lib/domain/coach/richText'

/**
 * One exchange. **User bubbled, assistant unbubbled** (PRD-005 §3.8, WHOOP Coach).
 *
 * The asymmetry is the whole point: a 200-word numeric analysis inside a grey chat
 * bubble is unreadable, and it reads as chatter rather than as a report. Unbubbled with
 * a small glyph marker, it reads as a document — which is what Superpower's Concierge
 * does with lab values, and the closest register to this app's instrument aesthetic.
 *
 * No avatar. A cartoon coach is the wrong register (PRD-002 §10).
 */
function Spans({ blocks }: { blocks: readonly Block[] }) {
  return (
    <>
      {blocks.map((block, i) => {
        const content = block.spans.map((span, j) =>
          span.bold ? (
            // Bolded numbers are scannability, and they reinforce the instrument voice.
            <strong key={j} className="font-semibold text-ink">
              {span.text}
            </strong>
          ) : (
            <span key={j}>{span.text}</span>
          ),
        )

        if (block.kind === 'bullet') {
          return (
            <li key={i} className="ml-4 list-disc pl-1 text-base leading-relaxed text-ink-2">
              {content}
            </li>
          )
        }
        if (block.kind === 'heading') {
          return (
            <Text key={i} as="h3" variant="label" className="pt-1">
              {content}
            </Text>
          )
        }
        return (
          <p key={i} className="text-base leading-relaxed text-ink-2">
            {content}
          </p>
        )
      })}
    </>
  )
}

export function CoachMessage({ turn }: { turn: CoachTurn }) {
  const [showSources, setShowSources] = useState(false)

  if (turn.role === 'user') {
    return (
      <div className="flex justify-end">
        <p className="max-w-[85%] rounded-md rounded-br-sm bg-sunk px-3 py-2 text-base text-ink">
          {turn.blocks.map((b) => b.spans.map((s) => s.text).join('')).join(' ')}
        </p>
      </div>
    )
  }

  return (
    <div className="flex gap-2.5">
      {/*
        `◉`, exactly as §3.8 draws it — a glyph, not an avatar, and not an icon either.
        A cartoon coach is the wrong register (PRD-002 §10), and a text mark cannot drift
        when an icon library renames something. It also gives the answer a hanging indent,
        which is what makes an unbubbled reply read as a block rather than as loose text.
      */}
      <span aria-hidden className="mt-0.5 shrink-0 font-mono text-base leading-relaxed text-accent-ink">
        ◉
      </span>

      <div className="flex min-w-0 flex-1 flex-col gap-2">
        <div className="flex flex-col gap-2">
          <Spans blocks={turn.blocks} />
        </div>

        {turn.degraded ? (
          <Chip label="FALLBACK MODEL" tone="warn" size="sm" className="self-start" />
        ) : null}

        {/*
          `▸ DATA USED` — non-negotiable (§3.6). It sits at the point of the claim, and
          it lists the range the model CHOSE, because asked twice for "last week" it
          picked two different windows. An AI citing numbers you cannot check is worse
          than no AI, since you will believe it.
        */}
        {turn.sources.length > 0 ? (
          <div className="flex flex-col gap-1.5">
            <button
              type="button"
              onClick={() => setShowSources((v) => !v)}
              aria-expanded={showSources}
              className="flex min-h-11 items-center gap-1.5 self-start text-left"
            >
              <ChevronRight
                size={13}
                strokeWidth={2.5}
                aria-hidden
                className={cn('text-ink-3 transition-transform', showSources && 'rotate-90')}
              />
              <Text variant="label">{`DATA USED (${turn.sources.length})`}</Text>
            </button>

            {showSources ? (
              <div className="flex flex-col gap-2 rounded-md bg-sunk px-3 py-2">
                {turn.sources.map((s, i) => (
                  /*
                    Two lines per source, always: name and coverage on the first, the
                    range beneath. Putting all three on one line made the shape depend on
                    how long the tool name happened to be — one row wrapped, the next did
                    not, and two identical facts read as two different things. A receipt
                    has one shape.
                  */
                  <div key={`${s.tool}-${i}`} className="flex flex-col">
                    <span className="flex items-baseline justify-between gap-3">
                      <Text variant="micro" tone="secondary" truncate>
                        {s.tool}
                      </Text>
                      <span className="tabular shrink-0 font-mono text-2xs text-ink-3">{s.count}</span>
                    </span>
                    <span className="tabular font-mono text-2xs text-ink-3">{s.detail}</span>
                  </div>
                ))}
                {turn.model ? (
                  <>
                    <Rule />
                    <Text variant="micro" tone="tertiary">
                      {`Answered by ${turn.model}`}
                    </Text>
                  </>
                ) : null}
              </div>
            ) : null}
          </div>
        ) : null}
      </div>
    </div>
  )
}
