# PRD-008 · Coachienta — Credentials, API Keys & Account Setup

| | |
|---|---|
| **Status** | Draft v1 · 2026-08-06 |
| **Audience** | You, doing this once, before any code runs |
| **Blocks** | P0 — nothing can be scaffolded until §9's checklist is green |
| **Depends on** | PRD-001 (§2 providers, §3.6 security, §6 environment) |
| **Time required** | ~35 minutes for the required set |
| **Money required** | **£0 / $0.** No credit card is needed for anything marked Required. |

---

## 1. What you actually need

Four accounts. Two of them issue AI keys, one is your database, one is hosting.

| # | Service | What it gives you | Cost | Card needed? | Time |
|---|---|---|---|---|---|
| 1 | **Google AI Studio** | Gemini — dish estimation, vision, **embeddings** | Free tier | ❌ No | 5 min |
| 2 | **Groq** | Fast chat inference | Free tier | ❌ No | 3 min |
| 3 | **Supabase** | Postgres + pgvector + Auth + Storage | Free tier | ❌ No | 10 min |
| 4 | **Vercel** | Hosting + the server that holds your keys | Hobby (free) | ❌ No | 5 min |
| 5 | **GitHub** | Code repo, triggers Vercel deploys | Free | ❌ No | 2 min |
| 6 | **USDA FoodData Central** | Structured nutrition data — primary macro source | Free | ❌ No | 2 min |
| 7 | *Open Food Facts* | Branded/packaged nutrition — **no account, no key, nothing to do** | Free | ❌ No | **0 min** |

**Google AI Studio is the one with no substitute.** Groq offers no embedding model at all (PRD-001 §2.1), so semantic search in Coachienta depends on Gemini alone. Everything else has a fallback.

### Full credential inventory

| Env var | From | Secret? | Used by |
|---|---|---|---|
| `GOOGLE_GENERATIVE_AI_API_KEY` | Google AI Studio | 🔴 **Secret** | Macro resolution, vision, embeddings |
| `GROQ_API_KEY` | Groq Console | 🔴 **Secret** | Coach chat |
| `SUPABASE_URL` | Supabase | 🔴 Server-only | Server DB client |
| `SUPABASE_SECRET_KEY` | Supabase | 🔴 **Secret** | All DB access, migrations, seed import |
| `SUPABASE_DB_URL` | Supabase (contains the DB password) | 🔴 **Secret** | CLI migrations |
| `APP_ACCESS_TOKEN` | You — `openssl rand -hex 32` | 🔴 **Secret** | Route gate (§6). **Hex, not base64** — `+` in a URL decodes to a space and breaks `?k=`. |
| `USDA_FDC_API_KEY` | api.data.gov (free, instant) | 🔴 Secret | Macro lookup — primary source |
| `NEXT_PUBLIC_APP_URL` | You | 🟢 Public | Absolute URLs, PWA metadata |

🔴 **Secret** means: server-only. Never prefixed `NEXT_PUBLIC_`, never imported into a component, never committed.

> **There is no publishable Supabase key here, deliberately.** With no auth there is no RLS, so a browser-side Supabase key would be a public read/write database credential. The browser talks only to our own API routes (PRD-001 §3.6). `NEXT_PUBLIC_APP_URL` is the only public variable in the app.

---

## 2. Google AI Studio → `GOOGLE_GENERATIVE_AI_API_KEY`

### Steps

1. Go to **https://aistudio.google.com/apikey**
2. Sign in with your Google account.
3. Accept the Terms of Service if prompted. On first acceptance, Google **automatically creates a default Google Cloud project** for you and may create a key immediately.
4. Click **Create API key**.
5. If asked to pick a project, choose the auto-created default (something like `Gemini API`). Don't create a new Cloud project — there's no benefit here.
6. **Copy the key immediately.** It looks like `AIza...`. You can re-open it later from this page, but copy it now anyway.
7. Give it a name you'll recognise: `coachienta-prod`.

### ⚠️ How to stay on the free tier

This is the part people get wrong.

Your API key belongs to a Google Cloud project. **Free tier vs paid tier is determined by whether that Cloud project has billing enabled.** The key itself is identical either way.

- **Do NOT enable billing** on the Cloud project. No billing = free tier = hard-capped at free limits = **cannot be charged**.
- If you ever see a "Set up Billing" or "Upgrade" prompt in AI Studio, decline it.
- Hitting your free limit returns HTTP `429`. It does not silently start charging you. That's the behaviour we want, and PRD-001 §2.4's quota router is built to handle it.

To confirm: open **https://console.cloud.google.com/billing** → your project should show **no billing account linked**.

### ⚠️ Verify your actual rate limits — this is PRD-000 Q1

Google's public docs deliberately don't publish free-tier per-model numbers, third-party sources disagree, and **quotas were cut 50–80% on 2025-12-07**. You need the real numbers before P1.

1. Go to **https://aistudio.google.com/**
2. Open the left sidebar → **Dashboard**, or go directly to the **Rate limits** page (linked from the API key page).
3. Record, for each model we use, the **RPM**, **TPM** and **RPD**:
   - `gemini-3.6-flash`
   - `gemini-3.5-flash-lite`
   - `gemini-embedding-001`
4. ⚠️ **Google Search grounding has NO free allowance** — verified 2026-08-06, returns `429` on the first call. Do not plan around it (PRD-001 §2.2).
5. ⚠️ **`gemini-2.5-*` models return `404 — no longer available to new users`.** Pin `gemini-3.6-flash`.
6. **Write those numbers into PRD-001 §2.2** and close PRD-000 Q1.

Two facts to remember: limits are **per Cloud project, not per key** (making a second key gains you nothing), and daily quotas reset at **midnight Pacific Time**, not your local midnight. The quota router's date bucketing must use Pacific.

### Verify the key works

```bash
export GOOGLE_GENERATIVE_AI_API_KEY="AIza..."

curl -s "https://generativelanguage.googleapis.com/v1beta/models?key=$GOOGLE_GENERATIVE_AI_API_KEY" \
  | head -40
```

Expect a JSON list of models. A `400` with `API_KEY_INVALID` means the key is wrong; `403` usually means the Generative Language API isn't enabled on the project (AI Studio normally does this for you).

Then test the one thing only Gemini can do:

```bash
curl -s "https://generativelanguage.googleapis.com/v1beta/models/gemini-embedding-001:embedContent?key=$GOOGLE_GENERATIVE_AI_API_KEY" \
  -H 'Content-Type: application/json' \
  -d '{"content":{"parts":[{"text":"200g white rice"}]},"outputDimensionality":768}'
```

Expect an array of 768 floats. If this fails, Feature 3's semantic search cannot work — deal with it now, not at P4.

> **Naming note.** Google's own SDKs auto-detect `GEMINI_API_KEY` or `GOOGLE_API_KEY`. The Vercel AI SDK provider we're using (`@ai-sdk/google`) reads **`GOOGLE_GENERATIVE_AI_API_KEY`**. Use that name. Setting all three to the same value is harmless if you're switching between tools.

---

## 3. Groq → `GROQ_API_KEY`

### Steps

1. Go to **https://console.groq.com**
2. Sign up — Google or GitHub sign-in is fastest. **No credit card.**
3. Go to **https://console.groq.com/keys**
4. Click **Create API Key**.
5. Name it `coachienta`.
6. **Copy it now.** It looks like `gsk_...`. Groq shows the secret **once** — if you lose it you must delete the key and make a new one.

### Confirm the limits we planned around

Open **https://console.groq.com/settings/limits** and confirm the models in PRD-001 §2.2. The numbers I planned against:

| Model | RPM | RPD | TPM | **TPD** |
|---|---|---|---|---|
| `llama-3.3-70b-versatile` — coach chat | 30 | 1,000 | 12,000 | **100,000** |
| `llama-3.1-8b-instant` — cheap classification | 30 | 14,400 | 6,000 | **500,000** |
| `qwen/qwen3.6-27b` — vision fallback | 30 | 1,000 | 8,000 | 200,000 |
| `compound-mini` — web-search fallback | 30 | 250 | 70,000 | — |

**The 100,000 tokens/day on the 70B model is the binding constraint in the whole product.** PRD-005 §3.4's token budget exists specifically to live inside it.

### Verify

```bash
export GROQ_API_KEY="gsk_..."

curl -s https://api.groq.com/openai/v1/chat/completions \
  -H "Authorization: Bearer $GROQ_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"model":"llama-3.3-70b-versatile","messages":[{"role":"user","content":"Reply with OK"}],"max_tokens":5}'
```

Base URL is `https://api.groq.com/openai/v1` — Groq is OpenAI-compatible, which is why provider switching in PRD-001 §2.3 is a one-line change.

---

## 3a. Open Food Facts → nothing to obtain

**No API key. No account. No signup.** Read access needs only a `User-Agent` header identifying the app:

```
User-Agent: Coachienta/0.1 (froye@example.com)
```

Format `AppName/Version (ContactEmail)` is mandatory — requests without it get blocked. There is no env var for this; it is a constant in `lib/nutrition/openFoodFacts.ts`.

Rate limits, per IP: **15/min** for barcode lookups, **10/min** for search. Writes would need an account — we never write.

⚠️ Two verified traps are documented in PRD-003 §3.1a: `/api/v2/search?q=` **silently ignores `q`** and returns the whole database, and OFF records frequently have `null` macros and must be rejected unless all four fields are numeric. Read that section before implementing.

---

## 4. Supabase → four values

### 4a. Create the project

1. Go to **https://supabase.com** → **Start your project** → sign in with GitHub.
2. **New project**.
3. Fill in:
   - **Name:** `coachienta`
   - **Database Password:** click Generate, then **save it in your password manager right now.** It is shown once and you need it for CLI migrations. Recovering it later means resetting it.
   - **Region:** pick the one nearest you. Given Japanese food entries and an `Asia/Tokyo` timezone, **Northeast Asia (Tokyo)** — every query round-trip goes through this.
   - **Plan:** Free.
4. Wait ~2 minutes for provisioning.

### 4b. Get the URL and keys

1. In your project → **Settings** (gear icon) → **API Keys**.
2. Copy:
   - **Project URL** → `SUPABASE_URL` (like `https://abcdefgh.supabase.co`)
   - **Secret key** (`sb_secret_...`) → `SUPABASE_SECRET_KEY` — click to reveal, then **🔴 treat as a password**

**You do not need the publishable key.** With no auth there is no RLS, so a browser-side Supabase key would be a public read/write credential for your database. The browser talks only to our own API routes (PRD-001 §3.6). Leave it in the dashboard.

> **⚠️ Key naming changed.** Supabase moved from JWT keys (`anon` / `service_role`) to prefixed keys (`sb_publishable_...` / `sb_secret_...`). **The legacy keys are deprecated by the end of 2026.** Your dashboard has an **API Keys** tab (new) and **Legacy API Keys** / **JWT Keys** tabs (old) — **take the secret key from the new one.**

**What the secret key can do:** everything. It bypasses Row Level Security by design (`BYPASSRLS`), which is exactly why it must never reach a browser and why it is the only key we use.

Helpful safety net: Supabase **blocks secret keys sent from a browser** by matching the User-Agent and returning `401`. Don't rely on it, but it means an accidental leak into client code fails loudly rather than silently working.

### 4c. Enable pgvector

Feature 3 needs it. **SQL Editor** → **New query**:

```sql
create extension if not exists vector;
create extension if not exists pg_trgm;   -- fuzzy food-name matching, PRD-003 §3
select extname, extversion from pg_extension where extname in ('vector','pg_trgm');
```

Run it. Both should appear. `pg_trgm` powers step 4 of the food resolution cascade — without it, fuzzy matching falls back to slow `LIKE` scans.

### 4d. Get the DB connection string (for migrations)

⚠️ **This is not in the Settings sidebar.** On the current dashboard, Settings only contains General / Infrastructure / Integrations / API Keys / JWT Keys / Log Drains / Add-ons — there is no Database section.

1. Click the green **`Connect`** button at the **top of the page**, beside the branch selector (`main / PRODUCTION`).
2. Go to the **Connection String** tab.
3. Choose **Session pooler**.
4. Copy the URI. It contains `[YOUR-PASSWORD]` as a placeholder — substitute the password from 4a.

**Use the session pooler, not the direct connection.**

| | Host | Verdict |
|---|---|---|
| Direct | `db.<ref>.supabase.co:5432` | ❌ **IPv6-only** on newer projects. Fails with a confusing DNS error on IPv4-only networks — most home ISPs, most café wifi. |
| **Session pooler** | `aws-0-<region>.pooler.supabase.com:5432` | ✅ IPv4-friendly, supports all DDL |
| Transaction pooler | `…pooler.supabase.com:6543` | ❌ Doesn't support all DDL — migrations will fail |

Store as `SUPABASE_DB_URL`. Never commit it — it contains full database credentials.

### Verify

```bash
curl -s "$NEXT_PUBLIC_SUPABASE_URL/rest/v1/" \
  -H "apikey: $NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY"
```

Expect an OpenAPI JSON document. `401` means a bad key.

---

## 5. Vercel + GitHub

Vercel is not optional decoration — **it is the only reason your AI keys stay secret.** The browser calls your Vercel route handler; the route handler calls Gemini or Groq. The key never leaves the server (PRD-001 §3.6).

### Steps

1. Create a GitHub account if you don't have one → **https://github.com**
2. Create a repo: `coachienta`, **Private**.
3. Go to **https://vercel.com** → **Sign Up** → **Continue with GitHub**.
4. Choose the **Hobby** plan (free). No card.
5. **Add New → Project** → import `coachienta`.
6. **Before deploying**, expand **Environment Variables** and add all of them (§7).
7. Deploy.

### Hobby plan limits to know about

| Limit | Value | Relevance |
|---|---|---|
| Function timeout | **10 s** default | Grounded resolution p95 ≈ 4 s. Fine, but chat **must stream** (PRD-001 T7). |
| Bandwidth | 100 GB/month | Irrelevant at one user. |
| Commercial use | Not permitted on Hobby | This is a personal app. Fine. |

No Vercel API token is needed — the GitHub integration deploys on push.

---

## 6. No auth — nothing to configure

**There is no authentication in this app.** No Supabase Auth, no email provider, no password, no users table, no login screen. Single user, single dataset. Decision recorded in PRD-001 §3.6.

**Nothing to do in the Supabase dashboard.** Skip Authentication entirely. As a side effect this also sidesteps the free tier's 2-auth-emails-per-hour limit and the 2026-06-03 change restricting email template editing — neither applies if you never send an auth email.

### The one thing this does require

Removing auth removes RLS, and RLS was the only reason a public Supabase key was safe. So:

- **Do not put any Supabase key in the browser.** No `NEXT_PUBLIC_SUPABASE_*` variables. All database access runs server-side through Route Handlers with the secret key (PRD-001 §3.6).
- **Generate one access token** so your API routes aren't callable by anyone who finds the URL:

```bash
openssl rand -hex 32
```

Store it as `APP_ACCESS_TOKEN` in `.env.local` and Vercel. Visit `/unlock?k=<token>` once per device; a one-year cookie is set and you never see a prompt again. This is a doorbell, not a login — no accounts, no identity, no password typed.

### Optional hardening, once the app is stable

Supabase → **Settings → Data API** → **disable the Data API**. Since the browser never uses it, turning it off means even a leaked secret key has no public REST surface to attack. Purely additive; do it after things work.

### If you later want real auth

Only relevant if someone else uses the app, or you want data isolation across accounts. It's a mechanical migration: add `user_id uuid references auth.users` to each table, backfill with your single id, enable RLS with `user_id = auth.uid()`, then move reads back to the client with a publishable key. Nothing in the current design blocks it.

---

## 7. Wiring the values in

### Local development

Create `.env.local` at the repo root:

```bash
# ── Supabase (all server-only — no NEXT_PUBLIC_) ──────────
SUPABASE_URL=https://abcdefgh.supabase.co
SUPABASE_SECRET_KEY=sb_secret_xxxxxxxx
SUPABASE_DB_URL=postgresql://postgres.abcdefgh:PASSWORD@aws-0-ap-northeast-1.pooler.supabase.com:5432/postgres

# ── AI providers (server only — no NEXT_PUBLIC_) ──────────
GOOGLE_GENERATIVE_AI_API_KEY=AIzaxxxxxxxx
GROQ_API_KEY=gsk_xxxxxxxx

# ── Access gate — not auth, see §6 ────────────────────────
APP_ACCESS_TOKEN=generate_with_openssl_rand_base64_32

# ── App config ────────────────────────────────────────────
AI_DEFAULT_CHAT_PROVIDER=groq
AI_QUOTA_SAFETY_MARGIN=0.8
APP_TIMEZONE=Asia/Tokyo
NEXT_PUBLIC_APP_URL=http://localhost:3000
```

**Confirm `.gitignore` contains this before your first commit:**

```gitignore
.env
.env*.local
```

Next.js scaffolding includes it by default. Check anyway — a leaked key in git history is painful to remove properly.

### Vercel

**Project → Settings → Environment Variables.** Add each one, ticking **Production**, **Preview** and **Development**.

`vercel env pull .env.local` syncs them down later, so Vercel becomes the single source of truth and you don't maintain two lists.

### The `NEXT_PUBLIC_` rule — read this once, carefully

In Next.js, **any variable prefixed `NEXT_PUBLIC_` is inlined into the JavaScript bundle sent to the browser.** Anyone can read it with DevTools.

- ✅ `NEXT_PUBLIC_SUPABASE_URL` — public by design
- ✅ `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` — public by design, RLS protects the data
- 🔴 `GOOGLE_GENERATIVE_AI_API_KEY` — **prefixing this would publish your AI key to the internet**
- 🔴 `GROQ_API_KEY` — same
- 🔴 `SUPABASE_SECRET_KEY` — this one bypasses RLS entirely; publishing it exposes all your data

There is never a reason to prefix an AI key. If a component seems to need one, the architecture is wrong — the call belongs in a route handler.

---

## 8. Security & incident response

### Standing rules

1. **Secrets only in `.env.local` and Vercel.** Never in code, comments, commit messages, screenshots, or a chat window.
2. **Never `console.log` a key.** Log at most the last 4 characters if you must identify one.
3. Route handlers only. `lib/ai/*` runs server-side; it must never be imported by a client component. Add `import 'server-only'` at the top of those modules so a mistake becomes a build error rather than a leak.
4. RLS on every table, no exceptions (PRD-001 §3.6).
5. Private GitHub repo.

### If a key leaks

Rotate immediately — assume it's already being used.

| Key | Rotation |
|---|---|
| Gemini | AI Studio → API keys → **Delete** the key → **Create API key** → update Vercel + `.env.local` → redeploy |
| Groq | Console → Keys → **Delete** → **Create API Key** → update → redeploy |
| Supabase **secret** | **Highest urgency — this is full database access.** Settings → API Keys → rotate. Deletion is irreversible. Then check your tables for unexpected or missing rows. |
| `APP_ACCESS_TOKEN` | Generate a new one, update env, redeploy. Old device cookies stop working — revisit `/unlock?k=<new>` once per device. |
| DB password | Settings → Database → **Reset database password**. Update `SUPABASE_DB_URL` everywhere. |

If a key ever reached a git commit, rotating is mandatory — deleting the line in a later commit does **not** remove it from history.

### Cost guardrails

The app is designed to be unable to cost money, but verify each:

| Service | Guardrail | Check |
|---|---|---|
| Gemini | No billing on the Cloud project → hard-capped, returns `429` | https://console.cloud.google.com/billing shows no linked account |
| Groq | Free tier has no card on file | Console → Billing shows no payment method |
| Supabase | Free plan; projects **pause after 7 days inactive** rather than charging | Dashboard shows Free. Open the app weekly, or expect a manual unpause. |
| Vercel | Hobby has no paid overage; it throttles | Settings → Billing shows Hobby |

⚠️ **Supabase free-tier projects pause after ~7 days of inactivity.** For a daily-use app that never triggers. If you travel and stop logging for a week, the first load afterwards needs a manual unpause from the dashboard. Worth knowing before you conclude the app is broken.

---

## 9. Setup checklist

Work top to bottom. P0 scaffolding is blocked until every box is ticked.

**Accounts**
- [ ] Google account with AI Studio access
- [ ] Groq account
- [ ] GitHub account, private `coachienta` repo
- [ ] Vercel account on Hobby, linked to GitHub
- [ ] Supabase account

**Google AI Studio**
- [ ] API key created and saved to a password manager
- [ ] **Billing NOT enabled** on the Cloud project — verified in Cloud Console
- [ ] `curl` model-list check returns 200
- [ ] `curl` **embedding** check returns 768 floats ← blocks Feature 3
- [ ] **Free-tier RPM / TPM / RPD recorded for each model** ← closes PRD-000 Q1
- [ ] Google Search grounding allowance recorded

**Groq**
- [ ] API key created and saved
- [ ] `curl` chat completion returns 200
- [ ] Rate limits confirmed against PRD-001 §2.2 — especially the 100k TPD on the 70B

**Supabase**
- [ ] Project created in the Tokyo region
- [ ] **Database password saved to a password manager** (shown once)
- [ ] Project URL and **secret** key copied (publishable key not needed)
- [ ] Using the **new** `sb_secret_` key, not a legacy JWT / `service_role` key
- [ ] `vector` and `pg_trgm` extensions enabled and verified
- [ ] Connection string saved — **session pooler**, port 5432, user `postgres.<ref>`
- [ ] ~~Auth~~ — nothing to do, there is no auth (§6)
- [ ] `APP_ACCESS_TOKEN` generated with `openssl rand -hex 32`

**Wiring**
- [ ] `.gitignore` contains `.env*.local` — checked before first commit
- [ ] `.env.local` populated
- [ ] All vars added to Vercel for Production + Preview + Development
- [ ] No AI or secret key carries a `NEXT_PUBLIC_` prefix
- [ ] `import 'server-only'` at the top of every module in `lib/ai/`

**Cost**
- [ ] No card on file anywhere
- [ ] Aware Supabase pauses after 7 idle days

---

## 10. Explain Like in High School

**Why you need any of this.** The app is made of parts you don't own: two AI services, a database, and a web host. Each one needs to know it's really you calling. An API key is that proof — a long random password the service issues to you.

The whole job of this document is: get four passwords, put them somewhere the internet can't read, and prove none of them can cost you money.

**The single most important idea: public vs secret.**

Your app has two halves. The half on your phone — HTML and JavaScript your browser downloads — and the half on Vercel's servers.

**Anything in the phone half is readable by anybody.** Not "hard to read". Readable. Open developer tools, look at the JavaScript, there it is. There's no such thing as hiding a secret in a browser.

So your AI keys live in the server half only. Your phone asks *your* server "get me the macros for white rice", your server calls Gemini using the key, and hands back the answer. The key never travels to your phone. That is the entire reason Vercel is in this stack at all — not for hosting, for key custody.

**Next.js makes this concrete with a naming rule.** Any variable starting with `NEXT_PUBLIC_` gets baked into the browser code. Anything else stays on the server. So:

- `NEXT_PUBLIC_SUPABASE_URL` — fine, it's just an address
- `GROQ_API_KEY` — **if you ever add that prefix, you've published your AI key to the internet**

It's a one-word mistake with a real consequence, which is why there's a checklist item for it.

**Why there's no Supabase key in the browser at all.**

Supabase gives you two keys. The **publishable** one is meant to be public — every visitor's browser holds it. It's safe *only* because of Row Level Security: a rule inside the database saying "you may only see rows belonging to the logged-in user". The key gets you to the door; the login gets you through it.

We have no login. So there's no "logged-in user", so RLS has nothing to check, so it has to be off — and with it off, that publishable key stops being a harmless identifier and becomes a **working read/write password for your database, sitting in a file anyone can download.**

The fix isn't to add a login back. It's to stop the browser talking to the database at all. Your phone talks only to your own server; your server talks to Supabase with the **secret** key. There is no Supabase credential in the browser to steal, so the whole problem disappears.

That's why the credential list has no publishable key in it — not an oversight.

**And the doorbell.** With no login, your `/api/*` routes are just URLs on the internet. A bot that finds them could read your logs or drain your AI quota — not because your data is juicy, but because scanners hit everything.

So there's one long random string. You visit a link containing it **once per device**, ever. A cookie is set for a year and you never see it again. No form, no email, no password, no account, nothing to log out of. It's a doorbell, not a lock — it just means anonymous traffic gets a 404 instead of your database.

**How to be certain Google can't charge you.** This is the bit worth being careful about, because "free tier" usually means "free until you accidentally exceed it, then billed".

Your Gemini key belongs to a Google Cloud project. Whether you're on free or paid depends entirely on **whether that project has billing switched on** — the key is the same either way.

If billing is off, there's no payment method attached, so exceeding your limit can't charge you. Instead the API returns error `429 Too Many Requests`. That's actually the behaviour we want, and PRD-001's quota router is built expecting it: at 80% of a limit it switches to Groq, and if everything's exhausted it falls back to your own food library and shows "AI paused until midnight".

So the rule is simply: **never enable billing, and decline every upgrade prompt.**

**The thing I need you to actually do, not just read.** Somewhere in this document there's a step that unblocks a decision I couldn't make for you.

Google deliberately doesn't publish free-tier limits per model — their docs say "check your dashboard". Third-party blogs disagree with each other, and Google cut free quotas by 50–80% in December 2025. So I genuinely don't know your real numbers.

Open AI Studio, write down the requests-per-minute and requests-per-day for each model, and that closes the last open question in the whole PRD set. It determines whether Groq or Gemini leads for chat, which is a real architectural fork.

**Tokens per day, and why it's the tightest constraint.** A token is roughly ¾ of a word. Groq's good model allows 100,000 tokens a day free, which sounds like an enormous amount of conversation.

It isn't, because every message resends the whole history plus your instructions plus whatever data got looked up. Careless, you'd burn it in about twenty messages. That's exactly why PRD-005 has a token budget — keep six turns of history, summarise the rest, cap retrieved data, and send trivial replies to the small model. Gets you ~16 real coaching conversations a day.

**The email trap I nearly walked us into.** I'd originally specified magic-link login — you type your email, get a link, tap it, you're in. Lovely on a phone.

Then I checked: **Supabase's free tier sends 2 emails per hour.** Two. So during development you'd hit that constantly, and if you mistyped your email twice you'd be locked out for an hour. There's also a change landing 3 June 2026 where new free projects can't even customise those emails.

So: **email and password, with email confirmation turned off.** You're the only user — there's nobody to verify you're you. Zero emails ever sent, limit becomes irrelevant. Sessions persist, so you'll type the password roughly once per device.

Magic links are still available later by plugging in a free email service called Resend. It's a nice-to-have, not a blocker.

**Pick Tokyo for the database region.** Every single thing the app does involves a round trip to the database. If the server's in Virginia and you're in Japan, that's ~150ms of pure travel time on every query, before any actual work. Tokyo makes it ~10ms. It's the cheapest performance decision available and it's irreversible without recreating the project.

**Save the database password properly, right now.** Supabase shows it exactly once, at project creation. It's not the same as the API keys and you can't look it up later — only reset it. You need it to run migrations. Password manager, immediately, before you click away.

**Why a leaked key must be replaced, not just deleted from the code.** Git remembers everything. If a key lands in a commit and you delete the line in the next commit, the key is still sitting in your repository's history, permanently, readable by anyone who clones it.

So the rule is: if a secret ever touched a commit, **rotate it** — delete it at the provider and issue a new one. Removing the text isn't enough, because the old key still works. Deleting it at the source is what makes it harmless.

**One quirk to expect.** Supabase pauses free projects after about 7 days with no activity. Using the app daily, this never happens. But if you go on holiday for two weeks, the app will look broken when you come back — it isn't, it just needs an unpause click in the dashboard. Better to know now than to debug it later.
