'use client'
import { FoodMacroFields } from '@/components/food/FoodMacroFields'
import { Button } from '@/components/ui/Button'
import { Chip } from '@/components/ui/Chip'
import { Sheet } from '@/components/ui/Sheet'
import { Text } from '@/components/ui/Text'
import type { FoodRow } from '@/lib/db/queries/foods'
import type { NewFoodView } from '@/hooks/useNewFood'

/**
 * Adding a food the databases do not have.
 *
 * Deliberately NOT the library's `FoodEditor` opened blank. That component renders a
 * trust chip, a version, a log count, citations and a delete guard — all of which need a
 * real row, and a blank one would be wearing provenance it has not earned.
 *
 * The fields are shared (`FoodMacroFields`); the framing is not. Correcting a food asks
 * "are these numbers right?"; creating one asks "what are they?" — and only the second
 * needs to promise what will be recorded.
 */
export function NewFoodSheet({
  vm,
  onSaved,
}: {
  vm: NewFoodView
  /** The saved row, so the caller can carry it straight on to the next step. */
  onSaved?: (food: FoodRow) => void
}) {
  return (
    <Sheet
      open={vm.isOpen}
      onOpenChange={(open) => !open && vm.close()}
      title="Add a food"
      size="full"
      dismissible={!vm.isSaving}
      footer={
        <Button
          variant="primary"
          size="lg"
          fullWidth
          disabled={!vm.canSave}
          loading={vm.isSaving}
          onClick={() => {
            void vm.save().then((food) => {
              if (food) onSaved?.(food)
            })
          }}
        >
          SAVE FOOD
        </Button>
      }
    >
      <div className="flex flex-col gap-4 pb-2">
        <Text variant="micro">
          Saved as verified, because you are the source. It will be searchable straight away
          and the numbers stay exactly as you enter them.
        </Text>

        <FoodMacroFields
          name={vm.name}
          brand={vm.brand}
          rate={vm.rate}
          onName={vm.setName}
          onBrand={vm.setBrand}
          onRate={vm.setRate}
          nameHint="What you will search for next time"
          autoFocusName
        />

        {vm.error ? <Chip label={vm.error} tone="neg" /> : null}
        {vm.canSave || vm.isSaving ? null : (
          <Chip label="A name and a basis amount are required" tone="warn" />
        )}
      </div>
    </Sheet>
  )
}
