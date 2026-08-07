import { ChevronRight, Library, UserRound } from 'lucide-react'
import Link from 'next/link'
import { EmptyState } from '@/components/ui/EmptyState'
import { ListRow } from '@/components/ui/ListRow'
import { Rule } from '@/components/ui/Rule'
import { Text } from '@/components/ui/Text'

export const metadata = { title: 'More · Coachienta' }

export default function Page() {
  return (
    <main className="mx-auto flex w-full max-w-lg flex-col gap-6 px-4 pt-6 pb-8">
      <Text as="h1" variant="title">More</Text>

      <div className="flex flex-col">
        <Rule />
        <Link href="/profile">
          <ListRow
            leading={<UserRound size={18} strokeWidth={1.5} aria-hidden className="text-ink-3" />}
            title="Profile & goals"
            subtitle="Weigh-ins, trends, phase, targets, coach rules"
            /* A trailing glyph occupies a 44 px column, so it centres where the
               delete button's icon centres in the session list below — a bare
               chevron sits flush right and lands 14 px off it. */
            trailing={
              <span className="grid size-11 place-items-center">
                <ChevronRight size={16} strokeWidth={2} aria-hidden className="text-ink-3" />
              </span>
            }
          />
        </Link>
        <Link href="/food/library">
          <ListRow
            leading={<Library size={18} strokeWidth={1.5} aria-hidden className="text-ink-3" />}
            title="Food library"
            subtitle="Correct macros, clear unused foods, merge duplicates"
            /* A trailing glyph occupies a 44 px column, so it centres where the
               delete button's icon centres in the session list below — a bare
               chevron sits flush right and lands 14 px off it. */
            trailing={
              <span className="grid size-11 place-items-center">
                <ChevronRight size={16} strokeWidth={2} aria-hidden className="text-ink-3" />
              </span>
            }
          />
        </Link>
      </div>

      <EmptyState
        title="STILL TO COME"
        body="Editing targets and phases, the rule editor, and the workout side of the app."
      />
    </main>
  )
}
