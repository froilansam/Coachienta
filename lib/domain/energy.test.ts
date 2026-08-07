import { describe, expect, it } from 'vitest'
import { ageFrom, mifflinStJeor } from './energy'

describe('mifflinStJeor', () => {
  it('matches the audit figure at the current weight', () => {
    // 70 kg / 179 cm / 27 / male → 700 + 1118.75 - 135 + 5 = 1688.75
    expect(mifflinStJeor(70, 179, 27, 'male')).toBe(1689)
  })

  it('reproduces the spreadsheet stale value at the OLD weight', () => {
    // The Coach Agent tab stored 1,619 kcal, derived at 64 kg. Every calorie
    // target downstream inherited that error (PRD-006 §1).
    expect(mifflinStJeor(64, 179, 27, 'male')).toBe(1629)
  })

  it('applies the female constant', () => {
    expect(mifflinStJeor(70, 179, 27, 'female')).toBe(1523)
  })
})

describe('ageFrom', () => {
  it('does not count a birthday that has not happened yet', () => {
    expect(ageFrom('1999-12-25', new Date('2026-08-06'))).toBe(26)
  })

  it('counts a birthday that has passed', () => {
    expect(ageFrom('1999-03-14', new Date('2026-08-06'))).toBe(27)
  })

  it('counts the birthday itself', () => {
    expect(ageFrom('1999-08-06', new Date('2026-08-06'))).toBe(27)
  })
})
