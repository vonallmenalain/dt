#!/usr/bin/env node
/* =============================================================================
 *  scripts/test-asset-versions.js
 *
 *  Haelt die Asset-Versionierung der Seiten konsistent.
 *
 *  Seit dem Build-Stempel (scripts/build-asset-versions.js) tragen ALLE
 *  lokalen JS/CSS/Daten-Referenzen der Nutzer-Seiten denselben Platzhalter
 *  `?v=__BUILD__`. Nur dann gilt nach dem Deploy: eine Datei = eine URL =
 *  ein Cache-Eintrag, und der Service Worker darf alles cache-first
 *  ausliefern (kein Netz-Roundtrip beim Seitenwechsel).
 *
 *  Frueher liefen die `?v=`-Werte pro Seite auseinander (index -13,
 *  rangliste -16, spieleranalyse -25, …) und viele Dateien waren gar nicht
 *  versioniert – gemeinsame Assets lagen dadurch mehrfach im Cache bzw.
 *  mussten bei jedem Seitenwechsel uebers Netz revalidiert werden. Genau
 *  diese Drift faengt der Test ab.
 *
 *  Aufruf: npm run test:versions
 * ============================================================================= */

'use strict';

const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const readRoot = (file) => fs.readFileSync(path.join(ROOT, file), 'utf8');

const PLACEHOLDER = '__BUILD__';
const VERSION_SUFFIX = `?v=${PLACEHOLDER}`;

/* Alle Seiten, die Nutzer im Alltag laden. Admin-/Einmal-Seiten
 * (adm-*, auth-action, init-meta) sind bewusst nicht dabei. */
const PAGES = [
  'index.html', 'punktesystem.html', 'rangliste.html',
  'spieleranalyse.html', 'team-builder.html', 'teams.html',
  'liga-tabelle.html', 'app.html'
];

let failures = 0;
function check(label, condition, detail) {
  if (condition) return;
  failures++;
  console.error(`✗ ${label}${detail ? ` – ${detail}` : ''}`);
}

/* ── 1) Jede lokale Script-/Stylesheet-Referenz traegt ?v=__BUILD__ ─────── */
for (const page of PAGES) {
  const src = readRoot(page);

  // Alle src=/href=-Werte von <script>- und <link rel=stylesheet|manifest|
  // preload>-Tags einsammeln. Inline-Attribute anderer Tags (img, a) sind
  // hier egal – sie laufen nicht ueber den versionierten SW-Pfad.
  const refs = [];
  const tagRe = /<(script|link)\b[^>]*>/gi;
  let m;
  while ((m = tagRe.exec(src)) !== null) {
    const tag = m[0];
    const urlMatch = tag.match(/\b(?:src|href)="([^"]+)"/i);
    if (!urlMatch) continue;
    const url = urlMatch[1];
    if (/^(https?:)?\/\//i.test(url)) continue;          // CDN (Firebase) – nicht unser Cache-Pfad
    if (!/\.(js|css|webmanifest)(\?|$)/i.test(url)) continue; // Icons/Favicons etc.
    refs.push(url);
  }

  check(`${page}: enthaelt lokale Script-/Style-Referenzen`, refs.length > 0);

  for (const url of refs) {
    check(`${page}: ${url} traegt ${VERSION_SUFFIX}`, url.endsWith(VERSION_SUFFIX));
  }

  // Kein Ueberbleibsel alter, handgepflegter Versionsstrings.
  check(`${page}: keine alten ?v=…firebase-key…-Strings`, !/\?v=(?!__BUILD__)[^"']+"/.test(src) || !/firebase-key/.test(src));

  // Genereller: JEDES ?v= in der Seite muss der Platzhalter sein.
  const stray = (src.match(/\?v=([^"'&\s]+)/g) || []).filter(v => v !== VERSION_SUFFIX);
  check(`${page}: alle ?v=-Werte sind ${PLACEHOLDER}`, stray.length === 0, stray.join(', '));

  // Keine ungepinnten Drittanbieter-Skripte mehr (Chart.js/vanilla-tilt
  // sind vendored; nur gstatic.com/firebasejs ist als externe Quelle ok).
  const externalScripts = (src.match(/<script\b[^>]*src="https?:\/\/[^"]+"/gi) || [])
    .filter(tag => !tag.includes('www.gstatic.com/firebasejs/'));
  check(`${page}: keine externen Skripte ausser Firebase`, externalScripts.length === 0, externalScripts.join(' | '));
}

/* ── 2) Pre-Flight-Preload der Kaderdatei nutzt dieselbe Version ────────── */
// data.js haengt die eigene ?v=-Version an die Kaderdatei an; der Preload im
// <head> muss dieselbe URL treffen, sonst laedt der Browser doppelt.
for (const page of ['index.html', 'rangliste.html', 'spieleranalyse.html', 'teams.html', 'team-builder.html']) {
  const src = readRoot(page);
  check(`${page}: Kaderdatei-Preload traegt ${VERSION_SUFFIX}`,
    src.includes(`pl.href=df+"${VERSION_SUFFIX}";`));
}

/* ── 3) data.js reicht die Version an alle nachgeladenen Dateien weiter ── */
{
  const dataJs = readRoot('data.js');
  const writes = dataJs.split('\n')
    .filter(line => !line.trim().startsWith('//'))
    .filter(line => line.includes("document.write('<script src="));
  check('data.js: document.write-Ladezeilen gefunden', writes.length >= 4);
  for (const w of writes) {
    check(`data.js: ${w.trim().slice(0, 60)}… haengt vSuffix an`, w.includes('vSuffix'));
  }
}

/* ── 4) Service Worker traegt denselben Platzhalter als CACHE_VERSION ───── */
{
  const sw = readRoot('service-worker.js');
  check('service-worker.js: CACHE_VERSION nutzt den Build-Platzhalter',
    sw.includes(`const CACHE_VERSION = 'v${PLACEHOLDER}';`));
  check('service-worker.js: Dev-Erkennung vorhanden (geteiltes Token)',
    sw.includes("'__BU' + 'ILD__'"));
  check('service-worker.js: vendored Libs in der App-Shell',
    sw.includes("'./chart.umd.min.js'") && sw.includes("'./vanilla-tilt.min.js'"));
}

/* ── 5) build-asset-versions.js findet auf jeder Seite etwas zu stempeln ── */
for (const page of PAGES) {
  const src = readRoot(page);
  check(`${page}: enthaelt mindestens einen ${PLACEHOLDER}-Platzhalter`,
    src.includes(PLACEHOLDER));
}

if (failures > 0) {
  console.error(`\ntest-asset-versions: ${failures} Check(s) fehlgeschlagen.`);
  process.exit(1);
}
console.log('✓ test-asset-versions: Alle Seiten teilen sich die gestempelte Asset-Version.');
