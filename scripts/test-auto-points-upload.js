'use strict';

const assert = require('node:assert/strict');
const {
  buildEmptyPlayerObject,
  processFixtureDetail
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

console.log('auto-points-upload regression tests passed');
