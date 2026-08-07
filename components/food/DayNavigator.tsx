'use client'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import { Text } from '@/components/ui/Text'
import { cn } from '@/lib/cn'

/**
 * Steps the day being viewed. `‹ YESTERDAY ›` with the label itself a date picker.
 *
 * The label doubles as the control rather than sitting beside a calendar icon:
 * it is already the biggest tap target in the header, and a separate icon would
 * add a second thing to explain for the same action.
 *
 * Forward stops at today — you cannot have eaten tomorrow, and letting the arrow
 * walk into empty future days is a dead end. The date field itself has no `max`,
 * so an entry accidentally logged ahead is still reachable deliberately.
 */
export function DayNavigator({
  date,
  label,
  canGoForward,
  isToday,
  onStep,
  onPick,
  onToday,
}: {
  date: string
  /** `TODAY`, `YESTERDAY`, or `05 AUG · WED` — computed in the hook. */
  label: string
  canGoForward: boolean
  isToday: boolean
  onStep: (delta: number) => void
  onPick: (iso: string) => void
  onToday: () => void
}) {
  return (
    <div className="flex items-center gap-1">
      <Arrow direction="back" onClick={() => onStep(-1)} />

      {/*
        A native date input styled as text. The platform picker is better than
        anything worth building here, and on iOS it is the control the user
        already knows.
      */}
      <span className="relative">
        <Text variant="label">{label}</Text>
        <input
          type="date"
          value={date}
          aria-label="Pick a day to view"
          onChange={(e) => e.target.value && onPick(e.target.value)}
          className="absolute inset-0 h-full w-full cursor-pointer opacity-0"
        />
      </span>

      <Arrow direction="forward" disabled={!canGoForward} onClick={() => onStep(1)} />

      {/* Only offered once it does something — no dead control on today. */}
      {isToday ? null : (
        <button
          type="button"
          onClick={onToday}
          // 44px tall via padding, per PRD-002 — the glyph stays small.
          className="ml-1 grid min-h-11 place-items-center rounded-sm px-2 text-2xs font-semibold uppercase tracking-[0.08em] text-accent hover:bg-accent-wash"
        >
          Today
        </button>
      )}
    </div>
  )
}

function Arrow({
  direction,
  disabled,
  onClick,
}: {
  direction: 'back' | 'forward'
  disabled?: boolean
  onClick: () => void
}) {
  const Icon = direction === 'back' ? ChevronLeft : ChevronRight
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      aria-label={direction === 'back' ? 'Previous day' : 'Next day'}
      className={cn(
        'grid size-8 shrink-0 place-items-center rounded-sm text-ink-2',
        'hover:bg-sunk hover:text-ink disabled:pointer-events-none disabled:opacity-30',
      )}
    >
      <Icon size={18} strokeWidth={2} aria-hidden />
    </button>
  )
}
