'use client'
import { Delete } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { Sheet } from '@/components/ui/Sheet'
import { Text } from '@/components/ui/Text'
import { cn } from '@/lib/cn'

/**
 * Large-key in-app numeric pad (Bevel pattern, PRD-007 §4.6).
 *
 * Justified for gym input: the native iOS keyboard is small, eats half the
 * screen, and can trigger the <16px zoom. These keys are 56px, reachable with a
 * thumb and sweaty hands, and the pad can't zoom the page.
 */
export interface KeypadSheetProps {
  open: boolean
  onOpenChange: (v: boolean) => void
  label: string
  value: string
  unit?: string
  onChange: (v: string) => void
  onDone: () => void
  allowDecimal?: boolean
}

const DIGITS = ['1', '2', '3', '4', '5', '6', '7', '8', '9'] as const

export function KeypadSheet({
  open,
  onOpenChange,
  label,
  value,
  unit,
  onChange,
  onDone,
  allowDecimal = true,
}: KeypadSheetProps) {
  const press = (k: string) => {
    if (k === '.' && value.includes('.')) return
    if (k === '.' && value === '') return onChange('0.')
    onChange(value + k)
  }

  const key = (k: string, onPress: () => void, extra?: string) => (
    <button
      key={k}
      type="button"
      onClick={onPress}
      aria-label={k === '⌫' ? 'Delete' : k}
      className={cn(
        'tabular grid h-14 place-items-center rounded-md border border-rule bg-surface',
        'font-mono text-2xl text-ink transition-colors active:bg-sunk',
        extra,
      )}
    >
      {k === '⌫' ? <Delete size={22} strokeWidth={1.5} aria-hidden /> : k}
    </button>
  )

  return (
    <Sheet open={open} onOpenChange={onOpenChange} title={label} size="auto">
      <div className="flex flex-col gap-4 pb-4">
        {/* Readout mirrors the field it's editing — same font, same alignment. */}
        <div className="flex items-baseline justify-end gap-1.5 rounded-md bg-sunk px-4 py-3">
          <span className="tabular font-mono text-4xl font-medium text-ink">{value || '0'}</span>
          {unit ? <Text variant="label">{unit}</Text> : null}
        </div>

        <div className="grid grid-cols-3 gap-2">
          {DIGITS.map((d) => key(d, () => press(d)))}
          {allowDecimal ? key('.', () => press('.')) : <span />}
          {key('0', () => press('0'))}
          {key('⌫', () => onChange(value.slice(0, -1)))}
        </div>

        <Button variant="primary" size="lg" fullWidth onClick={onDone}>
          DONE
        </Button>
      </div>
    </Sheet>
  )
}
