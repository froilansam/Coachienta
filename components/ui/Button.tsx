'use client'
import { cva, type VariantProps } from 'class-variance-authority'
import { Loader2, type LucideIcon } from 'lucide-react'
import type { ButtonHTMLAttributes, ReactNode } from 'react'
import { cn } from '@/lib/cn'

/**
 * Exactly one `primary` per screen — its job is to answer "what do I probably
 * want here?", and two of them answer nothing.
 *
 * `danger` is text-only by default. A destructive action is not automatically
 * big and red; the solid red belongs on the confirmation step. Hevy renders
 * "Discard Workout" as red text for the same reason (PRD-007 §3.3).
 */
const button = cva(
  'inline-flex items-center justify-center gap-2 rounded-md font-medium ' +
    'transition-[transform,background-color,border-color] duration-100 ease-out-quart ' +
    'active:translate-y-px disabled:pointer-events-none disabled:opacity-40',
  {
    variants: {
      variant: {
        primary: 'bg-accent text-on-accent hover:brightness-105',
        secondary: 'border border-rule-strong text-ink hover:bg-sunk',
        ghost: 'text-ink-2 hover:bg-sunk hover:text-ink',
        danger: 'text-neg hover:bg-neg-wash',
        /**
         * Solid red, and ONLY on the confirm step of a destructive action
         * (PRD-002 action hierarchy). A delete button that is already solid red
         * before you have been asked anything trains you to tap through it.
         */
        destructive: 'bg-neg text-on-accent hover:brightness-105',
      },
      size: {
        // 44px is the iOS touch minimum — `md` is the floor for anything tapped.
        sm: 'h-8 px-3 text-sm',
        md: 'h-11 px-4 text-base',
        lg: 'h-13 px-6 text-base',
      },
      fullWidth: { true: 'w-full', false: '' },
    },
    defaultVariants: { variant: 'secondary', size: 'md', fullWidth: false },
  },
)

export interface ButtonProps
  extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'className'>,
    VariantProps<typeof button> {
  loading?: boolean
  iconStart?: LucideIcon
  iconEnd?: LucideIcon
  className?: string
  children?: ReactNode
}

export function Button({
  variant,
  size,
  fullWidth,
  loading = false,
  iconStart: Start,
  iconEnd: End,
  className,
  children,
  disabled,
  ...rest
}: ButtonProps) {
  return (
    <button
      {...rest}
      // Width stays fixed while loading, so nothing shifts.
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      className={cn(button({ variant, size, fullWidth }), className)}
    >
      {loading ? (
        <Loader2 size={18} className="animate-spin" aria-hidden />
      ) : (
        <>
          {Start ? <Start size={18} strokeWidth={1.5} aria-hidden /> : null}
          {children}
          {End ? <End size={18} strokeWidth={1.5} aria-hidden /> : null}
        </>
      )}
    </button>
  )
}

export interface IconButtonProps extends Omit<ButtonProps, 'children' | 'iconStart' | 'iconEnd'> {
  icon: LucideIcon
  /** Required — an icon-only control with no accessible name is the most
   *  common a11y failure in mobile UI. */
  label: string
}

export function IconButton({ icon: Icon, label, size = 'md', className, ...rest }: IconButtonProps) {
  return (
    <Button
      {...rest}
      size={size}
      aria-label={label}
      // Square, but the hit area still meets 44px via the size token.
      className={cn(size === 'sm' ? 'w-8 px-0' : 'w-11 px-0', className)}
    >
      <Icon size={20} strokeWidth={1.5} aria-hidden />
    </Button>
  )
}
