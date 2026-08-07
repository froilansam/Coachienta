'use client'
import * as RT from '@radix-ui/react-toast'
import { X } from 'lucide-react'
import { createContext, useCallback, useContext, useState, type ReactNode } from 'react'
import { cn } from '@/lib/cn'
import { Text } from './Text'

export interface ToastPayload {
  message: string
  tone?: 'neutral' | 'pos' | 'neg'
  /** An undo affordance costs nothing and removes the need for a confirm dialog. */
  action?: { label: string; onAction: () => void }
}

const ToastCtx = createContext<(t: ToastPayload) => void>(() => {})

/** `useToast()(...)` from anywhere under ToastProvider. */
export const useToast = () => useContext(ToastCtx)

const TONE = {
  neutral: 'border-rule-strong bg-surface text-ink',
  pos: 'border-pos bg-pos-wash text-pos',
  neg: 'border-neg bg-neg-wash text-neg',
} as const

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<Array<ToastPayload & { id: number }>>([])

  const push = useCallback((t: ToastPayload) => {
    setItems((prev) => [...prev, { ...t, id: Date.now() + Math.random() }])
  }, [])

  return (
    <ToastCtx.Provider value={push}>
      <RT.Provider swipeDirection="down" duration={4000}>
        {children}
        {items.map((t) => (
          <RT.Root
            key={t.id}
            onOpenChange={(open) => !open && setItems((p) => p.filter((x) => x.id !== t.id))}
            className={cn(
              // pointer-events-auto: the viewport itself is inert (see below),
              // so each toast has to opt back in.
              'pointer-events-auto flex items-center gap-3 rounded-md border px-3 py-2.5 shadow-pop',
              'animate-fade-in data-[state=closed]:opacity-0',
              TONE[t.tone ?? 'neutral'],
            )}
          >
            <RT.Description asChild>
              <Text variant="meta" tone="primary" className="flex-1">
                {t.message}
              </Text>
            </RT.Description>

            {t.action ? (
              <RT.Action altText={t.action.label} asChild>
                <button
                  type="button"
                  onClick={t.action.onAction}
                  className="shrink-0 text-sm font-semibold text-accent-ink underline-offset-2 hover:underline"
                >
                  {t.action.label}
                </button>
              </RT.Action>
            ) : null}

            <RT.Close aria-label="Dismiss" className="shrink-0 text-ink-3 hover:text-ink">
              <X size={16} strokeWidth={2} aria-hidden />
            </RT.Close>
          </RT.Root>
        ))}

        {/*
          Sits ABOVE the tab bar and is `pointer-events-none`.
          Verified bug: a full-width viewport pinned to bottom-0 covered the tab
          bar, so for the 4 s a toast was alive navigation was unclickable —
          `elementFromPoint` on the Train link returned the toast's own <ol>.
        */}
        <RT.Viewport
          className="pointer-events-none fixed inset-x-0 z-50 flex flex-col gap-2 px-4"
          style={{ bottom: 'calc(var(--tabbar-h) + env(safe-area-inset-bottom) + 0.5rem)' }}
        />
      </RT.Provider>
    </ToastCtx.Provider>
  )
}
