'use client'
import { Plus } from 'lucide-react'
import { TrendChart } from '@/components/patterns/TrendChart'
import { Button } from '@/components/ui/Button'
import { Chip } from '@/components/ui/Chip'
import { EmptyState } from '@/components/ui/EmptyState'
import { Rule } from '@/components/ui/Rule'
import { SegmentedControl } from '@/components/ui/SegmentedControl'
import { SkeletonList } from '@/components/ui/Skeleton'
import { Text } from '@/components/ui/Text'
import { useGoals } from '@/hooks/useGoals'
import { RANGES, useProfile, type RangeDays } from '@/hooks/useProfile'
import { CurrentStrip } from './CurrentStrip'
import { PhaseCard, PrioritiesCard, RulesCard, TargetsCard } from './GoalCards'
import { Findings, GoalEditors } from './GoalEditors'
import { WeighInSheet } from './WeighInSheet'

/**
 * Profile. One hook call, then JSX.
 *
 * This is the screen that ends the spreadsheet's central failure: the same number
 * living in six tabs with six values. Everything here is the single stored copy,
 * and the Today screen and the coach read the same rows (AC-4.7).
 */
export function ProfileScreen() {
  const vm = useProfile()
  const goals = useGoals({
    targets: vm.targets,
    phase: vm.phase,
    measurements: vm.measurements,
    priorities: vm.priorities,
  })

  if (vm.loadError) {
    return (
      <main className="mx-auto w-full max-w-lg px-4 py-8">
        <EmptyState
          title="CANNOT REACH THE SERVER"
          body="Your profile could not be loaded."
          action={
            <Button variant="secondary" onClick={vm.retry}>
              TRY AGAIN
            </Button>
          }
        />
      </main>
    )
  }

  return (
    <main className="mx-auto flex w-full max-w-lg flex-col gap-6 px-4 pt-6 pb-8">
      <header className="flex flex-col gap-1">
        <Text as="h1" variant="title">{vm.displayName ?? 'Profile'}</Text>
        <Text variant="micro">
          {[
            vm.heightCm !== null ? `${vm.heightCm} cm` : null,
            vm.timezone,
            vm.birthDate ? `born ${vm.birthDate}` : 'no date of birth set',
          ]
            .filter(Boolean)
            .join(' · ')}
        </Text>
      </header>

      {vm.isLoading ? (
        <SkeletonList rows={8} />
      ) : (
        <>
          {vm.notice ? <Chip label={vm.notice} tone="accent" /> : null}

          {/*
            The consistency checks on what is currently STORED. They live at the
            top because a contradiction between your own numbers is the thing this
            screen exists to surface — the spreadsheet kept them in separate tabs
            where they never met (PRD-006 §3.7).
          */}
          <Findings findings={goals.storedFindings} />

          <section className="flex flex-col gap-2">
            <div className="flex items-baseline justify-between gap-3">
              <Text variant="label">CURRENT</Text>
              <Text variant="micro">each value from its own reading</Text>
            </div>
            <CurrentStrip metrics={vm.current} energy={vm.energy} />
            <Button variant="secondary" iconStart={Plus} onClick={vm.openWeighIn}>
              LOG WEIGH-IN
            </Button>
          </section>

          <section className="flex flex-col gap-3">
            <div className="flex items-center justify-between gap-3">
              <Text variant="label">MONITOR</Text>
              <SegmentedControl
                label="Chart range"
                size="sm"
                value={String(vm.range) as `${RangeDays}`}
                options={RANGES.map((d) => ({ value: String(d) as `${RangeDays}`, label: `${d}D` }))}
                onChange={(v) => vm.setRange(Number(v) as RangeDays)}
              />
            </div>
            <Rule />
            {vm.charts.map((c) => (
              <div key={c.label} className="flex flex-col gap-1">
                <div className="flex items-baseline justify-between gap-3">
                  <Text variant="micro">{c.label}</Text>
                  {c.trend ? (
                    <span className="tabular font-mono text-2xs text-ink-3">
                      {`${c.trend.from.toFixed(c.decimals)} → ${c.trend.to.toFixed(c.decimals)} ${c.unit}`}
                      {c.trend.perWeek !== null
                        ? `  ${c.trend.perWeek > 0 ? '▲ +' : c.trend.perWeek < 0 ? '▼ ' : '● '}${c.trend.perWeek}/wk`
                        : '  · readings too close to rate'}
                    </span>
                  ) : null}
                </div>
                <TrendChart series={c.series} label={c.label} unit={c.unit} decimals={c.decimals} />
              </div>
            ))}
          </section>

          <PhaseCard phase={vm.phase} onChange={goals.openPhase} />
          <TargetsCard targets={vm.targets} onChange={goals.openTargets} />
          <PrioritiesCard priorities={vm.priorities} onEdit={goals.openPriorities} />
          <RulesCard
            rules={goals.activeRules}
            retiredCount={goals.retiredRules.length}
            onEdit={goals.openEditRule}
            onAdd={goals.openNewRule}
            onPreview={goals.openPrompt}
          />

          <Text variant="micro">
            Changing targets or a phase supersedes the current row rather than overwriting it, so
            past days keep being graded against what was true then.
          </Text>
        </>
      )}

      <GoalEditors vm={goals} />

      <WeighInSheet
        draft={vm.weighIn}
        canSave={vm.canSaveWeighIn}
        isSaving={vm.isSaving}
        onChange={vm.setWeighIn}
        onClose={vm.closeWeighIn}
        onSave={() => void vm.saveWeighIn()}
      />
    </main>
  )
}
