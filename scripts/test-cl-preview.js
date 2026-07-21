'use strict';

/* =============================================================================
 *  test-cl-preview.js
 *
 *  Regressionstest für den Preview-Kanal (Meilenstein M3): Admins können
 *  ein noch nicht freigeschaltetes Turnier (z. B. cl2627) über einen
 *  geheimen `?preview=`-Parameter bzw. den Admin-Switcher betrachten,
 *  ohne dass es für normale Nutzer sichtbar/aktiv wird.
 *
 *  Läuft ohne Browser: die URL-/localStorage-Kanäle sind in Node inert,
 *  daher werden die exponierten Steuerfunktionen (setPreviewTournament/
 *  clearPreview mit reload:false) direkt geprüft.
 * ============================================================================= */

const assert = require('node:assert/strict');
const APP = require('../tournament-config.js');

/* ── 1) Preview-Fähigkeit korrekt erkannt ─────────────────────────────── */
assert.equal(APP.isTournamentPreviewable('cl2627'), true,
  'cl2627 (available:false, mit dataFile) muss als Vorschau verfügbar sein.');
assert.equal(APP.isTournamentPreviewable('wm2026'), false,
  'wm2026 ist regulär verfügbar → keine Vorschau.');
assert.equal(APP.isTournamentPreviewable('gibtsnicht'), false,
  'Unbekannter Key ist nicht als Vorschau verfügbar.');
assert.deepEqual(APP.previewableTournamentKeys, ['cl2627'],
  'Nur cl2627 ist aktuell als Vorschau verfügbar.');

/* ── 2) Ohne aktive Vorschau: WM aktiv, CL nicht ladbar ───────────────── */
assert.equal(APP.isPreviewActive(), false, 'Ohne Preview: isPreviewActive false.');
assert.equal(APP.activePreviewKey, null, 'Ohne Preview: activePreviewKey null.');
assert.equal(APP.activeTournamentKey, 'wm2026', 'Ohne Preview: WM aktiv.');
assert.equal(APP.isTournamentLoadable('wm2026'), true, 'WM ist ladbar.');
assert.equal(APP.isTournamentLoadable('cl2627'), false,
  'cl2627 ist ohne aktive Vorschau NICHT ladbar (data.js fällt sonst auf WM zurück).');

/* ── 3) Vorschau aktivieren ───────────────────────────────────────────── */
assert.equal(APP.setPreviewTournament('cl2627', { reload: false }), true,
  'Vorschau auf cl2627 muss aktivierbar sein.');
assert.equal(APP.isPreviewActive(), true, 'Nach Aktivierung: isPreviewActive true.');
assert.equal(APP.activePreviewKey, 'cl2627', 'activePreviewKey ist cl2627.');
assert.equal(APP.activeTournamentKey, 'cl2627', 'Aktives Turnier ist nun cl2627.');
assert.equal(APP.key, 'cl2627', 'APP.key folgt dem Vorschau-Turnier.');
assert.equal(APP.isTournamentLoadable('cl2627'), true,
  'Im Preview ist cl2627 ladbar → data.js lädt data-cl2627.js statt WM.');

/* ── 4) Reguläres Turnier ist nicht „previewbar" ──────────────────────── */
assert.equal(APP.setPreviewTournament('wm2026', { reload: false }), false,
  'Ein regulär verfügbares Turnier darf nicht als Vorschau gesetzt werden.');

/* ── 5) Vorschau beenden → zurück zum Domain-Default (WM) ─────────────── */
assert.equal(APP.clearPreview({ reload: false }), true, 'Vorschau muss beendbar sein.');
assert.equal(APP.isPreviewActive(), false, 'Nach Beenden: isPreviewActive false.');
assert.equal(APP.activePreviewKey, null, 'Nach Beenden: activePreviewKey null.');
assert.equal(APP.activeTournamentKey, 'wm2026', 'Nach Beenden: WM wieder aktiv.');
assert.equal(APP.isTournamentLoadable('cl2627'), false,
  'Nach Beenden ist cl2627 wieder nicht ladbar.');

console.log('cl preview tests passed');
