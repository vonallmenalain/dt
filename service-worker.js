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
 *
 *  Fetch-Strategie (Performance-Überarbeitung):
 *  - Navigationen (HTML): network-first mit kurzem Timeout. Das HTML bleibt
 *    damit immer frisch (Netlify liefert per ETag billige 304er), aber bei
 *    schlechtem Empfang erscheint nach NAV_TIMEOUT_MS der letzte gute
 *    Cache-Stand statt eines weissen Bildschirms.
 *  - Assets MIT `?v=`-Parameter (styles.css, nav.js, cache.js, …):
 *    cache-first. Der Versions-Parameter IST die Inhalts-Identität – eine
 *    neue Version bekommt eine neue URL und damit automatisch einen
 *    frischen Download. Bereits gecachte Versionen kommen ohne jeden
 *    Netz-Roundtrip aus dem Cache (grösster Gewinn beim Seitenwechsel).
 *  - Assets OHNE `?v=` (admin.js, auth.js, data-*.js, …): network-first mit
 *    Timeout. Sie bleiben dank ETag-Revalidierung (304) frisch, kosten
 *    online aber nur noch einen parallelen Roundtrip statt eines vollen
 *    Downloads; offline/langsam greift der Cache.
 *  - Bilder: stale-while-revalidate (unverändert).
 *
 *  Der frühere `bypassHttpCache`-Zwang (cache:'reload' für alle kritischen
 *  Assets) ist bewusst entfernt: Er hat bei JEDEM Seitenwechsel alle
 *  HTML/JS/CSS-Dateien komplett neu über das Netz geladen und war die
 *  Hauptursache für mehrsekündige Navigationszeiten. Deploy-Frischheit ist
 *  weiterhin garantiert: Beim Deploy wird CACHE_VERSION (zusammen mit den
 *  `?v=`-Parametern in den HTML-Seiten) erhöht → neuer SW installiert die
 *  App-Shell mit cache:'no-cache' frisch, aktiviert sich per skipWaiting,
 *  und nav.js lädt die Seite beim controllerchange einmal neu.
 * ============================================================================= */
const CACHE_VERSION = 'v2026-07-23-cl-turnier-2';
const NAV_TIMEOUT_MS = 2500;
const ASSET_TIMEOUT_MS = 3000;
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
  './index.css',
  './index.js',
  './spieleranalyse.css',
  './spieleranalyse.js',
  './teams.css',
  './teams.js',
  './rangliste.css',
  './rangliste.js',
  './team-builder.css',
  './team-builder.js',
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
  './data-cl2526.js',
  './position-overrides.js',
  './name-overrides.js',
  './points-utils.js',
  './transfer-utils.js',
  './cache.js',
  './theme-cl.css',
  './liga-tabelle.html',
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
/**
 * Cache-Key für Navigationen: Query-Parameter (z.B. ?manager=…,
 * ?tournament=…) beeinflussen bei statischem Hosting den HTML-Inhalt
 * nicht – sie werden rein client-seitig ausgewertet. Ohne Normalisierung
 * würde jede Query-Variante als eigener Cache-Eintrag wachsen.
 */
function normalizedCacheKey(request) {
  const url = new URL(request.url);
  url.search = '';
  return url.href;
}

function fetchAndCache(request, options = {}) {
  return fetch(request).then((response) => {
    if (response && response.ok) {
      const copy = response.clone();
      const key = options.cacheKey || request;
      caches.open(CACHE_NAME).then((cache) => cache.put(key, copy));
    }
    return response;
  });
}

/**
 * cache-first für Assets mit `?v=`-Parameter: Die URL identifiziert den
 * Inhalt eindeutig (Cache-Buster-Konvention der App). Ist die exakte URL
 * gecacht, gibt es keinen Netz-Roundtrip; ein Versionssprung erzeugt eine
 * neue URL und lädt automatisch frisch. Fällt das Netz beim Erst-Download
 * aus, dient die beim install vorgecachte, unversionierte Kopie derselben
 * Datei als Offline-Fallback.
 */
async function cacheFirstVersioned(request) {
  const cache = await caches.open(CACHE_NAME);
  const exact = await cache.match(request);
  if (exact) return exact;

  try {
    const response = await fetch(request);
    if (response && response.ok) {
      await cache.put(request, response.clone());
    }
    return response;
  } catch (error) {
    const fallback = await cache.match(request, { ignoreSearch: true });
    if (fallback) return fallback;
    return Response.error();
  }
}

async function networkFirstWithTimeout(request, timeoutMs = 3000, matchOptions = undefined, options = {}) {
  const cached = await caches.match(request, matchOptions);

  let timeoutId;
  const timeoutPromise = new Promise((resolve) => {
    timeoutId = setTimeout(() => resolve(null), timeoutMs);
  });

  let networkPromise;
  try {
    networkPromise = fetchAndCache(request, options);
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

  // Kein Cache vorhanden → wir muessen warten. Faellt das Netzwerk komplett
  // aus, dient bei Navigationen die index.html (App-Shell) als letzter
  // Fallback, damit nicht der nackte Browser-Offline-Screen erscheint.
  // Fuer Sub-Ressourcen (JS/CSS) waere index.html eine falsche Antwort.
  clearTimeout(timeoutId);
  try {
    return await networkPromise;
  } catch (error) {
    if (request.mode === 'navigate') {
      return (await caches.match('./index.html')) || Response.error();
    }
    return Response.error();
  }
}

// Behaelt den frueheren Namen bei, damit alte Aufrufer (falls jemand aus
// der Konsole oder einem Deploy-Script den Pfad referenziert) sich nicht
// unerwartet verhalten.
function networkFirst(request) {
  return networkFirstWithTimeout(request);
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
    // HTML bleibt network-first (frisches Markup inkl. neuer `?v=`-Referenzen
    // nach einem Deploy); der Cache-Fallback greift per Timeout bei
    // schlechtem Empfang. ignoreSearch, damit z.B. teams.html?manager=X den
    // gecachten teams.html-Stand als Fallback nutzt.
    event.respondWith(networkFirstWithTimeout(
      request,
      NAV_TIMEOUT_MS,
      { ignoreSearch: true },
      { cacheKey: normalizedCacheKey(request) }
    ));
    return;
  }

  if (isCriticalAsset) {
    const isVersioned = url.searchParams.has('v');
    if (isVersioned) {
      event.respondWith(cacheFirstVersioned(request));
    } else {
      event.respondWith(networkFirstWithTimeout(request, ASSET_TIMEOUT_MS));
    }
    return;
  }

  if (isImageAsset) {
    event.respondWith(staleWhileRevalidate(request));
    return;
  }

  event.respondWith(networkFirst(request));
});
