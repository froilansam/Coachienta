import { defaultCache } from '@serwist/next/worker'
import type { PrecacheEntry, SerwistGlobalConfig } from 'serwist'
import { NetworkFirst, Serwist } from 'serwist'

declare global {
  interface WorkerGlobalScope extends SerwistGlobalConfig {
    __SW_MANIFEST: (PrecacheEntry | string)[] | undefined
  }
}
declare const self: ServiceWorkerGlobalScope

new Serwist({
  precacheEntries: self.__SW_MANIFEST,
  skipWaiting: true,
  clientsClaim: true,
  // Off: it races the document handler below and forces a network attempt that
  // cannot succeed offline.
  navigationPreload: false,
  runtimeCaching: [
    /**
     * Documents: network first, fall back to the last good copy.
     *
     * `__SW_MANIFEST` only carries `_next/static/*` — App Router HTML is never
     * precached, so a reload with no network died with ERR_FAILED (caught by the
     * offline E2E test). Caching the document at runtime restores the ACTUAL
     * page you were on, which beats a generic offline stub.
     */
    {
      // `mode === 'navigate'` is the canonical navigation test. `destination ===
      // 'document'` looked equivalent but never matched — verified: the pages
      // cache was never created.
      matcher: ({ request }) => request.mode === 'navigate',
      handler: new NetworkFirst({
        cacheName: 'pages',
        networkTimeoutSeconds: 3,
        plugins: [{ cacheWillUpdate: async ({ response }) => (response.ok ? response : null) }],
      }),
    },
    ...defaultCache,
  ],
}).addEventListeners()
