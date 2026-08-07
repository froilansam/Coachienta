'use client'
import { Dumbbell, LayoutGrid, MessageSquare, Sun } from 'lucide-react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { Text } from '@/components/ui/Text'
import { cn } from '@/lib/cn'

/**
 * Four places. Food logging is deliberately NOT here — it is an action, reached
 * as a sheet from Today, not a destination (PRD-002 §7).
 *
 * Pinned above the iOS home indicator via the safe-area inset.
 */
const TABS = [
  { href: '/today', label: 'Today', icon: Sun },
  { href: '/train', label: 'Train', icon: Dumbbell },
  { href: '/coach', label: 'Coach', icon: MessageSquare },
  { href: '/more', label: 'More', icon: LayoutGrid },
] as const

export function TabBar() {
  const pathname = usePathname()

  return (
    <nav
      aria-label="Main"
      className="sticky bottom-0 z-20 border-t border-rule bg-surface/95 pb-safe backdrop-blur-sm"
    >
      <ul className="mx-auto flex max-w-lg">
        {TABS.map(({ href, label, icon: Icon }) => {
          const active = pathname === href || pathname.startsWith(`${href}/`)
          return (
            <li key={href} className="flex-1">
              <Link
                href={href}
                aria-current={active ? 'page' : undefined}
                className={cn(
                  'flex min-h-11 flex-col items-center gap-0.5 py-2 transition-colors',
                  active ? 'text-accent-ink' : 'text-ink-3 hover:text-ink-2',
                )}
              >
                <Icon size={20} strokeWidth={active ? 2 : 1.5} aria-hidden />
                <Text variant="label" tone={active ? 'accent' : 'tertiary'}>
                  {label}
                </Text>
              </Link>
            </li>
          )
        })}
      </ul>
    </nav>
  )
}
