import { cva, type VariantProps } from 'class-variance-authority'
import type { ElementType, ReactNode } from 'react'
import { cn } from '@/lib/cn'

/**
 * Every non-numeric string goes through this. It is what stops the type scale
 * drifting into 13px-here-15px-there. Numbers use <NumericValue> instead.
 *
 * `as` is chosen semantically, `variant` visually — they are independent
 * (PRD-002 §3.2).
 */
const text = cva('', {
  variants: {
    variant: {
      title: 'text-xl font-semibold tracking-[-0.01em]',
      // Instrument nomenclature: small caps + generous tracking.
      label: 'text-2xs font-semibold uppercase tracking-[0.08em]',
      body: 'text-base font-normal leading-normal',
      meta: 'text-sm font-normal',
      micro: 'text-2xs font-medium',
    },
    tone: {
      primary: 'text-ink',
      secondary: 'text-ink-2',
      tertiary: 'text-ink-3',
      accent: 'text-accent-ink',
      pos: 'text-pos',
      warn: 'text-warn',
      neg: 'text-neg',
    },
    truncate: { true: 'truncate', false: '' },
  },
  defaultVariants: { variant: 'body', tone: 'primary', truncate: false },
})

type TextVariants = VariantProps<typeof text>

export interface TextProps extends TextVariants {
  as?: ElementType
  /** Set on Japanese food names so VoiceOver pronounces them correctly. */
  lang?: string
  className?: string
  children: ReactNode
}

/** Sensible tone defaults so `label` doesn't need `tone="tertiary"` every time. */
const DEFAULT_TONE: Record<NonNullable<TextVariants['variant']>, TextVariants['tone']> = {
  title: 'primary',
  label: 'tertiary',
  body: 'primary',
  meta: 'secondary',
  micro: 'tertiary',
}

export function Text({
  as: Tag = 'span',
  variant = 'body',
  tone,
  truncate,
  lang,
  className,
  children,
}: TextProps) {
  return (
    <Tag lang={lang} className={cn(text({ variant, tone: tone ?? DEFAULT_TONE[variant!], truncate }), className)}>
      {children}
    </Tag>
  )
}
