'use client'
import { useState } from 'react'
import { cn } from '@/lib/cn'

/**
 * Separate from <Input> because numeric entry mid-workout has different rules.
 *
 * - `type="text"` + `inputMode="decimal"`: `type="number"` brings spinners and
 *   rejects valid intermediate strings like "1." while typing.
 * - `selectOnFocus`: fields are prefilled from the previous set, so a tap should
 *   let you overtype immediately — that is the whole point of prefilling.
 * - mono + tabular + right-aligned, matching every other number on screen.
 */
export interface NumericInputProps {
  value: number | null
  onChange: (v: number | null) => void
  unit?: string
  min?: number
  max?: number
  decimals?: number
  /** Typically the previous set's value — a hint, not a default. */
  placeholder?: string
  size?: 'md' | 'lg'
  selectOnFocus?: boolean
  disabled?: boolean
  id?: string
  'aria-label'?: string
  className?: string
}

export function NumericInput({
  value,
  onChange,
  unit,
  min = 0,
  max,
  decimals = 1,
  placeholder,
  size = 'md',
  selectOnFocus = true,
  disabled,
  className,
  ...aria
}: NumericInputProps) {
  const [draft, setDraft] = useState(value === null ? '' : String(value))
  const [lastValue, setLastValue] = useState(value)

  /**
   * Keep the draft in step when the PARENT changes the value (prefill, stepper),
   * without clobbering what is being typed.
   *
   * Adjusted during render, not in an effect: React discards this pass and
   * re-runs before painting, so there is no flash of the stale number and no
   * cascading second commit.
   */
  if (value !== lastValue) {
    setLastValue(value)
    setDraft(value === null ? '' : String(value))
  }

  const commit = (raw: string) => {
    const cleaned = raw.replace(/[^\d.]/g, '')
    setDraft(cleaned)
    if (cleaned === '' || cleaned === '.') return onChange(null)
    const n = Number.parseFloat(cleaned)
    if (Number.isNaN(n)) return
    const clamped = Math.min(Math.max(n, min), max ?? Number.POSITIVE_INFINITY)
    onChange(Number(clamped.toFixed(decimals)))
  }

  return (
    <div className="relative">
      <input
        {...aria}
        type="text"
        inputMode="decimal"
        autoComplete="off"
        value={draft}
        placeholder={placeholder}
        disabled={disabled}
        onFocus={(e) => selectOnFocus && e.currentTarget.select()}
        onChange={(e) => commit(e.target.value)}
        className={cn(
          'tabular w-full rounded-md border border-rule bg-surface font-mono text-base text-ink',
          'text-right outline-none transition-colors placeholder:text-ink-3',
          'focus-visible:border-accent disabled:opacity-40 aria-[invalid=true]:border-neg',
          size === 'lg' ? 'h-13' : 'h-11',
          unit ? 'pr-8 pl-3' : 'px-3',
          className,
        )}
      />
      {unit ? (
        <span className="pointer-events-none absolute inset-y-0 right-2.5 flex items-center text-2xs font-medium text-ink-3">
          {unit}
        </span>
      ) : null}
    </div>
  )
}
