'use client'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useCallback, useState } from 'react'
import type { GoalsResponse } from '@/app/api/data/goals/route'
import type { ProfilePayload } from '@/app/api/data/profile/route'
import { isBlocked, runChecks, type Finding, type Targets } from '@/lib/domain/coach/consistency'
import type { Measurement } from '@/lib/domain/body'
import { todayLocal } from '@/lib/domain/date'
import type { Rule } from '@/lib/domain/coach/prompt'
import {
  add as addPriority,
  isChanged as prioritiesChanged,
  move as movePriority,
  remove as removePriority,
  remaining as remainingGroups,
  setNote as setPriorityNote,
  validate as validatePriorities,
  type MuscleGroup,
  type PriorityItem,
} from '@/lib/domain/coach/priorities'

/**
 * Editing goals: targets, phase, coach rules — plus the prompt preview.
 *
 * The consistency checks run **live** against the draft, not on submit. A calorie
 * floor you discover after pressing save is a worse experience than one that
 * greys the button out while you type, and the same pure function decides both
 * (`lib/domain/coach/consistency.ts`), so the UI and the server can never
 * disagree about what is allowed.
 */
export type Editor = 'targets' | 'phase' | 'rule' | 'prompt' | 'priorities' | null

export interface TargetsDraft extends Targets {
  effective_from: string
  phase_label: string
  rationale: string
}

export interface PhaseDraft {
  effective_from: string
  label: string
  goal_kind: 'cut' | 'lean_bulk' | 'maintenance' | 'recomp' | 'peak'
  target_weight_kg: number | null
  target_rate_kg_per_week: number | null
  bf_ceiling_pct: number | null
  notes: string
}

export interface RuleDraft extends Rule {
  /** Set when replacing an existing rule; null when adding a new one. */
  supersedes: string | null
}

export interface GoalsView {
  editor: Editor
  close: () => void
  isSaving: boolean
  error: string | null

  // -- targets --------------------------------------------------------------
  targetsDraft: TargetsDraft | null
  openTargets: () => void
  setTargets: (patch: Partial<TargetsDraft>) => void
  /** Live findings for the draft. A `block` here means SAVE is disabled. */
  targetFindings: Finding[]
  canSaveTargets: boolean

  // -- phase ----------------------------------------------------------------
  phaseDraft: PhaseDraft | null
  openPhase: () => void
  setPhase: (patch: Partial<PhaseDraft>) => void
  canSavePhase: boolean

  // -- rules ----------------------------------------------------------------
  ruleDraft: RuleDraft | null
  openNewRule: () => void
  openEditRule: (rule: Rule & { id: string }) => void
  setRule: (patch: Partial<RuleDraft>) => void
  canSaveRule: boolean
  retireRule: (id: string) => Promise<void>
  activeRules: Array<Rule & { id: string }>
  retiredRules: Array<Rule & { id: string }>

  // -- priority order -------------------------------------------------------
  priorityDraft: PriorityItem[] | null
  openPriorities: () => void
  movePriority: (index: number, delta: number) => void
  addPriority: (group: string) => void
  removePriority: (index: number) => void
  setPriorityNote: (index: number, note: string) => void
  /** Groups not yet in the list. */
  availableGroups: MuscleGroup[]
  priorityError: string | null
  canSavePriorities: boolean

  // -- prompt ---------------------------------------------------------------
  openPrompt: () => void
  prompt: string
  promptTokens: number

  /**
   * Findings for what is currently STORED that have no inline home.
   *
   * PRD-006 §4 puts warnings "inline at the offending value rather than collected
   * in a banner", and `CurrentStrip` already renders the body-fat ceiling and the
   * weight-trend drift next to the numbers they concern. Repeating them in a panel
   * said the same sentence twice on one screen.
   */
  storedFindings: Finding[]

  save: () => Promise<void>
}

export function useGoals(profile: {
  targets: ProfilePayload['targets']
  phase: ProfilePayload['phase']
  measurements: Measurement[]
  priorities: ProfilePayload['priorities']
}): GoalsView {
  const qc = useQueryClient()
  const [editor, setEditor] = useState<Editor>(null)
  const [targetsDraft, setTargetsDraft] = useState<TargetsDraft | null>(null)
  const [phaseDraft, setPhaseDraft] = useState<PhaseDraft | null>(null)
  const [ruleDraft, setRuleDraft] = useState<RuleDraft | null>(null)
  const [priorityDraft, setPriorityDraft] = useState<PriorityItem[] | null>(null)
  const [isSaving, setIsSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const { data } = useQuery<GoalsResponse>({
    queryKey: ['goals'],
    queryFn: async () => {
      const res = await fetch('/api/data/goals')
      if (!res.ok) throw new Error('goals')
      return res.json() as Promise<GoalsResponse>
    },
  })

  const close = useCallback(() => {
    setEditor(null)
    setTargetsDraft(null)
    setPhaseDraft(null)
    setRuleDraft(null)
    setPriorityDraft(null)
    setError(null)
  }, [])

  const openPriorities = useCallback(() => {
    setPriorityDraft(profile.priorities.map((p) => ({ muscle_group: p.muscle_group, note: p.note })))
    setEditor('priorities')
    setError(null)
  }, [profile.priorities])

  /**
   * A new target row starts as a copy of the active one, dated tomorrow.
   *
   * Tomorrow, not today: superseding closes the old row the day before the new one
   * opens, and a same-day supersede would leave today with no target at all. The
   * RPC refuses it, so the form should not offer it.
   */
  const openTargets = useCallback(() => {
    const t = profile.targets
    setTargetsDraft({
      effective_from: tomorrow(),
      phase_label: t?.phase_label ?? profile.phase?.label ?? '',
      kcal_gym_low: t?.kcal_gym_low ?? null,
      kcal_gym_high: t?.kcal_gym_high ?? null,
      kcal_rest_low: t?.kcal_rest_low ?? null,
      kcal_rest_high: t?.kcal_rest_high ?? null,
      protein_g: t?.protein_g ?? 160,
      carbs_gym_low: t?.carbs_gym_low ?? null,
      carbs_gym_high: t?.carbs_gym_high ?? null,
      carbs_rest_low: t?.carbs_rest_low ?? null,
      carbs_rest_high: t?.carbs_rest_high ?? null,
      fat_low: t?.fat_low ?? null,
      fat_high: t?.fat_high ?? null,
      kcal_floor: t?.kcal_floor ?? null,
      rationale: '',
    })
    setEditor('targets')
    setError(null)
  }, [profile.targets, profile.phase])

  const openPhase = useCallback(() => {
    const p = profile.phase
    setPhaseDraft({
      effective_from: tomorrow(),
      label: p?.label ?? '',
      goal_kind: (p?.goal_kind as PhaseDraft['goal_kind']) ?? 'maintenance',
      target_weight_kg: p?.target_weight_kg ?? null,
      target_rate_kg_per_week: p?.target_rate_kg_per_week ?? null,
      bf_ceiling_pct: p?.bf_ceiling_pct ?? null,
      notes: p?.notes ?? '',
    })
    setEditor('phase')
    setError(null)
  }, [profile.phase])

  const openNewRule = useCallback(() => {
    setRuleDraft({
      category: 'training',
      title: '',
      content: '',
      priority: 100,
      is_critical: false,
      supersedes: null,
    })
    setEditor('rule')
    setError(null)
  }, [])

  const openEditRule = useCallback((rule: Rule & { id: string }) => {
    // Editing a rule creates its replacement — the original stays in history.
    setRuleDraft({ ...rule, supersedes: rule.id })
    setEditor('rule')
    setError(null)
  }, [])

  const targetFindings =
    targetsDraft === null
      ? []
      : runChecks({
          targets: targetsDraft,
          phase: profile.phase,
          measurements: profile.measurements,
          today: todayLocal(),
        })

  const post = useCallback(
    async (body: unknown) => {
      setIsSaving(true)
      setError(null)
      try {
        const res = await fetch('/api/data/goals', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        })
        const json = (await res.json()) as { error?: string }
        if (!res.ok) throw new Error(json.error ?? 'That edit was refused.')
        await Promise.all([
          qc.invalidateQueries({ queryKey: ['goals'] }),
          qc.invalidateQueries({ queryKey: ['profile'] }),
          // Targets are date-scoped, so Today's grading changes with them.
          qc.invalidateQueries({ queryKey: ['day'] }),
        ])
        close()
      } catch (err) {
        setError(err instanceof Error ? err.message : 'That edit was refused.')
      } finally {
        setIsSaving(false)
      }
    },
    [qc, close],
  )

  const save = useCallback(async () => {
    if (editor === 'targets' && targetsDraft) {
      const { rationale, ...rest } = targetsDraft
      await post({ action: 'targets', ...rest, rationale: rationale.trim() || null })
    } else if (editor === 'phase' && phaseDraft) {
      const { notes, ...rest } = phaseDraft
      await post({ action: 'phase', ...rest, notes: notes.trim() || null })
    } else if (editor === 'priorities' && priorityDraft) {
      await post({ action: 'priorities', items: priorityDraft })
    } else if (editor === 'rule' && ruleDraft) {
      const { supersedes, ...rule } = ruleDraft
      await post(
        supersedes
          ? { action: 'rule_supersede', id: supersedes, ...rule }
          : { action: 'rule_add', ...rule },
      )
    }
  }, [editor, targetsDraft, phaseDraft, ruleDraft, priorityDraft, post])

  return {
    editor,
    close,
    isSaving,
    error,

    targetsDraft,
    openTargets,
    setTargets: (patch) => setTargetsDraft((d) => (d ? { ...d, ...patch } : d)),
    targetFindings,
    canSaveTargets:
      targetsDraft !== null &&
      targetsDraft.phase_label.trim() !== '' &&
      targetsDraft.protein_g > 0 &&
      !isBlocked(targetFindings),

    phaseDraft,
    openPhase,
    setPhase: (patch) => setPhaseDraft((d) => (d ? { ...d, ...patch } : d)),
    canSavePhase: phaseDraft !== null && phaseDraft.label.trim() !== '',

    ruleDraft,
    openNewRule,
    openEditRule,
    setRule: (patch) => setRuleDraft((d) => (d ? { ...d, ...patch } : d)),
    canSaveRule:
      ruleDraft !== null && ruleDraft.title.trim() !== '' && ruleDraft.content.trim() !== '',
    retireRule: (id: string) => post({ action: 'rule_retire', id }),
    activeRules: data?.activeRules ?? [],
    retiredRules: data?.retiredRules ?? [],

    priorityDraft,
    openPriorities,
    movePriority: (index, delta) => setPriorityDraft((d) => (d ? movePriority(d, index, delta) : d)),
    addPriority: (group) => setPriorityDraft((d) => (d ? addPriority(d, group) : d)),
    removePriority: (index) => setPriorityDraft((d) => (d ? removePriority(d, index) : d)),
    setPriorityNote: (index, note) =>
      setPriorityDraft((d) => (d ? setPriorityNote(d, index, note) : d)),
    availableGroups: priorityDraft ? remainingGroups(priorityDraft) : [],
    priorityError: priorityDraft ? validatePriorities(priorityDraft) : null,
    // Nothing to save until something actually moved.
    canSavePriorities:
      priorityDraft !== null &&
      validatePriorities(priorityDraft) === null &&
      prioritiesChanged(
        priorityDraft,
        profile.priorities.map((p) => ({ muscle_group: p.muscle_group, note: p.note })),
      ),

    openPrompt: () => {
      setEditor('prompt')
      setError(null)
    },
    prompt: data?.prompt ?? '',
    promptTokens: data?.promptTokens ?? 0,

    storedFindings: (data?.findings ?? []).filter((f) => !INLINE_ON_CURRENT.has(f.id)),

    save,
  }
}

/** Rendered beside the value in `CurrentStrip`, so the panel must not repeat them. */
const INLINE_ON_CURRENT = new Set<Finding['id']>(['bf_over_ceiling', 'weight_off_target_rate'])

/** Superseding closes the old row the day before, so a new row starts tomorrow. */
function tomorrow(): string {
  const d = new Date()
  d.setDate(d.getDate() + 1)
  return todayLocal(d)
}
