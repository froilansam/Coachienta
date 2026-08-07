'use client'
import { ArrowDown, ChevronDown, RotateCcw } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { Button } from '@/components/ui/Button'
import { EmptyState } from '@/components/ui/EmptyState'
import { Spinner } from '@/components/ui/Spinner'
import { Text } from '@/components/ui/Text'
import { useCoach } from '@/hooks/useCoach'
import { LABEL, quotaState } from '@/lib/domain/coach/models'
import { CoachComposer } from './CoachComposer'
import { CoachMessage } from './CoachMessage'
import { ModelPicker } from './ModelPicker'

/**
 * Coachienta. One hook call, then JSX.
 *
 * The thing that makes this trustworthy is not the prose — it is that every number
 * comes from a SQL tool over the complete range, and every answer shows which tools ran
 * and over what dates. A coach quoting figures you cannot check is worse than no coach:
 * the spreadsheet's agent coached from a 64 kg bodyweight for two months precisely
 * because nothing ever showed its workings.
 */
export function CoachScreen() {
  const vm = useCoach()
  const [pickerOpen, setPickerOpen] = useState(false)

  const active = vm.modelOptions.find((o) => o.choice === vm.modelChoice)
  const lowOnQuota = active ? quotaState(active.quota) !== 'ok' : false

  return (
    /*
      `min-h` on the viewport minus the tab bar: without a height to fill, `flex-1` on
      the thread has no leftover space to take, so a short conversation left the composer
      floating mid-screen with dead space beneath it.
    */
    <main className="mx-auto flex min-h-[calc(100dvh-var(--tabbar-h))] w-full max-w-lg flex-col px-4 pt-6">
      <header className="flex items-center justify-between gap-2 pb-4">
        <Text as="h1" variant="title">
          Coach
        </Text>

        <div className="flex items-center gap-1">
          {/*
            The model is a quota decision, so it lives here rather than buried in
            settings — you switch at the moment a reply fails, not on a separate trip.
            It turns amber when the pool it names is nearly gone.
          */}
          <button
            type="button"
            onClick={() => setPickerOpen(true)}
            aria-label={`Model: ${LABEL[vm.modelChoice].label}. Change model.`}
            className="flex min-h-11 items-center gap-1 rounded-md px-2 hover:bg-sunk"
          >
            <Text variant="label" tone={lowOnQuota ? 'warn' : 'tertiary'}>
              {LABEL[vm.modelChoice].label}
            </Text>
            <ChevronDown size={13} strokeWidth={2.5} aria-hidden className="text-ink-3" />
          </button>

          {vm.isEmpty ? null : (
            <Button variant="ghost" size="sm" iconStart={RotateCcw} onClick={vm.reset}>
              NEW
            </Button>
          )}
        </div>
      </header>

      <Thread vm={vm} />

      <ModelPicker
        open={pickerOpen}
        onOpenChange={setPickerOpen}
        options={vm.modelOptions}
        selected={vm.modelChoice}
        onSelect={vm.setModelChoice}
      />

      <CoachComposer
        value={vm.input}
        onChange={vm.setInput}
        onSend={() => vm.send()}
        canSend={vm.canSend}
        isBusy={vm.isBusy}
        followUps={vm.followUps}
        onPick={(text) => vm.send(text)}
      />
    </main>
  )
}

/**
 * The transcript, and the two things that keep a streaming answer usable: it follows the
 * text down, and it stops following the moment you scroll up to re-read something.
 */
function Thread({ vm }: { vm: ReturnType<typeof useCoach> }) {
  const endRef = useRef<HTMLDivElement | null>(null)
  const [pinned, setPinned] = useState(true)

  useEffect(() => {
    if (pinned) endRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' })
  }, [vm.turns, vm.thinking, pinned])

  useEffect(() => {
    const onScroll = () => {
      const fromBottom =
        document.documentElement.scrollHeight - window.scrollY - window.innerHeight
      setPinned(fromBottom < 120)
    }
    window.addEventListener('scroll', onScroll, { passive: true })
    return () => window.removeEventListener('scroll', onScroll)
  }, [])

  if (vm.isEmpty) {
    return (
      <div className="flex flex-1 flex-col justify-center">
        {/*
          Alma's honesty pattern, which independently matches AC-3.13: say what is
          missing rather than inviting a question that cannot be answered well yet.
        */}
        <EmptyState
          title="ASK ABOUT YOUR NUMBERS"
          body="Every answer is computed from your logged data — averages over every row, not a sample — and shows which queries it ran. Pick one below, or ask anything."
        />
      </div>
    )
  }

  return (
    <div className="flex flex-1 flex-col gap-5 pb-4">
      {vm.turns.map((turn) => (
        <CoachMessage key={turn.id} turn={turn} />
      ))}

      {/* Names the tool that is running. Generic filler hides a wrong tool choice
          while it happens; four seconds of silence reads as broken (§3.8). */}
      {vm.thinking ? (
        <div className="flex items-center gap-2">
          <Spinner size={13} />
          <Text variant="micro" tone="secondary">
            {vm.thinking}
          </Text>
        </div>
      ) : null}

      {vm.error ? (
        <div className="flex flex-col items-start gap-2 rounded-md bg-neg-wash px-3 py-2">
          <Text variant="meta" tone="neg">
            {vm.error}
          </Text>
          <Button variant="secondary" size="sm" onClick={vm.retry}>
            TRY AGAIN
          </Button>
        </div>
      ) : null}

      {/* Gemini's affordance: a long streaming answer scrolls past the viewport, and
          without this you have to guess how far. Only shown once you have scrolled away. */}
      {!pinned ? (
        <button
          type="button"
          onClick={() => setPinned(true)}
          aria-label="Scroll to the latest reply"
          className="fixed bottom-40 left-1/2 z-10 grid size-11 -translate-x-1/2 place-items-center rounded-full border border-rule-strong bg-surface shadow-pop"
        >
          <ArrowDown size={16} strokeWidth={2} aria-hidden className="text-ink-2" />
        </button>
      ) : null}

      <div ref={endRef} />
    </div>
  )
}
