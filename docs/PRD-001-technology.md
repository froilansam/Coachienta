# PRD-001 · Coachienta — Technology & Libraries

| | |
|---|---|
| **Status** | Draft v1 · 2026-08-06 |
| **Depends on** | PRD-000 (principles, constraints, risks) |
| **Decided context** | iOS Safari primary · Cloud + offline cache · Free tier only |

---

## 1. Stack summary

| Layer | Choice | Why this and not the alternative |
|---|---|---|
| Framework | **Next.js 16.3 (App Router), React 19.2, TypeScript strict** | Route Handlers are the only place keys may live. One deploy artifact for app + API. ⚠️ Next 16 renames `middleware.ts` → `proxy.ts` and defaults to Turbopack. |
| Language rules | `strict: true`, `noUncheckedIndexedAccess`, **no `any`** | PRD-000 defect classes are type defects. Enforced, not aspirational. |
| Styling | **Tailwind CSS v4** (CSS-first `@theme`) | Design tokens become real CSS custom properties, usable in charts and canvas too — not locked in a JS config. |
| PWA / service worker | **Serwist** (`@serwist/next`) | Maintained successor to `next-pwa`. ⚠️ Injects a `webpack` fn **even when `disable: true`**, which breaks Turbopack — so `next.config.ts` applies it only when `phase === PHASE_PRODUCTION_BUILD`, and `build` runs `--webpack`. Dev stays on Turbopack. |
| Local store | **Dexie 4** over IndexedDB | Typed tables + a clean async API. Raw IndexedDB is too low-level to keep clean. |
| Server state | **TanStack Query v5** | Optimistic updates and cache invalidation are exactly the offline-write problem. |
| Validation | **Zod** | One schema drives AI structured output, API boundary, and DB insert. Single source of truth for types (PRD-000 Principle 2). |
| Database | **Supabase Postgres + pgvector** | Postgres enums/constraints are the structural fix. pgvector avoids a second vector service. Auth + Storage included. |
| AI abstraction | **Vercel AI SDK v5** + `@ai-sdk/google` + `@ai-sdk/groq` | Uniform streaming, tool-calling and structured output across both providers. Provider switch becomes one line. |
| Charts | **Recharts** wrapped in project chart primitives | Fast to ship. Wrapper enforces the Instrument look so raw Recharts defaults never leak. |
| Dates | **date-fns** + `date` columns in `Asia/Tokyo` | Log days are calendar days, not instants. This is the fix for the spreadsheet's date chaos. |
| Hosting | **Vercel** (Hobby) | Free, native Next.js, edge-cached shell. |
| Testing | **Vitest** + **Playwright** | Unit for the pure resolvers, E2E for the offline→sync path which is the riskiest flow. |

**Deliberately not used:** MobX (banned by clean-code standard), Redux (TanStack Query + a small amount of local state is enough), a separate vector DB (Pinecone/Chroma — pgvector suffices at this scale), `next-pwa` (unmaintained), Inter/Roboto (see PRD-002).

---

## 2. AI provider matrix

### 2.1 Verified capabilities

| Capability | Google AI Studio (Gemini) | Groq |
|---|---|---|
| Text chat | ✅ | ✅ — dramatically faster (Llama 3.1 8B ≈ 560 tok/s, 3.3 70B ≈ 280 tok/s) |
| Vision / image input | ✅ all callable Flash models | ⚠️ **only** `qwen/qwen3.6-27b`; max 5 images, 20 MB |
| **Web search grounding** | ❌ **no free quota** — `429` on first call (§2.2) | ⚠️ `compound-mini` returned `executed_tools: false` — answered from memory, did not search |
| Structured output | ✅ `responseMimeType` + `responseSchema` | ✅ JSON mode / JSON schema |
| Tool / function calling | ✅ | ✅ |
| **Text embeddings** | ✅ `gemini-embedding-001`, `gemini-embedding-2` | ❌ **none offered** |
| API shape | Google GenAI SDK | **OpenAI-compatible** (`/v1` endpoint) |

### 2.2 Verified free-tier limits

**Groq** — published per-model, reliable:

| Model | RPM | RPD | TPM | TPD |
|---|---|---|---|---|
| `llama-3.1-8b-instant` | 30 | 14,400 | 6,000 | 500,000 |
| `llama-3.3-70b-versatile` | 30 | 1,000 | 12,000 | 100,000 |
| `qwen/qwen3.6-27b` (vision) | 30 | 1,000 | 8,000 | 200,000 |
| `compound` / `compound-mini` (web search) | 30 | 250 | 70,000 | — |
| `gpt-oss-120b` / `gpt-oss-20b` | 30 | 1,000 | 8,000 | 200,000 |

**Google AI Studio** — ✅ **verified live against the real account on 2026-08-06.** This closes PRD-000 Q1. Findings differ materially from the published documentation:

| Capability | Result | Notes |
|---|---|---|
| `gemini-2.5-flash`, `gemini-2.5-pro` | ❌ **`404 — no longer available to new users`** | Listed by the models endpoint but **not callable.** Any PRD naming these was wrong. |
| `gemini-3.6-flash` | ✅ works | 1,048,576 in / 65,536 out · `thinking: true` |
| `gemini-3.5-flash`, `3.5-flash-lite` | ✅ works | Same limits |
| `gemini-3.1-flash-lite` | ✅ works | |
| `gemini-flash-latest`, `gemini-flash-lite-latest` | ✅ works | Auto-updating aliases |
| `gemini-3-pro-preview` | ❌ `429 quota exceeded` | **Pro tier has no free allowance** |
| `gemini-embedding-001` | ✅ works | 768 dims confirmed, `taskType: RETRIEVAL_DOCUMENT` accepted |
| **Google Search grounding** (`googleSearch` tool) | ❌ **`429 quota exceeded` on the first call** | **No free allowance.** Plain generation on the same model succeeds, so it is grounding-specific, not account-wide. |

> ⚠️ **The documented "5,000 free searches/month" does not apply to this account.** Grounding is quota-blocked immediately. Feature 1's primary resolution route had to be redesigned — see §2.3 and PRD-003 §3.

**Model choice:** pin **`gemini-3.6-flash`**. Avoid the `-latest` aliases despite their appeal — behaviour can shift under us mid-phase. Accept that pinned models eventually retire (exactly what happened to 2.5) and treat "model deprecated" as a known maintenance event; the router already degrades gracefully.

**Note `thinking: true`** on all 3.x Flash models — they spend output tokens on internal reasoning. Set `maxOutputTokens` generously (≥2,000) or responses return empty with no error.

**Measured token costs (2026-08-06, live).** Both are materially higher than the older documentation implies and must inform PRD-005 §3.4:

| Observation | Measured | Implication |
|---|---|---|
| `thoughtsTokenCount` on a trivial prompt | **777** tokens for a 1-token answer | Thinking overhead is a fixed tax per call, not proportional to the answer. Budget ~800 tokens of invisible output per Gemini call. |
| A 64×64 PNG | **1,089** prompt tokens | Docs describe 258/tile for 2.x models; 3.x tokenizes images far more heavily. A real meal photo will cost well over 1,000 tokens. |
| ✅ Vision accepted `inline_data` base64 | works | Photo logging viable (PRD-003 §3.3) |

Consequences: keep client-side image downscaling aggressive (PRD-003 §3.3 already specifies max 1024px / q0.8), and prefer Groq for chat where no thinking tax applies — reinforcing the routing in §2.3.

Daily reset is midnight Pacific; limits are **per Cloud project, not per key**.

### 2.3 Routing policy

Route by **job**, not by preference. Every route has a documented fallback.

| Job | Primary | Fallback | Rationale |
|---|---|---|---|
| **Macro resolution — generic/whole foods** | **USDA FoodData Central API** | Open Food Facts → LLM | ✅ verified. Real structured nutrition data, free, **no hallucination possible.** Strictly better than asking a model. |
| **Macro resolution — packaged/branded** | **Open Food Facts API v2** | USDA → LLM | ✅ verified. Free, no API key, strong coverage of Japanese konbini products. |
| **Macro resolution — composite/restaurant dishes** | Gemini `gemini-3.6-flash` + JSON schema | Groq `llama-3.3-70b` | Only route for "mapo tofu as my mum makes it". Capped at `medium` confidence. |
| **Macro resolution from photo** | Gemini `gemini-3.6-flash` (vision + JSON schema) | Groq `qwen/qwen3.6-27b` | Identification only; grams always user-confirmed |
| **Coach chat** | Groq `llama-3.3-70b-versatile` | Gemini `gemini-3.6-flash` | Speed dominates perceived quality. Watch the 100 K TPD cap. |
| **Workout plan from prompt** | Groq `llama-3.3-70b-versatile` + JSON schema | Gemini `gemini-3.6-flash` | Same models as chat. Library IDs only; LAST/BEST attached from SQL after (PRD-004 §4.2a). Shares chat quota. |
| **Cheap classification** | Groq `llama-3.1-8b-instant` | local heuristics | 500 K TPD — effectively unlimited |
| **Embeddings** | Gemini `gemini-embedding-001`, 768 dims | ❌ **none** | Groq has no embedding model (PRD-000 R4) |
| ~~Web-grounded search~~ | ❌ **removed** | — | Gemini grounding has no free quota; Groq `compound-mini` returned `executed_tools: false` (answered from memory, not search). Structured databases replace it. |

**Why this is an upgrade, not a workaround.** Grounded LLM search was always the weakest link: the model reads web pages and *retells* numbers, so a transcription error is invisible. USDA and Open Food Facts return **structured fields** — `energy-kcal_100g`, `proteins_100g` — with no language model between the database and our schema. Verified cross-check on cooked white rice: USDA `130 kcal / 2.54 P / 28.98 C / 0.37 F` per 100 g, independently matching the LLM's recalled `130 / 2.4 / 28.2 / 0.2`. The database is the citable source; the LLM becomes the last resort rather than the first.

The three tiers each have a real job: **USDA** for generic ingredients (rice, chicken breast, egg), **Open Food Facts** for barcoded and branded items, **LLM** for prepared dishes that exist in no database.

**Embedding config:** 768 dimensions (not the 3072 default) — 4× smaller index, negligible recall loss at this corpus size. `taskType: RETRIEVAL_DOCUMENT` when indexing, `RETRIEVAL_QUERY` when searching. Asymmetric task types materially improve retrieval and are free.

### 2.4 Quota-aware router

The router is a real module, not a try/catch. Contract:

```ts
// lib/ai/router.ts
type AiJob = 'macro_text' | 'macro_photo' | 'chat' | 'classify' | 'embed'

interface RouteDecision {
  provider: 'google' | 'groq'
  model: string
  degraded: boolean            // true when primary was skipped
  reason?: 'quota' | 'error' | 'unavailable'
}

export async function route(job: AiJob): Promise<RouteDecision>
```

Rules:
1. Read today's per-provider-per-model counters from Postgres (`ai_usage_daily`), not memory — serverless has no shared memory.
2. If projected spend exceeds ~80% of the model's daily cap, skip to fallback and set `degraded: true`.
3. On `429`/`5xx`, retry once with jittered backoff, then fall through.
4. If every provider is exhausted: **do not error**. Return cached/heuristic result and surface a quiet banner — "AI paused until midnight, logging from your library only." Logging must never be blocked by AI (PRD-000 Principle 1).
5. Record every call: job, provider, model, tokens, latency, outcome. This table is how R3 gets managed.

---

## 3. Data model

Postgres. Every spreadsheet defect maps to a constraint here.

### 3.1 Reference & identity

```sql
create type unit_basis   as enum ('g','ml','piece','serving');
create type muscle_group as enum ('chest','back_lats','back_mid','shoulders_side',
  'shoulders_front','shoulders_rear','biceps','triceps','quads','hamstrings',
  'glutes','calves','abs_core','forearms','other');
create type movement_pattern as enum ('horizontal_push','vertical_push',
  'horizontal_pull','vertical_pull','hinge','squat','lunge','carry',
  'isolation','core','other');
create type load_type    as enum ('external_weight','bodyweight','assisted','duration','distance');
create type set_type     as enum ('ramp','working','top','backoff','dropset','rest_pause','warmup');
create type confidence   as enum ('high','medium','low','user_verified');
create type resolution_source as enum ('library','ai_grounded','ai_unGrounded','photo','manual');
```

> Enums are the fix for PRD-000's vocabulary drift — 29 sets used muscle-group values outside the lookup list and vanished from every rollup. Here that insert simply fails.

### 3.2 Food domain

> **Single-user schema — no `user_id` anywhere.** There is no auth (§3.6), one person, one dataset. Carrying a `user_id` column on every table would be dead weight: an extra column, an extra index, and an extra predicate on every query, all to distinguish one user from nobody. Removed by KISS. If this ever becomes multi-user, adding `user_id` + RLS is a mechanical migration.

```sql
-- The reusable library. THE cache. Grows monotonically.
create table foods (
  id            uuid primary key default gen_random_uuid(),
  name          text not null,                    -- display name
  name_norm     text not null,                    -- lowercased, trimmed, accent-folded
  aliases       text[] not null default '{}',     -- "白米", "steamed rice"
  brand         text,

  -- macros are a RATE, never a total  (PRD-000 Principle 2)
  basis_unit    unit_basis not null default 'g',
  basis_amount  numeric(10,2) not null default 100 check (basis_amount > 0),
  kcal          numeric(10,2) not null check (kcal      >= 0),
  protein_g     numeric(10,2) not null check (protein_g >= 0),
  carbs_g       numeric(10,2) not null check (carbs_g   >= 0),
  fat_g         numeric(10,2) not null check (fat_g     >= 0),
  fiber_g       numeric(10,2),

  confidence    confidence not null default 'medium',
  source        resolution_source not null,
  citations     jsonb not null default '[]',      -- [{url,title,snippet}]
  version       int not null default 1,           -- bumped on macro correction
  times_logged  int not null default 0,
  last_used_at  timestamptz,
  created_at    timestamptz not null default now(),

  unique (name_norm, coalesce(brand,''))
);
create index on foods using gin (name_norm gin_trgm_ops);   -- fuzzy match
create index on foods (times_logged desc);                  -- "usual foods"

-- One row per thing eaten. Immutable snapshot.  (PRD-000 Principle 7)
create table food_log_entries (
  id            uuid primary key default gen_random_uuid(),
  logged_on     date not null,                    -- calendar day, Asia/Tokyo
  logged_at     timestamptz not null default now(),
  meal          text,                             -- free label: breakfast/lunch/konbini
  food_id       uuid references foods on delete set null,
  food_name     text not null,                    -- denormalized: survives food deletion

  amount        numeric(10,2) not null check (amount > 0),
  unit          unit_basis not null,

  -- computed AT LOG TIME and frozen. Correcting the food later never rewrites history.
  kcal          numeric(10,2) not null,
  protein_g     numeric(10,2) not null,
  carbs_g       numeric(10,2) not null,
  fat_g         numeric(10,2) not null,
  food_version  int,                              -- which macro version produced these
  confidence    confidence not null,
  resolved_by   resolution_source not null,
  photo_path    text,                             -- Supabase Storage
  notes         text
);
create index on food_log_entries (logged_on desc);
```

`logged_on date` + frozen macros + `food_version` together kill three spreadsheet bugs at once: the text-date dashboard failure, the impossibility of rescaling a quantity, and silent retroactive edits.

### 3.3 Training domain

```sql
create table gyms (            -- first-class: PRs are only comparable within a gym
  id uuid primary key default gen_random_uuid(),
  name text not null,
  is_current boolean not null default false
);
create unique index one_current_gym on gyms ((1)) where is_current;

create table exercises (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  name_norm text not null unique,
  muscle_group     muscle_group not null,
  movement_pattern movement_pattern not null,
  load_type        load_type not null,        -- ← fixes the volume distortion
  is_unilateral    boolean not null default false,
  equipment        text,
  is_active        boolean not null default true
);

create table workout_plans (          -- the "maintenance of workout list"
  id uuid primary key default gen_random_uuid(),
  name text not null,                 -- "Day 1 Push"
  day_label text,
  is_template boolean not null default true
);
create table plan_exercises (
  plan_id uuid not null references workout_plans on delete cascade,
  exercise_id uuid not null references exercises on delete cascade,
  position int not null,
  target_sets int,
  target_rep_low int, target_rep_high int,
  progression_rule text,
  primary key (plan_id, position)
);

create table workout_sessions (
  id uuid primary key default gen_random_uuid(),
  performed_on date not null,
  name text not null,
  plan_id uuid references workout_plans on delete set null,
  gym_id  uuid references gyms on delete set null,
  notes text,
  completed_at timestamptz
);
create index on workout_sessions (performed_on desc);

create table workout_sets (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references workout_sessions on delete cascade,
  exercise_id uuid not null references exercises on delete restrict,
  position int not null,              -- exercise order within session
  set_index int not null,             -- 1..n within exercise
  set_kind set_type not null default 'working',

  weight_kg   numeric(7,2) check (weight_kg >= 0),
  reps        int          check (reps >= 0),
  duration_sec int         check (duration_sec >= 0),
  distance_m   numeric(9,2),
  rpe          numeric(3,1) check (rpe between 1 and 10),

  is_failure boolean not null default false,
  is_pr      boolean not null default false,     -- BOOLEAN. not free text.
  notes text,

  -- generated, never hand-entered, null for non-weighted work
  volume_kg numeric(12,2) generated always as (
    case when weight_kg is not null and reps is not null
         then weight_kg * reps end
  ) stored,

  unique (session_id, position, set_index)
);
```

Four fixes visible in that one table: `is_pr boolean` (was 15 free-text values incl. `80`), `volume_kg` generated (was a hand-maintained formula column that held Notes text in 4 rows), `gym_id` (was "New Gym Baseline" strings), and `duration_sec` separate from reps so planks never inflate volume.

### 3.4 Profile, goals, coach rules

```sql
create table profile (            -- exactly one row, enforced
  id boolean primary key default true check (id),   -- single-row table trick
  display_name text, birth_date date, height_cm numeric(5,1),
  sex text, timezone text not null default 'Asia/Tokyo',
  language_pref text not null default 'en',
  medical_notes text             -- jaw surgery constraints
);

create table body_measurements (  -- append-only; latest row IS current weight
  id uuid primary key default gen_random_uuid(),
  measured_on date not null,
  weight_kg numeric(5,2), body_fat_pct numeric(4,1),
  lean_mass_kg numeric(5,2), skeletal_muscle_kg numeric(5,2),
  visceral_fat_index numeric(4,1), bmr_kcal int,
  water_kg numeric(5,2), bone_mass_kg numeric(4,2),
  waist_cm numeric(5,1), source text, notes text,
  unique (measured_on)
);

create table nutrition_targets (  -- ONE active row. enforced.
  id uuid primary key default gen_random_uuid(),
  effective_from date not null,
  effective_to   date,                       -- null = active
  phase_label text not null,                 -- "4-week maintenance recomp"
  kcal_gym_low int, kcal_gym_high int,
  kcal_rest_low int, kcal_rest_high int,
  protein_g int not null,
  carbs_gym_low int, carbs_gym_high int,
  carbs_rest_low int, carbs_rest_high int,
  fat_low int, fat_high int,
  kcal_floor int,                            -- the 1,800 hard floor
  rationale text
);
-- structurally guarantees PRD-000's "exactly 1 active target" metric.
-- Unique index on a constant → at most one row can satisfy the predicate.
create unique index one_active_target
  on nutrition_targets ((1)) where effective_to is null;

create type rule_category as enum ('persona','output_format','nutrition','training',
  'exercise_order','planning','progression','logging','phase','safety','interaction');

create table coach_rules (        -- the Coach Agent tab, with real precedence
  id uuid primary key default gen_random_uuid(),
  category rule_category not null,
  title text not null,
  content text not null,
  priority int not null default 100,         -- lower = injected earlier
  is_critical boolean not null default false,
  effective_from date not null default current_date,
  superseded_by uuid references coach_rules, -- ← the missing field
  is_active boolean not null default true,
  source text
);
```

`one_active_target` is the single most valuable line in this schema. It makes PRD-000's six-conflicting-targets defect unrepresentable.

### 3.5 Retrieval

Embed **digests**, not rows. Embedding 980 individual food rows is wasteful and retrieves poorly; one coherent document per day retrieves far better.

```sql
create type doc_kind as enum ('day_nutrition','workout_session','body_trend','profile','coach_rule','note');

create table rag_documents (
  id uuid primary key default gen_random_uuid(),
  kind doc_kind not null,
  ref_date date,
  ref_id uuid,                    -- session id, etc.
  content text not null,          -- rendered digest
  content_hash text not null,     -- re-embed only when this changes
  embedding vector(768),
  updated_at timestamptz not null default now(),
  unique (kind, coalesce(ref_id, '00000000-0000-0000-0000-000000000000'::uuid), coalesce(ref_date,'1970-01-01'))
);
create index on rag_documents using hnsw (embedding vector_cosine_ops);

create table ai_usage_daily (     -- powers the quota router
  usage_date date not null,       -- bucketed in the PROVIDER's timezone, not ours
  provider text not null, model text not null,
  requests int not null default 0,
  input_tokens int not null default 0, output_tokens int not null default 0,
  primary key (usage_date, provider, model)
);
```

`content_hash` means a day is re-embedded only if that day's log actually changed — keeping embedding calls near zero.

### 3.6 Security — no auth, server-only data access

**Decision: there is no authentication.** No Supabase Auth, no users table, no login screen, no password, no `auth.uid()`, no RLS. Single user, single dataset (§3.2 note).

That decision forces one architectural consequence, and it is not optional:

> **The browser never talks to Supabase. All database access goes through Next.js Route Handlers using the secret key.**

Why it's forced: the publishable key is compiled into the JavaScript bundle and is readable by anyone. It is safe *only* because RLS restricts every row to the authenticated user. With no auth there is no RLS, so shipping a publishable key would publish a read/write database credential to the internet. The exposure isn't privacy — it's that any bot scanning Vercel URLs could delete the entire log history or drain the AI quota.

So we remove the public keys entirely instead.

| Rule | Consequence |
|---|---|
| **No `NEXT_PUBLIC_SUPABASE_*` variables exist** | There is no Supabase credential in the client bundle to abuse |
| **`@supabase/supabase-js` is imported only in server code** | `lib/db/*` carries `import 'server-only'` — a client import is a build error, not a leak |
| All reads/writes go via `/api/data/*` Route Handlers | One choke point to secure, log and rate-limit |
| `SUPABASE_SECRET_KEY` server env only | Never in a bundle, never in a commit |
| `GOOGLE_GENERATIVE_AI_API_KEY`, `GROQ_API_KEY` server env only | Same. `lib/ai/*` also `server-only`. |
| Supabase **Data API can be disabled entirely** | Settings → Data API → off. Then even a leaked key has no REST surface. Optional hardening; do it once the app is stable. |
| Photos → Supabase Storage **private** bucket | Served via short-lived signed URLs minted server-side |

**Route protection — a single gate, no login UI.** Route Handlers are still publicly addressable, so they need one check. Not a login system:

```ts
// middleware.ts — runs on /api/* and all app routes
// Cookie present & valid  → pass through
// Missing                 → rewrite to /unlock
// /unlock accepts the token via ?k= OR a paste field, sets a 1-year cookie:
//   httpOnly, Secure, SameSite=Lax
```

`APP_ACCESS_TOKEN` is one long random string in server env. **This is not authentication** — no accounts, no identity, no session, nothing to log out of. It is a doorbell that stops anonymous internet traffic reaching handlers that hold the secret key.

**Why `/unlock` must be a page with a paste field, not only a `?k=` URL.** On iOS, a home-screen PWA can run in a **separate cookie jar from Safari**, so unlocking in Safari does not reliably carry into the installed app. A paste field works identically in every context — Safari, the installed PWA, desktop — with no dependence on that behaviour. The `?k=` form stays as a convenience.

**Cost to the user, once per browser context:**

| Context | Action |
|---|---|
| Desktop browser | Open `/unlock`, paste, done for a year |
| iPhone Safari | Same |
| Installed PWA | Paste once more **if** it has its own jar |

**Phone ergonomics:** typing a 44-character base64 string on a phone keyboard is miserable, so the desktop `/unlock` page renders a **QR code** of the unlock link. Scan with the phone camera → opens already unlocked, zero typing. Same trick covers a new device later.

**Not viable alternatives**, for the record: putting the token in the PWA manifest's `start_url` (manifests are publicly fetchable — it would leak the token), IP allowlisting (mobile IPs rotate), and relying on the Vercel URL being unguessable (deployment URLs appear in certificate transparency logs). Vercel's built-in Deployment Protection would solve it cleanly but is a paid-plan feature.

**What this buys versus the auth we removed:** no login screen, no email, no password to remember, no Supabase Auth configuration, no 2-emails-per-hour limit, and one fewer table — while the database stays unreachable from the open internet.

**If you want it fully open instead** (no middleware, handlers callable by anyone who finds the URL): delete the middleware and accept that anyone with the URL can read and destroy all data and spend your AI quota. Documented as an option; not recommended, and it saves ~15 lines.

---

## 4. Offline architecture (iOS-constrained)

### 4.1 What iOS Safari does not give us

| Capability | Android/Chrome | iOS Safari | Consequence |
|---|---|---|---|
| Background Sync API | ✅ | ❌ | Cannot upload while closed → **sync on focus** |
| Periodic Background Sync | ✅ | ❌ | No scheduled refresh |
| `beforeinstallprompt` | ✅ | ❌ | Must teach "Share → Add to Home Screen" manually |
| Storage durability | Good | **Evictable after ~7 days unused** | Cloud must be source of truth (PRD-000 R1) |
| Push notifications | ✅ | ⚠️ only when installed to home screen | No reminders unless installed |

### 4.2 Write path

Local-first, always. Never block a write on the network.

```
User taps "Save set"
  → write to Dexie `workout_sets` with sync_state:'pending', client uuid
  → optimistic UI update (TanStack Query cache)          ← user is done here, < 100 ms
  → enqueue mutation in Dexie `sync_queue`
  → attempt flush immediately if navigator.onLine
```

```ts
// lib/offline/db.ts
interface SyncQueueItem {
  id: string                  // client-generated uuid = idempotency key
  table: 'food_log_entries' | 'workout_sets' | 'workout_sessions' | 'body_measurements'
  op: 'insert' | 'update' | 'delete'
  payload: unknown            // validated by Zod before flush
  createdAt: number
  retryCount: number
  lastError?: string
}
```

**Flush triggers** — all of them, because iOS gives us no background:
1. `visibilitychange` → visible  ← the primary trigger on iOS
2. `online` event
3. App mount
4. Manual pull-to-refresh
5. After any successful mutation (drain the tail)

**Idempotency:** the client-generated `uuid` is the primary key sent to Postgres. Replays become `ON CONFLICT DO NOTHING`. A duplicated flush cannot create duplicate rows — which is exactly how the spreadsheet ended up with the same session twice.

**Conflict policy:** single user, single device at a time → last-write-wins on `updated_at` is sufficient and honest. Documented rather than over-engineered (KISS).

**Retry:** exponential backoff, max 5 attempts, then mark `failed` and surface it. Failed items are never silently dropped — a visible count in the header is the antidote to the orphaned-tab problem.

### 4.3 Service worker (Serwist)

| Route class | Strategy |
|---|---|
| App shell, JS/CSS | Precache, cache-first |
| Fonts | Cache-first, 1 year |
| `/api/ai/*` | **Network-only** — never cache AI responses |
| `/api/data/*` reads | Stale-while-revalidate |
| Photos | Cache-first, LRU cap 50 |
| Navigation fallback | Offline shell that still reaches Dexie |

Also: request `navigator.storage.persist()` on first successful login, and show durability state in Settings so eviction risk is visible rather than silent.

---

## 5. Project structure

Placement rules per the clean-code standard: thin route handlers, pure logic in `lib/`, presentational components domain-agnostic.

```
app/
  (app)/
    today/page.tsx              food + training day view
    food/  log/page.tsx  library/page.tsx
    train/ plan/page.tsx  session/[id]/page.tsx  exercises/page.tsx
    coach/page.tsx
    profile/page.tsx
    trends/page.tsx
  api/
    ai/resolve-food/route.ts    text → macros
    ai/resolve-photo/route.ts   image → candidates
    ai/chat/route.ts            streaming, tool-calling
    ai/embed/route.ts           digest → vector
    sync/route.ts               batch flush endpoint
  manifest.ts
  sw.ts

lib/
  ai/     router.ts  providers.ts  prompts/  schemas/  tools/
  db/     supabase.ts  queries/  mutations/
  offline/ db.ts  queue.ts  flush.ts
  domain/ food/parseQuantity.ts  food/scaleMacros.ts  food/matchFood.ts
          train/volume.ts  train/detectPr.ts  train/progression.ts
          coach/assemblePrompt.ts  coach/renderDigest.ts
  schemas/            Zod — the single source of truth for types
  format/             numbers, dates, units

components/
  ui/         Button, Field, Sheet, Chip, Rule, StatRow, NumericCell   ← agnostic
  charts/     TrendLine, MacroBar, VolumeChart                          ← agnostic
  food/  train/  coach/                                                 ← domain-aware
```

**Rule:** `components/ui/*` and `components/charts/*` receive display props only. No component in those folders may import from `lib/db` or know what a `food_log_entry` is. Domain mapping happens in `lib/domain/*` or the page orchestrator.

---

## 6. Environment

> Acquisition steps, verification `curl`s and security rules: **[PRD-008 — Credentials & Account Setup](PRD-008-credentials-setup.md)**.

```bash
# ── Supabase — ALL server-only. No NEXT_PUBLIC_ Supabase vars exist (§3.6) ──
SUPABASE_URL=
SUPABASE_SECRET_KEY=                    # sb_secret_… — full access, no RLS
SUPABASE_DB_URL=                        # migrations, session pooler port 5432

# ── AI providers — server only, never NEXT_PUBLIC_ ──────────
GOOGLE_GENERATIVE_AI_API_KEY=
GROQ_API_KEY=

# ── Access gate — not auth, just a doorbell (§3.6) ──────────
APP_ACCESS_TOKEN=                       # openssl rand -hex 32 — MUST be URL-safe

# ── App config ──────────────────────────────────────────────
AI_DEFAULT_CHAT_PROVIDER=groq
AI_QUOTA_SAFETY_MARGIN=0.8
APP_TIMEZONE=Asia/Tokyo
NEXT_PUBLIC_APP_URL=
```

**Two changes from the original.** `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` are **gone** — with no RLS they would be a public database credential (§3.6). `SUPABASE_URL` replaces the former, server-side only. The publishable key is not needed at all.

**Key naming note.** Supabase has migrated from JWT keys (`anon` / `service_role`) to prefixed keys (`sb_publishable_…` / `sb_secret_…`); **the legacy keys are deprecated by end of 2026.** Take the secret key from the dashboard's **API Keys** tab, not **Legacy API Keys** or **JWT Keys**.

Quota-router note: Gemini daily quotas reset at **midnight Pacific**, not local. `ai_usage_daily.usage_date` must bucket on `America/Los_Angeles` for Google and UTC for Groq — two different day boundaries in one table.

---

## 7. Technical risks

| # | Risk | Mitigation |
|---|---|---|
| T1 | Gemini free limits unverified and recently cut | Verify in AI Studio before P1. Router degrades rather than errors. Groq-first for chat. |
| T2 | Groq `llama-3.3-70b` capped at 100 K tokens/day — long chat context burns it fast | Cap retrieved context to ~4 K tokens. Summarise conversations past 10 turns. Fall to `8b-instant` for trivial turns. |
| T3 | Embeddings are Gemini-only | Cache permanently keyed on `content_hash`. If Gemini becomes unavailable, chat degrades to SQL-tools-only — still answers most questions (they're mostly aggregations). |
| T4 | iOS evicts IndexedDB with pending writes | Cloud is truth; flush on every focus; visible pending count; `storage.persist()` |
| T5 | pgvector HNSW build on Supabase free tier | Corpus is ~500 docs. Trivial. Revisit past 50 K. |
| T6 | Recharts defaults fight the Instrument aesthetic | All charts go through `components/charts/*` wrappers reading CSS tokens. Load the `dataviz` skill before building any chart. |
| T7 | Vercel Hobby 10 s function timeout | Grounded resolution p95 ≈ 4 s. Stream chat. Move embedding to a queued background route if it ever approaches the limit. |

---

## 8. Explain Like in High School

**Why there has to be a server at all.** You wanted a website you can use on your phone — so why not put everything in the browser? Because of the API keys. An API key is like your credit card for the AI service. Anything you put in browser code, anyone can read by opening developer tools. If your Groq key leaks, strangers spend your quota. So the app is split: the part you see runs on your phone, and a small piece runs on Vercel's servers where the keys live. Your phone asks the server "get me macros for white rice", the server talks to the AI, and the key never leaves the server.

**Why Postgres instead of just files.** The spreadsheet's whole problem was that it accepted anything. A real database lets you *declare* rules up front:

- "This column is a date" → text can't go in it
- "Muscle group must be one of these fifteen words" → typos are rejected
- "is_pr is true or false" → it can never become the number 80
- "There can only be one active calorie target" → the six-conflicting-targets mess is literally impossible

That last one is a real thing called a partial unique index. It's one line, and it permanently kills the bug that made your coach give advice based on the wrong weight.

**Why we compute volume automatically.** In the sheet, `Volume kg` was a formula you maintained by hand — and in four rows, notes text ended up in it instead of a number, so 1,802 kg silently vanished from your totals. Here the database computes it itself from weight × reps. You can't put text there because you can't write to it at all.

And it only computes for exercises where volume *means* something. Your abs machine showed 43,368 kg — more than your entire chest training — because 45 kg × 30 reps on a machine looks identical to a heavy compound lift if you just multiply. So every exercise now carries a tag saying what kind of load it is, and planks measured in seconds never get multiplied into a fake weight number.

**Two AI providers, and why we can't just pick one.** Groq is very fast — think 500 words a second — which makes chat feel alive. Google is more capable, and crucially it can *search Google* mid-answer and hand back the links it used, which is exactly what we need for looking up nutrition facts instead of letting the AI guess from memory.

But there's one job only Google can do: turning text into **vectors**. A vector is just a long list of numbers that represents meaning, so a computer can tell that "chicken breast" and "grilled poultry" are close together. Groq doesn't offer this at all. So the search-by-meaning part of the coach depends entirely on Google. That's the one piece with no backup, and it's written down as a known risk rather than discovered later.

**What the quota router does.** Both services give away a limited amount per day. Groq's fast big model allows 100,000 tokens a day — a token is roughly ¾ of a word, so that's maybe 75,000 words of conversation. Sounds like a lot until you realise every chat message resends the whole history plus your logs.

So there's a counter in the database tracking usage. At about 80% of a limit it quietly switches to the other provider. If everything's exhausted it does *not* show an error — it falls back to your own food library and says "AI paused until midnight". Because you should always be able to log food. That's the point of the app; the AI is a convenience on top.

**Why the counter lives in the database and not in memory.** Vercel runs your server code in short-lived instances that don't share memory — one request might run on a completely different machine than the next. A counter in a normal variable would reset constantly and be useless. The database is the only thing all of them can see.

**How offline works, and the iPhone problem.** Normally: you tap save, it writes to your phone's own storage instantly, and separately tries to upload. If there's no signal it sits in a queue and goes up later. You never wait for the network.

Android has a proper API for "finish this upload later even if the app is closed". **iOS Safari doesn't.** So we upload every time you *open* the app instead — plus when signal returns, plus on pull-to-refresh. Slightly less elegant, completely reliable.

The nastier iOS issue: Safari can **delete** a web app's stored data if you haven't opened it in about seven days. That's why the cloud is the real home for your data and your phone is a temporary holding area — not the other way round. There's also a browser API to ask "please don't delete my data", which we call once you log in, and the app shows you whether it was granted rather than hiding it.

**Idempotency, which sounds scarier than it is.** If your phone uploads a set, then loses signal before hearing "got it", it'll try again — and you'd get the same set twice. So your phone invents the ID for each row *before* uploading. If the same ID arrives twice, the database says "already have that one" and ignores it. This is how your spreadsheet ended up with the same workout session listed twice; here it can't happen.

**Why we store macros per 100 g.** Worth repeating because it's the core of the design. Store the *rate*, not the total. "126 calories per 100 g of rice" lets you compute any amount forever. "This meal was 252 calories" plus a text note saying "200g" is a dead end — you can't rescale it, which is why the spreadsheet couldn't either.

**Why old entries never change.** When you log something, the app copies the calculated numbers into that entry and freezes them. If you later discover your rice figure was wrong and fix it, the fix applies going forward — last month's chart still shows what you actually believed and ate at the time. Otherwise correcting one food would silently rewrite months of history, and you'd never be able to trust a trend line again.
