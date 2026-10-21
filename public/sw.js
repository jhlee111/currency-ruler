// Keeps the app usable with no signal: the app's own files are served from a cache that is
// filled in one go when this worker installs. VERSION is stamped by scripts/stamp-sw.mjs on
// deploy, so every deploy installs a fresh, complete set and drops the old one.
const VERSION = '950faa202e90'
const APP = `app-${VERSION}`
const FONTS = 'fonts-v1'
const FILES = [
  '/',
  '/styles.css',
  '/js/main.js',
  '/js/scale.js',
  '/js/currencies.js',
  '/js/rates.js',
  '/js/regions.js',
  '/js/search.js',
  '/js/themes.js',
  '/manifest.webmanifest',
  '/icons/icon-192.png',
  '/icons/apple-touch-icon.png',
]

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(APP)
      .then((cache) => cache.addAll(FILES.map((url) => new Request(url, { cache: 'reload' }))))
      .then(() => self.skipWaiting()),
  )
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== APP && key !== FONTS).map((key) => caches.delete(key))))
      .then(() => self.clients.claim()),
  )
})

self.addEventListener('fetch', (event) => {
  const { request } = event
  if (request.method !== 'GET') return
  const url = new URL(request.url)

  if (url.origin === location.origin) {
    // Any page load gets the app shell; everything else comes from the install-time set.
    const key = request.mode === 'navigate' ? '/' : url.pathname
    event.respondWith(caches.match(key, { cacheName: APP }).then((hit) => hit || fetch(request)))
    return
  }

  // The B612 typeface: use the copy on hand, refresh it in the background.
  if (url.hostname === 'fonts.googleapis.com' || url.hostname === 'fonts.gstatic.com') {
    event.respondWith(
      caches.open(FONTS).then(async (cache) => {
        const hit = await cache.match(request)
        const fresh = fetch(request)
          .then((res) => {
            if (res.ok || res.type === 'opaque') cache.put(request, res.clone())
            return res
          })
          .catch(() => hit)
        return hit || fresh
      }),
    )
  }
  // Exchange rates go straight to the network; the app keeps its own saved copy.
})
