import { z } from 'zod'
import { MacroRate, Confidence, ResolutionSource } from '@/lib/schemas/domain'

/** What every nutrition source returns. Sources differ; this shape does not. */
export const FoodCandidate = z.object({
  name: z.string().min(1),
  brand: z.string().nullable().default(null),
  rate: MacroRate,
  confidence: Confidence,
  source: ResolutionSource,
  /** Provenance the user can check. USDA fdcId, OFF barcode+url, or model id. */
  citation: z.object({
    ref: z.string(),
    url: z.url().nullable().default(null),
    detail: z.string().nullable().default(null),
  }),
})
export type FoodCandidate = z.infer<typeof FoodCandidate>

export interface NutritionSource {
  readonly name: string
  search(query: string, limit?: number): Promise<FoodCandidate[]>
}
