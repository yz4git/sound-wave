const params = new URL(self.location.href).searchParams;
const BUILD = params.get('build') || 'local';
const CACHE_PREFIX = 'sound-wave-';
const CACHE = `${CACHE_PREFIX}${BUILD}`;
const SCOPE = self.registration.scope;
const OFFLINE_DOCUMENT = new URL('./index.html', SCOPE).toString();
const PRECACHE = [
  './manifest.webmanifest',
  './icon.svg',
  './vocal-worklet.js',
];

async function putIfOk(cache, request, response) {
  if (response && response.ok) await cache.put(request, response.clone());
  return response;
}

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE);

    for (const path of PRECACHE) {
      try {
        const url = new URL(path, SCOPE);
        url.searchParams.set('__build', BUILD);
        const response = await fetch(url, { cache: 'no-store' });
        if (response.ok) await cache.put(new URL(path, SCOPE), response.clone());
      } catch {
        // Optional precache item; do not make installation fail.
      }
    }

    // Cache one fresh application shell only as an offline fallback. Online
    // navigations always use the network first.
    try {
      const shellUrl = new URL('./', SCOPE);
      shellUrl.searchParams.set('__build', BUILD);
      const shell = await fetch(shellUrl, { cache: 'no-store' });
      if (shell.ok) await cache.put(OFFLINE_DOCUMENT, shell.clone());
    } catch {
      // First install may be offline; activation can still proceed.
    }

    await self.skipWaiting();
  })());
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(
      keys
        .filter((key) => key.startsWith(CACHE_PREFIX) && key !== CACHE)
        .map((key) => caches.delete(key)),
    );
    await self.clients.claim();
  })());
});

async function networkFirst(request, fallbackRequest = null) {
  const cache = await caches.open(CACHE);
  try {
    const response = await fetch(request, { cache: 'no-store' });
    await putIfOk(cache, request, response);
    return response;
  } catch {
    return (await cache.match(request))
      ?? (fallbackRequest ? await cache.match(fallbackRequest) : undefined)
      ?? Response.error();
  }
}

async function cacheFirstHashedAsset(request) {
  const cache = await caches.open(CACHE);
  const cached = await cache.match(request);
  if (cached) return cached;

  try {
    const response = await fetch(request, { cache: 'force-cache' });
    await putIfOk(cache, request, response);
    return response;
  } catch {
    return Response.error();
  }
}

self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;

  const url = new URL(event.request.url);
  if (url.origin !== self.location.origin) return;

  // Never cache the deployment probe or the worker script itself.
  if (url.pathname.endsWith('/version.json') || url.pathname.endsWith('/service-worker.js')) {
    event.respondWith(fetch(event.request, { cache: 'no-store' }).catch(() => Response.error()));
    return;
  }

  // HTML is always network-first. This is the key protection against GitHub
  // Pages showing the previous deployment after a publish.
  if (event.request.mode === 'navigate' || url.pathname.endsWith('/index.html')) {
    event.respondWith(networkFirst(event.request, OFFLINE_DOCUMENT));
    return;
  }

  // Vite content-hashed bundles are immutable by filename and safe to keep.
  if (url.pathname.includes('/assets/')) {
    event.respondWith(cacheFirstHashedAsset(event.request));
    return;
  }

  // Unhashed files such as vocal-worklet.js, manifest and icons should prefer
  // the network so a deployment cannot be masked by a previous cache entry.
  event.respondWith(networkFirst(event.request));
});
