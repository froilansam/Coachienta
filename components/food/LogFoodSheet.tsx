'use client'
import { Button } from '@/components/ui/Button'
import { Sheet } from '@/components/ui/Sheet'
import { useToast } from '@/components/ui/Toast'
import { useFoodResolve } from '@/hooks/useFoodResolve'
import { useLogDraft } from '@/hooks/useLogDraft'
import { usePhotoDraft } from '@/hooks/usePhotoDraft'
import { presetsFor, stepFor } from '@/lib/domain/food/draft'
import { BasketFooter } from './BasketFooter'
import { FoodSearchPanel } from './FoodSearchPanel'
import { LabelReview } from './LabelReview'
import { LogHeaderChips } from './LogHeaderChips'
import { PhotoReview } from './PhotoReview'
import { PortionEditor } from './PortionEditor'

/**
 * Log-food sheet. Three hook calls and a three-way mode switch — no state, no
 * fetches and no arithmetic of its own.
 *
 * Modes, in priority order: reviewing a photo → portioning one food → searching.
 * A photo splits again by what it turned out to be — a nutrition label is printed
 * fact and gets its own screen, a plate is an estimate (PRD-003 §3.3a/b).
 * Layout follows PRD-003 §5.1a and §8.
 */
export function LogFoodSheet({
  open,
  onOpenChange,
  day,
  onLogged,
}: {
  open: boolean
  onOpenChange: (v: boolean) => void
  /** Which day the sheet opens on. Defaults to today when omitted. */
  day?: string
  onLogged?: () => void
}) {
  const search = useFoodResolve()
  const draft = useLogDraft(onLogged, day)
  const photo = usePhotoDraft()
  const toast = useToast()

  /**
   * Photo items join the SAME basket as typed ones, so there is one commit path
   * and photo entries land in the same offline queue. Amounts were already made
   * editable in the review step, so they skip the portion editor.
   */
  const confirmable = photo.items.filter((i) => i.included && i.food && i.macros)
  const reviewingPhoto = photo.phase === 'review'

  const acceptPhoto = () => {
    for (const i of confirmable) if (i.food) draft.addResolved(i.food, i.amount)
    toast({ message: `Added ${confirmable.length} item${confirmable.length > 1 ? 's' : ''}` })
    photo.reset()
  }

  /**
   * A label becomes a library row only now, under the name the user approved —
   * so the row that lands in the basket is the same one tomorrow's search finds.
   */
  const acceptLabel = async () => {
    const label = photo.label
    if (!label) return
    const food = await photo.saveLabel()
    if (!food) return
    draft.addResolved(food, label.amount)
    toast({ message: `Saved ${food.name} to your library` })
    photo.reset()
  }

  const commit = async () => {
    const n = await draft.commit()
    if (n === 0) return
    toast({ message: `Logged ${n} item${n > 1 ? 's' : ''}` })
    search.reset()
    onOpenChange(false)
  }

  return (
    <Sheet
      open={open}
      onOpenChange={onOpenChange}
      title="Log food"
      size="full"
      dismissible={!draft.isCommitting}
      headerSlot={
        <LogHeaderChips
          loggedOn={draft.loggedOn}
          meal={draft.meal}
          onLoggedOnChange={draft.setLoggedOn}
          onMealChange={draft.setMeal}
        />
      }
      footer={
        reviewingPhoto || photo.phase === 'saving' ? (
          <div className="flex gap-2">
            <Button variant="ghost" onClick={photo.reset}>
              Discard
            </Button>
            {photo.label ? (
              <Button
                variant="primary"
                size="lg"
                fullWidth
                disabled={!photo.label.canSave}
                loading={photo.phase === 'saving'}
                onClick={() => void acceptLabel()}
              >
                SAVE &amp; ADD
              </Button>
            ) : (
              <Button
                variant="primary"
                size="lg"
                fullWidth
                disabled={confirmable.length === 0}
                onClick={acceptPhoto}
              >
                {`ADD ${confirmable.length} ITEM${confirmable.length === 1 ? '' : 'S'}`}
              </Button>
            )}
          </div>
        ) : (
          <BasketFooter
            items={draft.items.map((i) => ({
              id: i.id,
              label: `${i.food.name} ${i.amount}${i.unit === 'piece' ? '' : i.unit}`,
            }))}
            totals={draft.totals}
            isCommitting={draft.isCommitting}
            onRemove={draft.remove}
            onCommit={commit}
          />
        )
      }
    >
      {photo.label ? (
        <LabelReview
          previewUrl={photo.previewUrl}
          label={photo.label}
          onNameChange={photo.setLabelName}
          onBrandChange={photo.setLabelBrand}
          onAmountChange={photo.setLabelAmount}
        />
      ) : reviewingPhoto ? (
        <PhotoReview
          previewUrl={photo.previewUrl}
          dishName={photo.dishName}
          items={photo.items}
          total={photo.total}
          unmatchedCount={photo.unmatchedCount}
          onAmountChange={photo.setAmount}
          onToggle={photo.toggle}
          onRemove={photo.remove}
        />
      ) : draft.pending ? (
        <PortionEditor
          name={draft.pending.food.name}
          amount={draft.pending.amount}
          unit={draft.pending.unit}
          step={stepFor(draft.pending.food)}
          presets={presetsFor(draft.pending.food)}
          macros={draft.pending.macros}
          sources={draft.pending.food.citations ?? []}
          warning={draft.pending.amount > 2000 ? 'That is a very large amount — check it' : null}
          onAmountChange={draft.setPendingAmount}
          onConfirm={draft.confirmPending}
          onCancel={draft.cancelPending}
        />
      ) : (
        <FoodSearchPanel
          search={search}
          photo={photo}
          addedIds={new Set(draft.items.map((i) => i.food.id))}
          onSelect={(f) => draft.select(f, search.parsedAmount ?? undefined)}
        />
      )}
    </Sheet>
  )
}
