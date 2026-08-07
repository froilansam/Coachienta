import { describe, expect, it } from 'vitest'
import { computeVolume, isVolumeEligible } from './volume'

describe('computeVolume — the Abs/Core distortion fix', () => {
  it('computes weight × reps for external weight', () => {
    expect(computeVolume('external_weight', 10, 13)).toBe(130)
  })

  it('returns null for duration work — a plank has no weight to multiply', () => {
    // The spreadsheet pooled these and Abs/Core reached 43,368 kg, out-ranking
    // Chest (27,298) and Legs (23,548) in a program that deprioritises core.
    expect(computeVolume('duration', null, null)).toBeNull()
  })

  it('returns null for ASSISTED work — less assist means stronger', () => {
    // Multiplying here inverts the meaning: getting stronger would make the
    // number go down and the chart would show regression while you improved.
    expect(computeVolume('assisted', 20, 8)).toBeNull()
  })

  it('returns null for distance work', () => {
    expect(computeVolume('distance', null, null)).toBeNull()
  })

  it('returns null for unweighted bodyweight but counts added weight', () => {
    expect(computeVolume('bodyweight', 0, 8)).toBeNull()
    expect(computeVolume('bodyweight', 10, 8)).toBe(80)
  })

  it('returns null when either input is missing', () => {
    expect(computeVolume('external_weight', 10, null)).toBeNull()
    expect(computeVolume('external_weight', null, 13)).toBeNull()
  })

  it('rounds to 2dp rather than carrying float noise', () => {
    expect(computeVolume('external_weight', 12.5, 7)).toBe(87.5)
    expect(computeVolume('external_weight', 47.35, 3)).toBe(142.05)
  })

  it('eligibility matches the volume behaviour exactly', () => {
    expect(isVolumeEligible('external_weight')).toBe(true)
    expect(isVolumeEligible('bodyweight')).toBe(true)
    for (const t of ['assisted', 'duration', 'distance'] as const) {
      expect(isVolumeEligible(t)).toBe(false)
    }
  })
})
