import { Rule } from '@/components/ui/Rule'
import { Text } from '@/components/ui/Text'

export const metadata = { title: 'Offline · Coachienta' }

/**
 * Navigation fallback, precached by the service worker (PRD-001 §4.3).
 *
 * Without this, reloading with no network gives the browser's own error page —
 * verified by the Playwright offline test. Anything already queued in IndexedDB
 * is untouched and uploads on the next focus.
 */
export default function OfflinePage() {
  return (
    <main className="mx-auto flex max-w-md flex-col gap-4 px-4 py-16">
      <Text as="h1" variant="title">
        Offline
      </Text>
      <Rule />
      <Text variant="meta">
        No connection right now. Anything you have already logged is saved on this
        device and will upload by itself once you are back online — nothing is lost.
      </Text>
      <Text variant="micro">Pull down to retry, or just reopen the app later.</Text>
    </main>
  )
}
