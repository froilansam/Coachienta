'use client'
import { NumericTable, type Column } from '@/components/patterns/NumericTable'
import { PrStamp } from '@/components/patterns/PrStamp'
import { Checkbox } from '@/components/ui/Checkbox'
import { NumericInput } from '@/components/ui/NumericInput'
import { Text } from '@/components/ui/Text'
import type { ExerciseBlock, SessionState } from '@/hooks/useSession'
import { describeKinds } from '@/lib/domain/train/detectPr'
import { isComplete, type SetRow } from '@/lib/domain/train/session'

/**
 * The set table. `SET · PREV · load · reps · ✓`.
 *
 * The checkbox commits and the row fills — Hevy and Gymshark independently landed
 * on this, and PRD-002 §0 records why it replaced my per-row SAVE button: smaller,
 * fixed position, and it allows committing out of order. `Checkbox variant="commit"`
 * is 32px and always in the same column so it can be found without looking.
 *
 * `PREV` is never hidden. `—` when there is no history at this gym (US-2.4).
 */
export function SetTable({ block, vm }: { block: ExerciseBlock; vm: SessionState }) {
  const { inputs, exercise } = block

  const columns: Array<Column<SetRow>> = [
    {
      key: 'set',
      header: 'SET',
      width: 'min',
      render: (row) =>
        row.committed ? (
          <span className="tabular font-mono text-2xs text-ink-2">{vm.label(row)}</span>
        ) : (
          // Tapping the index marks the row a warmup — `W` rather than a number,
          // because a warmup is not set 1 of the work (§4.3).
          <button
            type="button"
            onClick={() => vm.toggleWarmup(row)}
            /* The exercise name is part of the label: five exercises each have a
               "set 1", and a screen-reader user would hear the same phrase five
               times with no way to tell them apart — the same fault fixed for the
               food log's delete button. */
            aria-label={`Mark ${exercise.name} set ${row.set_index} as ${row.kind === 'warmup' ? 'working' : 'warmup'}`}
            className="tabular grid size-11 place-items-center font-mono text-2xs text-ink-3 hover:text-accent"
          >
            {vm.label(row)}
          </button>
        ),
    },
    {
      key: 'prev',
      header: 'PREV',
      render: (row) => {
        const i = block.rows.indexOf(row)
        return (
          <span className="tabular font-mono text-2xs text-ink-3">{block.prev[i] ?? '—'}</span>
        )
      },
    },
  ]

  if (inputs.weight) {
    columns.push({
      key: 'weight',
      header: inputs.weightLabel,
      align: 'end',
      render: (row) => <Cell row={row} field="weight_kg" vm={vm} label={`${inputs.weightLabel} for set ${row.set_index} of ${exercise.name}`} decimals={1} />,
    })
  }
  if (inputs.reps) {
    columns.push({
      key: 'reps',
      header: 'REPS',
      align: 'end',
      render: (row) => <Cell row={row} field="reps" vm={vm} label={`Reps for set ${row.set_index} of ${exercise.name}`} decimals={0} />,
    })
  }
  if (inputs.duration) {
    columns.push({
      key: 'duration',
      header: 'SECS',
      align: 'end',
      render: (row) => <Cell row={row} field="duration_sec" vm={vm} label={`Seconds for set ${row.set_index} of ${exercise.name}`} decimals={0} />,
    })
  }
  if (exercise.is_unilateral) {
    // Numbers per side, never free text (AC-2.12).
    columns.push({
      key: 'side',
      header: 'SIDE',
      width: 'min',
      render: (row) => <Text variant="micro">{row.side === null ? '—' : row.side === 'left' ? 'L' : 'R'}</Text>,
    })
  }

  // The stamp sits with the numbers that earned it, before the checkbox — a
  // mechanical press coming down, not confetti (PRD-002 §10).
  columns.push({
    key: 'pr',
    header: '',
    width: 'min',
    render: (row) => {
      const pr = vm.prs[row.id]
      if (!pr?.isPr) return null
      return (
        <span title={pr.basis ?? undefined} aria-label={`Personal record: ${describeKinds(pr.kinds)}`}>
          <PrStamp stampKey={row.id} />
        </span>
      )
    },
  })

  columns.push({
    key: 'commit',
    header: '✓',
    width: 'min',
    render: (row) => (
      <Checkbox
        variant="commit"
        checked={row.committed}
        disabled={row.committed || !isComplete(row, exercise.load_type)}
        label={row.committed ? `Set ${row.set_index} saved` : `Save set ${row.set_index} of ${exercise.name}`}
        onCheckedChange={() => void vm.commit(row)}
      />
    ),
  })

  return (
    <NumericTable
      caption={`Sets for ${exercise.name}`}
      columns={columns}
      rows={block.rows}
      rowKey={(r) => r.id}
      rowState={(r) => (r.committed ? 'committed' : 'active')}
      flashKeys={vm.flashKeys}
    />
  )
}

/** A committed cell is text, not a disabled input — locked should look locked. */
function Cell({
  row,
  field,
  vm,
  label,
  decimals,
}: {
  row: SetRow
  field: 'weight_kg' | 'reps' | 'duration_sec'
  vm: SessionState
  label: string
  decimals: number
}) {
  const value = row[field]
  if (row.committed) {
    return (
      <span className="tabular block text-right font-mono text-sm text-ink">
        {value === null ? '—' : value}
      </span>
    )
  }
  return (
    <div className="w-16">
      <NumericInput
        value={value}
        onChange={(v) => vm.setValue(row, field, v)}
        decimals={decimals}
        aria-label={label}
      />
    </div>
  )
}
