import { z } from 'zod'
import { Confidence, ResolutionSource, UnitBasis } from './domain'

/**
 * The client/server contract for food resolution.
 *
 * Lives here rather than in `lib/db/queries/foods.ts` because that module is
 * `server-only` — a client component importing from it is a build error.
 */

/** Provenance the user can check: a USDA fdcId, an OFF barcode, a label read. */
export const Citation = z.object({
  ref: z.string(),
  url: z.url().nullable().catch(null),
  detail: z.string().nullable().catch(null),
})
export type Citation = z.infer<typeof Citation>

export const FoodRow = z.object({
  id: z.uuid(),
  name: z.string(),
  brand: z.string().nullable(),
  basis_unit: UnitBasis,
  basis_amount: z.coerce.number(),
  kcal: z.coerce.number(),
  protein_g: z.coerce.number(),
  carbs_g: z.coerce.number(),
  fat_g: z.coerce.number(),
  fiber_g: z.coerce.number().nullable(),
  confidence: Confidence,
  source: ResolutionSource,
  version: z.number().int(),
  times_logged: z.number().int(),
  usual_amount: z.coerce.number().nullable(),
  match_kind: z.string().nullish(),
  score: z.coerce.number().nullish(),
  /** Real reference count, from `library_foods` only. Gates deletion. */
  entry_count: z.coerce.number().nullish(),
  /** Where the numbers came from. Empty for a hand-typed row (AC-1.3). */
  citations: z.array(Citation).nullish(),
})
export type FoodRow = z.infer<typeof FoodRow>

export const ResolveStage = z.enum(['library', 'external', 'ai', 'none'])
export type ResolveStage = z.infer<typeof ResolveStage>

export const ResolveResponse = z.object({
  parsed: z.object({
    amount: z.number().nullable(),
    unit: UnitBasis.nullable(),
    query: z.string(),
  }),
  stage: ResolveStage,
  results: z.array(FoodRow),
  /** Present when the input held several foods — the client resolves each. */
  segments: z.array(z.string()).optional(),
  rejected: z.string().optional(),
  degraded: z.boolean().optional(),
  notice: z.string().optional(),
})
export type ResolveResponse = z.infer<typeof ResolveResponse>
