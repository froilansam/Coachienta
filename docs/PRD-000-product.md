# PRD-000 · Coachienta — Product Requirements

| | |
|---|---|
| **Product** | Coachienta |
| **Type** | Installable PWA (mobile-first, iOS Safari primary; desktop browser secondary) |
| **Owner** | Froilan ("Froye") — sole user and sole stakeholder |
| **Status** | Draft v1 · 2026-08-06 |
| **Supersedes** | `Fitness Hub Organized with Agent Tab - Updated Jul 22.xlsx` (20-tab spreadsheet) |
| **Related** | PRD-001 Technology · PRD-002 Design · PRD-003…006 Features |

---

## 1. Why this exists

The current system is a 20-tab spreadsheet with ~36,350 populated cells. It works as a *record* but has failed as a *system*. The audit found:

- The nutrition Dashboard displays **0 for every macro** because dates are stored as text, so `MIN`/`MAX`/`SUMIF` match nothing.
- The three most recent workouts sit in an **orphaned tab** referenced by zero formulas, and **44 of its 77 rows are column-shifted** by one.
- Six tabs state **six different calorie targets**; four different training phases are simultaneously marked "Active".
- The coach's own profile says **64 kg** while the body-stats tab says **70 kg** — so every TDEE number in the agent prompt is derived from a stale weight.
- Progression suggestions are **57 days stale**, yet the agent is instructed to read them before planning.
- `PR Flag` is a free-text column holding 15 distinct values including the number `80`.

Every one of those is a *class* of defect that a typed database and a real application prevent structurally. That is the product thesis.

**Coachienta is a personal food and training log with an AI coach, where the data model makes the spreadsheet's failure modes impossible.**

---

## 2. Product principles

These are the tie-breakers. When a decision is ambiguous, resolve it against this list in order.

1. **Logging must never be slower than the spreadsheet.** Two taps to log a repeat food. If logging feels like admin, the data stops and the product dies.
2. **Deterministic storage, probabilistic input.** AI may guess *what* a food is and *what* its macros are. Once resolved, it is written as typed numbers with an explicit basis, confidence, and source. Nothing derived is ever stored as prose.
3. **Ask the AI once per food, forever.** Every resolved food goes into a lookup table. Cost and latency decay toward zero as the library fills.
4. **One number has one home.** A target, a bodyweight, a phase — each has exactly one authoritative row. Everything else reads it.
5. **Offline-first at the point of capture.** The gym has bad signal and meals happen on trains. Writes land locally and sync later, always.
6. **Free tier is a hard constraint, not a goal.** The app must stay inside Groq and Google AI Studio free limits under normal daily use.
7. **History is immutable.** Correcting a food's macros today must not silently rewrite what last month's chart says you ate.

---

## 3. User & context

Single user. No multi-tenancy, no sharing, no social features, **and no authentication** — no login screen, no logout, no account, no password. One person, one dataset, so identity is a concept the app doesn't need.

The consequence is architectural rather than cosmetic: with no auth there is no row-level security, so the browser never holds a database credential and all data access runs server-side (PRD-001 §3.6). A single one-time-per-device access token keeps the API routes from being callable by anonymous internet traffic — a doorbell, not a login.

| Attribute | Value |
|---|---|
| Athlete | 27, 179 cm, ~70 kg, ~20% BF (measured 2026-08-04) |
| Goal | Classic V-taper: capped side delts, wider lats/upper back, fuller upper chest, tight waist. Legs proportional, not primary. |
| Phase | 4-week weight-maintenance recomp from 2026-08-04, 2,300–2,400 kcal, 160 g protein daily |
| Training | 4-day split — Push / Pull / Legs / Upper Specialization |
| Constraints | Post-op double jaw surgery (LeFort I + BSSO) — soft-food bias, no Valsalva on heavy compounds unless cleared. No heavy oblique work (waist aesthetics). |
| Language | English primary, Taglish acceptable in casual coach replies. Food names frequently Japanese (Japanese convenience store / restaurant items). |
| Devices | iPhone (Safari) primary. Desktop browser for review and bulk edits. |

### Jobs to be done

| # | Job | Where it happens | Latency tolerance |
|---|---|---|---|
| J1 | "Log what I just ate without looking up macros myself" | Kitchen, restaurant, konbini, train | < 3 s for known food; < 8 s for unknown |
| J2 | "Log the set I just finished before I forget the number" | Mid-workout, phone in hand, possibly no signal | < 1 s, must work offline |
| J3 | "Tell me if I'm on track today" | Any time, glanceable | Instant |
| J4 | "Show me whether I'm actually progressing over weeks" | Sunday review, desktop | < 2 s |
| J5 | "Ask my coach a question grounded in my real numbers" | Evenings, planning next session | < 5 s to first token |
| J6 | "Change my goals and have the coach actually respect them" | Every few weeks at phase change | Immediate effect on next coach reply |

---

## 4. Scope

### Feature 1 — Food logging with AI macro resolution → `PRD-003`
Text or photo input. Deterministic quantity parsing. Cache-first macro lookup; AI + web grounding only on cache miss. Every resolved food persisted to a reusable library with per-100 g basis, confidence and citations. Daily log view, daily totals vs targets, trends and charts.

### Feature 2 — Workout logging → `PRD-004`
Maintained exercise library. Build a plan for the day by **prompt** (`PULL LEGS!`, `Upper Body`), template, or manual pick — AI draft uses coach rules, priorities, and logs; always editable; LAST + BEST on known exercises. Log reps and load per set, offline — **add/remove exercises even mid-session**. Browse **sessions by date** and **delete** a whole session. PRs that are comparable within a gym, progression suggestions, trends and charts.

### Feature 3 — Coachienta AI chat → `PRD-005`
Chat grounded in the user's actual logs. Hybrid retrieval: typed SQL tools for aggregation questions, pgvector semantic search for narrative questions. Provider-switchable between Groq and Google AI Studio. Persona and rules sourced from Feature 4.

### Feature 4 — Profile, goals & agent instructions → `PRD-006`
Editable personal stats; body log with **weight (kg)**, **waist (cm)**, and optional **body fat %** plus monitoring over time; nutrition targets; training phase; and a versioned coach-rules registry with real precedence. This is the single source of truth the coach reads.

### Explicitly out of scope for v1

| Not building | Why |
|---|---|
| Barcode scanning | Japanese konbini barcode DBs are poor; photo + text covers it |
| Wearable / HealthKit sync | No API access from a PWA on iOS |
| Native app | PWA is sufficient and the user asked for browser |
| Recipe builder with nested ingredients | Solve after the flat food library proves itself |
| Multi-user, coaching others, sharing | Single-user product |
| Automatic macro re-computation of past entries | Violates Principle 7 |
| Migrating the 980 food log rows / 1,058 workout sets | Decision: import **lookup tables only** (279 foods, 78 exercises). Spreadsheet retained as read-only archive. |

---

## 5. Success metrics

The product succeeds if it is *used*, and the spreadsheet's defect classes never reappear.

| Metric | Target | How measured |
|---|---|---|
| **Logging adherence** | ≥ 6 of 7 days logged with ≥ 3 entries | `food_log_entries` count by day |
| **Repeat-food speed** | ≥ 80% of entries resolved from local library, zero AI call | `resolution_source` column on each entry |
| **AI cost** | 0 paid requests. Stays inside free tier every day. | Provider call log + daily quota counter |
| **Time to log a known food** | p90 < 3 s from tap to persisted | Client timing |
| **Offline reliability** | 100% of sets logged at the gym persist and sync | Sync queue failure count = 0 |
| **Target coherence** | Exactly 1 active nutrition target row at any time | DB constraint — structurally guaranteed |
| **Coach freshness** | Coach never cites a bodyweight or target older than the newest row | Prompt assembled from live query, not stored prose |
| **Data integrity** | 0 rows with impossible shape | Enums, NOT NULL, CHECK constraints |

---

## 6. Phasing

Ordered by daily value delivered per unit of build effort. Feature 4 precedes Feature 3 because the coach is useless without authoritative goals; Feature 3 is last because retrieval needs data volume to be worth anything.

| Phase | Contents | Exit criteria |
|---|---|---|
| **P0 — Foundation** | Next.js + PWA shell, Supabase schema, auth, design tokens, offline sync harness, import 279 foods + 78 exercises | Installs to iOS home screen, logs a hardcoded row offline, syncs on focus |
| **P1 — Feature 1** | Food logging, AI resolution, food library, day view, daily totals | A full day logged by text and photo without touching the spreadsheet |
| **P2 — Feature 4** | Profile, body log, targets, phase, coach-rules registry | Day view shows targets from DB, not constants |
| **P3 — Feature 2** | Exercise library, day plan (prompt / template / manual), set logging, PRs, progression | A complete gym session from an AI or manual plan, logged offline start to finish |
| **P4 — Feature 3** | Coachienta chat, SQL tools, embeddings + pgvector, provider switch | Coach correctly answers "what was my average protein last week" and "is my lateral raise progressing" |
| **P5 — Polish** | Charts, trends, empty states, delight pass, full a11y and polish audit | `polish` + `audit` skill checklists pass |

---

## 7. Risks

| # | Risk | Severity | Mitigation |
|---|---|---|---|
| R1 | **iOS Safari evicts IndexedDB** after ~7 days unused, losing unsynced writes | High | Cloud is source of truth; request `navigator.storage.persist()`; sync on every focus; warn in UI if queue is non-empty and stale |
| R2 | **No Background Sync API on iOS** | High | Sync-on-focus + sync-on-online + manual pull-to-sync. Never rely on background wake. |
| R3 | **Gemini free tier was cut 50–80% in Dec 2025** and published numbers disagree | High | Build a quota-aware router with a persisted daily counter, degrade to Groq, then to cache-only. Verify live limits in AI Studio before P1. |
| R4 | **Groq has no embedding model** | High | Embeddings are Gemini-only. Documented single-provider dependency. Cache embeddings permanently; only re-embed on content change. |
| R5 | **AI returns confidently wrong macros** | High | Mandatory confidence + source citations; anything below threshold is flagged `unverified` in the UI and excluded from streak claims. User can correct; correction is authoritative forever. |
| R6 | **Volume metric distortion repeats** (spreadsheet: Abs/Core showed 602 kg/set, out-ranking Chest and Legs) | Medium | `load_type` enum on every exercise. Volume computed only for weighted movements; duration work tracked separately and never pooled. |
| R7 | **Gym-switch PR corruption repeats** | Medium | First-class `gyms` table. PRs and progression scoped to gym. Cross-gym comparisons explicitly labelled, never silent. |
| R8 | Logging feels like admin, user reverts to the sheet | High | Principle 1 is a hard gate on every Feature 1 and 2 review |
| R9 | Photo food estimation is inherently imprecise | Medium | Photo yields *candidates*, user always confirms grams. Never auto-commit a photo estimate. |
| R10 | Single user means no one catches bugs | Medium | DB constraints as the primary safety net; typed end-to-end with Zod; no `any` |

---

## 8. Open questions

| # | Question | Blocks | Default if unanswered |
|---|---|---|---|
| ~~Q1~~ | ~~Confirm live Gemini free-tier limits~~ | — | ✅ **CLOSED 2026-08-06.** Verified live: `gemini-2.5-*` returns 404 (retired for new accounts), `gemini-3.6-flash` works, Pro has no free quota, **Google Search grounding has no free quota at all**. Feature 1 re-routed to USDA + Open Food Facts. See PRD-001 §2.2. |
| Q2 | Timezone — Asia/Tokyo assumed from Japanese food entries and receipt timestamps | Day boundaries | `Asia/Tokyo`, stored as `date` not timestamp |
| Q3 | Should the 4-Day Workout Plan be seeded as a template? | P3 | Yes, seed it — it is current and complete |
| Q4 | Keep `Mini Cut Week` as a concept, or replace with generic phase-week? | P2 schema | Generic `phase_week`, computed from phase start date |
| Q5 | Was the 2026-08-05 oblique work intentional (rule change) or a lapse? | Coach rules | Treat rule as still active; coach flags the conflict rather than silently allowing |

---

## 9. Explain Like in High School

**What we're building.** Think of a really smart notebook for food and gym, that lives on your phone like an app but is actually just a website you saved to your home screen.

**The problem with the spreadsheet.** Right now everything is in Excel. Excel doesn't care what you type. If you type a date as *text* instead of a real date, Excel still accepts it — but then when you ask it "what's the latest date?", it answers `0`, because it doesn't actually see dates there. That's why your dashboard says you've eaten 0 calories today. Same story with your PR column: it was supposed to hold "is this a personal record, yes or no", but it ended up holding fifteen different things including the number 80. Excel let it happen because Excel lets everything happen.

**The fix.** A real database has *rules baked in*. You declare "this column holds a date" and it becomes physically impossible to put text there. You declare "muscle group must be one of these eight values" and typos can't sneak in. So the whole category of bug you've been hitting just stops existing. That's the main reason to move off the sheet — not that the app is prettier, but that the app can't lie to you.

**How food logging will work.** You type "200g white rice". The app first checks its own list of foods it already knows. White rice is in there — because we're importing the 279 foods you've already logged — so it instantly knows rice is about 126 calories per 100 grams, doubles it for your 200 grams, and saves it. No internet needed, no waiting, no AI.

Now say you eat something new. You type it, and *this* time the app asks an AI, and the AI is allowed to search Google to find real nutrition facts instead of guessing from memory. It comes back with the numbers, how confident it is, and links to where it found them. The app saves that food into its list. Next time you eat it, it's instant and free — same as the rice. So the app gets faster and cheaper the more you use it. That's the whole trick.

**Why we store "per 100 grams" instead of "per meal".** This is the single most important design choice. Your spreadsheet stored "this meal was 252 calories" and separately "the quantity was 200g" as *text*. So if you later ate 150g instead, there was no way to recalculate — the maths was gone. We store the *rate* (calories per 100g) and the *amount* separately, so any amount can be computed. Like storing "60 km per hour" instead of just "we went 120 km", so you can work out any trip length.

**Why the AI needs to run SQL, not just "search my notes".** There's a popular technique called RAG where you turn your notes into maths (vectors) so an AI can find the most *similar* note to your question. That's great for "what did I eat when I felt strongest?" — a fuzzy, meaning-based question.

But it's genuinely bad at "what was my average protein last week?" Averages need *every single row*, exactly, and arithmetic. Finding the five most similar notes will give you a confident wrong number. So Coachienta gets two tools: real database queries for counting and averaging, and vector search for the fuzzy stuff. It picks the right one per question. Most fitness questions are secretly maths questions, which is why most AI fitness chatbots quietly make numbers up.

**Why offline matters.** Gyms are signal dead zones and basements. If the app needs internet to save a set, you'll lose sets. So it saves to your phone's own storage first — instantly, always — then quietly uploads when signal returns.

There's a catch with iPhones. Android has a proper API for "finish uploading this later even if the app is closed". iOS Safari doesn't have it, and worse, iOS can *delete* a web app's stored data if you don't open it for about a week. So we do two things: treat the cloud as the real home for your data and the phone as a temporary holding area, and upload every single time you open the app rather than hoping the phone does it for us.

**Why the coach kept giving stale advice.** Your spreadsheet's coach prompt says you weigh 64 kg. Your body-stats tab says 70 kg. Every calorie target in the prompt was calculated from 64 kg, so all of it was wrong — and there were six different calorie targets across six tabs, plus four different training phases all marked "Active" at once. The AI had no way to know which to believe, so it believed the stalest one.

In the app, there's exactly *one* row that says what you weigh and exactly *one* that says your current target. The coach reads them fresh every single time it answers. It literally cannot cite an old number, because the old number isn't stored anywhere it can reach.

**What "free tier" means here.** Groq and Google both give away a limited amount of AI per day. We stay inside it by being stingy: cache every food forever, only call AI on genuinely new things, use the cheap fast model for easy jobs and the good model only for real coaching, and keep a counter so that if we're near the daily cap the app switches providers or falls back to its own cached data instead of erroring.

One important constraint we found while researching: **Groq doesn't offer the "turn text into vectors" model at all.** So that specific job can only be done by Google. Everything else can switch between the two. Worth knowing, because if Google's free tier changes, that's the one piece with no backup.
