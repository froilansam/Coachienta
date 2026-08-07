'use client'
import { Search, X } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { cn } from '@/lib/cn'

/**
 * Debounced, and never auto-submits.
 *
 * The debounce is not cosmetic: Open Food Facts allows 10 searches/minute and
 * explicitly warns against search-as-you-type. Local library matching is
 * instant, so only the external fallback pays the delay (PRD-003 §3.1a).
 */
export interface SearchFieldProps {
  value: string
  onChange: (v: string) => void
  /** Fires after `debounceMs` of quiet. Use this for anything that costs money. */
  onSearch?: (v: string) => void
  placeholder?: string
  debounceMs?: number
  autoFocus?: boolean
  label: string
}

export function SearchField({
  value,
  onChange,
  onSearch,
  placeholder = 'Search',
  debounceMs = 350,
  autoFocus,
  label,
}: SearchFieldProps) {
  const ref = useRef<HTMLInputElement>(null)
  const [focused, setFocused] = useState(false)

  useEffect(() => {
    if (!onSearch) return
    const t = setTimeout(() => onSearch(value.trim()), debounceMs)
    return () => clearTimeout(t)
  }, [value, debounceMs, onSearch])

  return (
    <div
      className={cn(
        'flex h-11 items-center gap-2 rounded-md border bg-surface px-3 transition-colors',
        focused ? 'border-accent' : 'border-rule',
      )}
    >
      <Search size={18} strokeWidth={1.5} aria-hidden className="shrink-0 text-ink-3" />
      <input
        ref={ref}
        type="search"
        // enterKeyHint keeps the iOS keyboard's action button honest.
        enterKeyHint="search"
        autoComplete="off"
        aria-label={label}
        autoFocus={autoFocus}
        value={value}
        placeholder={placeholder}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        onChange={(e) => onChange(e.target.value)}
        className="min-w-0 flex-1 bg-transparent text-base text-ink outline-none placeholder:text-ink-3 [&::-webkit-search-cancel-button]:hidden"
      />
      {value ? (
        <button
          type="button"
          aria-label="Clear search"
          onClick={() => {
            onChange('')
            ref.current?.focus()
          }}
          className="grid size-7 shrink-0 place-items-center rounded-sm text-ink-3 hover:bg-sunk hover:text-ink"
        >
          <X size={16} strokeWidth={2} aria-hidden />
        </button>
      ) : null}
    </div>
  )
}
