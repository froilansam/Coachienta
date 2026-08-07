/**
 * The physique priority order: what you want to grow, ranked.
 *
 * It is not decoration. `priority_volume_share()` compares this order against
 * where the volume actually went, and PRD-004's adherence chart reads the same
 * rows — so it turns a stated intention into a measurable one (AC-4.14). Ranking
 * shoulders first and then training chest twice as hard is exactly the
 * contradiction the spreadsheet could not see.
 *
 * Pure. Reordering happens here; persisting is one RPC that replaces the list.
 */

/** Every group the exercise library can attribute volume to. */
export const MUSCLE_GROUPS = [
  'shoulders_side',
  'shoulders_rear',
  'shoulders_front',
  'back_lats',
  'back_mid',
  'chest',
  'biceps',
  'triceps',
  'quads',
  'hamstrings',
  'glutes',
  'calves',
  'abs_core',
  'forearms',
  'other',
] as const
export type MuscleGroup = (typeof MUSCLE_GROUPS)[number]

/** Shared by the priority list, the editor, and any future volume chart. */
export const MUSCLE_LABEL: Record<string, string> = {
  shoulders_side: 'Shoulders (side)',
  shoulders_rear: 'Shoulders (rear)',
  shoulders_front: 'Shoulders (front)',
  back_lats: 'Back / lats',
  back_mid: 'Back (mid)',
  chest: 'Chest',
  biceps: 'Biceps',
  triceps: 'Triceps',
  quads: 'Quads',
  hamstrings: 'Hamstrings',
  glutes: 'Glutes',
  calves: 'Calves',
  abs_core: 'Abs / core',
  forearms: 'Forearms',
  other: 'Other',
}

export const labelOf = (mg: string): string => MUSCLE_LABEL[mg] ?? mg.replace(/_/g, ' ')

export interface PriorityItem {
  muscle_group: string
  note: string | null
}

/**
 * Moves one entry by `delta`, clamped at both ends.
 *
 * Up/down buttons rather than drag-and-drop: this is a five-item list edited maybe
 * twice a year, and buttons work with one thumb, with a keyboard, and with a
 * screen reader without any of the drag affordances needing to be reinvented.
 */
export function move(items: readonly PriorityItem[], index: number, delta: number): PriorityItem[] {
  const to = index + delta
  if (index < 0 || index >= items.length || to < 0 || to >= items.length) return [...items]
  const next = [...items]
  const [moved] = next.splice(index, 1)
  next.splice(to, 0, moved!)
  return next
}

/** Appending, not inserting: a new priority is the least important until moved. */
export function add(items: readonly PriorityItem[], muscle_group: string): PriorityItem[] {
  if (items.some((i) => i.muscle_group === muscle_group)) return [...items]
  return [...items, { muscle_group, note: null }]
}

/** The list may not be emptied — the RPC refuses it, so the UI should too. */
export function remove(items: readonly PriorityItem[], index: number): PriorityItem[] {
  if (items.length <= 1) return [...items]
  return items.filter((_, i) => i !== index)
}

export function setNote(
  items: readonly PriorityItem[],
  index: number,
  note: string,
): PriorityItem[] {
  return items.map((i, n) => (n === index ? { ...i, note: note.trim() === '' ? null : note } : i))
}

/** Groups still available to add. */
export const remaining = (items: readonly PriorityItem[]): MuscleGroup[] =>
  MUSCLE_GROUPS.filter((g) => !items.some((i) => i.muscle_group === g))

/** No duplicates, at least one entry — the same rules the RPC enforces. */
export function validate(items: readonly PriorityItem[]): string | null {
  if (items.length === 0) return 'Keep at least one priority.'
  const groups = items.map((i) => i.muscle_group)
  if (new Set(groups).size !== groups.length) return 'A muscle group can appear only once.'
  return null
}

/** True when the order or the notes differ from what is stored. */
export function isChanged(a: readonly PriorityItem[], b: readonly PriorityItem[]): boolean {
  if (a.length !== b.length) return true
  return a.some((x, i) => x.muscle_group !== b[i]!.muscle_group || (x.note ?? '') !== (b[i]!.note ?? ''))
}
