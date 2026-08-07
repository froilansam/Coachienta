import type { MetadataRoute } from 'next'

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'Coachienta',
    short_name: 'Coachienta',
    description: 'Food and training log with an AI coach',
    start_url: '/',
    display: 'standalone',
    orientation: 'portrait',
    background_color: '#f4f1ee',
    theme_color: '#f4f1ee',
    icons: [
      { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
      { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
      // `maskable` lets Android crop to its platform shape without clipping art.
      { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
      { src: '/icons/icon-1024.png', sizes: '1024x1024', type: 'image/png', purpose: 'any' },
    ],
  }
}
