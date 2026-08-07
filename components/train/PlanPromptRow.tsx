'use client'
import { ChevronDown, Sparkles } from 'lucide-react'
import { useState } from 'react'
import { Button } from '@/components/ui/Button'
import { Chip } from '@/components/ui/Chip'
import { Field, Input } from '@/components/ui/Field'
import { Text } from '@/components/ui/Text'
import type { PlanDraft } from '@/hooks/usePlan'

/**
 * `PROMPT [ Pull legs!            ] [ BUILD ]` — §4.2a's first path into a plan.
 *
 * One line, action inline, no wizard. Bevel and Cal AI both ask a sequence of
 * structured questions (equipment → intensity → duration) which is right for a new
 * user and wrong here: Froye already knows the split and typing `PULL LEGS!` is
 * faster than four taps. Genie's single follow-up field is the closer model.
 *
 * The draft itself is NOT rendered here. It goes into the ordinary `PlanRowCard` list
 * below — the same pattern Peloton Strength+ uses for a generated workout, and the
 * reason every edit control already works on it (AC-2.18). What this row adds
 * afterwards is only provenance: that it came from a model, why, and what it could
 * not do.
 */
export function PlanPromptRow({
  value,
  onChange,
  onBuild,
  canBuild,
  isBuilding,
  draft,
}: {
  value: string
  onChange: (v: string) => void
  onBuild: () => void
  /** Decided by the hook — it knows whether the exercise library has arrived. */
  canBuild: boolean
  isBuilding: boolean
  draft: PlanDraft | null
}) {
  const [showRationale, setShowRationale] = useState(false)
  const enabled = canBuild && !isBuilding

  return (
    <div className="flex flex-col gap-2">
      {/*
        BUILD goes in Field's `action` slot, not in a `flex items-end` wrapper around
        the whole Field. The wrapper version aligned the button to the bottom of the
        HINT and dropped it a full line below the input it belongs to.
      */}
      <Field
        label="Prompt"
        hint="A split, a focus, a mood — “short push, delts first”."
        action={
          <Button
            variant="secondary"
            iconStart={Sparkles}
            disabled={!enabled}
            loading={isBuilding}
            onClick={onBuild}
          >
            BUILD
          </Button>
        }
      >
        <Input
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder="Pull legs!"
          enterKeyHint="go"
          onKeyDown={(e) => {
            // Return builds. The field is one line and the button is right there, but
            // on a phone keyboard the Go key is the nearer target.
            if (e.key === 'Enter' && enabled) onBuild()
          }}
        />
      </Field>

      {/* Not a spinner over the list: the list is still yours to edit while this runs,
          and naming what it is reading is the honest version of a progress bar. */}
      {isBuilding ? (
        <Text variant="micro">Reading your coach rules, priorities and last sessions…</Text>
      ) : null}

      {draft ? (
        <div className="flex flex-col gap-1.5">
          <div className="flex flex-wrap items-center gap-1.5">
            <Chip label="AI DRAFT · EDIT FREELY" tone="accent" icon={Sparkles} />
            {/* Which model answered is not trivia — the fallback is a different model
                with different judgement, and a plan you cannot attribute is a plan you
                cannot learn to trust or distrust. */}
            {draft.degraded ? <Chip label="FALLBACK MODEL" tone="warn" /> : null}
          </div>

          {draft.notice ? (
            <Text variant="micro" tone="warn">
              {draft.notice}
            </Text>
          ) : null}

          {/*
            A real disclosure, not a tooltip. `Tooltip` is desktop-only by design and
            must never be the sole carrier of information (PRD-007 §3.17), and the
            whole row is the target so it clears 44 px.
          */}
          <button
            type="button"
            onClick={() => setShowRationale((v) => !v)}
            aria-expanded={showRationale}
            className="flex min-h-11 items-center justify-between gap-2 rounded-md text-left"
          >
            <Text variant="label">WHY THESE CHOICES</Text>
            <ChevronDown
              size={16}
              strokeWidth={2}
              aria-hidden
              className={showRationale ? 'rotate-180 text-ink-2' : 'text-ink-3'}
            />
          </button>
          {showRationale ? (
            <Text variant="meta" className="block rounded-md bg-sunk px-3 py-2">
              {draft.rationale}
            </Text>
          ) : null}
        </div>
      ) : null}
    </div>
  )
}
