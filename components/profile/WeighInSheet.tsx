'use client'
import { Button } from '@/components/ui/Button'
import { Field, Input } from '@/components/ui/Field'
import { NumericInput } from '@/components/ui/NumericInput'
import { Sheet } from '@/components/ui/Sheet'
import { Text } from '@/components/ui/Text'
import type { WeighInDraft } from '@/hooks/useProfile'

/**
 * A weigh-in. Weight is required; waist and body fat are not.
 *
 * That asymmetry is the spec (AC-4.4a) and the real data backs it: one logged
 * reading carries the note *"partial reading; blanks are honest"*. A form that
 * demanded all three would have forced a number nobody measured, and an invented
 * waist figure is worse than an absent one — it would feed the recomp signal.
 */
export function WeighInSheet({
  draft,
  canSave,
  isSaving,
  onChange,
  onClose,
  onSave,
}: {
  draft: WeighInDraft | null
  canSave: boolean
  isSaving: boolean
  onChange: (patch: Partial<WeighInDraft>) => void
  onClose: () => void
  onSave: () => void
}) {
  return (
    <Sheet
      open={draft !== null}
      onOpenChange={(o) => !o && onClose()}
      title="Log weigh-in"
      size="auto"
      dismissible={!isSaving}
      footer={
        <div className="flex gap-2">
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button
            variant="primary"
            size="lg"
            fullWidth
            disabled={!canSave}
            loading={isSaving}
            onClick={onSave}
          >
            SAVE
          </Button>
        </div>
      }
    >
      {draft ? (
        <div className="flex flex-col gap-3 pb-2">
          <Field label="Date">
            <Input
              type="date"
              value={draft.measured_on}
              onChange={(e) => onChange({ measured_on: e.target.value })}
            />
          </Field>

          <Field label="Weight" hint="Required">
            <NumericInput
              value={draft.weight_kg}
              onChange={(weight_kg) => onChange({ weight_kg })}
              unit="kg"
              decimals={1}
              aria-label="Weight in kilograms"
            />
          </Field>

          <Field label="Waist" hint="Optional — the primary recomp signal">
            <NumericInput
              value={draft.waist_cm}
              onChange={(waist_cm) => onChange({ waist_cm })}
              unit="cm"
              decimals={1}
              aria-label="Waist in centimetres"
            />
          </Field>

          <Field label="Body fat" hint="Optional — leave blank if you did not measure it">
            <NumericInput
              value={draft.body_fat_pct}
              onChange={(body_fat_pct) => onChange({ body_fat_pct })}
              unit="%"
              decimals={1}
              aria-label="Body fat percentage"
            />
          </Field>

          <Field label="Note" hint="Optional">
            <Input
              value={draft.notes}
              placeholder="e.g. partial reading, scale model"
              onChange={(e) => onChange({ notes: e.target.value })}
            />
          </Field>

          <Text variant="micro">
            Weigh-ins are never overwritten by a later one — each is a reading in its own right.
            Logging the same date again corrects that date.
          </Text>
        </div>
      ) : null}
    </Sheet>
  )
}
