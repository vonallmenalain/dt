/* =============================================================================
 *  service-worker.js
 *
 *  Multi-Tournament-aware PWA Service Worker.
 *
 *  Wichtig:
 *  - Service Worker laufen pro Origin/Domain getrennt. Trotzdem wird der
 *    Cache-Name HOSTBASIERT vergeben, damit:
 *      * em24dt.alae.app  → Cache `dreamteam-em24dt.alae.app-vYYYY-MM-DD-...`
 *      * dt.alae.app      → Cache `dreamteam-dt.alae.app-vYYYY-MM-DD-...`
 *      * localhost / Deploy Previews → eigener Cache pro Hostname
 *    So gibt es selbst bei einem versehentlichen Domain-Switch oder einem
 *    Pflegezugriff via anderer Sub-Domain keine vermischten Inhalte.
 *  - Die Cache-Version wurde bewusst erhöht, damit der Browser nach dem
 *    Domain-Mapping-Umbau einen frischen Stand zieht und keine alten
 *    Assets aus dem Vor-Umbau-Cache als neuer Inhalt erscheinen.
 *  - Beim activate-Event werden ALLE alten dreamteam-* Caches entfernt
 *    (alles ausser dem aktuellen CACHE_NAME).
 * ============================================================================= */
const CACHE_VERSION = 'v2026-05-08-dev-switcher-popover';
const SW_HOSTNAME = (self.location && self.location.hostname) || 'unknown';
const CACHE_NAME = `dreamteam-${SW_HOSTNAME}-${CACHE_VERSION}`;
const APP_SHELL = [
  './',
  './index.html',
  './team-builder.html',
  './punktesystem.html',
  './teams.html',
  './spieleranalyse.html',
  './rangliste.html',
  './dashboard.html',
  './styles.css',
  './nav.js',
  './tournament-config.js',
  './data.js',
  './data-em2024.js',
  './data-wm2026.js',
  './position-overrides.js',
  './cache.js',
  './Icons/site.webmanifest',
  './Icons/favicon.ico',
  './Icons/android-chrome-192x192.png',
  './Icons/android-chrome-512x512.png',
  './Icons/apple-touch-icon.png'
];

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(async (cache) => {
        await Promise.allSettled(
          APP_SHELL.map(async (asset) => {
            try {
              const response = await fetch(asset, { cache: 'no-cache' });
              if (response && response.ok) {
                await cache.put(asset, response);
              }
            } catch (error) {
              // Einzelne Asset-Fehler sollen die SW-Installation nicht abbrechen.
            }
          })
        );
      })
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys => Promise.all(
      keys
        // Alle alten dreamteam-* Caches dieser Domain entfernen (z.B.
        // ehemalige fixe `dreamteam-pwa-v...`-Caches und ältere
        // host-spezifische Versionen). Der jeweils aktuelle Cache bleibt.
        .filter(key => key !== CACHE_NAME && /^dreamteam[-_]/i.test(key))
        .map(key => caches.delete(key))
    )).then(() => self.clients.claim())
  );
});

async function networkFirst(request) {
  try {
    const fresh = await fetch(request);
    const cache = await caches.open(CACHE_NAME);
    cache.put(request, fresh.clone());
    return fresh;
  } catch (error) {
    const cached = await caches.match(request);
    if (cached) return cached;
    return caches.match('./index.html');
  }
}

async function staleWhileRevalidate(request) {
  const cache = await caches.open(CACHE_NAME);
  const cached = await cache.match(request);
  const networkPromise = fetch(request)
    .then(response => {
      if (response && response.ok) {
        cache.put(request, response.clone());
      }
      return response;
    })
    .catch(() => null);

  return cached || networkPromise || fetch(request);
}

self.addEventListener('fetch', event => {
  const request = event.request;

  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  const pathname = url.pathname.toLowerCase();
  const isCriticalAsset = /\.(html|js|css|webmanifest)$/.test(pathname);
  const isImageAsset = /\.(png|jpg|jpeg|gif|svg|webp|ico|avif)$/.test(pathname);

  if (request.mode === 'navigate') {
    event.respondWith(networkFirst(request));
    return;
  }

  if (isCriticalAsset) {
    event.respondWith(networkFirst(request));
    return;
  }

  if (isImageAsset) {
    event.respondWith(staleWhileRevalidate(request));
    return;
  }

  event.respondWith(networkFirst(request));
});
