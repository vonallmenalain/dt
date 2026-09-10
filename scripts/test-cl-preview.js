'use strict';

/* =============================================================================
 *  test-cl-preview.js
 *
 *  Regressionstest für den Preview-Kanal (Meilenstein M3): Admins können
 *  ein nicht freigeschaltetes Turnier über einen geheimen `?preview=`-
 *  Parameter bzw. den Admin-Switcher betrachten, ohne dass es für normale
 *  Nutzer sichtbar/aktiv wird.
 *
 *  Aktuell ist KEIN Turnier als Vorschau hinterlegt: die WM und die CL 26/27
 *  sind beide regulär freigeschaltet, der eingefrorene Teststand cl2526 ist
 *  entfernt. Der Kanal bleibt als Mechanik für das nächste noch gesperrte
 *  Turnier bestehen – dieser Test hält ihn deshalb an zwei Enden fest:
 *  die Steuerfunktionen existieren und verhalten sich korrekt, und ein
 *  regulär verfügbares Turnier rutscht NIE versehentlich in den Kanal.
 *
 *  Läuft ohne Browser: die URL-/localStorage-Kanäle sind in Node inert,
 *  daher werden die exponierten Steuerfunktionen (setPreviewTournament/
 *  clearPreview mit reload:false) direkt geprüft.
 * ============================================================================= */

const assert = require('node:assert/strict');
const APP = require('../tournament-config.js');

/* ── 1) Preview-Fähigkeit korrekt erkannt ─────────────────────────────── */
assert.equal(APP.isTournamentPreviewable('wm2026'), false,
  'wm2026 ist regulär verfügbar → keine Vorschau.');
assert.equal(APP.isTournamentPreviewable('cl2627'), false,
  'cl2627 ist seit der Freischaltung regulär verfügbar → keine Vorschau mehr.');
assert.equal(APP.isTournamentPreviewable('cl2526'), false,
  'Der Teststand cl2526 ist entfernt – es gibt ihn nicht mehr.');
assert.equal(APP.isTournamentPreviewable('gibtsnicht'), false,
  'Unbekannter Key ist nicht als Vorschau verfügbar.');
assert.deepEqual(APP.previewableTournamentKeys, [],
  'Zurzeit ist kein Turnier als Vorschau hinterlegt (alle sind freigeschaltet).');

/* Gegenprobe zur leeren Liste: Sie ist leer, WEIL alle Turniere regulär
 * verfügbar sind – nicht, weil die Regel kaputt wäre. Käme ein gesperrtes
 * Turnier mit Kaderdatei dazu, müsste es sofort previewbar sein. */
assert.deepEqual(
  Object.keys(APP.tournaments).filter((k) => !APP.isTournamentAvailable(k)), [],
  'Es gibt kein gesperrtes Turnier mehr – sonst müsste es in previewableTournamentKeys stehen.'
);

/* ── 2) Ohne aktive Vorschau: reguläre Auflösung ──────────────────────── */
assert.equal(APP.isPreviewActive(), false, 'Ohne Preview: isPreviewActive false.');
assert.equal(APP.activePreviewKey, null, 'Ohne Preview: activePreviewKey null.');
assert.equal(APP.activeTournamentKey, 'wm2026', 'Ohne Preview und ohne window: Fallback aktiv.');
assert.equal(APP.isTournamentLoadable('wm2026'), true, 'Die WM ist ladbar.');
assert.equal(APP.isTournamentLoadable('cl2627'), true,
  'Die freigeschaltete CL ist immer ladbar – auch ohne Vorschau.');
assert.equal(APP.isTournamentLoadable('cl2526'), false,
  'Ein entferntes Turnier ist nie ladbar.');

/* ── 3) Reguläre Turniere sind nicht „previewbar" ─────────────────────── */
/* Der wichtige Teil: Der Kanal darf kein verfügbares Turnier übernehmen –
 * sonst hinge die Produktivseite an einem Preview-Override statt an der
 * Domain-Auflösung. */
assert.equal(APP.setPreviewTournament('wm2026', { reload: false }), false,
  'Ein regulär verfügbares Turnier darf nicht als Vorschau gesetzt werden.');
assert.equal(APP.setPreviewTournament('cl2627', { reload: false }), false,
  'Auch die freigeschaltete CL darf nicht als Vorschau gesetzt werden.');
assert.equal(APP.setPreviewTournament('cl2526', { reload: false }), false,
  'Ein entferntes Turnier darf nicht als Vorschau gesetzt werden.');
assert.equal(APP.setPreviewTournament('gibtsnicht', { reload: false }), false,
  'Ein unbekannter Key darf nicht als Vorschau gesetzt werden.');
assert.equal(APP.isPreviewActive(), false,
  'Nach den abgelehnten Versuchen darf keine Vorschau aktiv sein.');
assert.equal(APP.activeTournamentKey, 'wm2026',
  'Ein abgelehnter Preview-Versuch lässt das aktive Turnier unberührt.');

/* ── 4) Steuerfunktionen bleiben exponiert ────────────────────────────── */
/* nav.js (Admin-Switcher) und data.js hängen an diesen Namen. Verschwindet
 * einer davon, fällt die Vorschau für das nächste gesperrte Turnier
 * stillschweigend aus. */
for (const fn of ['setPreviewTournament', 'clearPreview', 'isPreviewActive',
                  'isTournamentPreviewable', 'getPreviewableTournamentKeys',
                  'isTournamentLoadable', 'recoverFromBrokenPreview']) {
  assert.equal(typeof APP[fn], 'function', `${fn} muss exponiert sein.`);
}

/* ── 5) Vorschau beenden ist ohne aktive Vorschau harmlos ─────────────── */
assert.equal(APP.clearPreview({ reload: false }), true,
  'clearPreview muss auch ohne aktive Vorschau sauber durchlaufen.');
assert.equal(APP.activeTournamentKey, 'wm2026', 'Danach weiterhin der Fallback.');

/* ── 6) Selbstheilung: ohne Vorschau ein No-op ────────────────────────── */
assert.equal(APP.recoverFromBrokenPreview({ reload: false }), false,
  'Ohne aktive Vorschau: keine Heilung nötig (No-op, false).');
assert.equal(APP.activeTournamentKey, 'wm2026', 'No-op lässt den Fallback aktiv.');

console.log('cl preview tests passed');
