// The app offline (the tablet at a customer without internet): it opens as last loaded, with the plan as last
// fetched. Online everything comes fresh from the server first; only without a connection the kept copy answers.
// The files under /assets carry a content hash in their names: kept once, they never change.
const APP = 'wego-app-v1'
const API = 'wego-api-v1'

self.addEventListener('install', () => self.skipWaiting())

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== APP && key !== API).map((key) => caches.delete(key))))
      .then(() => self.clients.claim()),
  )
})

/** Fresh from the server, kept as a copy; without a connection the copy (or the fallback). */
async function networkFirst(request, cacheName, fallback) {
  const cache = await caches.open(cacheName)
  try {
    const response = await fetch(request)
    if (response.ok) await cache.put(fallback ?? request, response.clone())
    return response
  } catch (error) {
    const kept = await cache.match(fallback ?? request)
    if (kept) return kept
    throw error
  }
}

async function cacheFirst(request) {
  const cache = await caches.open(APP)
  const kept = await cache.match(request)
  if (kept) return kept
  const response = await fetch(request)
  if (response.ok) await cache.put(request, response.clone())
  return response
}

self.addEventListener('fetch', (event) => {
  const request = event.request
  const url = new URL(request.url)
  if (url.origin !== self.location.origin) return

  // Signed out: nothing of the plan stays on the device.
  if (request.method === 'POST' && url.pathname === '/api/auth/logout') {
    event.waitUntil(caches.delete(API))
    return
  }
  if (request.method !== 'GET') return

  if (request.mode === 'navigate') {
    event.respondWith(networkFirst(request, APP, '/'))
  } else if (url.pathname.startsWith('/assets/')) {
    event.respondWith(cacheFirst(request))
  } else if (url.pathname.startsWith('/api/')) {
    // Not kept: the polling for changes, and the documents (big, opened online by the planners).
    if (url.pathname === '/api/changes' || url.pathname.startsWith('/api/sites/documents/')) return
    if (url.pathname.startsWith('/api/auth/') && url.pathname !== '/api/auth/me') return
    event.respondWith(networkFirst(request, API))
  } else {
    event.respondWith(networkFirst(request, APP))
  }
})
