/* =============================================================================
 *  service-worker.js
 *
 *  Multi-Tournament-aware PWA Service Worker.
 *
 *  Wichtig:
 *  - Service Worker laufen pro Origin/Domain getrennt. Trotzdem wird der
 *    Cache-Name HOSTBASIERT vergeben, damit:
 *      * dt.alae.app      → Cache `dreamteam-dt.alae.app-vYYYY-MM-DD-...`
 *      * localhost / Deploy Previews → eigener Cache pro Hostname
 *    So gibt es selbst bei einem Pflegezugriff via anderer Sub-Domain keine
 *    vermischten Inhalte.
 *  - Die Cache-Version wird bei strukturellen Änderungen erhöht, damit der
 *    Browser einen frischen Stand zieht und alte Caches früherer Turniere
 *    zuverlässig verschwinden.
 *  - Beim activate-Event werden ALLE alten dreamteam-* Caches entfernt
 *    (alles ausser dem aktuellen CACHE_NAME).
 * ============================================================================= */
const CACHE_VERSION = 'v2026-06-16-badge-catalog-modal';
const SW_HOSTNAME = (self.location && self.location.hostname) || 'unknown';
const CACHE_NAME = `dreamteam-${SW_HOSTNAME}-${CACHE_VERSION}`;
const APP_SHELL = [
  './',
  './index.html',
  './adm-sync-monitor.html',
  './team-builder.html',
  './punktesystem.html',
  './teams.html',
  './spieleranalyse.html',
  './rangliste.html',
  './styles.css',
  './nav.js',
  './badge-catalog.js',
  './admin.js',
  './auth.js',
  './auth-modal.js',
  './auth-modal.css',
  './anime.min.js',
  './tournament-config.js',
  './country-aliases.js',
  './data.js',
  './data-wm2026.js',
  './position-overrides.js',
  './points-utils.js',
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

/**
 * networkFirstWithTimeout
 *
 * Bewusst NICHT „nur" auf das Netzwerk zu warten:
 * In schlechtem Mobilfunk-Empfang (Zug, Tiefgarage) blockierte der
 * bisherige `networkFirst`-Pfad die Navigation, bis das Backend wirklich
 * antwortete – manchmal mehrere Sekunden weisser Bildschirm. Mit einem
 * Race gegen `timeoutMs` zeigen wir nach 3 s den Cache-Stand an, sobald
 * vorhanden, und füllen den Cache im Hintergrund nach.
 *
 * Reihenfolge der Antworten:
 *   1. Frisches Netzwerk-Response (gewinnt das Race) → Cache aktualisieren.
 *   2. Timeout abgelaufen → letzter guter Cache (sofort).
 *   3. Cache leer → trotzdem auf Netzwerk warten (besser etwas spaet als gar nichts).
 *   4. Netzwerk komplett aus → Cache, sonst Index-Fallback.
 */
function fetchAndCache(request) {
  return fetch(request).then((response) => {
    if (response && response.ok) {
      const copy = response.clone();
      caches.open(CACHE_NAME).then((cache) => cache.put(request, copy));
    }
    return response;
  });
}

async function networkFirstWithTimeout(request, timeoutMs = 3000, matchOptions = undefined) {
  const cached = await caches.match(request, matchOptions);

  let timeoutId;
  const timeoutPromise = new Promise((resolve) => {
    timeoutId = setTimeout(() => resolve(null), timeoutMs);
  });

  let networkPromise;
  try {
    networkPromise = fetchAndCache(request);
  } catch (err) {
    networkPromise = Promise.reject(err);
  }

  // Schritt 1+2: Netzwerk vs. Timeout – aber nur, wenn wir einen
  // brauchbaren Cache-Stand haetten, mit dem sich der Timeout lohnt.
  if (cached) {
    const winner = await Promise.race([
      networkPromise.catch(() => null),
      timeoutPromise
    ]);
    clearTimeout(timeoutId);

    if (winner && winner.ok) return winner;
    // Timeout oder Netzwerkfehler → cache liefern, im Hintergrund weiter
    // versuchen (kein await), damit der naechste Request eine frische
    // Kopie sieht.
    networkPromise.catch(() => { /* swallow background refresh */ });
    return cached;
  }

  // Kein Cache vorhanden → wir muessen warten. Falls das Netzwerk komplett
  // ausfaellt, fallen wir zumindest auf die index.html (App-Shell) zurueck,
  // damit nicht der nackte Browser-Offline-Screen erscheint.
  clearTimeout(timeoutId);
  try {
    return await networkPromise;
  } catch (error) {
    return (await caches.match('./index.html')) || Response.error();
  }
}

// Behaelt den frueheren Namen bei, damit alte Aufrufer (falls jemand aus
// der Konsole oder einem Deploy-Script den Pfad referenziert) sich nicht
// unerwartet verhalten.
function networkFirst(request) {
  return networkFirstWithTimeout(request);
}

function networkFirstIgnoreSearch(request) {
  return networkFirstWithTimeout(request, 3000, { ignoreSearch: true });
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
    event.respondWith(networkFirstIgnoreSearch(request));
    return;
  }

  if (isCriticalAsset) {
    event.respondWith(networkFirstIgnoreSearch(request));
    return;
  }

  if (isImageAsset) {
    event.respondWith(staleWhileRevalidate(request));
    return;
  }

  event.respondWith(networkFirst(request));
});
