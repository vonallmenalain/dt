'use strict';

/* =============================================================================
 *  test-wm2026-freeze.js
 *
 *  Freeze-Guard für die WM 2026.
 *
 *  Die WM 2026 ist ein abgeschlossenes Turnier und soll dauerhaft
 *  unverändert einsehbar bleiben – Punktesystem, Regel-Labels und die
 *  Captain-Regel genau so, wie sie während des Turniers galten. Dieser
 *  Test schlägt fehl, sobald eine dieser eingefrorenen Grössen verändert
 *  wird. So können Anpassungen für andere Turniere (z. B. Champions
 *  League) das Punktesystem/Aussehen der WM nicht versehentlich
 *  mitverändern.
 *
 *  Läuft ohne Browser/Firebase: tournament-config.js wird als reines
 *  Node-Modul geladen (window ist undefined → aktives Turnier fällt auf
 *  den Fallback `wm2026` zurück).
 * ============================================================================= */

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const APP = require('../tournament-config.js');
const ROOT = path.join(__dirname, '..');

// Absichern, dass wir wirklich gegen die WM-Werte prüfen.
assert.equal(
  APP.activeTournamentKey,
  'wm2026',
  'Freeze-Test erwartet wm2026 als aktives Turnier (Node-Fallback).'
);

/* ── 1) Eingefrorenes Punktesystem der WM 2026 ─────────────────────────── */
const FROZEN_WM_RULES = {
  START: 5,
  SUBBED_IN: 2,
  SUBBED_OUT: -2,
  GOAL_GK: 10,
  GOAL_DEF: 7,
  GOAL_MID: 6,
  GOAL_ATT: 5,
  OWN_GOAL: -5,
  ASSIST_GK_DEF: 5,
  ASSIST_MID: 4,
  ASSIST_ATT: 3,
  TEAM_GOAL: 1,
  DEF_BASE_PTS: 6,
  GEGENTOR_GK_DEF: -2,
  YELLOW_CARD: -3,
  RED_CARD: -7,
  PEN_SAVED: 7,
  PEN_MISSED: -7,
  PEN_COMMITED: -5,
  PEN_WON: 3,
  WIN: 3,
  DRAW: 1,
  LOSS: -3
};

assert.deepEqual(
  APP.rules,
  FROZEN_WM_RULES,
  'WM-2026-Punktesystem (APP.rules) wurde verändert – WM-Freeze verletzt.'
);

/* ── 2) Eingefrorene Regel-Labels der WM 2026 ──────────────────────────── */
const FROZEN_WM_RULE_LABELS = {
  START: 'Startaufstellung',
  SUBBED_IN: 'Eingewechselt',
  SUBBED_OUT: 'Ausgewechselt',
  GOAL_GK: 'Tore',
  GOAL_DEF: 'Tore',
  GOAL_MID: 'Tore',
  GOAL_ATT: 'Tore',
  OWN_GOAL: 'Eigentore',
  ASSIST_GK_DEF: 'Assists',
  ASSIST_MID: 'Assists',
  ASSIST_ATT: 'Assists',
  TEAM_GOAL: 'Tore (Mannschaft)',
  GEGENTOR_GK_DEF: 'Gegentore',
  YELLOW_CARD: 'Gelbe Karten',
  RED_CARD: 'Rote Karten',
  PEN_SAVED: 'Elfmeter gehalten',
  PEN_MISSED: 'Elfmeter verschossen',
  PEN_COMMITED: 'Elfmeter verursacht',
  PEN_WON: 'Elfmeter herausgeholt',
  WIN: 'Siege',
  DRAW: 'Unentschieden',
  LOSS: 'Niederlagen',
  DEF_BASE_PTS: 'Defensiv-Basis'
};

assert.deepEqual(
  APP.ruleLabels,
  FROZEN_WM_RULE_LABELS,
  'WM-2026-Regel-Labels (APP.ruleLabels) wurden verändert – WM-Freeze verletzt.'
);

/* ── 3) Captain-Regel (×2) in den WM-Ansichten ─────────────────────────── */
/* Die WM verdoppelt die Punkte des Captains. Diese Regel ist in den
 * (eingefrorenen) WM-Views hartkodiert. Für andere Turniere wird der
 * Multiplikator später über die Config gesteuert – die WM-Views selbst
 * dürfen dabei nicht angefasst werden. */
const CAPTAIN_X2_FILES = ['rangliste.html', 'teams.html', 'spieleranalyse.html'];
const CAPTAIN_X2_PATTERN = 'isCaptain ? basePts * 2 : basePts';

for (const file of CAPTAIN_X2_FILES) {
  const src = fs.readFileSync(path.join(ROOT, file), 'utf8');
  assert.ok(
    src.includes(CAPTAIN_X2_PATTERN),
    `Captain-Multiplikator (×2) fehlt/verändert in ${file} – WM-Freeze verletzt.`
  );
}

// rangliste.html enthält zusätzlich die Summenschleifen-Variante.
const ranglisteSrc = fs.readFileSync(path.join(ROOT, 'rangliste.html'), 'utf8');
assert.ok(
  ranglisteSrc.includes('isCaptain ? baseMatchPts * 2 : baseMatchPts'),
  'Captain-Multiplikator (×2, Summenschleife) fehlt/verändert in rangliste.html – WM-Freeze verletzt.'
);

console.log('wm2026 freeze test passed');
