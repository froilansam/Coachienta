'use client'
import { ArrowUp } from 'lucide-react'
import { Input } from '@/components/ui/Field'
import { Text } from '@/components/ui/Text'
import { cn } from '@/lib/cn'

/**
 * The input, the follow-up chips above it, and the disclaimer beneath.
 *
 * Pinned to the bottom, which is where a thumb reaches one-handed (PRD-002 §4). The
 * chips scroll horizontally rather than wrapping — a wrapping row changes the input's
 * position between answers, and a control that moves under your thumb is worse than one
 * you have to scroll to (WHOOP Coach does the same).
 *
 * Display props in, events out. It knows nothing about tools or models.
 */
export function CoachComposer({
  value,
  onChange,
  onSend,
  canSend,
  isBusy,
  followUps,
  onPick,
}: {
  value: string
  onChange: (v: string) => void
  onSend: () => void
  canSend: boolean
  isBusy: boolean
  followUps: readonly string[]
  onPick: (text: string) => void
}) {
  return (
    <div className="sticky bottom-0 -mx-4 flex flex-col gap-2 border-t border-rule bg-bg/95 px-4 pt-2 pb-safe backdrop-blur-sm">
      {followUps.length > 0 ? (
        <div
          className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-0.5"
          // The row scrolls; it must not become a horizontal scrollbar on the page.
          style={{ scrollbarWidth: 'none' }}
        >
          {followUps.map((chip) => (
            <button
              key={chip}
              type="button"
              disabled={isBusy}
              onClick={() => onPick(chip)}
              className="min-h-9 shrink-0 rounded-md border border-rule bg-surface px-3 text-sm whitespace-nowrap text-ink-2 transition-colors hover:border-rule-strong hover:text-ink disabled:opacity-40"
            >
              {chip}
            </button>
          ))}
        </div>
      ) : null}

      <div className="flex items-center gap-2">
        <Input
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder="Ask Coachienta anything"
          aria-label="Ask Coachienta"
          enterKeyHint="send"
          onKeyDown={(e) => {
            if (e.key === 'Enter' && canSend) onSend()
          }}
        />
        {/*
          Disabled is drawn as NEUTRAL, not as faded accent. `bg-accent` at 30 % opacity
          reads as a broken orange blob rather than as an inactive control — the button
          should look inert, not damaged.
        */}
        <button
          type="button"
          onClick={onSend}
          disabled={!canSend}
          aria-label="Send"
          className={cn(
            'grid size-11 shrink-0 place-items-center rounded-md transition-colors',
            canSend
              ? 'bg-accent text-on-accent hover:brightness-105'
              : 'border border-rule bg-surface text-ink-3',
          )}
        >
          <ArrowUp size={18} strokeWidth={2.5} aria-hidden />
        </button>
      </div>

      {/* Always visible, never a one-time modal. Required given the post-op
          constraint — a disclaimer you have already dismissed is not a disclaimer. */}
      <Text variant="micro" tone="tertiary" className="pb-1">
        Not medical advice. Answers respect your logged data and your post-op constraints.
      </Text>
    </div>
  )
}
