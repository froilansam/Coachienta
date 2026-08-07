import type { ReactNode } from 'react'
import { Text } from './Text'

/**
 * Empty states teach the interface. "No data" is a dead end; a sentence that
 * says what to do next is the best onboarding you get, because the user is
 * looking right at it and wants to proceed (PRD-002 §9).
 */
export function EmptyState({
  title,
  body,
  action,
}: {
  title: string
  body: string
  action?: ReactNode
}) {
  return (
    <div className="flex flex-col items-center gap-3 px-6 py-12 text-center">
      <Text variant="label">{title}</Text>
      <Text variant="meta" className="max-w-[46ch]">
        {body}
      </Text>
      {action ? <div className="pt-1">{action}</div> : null}
    </div>
  )
}
