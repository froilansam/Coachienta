# PRD-006 · Feature 4 — Profile, Goals & Agent Instructions

| | |
|---|---|
| **Status** | Draft v1 · 2026-08-06 · Phase P2 |
| **Depends on** | PRD-000, PRD-001 (§3.4 schema) |
| **Consumed by** | PRD-003 (targets on Today), PRD-004 (rule conflicts), PRD-005 (prompt assembly) |
| **Core thesis** | One number, one home. Everything else reads it. |

---

## 1. Problem

This feature exists because the spreadsheet's policy layer contradicted itself in five separate ways, and every downstream defect traced back here.

**Six different calorie targets across six tabs:**

| Source | Gym day | Rest day | Protein |
|---|---|---|---|
| Dashboard `C9:C12` (hardcoded literals) | 2,500 | — | 160 |
| Instructions & Goals r13–19 | 2,500 | 2,250 | 160 |
| Instructions & Goals r60 | 2,100–2,250 | 1,900–2,050 | 160–170 |
| Coach Agent r36–42 | 2,300–2,500 | 2,000–2,200 | **128**–160 |
| Coach Agent r104 | 2,100–2,250 | 1,900–2,050 | 160–170 |
| **Body Stats / Nutritional Targets (newest)** | **2,300–2,400** | **2,300–2,400** | **160** |

**Four training phases simultaneously "Active":** lean bulk (+200–250 surplus) · a 6-week mini cut started 2026-06-01 (ended ~07-13) · post-mini-cut hypertrophy · 4-week maintenance recomp from 2026-08-04.

**Bodyweight stated four ways:** 64 kg (Coach Agent) · 67 kg · 69 kg · **70.0 kg** (Body Stats, measured 2026-08-04). The Coach Agent's BMR 1,619 and TDEE 2,509/2,226 were all derived from 64 kg.

**Body fat stated two ways:** ~10–13% (Coach Agent) vs 20% measured. A "stay ≤15% while bulking" ceiling had already been breached, invisibly.

**119 coach rules with no precedence field:** 113 dated 2026-06-15 and 6 dated 2026-07-01 in one flat list, with a 43-row blank band (rows 118–160) splitting them — so any top-down reader stops at row 117 and misses the six newest and highest-priority rules, including the one defining source of truth.

Every one of these is an *absence of structure*, not a data-entry mistake. This PRD supplies the structure.

---

## 2. User stories

| ID | Story | Priority |
|---|---|---|
| US-4.1 | As Froye, I edit my stats in one place and every screen and the coach use them immediately. | P0 |
| US-4.2 | As Froye, I log a weigh-in with **weight (kg)** and **waist (cm)**, and optionally **body fat %** — and the latest row *is* my current body stats. | P0 |
| US-4.2a | As Froye, I can see weight, waist, and body-fat over time on Profile so I can monitor the recomp without opening the spreadsheet. | P0 |
| US-4.3 | As Froye, I set nutrition targets with a start date, and exactly one set is ever active. | P0 |
| US-4.4 | As Froye, I declare my current training phase, and old phases become history, not competing truth. | P0 |
| US-4.5 | As Froye, I edit the coach's rules, and newer rules visibly supersede older ones. | P0 |
| US-4.6 | As Froye, BMR and TDEE recompute automatically when my weight changes. | P0 |
| US-4.7 | As Froye, I mark rules critical so the coach and the plan builder enforce them. | P1 |
| US-4.8 | As Froye, I set my physique priority order and see actual training measured against it. | P1 |
| US-4.9 | As Froye, I set milestone targets and track progress toward them. | P2 |
| US-4.10 | As Froye, the app warns me when my own settings contradict each other. | P1 |

---

## 3. Sub-features

### 3.1 Profile — exactly one row

`profile` uses the single-row-table pattern (`id boolean primary key default true check (id)`), so a second row is impossible. Fields: display name, birth date (age derived, never stored), height, sex, timezone (`Asia/Tokyo`), language preference, unit preference, medical notes.

**Medical notes** carry the jaw-surgery constraints (LeFort I + BSSO — soft-food bias, no Valsalva on heavy compounds unless cleared). These are injected into every coach turn as a safety constraint, not stored as a suggestion.

**Age is computed from `birth_date`**, never stored as a number. The spreadsheet stored `27` in three places; it would have silently gone stale on a birthday and quietly skewed every BMR calculation.

### 3.2 Body measurements — append-only, latest wins

The table can hold the full Yamato DF870 dump (weight, BF%, fat mass, lean mass, skeletal muscle, visceral fat, BMR, water, bone mass, waist, source, notes). Unique on `measured_on`.

**Primary log path (what Profile ships first)** — three fields only. Everything else is optional / advanced:

| Field | Unit | Required? | Why |
|---|---|---|---|
| `weight_kg` | kg | **Yes** | Current weight; drives BMR/TDEE and coach facts |
| `waist_cm` | cm | **Yes** on the quick form | V-taper / waist aesthetics — the number that actually tracks recomp for this user |
| `body_fat_pct` | % | **Optional** | Useful when the scale gives it; never block a weigh-in because BF% is missing |

Storage stays metric (kg / cm / %). Display never invents a second "current weight" column on `profile`.

**"Current" stats are not stored fields.** They are derived:

```sql
SELECT weight_kg, waist_cm, body_fat_pct
FROM body_measurements
ORDER BY measured_on DESC
LIMIT 1;
```

There is no second place for them to disagree with themselves — which is exactly how 64/67/69/70 kg coexisted before. Same rule for waist and body fat: latest non-null reading wins for that metric; a new weigh-in that omits BF% does **not** clear the previous BF% on the CURRENT strip (show last known BF% with its date), but the new row itself stores `body_fat_pct = null` honestly.

**Quick weigh-in sheet** (`[ ＋ LOG WEIGH-IN ]` on Profile / More):

```
LOG WEIGH-IN                              [06 AUG ⌄]
─────────────────────────────────────────────────────
WEIGHT     [  70.0 ] kg          ← required
WAIST      [  80.0 ] cm          ← required
BODY FAT   [       ] %   optional
─────────────────────────────────────────────────────
              [ SAVE WEIGH-IN ]
```

- Date chip defaults to today; backdating allowed (same-day conflict → update that day's row).
- Prefill weight / waist from the previous entry so a daily log is mostly confirm + nudge.
- Extended scale fields (lean mass, visceral fat, etc.) live behind `MORE FIELDS` — never on the default path.
- Writes go local-first via `enqueue()` on `body_measurements` (already in the offline queue tables) so a bathroom weigh-in with bad signal still sticks.

**Monitoring** (US-4.2a) — on the same Profile surface, below CURRENT:

- Spark / line for **weight (kg)**, **waist (cm)**, **body fat (%)** over 30 / 90 days (range toggle).
- Each series skips nulls rather than plotting zero.
- Weekly rate of change for weight and waist, compared to the active phase's `target_rate_kg_per_week`.
- Empty series copy: `NO WAIST LOGS YET` / "Log waist with your next weigh-in — it's the best recomp signal you have."

Import fixes on migration:
- Spreadsheet `Body Stats` row 4 said waist **87 cm** while its own log's newest reading was **80 cm**. The log wins; the standalone field is dropped.
- Two rows dated `2026-07-27` (one with 2 fields, one with 13). Merge, keep the complete one.
- The `2026-08-04` row has 5 of 14 fields blank. Import as-is; blanks are honest.

### 3.3 Nutrition targets — effective-dated, one active

```sql
create unique index one_active_target
  on nutrition_targets ((1)) where effective_to is null;
```

**This one line is the highest-value statement in the entire schema.** It makes the six-conflicting-targets defect unrepresentable.

Editing targets is a **supersede**, never an update:
1. `UPDATE nutrition_targets SET effective_to = :today - 1 WHERE effective_to IS NULL`
2. `INSERT` the new row with `effective_from = :today`, `effective_to = NULL`

Result: a complete audit trail of what you were targeting on any past date, and exactly one answer to "what am I targeting now". Historical adherence charts can evaluate each day against the target that was *actually* active then — something the spreadsheet could never do.

Fields: phase label, gym/rest kcal ranges, protein, gym/rest carb ranges, fat range, `kcal_floor` (the 1,800 hard floor), rationale.

Current active row from the audit:

| Field | Value |
|---|---|
| Phase | 4-week weight-maintenance recomp |
| Effective from | 2026-08-04 |
| Calories | 2,300–2,400 both gym and rest days |
| Protein | 160 g daily |
| Carbs | 290–315 g gym / 230–250 g rest |
| Fat | 65–75 g |
| Floor | 1,800 kcal |

### 3.4 Training phase & priorities

```sql
create table training_phases (
  id uuid primary key default gen_random_uuid(),
  label text not null,
  goal_kind text not null,          -- cut | lean_bulk | maintenance | recomp | peak
  effective_from date not null,
  effective_to date,
  target_weight_kg numeric(5,2),
  target_rate_kg_per_week numeric(4,3),   -- +0.15, −0.4, 0
  bf_ceiling_pct numeric(4,1),
  notes text
);
create unique index one_active_phase
  on training_phases ((1)) where effective_to is null;

create table physique_priorities (   -- the V-taper priority order
  rank int not null,
  muscle_group muscle_group not null,
  note text,
  primary key (rank)
);
```

Same one-active pattern. Seeded from the audit: shoulders (side/rear) → back/lats → upper chest → arms → legs.

`physique_priorities` is what makes PRD-004's priority-adherence chart and PRD-005's contradiction detection possible. It turns a stated intention into a measurable one.

`bf_ceiling_pct` makes the breached stop-condition visible: last reading 20% against a 15% ceiling. The app surfaces this rather than letting it sit in a contradicting tab.

### 3.5 Coach rules registry — precedence, finally

The spreadsheet's Coach Agent tab was well-designed in intent: `Section | Content | Owner | Use Case | Source | Last Updated`, with real provenance on all 119 rows. Its two structural failures were **no precedence field** and a 43-row blank band hiding the newest rules.

Ported to `coach_rules` (PRD-001 §3.4) with the missing pieces:

| New field | Fixes |
|---|---|
| `category` (enum) | The 17 free-text "Use Case" values collapse to a fixed set |
| `priority` (int) | Deterministic injection order |
| `is_critical` (bool) | Enforceable by the plan builder and coach, not just advisory |
| `effective_from` (date) | Real dating |
| `superseded_by` (uuid) | **The missing field.** Explicit replacement chains. |
| `is_active` (bool) | Retire without deleting |

**Rules UI** (`/profile` → Coach Rules):
- Grouped by `category`, ordered by `priority`
- Superseded rules collapsed under their replacement, greyed, with dates — history stays visible, precedence is unambiguous
- `CRITICAL` chip on enforced rules
- Provenance preserved from the sheet's `Source` column
- Live preview of the assembled system prompt, so what the coach actually receives is inspectable rather than mysterious

**Migration mapping** (119 rows → structured):

| Spreadsheet content | New home |
|---|---|
| Persona block (r9–10) | `category: 'persona'`, priority 0 |
| Athlete profile table (r11–23) | **Discarded as rules.** Becomes `profile` + `body_measurements`. This is the 64 kg fix. |
| Macro target tables (r36–42, r104) | **Discarded as rules.** Becomes `nutrition_targets`. This is the six-targets fix. |
| 8 skill domains (r51–83) | `category: 'persona'`, priority 10 |
| Coaching directives (r84–91) | Split by category, `is_critical` where stated |
| `showfoodlogs` / `logfood` skills (r94–100) | **Discarded.** These are now real app features, not prompt instructions. |
| Output format rules (7 rows) | `category: 'output_format'` |
| Exercise-order rules (OHP first, lat width first) | `category: 'exercise_order'`, `is_critical: true` |
| No-heavy-obliques rule | `category: 'safety'`, `is_critical: true` |
| Gym Switch Rule (r162) | **Discarded as a rule.** Becomes the `gyms` table (PRD-004 §3.2). |
| Handoff Rule (r165) | **Discarded.** Structurally guaranteed by prompt assembly. |
| Mini-cut rules (r104, r110, r116) | `is_active: false` — that phase ended ~2026-07-13 |
| Rows 118–160 (blank) | Nothing to migrate. Documented in the migration report. |

The pattern: **anything that is a fact becomes data; only genuine behavioural instructions remain rules.** That reduces 119 rows to roughly 35 real rules and eliminates the entire class of stale-fact-in-prompt bugs.

### 3.6 Derived calculations

Computed on read, never stored (US-4.6):

```ts
// lib/domain/coach/energy.ts
export function mifflinStJeor(weightKg, heightCm, age, sex): number {
  const base = 10*weightKg + 6.25*heightCm - 5*age
  return sex === 'male' ? base + 5 : base - 161
}
export function tdee(bmr: number, activity: ActivityLevel): number
```

At 70 kg / 179 cm / 27 / male → BMR ≈ **1,689 kcal**. The spreadsheet's stored 1,619 was computed at 64 kg — about 70 kcal low, propagating into every TDEE and target figure.

Displayed alongside the scale's own measured BMR (1,587 / 1,605 in the log) with both labelled, because they use different methods and neither is authoritative. Showing both honestly beats picking one silently.

The spreadsheet had a rule requiring exactly this recalculation on weight change (Instructions & Goals r52). The rule existed and was never executed — which is the argument for computing rather than instructing.

### 3.7 Self-consistency checks (US-4.10)

Runs on save and on `/profile` load. Warns, never blocks.

| Check | Warning |
|---|---|
| BF% > phase `bf_ceiling_pct` | "Last reading 20% exceeds your 15% ceiling for this phase." |
| Weight trend vs `target_rate_kg_per_week` | "Trending +0.15 kg/wk against a 0 kg maintenance target." |
| Protein target < 1.6 g/kg bodyweight | "160 g is 2.3 g/kg — fine. Below 112 g would be low for your goal." |
| Calorie target below `kcal_floor` | Hard block. The 1,800 floor is a safety rule. |
| Macro grams inconsistent with calorie range | "290 g carbs + 160 g protein + 75 g fat ≈ 2,475 kcal, above your 2,400 ceiling." |
| Active phase with no active target | "Phase set but no nutrition target active." |
| Weigh-in older than 14 days | "Last weigh-in was 18 days ago. Coach advice depends on current weight." |
| Priority order vs 30-day volume share | "Shoulders ranked #1 received 18% of volume, behind back at 31%." |

That macro-vs-calorie check is a real catch: the spreadsheet's own carb and protein targets summed above its stated calorie ceiling, and nothing noticed.

---

## 4. Views

```
PROFILE                                          [ SAVE ]
─────────────────────────────────────────────────────────
STATS
Height          179 cm
Age              27          from 1999-03-14
Timezone        Asia/Tokyo
─────────────────────────────────────────────────────────
CURRENT                              from latest weigh-in
Weight         70.0 kg      2026-08-04
Waist          80.0 cm      2026-08-04      ← primary recomp signal
Body fat       20.0 %       ⚠ ceiling 15%   ← optional; last known if omitted today
BMR est.      1,689 kcal    Mifflin-St Jeor · scale says 1,605
                                            [ ＋ LOG WEIGH-IN ]

MONITOR  30 D ▾
Weight  ··············  68.9 → 70.0 kg     ▲ +0.15 /wk
Waist   ··············  81   → 80.0 cm     ▼ −0.3 /wk
Body fat ·············  19.5 → 20.0 %
─────────────────────────────────────────────────────────
ACTIVE PHASE                                    [ CHANGE ]
4-week weight-maintenance recomp    from 2026-08-04
Target 70.0 kg  ·  rate 0.00 kg/wk  ·  BF ceiling 15%
─────────────────────────────────────────────────────────
ACTIVE TARGETS                                  [ CHANGE ]
Calories    2,300–2,400   gym and rest
Protein           160 g
Carbs       290–315 g gym  ·  230–250 g rest
Fat            65–75 g            floor 1,800 kcal
─────────────────────────────────────────────────────────
PRIORITY ORDER                                  [ EDIT ]
1 Shoulders (side/rear)      2 Back / lats
3 Upper chest                4 Arms
5 Legs
─────────────────────────────────────────────────────────
COACH RULES                        34 active · 12 retired
SAFETY                                          CRITICAL
  No heavy oblique work — planks only
  ⚠ conflicts with 3 sets logged 2026-08-05
EXERCISE ORDER                                  CRITICAL
  OHP / shoulder press before chest machines
  ▸ 1 superseded rule
                              [ ＋ RULE ] [ PREVIEW PROMPT ]
─────────────────────────────────────────────────────────
```

Design notes per PRD-002: hairline sections, mono numerals right-aligned, `⚠` warnings inline at the offending value rather than collected in a banner, one primary action.

---

### 4.1 Build status — P2 complete

`/profile`, reachable from **More**. Built: the screen, weigh-ins, MONITOR charts, derived BMR, the targets and phase editors, the priority-order editor, the rules registry, the prompt preview, and all eight consistency checks.

**Every edit control is a 44×44 target.** The first pass put `text-2xs` links in the section-header corners — about 14×30px, below the minimum PRD-002 mandates, and on a phone the controls could neither be found nor hit. Now: the section header itself is the button where there is one thing to edit (title, meta, and a chevron, the same idiom as More and the food library), `+` is an `IconButton`, and the prompt preview is a full-width button — it is the one thing on this screen you read rather than edit.

**Priority order** is edited with up/down buttons rather than drag-and-drop: five items changed maybe twice a year, and buttons work with one thumb, with a keyboard and with a screen reader without reinventing any drag affordance. Saving replaces the whole list in one RPC — `rank` is the primary key and `muscle_group` is unique, so no sequence of single statements can swap two rows without colliding with itself. Ranks stay 1..n with no gaps, which is what keeps `priority_volume_share()` answerable.

| AC | Where it is proven | State |
|---|---|---|
| AC-4.1 / AC-4.2 | `one_active_target` / `one_active_phase` partial unique indexes | ✅ schema-enforced |
| AC-4.4 | `e2e/profile.spec.ts` — a new reading appends and leaves the older one untouched | ✅ |
| AC-4.4a | `e2e/profile.spec.ts` — saves with body fat blank; weight alone is enough | ✅ |
| AC-4.4b | `body.test.ts` + `e2e/profile.spec.ts` — weight dated 2026-08-04, waist 2026-07-28, from the same log | ✅ |
| AC-4.4c | `body.test.ts` — nulls dropped, not zeroed; `TrendChart` places points by date | ✅ |
| AC-4.5 | `energy.test.ts` proves BMR moves with weight; the E2E **skips with an annotation** because `birth_date` is NULL | ⚠️ blocked on data, not code |
| AC-4.6 | `energy.test.ts` — `ageOn` incl. the not-yet-had-birthday case. No age column exists | ✅ |
| AC-4.7 | `e2e/profile.spec.ts` — the screen renders the same stored phase, targets and priorities Today reads | ✅ |
| AC-4.3 | `e2e/goals.spec.ts` — the old row closes the day before, keeps its range, and stays queryable | ✅ |
| AC-4.8 | `prompt.test.ts` — criticals lead their category and are marked `[CRITICAL]`; `e2e/goals.spec.ts` asserts it in the rendered prompt | ✅ |
| AC-4.9 | `e2e/goals.spec.ts` — the original is retired, points at its replacement, stays in the table and leaves the prompt | ✅ |
| AC-4.10 | `consistency.test.ts` + `e2e/goals.spec.ts` — greyed live **and** refused with 422 when posted directly | ✅ |
| AC-4.11 | `consistency.test.ts` + `e2e/goals.spec.ts` — names both figures, warns without blocking | ✅ |
| AC-4.12 | `buildCoachPrompt` is the only assembler; the preview renders its output verbatim | ⚠️ structurally guaranteed — provable once `/api/ai/chat` exists in P4 |
| AC-4.13 | — | ❌ no migration report |
| AC-4.14 | `priorities.test.ts` (19 tests) + `e2e/goals.spec.ts` — reorder rewrites ranks 1..n, notes travel with their row, SAVE inert until something moves, and the order reaches the prompt | ✅ |
| AC-4.15 | `consistency.test.ts` — 23 tests, all eight checks with their passing case | ✅ |

**Design decisions worth keeping**

- **A new row starts tomorrow, never today.** Superseding closes the old row the day before the new one opens, so a same-day change would leave today with no target at all. The RPC refuses any date at or before the current row's start, with a message naming that date.
- **The calorie floor is enforced in the API as well as the form.** A safety rule that only lives in a client is not a rule — the E2E posts a sub-floor target directly and asserts a 422 plus zero rows written.
- **Only the floor blocks.** All seven other checks warn. A test asserts that a target simultaneously tripping four warnings still saves.
- **Check 8 stays silent before any training exists.** With no sets logged every share is 0%, and *"shoulders received 0% of volume"* would read as neglect when the truth is "you have not trained yet".
- **Supabase's `pg_safeupdate` rejects an unqualified DELETE through PostgREST.** `reorder_physique_priorities` deletes the list before rebuilding it, and a bare `delete from physique_priorities` worked from a direct psql session while failing with *"DELETE requires a WHERE clause"* through the API — the probe passed and the feature did not. `where rank >= 1` selects every row and satisfies the guard.
- **Findings shown inline by `CurrentStrip` are filtered out of the panel.** §4 wants warnings at the offending value, not collected in a banner; rendering both said the same sentence twice on one screen.

**Two findings worth keeping**

- **Latest-wins is per FIELD, not per row.** The real log's newest reading has a weight but no waist (*"partial reading; blanks are honest"*), while an 80.0 cm waist exists a week earlier. Taking the newest row wholesale would blank a measurement that exists — which is why AC-4.4b asks for each value "with the date of the reading that produced it". `latestOf` scans per field.
- **`body_measurements.id` has no `default gen_random_uuid()`.** Like `food_log_entries`, it follows the client-generated-uuid pattern (PRD-001 §4.2). So `saveWeighIn` is update-or-insert, not an upsert on `measured_on`: an upsert carrying a fresh uuid would rewrite an existing row's primary key when correcting the same day.

**A weekly rate is withheld under seven days of spread.** `trendOf` returns `perWeek: null` rather than extrapolating — the phase's own note says *"judge by average weight, waist and strength, not day-to-day scale noise"*, and the two waist readings are one day apart.

---

## 5. Acceptance criteria

| ID | Criterion |
|---|---|
| AC-4.1 | Attempting to insert a second `nutrition_targets` row with `effective_to IS NULL` fails at the database. |
| AC-4.2 | Same for `training_phases`. |
| AC-4.3 | Editing targets supersedes the old row; the old row retains its date range and remains queryable. |
| AC-4.4 | Current weight is derived from the newest `body_measurements` row. No stored duplicate exists anywhere. |
| AC-4.4a | The quick weigh-in form requires `weight_kg` and `waist_cm`; `body_fat_pct` may be left blank and the row still saves. |
| AC-4.4b | Profile CURRENT shows latest weight, waist, and (when ever logged) body fat, each with the date of the reading that produced it. |
| AC-4.4c | Profile MONITOR plots weight (kg), waist (cm), and body fat (%) over the selected range; null BF% points are skipped, not zeroed. |
| AC-4.5 | Logging a new weigh-in changes displayed BMR and TDEE with no other action. |
| AC-4.6 | Age is computed from `birth_date`; no integer age column exists. |
| AC-4.7 | Today (PRD-003) and the coach (PRD-005) both read the same active target row. Verified by test. |
| AC-4.8 | A rule marked `is_critical` appears in the assembled prompt and is enforced by the plan builder. |
| AC-4.9 | Superseding a rule sets `superseded_by`; the old rule stays visible in history and is excluded from the prompt. |
| AC-4.10 | Setting a calorie target below `kcal_floor` is blocked with an explanation. |
| AC-4.11 | Macro grams exceeding the calorie ceiling raises a warning naming both figures. |
| AC-4.12 | Prompt preview output is byte-identical to what `/api/ai/chat` sends. |
| AC-4.13 | Migration report lists every discarded spreadsheet rule and why. |
| AC-4.14 | Priority order drives PRD-004's adherence chart with no duplicated config. |
| AC-4.15 | All 8 self-consistency checks have tests, including the passing case. |

---

## 6. Edge cases

| Case | Handling |
|---|---|
| Two weigh-ins same day | Unique on `measured_on`; second is an update. Manual scales vary hour to hour; one per day is the honest granularity. |
| Weigh-in with weight + waist, no BF% | Allowed. CURRENT keeps showing the previous BF% with its older date until a new BF% is logged. |
| Weigh-in missing waist | Blocked on the quick form with "Waist is required — it's how you track the recomp." Extended/import paths may still store null waist for legacy rows. |
| Backdating a target start | Allowed; adjusts the previous row's `effective_to`. Overlap rejected. |
| Deleting the only active target | Blocked. There must always be one. |
| Phase ends with no successor | Warn; targets stay active until replaced |
| Retiring a critical rule | Confirm prompt naming what stops being enforced |
| Two rules contradicting each other | Detected on save; requires supersede or explicit `priority` difference |
| Unit switch kg ↔ lb | Display only; storage stays canonical kg |
| Height change (unlikely, but) | Historical BMR figures keep the height in force at the time |
| Weigh-in imported from scale with partial fields | Blanks allowed; charts skip nulls rather than treating them as zero |
| Prompt exceeds the token budget | Warn in preview, naming which rules to shorten (PRD-005 §3.4) |

---

## 7. Explain Like in High School

**The rule this whole feature is built on: one number, one home.**

Your spreadsheet said you weighed 64 kg in one tab, 67 kg in another, 69 kg in a third, and 70 kg in a fourth. All four were "true" when someone typed them. None of them knew about the others. The AI coach read the 64 kg one — the oldest — and calculated all your calorie targets from it.

The fix isn't discipline or reminders. It's making the duplicate impossible. There's exactly one place weight is recorded: your log of weigh-ins. "Current weight" isn't stored anywhere at all — it's a question: *"what's the most recent weigh-in?"* You can't have a stale copy of something that was never copied.

**The single most valuable line of code in this project.** It's one line of database configuration:

```sql
create unique index one_active_target
  on nutrition_targets ((1)) where effective_to is null;
```

In English: *at most one calorie target row may have an empty end-date.*

That's it. That one line makes your six-conflicting-targets problem physically impossible. Not discouraged — rejected. Try to add a second active target and the database refuses the write.

This is the difference between a rule you have to remember and a rule the system enforces. Your spreadsheet had a *written instruction* saying "recalculate BMR when your weight changes" — a perfectly sensible rule, in writing, that never once got followed. Written rules decay. Structural rules can't.

**Why editing your targets creates a new row instead of changing the old one.** Say in September you switch from maintenance to a bulk. The obvious move is to edit the numbers. We don't — we end-date the old row and add a new one.

Two reasons, and the second is the good one:

1. You get a history of what you were aiming for, whenever you look back.
2. **Your adherence charts stay honest.** If you edited in place, then a chart of August would judge August against September's targets, and you'd look like you missed goals you actually hit. By keeping both rows with date ranges, each day is scored against the target that was really active that day.

Same pattern for phases. Instead of four "Active" phases fighting each other, you get one active phase and a clean timeline of the previous ones.

**Why age is calculated, not stored.** Your sheet stored `27` in three places. On your next birthday, all three would be wrong — and since age feeds the BMR formula, every calorie target would quietly drift.

So we store your birth date and work out your age when needed. It's the same idea again: store the fact that doesn't change, compute the thing that does.

**Turning most of the coach's "rules" into data.** Your Coach Agent tab had 119 rules. But a lot of them weren't rules at all — they were *facts* dressed as instructions:

- `Current Weight | 64kg` — that's a fact. It belongs in the weigh-in log.
- `Calories (Gym) | 2,300–2,500 kcal` — that's a fact. It belongs in the targets table.
- `Skill: showfoodlogs` — that's a *feature*. It's now an actual button in the app.

Once you pull the facts out, you're left with about 35 genuine behavioural instructions: *be direct and cite numbers*, *put shoulder press before chest work*, *no heavy obliques*, *respect the jaw-surgery limits*. Those are real rules. They tell the coach how to behave, not what's true.

This split matters because facts written into a prompt go stale silently and there's no mechanism to catch it. Facts in a database are queried fresh every time. Getting them out of the prompt is what permanently fixes the 64 kg bug.

**The `superseded_by` field, and the 43 invisible rows.** Your 119 rules were one flat list with no way to say "this one replaced that one". 113 were dated 15 June, 6 were dated 1 July — and the newest six were the most important, including the one that defined what the coach should treat as truth.

Worse: rows 118 to 160 were completely blank — formatted, but empty. So the rules were split into two blocks with a 43-row gap. Anyone reading top-down stops at row 117 and never sees the newest six. That's not a hypothetical; that's how the sheet was actually laid out.

Now each rule can point at the rule that replaced it. Old ones stay visible in a collapsed history so you can see how your thinking changed, but they're excluded from what the coach receives. Precedence is explicit instead of implied by a date column nobody sorts by.

**The "preview prompt" button.** You can see the exact text the coach receives, assembled live from your current data. If it looks wrong, you fix the data, not a prompt.

This sounds minor. It's the difference between an AI that feels like a black box and one you can debug. Your spreadsheet's coach was giving advice from a 64 kg bodyweight for months and there was no way to see why.

**The consistency checks, and the one that surprised me.** The app checks your settings against each other and warns you. Most are obvious — your body fat is 20% against a 15% ceiling, your weight's trending up against a maintenance target, you haven't weighed in for 18 days.

But here's a nice one: it multiplies out your macro targets and compares them to your calorie target. Protein is 4 calories per gram, carbs 4, fat 9. So 160 g protein + 290 g carbs + 75 g fat = 640 + 1,160 + 675 = **2,475 calories**.

Your calorie ceiling is 2,400. So your own macro targets are *arithmetically impossible* to hit without exceeding your calorie target. Not a big error — 75 calories — but it was sitting there in the spreadsheet, unnoticed, and it means "hit all your macros" and "stay under your calories" were quietly in conflict.

That's the kind of thing a database can check in a millisecond and a spreadsheet will never mention.

**The 15% body fat ceiling.** Your coach rules say "stay at or below 15% body fat while bulking". Your last two readings were 18.6% and 20%. So a stop condition you wrote for yourself has already fired — and it was invisible, because the tab claiming 10–13% body fat and the tab measuring 20% never spoke to each other.

Now there's one place body fat lives, one place the ceiling lives, and the app puts a `⚠` right next to the number. Not a report you have to run. Just there, every time you open the screen.

**Why the priority order is a table and not a note.** You wrote down: shoulders first, then back and lats, then upper chest, then arms, then legs. As prose in a spreadsheet, that's a nice intention nobody can check.

As five rows in a table, it becomes something the app can *measure against*. It can tell you shoulders got 18% of your volume while back got 31% — and that your #1 priority is actually your #2 investment. That comparison is probably the most useful sentence this app will ever show you, and it only exists because a stated goal became structured data.
