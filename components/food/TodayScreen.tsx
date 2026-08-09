'use client'
import { Plus } from 'lucide-react'
import { useState } from 'react'
import { SyncBadge } from '@/components/patterns/SyncBadge'
import { Button } from '@/components/ui/Button'
import { Chip } from '@/components/ui/Chip'
import { EmptyState } from '@/components/ui/EmptyState'
import { Rule } from '@/components/ui/Rule'
import { SkeletonList } from '@/components/ui/Skeleton'
import { Text } from '@/components/ui/Text'
import { useSyncStatus } from '@/hooks/useSyncStatus'
import { useToday } from '@/hooks/useToday'
import { DayNavigator } from './DayNavigator'
import type { DayEntry } from '@/lib/domain/food/dayView'
import { DayTimeline } from './DayTimeline'
import { EntryDetailSheet } from './EntryDetailSheet'
import { LogFoodSheet } from './LogFoodSheet'
import { MacroSummary } from './MacroSummary'

/**
 * The home screen, showing any one day. Three hook calls and JSX — no state, no
 * effects, no arithmetic and no date formatting here. Grading, grouping, totals
 * and every label live in `useToday`, `lib/domain/food/dayView.ts` and
 * `lib/domain/date.ts`.
 */
export function TodayScreen() {
  const [logOpen, setLogOpen] = useState(false)
  const [detail, setDetail] = useState<DayEntry | null>(null)
  const today = useToday()
  const sync = useSyncStatus()

  return (
    <main className="mx-auto flex w-full max-w-lg flex-col gap-6 px-4 pt-6 pb-8">
      <header className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 flex-col gap-1">
          <DayNavigator
            date={today.date}
            label={today.dayLabel}
            canGoForward={today.canGoForward}
            isToday={today.isToday}
            onStep={today.stepDay}
            onPick={today.goToDay}
            onToday={today.goToToday}
          />
          <Text as="h1" variant="title">
            {today.longLabel}
          </Text>
          <div className="flex items-center gap-1.5">
            {today.phaseLabel ? <Text variant="micro">{today.phaseLabel}</Text> : null}
            {today.isGymDay ? <Chip label="Gym day" tone="accent" size="sm" /> : null}
          </div>
        </div>
        <SyncBadge
          online={sync.online}
          pending={sync.pending}
          failed={sync.failed}
          onRetry={sync.retry}
        />
      </header>

      {/*
        A failed load is its own state, above everything else. Before this it fell
        through to "no targets" + "nothing logged" — the same screen an empty day
        produces — so a dropped access cookie on the phone was indistinguishable
        from a database outage, and from having simply not eaten yet.
      */}
      {today.loadError ? (
        <EmptyState
          title={today.loadError === 'locked' ? 'THIS DEVICE IS LOCKED OUT' : 'CANNOT REACH THE SERVER'}
          body={
            today.loadError === 'locked'
              ? 'The access token for this device is missing or stale, so no data can load. Open /unlock and paste it again.'
              : 'The day could not be loaded. Anything you log still saves on this device and uploads later.'
          }
          action={
            <Button variant="secondary" onClick={today.retry}>
              TRY AGAIN
            </Button>
          }
        />
      ) : today.isLoading ? (
        <SkeletonList rows={5} />
      ) : !today.hasTargets ? (
        <EmptyState
          title="NO TARGET FOR THIS DAY"
          body={
            today.isToday
              ? 'Set a nutrition target so today can be measured against something. Until then entries still log fine.'
              : 'This day is before your first nutrition target, so there is nothing to measure it against. The entries below are still exact.'
          }
        />
      ) : (
        <MacroSummary
          equation={today.equation}
          kcal={today.kcal!}
          macros={today.macros}
          pct={today.pct}
        />
      )}

      <Rule strong />

      {today.entryCount === 0 && !today.isLoading && !today.loadError ? (
        <EmptyState
          title="NOTHING LOGGED"
          body={
            today.isToday
              ? 'Log your first meal. Your imported foods are already searchable — most take two taps.'
              : `Nothing was logged on ${today.longLabel}. You can still add to it — the log sheet's date chip opens on this day.`
          }
          action={
            <Button variant="primary" iconStart={Plus} onClick={() => setLogOpen(true)}>
              LOG FOOD
            </Button>
          }
        />
      ) : today.loadError ? null : (
        <DayTimeline groups={today.mealGroups} onRemove={today.remove} onOpen={setDetail} />
      )}

      {today.entryCount > 0 ? (
        <Button variant="primary" size="lg" fullWidth iconStart={Plus} onClick={() => setLogOpen(true)}>
          LOG FOOD
        </Button>
      ) : null}

      {/* `day` seeds the sheet's date chip, so logging from a past day lands on
          the day you are looking at rather than silently on today. */}
      <EntryDetailSheet entry={detail} onClose={() => setDetail(null)} onDelete={today.remove} />

      <LogFoodSheet
        open={logOpen}
        onOpenChange={setLogOpen}
        day={today.date}
        onLogged={today.refresh}
      />
    </main>
  )
}
