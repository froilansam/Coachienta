'use client'
import { useQuery } from '@tanstack/react-query'
import { useCallback, useMemo, useState } from 'react'
import type { AiPlanResponse } from '@/app/api/ai/plan-workout/route'
import type { PlanPayload } from '@/app/api/data/plan/route'
import { todayLocal } from '@/lib/domain/date'
import type { Exercise } from '@/lib/domain/train/exercise'
import {
  add as addItem,
  canStart,
  checkRules,
  move as moveItem,
  patch as patchItem,
  remove as removeItem,
  summarise,
  type PlanItem,
  type RuleCheck,
} from '@/lib/domain/train/plan'
import { describeBest, describeLast, suggestTarget, type Target } from '@/lib/domain/train/progression'

/**
 * The day plan. Owns the draft, the history lookups and the rule check.
 *
 * The plan is a **client-side draft** until START SESSION. Nothing is written while
 * you shuffle exercises around — the same rule as a photo yielding candidates
 * (AC-1.9) and an AI draft never auto-starting a session (AC-2.17).
 */
export interface PlanRow {
  item: PlanItem
  /** Always present, `—` when there is no history at this gym (US-2.15, AC-2.19). */
  last: string
  best: string
  target: Target
}

export interface PlanView {
  isLoading: boolean
  loadError: boolean
  retry: () => void

  day: string
  setDay: (d: string) => void
  gymId: string | null
  setGymId: (id: string) => void
  gyms: PlanPayload['gyms']
  gymName: string

  templates: PlanPayload['templates']
  templateId: string | null
  /** Loads a template into the draft, replacing it. */
  useTemplate: (id: string) => void
  startEmpty: () => void

  name: string
  setName: (v: string) => void
  rows: PlanRow[]
  summary: string
  rules: RuleCheck

  move: (index: number, delta: number) => void
  remove: (index: number) => void
  setSets: (index: number, sets: number | null) => void
  setReps: (index: number, low: number | null, high: number | null) => void

  /** The picker, reusing `ExerciseList` in selection mode. */
  pickerOpen: boolean
  openPicker: () => void
  closePicker: () => void
  exercises: Exercise[]
  pickedIds: ReadonlySet<string>
  togglePick: (e: Exercise) => void

  /**
   * Prompt → AI draft (US-2.12–2.14). The draft lands in the SAME `items` state a
   * template fills, so every edit control below already works on it — which is the
   * whole of AC-2.18.
   */
  prompt: string
  setPrompt: (v: string) => void
  build: () => Promise<void>
  isBuilding: boolean
  /**
   * False until there is a prompt AND the library has arrived.
   *
   * The library matters: a draft is mapped through `byId` exactly once, so building
   * before `/api/data/plan` resolves silently drops every id and produces an `AI
   * DRAFT` chip above an empty plan. Cheap to prevent, invisible once shipped.
   */
  canBuild: boolean
  /** Set once a build succeeds. Cleared by EMPTY or by picking a template. */
  draft: PlanDraft | null
  /** Non-null when BUILD would discard work — the caller confirms first (§6). */
  rebuild: { replace: () => Promise<void>; append: () => Promise<void>; cancel: () => void } | null

  canStart: boolean
  isStarting: boolean
  notice: string | null
  start: () => Promise<string | null>
}

export interface PlanDraft {
  title: string
  /** Why these choices — which rules and priorities drove them. */
  rationale: string
  /** What could not be honoured, or what the server corrected. Null when clean. */
  notice: string | null
  /** True when the primary model was out of quota and the fallback answered. */
  degraded: boolean
}

export function usePlan(): PlanView {
  const [day, setDay] = useState(() => todayLocal())
  const [gymId, setGymIdState] = useState<string | null>(null)
  const [templateId, setTemplateId] = useState<string | null>(null)
  const [name, setName] = useState('')
  const [items, setItems] = useState<PlanItem[]>([])
  const [pickerOpen, setPickerOpen] = useState(false)
  const [isStarting, setIsStarting] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)
  const [prompt, setPrompt] = useState('')
  const [isBuilding, setIsBuilding] = useState(false)
  const [draft, setDraft] = useState<PlanDraft | null>(null)
  const [askRebuild, setAskRebuild] = useState(false)

  const { data, isLoading, error, refetch } = useQuery<PlanPayload>({
    queryKey: ['plan', gymId],
    queryFn: async () => {
      const res = await fetch(`/api/data/plan${gymId ? `?gym=${gymId}` : ''}`)
      if (!res.ok) throw new Error('plan')
      return res.json() as Promise<PlanPayload>
    },
  })

  const gyms = data?.gyms ?? []
  /**
   * Both memoised. A fresh `[]` / `{}` each render would defeat every memo below —
   * the same trap the exercise library hit, re-deriving 57 rows per keystroke.
   */
  const exercises = useMemo(() => data?.exercises ?? [], [data])
  const history = useMemo(() => data?.history ?? {}, [data])
  // Falls back to the current gym until one is chosen — history is gym-scoped, so
  // there is no such thing as a plan without one (§3.2).
  const effectiveGym = gymId ?? gyms.find((g) => g.is_current)?.id ?? gyms[0]?.id ?? null

  const byId = useMemo(() => new Map(exercises.map((e) => [e.id, e])), [exercises])

  const useTemplate = useCallback(
    (id: string) => {
      const t = data?.templates.find((x) => x.id === id)
      if (!t) return
      setTemplateId(id)
      setName(t.name)
      setItems(
        t.items
          .map((row) => {
            const exercise = byId.get(row.exercise_id)
            if (!exercise) return null
            return {
              exercise,
              // A template value is a default, never a constraint (US-2.2).
              target_sets: row.target_sets ?? 3,
              rep_low: row.target_rep_low,
              rep_high: row.target_rep_high,
              progression_rule: row.progression_rule,
            }
          })
          .filter((x): x is PlanItem => x !== null),
      )
      setNotice(null)
      setDraft(null)
    },
    [data?.templates, byId],
  )

  const startEmpty = useCallback(() => {
    setTemplateId(null)
    setName('')
    setItems([])
    setNotice(null)
    setDraft(null)
  }, [])

  /**
   * Asks the server for a draft, then loads it exactly as `useTemplate` does.
   *
   * `append` keeps what is already there — the plan you hand-built plus the machines
   * the model suggested. `replace` is the default because a re-BUILD usually means
   * "not that, try again" (§6). Gym and date survive either way.
   */
  const runBuild = useCallback(
    async (mode: 'replace' | 'append') => {
      setIsBuilding(true)
      setNotice(null)
      try {
        const res = await fetch('/api/ai/plan-workout', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ prompt: prompt.trim(), gym_id: effectiveGym }),
        })
        const json = (await res.json()) as AiPlanResponse & { error?: string }
        if (!res.ok) throw new Error(json.error ?? 'The plan builder is unavailable.')

        const built = json.items.flatMap((it) => {
          const exercise = byId.get(it.exercise_id)
          // Belt and braces: the route already drops unknown ids, and a payload that
          // still had one must not put `undefined` in the list.
          if (!exercise) return []
          return [
            {
              exercise,
              target_sets: it.target_sets,
              rep_low: it.rep_low,
              rep_high: it.rep_high,
              progression_rule: it.why,
            },
          ]
        })

        setItems((prev) =>
          mode === 'append'
            ? [...prev, ...built.filter((b) => !prev.some((p) => p.exercise.id === b.exercise.id))]
            : built,
        )
        // The model names the session, but only when there is nothing to overwrite.
        setName((prev) => (mode === 'replace' || prev.trim() === '' ? json.title : prev))
        setTemplateId(null)
        setDraft({
          title: json.title,
          rationale: json.rationale,
          notice: json.notice,
          degraded: json.degraded,
        })
      } catch (err) {
        // Visible and recoverable. Template and Empty are untouched (AC-2.20).
        setNotice(err instanceof Error ? err.message : 'The plan builder is unavailable.')
      } finally {
        setIsBuilding(false)
        setAskRebuild(false)
      }
    },
    [prompt, effectiveGym, byId],
  )

  // A prompt worth sending, and a library to resolve its answer against.
  const canBuild = prompt.trim().length >= 2 && byId.size > 0

  const build = useCallback(async () => {
    if (!canBuild) return
    // Only ask when there is something to lose.
    if (items.length > 0) {
      setAskRebuild(true)
      return
    }
    await runBuild('replace')
  }, [canBuild, items.length, runBuild])

  const rows = useMemo<PlanRow[]>(
    () =>
      items.map((item) => {
        const h = history[item.exercise.id] ?? null
        return {
          item,
          last: describeLast(h, item.exercise.load_type),
          best: describeBest(h, item.exercise.load_type),
          target: suggestTarget(h, item.rep_low, item.rep_high, item.exercise.load_type),
        }
      }),
    [items, history],
  )

  const pickedIds = useMemo(() => new Set(items.map((i) => i.exercise.id)), [items])

  const start = useCallback(async (): Promise<string | null> => {
    if (items.length === 0 || effectiveGym === null) return null
    setIsStarting(true)
    try {
      // Client-generated id, so a replayed flush upserts rather than opening a
      // second session (PRD-001 §4.2).
      const sessionId = crypto.randomUUID()
      const res = await fetch('/api/data/plan', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          session_id: sessionId,
          name: name.trim() === '' ? 'Session' : name.trim(),
          performed_on: day,
          gym_id: effectiveGym,
          items: items.map((i) => ({
            exercise_id: i.exercise.id,
            target_sets: i.target_sets,
            rep_low: i.rep_low,
            rep_high: i.rep_high,
          })),
        }),
      })
      const json = (await res.json()) as { session?: { id: string }; error?: string }
      if (!res.ok) throw new Error(json.error ?? 'Could not start that session.')
      return json.session?.id ?? sessionId
    } catch (err) {
      setNotice(err instanceof Error ? err.message : 'Could not start that session.')
      return null
    } finally {
      setIsStarting(false)
    }
  }, [items, effectiveGym, name, day])

  return {
    isLoading,
    loadError: error !== null,
    retry: () => void refetch(),

    day,
    setDay,
    gymId: effectiveGym,
    setGymId: setGymIdState,
    gyms,
    gymName: gyms.find((g) => g.id === effectiveGym)?.name ?? '—',

    templates: data?.templates ?? [],
    templateId,
    useTemplate,
    startEmpty,

    name,
    setName,
    rows,
    summary: summarise(items),
    rules: checkRules(items, data?.criticalRules ?? []),

    move: (index, delta) => setItems((prev) => moveItem(prev, index, delta)),
    remove: (index) => setItems((prev) => removeItem(prev, index)),
    setSets: (index, sets) =>
      setItems((prev) => (sets && sets > 0 ? patchItem(prev, index, { target_sets: sets }) : prev)),
    setReps: (index, low, high) =>
      setItems((prev) => patchItem(prev, index, { rep_low: low, rep_high: high })),

    pickerOpen,
    openPicker: () => setPickerOpen(true),
    closePicker: () => setPickerOpen(false),
    exercises,
    pickedIds,
    togglePick: (e) =>
      setItems((prev) =>
        prev.some((i) => i.exercise.id === e.id)
          ? prev.filter((i) => i.exercise.id !== e.id)
          : addItem(prev, e),
      ),

    prompt,
    setPrompt,
    build,
    isBuilding,
    canBuild,
    draft,
    rebuild: askRebuild
      ? {
          replace: () => runBuild('replace'),
          append: () => runBuild('append'),
          cancel: () => setAskRebuild(false),
        }
      : null,

    canStart: canStart(items) && effectiveGym !== null,
    isStarting,
    notice,
    start,
  }
}
