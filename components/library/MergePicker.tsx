'use client'
import { ArrowRight } from 'lucide-react'
import { Chip } from '@/components/ui/Chip'
import { EmptyState } from '@/components/ui/EmptyState'
import { ListRow } from '@/components/ui/ListRow'
import { Rule } from '@/components/ui/Rule'
import { SearchField } from '@/components/ui/SearchField'
import { Text } from '@/components/ui/Text'
import { cn } from '@/lib/cn'
import { describeRow, mergePlan } from '@/lib/domain/food/library'
import type { FoodRow } from '@/lib/schemas/food'

/**
 * Merge two foods. Two steps: find the other one, then choose which name lives.
 *
 * The survivor choice is explicit rather than "always keep the one you opened",
 * because the duplicate you notice is usually the wrong one — you search
 * `sunny side up egg`, find it has 10 logs, and want the 27-log spelling to win.
 * Guessing that would be a coin flip on a destructive action.
 */
export function MergePicker({
  source,
  candidates,
  query,
  onQuery,
  chosen,
  onChoose,
  survivorId,
  onSurvivor,
  error,
}: {
  source: FoodRow
  candidates: readonly FoodRow[]
  query: string
  onQuery: (v: string) => void
  chosen: FoodRow | null
  onChoose: (f: FoodRow | null) => void
  survivorId: string | null
  onSurvivor: (id: string) => void
  error: string | null
}) {
  if (!chosen) {
    return (
      <div className="flex flex-col gap-3 pb-2">
        <Text variant="body">{`Merge "${source.name}" with…`}</Text>
        <SearchField
          label="Find the other food"
          value={query}
          onChange={onQuery}
          placeholder="Search your library"
          autoFocus
        />
        {candidates.length === 0 ? (
          <EmptyState title="NOTHING ELSE MATCHES" body="Try a shorter search." />
        ) : (
          <div className="flex flex-col">
            {candidates.map((f) => (
              <ListRow
                key={f.id}
                title={f.brand ? `${f.name} · ${f.brand}` : f.name}
                subtitle={describeRow(f)}
                onClick={() => onChoose(f)}
                meta={
                  <span className="tabular font-mono text-2xs text-ink-3">{f.times_logged}×</span>
                }
              />
            ))}
          </div>
        )}
      </div>
    )
  }

  const survivor = survivorId === chosen.id ? chosen : source
  const loser = survivorId === chosen.id ? source : chosen

  return (
    <div className="flex flex-col gap-4 pb-2">
      <button type="button" onClick={() => onChoose(null)} className="self-start">
        <Chip label="← Pick a different food" tone="neutral" />
      </button>

      <div className="flex flex-col gap-2">
        <Text variant="label">WHICH NAME SURVIVES?</Text>
        {/* Stacked, not a segmented control: food names are long and two of them
            side by side overflow a 390px screen. */}
        <div role="radiogroup" aria-label="Which food survives the merge" className="flex flex-col gap-1.5">
          {[source, chosen].map((f) => {
            const active = (survivorId ?? source.id) === f.id
            return (
              <button
                key={f.id}
                type="button"
                role="radio"
                aria-checked={active}
                onClick={() => onSurvivor(f.id)}
                className={cn(
                  'flex items-center justify-between gap-3 rounded-md border px-3 py-2.5 text-left transition-colors',
                  active ? 'border-accent bg-accent-wash' : 'border-rule bg-surface',
                )}
              >
                <span className="min-w-0 flex-1">
                  <Text variant="body" truncate>
                    {f.brand ? `${f.name} · ${f.brand}` : f.name}
                  </Text>
                  <Text variant="micro">{describeRow(f)}</Text>
                </span>
                <span className="tabular shrink-0 font-mono text-2xs text-ink-3">
                  {f.times_logged}×
                </span>
              </button>
            )
          })}
        </div>
      </div>

      <Rule />

      {error ? (
        <Chip label={error} tone="neg" />
      ) : (
        <div className="flex flex-col gap-2">
          <div className="flex items-center gap-2">
            <Text variant="micro">{loser.name}</Text>
            <ArrowRight size={12} strokeWidth={2} aria-hidden className="text-ink-3" />
            <Text variant="body">{survivor.name}</Text>
          </div>
          {/* Stated before it happens, not summarised after. A merge deletes a row. */}
          <ul className="flex flex-col gap-1">
            {mergePlan(survivor, loser).map((line) => (
              <li key={line}>
                <Text variant="micro">• {line}</Text>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  )
}
