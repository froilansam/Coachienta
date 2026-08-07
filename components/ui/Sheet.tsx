'use client'
import * as Dialog from '@radix-ui/react-dialog'
import { X } from 'lucide-react'
import type { ReactNode } from 'react'
import { cn } from '@/lib/cn'
import { Text } from './Text'

/**
 * The primary input surface on mobile — not modals, not new pages.
 *
 * A thumb reaches the bottom third of a phone held one-handed. Input slides up
 * from there, and it does not cover the whole screen, so you keep your place
 * (PRD-002 §4).
 *
 * Radix Dialog underneath: focus trap, scroll lock, Escape, `aria-modal` and
 * focus restoration are all solved problems and hand-rolled versions get them
 * wrong (PRD-007 §2).
 */
export interface SheetProps {
  open: boolean
  onOpenChange: (v: boolean) => void
  title: string
  /** Editable date / time / meal chips. Ultrahuman + BitePal put these in the
   *  header so retroactive logging is one tap, not a separate screen. */
  headerSlot?: ReactNode
  /** Sticky action area. Gets the safe-area inset. */
  footer?: ReactNode
  size?: 'auto' | 'half' | 'full'
  /** false while a write is in flight — blocks Escape and outside-click too. */
  dismissible?: boolean
  children: ReactNode
}

const SIZE = {
  auto: 'max-h-[85dvh]',
  half: 'h-[55dvh]',
  full: 'h-[92dvh]',
} as const

export function Sheet({
  open,
  onOpenChange,
  title,
  headerSlot,
  footer,
  size = 'auto',
  dismissible = true,
  children,
}: SheetProps) {
  return (
    <Dialog.Root open={open} onOpenChange={dismissible ? onOpenChange : undefined}>
      <Dialog.Portal>
        <Dialog.Overlay
          className="fixed inset-0 z-30 bg-ink/30 animate-fade-in"
          style={{ backdropFilter: 'blur(1px)' }}
        />
        <Dialog.Content
          onEscapeKeyDown={(e) => !dismissible && e.preventDefault()}
          onPointerDownOutside={(e) => !dismissible && e.preventDefault()}
          // 100dvh, never vh — iOS Safari's collapsing toolbar makes vh wrong.
          className={cn(
            'fixed inset-x-0 bottom-0 z-40 flex flex-col',
            'rounded-t-lg border-t border-rule-strong bg-bg shadow-sheet',
            'animate-sheet-in',
            SIZE[size],
          )}
        >
          {/* Drag affordance. Decorative — Escape and the close button do the work. */}
          <div aria-hidden className="flex shrink-0 justify-center pt-2 pb-1">
            <span className="h-1 w-9 rounded-full bg-rule-strong" />
          </div>

          <header className="flex shrink-0 items-start gap-3 px-4 pb-3">
            <div className="flex min-w-0 flex-1 flex-col gap-2">
              <Dialog.Title asChild>
                <Text as="h2" variant="title">
                  {title}
                </Text>
              </Dialog.Title>
              {headerSlot ? <div className="flex flex-wrap gap-1.5">{headerSlot}</div> : null}
            </div>

            {dismissible ? (
              <Dialog.Close
                aria-label="Close"
                className="-mt-1 -mr-1 grid size-11 shrink-0 place-items-center rounded-md text-ink-2 transition-colors hover:bg-sunk hover:text-ink"
              >
                <X size={20} strokeWidth={1.5} aria-hidden />
              </Dialog.Close>
            ) : null}
          </header>

          <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4">{children}</div>

          {footer ? (
            <footer className="shrink-0 border-t border-rule bg-surface px-4 pt-3 pb-safe">
              {footer}
            </footer>
          ) : null}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}
