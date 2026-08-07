import withSerwistInit from '@serwist/next'
import type { NextConfig } from 'next'
import { PHASE_PRODUCTION_BUILD } from 'next/constants'

const nextConfig: NextConfig = {
  typedRoutes: true,
}

/**
 * Serwist is applied ONLY for the production build.
 *
 * `withSerwistInit` injects a `webpack` function into the config even when its
 * own `disable: true` is set (verified). Next 16 defaults to Turbopack, which
 * refuses to start when it finds a webpack config and no turbopack config — so
 * `next dev` failed outright.
 *
 * Gating on the build phase gives dev a clean Turbopack config (no service
 * worker is wanted there anyway) while the production build still gets the SW.
 * That production phase is also why `build` carries `--webpack`: it is the only
 * phase where Serwist's webpack config is real and must be honoured.
 */
export default function config(phase: string): NextConfig {
  if (phase !== PHASE_PRODUCTION_BUILD) return nextConfig

  return withSerwistInit({
    swSrc: 'app/sw.ts',
    swDest: 'public/sw.js',
  })(nextConfig)
}
