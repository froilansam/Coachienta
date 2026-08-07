'use client'
import { Minus, Plus } from 'lucide-react'
import { cn } from '@/lib/cn'
import { IconButton } from './Button'
import { NumericInput } from './NumericInput'

/**
 * The grams control. Small component, disproportionate effect on how fast
 * logging feels.
 *
 * `presets` is the detail that matters: derived from the food's own history, so
 * the common case is one tap instead of typing (PRD-007 §3.7).
 */
export interface StepperProps {
  value: number | null
  onChange: (v: number | null) => void
  unit: string
  step?: number
  min?: number
  max?: number
  presets?: readonly number[]
  label: string
  className?: string
}

export function Stepper({
  value,
  onChange,
  unit,
  step = 10,
  min = 0,
  max,
  presets,
  label,
  className,
}: StepperProps) {
  const nudge = (delta: number) =>
    onChange(Math.min(Math.max((value ?? 0) + delta, min), max ?? Number.POSITIVE_INFINITY))

  return (
    <div className={cn('flex flex-col gap-2', className)}>
      <div className="flex items-stretch gap-2">
        <IconButton
          icon={Minus}
          label={`Decrease ${label}`}
          onClick={() => nudge(-step)}
          disabled={value !== null && value <= min}
        />
        <NumericInput
          value={value}
          onChange={onChange}
          unit={unit}
          min={min}
          max={max}
          aria-label={label}
          className="flex-1"
        />
        <IconButton icon={Plus} label={`Increase ${label}`} onClick={() => nudge(step)} />
      </div>

      {presets?.length ? (
        <div className="flex gap-1.5">
          {presets.map((p) => (
            <button
              key={p}
              type="button"
              onClick={() => onChange(p)}
              aria-pressed={value === p}
              className={cn(
                'tabular h-8 flex-1 rounded-md border font-mono text-sm transition-colors',
                value === p
                  ? 'border-accent bg-accent-wash text-accent-ink'
                  : 'border-rule text-ink-2 hover:bg-sunk',
              )}
            >
              {p}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  )
}
