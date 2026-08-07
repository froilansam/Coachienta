import { loadEnvConfig } from '@next/env'
import { defineConfig } from '@playwright/test'

// Same loader Next uses, so the tests read exactly the .env.local the app does.
// Without this, `connect()` and `APP_ACCESS_TOKEN` are undefined unless the shell
// happens to have exported them.
loadEnvConfig(process.cwd())

const PORT = 3230
const BASE = `http://127.0.0.1:${PORT}`

export default defineConfig({
  testDir: 'e2e',
  timeout: 60_000,
  // Serial: these tests assert on shared database rows.
  workers: 1,
  use: { baseURL: BASE, trace: 'retain-on-failure' },
  webServer: {
    // Production build — the offline path depends on the service worker and the
    // real proxy, neither of which behaves identically in dev.
    command: `npx next start -p ${PORT}`,
    url: `${BASE}/unlock`,
    reuseExistingServer: false,
    timeout: 60_000,
  },
})
