'use strict';

/* =============================================================================
 *  test-cl2627-scaffold.js
 *
 *  Guard für den Champions-League-2026/27-Config-Block.
 *
 *  Bis zur Freischaltung am 29.08.2026 hat dieser Test bewacht, dass die CL
 *  vollständig INERT bleibt. Jetzt ist sie das produktive Turnier, und der
 *  Test bewacht die Gegenrichtung: dass sie freigeschaltet bleibt, dass
 *  dt.alae.app auf sie defaultet, und dass die Turnierstruktur (Ligaphase,
 *  club-zentriert, kein Captain) und der Spielkalender unverändert stimmen.
 *
 *  Läuft ohne Browser/Firebase: tournament-config.js wird als reines
 *  Node-Modul geladen. Ohne `window` gibt es keinen Hostname, deshalb ist
 *  das aktive Turnier dort der Fallback (wm2026) – die Domain-Auflösung
 *  wird unten explizit mit einem Hostnamen geprüft.
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

/* ── 2) CL ist freigeschaltet ──────────────────────────────────────────── */
assert.equal(cl.available, true, 'cl2627 muss available sein.');
assert.equal(cl.dataReady, true, 'cl2627 muss dataReady sein.');
assert.equal(APP.isTournamentAvailable('cl2627'), true, 'cl2627 muss verfügbar sein.');
assert.ok(APP.availableTournamentKeys.includes('cl2627'),
  'cl2627 muss in availableTournamentKeys auftauchen.');
assert.equal(cl.archived, undefined, 'Das laufende Turnier darf kein Archiv sein.');

/* ── 3) WM bleibt als Archiv erreichbar ────────────────────────────────── */
/* Die WM ist gespielt, verschwindet aber nicht: sie bleibt verfügbar, damit
 * angemeldete Nutzer Rangliste und Resultate nachlesen können. Schreibschutz
 * und Umschalter siehe test-tournament-archive.js. */
assert.equal(APP.isTournamentAvailable('wm2026'), true, 'wm2026 muss als Archiv verfügbar bleiben.');
assert.equal(APP.isTournamentArchived('wm2026'), true, 'wm2026 muss als Archiv markiert sein.');
assert.deepEqual(APP.availableTournamentKeys.slice().sort(), ['cl2627', 'wm2026'],
  'Verfügbar sind genau die CL und die WM – der Teststand cl2526 nie.');

/* In Node gibt es keinen Hostname; das aktive Turnier ist deshalb weiterhin
 * der globale Fallback. Wichtig, damit die Cron-Skripte nicht versehentlich
 * über diesen Weg aufgelöst werden (sie nutzen serverTournamentKey). */
assert.equal(APP.activeTournamentKey, 'wm2026',
  'Ohne window bleibt der globale Fallback das aktive Turnier.');

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

/* ── 3c) Auslosungs-Töpfe: 4 × 9, deckungsgleich mit dem Klub-Pool ─────── */
/* leaguePhase.drawPots sortiert die 0er-Ligatabelle vor dem ersten Anpfiff
 * (Topf 1–4, innerhalb des Topfs Prognose-Reihenfolge). Die Namen müssen
 * exakt die api-football-Klubs des Turniers treffen – ein Tippfehler würde
 * den Klub still ans Tabellenende (alphabetischer Rest) rutschen lassen. */
const drawPots = cl.leaguePhase && cl.leaguePhase.drawPots;
assert.ok(Array.isArray(drawPots) && drawPots.length === 4,
  'cl2627.leaguePhase.drawPots muss genau 4 Töpfe enthalten.');
assert.deepEqual(drawPots.map((p) => p.pot), [1, 2, 3, 4],
  'Die Töpfe müssen als 1–4 nummeriert und aufsteigend sortiert sein.');

const potTeamKeys = [];
for (const pot of drawPots) {
  assert.ok(Array.isArray(pot.teams) && pot.teams.length === 9,
    `Topf ${pot.pot} muss genau 9 Klubs enthalten.`);
  pot.teams.forEach((name) => potTeamKeys.push(APP.normalizeTeamName(name)));
}
assert.equal(new Set(potTeamKeys).size, 36,
  'Die 4 Töpfe müssen zusammen 36 verschiedene Klubs ergeben.');

const poolClubs = require('./cl-pool-cl2627-clubs.json').clubs;
const poolKeys = new Set(poolClubs.map((c) => APP.normalizeTeamName(c.name)));
for (const key of potTeamKeys) {
  assert.ok(poolKeys.has(key),
    `Topf-Klub "${key}" fehlt im Klub-Pool (cl-pool-cl2627-clubs.json) – Tippfehler?`);
}

/* ── 4) Zeit-Default: dt.alae.app zeigt ab dem Stichtag die CL ─────────── */
assert.equal(typeof APP.resolveScheduledDomainKey, 'function',
  'resolveScheduledDomainKey sollte exponiert sein.');
const afterDraw = new Date('2026-09-01T12:00:00+02:00').getTime();
assert.equal(
  APP.resolveScheduledDomainKey('dt.alae.app', afterDraw),
  'cl2627',
  'dt.alae.app muss ab dem Stichtag auf die CL defaulten.'
);
/* Vor dem Stichtag greift der Zeit-Default nicht – dann gilt weiter das
 * statische Domain-Mapping. Die Kette bleibt damit lückenlos. */
assert.equal(
  APP.resolveScheduledDomainKey('dt.alae.app', new Date(cl.defaultActiveFrom).getTime() - 1),
  null,
  'Vor defaultActiveFrom darf der Zeit-Default nicht greifen.'
);
/* Fremde Domains bleiben unberührt. */
assert.equal(APP.resolveScheduledDomainKey('localhost', afterDraw), null,
  'Der Zeit-Default gilt nur für die konfigurierten Domains.');

console.log('cl2627 scaffold test passed');
