import 'server-only'
import { generateObject } from 'ai'
import { z } from 'zod'
import { NutritionLabel } from '@/lib/schemas/label'
import { MIN_OUTPUT_TOKENS } from './models'
import { recordUsage, routedModel } from './router'

/**
 * One photo, one vision call, two possible answers: a plate of food or a
 * nutrition label.
 *
 * ## Why they are not two different features
 *
 * Both start with the same gesture — you hold up the phone and shoot. Asking
 * "food or label?" first would be a mode switch in front of every photo, to save
 * a classification the model does for free. So there is one shutter, and the
 * model says which it got.
 *
 * ## Why they are not the same answer
 *
 * A plate is an ESTIMATE. The model is good at naming what is on it and bad at
 * judging how much, so the UI hands the grams back to the user.
 *
 * A label is a TRANSCRIPTION. The numbers are printed; there is nothing to
 * estimate. So the model's entire job is to read characters accurately, and every
 * number derived from them — total carbohydrate, the energy cross-check, the
 * stored basis — is computed by pure functions in `lib/domain/food/label.ts`. The
 * model is never asked to do arithmetic, which is what makes the result
 * deterministic: the same label always yields the same macros.
 *
 * Measured cost: a 64×64 PNG was 1,089 prompt tokens and a trivial reply spent
 * ~800 thinking tokens. Images are downscaled client-side, and `maxOutputTokens`
 * must stay generous or the response comes back EMPTY with no error
 * (PRD-001 §2.2).
 */
const PlateItem = z.object({
  name: z.string().describe('Plain food name. No brand unless clearly visible.'),
  estimated_amount: z.number().positive(),
  estimated_unit: z.enum(['g', 'ml', 'piece', 'serving']),
  /** Surfaced in the UI so the user can judge the estimate. */
  portion_reasoning: z.string().max(160).describe('What in the image indicated this size'),
  confidence: z.enum(['high', 'medium', 'low']),
})

/**
 * One flat object with a `kind` discriminator rather than a Zod discriminated
 * union. A union compiles to JSON Schema `anyOf`, which Gemini's structured
 * output does not handle reliably; a flat schema with nullable branches does. The
 * route narrows on `kind` and treats a missing branch as "neither".
 */
const PhotoReading = z.object({
  kind: z
    .enum(['plate', 'label', 'neither'])
    .describe('label if a printed nutrition panel is legible, plate if food, else neither'),
  dish_name: z.string().nullable().describe('Plate only. Name of the whole dish, if it reads as one'),
  items: z.array(PlateItem).max(8).describe('Plate only. Empty for a label.'),
  label: NutritionLabel.nullable().describe('Label only. Null for a plate.'),
  scene_notes: z.string().max(200).nullable(),
})

export type PhotoCandidate = z.infer<typeof PlateItem>

/**
 * Shared with pasted text. A copied panel and a photographed panel are the same
 * transcription job, and the 糖質 rule cannot live in two prompts.
 */
export const LABEL_TRANSCRIPTION = `FOR A LABEL, TRANSCRIBE. Do not calculate anything.
- Copy digits exactly as printed. Never convert, sum, scale or infer a missing value.
- One entry in "columns" per column the panel prints. Many labels print two (per 100 g and per serving); capture both — they cross-check each other.
- basis_unit / basis_amount is what the column is per: 100 g → g/100. "1食分" or "1袋" → serving/1 or piece/1.
- basis_mass is the weight the label states for that basis: "1食分 (40g)" → 40. Leave null if no weight is printed. Never estimate it.
- Japanese panels: 熱量=kcal, たんぱく質=protein, 脂質=fat, 炭水化物=carbohydrate_g, 糖質=net_carbs_g, 食物繊維=fiber_g, 糖類=sugars_g, 食塩相当量=salt_g, ナトリウム=sodium_mg.
- 糖質 is NOT sugars and NOT total carbohydrate. Put it in net_carbs_g. If the panel prints 糖質 and 食物繊維 but no 炭水化物 line, leave carbohydrate_g null.
- Set regime "jp" for a Japanese panel, "us" for a US Nutrition Facts panel, else "unknown".
- Any value not printed is null. A null is correct; a guess is not.
- Put anything you could not read into unreadable_notes.`

const SYSTEM = `You read one photo for a food log. It is either a plate of food or a printed nutrition panel.

Decide which:
- "label" — a nutrition facts panel is legible. Prefer this whenever numbers are readable, even if food is also in frame. A photographed label is exact; a photographed plate is a guess.
- "plate" — food, with no legible panel.
- "neither" — no food and no panel.

FOR A PLATE, estimate:
- List each distinct food separately. Do not merge rice and chicken into "chicken with rice".
- Grams for solids, ml for liquids. "piece" only for countable items.
- Say what in the image told you the size — a plate rim, a spoon, a standard bowl.
- If you cannot see food, return kind "neither". Do not invent food.

${LABEL_TRANSCRIPTION}`

export type PhotoKind = 'plate' | 'label' | 'neither'

export interface ResolvePhotoResult {
  kind: PhotoKind
  dishName: string | null
  items: PhotoCandidate[]
  label: z.infer<typeof NutritionLabel> | null
  sceneNotes: string | null
  degraded: boolean
  error?: string
}

const EMPTY: ResolvePhotoResult = {
  kind: 'neither',
  dishName: null,
  items: [],
  label: null,
  sceneNotes: null,
  degraded: true,
}

export async function resolvePhoto(
  imageBase64: string,
  mimeType: string,
): Promise<ResolvePhotoResult> {
  try {
    const { model, route } = await routedModel('vision')

    const { object, usage } = await generateObject({
      model,
      schema: PhotoReading,
      system: SYSTEM,
      maxOutputTokens: MIN_OUTPUT_TOKENS,
      temperature: 0.2,
      messages: [
        {
          role: 'user',
          content: [
            // Text before the image — documented accuracy improvement.
            {
              type: 'text',
              text: 'Read this photo. If a nutrition panel is legible, transcribe it exactly. Otherwise identify every food and estimate each amount.',
            },
            { type: 'image', image: imageBase64, mediaType: mimeType },
          ],
        },
      ],
    })

    void recordUsage(route.provider, route.id, usage.inputTokens ?? 0, usage.outputTokens ?? 0).catch(
      () => {
        /* accounting must never fail the request */
      },
    )

    // A branch the model claimed but did not fill is not an error worth showing —
    // it just means we got nothing usable from this photo.
    const kind: PhotoKind =
      object.kind === 'label' && object.label
        ? 'label'
        : object.kind === 'plate' && object.items.length > 0
          ? 'plate'
          : 'neither'

    return {
      kind,
      dishName: object.dish_name,
      items: kind === 'plate' ? object.items : [],
      label: kind === 'label' ? object.label : null,
      sceneNotes: object.scene_notes,
      degraded: route.degraded,
    }
  } catch (err) {
    // Never throw at the caller — a vision outage must not block logging
    // (PRD-000 Principle 1, AC-1.12).
    return { ...EMPTY, error: err instanceof Error ? err.message : 'Photo lookup failed' }
  }
}
