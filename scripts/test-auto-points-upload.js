'use strict';

const assert = require('node:assert/strict');
const {
  buildEmptyPlayerObject,
  compareGoalEventSets,
  extractApiErrors,
  isRetriableApiError,
  processFixtureDetail,
  shouldContinueAfterTickFailure
} = require('./auto-points-upload.js');

function player(id, name, position = 'MIDFIELDER') {
  return {
    'player.id': id,
    Spielername: name,
    Position: position,
    'Nationalteam.name': 'France'
  };
}

function stat(id, minutes, substitute) {
  return {
    player: { id },
    statistics: [{
      games: { minutes, substitute },
      goals: {},
      cards: {},
      penalty: {}
    }]
  };
}

const playersData = [
  player(1, 'Real Starter', 'DEFENDER'),
  player(2, 'Real Substitute', 'ATTACKER'),
  player(3, 'Unused Default False', 'DEFENDER'),
  ...Array.from({ length: 9 }, (_, index) => player(4 + index, `Unused Squad ${index + 1}`, 'MIDFIELDER'))
];

const allPlayerPoints = Object.fromEntries(
  playersData.map(p => [String(p['player.id']), buildEmptyPlayerObject(p)])
);

const game = {
  fixture: { id: 999001, status: { short: 'FT' } },
  teams: {
    home: { id: 2, name: 'France', winner: true },
    away: { id: 999, name: 'Iraq', winner: false }
  },
  goals: { home: 1, away: 0 }
};

const fixtureData = {
  lineups: [{
    team: { id: 2, name: 'France' },
    // Defensive regression case: API data can expose an impossible
    // "startXI" containing the wider squad. This must be ignored.
    startXI: playersData.map(p => ({ player: { id: p['player.id'] } })),
    substitutes: [{ player: { id: 2 } }, { player: { id: 3 } }]
  }],
  players: [{
    team: { id: 2, name: 'France' },
    players: [
      stat(1, 90, false),
      stat(2, 28, false),
      stat(3, 0, false)
    ]
  }],
  events: [
    { type: 'subst', player: { id: 1 }, assist: { id: 2 } }
  ]
};

const processed = processFixtureDetail(fixtureData, game, allPlayerPoints, playersData);
assert.equal(processed, 2);

const starterMatch = allPlayerPoints['1'].Spiel_999001;
assert.equal(starterMatch.Aufstellung.START, 5);
assert.equal(starterMatch.Aufstellung.DEF_BASE_PTS, 6);
assert.equal(starterMatch.Aufstellung.WIN, 3);
assert.equal(starterMatch.Aufstellung.SUBBED_OUT, -2);
assert.equal(starterMatch.TotalPunkte, 12);

const substituteMatch = allPlayerPoints['2'].Spiel_999001;
assert.equal(substituteMatch.Aufstellung.SUBBED_IN, 2);
assert.equal(substituteMatch.Aufstellung.TEAM_GOAL, 1);
assert.equal(substituteMatch.Aufstellung.WIN, 3);
assert.equal(substituteMatch.TotalPunkte, 6);

assert.equal(allPlayerPoints['3'].Spiel_999001, undefined);
for (let id = 4; id <= 12; id++) {
  assert.equal(allPlayerPoints[String(id)].Spiel_999001, undefined);
}

/* ── Tick-Resilienz der Monitor-Session ──────────────────────────────────────
 * Ein einzelner fehlgeschlagener Live-Tick (API-Aussetzer nach allen Retries)
 * darf einen Scheduled Run nicht mehr mitten im Spiel beenden; Dauerfehler
 * muessen nach dem Limit weiterhin sichtbar abbrechen, One-Shot-Runs sofort. */
const monitorOpts = {
  forceRun: false,
  oneShotRun: false,
  maxConsecutiveTickFailures: 5,
  liveTickIntervalSec: 30,
  sessionDeadlineMs: Date.now() + 60 * 60_000
};
assert.equal(shouldContinueAfterTickFailure(1, monitorOpts), true,
  'erster Fehler in einer Monitor-Session: Session laeuft weiter');
assert.equal(shouldContinueAfterTickFailure(4, monitorOpts), true,
  'unter dem Limit: Session laeuft weiter');
assert.equal(shouldContinueAfterTickFailure(5, monitorOpts), false,
  'Limit erreicht: Run bricht ab (Exit 2)');
assert.equal(shouldContinueAfterTickFailure(1, { ...monitorOpts, maxConsecutiveTickFailures: undefined }), true,
  'ohne explizites Limit gilt der Default (5)');
assert.equal(shouldContinueAfterTickFailure(1, { ...monitorOpts, maxConsecutiveTickFailures: 0 }), false,
  'Limit 0 = bisheriges Verhalten (jeder Fehler beendet den Run)');
assert.equal(shouldContinueAfterTickFailure(1, { ...monitorOpts, forceRun: true }), false,
  'FORCE_RUN bricht beim ersten Fehler ab');
assert.equal(shouldContinueAfterTickFailure(1, { ...monitorOpts, oneShotRun: true }), false,
  'Push-/One-Shot-Run bricht beim ersten Fehler ab');
assert.equal(shouldContinueAfterTickFailure(1, { ...monitorOpts, sessionDeadlineMs: Date.now() + 10_000 }), false,
  'keine Restlaufzeit fuer einen weiteren Tick: Run bricht ab');
assert.equal(shouldContinueAfterTickFailure(1, { ...monitorOpts, sessionDeadlineMs: undefined }), true,
  'ohne Session-Deadline (unbegrenzt) laeuft die Session weiter');

/* ── API-Fehler im 200er-Body (Kontingent, Parameter) ────────────────────────
 * api-football meldet ein aufgebrauchtes Tageskontingent mit HTTP 200, leerer
 * response und errors = { requests: "..." }; ohne Fehler ist errors = []. */
assert.deepEqual(extractApiErrors({ errors: [], response: [] }), []);
assert.deepEqual(extractApiErrors({ response: [] }), []);
assert.deepEqual(extractApiErrors(null), []);
assert.deepEqual(
  extractApiErrors({ errors: { requests: 'You have reached the request limit for the day' }, response: [] }),
  ['requests: You have reached the request limit for the day']
);
assert.deepEqual(extractApiErrors({ errors: ['kaputt'] }), ['kaputt']);
assert.equal(isRetriableApiError(['requests: You have reached the request limit for the day']), false,
  'Tageskontingent aufgebraucht: kein Retry');
assert.equal(isRetriableApiError(['rateLimit: Too many requests. Your rate limit is 300 requests per minute.']), true,
  'Minuten-Limit: Retry mit Backoff');
assert.equal(isRetriableApiError([]), false);

/* ── Event-Diagnose: Batch-Events gegen separaten Event-Call ────────────────── */
const goal = (detail = 'Normal Goal') => ({ type: 'Goal', detail });
assert.deepEqual(
  compareGoalEventSets(4711, [goal(), goal('Own Goal'), goal('Missed Penalty'), { type: 'Card', detail: 'Yellow Card' }],
    [goal(), goal('Own Goal')]),
  { fixtureId: '4711', batchHasEvents: true, batchGoals: 2, separateGoals: 2, consistent: true },
  'verschossener Elfmeter und Karten zaehlen nicht als Tor'
);
assert.equal(compareGoalEventSets(1, [goal()], [goal(), goal()]).consistent, false,
  'Batch hinkt hinterher: nicht deckungsgleich');
assert.equal(compareGoalEventSets(1, undefined, []).consistent, false,
  'Batch ohne events-Array: nicht deckungsgleich, auch bei 0 Toren');
assert.equal(compareGoalEventSets(1, [], []).consistent, true,
  'leeres events-Array bei 0 Toren ist deckungsgleich');

console.log('auto-points-upload regression tests passed');
