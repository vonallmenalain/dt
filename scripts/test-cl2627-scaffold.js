'use strict';

/* =============================================================================
 *  test-cl2627-scaffold.js
 *
 *  Guard für das Champions-League-2026/27-Gerüst (Meilenstein M1).
 *
 *  Das CL-Turnier existiert ab M1 als Config-Block, ist aber noch
 *  vollständig INERT: nicht verfügbar, nicht auswählbar, kein Domain-
 *  Default. Dieser Test schlägt fehl, falls die CL versehentlich
 *  freigeschaltet wird, bevor Daten (data-cl2627.js) und Logik (M2 ff.)
 *  bereit sind, oder falls sie die WM als Default verdrängt.
 *
 *  Läuft ohne Browser/Firebase: tournament-config.js wird als reines
 *  Node-Modul geladen (window undefined → aktives Turnier = Fallback
 *  wm2026).
 * ============================================================================= */

const assert = require('node:assert/strict');
const APP = require('../tournament-config.js');

/* ── 1) CL-Block existiert und hat die erwartete Grundform ─────────────── */
const cl = APP.tournaments && APP.tournaments.cl2627;
assert.ok(cl, 'cl2627-Block fehlt in TOURNAMENTS.');
assert.equal(cl.key, 'cl2627', 'cl2627.key falsch.');
assert.equal(cl.type, 'CL', 'cl2627.type soll "CL" sein.');
assert.equal(cl.structure, 'league', 'CL muss structure "league" haben (Ligaphase).');
assert.equal(cl.primaryEntity, 'club', 'CL muss club-zentriert sein (primaryEntity "club").');
assert.equal(cl.captainMultiplier, 1.5, 'CL-Captain-Multiplikator soll 1.5 sein.');
assert.equal(cl.api.competitionId, 2, 'CL API competitionId soll 2 (Champions League) sein.');
assert.ok(Array.isArray(cl.defaultDomains) && cl.defaultDomains.includes('dt.alae.app'),
  'cl2627.defaultDomains soll dt.alae.app enthalten.');
assert.ok(cl.defaultActiveFrom, 'cl2627.defaultActiveFrom muss gesetzt sein.');

/* ── 2) CL ist INERT: nicht verfügbar, nicht auswählbar ────────────────── */
assert.equal(cl.available, false, 'cl2627 darf (noch) nicht available sein.');
assert.equal(cl.dataReady, false, 'cl2627 darf (noch) nicht dataReady sein.');
assert.equal(APP.isTournamentAvailable('cl2627'), false, 'cl2627 darf nicht verfügbar sein.');
assert.ok(!APP.availableTournamentKeys.includes('cl2627'),
  'cl2627 darf nicht in availableTournamentKeys auftauchen.');

/* ── 3) WM bleibt aktiv und Default ────────────────────────────────────── */
assert.equal(APP.activeTournamentKey, 'wm2026', 'Aktives Turnier muss wm2026 bleiben.');
assert.equal(APP.primaryEntity, 'nation', 'WM bleibt nation-zentriert (Default).');
assert.equal(APP.domainDefaultKey, 'wm2026', 'Domain-Default muss wm2026 bleiben.');
assert.deepEqual(APP.availableTournamentKeys, ['wm2026'],
  'Nur wm2026 darf verfügbar sein.');

/* ── 4) Zeit-Default ist dormant, solange die CL nicht available ist ───── */
/* Selbst mit korrekter Domain und einem Zeitpunkt NACH dem Stichtag darf
 * die CL nicht als Domain-Default greifen, weil sie (noch) gesperrt ist. */
assert.equal(typeof APP.resolveScheduledDomainKey, 'function',
  'resolveScheduledDomainKey sollte exponiert sein.');
const afterDraw = new Date('2026-09-01T12:00:00+02:00').getTime();
assert.equal(
  APP.resolveScheduledDomainKey('dt.alae.app', afterDraw),
  null,
  'Solange cl2627 nicht available ist, darf der Zeit-Default nicht greifen.'
);

console.log('cl2627 scaffold test passed');
