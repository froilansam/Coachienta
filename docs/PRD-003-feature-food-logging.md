# PRD-003 · Feature 1 — Food Logging & AI Macro Resolution

| | |
|---|---|
| **Status** | Draft v1 · 2026-08-06 · Phase P1 |
| **Depends on** | PRD-000, PRD-001 (§3.2 schema, §2 routing), PRD-002 (§8 flows) |
| **Core thesis** | Ask the AI once per food, forever. |

---

## 1. Problem

Logging food is the highest-frequency action in the product — roughly 10–13 entries a day, based on 4 months of actual spreadsheet history. Any friction here kills the whole product, because the user has a working (if broken) alternative they'll revert to.

Two things must be true simultaneously, and they pull against each other:

1. **Logging a repeat food must be near-instant and work offline** — most entries are repeats.
2. **Logging a novel food must not require the user to look up macros themselves** — that's the manual labour the AI exists to remove.

The resolution is a **cache-first cascade**: novel foods pay an AI cost once and become free forever after. The 279 imported foods mean the cache starts warm on day one.

---

## 2. User stories

| ID | Story | Priority |
|---|---|---|
| US-1.1 | As Froye, I type `200g white rice` and it's logged in two taps with correct macros, with no network. | P0 |
| US-1.2 | As Froye, I type a food I've never logged, and the app finds real macros from the web with sources I can check. | P0 |
| US-1.3 | As Froye, I photograph a meal and get a list of candidate items with estimated grams I can correct. | P1 |
| US-1.4 | As Froye, every food resolved once is saved so the next time is instant and free. | P0 |
| US-1.5 | As Froye, I see today's totals against my targets with the gap stated as a number. | P0 |
| US-1.6 | As Froye, I can correct a food's macros and the correction wins forever — without rewriting my history. | P0 |
| US-1.7 | As Froye, I see trends over weeks: adherence, protein consistency, calorie variance. | P1 |
| US-1.8 | As Froye, I can log a multi-item meal in one input (`200g tofu, 140g rice`) and get separate rows. | P1 |
| US-1.9 | As Froye, I can tell at a glance which macros are estimates versus verified. | P1 |
| US-1.10 | As Froye, I can merge duplicate foods in my library (`Sunny side up egg` / `eggs`). | P2 |

---

## 3. Resolution pipeline

The heart of the feature. Ordered cascade, cheapest first. Stops at the first confident hit.

```
INPUT: raw text  ("200g white rice", "2 pancakes", "sukiya gyudon mini")
   │
   ├─ 1. PARSE  (deterministic, local, zero cost)
   │     → { amount: 200, unit: 'g', query: 'white rice' }
   │
   ├─ 2. EXACT MATCH on foods.name_norm            → HIT: scale & done   [~0 ms]
   ├─ 3. ALIAS MATCH on foods.aliases              → HIT: scale & done   [~0 ms]
   ├─ 4. TRIGRAM FUZZY, similarity > 0.55          → HIT: offer top 3    [~5 ms]
   ├─ 5. VECTOR SEMANTIC (only if online)          → HIT: offer top 3    [~300 ms]
   │        "gyudon" ≈ "beef bowl"
   │
   ├─ 6. USDA FoodData Central   (online)          → structured facts    [~500 ms]
   │        generic/whole foods: rice, chicken breast, egg
   │        returns real DB fields → confidence 'high'
   │
   ├─ 7. Open Food Facts v2      (online)          → structured facts    [~700 ms]
   │        packaged/branded, incl. Japanese konbini
   │        returns per-100g nutriments → confidence 'high'
   │
   └─ 8. LLM ESTIMATE            (online, last resort)                  [~3 s]
            gemini-3.6-flash + responseSchema
            composite dishes only → confidence capped at 'medium'
            → WRITE to foods (cache now warm)
            → scale & log
```

> **Revised 2026-08-06 after live verification.** The original design put grounded LLM search at step 6. **Gemini's `googleSearch` tool has no free-tier quota** — it returns `429` on the very first call — and Groq's `compound-mini` reported `executed_tools: false`, meaning it answered from memory rather than searching. Both verified against the real account (PRD-001 §2.2).
>
> The replacement is better than the original plan, not a workaround. A grounded LLM *reads* a nutrition table and *retells* the numbers, so a transcription slip is invisible. USDA and Open Food Facts return **structured fields** (`energy-kcal_100g`, `proteins_100g`) with no language model between the database and our schema. Verified: USDA gives cooked white rice as `130 kcal / 2.54 P / 28.98 C / 0.37 F` per 100 g — citable, reproducible, and independently consistent with the LLM's recalled figures.
>
> The LLM keeps exactly one job: dishes that exist in no database.

**Source precedence and confidence:**

| Step | Source | Confidence | Citation stored |
|---|---|---|---|
| 6 | USDA FDC | `high` | `fdcId` + description + dataType |
| 7 | Open Food Facts | `high` | barcode + product URL |
| 8 | LLM | **`medium` max** | model id + `reasoning`, marked `EST` |

USDA is queried first for generic terms, Open Food Facts first when the input looks branded (contains a brand token, katakana/kanji product name, or a barcode). Both are tried before the LLM is considered. All three run through the same Atwater validation gate (§3.2).

### 3.1a Nutrition API integration — verified endpoints

Tested live 2026-08-06. **Two traps here cost real debugging time if not written down.**

**Open Food Facts — no API key, no signup, no account.** Read access requires only a `User-Agent`.

```
User-Agent: Coachienta/0.1 (froye@example.com)
```
Format is `AppName/Version (ContactEmail)` and it is mandatory — requests without it get blocked.

| Endpoint | Verified | Rate limit | Verdict |
|---|---|---|---|
| `api/v2/product/{barcode}` | ✅ 200, product found with per-100 g nutriments | **15/min per IP** | Use for barcode |
| `api/v2/search?categories_tags_en=…` | ✅ 200, real filtering (`rice` → 10,356) | **10/min per IP** | Use for tag filters |
| ⚠️ `api/v2/search?q=…` | **`q` is silently ignored** — `q=rice` and `q=onigiri` both returned 4,667,214, the entire database | 10/min | **❌ Never use.** Looks like it works; returns garbage. |
| ✅ `search.openfoodfacts.org/search?q=…` | ✅ 200, `onigiri` → **213 real hits** with macros (`176 kcal, 7 g protein`) | 10/min | **✅ This is the full-text endpoint** |
| `cgi/search.pl` (legacy) | ❌ 503 on every attempt | — | Deprecated, do not use |

**Trap 1 — the wrong search endpoint returns the whole database.** `/api/v2/search?q=` accepts the parameter, returns HTTP 200, and ignores it. Full-text search lives on the separate **Search-a-licious** service at `search.openfoodfacts.org`.

**Trap 2 — OFF data is crowd-sourced and frequently incomplete.** Verified: the top hit for `onigiri` had `energy-kcal_100g: null`. **Every OFF result must be rejected unless `energy-kcal_100g`, `proteins_100g`, `carbohydrates_100g` and `fat_100g` are all present and numeric.** Treat a partial record as no result and fall through to the next source.

**Rate limits are tight — 10/min on search.** OFF explicitly warns against search-as-you-type. Our architecture already avoids this (external lookup only on a *cache miss*, never per keystroke), but enforce it structurally:
- All external calls go through `/api/data/resolve-food` server-side — never the browser
- Server-side token-bucket limiter per provider: OFF search 10/min, OFF product 15/min
- On `429` or `503`, fall through to the next source rather than retrying — OFF returns transient 503s under load (observed twice during testing)

**USDA FoodData Central** — free key from [api.data.gov/signup](https://api.data.gov/signup), instant, email only. `DEMO_KEY` works for testing but is throttled hard. Default limit for a real key is 1,000 requests/hour, which is ~60× our expected need.

```
GET https://api.nal.usda.gov/fdc/v1/foods/search?query=…&api_key=$USDA_FDC_API_KEY
```
Nutrient values arrive as a `foodNutrients` array keyed by `nutrientName` — map `Energy` (kcal), `Protein`, `Carbohydrate, by difference`, `Total lipid (fat)`. Prefer `dataType: Foundation` or `SR Legacy` over `Branded` for generic ingredients; `Survey (FNDDS)` is good for prepared foods.

**Offline behaviour:** steps 1–4 work with no network. Step 5–6 unavailable → the sheet offers *Save as estimate* (user types macros, `confidence: 'low'`, `source: 'manual'`) or *Queue for lookup* (logs with name + grams, resolves when online, flagged `unverified`).

### 3.1 Step 1 — Deterministic quantity parsing

Pure function. Unit-tested. **Never** an AI call — this is the mistake that would make every log slow.

```ts
// lib/domain/food/parseQuantity.ts
export interface ParsedFoodInput {
  amount: number | null
  unit: UnitBasis | null
  query: string
  raw: string
}
export function parseQuantity(raw: string): ParsedFoodInput
export function splitMultiItem(raw: string): string[]   // on  ,  /  +  and  「、」
```

| Input | amount | unit | query |
|---|---|---|---|
| `200g white rice` | 200 | `g` | `white rice` |
| `white rice 200g` | 200 | `g` | `white rice` |
| `2 pancakes` | 2 | `piece` | `pancakes` |
| `1 cup / 125 g yogurt` | 125 | `g` | `yogurt` |
| `1 scoop whey` | 1 | `serving` | `whey` |
| `3 eggs` | 3 | `piece` | `eggs` |
| `250ml milk` | 250 | `ml` | `milk` |
| `kimchi` | `null` | `null` | `kimchi` |

Rules: prefer an explicit mass/volume over a count when both appear (`1 cup / 125 g` → 125 g, because grams are the precise figure). `null` amount → UI asks, pre-filled from `foods.usual_amount` when known.

### 3.2 Step 6 — AI grounded resolution

**Route:** `gemini-3.6-flash` + `responseMimeType: application/json` + `responseSchema` (PRD-001 §2.3). **Last resort only** — reached when neither USDA nor Open Food Facts has the item, i.e. composite and restaurant dishes. Confidence is capped at `medium` regardless of what the model claims.

⚠️ `gemini-3.6-flash` has `thinking: true` — it spends output tokens on internal reasoning before answering. Set `maxOutputTokens ≥ 2000` or the response comes back empty with no error.

**Zod schema — single source of truth** (drives the AI response format, the API boundary, and the DB insert):

```ts
// lib/ai/schemas/foodMacros.ts
export const FoodMacrosSchema = z.object({
  canonical_name: z.string().describe('Clean English name, brand separate'),
  brand: z.string().nullable(),
  aliases: z.array(z.string()).max(6)
    .describe('Alternative names incl. original language, e.g. 白米'),

  basis_unit:   z.enum(['g','ml','piece','serving']),
  basis_amount: z.number().positive()
    .describe('Prefer 100 for g/ml. For piece/serving use 1 and describe it.'),
  basis_description: z.string().nullable()
    .describe('Required when unit is piece/serving, e.g. "1 medium egg, 50g"'),

  kcal:      z.number().min(0).max(900),
  protein_g: z.number().min(0).max(100),
  carbs_g:   z.number().min(0).max(100),
  fat_g:     z.number().min(0).max(100),
  fiber_g:   z.number().min(0).max(100).nullable(),

  confidence: z.enum(['high','medium','low']),
  reasoning:  z.string().max(400)
    .describe('Why this confidence. Name the source type.'),
  is_composite_dish: z.boolean()
    .describe('True for mixed dishes where macros vary by preparation'),
})
export type FoodMacros = z.infer<typeof FoodMacrosSchema>
```

**Validation gate — a schema-valid response is not automatically a correct one:**

```ts
// lib/domain/food/validateMacros.ts
// Atwater check: 4·protein + 4·carbs + 9·fat should ≈ kcal
const derived = 4*protein_g + 4*carbs_g + 9*fat_g
if (Math.abs(derived - kcal) / Math.max(kcal, 1) > 0.20) {
  confidence = 'low'
  flags.push('macro_kcal_mismatch')
}
// Mass sanity for gram basis
if (basis_unit === 'g' && protein_g + carbs_g + fat_g > basis_amount * 1.05) {
  confidence = 'low'
  flags.push('mass_exceeds_basis')
}
```

This catches the most common LLM nutrition failure — internally inconsistent macro sets that look plausible — before it reaches the database. Anything downgraded to `low` is surfaced to the user rather than silently stored.

**Confidence policy:**

| Level | Meaning | UI | Counts toward adherence? |
|---|---|---|---|
| `user_verified` | User typed or confirmed the numbers | no chip | ✅ |
| `high` | Official label, or consistent across ≥2 sources, Atwater passes | no chip | ✅ |
| `medium` | Single credible source, or generic-food database value | `EST` chip | ✅ |
| `low` | Composite dish, inference, or failed a validation check | `UNVERIFIED` chip, amber | ⚠️ flagged in trends |

Composite dishes (`is_composite_dish: true`) are capped at `medium` regardless of the model's own claim — `mapo tofu` genuinely varies by cook, and confident precision there would be a lie.

### 3.3 Photo resolution — one shutter, two kinds of answer

**Route:** Gemini Flash vision + JSON schema. Fallback Groq `qwen/qwen3.6-27b` (only Groq vision model, 5 images / 20 MB max).

A photo of food and a photo of a nutrition panel arrive through the same gesture — hold up the phone and shoot. Asking "food or label?" first would put a mode switch in front of every photo to save a classification the model performs for free. So there is **one capture button**, and the model reports which it got.

They are not the same *answer*, though, and the difference decides everything downstream:

| | **Plate** (§3.3a) | **Label** (§3.3b) |
|---|---|---|
| What the model does | identifies + estimates | transcribes |
| Nature of the result | an estimate | printed fact |
| Who owns the numbers | the user corrects grams | the manufacturer; the user states how much they ate |
| Macro source | steps 2–6 cascade, per item | the panel itself; no lookup |
| Determinism | no — an estimate | **yes** — same panel, same macros |
| Confidence | inherited from the cascade | `high` when the printed numbers reconcile |

```ts
// One flat object with a `kind` discriminator, NOT a Zod discriminated union:
// a union compiles to JSON Schema `anyOf`, which Gemini's structured output does
// not handle reliably. The route narrows on `kind` and treats a branch the model
// claimed but did not fill as 'neither'.
const PhotoReading = z.object({
  kind: z.enum(['plate', 'label', 'neither']),
  dish_name: z.string().nullable(),        // plate
  items: z.array(PlateItem).max(8),        // plate
  label: NutritionLabel.nullable(),        // label
  scene_notes: z.string().max(200).nullable(),
})
```

Classification bias is deliberate: **prefer `label` whenever a panel is legible**, even when food is also in frame. A photographed label is exact; a photographed plate is a guess. Given both, take the exact one.

Pre-upload for both: client-side resize to max 1024px longest edge, JPEG q0.8. Cuts tokens (258 per 768×768 tile) and upload time on mobile data. Prompt text goes **before** the image in the request array — documented accuracy improvement.

#### 3.3a Plate — estimate, then correct

**Hard rule: never auto-commits** (PRD-000 R9). Portion estimation from a photo is the model's weakest skill; item *identification* is its strongest. So the UI splits them: names come pre-filled, **grams are always presented as editable and focused**. Each candidate then runs steps 2–6 for macros — reusing the same cache.

Items resolve **sequentially, not in parallel**: each miss may hit USDA and Open Food Facts, and OFF allows only 10 searches a minute (§3.1a). A five-item plate is therefore slower than a one-item plate, by design.

**Review UI** (anatomy in PRD-002 §8, Mobbin basis in PRD-002 §0) — `components/food/PhotoReview.tsx`:

- **`AI-DETECTED ITEMS ⓘ` labels the whole group** (BitePal) rather than badging every row. Cleaner, and it draws an explicit line between what the model guessed and what the user entered.
- **`portion_reasoning` is rendered under each item name** — `1 bowl, ~200 g` (Life Reset). The user can only correct a portion estimate if they can see what it was based on.
- **Grams field is editable and focused**; the item name is not. This is the split between what the model is good at (identification) and bad at (portion).
- **A `TOTAL` row sits above the commit CTA** (Life Reset, MyFitnessPal) so the sum is confirmed before the write.
- `⊖` removes an item; swipe-left also works.
- **`FeedbackButtons` (👍 / 👎) on the resolution result** (Cal AI's "How did Cal AI do?"). Recorded against the resolution, giving a real quality signal on the vision route rather than guesswork.

#### 3.3b Label — transcribe, then verify

This is the deterministic path, and the reason it *is* deterministic is a hard division of labour:

> **The model reads characters. It never does arithmetic.**

Every derived value — total carbohydrate, the energy cross-check, which basis to store against, the confidence grade — is computed by pure functions in `lib/domain/food/label.ts`. Feed the same transcription in twice and identical macros come out, and the maths is testable with no model in the loop. Anything the model is asked to *compute* is a number nobody can reproduce or check.

The transcription contract is `lib/schemas/label.ts`. Rules the prompt enforces:

- Copy digits **exactly as printed**. Never convert, sum, scale or infer a missing value.
- **One entry per printed column.** Many panels print two (per 100 g *and* per serving). Capture both — they cross-check each other, which is the strongest error check available.
- `basis_mass` is the weight the label *states* for a basis: `1食分 (40g)` → `40`. Null when no weight is printed. **Never estimated** — that would be guessing a density, which §4.1 forbids everywhere else.
- Any value not printed is `null`. A null is correct; a guess is not.
- Unreadable regions go in `unreadable_notes`, shown to the user and never used in a calculation.

**Japanese panels are the primary case**, not an afterthought — they are what gets photographed here. Mapping and traps:

| Printed | Field | Trap |
|---|---|---|
| 熱量 | `kcal` | — |
| たんぱく質 | `protein_g` | — |
| 脂質 | `fat_g` | — |
| 炭水化物 | `carbohydrate_g` | Includes fibre, like USDA's "by difference" |
| 糖質 | `net_carbs_g` | **Not sugars, and not total carbohydrate.** 糖質 = 炭水化物 − 食物繊維 |
| 食物繊維 | `fiber_g` | — |
| 糖類 | `sugars_g` | A subset of 糖質. Never used for energy |
| 食塩相当量 | `salt_g` | — |
| ナトリウム | `sodium_mg` | 食塩相当量(g) = ナトリウム(mg) × 2.54 ÷ 1000 |

Japanese protein and diet products routinely print **糖質 and 食物繊維 with no 炭水化物 line at all**, which 食品表示基準 permits (if either sub-item is shown, both must be). Total carbohydrate is then recovered as `糖質 + 食物繊維`. With 糖質 alone, fibre is genuinely unknown: `totalCarbs` returns it as `net_only`, raises `fiber_unknown`, and the UI says carbs may be understated. Energy is unaffected either way — net carbs is exactly what the 4 kcal/g factor applies to.

Reading 糖質 as total carbohydrate would silently undercount every fibre-containing packet in the library. It is the same class of error as reading USDA's fibre-inclusive carbohydrate naively (§3.2) and it fails in the same direction.

**Storage basis.** Per-100 wins when printed: it is the app's dominant basis, it scales without a density, and it is the column least likely to be mis-transcribed. Otherwise the column's stated gram weight is used, even when the label calls it "1 serving", because grams scale and servings do not. With no weight printed at all, the row is stored `basis_unit: 'piece'`, `basis_amount: 1` and flagged `basis_mass_missing` — never a guessed weight.

**Reading and saving are two steps, because the name is the library key.**

A label's *name* is its identity: `(name_norm, brand)` is the uniqueness key, and it is the string a search has to match next week. OCR misreads names far more often than digits — half-width katakana, stylised logos, a product name split across two lines — so writing the row at read time would mean every scan risked leaving behind an entry that can never be found again. That is the opposite of the point: the whole reason to photograph a label is so you never have to again.

So:

| Step | Endpoint | Writes? |
|---|---|---|
| Read | `POST /api/data/resolve-photo` | **no** — returns transcription, verdict, derived rate, proposed name/brand |
| Save | `POST /api/data/label-food` | yes — upserts under the **approved** name |

The client sends the **transcription** back to save, not the macros. `readLabel` runs again server-side, so the stored rate is always derived from what was transcribed and a client can never post arbitrary numbers under a label's authority. The user owns the name; the server owns the arithmetic.

Two consequences worth stating:

- **Correcting a garbled name into one already in the library resolves to that row**, because the upsert conflicts on `(name_norm, brand)`. Fixing `SAVAS ﾐﾙｸﾌﾟﾛﾃｲﾝ` to `SAVAS Milk Protein ココア` updates the existing entry rather than creating a near-duplicate beside it — exactly what the user was reaching for. A dedicated merge tool (AC-1.13) is still P1e work for duplicates that already exist.
- **An empty name blocks the save.** It is the one input that makes a row permanently unfindable, so `canSave` is false and the CTA is disabled until there is something to match on.

A label row is written with `source: 'photo'` and its citation is the packet itself (`url: null`) — inventing a URL would make a photographed label look like a web source.

**Offline.** Reading a label requires the network by definition (the vision call), and saving needs one more round trip. If that save fails the review screen *stays open* with the transcription intact and a retry notice — losing it would mean photographing the packet again. Once saved, the log entry itself goes through the normal local-first `enqueue()` path like any other.

#### 3.3c Why the energy check is an interval, not a percentage

`validateMacroRate` (§3.2) flags a >20% Atwater discrepancy. **Applied to a label, that test is wrong**, because printed values are rounded by law before they reach the package:

| | Energy | Protein / Carb / Fibre | Fat |
|---|---|---|---|
| **JP** — 食品表示基準 | 1 kcal | 1 g | 1 g |
| **US** — 21 CFR 101.9 | nearest **5 below 50 kcal, 10 above** | 1 g | 0.5 g under 5 g, 1 g at or above |

A 30 kcal item with whole-gram macros therefore carries up to **±8.5 kcal of legal slack — 28%** — which the flat 20% test would report as a bad label. Rejecting food that is fine is exactly the failure the fibre-aware fix addressed elsewhere.

So `readLabel` computes the energy range the printed macros *could* represent and asks only whether the printed energy falls inside it:

```
energy = 4·protein + 4·(carbs − fibre) + 9·fat + 2·fibre
```

Energy rises with protein, carbohydrate and fat and **falls** with fibre (2 kcal/g displacing 4), so the extremes sit at opposite corners of the interval box — lowest macros with highest fibre, and the reverse. Non-overlap means a real discrepancy: one of the printed numbers was misread, or the label itself is wrong.

Four further checks, all pure:

| Flag | Fires when | Effect on confidence |
|---|---|---|
| `energy_disagrees` | printed kcal outside the implied range | `low` |
| `mass_exceeds_basis` | P+C+F weighs more than the serving | `low` |
| `columns_disagree` | two columns do not scale to each other | `medium` |
| `fiber_unknown` | only 糖質 printed | `medium` |
| `basis_mass_missing` | no weight printed for the basis | note only |
| `servings_disagree` | servings × serving size ≠ net weight | note only |
| `salt_disagrees` | salt and sodium do not convert | note only |

A label that clears every check is graded **`high`** — the strongest non-user source in the app, because it is the manufacturer's own declaration rather than anyone's estimate.

**Review UI** — `components/food/LabelReview.tsx`, deliberately *not* the plate screen:

- **The name field comes first, and it is editable.** Not a heading with read-only text under it. It is the field that decides whether this packet is ever found again, so it leads. Hint: *"Search will match this"*.
- **Brand is a separate optional field**, because it is half of the uniqueness key — merging it into the name would make `(name_norm, brand)` collide differently than the user expects.
- **Leads with a verdict, not a disclaimer.** `✓ The numbers add up — 126 kcal printed; the macros imply 118–134 kcal`. That one line is the whole feature made visible. The plate screen leads with "these are estimates, check the grams"; a label has earned the opposite framing.
- **The panel is shown as transcribed**, in reading order, with the Japanese term beside the English one on a JP panel (`Protein · たんぱく質`). You hold the phone next to the packet and compare line by line. Nothing is reordered, renamed or rounded by us.
- **A real `<table>` with `<th scope="row">`** — the panel is tabular data and screen readers should hear it that way.
- **`HOW MUCH DID YOU HAVE?`**, prefilled with one basis. The macros beside it update live. Along with the name, the only thing on this screen the label cannot tell us.
- **CTA is `SAVE & ADD`**, not `ADD` — it says plainly that a library row is being created, which is the durable side effect the user is buying.
- Soft flags appear as `warn` chips under the panel, each one sentence.

**Not stored:** sodium and sugars. `foods` has no column for either, and adding one is a migration this feature does not need. Both are read, both are shown for confirmation, neither reaches the database. Worth revisiting if salt ever becomes a tracked target.

**Known limitation.** `upsertFood` upserts on `(name_norm, brand)`, so re-scanning a product overwrites its macros **without bumping `version`**. For a label that is usually the desired outcome — the packet is authoritative and may have been reformulated — but it is the same unproven path as AC-1.6, and until that test exists a re-scan silently replaces the old rate. Existing `food_log_entries` keep their frozen macros regardless, so history is safe either way.

---

## 4. Data contracts

### 4.1 Scaling — the pure function everything depends on

```ts
// lib/domain/food/scaleMacros.ts
export function scaleMacros(
  food: Pick<Food,'basis_unit'|'basis_amount'|'kcal'|'protein_g'|'carbs_g'|'fat_g'|'fiber_g'>,
  amount: number,
  unit: UnitBasis,
): ScaledMacros

// Same unit → linear ratio.
// Cross-unit (piece → g) requires food.unit_conversions; otherwise throw
// UnitMismatchError and force the UI to ask. NEVER silently guess a density.
```

Refusing to guess a density is deliberate. `1 piece` → `g` without a known conversion is the kind of silent wrong answer that poisons a whole dataset.

### 4.2 Commit

```ts
export const LogEntryInput = z.object({
  id: z.string().uuid(),            // client-generated → idempotency (PRD-001 §4.2)
  logged_on: z.string().date(),     // Asia/Tokyo calendar day
  meal: z.string().max(40).nullable(),
  food_id: z.string().uuid().nullable(),
  food_name: z.string().min(1),     // denormalized, survives food deletion
  amount: z.number().positive(),
  unit: z.enum(['g','ml','piece','serving']),
  kcal: z.number().min(0),          // frozen at log time (PRD-000 Principle 7)
  protein_g: z.number().min(0),
  carbs_g: z.number().min(0),
  fat_g: z.number().min(0),
  food_version: z.number().int().nullable(),
  confidence: z.enum(['high','medium','low','user_verified']),
  resolved_by: z.enum(['library','ai_grounded','ai_ungrounded','photo','manual']),
  photo_path: z.string().nullable(),
  notes: z.string().max(500).nullable(),
})
```

`resolved_by` is what makes PRD-000's "≥80% resolved from library" metric measurable rather than aspirational.

### 4.3 Correction semantics (US-1.6)

Editing a food's macros:
1. `UPDATE foods SET ..., version = version + 1, confidence = 'user_verified'`
2. **Existing `food_log_entries` are untouched.** They keep their frozen macros and old `food_version`.
3. Future logs use the new values.
4. The day view may show a subtle `↻` on entries whose `food_version` is stale, with an explicit opt-in *Recalculate this day* action.

Never automatic. Retroactive recalculation would make every historical chart untrustworthy.

---

## 5. Views

### 5.1 Today, and any other day (`/today`)

Per PRD-002 §7. Composition, top to bottom:

```
‹  YESTERDAY  ›   TODAY                        [OFFLINE · 2 PENDING]
Wednesday 5 August · 4-week weight-maintenance recomp
─────────────────────────────────────────────────────────────
2,350 GOAL  −  2,090 FOOD  =  260 REMAINING          ← EquationRow
█████████████████████████████████▏          89%
─────────────────────────────────────────────────────────────
PRO    168.3 g   ▲ +8.3    TARGET 160
CHO    196.7 g   ▼ −93.3   TARGET 290
FAT     70.4 g   ●  ok     TARGET  75
─────────────────────────────────────────────────────────────
BREAKFAST                                             468
P 36.9   C 57.4   F 30.0                              ← per-meal macros
07:40  Scrambled eggs        3 ea    216
07:40  White rice           200 g    252
─────────────────────────────────────────────────────────────
LUNCH                                                 193
P 36.3   C  0.0   F  4.2
12:15  Chicken breast       100 g    193   EST
─────────────────────────────────────────────────────────────
                                    [ ＋ FOOD ]
```

#### 5.1-0 Day navigation

> **Added 2026-08-06.** Retroactive *logging* was specced in three places (§5.1a, PRD-002 §0, PRD-007 §4) but retroactive *reading* was specced nowhere — while the plumbing for it was already complete. `/api/data/day` took a `date`, `useToday` held `date` state and already returned `setDate`, and the Dexie mirror is indexed `[table+day]`. Nothing called it. The screen rendered the date as static text, so the user's entries — which sat on 05 AUG — were unreachable from a screen showing 06 AUG.

- **`‹ LABEL ›` in the header, where the date already was.** The label doubles as the control: it is the biggest tap target up there, and a separate calendar icon would add a second affordance for one action. Underneath it is a native `<input type="date">` at `opacity-0` — the platform picker is better than anything worth building, and on iOS it is the control the user already knows.
- **Relative labels for the near days.** `TODAY`, `YESTERDAY`, `TOMORROW`, then `05 AUG · WED`. You think in relative days for the last couple and in dates after that.
- **Forward stops at today.** You cannot have eaten tomorrow, and letting the arrow walk into empty future days is a dead end. The date *field* has no `max`, so an entry accidentally logged ahead is still reachable deliberately.
- **A `TODAY` jump appears only once you are off today** — no dead control on the day it does nothing.
- **No swipe-to-change-day**, deliberately. `ListRow` already owns horizontal pointer gestures for swipe-to-delete, and a container-level horizontal swipe would fight it. Breaking delete to save one gesture is a bad trade.
- **Logging from a past day defaults to that day.** `LogFoodSheet` takes a `day` prop that seeds the date chip. Without it, opening the sheet while viewing 05 AUG would silently write to 06 AUG — the spreadsheet's mis-dating problem in a new form. `useLogDraft` re-syncs `loggedOn` when `day` changes, adjusted during render rather than in an effect, because the hook mounts once with the Today screen and outlives every open of the sheet.
- **Empty and unmeasurable days say which day they mean**, and still offer to log to it.
- **A failed load is its own state, above everything else.** `CANNOT REACH THE SERVER` or `THIS DEVICE IS LOCKED OUT`, each with `TRY AGAIN`. Previously `useToday` swallowed the fetch error, so a 404 or 500 fell through to *"no targets"* + *"nothing logged"* — the exact screen an empty day produces. A user cannot act on a difference they cannot see, and this is how a dropped access cookie on the phone presented as a database outage.

#### 5.1-0a Targets must come from the day, not from now

Reading `nutrition_targets` where `effective_to IS NULL` is correct for today and **wrong for every other day**. It judges August's entries against whatever target is current when you happen to look, so a phase change would silently rewrite how every earlier day scored — the same class of error as retroactive macro recalculation, which §4.3 forbids.

The query now selects the row whose validity window contains the date:

```sql
where effective_from <= :date
  and (effective_to is null or effective_to >= :date)
order by effective_from desc limit 1
```

Same row for today, so AC-1.8 is unaffected. A date before the earliest `effective_from` returns null targets and the screen says *"This day is before your first nutrition target… The entries below are still exact."* — it does not invent a comparison.

- **Remaining stated as a visible equation** (`EquationRow`, PRD-007 §4.4) rather than a bare number — MyFitnessPal pattern, and it suits the Instrument voice because it shows its working.
- **An overshoot reads `225 OVER`, not `-225.4 LEFT`.** Found by looking at a real past day. A negative remainder made the reader decode a minus sign to learn something the label could just say, and `-225.4` mixed precisions with `2,350` beside it for a number nobody eats to a tenth of a calorie. Whole calories, positive value, different word, `neg` tone. Browsing past days makes this the common case, not the edge one.
- **Per-meal subtotal and per-meal macro breakdown.** Added after Mobbin research; the original design only had per-day totals, which makes it impossible to see which meal cost you the fat budget.
- Targets read live from `nutrition_targets` where `effective_to IS NULL` — the single active row (PRD-001 §3.4). Never constants. Direct fix for the spreadsheet's hardcoded 2,500 on a screen whose real target was 2,350.
- Gym vs rest day target selected by whether a `workout_sessions` row exists for `logged_on`. Manual override available.
- Entries grouped by `meal`, ordered by `logged_at`.
- Swipe-left on a row → Edit / Duplicate / Delete. Also reachable by long-press (swipe alone is not accessible).
- Long-press → *Log this again now* — the fastest repeat path, equivalent to MyFitnessPal's "Copy previous meal".

### 5.1a Log sheet anatomy

```
┌─ drag handle ──────────────────────────────────────────────┐
│  [06 AUG ⌄]  [15:20 ⌄]  [Snack ⌄]                      ✕  │  ← header chips
├────────────────────────────────────────────────────────────┤
│  🔍  white rice                                         ✕  │
│                                                            │
│  BEST MATCHES                                              │
│  ○ White rice (cooked)                        ✓ VERIFIED   │
│    Per 100 g · 126 kcal · P 2.3 · C 28.2 · F 0.0      ✏️ ＋ │
│  ○ Brown rice (cooked)                                     │
│    Per 100 g · 123 kcal · P 2.7 · C 25.6 · F 1.0      ✏️ ＋ │
│                                                            │
│  MORE RESULTS                                              │
│  ○ Rice, fried (konbini)                            EST    │
│    Per 100 g · 168 kcal · P 3.9 · C 24.4 · F 5.5      ✏️ ＋ │
├────────────────────────────────────────────────────────────┤
│  [White rice 200 g ✕]  [Kimchi 60 g ✕]                    │  ← basket
│  TOTAL  268 kcal   P 3.5   C 59.2   F 0.2                  │
│                       [ LOG 2 ITEMS ]                      │
└────────────────────────────────────────────────────────────┘
```

Five decisions, all Mobbin-derived (PRD-002 §0):

1. **Editable date / time / meal chips in the header** (Ultrahuman, BitePal) — replaces a separate date picker. Retroactive logging in one tap.
2. **Macros shown per-100 g in the result row** (Ultrahuman) — the basis is visible at the decision point, so you can sanity-check before adding.
3. **`✓ VERIFIED` badge** (MyFitnessPal) — renders our `confidence` field. `EST` / `UNVERIFIED` for the weaker levels.
4. **Two tiers: `BEST MATCHES` / `MORE RESULTS`** (MyFitnessPal) — maps directly onto the cascade: exact + alias hits are Best, fuzzy + vector hits are More.
5. **Basket of removable chips with a running total** (Ultrahuman) — accumulate several items, commit once. This is the better answer to US-1.8 than text-parsing `200g tofu, 140g rice` alone, though both are supported.

`✏️` opens the macro editor before adding (MacroFactor's `Serving / 100 g / 100 ml` basis toggle). `＋` adds straight to the basket and turns into a filled `✓` in place.

When Best Matches is empty, the echoed query gets a `[ LOOK UP ]` button on its section header (Ultrahuman's `Create` affordance) — that is the entry point to §3.2 grounded resolution.

### 5.2 Food library (`/food/library`)

Sorted by `times_logged desc` — this *is* the "Usual Foods" tab, done properly.

**Its job is triage, not browsing.** Measured against the live database on 2026-08-06:

| | Count | |
|---|---|---|
| Foods | 282 | |
| `medium` or `low` confidence | **188 (67%)** | nobody has confirmed these |
| `user_verified` | **0** | there was no way to verify anything |
| Never logged | **58 (21%)** | leftovers from lookups |
| Read from a label | 2 | |
| Near-duplicate clusters | **2** | and neither is a real duplicate |

So the filters lead the screen and carry live counts — `ALL 282 · CHECK 188 · UNUSED 58 · LABELS 2`. The number *is* the call to action; a chip reading `CHECK 188` needs no legend.

> **Merge was mis-prioritised, and the data says so.** This PRD justified merge as the library's headline job: *"the spreadsheet had ≥10 near-duplicate clusters (`Sunny side up eggs` 27× / `Sunny side up egg` 10×; three spellings of SAVAS Milk Protein)."* True of the **spreadsheet** — but `0003_seed.sql` already normalised those names, which is why `Sunny side up eggs` is one row with 31 logs.
>
> What remains is 2 clusters, 6 rows, **all with 0 logs**: `Chicken Tandoori` by *Evol* (112 kcal), *The Keto Food Co.* (112) and *Whole Foods* (161), plus two `Chicken Tandoori Wrap`s. Different brands, different macros — **genuinely distinct products** that Open Food Facts testing pulled in. Merging them would be wrong.
>
> Merge is still built, because label re-scans and future external lookups will create real duplicates. It is just not what this screen is for.

#### 5.2a Correcting a food (US-1.6, AC-1.6)

Tapping any row opens the editor: name, brand, basis unit + amount, and the five macro fields. Saving calls `update_food_macros`, which bumps `version`, sets `confidence: 'user_verified'`, and touches **only** the `foods` row.

- **The live check shows its working**, in the same voice as the label screen: `126 kcal entered; the macros imply 122`. Updating on every keystroke rather than on blur is deliberate — entering **fibre** can clear a calorie mismatch outright, and watching that happen teaches the rule far better than a warning that appears after you have left the field.
- **The immutability promise is on the screen**, not just in this document: *"Entries you have already logged keep the numbers they were logged with."* It is the first thing anyone wonders before editing a food they have logged 154 times.
- **A referenced food cannot be deleted.** The button is disabled with the reason stated, and merge is offered instead.

> **`times_logged` is not a reference count, and gating on it was a bug.** Shipped in P1e, reported immediately: a food whose only entry had been deleted still said *"This food is in 1 past entry, so it cannot be deleted."*
>
> `foods.times_logged` is a **lifetime usage counter** seeded from spreadsheet history. `White rice (cooked)` carries 187 because that is how often it was eaten, while only 5 `food_log_entries` rows were ever imported. That gap is correct — the counter is what orders `recent_foods`, which is what makes the two-tap path work — so it must never be "repaired" to match the entry count.
>
> The mistake was using it to answer a different question. Measured across the live library: **221 of 282 foods were refused deletion while nothing referenced them.**
>
> Two fixes (`0011_delete_gate_by_reference.sql`):
> 1. `library_foods` now returns **`entry_count`** — a real `count(*)` over `food_log_entries` — and `deleteGuard` gates on that. `delete_food_if_unreferenced()` repeats the check in SQL, so the API cannot be talked past.
> 2. **Deleting a log entry now calls `unbump_food_usage`**, floored at zero. Log-then-delete previously left the food permanently promoted in `recent_foods`, and produced the phantom entry the user saw. The sync route reads `food_id` *before* the delete, because a delete payload does not carry it.
>
> `usual_amount` and `last_used_at` are deliberately not rolled back: a deleted entry was still a real observation of the portion taken.
>
> The delete gate now distinguishes three states — **blocked** (entries reference it), **allowed with a note** (nothing references it but the counter shows imported history worth pausing over), and **allowed** (a genuine leftover).

#### 5.2b Pruning (new)

Every cache miss writes up to 8 candidate rows, so the library accumulates food that was looked at once and never eaten — **58 of 282 rows, and growing with use**. This is the library's actual pollution problem, and it is a *delete* problem, not a merge problem.

The `UNUSED` filter lists exactly those rows with one `CLEAR 58` action. Safe by construction: `prune_unlogged_foods()` deletes only rows nothing references, so anything with history survives regardless of its counter.

#### 5.2c Merge (US-1.10, AC-1.13)

`merge_foods(survivor, loser)`: the loser's name and aliases move into the survivor's `aliases` so the old spelling still resolves via cascade step 3, log entries are repointed, `times_logged` is summed, and the loser row is deleted. Historical frozen macros are untouched — only `food_id` changes.

- **The survivor is chosen explicitly**, never inferred. The duplicate you *notice* is usually the one you want to lose: you search `sunny side up egg`, find it has 10 logs, and want the 27-log spelling to win. Guessing that would be a coin flip on a destructive action. The default is the more-logged row, and the choice is two stacked radio cards — a segmented control cannot hold two food names at 390px.
- **The plan is stated before it happens**, line by line: what disappears, the resulting count, that the old name becomes an alias, and how many past entries get repointed.
- **Cross-basis merges are refused in SQL**, not converted. Folding a per-piece row into a per-100 g row would reinterpret every historical amount on the entries being moved, and there is no density to convert with. Same rule as `scaleMacros`: ask rather than guess (§4.1).

#### 5.2d The trust chip was dishonest, and is fixed

`FoodResultRow` mapped **both** `high` and `user_verified` to a green **"Verified"**. That made 94 rows nobody had ever looked at claim human approval — including `SWEET'N LOW 400 COUNT PACKET BOX`, recorded by USDA as **0 kcal with 100 g of carbohydrate**, sitting at `high` confidence behind a green tick.

That is exactly the dishonest precision §10 forbids: it spends the user's trust on rows that have not earned it, and leaves nothing to say about the rows that have. `trustOf(confidence, source)` now names the provenance:

| Row | Chip | Tone |
|---|---|---|
| `user_verified` | `VERIFIED` | pos — **only** this means a human checked it |
| `source: 'photo'` | `LABEL` | pos — printed panel, the strongest non-user source |
| `high` + USDA | `USDA` | neutral |
| `high` + Open Food Facts | `OFF` | neutral |
| `high` + imported | `IMPORTED` | neutral |
| `medium` | `EST` | warn |
| `low` | `UNVERIFIED` | warn |

### 5.3 Trends (`/trends`, nutrition section) — shipped

| Chart | Spec |
|---|---|
| Calories vs target band | Daily line, target range as a shaded band. Hairline stroke, no gradient fill. |
| Protein consistency | Daily bars, target as a **tick mark** not a second bar. Streak count of consecutive days ≥ target. |
| Macro split | Stacked horizontal, 7/14/30-day averages |
| Adherence grid | Calendar heat grid — logged / on-target / missed. The honest picture. |
| Data-quality strip | % of entries by confidence. Makes "am I actually measuring or guessing?" visible. |

Aggregates come from **SQL, not client-side reduce** — same query functions the coach's tools use (PRD-005), so a chart and the coach can never disagree. `/trends` segments **Food | Train**; the range control is shared.

> Load the `dataviz` skill before implementing any chart (PRD-001 T6).

| AC | Criterion | State |
|---|---|---|
| AC-1.30 | Food trends: kcal band, protein streak/tick bars, macro split, adherence grid, confidence strip — all from coach SQL | ✅ unit + UI |
| AC-1.31 | Photo: camera **and** library upload both reach the same resolve-photo pipeline | ✅ |
---

## 6. Acceptance criteria

| ID | Criterion |
|---|---|
| AC-1.1 | Logging a food present in the library completes in ≤ 2 taps after the sheet opens, p90 < 3 s, with the device in airplane mode. |
| AC-1.2 | `parseQuantity` passes all cases in §3.1 as unit tests, plus `null`-amount handling. |
| AC-1.3 | A novel food returns per-basis macros with ≥1 citation URL, or fails visibly with a retry — never silently. |
| AC-1.4 | Every AI-resolved food creates exactly one `foods` row. The same food resolved twice creates no duplicate. |
| AC-1.5 | Any macro set failing the Atwater check by >20% is stored `confidence: 'low'` and shows `UNVERIFIED`. |
| AC-1.6 | Editing a food's macros does not change any existing `food_log_entries` values. Verified by test. |
| AC-1.7 | Today's totals equal `SUM` over `food_log_entries` for `logged_on`. Enforced by a reconciliation test — this is the spreadsheet's core failure. |
| AC-1.8 | Targets displayed come from the active `nutrition_targets` row. Changing that row changes the display with no code change. |
| AC-1.9 | Photo flow never commits without explicit user confirmation of grams. |
| AC-1.10 | `200g tofu, 140g rice` creates two separate entries. |
| AC-1.11 | Offline log → app closed → reopened → entry present locally and synced to Postgres exactly once. |
| AC-1.12 | With all AI quota exhausted, library logging still works and a non-blocking notice explains why lookup is paused. |
| AC-1.13 | Merging duplicates preserves total `times_logged` and repoints all entries. |
| AC-1.14 | Japanese food names round-trip correctly through parse, store, search, and display. |
| AC-1.15 | A photo of a legible nutrition panel is classified `label`, not `plate` — including when food is also in frame. |
| AC-1.16 | The same transcription always yields the same stored macros. No arithmetic happens in the model. |
| AC-1.17 | A JP panel printing 糖質 + 食物繊維 and no 炭水化物 line stores `carbs = 糖質 + 食物繊維`. A panel printing 糖質 alone stores it flagged `fiber_unknown`, never as total carbohydrate. |
| AC-1.18 | A label whose printed energy sits inside the range its printed macros allow — after legal rounding — is graded `high` and shows no warning. One outside the range is graded `low` and says which numbers disagree. |
| AC-1.19 | A label with no printed weight for its basis is stored per piece. No density is ever inferred. |
| AC-1.20 | Label review commits nothing on its own. Same rule as AC-1.9, same single commit path. |
| AC-1.30 | `/trends` Food: kcal vs band, protein streak + tick bars, macro split, adherence grid, confidence strip — from coach SQL. |
| AC-1.31 | Log food offers camera **and** library upload; both use the same resolve-photo pipeline. |
| AC-1.21 | The product name and brand are editable before the row is created, and the row is stored under the approved name — so searching that name later finds it. An empty name cannot be saved. |
| AC-1.22 | Editing a scanned name to match an existing library row updates that row rather than creating a second one. |
| AC-1.23 | The library lists every food with live counts per filter, and `UNUSED` shows only rows no log entry references. |
| AC-1.24 | Pruning deletes only never-logged foods. A food with history survives regardless of its `times_logged` counter. |
| AC-1.25 | A food referenced by any `food_log_entries` row cannot be deleted from the UI or the API. The gate uses the real reference count, never `times_logged`. |
| AC-1.28 | Deleting a log entry decrements `times_logged`, floored at zero, so log-then-delete leaves no phantom usage. |
| AC-1.29 | Any past day's entries are reachable from `/today` in one tap, and its totals are graded against the targets that were active **on that day** — never against today's. A day before the first target row states that rather than inventing a comparison. |
| AC-1.30 | Opening the log sheet while viewing a past day writes to that day, not today. |
| AC-1.31 | A day that fails to load says so and offers a retry. It is never rendered as an empty day. |
| AC-1.32 | The access cookie is storable over plain HTTP on a LAN address, so the phone works in dev, and keeps `Secure` when served over HTTPS. |
| AC-1.26 | A cross-basis merge is refused with a stated reason, never converted. |
| AC-1.27 | `VERIFIED` appears only on `user_verified` rows. Database rows name their source instead. |

### 6.1 Coverage

**P1f closed this out.** 160 unit tests and 38 E2E tests against real Postgres. Every row below names where it is proven; nothing claims more than it has.

| AC | Where it is proven | State |
|---|---|---|
| AC-1.1 | `e2e/log-food.spec.ts` — two taps in airplane mode | ✅ |
| AC-1.2 | `parseQuantity.test.ts`, 31 cases | ✅ |
| AC-1.3 | `e2e/day-nav.spec.ts` — sources shown at the portion step; a dead lookup shows a retry and never claims `NO MATCH`. `e2e/library.spec.ts` — the editor's source disclosure | ✅ |
| AC-1.4 | `upsertFood` + `unique (name_norm, brand) nulls not distinct` | ✅ schema-enforced |
| AC-1.5 | `macros.test.ts` grades it; `library.test.ts` asserts the `UNVERIFIED` chip | ✅ |
| AC-1.6 | **`e2e/library.spec.ts`** — correcting a food to 999 kcal bumped `version` 1→2 and left both log entries at 400 kcal with `food_version` 1 | ✅ **the risky one, now closed** |
| AC-1.7 | `e2e/today.spec.ts` — displayed totals vs `SUM` | ✅ |
| AC-1.8 | `e2e/today.spec.ts` + `e2e/day-nav.spec.ts` — and now date-scoped | ✅ |
| AC-1.9 | `e2e/photo-log.spec.ts` — review writes nothing; discard writes nothing | ✅ |
| AC-1.10 | `e2e/log-food.spec.ts` — segments, then two entries | ✅ |
| AC-1.11 | `e2e/offline-sync.spec.ts` — replayed flush does not duplicate | ✅ |
| AC-1.12 | `e2e/photo-log.spec.ts` + `lib/ai/router.ts` | ✅ |
| AC-1.13 | `e2e/library.spec.ts` — 27+10 → 37, entry repointed with frozen macros, loser gone, old spelling resolves via alias | ✅ |
| AC-1.14 | Seed round-trips `SAVAS Milk Protein ココア`; `library_foods('ココア')` probed | ⚠️ half — no dedicated test |
| AC-1.15 | Prompt instructs it; nothing asserts it | ❌ needs a real panel photo |
| AC-1.16 | `label.test.ts` — five identical reads of one transcription | ✅ |
| AC-1.17 | `label.test.ts` — 糖質+食物繊維 reconstruction, and a lone 糖質 flagged `fiber_unknown` | ✅ |
| AC-1.18 | `label.test.ts` — a 30 kcal JP label passes where a flat 20% gate fails; US gets 10 kcal slack; fibre at 2 kcal/g | ✅ |
| AC-1.19 | `label.test.ts` — per-100 preferred, stated gram weight used, per-piece fallback with no invented density | ✅ |
| AC-1.20 | Same commit path as AC-1.9 | ⚠️ inherited, not asserted on the label screen |
| AC-1.21 | Two-step read/save; `canSave` gates an empty name | ❌ no test |
| AC-1.22 | `upsert onConflict (name_norm, brand)` | ⚠️ schema-enforced |
| AC-1.23 | `library_foods` / `library_counts`; filters driven in `e2e/library.spec.ts` | ⚠️ exercised, not asserted per filter |
| AC-1.24 | `e2e/library.spec.ts` — a referenced row with `times_logged = 0` survives the prune | ✅ |
| AC-1.25 | `e2e/library.spec.ts` — DELETE disabled with the reason; `library.test.ts` covers the guard | ✅ |
| AC-1.26 | `e2e/library.spec.ts` + `library.test.ts` — refused with a stated reason | ✅ |
| AC-1.27 | `library.test.ts` — `VERIFIED` only for `user_verified`; USDA/OFF/IMPORTED name their source | ✅ |
| AC-1.28 | `e2e/library.spec.ts` — bump then unbump, floored at zero | ✅ |
| AC-1.29 | `e2e/day-nav.spec.ts` — a 2019 day graded against a 2019 target row, and no longer once out of its window | ✅ |
| AC-1.30 | `e2e/day-nav.spec.ts` — the date chip reads the viewed day | ✅ |
| AC-1.31 | `e2e/day-nav.spec.ts` — 500 → `CANNOT REACH THE SERVER`, 404 → lockout, retry recovers, and neither borrows the empty-day screen | ✅ |
| AC-1.32 | Probed over the LAN: no `Secure` on plain http, `Secure` when forwarded as https | ⚠️ probed — needs a proxy-level test |

**What is still genuinely open**

- **AC-1.15** — whether a real panel is classified `label` rather than `plate`. No assertion can settle it; `npm run probe:vision <photo>` and a human can.
- **AC-1.21 / AC-1.20** — the label review screen has no E2E of its own. Its commit path is AC-1.9's, which is proven, but the name-editing gate is not.
- **AC-1.32** — the cookie fix is verified by hand over the LAN. A test would need Playwright to hit a non-localhost origin.
- **Offline reload** — still `test.fixme` in `e2e/offline-sync.spec.ts`, diagnosed in AGENTS.md. Queued writes are unaffected.

Photo **accuracy** stays outside this table by design: the suite stubs vision so AC-1.9 can be asserted against a fixed set of items. For a label the probe runs the same pure arithmetic the app does, so the only thing left to judge by eye is whether the digits were read right.

---|---|---|
| AC-1.1 | `e2e/log-food.spec.ts` — two taps in airplane mode | ✅ |
| AC-1.2 | `lib/domain/food/parseQuantity.test.ts`, 31 cases | ✅ |
| AC-1.3 | — | ❌ no test. The cascade returns citations, but nothing asserts they reach the screen or that a total failure is visible. |
| AC-1.4 | `upsertFood` + `unique (name_norm, brand) nulls not distinct` | ✅ schema-enforced |
| AC-1.5 | `lib/domain/macros.test.ts` grades it; the `UNVERIFIED` chip is **not** asserted in any UI test | ⚠️ half |
| AC-1.6 | **Verified by probe** against live Postgres: correcting `White rice (cooked)` moved `foods.kcal` 126.05 → 999 and `version` 1 → 2, while the log entry held 252.10 kcal and `food_version` 1 | ⚠️ proven once by hand, no automated regression test |
| AC-1.7 | `e2e/today.spec.ts` — displayed totals vs `SUM` | ✅ |
| AC-1.8 | `e2e/today.spec.ts` — targets from the active row | ✅ |
| AC-1.9 | `e2e/photo-log.spec.ts` — review writes nothing; discard writes nothing | ✅ |
| AC-1.10 | `e2e/log-food.spec.ts` — segments, then two entries | ✅ |
| AC-1.11 | `e2e/offline-sync.spec.ts` — replayed flush does not duplicate | ✅ |
| AC-1.12 | `e2e/photo-log.spec.ts` (vision 500 → typing still works) + `lib/ai/router.ts` | ✅ |
| AC-1.13 | `merge_foods` built and probed: `times_logged` 3+7 → 10, 1 entry repointed, loser deleted, old spelling still resolves via alias | ⚠️ proven by probe, not by test |
| AC-1.14 | Seed round-trips `SAVAS Milk Protein ココア`; no dedicated test | ⚠️ half |
| AC-1.15 | — | ❌ prompt instructs it; nothing asserts it. Needs a real panel photo. |
| AC-1.16 | Guaranteed structurally — `readLabel` is pure and the model returns no computed field | ⚠️ by construction, untested |
| AC-1.17 | `totalCarbs` implements it | ❌ no unit test yet |
| AC-1.18 | `readLabel` + `slackFor` implement it | ❌ no unit test yet |
| AC-1.19 | `readLabel` implements it | ❌ no unit test yet |
| AC-1.20 | Same commit path as AC-1.9, which is proven | ⚠️ inherited, not asserted for the label screen |
| AC-1.21 | Two-step read/save; `canSave` gates an empty name | ❌ no test yet |
| AC-1.22 | Guaranteed by `upsert onConflict (name_norm, brand)` | ⚠️ schema-enforced, untested |
| AC-1.23 | `library_foods` / `library_counts` probed against live data (282/188/58/2) | ⚠️ probed, untested |
| AC-1.24 | `not exists` guard in SQL, not the counter | ⚠️ probed, untested |
| AC-1.25 | **Probed after the 0011 fix**: `Whey + almond milk` (counter 67, 0 entries) is now deletable; `White rice (cooked)` (counter 187, 5 entries) stays blocked and `delete_food_if_unreferenced` returned false | ⚠️ probed, untested |
| AC-1.28 | Probed: 187 → bump 188 → unbump 187, and unbump floors a zero counter at zero | ⚠️ probed, untested |
| AC-1.29 | **Probed in a real browser**: stepping back from 06 AUG reached the 14 entries on 05 AUG with the correct phase label; 02 AUG (before the first target) showed the no-target copy; SQL predicate checked across five dates | ⚠️ probed, untested |
| AC-1.30 | Probed: the sheet's date chip read `2026-08-05` when opened from that day | ⚠️ probed, untested |
| AC-1.31 | **Probed in a browser** (service workers blocked): 500 → `CANNOT REACH THE SERVER`, 404 → `THIS DEVICE IS LOCKED OUT`, and `TRY AGAIN` recovers | ⚠️ probed, untested |
| AC-1.32 | **Probed over the LAN**: `Set-Cookie` has no `Secure` on plain http and the cookie sticks (17 entries load); an `x-forwarded-proto: https` request still gets `Secure` | ⚠️ probed, untested |
| AC-1.26 | Probed: `cannot merge piece basis into g basis` raised | ⚠️ probed, untested |
| AC-1.27 | `trustOf` is pure | ❌ no unit test yet |

Two gaps carry real risk and are P1f work: **AC-1.6** (silent history rewrite would corrupt every past day) and **AC-1.3** (a silent citation failure is exactly the spreadsheet's failure mode returning).

The label ACs are **written but unproven** — the arithmetic exists and is pure, so it is cheap to test, and AC-1.17 / AC-1.18 / AC-1.19 are pure-function tests that need no model and no browser. They are the first thing to write when tests resume.

Photo **accuracy** is deliberately outside this table. The suite stubs vision so AC-1.9 can be asserted against a fixed set of items; whether the model reads a real plate or a real panel correctly is a human judgement made with `npm run probe:vision <photo>`. For a label the probe prints the transcription *and* runs the same pure arithmetic the app would, so the only thing left to check by eye is whether the digits were read right.

---

## 7. Edge cases

| Case | Handling |
|---|---|
| Same food logged twice in a minute | Allowed. Real behaviour (two coffees). No dedupe. |
| Zero-macro entry (water, black coffee) | Allowed, `kcal: 0`. Not an error. |
| Non-food input (`nutrition planning session`) | Rejected at parse with "That doesn't look like a food". The spreadsheet had exactly this row polluting a day as 0 kcal / "Low protein". |
| Amount > 2000 g | Confirm prompt: "2,000 g of rice — is that right?" |
| Restaurant / mixed dish | `is_composite_dish` → cap `medium`, `EST` chip, `reasoning` shown |
| Cross-timezone travel | `logged_on` from device local; editable per entry |
| Photo with no recognisable food | Empty candidates + "Couldn't identify food. Type it instead?" |
| AI returns 0 for everything | Fails validation (`kcal 0` with named non-zero food) → retry once → manual entry |
| Alias collides with another food's name | Rejected with a pointer to the conflicting food |
| Library grows past ~2,000 foods | Trigram index handles it; add pagination to library view at 500 |
| User logs for a past date | Supported via date picker; `logged_at` retains real insert time |

---

## 8. Instrumentation

Every entry records `resolved_by`, `confidence`, and resolution latency. Every AI call writes to `ai_usage_daily`. Weekly self-check the coach can read:

- Library hit rate (target ≥ 80%)
- AI calls per day (should trend down)
- p50 / p90 log latency by resolution source
- Entries by confidence (data-quality trend)
- Sync queue failures (must be 0)

---

## 9. Explain Like in High School

**The one idea behind this feature.** Ask the AI once per food, then never again.

The first time you eat `sukiya gyudon mini`, the app doesn't know it. It asks an AI, which searches the web for real nutrition facts, and gets back: about this many calories per 100 grams, this much protein, and here are the links where I found it. The app writes that into its own list of foods.

The second time you eat it — and every time after — there's no AI, no internet, no waiting. It's just a lookup, like checking a phone contact. So the app gets faster and cheaper the longer you use it, which is the opposite of how most AI apps work. And because we're importing the 279 foods you've already logged, it starts out already knowing most of what you eat.

**Why we don't let the AI parse "200g white rice".** It'd work. It'd also be slow, cost quota, and need internet — for a job that a bit of ordinary code does perfectly in under a millisecond. So a plain function pulls out the number, the unit, and the food name. AI is reserved for the one thing only AI can do: knowing what's *in* a food it's never seen.

General principle: never spend AI on something deterministic code can do. It's slower, more expensive, and less reliable.

**Why the AI has to search the web instead of just answering.** Language models are trained on text and then frozen. Ask one for the calories in a specific convenience-store product and it'll produce a confident, specific, plausible number that it essentially made up — because it's a text predictor, and made-up numbers look exactly like real ones.

Google's API can let the model actually *search* mid-answer and hand back the links it used. Now the number has a source you can click. That's the difference between an answer and a guess that looks like an answer.

**The Atwater check — catching the AI when it's confidently wrong.** There's a fixed relationship in nutrition: protein and carbs are 4 calories per gram, fat is 9. So if the AI says a food has 20g protein, 30g carbs, and 10g fat, the calories *must* be about (20×4)+(30×4)+(10×9) = 290.

If it also says "450 calories", something is wrong — and the app can detect that automatically, without knowing anything about the food. It's just arithmetic that has to hold.

This is genuinely important because it's the AI's most common failure mode here: each individual number looks reasonable, but they don't add up together. Any human eyeballing it would accept it. The maths catches it. Anything failing the check gets marked *unverified* and shown to you, rather than quietly stored as fact.

There's a second check too: for a 100 g food, protein + carbs + fat obviously can't exceed 100 g. Sounds too obvious to need checking. It gets caught regularly.

**Why "per 100 grams" and not "this meal was 252 calories".** This is the design's foundation and worth repeating.

Your spreadsheet stored the *total* for each meal, with the quantity in a separate text column like `"200g"` or `"1 cup / 125 g"` or `"—"`. So the connection between the amount and the calories only existed in your head at the time you typed it. Later, eating 150g instead of 200g meant no way to recalculate — the maths was gone.

We store the *rate* — calories per 100 g — plus the amount, separately, as real numbers. Any amount becomes computable, forever. It's the difference between writing down "60 km per hour" and writing down "we went 120 km": one lets you work out any journey, the other is a dead end.

**Why fixing a food doesn't change your history.** Say you realise your rice numbers have been slightly off. You fix them. Should last month's chart change?

No — and this matters more than it sounds. If corrections silently rewrote history, your trend lines would shift under you every time you tweaked anything, and you could never trust a graph again. So each log entry keeps a frozen copy of the numbers as they were understood *that day*. The fix applies going forward. If you specifically want an old day recalculated, there's a button — but you have to press it.

**Why photos ask you for the grams.** AI vision is genuinely good at *identifying* food — it'll spot rice, chicken, and kimchi on a plate reliably. It's genuinely bad at *how much*, because judging weight from a flat image is hard even for people.

So the app splits the job along that line: it fills in the names, and it puts your cursor in the grams field. It uses the AI for what it's good at and you for what you're good at. It will never quietly log a guessed portion size.

**Photographing the label instead of the food — the exact path.** Most of the time you're not photographing a plate, you're photographing the little table on the back of a packet. That's a completely different situation, and it's a much better one.

A plate is a *guess*. A label is *printed*. Someone in a lab measured that product and the law requires the number on the packet. There's nothing to estimate — the answer is right there in ink.

So the app uses one camera button for both and lets the model work out which it got. Making you choose "food or label?" before every shot would cost you a tap to save a decision the model makes for free. And if a label is readable, it always wins — even if food is in the same photo. Given an exact answer and a guess, take the exact one.

**The rule that makes a label deterministic: the AI is only allowed to read.** This is the important part.

The model's entire job is transcription — copy the digits off the packet. It is explicitly forbidden from adding, converting, scaling, or filling in anything that isn't printed. If a value isn't on the label, it must return "not printed" rather than a plausible number.

Every calculation happens afterwards, in ordinary code you can read: totalling the carbs, checking the calories, deciding what to store. That's what "deterministic" means here — put the same label in twice and you get exactly the same macros out, because the maths never involves a model. And when something looks wrong, you can point at the line of code that produced it. You can't do that with a number a model computed in its head.

Same principle as not letting the AI parse "200g white rice", applied one level deeper: **the model reads, the code calculates.**

**The Japanese label trap that would have quietly wrecked the numbers.** Japanese labels have three carbohydrate-ish rows and they mean different things:

- 炭水化物 — total carbohydrate, fibre included
- 糖質 — total *minus* fibre
- 食物繊維 — the fibre itself

And Japanese protein bars and diet foods very often print **糖質 and 食物繊維 with no 炭水化物 row at all** — which the law allows. If you read 糖質 as "carbs", you undercount every one of those products, permanently, in your own library. So the app adds them back: 炭水化物 = 糖質 + 食物繊維. If only 糖質 is printed, it says so instead of pretending fibre is zero.

**Why the calorie check had to be rebuilt for labels.** Remember the Atwater check — calories should equal 4×protein + 4×carbs + 9×fat, and anything more than 20% off gets flagged.

That check is *wrong* for a label, and it took reading the actual regulations to see why: **the numbers on a packet are rounded before they're printed.** Japan rounds protein, fat and carbs to whole grams. The US rounds *calories* to the nearest 10 above 50.

Take a 30-calorie item with whole-gram macros. Each gram could be off by half a gram in either direction, and half a gram of fat is 4.5 calories. Add up all the slack and the honest range is about ±8.5 calories — which on 30 calories is 28%. The old 20% test would flag a completely legitimate label as untrustworthy.

So instead of asking "is it within 20%?", the app works out the range the printed macros *could* mean — say 41 to 48 calories — and asks whether the printed number lands inside it. If it does, the label is consistent and you're told so. If it doesn't, something really was misread, and you're told which numbers to check.

Same mistake as the fibre bug found earlier: a check that looked reasonable was rejecting food that was fine. Both were only findable by reading what the numbers actually mean rather than trusting the formula.

**A free second check: labels with two columns check themselves.** Lots of labels print both "per 100 g" and "per serving". Those two columns have to be multiples of each other. If they aren't, a digit got misread somewhere — and that's an error the calorie check can't catch, because a wrong digit in one column is perfectly self-consistent within that column.

**Why a label screen looks different from a plate screen.** The plate screen has to say "these are estimates, check them". A label has earned the opposite: it opens with a green tick and *"the numbers add up — 44 kcal printed, the macros imply 41–48"*, then reproduces the panel exactly as it was read, Japanese terms and all, so you can hold the phone next to the packet and compare row by row.

Then one field: how much did you have. Everything above it is printed fact. That's the only thing left that the app genuinely cannot know.

**Why it can't guess that 1 egg = 50 grams.** If a food's stored per-piece and you ask for grams, and nobody's told the app how much a piece weighs, it *stops and asks*. It doesn't guess.

That's a deliberate choice. A guessed conversion is a wrong number that looks identical to a right one, and it'll sit in your data forever quietly skewing your averages. Better to ask once.

**Deltas instead of fractions.** `2,090 / 2,350` makes you subtract. `▼ −260` just tells you. Small thing, but you look at this twenty times a day.

**Why the confidence chips exist.** Not all numbers deserve equal trust. A packaged food's label is near-exact. A homemade mapo tofu genuinely varies by whoever cooked it. Pretending both are precise is dishonest, and it'd make you doubt the numbers that *are* good.

So each entry carries a confidence level, and the trends page shows what fraction of your data is verified versus estimated. If your protein average is built mostly on guesses, you should be able to see that.

**Why totals are calculated by the database, not the app.** Small but real: the same SQL query powers the number on your Today screen, the bars on your trends chart, and the coach's answer when you ask about protein. One query, three consumers — so they physically cannot disagree.

Your spreadsheet had exactly this bug in reverse: the Daily Summary tab was missing 21 days that Food Logs had, so the trend view and the raw data told different stories, and neither flagged it.
