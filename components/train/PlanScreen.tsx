'use client'
import { AlertTriangle, Play, Plus } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { ConfirmSheet } from '@/components/patterns/ConfirmSheet'
import { Button } from '@/components/ui/Button'
import { Chip } from '@/components/ui/Chip'
import { EmptyState } from '@/components/ui/EmptyState'
import { Field, Input } from '@/components/ui/Field'
import { Rule } from '@/components/ui/Rule'
import { Select } from '@/components/ui/Select'
import { SkeletonList } from '@/components/ui/Skeleton'
import { Text } from '@/components/ui/Text'
import { usePlan } from '@/hooks/usePlan'
import { ExercisePickerSheet } from './ExercisePickerSheet'
import { PlanPromptRow } from './PlanPromptRow'
import { PlanRowCard } from './PlanRow'

/**
 * The day plan. Template, or empty, then edit freely and start.
 *
 * Nothing is written until START SESSION — the draft lives in the hook. Same rule
 * as a photo yielding candidates and an AI draft never auto-starting a session
 * (AC-1.9, AC-2.17).
 *
 * Footer is Gymshark's two buttons: add exercises, then commit. The picker is
 * `ExerciseList` in selection mode — the same component the library browses with.
 *
 * Three ways in, one list out: a prompt, a template, or nothing. An AI draft is not a
 * special mode — it fills the same `items` state a template does, so every edit
 * control works on it unchanged (AC-2.18).
 */
export function PlanScreen() {
  const vm = usePlan()
  const router = useRouter()

  if (vm.loadError) {
    return (
      <main className="mx-auto w-full max-w-lg px-4 py-8">
        <EmptyState
          title="CANNOT REACH THE SERVER"
          body="The plan could not be loaded. Templates and history both need it."
          action={<Button variant="secondary" onClick={vm.retry}>TRY AGAIN</Button>}
        />
      </main>
    )
  }

  return (
    <main className="mx-auto flex w-full max-w-lg flex-col gap-4 px-4 pt-6 pb-8">
      <Text as="h1" variant="title">New session</Text>

      <div className="flex flex-col gap-3">
        <Field label="Date">
          <Input type="date" value={vm.day} onChange={(e) => vm.setDay(e.target.value)} />
        </Field>

        {/* Gym is not a detail: LAST, BEST and every PR are scoped to it (§3.2). */}
        {vm.gyms.length > 0 && vm.gymId ? (
          <Select
            label="Gym"
            showLabel
            value={vm.gymId}
            onChange={vm.setGymId}
            options={vm.gyms.map((g) => ({ value: g.id, label: g.name }))}
          />
        ) : null}

        <PlanPromptRow
          value={vm.prompt}
          onChange={vm.setPrompt}
          onBuild={() => void vm.build()}
          canBuild={vm.canBuild}
          isBuilding={vm.isBuilding}
          draft={vm.draft}
        />

        {/* `items-end` aligns EMPTY to the bottom of the TRIGGER, because the
            label Select draws sits inside its own block. */}
        <div className="flex items-end gap-2">
          <div className="min-w-0 flex-1">
            {vm.templates.length > 0 ? (
              <Select
                label="Template"
                showLabel
                value={vm.templateId ?? ''}
                onChange={vm.useTemplate}
                placeholder="Pick a day"
                options={vm.templates.map((t) => ({ value: t.id, label: t.name }))}
              />
            ) : null}
          </div>
          <Button variant="secondary" onClick={vm.startEmpty}>
            EMPTY
          </Button>
        </div>
      </div>

      {vm.isLoading ? (
        <SkeletonList rows={6} />
      ) : (
        <>
          {vm.rows.length > 0 ? (
            <Field label="Session name">
              <Input value={vm.name} onChange={(e) => vm.setName(e.target.value)} />
            </Field>
          ) : null}

          {/* Order violations name the rule, before you start (AC-2.11). */}
          {vm.rules.violations.map((v) => (
            <div key={v.title} className="flex items-start gap-2 rounded-md bg-warn-wash p-3 text-warn">
              <AlertTriangle size={13} strokeWidth={2.5} aria-hidden className="mt-0.5 shrink-0" />
              <span className="flex flex-col gap-0.5">
                <Text variant="label">{v.title}</Text>
                <Text variant="micro">{v.detail}</Text>
              </span>
            </div>
          ))}

          {vm.notice ? <Chip label={vm.notice} tone="neg" /> : null}

          {vm.rows.length === 0 ? (
            <EmptyState
              title="NOTHING PLANNED"
              body="Describe the session above, pick a template, or add exercises one at a time."
              action={
                <Button variant="primary" iconStart={Plus} onClick={vm.openPicker}>
                  ADD EXERCISE
                </Button>
              }
            />
          ) : (
            <>
              <div className="flex items-baseline justify-between gap-3">
                <Text variant="label">{`${vm.gymName}`}</Text>
                <Text variant="micro">{vm.summary}</Text>
              </div>
              <Rule strong />
              <ol className="flex flex-col">
                {vm.rows.map((row, i) => (
                  <PlanRowCard
                    key={`${row.item.exercise.id}-${i}`}
                    index={i}
                    total={vm.rows.length}
                    row={row}
                    onMove={(d) => vm.move(i, d)}
                    onRemove={() => vm.remove(i)}
                    onSets={(v) => vm.setSets(i, v)}
                    onReps={(lo, hi) => vm.setReps(i, lo, hi)}
                  />
                ))}
              </ol>

              {/* Gymshark's footer: add more, or commit. */}
              <Button variant="secondary" fullWidth iconStart={Plus} onClick={vm.openPicker}>
                ADD EXERCISE
              </Button>
              <Button
                variant="primary"
                size="lg"
                fullWidth
                iconStart={Play}
                disabled={!vm.canStart}
                loading={vm.isStarting}
                onClick={async () => {
                  const id = await vm.start()
                  if (id) router.push(`/train/session/${id}`)
                }}
              >
                START SESSION
              </Button>

              {/* Criticals the checker cannot parse are named rather than assumed
                  satisfied — a rule silently treated as met is worse than no check. */}
              {vm.rules.unchecked.length > 0 ? (
                <Text variant="micro">
                  {`Not checked automatically: ${vm.rules.unchecked.join(' · ')}. Read them yourself before you start.`}
                </Text>
              ) : null}
            </>
          )}
        </>
      )}

      {/* §6: a re-BUILD over existing rows asks before discarding them. Replace is
          the default because a second BUILD usually means "not that, try again". */}
      <ConfirmSheet
        open={vm.rebuild !== null}
        title="Build again"
        body={`You already have ${vm.rows.length} exercise${vm.rows.length === 1 ? '' : 's'} planned. Replace them with the new draft, or add the new one to what is there?`}
        confirmLabel="REPLACE"
        altLabel="ADD TO PLAN"
        tone="primary"
        isBusy={vm.isBuilding}
        onCancel={() => vm.rebuild?.cancel()}
        onConfirm={() => void vm.rebuild?.replace()}
        onAlt={() => void vm.rebuild?.append()}
      />

      <ExercisePickerSheet
        open={vm.pickerOpen}
        onOpenChange={(o) => !o && vm.closePicker()}
        exercises={vm.exercises}
        selected={vm.pickedIds}
        onToggle={vm.togglePick}
      />
    </main>
  )
}
