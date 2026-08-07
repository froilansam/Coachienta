'use client'
import { useState, type ReactNode } from 'react'
import { cn } from '@/lib/cn'
import { Text } from './Text'

/**
 * Workhorse for every list. Label + optional sub-label left, numbers right —
 * the Bloomberg / Fidelity arrangement (PRD-002 §0).
 *
 * `barTone` draws a left colour bar. Bloomberg uses it to encode direction as a
 * POSITION as well as a colour, so meaning survives colour-blindness.
 */
export interface SwipeAction {
  label: string
  tone: 'neutral' | 'negative'
  onAction: () => void
}

export interface ListRowProps {
  leading?: ReactNode
  title: string
  subtitle?: string
  meta?: ReactNode
  trailing?: ReactNode
  barTone?: 'pos' | 'neg' | 'accent'
  zebra?: boolean
  lang?: string
  onClick?: () => void
  /** Swipe-left reveal (MyFitnessPal idiom). See the a11y note below. */
  swipeActions?: readonly SwipeAction[]
  className?: string
}

const ACTION_W = 88

export function ListRow({
  leading,
  title,
  subtitle,
  meta,
  trailing,
  barTone,
  zebra,
  lang,
  onClick,
  swipeActions,
  className,
}: ListRowProps) {
  const [offset, setOffset] = useState(0)
  /**
   * Where the drag started, or null when idle. State rather than a ref because
   * it decides whether the row animates — a ref read during render is exactly
   * the stale-value trap the React lint rule is pointing at, and `onPointerMove`
   * already re-renders on every move.
   */
  const [dragFrom, setDragFrom] = useState<number | null>(null)
  const maxSlide = (swipeActions?.length ?? 0) * ACTION_W
  const open = offset <= -maxSlide + 8

  const Tag = onClick ? 'button' : 'div'

  const body = (
    <Tag
      {...(onClick ? { type: 'button' as const, onClick } : {})}
      className={cn(
        'relative flex min-h-11 w-full items-center gap-3 py-2 text-left',
        zebra && 'bg-sunk',
        onClick && 'transition-colors hover:bg-sunk',
        barTone && 'pl-2.5',
        className,
      )}
    >
      {barTone ? (
        <span
          aria-hidden
          className={cn(
            'absolute inset-y-1 left-0 w-[3px] rounded-full',
            barTone === 'pos' ? 'bg-pos' : barTone === 'neg' ? 'bg-neg' : 'bg-accent',
          )}
        />
      ) : null}

      {leading}

      <span className="flex min-w-0 flex-1 flex-col">
        <Text variant="body" truncate lang={lang}>
          {title}
        </Text>
        {subtitle ? (
          <Text variant="micro" truncate>
            {subtitle}
          </Text>
        ) : null}
      </span>

      {meta ? <span className="shrink-0 text-right">{meta}</span> : null}
      {trailing}
    </Tag>
  )

  if (!swipeActions?.length) return body

  return (
    <div className="relative overflow-hidden">
      {/*
        The action buttons live in the DOM permanently and are only translated
        out of view — so they stay tabbable and announced by screen readers even
        while visually hidden. That satisfies "every swipe action must also be
        reachable without swiping" (PRD-007 §3.16) without a second long-press
        menu to build and keep in sync.
      */}
      <div className="absolute inset-y-0 right-0 flex">
        {swipeActions.map((a) => (
          <button
            key={a.label}
            type="button"
            /* "Delete" alone is a useless accessible name in a list of twelve
               rows — a screen-reader user hears it twelve times with no way to
               tell them apart. Naming the row makes each action unambiguous. */
            aria-label={`${a.label} ${title}`}
            onClick={() => {
              a.onAction()
              setOffset(0)
            }}
            style={{ width: ACTION_W }}
            className={cn(
              'text-sm font-semibold',
              a.tone === 'negative' ? 'bg-neg text-on-accent' : 'bg-sunk text-ink',
            )}
          >
            {a.label}
          </button>
        ))}
      </div>

      <div
        style={{
          transform: `translateX(${offset}px)`,
          // pan-y so vertical scrolling still works through the row.
          touchAction: 'pan-y',
          transition: dragFrom === null ? 'transform 180ms var(--ease-out-quart)' : 'none',
        }}
        className="relative bg-bg"
        onPointerDown={(e) => {
          // Mouse included on purpose: without it, desktop had no way to reach
          // the actions at all — they are visually behind the row.
          setDragFrom(e.clientX - (open ? -maxSlide : 0))
        }}
        onPointerMove={(e) => {
          if (dragFrom === null) return
          setOffset(Math.max(Math.min(e.clientX - dragFrom, 0), -maxSlide))
        }}
        onPointerUp={() => {
          setDragFrom(null)
          setOffset(offset < -maxSlide / 2 ? -maxSlide : 0)
        }}
        onPointerCancel={() => {
          setDragFrom(null)
          setOffset(0)
        }}
      >
        {body}
      </div>
    </div>
  )
}
