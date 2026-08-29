'use strict';

/* =============================================================================
 *  test-cl-preview.js
 *
 *  Regressionstest für den Preview-Kanal (Meilenstein M3): Admins können
 *  ein nicht freigeschaltetes Turnier über einen geheimen `?preview=`-
 *  Parameter bzw. den Admin-Switcher betrachten, ohne dass es für normale
 *  Nutzer sichtbar/aktiv wird.
 *
 *  Beispiel-Turnier ist der eingefrorene Teststand cl2526. Bis zur
 *  Freischaltung am 29.08.2026 war das die cl2627 – die ist jetzt regulär
 *  verfügbar und damit bewusst NICHT mehr previewbar (siehe unten).
 *
 *  Läuft ohne Browser: die URL-/localStorage-Kanäle sind in Node inert,
 *  daher werden die exponierten Steuerfunktionen (setPreviewTournament/
 *  clearPreview mit reload:false) direkt geprüft.
 * ============================================================================= */

const assert = require('node:assert/strict');
const APP = require('../tournament-config.js');

/* ── 1) Preview-Fähigkeit korrekt erkannt ─────────────────────────────── */
assert.equal(APP.isTournamentPreviewable('cl2526'), true,
  'cl2526 (available:false, mit dataFile) muss als Vorschau verfügbar sein.');
assert.equal(APP.isTournamentPreviewable('wm2026'), false,
  'wm2026 ist regulär verfügbar → keine Vorschau.');
assert.equal(APP.isTournamentPreviewable('cl2627'), false,
  'cl2627 ist seit der Freischaltung regulär verfügbar → keine Vorschau mehr.');
assert.equal(APP.isTournamentPreviewable('gibtsnicht'), false,
  'Unbekannter Key ist nicht als Vorschau verfügbar.');
assert.deepEqual(APP.previewableTournamentKeys, ['cl2526'],
  'Als Vorschau bleibt nur der eingefrorene Teststand cl2526.');

/* ── 2) Ohne aktive Vorschau: Fallback aktiv, Teststand nicht ladbar ──── */
assert.equal(APP.isPreviewActive(), false, 'Ohne Preview: isPreviewActive false.');
assert.equal(APP.activePreviewKey, null, 'Ohne Preview: activePreviewKey null.');
assert.equal(APP.activeTournamentKey, 'wm2026', 'Ohne Preview und ohne window: Fallback aktiv.');
assert.equal(APP.isTournamentLoadable('wm2026'), true, 'Die WM ist ladbar.');
assert.equal(APP.isTournamentLoadable('cl2627'), true,
  'Die freigeschaltete CL ist immer ladbar – auch ohne Vorschau.');
assert.equal(APP.isTournamentLoadable('cl2526'), false,
  'cl2526 ist ohne aktive Vorschau NICHT ladbar (data.js fällt sonst zurück).');

/* ── 3) Vorschau aktivieren ───────────────────────────────────────────── */
assert.equal(APP.setPreviewTournament('cl2526', { reload: false }), true,
  'Vorschau auf cl2526 muss aktivierbar sein.');
assert.equal(APP.isPreviewActive(), true, 'Nach Aktivierung: isPreviewActive true.');
assert.equal(APP.activePreviewKey, 'cl2526', 'activePreviewKey ist cl2526.');
assert.equal(APP.activeTournamentKey, 'cl2526', 'Aktives Turnier ist nun cl2526.');
assert.equal(APP.key, 'cl2526', 'APP.key folgt dem Vorschau-Turnier.');
assert.equal(APP.isTournamentLoadable('cl2526'), true,
  'Im Preview ist cl2526 ladbar → data.js lädt data-cl2526.js.');

/* ── 4) Reguläres Turnier ist nicht „previewbar" ──────────────────────── */
assert.equal(APP.setPreviewTournament('wm2026', { reload: false }), false,
  'Ein regulär verfügbares Turnier darf nicht als Vorschau gesetzt werden.');
assert.equal(APP.setPreviewTournament('cl2627', { reload: false }), false,
  'Auch die freigeschaltete CL darf nicht mehr als Vorschau gesetzt werden.');

/* ── 5) Vorschau beenden → zurück zur regulären Auflösung ─────────────── */
assert.equal(APP.clearPreview({ reload: false }), true, 'Vorschau muss beendbar sein.');
assert.equal(APP.isPreviewActive(), false, 'Nach Beenden: isPreviewActive false.');
assert.equal(APP.activePreviewKey, null, 'Nach Beenden: activePreviewKey null.');
assert.equal(APP.activeTournamentKey, 'wm2026', 'Nach Beenden: wieder der Fallback.');
assert.equal(APP.isTournamentLoadable('cl2526'), false,
  'Nach Beenden ist cl2526 wieder nicht ladbar.');

/* ── 6) Selbstheilung: hängende Vorschau darf die Domain nicht blockieren  */
assert.equal(typeof APP.recoverFromBrokenPreview, 'function',
  'recoverFromBrokenPreview muss exponiert sein.');
// Ohne aktive Vorschau ist die Heilung ein No-op (WM bleibt unberührt).
assert.equal(APP.recoverFromBrokenPreview({ reload: false }), false,
  'Ohne aktive Vorschau: keine Heilung nötig (No-op, false).');
assert.equal(APP.activeTournamentKey, 'wm2026', 'No-op lässt den Fallback aktiv.');

/* ── 7) Bewusst aktivierte Vorschau bleibt bestehen (kein Auto-Rückfall) ─ */
// setPreviewTournament markiert die Vorschau als bewusst gewollt (Session-
// Intent). recoverFromBrokenPreview darf eine solche Vorschau NICHT
// wegbouncen – der Admin will sie sehen, auch wenn Daten fehlen; dort greift
// stattdessen der sichtbare Hinweis-Banner mit 1-Klick-Ausstieg (nav.js).
assert.equal(APP.setPreviewTournament('cl2526', { reload: false }), true,
  'Vorschau cl2526 (Teststand) muss aktivierbar sein.');
assert.equal(APP.activeTournamentKey, 'cl2526', 'cl2526-Vorschau ist aktiv.');
assert.equal(APP.recoverFromBrokenPreview({ reload: false }), false,
  'Bewusst aktivierte Vorschau bleibt bestehen (kein Auto-Rückfall).');
assert.equal(APP.activeTournamentKey, 'cl2526',
  'Bewusst aktivierte Vorschau bleibt trotz Heilungsversuch aktiv.');

// Absicht zurücknehmen (clearPreview leert Override + Intent) und WM wieder
// als Domain-Default bestätigen.
assert.equal(APP.clearPreview({ reload: false }), true, 'Vorschau erneut beendbar.');
assert.equal(APP.activeTournamentKey, 'wm2026', 'Nach Beenden wieder WM aktiv.');
assert.equal(APP.recoverFromBrokenPreview({ reload: false }), false,
  'Ohne Vorschau erneut No-op.');

console.log('cl preview tests passed');
