'use client'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { useEffect, useState, type ReactNode } from 'react'
import { ToastProvider } from '@/components/ui/Toast'
import { requestPersistence } from '@/lib/offline/db'
import { startSync } from '@/lib/offline/sync'

/** Single client-side root: server cache + offline sync lifecycle. */
export function AppProviders({ children }: { children: ReactNode }) {
  const [qc] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: { staleTime: 30_000, retry: 1, refetchOnWindowFocus: true },
        },
      }),
  )

  useEffect(() => {
    void requestPersistence()
    return startSync()
  }, [])

  return (
    <QueryClientProvider client={qc}>
      <ToastProvider>{children}</ToastProvider>
    </QueryClientProvider>
  )
}
