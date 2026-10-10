import type { MetadataRoute } from 'next'

export default function manifest(): MetadataRoute.Manifest {
  return {
    id: '/',
    name: 'Trinela — Driving Schools',
    short_name: 'Trinela',
    description: 'Find verified driving schools and book your first lesson in Bengaluru.',
    start_url: '/',
    display: 'standalone',
    background_color: '#ffffff',
    theme_color: '#1765ee',
    orientation: 'portrait',
    lang: 'en-IN',
    categories: ['lifestyle', 'travel'],
    icons: [
      {
        src: '/icon-192.png',
        sizes: '192x192',
        type: 'image/png',
        purpose: 'any',
      },
      {
        src: '/icon.png',
        sizes: '512x512',
        type: 'image/png',
        purpose: 'any',
      },
      {
        src: '/icon-maskable-512.png',
        sizes: '512x512',
        type: 'image/png',
        purpose: 'maskable',
      },
    ],
  }
}
