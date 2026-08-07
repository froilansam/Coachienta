import 'server-only'
import { generateObject } from 'ai'
import { z } from 'zod'
import { MIN_OUTPUT_TOKENS } from './models'
import { recordUsage, routedModel } from './router'
import type { FoodCandidate } from '@/lib/nutrition/types'

/**
 * Step 8 — the LAST resort (PRD-003 §3).
 *
 * Reached only when neither USDA nor Open Food Facts has the item, i.e. prepared
 * and restaurant dishes that exist in no database. Confidence is capped at
 * `medium` no matter how sure the model claims to be.
 */
const Estimate = z.object({
  canonical_name: z.string().describe('Clean English name. Put the brand in `brand`, not here.'),
  brand: z.string().nullable(),
  basis_unit: z.enum(['g', 'ml', 'piece', 'serving']),
  basis_amount: z.number().positive().describe('Use 100 for g/ml. Use 1 for piece/serving.'),
  basis_description: z.string().nullable().describe('Required for piece/serving, e.g. "1 medium egg, 50g"'),
  kcal: z.number().min(0).max(900),
  protein_g: z.number().min(0).max(100),
  carbs_g: z.number().min(0).max(100),
  fat_g: z.number().min(0).max(100),
  fiber_g: z.number().min(0).max(100).nullable(),
  is_composite_dish: z.boolean().describe('True for mixed dishes whose macros vary by preparation'),
  reasoning: z.string().max(300).describe('Why these numbers, and what kind of source they came from.'),
})

const SYSTEM = `You estimate nutrition for prepared dishes that are not in USDA or Open Food Facts.

Rules:
- Return values PER BASIS, never per portion. For g/ml use a 100 basis.
- Be internally consistent: 4*protein + 4*carbs + 9*fat must be close to kcal.
- Japanese convenience-store and restaurant dishes are common; treat them as normal.
- If the input is not a food, still return the schema but set kcal 0 and say so in reasoning.
- Never invent a brand. Leave brand null unless it is explicit in the input.`

export interface ResolveFoodResult {
  candidate: FoodCandidate | null
  degraded: boolean
  error?: string
}

export async function resolveFoodWithAi(query: string): Promise<ResolveFoodResult> {
  try {
    const { model, route } = await routedModel('estimate')

    const { object, usage } = await generateObject({
      model,
      schema: Estimate,
      system: SYSTEM,
      prompt: `Estimate nutrition for: ${query}`,
      // 3.x Flash is a thinking model — ~800 output tokens of overhead measured.
      // Too low a cap returns an EMPTY response with no error (PRD-001 §2.2).
      maxOutputTokens: MIN_OUTPUT_TOKENS,
      temperature: 0.2,
    })

    void recordUsage(
      route.provider,
      route.id,
      usage.inputTokens ?? 0,
      usage.outputTokens ?? 0,
    ).catch(() => {
      /* accounting must never fail the request */
    })

    return {
      degraded: route.degraded,
      candidate: {
        name: object.canonical_name,
        brand: object.brand,
        rate: {
          basis_unit: object.basis_unit,
          basis_amount: object.basis_amount,
          kcal: object.kcal,
          protein_g: object.protein_g,
          carbs_g: object.carbs_g,
          fat_g: object.fat_g,
          fiber_g: object.fiber_g,
        },
        // Capped at medium regardless of the model's own certainty. A composite
        // dish genuinely varies by whoever cooked it.
        confidence: 'medium',
        source: 'ai_estimate',
        citation: {
          ref: `${route.provider}:${route.id}`,
          url: null,
          detail: object.basis_description
            ? `${object.reasoning} (${object.basis_description})`
            : object.reasoning,
        },
      },
    }
  } catch (err) {
    // Never throw at the caller — logging must survive an AI outage
    // (PRD-000 Principle 1, AC-1.12).
    return {
      candidate: null,
      degraded: true,
      error: err instanceof Error ? err.message : 'AI estimate failed',
    }
  }
}
