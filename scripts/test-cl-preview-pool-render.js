'use strict';

/* =============================================================================
 *  test-cl-preview-pool-render.js
 *
 *  Regressionstest: der Spielerpool muss in einer Vorschau AUCH DANN sichtbar
 *  sein, wenn es noch keine Live-Daten gibt.
 *
 *  Hintergrund: die Kaderdatei (data-<turnier>.js) liegt statisch im Browser
 *  und braucht weder Firestore noch Punkte. Vor Turnierstart fehlen nur die
 *  PUNKTE. Frueher hat der Vorschau-Hinweis `#player-list` komplett ersetzt –
 *  damit war ein fertig geladener Kader unsichtbar (CL 2026/27: 917 Spieler,
 *  aber leere Liste). Dieser Test haelt die Korrektur fest.
 *
 *  Quelltext-Check statt DOM: spieleranalyse.js ist eine Browser-IIFE mit
 *  Firebase-/DOM-Abhaengigkeiten und laesst sich in Node nicht ausfuehren.
 * ============================================================================= */

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const source = fs.readFileSync(path.join(__dirname, '..', 'spieleranalyse.js'), 'utf8');

/* ── 1) Der rettende Pfad existiert ─────────────────────────────────────── */
assert.match(source, /function renderPreviewWithoutLiveData\s*\(/,
  'renderPreviewWithoutLiveData fehlt – der Pool wuerde in der Vorschau nicht gerendert.');
assert.match(source, /function hasPlayerPool\s*\(/,
  'hasPlayerPool fehlt – ohne Pool-Pruefung greift der Fallback nicht.');

/* ── 2) Er rendert wirklich (und zeigt nicht nur einen Hinweis) ─────────── */
const fnStart = source.indexOf('function renderPreviewWithoutLiveData');
const fnBody = source.slice(fnStart, fnStart + 1400);
assert.match(fnBody, /applyDataset\s*\(/,
  'renderPreviewWithoutLiveData muss applyDataset aufrufen, sonst bleibt die Liste leer.');
assert.match(fnBody, /showStaleNotice\s*\(/,
  'Der Vorschau-Hinweis muss nicht-destruktiv sein (showStaleNotice), nicht die Liste ersetzen.');
assert.match(fnBody, /hasPlayerPool\s*\(\s*\)/,
  'Ohne Pool muss weiterhin der alte, ersetzende Hinweis greifen.');

/* ── 3) Kein Aufrufer ersetzt die Liste mehr direkt ─────────────────────── */
/* `showPreviewNoDataNotice` darf es weiter geben – aber nur noch als
 * Fallback INNERHALB von renderPreviewWithoutLiveData (zweimal: kein Pool,
 * und applyDataset ist gescheitert). Jede weitere Aufrufstelle waere ein
 * Rueckfall in das alte Verhalten. */
// Aufrufe zaehlen, nicht die Definition (`function showPreviewNoDataNotice()`).
const CALL = /(?<!function\s)showPreviewNoDataNotice\s*\(\s*\)/g;
const callOffsets = [];
for (let m = CALL.exec(source); m; m = CALL.exec(source)) callOffsets.push(m.index);
assert.equal(callOffsets.length, 2,
  `showPreviewNoDataNotice() wird ${callOffsets.length}x aufgerufen – erwartet werden genau die ` +
  '2 Fallbacks in renderPreviewWithoutLiveData. Weitere Aufrufe wuerden die Spielerliste wieder ersetzen.');

// Beide Aufrufe muessen innerhalb von renderPreviewWithoutLiveData liegen,
// also vor der naechsten Funktionsdefinition auf gleicher Einrueckung.
const nextFn = source.indexOf('\n    function ', fnStart + 1);
assert.ok(nextFn > fnStart, 'Ende von renderPreviewWithoutLiveData nicht auffindbar.');
for (const offset of callOffsets) {
  assert.ok(offset > fnStart && offset < nextFn,
    'showPreviewNoDataNotice wird ausserhalb von renderPreviewWithoutLiveData aufgerufen – ' +
    'dort wuerde es die Spielerliste wieder ersetzen.');
}

/* ── 4) Alle Vorschau-Zweige nutzen den neuen Pfad ──────────────────────── */
const renderCalls = source.match(/renderPreviewWithoutLiveData\s*\(/g) || [];
assert.equal(renderCalls.length, 5,
  `renderPreviewWithoutLiveData kommt ${renderCalls.length}x vor – erwartet: 1 Definition + 4 Aufrufstellen ` +
  '(onCachedReady, onUpdate, onError, aeusserer catch).');

/* ── 5) Kaderdatei-Preload deckt neue CL-Saisons ab ─────────────────────── */
/* Der Preload im <head> hat frueher nur cl2526 gekannt und fuer cl2627 die
 * WM-Datei vorgeladen. Jetzt greift ein Muster – sonst muesste man bei jeder
 * neuen CL-Saison fuenf HTML-Dateien nachziehen. */
const PAGES = ['index.html', 'team-builder.html', 'teams.html', 'rangliste.html', 'spieleranalyse.html'];
for (const page of PAGES) {
  const html = fs.readFileSync(path.join(__dirname, '..', page), 'utf8');
  assert.match(html, /\/\^cl\\d\{4\}\$\/\.test\(k\)\s*\?\s*\("data-"\+k\+"\.js"\)/,
    `${page}: der Kaderdatei-Preload muss jede CL-Saison abdecken (Muster statt fester Liste).`);
}

/* ── 6) Spielplan faellt auf den Terminkalender zurueck ─────────────────── */
/* Vor der Auslosung gibt es keinen Firestore-Spielplan. buildScheduleCatalog
 * muss dann die Platzhalter aus tournament-config.js nutzen, sonst steht in
 * der Spiele-Ansicht „Kein Spielplan verfuegbar", obwohl die Termine
 * feststehen. */
const catalogStart = source.indexOf('function buildScheduleCatalog');
assert.ok(catalogStart > -1, 'buildScheduleCatalog nicht gefunden.');
const catalogBody = source.slice(catalogStart, source.indexOf('\n    /* ---------- Schedule helpers', catalogStart));
assert.match(catalogBody, /APP\.fallbackFixtures/,
  'buildScheduleCatalog muss auf APP.fallbackFixtures zurueckfallen, sonst bleibt die Spiele-Ansicht leer.');
assert.ok(
  catalogBody.indexOf('APP.fallbackFixtures') > catalogBody.indexOf('data?.fixtures'),
  'Der Firestore-Spielplan muss Vorrang vor den Kalender-Platzhaltern haben.'
);

/* ── 7) Service Worker kennt die neue Kaderdatei ────────────────────────── */
const sw = fs.readFileSync(path.join(__dirname, '..', 'service-worker.js'), 'utf8');
for (const file of ['./data-wm2026.js', './data-cl2526.js', './data-cl2627.js']) {
  assert.ok(sw.includes(`'${file}'`),
    `service-worker.js: ${file} fehlt in APP_SHELL – offline waere der Kader nicht verfuegbar.`);
}

console.log('cl preview pool render test passed');
