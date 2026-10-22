'use client'
import {
  useId,
  type InputHTMLAttributes,
  type ReactElement,
  type ReactNode,
  type TextareaHTMLAttributes,
  cloneElement,
} from 'react'
import { cn } from '@/lib/cn'
import { Text } from './Text'

/**
 * Owns the label / hint / error slot and the aria wiring, so no control has to
 * repeat it. A placeholder is never the only label.
 *
 * Error replaces hint in the SAME slot — validating must not shift layout.
 *
 * `action` puts a button beside the control — `[ Pull legs!      ] [ BUILD ]`.
 * It exists because the obvious hand-rolled version is subtly wrong: wrapping the
 * whole Field in `flex items-end` aligns the button to the bottom of the **hint**,
 * not the input, which dropped BUILD a full line below the box it belongs to. Inside
 * the Field the label stays above and the hint below *both*, so they cannot disagree.
 */
export function Field({
  label,
  hint,
  error,
  required,
  labelHidden,
  action,
  children,
}: {
  label: string
  hint?: string
  error?: string
  required?: boolean
  labelHidden?: boolean
  /** A control that belongs to this field, placed on the same line as it. */
  action?: ReactNode
  children: ReactElement<{ id?: string; 'aria-invalid'?: boolean; 'aria-describedby'?: string }>
}) {
  const id = useId()
  const msgId = `${id}-msg`
  const msg = error ?? hint

  const control = cloneElement(children, {
    id,
    'aria-invalid': error ? true : undefined,
    'aria-describedby': msg ? msgId : undefined,
  })

  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={id} className={cn(labelHidden && 'sr-only')}>
        <Text variant="label">
          {label}
          {required ? <span className="text-neg"> *</span> : null}
        </Text>
      </label>

      {action ? (
        <div className="flex items-stretch gap-2">
          {/* `min-w-0` or a long placeholder pushes the action off the row. */}
          <div className="min-w-0 flex-1">{control}</div>
          {action}
        </div>
      ) : (
        control
      )}

      {msg ? (
        <Text as="p" variant="micro" tone={error ? 'neg' : 'tertiary'} className="min-h-4">
          {msg}
        </Text>
      ) : null}
    </div>
  )
}

const base =
  'w-full rounded-md border bg-surface px-3 text-base text-ink placeholder:text-ink-3 ' +
  'transition-colors outline-none focus-visible:border-accent ' +
  'disabled:opacity-40 aria-[invalid=true]:border-neg'

export interface InputProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'size' | 'className'> {
  size?: 'md' | 'lg'
  className?: string
}

/** `text-base` (16px) is a floor, not a preference: anything smaller makes iOS
 *  Safari zoom the page in on focus. */
export function Input({ size = 'md', className, ...rest }: InputProps) {
  return (
    <input
      {...rest}
      className={cn(base, 'border-rule', size === 'lg' ? 'h-13' : 'h-11', className)}
    />
  )
}

export interface TextareaProps
  extends Omit<TextareaHTMLAttributes<HTMLTextAreaElement>, 'className'> {
  className?: string
}

/** Same floor as `Input`: 16px, or iOS Safari zooms the page in on focus. */
export function Textarea({ className, rows = 4, ...rest }: TextareaProps) {
  return (
    <textarea
      {...rest}
      rows={rows}
      className={cn(base, 'border-rule py-2 leading-normal', className)}
    />
  )
}
