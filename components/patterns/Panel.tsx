import type { ReactNode } from 'react'
import { Rule } from '@/components/ui/Rule'
import { Text } from '@/components/ui/Text'

/**
 * A titled block: label, an optional control on the same line, a caption, a rule,
 * then the content.
 *
 * Rule-separated rather than a Card, because six charts in six cards is the uniform
 * grid of identical tiles PRD-007 §4 names as the fingerprint of generated design.
 * The caption is not decoration — every chart on the trends screen has to say what
 * it counts, or a number invites the wrong conclusion (§3.1, the ab-machine problem).
 */
export function Panel({
  title,
  caption,
  control,
  footer,
  children,
}: {
  title: string
  caption?: string
  control?: ReactNode
  footer?: ReactNode
  children: ReactNode
}) {
  return (
    <section className="flex flex-col gap-2">
      <div className="flex items-baseline justify-between gap-3">
        <Text as="h2" variant="label">
          {title}
        </Text>
        {control}
      </div>
      {caption ? (
        <Text variant="micro" tone="tertiary" className="max-w-[52ch]">
          {caption}
        </Text>
      ) : null}
      <Rule />
      <div className="flex flex-col gap-3">{children}</div>
      {footer}
    </section>
  )
}
