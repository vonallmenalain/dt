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
// Die CL hat keinen Captain: das Flag schaltet ihn ab, und ein eigener
// Multiplikator darf gar nicht erst konfiguriert sein (sonst gäbe es eine
// zweite, widersprüchliche Quelle neben dem Flag).
assert.equal(cl.captainEnabled, false, 'CL darf kein Captain-Feature haben.');
assert.equal(cl.captainMultiplier, undefined,
  'CL darf keinen eigenen Captain-Multiplikator konfigurieren.');
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

/* ── 3b) Spielkalender 2026/27: Termine stehen, Paarungen nicht ────────── */
/* Die Termine der Ligaphase und der K.-o.-Runden sind veröffentlicht, die
 * Auslosung fehlt noch. Der Kalender hält sie fest, die daraus abgeleiteten
 * Platzhalter zeigen sie an, bis der Spielplan-Sync echte Spiele liefert. */
assert.ok(Array.isArray(cl.matchCalendar) && cl.matchCalendar.length,
  'cl2627.matchCalendar muss die feststehenden Spieltermine enthalten.');

const leagueStageEntries = cl.matchCalendar.filter((e) => /^League Stage - \d$/.test(e.round));
assert.equal(leagueStageEntries.length, 8,
  'Die Ligaphase hat 8 Spieltage – matchCalendar muss alle acht führen.');

// Runden-Texte müssen von der zentralen Klassifikation als TURNIER-Spiele
// erkannt werden. Rutschte eine Runde in die Qualifikation, würde
// sync-fixtures.js die Spiele später verwerfen (siehe test-cl-fixture-scope).
for (const entry of cl.matchCalendar) {
  assert.equal(APP.isQualificationFixtureFor('cl2627', entry.round), false,
    `Kalenderrunde "${entry.round}" darf nicht als Qualifikation gelten.`);
  assert.ok(Array.isArray(entry.dates) && entry.dates.length,
    `Kalenderrunde "${entry.round}" braucht mindestens ein Datum.`);
}

// Genau eine Final-Runde, als Einzelspiel (alle anderen sind Hin/Rück).
const finals = cl.matchCalendar.filter((e) => e.round === 'Final');
assert.equal(finals.length, 1, 'Es darf genau eine Final-Runde im Kalender geben.');
assert.equal(finals[0].dates.length, 1, 'Der Final ist ein Einzelspiel an einem Datum.');

// Platzhalter-Spiele: eine Karte pro Spieltag-Datum, chronologisch nutzbar
// und noch ohne Paarung (Auslosung offen).
const expectedPlaceholders = cl.matchCalendar.reduce((sum, e) => sum + e.dates.length, 0);
assert.equal(cl.fallbackFixtures.length, expectedPlaceholders,
  'Zu jedem Spieltag-Datum gehört genau ein Platzhalter-Spiel.');
const ids = new Set(cl.fallbackFixtures.map((f) => f.id));
assert.equal(ids.size, cl.fallbackFixtures.length, 'Platzhalter-IDs müssen eindeutig sein.');
for (const fixture of cl.fallbackFixtures) {
  assert.equal(fixture.teamA, 'TBD', 'Vor der Auslosung steht keine Paarung fest.');
  assert.equal(fixture.teamB, 'TBD', 'Vor der Auslosung steht keine Paarung fest.');
  assert.equal(fixture.statusShort, 'NS', 'Platzhalter sind noch nicht angepfiffen.');
  assert.ok(Number.isFinite(new Date(fixture.date).getTime()),
    `Platzhalter-Datum "${fixture.date}" ist kein gültiger Zeitpunkt.`);
}

// Der Team-Bau-Deadline hängt am ersten Ligaphasen-Spiel – beides muss
// zusammenpassen, sonst liefe der Reveal an der Realität vorbei.
const firstKickoff = cl.fallbackFixtures
  .map((f) => new Date(f.date).getTime())
  .sort((a, b) => a - b)[0];
assert.equal(new Date(cl.DREAMTEAM_START).getTime(), firstKickoff,
  'DREAMTEAM_START muss dem ersten Spieltermin des Kalenders entsprechen.');
assert.ok(new Date(cl.AUTO_POINTS_FROM).getTime() < firstKickoff,
  'Das Auto-Punkte-Fenster muss vor dem ersten Anpfiff öffnen.');
const lastKickoff = cl.fallbackFixtures
  .map((f) => new Date(f.date).getTime())
  .sort((a, b) => b - a)[0];
assert.ok(new Date(cl.AUTO_POINTS_UNTIL).getTime() > lastKickoff,
  'Das Auto-Punkte-Fenster muss den Final noch abdecken.');

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
