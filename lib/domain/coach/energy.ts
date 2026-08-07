/**
 * Energy expenditure, computed on read and never stored (US-4.6, AC-4.5).
 *
 * The spreadsheet stored a BMR of 1,619 that had been computed at 64 kg and never
 * revisited — about 70 kcal low at 70 kg, and that error propagated into every
 * TDEE and every calorie target downstream. It even had a rule requiring
 * recalculation on weight change (Instructions & Goals r52). The rule existed and
 * was never executed, which is the whole argument for computing rather than
 * instructing.
 */

export type Sex = 'male' | 'female'

/**
 * Whole years, from a date of birth. There is deliberately no stored age column
 * (AC-4.6) — an integer age is wrong for up to a year and nobody remembers to
 * update it.
 */
export function ageOn(birthDate: string, on: string): number {
  const [by = 0, bm = 1, bd = 1] = birthDate.split('-').map(Number)
  const [y = 0, m = 1, d = 1] = on.split('-').map(Number)
  const hadBirthday = m > bm || (m === bm && d >= bd)
  return y - by - (hadBirthday ? 0 : 1)
}

/**
 * Mifflin-St Jeor. The usual clinical default, and the one the spreadsheet's own
 * figure was derived from, so the comparison is like-for-like.
 */
export function mifflinStJeor(
  weightKg: number,
  heightCm: number,
  age: number,
  sex: Sex,
): number {
  const base = 10 * weightKg + 6.25 * heightCm - 5 * age
  return Math.round(sex === 'male' ? base + 5 : base - 161)
}

/**
 * Activity multipliers. Coarse on purpose — the honest resolution of a
 * self-reported activity level is not two decimal places.
 */
export const ACTIVITY = {
  sedentary: 1.2,
  light: 1.375,
  moderate: 1.55,
  active: 1.725,
} as const
export type ActivityLevel = keyof typeof ACTIVITY

export const tdee = (bmr: number, activity: ActivityLevel): number =>
  Math.round(bmr * ACTIVITY[activity])

/**
 * What the profile screen can say about resting energy.
 *
 * Returns a `blocked` reason instead of a number when an input is missing. A BMR
 * computed from a guessed age is a plausible number nobody can check, and it would
 * feed straight into targets — the exact failure the spreadsheet already made.
 */
export type EnergyEstimate =
  | { ok: true; bmr: number; tdee: number; age: number; scaleBmr: number | null }
  | { ok: false; blocked: string }

export function estimateEnergy(input: {
  weightKg: number | null
  heightCm: number | null
  birthDate: string | null
  sex: Sex | null
  today: string
  activity?: ActivityLevel
  /** The scale's own figure, shown beside ours — different method, neither authoritative. */
  scaleBmr?: number | null
}): EnergyEstimate {
  const { weightKg, heightCm, birthDate, sex, today } = input
  if (birthDate === null) {
    return { ok: false, blocked: 'Add your date of birth to compute BMR — age is part of the formula.' }
  }
  if (weightKg === null) {
    return { ok: false, blocked: 'Log a weigh-in to compute BMR.' }
  }
  if (heightCm === null || sex === null) {
    return { ok: false, blocked: 'Set your height and sex to compute BMR.' }
  }

  const age = ageOn(birthDate, today)
  const bmr = mifflinStJeor(weightKg, heightCm, age, sex)
  return {
    ok: true,
    bmr,
    tdee: tdee(bmr, input.activity ?? 'light'),
    age,
    scaleBmr: input.scaleBmr ?? null,
  }
}
