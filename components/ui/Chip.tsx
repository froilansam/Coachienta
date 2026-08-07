import { cva, type VariantProps } from 'class-variance-authority'
import { X, type LucideIcon } from 'lucide-react'
import { cn } from '@/lib/cn'

/**
 * Status tokens: EST, UNVERIFIED, PR, NEW GYM, W, TOP.
 * Tinted-wash background is Bloomberg's treatment for a primary delta — it
 * reads as a badge without shouting (PRD-002 §0).
 */
const chip = cva(
  'inline-flex items-center gap-1 rounded-sm font-semibold uppercase tracking-[0.06em] whitespace-nowrap',
  {
    variants: {
      tone: {
        neutral: 'bg-sunk text-ink-2',
        accent: 'bg-accent-wash text-accent-ink',
        pos: 'bg-pos-wash text-pos',
        warn: 'bg-warn-wash text-warn',
        neg: 'bg-neg-wash text-neg',
      },
      size: { sm: 'h-4 px-1 text-[10px]', md: 'h-5 px-1.5 text-2xs' },
    },
    defaultVariants: { tone: 'neutral', size: 'md' },
  },
)

export interface ChipProps extends VariantProps<typeof chip> {
  label: string
  icon?: LucideIcon
  onRemove?: () => void
  className?: string
}

export function Chip({ label, icon: Icon, onRemove, tone, size, className }: ChipProps) {
  return (
    <span className={cn(chip({ tone, size }), className)}>
      {Icon ? <Icon size={11} strokeWidth={2} aria-hidden /> : null}
      {label}
      {onRemove ? (
        <button
          type="button"
          onClick={onRemove}
          aria-label={`Remove ${label}`}
          className="-mr-0.5 ml-0.5 rounded-sm p-0.5 hover:bg-ink/10"
        >
          <X size={11} strokeWidth={2.5} aria-hidden />
        </button>
      ) : null}
    </span>
  )
}
