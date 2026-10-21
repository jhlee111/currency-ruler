import { execSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { defineConfig } from 'vite'
import { VitePWA } from 'vite-plugin-pwa'

const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8'))

// The commit a build came from, shown next to the version in Settings.
function commit() {
  try {
    return execSync('git rev-parse --short HEAD', { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim()
  } catch {
    return 'dev'
  }
}

export default defineConfig({
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version),
    __APP_COMMIT__: JSON.stringify(commit()),
  },
  plugins: [
    VitePWA({
      // src/main.js registers the worker itself, so it can offer the update rather than reload under the user.
      injectRegister: false,
      manifest: {
        id: '/',
        name: 'Currency Ruler',
        short_name: 'Ruler',
        description: 'Read prices across two currencies on a logarithmic ruler.',
        lang: 'en',
        dir: 'ltr',
        start_url: '/',
        scope: '/',
        display: 'standalone',
        orientation: 'portrait',
        // The Wood theme's desk, the default, so the splash screen matches the first frame.
        background_color: '#2a1d14',
        theme_color: '#2a1d14',
        categories: ['travel', 'finance', 'utilities'],
        prefer_related_applications: false,
        icons: [
          { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
          { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
          { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        // Everything the app needs to open with no signal. Exchange rates aren't here: the app keeps
        // its own saved copy, and ExchangeRate-API's terms don't allow redistributing theirs.
        globPatterns: ['**/*.{js,css,html,png,webmanifest}'],
        navigateFallback: '/index.html',
        // A new version takes over at once; the app then offers a reload (see the update toast).
        skipWaiting: true,
        clientsClaim: true,
        cleanupOutdatedCaches: true,
        runtimeCaching: [
          {
            // The B612 typeface: use the copy on hand, refresh it in the background.
            urlPattern: ({ url }) => url.origin === 'https://fonts.googleapis.com' || url.origin === 'https://fonts.gstatic.com',
            handler: 'StaleWhileRevalidate',
            options: { cacheName: 'fonts', cacheableResponse: { statuses: [0, 200] }, expiration: { maxEntries: 20 } },
          },
        ],
      },
    }),
  ],
})
