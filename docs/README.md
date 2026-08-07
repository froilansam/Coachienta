# Coachienta — PRD Set

Installable PWA: food and exercise log with an AI coach. Replaces the 20-tab `Fitness Hub` spreadsheet.

## Read in this order

| # | Document | Covers |
|---|---|---|
| 000 | [Product](PRD-000-product.md) | Why, principles, users, jobs, scope, metrics, phasing, risks |
| 001 | [Technology](PRD-001-technology.md) | Stack, AI provider matrix + free-tier limits, full DB schema, offline/iOS architecture, security |
| 002 | [Design](PRD-002-design.md) | Mobbin reference research, Instrument aesthetic, OKLCH tokens, type/space scales, motion, a11y, screens, flows |
| 007 | [Design System & UI Library](PRD-007-design-system.md) | Three-tier component architecture, 35+ component specs with prop interfaces, variants, states, build order |
| 003 | [Feature 1 — Food logging](PRD-003-feature-food-logging.md) | Cache-first macro resolution via USDA + Open Food Facts, LLM last resort, photo flow, day view, trends |
| 004 | [Feature 2 — Workout](PRD-004-feature-workout.md) | Exercise library, AI prompt / template / manual day plan, live set logging, LAST+BEST, PRs by gym, progression, volume trends |
| 005 | [Feature 3 — Coachienta chat](PRD-005-feature-coach-chat.md) | SQL tools + pgvector hybrid retrieval, prompt assembly, token budget, chat surface, transparency |
| 006 | [Feature 4 — Profile & goals](PRD-006-feature-profile-goals.md) | Effective-dated targets, body log, phases, coach-rules registry with precedence |
| 008 | [Credentials & Setup](PRD-008-credentials-setup.md) | **Start here to build.** Every API key, step-by-step acquisition, verification curls, cost guardrails, security |

Read 002 → 007 together; 007 is the buildable spec, 002 is the direction it serves.

Every PRD ends with an **Explain Like in High School** section.

## Decisions locked

| Decision | Value |
|---|---|
| Aesthetic | **Instrument** — industrial, mono numerals, hairline rules, safety-orange accent |
| Primary device | **iPhone / Safari** — no Background Sync, sync-on-focus, eviction-aware |
| Data | **Cloud + offline cache** — Supabase Postgres/pgvector + IndexedDB mirror, keys server-side |
| Migration | **Lookup tables only** — 279 foods, 78 exercises. Logs start empty. Sheet kept as archive. |
| Auth | **None** — no login, no logout, no account. Browser never holds a DB key; all access server-side. |
| Macro source | **USDA FDC → Open Food Facts → LLM.** Grounded search removed — no free quota. |

## Build order

`P0` foundation → `P1` food logging → `P2` profile & goals → `P3` workout → `P4` coach chat → `P5` polish

Feature 4 precedes Feature 3 because the coach is useless without authoritative goals. Feature 3 is last because retrieval needs data volume.

## The nine spreadsheet defects these PRDs structurally prevent

| Spreadsheet defect | Structural fix | Where |
|---|---|---|
| Dashboard showed **0 kcal** — dates stored as text | `logged_on date` column type | 001 §3.2 |
| 3 newest workouts in an **orphaned tab**, 44/77 rows column-shifted | Typed schema; no columns to shift | 001 §3.3 |
| **Six** conflicting calorie targets | `one_active_target` partial unique index | 006 §3.3 |
| **Four** phases simultaneously "Active" | `one_active_phase` index | 006 §3.4 |
| Coach used **64 kg**; real weight **70 kg** | Facts queried live, never stored in the prompt | 005 §3.1 |
| Progression suggestions **57 days stale** | Computed function, not a stored snapshot | 004 §3.4 |
| `PR Flag` held 15 values including the number `80` | `is_pr boolean` | 001 §3.3 |
| Abs/Core volume **out-ranked chest and legs** | `load_type` enum; volume only where meaningful | 004 §3.1 |
| 29 sets vanished from rollups; **9,352 kg leaked**, "Other" read 0 | `muscle_group` enum + visible `unattributed` bucket | 004 §3.1 |

## Design research

Mobbin MCP connected 2026-08-06. 13 apps examined across set logging, food search, AI chat and photo-candidate review — Hevy, Gymshark, Ultrahuman, MyFitnessPal, MacroFactor, WHOOP, Alma, BitePal, Life Reset, Cal AI, Bevel, Superpower, Mindvalley. Full source list, adopted patterns and **rejected** patterns in [PRD-002 §0](PRD-002-design.md).

Six specs were corrected as a result:

| Was | Now | Source |
|---|---|---|
| `[SAVE]` button per set row | Checkbox column; committed row fills with colour | Hevy, Gymshark |
| No session summary | `Duration · Volume · Sets` strip pinned to the session | Hevy |
| Global rest timer | Per-exercise rest timer + bottom overlay with −15/+15/Skip | Hevy |
| Separate date picker | Editable date/time/meal chips in the sheet header | Ultrahuman, BitePal |
| Single-item log, per-day totals only | Removable-chip basket + per-meal subtotals and macros | Ultrahuman, MyFitnessPal |
| Assistant messages in bubbles | Assistant unbubbled, numbers bolded, follow-up chips | WHOOP Coach |

Two independent validations worth noting: **MacroFactor** and **Cal AI** both expose a `Serving / 100 g / 100 ml` basis toggle, and **Ultrahuman** prints `Per 100 g — …` in every search result — confirming the `basis_unit` / `basis_amount` model in PRD-001 §3.2. **Hevy** ships a `PREVIOUS` column on every set row, independently confirming the highest-value decision in PRD-004.

## Known gaps

- ~~Gemini free-tier limits unverified~~ — ✅ **verified live 2026-08-06.** Three surprises: `gemini-2.5-*` returns `404 — no longer available to new users`; Gemini **Pro has no free quota**; **Google Search grounding has no free quota at all** (429 on first call). Feature 1 re-routed to structured nutrition databases. PRD-001 §2.2.
- **Embeddings are Gemini-only** — Groq offers none. Single-provider dependency, verified working (768 dims). See PRD-000 R4.
- **Pinned model will eventually retire.** `gemini-3.6-flash` is pinned deliberately over `-latest` aliases; treat deprecation as a scheduled maintenance event.
- **Mobbin indexes static screens.** Layout and control choices are well-evidenced; interaction timing, prefill logic and offline behaviour are not observable in a capture and rest on our own reasoning.

## Next steps

1. ✅ ~~Credentials~~ — all verified working 2026-08-06: Groq chat, Gemini generation, Gemini embeddings (768 dims), Supabase REST. Remaining: free USDA FoodData Central key from api.data.gov (2 min).
2. Approve + authenticate the Supabase MCP, then enable `vector` and `pg_trgm`
3. Write `.impeccable.md` at repo root from PRD-002 §1 so design skills find the context
4. Scaffold P0 in the order set by [PRD-007 §8](PRD-007-design-system.md): tokens → primitives → controls → containers → patterns, with a `/dev/ui` gallery
5. Then Next.js + Serwist + Supabase schema + seed migration
6. Load the `dataviz` skill before building any chart
