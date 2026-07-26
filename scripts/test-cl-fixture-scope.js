'use strict';

/* =============================================================================
 *  test-cl-fixture-scope.js
 *
 *  Regressionstest für den Turnier-Scope einer Ligaphasen-Competition (CL):
 *  gewertet wird ausschliesslich ab dem Start der Ligaphase. Die
 *  Qualifikationsrunden davor liefert api-football zwar mit, sie gehören
 *  aber nicht zum Turnier – weder im Spielplan noch in der Punkterechnung.
 *
 *  Referenz ist die abgeschlossene Saison 2025/26 (league=2, season=2025).
 *  Runden-Texte und Spielzahlen laut API:
 *
 *      1st Qualifying Round     28  ─┐
 *      2nd Qualifying Round     30   │ vor der Ligaphase → NICHT gewertet
 *      3rd Qualifying Round     20   │        92 Spiele
 *      Play-offs                14  ─┘
 *      League Stage - 1..8     144  ─┐
 *      Round of 32              16   │ ab der Ligaphase  → gewertet
 *      Round of 16              16   │       189 Spiele
 *      Quarter-finals            8   │
 *      Semi-finals               4   │
 *      Final                     1  ─┘
 *                        Total  281
 *
 *  Geprüft wird:
 *    1. Runden-Klassifikation (Qualifikation ja/nein) je Runden-Text.
 *    2. Die Gesamtzahlen 281 → 189 + 92 über einen kompletten Runden-Satz.
 *    3. Der kanonische K.-o.-Runden-Key je Runde – insbesondere, dass
 *       "Round of 32" die Playoff-Runde NACH der Ligaphase ist (früher fiel
 *       sie in keine Spalte, der Turnierbaum blieb dort leer).
 *    4. Turniere mit Gruppenphase (WM 2026) bleiben unberührt: dort ist
 *       "Round of 32" ein K.-o.-Spiel und nichts wird herausgefiltert.
 *    5. Fixture-Objekte werden genauso klassifiziert wie blanke Strings
 *       (API-Form `league.round` und flache Schedule-Form `round`).
 * ============================================================================= */

const assert = require('node:assert/strict');
const APP = require('../tournament-config.js');

const CL = 'cl2526';
const WM = 'wm2026';

/* Kompletter Runden-Satz der CL-Saison 2025/26 mit den echten Spielzahlen. */
const CL_2526_ROUNDS = [
  { round: '1st Qualifying Round', count: 28, quali: true,  koKey: null },
  { round: '2nd Qualifying Round', count: 30, quali: true,  koKey: null },
  { round: '3rd Qualifying Round', count: 20, quali: true,  koKey: null },
  { round: 'Play-offs',            count: 14, quali: true,  koKey: null },
  { round: 'League Stage - 1',     count: 18, quali: false, koKey: null },
  { round: 'League Stage - 2',     count: 18, quali: false, koKey: null },
  { round: 'League Stage - 3',     count: 18, quali: false, koKey: null },
  { round: 'League Stage - 4',     count: 18, quali: false, koKey: null },
  { round: 'League Stage - 5',     count: 18, quali: false, koKey: null },
  { round: 'League Stage - 6',     count: 18, quali: false, koKey: null },
  { round: 'League Stage - 7',     count: 18, quali: false, koKey: null },
  { round: 'League Stage - 8',     count: 18, quali: false, koKey: null },
  { round: 'Round of 32',          count: 16, quali: false, koKey: 'playoffs' },
  { round: 'Round of 16',          count: 16, quali: false, koKey: 'r16' },
  { round: 'Quarter-finals',       count:  8, quali: false, koKey: 'qf' },
  { round: 'Semi-finals',          count:  4, quali: false, koKey: 'sf' },
  { round: 'Final',                count:  1, quali: false, koKey: 'final' }
];

const EXPECTED_TOTAL = 281;
const EXPECTED_SCOPED = 189;
const EXPECTED_QUALI = 92;

/* ── 1+3) Klassifikation je Runden-Text ───────────────────────────────── */
(function roundClassification() {
  CL_2526_ROUNDS.forEach(({ round, quali, koKey }) => {
    assert.equal(
      APP.isQualificationFixtureFor(CL, round), quali,
      `"${round}" muss ${quali ? '' : 'NICHT '}als Qualifikationsrunde gelten.`
    );
    assert.equal(
      APP.isScoredFixtureFor(CL, round), !quali,
      `"${round}" muss ${quali ? 'NICHT ' : ''}gewertet werden.`
    );
    assert.equal(
      APP.leagueKnockoutRoundKey(round), koKey,
      `"${round}" muss auf K.-o.-Key ${JSON.stringify(koKey)} abbilden.`
    );
  });
})();

/* ── 2) Gesamtzahlen der Saison 2025/26 ───────────────────────────────── */
(function seasonTotals() {
  const total = CL_2526_ROUNDS.reduce((sum, r) => sum + r.count, 0);
  const scoped = CL_2526_ROUNDS.filter(r => !r.quali).reduce((sum, r) => sum + r.count, 0);
  const quali = CL_2526_ROUNDS.filter(r => r.quali).reduce((sum, r) => sum + r.count, 0);

  assert.equal(total, EXPECTED_TOTAL, 'Die API liefert 281 Spiele fuer league=2&season=2025.');
  assert.equal(scoped, EXPECTED_SCOPED, 'Ab Ligaphase sind es genau 189 Spiele.');
  assert.equal(quali, EXPECTED_QUALI, 'Vor der Ligaphase sind es genau 92 Spiele.');
  assert.equal(scoped + quali, total, 'Scope-Aufteilung muss verlustfrei sein.');

  // Der Sync-Guard muss zu dieser Zahl passen, sonst laesst er einen
  // unvollstaendigen Spielplan durch bzw. blockiert einen vollstaendigen.
  const fixtureCount = APP.tournaments[CL].fixtureCount || {};
  assert.equal(fixtureCount.minPublished, EXPECTED_SCOPED,
    'cl2526.fixtureCount.minPublished muss 189 sein (abgeschlossene Saison).');
  assert.equal(fixtureCount.expectedFinal, EXPECTED_SCOPED,
    'cl2526.fixtureCount.expectedFinal muss 189 sein.');
})();

/* ── 4) WM bleibt unberührt ───────────────────────────────────────────── */
(function worldCupUntouched() {
  ['Group A - 1', 'Round of 32', 'Round of 16', 'Play-offs', 'Final'].forEach((round) => {
    assert.equal(
      APP.isQualificationFixtureFor(WM, round), false,
      `WM darf nie filtern ("${round}").`
    );
    assert.equal(
      APP.isScoredFixtureFor(WM, round), true,
      `WM muss "${round}" werten.`
    );
  });
})();

/* ── 5) Fixture-Objekte verhalten sich wie Strings ────────────────────── */
(function fixtureShapes() {
  const apiShape = round => ({ fixture: { id: 1 }, league: { id: 2, round } });
  const scheduleShape = round => ({ id: 1, round });

  [['Play-offs', true], ['Round of 32', false], ['League Stage - 3', false]].forEach(([round, quali]) => {
    assert.equal(APP.isQualificationFixtureFor(CL, apiShape(round)), quali,
      `API-Fixture "${round}" falsch klassifiziert.`);
    assert.equal(APP.isQualificationFixtureFor(CL, scheduleShape(round)), quali,
      `Schedule-Eintrag "${round}" falsch klassifiziert.`);
  });

  assert.equal(APP.leagueKnockoutRoundKey(apiShape('Round of 32')), 'playoffs',
    'API-Fixture "Round of 32" muss die Playoff-Spalte treffen.');
  assert.equal(APP.leagueKnockoutRoundKey(scheduleShape('Semi-finals')), 'sf',
    'Schedule-Eintrag "Semi-finals" muss die Halbfinal-Spalte treffen.');

  // Unbekannte/leere Runden duerfen nichts behaupten.
  assert.equal(APP.leagueKnockoutRoundKey(''), null, 'Leerer Runden-Text → null.');
  assert.equal(APP.leagueKnockoutRoundKey('Irgendwas'), null, 'Unbekannte Runde → null.');
  assert.equal(APP.isQualificationFixtureFor(CL, ''), false, 'Leerer Runden-Text ist kein Quali-Spiel.');
})();

/* ── 6) Alternative Schreibweisen der K.-o.-Playoffs ──────────────────── */
(function playoffAliases() {
  ['Knockout Round Play-offs', 'Knockout Play-offs', 'Last 32', '1/16'].forEach((round) => {
    assert.equal(APP.leagueKnockoutRoundKey(round), 'playoffs',
      `"${round}" muss als K.-o.-Playoff-Runde gelten.`);
    assert.equal(APP.isQualificationFixtureFor(CL, round), false,
      `"${round}" ist die Playoff-Runde NACH der Ligaphase, keine Qualifikation.`);
  });
})();

console.log('✅ test-cl-fixture-scope: alle Checks bestanden ' +
  `(${EXPECTED_TOTAL} API-Spiele → ${EXPECTED_SCOPED} ab Ligaphase, ${EXPECTED_QUALI} Quali verworfen).`);
