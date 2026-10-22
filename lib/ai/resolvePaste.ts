import 'server-only'
import { generateText } from 'ai'
import { z } from 'zod'
import { tidyPastedFoods, type PastedFood } from '@/lib/domain/food/paste'
import { NutritionLabel } from '@/lib/schemas/label'
import { MIN_OUTPUT_TOKENS } from './models'
import { clampProse, describeAiFailure, extractJson } from './parse'
import { LABEL_TRANSCRIPTION, type ResolvePhotoResult } from './resolvePhoto'
import { recordUsage, routedModel } from './router'

/**
 * Pasted text → the same answer a photo produces.
 *
 * A copied meal, a shopping-list of what you ate, or a nutrition panel pasted
 * from a product page. The model only splits and transcribes. Plate macros come
 * from the cascade afterwards, and a label's arithmetic stays in `readLabel`.
 *
 * Groq cannot do `json_schema`, so the shape is in the prompt and checked on the
 * way back. Gemini is not the fallback: that pool is twenty calls a day, shared
 * with photos. Never throws.
 */
const Item = z.object({
  name: z.string(),
  estimated_amount: z.number(),
  estimated_unit: z.enum(['g', 'ml', 'piece', 'serving']),
  portion_reasoning: z.string(),
  confidence: z.enum(['high', 'medium', 'low']),
})

const Reading = z.object({
  kind: z.enum(['plate', 'label', 'neither']),
  dish_name: z.string().nullable().optional(),
  items: z.array(z.unknown()).optional(),
  label: z.unknown().nullable().optional(),
  scene_notes: z.string().nullable().optional(),
})

const SHAPE = JSON.stringify(
  z.toJSONSchema(
    z.object({
      kind: z.enum(['plate', 'label', 'neither']),
      dish_name: z.string().nullable(),
      items: z.array(Item).max(8),
      label: NutritionLabel.nullable(),
      scene_notes: z.string().nullable(),
    }),
  ),
)

const SYSTEM = `You sort one pasted note into a food log. It is either food someone ate, or a copied nutrition panel.

Decide:
- "label" — the text is a nutrition facts panel, with energy and macros printed. Prefer this whenever those numbers are present.
- "plate" — foods or ingredients, with or without amounts.
- "neither" — the text is not about food.

FOR A PLATE:
- One row per distinct food. "rice and egg" is two rows, not one.
- Use the amount written in the text. If none is written, use one ordinary serving and set portion_reasoning to "no amount written".
- Grams for solids, ml for liquids, piece for countable items. "serving" only when the text itself says a serving.
- Do not invent a food that is not in the text. Do not estimate macros.

${LABEL_TRANSCRIPTION}

REPLY FORMAT
Reply with ONE JSON object and nothing else — no prose around it, no code fence.
It must match this schema:
${SHAPE}`

const UNUSABLE = 'Could not sort that text. Type the foods instead.'

const EMPTY: ResolvePhotoResult = {
  kind: 'neither',
  dishName: null,
  items: [],
  label: null,
  sceneNotes: null,
  degraded: true,
}

function asFoods(raw: unknown[] | undefined): PastedFood[] {
  const parsed: PastedFood[] = []
  for (const row of raw ?? []) {
    const item = Item.safeParse(row)
    if (!item.success) continue
    parsed.push({
      ...item.data,
      portion_reasoning: clampProse(item.data.portion_reasoning, 160) ?? 'From the text you pasted.',
    })
  }
  return tidyPastedFoods(parsed)
}

function asLabel(raw: unknown): z.infer<typeof NutritionLabel> | null {
  if (!raw || typeof raw !== 'object') return null
  const note = (raw as { unreadable_notes?: unknown }).unreadable_notes
  const clamped =
    typeof note === 'string' ? { ...raw, unreadable_notes: clampProse(note, 200) } : raw
  const parsed = NutritionLabel.safeParse(clamped)
  return parsed.success ? parsed.data : null
}

export async function resolvePaste(text: string): Promise<ResolvePhotoResult> {
  try {
    const { model, route } = await routedModel('paste')
    const { text: reply, usage } = await generateText({
      model,
      system: SYSTEM,
      prompt: text,
      maxOutputTokens: MIN_OUTPUT_TOKENS * 2,
      temperature: 0.2,
    })

    void recordUsage(route.provider, route.id, usage.inputTokens ?? 0, usage.outputTokens ?? 0).catch(() => {
      /* accounting must never fail the request */
    })

    const parsed = Reading.safeParse(extractJson(reply))
    if (!parsed.success) return { ...EMPTY, error: UNUSABLE, degraded: route.degraded }

    const label = parsed.data.kind === 'label' ? asLabel(parsed.data.label) : null
    const items = parsed.data.kind === 'plate' ? asFoods(parsed.data.items) : []
    const kind = label ? 'label' : items.length > 0 ? 'plate' : 'neither'

    return {
      kind,
      dishName: clampProse(parsed.data.dish_name ?? null, 80),
      items: kind === 'plate' ? items : [],
      label: kind === 'label' ? label : null,
      sceneNotes: clampProse(parsed.data.scene_notes ?? null, 200),
      degraded: route.degraded,
      ...(kind === 'neither' ? { error: UNUSABLE } : {}),
    }
  } catch (err) {
    return {
      ...EMPTY,
      error: describeAiFailure(err instanceof Error ? err.message : String(err), 'type each food instead'),
    }
  }
}
