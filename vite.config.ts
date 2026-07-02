/// <reference types="vitest" />
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

// GitHub Pages serves this project repo under a sub-path
// (https://<user>.github.io/Argent-Mobile/), so the production build must be
// based there. Dev + preview + tests stay at '/' so nothing local changes.
const GH_PAGES_BASE = '/Argent-Mobile/';

export default defineConfig(({ command }) => ({
  base: command === 'build' ? GH_PAGES_BASE : '/',
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['favicon.svg', 'apple-touch-icon.png'],
      workbox: {
        // App is fully client-side; precache the whole shell so it runs offline.
        globPatterns: ['**/*.{js,css,html,svg,png,ico,woff,woff2}'],
        // The JS bundle is ~1.2 MB — raise the precache cap so it's cached.
        maximumFileSizeToCacheInBytes: 4 * 1024 * 1024,
        // Google Fonts: cache the stylesheet + font files for offline play.
        runtimeCaching: [
          {
            urlPattern: ({ url }) => url.origin === 'https://fonts.googleapis.com',
            handler: 'StaleWhileRevalidate',
            options: { cacheName: 'google-fonts-stylesheets' },
          },
          {
            urlPattern: ({ url }) => url.origin === 'https://fonts.gstatic.com',
            handler: 'CacheFirst',
            options: {
              cacheName: 'google-fonts-webfonts',
              expiration: { maxEntries: 30, maxAgeSeconds: 60 * 60 * 24 * 365 },
              cacheableResponse: { statuses: [0, 200] },
            },
          },
        ],
      },
      manifest: {
        name: 'Argent: The Consortium',
        short_name: 'Argent',
        description:
          'Local hot-seat implementation of Argent: The Consortium — 2–6 players, with AI bots.',
        theme_color: '#171430',
        background_color: '#171430',
        display: 'standalone',
        orientation: 'any',
        // Must match the GitHub Pages sub-path (see GH_PAGES_BASE) so the
        // installed PWA launches into / stays scoped to the app.
        start_url: '/Argent-Mobile/',
        scope: '/Argent-Mobile/',
        categories: ['games'],
        icons: [
          { src: 'pwa-192x192.png', sizes: '192x192', type: 'image/png' },
          { src: 'pwa-512x512.png', sizes: '512x512', type: 'image/png' },
          {
            src: 'pwa-maskable-512x512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'maskable',
          },
        ],
      },
      devOptions: {
        // Let the service worker run in `vite dev` so we can test installability.
        enabled: false,
      },
    }),
  ],
  test: {
    globals: false,
    environment: 'node',
    include: ['src/**/*.test.ts', 'src/**/*.test.tsx'],
  },
}));
