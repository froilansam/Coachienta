<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

# Coachienta — working rules

Personal PWA: food + training log with an AI coach. Single user. Full specs in `docs/` — start with `docs/README.md`.

## Non-negotiables

1. **No `any`.** `strict` + `noUncheckedIndexedAccess` are on.
2. **No auth, and no Supabase key in the browser.** There is no RLS, so a client-side key would be a public read/write database credential. All DB access goes through `app/api/data/*` via `lib/db/client.ts`. `lib/{env,db,ai,nutrition}` are `server-only` — importing them from a client component is a build error.
3. **Zod is the single source of truth for types.** `lib/schemas/domain.ts` mirrors the Postgres enums 1:1. Change both together.
4. **Macros are stored as a rate per basis**, never a per-entry total. `scaleMacros` refuses cross-unit conversion rather than guessing a density.
5. **Log entries are immutable.** Correcting a food bumps `foods.version`; existing `food_log_entries` keep their frozen macros.
6. **Volume only where it means something.** `computeVolume` returns `null` for `assisted`, `duration`, `distance` and unweighted bodyweight. Never sum volume across all load types.
7. **Writes go local-first.** `enqueue()` → Dexie → `/api/data/sync`. The client-generated uuid is the row's primary key, so a replayed flush upserts instead of duplicating.
8. **AI never blocks logging.** If quota is exhausted, degrade and carry on — `lib/ai/router.ts`.

## Architecture

```
app/api/data/*        the only path to the database
lib/env.ts            validated config; throws at boot on a bad value
lib/schemas/          Zod — domain vocabulary
lib/domain/           pure functions, no I/O (macros, volume, energy)
lib/nutrition/        USDA + Open Food Facts clients + cascade
lib/ai/               model registry, providers, quota router
lib/offline/          Dexie mirror + sync queue
components/ui/        Tier 0 primitives — ZERO domain knowledge
components/patterns/  Tier 1 composites — still domain-agnostic
components/<feature>/ Tier 2 — domain-aware
```

**Dependency rule, one direction only:** Tier 2 → Tier 1 → Tier 0 → tokens. Nothing in `ui/` or `patterns/` may import `lib/db`, `lib/ai`, or a feature folder. Domain mapping belongs in `lib/domain/*` or the page orchestrator; presentational components take display props only.

## Components stay readable — logic lives in hooks and context

A component body should read like a description of the screen. If you have to scroll it to find the JSX, the logic is in the wrong place.

```
hooks/use*.ts        all state, effects, mutations, derived values
context/*Provider    state shared by more than one sibling
components/*.tsx     JSX + a single hook call. No useEffect, no fetch, no math.
lib/domain/*         pure functions, no React at all
```

Rules:
- **One hook call per component**, ideally. `const vm = useFoodLog()` then render `vm`.
- **No `useEffect` in a component file.** Effects belong in the hook that owns the state.
- **No arithmetic or formatting in JSX.** Compute it in the hook or a `lib/domain` function; the component receives finished values.
- **Context only for genuinely shared state.** Prop-drilling two levels is better than a provider nobody needs.
- **Hooks return a flat view-model** — `{ entries, totals, isLoading, log, remove }` — not nested objects the JSX has to dig through.
- A hook may call `lib/*`; a component may not.

**Before adding a component,** check `docs/PRD-007-design-system.md` §3–4. It probably exists. Add a variant rather than forking a file.

## Verified facts that cost time to rediscover

- `gemini-2.5-*` returns **404 — retired for new accounts**. Use `gemini-3.6-flash`.
- Gemini **Pro has no free quota**, and **Google Search grounding has none either** (429 on the first call). Macros come from USDA → Open Food Facts → LLM.
- **`gemini-3.6-flash` free tier is 20 requests per DAY per model** — `quotaId: GenerateRequestsPerDayPerProjectPerModel-FreeTier`, `quotaValue: 20`. Its error carries `retryDelay: 49s`, which reads like a per-minute limit and is not one. That pool is shared by every Google job (`vision`, `estimate`), so photo logging is what it is for; a once-a-session convenience must not spend it.
- **No Groq model in `MODELS` supports `json_schema`, so `generateObject` fails on all of them.** `llama-3.3-70b-versatile` and `qwen/qwen3.6-27b` refuse a two-field flat schema as readily as a complex one — it is a model capability, not a schema shape, and `mode: 'json'` does not change it. `openai/gpt-oss-120b` accepts the schema but nested `items` inside a second `items` object (rejected non-retryably) and caps at 8k tokens/minute. So `plan` uses **`generateText` + `AiWorkoutPlanSchema.safeParse`**, with the JSON shape in the prompt generated by `z.toJSONSchema()` so it cannot drift from the validator. Groq's 100k tokens/day ≈ 120 plans at the ~600 tokens/call measured.
- **`visionFallback` was removed for the same reason** — `resolvePhoto` calls `generateObject`, so degrading to qwen on a Google quota exhaustion replaced a truthful "quota" message with a confusing capability error. A fallback that cannot serve the call is worse than none.
- **A model's prose is clamped, never validated.** `z.string().max(400)` on `rationale` threw away an otherwise perfect plan for being 30 characters long. Same failure direction as the label Atwater check: refusing good data over a cosmetic bound. `clampProse` in `lib/ai/parse.ts` cuts it; the items are the payload.
- **Provider errors are never shown raw.** A rate limit arrives as *"Failed after 3 attempts. Last error: AI_APICallError… generativelanguage.googleapis.com/generate_content_free_tier_requests, limit: 20"* — a log line that also leaks the provider. `describeAiFailure` reduces it to wait-or-do-it-another-way.
- Gemini 3.x Flash is a **thinking model** — ~800 output tokens of overhead measured. `maxOutputTokens` below ~2000 returns an empty response with no error.
- **`openfoodfacts.org/api/v2/search?q=` silently ignores `q`** and returns all 4.6M rows. Full text lives at `search.openfoodfacts.org/search`.
- OFF records frequently have **null macros** — reject unless all four are numeric.
- Groq has **no embedding model**. Embeddings are Gemini-only, 768 dims.
- Quota resets use the **provider's** timezone (Google `America/Los_Angeles`, Groq `UTC`), never `APP_TIMEZONE`.
- `APP_ACCESS_TOKEN` must be **URL-safe (hex)**. A base64 token breaks `?k=` because `+` decodes to a space.
- Supabase's **direct** DB host is IPv6-only — use the **session pooler** (`postgres.<ref>@aws-0-…pooler…:5432`).
- **`@serwist/next` injects a `webpack` fn even when `disable: true`.** Next 16 defaults to Turbopack, which refuses to start with a webpack config and no turbopack config — so `next dev` died. `next.config.ts` therefore applies Serwist only when `phase === PHASE_PRODUCTION_BUILD`. Do not "simplify" that back into an unconditional wrap.
- macOS has no `timeout` command; poll a log in a loop instead.
- **`pg` parses DATE (oid 1082) into a JS `Date` at LOCAL midnight**, so in JST `2026-08-04` → `toISOString()` = `2026-08-03`. `scripts/db.ts` disables that parser. Always import `connect()` from there; never `new pg.Client` directly.
- **Offline reload is a known gap** (`test.fixme` in `e2e/offline-sync.spec.ts`). `__SW_MANIFEST` carries only `_next/static/*`; `@serwist/next` ignores `additionalPrecacheEntries`; its `defaultCache` is one NetworkOnly passthrough. Queued writes are unaffected — they persist in IndexedDB and upload on focus.
- **A hand-written base64 PNG in a test is a trap.** `prepareImage` really decodes via `createImageBitmap`, so a bad IDAT/CRC rejects — and the UI reports that as *"Could not read that photo"*, which is byte-for-byte the message an API failure produces. Three stubbed photo tests failed while looking like a stub problem. Generate PNG bytes programmatically, and assert the route was actually hit before trusting an error-path test.
- **Playwright loads `.env.local` itself** via `loadEnvConfig` in `playwright.config.ts`. Without it `connect()` and `APP_ACCESS_TOKEN` are undefined unless the shell happened to export them.
- **Next 16 refuses a second `next dev`** ("Another next dev server is already running") and reports the existing port. `scripts/console-sweep.mts` takes `SWEEP_URL` — point it at whatever is already up rather than fighting for a port.
- **`eslint-plugin-react-hooks` v6 rules are errors, not warnings**: `setState` synchronously inside an effect, and reading `ref.current` during render. Fixes that worked: `useSyncExternalStore` for browser-owned values (`hooks/useOnline.ts`), the documented adjust-state-during-render pattern for prop→draft sync (`NumericInput`), plain state instead of a ref when the value decides what renders (`ListRow`), and moving "clear on empty input" out of an effect and into the setter (`useFoodResolve`). `public/sw.js` is generated — it is in eslint's `globalIgnores`.
- **`streamText`'s `onFinish` gives `usage` for the FINAL STEP ONLY.** Use `totalUsage` for a multi-step tool turn. Measured: 52,126 tokens recorded against Groq's own count of ~98,000 for the same day, roughly half — which blinded the quota router, the thing meant to degrade to Gemini *before* Groq hard-stops (AC-3.9). Single-call sites (`resolveFood`, `resolvePhoto`, `planWorkout`) are unaffected: with one step the two are equal.
- **Groq's `llama-3.3-70b-versatile` DOES call tools**, even though it cannot do `json_schema` structured output — different API surfaces, verified separately. AI SDK v7 names them `inputSchema` (not `parameters`) and `stopWhen: stepCountIs(n)` (not `maxSteps`).
- **`@ai-sdk/react@4` is the companion for `ai@7`.** It peers only on React, like `@ai-sdk/google@4` and `@ai-sdk/groq@4` already do here — the version numbers look mismatched and are not.
- **Never hand the small model the tool catalogue.** `llama-3.1-8b-instant` answered "thanks" by calling five tools over 120 seconds; the 70B is a far better tool-selector. Trivial turns get no tools at all and finish in ~1.2 s.
- **A model retries an identical tool call when the result is empty.** `get_session_summary` was called twice with byte-identical arguments. `readOnly()` in `lib/ai/tools/coach.ts` memoises per turn and appends an explicit "this is the complete and final answer — do not call again" note to any `row_count: 0` result.
- **A real coaching turn costs ~6,500 input tokens**, so Groq's 100k/day is ~15 turns — matching PRD-005 §3.4's projection. Exhausting it takes one afternoon of probing, and it then breaks `e2e/ai-plan.spec.ts`, the one test that spends a real call. That test now SKIPS on a quota notice rather than reporting red for a provider state.
- **The coach system prompt is ~1,303 tokens against its 1,200 budget** (20 active coach rules). `systemPromptWarning` logs it on every turn rather than letting the overrun be invisible; trim rules or raise the documented figure deliberately.
- **A photo may be a nutrition LABEL, not food** — that is the common case here. One vision call classifies (`kind: 'plate' | 'label' | 'neither'`) and prefers `label` whenever a panel is legible. On the label path **the model only transcribes; all arithmetic is pure code in `lib/domain/food/label.ts`**. Never move a calculation into the prompt — determinism is the whole point.
- **Japanese labels: 糖質 is NET carbs (total − fibre), not sugars and not total.** 炭水化物 = 糖質 + 食物繊維, and JP protein/diet products often print the two sub-rows with **no 炭水化物 row at all**. Reading 糖質 as total carbohydrate silently undercounts every one of them. 糖類 is sugars and is never used for energy.
- **Label numbers are rounded by law, so a percentage Atwater check rejects valid labels.** JP rounds macros to 1 g; US rounds kcal to the nearest 10 above 50 kcal (21 CFR 101.9). A 30 kcal item carries ±8.5 kcal (28%) of legal slack. `readLabel` therefore checks whether printed kcal falls inside the *interval* the printed macros imply. Same failure direction as the fiber bug: rejecting food that is fine.
- **Gemini structured output does not handle `anyOf` reliably**, so the photo schema is one flat object with a `kind` discriminator rather than a Zod discriminated union. The route treats a branch the model claimed but did not fill as `'neither'`.
- **A label is read and saved in two steps.** `POST /api/data/resolve-photo` writes nothing; `POST /api/data/label-food` creates the row once the user approves the NAME. The name is the library key (`name_norm, brand`) and OCR misreads names far more often than digits, so writing at read time would strand unfindable rows. The client posts the **transcription** back, never macros — the server re-derives the rate so it cannot be fabricated.
- **Sodium and sugars are read from labels but not stored** — `foods` has no column. Adding one is a migration, not a quick fix.
- **The library's problem is trust, not duplicates.** Live data: 282 foods, **188 (67%) unconfirmed**, **58 (21%) never eaten**, and only **2** near-duplicate clusters — both actually distinct branded products. The seed already normalised the spreadsheet's clusters, so the PRD's original "≥10 clusters" merge rationale no longer holds. Every cache miss writes up to 8 candidate rows, so `UNUSED` grows with use; that is a prune problem.
- **`VERIFIED` means a human checked it — nothing else.** The old chip mapped `high` to "Verified", so 94 untouched rows claimed approval, including a USDA sweetener at 0 kcal / 100 g carbs. `trustOf(confidence, source)` in `lib/domain/food/library.ts` is the single source for that label; database rows name their source (`USDA`, `OFF`, `IMPORTED`) instead.
- **A `Secure` cookie is silently dropped over plain HTTP, and that broke the phone.** `proxy.ts` set `secure: true` unconditionally. Browsers exempt `localhost`, so desktop dev looked fine while the phone could never store the token over the LAN at `http://192.168.x.x:3000` — every API call then 404'd and the screen rendered as an empty day. `cookieOptions(req)` now sets `secure` only when `x-forwarded-proto`/the request protocol is https, so Vercel keeps it. **Not gated on NODE_ENV** — that describes the build, not the transport.
- **A failed day fetch must never render as an empty day.** `useToday` swallowed react-query's error, so a 404/500 looked identical to "you haven't eaten yet" — which is what made the cookie bug undiagnosable. It now returns `loadError: 'locked' | 'unreachable'` and `retry`, and `TodayScreen` shows a named state above everything else.
- **`page.route` does not intercept fetches once the Serwist service worker takes control** in a `next start` build — a stubbed 500 was passed straight to the real server on retry. Use `test.use({ serviceWorkers: 'block' })` when stubbing an API route the client polls.
- **`/today` shows any day, not just today.** `useToday` owns the date; navigation is `stepDay`/`goToDay`/`goToToday`. **Targets are selected by the day being viewed** (`effective_from <= date and (effective_to is null or effective_to >= date)`), never `effective_to is null` — otherwise a phase change silently re-scores every past day. Date maths lives in `lib/domain/date.ts` and never touches `toISOString()`; in JST that shifts the day.
- **No horizontal swipe on the day timeline.** `ListRow` already owns horizontal pointer gestures for swipe-to-delete; a container swipe fights it.
- **`foods.times_logged` is a lifetime usage counter, NOT a reference count.** It is seeded from spreadsheet history: `White rice (cooked)` = 187 logs against 5 actual `food_log_entries` rows. Never "repair" it to match — it orders `recent_foods`, which is the two-tap path. **Never gate anything destructive on it**; that shipped once and refused 221 of 282 foods while reporting phantom entries. Use `entry_count` from `library_foods`, and `delete_food_if_unreferenced()` server-side.
- **Deleting a log entry must `unbump_food_usage`** (migration 0011). The sync route reads `food_id` *before* the delete, since a delete payload has no body. `usual_amount` / `last_used_at` are deliberately not rolled back.
- **Library writes are RPCs** (`0010_food_library.sql`): `update_food_macros`, `prune_unlogged_foods`, `merge_foods`, `library_foods`, `library_counts`. Reasons: multi-statement atomicity, and `version = version + 1` is an expression supabase-js cannot send. **Deletes are guarded by `not exists (… food_log_entries …)`, never by `times_logged = 0`** — a counter can be wrong, a foreign key cannot.
- **AC-1.6 is confirmed by probe, not by test.** Correcting a food bumps `foods.version` and leaves `food_log_entries` untouched — verified against live Postgres. Still no automated regression test; that is the first thing to write when tests resume.
- **`typedRoutes` needs a `next build` after adding a route**, or `Link href` fails to typecheck with "not assignable to RouteImpl".
- **Vision accuracy is untested and untestable in CI.** The E2E suite stubs `/api/data/resolve-photo` because AC-1.9 is about the review screen having no write path. Whether the model reads a real plate correctly needs `npm run probe:vision <photo>` and a human.
- **Plan quality is the same** — `npm run probe:plan "Upper Body"` and a human. `e2e/ai-plan.spec.ts` spends exactly one real model call, on the only claim worth it (nothing invented, nothing written); the rest stub the route so they are deterministic and cost no quota.
- **BUILD is gated on the exercise library, not just on the prompt.** A draft is mapped through `byId` exactly once, so building before `/api/data/plan` resolved dropped every id and rendered an `AI DRAFT` chip above an empty plan — with no error anywhere. Found by the E2E suite, invisible on screen.

## Profile & body log (P2, partial)

- **`body_measurements.id` has NO default** — client-generated uuid pattern, same as `food_log_entries`. An insert omitting `id` violates the primary key, and an upsert on `measured_on` would rewrite an existing row's id. `saveWeighIn` is update-or-insert. Test fixtures need `gen_random_uuid()` too.
- **Latest-wins is per FIELD, not per row** (`lib/domain/body.ts`). The newest weigh-in has a weight and no waist; reading the row wholesale blanks a waist that exists. Each CURRENT value carries its own date.
- **BMR is blocked, not guessed, while `profile.birth_date` is NULL.** Age is part of Mifflin-St Jeor and PRD-006 forbids a stored age column. A guessed age would feed calorie targets — the spreadsheet's exact failure.
- `trendOf` withholds a weekly rate under 7 days of spread rather than extrapolating scale noise.
- **Editing targets, phase and rules is a SUPERSEDE, never an update** (`0013_goal_editing.sql`). RPCs, because the `one_active_*` partial unique indexes forbid two open rows for even an instant: the old row must close and the new one open in one transaction. A new row starts **tomorrow** — a same-day supersede would leave today with no target, and the RPC refuses a date at or before the current row's start.
- **The calorie floor is enforced in the API too, not only in the form** (AC-4.10). A safety rule that only lives in a client is not a rule. Same pure function (`lib/domain/coach/consistency.ts`) decides both, so they cannot disagree.
- **`buildCoachPrompt` is the only place a prompt is assembled** (AC-4.12). The preview renders exactly what P4's chat route will send. A second code path would drift, and an unverifiable prompt is how the spreadsheet's "Coach Agent" tab came to describe behaviour the agent never had.
- **Consistency findings that `CurrentStrip` shows inline are filtered out of the panel** (`INLINE_ON_CURRENT` in `hooks/useGoals.ts`). PRD-006 §4 wants warnings at the offending value, not collected in a banner; rendering both said the same sentence twice.
- **Changing an RPC's ARGUMENT COUNT creates a second overload, and PostgREST then refuses every call.** `create or replace function` only replaces an identical argument list, so adding `p_offset` left both versions in `pg_proc` and PostgREST returned `PGRST203 Could not choose the best candidate function` — every food lookup 500'd while the same SQL worked fine from `scripts/db.ts`. Two compounding traps: naming an exact signature in `drop function if exists` silently does nothing if you guess wrong, and **PostgREST caches the schema**, so a signature change needs `notify pgrst, 'reload schema'`. Drop overloads by iterating `pg_proc` (see `0025_search_foods_single_overload.sql`) rather than by guessing a signature.
- **Supabase runs the API role with `pg_safeupdate`: an unqualified `DELETE`/`UPDATE` inside an RPC fails through PostgREST** with "DELETE requires a WHERE clause", while succeeding from a direct `scripts/db.ts` session. Always add a WHERE that selects everything (`where rank >= 1`). A direct-connection probe cannot prove an RPC works from the app.
- **Priority order is replaced whole, never patched** (`reorder_physique_priorities`). `rank` is the primary key and `muscle_group` is unique, so any single-statement swap collides with itself mid-way.

## Train (P3-1: exercise library)

- **`exercises.muscle_group` is load-bearing, not a label.** Per-muscle volume and `priority_volume_share()` group by it, so a mis-tagged row corrupts priority adherence. `/train/exercises` has a `NEEDS CHECK` filter for exactly this.
- **PRD-004 §4.1's "corrected on import" claims are false against the live data.** All three `Chest Press Machine` rows are `vertical_pull`; `(Narrow Grip)` is `back_mid`; `Arms Superset — DB Bicep Curl` keeps its prefix and is tagged `triceps`. Do not trust that table — trust `auditExercise`.
- **Correcting an exercise is a plain UPDATE, not a supersede** — the opposite of a food macro correction. A food entry froze a measurement; an exercise row records what the movement IS, so the correction should apply retroactively.
- **`ExerciseList` is selection-agnostic** (`onOpen` vs `selected`+`onToggle`). The day plan reuses it; do not fork it.
- **A mis-imported `movement_pattern` can silently disable a CRITICAL coach rule.** `Shoulder Press Machine` is seeded `vertical_pull`; an order check requiring `vertical_push` found nothing and reported no violation. Identify movements by `muscle_group` (reliable) plus name, never by `movement_pattern` alone.
- **The 4-day template is seeded** (`0017`), 21 rows across 4 plans, with a migration report for the 5 names that did not resolve. `Plank` is `duration` load type — never `external_weight`, or a bodyweight hold invents volume.
- **`START SESSION` copies the plan, never references the template.** Editing today must not rewrite the template; a template edit must not retcon a past session.
- **Progression is split**: `exercise_history()` in SQL supplies evidence, `suggestTarget()` in TS makes the suggestion. Weighted work does not use the plan's rep range. A working set is under 10 reps, and the heaviest such set is the working weight — next session's set 1 starts there. 10 reps or more at that load adds 2.5 kg. A lighter high-rep set is a warm-up and never becomes the recommendation, because history already returns the heaviest set. Assisted work still follows the plan range. PRD-004 §3.4's double-progression table is that assisted path.
- **PostgREST returns an embedded to-one relation as an ARRAY.** `data.gyms` and `data.workout_plans` need unwrapping, not casting.
- **No A–Z scrubber and no Recent tab**, despite PRD-002 §0 adopting both from Gymshark — 57 exercises and zero sessions make them chrome and a dead control respectively.

## Live session (P3-3)

- **The commit path never awaits the network.** `enqueue()` → Dexie → re-render via `useLiveQuery`. `workout_sets` was already in the sync allowlist and the Dexie mirror, so this reuses Feature 1's proven queue. Do not add an await to it: AC-2.1 is under 200 ms offline.
- **A derived row's id is a React key, NOT a database key.** The first row per exercise is derived (not seeded by an effect) so it needs a stable id like `draft:1` — which is not a uuid and was rejected by `/api/data/sync` with a 400 *while the UI showed a locked row*. `SetRow.derived` marks it; a real uuid is minted at commit.
- **Rest is a deadline, not a countdown.** `setState` ticking in an effect is a cascading-render lint error and drifts on a backgrounded tab.
- **Mirror `day` for sets is the SESSION ID**, not a date — so a reload reads back only this session's queued sets.
- **`aria-label` must include the exercise name.** Five exercises each have a "set 1"; identical labels are the same fault as twelve "Delete" buttons.

## Personal records (P3-4, revised in `0028`)

- **A PR is judged at the SET POSITION it was set, over the whole record.** Set 1 competes with every set 1, set 3 with every set 3. Pooling every set of an exercise — the original rule — means only the top set can ever win, so the back-off sets creeping up (most of progressive overload) was invisible. The live data proves the shape: `High-to-Low Cable Fly` best set 1 = 11 kg, best set 4 = **16 kg**; `Cable Lateral Raise` set 1 = 5 kg, sets 2–3 = 7.5 kg. This training ramps UP, so the pooled maximum permanently disqualified the opening sets.
- **Position is the GATE; `all_time` is a rank on top, never a way in.** The two comparisons are not nested: 50 × 11 beats a 50 × 10 sitting at set 1 (so the pooled rule called it a reps record) while losing to the 60 × 20 at its own position. `detectPr` runs the positional pool first and returns early if it fails.
- **`set_ordinal` is the rank among WORKING sets, not `set_index`.** Warmups occupy an index — `unique (session_id, position, set_index, side)` requires it — so the first working set is index 2 on a day with a warmup and index 1 on a day without. Grading positions on raw indexes silently re-aligns the whole history whenever the warmup count changes. `row_number()` in `prior_sets` and `setOrdinal()` in `lib/domain/train/session.ts` must stay in step; `WORKING_KINDS` is mirrored on the client for that reason. Sides are numbered independently, matching `blankSet`.
- **The `PR` line under `PREV` is the record STANDING at that position, constant until beaten.** `standingRecord` replays the position's history oldest-first through the same `compare` the stamp uses: the first measured set is the baseline, and the record moves only to a set that beat everything before it. A "best" chosen on one axis (heaviest) would disagree with a reps or volume stamp. Today's saved sets join the pool (`savedToday` in `useSession`), so beating it moves it on the spot. `PREV` deliberately stays the last session.
- **`PREV` is per position now.** It used to show the exercise's last top set on every row, which gave sets 2 and 3 a target they were never meant to hit — the same reason their progress never counted. `—` when that position has no history.
- **Changing an RPC's RETURN TYPE cannot use `create or replace` either** — not just its argument count. Same remedy as `0025`: drop every overload by iterating `pg_proc`, then `notify pgrst, 'reload schema'`. `0028` does this for `prior_sets`, `session_sets` and `pr_timeline` in one loop. Verified through PostgREST, not only through `scripts/db.ts` — a direct-connection probe cannot prove an RPC works from the app.
- **The stamp survives a reload; its tooltip does not.** `is_pr` / `pr_kinds` / `pr_scope` are stored, so reopening a session re-derives the stamp — it used to live only in hook state and vanished on leaving the screen. `basis` is deliberately NOT stored (a derived sentence goes stale the way the spreadsheet's targets did), so the evidence tooltip is live-verdict only. `useSession` layers this visit's verdicts over the server's; the server's win after any remount, which is why an E2E assertion on `title` must run before the upload, not after.
- **A second set committed while the first is still uploading waits for the next foreground event.** `flush()` self-guards with a `running` flag and iterates a snapshot of `pending`, so a set enqueued mid-flush is not in that pass. In a test, dispatch `online` from the page (`expectSets` in `e2e/trends.spec.ts`) — it is one of the three triggers the app listens for and, unlike `bringToFront()`, does not depend on the tab having been backgrounded.

## Weekly averages

- **The current week is excluded — it is not over.** Averaging Tuesday's two sessions in as a whole week drags every figure down for five days out of seven.
- **The window starts at your first logged week, not at the start of the range.** A 24-week range over 6 weeks of history would otherwise report a quarter of the truth. Blank weeks *in between* still count: a skipped week is part of an average, and dropping it reports a personal best instead.
- **Food kcal and protein are per LOGGED day, never per calendar day.** An unlogged day is missing data, not a day of eating nothing; dividing by seven reports a crash diet every time a week goes half-logged. `daysLogged` per week is shown alongside so the mean can be weighed. Same failure direction as a failed day fetch rendering as an empty day.
- Both functions return the week count so the caller can state its denominator. An average whose denominator is invisible is the spreadsheet's dashboard again.
- **`mondayOf` had THREE copies** (food trends, train trends, and a local `addDays` in train trends that re-introduced the `new Date('…T00:00:00')` parse `lib/domain/date.ts` exists to avoid). It lives in `lib/domain/date.ts` now; train trends re-exports it for its existing importers.

## Touch targets are 44×44, no exceptions

PRD-002 §"states" mandates it, and `Button`'s own size map says `md` (h-11) is the floor for anything tapped. A `text-2xs` link in a section-header corner is ~14×30 — it shipped once on `/profile` and the edit controls were effectively **undiscoverable and unhittable on a phone**. Grow the hit area with padding (`min-h-11`, `size-11`), never the glyph. `IconButton` already does this; a tappable header row with a chevron (the More / library idiom) is the pattern for "this whole section is editable".

Note for tests: `Select` is a **Radix combobox, not a native `<select>`** — `selectOption` fails; click the trigger then the `option` role. And an `aria-label` **replaces** the visible text as the accessible name, so `getByRole('button', { name: '+ Triceps' })` stops matching once the button gains a descriptive label. That is the a11y win, not a regression.

## Testing reality

- **455 unit tests, 121 E2E** (2 skipped for the no-cached-shell offline-reload gap; 1 more skips itself when the day's AI quota is gone). `npm test` is pure functions only; `npm run test:e2e` runs against **real Postgres** and cleans up after itself with `ZZTest`-prefixed rows and sentinel dates in 2019.
- **The database holds REAL data now, so a cleanup scoped by anything a real row could match is a data-loss bug.** Three landed: `today.spec.ts` seeded and cleaned with `logged_on = <today>`, wiping whatever had actually been eaten that day; five specs swept `workout_plans where not is_template`, which now hits a plan a real session references (the FK is ON DELETE NO ACTION, so it raises and takes the whole file with it — `dropUnreferencedPlans` in `e2e/db.ts` replaces it); and an ad-hoc fixture matched `food_name = 'White rice (cooked)'` on the current date and deleted the user's entry along with its own. **Scope every delete to a 2019 sentinel day, a `ZZTest` name, or an id you minted** — never to a value real data can take.
- **A test can assert a true claim through a proxy that only real data falsifies.** `trends.spec.ts` proved "a plank carries no kilograms" by asserting abs were absent from the volume legend — correct only while the seeded plank was the sole abs work. One real weighted abs machine (950 kg, `external_weight`, entirely correct) broke it. Assert the arithmetic, not the absence.
- **A latency budget measured from Node is measuring Playwright.** AC-2.1's 200 ms failed in a full run and passed in isolation: the window included a CDP round trip for the click and `waitFor` DOM polling. Install a `MutationObserver` in the page, start the clock on the captured `click` event, read the elapsed value back afterwards.
- **AC-1.6 is proven**: correcting a food bumps `foods.version` and leaves `food_log_entries` untouched (`e2e/library.spec.ts`). This was the project's riskiest unproven claim.
- **A local-first write needs a FLUSH TRIGGER in a test, not a longer timeout.** One queued-write assertion passed alone and failed in the full suite; raising the poll to 20 s changed nothing, because nothing was going to happen — the queue flushes on `online`/`visibilitychange`, and across a long run none fired inside the window. `await page.bringToFront()` before the poll fixed it. Sharing one pg connection per worker (`e2e/db.ts`) was a real DRY win but not the cause.
- **Playwright's `getByText(string)` is a case-insensitive SUBSTRING match.** Section headings like `CURRENT` and `PRIORITY ORDER` collide with explanatory prose that happens to contain the word. Use `{ exact: true }` for headings — this has bitten three times.
- **`innerText` applies CSS `text-transform`**, so a `Text variant="label"` reads as `WAIST`, not `Waist`. Match case-insensitively or assert the uppercase form.
- **`page.route` stops intercepting once the Serwist service worker takes control** in a `next start` build. Any test stubbing an API route the client polls needs `test.use({ serviceWorkers: 'block' })`.
- **Real training at `Current gym` (from 2026-10-06) falsified every "no history at this gym" premise.** `AC-2.5` (first set is a baseline), `AC-2.19` and `AC-2.22` (`Establish a baseline`) fail because Day 1 Push exercises now have real sets, and `AC-2.21` because nine real sessions are `LIVE`. The code is right; the fixtures need a sentinel gym of their own.
- **`e2e/trends.spec.ts` › "strength progression draws one line per gym" fails on `main`** and has nothing to do with PRs — verified by stashing. Do not attribute it to a change you are making; fix it on its own or leave it named.
- Do not hard-code seed counts in tests — `"57 shown"` broke the moment a migration added two exercises. Read the count from the database. Coverage is tracked honestly in `docs/PRD-003-feature-food-logging.md` §6.1 — ✅ / ⚠️ / ❌ per AC, with what is still open named.

## Commands

```bash
npm run dev         # Turbopack
npm run build       # --webpack — required; Serwist's webpack config is only applied in this phase
npm run typecheck
npm test            # vitest — pure functions only
npm run test:e2e    # playwright — offline→sync against real Postgres
npm run migrate     # applies supabase/migrations/*.sql, idempotent
npm run sweep       # browser sweep of every flow against `next dev` (StrictMode); SWEEP_URL to retarget
npm run probe:vision <photo>   # what the real model sees in a real photo
npm run probe:plan "Upper Body" # what the real model builds from a real prompt
npm run probe:coach "what was my average protein last week"  # a real coach turn, with its tool calls
```

Unlock once per device: `/unlock` (paste) or `/?k=$APP_ACCESS_TOKEN`.
