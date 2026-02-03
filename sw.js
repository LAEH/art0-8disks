/**
 * Art0 8disks - Service Worker
 * Provides offline caching and faster subsequent loads
 */

const CACHE_VERSION = 'v1';
const STATIC_CACHE = `art0-static-${CACHE_VERSION}`;
const IMAGE_CACHE = `art0-images-${CACHE_VERSION}`;

// Static assets to cache immediately
const STATIC_ASSETS = [
    '/',
    '/index.html',
    '/css/style.css',
    '/js/app.js',
    '/js/animator.js',
    '/js/imageLoader.js',
    '/config.json'
];

// Install event - cache static assets
self.addEventListener('install', (event) => {
    event.waitUntil(
        caches.open(STATIC_CACHE)
            .then(cache => cache.addAll(STATIC_ASSETS))
            .then(() => self.skipWaiting())
    );
});

// Activate event - clean up old caches
self.addEventListener('activate', (event) => {
    event.waitUntil(
        caches.keys().then(cacheNames => {
            return Promise.all(
                cacheNames
                    .filter(name => name.startsWith('art0-') && name !== STATIC_CACHE && name !== IMAGE_CACHE)
                    .map(name => caches.delete(name))
            );
        }).then(() => self.clients.claim())
    );
});

// Fetch event - serve from cache, fallback to network
self.addEventListener('fetch', (event) => {
    const url = new URL(event.request.url);

    // Handle GCS image requests
    if (url.hostname === 'storage.googleapis.com') {
        event.respondWith(handleImageRequest(event.request));
        return;
    }

    // Handle static assets
    if (event.request.method === 'GET') {
        event.respondWith(handleStaticRequest(event.request));
    }
});

/**
 * Handle static asset requests - cache first, then network
 */
async function handleStaticRequest(request) {
    const cached = await caches.match(request);
    if (cached) {
        // Return cached, but update in background
        updateCache(request, STATIC_CACHE);
        return cached;
    }

    try {
        const response = await fetch(request);
        if (response.ok) {
            const cache = await caches.open(STATIC_CACHE);
            cache.put(request, response.clone());
        }
        return response;
    } catch (e) {
        // Offline fallback
        return new Response('Offline', { status: 503 });
    }
}

/**
 * Handle image requests - cache first with size limits
 */
async function handleImageRequest(request) {
    const cached = await caches.match(request);
    if (cached) {
        return cached;
    }

    try {
        const response = await fetch(request);
        if (response.ok) {
            // Cache the image
            const cache = await caches.open(IMAGE_CACHE);
            cache.put(request, response.clone());

            // Cleanup old images if cache gets too large
            cleanupImageCache();
        }
        return response;
    } catch (e) {
        // Return placeholder or error
        return new Response('Image unavailable', { status: 503 });
    }
}

/**
 * Update cache in background
 */
async function updateCache(request, cacheName) {
    try {
        const response = await fetch(request);
        if (response.ok) {
            const cache = await caches.open(cacheName);
            cache.put(request, response);
        }
    } catch (e) {
        // Ignore update failures
    }
}

/**
 * Clean up image cache to prevent storage issues
 * Keep only most recent 500 images
 */
async function cleanupImageCache() {
    const cache = await caches.open(IMAGE_CACHE);
    const keys = await cache.keys();

    if (keys.length > 500) {
        // Delete oldest entries (first 100)
        const toDelete = keys.slice(0, 100);
        await Promise.all(toDelete.map(key => cache.delete(key)));
    }
}
