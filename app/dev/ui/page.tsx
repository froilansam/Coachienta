import { Gallery } from './Gallery'

export const metadata = { title: 'UI Gallery · Coachienta' }

/**
 * Every primitive in every variant and state, on one page.
 *
 * Costs an afternoon and pays for itself immediately — it's where you notice the
 * disabled button looks identical to the enabled one, or that a focus ring
 * vanishes in dark mode. Much easier than hunting screen by screen (PRD-007 §8).
 */
export default function DevUiPage() {
  return <Gallery />
}
