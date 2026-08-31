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
 *  Fetch-Strategie (Performance-Überarbeitung, Stand „Instant Navigation"):
 *  - Navigationen (HTML): stale-while-revalidate. Der letzte gute
 *    Cache-Stand erscheint SOFORT (kein Netz-Roundtrip beim Seitenwechsel),
 *    parallel wird der Cache im Hintergrund aufgefrischt. Frisch nach einem
 *    Deploy wird die App über den SW-Update-Mechanismus: CACHE_VERSION
 *    trägt den Build-Stempel (siehe unten) → neuer SW installiert die
 *    App-Shell mit cache:'no-cache', aktiviert sich per skipWaiting, und
 *    nav.js lädt die Seite beim controllerchange einmal neu. Live-Daten
 *    (Punkte, Rangliste, Spiele) sind davon unabhängig – sie kommen über
 *    cache.js versionsgeprüft aus Firestore.
 *  - Assets MIT `?v=`-Parameter: cache-first. Der Versions-Parameter IST
 *    die Inhalts-Identität – seit dem Build-Stempel (`?v=__BUILD__` →
 *    Commit-SHA, siehe scripts/build-asset-versions.js) tragen ihn ALLE
 *    lokalen JS/CSS/Daten-Dateien, auch data-*.js, admin.js, auth.js usw.
 *    Bereits gecachte Versionen kommen ohne jeden Netz-Roundtrip aus dem
 *    Cache (grösster Gewinn beim Seitenwechsel).
 *  - Assets OHNE `?v=` (nur noch Admin-/Sonderseiten): network-first mit
 *    Timeout, offline/langsam greift der Cache.
 *  - Bilder: stale-while-revalidate (unverändert).
 *
 *  Dev-Modus: Läuft die Seite ungebaut (Platzhalter `__BUILD__` nicht
 *  ersetzt, z.B. lokal via `python -m http.server`), wäre die Version
 *  konstant und cache-first würde jede Code-Änderung verschlucken. Der SW
 *  erkennt das und fällt für Navigationen UND versionierte Assets auf
 *  network-first zurück – wie vor der Umstellung.
 *
 *  Der frühere `bypassHttpCache`-Zwang (cache:'reload' für alle kritischen
 *  Assets) bleibt entfernt: Er hat bei JEDEM Seitenwechsel alle
 *  HTML/JS/CSS-Dateien komplett neu über das Netz geladen und war die
 *  Hauptursache für mehrsekündige Navigationszeiten.
 * ============================================================================= */
// Wird von scripts/build-asset-versions.js beim Deploy durch den
// Commit-SHA ersetzt – identisch mit den `?v=`-Werten der HTML-Seiten.
const CACHE_VERSION = 'v__BUILD__';
// Ungestempelt (= lokale Entwicklung ohne Build)? Token geteilt, damit der
// Build-Stempel diese Prüfung nicht mit-ersetzt.
const IS_DEV_BUILD = CACHE_VERSION.indexOf('__BU' + 'ILD__') !== -1;
const NAV_TIMEOUT_MS = 2500;
const ASSET_TIMEOUT_MS = 3000;
const SW_HOSTNAME = (self.location && self.location.hostname) || 'unknown';
const CACHE_NAME = `dreamteam-${SW_HOSTNAME}-${CACHE_VERSION}`;
const APP_SHELL = [
  './',
  './app.html',
  './shell.js',
  './index.html',
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
  './view-mode.js',
  './tippgruppen.js',
  './tippgruppen.css',
  './anime.min.js',
  './tournament-config.js',
  './country-aliases.js',
  './data.js',
  './data-wm2026.js',
  './data-cl2526.js',
  './data-cl2627.js',
  './position-overrides.js',
  './name-overrides.js',
  './name-shortener.js',
  './points-utils.js',
  './transfer-utils.js',
  './cache.js',
  './chart.umd.min.js',
  './vanilla-tilt.min.js',
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

/**
 * stale-while-revalidate für Navigationen: Der letzte gute Cache-Stand
 * antwortet SOFORT (kein Netz-Roundtrip beim Seitenwechsel), parallel wird
 * der Cache im Hintergrund aufgefrischt. Nach einem Deploy sorgt der
 * SW-Update-Mechanismus (neue CACHE_VERSION → skipWaiting →
 * controllerchange-Reload in nav.js) für frisches Markup; bis dahin ist ein
 * kurzzeitig veralteter Shell-Stand akzeptabel, weil Live-Daten über
 * cache.js versionsgeprüft aus Firestore kommen und nicht im HTML stecken.
 */
async function navigationStaleWhileRevalidate(event, request) {
  const cacheKey = normalizedCacheKey(request);
  const cached = await caches.match(cacheKey)
    || await caches.match(request, { ignoreSearch: true });

  const refresh = fetchAndCache(request, { cacheKey }).catch(() => null);

  if (cached) {
    // Hintergrund-Refresh zu Ende laufen lassen, auch wenn die Antwort
    // längst ausgeliefert ist – sonst darf der Browser den Fetch abbrechen.
    if (event && typeof event.waitUntil === 'function') {
      event.waitUntil(refresh);
    }
    return cached;
  }

  // Erstbesuch dieser Seite (noch kein Cache): auf das Netz warten; fällt
  // es komplett aus, dient die vorgecachte index.html als App-Shell-Fallback.
  const response = await refresh;
  if (response) return response;
  return (await caches.match('./index.html')) || Response.error();
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
    // Produktion: Cache sofort, Netz im Hintergrund (Details am
    // Funktionskopf). Dev ohne Build-Stempel: network-first wie früher,
    // damit Code-Änderungen beim lokalen Entwickeln sichtbar bleiben.
    if (IS_DEV_BUILD) {
      event.respondWith(networkFirstWithTimeout(
        request,
        NAV_TIMEOUT_MS,
        { ignoreSearch: true },
        { cacheKey: normalizedCacheKey(request) }
      ));
    } else {
      event.respondWith(navigationStaleWhileRevalidate(event, request));
    }
    return;
  }

  if (isCriticalAsset) {
    const isVersioned = url.searchParams.has('v');
    if (isVersioned && !IS_DEV_BUILD) {
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
