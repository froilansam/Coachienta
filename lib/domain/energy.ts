/** Mifflin-St Jeor. Computed on read from the latest weigh-in, never stored (PRD-006 §3.6). */
export function mifflinStJeor(
  weightKg: number,
  heightCm: number,
  ageYears: number,
  sex: 'male' | 'female',
): number {
  const base = 10 * weightKg + 6.25 * heightCm - 5 * ageYears
  return Math.round(sex === 'male' ? base + 5 : base - 161)
}

export const ageFrom = (birthDate: string, today = new Date()): number => {
  const b = new Date(birthDate)
  let age = today.getFullYear() - b.getFullYear()
  const m = today.getMonth() - b.getMonth()
  if (m < 0 || (m === 0 && today.getDate() < b.getDate())) age--
  return age
}
