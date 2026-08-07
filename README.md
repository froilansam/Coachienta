# Coachienta

A personal food + training log with an AI coach. One user, no accounts, offline-first.

It replaces a 20-tab spreadsheet whose worst habit was confidence: six conflicting calorie
targets, four phases all marked "Active", and a coach prompt that hardcoded a bodyweight
6 kg out of date and computed every calorie figure from it. Most of the design here exists
to make those specific failures impossible rather than merely discouraged.

- **Specs** — `docs/README.md` first, then the PRD it points you at.
- **Working rules and hard-won facts** — `AGENTS.md`. Read it before changing anything;
  it records the things that cost hours to discover, with the evidence.

## Running it

```bash
npm install
cp .env.example .env.local     # fill in — see docs/PRD-008-credentials-setup.md
npm run migrate                # idempotent; safe to re-run
npm run dev
```

Then unlock the device once: `/unlock` and paste the token, or open `/?k=$APP_ACCESS_TOKEN`.
A one-year cookie is set and you never see it again. This is a doorbell, not a login —
there is no account, no identity, and no password typed.

## Commands

```bash
npm run dev          # Turbopack
npm run build        # --webpack, required: Serwist's config is only applied in this phase
npm run typecheck
npm test             # vitest — pure functions only
npm run test:e2e     # playwright — against REAL Postgres; cleans up after itself
npm run migrate      # applies supabase/migrations/*.sql
npm run sweep        # drives every flow in a browser against `next dev`, reports console faults
```

Three probes exist because some things cannot be asserted in CI — they need a human
looking at the output:

```bash
npm run probe:vision <photo>                                  # what the model sees in a real photo
npm run probe:plan "Upper Body"                               # what it builds from a real prompt
npm run probe:coach "what was my average protein last week"   # a real coach turn, with its tool calls
```

## Deploying

GitHub → Vercel, deploying on push. Vercel is not decoration: it is the only reason the AI
and database keys stay secret. The browser calls a route handler; the route handler calls
Gemini, Groq or Postgres. No key ever reaches the phone.

1. Push to a **private** GitHub repo.
2. Import it at [vercel.com/new](https://vercel.com/new). Next.js is auto-detected, and
   `npm run build` already carries `--webpack`.
3. Add **every** variable from `.env.example` under Settings → Environment Variables,
   for Production, Preview and Development. The app throws at boot on a missing or
   malformed one rather than starting up half-configured (`lib/env.ts`).
4. Deploy, then open `https://<your-app>/?k=$APP_ACCESS_TOKEN` once per device.

Migrations run against the same Supabase project in every environment, so `npm run migrate`
from your machine is what updates production. There is no separate production database.

### Two things that are easy to get wrong

- **`APP_ACCESS_TOKEN` must be URL-safe hex.** A base64 token breaks `?k=` because `+`
  decodes to a space. `openssl rand -hex 32` produces the right shape.
- **`vercel.json` pins functions to `hnd1` (Tokyo)** because Supabase is in
  `ap-northeast-1`. Left on a US default, every query crosses the Pacific — and a single
  coach turn makes several.

### If a secret ever touches a commit

Rotate it. Deleting the line does not remove it from git history, and the old key still
works. `docs/PRD-008-credentials-setup.md` §8 has the per-provider steps.

## State

| | |
|---|---|
| Shipped | Food logging with photo/label reading · training log with PRs and trends · profile, goals and coach rules · AI plan builder · AI coach with SQL tools |
| Tests | 448 unit, 119 E2E (3 skipped — 2 for a known service-worker gap, 1 when the day's AI quota is spent) |
| Not built | Vector search over logged days (`search_logs`), coach message feedback, conversation persistence |

Per-feature acceptance-criteria coverage is tracked honestly in each PRD's build-status
section — ✅ / ⚠️ / ❌ per criterion, with what is still open named rather than implied.
