const CACHE_NAME = 'menage-manager-v2';

// Install: skip waiting to activate immediately
self.addEventListener('install', event => {
    self.skipWaiting();
});

// Activate: clean old caches
self.addEventListener('activate', event => {
    event.waitUntil(
        caches.keys().then(keys =>
            Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k)))
        )
    );
    self.clients.claim();
});

// Fetch: network-first, cache as fallback (offline support)
self.addEventListener('fetch', event => {
    // Only handle GET requests
    if (event.request.method !== 'GET') return;

    event.respondWith(
        fetch(event.request).then(resp => {
            // Cache successful responses for offline use
            if (resp.ok) {
                const clone = resp.clone();
                caches.open(CACHE_NAME).then(cache => cache.put(event.request, clone));
            }
            return resp;
        }).catch(() => {
            // Offline: try cache
            return caches.match(event.request);
        })
    );
});
