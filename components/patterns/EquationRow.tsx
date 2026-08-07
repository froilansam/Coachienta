import { NumericValue } from '@/components/ui/NumericValue'
import { Text } from '@/components/ui/Text'

/**
 * `2,350 GOAL − 2,090 FOOD = 260 REMAINING`
 *
 * MyFitnessPal lays the calorie arithmetic out as a visible equation rather than
 * a bare remaining figure. It suits this product better than anything I'd
 * designed — showing the working IS the personality (PRD-002 §0).
 */
export interface Term {
  label: string
  value: number
  operator?: '−' | '+' | '='
  tone?: 'primary' | 'secondary' | 'accent' | 'pos' | 'neg'
}

export function EquationRow({ terms }: { terms: readonly Term[] }) {
  return (
    <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
      {terms.map((t, i) => (
        <span key={t.label} className="flex items-baseline gap-1.5">
          {t.operator ? (
            <span aria-hidden className="font-mono text-base text-ink-3">
              {t.operator}
            </span>
          ) : null}
          <NumericValue value={t.value} tone={t.tone ?? (i === terms.length - 1 ? 'accent' : 'primary')} />
          <Text variant="label">{t.label}</Text>
        </span>
      ))}
    </div>
  )
}
