'use client'
import { CalendarPlus, ChevronRight, Dumbbell, LineChart } from 'lucide-react'
import Link from 'next/link'
import { ConfirmSheet } from '@/components/patterns/ConfirmSheet'
import { Button } from '@/components/ui/Button'
import { EmptyState } from '@/components/ui/EmptyState'
import { ListRow } from '@/components/ui/ListRow'
import { Rule } from '@/components/ui/Rule'
import { SkeletonList } from '@/components/ui/Skeleton'
import { Text } from '@/components/ui/Text'
import { useSessions } from '@/hooks/useSessions'
import { SessionList } from './SessionList'

/**
 * Train home. One hook call, then JSX.
 *
 * Three destinations, then history — because the answer to "what did I do on
 * Tuesday?" used to mean scrolling a spreadsheet tab, and it is the reason a session
 * list exists at all (US-2.16).
 */
const LINKS = [
  {
    href: '/train/plan',
    icon: CalendarPlus,
    title: 'New session',
    subtitle: 'Template or empty, with last and best per exercise',
  },
  {
    href: '/trends',
    icon: LineChart,
    title: 'Trends',
    subtitle: 'Volume, strength, records, and whether you trained what you ranked',
  },
  {
    href: '/train/exercises',
    icon: Dumbbell,
    title: 'Exercises',
    subtitle: 'Browse, correct and add movements',
  },
] as const

export function TrainScreen() {
  const vm = useSessions()

  return (
    <main className="mx-auto flex w-full max-w-lg flex-col gap-6 px-4 pt-6 pb-8">
      <Text as="h1" variant="title">
        Train
      </Text>

      <div className="flex flex-col">
        <Rule />
        {LINKS.map(({ href, icon: Icon, title, subtitle }) => (
          <Link key={href} href={href}>
            <ListRow
              leading={<Icon size={18} strokeWidth={1.5} aria-hidden className="text-ink-3" />}
              title={title}
              subtitle={subtitle}
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
        ))}
      </div>

      {vm.loadError ? (
        <EmptyState
          title="CANNOT REACH THE SERVER"
          body="Your session history could not be loaded. Anything you logged offline is still safe on this device."
          action={
            <Button variant="secondary" onClick={vm.retry}>
              TRY AGAIN
            </Button>
          }
        />
      ) : vm.isLoading ? (
        <SkeletonList rows={5} />
      ) : vm.isEmpty ? (
        <EmptyState
          title="NO SESSIONS YET"
          body="Start one above. Every session you log stays here, grouped by the day it happened."
        />
      ) : (
        <SessionList groups={vm.groups} onDelete={vm.askDelete} />
      )}

      <ConfirmSheet
        open={vm.pendingDelete !== null}
        title="Delete session"
        body={vm.confirmText}
        confirmLabel="DELETE"
        isBusy={vm.isDeleting}
        onCancel={vm.cancelDelete}
        onConfirm={() => void vm.confirmDelete()}
      />
    </main>
  )
}
