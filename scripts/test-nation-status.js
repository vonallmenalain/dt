'use strict';

/* =============================================================================
 *  scripts/test-nation-status.js
 *
 *  Regressionstest für APP_CONFIG.getNationStatus (computeTournamentNationStatus
 *  in tournament-config.js) – die Berechnung von "Spieler noch im Turnier".
 *
 *  Hintergrund: Vor dem Fix wurde der Nationen-Status rein aus den Fixtures
 *  abgeleitet. K.-o.-Spiele mit noch unbenanntem Gegner (z. B. "Dritter X/Y/Z")
 *  wurden komplett ignoriert, sodass qualifizierte Gruppenerste/-zweite, die in
 *  den Sechzehntelfinals gegen einen Drittplatzierten-Platzhalter antreten,
 *  fälschlich als ausgeschieden galten. Bei einem Beispiel-Team standen so nur
 *  7/15 statt korrekt 14/15 Spieler im Turnier.
 *
 *  Der Test baut den Endstand der WM-2026-Gruppenphase nach (alle Gruppen
 *  fertig gespielt) und prüft, dass exakt die Gruppen-Ersten/-Zweiten plus die
 *  8 besten Gruppendritten im Turnier sind und alle Vierten / die 4 schlechtesten
 *  Dritten ausgeschieden sind. Zusätzlich werden K.-o.-Progression und der
 *  TBD-Gegner-Fall abgedeckt.
 * ============================================================================= */

const assert = require('node:assert/strict');
const APP = require('../tournament-config.js');

assert.equal(APP.activeTournamentKey, 'wm2026', 'Test erwartet aktives Turnier wm2026.');

/* ─────────────────────────────────────────────────────────────────────────────
 *  Hilfsfunktion: erzeugt für eine 4er-Gruppe 6 Fixtures gemäss WM-Pairing-
 *  Muster. Höher gesetzte Teams gewinnen. Über `thirdStrength` wird die
 *  Tordifferenz des Gruppendritten gesteuert ('strong' → -1, 'weak' → -3),
 *  um die Reihenfolge der Drittplatzierten über alle Gruppen hinweg zu
 *  bestimmen.
 *
 *  seeds = [s1, s2, s3, s4]  (s1 = stärkstes Team)
 *   → Endstand: s1 9 Pkt, s2 6 Pkt, s3 3 Pkt, s4 0 Pkt.
 * ───────────────────────────────────────────────────────────────────────────── */
function makeGroupFixtures(letter, seeds, thirdStrength) {
  const [s1, s2, s3, s4] = seeds;
  const thirdWin = thirdStrength === 'weak' ? 1 : 3; // s3 schlägt s4

  const fx = (round, home, away, hg, ag) => ({
    league: { round: `Group ${letter} - ${round}` },
    status: { short: 'FT' },
    homeTeam: { name: home, winner: hg > ag },
    awayTeam: { name: away, winner: ag > hg },
    goals: { home: hg, away: ag }
  });

  return [
    // Spieltag 1: (1,2) / (3,4)
    fx(1, s1, s2, 2, 0),
    fx(1, s3, s4, thirdWin, 0),
    // Spieltag 2: (4,2) / (1,3)
    fx(2, s4, s2, 0, 2),
    fx(2, s1, s3, 2, 0),
    // Spieltag 3: (4,1) / (2,3)
    fx(3, s4, s1, 0, 2),
    fx(3, s2, s3, 2, 0)
  ];
}

// Gruppen-Setups. "strong"-Gruppen liefern qualifizierende Dritte (8 Stück),
// "weak"-Gruppen die 4 schlechtesten Dritten (ausgeschieden).
const GROUP_SETUPS = [
  { letter: 'A', seeds: ['Mexico', 'South Africa', 'Korea Republic', 'Czechia'], third: 'weak' },
  { letter: 'B', seeds: ['Switzerland', 'Canada', 'Bosnia and Herzegovina', 'Qatar'], third: 'strong' },
  { letter: 'C', seeds: ['Brazil', 'Morocco', 'Scotland', 'Haiti'], third: 'weak' },
  { letter: 'D', seeds: ['USA', 'Australia', 'Paraguay', 'Turkiye'], third: 'strong' },
  { letter: 'E', seeds: ['Germany', 'Ivory Coast', 'Ecuador', 'Curacao'], third: 'strong' },
  { letter: 'F', seeds: ['Netherlands', 'Japan', 'Sweden', 'Tunisia'], third: 'strong' },
  { letter: 'G', seeds: ['Belgium', 'Egypt', 'Iran', 'New Zealand'], third: 'weak' },
  { letter: 'H', seeds: ['Spain', 'Cape Verde', 'Uruguay', 'Saudi Arabia'], third: 'weak' },
  { letter: 'I', seeds: ['France', 'Norway', 'Senegal', 'Iraq'], third: 'strong' },
  { letter: 'J', seeds: ['Argentina', 'Austria', 'Algeria', 'Jordan'], third: 'strong' },
  { letter: 'K', seeds: ['Colombia', 'Portugal', 'DR Congo', 'Uzbekistan'], third: 'strong' },
  { letter: 'L', seeds: ['England', 'Croatia', 'Ghana', 'Panama'], third: 'strong' }
];

function buildCompletedGroupStage() {
  const fixtures = {};
  let id = 1;
  GROUP_SETUPS.forEach((setup) => {
    makeGroupFixtures(setup.letter, setup.seeds, setup.third).forEach((fixture) => {
      fixtures[`g${id++}`] = fixture;
    });
  });
  return fixtures;
}

// Das Beispiel-Team aus dem Bug-Report (15 Spieler / Nationen).
const EXAMPLE_TEAM_NATIONS = [
  'France', 'Brazil', 'Spain', 'Netherlands', 'Portugal', 'Belgium',
  'Switzerland', 'Germany', 'Senegal', 'England', 'Canada', 'Argentina',
  'USA', 'Turkiye', 'Mexico'
];

/* ─────────────────────────────────────────────────────────────────────────────
 *  Szenario 0: Gruppenphase noch nicht abgeschlossen → konservativ alle aktiv.
 * ───────────────────────────────────────────────────────────────────────────── */
(function testGroupStageInProgress() {
  const fixtures = buildCompletedGroupStage();
  // Ein Gruppenspiel auf "geplant" zurücksetzen → Gruppe A nicht fertig.
  fixtures.g1 = { ...fixtures.g1, status: { short: 'NS' } };

  const status = APP.getNationStatus(fixtures);
  assert.equal(status.allGroupsComplete, false, 'Gruppenphase darf nicht als abgeschlossen gelten.');
  const players = EXAMPLE_TEAM_NATIONS.map((n) => ({ nation: n }));
  assert.equal(
    status.countActivePlayers(players, (p) => p.nation),
    15,
    'Solange nicht alle Gruppen fertig sind, gilt niemand als ausgeschieden.'
  );
  assert.equal(status.isNationAlive('Turkiye'), true, 'Türkiye vor Abschluss noch aktiv.');
})();

/* ─────────────────────────────────────────────────────────────────────────────
 *  Szenario 1: Gruppenphase komplett, K.-o. noch nicht in den Fixtures.
 *  Erwartung: 14/15 Spieler im Turnier (nur Türkiye als Gruppenvierter raus).
 * ───────────────────────────────────────────────────────────────────────────── */
const completedStatus = (function testCompletedGroupStage() {
  const fixtures = buildCompletedGroupStage();
  const status = APP.getNationStatus(fixtures);

  assert.equal(status.allGroupsComplete, true, 'Alle Gruppen sollten als abgeschlossen gelten.');

  const players = EXAMPLE_TEAM_NATIONS.map((n) => ({ nation: n }));
  const active = status.countActivePlayers(players, (p) => p.nation);
  assert.equal(active, 14, `Erwartet 14/15 aktive Spieler, erhalten ${active}.`);

  // Türkiye (Gruppe D, 4.) ist als Einzige ausgeschieden.
  assert.equal(status.isNationAlive('Turkiye'), false, 'Türkiye ist als Gruppenvierter ausgeschieden.');
  // Alias "Turkey" muss ebenfalls als ausgeschieden erkannt werden.
  assert.equal(status.isNationAlive('Turkey'), false, 'Türkiye-Alias "Turkey" ebenfalls ausgeschieden.');

  EXAMPLE_TEAM_NATIONS.filter((n) => n !== 'Turkiye').forEach((nation) => {
    assert.equal(status.isNationAlive(nation), true, `${nation} sollte noch im Turnier sein.`);
  });

  // Gruppendritter, die NICHT zu den besten 8 gehören, sind ausgeschieden …
  ['Korea Republic', 'Scotland', 'Iran', 'Uruguay'].forEach((nation) => {
    assert.equal(status.isNationAlive(nation), false, `${nation} (schwacher Gruppendritter) ist raus.`);
  });
  // … die 8 besten Gruppendritten sind drin.
  ['Bosnia and Herzegovina', 'Paraguay', 'Ecuador', 'Sweden', 'Senegal', 'Algeria', 'DR Congo', 'Ghana']
    .forEach((nation) => {
      assert.equal(status.isNationAlive(nation), true, `${nation} (bester Gruppendritter) ist drin.`);
    });

  // Alle Gruppenvierten sind ausgeschieden.
  ['Czechia', 'Qatar', 'Haiti', 'Turkiye', 'Curacao', 'Tunisia', 'New Zealand', 'Saudi Arabia', 'Iraq', 'Jordan', 'Uzbekistan', 'Panama']
    .forEach((nation) => {
      assert.equal(status.isNationAlive(nation), false, `${nation} (Gruppenvierter) ist raus.`);
    });

  // Genau 32 Nationen (12 Gruppenerste + 12 Gruppenzweite + 8 beste Dritte)
  // erreichen die Sechzehntelfinals.
  assert.equal(status.aliveKeys.size, 32, `Erwartet 32 aktive Nationen, erhalten ${status.aliveKeys.size}.`);

  return status;
})();

/* ─────────────────────────────────────────────────────────────────────────────
 *  Szenario 2: Sechzehntelfinals teils gespielt / teils mit TBD-Gegner.
 *   - Brazil verliert sein K.-o.-Spiel → ausgeschieden.
 *   - Germany spielt gegen einen noch unbenannten Gegner ("") → bleibt aktiv
 *     (das war der ursprüngliche Bug: benannte Seite wurde fälschlich raus
 *     gewertet, weil der Gegner-Platzhalter leer war).
 * ───────────────────────────────────────────────────────────────────────────── */
(function testKnockoutProgression() {
  const fixtures = buildCompletedGroupStage();

  // Brazil (Gruppe C, 1.) verliert im Sechzehntelfinal gegen Morocco.
  fixtures.ko_brazil = {
    league: { round: 'Round of 32' },
    status: { short: 'FT' },
    homeTeam: { name: 'Brazil', winner: false },
    awayTeam: { name: 'Morocco', winner: true },
    goals: { home: 0, away: 1 }
  };

  // Germany (Gruppe E, 1.) vs. noch unbenannter Gegner (TBD), geplant.
  fixtures.ko_germany = {
    league: { round: 'Round of 32' },
    status: { short: 'NS' },
    homeTeam: { name: 'Germany', winner: null },
    awayTeam: { name: '', winner: null },
    goals: { home: null, away: null }
  };

  const status = APP.getNationStatus(fixtures);

  assert.equal(status.isNationAlive('Brazil'), false, 'Brazil ist nach K.-o.-Niederlage ausgeschieden.');
  assert.equal(status.isNationAlive('Morocco'), true, 'Morocco bleibt nach K.-o.-Sieg im Turnier.');
  assert.equal(status.isNationAlive('Germany'), true, 'Germany bleibt trotz TBD-Gegner im Turnier.');
  assert.equal(status.isNationAlive('Turkiye'), false, 'Türkiye bleibt ausgeschieden.');

  const players = EXAMPLE_TEAM_NATIONS.map((n) => ({ nation: n }));
  const active = status.countActivePlayers(players, (p) => p.nation);
  assert.equal(active, 13, `Nach Brazils Aus erwartet 13/15 aktive Spieler, erhalten ${active}.`);
})();

/* ─────────────────────────────────────────────────────────────────────────────
 *  Szenario 3: Penalty-Entscheidung ohne Tordifferenz – Sieger via winner-Flag.
 * ───────────────────────────────────────────────────────────────────────────── */
(function testPenaltyDecision() {
  const fixtures = buildCompletedGroupStage();
  fixtures.ko_pen = {
    league: { round: 'Round of 16' },
    status: { short: 'PEN' },
    homeTeam: { name: 'France', winner: false },
    awayTeam: { name: 'Spain', winner: true },
    goals: { home: 1, away: 1 } // regulär unentschieden, Sieger nur über winner-Flag
  };

  const status = APP.getNationStatus(fixtures);
  assert.equal(status.isNationAlive('France'), false, 'France scheidet nach verlorenem Elfmeterschiessen aus.');
  assert.equal(status.isNationAlive('Spain'), true, 'Spain gewinnt das Elfmeterschiessen und bleibt drin.');
})();

console.log('nation-status regression tests passed');
