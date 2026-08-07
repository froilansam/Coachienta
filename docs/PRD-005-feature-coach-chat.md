# PRD-005 · Feature 3 — Coachienta AI Chat

| | |
|---|---|
| **Status** | Draft v1 · 2026-08-06 · Phase P4 |
| **Depends on** | PRD-000, PRD-001 (§2 routing, §3.5 retrieval), PRD-006 (rules & profile), P1–P3 data |
| **Core thesis** | Most fitness questions are arithmetic questions. Vector search cannot do arithmetic. So the coach gets SQL tools first, and semantic search second. |

---

## 1. Problem

The request was "index db vector so I could create ai chat". Vector search is necessary but **not sufficient**, and shipping it alone is the single most common way AI fitness chatbots end up confidently wrong.

Here is the failure, concretely. Ask *"what was my average protein last week?"*

- **Pure RAG** embeds the question, finds the 5 most *semantically similar* documents, and hands them to the model. The model sees a handful of days, averages those, and states a precise number with total confidence. It is wrong, because an average needs **every** row, exactly, and arithmetic — not the most similar rows.
- **SQL tool** runs `SELECT AVG(protein_g) ... WHERE logged_on BETWEEN ...` over all 7 days and returns one exact number.

Now ask *"what did I eat on days I felt strongest?"* — SQL can't do that, because "felt strongest" isn't a column. Vector search can.

**So Coachienta is a tool-calling agent with two retrieval modes**, and picking correctly per question is the feature.

| Question type | Retrieval | Example |
|---|---|---|
| Aggregation / comparison / counting | **SQL tools** | "average protein last week", "am I progressing on lateral raises", "how many sessions this month" |
| Semantic / narrative / recall | **Vector search** | "what did I eat when I felt strongest", "when did I last mention shoulder pain" |
| Policy / rules | **Direct fetch** (always injected) | "what's my calorie target", "should I do obliques" |

---

## 2. User stories

| ID | Story | Priority |
|---|---|---|
| US-3.1 | As Froye, I ask about my numbers and get exact answers, not estimates from a sample. | P0 |
| US-3.2 | As Froye, the coach always uses my *current* weight, targets and phase — never a stale figure. | P0 |
| US-3.3 | As Froye, I see which data the coach used, so I can check it. | P0 |
| US-3.4 | As Froye, replies stream so it feels responsive. | P0 |
| US-3.5 | As Froye, the coach respects my critical rules (OHP first, no heavy obliques, jaw-surgery constraints). | P0 |
| US-3.6 | As Froye, I can ask fuzzy questions about past patterns and get useful answers. | P1 |
| US-3.7 | As Froye, I can switch AI provider, or it switches itself when quota runs low. | P1 |
| US-3.8 | As Froye, the coach flags contradictions in my own data instead of guessing. | P1 |
| US-3.9 | As Froye, I get suggested prompts drawn from my real data. | P2 |
| US-3.10 | As Froye, conversations persist so I can continue later. | P2 |

---

## 3. Architecture

```
User message
   │
   ├─ ASSEMBLE SYSTEM PROMPT  (fresh every turn, never cached)
   │    • persona          ← coach_rules WHERE category='persona' AND is_active
   │    • hard facts       ← profile + LATEST body_measurements + ACTIVE nutrition_targets
   │    • critical rules   ← coach_rules WHERE is_critical AND is_active
   │    • output contracts ← coach_rules WHERE category='output_format'
   │    • tool catalogue
   │
   ├─ MODEL TURN  (Groq llama-3.3-70b primary · Gemini Flash fallback)
   │    └─ may call tools, possibly several, possibly in parallel
   │         ├─ SQL tools      → exact numbers
   │         ├─ search_logs    → pgvector semantic
   │         └─ get_rules      → policy lookup
   │
   ├─ TOOL RESULTS fed back → model composes answer
   │
   └─ STREAM to client, with a collapsible "data used" panel
```

### 3.1 Why the system prompt is rebuilt every turn

This is the direct fix for the worst spreadsheet defect. The Coach Agent tab hardcoded `Current Weight | 64kg` and derived `BMR ~1,619 / Gym TDEE ~2,509` from it. Actual current weight is **70 kg**. Every calorie number in that prompt was wrong, and the tab was simultaneously designated "source of truth".

Here, facts are **queried, not stored as prose**:

```ts
// lib/domain/coach/assemblePrompt.ts
export async function assembleSystemPrompt(): Promise<string> {
  const [profile, latestBody, activeTargets, rules] = await Promise.all([
    getProfile(),
    getLatestBodyMeasurement(),      // ← ONE row. today's truth.
    getActiveNutritionTargets(),     // ← ONE row (unique index guarantees it)
    getActiveCoachRules(),           // ← ordered by priority, superseded excluded
  ])
  // BMR/TDEE computed live from latestBody, never read from text
  const bmr = mifflinStJeor(latestBody.weight_kg, profile.height_cm, age, profile.sex)
  ...
}
```

The coach *cannot* cite a stale weight, because no stale weight exists anywhere it can reach.

### 3.2 Tool catalogue

Typed, parameterised, read-only. Each maps to a Postgres function. Zod schemas define the parameters — no free-form SQL from the model, ever (no injection surface).

**Nutrition**

| Tool | Params | Returns |
|---|---|---|
| `get_nutrition_summary` | `start_date, end_date, group_by: day\|week` | kcal, protein, carbs, fat, entry count, target deltas per bucket |
| `get_nutrition_averages` | `start_date, end_date` | mean/median/SD per macro, days on target, longest streak |
| `get_food_frequency` | `start_date, end_date, limit` | top foods by count and kcal contribution |
| `get_target_adherence` | `start_date, end_date` | days met/missed per macro, and by confidence level |

**Training**

| Tool | Params | Returns |
|---|---|---|
| `get_session_summary` | `start_date, end_date` | sessions with sets, eligible volume, PR count, duration, gym |
| `get_exercise_progression` | `exercise_name, gym_scope, limit` | chronological top sets, est. 1RM trend, plateau flag |
| `get_volume_by_muscle_group` | `start_date, end_date` | eligible volume + set count per group, **plus `unattributed`** |
| `get_prs` | `start_date, end_date` | PRs with kind, previous best, gym |
| `get_next_targets` | `gym_id` | live `next_session_targets()` output with `basis` |
| `get_priority_adherence` | `start_date, end_date` | stated priority order vs actual volume/set share |

**Body & policy**

| Tool | Params | Returns |
|---|---|---|
| `get_body_trend` | `start_date, end_date` | weight, BF%, waist series + fitted weekly rate of change |
| `get_active_targets` | — | the one active `nutrition_targets` row |
| `get_coach_rules` | `category?` | active rules with precedence |

**Semantic**

| Tool | Params | Returns |
|---|---|---|
| `search_logs` | `query, kinds[], date_range?, limit` | top-k `rag_documents` by cosine similarity, with `ref_date`/`ref_id` |

**Tool design rules:**
- Every numeric tool returns the `row_count` it aggregated over. The model is instructed to state coverage ("across 7 logged days"). Prevents confidently averaging 2 days and calling it a week.
- Date params are always explicit `date` strings. The model resolves "last week" → dates using a `today` value injected in the prompt. Never let the model assume today's date.
- Tools return **empty results, not errors**, when there's no data. `{ rows: [], row_count: 0 }` lets the model say "you have no sessions logged in that range" instead of hallucinating.

### 3.3 Vector index — embed digests, not rows

Embedding 980 individual food rows would be wasteful and would retrieve badly — a single row (`White rice, 200 g, 252 kcal`) has almost no semantic content. One coherent document per day retrieves far better.

| `doc_kind` | Granularity | Content |
|---|---|---|
| `day_nutrition` | 1 per logged day | Date, day type, totals vs targets, every food with amounts, notable notes |
| `workout_session` | 1 per session | Date, gym, session name, each exercise with top sets, PRs, subjective notes |
| `body_trend` | 1 per measurement | Weight, BF%, waist, delta from previous |
| `profile` | 1 | Goals, constraints, physique targets |
| `coach_rule` | 1 per rule | So the coach can retrieve its own policy semantically |
| `note` | 1 per free note | Ad-hoc observations ("shoulder felt off today") |

**Digest rendering** is a pure function (`lib/domain/coach/renderDigest.ts`) producing readable prose — a good digest reads like a training-diary entry, because that is what the embedding model handles best.

**Embedding config** (PRD-001 §2.3): `gemini-embedding-001`, **768 dims**, `taskType: RETRIEVAL_DOCUMENT` for indexing, `RETRIEVAL_QUERY` for search. Asymmetric task types measurably improve retrieval and cost nothing.

**Re-embed only on change:** `content_hash` compared before every embed call. A day is re-embedded only if its log actually changed. In steady state this is ~2 embed calls/day.

**Backfill:** on P4 rollout, render + embed all existing days and sessions in a batched job. At ~500 docs this is a few minutes and well inside free tier.

> ⚠️ Embeddings are **Gemini-only** — Groq offers no embedding model (PRD-001 §2.1). Single-provider dependency, PRD-000 R4. Mitigation: cache permanently; if Gemini is unavailable the chat degrades to SQL-tools-only, which still answers most questions because most questions are aggregations.

### 3.4 Token budget — the real constraint

Groq `llama-3.3-70b-versatile` free tier: **100,000 tokens/day**, 12,000 TPM, 1,000 RPD. A naive implementation resending full history plus generous retrieval would exhaust that in ~20 exchanges.

| Component | Budget | Strategy |
|---|---|---|
| System prompt | ≤ 1,200 tok | Rules are terse; only `is_critical` + `persona` + `output_format` injected in full |
| Conversation history | ≤ 1,500 tok | Last 6 turns verbatim; older turns replaced by a rolling summary |
| Tool results | ≤ 2,000 tok | Tools return aggregates, not rows. `limit` defaults enforced server-side. |
| Vector results | ≤ 1,500 tok | top-k = 4, digests truncated to 400 tok each |
| **Total input** | **≤ 6,200 tok** | ≈ 16 full exchanges/day at the 100 K cap |
| Output | ≤ 800 tok | Instructed brevity; matches the persona anyway |

Escalation policy: trivial turns ("thanks", "ok") route to `llama-3.1-8b-instant` (500 K TPD — effectively unlimited). Only substantive coaching turns spend the 70B budget.

### 3.5 Provider switching (US-3.7)

Vercel AI SDK gives one interface over both. Switching is a model handle, not a rewrite.

```ts
const model = decision.provider === 'groq'
  ? groq('llama-3.3-70b-versatile')
  : google('gemini-3.6-flash')

const result = streamText({
  model,
  system: await assembleSystemPrompt(),
  messages,
  tools: coachTools,
  maxSteps: 5,            // allow multi-hop tool use
  temperature: 0.4,       // low — this is a numbers job
})
```

Manual override in Settings; automatic override by the quota router (PRD-001 §2.4). When degraded, the UI says so quietly: `Using Gemini — Groq daily limit reached`.

### 3.6 Transparency (US-3.3)

Every reply carries a collapsible panel:

```
▸ DATA USED  (3 sources)
  get_nutrition_averages   2026-07-30 → 2026-08-05   7 days
  get_active_targets       1 row
  search_logs              "felt strong"  ·  3 matches
```

Non-negotiable. An AI coach citing numbers you can't verify is worse than no coach — that is precisely how the spreadsheet's agent ended up confidently coaching from a 64 kg bodyweight.

Vector matches link to the underlying day or session. SQL results show the date range and row count.

### 3.7 Contradiction detection (US-3.8)

The coach is instructed to surface conflicts rather than pick silently. Detectors run server-side and inject findings as context:

| Conflict | Coach behaviour |
|---|---|
| Bodyweight vs phase target drifting | "You're at 70.2 kg average vs a 70 kg maintenance target — trending up 0.15 kg/week." |
| Logged activity vs a critical rule | "You logged 3 sets of weighted oblique twist on 5 Aug. Your active critical rule says planks only. Did that change?" |
| Measured BF% breaching a stated ceiling | "Your last reading was 20% against a ≤15% bulking ceiling. Worth revisiting the phase." |
| Priority order vs actual volume | "Shoulders are your #1 priority but got 18% of eligible volume this month, behind back at 31%." |
| Data-quality shortfall | "Only 40% of last week's entries were verified, so treat that protein average as approximate." |

This is the highest-value coaching output in the product, and it is only possible because the data is now typed.

---

## 3.8 Chat surface

Added after Mobbin research (PRD-002 §0). WHOOP Coach is the closest shipped analogue — an AI chat citing the user's own metrics inside a tracking app.

```
✕            COACHIENTA                              ⊕ NEW
─────────────────────────────────────────────────────────────
                        ┌──────────────────────────────────┐
                        │ How was my protein last week?    │  ← user: bubbled
                        └──────────────────────────────────┘

◉  Across 7 logged days you averaged **171.4 g** protein
   against a **160 g** target — over on 6 of 7 days.

   • Lowest was **148 g** on 2 Aug (rest day, 8 entries)
   • Highest **193 g** on 24 Jul
   • Consistency is good; SD **14.2 g**

   Carbs are the gap, not protein. You averaged **214 g**
   against **290 g** on gym days.
                                              👍  👎
   ▸ DATA USED (2 sources)
─────────────────────────────────────────────────────────────
[ What about my carbs? ]  [ Compare to July ]  [ Am I p… ]  →
─────────────────────────────────────────────────────────────
  💬  Ask Coachienta anything                            ↑
  Not medical advice. Respects your post-op constraints.
```

**Committed patterns:**

| Decision | Rationale | Source |
|---|---|---|
| **User messages bubbled; assistant messages unbubbled** | Long numeric answers read as documents, not chat blobs. A 200-word analysis in a grey bubble is unreadable. | WHOOP Coach |
| **Key numbers bolded inside prose** | Free scannability, and it reinforces the instrument voice. Numbers render via `NumericValue` inline. | Alma, WHOOP |
| **Horizontally-scrolling follow-up chips above the input** | Replaces "suggested prompts on first open only". Keeps the conversation moving and teaches what the coach can do. Generated from the answer's context, not a static list. | WHOOP Coach |
| **`▸ DATA USED` collapsed under the message** | Per-message provenance, at the point of the claim (§3.6) | — |
| **👍 / 👎 per assistant message** | Real quality signal, feeds coach-rule tuning | Cal AI |
| **Persistent disclaimer under the input** | Small, always visible. Required given the jaw-surgery constraint. | Superpower, Mindvalley |
| **`Thinking…` with the current tool named** | `Reading your last 7 logged days…` — specific, not generic filler. 4 s of silence reads as broken. | Superpower |
| **Assistant marker is a glyph, not an avatar** | No cartoon coach. Wrong register (PRD-002 §10). | — |
| **Rejected: circular progress rings, celebratory framing** | Wrong aesthetic and wrong register | Ultrahuman, Cal AI |

**Empty state** — Alma's honesty pattern, which independently matches AC-3.13:

> *"I don't have enough logged data yet to spot trends — you're 3 days in. Ask me about today, or about your targets and rules."*

with suggestion chips drawn from whatever data does exist.

---

## 3.9 Build status — P4-1 / P4-2 shipped (tools, streaming chat, model choice)

`POST /api/ai/chat` and `/coach`. **Ten SQL tools, no vector search yet** — deferred with the rest of §3.3 (see *Not built* below).

**The core thesis holds against the real model.** Asked *"what was my average protein last week"* it called `get_nutrition_averages`, resolved the range itself, and answered *"Across **1 logged day**, your average protein intake was **736.9 g**"* — a figure identical to `AVG()` over the same range, with its coverage stated (AC-3.1). Unprompted, it added *"this average is approximate due to a relatively low verified percentage of **64%**"*, which is output contract 5 working.

| Verified live 2026-08-07 | Result |
|---|---|
| Groq 70B tool calling | ✅ works — the `json_schema` limitation that shaped P3-5 does **not** apply to tools |
| First token, warm, production build | **1,486 ms** — inside AC-3.5 |
| First token under back-to-back probing | 15–52 s — Groq's 12,000 TPM ceiling, not the code |
| Real cost per coaching turn | **~6,500 input tokens** → ~15 turns/day, matching §3.4's ~16 |
| Multi-hop | ✅ asked about progression with no data, it then checked whether *any* sessions existed and said so |

**Three defects the probing found, all fixed**

- **Usage was undercounted by half.** `onFinish`'s `usage` is the *final step* only — 52,126 recorded against Groq's ~98,000. That blinded the quota router, so AC-3.9 could never have fired. Now `totalUsage`.
- **"thanks" cost 120 seconds and five tool calls.** It routed to the 8B correctly but still received the tool catalogue, and the small model went fishing. Trivial turns now get **no tools**: ~1.2 s.
- **An identical tool call was issued twice.** Models retry when a result is empty. `readOnly()` memoises per turn and tells the model explicitly that a `row_count: 0` result is final — which is also what makes AC-3.13 hold.

**Design decisions**

- **Provenance is derived, never reported.** `DATA USED` and the `Thinking…` line are read off the tool parts in the stream, so they cannot describe work that did not happen. A receipt assembled separately from the queries is worse than none.
- **The range is the audited part.** Asked twice for "last week" the model chose two different seven-day windows — both defensible, both needing to be stated (§6).
- **`◉`, not an icon or an avatar.** §3.8 draws it; a text mark cannot break when an icon library renames something.
- **No Markdown library.** A ~40 kB dependency plus a sanitiser to render bold and bullets. `lib/domain/coach/richText.ts` handles the subset the model emits and returns *data*, so no model output goes near `dangerouslySetInnerHTML`.
- **Follow-up chips come from the tools that ran** (§3.8 requires context, not a static list) and exclude anything already asked — re-offering the chip just tapped reads as the tap not working.
- **Model choice is a quota decision, so it lives in the header** rather than in settings: you switch at the moment a reply fails. Each option shows its own pool, and a spent one is disabled rather than hidden — an option that vanishes looks like a bug. The client sends a **job key**, never a model id: the same allowlist principle as the tools.
- **Manual choice still passes through the quota router**, so it picks the starting point without switching off the safety margin (AC-3.9).

| AC | Where it is proven | State |
|---|---|---|
| AC-3.1 | `npm run probe:coach` against the real model; figure matches `nutrition_averages` exactly, day count stated | ✅ |
| AC-3.2 | `coachContext()` is the single assembly path, shared with `/profile`'s preview | ✅ by construction, no snapshot test yet |
| AC-3.4 | `e2e/coach.spec.ts` — panel names each tool, its range and its row count | ✅ |
| AC-3.5 | 1,486 ms warm on a production build | ⚠️ met warm; 15 s+ once Groq's 12k TPM throttles |
| AC-3.9 | `e2e/coach.spec.ts` renders the fallback chip; the router can now see real usage | ⚠️ UI proven, live switch not observed (Google's 20/day was spent) |
| AC-3.10 | `e2e/coach.spec.ts` — named state with a retry, and the tab bar still navigates | ✅ |
| AC-3.11 | `budget.test.ts` — trimming, and a per-component cap that bites before the total | ✅ |
| AC-3.12 | Tools are Zod-validated; no free-form SQL path exists | ✅ by construction |
| AC-3.13 | `e2e/coach.spec.ts` + the real model on an empty March | ✅ |
| AC-3.15 | `runChecks` findings injected into the prompt | ⚠️ injected, not yet asserted end-to-end |
| AC-3.3 / AC-3.6 / AC-3.7 | — | ❌ not asserted; need a live turn per case |
| AC-3.8 / AC-3.14 | — | ❌ `search_logs` and embeddings are not built |

**Not built (deferred, deliberately)**

| Piece | Why |
|---|---|
| §3.3 vector index, digests, `search_logs` (US-3.6, AC-3.8, AC-3.14) | The exit criteria are both aggregations, and §1's own argument is that most questions are. `rag_documents` and pgvector already exist from migration 0001, so this is additive. |
| 👍 / 👎 per message (§3.8) | It "feeds coach-rule tuning", which needs persistence. A button that discards the signal is worse than none. |
| Conversation persistence (US-3.10) | The thread is in memory; `NEW` clears it. Needs a table, and it pairs naturally with the feedback signal. |
| Rolling summary past 6 turns (§3.4) | Older turns are **dropped**, not summarised. The metadata reports `droppedTurns` so it is visible rather than silent. |

---

## 4. Persona & output contracts

Sourced from `coach_rules` (PRD-006), not hardcoded. Migrated from the spreadsheet's 119 rule rows.

**Persona:** direct, specific, data-driven. Cites actual numbers, never generalities. Taglish acceptable in casual exchanges. Never vague. Tough where warranted, supportive where earned.

**Output contracts** carried over from the spreadsheet's `Output Format` rules (7 rows) — they were good rules that the sheet couldn't enforce:

| Contract | Requirement |
|---|---|
| Nutrition progress | Table with exactly `Taken · Goal · Remaining` |
| Workout plan | Columns `Exercise · Last Sets · Today Target · Progress Goal`. **Last sets never omitted.** Prefer linking into Train’s draft plan (`POST /api/ai/plan-workout` / same schema as PRD-004 §4.2a) rather than a chat-only table the user cannot edit into a session. |
| Single-exercise plan | Set-by-set rows: `Set · Kind · Last Set · Today Target · Progress Goal` |
| Food gap advice | Name specific foods with numbers — "add 2 tbsp peanut butter: +190 kcal, 8 g protein" — never "eat more calorie-dense foods" |
| Uncertainty | Flag estimates explicitly; never present an estimate as measured |
| Recovery constraints | Respect jaw-surgery limits (soft-food bias, no Valsalva unless cleared) in every recommendation |

---

## 5. Acceptance criteria

| ID | Criterion |
|---|---|
| AC-3.1 | "What was my average protein last week?" returns a value **exactly** matching `SELECT AVG(...)` over the same range, and states the day count. |
| AC-3.2 | System prompt contains the latest `body_measurements` weight and the single active target. Verified by snapshot test. |
| AC-3.3 | Changing the active target row changes the coach's next answer with no code change or restart. |
| AC-3.4 | Every reply with a numeric claim shows a "data used" panel naming the tools and ranges. |
| AC-3.5 | First token arrives < 2 s p90 on the primary provider. |
| AC-3.6 | Asked to plan a push session, the coach places shoulder press before chest work, per the active critical rule. |
| AC-3.7 | Asked about oblique work, the coach cites the active critical rule rather than programming it. |
| AC-3.8 | `search_logs` returns relevant days for "when did I feel strongest" and the answer links to them. |
| AC-3.9 | With Groq quota exhausted, the chat completes on Gemini and the UI indicates the switch. |
| AC-3.10 | With **all** AI unavailable, `/coach` shows a clear state and the rest of the app remains fully usable. |
| AC-3.11 | Total input tokens per turn ≤ 6,200. Asserted in tests. |
| AC-3.12 | Model cannot execute arbitrary SQL. Tool params are Zod-validated; injection attempt is rejected. |
| AC-3.13 | Asking about a range with no data yields "no data logged in that range", never an invented number. |
| AC-3.14 | Re-embedding is skipped when `content_hash` is unchanged. Verified by call count. |
| AC-3.15 | Coach surfaces at least one real contradiction from current data when asked "how am I doing?". |

---

## 6. Edge cases

| Case | Handling |
|---|---|
| Question spanning food *and* training | Multiple tools in one turn; `maxSteps: 5` |
| Vague date ("recently") | Model resolves against injected `today`, then **states the range it chose** |
| Asks about a food never logged | Tool returns empty; coach says so and offers to look it up |
| Contradictory user instruction vs critical rule | Coach names the conflict, asks whether the rule changed. Does not silently override. |
| Very long conversation | Rolling summary past 6 turns; summary itself capped |
| Asks for medical advice | Defers, cites the jaw-surgery constraint, recommends clinical clearance |
| Asks about a date range before any data | Returns empty honestly; suggests the earliest available date |
| Model attempts a tool that doesn't exist | Rejected; error fed back; retry once |
| Provider returns malformed tool args | Zod rejects; error fed back for self-correction; then fail visibly |
| User asks "are you sure?" | Coach re-runs the tool and shows the raw figure |

---

## 7. Explain Like in High School

**The mistake almost every AI fitness app makes.** You asked for a vector index so you could chat with your data. That's the right instinct, and on its own it will give you wrong numbers. Here's why, because it's worth understanding properly.

**What a vector actually is.** A model can turn any text into a long list of numbers — say 768 of them — that represents its *meaning*. "Chicken breast" and "grilled poultry" end up with similar lists, even though they share no words. So you can search by meaning instead of by keyword. That's a genuinely powerful thing, and it's what people mean by "vector search" or "RAG".

**Where it breaks.** Ask *"what was my average protein last week?"*

Vector search finds the handful of documents most *similar* to your question. It might return four of your seven days. The model averages those four and gives you a precise-sounding number. It's wrong — and nothing about the answer looks wrong.

The problem is that an average is *arithmetic over a complete set*. "Most similar" and "all of them" are different ideas. Vector search is built for relevance; it has no concept of completeness.

**The fix: give the coach a calculator.** Instead of just handing the model documents, we give it a set of buttons it can press — real database queries, written by us, that it's allowed to call:

- `get_nutrition_averages(start, end)` → runs actual SQL over every row in that range
- `get_exercise_progression("lateral raises")` → pulls every top set in order
- `get_volume_by_muscle_group(start, end)` → sums properly

The model decides *which* button to press and what dates to use. The database does the maths. So the number is exact by construction, not by luck.

And we keep vector search for what it's genuinely good at: *"what did I eat on days I felt strong?"* — "felt strong" isn't a column in any table, so SQL can't touch it, but it's a meaning you can search for.

**Two tools, and the model picks.** That's the whole design. Most fitness questions are secretly maths questions, so most of the time it uses SQL. The fuzzy ones get vector search. Getting that split right is the feature.

**Why the model can't write its own SQL.** It'd be more flexible, and it'd be a security hole — a model that can write arbitrary queries can eventually be talked into writing a destructive one. So it can only call our pre-written functions with validated parameters. Like giving someone a vending machine instead of the keys to the warehouse.

**How we stop the coach quoting your old weight.** This was your spreadsheet's worst bug. The Coach Agent tab said `Current Weight | 64kg` and computed your calorie needs from that. You actually weigh 70 kg. So every single calorie number in the coach's instructions was wrong — and that same tab was labelled "source of truth".

The fix is a rule: **facts are never written into the prompt as text.** Every time you send a message, the app queries the database fresh for your latest weight, your one active target, and your active rules, and builds the instructions on the spot. Your BMR is calculated live from today's weight, not read from a sentence someone typed in June.

It's not that the coach is told to check. It's that there is no old number anywhere for it to find.

**Why one active target is enforced by the database.** Your sheet had six different calorie targets across six tabs, and four training phases all marked "Active". No reader — human or AI — could tell which was current, so the AI picked the stalest.

There's one line of database code that makes this impossible: a rule saying "only one nutrition target row may have an empty end-date". Try to add a second active target and the write fails. Not a warning, not a convention — physically rejected.

**Why the coach shows its receipts.** Every answer has a panel you can expand showing exactly which queries ran and over what dates. Sounds like a nice-to-have; it's the most important trust feature in the product. An AI that quotes numbers you can't verify is worse than no AI, because you'll believe it. Your spreadsheet's coach was confidently wrong for two months precisely because nothing showed its workings.

**Contradiction detection — the actually useful part.** Because everything is now properly typed, the coach can catch conflicts you'd otherwise find during an audit two months later:

- Your last body-fat reading was 20%. Your rules say stay under 15% while bulking. That's a stop condition that already fired and nothing noticed.
- You logged weighted oblique twists on 5 August. Two of your own rules mark "no heavy obliques" as critical. Nothing flagged it — partly because those sets landed in a spreadsheet tab nothing read.
- Shoulders are your stated #1 priority. Where did your volume actually go?

That last one is the kind of thing that changes what you do on Monday. A spreadsheet can't tell you; a typed database can.

**Why the coach reads summaries instead of individual rows.** If we turned each of your 980 food rows into a vector, searching would be useless — a single line reading `White rice, 200 g, 252 kcal` carries almost no meaning on its own.

Instead we write one readable paragraph per day: what you ate, the totals, how it compared to target, anything notable. That reads like a diary entry, which is exactly what meaning-based search works well on. Same for each workout session. About 500 documents instead of 2,000 fragments, and much better results.

We also only redo this when a day actually changes — each document carries a fingerprint of its content, and if the fingerprint matches, we skip the work. That keeps this nearly free.

**The token budget, and why we're careful.** Models charge by *tokens* — roughly ¾ of a word. Groq's free tier gives 100,000 tokens a day on the good model. Sounds enormous.

But every message resends the entire conversation *plus* the system instructions *plus* whatever data got retrieved. A careless build burns through 100,000 in about twenty messages.

So: keep only the last six turns verbatim and summarise the rest, have tools return summaries rather than raw rows, cap retrieved documents at four, and route trivial replies ("thanks") to the small fast model, which has effectively unlimited free quota. That gets us to roughly 16 real coaching conversations a day, which is well past what anyone actually uses.

**The one piece with no backup.** Groq doesn't offer text-to-vector conversion at all — only Google does. So the meaning-based search depends entirely on Google's free tier.

If that goes away, the coach falls back to SQL tools only. Which is genuinely fine for most questions, since most of them are maths anyway. Worth knowing up front rather than discovering it, which is why it's written down as a named risk rather than buried.
