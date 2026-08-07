/**
 * MUST stay identical to `food_name_norm()` in supabase/migrations/0004.
 * If they diverge, a food inserted by the app becomes unfindable by the app.
 */
export const normalizeFoodName = (name: string): string =>
  name.normalize('NFKC').trim().replace(/\s+/g, ' ').toLowerCase()
