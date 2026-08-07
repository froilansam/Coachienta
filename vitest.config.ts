import { defineConfig } from 'vitest/config'
import { fileURLToPath } from 'node:url'

export default defineConfig({
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('.', import.meta.url)),
      // `server-only` throws on import outside a React Server Component, which
      // would make every lib/{db,ai,nutrition} module untestable. Stubbed here;
      // the real guard still applies to the app build.
      'server-only': fileURLToPath(new URL('./test/server-only-stub.ts', import.meta.url)),
    },
  },
  test: {
    environment: 'node',
    // Only the pure modules. Anything touching the network or DB is Playwright's job.
    include: ['lib/**/*.test.ts'],
  },
})
