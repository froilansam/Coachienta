import { describe, expect, it } from 'vitest'
import { ageOn, estimateEnergy, mifflinStJeor, tdee } from './energy'

describe('ageOn (AC-4.6)', () => {
  it('counts whole years', () => {
    expect(ageOn('1999-03-14', '2026-08-06')).toBe(27)
  })
  it('does not count a birthday that has not happened yet', () => {
    expect(ageOn('1999-12-14', '2026-08-06')).toBe(26)
  })
  it('counts the birthday itself', () => {
    expect(ageOn('1999-08-06', '2026-08-06')).toBe(27)
    expect(ageOn('1999-08-07', '2026-08-06')).toBe(26)
  })
})

describe('mifflinStJeor', () => {
  it('matches the figure PRD-006 states for the real profile', () => {
    // 70 kg / 179 cm / 27 / male → ≈1,689.
    expect(mifflinStJeor(70, 179, 27, 'male')).toBe(1689)
  })

  it('moves with weight, which is the whole point', () => {
    /**
     * The spreadsheet stored 1,619 computed at 64 kg and never revisited it —
     * ~70 kcal low, propagating into every TDEE and target.
     */
    expect(mifflinStJeor(64, 179, 27, 'male')).toBe(1629)
    expect(mifflinStJeor(70, 179, 27, 'male') - mifflinStJeor(64, 179, 27, 'male')).toBe(60)
  })

  it('applies the female constant', () => {
    expect(mifflinStJeor(70, 179, 27, 'female')).toBe(1523)
  })
})

describe('tdee', () => {
  it('scales by activity', () => {
    expect(tdee(1689, 'sedentary')).toBe(2027)
    expect(tdee(1689, 'light')).toBe(2322)
    expect(tdee(1689, 'moderate')).toBe(2618)
  })
})

describe('estimateEnergy', () => {
  const base = { weightKg: 70, heightCm: 179, birthDate: '1999-03-14', sex: 'male' as const, today: '2026-08-06' }

  it('computes when every input is present', () => {
    const e = estimateEnergy({ ...base, scaleBmr: 1605 })
    expect(e).toMatchObject({ ok: true, bmr: 1689, age: 27, scaleBmr: 1605 })
  })

  it('blocks on a missing birth date rather than guessing an age', () => {
    /**
     * A BMR from a guessed age is a plausible number nobody can check, and it
     * would feed straight into calorie targets — the spreadsheet's exact failure.
     */
    const e = estimateEnergy({ ...base, birthDate: null })
    expect(e.ok).toBe(false)
    if (!e.ok) expect(e.blocked).toContain('date of birth')
  })

  it('blocks on a missing weight, height or sex, and says which', () => {
    expect(estimateEnergy({ ...base, weightKg: null })).toMatchObject({ ok: false })
    const noHeight = estimateEnergy({ ...base, heightCm: null })
    expect(noHeight.ok).toBe(false)
    if (!noHeight.ok) expect(noHeight.blocked).toContain('height')
  })
})
