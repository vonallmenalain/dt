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
assert.ok(APP.previewableTournamentKeys.includes('cl2627'),
  'cl2627 muss als Vorschau verfügbar sein.');
assert.ok(APP.previewableTournamentKeys.includes('cl2526'),
  'cl2526 (Teststand) muss als Vorschau verfügbar sein.');
assert.ok(!APP.previewableTournamentKeys.includes('wm2026'),
  'wm2026 (regulär verfügbar) darf nicht als Vorschau gelten.');

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

/* ── 6) Selbstheilung: hängende Vorschau darf die Domain nicht blockieren  */
assert.equal(typeof APP.recoverFromBrokenPreview, 'function',
  'recoverFromBrokenPreview muss exponiert sein.');
// Ohne aktive Vorschau ist die Heilung ein No-op (WM bleibt unberührt).
assert.equal(APP.recoverFromBrokenPreview({ reload: false }), false,
  'Ohne aktive Vorschau: keine Heilung nötig (No-op, false).');
assert.equal(APP.activeTournamentKey, 'wm2026', 'No-op lässt die WM aktiv.');

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
