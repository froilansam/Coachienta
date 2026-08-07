'use client'
import { Plus, X } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { Chip } from '@/components/ui/Chip'
import { Rule } from '@/components/ui/Rule'
import { Select } from '@/components/ui/Select'
import { Text } from '@/components/ui/Text'
import type { ExerciseBlock as Block, SessionState } from '@/hooks/useSession'
import { describeExercise } from '@/lib/domain/train/exercise'
import { REST_OPTIONS, restLabel } from '@/lib/domain/train/session'
import { SetTable } from './SetTable'

/**
 * One exercise mid-session: what it is, how many sets are done, the table, and
 * what to beat.
 *
 * `2 of 5` rather than a progress bar — you are counting sets, not filling a
 * container (Ladder shows the same, PRD-002 §0).
 */
export function ExerciseBlockView({ block, vm }: { block: Block; vm: SessionState }) {
  const done = block.rows.filter((r) => r.committed).length
  const target = block.targetSets ?? block.rows.length

  return (
    <section className="flex flex-col gap-2">
      <div className="flex items-start justify-between gap-3">
        <span className="flex min-w-0 flex-col gap-0.5">
          <Text variant="body" truncate>{block.exercise.name}</Text>
          <Text variant="micro">{describeExercise(block.exercise)}</Text>
        </span>
        <span className="flex shrink-0 items-center gap-1">
          <span className="tabular font-mono text-2xs text-ink-3">{`${done} of ${target}`}</span>
          {/* Swapping an exercise out mid-session is first-class (US-2.18), so the
              control is visible rather than buried in a menu — but it confirms, since
              committed sets go with it. */}
          <button
            type="button"
            onClick={() => vm.askRemove(block)}
            aria-label={`Remove ${block.exercise.name} from this session`}
            className="grid size-11 place-items-center rounded-md text-ink-3 hover:bg-neg-wash hover:text-neg"
          >
            <X size={15} strokeWidth={2} aria-hidden />
          </button>
        </span>
      </div>

      {/* Rest is per exercise, configured inline. A plank and a heavy press do not
          need the same rest, which is why a global timer was wrong (PRD-002 §0). */}
      <div className="flex items-center gap-2">
        <div className="w-32">
          <Select
            label={`Rest for ${block.exercise.name}`}
            size="md"
            value={String(block.restSec)}
            onChange={(v) => vm.setRest(block.position, Number(v))}
            options={REST_OPTIONS.map((s) => ({ value: String(s), label: `Rest ${restLabel(s)}` }))}
          />
        </div>
        {block.repLow !== null && block.repHigh !== null ? (
          <Chip
            label={`${block.repLow}–${block.repHigh} ${block.inputs.duration ? 's' : 'reps'}`}
            tone="neutral"
          />
        ) : null}
      </div>

      <SetTable block={block} vm={vm} />

      {/* The target, with its evidence. Same rule as the plan screen: a suggestion
          without a basis is unauditable (AC-2.8). */}
      <div className="flex flex-col gap-0.5 rounded-md bg-sunk px-3 py-2">
        <Text variant="label">TARGET</Text>
        <span className="tabular font-mono text-2xs text-ink">{block.target.suggestion}</span>
        <Text variant="micro">{block.target.basis}</Text>
      </div>

      <div className="flex gap-2">
        <Button variant="secondary" size="sm" iconStart={Plus} onClick={() => vm.addSet(block.position)}>
          ADD SET
        </Button>
        {block.exercise.is_unilateral ? (
          <>
            <Button variant="ghost" size="sm" onClick={() => vm.addSet(block.position, 'left')}>
              + LEFT
            </Button>
            <Button variant="ghost" size="sm" onClick={() => vm.addSet(block.position, 'right')}>
              + RIGHT
            </Button>
          </>
        ) : null}
      </div>

      <Rule strong />
    </section>
  )
}
