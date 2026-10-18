'use client'
import { Trash2 } from 'lucide-react'
import { StatRow } from '@/components/patterns/StatRow'
import { Button } from '@/components/ui/Button'
import { Chip } from '@/components/ui/Chip'
import { NumericValue } from '@/components/ui/NumericValue'
import { Rule } from '@/components/ui/Rule'
import { Sheet } from '@/components/ui/Sheet'
import { Text } from '@/components/ui/Text'
import type { DayEntry } from '@/lib/domain/food/dayView'
import { trustOf } from '@/lib/domain/food/library'

/**
 * One logged entry, in full.
 *
 * **Read-only, deliberately.** A log entry is a frozen measurement: correcting a food
 * bumps `foods.version` and leaves every entry it has already produced exactly as it
 * was (AC-1.6). An edit form here would either lie about that or quietly break it, so
 * the only write offered is delete — and the sheet says why, because "why can't I
 * change this?" is the first thing anyone wonders.
 */
const SOURCE_LABEL: Record<string, string> = {
  library: 'Your library',
  usda: 'USDA FoodData Central',
  openfoodfacts: 'Open Food Facts',
  ai_estimate: 'AI estimate',
  photo: 'Read from a label photo',
  manual: 'Entered by hand',
}

const loggedAtLabel = (iso: string | null): string | null =>
  iso === null
    ? null
    : new Date(iso).toLocaleString('en-GB', {
        weekday: 'short', day: 'numeric', month: 'short',
        hour: '2-digit', minute: '2-digit',
      })

export function EntryDetailSheet({
  entry,
  onClose,
  onDelete,
}: {
  entry: DayEntry | null
  onClose: () => void
  onDelete: (id: string) => void
}) {
  if (entry === null) return null

  // `resolvedBy` doubles as the source for the trust label, matching the library.
  const trust = trustOf(entry.confidence, entry.resolvedBy ?? 'library')

  return (
    <Sheet open onOpenChange={(open) => !open && onClose()} title="Logged entry">
      <div className="flex flex-col gap-4 pb-2">
        <div className="flex flex-col gap-1">
          <Text as="h3" variant="title">
            {entry.foodName}
          </Text>
          <Text variant="micro">
            {[
              entry.amount > 0 ? `${entry.amount}${entry.unit === 'piece' ? ' piece' : entry.unit}` : null,
              entry.meal,
              loggedAtLabel(entry.loggedAt),
            ]
              .filter(Boolean)
              .join(' · ')}
          </Text>
        </div>

        <div className="flex flex-wrap items-center gap-1.5">
          <Chip label={trust.label} tone={trust.tone === 'neutral' ? 'neutral' : trust.tone} />
        </div>
        <Text variant="micro">{trust.explain}</Text>

        <Rule />

        {/* The numbers as they were logged — not as the food reads today. */}
        <div className="flex items-baseline justify-between gap-3">
          <Text variant="label">ENERGY</Text>
          <NumericValue value={entry.kcal} unit="kcal" decimals={0} size="metric" />
        </div>
        <div className="flex flex-col gap-1">
          <StatRow label="PRO" value={entry.proteinG} unit="g" />
          <StatRow label="CHO" value={entry.carbsG} unit="g" />
          <StatRow label="FAT" value={entry.fatG} unit="g" />
        </div>

        <Rule />

        <div className="flex flex-col gap-1">
          <Text variant="label">WHERE THESE NUMBERS CAME FROM</Text>
          <Text variant="meta">
            {entry.resolvedBy ? (SOURCE_LABEL[entry.resolvedBy] ?? entry.resolvedBy) : 'Not recorded'}
            {entry.foodVersion !== null ? ` · food v${entry.foodVersion}` : ''}
          </Text>
          {entry.notes ? <Text variant="micro">{entry.notes}</Text> : null}
        </div>

        {/*
          The guarantee, stated where it is relevant rather than buried in a PRD.
          Correcting a food never rewrites what you already logged — which is exactly
          why this sheet cannot offer an edit.
        */}
        <Text variant="micro">
          These are the numbers as logged. Correcting the food later changes what you log next
          time and leaves this entry alone — so to fix it, delete it and log it again.
        </Text>

        <Button
          variant="danger"
          iconStart={Trash2}
          onClick={() => {
            onDelete(entry.id)
            onClose()
          }}
        >
          DELETE ENTRY
        </Button>
      </div>
    </Sheet>
  )
}
