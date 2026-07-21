'use strict';

/* =============================================================================
 *  test-cl-league-status.js
 *
 *  Regressionstest für die Ligaphasen-Logik (Meilenstein M2a):
 *  APP_CONFIG.computeLeagueStatus (structure "league", z. B. CL 2026/27).
 *
 *  Nutzt SYNTHETISCHE Fixtures und überschreibt die Ligaphasen-Parameter
 *  per opts, damit die Rang-Grenzen mit wenigen Spielen prüfbar sind
 *  (kein Live-Datenzugriff). Deckt ab:
 *    1. Ligaphase unvollständig  → niemand ausgeschieden (konservativ).
 *    2. Ligaphase komplett       → Ränge hinter playoffThrough raus,
 *                                  Rest (direkt + Playoff) bleibt drin.
 *    3. K.-o. Hin/Rück           → Ausscheiden erst nach beiden Legs;
 *                                  Entscheidung per Gesamtergebnis bzw.
 *                                  bei Gleichstand per Sieger-Flag (Elfer).
 *    4. Final (Einzelspiel)      → Verlierer sofort raus.
 * ============================================================================= */

const assert = require('node:assert/strict');
const APP = require('../tournament-config.js');

/* Fixture-Fabrik in einer vom Config unterstützten Form
 * (round / homeTeam.name / awayTeam.name / goals / statusShort / winner). */
function fx(round, home, away, hg, ag, status, extra) {
  const e = extra || {};
  return {
    round,
    homeTeam: { name: home, winner: e.homeWinner },
    awayTeam: { name: away, winner: e.awayWinner },
    goals: { home: hg, away: ag },
    statusShort: status || 'FT'
  };
}

// Kleine Liga mit 4 Klubs, je 2 Spiele. Parameter: Rang 1 → direkt,
// Rang 2 → Playoff (beide drin), Ränge 3–4 → raus.
const SMALL_LEAGUE_OPTS = {
  leaguePhase: { teamCount: 4, matchesPerTeam: 2, directQualifyThrough: 1, playoffThrough: 2 }
};

const LP = 'League Phase - ';

/* ── 1) Ligaphase unvollständig → niemand ausgeschieden ───────────────── */
(function midPhase() {
  // Jeder Klub erst 1 von 2 Spielen → nicht komplett.
  const fixtures = [
    fx(LP + '1', 'Real Madrid', 'Bayern München', 2, 0),
    fx(LP + '1', 'Paris Saint-Germain', 'Manchester City', 1, 1)
  ];
  const s = APP.computeLeagueStatus(fixtures, SMALL_LEAGUE_OPTS);
  assert.equal(s.leaguePhaseComplete, false, 'Ligaphase darf noch nicht komplett sein.');
  assert.equal(s.eliminatedKeys.size, 0, 'Vor Abschluss darf niemand ausgeschieden sein.');
  assert.equal(s.knockoutStarted, false, 'knockoutStarted noch false.');
  ['Real Madrid', 'Bayern München', 'Paris Saint-Germain', 'Manchester City'].forEach((c) => {
    assert.equal(s.isNationAlive(c), true, `${c} muss vor Abschluss aktiv sein.`);
  });
})();

/* ── 2) Ligaphase komplett → Rang-Grenze greift ───────────────────────── */
(function completePhase() {
  // Ergebnisse so gewählt, dass die Tabelle eindeutig ist:
  //   Real Madrid  6 Pkt (Rang 1) → direkt
  //   Bayern       3 Pkt (Rang 2) → Playoff
  //   PSG          1 Pkt, GD -1 (Rang 3) → raus
  //   Man City     1 Pkt, GD -3 (Rang 4) → raus
  const fixtures = [
    fx(LP + '1', 'Real Madrid', 'Bayern München', 2, 0),
    fx(LP + '2', 'Real Madrid', 'Paris Saint-Germain', 1, 0),
    fx(LP + '1', 'Bayern München', 'Manchester City', 3, 0),
    fx(LP + '2', 'Paris Saint-Germain', 'Manchester City', 1, 1)
  ];
  const s = APP.computeLeagueStatus(fixtures, SMALL_LEAGUE_OPTS);

  assert.equal(s.leaguePhaseComplete, true, 'Ligaphase muss komplett sein (je 2 Spiele).');
  assert.equal(s.knockoutStarted, true, 'knockoutStarted nach Abschluss true.');

  // Reihenfolge der Tabelle.
  assert.deepEqual(
    s.standings.map((r) => r.key),
    ['real madrid', 'bayern munchen', 'paris saint germain', 'manchester city'],
    'Tabellenreihenfolge falsch.'
  );
  assert.equal(s.standings[0].rank, 1);
  assert.equal(s.standings[0].pts, 6);

  // Rang 1 (direkt) + Rang 2 (Playoff) bleiben drin; 3 und 4 raus.
  assert.equal(s.isNationAlive('Real Madrid'), true, 'Rang 1 bleibt drin.');
  assert.equal(s.isNationAlive('Bayern München'), true, 'Rang 2 (Playoff) bleibt drin.');
  assert.equal(s.isNationAlive('Paris Saint-Germain'), false, 'Rang 3 ist raus.');
  assert.equal(s.isNationAlive('Manchester City'), false, 'Rang 4 ist raus.');
  assert.equal(s.eliminatedKeys.size, 2, 'Genau 2 Klubs ausgeschieden.');
  assert.equal(s.aliveKeys.size, 2, 'Genau 2 Klubs noch drin.');

  // Umlaut-Normalisierung: Alias-Schreibweise wird gleich behandelt.
  assert.equal(s.isNationAlive('Bayern Munchen'), true, 'Umlaut-Variante muss matchen.');
})();

/* ── 3a) Hin/Rück: nur ein Leg gespielt → noch keine Entscheidung ─────── */
(function knockoutOneLeg() {
  const fixtures = [
    fx('Knockout Round Play-offs', 'Club Brugge', 'Benfica', 2, 1, 'FT'),
    fx('Knockout Round Play-offs', 'Benfica', 'Club Brugge', 0, 0, 'NS')
  ];
  const s = APP.computeLeagueStatus(fixtures, SMALL_LEAGUE_OPTS);
  assert.equal(s.eliminatedKeys.size, 0, 'Nach nur einem Leg darf niemand raus sein.');
  assert.equal(s.knockoutStarted, true, 'K.-o.-Phase erkannt.');
  assert.equal(s.isNationAlive('Benfica'), true);
  assert.equal(s.isNationAlive('Club Brugge'), true);
})();

/* ── 3b) Hin/Rück: Gesamtergebnis entscheidet ─────────────────────────── */
(function knockoutAggregate() {
  // Leg1: Brugge 2-1 Benfica; Leg2: Benfica 1-1 Brugge
  // Gesamt: Brugge 3, Benfica 2 → Benfica raus.
  const fixtures = [
    fx('Knockout Round Play-offs', 'Club Brugge', 'Benfica', 2, 1, 'FT'),
    fx('Knockout Round Play-offs', 'Benfica', 'Club Brugge', 1, 1, 'FT')
  ];
  const s = APP.computeLeagueStatus(fixtures, SMALL_LEAGUE_OPTS);
  assert.equal(s.isNationAlive('Benfica'), false, 'Benfica scheidet nach Gesamtergebnis aus.');
  assert.equal(s.isNationAlive('Club Brugge'), true, 'Club Brugge weiter.');
  assert.equal(s.eliminatedKeys.size, 1);
})();

/* ── 3c) Hin/Rück: Gesamt-Gleichstand → Sieger-Flag (Elfmeter) ────────── */
(function knockoutPenalties() {
  // Leg1: Brugge 1-2 Benfica; Leg2: Benfica 0-1 Brugge → Gesamt 2:2.
  // Rückspiel per Elfmeter an Brugge (Auswärts-Sieger-Flag) → Benfica raus.
  const fixtures = [
    fx('Knockout Round Play-offs', 'Club Brugge', 'Benfica', 1, 2, 'FT'),
    fx('Knockout Round Play-offs', 'Benfica', 'Club Brugge', 0, 1, 'PEN', { awayWinner: true })
  ];
  const s = APP.computeLeagueStatus(fixtures, SMALL_LEAGUE_OPTS);
  assert.equal(s.isNationAlive('Benfica'), false, 'Benfica verliert im Elfmeterschiessen.');
  assert.equal(s.isNationAlive('Club Brugge'), true, 'Club Brugge gewinnt im Elfmeterschiessen.');
})();

/* ── 4) Final (Einzelspiel): Verlierer sofort raus ────────────────────── */
(function final() {
  const fixtures = [
    fx('Final', 'Inter', 'Arsenal', 0, 2, 'FT')
  ];
  const s = APP.computeLeagueStatus(fixtures, SMALL_LEAGUE_OPTS);
  assert.equal(s.isNationAlive('Inter'), false, 'Final-Verlierer ist raus.');
  assert.equal(s.isNationAlive('Arsenal'), true, 'Final-Sieger bleibt drin.');
  assert.equal(s.eliminatedKeys.size, 1);
})();

console.log('cl league-status tests passed');
