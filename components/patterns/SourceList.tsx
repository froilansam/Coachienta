'use client'
import { ChevronRight, ExternalLink } from 'lucide-react'
import { useState } from 'react'
import { Text } from '@/components/ui/Text'
import { cn } from '@/lib/cn'

/**
 * `▸ 2 SOURCES` — collapsed by default, opens to checkable links.
 *
 * Collapsed because provenance is a question you ask *sometimes*: every day you
 * want the number, and once a month you want to know where it came from. Showing
 * the URLs inline would spend permanent space on an occasional need and bury the
 * macros under citation chrome.
 *
 * But it is always *present*, even when there is nothing to link to — a row whose
 * only source is "you typed it" should say so rather than look identical to one
 * backed by USDA. That distinction is the whole point of AC-1.3.
 *
 * Tier 1: no domain knowledge. It takes labels and hrefs.
 */
export interface Source {
  ref: string
  url: string | null
  detail: string | null
}

export function SourceList({ sources, emptyLabel }: { sources: readonly Source[]; emptyLabel: string }) {
  const [open, setOpen] = useState(false)

  if (sources.length === 0) {
    return <Text variant="micro">{emptyLabel}</Text>
  }

  const linked = sources.filter((s) => s.url !== null).length

  return (
    <div className="flex flex-col gap-1.5">
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        className="flex items-center gap-1 self-start text-ink-3 hover:text-ink-2"
      >
        <ChevronRight
          size={12}
          strokeWidth={2.5}
          aria-hidden
          className={cn('transition-transform', open && 'rotate-90')}
        />
        <Text variant="label">
          {`${sources.length} SOURCE${sources.length === 1 ? '' : 'S'}`}
        </Text>
        {/* Says whether any of them can actually be opened, before you tap. */}
        {linked === 0 ? <Text variant="micro">(no links)</Text> : null}
      </button>

      {open ? (
        <ul className="flex flex-col gap-1 pl-4">
          {sources.map((s) => (
            <li key={`${s.ref}-${s.url ?? ''}`}>
              {s.url ? (
                <a
                  href={s.url}
                  target="_blank"
                  rel="noreferrer noopener"
                  className="inline-flex items-baseline gap-1 text-accent underline decoration-rule underline-offset-2"
                >
                  <Text variant="micro">{s.detail ? `${s.ref} · ${s.detail}` : s.ref}</Text>
                  <ExternalLink size={10} strokeWidth={2} aria-hidden className="translate-y-px" />
                </a>
              ) : (
                <Text variant="micro">{s.detail ? `${s.ref} · ${s.detail}` : s.ref}</Text>
              )}
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  )
}
