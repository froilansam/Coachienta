'use client'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useCallback, useState } from 'react'
import type { ProfilePayload } from '@/app/api/data/profile/route'
import {
  chronological,
  daysSinceWeighIn,
  latestOf,
  seriesOf,
  trendOf,
  withinDays,
  type Latest,
  type Measurement,
  type Series,
  type Trend,
} from '@/lib/domain/body'
import { estimateEnergy, type EnergyEstimate } from '@/lib/domain/coach/energy'
import { todayLocal } from '@/lib/domain/date'

/**
 * The profile screen, whole. Every number below is derived here or in
 * `lib/domain/body.ts` — the components take finished values.
 */
export const RANGES = [30, 90, 365] as const
export type RangeDays = (typeof RANGES)[number]

/** One row of CURRENT: the value, its own date, and any warning about it. */
export interface CurrentMetric {
  label: string
  latest: Latest | null
  unit: string
  decimals: number
  trend: Trend | null
  /** Inline at the offending value, not collected in a banner (PRD-006 §4). */
  warning: string | null
}

export interface WeighInDraft {
  measured_on: string
  weight_kg: number | null
  waist_cm: number | null
  body_fat_pct: number | null
  notes: string
}

export interface ProfileView {
  isLoading: boolean
  loadError: boolean
  retry: () => void

  displayName: string | null
  heightCm: number | null
  birthDate: string | null
  timezone: string | null
  medicalNotes: string | null

  current: CurrentMetric[]
  energy: EnergyEstimate
  /** Set when the newest weigh-in is old enough to make advice unreliable. */
  staleWeighIn: string | null

  range: RangeDays
  setRange: (d: RangeDays) => void
  charts: Array<{ label: string; unit: string; decimals: number; series: Series | null; trend: Trend | null }>

  phase: ProfilePayload['phase']
  targets: ProfilePayload['targets']
  priorities: ProfilePayload['priorities']
  /** Raw readings, for the goal editors' live consistency checks. */
  measurements: Measurement[]
  /** Active rules grouped by category, criticals first. */
  ruleGroups: Array<{ category: string; rules: ProfilePayload['rules'] }>
  activeRuleCount: number
  retiredRuleCount: number

  weighIn: WeighInDraft | null
  openWeighIn: () => void
  closeWeighIn: () => void
  setWeighIn: (patch: Partial<WeighInDraft>) => void
  canSaveWeighIn: boolean
  saveWeighIn: () => Promise<void>
  isSaving: boolean
  notice: string | null
}

const FIELDS = [
  { key: 'weight_kg', label: 'Weight', unit: 'kg', decimals: 1 },
  { key: 'waist_cm', label: 'Waist', unit: 'cm', decimals: 1 },
  { key: 'body_fat_pct', label: 'Body fat', unit: '%', decimals: 1 },
] as const

export function useProfile(): ProfileView {
  const qc = useQueryClient()
  const [range, setRange] = useState<RangeDays>(30)
  const [weighIn, setWeighInState] = useState<WeighInDraft | null>(null)
  const [isSaving, setIsSaving] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)
  const today = todayLocal()

  const { data, isLoading, error, refetch } = useQuery<ProfilePayload>({
    queryKey: ['profile'],
    queryFn: async () => {
      const res = await fetch('/api/data/profile')
      if (!res.ok) throw new Error('profile')
      return res.json() as Promise<ProfilePayload>
    },
  })

  const measurements = data?.measurements ?? []
  const profile = data?.profile ?? null

  const weightLatest = latestOf(measurements, 'weight_kg')
  const scaleBmr = latestOf(measurements, 'bmr_kcal')
  const bfCeiling = data?.phase?.bf_ceiling_pct ?? null
  const targetRate = data?.phase?.target_rate_kg_per_week ?? null

  /**
   * Warnings sit on the value they concern. A body-fat reading over the phase
   * ceiling is a breached stop-condition — the spreadsheet had it sitting in a
   * contradicting tab where nobody saw it (PRD-006 §3.4).
   */
  const current: CurrentMetric[] = FIELDS.map((f) => {
    const latest = latestOf(measurements, f.key)
    const trend = trendOf(measurements, f.key)
    let warning: string | null = null

    if (f.key === 'body_fat_pct' && latest && bfCeiling !== null && latest.value > bfCeiling) {
      warning = `over your ${bfCeiling}% ceiling for this phase`
    }
    if (f.key === 'weight_kg' && trend?.perWeek !== null && trend !== null && targetRate !== null) {
      const drift = Math.abs(trend.perWeek - targetRate)
      if (drift > 0.1) {
        warning = `trending ${trend.perWeek > 0 ? '+' : ''}${trend.perWeek} kg/wk against a ${targetRate} kg/wk target`
      }
    }
    return { label: f.label, latest, unit: f.unit, decimals: f.decimals, trend, warning }
  })

  const energy = estimateEnergy({
    weightKg: weightLatest?.value ?? null,
    heightCm: profile?.height_cm ?? null,
    birthDate: profile?.birth_date ?? null,
    sex: profile?.sex ?? null,
    today,
    scaleBmr: scaleBmr?.value ?? null,
  })

  const stale = daysSinceWeighIn(measurements, today)
  const inRange = withinDays(measurements, range)

  const rules = data?.rules ?? []
  const ruleGroups = Array.from(new Set(rules.map((r) => r.category))).map((category) => ({
    category,
    rules: rules.filter((r) => r.category === category),
  }))
  // Criticals first, then by rule priority — the same precedence the prompt uses.
  ruleGroups.sort((a, b) => {
    const crit = (g: typeof a) => (g.rules.some((r) => r.is_critical) ? 0 : 1)
    return crit(a) - crit(b) || a.category.localeCompare(b.category)
  })

  const openWeighIn = useCallback(() => {
    setWeighInState({
      measured_on: todayLocal(),
      weight_kg: null,
      waist_cm: null,
      body_fat_pct: null,
      notes: '',
    })
    setNotice(null)
  }, [])

  const setWeighIn = useCallback((patch: Partial<WeighInDraft>) => {
    setWeighInState((w) => (w ? { ...w, ...patch } : w))
  }, [])

  const save = useCallback(async () => {
    if (!weighIn || weighIn.weight_kg === null) return
    setIsSaving(true)
    try {
      const res = await fetch('/api/data/profile', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          measured_on: weighIn.measured_on,
          weight_kg: weighIn.weight_kg,
          waist_cm: weighIn.waist_cm,
          body_fat_pct: weighIn.body_fat_pct,
          notes: weighIn.notes.trim() === '' ? null : weighIn.notes.trim(),
        }),
      })
      if (!res.ok) throw new Error('save')
      await qc.invalidateQueries({ queryKey: ['profile'] })
      setWeighInState(null)
      // BMR and TDEE move with no other action (AC-4.5) — worth saying, because
      // the spreadsheet's stored BMR never did.
      setNotice('Saved. Your BMR and trends have moved with it.')
    } catch {
      setNotice('Could not save that weigh-in.')
    } finally {
      setIsSaving(false)
    }
  }, [weighIn, qc])

  return {
    isLoading,
    loadError: error !== null,
    retry: () => void refetch(),

    displayName: profile?.display_name ?? null,
    heightCm: profile?.height_cm ?? null,
    birthDate: profile?.birth_date ?? null,
    timezone: profile?.timezone ?? null,
    medicalNotes: profile?.medical_notes ?? null,

    current,
    energy,
    staleWeighIn:
      stale !== null && stale > 14
        ? `Last weigh-in was ${stale} days ago. Coach advice depends on current weight.`
        : null,

    range,
    setRange,
    charts: FIELDS.map((f) => ({
      label: f.label,
      unit: f.unit,
      decimals: f.decimals,
      series: seriesOf(inRange, f.key),
      trend: trendOf(inRange, f.key),
    })),

    phase: data?.phase ?? null,
    targets: data?.targets ?? null,
    priorities: data?.priorities ?? [],
    measurements,
    ruleGroups,
    activeRuleCount: rules.length,
    retiredRuleCount: data?.retiredRuleCount ?? 0,

    weighIn,
    openWeighIn,
    closeWeighIn: () => setWeighInState(null),
    setWeighIn,
    canSaveWeighIn: weighIn !== null && weighIn.weight_kg !== null && weighIn.weight_kg > 0,
    saveWeighIn: save,
    isSaving,
    notice,
  }
}

/** Exposed for the chart component's x-axis labels. */
export { chronological }
