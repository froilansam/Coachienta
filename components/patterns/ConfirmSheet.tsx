'use client'
import { Button } from '@/components/ui/Button'
import { Sheet } from '@/components/ui/Sheet'
import { Text } from '@/components/ui/Text'

/**
 * The second step of something irreversible.
 *
 * A sheet rather than `window.confirm`, so the sentence can name what will be lost —
 * "14 sets will be removed" is the only warning there is, because the cloud is the
 * truth and there is no undo after this (PRD-004 §6).
 *
 * Solid red appears HERE and nowhere earlier. Cancel is the wide, comfortable
 * target; confirm sits beside it, not under the thumb's resting position.
 *
 * `alt` is for the rare choice that is not simply yes/no — rebuilding a plan can
 * either replace what is there or add to it, and offering that as two separate sheets
 * would make the same decision twice.
 */
export function ConfirmSheet({
  open,
  title,
  body,
  confirmLabel,
  onConfirm,
  onCancel,
  altLabel,
  onAlt,
  tone = 'destructive',
  isBusy = false,
}: {
  open: boolean
  title: string
  body: string
  confirmLabel: string
  onConfirm: () => void
  onCancel: () => void
  altLabel?: string
  onAlt?: () => void
  /** `destructive` for anything irreversible; `primary` for a plain choice. */
  tone?: 'destructive' | 'primary'
  isBusy?: boolean
}) {
  return (
    <Sheet
      open={open}
      onOpenChange={(o) => !o && onCancel()}
      title={title}
      dismissible={!isBusy}
      footer={
        <div className="flex gap-2">
          <Button variant="secondary" size="lg" fullWidth onClick={onCancel} disabled={isBusy}>
            CANCEL
          </Button>
          {altLabel && onAlt ? (
            <Button variant="secondary" size="lg" fullWidth disabled={isBusy} onClick={onAlt}>
              {altLabel}
            </Button>
          ) : null}
          <Button variant={tone} size="lg" fullWidth loading={isBusy} onClick={onConfirm}>
            {confirmLabel}
          </Button>
        </div>
      }
    >
      <Text variant="body" className="block pb-2">
        {body}
      </Text>
    </Sheet>
  )
}
