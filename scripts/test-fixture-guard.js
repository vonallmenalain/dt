#!/usr/bin/env node
/* =============================================================================
 *  scripts/test-fixture-guard.js
 *
 *  Regressionstest fuer den Platzhalter-Guard im Spielplan-Sync.
 *
 *  Hintergrund: nach der Ligaphasen-Auslosung liefert api-football zuerst nur
 *  die PAARUNGEN. Der Spieltag-Kalender folgt Tage spaeter. Bis dahin liegen
 *  alle 144 Ligaphasen-Spiele auf EINEM Datum – so kam die CL 2026/27 am
 *  29.08.2026 herein: Runde "Group Stage", alle Anstoesse am 08.09.2026 21:00,
 *  keine Venue-IDs.
 *
 *  Dieser Stand darf nicht nach Firestore. Sonst laegen in der App 144 Spiele
 *  auf dem ersten Spieltag, "naechstes Spiel" und Countdown waeren falsch, und
 *  der Live-Monitor wuerde am Anpfiff alle 144 Partien gleichzeitig als
 *  Kandidaten oeffnen.
 *
 *  Geprueft wird:
 *    1. Ein Spielplan mit nur einem Anstoss-Tag wird abgelehnt.
 *    2. Der echte Kalender (8 Spieltage) wird akzeptiert.
 *    3. ALLOW_PLACEHOLDER_SCHEDULE laesst den Platzhalter bewusst durch.
 *    4. Turniere mit Gruppenphase (WM 2026) sind vom Guard nicht betroffen.
 *    5. Die Ligaphasen-Spiele werden auch dann gezaehlt, wenn api-football sie
 *       "Group Stage" statt "League Stage - N" nennt.
 *
 *  Aufruf: npm run test:fixture-guard
 * ============================================================================= */

'use strict';

const assert = require('node:assert/strict');
const APP = require('../tournament-config.js');
const {
  assertFixtureSyncIsSafe,
  countLeaguePhaseKickoffDates
} = require('./sync-fixtures.js');

const CL = APP.tournaments.cl2627;
const WM = APP.tournaments.wm2026;

/* Ein Fixture im API-Format, so weit der Guard es anfasst. */
function fixture(round, isoDate, index) {
  return {
    fixture: { id: 900000 + index, date: isoDate, venue: { id: null, name: 'Stadion' } },
    league: { round },
    teams: {
      home: { name: `Klub ${index}A`, logo: 'https://media.api-sports.io/football/teams/1.png' },
      away: { name: `Klub ${index}B`, logo: 'https://media.api-sports.io/football/teams/2.png' }
    }
  };
}

/* 144 Ligaphasen-Spiele, alle am selben Tag – der Platzhalter-Stand. */
function placeholderLeaguePhase(round = 'Group Stage') {
  return Array.from({ length: 144 }, (_, i) => fixture(round, '2026-09-08T21:00:00+02:00', i));
}

/* 144 Ligaphasen-Spiele, verteilt auf die echten Spieltage des Kalenders. */
function realLeaguePhase(round = 'Group Stage') {
  const dates = CL.matchCalendar
    .filter(entry => APP.isLeaguePhaseRound(entry.round))
    .flatMap(entry => entry.dates.map(date => `${date}T${entry.kickoff}:00${entry.offset}`));
  assert.ok(dates.length >= 8, 'Kalender liefert zu wenige Ligaphasen-Termine');
  return Array.from({ length: 144 }, (_, i) => fixture(round, dates[i % dates.length], i));
}

async function expectRejected(label, fixtures, tournament, opts) {
  await assert.rejects(
    () => assertFixtureSyncIsSafe(null, tournament, fixtures, 0, opts),
    /Anstoss-Tag/,
    label
  );
}

async function expectAccepted(label, fixtures, tournament, opts) {
  await assert.doesNotReject(
    () => assertFixtureSyncIsSafe(null, tournament, fixtures, 0, opts),
    label
  );
}

(async () => {
  // 1) Platzhalter-Spielplan wird abgelehnt – in beiden Runden-Schreibweisen.
  await expectRejected('Platzhalter "Group Stage" muss abgelehnt werden',
    placeholderLeaguePhase('Group Stage'), CL, {});
  await expectRejected('Platzhalter "League Stage - 1" muss abgelehnt werden',
    placeholderLeaguePhase('League Stage - 1'), CL, {});

  // 2) Der echte Kalender geht durch.
  await expectAccepted('Echter Spielplan mit 8 Spieltagen muss durchgehen',
    realLeaguePhase('Group Stage'), CL, {});
  await expectAccepted('Echter Spielplan mit "League Stage - N" muss durchgehen',
    realLeaguePhase('League Stage - 1'), CL, {});

  // 3) Bewusstes Opt-out.
  await expectAccepted('ALLOW_PLACEHOLDER_SCHEDULE laesst den Platzhalter durch',
    placeholderLeaguePhase(), CL, { allowPlaceholderSchedule: true });

  // 4) Gruppenphasen-Turniere sind nicht betroffen. Die WM spielt ihre
  //    Gruppenphase ohnehin an vielen Tagen; entscheidend ist, dass der Guard
  //    dort gar nicht erst greift (kein `structure: "league"`).
  assert.equal(WM.structure, undefined, 'WM darf keine league-Struktur haben');
  const wmSameDay = Array.from({ length: 104 }, (_, i) =>
    fixture('Group Stage - 1', '2026-06-11T21:00:00+02:00', i));
  await expectAccepted('WM-Spielplan bleibt vom Guard unberuehrt', wmSameDay, WM, {});

  // 5) Zaehlung der Anstoss-Tage.
  assert.equal(countLeaguePhaseKickoffDates(placeholderLeaguePhase()), 1);
  assert.ok(countLeaguePhaseKickoffDates(realLeaguePhase()) >= CL.leaguePhase.matchesPerTeam);
  // K.-o.-Spiele zaehlen nicht mit – der Guard prueft ausschliesslich die
  // Ligaphase, sonst wuerde ein spaeter Lauf mit vielen K.-o.-Terminen einen
  // immer noch platzhaltrigen Ligaphasen-Kalender kaschieren.
  const knockoutOnly = Array.from({ length: 16 }, (_, i) =>
    fixture('Round of 16', `2027-03-${String(9 + (i % 2)).padStart(2, '0')}T21:00:00+01:00`, i));
  assert.equal(countLeaguePhaseKickoffDates(knockoutOnly), 0);

  console.log('✓ test-fixture-guard: Platzhalter-Spielplaene werden abgelehnt, echte Kalender gehen durch.');
})().catch(err => {
  console.error(`✗ test-fixture-guard: ${err.message}`);
  process.exit(1);
});
