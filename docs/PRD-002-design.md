# PRD-002 · Coachienta — Design System

| | |
|---|---|
| **Status** | Draft v1 · 2026-08-06 |
| **Aesthetic direction** | **Instrument** — industrial, high-density, precise |
| **Primary viewport** | iPhone, portrait, one-handed, 390×844 baseline |
| **Depends on** | PRD-000, PRD-001 |
| **Skills applied** | `refactoring-ui`, `frontend-design`, `arrange`, `polish`, `delight`, `ui-ux-frontend-review` |

---

## 0. Reference research (Mobbin)

Mobbin MCP connected 2026-08-06. Four searches run across iOS: set logging, food search + portion entry, AI coach chat, and AI photo-candidate review. Every pattern below was verified by examining the actual screens, not metadata.

### Sources examined

| App | Flow / screen | Relevance |
|---|---|---|
| [Hevy — Logging a workout](https://mobbin.com/flows/7b6374ff-8ff6-4d7b-babe-077e72b6ee1f) | 21 screens, live session → save | **Primary reference for PRD-004.** Closest analogue in the category. |
| [Gymshark — Completing a movement](https://mobbin.com/flows/0201c1a7-85da-484d-ba1d-f7d3b9369dc1) | Set commit, supersets | Dark-theme set commit; superset grouping |
| [Gymshark — Adding an exercise](https://mobbin.com/flows/aebf16eb-af1f-49ac-a3b9-916902b928a7) | Exercise picker | A–Z scrubber, multi-select |
| [Ultrahuman — Logging food](https://mobbin.com/flows/e49b76e5-175e-4874-b86d-0e591e6a8617) | Search → per-100g results → multi-add | **Primary reference for PRD-003.** Nearly identical model to ours. |
| [MyFitnessPal — Adding food with search](https://mobbin.com/flows/03129e29-ea82-4321-ab5d-b7040cfc6d61) | Two-tier results, diary | Result ranking, remaining-calorie equation |
| [MacroFactor — Edit Food](https://mobbin.com/screens/a8ba6e6a-6b85-461a-96e9-92023874ea97) | Serving basis editor | **Validates our `basis_unit`/`basis_amount` model** |
| [WHOOP Coach](https://mobbin.com/screens/3116e855-8f53-4d68-8bd5-d8ee8e6bf26c) | AI chat citing user's own metrics | **Primary reference for PRD-005** |
| [Alma](https://mobbin.com/screens/023ee429-ccf6-46ce-85d7-1cc5aef73cfd) | AI answer honest about missing data | Confirms AC-3.13 behaviour |
| [BitePal](https://mobbin.com/screens/becea387-8352-4cfc-96b6-ad322cdcb94c) | AI-detected ingredients, editable grams | **Primary reference for the photo flow** |
| [Life Reset](https://mobbin.com/screens/7adfdd2a-394f-4307-b597-16a2f7ba0baa) | "Food Identified" candidate review | Portion reasoning shown; per-item macro dots |
| [Cal AI](https://mobbin.com/screens/ac4da5ae-acfd-4c04-8038-4eca3bf980d9) | Serving/Package/G basis + AI feedback | 👍/👎 on AI output |
| [Bevel](https://mobbin.com/screens/42957822-9317-4663-93a0-0dce3fa88c39) | Custom numeric keypad | Large-key entry for gym use |
| [Superpower](https://mobbin.com/screens/dd057cca-f363-4c1e-add0-8980c2513999) | "Thinking…" + medical disclaimer | Disclaimer placement |

### Patterns adopted

| Pattern | Source | Why it earns a place |
|---|---|---|
| **`PREVIOUS` column on every set row** | Hevy | Independent confirmation of the highest-value training decision. Hevy names the column `PREVIOUS`; we use `PREV` to fit narrow columns. |
| **Checkbox commits a set; row fills with colour** | Hevy (green), Gymshark (accent) | Replaces my per-row `SAVE` button. Smaller, fixed position, allows out-of-order ticking. |
| **`Duration · Volume · Sets` strip pinned to session** | Hevy | Cheapest way to make a session feel measured. Was missing from my design. |
| **Per-exercise rest timer, configured inline** | Hevy (`Rest Timer: 2min 30s`) | Planks and heavy squats need different rests. Mine was global. |
| **Rest timer as bottom overlay with −15 / +15 / Skip** | Hevy | Concrete replacement for my vague "haptic + pulse" |
| **Warmup set labelled `W`, not a number** | Hevy | Maps directly to our `set_kind` enum |
| **Exercise name as tappable link → history** | Hevy | Free access to progression context |
| **Superset as a section grouping, never a name suffix** | Gymshark (`SUPERSET` header) | Confirms PRD-004 §6 decision; the spreadsheet encoded these in names |
| **Exercise picker: search + Body Part / Recent tabs + A–Z scrubber + multi-select with count in CTA** | Gymshark | Replaces my plain search field |
| **Macros shown per-100g in the search result row** | Ultrahuman (`Per 100g — Calories: 32kcal \| Fat: 0.30g…`) | Makes the basis visible at the decision point |
| **`Create` button beside the echoed query** | Ultrahuman | Exactly our "not in library → resolve with AI" affordance |
| **Selected items as removable chips above the keyboard** | Ultrahuman | A running basket. Serves multi-item logging better than text parsing alone. |
| **Editable date + time chips in the sheet header** | Ultrahuman, BitePal | Replaces my separate date picker. Retroactive logging in one tap. |
| **Two-tier results: `Best Matches` / `More Results`** | MyFitnessPal | Maps onto our cascade — exact+alias vs fuzzy+vector |
| **`+` turns into filled `✓` in place** | MyFitnessPal | Add without navigating. Consistent with the set checkbox. |
| **Verified badge on trusted foods** | MyFitnessPal (green ✓) | Maps directly to our `confidence` field |
| **Remaining shown as a visible equation** | MyFitnessPal (`1,670 Goal − 224 Food = 1,446 Remaining`) | Shows its working — the personality of this product |
| **Per-meal subtotal + per-meal macro breakdown** | MyFitnessPal | I only had per-day |
| **`Serving / 100 g / 100 ml` basis toggle** | MacroFactor, Cal AI | **Validates `basis_unit`.** The most rigorous app in the category models it identically. |
| **Assistant messages unbubbled; user messages bubbled** | WHOOP Coach | Long numeric answers read as documents, not chat blobs |
| **Horizontally-scrolling follow-up chips above the input** | WHOOP Coach | Replaces my "suggested prompts on first open only" |
| **Key numbers bolded inside the answer** | Alma, WHOOP | Free scannability; reinforces the instrument voice |
| **AI states plainly when it lacks data** | Alma | Confirms AC-3.13 |
| **`AI-detected ingredients ⓘ` labels the whole group** | BitePal | Cleaner than per-row `EST` chips for the photo flow |
| **Portion reasoning shown under the item name** | Life Reset | Surfaces our `portion_reasoning` field |
| **Total row above the commit CTA** | Life Reset, MyFitnessPal | Confirms the sum before writing |
| **👍 / 👎 on AI output** | Cal AI ("How did Cal AI do?") | Feeds coach-rule tuning over time |
| **Custom large-key numeric pad** | Bevel | Better than the native keyboard mid-workout |
| **Swipe-left reveals destructive action** | MyFitnessPal | Standard iOS idiom; cheaper than an overflow menu |
| **Persistent small-print disclaimer under the input** | Superpower, Mindvalley | Needed given the jaw-surgery constraint |

### Patterns deliberately rejected

| Rejected | Source | Why |
|---|---|---|
| Exercise thumbnail images / demo video per row | Hevy, Gymshark | The user knows the exercises. Costs vertical space we need for the `PREV` column. |
| Social feed, sharing, visibility settings | Hevy | Single-user product (PRD-000 §4) |
| Barcode scanning as a primary entry point | MyFitnessPal | Japanese konbini barcode coverage is poor (PRD-000 §4) |
| Effort-percentage dropdown per set | Ladder | Our model uses `set_kind` + RPE; % of max needs a tested 1RM we don't have |
| Video-led guided workout | Ladder, Gymshark | Not a guided-training product |
| Circular progress rings | Ultrahuman, Cal AI | Wrong aesthetic. Segmented linear tracks read more precisely (§3.15). |
| Coloured macro dots as the primary encoding | Life Reset | Colour alone can't carry meaning (§11). We use glyph + sign + colour. |
| Streaks, badges, celebratory framing | Gymshark, MyFitnessPal | Wrong register for this user (§10) |

> **Caveat on the evidence.** Mobbin indexes static screens. Roughly half of what makes set logging work is offline behaviour, prefill logic and interaction timing, none of which is visible in a capture. Treated as authoritative on layout, hierarchy and control choice; our own reasoning stands on timing and offline behaviour.

---

## 1. Design context (per `frontend-design` Context Gathering Protocol)

| Required context | Confirmed value |
|---|---|
| **Target audience** | One person. 27, technically literate, trains 4×/week, already maintains a 20-tab spreadsheet by hand. Tolerates density; resents ceremony. |
| **Use cases** | Log food in a konbini or at a table in under 3 s · log a set mid-workout with sweaty hands and no signal · glance at today's variance · review weekly trends on desktop · ask the coach a grounded question |
| **Brand personality** | **Precision instrument.** A scale readout, a caliper, a machinist's gauge. Trustworthy because it is exact. Never chirpy, never gamified, never a "wellness journey". Confident and terse. |
| **Differentiation** | The thing you remember: **numbers that are aligned, monospaced, and always show their delta.** It reads like an instrument panel, not an app. |
| **Quality bar** | Flagship for Features 1–2 (used daily). MVP-acceptable for Feature 3 chrome. |

> Write this to `.impeccable.md` at repo root during P0 so every future design skill invocation finds it.

---

## 2. Aesthetic direction

**Instrument.** Flat, printed, precise. Structure comes from **hairline rules and alignment**, not cards and shadows. The interface should feel like a well-made measuring device — dense but never cramped, because every number is exactly where it belongs.

### Committed choices

- **Rules over cards.** The default container is a horizontal hairline, not a rounded box. Cards appear only for genuinely detachable objects (a session, a chat message).
- **Monospace numerals throughout.** Justified functionally, not stylistically: tabular figures make vertical numeric columns scannable, and the whole product is numeric columns. This is the one legitimate use of mono, and it is a load-bearing decision rather than a "technical vibe".
- **Labels in small caps with letter-spacing.** Reads as instrument nomenclature. Cheap, distinctive, immediately non-generic.
- **One accent: safety orange.** Used for the current value, the primary action, and nothing else. Scarcity is what makes it work.
- **Deltas always visible.** `▲ +8.3` / `▼ −93.3` beside every target. This is the product's voice.
- **Light default, dark supported.** Gym lighting is bright and phones go outdoors. Dark is a real theme, not the default hiding place for weak design decisions.

### Anti-slop commitments

Explicitly rejected, per `frontend-design`:

❌ Inter / Roboto / system-default type ❌ purple→blue or cyan-on-dark gradients ❌ glassmorphism ❌ rounded rectangles with generic drop shadows ❌ gradient text on metrics ❌ dark mode with glowing accents as the default ❌ hero-metric template (big number + tiny label + decorative sparkline) ❌ identical card grids ❌ large rounded icons above every heading ❌ decorative sparklines ❌ bounce/elastic easing ❌ pure `#000` or `#fff` ❌ grey text on coloured backgrounds ❌ modals where a sheet or inline edit works

**The AI Slop Test:** if someone saw this and said "AI made this", the failure would be visible as soft rounded cards floating on a dark gradient. Our defence is the opposite of all of it: warm paper, hairlines, small caps, tabular numerals, one orange.

---

## 3. Tokens

Tailwind CSS v4, CSS-first. Defined once in `app/globals.css` under `@theme` so the same values are reachable from components **and** from chart code.

### 3.1 Colour — OKLCH, tinted neutrals, no pure black or white

```css
@theme {
  /* ── Light (default) ─────────────────────────────── */
  --color-bg:            oklch(0.958 0.005  75);  /* warm concrete */
  --color-surface:       oklch(0.988 0.004  78);  /* panel */
  --color-sunk:          oklch(0.930 0.006  75);  /* inset wells, table zebra */

  --color-rule:          oklch(0.868 0.007  72);  /* hairline — the signature */
  --color-rule-strong:   oklch(0.780 0.009  70);  /* section boundary */

  --color-ink:           oklch(0.235 0.013  62);  /* primary text */
  --color-ink-2:         oklch(0.478 0.011  62);  /* secondary */
  --color-ink-3:         oklch(0.640 0.009  65);  /* tertiary, labels */

  --color-accent:        oklch(0.655 0.190  47);  /* safety orange — fills */
  --color-accent-ink:    oklch(0.505 0.170  44);  /* orange as TEXT on light */
  --color-accent-wash:   oklch(0.955 0.038  60);  /* selected row bg */

  --color-pos:           oklch(0.570 0.110 152);  /* on target / above */
  --color-warn:          oklch(0.680 0.140  78);
  --color-neg:           oklch(0.545 0.175  27);  /* below target / failure */

  /* ── Spacing — refactoring-ui base-16 scale ──────── */
  --space-1: 4px;   --space-2: 8px;   --space-3: 12px;  --space-4: 16px;
  --space-6: 24px;  --space-8: 32px;  --space-12: 48px; --space-16: 64px;
  --space-24: 96px;

  /* ── Type scale — hand-crafted, never modular ────── */
  --text-2xs: 11px; --text-xs: 12px; --text-sm: 14px; --text-base: 16px;
  --text-lg: 18px;  --text-xl: 20px; --text-2xl: 24px; --text-3xl: 30px;
  --text-4xl: 36px; --text-5xl: 48px;

  --font-ui:   'Archivo Variable', system-ui, sans-serif;
  --font-mono: 'IBM Plex Mono', ui-monospace, monospace;

  /* ── Radius — near-square. Instruments aren't soft ─ */
  --radius-sm: 2px; --radius-md: 4px; --radius-lg: 6px;

  /* ── Elevation — used sparingly; rules do the work ─ */
  --shadow-sheet: 0 -1px 0 var(--color-rule-strong), 0 -12px 32px oklch(0.235 0.013 62 / 0.10);
  --shadow-pop:   0 1px 0 var(--color-rule-strong),  0  8px 24px oklch(0.235 0.013 62 / 0.12);

  /* ── Motion ──────────────────────────────────────── */
  --ease-out-quart: cubic-bezier(0.25, 1, 0.5, 1);
  --dur-fast: 120ms; --dur-base: 180ms; --dur-slow: 260ms;

  /* ── Z-scale — semantic, never 9999 ──────────────── */
  --z-sticky: 10; --z-tabbar: 20; --z-sheet-backdrop: 30;
  --z-sheet: 40;  --z-toast: 50; --z-tooltip: 60;
}

@media (prefers-color-scheme: dark) {
  :root {
    --color-bg:          oklch(0.185 0.008 65);
    --color-surface:     oklch(0.228 0.008 65);
    --color-sunk:        oklch(0.150 0.008 65);
    --color-rule:        oklch(0.320 0.009 65);
    --color-rule-strong: oklch(0.400 0.010 65);
    --color-ink:         oklch(0.945 0.005 72);
    --color-ink-2:       oklch(0.740 0.008 68);
    --color-ink-3:       oklch(0.560 0.009 66);
    --color-accent:      oklch(0.705 0.180 50);
    --color-accent-ink:  oklch(0.760 0.160 52);
    --color-accent-wash: oklch(0.280 0.040 55);
    --color-pos:         oklch(0.680 0.110 152);
    --color-neg:         oklch(0.650 0.170  27);
  }
}
```

`:root[data-theme]` overrides must also be emitted so a manual toggle wins in both directions.

### 3.2 Typography

| Role | Family | Size | Weight | Treatment |
|---|---|---|---|---|
| Screen title | UI | 20 | 600 | Tight tracking (−0.01em) |
| Section label | UI | 11 | 600 | **UPPERCASE, +0.08em tracking**, `--color-ink-3` |
| Body | UI | 16 | 400 | line-height 1.5 |
| Secondary / meta | UI | 14 | 400 | `--color-ink-2` |
| **Primary metric** | **Mono** | 36 | 500 | `font-variant-numeric: tabular-nums` |
| **Data value** | **Mono** | 16 | 400 | tabular, **right-aligned** |
| Delta | Mono | 13 | 500 | tabular, coloured by sign |
| Micro / unit | UI | 11 | 500 | `--color-ink-3` |

**Rules.** Never below weight 400 — de-emphasise with colour or size. Line length 45–75 characters (matters only in the coach chat). Mixed sizes on one line align to **baseline**, not centre — critical for `2,090` beside `／ 2,350`. All numeric columns get `tabular-nums`; without it, digit widths shift and the instrument illusion collapses.

**Loading:** self-host both variable fonts via `next/font/local`, `display: swap`, subset to Latin + Japanese punctuation (food names contain kana/kanji — verify glyph coverage or declare a CJK fallback stack).

### 3.3 Rules, not shadows

The hairline is the system's structural primitive.

```css
.rule       { border-block-end: 1px solid var(--color-rule); }
.rule-strong{ border-block-end: 1px solid var(--color-rule-strong); }
```

Per `refactoring-ui`: a border too subtle should get **thicker, not darker**. Section boundaries use `--color-rule-strong` at 1px; on a retina phone that reads as a genuine hairline. Shadows are reserved for surfaces that actually leave the plane — bottom sheets and popovers. Nothing else.

---

## 4. Layout & spatial rhythm

Per `arrange`: **variety creates hierarchy.** Uniform padding everywhere is what makes an interface feel monotonous.

| Relationship | Gap |
|---|---|
| Within a row (label → value) | `--space-2` (8) |
| Between sibling rows in a group | `--space-3` (12) |
| Between groups inside a section | `--space-6` (24) |
| **Between sections** | `--space-12` (48) |
| Screen edge padding | `--space-4` (16) mobile · `--space-8` (32) ≥768px |

More space **around** a group than **within** it, always. That single ratio is what makes a dense screen legible rather than cramped.

### Structure

- **Flexbox for rows** (label/value/delta, button groups, set rows) — the majority of this UI.
- **Grid only for genuinely 2D** layouts: the trends page and the weekly plan matrix.
- **Left-aligned, asymmetric.** Labels left, numbers right, nothing centred except a single empty-state.
- **No nested cards, ever.** Hierarchy inside a group comes from rules and spacing.

### iOS-specific layout

```css
padding-block-end: calc(var(--space-4) + env(safe-area-inset-bottom));
```

- **Thumb zone:** all primary actions live in the bottom third. Tab bar pinned above the home indicator.
- **Bottom sheets are the primary input surface** — not modals, not new pages. Keeps context visible and sits under the thumb.
- **`100dvh`, never `100vh`** — iOS Safari's collapsing toolbar makes `vh` wrong.
- **Inputs at `font-size: 16px` minimum** — anything smaller triggers iOS auto-zoom on focus.
- **`touch-action: manipulation`** on tappables to remove the 300 ms delay.

### Density stance

This is a deliberately dense UI — justified because it is a data instrument used by one expert on their own data. Density is bought with **alignment and rules**, never by shrinking spacing below the scale.

---

## 5. Components

> **Full component library specification: [PRD-007 — Design System & UI Component Library](PRD-007-design-system.md).**
> That document owns the three-tier architecture, per-component prop interfaces, variants, states, build order and the per-component definition of done. This section keeps only the principles that constrain it.

`components/ui/*` (Tier 0) and `components/patterns/*` (Tier 1) are **domain-agnostic**: display props in, events out. Neither may import from `lib/db` or know what a `food_log_entry` is — enforced by ESLint, not convention (PRD-001 §5, PRD-007 §2).

The signature components that carry this aesthetic:

| Component | Role |
|---|---|
| `Rule` | The structural primitive. Replaces cards as the default container. |
| `NumericValue` | Mono, tabular, right-aligned. The single most-used component. |
| `StatRow` | `PRO  168.3 g  ▲ +8.3  TARGET 160`. Powers macros, body stats, PRs. |
| `DeltaBadge` | Direction and good/bad as **separate** props — up is not always good. |
| `NumericTable` | The live-workout set table. Real `<table>`, committed rows filled. |
| `MetricStrip` | `Duration · Volume · Sets`. Added after Mobbin research. |
| `EquationRow` | `1,670 Goal − 224 Food = 1,446 Remaining`. Shows its working. |
| `ProgressTrack` | Segmented blocky fill, with an explicit overflow indicator. |
| `Sheet` | The primary input surface. Header carries editable date/time chips. |

### Action hierarchy

Per `refactoring-ui`: **one** primary per screen (solid accent). Secondary = outline. Tertiary = text. Destructive actions are *not* automatically big and red — `Delete entry` is a ghost/text button; the red solid appears only in the confirmation step.

### Interaction states

Every interactive element ships all eight: default · hover · **focus-visible** · active · disabled · loading · error · success. Focus rings are never removed — 2px `--color-accent` offset 2px. Touch targets **44×44 minimum**, enforced with padding rather than by growing the visual element.

---

## 6. Motion

Restrained. An instrument doesn't bounce.

| Interaction | Treatment |
|---|---|
| Sheet open/close | `translateY` + backdrop opacity, `--dur-slow`, `--ease-out-quart` |
| Row commit (set/food saved) | Background flash `--color-accent-wash` → transparent, `--dur-slow` |
| Number change | Count-up over `--dur-base` for values ≥ 100; instant below |
| Progress fill | `transform: scaleX()`, `--dur-base` |
| Tab change | Cross-fade only, no slide |
| Chart entry | Stagger 30 ms per series, `--dur-slow` |

**Rules:** animate **only `transform` and `opacity`**. No bounce, no elastic — they read as dated. Height changes use `grid-template-rows` transitions, never `height`. Full `prefers-reduced-motion: reduce` support — replace all motion with opacity, keep count-ups instant.

---

## 7. Screen inventory

| Screen | Route | Purpose | Primary action |
|---|---|---|---|
| **Today** | `/today` | The home, and the reader for **any** day. `‹ day ›` navigator in the header, kcal track, three macro `StatRow`s with deltas, timeline of entries, training summary if a session exists. | `＋ FOOD` |
| Log food | `/food/log` (sheet) | Input → resolve → confirm grams → commit | `LOG` |
| Food library | `/food/library` | 279+ foods, sorted by `times_logged`. Search, edit macros, merge duplicates. | `＋ NEW FOOD` |
| Train home | `/train` | Sessions **by date**; open or delete a session; start new | `＋ NEW SESSION` |
| Day plan | `/train/plan` | Prompt → AI draft, or template / empty; edit exercises; LAST + BEST; start session | `BUILD` / `START SESSION` |
| **Live session** | `/train/session/[id]` | **Most important training screen.** Set logging + **add/remove exercises mid-session**; PREV; rest timer; offline-first. | `＋ SET` / `＋ ADD EXERCISE` |
| Exercise library | `/train/exercises` | 78+ exercises with `muscle_group`, `load_type`. Maintenance surface. | `＋ EXERCISE` |
| Coachienta | `/coach` | Streaming chat, tool-call transparency, suggested prompts | `ASK` |
| Trends | `/trends` | Nutrition adherence, weight, volume by muscle group, PR timeline | Range toggle |
| Profile | `/profile` (via More) | Stats; weigh-in (weight kg + waist cm + optional BF%); body monitor; targets; phase; coach rules | `＋ LOG WEIGH-IN` / `SAVE` |

**Navigation:** 4-item bottom tab bar — `TODAY · TRAIN · COACH · MORE`. Food logging is a sheet from Today, not a tab, because it is an *action* rather than a *place*.

---

## 8. Key flows

### Log a known food — target 2 taps, < 3 s

```
Today  →  [＋ FOOD]
  Sheet opens. Header: [06 AUG ⌄] [15:20 ⌄] [Snack ⌄]      ← editable chips
  Cursor in search. RECENT list visible (top 8 by times_logged).

  Tap "White rice (cooked)"     Per 100 g · 126 kcal · P 2.3 · C 28.2 · F 0.0
    → Stepper: 200 g prefilled, presets [100][150][200][250]
    → Live macro preview updates as grams change
    → Item lands in the basket as a removable chip: [White rice 200 g ✕]

  Tap [LOG]  (or keep searching to add more)
    → Sheet closes, row flashes accent-wash into the timeline
    → Today's totals count up, deltas recolour
```

Zero network. Zero AI. Works in a basement.

### Log an unknown food

```
Type "sukiya gyudon mini"
  → Best Matches: (empty)
  → Query echoed as a section header with  [ LOOK UP ]  on the right
  → Grounded AI resolution, skeleton in place, ~4 s
  → Result row: Per 100 g macros · confidence chip · ▸ 2 sources
  → User confirms grams  (mandatory — never auto-commit)
  → [ SAVE TO LIBRARY & LOG ]     ← next time this is the 2-tap path
```

### Photo log — one shutter, two destinations

One camera button. The model classifies what it got, and the review screen changes shape accordingly. No mode picker in front of the shot: choosing "food or label?" every time would cost the user a decision to save a classification that is free.

```
[📷]  →  capture / pick  →  model classifies
                              │
              ┌───────────────┴───────────────┐
         a plate of food              a nutrition panel
       (an ESTIMATE to correct)     (printed FACT to confirm)
```

**Plate.** Grams are editable and focused; portion reasoning shown under each name. Never auto-commits (PRD-000 R9) — photos yield *candidates*, the user owns the grams.

```
  → Sheet: [06 AUG ⌄] [12:40 ⌄] [Lunch ⌄]
  → Dish title, then  AI-DETECTED ITEMS ⓘ          ← group-level provenance
      ⊖  Grilled chicken       1/2 breast, ~120 g        [ 120 ] g
      ⊖  White rice            1 bowl, ~200 g            [ 200 ] g
      ⊖  Kimchi                small side dish            [  60 ] g
      ＋ Add item
  → TOTAL   661 kcal   P 48.2   C 62.1   F 12.4
  → [ ADD 3 ITEMS ]
```

**Label.** A different screen, because a label is a different kind of claim. It opens with a *verdict* rather than a disclaimer — the printed calories checked against the printed macros — then reproduces the panel exactly as transcribed so you can hold the phone next to the packet and compare line by line.

```
  → Sheet: [06 AUG ⌄] [21:10 ⌄] [Snack ⌄]

  ┌──────┐  NAME IT FOR NEXT TIME
  │ 📷   │  [ SAVAS ミルクプロテイン ココア        ]   ← editable, leads the screen
  │      │  Search will match this
  └──────┘  BRAND
            [ 明治                              ]   ← optional; half the library key
            per 100 ml

  ╭────────────────────────────────────────────────╮
  │ ✓  THE NUMBERS ADD UP                          │   ← pos wash, not a warning
  │    44 kcal printed; the macros imply 41–48     │
  ╰────────────────────────────────────────────────╯

  AS PRINTED
  ────────────────────────────────────────────────
  Energy · 熱量                            44 kcal
  Protein · たんぱく質                        7.0 g    ← JP term beside the English
  Fat · 脂質                                 0.0 g       one, only on a JP panel
  Carbohydrate · 炭水化物                     4.2 g
  of which net carbs · 糖質                   4.0 g
  of which fibre · 食物繊維                   0.2 g
  Salt · 食塩相当量                           0.2 g
  ────────────────────────────────────────────────

  HOW MUCH DID YOU HAVE?
  [ 200 ] ml      88 kcal   P 14.0   C 8.4   F 0.0

  → [ SAVE & ADD ]        ← creates the library row, then baskets it
```

Design decisions behind that screen:

- **A verdict, not a provenance badge.** The plate screen must say "these are guesses". A label that reconciles has earned the opposite framing: it is the manufacturer's own declaration, the most trustworthy source in the app. Same visual system, inverted tone — `pos` wash and a check, where the plate gets a neutral group label and an ⓘ.
- **The implied range is shown even when everything passes.** `44 kcal printed; the macros imply 41–48` is the feature made visible in one line. Hiding it on the happy path would leave the user trusting a number for no stated reason.
- **The panel is reproduced, not summarised.** Reading order preserved, nothing renamed, nothing rounded, nothing dropped. A real `<table>` with `<th scope="row">` so it is announced as tabular data.
- **The name is editable and comes first.** OCR misreads names far more often than digits, and the name is what makes the packet findable next week — get it wrong and the whole point of scanning is lost. So it is the first thing on the screen, not a read-only heading. The row is created only when you tap `SAVE & ADD`, under the name you approved.
- **How much you ate is the other editable field.** Everything between them is printed fact. Prefilled with one basis, macros beside it updating live.
- **Failures name the numbers.** `neg` wash and *"The calories printed do not match the macros printed. Check both."* — never a bare "low confidence" chip, which tells the user nothing they can act on.

### Build today's plan from a prompt

```
Train → /train/plan
  PROMPT  [ Upper Body                          ]  [ BUILD ]
  → "Reading rules + last sessions…"
  → Draft list, chip AI DRAFT · edit freely
      1 Shoulder Press Machine   3× 6–10
         LAST 57.5×15 · BEST 60×12
      2 Incline DB Press         3× 6–12
         LAST 20×15 · BEST 22.5×10
      …
  User reorders / removes / tweaks sets
  → [ START SESSION ]
```

Prompt path sits beside Template and Empty. Never auto-starts. LAST + BEST from SQL for the current gym (PRD-004 §4.2a).

### Log a set mid-workout — must survive no signal

```
LATERAL RAISES                                    2 of 5
Shoulders · side delts        Rest 90s ⌄      [ ⏱ 1:23 ]
──────────────────────────────────────────────────────────
SET   PREV          KG        REPS       ✓
 W    —             [  6 ]    [ 15 ]     ☑     ← committed: row filled
 1    10 × 13       [ 10 ]    [ 13 ]     ☑     ← committed
 2    10 × 12       [ 10 ]    [ 12 ]     ☐     ← tap to commit
 3    10 × 10       [ 10 ]    [    ]     ☐
──────────────────────────────────────────────────────────
              [ ＋ ADD SET ]
```

- Tapping `☑` commits: Dexie write < 100 ms, **row fills with accent**, rest timer starts as a bottom overlay with `−15 / +15 / Skip`.
- Inputs prefill from the previous set; `PREV` prefills from last session at this gym.
- Sets can be committed **out of order** — the checkbox is positional, not sequential.
- On a PR: mechanical `PR` stamp (§10), `is_pr = true`.

`PREV` is non-negotiable — it is what the spreadsheet's own coach rules demanded ("Do not omit last sets") and what makes progression decidable in the moment. Hevy independently arrived at the same column.

---

## 9. States

Per `polish` and `frontend-design`: empty states **teach the interface**.

| Screen | Empty state |
|---|---|
| Today, nothing logged | `NO ENTRIES` / "Log your first meal. Your 279 imported foods are already searchable — most take two taps." / `[＋ FOOD]` |
| Food library | Never empty (seeded) |
| Trends, < 7 days data | `NOT ENOUGH DATA` / "Trends need about a week. You're 3 days in." + progress indicator toward 7 |
| Coach, first open | Suggested prompts derived from real data: "How did last week's protein average look?" · "Is my lateral raise progressing?" |
| Session, no exercises | `EMPTY SESSION` / "Add your first exercise, or load the Day 1 Push template." |

**Loading:** skeletons matching final layout — never spinners for content. AI resolution streams with a labelled progress line ("Searching nutrition sources…") because 4 s of silence feels broken.

**Error:** every error names a recovery path. `AI paused until midnight — logging from your library still works.` Not `Error 429`.

**Offline:** persistent, quiet header state — `OFFLINE · 3 PENDING`. Never a blocking modal.

---

## 10. Delight — read the room

Per `delight`: match the domain. This is an instrument, so delight is **precision feedback**, not confetti.

| Moment | Treatment |
|---|---|
| **PR set logged** | Mechanical `PR` stamp — scale 1.06 → 1.0 with a 1px rotation settle, `--dur-slow`. Feels like a press, not a party. |
| Macro target met | The delta badge ticks from `▼ −12` to `● ON TARGET`, tiny scale pulse |
| All three macros met | The three hairlines between macro rows briefly turn accent, top to bottom, 60 ms stagger. Subtle enough to be discovered rather than announced. |
| Set saved | Row locks with a 1px inset shadow — a physical "click" |
| Rest timer complete | Haptic (`navigator.vibrate` where supported) + row pulse |
| Session complete | Compact receipt: sets, volume, PRs, duration — printed-slip framing, not a trophy |
| Loading copy | Specific to what is happening: `Searching nutrition sources…`, `Reading your last 4 sessions…`. **Never** generic AI filler like "Herding pixels". |
| Easter egg | Long-press the Coachienta title → shows total sets logged and days tracked. Discoverable, unannounced. |

**Never:** confetti, streak nagging, badges, gamified levels, celebratory sound by default. Wrong register for this product and this user.

---

## 11. Accessibility

| Requirement | Standard |
|---|---|
| Contrast | 4.5:1 body, 3:1 large. `--color-ink-3` on `--color-bg` **must be verified** — it is the most at-risk pair. |
| Touch targets | 44×44 minimum |
| Focus | Always visible, 2px accent, offset 2px. Never removed. |
| Colour independence | Deltas carry `▲ ▼ ●` glyphs **and** sign, not colour alone |
| Reduced motion | Full `prefers-reduced-motion` support |
| Labels | Every input has a real `<label>`. Placeholder is never the only label. |
| Screen reader | `StatRow` announces "Protein, 168.3 grams, 8.3 above target of 160" — not three orphaned numbers |
| Numeric tables | `<table>` with proper scope, not divs |
| Dynamic Type | Respect iOS text sizing; layout must survive 200% without clipping |
| Language | `lang` attribute per element for Japanese food names so VoiceOver pronounces them correctly |

---

## 12. Definition of done (design)

Ship gate for any screen — from `polish` and `refactoring-ui`:

- [ ] Single clear focal point; competitors muted rather than the focus amplified
- [ ] More space around groups than within them
- [ ] Every spacing and type value from the scale — no arbitrary px
- [ ] All numerics `tabular-nums`, right-aligned; mixed sizes baseline-aligned
- [ ] All-caps labels have increased tracking
- [ ] Exactly one primary action
- [ ] All eight interaction states present
- [ ] Empty, loading, error, offline states designed
- [ ] Contrast verified with a tool, not by eye
- [ ] 44×44 targets; safe-area insets applied; `100dvh` not `100vh`; inputs ≥16px
- [ ] Works at 320px width and at 200% Dynamic Type
- [ ] `prefers-reduced-motion` honoured
- [ ] Only `transform`/`opacity` animated; 60fps on a real iPhone
- [ ] Both themes checked, including `data-theme` manual override
- [ ] Nothing conveyed by colour alone
- [ ] No nested cards; no arbitrary z-index
- [ ] **AI Slop Test:** would someone say "AI made this"? If yes, it fails.

---

## 13. Explain Like in High School

**What "design system" actually means.** It's a fixed menu of choices made once, up front, so you never have to decide again mid-build. Instead of asking "should this gap be 13px or 15px?" every single time, there's a list — 4, 8, 12, 16, 24, 32, 48, 64 — and you pick from it. Same for text sizes, same for colours.

This sounds boring. It's the entire reason professional interfaces look consistent and amateur ones look slightly *off* everywhere. The off-ness is dozens of near-miss values: a 13px gap here, a 15px gap there, three greys that are almost the same grey.

**Why "Instrument" and not something prettier.** You're one expert looking at your own data. You don't need to be eased into it or motivated — you need numbers you can read fast and trust. So the design borrows from measuring devices: kitchen scales, calipers, machinist's gauges. Flat, dense, precisely aligned. The feeling should be *this thing is accurate*, not *this thing is friendly*.

**Why monospace numbers matter more than you'd think.** In normal fonts, digits have different widths — a `1` is narrower than a `0`. So a column of numbers comes out jagged and your eye can't scan down it. Monospace fonts give every digit identical width, so `2,090` sits exactly above `2,350` and you can compare them instantly without reading them.

There's a general design rule that says *don't use monospace just to look technical* — it's a cliché. But here it's doing actual work: this app is basically columns of numbers, and monospace makes columns of numbers readable. Using it for a real reason is different from using it for vibes.

**Why hairlines instead of cards.** The default modern look is: everything in a rounded white box with a soft shadow. It's safe, and it's also the single most recognisable fingerprint of AI-generated design. It also wastes space — every box adds padding, so you fit less on screen.

We use thin lines to separate things instead. Less space wasted, more numbers visible, and it looks like a printed instrument panel rather than a generic app. There's a nice counterintuitive rule here: if a line looks too faint, make it *thicker*, not darker. A darker thin line looks harsh; a slightly thicker faint line looks intentional.

**Why only one accent colour.** Orange means exactly one thing: *this is the number that matters right now, or the button you probably want*. The moment you add a second accent, neither means anything. Colour works by scarcity. Spend it once.

**What OKLCH is and why we're not using hex codes.** Hex codes like `#ff8800` are how computers store colour, not how eyes see it. Two hex colours with the same "brightness" number can look wildly different in brightness to a human. OKLCH describes colour the way you'd actually think about it — lightness, how saturated, which hue — and its lightness number matches human perception. So when I say "make this 10% lighter", it looks 10% lighter, instead of looking washed out or muddy.

Also: no pure black and no pure white anywhere. Pure black doesn't exist in nature and looks like a hole in the screen. Every grey here has a faint warm tint, which is why it reads as paper and concrete rather than as "default computer grey".

**Why deltas instead of fractions.** `197 / 290` makes you do subtraction in your head. `▼ −93 g` tells you the answer. It's a tiny change that removes a small tax from every single glance, dozens of times a day. Notice the arrow *and* the minus sign are both there — that's deliberate, so it still works if you're colour-blind or the screen's washed out in sunlight. Never let colour be the only thing carrying information.

**Why bottom sheets, not pop-up windows.** On a phone held in one hand, your thumb reaches the bottom third of the screen. Anything above that is a stretch or a two-hand operation. So input slides up from the bottom, where your thumb already is, and it doesn't cover the whole screen so you keep your place.

**The iPhone gotchas we're designing around.**

- Text inputs smaller than 16px make iOS zoom in automatically when you tap them. Genuinely infuriating. So 16px is a floor, not a suggestion.
- `100vh` — "full screen height" — is wrong on iOS Safari because the toolbar slides away and changes the real height. There's a newer unit, `100dvh`, that handles it.
- The home-bar area at the bottom will happily sit on top of your buttons unless you explicitly pad for it (`safe-area-inset-bottom`).

**Showing your last performance on the set row.** This is the highest-value decision in the whole training UI, and your own spreadsheet already worked it out — one of its coach rules literally says "Do not omit last sets."

The reason: progressive overload means beating last time. If the app makes you remember or go looking for last time, you'll guess, and guessing means you plateau without noticing. Printing `LAST 10kg × 13` right on the input row means the decision is made *for* you in the moment. Everything else in the training screen is secondary to this.

**Delight, and why there's no confetti.** Delight means small moments of satisfaction — a button that feels good to press, a nice touch when you hit a goal. But it has to match the product. A banking app shouldn't be zany.

For an instrument, satisfaction comes from *precision feedback*: hitting a PR gets a mechanical stamp, like a press coming down. Hitting a macro target flips the delta to `● ON TARGET` with a tiny pulse. Saving a set gives the row a physical "click". No confetti, no badges, no streak guilt — that's a different product for a different person.

One thing worth calling out: loading messages have to be *specific*. "Searching nutrition sources…" tells you what's happening and why the wait is justified. Generic jokey filler like "Herding pixels…" is instantly recognisable as machine-written, and it tells you nothing.

**Empty states should teach, not apologise.** A screen saying "No data" is a dead end. A screen saying "Log your first meal — your 279 imported foods are already searchable, most take two taps" teaches you how the thing works at the exact moment you're ready to learn. Empty states are the best onboarding you'll ever get, because the user is looking right at them and actively wants to proceed.
