'use client'
import { ChevronRight, FileText, Plus } from 'lucide-react'
import { Button, IconButton } from '@/components/ui/Button'
import { Chip } from '@/components/ui/Chip'
import { Rule } from '@/components/ui/Rule'
import { Text } from '@/components/ui/Text'
import type { ProfilePayload } from '@/app/api/data/profile/route'
import { labelOf } from '@/lib/domain/coach/priorities'

/**
 * The read-only half of the profile: phase, targets, priority order, rules.
 *
 * Read-only in this pass on purpose. Editing any of these is effective-dated
 * superseding with its own guards — a calorie floor that hard-blocks, a
 * macro-versus-calorie check — and shipping a half-guarded editor over the numbers
 * the coach will cite is worse than shipping none (PRD-006 §3.3, §3.7).
 *
 * Every value here is already stored and already drives the Today screen, so
 * showing it is the point: these were the numbers that lived in six contradicting
 * spreadsheet tabs.
 */

/**
 * A section, whose whole header is the edit control when there is one thing to
 * edit.
 *
 * The first version put a `text-2xs` link in the header corner. It was about
 * 14×30px — below the **44×44 minimum PRD-002 mandates**, and on a phone
 * effectively undiscoverable: the controls existed and could not be found or hit.
 * A tappable header row with a chevron is the idiom already used on More and in
 * the food library, and it is 44px by construction.
 */
function Section({
  title,
  meta,
  onEdit,
  editLabel,
  action,
  children,
}: {
  title: string
  meta?: string
  onEdit?: () => void
  /** Announced to a screen reader — "PRIORITY ORDER" alone is not an action. */
  editLabel?: string
  action?: React.ReactNode
  children: React.ReactNode
}) {
  const header = (
    <>
      <Text variant="label">{title}</Text>
      <span className="flex items-center gap-2">
        {meta ? <Text variant="micro">{meta}</Text> : null}
        {action}
        {onEdit ? <ChevronRight size={16} strokeWidth={2} aria-hidden className="text-accent" /> : null}
      </span>
    </>
  )

  return (
    <section className="flex flex-col gap-1">
      {onEdit ? (
        <button
          type="button"
          onClick={onEdit}
          aria-label={editLabel ?? title}
          className="-mx-2 flex min-h-11 items-center justify-between gap-3 rounded-md px-2 text-left hover:bg-sunk"
        >
          {header}
        </button>
      ) : (
        <div className="flex min-h-11 items-center justify-between gap-3">{header}</div>
      )}
      <Rule />
      {children}
    </section>
  )
}

/** `2,300–2,400` or `2,350` — a range only when the two ends differ. */
function range(low: number | null, high: number | null, unit: string): string {
  if (low === null && high === null) return '—'
  if (low === null) return `≤ ${high} ${unit}`
  if (high === null || low === high) return `${low} ${unit}`
  return `${low}–${high} ${unit}`
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3 py-1">
      <Text variant="micro">{label}</Text>
      <span className="tabular font-mono text-sm text-ink">{value}</span>
    </div>
  )
}

export function PhaseCard({
  phase,
  onChange,
}: {
  phase: ProfilePayload['phase']
  onChange: () => void
}) {
  if (!phase) {
    return (
      <Section title="ACTIVE PHASE" onEdit={onChange} editLabel="Set training phase">
        <Text variant="micro">No phase set. The coach has nothing to aim at.</Text>
      </Section>
    )
  }
  return (
    <Section
      title="ACTIVE PHASE"
      meta={`from ${phase.effective_from}`}
      onEdit={onChange}
      editLabel="Change training phase"
    >
      <Text variant="body">{phase.label}</Text>
      <div className="flex flex-col">
        {phase.target_weight_kg !== null ? (
          <Row label="Target weight" value={`${phase.target_weight_kg} kg`} />
        ) : null}
        {phase.target_rate_kg_per_week !== null ? (
          <Row
            label="Target rate"
            value={`${phase.target_rate_kg_per_week > 0 ? '+' : ''}${phase.target_rate_kg_per_week} kg/wk`}
          />
        ) : null}
        {phase.bf_ceiling_pct !== null ? (
          <Row label="Body-fat ceiling" value={`${phase.bf_ceiling_pct} %`} />
        ) : null}
      </div>
      {phase.notes ? <Text variant="micro">{phase.notes}</Text> : null}
    </Section>
  )
}

export function TargetsCard({
  targets,
  onChange,
}: {
  targets: ProfilePayload['targets']
  onChange: () => void
}) {
  if (!targets) {
    return (
      <Section title="ACTIVE TARGETS" onEdit={onChange} editLabel="Set nutrition targets">
        <Text variant="micro">No active target. Today has nothing to measure against.</Text>
      </Section>
    )
  }
  const sameKcal =
    targets.kcal_gym_low === targets.kcal_rest_low && targets.kcal_gym_high === targets.kcal_rest_high

  return (
    <Section
      title="ACTIVE TARGETS"
      meta={`from ${targets.effective_from}`}
      onEdit={onChange}
      editLabel="Change nutrition targets"
    >
      <div className="flex flex-col">
        {sameKcal ? (
          <Row
            label="Calories · gym and rest"
            value={range(targets.kcal_gym_low, targets.kcal_gym_high, 'kcal')}
          />
        ) : (
          <>
            <Row label="Calories · gym" value={range(targets.kcal_gym_low, targets.kcal_gym_high, 'kcal')} />
            <Row label="Calories · rest" value={range(targets.kcal_rest_low, targets.kcal_rest_high, 'kcal')} />
          </>
        )}
        <Row label="Protein" value={`${targets.protein_g} g`} />
        <Row label="Carbs · gym" value={range(targets.carbs_gym_low, targets.carbs_gym_high, 'g')} />
        <Row label="Carbs · rest" value={range(targets.carbs_rest_low, targets.carbs_rest_high, 'g')} />
        <Row label="Fat" value={range(targets.fat_low, targets.fat_high, 'g')} />
      </div>
      {targets.kcal_floor !== null ? (
        <Text variant="micro">
          {`Hard floor ${targets.kcal_floor} kcal — a safety rule, not a preference.`}
        </Text>
      ) : null}
    </Section>
  )
}

export function PrioritiesCard({
  priorities,
  onEdit,
}: {
  priorities: ProfilePayload['priorities']
  onEdit: () => void
}) {
  if (priorities.length === 0) {
    return (
      <Section title="PRIORITY ORDER" onEdit={onEdit} editLabel="Set priority order">
        <Text variant="micro">No priority order set.</Text>
      </Section>
    )
  }
  return (
    <Section
      title="PRIORITY ORDER"
      meta="drives volume adherence"
      onEdit={onEdit}
      editLabel="Reorder priorities"
    >
      <ol className="flex flex-col">
        {priorities.map((p) => (
          <li key={p.rank} className="flex items-baseline gap-2 py-1">
            <span className="tabular w-4 shrink-0 font-mono text-2xs text-ink-3">{p.rank}</span>
            <span className="flex min-w-0 flex-1 flex-col">
              <Text variant="body">{labelOf(p.muscle_group)}</Text>
              {p.note ? <Text variant="micro">{p.note}</Text> : null}
            </span>
          </li>
        ))}
      </ol>
    </Section>
  )
}

export interface EditableRule {
  id: string
  category: string
  title: string
  content: string
  priority: number
  is_critical: boolean
}

export function RulesCard({
  rules,
  retiredCount,
  onEdit,
  onAdd,
  onPreview,
}: {
  rules: readonly EditableRule[]
  retiredCount: number
  onEdit: (rule: EditableRule) => void
  onAdd: () => void
  onPreview: () => void
}) {
  const categories = Array.from(new Set(rules.map((r) => r.category)))
  // Categories with a critical rule lead — the same precedence the prompt uses.
  categories.sort((a, b) => {
    const crit = (c: string) => (rules.some((r) => r.category === c && r.is_critical) ? 0 : 1)
    return crit(a) - crit(b) || a.localeCompare(b)
  })
  const groups = categories.map((category) => ({
    category,
    rules: rules.filter((r) => r.category === category),
  }))

  return (
    <Section
      title="COACH RULES"
      meta={`${rules.length} active${retiredCount > 0 ? ` · ${retiredCount} retired` : ''}`}
      /* Two actions, so the header cannot be one control. `+ Rule` is an icon
         button at 44px; the prompt preview earns a full-width button below, being
         the one thing on this screen you read rather than edit. */
      action={<IconButton icon={Plus} label="Add a coach rule" variant="ghost" onClick={onAdd} />}
    >
      {groups.length === 0 ? (
        <Text variant="micro">No rules recorded.</Text>
      ) : (
        /* `gap-6` is PRD-002's "between groups inside a section". It was `gap-3`,
           which put 12 px between categories while the 44 px rule rows inside them sat
           further apart than that — the inverse of "more space around a group than
           within it", and it made eleven categories read as one flat list. */
        <div className="flex flex-col gap-6">
          {groups.map((g) => (
            <div key={g.category} className="flex flex-col gap-1">
              <div className="flex items-center gap-2">
                <Text variant="label">{g.category.replace(/_/g, ' ')}</Text>
                {/* Critical rules are the ones the plan builder must enforce, not
                    merely mention (AC-4.8) — so they are marked here too. */}
                {g.rules.some((r) => r.is_critical) ? (
                  <Chip label="CRITICAL" tone="warn" size="sm" />
                ) : null}
              </div>
              <ul className="flex flex-col">
                {g.rules.map((r) => (
                  <li key={r.id}>
                    {/* The whole row opens the replacement editor: a rule is read
                        far more often than changed, so the affordance stays quiet
                        until you reach for it. */}
                    <button
                      type="button"
                      onClick={() => onEdit(r)}
                      aria-label={`Replace rule: ${r.title}`}
                      className="-mx-2 flex min-h-11 w-full items-center gap-2 rounded-sm px-2 text-left hover:bg-sunk"
                    >
                      <span className="text-ink-3" aria-hidden>
                        ·
                      </span>
                      <Text variant="micro">{r.title}</Text>
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      )}

      <div className="pt-2">
        <Button variant="secondary" fullWidth iconStart={FileText} onClick={onPreview}>
          PREVIEW COACH PROMPT
        </Button>
      </div>
    </Section>
  )
}
