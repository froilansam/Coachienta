import { VOLUME_ELIGIBLE, type LoadType } from '@/lib/schemas/domain'

/**
 * Volume is weight × reps — but only where that product means something.
 * An assisted machine inverts it (less assist = stronger), and a plank has no
 * weight at all. Pooling those inflated Abs/Core past Chest in the spreadsheet
 * (PRD-004 §3.1).
 */
export const isVolumeEligible = (loadType: LoadType) => VOLUME_ELIGIBLE.includes(loadType)

export function computeVolume(
  loadType: LoadType,
  weightKg: number | null,
  reps: number | null,
): number | null {
  if (!isVolumeEligible(loadType)) return null
  if (weightKg === null || reps === null || weightKg <= 0) return null
  return Math.round(weightKg * reps * 100) / 100
}
