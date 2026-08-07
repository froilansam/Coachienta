'use client'
import { AlertTriangle } from 'lucide-react'
import { Chip } from '@/components/ui/Chip'
import { Field, Input } from '@/components/ui/Field'
import { Rule } from '@/components/ui/Rule'
import { Select } from '@/components/ui/Select'
import { Text } from '@/components/ui/Text'
import { Toggle } from '@/components/ui/Toggle'
import type { ExerciseLibraryView } from '@/hooks/useExerciseLibrary'
import {
  LOAD_TYPE_META,
  LOAD_TYPES,
  MOVEMENT_PATTERNS,
  MUSCLE_GROUPS,
  muscleLabel,
  patternLabel,
  type LoadType,
} from '@/lib/domain/train/exercise'

/**
 * Correct one exercise, or add one.
 *
 * `muscle_group` leads because it is the field with the widest blast radius: it is
 * what per-muscle volume and `priority_volume_share()` group by, so a mis-tagged
 * exercise corrupts the V-taper adherence measurement rather than just looking
 * untidy (AC-2.14, AC-4.14).
 */
export function ExerciseEditor({ vm }: { vm: ExerciseLibraryView }) {
  const { draft, original } = vm.edit!
  const set = vm.setDraft
  const meta = LOAD_TYPE_META[draft.load_type as LoadType]

  return (
    <div className="flex flex-col gap-3 pb-2">
      {vm.edit!.original?.set_count ? (
        <Text variant="micro">
          {`${original!.set_count} logged set${original!.set_count === 1 ? '' : 's'} reference this exercise.`}
        </Text>
      ) : null}

      <Field label="Name">
        <Input value={draft.name} enterKeyHint="done" onChange={(e) => set({ name: e.target.value })} />
      </Field>

      <Select
        label="Muscle group"
        value={draft.muscle_group}
        onChange={(muscle_group) => set({ muscle_group })}
        options={MUSCLE_GROUPS.map((m) => ({ value: m, label: muscleLabel(m) }))}
      />
      <Select
        label="Movement pattern"
        value={draft.movement_pattern}
        onChange={(movement_pattern) => set({ movement_pattern })}
        options={MOVEMENT_PATTERNS.map((p) => ({ value: p, label: patternLabel(p) }))}
      />

      <Rule />

      <Select
        label="Load type"
        value={draft.load_type}
        onChange={(load_type) => set({ load_type })}
        options={LOAD_TYPES.map((l) => ({ value: l, label: LOAD_TYPE_META[l].label }))}
      />
      {/* What the choice means, in the same breath as making it — this field decides
          whether volume exists at all for every set of this exercise. */}
      {meta ? (
        <div className="flex flex-col gap-0.5 rounded-md bg-sunk p-3">
          <Text variant="micro">{`Inputs: ${meta.inputs}`}</Text>
          <Text variant="micro">{`Volume: ${meta.volume}`}</Text>
          <Text variant="micro">{`Progress by: ${meta.progression}`}</Text>
        </div>
      ) : null}

      {vm.loadWarning ? (
        <div className="flex items-start gap-2 rounded-md bg-warn-wash p-3 text-warn">
          <AlertTriangle size={13} strokeWidth={2.5} aria-hidden className="mt-0.5 shrink-0" />
          <Text variant="micro">{vm.loadWarning}</Text>
        </div>
      ) : null}

      <Rule />

      <Field label="Equipment" hint="Optional — machine, dumbbell, cable">
        <Input value={draft.equipment} onChange={(e) => set({ equipment: e.target.value })} />
      </Field>
      <Toggle
        label="Logged per side"
        hint="Unilateral work records left and right separately"
        checked={draft.is_unilateral}
        onCheckedChange={(is_unilateral) => set({ is_unilateral })}
      />

      {!vm.canSave ? <Chip label="A name is required" tone="warn" /> : null}
    </div>
  )
}
