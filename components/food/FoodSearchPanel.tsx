'use client'
import { Button } from '@/components/ui/Button'
import { Chip } from '@/components/ui/Chip'
import { EmptyState } from '@/components/ui/EmptyState'
import { Rule } from '@/components/ui/Rule'
import { SearchField } from '@/components/ui/SearchField'
import { SkeletonList } from '@/components/ui/Skeleton'
import { Text } from '@/components/ui/Text'
import type { FoodResolveState } from '@/hooks/useFoodResolve'
import { useNewFood } from '@/hooks/useNewFood'
import type { PhotoDraft } from '@/hooks/usePhotoDraft'
import type { FoodRow } from '@/lib/schemas/food'
import { CreateFoodRow } from './CreateFoodRow'
import { FoodResultRow } from './FoodResultRow'
import { NewFoodSheet } from './NewFoodSheet'
import { PhotoCaptureButton } from './PhotoCaptureButton'

/**
 * The two ways in: type it or shoot it. Both land on the same result rows.
 *
 * Takes the hooks whole rather than 15 props — they are already the tested,
 * typed surface, and spreading them here would only hide where state lives.
 */
export function FoodSearchPanel({
  search,
  photo,
  addedIds,
  onSelect,
}: {
  search: FoodResolveState
  photo: PhotoDraft
  addedIds: ReadonlySet<string>
  onSelect: (food: FoodRow) => void
}) {
  const busy = photo.phase === 'preparing' || photo.phase === 'identifying'
  const newFood = useNewFood()

  /**
   * Offered only when "add what I typed" means something:
   *
   * - not for an empty box — that view is the recent list;
   * - not when `looksLikeFood` has already said this is not food, since the copy there
   *   explains why;
   * - not mid multi-item entry — there you are picking a food per segment, and adding
   *   the whole typed string as ONE food would be wrong.
   */
  const canCreate =
    search.parsedQuery.trim() !== '' && search.rejected === null && !search.segments

  // Created food flows straight into the basket: the user was mid-log, not mid-admin.

  return (
    <div className="flex flex-col gap-3 pb-2">
      <div className="flex items-end gap-2">
        <div className="flex-1">
          <SearchField
            label="Search foods"
            value={search.query}
            onChange={search.setQuery}
            placeholder="e.g. 200g white rice"
            autoFocus
          />
        </div>
        <PhotoCaptureButton onFile={photo.capture} loading={busy} />
      </div>

      {photo.phase === 'identifying' ? <Chip label="Reading your photo…" tone="accent" /> : null}
      {photo.phase === 'error' && photo.notice ? <Chip label={photo.notice} tone="warn" /> : null}

      {/*
        A failed lookup gets a retry, always — not just when the screen is empty.
        Your library results are still valid and still worth showing, but leaving
        them under a silent passive chip implies they are matches for what you just
        typed. The banner says the question went unanswered and offers to ask again
        (AC-1.3).
      */}
      {search.failed ? (
        <div className="flex items-center justify-between gap-3 rounded-md bg-warn-wash p-3">
          <Text variant="micro">
            {search.notice ?? 'The nutrition databases could not be reached.'}
          </Text>
          <Button variant="secondary" size="sm" onClick={search.retry}>
            TRY AGAIN
          </Button>
        </div>
      ) : search.notice ? (
        <Chip label={search.notice} tone="warn" />
      ) : null}

      {/* Several foods in one input — offer them as separate lookups. */}
      {search.segments ? (
        <div className="flex flex-col gap-2">
          <Text variant="label">SEVERAL FOODS — PICK ONE AT A TIME</Text>
          <div className="flex flex-wrap gap-1.5">
            {search.segments.map((s) => (
              <button key={s} type="button" onClick={() => search.setQuery(s)}>
                <Chip label={s} tone="accent" />
              </button>
            ))}
          </div>
        </div>
      ) : null}

      {search.rejected ? (
        <EmptyState title="NOT A FOOD" body={search.rejected} />
      ) : search.isSearching && search.results.length === 0 ? (
        <SkeletonList rows={4} />
      ) : search.results.length === 0 && !search.segments ? (
        /*
          A failed lookup is NOT "no match". The food may well exist; we never got
          to ask. Claiming NO MATCH there is a confident answer to an unanswered
          question — the banner above already explains and offers the retry.
        */
        search.failed ? null : (
          <>
            <EmptyState
              title="NO MATCH"
              body="Nothing in your library or the nutrition databases. Try a simpler name, or add it yourself."
            />
            {/* Shown UNDER the empty state, not instead of it — the explanation and the
                way out are both useful. */}
            {canCreate ? (
              <CreateFoodRow query={search.parsedQuery} onCreate={() => newFood.open(search.parsedQuery)} />
            ) : null}
          </>
        )
      ) : (
        <div className="flex flex-col">
          <Text variant="label">{search.stage === 'library' ? 'YOUR FOODS' : 'FOUND ONLINE'}</Text>
          <Rule />
          {search.results.map((f) => (
            <FoodResultRow
              key={f.id}
              name={f.name}
              brand={f.brand}
              basisAmount={f.basis_amount}
              basisUnit={f.basis_unit}
              kcal={f.kcal}
              proteinG={f.protein_g}
              carbsG={f.carbs_g}
              fatG={f.fat_g}
              confidence={f.confidence}
              source={f.source}
              timesLogged={f.times_logged}
              added={addedIds.has(f.id)}
              onSelect={() => onSelect(f)}
            />
          ))}

          {/* Last row, always. "None of these is what I meant" is as common as
              "nothing matched". */}
          {canCreate ? (
            <CreateFoodRow query={search.parsedQuery} onCreate={() => newFood.open(search.parsedQuery)} />
          ) : null}
        </div>
      )}

      {/*
        Straight into the basket via the same handler a search result uses. If the name
        turned out to already exist, that row is selected instead — which is what the
        user was reaching for.
      */}
      <NewFoodSheet vm={newFood} onSaved={onSelect} />
    </div>
  )
}
