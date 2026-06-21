'use strict';

const assert = require('node:assert/strict');
const points = require('../points-utils.js');

const inconsistentAggregate = {
  playerName: 'Arda Guler',
  totalPoints: 18,
  START: 18,
  Spiel_1001: {
    MatchID: 1001,
    TotalPunkte: 99,
    Aufstellung: {
      START: 2
    }
  },
  Spiel_1002: {
    MatchID: 1002,
    TotalPunkte: 99,
    Aufstellung: {
      START: 2
    }
  }
};

const normalized = points.normalizePlayerPointDocument(inconsistentAggregate);
assert.equal(normalized.totalPoints, 4);
assert.equal(normalized.START, 4);
assert.equal(normalized.Spiel_1001.TotalPunkte, 2);
assert.equal(normalized.Spiel_1002.TotalPunkte, 2);
assert.equal(points.getPlayerTotal(inconsistentAggregate), 4);

const noLineupDetails = points.normalizePlayerPointDocument({
  totalPoints: 18,
  Spiel_1001: { MatchID: 1001, TotalPunkte: 2 },
  Spiel_1002: { MatchID: 1002, Punkte: 2 }
});
assert.equal(noLineupDetails.totalPoints, 4);
assert.deepEqual(noLineupDetails.matches, {
  '1001': { TotalPunkte: 2 },
  '1002': { TotalPunkte: 2 }
});

const normalizedMap = points.normalizePointsMap({ 12345: inconsistentAggregate });
assert.equal(normalizedMap['12345'].totalPoints, 4);

console.log('points-utils regression tests passed');
