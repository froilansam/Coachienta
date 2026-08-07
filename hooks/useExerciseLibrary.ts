'use client'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useCallback, useMemo, useState } from 'react'
import type { ExerciseListResponse } from '@/app/api/data/exercises/route'
import {
  auditExercise,
  canSaveExercise,
  group,
  loadTypeWarning,
  matches,
  MUSCLE_GROUPS,
  needsAttention,
  type Audit,
  type Exercise,
  type ExerciseDraft,
  type Group,
  type GroupBy,
} from '@/lib/domain/train/exercise'

/**
 * The exercise library screen: browse, search, filter, correct, add, retire.
 *
 * Filters are chips rather than tabs. Gymshark uses Alphabetical / Body Part /
 * Recent tabs, but `Recent` needs session history and there are zero sessions —
 * shipping an empty tab would be a dead control. Chips also combine, which tabs
 * cannot: "chest" plus "needs check" is one tap each.
 */
export type LibraryFilter = 'all' | 'attention' | 'retired'

export interface ExerciseRow {
  exercise: Exercise
  audit: Audit
}

export interface ExerciseLibraryView {
  isLoading: boolean
  loadError: boolean
  retry: () => void

  query: string
  setQuery: (v: string) => void
  filter: LibraryFilter
  setFilter: (f: LibraryFilter) => void
  groupBy: GroupBy
  setGroupBy: (g: GroupBy) => void
  /** Muscle group narrowing, on top of the search box. Null means all. */
  muscle: string | null
  setMuscle: (m: string | null) => void

  groups: Array<Group & { rows: ExerciseRow[] }>
  /** Muscle groups present in the library, for the filter chips. */
  muscles: string[]
  counts: { all: number; attention: number; retired: number }
  shownCount: number

  edit: { draft: ExerciseDraft; original: Exercise | null } | null
  openNew: () => void
  openEdit: (e: Exercise) => void
  close: () => void
  setDraft: (patch: Partial<ExerciseDraft>) => void
  canSave: boolean
  /** Non-null when the load-type change would reinterpret logged sets. */
  loadWarning: string | null
  save: () => Promise<void>
  setActive: (e: Exercise, active: boolean) => Promise<void>

  isSaving: boolean
  notice: string | null
}

const EMPTY_DRAFT: ExerciseDraft = {
  name: '',
  muscle_group: 'chest',
  movement_pattern: 'isolation',
  load_type: 'external_weight',
  is_unilateral: false,
  equipment: '',
}

export function useExerciseLibrary(): ExerciseLibraryView {
  const qc = useQueryClient()
  const [query, setQuery] = useState('')
  const [filter, setFilter] = useState<LibraryFilter>('all')
  const [groupBy, setGroupBy] = useState<GroupBy>('muscle')
  const [muscle, setMuscle] = useState<string | null>(null)
  const [edit, setEdit] = useState<{ draft: ExerciseDraft; original: Exercise | null } | null>(null)
  const [isSaving, setIsSaving] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)

  const { data, isLoading, error, refetch } = useQuery<ExerciseListResponse>({
    queryKey: ['exercises'],
    queryFn: async () => {
      // Retired rows are fetched too — they are a filter, not a separate screen.
      const res = await fetch('/api/data/exercises?inactive=1')
      if (!res.ok) throw new Error('exercises')
      return res.json() as Promise<ExerciseListResponse>
    },
  })

  /**
   * Memoised, because `?? []` mints a new array identity every render — which
   * silently defeated every `useMemo` below it, re-auditing 57 rows on each
   * keystroke.
   */
  const all = useMemo(() => data?.exercises ?? [], [data])

  /** Audited once per row, then reused by the counts, the filter and the list. */
  const audited = useMemo<ExerciseRow[]>(
    () => all.map((exercise) => ({ exercise, audit: auditExercise(exercise) })),
    [all],
  )

  const counts = useMemo(
    () => ({
      all: audited.filter((r) => r.exercise.is_active).length,
      attention: audited.filter((r) => r.exercise.is_active && needsAttention(r.audit)).length,
      retired: audited.filter((r) => !r.exercise.is_active).length,
    }),
    [audited],
  )

  const shown = useMemo(() => {
    const byFilter = audited.filter((r) =>
      filter === 'retired'
        ? !r.exercise.is_active
        : r.exercise.is_active && (filter === 'all' || needsAttention(r.audit)),
    )
    const byMuscle = muscle ? byFilter.filter((r) => r.exercise.muscle_group === muscle) : byFilter
    return byMuscle.filter((r) => matches(r.exercise, query))
  }, [audited, filter, muscle, query])

  const groups = useMemo(() => {
    const sections = group(
      shown.map((r) => r.exercise),
      groupBy,
    )
    // Re-attach the audit each section's rows already carry, rather than auditing
    // again inside the component.
    const byId = new Map(shown.map((r) => [r.exercise.id, r]))
    return sections.map((s) => ({
      ...s,
      rows: s.exercises.map((e) => byId.get(e.id)!).filter(Boolean),
    }))
  }, [shown, groupBy])

  /**
   * Ordered by the priority list, not by the Postgres enum — the sections below use
   * that order, and chips in a different order than the list they filter is the
   * kind of small inconsistency that makes a screen feel unreliable.
   */
  const muscles = useMemo(() => {
    const present = new Set(all.filter((e) => e.is_active).map((e) => e.muscle_group))
    return (MUSCLE_GROUPS as readonly string[]).filter((m) => present.has(m))
  }, [all])

  const openNew = useCallback(() => {
    setEdit({ draft: { ...EMPTY_DRAFT }, original: null })
    setNotice(null)
  }, [])

  const openEdit = useCallback((e: Exercise) => {
    setEdit({
      original: e,
      draft: {
        name: e.name,
        muscle_group: e.muscle_group,
        movement_pattern: e.movement_pattern,
        load_type: e.load_type,
        is_unilateral: e.is_unilateral,
        equipment: e.equipment ?? '',
      },
    })
    setNotice(null)
  }, [])

  const post = useCallback(
    async (body: unknown, message: string) => {
      setIsSaving(true)
      try {
        const res = await fetch('/api/data/exercises', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        })
        const json = (await res.json()) as { error?: string }
        if (!res.ok) throw new Error(json.error ?? 'That edit was refused.')
        await qc.invalidateQueries({ queryKey: ['exercises'] })
        setEdit(null)
        setNotice(message)
      } catch (err) {
        setNotice(err instanceof Error ? err.message : 'That edit was refused.')
      } finally {
        setIsSaving(false)
      }
    },
    [qc],
  )

  const save = useCallback(async () => {
    if (!edit) return
    const { draft, original } = edit
    await post(
      original ? { action: 'update', id: original.id, ...draft } : { action: 'add', ...draft },
      original ? `${draft.name.trim()} updated.` : `${draft.name.trim()} added.`,
    )
  }, [edit, post])

  return {
    isLoading,
    loadError: error !== null,
    retry: () => void refetch(),

    query,
    setQuery,
    filter,
    setFilter,
    groupBy,
    setGroupBy,
    muscle,
    setMuscle,

    groups,
    muscles,
    counts,
    shownCount: shown.length,

    edit,
    openNew,
    openEdit,
    close: () => setEdit(null),
    setDraft: (patch) => setEdit((e) => (e ? { ...e, draft: { ...e.draft, ...patch } } : e)),
    canSave: edit !== null && canSaveExercise(edit.draft),
    loadWarning:
      edit?.original != null
        ? loadTypeWarning(edit.original.load_type, edit.draft.load_type, edit.original.set_count)
        : null,
    save,
    setActive: (e, is_active) =>
      post(
        { action: 'set_active', id: e.id, is_active },
        is_active ? `${e.name} is back in the library.` : `${e.name} retired.`,
      ),

    isSaving,
    notice,
  }
}
