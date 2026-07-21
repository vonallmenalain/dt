'use strict';

/* =============================================================================
 *  test-transfer-utils.js
 *
 *  Regressionstest für die CL-Transfer-Regel-Engine (transfer-utils.js, M5):
 *  2 Transfers für die ganze CL, pro Transfer bis zu 3 Spieler, jederzeit.
 * ============================================================================= */

const assert = require('node:assert/strict');
const APP = require('../tournament-config.js');
const T = require('../transfer-utils.js');

/* ── 1) getTransferConfig folgt dem aktiven Turnier ───────────────────── */
// WM 2026 hat kein Transfer-Feature.
assert.equal(T.getTransferConfig(APP), null, 'WM darf keine Transfer-Config haben.');

// CL 2026/27 (per Vorschau aktivieren) liefert die Regeln.
assert.equal(APP.setPreviewTournament('cl2627', { reload: false }), true);
const clCfg = T.getTransferConfig(APP);
assert.ok(clCfg && clCfg.enabled, 'CL muss eine Transfer-Config haben.');
assert.equal(clCfg.totalTransfers, 2, 'CL: 2 Transfers gesamt.');
assert.equal(clCfg.maxPlayersPerTransfer, 3, 'CL: bis zu 3 Spieler pro Transfer.');
assert.equal(clCfg.anytime, true, 'CL: vorerst jederzeit.');
APP.clearPreview({ reload: false });
assert.equal(T.getTransferConfig(APP), null, 'Nach Beenden der Vorschau wieder keine Config.');

/* ── 2) validateTransfer ──────────────────────────────────────────────── */
const config = { enabled: true, totalTransfers: 2, maxPlayersPerTransfer: 3, anytime: true };
const team = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '10', '11', '12', '13', '14', '15'];

// gültig: 2 raus, 2 rein, noch keine Transfers verbraucht
assert.deepEqual(
  T.validateTransfer({ config, usedTransfers: 0, currentTeamIds: team, outPlayers: ['1', '2'], inPlayers: ['20', '21'] }),
  { ok: true, error: null }
);

// gültig: genau 3 (Maximum)
assert.equal(
  T.validateTransfer({ config, usedTransfers: 1, currentTeamIds: team, outPlayers: ['1', '2', '3'], inPlayers: ['20', '21', '22'] }).ok,
  true
);

// zu viele (4 > 3)
assert.equal(
  T.validateTransfer({ config, usedTransfers: 0, currentTeamIds: team, outPlayers: ['1', '2', '3', '4'], inPlayers: ['20', '21', '22', '23'] }).ok,
  false
);

// ungleiche Anzahl
assert.equal(
  T.validateTransfer({ config, usedTransfers: 0, currentTeamIds: team, outPlayers: ['1', '2'], inPlayers: ['20'] }).ok,
  false
);

// keine Transfers mehr übrig
assert.equal(
  T.validateTransfer({ config, usedTransfers: 2, currentTeamIds: team, outPlayers: ['1'], inPlayers: ['20'] }).ok,
  false
);

// abgegebener Spieler nicht im Team
assert.equal(
  T.validateTransfer({ config, usedTransfers: 0, currentTeamIds: team, outPlayers: ['99'], inPlayers: ['20'] }).ok,
  false
);

// geholter Spieler bereits im Team
assert.equal(
  T.validateTransfer({ config, usedTransfers: 0, currentTeamIds: team, outPlayers: ['1'], inPlayers: ['3'] }).ok,
  false
);

// nichts getauscht
assert.equal(
  T.validateTransfer({ config, usedTransfers: 0, currentTeamIds: team, outPlayers: [], inPlayers: [] }).ok,
  false
);

// Turnier ohne Transfer-Feature
assert.equal(
  T.validateTransfer({ config: null, usedTransfers: 0, currentTeamIds: team, outPlayers: ['1'], inPlayers: ['20'] }).ok,
  false
);

/* ── 3) remainingTransfers ────────────────────────────────────────────── */
assert.equal(T.remainingTransfers(config, 0), 2);
assert.equal(T.remainingTransfers(config, 1), 1);
assert.equal(T.remainingTransfers(config, 2), 0);
assert.equal(T.remainingTransfers(config, 5), 0);

/* ── 4) applyTransfer ─────────────────────────────────────────────────── */
const after = T.applyTransfer(team, ['1', '2'], ['20', '21']);
assert.equal(after.length, 15, 'Teamgrösse bleibt 15.');
assert.ok(!after.includes('1') && !after.includes('2'), 'Abgegebene sind raus.');
assert.ok(after.includes('20') && after.includes('21'), 'Geholte sind drin.');

console.log('transfer-utils tests passed');
