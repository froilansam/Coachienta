'use client'
import * as RT from '@radix-ui/react-tooltip'
import type { ReactNode } from 'react'

/**
 * Desktop only — a tooltip has no hover on touch, so it must NEVER be the sole
 * carrier of information. On mobile surfaces use Field `hint` text instead
 * (PRD-007 §3.17).
 */
export function Tooltip({ content, children }: { content: string; children: ReactNode }) {
  return (
    <RT.Provider delayDuration={400}>
      <RT.Root>
        <RT.Trigger asChild>{children}</RT.Trigger>
        <RT.Portal>
          <RT.Content
            sideOffset={6}
            className="z-60 max-w-56 rounded-md border border-rule-strong bg-surface px-2 py-1.5 text-sm text-ink shadow-pop"
          >
            {content}
            <RT.Arrow className="fill-surface" />
          </RT.Content>
        </RT.Portal>
      </RT.Root>
    </RT.Provider>
  )
}
