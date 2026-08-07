import type { Metadata, Viewport } from 'next'
import { Archivo, IBM_Plex_Mono } from 'next/font/google'
import { AppProviders } from '@/components/providers/AppProviders'
import './globals.css'

/**
 * PRD-002 §3.2. Archivo for UI (strong caps for the small-caps labels);
 * IBM Plex Mono for every numeral — functional, not decorative: tabular figures
 * are what make vertical numeric columns scannable.
 *
 * next/font downloads and self-hosts these at build time, so there is no
 * runtime request to Google and no FOUT.
 */
const archivo = Archivo({
  subsets: ['latin'],
  variable: '--font-archivo',
  display: 'swap',
})

const plexMono = IBM_Plex_Mono({
  subsets: ['latin'],
  weight: ['400', '500', '600'],
  variable: '--font-plex-mono',
  display: 'swap',
})

export const metadata: Metadata = {
  title: 'Coachienta',
  description: 'Food and training log with an AI coach',
  appleWebApp: { capable: true, statusBarStyle: 'default', title: 'Coachienta' },
}

/** viewportFit: cover is required for env(safe-area-inset-*) to resolve on iOS. */
export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  maximumScale: 1,
  viewportFit: 'cover',
}

export default function RootLayout({ children }: LayoutProps<'/'>) {
  return (
    <html
      lang="en"
      className={`${archivo.variable} ${plexMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col bg-bg text-ink">
        <AppProviders>{children}</AppProviders>
      </body>
    </html>
  )
}
