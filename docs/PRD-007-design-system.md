# PRD-007 · Coachienta — Design System & UI Component Library

| | |
|---|---|
| **Status** | Draft v1 · 2026-08-06 |
| **Depends on** | PRD-002 (aesthetic direction, tokens, scales) |
| **Consumed by** | PRD-003, 004, 005, 006 — all feature UI |
| **Skills applied** | `clean-code-implementation` (architecture mandate), `arrange` (spatial system), `refactoring-ui`, `polish` |
| **Mobbin research** | See PRD-002 §0 for the evidence base behind these component decisions |

---

## 1. Purpose

One place that defines every reusable UI part, so feature work is composition rather than invention.

This exists because of the `clean-code-implementation` architecture mandate:

> DRY and KISS. Carefully choose where to put the code, don't dump it anywhere. Make components agnostic, and just put props that are necessary. Always use what's already in the codebase.

A component library only delivers that if it is **written first and checked before every new component**. The failure mode is a `components/` folder that accumulates seven button variants because nobody looked.

### Non-negotiable rules

| # | Rule | Enforcement |
|---|---|---|
| R1 | **Search before you create.** No new component until you've checked this inventory. | Code review; §9 checklist |
| R2 | **Tier 0 and Tier 1 components know nothing about the domain.** No `FoodLogEntry`, no `WorkoutSet`, no imports from `lib/db`. | ESLint `no-restricted-imports` on `components/ui/**` |
| R3 | **Only necessary props.** No whole response objects "just in case". | Review |
| R4 | **No inline styles.** Tailwind utilities from the token scale, or a `cva` variant. | ESLint |
| R5 | **No `any`.** Every component has an explicit props interface. | `tsc --strict` |
| R6 | **No arbitrary values.** No `p-[13px]`, no `z-[9999]`, no raw hex. | ESLint `tailwindcss/no-arbitrary-value` |
| R7 | **Every interactive component ships all 8 states.** default · hover · focus-visible · active · disabled · loading · error · success | §9 checklist |
| R8 | **Compose, don't fork.** Need a variant? Add a variant. Don't copy the file. | Review |

---

## 2. Architecture

```
components/
  ui/              ← Tier 0: primitives.      ZERO domain knowledge.
  patterns/        ← Tier 1: composites.      Still domain-agnostic.
  charts/          ← Tier 1: data viz.        Display props only.
  food/            ← Tier 2: domain-aware.
  train/           ← Tier 2
  coach/           ← Tier 2
  profile/         ← Tier 2
```

**The dependency rule — enforced, one direction only:**

```
Tier 2 (domain)  →  Tier 1 (patterns/charts)  →  Tier 0 (ui)  →  tokens
```

Nothing ever points left. A Tier 0 component importing from `food/` is a build failure, not a style opinion.

**Where domain mapping lives:** `lib/domain/*`. A page orchestrator reads data, maps it to display props, and hands those to agnostic components. Presentational components receive *display models*, never API or DB shapes.

```tsx
// ✅ correct — Today page orchestrates, StatRow stays agnostic
const rows = toMacroDisplayRows(entries, activeTargets)   // lib/domain/food
return rows.map(r => <StatRow key={r.id} {...r} />)

// ❌ wrong — component now knows the DB shape
<StatRow entry={foodLogEntry} targets={nutritionTargetsRow} />
```

### Implementation stack

| Concern | Choice | Why |
|---|---|---|
| Variants | **`cva` (class-variance-authority)** | Type-safe variant maps; kills the prop-to-className `if` ladder |
| Class merging | **`tailwind-merge`** via a `cn()` helper | Consumer overrides win predictably |
| Unstyled behaviour | **Radix UI primitives** for Sheet, Toggle, Checkbox, Select, Tabs, Toast, Tooltip | Focus trapping, ARIA and keyboard behaviour are solved problems. We style; we don't reimplement. |
| Icons | **Lucide** at 1.5px stroke, 20px default | Matches the hairline aesthetic. One family only. |
| Animation | **CSS transitions** first; Framer Motion only for the Sheet | Keeps the bundle small |

> Radix is a deliberate exception to "build it yourself". Accessible focus management is where hand-rolled components fail, and PRD-002 §11 commits to real a11y.

---

## 3. Tier 0 — Primitives

### 3.1 `Text`

Every piece of text goes through this. It is what stops the type scale drifting.

```tsx
interface TextProps {
  variant: 'title' | 'section-label' | 'body' | 'meta' | 'micro'
  tone?: 'primary' | 'secondary' | 'tertiary' | 'accent' | 'positive' | 'warning' | 'negative'
  weight?: 400 | 500 | 600
  align?: 'start' | 'center' | 'end'
  truncate?: boolean | 1 | 2
  as?: 'p' | 'span' | 'h1' | 'h2' | 'h3' | 'div' | 'label'
  lang?: string          // 'ja' for Japanese food names — VoiceOver pronunciation
  children: ReactNode
}
```

| variant | size / weight / treatment |
|---|---|
| `title` | 20 / 600 / tracking −0.01em |
| `section-label` | 11 / 600 / **UPPERCASE, tracking +0.08em**, tone `tertiary` by default |
| `body` | 16 / 400 / line-height 1.5 |
| `meta` | 14 / 400 / tone `secondary` |
| `micro` | 11 / 500 / tone `tertiary` |

**Rules:** `as` is chosen semantically, `variant` visually — they are independent (PRD-002 §3.2). Never below weight 400; de-emphasise with `tone`. No numeric data goes through `Text` — that is `NumericValue`.

---

### 3.2 `NumericValue`

The single most-used component in the product, and the one that carries the Instrument aesthetic.

```tsx
interface NumericValueProps {
  value: number | null
  unit?: string
  size?: 'metric' | 'data' | 'compact'   // 36 / 16 / 13
  tone?: 'primary' | 'secondary' | 'tertiary' | 'accent' | 'positive' | 'negative'
  decimals?: number                       // default: 0 for ≥100, 1 below
  showSign?: boolean
  placeholder?: string                    // shown when value is null — default '—'
  countUp?: boolean                       // animate on change (PRD-002 §6)
}
```

**Hard requirements:**
- `font-variant-numeric: tabular-nums` — always. Without it, columns jitter and the instrument illusion dies.
- Right-aligned by default in table contexts.
- Thousands separators on values ≥ 1,000.
- `null` renders the placeholder, **never `0`**. A missing measurement is not zero — this distinction is why PRD-006 charts skip nulls instead of plotting them.

```tsx
<NumericValue value={2090} size="metric" />          {/* 2,090 */}
<NumericValue value={168.3} unit="g" size="data" />   {/* 168.3 g */}
<NumericValue value={null} />                          {/* — */}
```

---

### 3.3 `Button`

```tsx
interface ButtonProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'className'> {
  variant?: 'primary' | 'secondary' | 'ghost' | 'danger'
  size?: 'sm' | 'md' | 'lg'
  loading?: boolean
  fullWidth?: boolean
  iconStart?: LucideIcon
  iconEnd?: LucideIcon
  children?: ReactNode
}
```

| variant | Treatment | Use |
|---|---|---|
| `primary` | Solid `--color-accent`, ink-on-accent text | **Exactly one per screen.** `LOG`, `SAVE`, `START SESSION` |
| `secondary` | 1px `--color-rule-strong` border, transparent fill | `＋ ADD EXERCISE`, `＋ SET` |
| `ghost` | No border, `--color-ink-2` text | `Cancel`, `Edit`, row actions |
| `danger` | **Text-only, `--color-negative`** by default | `Delete entry`, `Discard workout` |

| size | Height | Padding | Text |
|---|---|---|---|
| `sm` | 32 | 12 | 14 |
| `md` | 44 | 16 | 16 |
| `lg` | 52 | 24 | 16 |

**`md` is the floor for anything touched on mobile** — 44px is the iOS target minimum (PRD-002 §11).

**Rules:**
- `danger` is text-only because destructive actions are *not* automatically big and red (`refactoring-ui`). Mobbin confirms: Hevy renders "Discard Workout" as red text, not a red button. The solid red appears only on the confirmation step.
- `loading` keeps the button's width fixed and swaps content for a spinner — no layout shift.
- `loading` implies `disabled` and sets `aria-busy`.
- Label is a verb. `LOG`, not `OK`.

---

### 3.4 `IconButton`

```tsx
interface IconButtonProps {
  icon: LucideIcon
  label: string          // REQUIRED — becomes aria-label. No unlabelled icon buttons.
  variant?: 'ghost' | 'secondary' | 'danger'
  size?: 'sm' | 'md'     // visual 32 / 40 — hit area always ≥44 via padding
  onClick: () => void
  disabled?: boolean
}
```

`label` is required, not optional. An icon-only button without an accessible name is the most common a11y failure in mobile UI.

---

### 3.5 `Field` + `Input`

`Field` owns label, hint, error and the id/aria wiring. `Input` is the control. They are separate so `Field` can wrap `NumericInput`, `Select`, `Stepper` too.

```tsx
interface FieldProps {
  label: string                  // REQUIRED. Placeholder is never the only label.
  hint?: string
  error?: string
  required?: boolean
  labelHidden?: boolean          // visually hidden, still announced
  children: ReactElement
}

interface InputProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'size'> {
  size?: 'md' | 'lg'
  invalid?: boolean
  iconStart?: LucideIcon
  onClear?: () => void           // renders a clear affordance when set
}
```

**Rules:**
- **`font-size: 16px` minimum, always.** Anything smaller triggers iOS auto-zoom on focus (PRD-002 §4).
- Error replaces hint in the same slot — no layout shift on validation.
- `aria-invalid` and `aria-describedby` wired automatically by `Field`.
- Validation fires on blur, not per keystroke.

---

### 3.6 `NumericInput`

Separate from `Input` because numeric entry on mobile has different requirements, and this is what gets used mid-workout with one thumb.

```tsx
interface NumericInputProps {
  value: number | null
  onChange: (v: number | null) => void
  unit?: string                  // rendered inside, right-aligned, tertiary tone
  min?: number
  max?: number
  step?: number
  decimals?: number
  placeholder?: string           // typically the previous value — see PRD-004
  keypad?: 'native' | 'custom'   // custom = in-app keypad sheet
  selectOnFocus?: boolean        // default true
  size?: 'md' | 'lg'
}
```

**Requirements:**
- `inputMode="decimal"`, `type="text"` — `type="number"` brings spinners and rejects valid intermediate input.
- Mono tabular font, right-aligned.
- `selectOnFocus` defaults true — tapping a prefilled field lets you overtype immediately, which is the whole point of prefilling.
- `keypad="custom"` opens a `KeypadSheet` (§4.6) with large keys. **Mobbin: Bevel ships exactly this** — a custom pad with `1–9`, `0`, `,`, `/`, backspace and a filled `Done`. Justified in the gym: bigger targets, no keyboard chrome eating the screen, and it can't trigger iOS zoom.

---

### 3.7 `Stepper`

The grams control. Small component, disproportionate impact on Feature 1's speed.

```tsx
interface StepperProps {
  value: number | null
  onChange: (v: number) => void
  unit: string
  step?: number
  min?: number
  max?: number
  presets?: number[]             // e.g. [100, 150, 200, 250]
  size?: 'md' | 'lg'
}
```

**Anatomy:** `[−]` `NumericInput` `[+]`, with an optional preset row beneath.

Presets are the highest-value detail in the whole food flow — derived from the food's own logging history (`foods.usual_amount` ± common variants), so the common case is one tap rather than typing.

---

### 3.8 `Toggle`

Radix Switch, styled.

```tsx
interface ToggleProps {
  checked: boolean
  onCheckedChange: (v: boolean) => void
  label: string                  // REQUIRED
  labelPosition?: 'start' | 'end'
  hint?: string
  size?: 'sm' | 'md'
  disabled?: boolean
}
```

Track 44×26 (`md`), thumb 22, travel animated with `transform` only. Accent when on, `--color-sunk` when off. Label is always a real `<label>` and is part of the 44px hit area — tapping the text toggles it.

**Not for filtering.** A toggle is a persistent setting. Use `SegmentedControl` for view switching and `Chip` for filters.

---

### 3.9 `Checkbox`

Radix Checkbox. Two visual modes, because Mobbin research changed this component's role.

```tsx
interface CheckboxProps {
  checked: boolean | 'indeterminate'
  onCheckedChange: (v: boolean) => void
  label?: string                 // optional — omit only inside a labelled table row
  size?: 'sm' | 'md' | 'lg'
  variant?: 'default' | 'commit'
}
```

- `default` — 20px square, 2px radius, accent fill with a drawn tick.
- **`commit` — 32px, used as the set-complete control in the live workout table.**

The `commit` variant exists because of a direct research finding. **Hevy** uses a `✓` column at the end of every set row; ticking it commits the set and the whole row turns green. **Gymshark** does the same, filling the row with its accent colour. This replaces the per-row `[SAVE]` button in my original PRD-004 design — it's smaller, always in the same position, and lets sets be ticked out of order.

---

### 3.10 `SegmentedControl`

```tsx
interface SegmentedControlProps<T extends string> {
  options: Array<{ value: T; label: string; disabled?: boolean }>
  value: T
  onChange: (v: T) => void
  size?: 'sm' | 'md'
  fullWidth?: boolean
}
```

Uses: `Gym day / Rest day` · `7d / 30d / 90d` · **`Serving / 100 g / 100 ml`**.

That last one is a direct lift from **MacroFactor**, which exposes serving basis as a three-way segmented control. It maps precisely onto our `basis_unit` enum (PRD-001 §3.2) — strong validation that the per-basis model matches how the most methodologically serious app in the category thinks.

Selection indicator is a filled block that slides via `transform`. Arrow-key navigable, `role="radiogroup"`.

---

### 3.11 `Chip`

```tsx
interface ChipProps {
  label: string
  tone?: 'neutral' | 'accent' | 'positive' | 'warning' | 'negative' | 'info'
  size?: 'sm' | 'md'
  icon?: LucideIcon
  onRemove?: () => void          // renders ✕ — makes it a removable token
  onClick?: () => void           // makes it a filter/suggestion chip
}
```

| Use | tone | Example |
|---|---|---|
| Confidence | `warning` | `EST`, `UNVERIFIED` |
| Verified | `positive` | `VERIFIED` ✓ |
| PR | `accent` | `PR` |
| Gym context | `info` | `NEW GYM` |
| Set kind | `neutral` | `W`, `TOP`, `DROP` |
| Removable token | `neutral` + `onRemove` | `Plain Yogurt 100 g ✕` |
| Suggestion | `neutral` + `onClick` | `How was my protein last week?` |

The removable-token form comes from **Ultrahuman**, which stacks selected foods as dismissible chips above the keyboard while you keep searching — a running basket. The suggestion form comes from **WHOOP Coach**, which puts horizontally-scrolling follow-up prompts directly above the chat input.

---

### 3.12 `Rule`

```tsx
interface RuleProps {
  strong?: boolean
  inset?: boolean       // indents to align with row content, not the screen edge
}
```

The structural primitive of the whole system (PRD-002 §3.3). `inset` matters: a rule between list rows should start where the text starts, not at the screen edge — otherwise the list reads as a table when it isn't one.

---

### 3.13 `Card`

Deliberately constrained, because the default modern instinct is to wrap everything in one.

```tsx
interface CardProps {
  children: ReactNode
  padding?: 'none' | 'sm' | 'md'
  interactive?: boolean          // adds hover/active affordance
  as?: 'div' | 'article' | 'li'
}
```

**Rules:**
- Use only for a genuinely **detachable object**: a workout session, a chat message, a food candidate.
- **Never nest a Card in a Card** (`arrange`). Internal hierarchy is `Rule` and spacing.
- Never use Cards to build a uniform grid of identical tiles — that's the "AI made this" fingerprint.
- Radius `--radius-md` (4px). Border, not shadow. Shadows are for surfaces that leave the plane.

Default container in this product is a `Rule`-separated group, not a `Card`. If you reach for `Card`, justify it.

---

### 3.14 `Sheet`

The primary input surface on mobile — not modals, not new pages (PRD-002 §4).

```tsx
interface SheetProps {
  open: boolean
  onOpenChange: (v: boolean) => void
  title?: string
  headerSlot?: ReactNode         // date/time/meal chips — see below
  footer?: ReactNode             // sticky action area
  size?: 'auto' | 'half' | 'full'
  dismissible?: boolean          // false while a write is in flight
  children: ReactNode
}
```

**Anatomy:** drag handle · header (title + `headerSlot` + close) · scrollable body · sticky footer with safe-area padding.

`headerSlot` exists because of **Ultrahuman** and **BitePal**, which both put editable **date and time chips directly in the log sheet header**. Retroactive logging becomes a one-tap adjustment instead of a separate date-picker screen. This replaces the "date picker" I'd specified in PRD-003 §7.

Radix Dialog underneath — focus trap, scroll lock, Escape, `aria-modal` all handled. Enters with `translateY` + backdrop fade, `--dur-slow`, `--ease-out-quart`.

---

### 3.15 `ProgressTrack`

```tsx
interface ProgressTrackProps {
  pct: number                    // 0–100+, clamped visually at 100
  tone?: 'accent' | 'positive' | 'warning' | 'negative'
  size?: 'sm' | 'md'
  segmented?: boolean            // blocky fill — the Instrument treatment
  overflowIndicator?: boolean    // marks >100% rather than silently clamping
  label?: string                 // aria label
}
```

`segmented` produces the blocky `██████▏` fill from the chosen aesthetic direction. `overflowIndicator` matters for calories: 110% of target must look different from 100%, not identical.

`role="progressbar"` with `aria-valuenow/min/max`.

---

### 3.16 `ListRow`

The workhorse for every list in the app.

```tsx
interface ListRowProps {
  leading?: ReactNode
  title: string
  subtitle?: string
  trailing?: ReactNode
  meta?: ReactNode               // right-aligned numeric slot
  onClick?: () => void
  swipeActions?: Array<{ label: string; tone: 'neutral' | 'negative'; onAction: () => void }>
  lang?: string
}
```

Swipe actions come from **MyFitnessPal**, where swiping an ingredient row reveals a red `Delete`. Standard iOS idiom; cheaper than an overflow menu for one destructive action. Every swipe action must also be reachable without swiping (long-press menu) — swipe alone is not accessible.

---

### 3.17 Remaining primitives

| Component | Notes |
|---|---|
| `SearchField` | `Input` + search icon + clear + debounced `onSearch`. Never auto-submits. |
| `Select` | Radix Select. Native-feeling on iOS, keyboard navigable. |
| `Tabs` | Radix Tabs. Underline indicator, not pills — pills are `SegmentedControl`'s job. |
| `Toast` | Radix Toast. Bottom, above tab bar, auto-dismiss 4s, `role="status"`. Optional `Undo` action. |
| `Skeleton` | Shape matching final content. **Never a spinner for content** (`polish`). |
| `Spinner` | Only for in-button loading and indeterminate waits. |
| `Tooltip` | Radix. Desktop only — on touch, use `hint` text instead. Never the sole carrier of information. |
| `EmptyState` | `title` + `body` + optional `action`. Teaches the interface (PRD-002 §9). |
| `Stack` / `Row` | Thin flex wrappers with `gap` from the scale. Exists to stop ad-hoc margin values. |

---

## 4. Tier 1 — Patterns

Composites built from Tier 0. Still zero domain knowledge.

### 4.1 `StatRow`

The signature component. Powers macro rows, body stats, PR displays.

```tsx
interface StatRowProps {
  label: string
  value: number | null
  unit?: string
  target?: number
  delta?: { value: number; direction: 'up' | 'down' | 'neutral' }
  state?: 'on-target' | 'under' | 'over' | 'neutral'
  chip?: { label: string; tone: ChipTone }
  onClick?: () => void
}
```

Renders: `PRO   168.3 g   ▲ +8.3   TARGET 160`

**Accessibility requirement:** announces as one sentence — *"Protein, 168.3 grams, 8.3 above target of 160"* — not four orphaned numbers. This is the single biggest screen-reader win in the product.

### 4.2 `DeltaBadge`

```tsx
interface DeltaBadgeProps {
  value: number
  unit?: string
  direction: 'up' | 'down' | 'neutral'
  state: 'good' | 'bad' | 'neutral'
  showGlyph?: boolean            // default true
}
```

`▲ +8.3` / `▼ −93.3` / `● ok`

**Direction and state are separate props on purpose.** Up is not always good: over on protein is good, over on calories during a cut is not. Conflating them is a bug waiting to happen.

Glyph **and** sign are both present so the meaning survives colour-blindness and sunlight (PRD-002 §11).

### 4.3 `MetricStrip`

```tsx
interface MetricStripProps {
  metrics: Array<{ label: string; value: number | null; unit?: string; tone?: Tone }>
  columns?: 2 | 3 | 4
}
```

Renders `Duration 1h 3min · Volume 1,740 kg · Sets 17`.

Straight from **Hevy**, which pins exactly this three-metric strip to the top of the live session and repeats it on the save screen. It's a gap in my original PRD-004 design and it's the cheapest possible way to make a session feel measured.

### 4.4 `EquationRow`

```tsx
interface EquationRowProps {
  terms: Array<{ label: string; value: number; operator?: '−' | '+' | '=' }>
  resultTone?: Tone
}
```

Renders `1,670 Goal − 224 Food + 0 Exercise = 1,446 Remaining`.

Borrowed from **MyFitnessPal**, which lays the calorie arithmetic out as a visible equation rather than a bare remaining figure. It suits the Instrument aesthetic better than anything I'd designed — it shows its working, which is the whole personality of this product.

### 4.5 `NumericTable`

The live-workout set table and any dense numeric grid.

```tsx
interface NumericTableProps<Row> {
  columns: Array<{
    key: string
    header: string
    align?: 'start' | 'end'
    width?: 'auto' | 'min' | number
    render: (row: Row) => ReactNode
  }>
  rows: Row[]
  rowKey: (row: Row) => string
  rowState?: (row: Row) => 'default' | 'committed' | 'active' | 'disabled'
}
```

**Requirements:**
- Real `<table>` with `<th scope="col">`. Not divs (PRD-002 §11).
- Column headers use `Text variant="section-label"`.
- `rowState="committed"` applies the filled treatment — Mobbin shows this is universal (Hevy green fill, Gymshark accent fill). My original "1px inset shadow" was far too subtle to read at a glance mid-set.
- Numeric columns right-aligned, `tabular-nums`.

### 4.6 `KeypadSheet`

```tsx
interface KeypadSheetProps {
  open: boolean
  value: string
  unit?: string
  onChange: (v: string) => void
  onDone: () => void
  allowDecimal?: boolean
}
```

Large-key in-app numeric pad (**Bevel** pattern). Used for gym input where the native keyboard is small, occupies half the screen, and risks iOS zoom.

### 4.7 Remaining patterns

| Component | Purpose | Research basis |
|---|---|---|
| `SuggestionChips` | Horizontally-scrolling prompt chips above an input | **WHOOP Coach** |
| `TokenBar` | Removable chips for a multi-select in progress | **Ultrahuman** food basket |
| `SourceCite` | Collapsible citation list for AI-resolved data | PRD-003 §3.2 |
| `SyncBadge` | Pending / failed / last-synced indicator | PRD-001 §4.2 |
| `FeedbackButtons` | 👍 / 👎 on an AI output | **Cal AI** "How did Cal AI do?" |
| `ProvenanceHeader` | Section label marking AI-generated content | **BitePal** "AI-detected ingredients ⓘ" |
| `DisclaimerNote` | Persistent small-print under an input | **Superpower**, **Mindvalley** |

`ProvenanceHeader` deserves note: **BitePal** labels the whole AI-detected group once rather than badging each row. Cleaner than my per-row `EST` chip for the photo flow, and it makes the boundary between "AI guessed this" and "you entered this" explicit.

---

## 5. Charts

All charts go through `components/charts/*` wrappers. Raw Recharts defaults must never reach a screen (PRD-001 T6).

```tsx
interface TrendLineProps {
  series: Array<{ x: string; y: number | null }>
  targetBand?: { low: number; high: number }
  range: '7d' | '30d' | '90d'
  unit?: string
  tone?: Tone
}
```

**House style:**
- 1px hairline stroke. **No gradient fills, no drop shadows, no dots except the final point.**
- Colours read from CSS custom properties — never hardcoded, so themes work.
- `null` breaks the line. Never interpolated, never plotted as 0.
- Target shown as a **tick mark or band**, never a competing second series.
- Grid lines: horizontal only, `--color-rule`.
- Every chart ships a table fallback (`<details>`) for screen readers.

> **Load the `dataviz` skill before implementing any chart.** It owns palette validation, mark specs and legend/axis rules.

---

## 6. Spatial system

From `arrange`. Enforced by the `Stack`/`Row` primitives so it can't drift.

| Relationship | Token | px |
|---|---|---|
| Within a row (label → value) | `space-2` | 8 |
| Sibling rows in a group | `space-3` | 12 |
| Groups within a section | `space-6` | 24 |
| **Between sections** | `space-12` | 48 |
| Screen edge (mobile) | `space-4` | 16 |
| Screen edge (≥768) | `space-8` | 32 |

**The one ratio that matters: more space *around* a group than *within* it.** That's what makes a dense screen legible instead of cramped.

**Rhythm rules:**
- Never uniform padding everywhere — variety *is* the hierarchy.
- `gap` for sibling spacing, never margins.
- Flexbox for 1D (most of this UI). Grid only for genuinely 2D — the trends page, the weekly plan matrix.
- Left-aligned and asymmetric. Labels left, numbers right. Nothing centred except a lone `EmptyState`.

---

## 7. States

Every interactive component implements all eight. This is a ship gate, not a nice-to-have.

| State | Treatment |
|---|---|
| default | Base |
| hover | Pointer only — `--color-sunk` background shift |
| **focus-visible** | 2px `--color-accent` ring, offset 2px. **Never removed.** |
| active | `translateY(1px)`, `--dur-fast` |
| disabled | 40% opacity, `cursor: not-allowed`, `aria-disabled` |
| loading | Spinner replaces content at fixed width, `aria-busy` |
| error | `--color-negative` border + message in the `Field` error slot |
| success | Brief `--color-positive` flash, `--dur-slow` |

---

## 8. Build order

Components are built in dependency order during **P0**, before any feature work. Feature PRDs assume these exist.

| Wave | Components |
|---|---|
| **P0a — foundations** | tokens, `cn()`, `Text`, `NumericValue`, `Rule`, `Stack`, `Row` |
| **P0b — controls** | `Button`, `IconButton`, `Field`, `Input`, `NumericInput`, `Stepper`, `Checkbox`, `Toggle`, `SegmentedControl`, `Select` |
| **P0c — containers** | `Card`, `Sheet`, `ListRow`, `Tabs`, `Toast`, `Skeleton`, `EmptyState`, `SearchField`, `Chip` |
| **P0d — patterns** | `StatRow`, `DeltaBadge`, `ProgressTrack`, `MetricStrip`, `EquationRow`, `NumericTable`, `SyncBadge` |
| **P1+ — as needed** | `KeypadSheet`, `TokenBar`, `SourceCite`, `SuggestionChips`, `FeedbackButtons`, `ProvenanceHeader`, charts |

A component-gallery route at `/dev/ui` renders every component in every variant and state. It is the fastest way to catch drift, and it's where the `polish` audit runs.

---

## 9. Definition of done (per component)

- [ ] Checked the inventory first — this genuinely doesn't exist yet (R1)
- [ ] Correct tier; **no domain imports** in Tier 0/1 (R2)
- [ ] Explicit props interface, minimum necessary props, no `any` (R3, R5)
- [ ] Variants via `cva`; no prop-to-className `if` ladders (R8)
- [ ] Zero inline styles, zero arbitrary values, zero raw hex (R4, R6)
- [ ] All 8 states implemented (R7)
- [ ] Keyboard operable; focus visible; correct ARIA role and name
- [ ] Touch targets ≥44×44
- [ ] Contrast verified with a tool, not by eye
- [ ] Both themes checked, including `data-theme` manual override
- [ ] `prefers-reduced-motion` honoured
- [ ] Only `transform`/`opacity` animated
- [ ] Survives 200% Dynamic Type and a 320px viewport
- [ ] Nothing conveyed by colour alone
- [ ] Rendered in `/dev/ui` in every variant
- [ ] **AI Slop Test:** does it read as a generic rounded-card-with-shadow component? If yes, it fails.

---

## 10. Explain Like in High School

**What a design system is, in one sentence.** A fixed set of pre-made parts, so building a screen is assembling rather than inventing.

Without one, you write a button in the food screen, another in the workout screen, another in the profile screen. Three months later there are seven buttons that are all slightly different — different heights, different greys, different corner radii. Nobody decided that; it just happened. That accumulated near-miss inconsistency is exactly what makes amateur software *feel* amateur even when you can't point at what's wrong.

**Why "tiers" and the one-way arrow.** Components are stacked in three layers, and the rule is that dependencies only ever point downward:

- **Tier 0** — dumb parts. A `Button` knows it's a button. It has no idea this app is about food.
- **Tier 1** — smart-ish combinations. `StatRow` knows how to lay out *a label, a number, and a target* — but not that the number is protein.
- **Tier 2** — the app-specific stuff that actually knows what a food log entry is.

Why bother? Because the moment a `Button` knows about food, you can't use it on the workout screen without dragging food code along. Keeping the bottom layers ignorant is what makes them reusable. It's the difference between a set of Lego bricks and a single pre-glued model.

There's an ESLint rule enforcing this, so it's a build error rather than a code-review argument.

**Why `NumericValue` is its own component.** Seems like overkill — it's just a number on screen. But almost every number in this app needs the same four things: monospaced digits so columns line up, right-alignment, a thousands separator, and a dash when the value is missing.

That last one matters more than it sounds. If a body-fat reading is missing and you render `0`, your chart now shows you dropped to 0% body fat. A blank and a zero are completely different facts, and a shared component is how you guarantee they never get confused.

**The `DeltaBadge` detail I'm mildly proud of.** It takes *direction* and *good-or-bad* as two separate inputs, because they aren't the same thing. Going over on protein is good. Going over on calories during a cut is bad. Both are "up".

If you build one property called `isPositive` and use it for both, you will eventually ship a green arrow celebrating a calorie overshoot. Splitting them makes that impossible rather than unlikely.

**What Mobbin actually changed.** I'd designed the workout screen from reasoning. Then I looked at what Hevy and Gymshark actually ship, and three of my decisions were wrong:

1. **I had a `SAVE` button on every set row.** Both apps use a **checkbox** at the end of the row instead. It's better: smaller, always in the same spot, and you can tick sets out of order. Obvious once you see it.
2. **I said a completed row would get "a 1px inset shadow".** Hevy turns the whole row **green**. Gymshark fills it with the accent colour. Mine was far too subtle to read at a glance while you're breathing hard between sets. A filled row is unmissable.
3. **I had no session summary.** Hevy pins `Duration · Volume · Sets` to the top of the screen the whole time. Nearly free to build, and it makes the session feel measured while you're in it.

That's the value of looking at shipped products. Reasoning gets you close; the details that matter are the ones real users have already sanded down.

**The most reassuring thing I found.** MacroFactor — the most rigorous nutrition app out there — lets you switch a food between `Serving / 100 g / 100 ml`. Ultrahuman shows `Per 100g — Calories: 32kcal | Fat: 0.30g...` right in the search results.

That's the *exact* model I proposed in PRD-003: store the rate per basis, not the total. It's the fix for your spreadsheet's dead-end "this meal was 252 calories" plus a text note saying `200g`. Finding out that the serious apps in the category model it identically is good evidence the foundation is right.

**Why we use somebody else's library for sheets and checkboxes.** Normally "build it yourself" is the right instinct. Not here.

A bottom sheet sounds trivial — slide a panel up. But it also has to trap keyboard focus inside itself, stop the page behind from scrolling, close on Escape, restore focus to wherever you were when it closes, and announce itself correctly to a screen reader. That's a lot of fiddly, invisible work, and hand-rolled versions almost always get some of it wrong.

Radix gives us all that behaviour with **no styling at all** — so we still own 100% of how it looks. We're borrowing the boring correctness and keeping the design.

**Why there's a rule against cards.** The default modern look is: every piece of content in a rounded white box with a soft shadow. It's the single most recognisable fingerprint of AI-generated design, and it wastes space — every box adds padding, so less fits on screen.

So `Card` exists, but it's only for genuinely detachable things: one workout session, one chat message. Everything else uses thin lines and spacing. And cards can never nest inside cards — a box in a box in a box is how interfaces turn to mush.

**Why "one primary button per screen".** A primary button is the solid orange one. Its job is to answer "what do I probably want to do here?" The instant there are two, it answers nothing.

Related: destructive actions are *not* automatically big and red. "Delete entry" is plain text. The big red button only appears on the confirmation step, when destroying something genuinely is the primary action. Hevy does exactly this — "Discard Workout" is red *text*. Making delete visually loud just means people hit it by accident.

**The 16px input rule, which is a real iPhone bug.** Any text input smaller than 16px makes iOS Safari zoom the whole page in when you tap it. You then have to pinch back out. It's genuinely maddening and it's why so many mobile web forms feel broken.

There is no clever fix. The input just has to be 16px or bigger. So it's baked into the component and nobody has to remember it.

**The `/dev/ui` gallery.** One hidden page showing every component in every variant and every state, all at once. Takes an afternoon to build and pays for itself immediately — it's where you notice that the disabled button looks identical to the enabled one, or that focus rings vanish in dark mode. Much easier than hunting for those bugs one screen at a time.

**Why the checklist ends with "does this look AI-generated?"** Because that's the actual failure mode worth guarding against. Not bugs — blandness. If a component could have come from any of ten thousand identical templates, it fails, even if every other box is ticked.
