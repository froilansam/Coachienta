'use client'
import * as RS from '@radix-ui/react-select'
import { Check, ChevronDown } from 'lucide-react'
import { cn } from '@/lib/cn'
import { Text } from './Text'

/**
 * Radix Select — keyboard navigable and native-feeling on iOS.
 * For 2–4 mutually exclusive view options prefer SegmentedControl; this is for
 * longer lists (exercise pick, meal type, gym).
 *
 * `showLabel` draws the label above the trigger, matching `Field`. Without it a
 * select is labelled only for assistive tech, which left the plan screen alternating
 * labelled and bare controls down one column — DATE and PROMPT titled, Gym and
 * Template not. The visible text is `aria-hidden` and `aria-label` still carries the
 * accessible name, so the name a screen reader announces does not change.
 */
export interface SelectProps<T extends string> {
  value: T
  onChange: (v: T) => void
  options: ReadonlyArray<{ value: T; label: string; disabled?: boolean }>
  label: string
  /** Draw `label` above the trigger as well as announcing it. */
  showLabel?: boolean
  placeholder?: string
  size?: 'md' | 'lg'
  disabled?: boolean
}

export function Select<T extends string>({
  value, onChange, options, label, showLabel, placeholder = 'Select…', size = 'md', disabled,
}: SelectProps<T>) {
  return (
    <RS.Root value={value} onValueChange={(v) => onChange(v as T)} disabled={disabled}>
      {/*
        Wrapped, always. `RS.Root` renders no DOM node of its own, so an unwrapped
        label and trigger become two SIBLINGS of whatever contains the Select — and in
        a `flex flex-col gap-3` column they inherited that 12 px, putting the gym label
        18 px above its control while `Field` put every other label 6 px above its own.
        The wrapper makes the pairing independent of the parent's layout.
      */}
      <div className="flex w-full flex-col gap-1.5">
        {showLabel ? (
          // `gap-1.5` and `variant="label"` match Field, so labelled controls of
          // either kind line up down one column.
          <span aria-hidden>
            <Text variant="label">{label}</Text>
          </span>
        ) : null}
        <RS.Trigger
          aria-label={label}
          className={cn(
            'flex w-full items-center justify-between gap-2 rounded-md border border-rule bg-surface px-3',
            'text-base text-ink transition-colors data-[placeholder]:text-ink-3',
            'hover:bg-sunk disabled:opacity-40',
            size === 'lg' ? 'h-13' : 'h-11',
          )}
        >
          <RS.Value placeholder={placeholder} />
          <RS.Icon><ChevronDown size={18} strokeWidth={1.5} aria-hidden className="text-ink-3" /></RS.Icon>
        </RS.Trigger>
      </div>

      <RS.Portal>
        <RS.Content
          position="popper"
          sideOffset={4}
          className="z-60 max-h-[50dvh] min-w-[--radix-select-trigger-width] overflow-hidden rounded-md border border-rule-strong bg-surface shadow-pop"
        >
          <RS.Viewport className="p-1">
            {options.map((o) => (
              <RS.Item
                key={o.value}
                value={o.value}
                disabled={o.disabled}
                className={cn(
                  'flex min-h-11 cursor-pointer items-center gap-2 rounded-sm px-2 text-base text-ink outline-none',
                  'data-[highlighted]:bg-sunk data-[disabled]:opacity-40',
                )}
              >
                <span className="grid w-4 place-items-center">
                  <RS.ItemIndicator><Check size={14} strokeWidth={2.5} aria-hidden /></RS.ItemIndicator>
                </span>
                <RS.ItemText>{o.label}</RS.ItemText>
              </RS.Item>
            ))}
          </RS.Viewport>
        </RS.Content>
      </RS.Portal>
    </RS.Root>
  )
}
