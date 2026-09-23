const CACHE_PREFIX = 'sound-wave-';
const BUILD_STORAGE_KEY = 'sound-wave-build-id-v1';

interface VersionPayload {
  buildId?: unknown;
  deployedAt?: unknown;
}

function normalizeBuildId(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return /^[A-Za-z0-9._-]{3,80}$/.test(trimmed) ? trimmed : null;
}

function versionRequestUrl(): URL {
  const url = new URL('./version.json', document.baseURI);
  // GitHub Pages/CDN and Safari must not be able to satisfy this probe with
  // a previous deployment.
  url.searchParams.set('__fresh', String(Date.now()));
  return url;
}

async function fetchCurrentBuildId(): Promise<string | null> {
  try {
    const response = await fetch(versionRequestUrl(), {
      cache: 'no-store',
      credentials: 'same-origin',
      headers: { 'cache-control': 'no-cache' },
    });
    if (!response.ok) return null;
    const payload = await response.json() as VersionPayload;
    return normalizeBuildId(payload.buildId);
  } catch {
    return null;
  }
}

function updateVisibleBuildId(buildId: string): void {
  try {
    const url = new URL(window.location.href);
    if (url.searchParams.get('__build') === buildId) return;
    url.searchParams.set('__build', buildId);
    history.replaceState(history.state, '', url);
  } catch {
    // URL rewriting is only a cache-busting aid. Never interrupt the app.
  }
}

async function removeOldSoundWaveCaches(buildId: string): Promise<void> {
  if (!('caches' in window)) return;
  const activeCache = `${CACHE_PREFIX}${buildId}`;
  try {
    const keys = await caches.keys();
    await Promise.all(
      keys
        .filter((key) => key.startsWith(CACHE_PREFIX) && key !== activeCache)
        .map((key) => caches.delete(key)),
    );
  } catch {
    // CacheStorage can be unavailable in private/restricted browsing.
  }
}

async function registerBuildServiceWorker(buildId: string): Promise<void> {
  if (!('serviceWorker' in navigator) || location.protocol !== 'https:') return;

  const script = new URL('./service-worker.js', document.baseURI);
  script.searchParams.set('build', buildId);

  try {
    const registration = await navigator.serviceWorker.register(script, {
      scope: './',
      updateViaCache: 'none',
    });
    await registration.update();
  } catch (error) {
    console.warn('Service worker registration failed.', error);
  }
}

export async function installFreshPagePolicy(): Promise<void> {
  const buildId = await fetchCurrentBuildId();
  if (!buildId) {
    // Development/local builds may not have a deployment-generated version.
    if ('serviceWorker' in navigator && location.protocol === 'https:') {
      await registerBuildServiceWorker('local');
    }
    return;
  }

  updateVisibleBuildId(buildId);

  let previousBuild: string | null = null;
  try {
    previousBuild = localStorage.getItem(BUILD_STORAGE_KEY);
    localStorage.setItem(BUILD_STORAGE_KEY, buildId);
  } catch {
    // Storage is optional.
  }

  // A changed deployment gets its own cache namespace. Old namespaces are
  // removed without reloading the current tab, so gameplay/audio is never
  // interrupted by an update.
  if (previousBuild !== buildId) {
    await removeOldSoundWaveCaches(buildId);
  }

  await registerBuildServiceWorker(buildId);
  // Also sweep after activation/register in case an older worker created a
  // cache between the first sweep and the new worker taking control.
  await removeOldSoundWaveCaches(buildId);
}
