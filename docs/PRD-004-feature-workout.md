# PRD-004 · Feature 2 — Workout Logging & Progression

| | |
|---|---|
| **Status** | Draft v1 · 2026-08-06 · Phase P3 |
| **Depends on** | PRD-000, PRD-001 (§3.3 schema, §4 offline), PRD-002 (§8 set-logging flow), **PRD-006** (coach rules, physique priorities, active phase — required for AI plan) |
| **Core thesis** | Show last performance on the input row. Everything else is secondary. |
| **Also** | Prompt → AI draft plan on `/train/plan` (§4.2a), editable, with LAST + BEST per known exercise |

---

## 1. Problem

Set logging happens **mid-workout**: phone in one hand, 30–90 seconds of rest, possibly sweaty hands, frequently no signal in a basement gym. It is the most hostile input environment in the product.

It also has the highest information value, because progressive overload is only decidable if you know what you did last time. The spreadsheet's own coach rules said this outright — *"Do not omit last sets"* — and the spreadsheet couldn't deliver it, which is why progression suggestions went 57 days stale.

Three spreadsheet defect classes must be structurally prevented here:

1. **Volume distortion** — Abs/Core showed 43,368 kg over 72 sets (602 kg/set), out-ranking Chest (27,298 kg) and Legs (23,548 kg), because a 45 kg × 30-rep machine ab set multiplies identically to a heavy compound. Fixed by `load_type`.
2. **Cross-gym PR corruption** — `PR Flag` held `New Gym Baseline`, `Current Gym Baseline`, `New Baseline`, `Baseline` as free text because machine stacks aren't comparable across gyms. Fixed by a first-class `gyms` table.
3. **Vocabulary drift** — 29 sets used muscle-group values outside the lookup list and silently vanished from every rollup, leaking 9,352 kg (4.2%) while the "Other" bucket read 0. Fixed by enums.

---

## 2. User stories

| ID | Story | Priority |
|---|---|---|
| US-2.1 | As Froye, I maintain a library of exercises with muscle group and load type. | P0 |
| US-2.2 | As Froye, I build today's session by picking exercises, with free choice of set count per exercise. | P0 |
| US-2.3 | As Froye, I log reps and weight per set and it saves instantly with no signal. | P0 |
| US-2.4 | As Froye, **every set input row shows what I did last time for that exercise.** | P0 |
| US-2.5 | As Froye, PRs are detected automatically and only compared within the same gym. | P0 |
| US-2.6 | As Froye, I get a concrete progression target for next session, computed from actual recent data. | P1 |
| US-2.7 | As Froye, I see volume and strength trends per muscle group, without ab machines distorting them. | P1 |
| US-2.8 | As Froye, I save a session as a reusable template. | P1 |
| US-2.9 | As Froye, planks and timed work are logged in seconds and never converted into fake volume. | P0 |
| US-2.10 | As Froye, a rest timer starts automatically when I save a set. | P2 |
| US-2.11 | As Froye, I'm warned when a planned exercise conflicts with a critical coach rule. | P2 |
| US-2.12 | As Froye, I type a short prompt on Train (`PULL LEGS!`, `Upper Body`) and get a populated day plan — not only manual pick or a fixed template. | P0 |
| US-2.13 | As Froye, the AI plan uses my **coach rules**, **physique priorities**, **active phase**, and **recent logs** (progressive overload, mechanical tension, V-taper, exercise order, safety). | P0 |
| US-2.14 | As Froye, every AI-suggested plan is fully editable before I start — add, remove, reorder, change set counts. | P0 |
| US-2.15 | As Froye, for every planned exercise that already exists in my history at this gym, I see **LAST** and **BEST** so I know what to beat. | P0 |
| US-2.16 | As Froye, I can see my workout **sessions grouped by date** (and open any past or in-progress session). | P0 |
| US-2.17 | As Froye, I can **delete a whole session** (wrong log, duplicate, abandoned) after confirm — sets go with it. | P0 |
| US-2.18 | As Froye, **even mid live session** I can still **add and remove exercises** — the plan is not locked when I start. | P0 |

---

## 3. Domain model decisions

### 3.1 `load_type` — the volume fix

Every exercise declares how it is loaded. This single enum determines what metrics are even meaningful.

| `load_type` | Inputs | `volume_kg` | Progression axis |
|---|---|---|---|
| `external_weight` | weight + reps | ✅ weight × reps | Load, then reps |
| `bodyweight` | reps (+ optional added weight) | ⚠️ only if added weight, else `null` | Reps |
| `assisted` | assist weight + reps | ❌ `null` — *lower assist is better*, so multiplying inverts the meaning | Reduce assist, then reps |
| `duration` | seconds | ❌ `null` | Seconds |
| `distance` | metres (+ time) | ❌ `null` | Distance or pace |

`volume_kg` is a **generated column** (PRD-001 §3.3) — computed by Postgres, never hand-entered. It cannot hold text, which is exactly what happened in 4 spreadsheet rows where Notes spilled into the volume column and silently removed 1,802 kg from the total.

**Consequence:** "Total Training Volume" is only ever summed over `external_weight` and weighted-`bodyweight` sets. Abs machine work is real training and is tracked — as sets and load progression — but it never enters a volume total where it would out-rank the chest.

### 3.2 Gyms — the PR comparability fix

```
gyms: (id, name, is_current)
workout_sessions.gym_id → gyms.id
```

A PR is `MAX` over sets **for the same exercise at the same gym**. Cross-gym comparisons aren't hidden — they're shown, explicitly labelled `NEW GYM BASELINE`, because a 45 kg cable stack at one gym is not 45 kg at another (pulley ratios, friction, plate calibration all differ).

When `is_current` changes, the first session at the new gym marks its sets as baselines automatically. No free-text flags, no manual bookkeeping.

### 3.3 PR detection

```ts
// lib/domain/train/detectPr.ts
export type PrKind = 'weight' | 'reps_at_weight' | 'volume_set' | 'duration' | 'first_time'

export function detectPr(
  candidate: WorkoutSet,
  history: WorkoutSet[],       // same exercise, same gym, before this session
  loadType: LoadType,
): { isPr: boolean; kinds: PrKind[]; previousBest: WorkoutSet | null }
```

Rules by load type:
- `external_weight`: new max weight at ≥1 rep · OR more reps at an equal-or-higher weight than the previous best at that weight
- `bodyweight`: more reps than previous max
- `assisted`: same reps at *lower* assist, or more reps at equal assist
- `duration`: longer hold
- `first_time`: no history at this gym → `first_time`, **not** a PR (prevents the spreadsheet's 335 PR flags on ~41 sessions, which made PRs meaningless)

`is_pr` is stored as a real `boolean`. `pr_kinds` as `text[]`. Never free text.

### 3.4 Progression suggestions — computed, never stored stale

The spreadsheet's Next Session Targets tab was a hand-written snapshot, 57 days stale, while the coach was instructed to read it. Here it is a **view / function**, computed at read time. It cannot go stale.

```sql
create or replace function next_session_targets(p_gym uuid)
returns table (
  exercise_id uuid, exercise_name text, muscle_group muscle_group,
  load_type load_type, last_performed_on date, sessions_since_pr int,
  best_weight_kg numeric, best_reps int, suggestion text, basis text
) language sql stable as $$ ... $$;
```

Suggestion logic — double progression, driven by the plan's own rep range:

| Situation | Suggestion |
|---|---|
| Top set hit the top of the rep range | Increase load one increment, drop to the bottom of the range |
| Top set inside the range | Add 1 rep at the same load |
| Below the bottom of the range | Hold load, target the bottom of the range |
| 3+ sessions with no progress | Flag plateau; suggest a back-off week or variation |
| No history at this gym | `Establish baseline — find a working weight` |

`basis` always states the evidence (`"from 2026-08-04: 10 kg × 13, top of 10–15 range"`). A suggestion without its basis is unauditable.

---

## 4. Views

### 4.1 Exercise library (`/train/exercises`)

Seeded from the 78 spreadsheet exercises, **normalised on import**:

| Import problem found | Resolution |
|---|---|
| 5 exercises with conflicting muscle groups (`Leg Press` tagged both `Legs` and `Quads/Glutes`) | Collapse to the enum; one canonical value each |
| Superset rows encoded as one name with a `" - "` suffix | Split into two exercises; supersets become a session-level grouping, not a name |
| `Chest Press Machine` tagged `Back/Lats` / `Pull` (spreadsheet rows 2–7) | Corrected on import; flagged in the migration report |
| `Progression Notes` column 100% empty | Dropped — a field never populated is not a field |

Fields: name, aliases, `muscle_group`, `movement_pattern`, `load_type`, `is_unilateral`, equipment, active. Editing `load_type` warns if historical sets would change metric meaning.

#### 4.1a Build status — P3-1 shipped

`/train/exercises`, reachable from **Train**. Search (name, alias, muscle label, equipment), `ALL / NEEDS CHECK / RETIRED` filters with live counts, muscle-group chips, `BY MUSCLE / A–Z` grouping, plus add, correct and retire.

> **The import corrections in the table above were never applied.** This section claims the mis-tagged chest presses were *"corrected on import; flagged in the migration report"* and that superset rows were *"split into two exercises"*. Against the live data: all three `Chest Press Machine` variants are stored `vertical_pull` (a chest press is a horizontal push), `Chest Press Machine (Narrow Grip)` is still `back_mid`, and `Arms Superset — DB Bicep Curl` is still named that **and** tagged `triceps`. The split happened; the attribution and the renaming did not.
>
> That is why the screen has a `NEEDS CHECK` filter rather than trusting the PRD. `auditExercise` flags a `movement_pattern` implausible for its `muscle_group`, and any name still carrying a superset prefix. `muscle_group` is what per-muscle volume and `priority_volume_share()` group by, so a wrong one silently distorts the V-taper adherence measurement the priority order exists to enable (AC-2.14, AC-4.14) — this is a data-integrity screen, not a browser.

**Design decisions, and two departures from PRD-002 §0**

- **No A–Z scrubber**, despite §0 adopting one from Gymshark. Gymshark indexes thousands of movements; this library has **57**, and the largest muscle group holds 10. A scrubber for a list you can see the end of costs a permanent gutter on a 390px screen for nothing. Sticky section headers give the orientation it would have.
- **Chips, not Alphabetical / Body Part / Recent tabs.** `Recent` needs session history and there are zero sessions — an empty tab is a dead control. Chips also combine: "chest" plus "needs check" is one tap each, which tabs cannot express.
- **Load type is on the row**, as a chip. It is the field that decides whether volume exists at all for that exercise's sets, so it belongs where you scan rather than behind a tap.
- **`set_count` is on the row too**, from `exercise_library()`. Same reason `entry_count` gates a food delete: the editor cannot honestly warn "this would reinterpret 42 logged sets" without the count.
- **Retire, never delete.** An exercise with logged sets must keep existing or the history it explains becomes unreadable.
- **No thumbnails**, per §0 — the user knows these movements, and images cost the vertical space the meta line needs.
- **`ExerciseList` is selection-agnostic.** One component, two modes: `onOpen` for the library, `selected` + `onToggle` for the day plan's picker (§4.2). The alternative to one agnostic list is three that drift.

**Correcting an exercise is a plain update, not a supersede** — deliberately the opposite of a food macro correction (PRD-003 §4.3). A food log entry froze a measurement, so rewriting it would falsify history; an exercise row records a fact about the movement, so a chest press mis-tagged `back_mid` *should* retroactively count toward chest, because it always was a chest press.

| AC | Where it is proven | State |
|---|---|---|
| AC-2.3 | `exercise.test.ts` — volume only for `external_weight` / `bodyweight` | ✅ |
| AC-2.6 | `e2e/exercises.spec.ts` — a muscle group outside the enum is rejected at the API and never stored | ✅ |
| Load-type warning (§4.1) | `exercise.test.ts` + `e2e/exercises.spec.ts` — names the count and the direction, warns without blocking | ✅ |
| AC-2.13 | `NEEDS CHECK` surfaces every mis-imported row on screen | ⚠️ a live filter rather than a one-off report |

### 4.2 Day plan (`/train/plan`)

Three ways in — all land on the **same editable plan list**:

1. **Prompt** (§4.2a) — type `PULL LEGS!` / `Upper Body` → AI draft  
2. **Template** — seeded 4-day plan (`Day 1 Push`, …)  
3. **Manual** — `START EMPTY` + exercise picker  

```
NEW SESSION                              06 AUG · THU
─────────────────────────────────────────────────────
PROMPT       [ Pull legs!                    ] [ BUILD ]
TEMPLATE     [ Day 1 Push ▾ ]   or  [ START EMPTY ]
GYM          [ Anytime Shinjuku ▾ ]
─────────────────────────────────────────────────────
1  Shoulder Press Machine        3 sets   6–10
   LAST  57.5kg × 15  ·  2026-06-10
   BEST  60kg × 12    ·  2026-05-28
2  Incline DB Press              3 sets   6–12
   LAST  20kg × 15   ·  2026-06-09
   BEST  22.5kg × 10 ·  2026-05-14
3  Lateral Raises                4 sets   10–15     ← set count freely editable
   LAST  10kg × 13   ·  2026-06-09
   BEST  12.5kg × 10 ·  2026-04-30
─────────────────────────────────────────────────────
              [ ＋ ADD EXERCISE ]
              [ START SESSION ]
```

- Templates seeded from the 4-Day Workout Plan tab (21 exercises with real rep ranges and progression rules — the most usable artefact in the spreadsheet).
- **Set count is free** per US-2.2 — template / AI value is a default, not a constraint.
- Reorder by drag. Order is stored (`plan_exercises.position`), so the OHP-before-chest rule is actually enforceable.
- **LAST** and **BEST** are always shown when history exists at the selected gym (US-2.15). `—` when none. Same gym-scoping as PRs (§3.2). BEST = prior max for that exercise+gym per §3.3 rules (not “first time”).

#### 4.2b Build status — P3-2 shipped

`/train/plan`, reachable from **Train**. Template or empty, gym selector, free set counts and rep ranges, reorder, remove, `＋ ADD EXERCISE` (the library's own `ExerciseList` in selection mode), critical-rule warnings, and `START SESSION` → `/train/session/[id]`. Prompt/AI is P3-5.

**The 4-day template is seeded** — 4 plans, 21 rows. 13 of 18 spreadsheet names resolved exactly; the migration report for the rest lives in `0017_plan_and_history.sql`. Two exercises had to be **added** because the plan names movements the imported library never contained: `Calf Raise` (there were zero `calves` exercises) and `Plank`. `Plank` is `duration` load type — declaring it `external_weight` would have invented fake volume out of a bodyweight hold (US-2.9, AC-2.3).

**Departure from §3.4.** That section specifies `next_session_targets(p_gym)` as a SQL function. It is split: `exercise_history(p_gym)` supplies the evidence, and `suggestTarget()` in `lib/domain/train/progression.ts` turns it into a suggestion. Two reasons — §3.4 says the suggestion is "driven by the plan's own rep range" and that signature cannot see the plan; and double progression has enough edge cases that being able to test all of them without a database is worth more than the single round trip. The stale-snapshot problem §3.4 was solving is untouched: **nothing is stored**, both halves compute on read.

> **A mis-imported `movement_pattern` silently disabled a CRITICAL rule.** `Shoulder Press Machine` is seeded `vertical_pull` — the same fault as the chest presses. The first order-check required `movement_pattern = 'vertical_push'`, so it found no shoulder press, reported no violation, and a rule the user had marked critical was quietly unenforced. `checkRules` now identifies a press by `muscle_group` plus its name, and there is a regression test for exactly that shape. This is the concrete cost of the §4.1 corrections never being applied.

**Design decisions**

- **The plan is a client-side draft.** Nothing is written while you shuffle exercises — same rule as a photo yielding candidates (AC-1.9) and an AI draft never auto-starting (AC-2.17). Proven by asserting the session count is unchanged mid-edit.
- **`START SESSION` copies the plan, never references the template.** Editing today must not rewrite `Day 1 Push`, and a template edit next month must not retcon this session — the same reasoning as a frozen food log entry (PRD-003 §4.3).
- **`LAST` and `BEST` are always rendered**, `—` when there is no history at this gym (AC-2.19). Hevy keeps `PREVIOUS` populated for the same reason: a column that vanishes is a column you stop trusting.
- **Every target carries its basis** — `from 2026-08-04: 10 kg × 13, top of 10–15 range` (AC-2.8). The spreadsheet's targets had none, which is how they went 57 days stale unnoticed.
- **Reorder is buttons, not drag.** Position is what makes the shoulder-press rule enforceable, so it has to be reliable with one thumb — and it reuses the priority list's idiom.
- **Unparseable critical rules are named, not assumed satisfied.** A rule silently treated as met is worse than no check, because the user would believe the plan had been vetted.
- **Footer is Gymshark's two buttons** — add more, then commit ([Gymshark NEW WORKOUT](https://mobbin.com/screens/8cb918c9-2c92-4712-879b-61f2353b5a5c)).

| AC | Where it is proven | State |
|---|---|---|
| AC-2.8 | `progression.test.ts` — every branch asserts its basis string | ✅ |
| AC-2.10 | `e2e/plan.spec.ts` — set count and range edited, summary follows | ✅ |
| AC-2.11 | `plan.test.ts` + `e2e/plan.spec.ts` — violation names the rule and the positions | ✅ |
| AC-2.17 | `e2e/plan.spec.ts` — session count unchanged until START SESSION | ✅ |
| AC-2.18 | `e2e/plan.spec.ts` — a reorder persists into the started session | ✅ |
| AC-2.19 | `progression.test.ts` + `e2e/plan.spec.ts` — `—` with no gym history | ✅ |
| AC-2.13 | Migration report in `0017_plan_and_history.sql` | ✅ |
| AC-2.7 | Nothing is stored; both halves compute on read | ⚠️ structural — needs session data to demonstrate |
| AC-2.5, AC-2.9, AC-2.12–2.16, AC-2.20 | See §4.3b and §4.2b-ai | ✅ shipped in P3-3 / P3-4 / P3-5 |

---

### 4.2a AI plan from prompt (US-2.12–2.14)

**Job:** turn a short natural-language session intent into a draft day plan the user can edit, then start. This is a **Train** feature, not a chat transcript — chat (PRD-005) may offer the same capability later via a tool that writes into this same draft shape.

**Route:** `POST /api/ai/plan-workout`  
**Model:** same as coach chat — Groq `llama-3.3-70b-versatile` primary, Gemini `gemini-3.6-flash` fallback (PRD-001 §2.3). Structured output via Zod schema. Job name in the router: `plan` (counts against chat quota; never blocks offline logging — if AI is down, Prompt BUILD fails visibly and Template / Empty still work).

**Inputs assembled server-side every call** (never trust the client for facts):

| Source | What |
|---|---|
| User prompt | Raw string, e.g. `PULL LEGS!`, `Upper Body`, `short push, delts first` |
| `exercises` | Active library: id, name, muscle_group, movement_pattern, load_type |
| Recent history | Per exercise at current gym: last top set, best set, last performed date, sessions_since |
| `next_session_targets()` | Computed progression suggestions + `basis` |
| Active `coach_rules` | Critical + training / exercise_order / progression / safety / phase |
| `physique_priorities` | Ranked muscle groups (V-taper order) |
| Active `training_phases` | Goal kind, rate, BF ceiling |
| Current gym | `gyms` where `is_current` |

**Hard rules for the model:**

1. **Only propose exercises that exist in the library** (by `exercise_id`). Never invent movements. If the library cannot cover the prompt, return fewer items + a `notice`, not hallucinated names.
2. **Respect critical coach rules** — e.g. OHP / shoulder press before chest; no heavy oblique work (planks only). Violations must not appear in the draft; soft preferences go into `rationale`.
3. **Bias toward mechanical tension + progressive overload** when those rules are active: compound / high-tension choices first, set/rep ranges that leave a clear “beat LAST” target.
4. **Honour physique priorities** — for an “Upper Body” prompt, side delts / lats / upper chest outrank legs volume; for `PULL LEGS!` include both pull and legs without burying the higher-ranked groups that fit the prompt.
5. **Never auto-start a session.** Output is a draft plan only. User edits, then taps `START SESSION` (same as AC photo never auto-commits).

**Output schema** (Zod — single source of truth):

```ts
// lib/ai/schemas/workoutPlan.ts
export const AiWorkoutPlanSchema = z.object({
  title: z.string(),                    // "Pull + Legs"
  rationale: z.string().max(400),       // short: which rules/priorities drove choices
  notice: z.string().nullable(),        // e.g. "No rear-delt isolation in library — used face pulls"
  items: z.array(z.object({
    exercise_id: z.string().uuid(),
    position: z.number().int().positive(),
    target_sets: z.number().int().min(1).max(10),
    target_rep_low: z.number().int().positive(),
    target_rep_high: z.number().int().positive(),
    today_target: z.string().nullable(), // e.g. "10 kg × 14" from next_session_targets
    why: z.string().max(120).nullable(), // one-line, optional
  })).min(1).max(12),
})
```

Server attaches LAST / BEST from SQL after the model returns (do **not** let the model invent history numbers — same split as label OCR vs arithmetic).


#### 4.2b-ai Build status — P3-5 shipped (prompt → AI draft)

`POST /api/ai/plan-workout`, and a `PROMPT [ ] [ BUILD ]` row above the template picker. The draft lands in the **same `items` state a template fills**, so every existing edit control works on it — which is the whole of AC-2.18, at no cost.

**The model chooses; code does everything checkable.**

| Guard | Where | Why in code and not only in the prompt |
|---|---|---|
| Only real exercises (AC-2.15) | `keepKnownExercises` | An invented id is dropped and named. A model ignoring an instruction is normal; a route shipping the result anyway is a bug. |
| Criticals enforced (AC-2.16) | `enforceCriticalOrder` | Reorders until `checkRules` — the *same* checker the screen warns with — reports nothing. Two implementations of "shoulder press before chest" would eventually disagree, and then one of them would be lying. |
| No invented numbers | schema omits `today_target` | §4.2a listed the field and its next sentence forbids it. LAST / BEST / target come from `exercise_history()` + `suggestTarget()`, exactly as for a template. |
| Nothing written (AC-2.17) | route has no write | Asserted against Postgres: session and plan counts unchanged after a real BUILD. |

> **The PRD's model choice did not survive contact with the API.** §4.2a specifies Groq `llama-3.3-70b-versatile` with structured output. Verified live: **no Groq model in the registry supports `json_schema`** — the 70B and qwen refuse a two-field flat schema as readily as this one, `mode: 'json'` does not help, and `openai/gpt-oss-120b` accepts it but nests `items` inside a second `items` object. Switching primary to Google surfaced the second problem: **`gemini-3.6-flash`'s free tier is 20 requests per DAY**, shared with photo logging. So the model choice stands and the *call* changed: `generateText` + `AiWorkoutPlanSchema.safeParse`, with the JSON shape in the prompt generated by `z.toJSONSchema()` so it cannot drift from the validator. Groq's 100k tokens/day is ~120 plans at the ~600 tokens measured, and Google stays the fallback the router can actually pre-empt onto.

**Design decisions**

- **A free-text line, not a wizard.** Bevel and Cal AI both ask equipment → intensity → duration, which is right for a new user and wrong for one who knows his splits: `PULL LEGS!` beats four taps. Genie's single field is the closer model.
- **The draft is not a special screen.** Peloton Strength+ renders a generated workout as an ordinary editable list with a sticky start button; so does this. A separate "AI result" layout would need its own edit controls, and they would drift from the manual ones.
- **Provenance, not decoration.** `AI DRAFT · EDIT FREELY`, a `FALLBACK MODEL` chip when the second model answered, and the rationale behind a **tappable disclosure** — not a tooltip, which is desktop-only by design and must never be the sole carrier of information (PRD-007 §3.17).
- **Server-side corrections are reported.** Dropped inventions, collapsed duplicates and any reorder appear in `notice`. A draft quietly edited on the way out is a draft you cannot reason about, and "the AI suggested this" has to mean it.
- **Prose is clamped, never rejected.** `z.string().max(400)` on `rationale` threw away a perfect plan for being 30 characters long — the same failure direction as the label reader refusing legally-rounded macros.
- **Re-BUILD asks first** (§6): `REPLACE` (default) or `ADD TO PLAN`, gym and date kept either way.
- **BUILD waits for the exercise library, not just for a prompt.** A draft is mapped through the library exactly once, so building before `/api/data/plan` resolved dropped every id and drew an `AI DRAFT` chip above an empty plan, with no error anywhere. Caught by the E2E suite.

| AC | Where it is proven | State |
|---|---|---|
| AC-2.15 | `e2e/ai-plan.spec.ts` — a **real** model call, every rendered name checked against `exercises`; `planPrompt.test.ts` for the drop-and-report path | ✅ |
| AC-2.16 | `planPrompt.test.ts` — a chest press above the shoulder press is moved below it, and an unsatisfiable rule is reported rather than looped on | ✅ |
| AC-2.17 | `e2e/ai-plan.spec.ts` — session and plan counts unchanged after a real BUILD | ✅ |
| AC-2.18 | `e2e/ai-plan.spec.ts` — reorder and set-count edits on a draft found in Postgres after START SESSION | ✅ |
| AC-2.20 | `e2e/ai-plan.spec.ts` — stubbed 503 shows a sentence, and Template still creates a 5-exercise plan | ✅ |
| US-2.13 | `coachContext()` is the single assembly path — the same prompt `/profile` previews | ✅ |
| Plan **quality** | `npm run probe:plan` + a human. Three prompts checked by hand: `Upper Body` put lateral raises (priority #1) first and OHP before the chest press | ⚠️ unautomatable, same as vision |
| Latency | 3–23 s measured against the real model. Named building state, no spinner over the list | ⚠️ acceptable for once a session, not fast |

**UI states:**

- Idle: prompt field + BUILD  
- Building: skeleton rows, `"Reading rules + last sessions…"`  
- Draft: populated list, editable; chip `AI DRAFT · edit freely`; rationale collapsed under ⓘ  
- Error / quota: non-blocking notice; Template and Empty remain  

**Offline:** BUILD requires network. Manual / last-used template paths still work with no signal (PRD-000 Principle 1 for logging; planning can wait).

**Exercise picker** (revised after Mobbin research — Gymshark pattern):

```
✕            ADD EXERCISES                              ＋
🔍  Search exercises
─────────────────────────────────────────────────────────────
[ A–Z ]   [ MUSCLE GROUP ]   [ RECENT ]         ← Tabs        A
─────────────────────────────────────────────────────────────  B
S                                                              C
  Seated Cable Row                    Back/mid · weight  ○     ·
  Shoulder Press Machine              Shoulders · weight ◉     S
  Side Plank                          Abs/core · duration ○    ·
─────────────────────────────────────────────────────────────  Z
     [ CREATE SUPERSET ]        [ ADD EXERCISES (3) ]
```

- **Three tabs: `A–Z` / `MUSCLE GROUP` / `RECENT`.** `RECENT` first-run defaults to most-logged, so the common case is at the top.
- **A–Z scrubber rail** on the right edge for fast travel through 78+ exercises.
- **Multi-select with a live count in the CTA** (`ADD EXERCISES (3)`) — add a whole session's worth in one pass instead of repeating the flow per exercise.
- `CREATE SUPERSET` groups the current selection (Gymshark) — the correct home for supersets, versus the spreadsheet's `" - "` name suffixes.
- Each row shows `muscle_group · load_type`, so an ab machine and a plank are visibly different kinds of thing at selection time.
- **No exercise thumbnails or demo video** — deliberately rejected (PRD-002 §0). The user knows the movements; the vertical space is better spent on metadata.
- **Coach-rule conflict check** (US-2.11): adding an exercise whose `muscle_group` is `abs_core` with `weighted_oblique` characteristics raises the active critical rule *"No heavy oblique work — planks only"*. Warns, does not block. Exactly the case the spreadsheet missed on 2026-08-05, where 3 sets of Weighted Oblique Twist were logged into an orphaned tab that no rollup or coach read.

### 4.3 Live session (`/train/session/[id]`) — the critical screen

> **Revised after Mobbin research.** Three of the original decisions were wrong; the corrected design follows Hevy and Gymshark, which independently converged on the same pattern. Evidence in PRD-002 §0.

```
⌄  LEG DAY                        [ ⏱ ]      [ FINISH ]
─────────────────────────────────────────────────────────────
DURATION 42:18     VOLUME 4,180 kg     SETS 14     ← MetricStrip
─────────────────────────────────────────────────────────────
LATERAL RAISES                                       2 of 5
Shoulders · side delts               Rest 90s ⌄
Notes…                                          ← per-exercise
─────────────────────────────────────────────────────────────
SET   PREV          KG        REPS       ✓
 W    —             [  6 ]    [ 15 ]     ☑   ← filled row
 1    10 × 13       [ 10 ]    [ 13 ]     ☑   ← filled row
 2    10 × 12       [ 10 ]    [ 12 ]     ☐
 3    10 × 10       [ 10 ]    [    ]     ☐
─────────────────────────────────────────────────────────────
TARGET   10 kg × 14   ·   top of 10–15 range, then 12.5 kg
─────────────────────────────────────────────────────────────
              [ ＋ ADD SET ]
─────────────────────────────────────────────────────────────
        02:29        [ −15 ]  [ +15 ]  [ SKIP ]    ← rest overlay
```

**Corrections from research:**

| Original | Revised | Source |
|---|---|---|
| `[SAVE]` button per set row | **Checkbox `☑` column at row end.** Smaller, fixed position, allows out-of-order commits. | Hevy, Gymshark |
| Committed row gets "1px inset shadow" | **Row fills with accent colour.** The original was far too subtle to read at a glance mid-set. | Hevy (green fill), Gymshark (accent fill) |
| No session summary | **`MetricStrip` pinned to the session:** `Duration · Volume · Sets` | Hevy |
| Global rest timer | **Per-exercise rest timer**, configured inline (`Rest 90s ⌄`) | Hevy (`Rest Timer: 2min 30s`) |
| "haptic + row pulse" on rest complete | **Bottom overlay timer with `−15 / +15 / SKIP`** | Hevy |
| `LAST` column label | **`PREV`** — Hevy names it `PREVIOUS`; shortened to fit narrow columns | Hevy |
| Per-set notes only | **Per-exercise notes inline** (`Notes…`), per-set notes retained but secondary | Hevy |

#### 4.3a Build status — P3-3 shipped

`/train/session/[id]`. Set table with a committing checkbox, `PREV`, per-exercise rest timer with the `−15 / +15 / SKIP` overlay, warmup toggle, `ADD SET`, the `Duration · Volume · Sets` strip, and `FINISH`.

**The commit path is local-only by design.** `enqueue()` writes one IndexedDB transaction and returns; the row re-renders from Dexie through `useLiveQuery`. Nothing on the path awaits the network, which is the whole of AC-2.1 — **measured at under 200 ms with the context offline**. Upload rides the same queue Feature 1 already proved, so `workout_sets` needed no new offline machinery: it was already in the sync allowlist and the Dexie mirror.

> **A derived row's React key reached the database as a primary key.** Fixing a `setState`-in-effect lint error, I made the first row of each exercise *derived* rather than seeded — which needs a stable id, so I used `draft:1`. That id then went into `enqueue` as `workout_sets.id`, and the sync route rejected it with a 400 while the UI showed a perfectly locked row. The failure was invisible on screen and only the DB assertion caught it. `SetRow.derived` now marks a UI-only id and a real uuid is minted at commit.

**Design decisions**

- **A committed cell is text, not a disabled input.** Locked should look locked, not greyed-out-editable.
- **Uncheck unlocks; re-tick saves.** The checkbox is a toggle (Hevy). Unchecking queues a delete and keeps the numbers as a draft under the same id; re-ticking upserts. Rest does not restart on a correction. A reload mid-edit keeps the unlocked draft in the Dexie mirror so a logged set cannot vanish from a refresh.
- **The next row is offered pre-filled with the same load.** The common case is the same weight again; retyping it three times per exercise is the friction that sends people back to paper. Re-saving after an uncheck does not pile on another blank row.
- **Rest is stored as a deadline, not a countdown.** A ticking `setState` in an effect is a cascading render and it drifts whenever the tab is backgrounded — which is most of a rest period on a phone. One clock, one subtraction at render.
- **Volume-less sets are counted and named.** The strip says how many carry no volume by definition, so a total of 1,000 kg over three sets is explicable rather than suspicious (AC-2.4).
- **`FINISH` only stamps the clock**, and is idempotent — tapping twice must not move the time or the duration would change per tap. The screen says so, because "finish" otherwise implies the sets were only now being saved.

**AC-2.9 is proven in halves, honestly.** Sets logged offline hold in the queue, reach Postgres on the next focus, and a replayed flush writes them exactly once — all asserted. The *"app closed, reopened while still offline"* half is `test.fixme`: there is no cached app shell (`__SW_MANIFEST` carries only `_next/static/*`, `@serwist/next` ignores `additionalPrecacheEntries`, `defaultCache` is a single NetworkOnly passthrough), so `reload()` offline fails before any of our code runs. Same pre-existing gap as `e2e/offline-sync.spec.ts`. The queued sets are unaffected — they are in IndexedDB either way.

| AC | Where it is proven | State |
|---|---|---|
| AC-2.1 | `e2e/session.spec.ts` — commit-to-locked measured under 200 ms with the context offline | ✅ |
| AC-2.2 / US-2.4 | `session.test.ts` + `e2e` — `PREV` always rendered, `—` with no gym history | ✅ |
| AC-2.3 | `session.test.ts` — `volume_kg` null for duration, assisted and unweighted bodyweight | ✅ |
| AC-2.4 | `e2e/session.spec.ts` — a plank adds a set and no kilograms | ✅ |
| AC-2.9 | `e2e/session.spec.ts` — queued offline, synced once; offline reopen is `test.fixme` | ⚠️ half, by a known SW gap |
| AC-2.10 | Sets addable mid-session | ✅ |
| US-2.10 | Rest starts automatically on commit | ✅ |
| AC-2.12 | Per-side rows exist and store `side`; `+ LEFT` / `+ RIGHT` | ⚠️ built, no unilateral exercise seeded to test against |
| AC-2.5, AC-2.7, AC-2.14 | See §4.4a | ✅ shipped in P3-4 |
| AC-2.24 | `e2e/session.spec.ts` — uncheck unlocks inputs; re-tick persists corrected weight/reps | ✅ |

---

**Design requirements:**
- **`PREV` column is always populated and never hidden** (US-2.4). Non-negotiable. Shows `—` when there is no history at this gym.
- Inputs prefill from the previous set of the same exercise; `selectOnFocus` so a tap lets you overtype immediately.
- Tapping `☑` → Dexie write < 100 ms, row fills, rest timer starts, focus advances. Zero network dependency.
- **Sets commit out of order.** The checkbox is positional, not sequential — you may do set 3 before set 2 if a machine frees up.
- Warmup sets labelled **`W`** rather than numbered (Hevy) — renders `set_kind`.
- Exercise name is a **tappable link to its history** (Hevy) — free progression context without leaving the session.
- `NumericInput` with `inputMode="decimal"`; optional `KeypadSheet` for large-key entry (PRD-007 §4.6, Bevel pattern).
- PR detection runs **locally** on commit → immediate `PR` stamp (PRD-002 §10). No round trip.
- Unilateral exercises show `L / R` columns when `is_unilateral` — fixes the spreadsheet's `"10 each arm"` free text.
- `duration` exercises swap the reps field for seconds plus a start/stop control.
- `MetricStrip` volume counts **volume-eligible sets only** (§3.1) — abs machine work never inflates it.
- Supersets render as a `SUPERSET` section header grouping two exercise blocks (Gymshark), never as a name suffix.
- `FINISH` → save screen with `MetricStrip`, session name, notes, and `Discard workout` as **red text, not a red button** (Hevy). Discard on an unfinished session = delete that `workout_sessions` row (same path as §4.3a).

**Live session stays editable (US-2.18)** — starting does **not** freeze the exercise list:

| Action | Behaviour |
|---|---|
| `＋ ADD EXERCISE` | Same picker as plan time (library multi-select). New block appears with empty sets + PREV/BEST from gym history. Critical-rule warning still applies (US-2.11). |
| Remove exercise | Confirm if any set on that exercise is already committed; then delete those `workout_sets` and drop the block. Offline via `enqueue` delete. |
| Reorder | Allowed while live — machines free up mid-session; position is not sacred. |

The plan built before `START SESSION` is a **suggestion**, not a contract. Machine occupied, energy low, or “I forgot face pulls” must not force finishing a wrong session.

### 4.3a Sessions by date — view & delete (US-2.16, US-2.17)

**Train home** (and optionally Today’s training strip) lists sessions **grouped by `performed_on`**:

```
TRAIN
─────────────────────────────────────────────────────
[ ＋ NEW SESSION ]     → /train/plan
─────────────────────────────────────────────────────
THU 6 AUG
  Leg Day · Anytime Shinjuku     42m · 4,180 kg · 14 sets
  ▸ open                              [ ⋯ ]
WED 5 AUG
  Push · Anytime Shinjuku        51m · 6,200 kg · 18 sets
─────────────────────────────────────────────────────
```

- Tap a row → `/train/session/[id]` (live if `completed_at` is null; read/edit finished sessions the same way food day history works — correct a set if needed).
- Same calendar day may have **multiple** sessions (edge case already allowed) — each is its own row.
- Empty day: no ghost rows; copy points to `＋ NEW SESSION`.
- Today screen: if that day has session(s), the training summary links into this list / the open session — one source of truth, not a second unread copy.

**Delete session:**

```
⋯  →  Delete session
Confirm: "Delete Leg Day · 6 Aug? 14 sets will be removed. This cannot be undone."
         [ Cancel ]   [ Delete ]
```

- Destructive confirm uses a **solid red** only on the confirm step (PRD-002 action hierarchy).
- Deletes the `workout_sessions` row; `workout_sets` cascade (`on delete cascade` in schema).
- Local-first: `enqueue({ table: 'workout_sessions', op: 'delete', … })` — same queue as food deletes.
- After delete: LAST/BEST/PR/progression recompute from remaining history — no stored stale snapshots (§3.4).
- Deleting is allowed for **completed and in-progress** sessions. In-progress delete = abandon; same confirm copy adjusted (“in progress · N sets logged”).


#### 4.3b Build status — P3-4 shipped (records, trends, history, mid-session editing)

**PR detection runs on the client, at commit.** `lib/domain/train/detectPr.ts` is a pure function; Postgres supplies the prior sets (`prior_sets(p_gym, p_before_session)`, gym-scoped, warmups excluded, current session excluded) and the verdict rides along in the queued payload as `is_pr` / `pr_kinds`. That placement is forced by AC-2.1 — a set has to lock in under 200 ms with no signal, so a record cannot be decided by a round trip.

The rules differ per load type because a single rule cannot be false often enough to mean anything. The spreadsheet flagged **335 PRs across ~41 sessions** on a free-text column holding 15 distinct values including the number `80`; every set was a record. Three things fix that:

- **No history at this gym is a baseline, not a record.** `first_time` is recorded and `is_pr` stays `false` (AC-2.5). A gym switch produces it by itself, with no typing — the spreadsheet needed four different hand-typed phrasings for this idea and the count formula could not see any of them.
- **A warmup is never a PR**, and beating one is not either.
- **Assisted work is inverted** — less assistance is stronger, so a naive maximum would call the heaviest assist a record.

| Screen | What shipped |
|---|---|
| `/trends` | Six charts: priority adherence, volume **or** sets by muscle group (weekly stacked), strength progression per exercise, PR timeline, session frequency. One request; both switches re-derive from the same payload. |
| `/train` | Sessions grouped by `performed_on` with `TODAY` / `YESTERDAY` labels, a `LIVE` badge on an unfinished one, and delete behind a confirm (AC-2.21, AC-2.22). |
| `/train/session/[id]` | `＋ ADD EXERCISE` mid-session and a per-exercise remove with confirm (AC-2.23, US-2.18). |

**Design decisions**

- **One accent plus an ink ramp, not eight colours.** PRD-002 §0 allows one hue, and eight muscle groups would need eight semantic colours the system does not have — they would also collide with `pos`/`warn`/`neg`. The ramp order is decided once from the range total, so a shade means the same group in every row rather than shifting week to week.
- **`unattributed` is a rendered number, in `neg`.** The spreadsheet lost 9,352 kg — 4.2% — to muscle groups outside its own list, and the dashboard's "Other" row showed **0**. Here the difference between the total and the sum of the parts is returned by SQL, summed in the hook, and printed as a sentence when non-zero (AC-2.14). A leak with a name cannot hide.
- **A zero is dropped from the legend, not listed.** `volume_by_muscle` returns abs/core with `0` because the sets exist, but "Abs / core — 0 kg" reads as a broken total rather than as a definition. Switch to SETS and it reappears with a real number — which is the whole point of separating the two measures.
- **Estimated 1RM (Epley), one line per gym, never bridged.** Plotting raw top-set weight would show dropping the reps to add load as a regression. Joining two gyms into one line would show a step change in strength that was a change of building (§3.2).
- **A calendar grid, not a weekly count.** Four sessions crammed into a weekend and four spread through the week are the same number and not the same week. Days after today are drawn as nothing rather than as misses — the current week has not failed yet.
- **Priority adherence leads the screen.** §4.4 calls it the chart most likely to change behaviour, so it is first; everything below describes what happened, this one answers a question you asked.
- **Delete is local-first; mid-session exercise editing is not.** A session delete goes on the same queue as a food delete and `workout_sets` cascade, so one mutation is the whole operation. Adding an exercise cannot: `plan_exercises` has no Dexie mirror, so an offline add would show a block whose sets survive a reload and whose heading does not. The screen asks for a connection and says so. The **sets** stay local-first, which is the part that has to work in a basement.
- **`position` is renumbered inside an RPC.** Removing an exercise deletes its sets, deletes the plan row and closes the gap in one statement block. Two round trips could be interrupted between them, and every set below the gap would render against the wrong exercise.

> **`started_at` did not exist.** §4.3a's mock shows `42m · 4,180 kg · 14 sets`, and the schema could not produce the `42m` — only `completed_at` was stored, and the live screen's elapsed clock counts from when the *screen* mounted. Migration 0022 adds the column with a `now()` default, deliberately **nullable and not backfilled**: sessions imported from the spreadsheet genuinely have no start time, and the summary omits the duration rather than inventing one.

| AC | Where it is proven | State |
|---|---|---|
| AC-2.5 | `e2e/trends.spec.ts` — first set at a gym stores `is_pr = false`, `pr_kinds = {first_time}`, and nothing is stamped | ✅ |
| AC-2.5 (positive) | `e2e/trends.spec.ts` — beating 60 kg stores `is_pr = true`, `pr_kinds ∋ weight`, stamp names its evidence | ✅ |
| AC-2.7 | `progression.ts` + `detectPr.ts` — both computed from rows on read, nothing stored | ✅ |
| AC-2.14 | `trends.test.ts` (leak surfaced as a number) + `e2e/trends.spec.ts` (every rendered bar's parts summed against its total) | ✅ |
| AC-2.21 | `e2e/session-history.spec.ts` — grouped by date, row opens the session | ✅ |
| AC-2.22 | `e2e/session-history.spec.ts` — sets cascade, row leaves the list, and BEST reverts to "establish a baseline" | ✅ |
| AC-2.23 | `e2e/session-history.spec.ts` — add lands in the session's own plan and not the template; remove deletes committed sets and renumbers `position` | ✅ |
| AC-2.3 / AC-2.4 (on trends) | `e2e/trends.spec.ts` — a plank appears under SETS and never under VOLUME | ✅ |
| §4.4 "gym switches marked" | Separate line per gym, labelled; no on-chart annotation | ⚠️ shown as separate lines, not as a marker on one axis |
| Vertical stacked bars per §4.4's wording | Horizontal bars, one row per week | ⚠️ deliberate — twelve vertical bars are 24 px wide on a phone |

### 4.4 Trends (`/trends`, training section)

| Chart | Spec |
|---|---|
| Volume by muscle group | Stacked bars, weekly. **Volume-eligible sets only.** Includes an explicit `unattributed` bucket so the 4.2% leak can never hide behind a "0". |
| Set count by muscle group | Separate from volume — the honest measure for abs and isolation work |
| Strength progression per exercise | Line of top-set `weight × reps` estimated 1RM (Epley), **one line per gym**, gym switches marked |
| PR timeline | Dot plot by date, coloured by `pr_kind` |
| Session frequency | Calendar grid vs the 4-day target |
| Priority adherence | Actual volume share vs the stated priority order (shoulders > back > upper chest > arms > legs). Directly answers "am I training what I said I'd train?" |

That last chart is the one the spreadsheet couldn't produce and the one most likely to change behaviour.

---

## 5. Acceptance criteria

| ID | Criterion |
|---|---|
| AC-2.1 | A set saves and renders as locked in < 200 ms with the device in airplane mode. |
| AC-2.2 | Every set input row displays last performance for that exercise+gym, or an explicit `—` when there is none. |
| AC-2.3 | `volume_kg` is `null` for `duration`, `distance`, `assisted`, and unweighted `bodyweight` sets. Verified by test. |
| AC-2.4 | Total volume excludes non-eligible load types. Ab machine work never appears in a volume total. |
| AC-2.5 | PRs are computed within `(exercise, gym)`. A gym change produces `first_time`/baseline, not a PR. |
| AC-2.6 | Inserting a set with a `muscle_group` outside the enum fails at the database. |
| AC-2.7 | `next_session_targets` never returns data older than the newest session — it is computed, not stored. |
| AC-2.8 | Every suggestion carries a `basis` string naming its evidence. |
| AC-2.9 | Offline session: start, 20 sets, complete, app closed, reopened → all 20 present and synced exactly once. |
| AC-2.10 | Set count per exercise is editable at plan time and mid-session. |
| AC-2.11 | Adding an exercise conflicting with an active critical coach rule shows a warning naming the rule. |
| AC-2.12 | Unilateral exercises capture L/R separately as numbers, never free text. |
| AC-2.13 | Migration report lists every corrected exercise mapping for review before commit. |
| AC-2.14 | Sum of per-muscle-group volume equals total volume, or the difference appears in `unattributed`. |
| AC-2.15 | Prompt `Upper Body` (or equivalent) returns a draft whose `exercise_id`s all exist in `exercises` — zero invented names. |
| AC-2.16 | With active critical rule "shoulder press before chest", an AI push/upper draft never lists a chest machine above shoulder press. |
| AC-2.17 | AI draft never starts a `workout_sessions` row by itself; `START SESSION` is an explicit second step. |
| AC-2.18 | After BUILD, user can remove an item, reorder, and change `target_sets`; those edits persist into the started session. |
| AC-2.19 | For an exercise with history at the current gym, the plan row shows LAST and BEST matching SQL for that exercise+gym; with no history both show `—`. |
| AC-2.20 | With AI quota exhausted or the route failing, BUILD shows a recoverable notice; Template and Empty still create a plan. |
| AC-2.21 | Train lists sessions grouped by `performed_on`; tapping opens `/train/session/[id]`. |
| AC-2.22 | Deleting a session removes the session and all its sets (cascade); they no longer appear in lists, volume, or LAST/BEST. Confirmed by test. |
| AC-2.23 | Mid live session: add an exercise → new block with PREV; remove an exercise that has committed sets → those sets are gone after confirm. Session stays open. |
| AC-2.24 | Unchecking a committed set unlocks its inputs; re-ticking persists the corrected values under the same set id (one row in Postgres). |
| AC-2.25 | Trends gym picker scopes volume/PRs to the selected gym; strength chart marks each additional gym line's start with a dashed axis marker. |

---

## 6. Edge cases

| Case | Handling |
|---|---|
| Dropset / rest-pause | `set_kind` enum values. Counted as sets, tagged, excluded from top-set PR comparison. |
| Superset | Session-level `superset_group` int on sets. Never encoded in the exercise name. |
| Failed set (DNF) | `reps: 0`, `is_failure: true`. Not `null` — a failure is data. |
| Mid-session exercise swap (machine occupied) | **First-class** (US-2.18): add/remove/reorder freely; plan is a suggestion |
| Delete session that was the only history for an exercise | LAST/BEST become `—` at that gym; no orphaned PR flags |
| Delete while offline | Queued; UI removes optimistically; sync upserts/deletes by client uuid |
| Accidental delete | Confirm step required; no undo after confirm (cloud is truth — restore would be a future import, not v1) |
| Prompt too vague (`train`) | Ask for a focus in `notice`, or return a priority-weighted full-body draft from physique_priorities — never invent exercises |
| Prompt names an exercise not in the library | Skip it; `notice` says what was omitted; user can add manually |
| AI returns an exercise_id not in the payload | Reject that item server-side; do not insert |
| BUILD while offline | Immediate notice; no spinner forever |
| Re-BUILD with items already edited | Confirm replace vs append; default replace draft items, keep gym/date |
| Two sessions same day | Allowed. Separate `workout_sessions` rows. Spreadsheet had duplicate-date rows that double-counted. |
| Forgot to log, entering next day | Date picker on session; `completed_at` retains reality |
| Weight in lb | `unit_pref` on profile; stored canonically in kg |
| Assisted pull-up progressing to unassisted | Two exercises linked by `progresses_to`; timeline stitches across |
| Bodyweight change affects bodyweight-exercise volume | Use bodyweight at session date from `body_measurements`; documented as an estimate |
| Deleting an exercise with history | Blocked (`on delete restrict`). Deactivate instead. |
| Plank hold in the middle of a weighted session | `duration` type; contributes seconds, never volume |

---

## 7. Explain Like in High School

**Prompting a plan instead of picking every exercise.** Some days you know the split — `PULL LEGS!`, `Upper Body` — and you don't want to tap through seventy-eight exercises. You type that, and the app builds a draft from three things that already exist: your exercise library (so it can't invent machines you don't have), your recent logs (so it knows what you did last time), and your coach rules (progressive overload, mechanical tension, V-taper priorities, "shoulders before chest", "no heavy obliques").

The draft is never sacred. Reorder it, delete a row, change set counts, then start. Same editable list as if you'd built it by hand. And for every exercise you've already logged at this gym, it prints **LAST** and **BEST** — so "what do I need to beat?" is answered before the first warm-up, not after you dig through history.

History numbers are attached by the database after the AI picks IDs, not invented by the model. Same idea as food labels: the model proposes structure; arithmetic and records stay deterministic.

**The one thing that matters most.** When you're about to do a set of lateral raises, the app shows `LAST 10kg × 13` right next to the boxes where you type. That's it. That's the highest-value feature in the whole training half.

Why: getting stronger means beating last time, by a bit. If you have to remember what last time was, or go digging for it while your rest timer runs down, you'll guess — and guessing means you'll do the same weight for months without noticing. Your own spreadsheet had a coach rule that literally said *"Do not omit last sets"*, and the spreadsheet couldn't actually show them. That's why its progression suggestions ended up two months out of date.

**Why your abs looked like your biggest muscle group.** Your spreadsheet said Abs/Core had 43,368 kg of total volume — more than your chest (27,298 kg) and legs (23,548 kg) combined-ish. Which would mean core was your single biggest training investment, in a program specifically designed to *not* prioritise it.

It wasn't real. "Volume" was calculated as weight × reps, and an ab machine set of 45 kg × 30 reps = 1,350 kg looks arithmetically identical to a heavy compound lift. The eight biggest single-set volumes in your entire history were all the ab machine.

The fix: every exercise now says what *kind* of load it uses. Weight × reps only gets computed where that number means something. Planks get measured in seconds and never turned into a fake weight. Ab machine work still gets tracked properly — as sets and as load progression — it just doesn't get to sit at the top of a volume leaderboard it doesn't belong on.

**The assisted pull-up trap.** Nice example of why this matters. On an assisted pull-up machine, the weight is helping you — so *less* weight is stronger. If you naively did weight × reps, getting stronger would make your "volume" go **down**, and the graph would show you regressing while you improved. So assisted exercises simply don't produce a volume number; they track "how much assistance did I need", which is the thing that's actually improving.

**Why switching gyms broke your PRs.** A cable machine marked 45 kg at one gym is genuinely not 45 kg at another. Different pulley ratios, different friction, plates that were never calibrated. So when you switched gyms in July, your numbers moved for reasons that had nothing to do with you.

Your spreadsheet tried to cope by typing notes into the PR column — `New Gym Baseline`, `Current Gym Baseline`, `New Baseline`, `Baseline`, four different phrasings for one idea. And because they were text in a column meant for yes/no, the PR count formula couldn't see them.

Now the gym is a proper thing the app knows about, attached to every session. PRs only compare within a gym. Switch gyms and the app says "new baseline" by itself, no typing. You can still compare across gyms — it just labels it clearly instead of pretending they're the same.

**Why you had 335 personal records.** Across roughly 41 sessions. That's eight PRs per workout, which means the word had stopped meaning anything.

Partly it was genuine early progress, partly it was that *any* first attempt at an exercise got flagged as a record. So the app now distinguishes "first time doing this" from "beat my previous best". First times are marked as baselines. A PR is a PR again.

**Why "next session targets" is calculated fresh every time instead of saved.** In your spreadsheet, that tab was a snapshot someone typed once. By the time we looked at it, the newest suggestion was 57 days old — while the coach was under instructions to read it before planning anything. So the coach was confidently recommending loads from two months ago.

Here it isn't stored at all. It's a question the database answers on the spot: what did I do last time, what's the rep range, therefore what's next. It's physically incapable of being stale because it doesn't exist until you ask.

**How the progression suggestion actually works.** It's a standard method called double progression, and it's just two rules:

- If you hit the **top** of your rep range → add weight next time, and expect your reps to drop back to the bottom of the range. That's fine, that's the point.
- If you're **inside** the range → keep the weight, add one rep.

So for lateral raises with a 10–15 range: you hit 10 kg × 15, so next time go 12.5 kg and expect maybe 10 reps. You hit 10 kg × 13, so next time aim for 14 at the same weight.

And every suggestion shows its reasoning — `"from 2026-08-04: 10 kg × 13, top of 10–15 range"`. A recommendation you can't check is a recommendation you shouldn't trust.

**Why offline is non-negotiable here.** Gyms are basements with concrete walls. You have maybe 60 seconds between sets. If saving a set needs a network round-trip, then on a bad-signal day you either wait, or you skip logging, or you lose the set entirely.

So saving writes to your phone's own storage first and returns immediately — under a tenth of a second, network or no network. Uploading happens later and quietly. You should never be aware of it.

**How typos became impossible.** Your spreadsheet had 29 sets tagged with muscle groups that weren't in its own list — `Back/Mid Back`, `Quads`, `Rear Delts`, `Quads/Glutes` and so on. Reasonable-looking words. But the dashboard only summed eight specific categories, so those 29 sets just... disappeared. 9,352 kg of training, 4.2% of your total, gone. And the "Other" row on the dashboard showed **0**, which made it look like everything was accounted for.

Now muscle group is what's called an enum — a fixed list, enforced by the database. A value outside the list isn't a typo that quietly leaks; it's a write that fails. And the trends chart carries a visible "unattributed" bucket, so if anything ever *does* slip through, it shows up as a number instead of hiding behind a zero.

**The oblique thing.** On 2026-08-05 you logged 3 sets of Weighted Oblique Twist. Two separate tabs of your spreadsheet marked "no heavy oblique work — planks only" as a **critical** rule, for waist aesthetics and your V-taper goal.

Nothing flagged it. Partly because spreadsheets don't check rules, and partly because those sets landed in the orphaned tab that no formula and no coach ever read.

So now, when you add an exercise to a plan that conflicts with an active critical rule, the app tells you which rule and lets you decide. It warns; it doesn't block. You might have changed your mind — but you should be *choosing*, not finding out two months later during an audit.

**The chart I think will actually change what you do.** You've written down a priority order: shoulders first, then back and lats, then upper chest, then arms, then legs. There's a chart that puts your stated priority next to where your sets and volume actually went.

Almost nobody's match up. That gap is usually the single most useful piece of information in a training log, and it's exactly the thing a spreadsheet can't show you.
