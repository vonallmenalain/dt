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

/* ── 5) reconstructInitialTeamIds ─────────────────────────────────────── */
// Aktuell [A,C,D] entstand aus Start [A,B,C] durch Transfer (B raus, D rein).
assert.deepEqual(
  T.reconstructInitialTeamIds(['A', 'C', 'D'], [{ at: 100, out: ['B'], in: ['D'] }]).sort(),
  ['A', 'B', 'C'],
  'Start-Team wird korrekt rückwärts rekonstruiert.'
);

/* ── 6) computeOwnershipWindows ───────────────────────────────────────── */
const win = T.computeOwnershipWindows(['A', 'C', 'D'], [{ at: 100, out: ['B'], in: ['D'] }]);
assert.deepEqual(win.A, [{ from: null, to: null }], 'Behaltener Spieler: dauerhaftes Fenster.');
assert.deepEqual(win.B, [{ from: null, to: 100 }], 'Abgegebener: Fenster endet beim Transfer.');
assert.deepEqual(win.D, [{ from: 100, to: null }], 'Geholter: Fenster beginnt beim Transfer.');

/* ── 7) isOwnedAt (Freeze halb-offen [from,to)) ───────────────────────── */
const cur = { A: true, C: true, D: true };
assert.equal(T.isOwnedAt(win, 'B', 50, cur), true, 'B zählt vor dem Transfer.');
assert.equal(T.isOwnedAt(win, 'B', 100, cur), false, 'B zählt NICHT ab dem Transfer-Zeitpunkt.');
assert.equal(T.isOwnedAt(win, 'D', 100, cur), true, 'D zählt ab dem Transfer-Zeitpunkt (inklusive).');
assert.equal(T.isOwnedAt(win, 'D', 50, cur), false, 'D zählt NICHT vor dem Transfer.');
assert.equal(T.isOwnedAt(win, 'A', 999, cur), true, 'A zählt immer.');
// Unbekannter Anpfiff → Fallback auf aktuelles Team.
assert.equal(T.isOwnedAt(win, 'D', null, cur), true, 'Ohne Anpfiff: aktueller Spieler zählt.');
assert.equal(T.isOwnedAt(win, 'B', null, cur), false, 'Ohne Anpfiff: Ex-Spieler zählt nicht.');

/* ── 8) managerTotalOverTime (voll durchgerechnetes Szenario) ─────────── */
// Start [A,B,C], Kapitän A. Transfer @100: B raus, D rein, Kapitän bleibt A.
// Anpfiffe: m1=50 (vor Transfer), m2=150 (nach Transfer).
const total = T.managerTotalOverTime({
  currentTeamIds: ['A', 'C', 'D'],
  transfers: [{ at: 100, out: ['B'], in: ['D'], captain: 'A' }],
  initialCaptain: 'A',
  playerMatchPoints: {
    A: { m1: 10, m2: 10 },   // Kapitän ×2 → 20 + 20 = 40
    B: { m1: 5, m2: 5 },     // nur m1 zählt (5); m2 nach Transfer raus
    C: { m1: 1, m2: 1 },     // 1 + 1 = 2
    D: { m0: 99, m2: 20 }    // m0@50 vor Transfer → raus; m2 zählt 20
  },
  getKickoffMs: (id) => ({ m0: 50, m1: 50, m2: 150 }[id]),
  captainMultiplier: 2
});
assert.equal(total, 40 + 5 + 2 + 20, 'Freeze-Summe: alte 15 bis Transfer, neue 15 danach, Kapitän ×2.');

// Kapitänswechsel im Transfer: A raus, E rein, Kapitän wird E.
const total2 = T.managerTotalOverTime({
  currentTeamIds: ['C', 'E'],
  transfers: [{ at: 100, out: ['A'], in: ['E'], captain: 'E' }],
  initialCaptain: 'A',
  playerMatchPoints: {
    A: { m1: 10 },   // A Kapitän vor Transfer, m1@50 → 10×2 = 20
    C: { m2: 3 },    // kein Kapitän → 3
    E: { m2: 7 }     // E Kapitän ab Transfer, m2@150 → 7×2 = 14
  },
  getKickoffMs: (id) => ({ m1: 50, m2: 150 }[id])
});
assert.equal(total2, 20 + 3 + 14, 'Kapitän-Multiplikator folgt dem Freeze pro Segment.');

/* ── 9) managerBreakdownOverTime (Aufschlüsselung inkl. Ausgetauschte) ── */
const bd = T.managerBreakdownOverTime({
  currentTeamIds: ['A', 'C', 'D'],
  transfers: [{ at: 100, out: ['B'], in: ['D'], captain: 'A' }],
  initialCaptain: 'A',
  playerMatchPoints: {
    A: { m1: 10, m2: 10 },
    B: { m1: 5, m2: 5 },
    C: { m1: 1, m2: 1 },
    D: { m0: 99, m2: 20 }
  },
  getKickoffMs: (id) => ({ m0: 50, m1: 50, m2: 150 }[id]),
  captainMultiplier: 2
});
assert.equal(bd.total, 67, 'Breakdown-Total stimmt mit managerTotalOverTime überein.');
assert.equal(bd.perPlayer.A, 40, 'A: Kapitän ×2 über beide Spiele.');
assert.equal(bd.perPlayer.B, 5, 'B (ausgetauscht): nur Punkte bis zum Transfer.');
assert.equal(bd.perPlayer.C, 2, 'C: unverändert.');
assert.equal(bd.perPlayer.D, 20, 'D (geholt): nur Punkte ab dem Transfer.');
assert.ok(bd.everOwned.includes('B') && !bd.currentSet.B, 'B ist ausgetauscht (nicht mehr aktuell).');

console.log('transfer-utils tests passed');
