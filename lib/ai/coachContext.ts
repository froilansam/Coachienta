import 'server-only'
import { getVolumeShare, getActiveRules, getRetiredRules } from '@/lib/db/queries/goals'
import { getProfile, type ProfilePayload } from '@/lib/db/queries/profile'
import { latestOf } from '@/lib/domain/body'
import { runChecks, type Finding } from '@/lib/domain/coach/consistency'
import { buildCoachPrompt, estimateTokens, type Rule } from '@/lib/domain/coach/prompt'
import { todayLocal } from '@/lib/domain/date'

/**
 * Gathers everything the coach is entitled to know, and builds its prompt once.
 *
 * This exists so there is exactly one path from stored rows to a prompt string
 * (AC-4.12). `/profile` previews it, `/api/ai/plan-workout` prefixes it, and P4's
 * chat route will send it — three callers, one assembly. A second gathering step
 * would drift, and an unverifiable prompt is how the spreadsheet's "Coach Agent" tab
 * came to describe behaviour the agent never had.
 *
 * Every fact here is a stored row. Nothing is inferred — which is what makes the
 * coach's answers checkable against the app.
 */
export interface CoachContext {
  activeRules: Array<Rule & { id: string }>
  retiredRules: Array<Rule & { id: string }>
  /** Byte-for-byte what a model will be sent. */
  prompt: string
  promptTokens: number
  findings: Finding[]
  profile: ProfilePayload
}

export async function coachContext(): Promise<CoachContext> {
  const [profile, activeRules, retiredRules, volumeShare] = await Promise.all([
    getProfile(),
    getActiveRules(),
    getRetiredRules(),
    getVolumeShare(30),
  ])

  const weight = latestOf(profile.measurements, 'weight_kg')
  const t = profile.targets
  const prompt = buildCoachPrompt(activeRules, {
    displayName: profile.profile?.display_name ?? null,
    phaseLabel: profile.phase?.label ?? null,
    weightKg: weight?.value ?? null,
    weightOn: weight?.on ?? null,
    targetSummary: t
      ? `${t.kcal_gym_low}–${t.kcal_gym_high} kcal, ${t.protein_g} g protein`
      : null,
    priorities: profile.priorities.map((p) => p.muscle_group.replace(/_/g, ' ')),
    medicalNotes: profile.profile?.medical_notes ?? null,
    today: todayLocal(),
  })

  return {
    activeRules,
    retiredRules,
    prompt,
    promptTokens: estimateTokens(prompt),
    findings: runChecks({
      targets: profile.targets,
      phase: profile.phase,
      measurements: profile.measurements,
      today: todayLocal(),
      volumeShare,
    }),
    profile,
  }
}
