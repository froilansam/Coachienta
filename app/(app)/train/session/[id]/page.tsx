import { SessionScreen } from '@/components/train/SessionScreen'

export const metadata = { title: 'Session · Coachienta' }

/**
 * The live session. Client-rendered on purpose: it must keep working when the
 * network does not, reading its queued sets straight out of IndexedDB.
 */
export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  return <SessionScreen sessionId={id} />
}
