// Meshboard's service worker. At build time `vite.config.ts` compiles it and fills in the
// version and the exact list of files to cache below.
// Strategy: the app opens offline too; the page is fetched network-first (so new
// versions arrive right away), hashed files come from the cache.
/// <reference lib="webworker" />

/** replaced at build time with the list of files to cache */
declare const __PRECACHE__: string[]

const VERSION = '__VERSION__'
const PRECACHE = __PRECACHE__
const CACHE = `meshboard-${VERSION}`
const sw = self as unknown as ServiceWorkerGlobalScope

sw.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(CACHE)
      .then((cache) => cache.addAll(PRECACHE))
      .then(() => sw.skipWaiting()),
  )
})

sw.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(keys.filter((k) => k.startsWith('meshboard-') && k !== CACHE).map((k) => caches.delete(k))),
      )
      .then(() => sw.clients.claim()),
  )
})

sw.addEventListener('fetch', (event) => {
  const { request } = event
  if (request.method !== 'GET') return
  const url = new URL(request.url)
  if (url.origin !== sw.location.origin) return

  if (request.mode === 'navigate') {
    // network first, then the cached shell (the token lives in the hash, so the page is always the same)
    event.respondWith(
      fetch(request)
        .then((response) => {
          const copy = response.clone()
          caches.open(CACHE).then((cache) => cache.put('./', copy))
          return response
        })
        // offline and never cached (the very first visit was offline): a plain network error
        .catch(async () => (await caches.match('./', { ignoreSearch: true })) ?? Response.error()),
    )
    return
  }

  event.respondWith(
    caches.match(request).then(
      (cached) =>
        cached ||
        fetch(request).then((response) => {
          if (response.ok && response.type === 'basic') {
            const copy = response.clone()
            caches.open(CACHE).then((cache) => cache.put(request, copy))
          }
          return response
        }),
    ),
  )
})
