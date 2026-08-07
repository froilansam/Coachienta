import { cva, type VariantProps } from 'class-variance-authority'
import { cn } from '@/lib/cn'
import { fmtNum, fmtSigned } from '@/lib/format/number'

/**
 * The most-used component in the app, and the one carrying the aesthetic.
 *
 * Always monospace + tabular so vertical columns align. `null` renders a dash,
 * never `0` — a missing weigh-in is not 0 kg, and plotting it as zero would put
 * a cliff in every chart. (Binance does the same: `--`, not `0`.)
 *
 * Units take a thin space, EXCEPT `%` and `°`, which are set closed-up by convention.
 * `21 %` reads as a typo in a way `21 kg` does not.
 */
const value = cva('tabular font-mono whitespace-nowrap', {
  variants: {
    size: {
      metric: 'text-4xl font-medium tracking-[-0.02em]',
      data: 'text-base font-normal',
      compact: 'text-[13px] font-medium',
    },
    tone: {
      primary: 'text-ink',
      secondary: 'text-ink-2',
      tertiary: 'text-ink-3',
      accent: 'text-accent-ink',
      pos: 'text-pos',
      neg: 'text-neg',
      warn: 'text-warn',
    },
  },
  defaultVariants: { size: 'data', tone: 'primary' },
})

export interface NumericValueProps extends VariantProps<typeof value> {
  value: number | null
  unit?: string
  decimals?: number
  showSign?: boolean
  /** Shown when value is null. Never substitute 0. */
  placeholder?: string
  className?: string
}

/** Units set tight against the number. Everything else takes a space. */
const CLOSED_UP = new Set(['%', '°', '°C', 'x', '×'])

export function NumericValue({
  value: v,
  unit,
  decimals,
  showSign = false,
  placeholder = '—',
  size,
  tone,
  className,
}: NumericValueProps) {
  const body =
    v === null ? placeholder : showSign ? fmtSigned(v, decimals) : fmtNum(v, decimals)

  return (
    <span className={cn(value({ size, tone }), className)}>
      {body}
      {unit && v !== null ? (
        <span className={cn('text-[0.7em] font-normal text-ink-3', CLOSED_UP.has(unit) ? '' : 'ml-1')}>
          {unit}
        </span>
      ) : null}
    </span>
  )
}
