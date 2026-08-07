'use client'
import { AlertTriangle, Check } from 'lucide-react'
import { Chip } from '@/components/ui/Chip'
import { Field, Input } from '@/components/ui/Field'
import { NumericInput } from '@/components/ui/NumericInput'
import { NumericValue } from '@/components/ui/NumericValue'
import { Rule } from '@/components/ui/Rule'
import { Text } from '@/components/ui/Text'
import type { LabelDraft } from '@/hooks/usePhotoDraft'

/**
 * A photographed nutrition panel, confirmed.
 *
 * Deliberately a different screen from `PhotoReview`, because a label is a
 * different kind of claim. A plate is an estimate, so that screen leads with
 * "these are guesses, check the grams". A label is printed fact, so this one
 * leads with a verdict on whether the printed numbers reconcile, then shows the
 * panel as transcribed — you can hold the phone next to the packet and compare
 * line by line. Nothing here is rounded, reordered or renamed by us.
 *
 * Two things stay the user's: **the name**, because that is what makes the row
 * findable next week and OCR gets names wrong far more often than digits, and
 * **how much you ate**, which no label can know (PRD-003 §3.3b).
 */
export function LabelReview({
  previewUrl,
  label,
  onNameChange,
  onBrandChange,
  onAmountChange,
}: {
  previewUrl: string | null
  label: LabelDraft
  onNameChange: (v: string) => void
  onBrandChange: (v: string) => void
  onAmountChange: (v: number | null) => void
}) {
  const { display, macros } = label
  const VerdictIcon = display.verdict.tone === 'pos' ? Check : AlertTriangle

  return (
    <div className="flex flex-col gap-4 pb-2">
      {/*
        Name first, and editable. It is the field that decides whether this ever
        gets found again, so it leads rather than sitting under a heading as
        read-only text.
      */}
      <div className="flex items-start gap-3">
        {previewUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={previewUrl}
            alt="The nutrition label you photographed"
            className="size-20 shrink-0 rounded-md object-cover"
          />
        ) : null}
        <div className="flex min-w-0 flex-1 flex-col gap-2">
          <Field
            label="Name it for next time"
            hint={label.canSave ? 'Search will match this' : 'A name is required'}
            error={label.canSave ? undefined : 'Give it a name so you can find it again'}
          >
            <Input
              value={label.name}
              placeholder="e.g. SAVAS Milk Protein ココア"
              enterKeyHint="done"
              onChange={(e) => onNameChange(e.target.value)}
            />
          </Field>
          <Field label="Brand" hint="Optional">
            <Input
              value={label.brand}
              placeholder="e.g. 明治"
              enterKeyHint="done"
              onChange={(e) => onBrandChange(e.target.value)}
            />
          </Field>
          <Text variant="micro">{display.basisLabel}</Text>
        </div>
      </div>

      {/*
        The verdict, not a provenance disclaimer. A label that reconciles is the
        most trustworthy source in the app — it is the manufacturer's own
        declaration — and saying so is what makes this feel different from a
        guess.
      */}
      <div
        className={
          display.verdict.tone === 'pos'
            ? 'flex items-start gap-2 rounded-md bg-pos-wash p-3 text-pos'
            : display.verdict.tone === 'warn'
              ? 'flex items-start gap-2 rounded-md bg-warn-wash p-3 text-warn'
              : 'flex items-start gap-2 rounded-md bg-neg-wash p-3 text-neg'
        }
      >
        <VerdictIcon size={16} strokeWidth={2.5} className="mt-px shrink-0" aria-hidden />
        <div className="flex flex-col gap-0.5">
          <Text variant="label">{display.verdict.headline}</Text>
          {display.verdict.detail ? (
            <span className="tabular font-mono text-2xs">{display.verdict.detail}</span>
          ) : null}
        </div>
      </div>

      <div className="flex flex-col gap-2">
        <Text variant="label">AS PRINTED</Text>
        <Rule />
        <table className="w-full border-collapse">
          <caption className="sr-only">
            {`Nutrition panel transcribed from the photo, ${display.basisLabel}`}
          </caption>
          <tbody>
            {display.rows.map((row) => (
              <tr key={row.label} className="border-b border-rule last:border-0">
                <th scope="row" className="py-1.5 text-left font-normal">
                  <Text variant="micro">{row.label}</Text>
                </th>
                <td className="tabular py-1.5 text-right font-mono text-2xs text-ink">
                  {row.value}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {display.notes.map((n) => (
        <Chip key={n} label={n} tone="warn" />
      ))}

      <Rule />

      <div className="flex flex-col gap-2">
        <Text variant="label">HOW MUCH DID YOU HAVE?</Text>
        <div className="flex items-center gap-3">
          <div className="w-32">
            <NumericInput
              value={label.amount}
              onChange={onAmountChange}
              unit={label.reading.rate.basis_unit}
              aria-label={`Amount in ${label.reading.rate.basis_unit}`}
            />
          </div>
          <span className="tabular flex flex-1 flex-wrap items-baseline gap-x-3 font-mono text-2xs text-ink-3">
            <NumericValue value={macros?.kcal ?? null} unit="kcal" tone="primary" />
            <span>P {macros?.protein_g ?? '—'}</span>
            <span>C {macros?.carbs_g ?? '—'}</span>
            <span>F {macros?.fat_g ?? '—'}</span>
          </span>
        </div>
      </div>
    </div>
  )
}
