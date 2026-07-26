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
 * (eingefrorenen) WM-Views hartkodiert. Andere Turniere schalten den Captain
 * über `captainEnabled: false` ab (CL) – die WM-Verdopplung selbst darf dabei
 * nicht angefasst werden.
 *
 * Gezählt wird über ALLE View-Dateien zusammen statt pro Datei: die Skripte
 * sind inzwischen aus den <script>-Blöcken der HTML-Seiten in eigene
 * .js-Dateien gewandert, und ein reiner Umzug von Code soll den Freeze-Guard
 * nicht auslösen. Fehlt oder ändert sich die Verdopplung, schlägt er an. */
const VIEW_FILES = [
  'index.js',
  'rangliste.js',
  'spieleranalyse.js',
  'teams.js',
  'team-builder.js',
  'badge-catalog.js'
];

const VIEW_SOURCES = VIEW_FILES.map((file) => ({
  file,
  src: fs.readFileSync(path.join(ROOT, file), 'utf8')
}));

function countOccurrences(haystack, needle) {
  let count = 0;
  let idx = haystack.indexOf(needle);
  while (idx !== -1) {
    count++;
    idx = haystack.indexOf(needle, idx + needle.length);
  }
  return count;
}

const CAPTAIN_X2_PATTERNS = [
  { pattern: 'isCaptain ? basePts * 2 : basePts',           minHits: 2, label: 'Team-Anreicherung' },
  { pattern: 'isCaptain ? baseMatchPts * 2 : baseMatchPts', minHits: 1, label: 'Ranglisten-Verlauf' },
  { pattern: 'isCaptain ? base * 2 : base',                 minHits: 7, label: 'Team-Summen' },
  { pattern: 'captainMultiplier: CAPTAIN_ENABLED ? 2 : 1',  minHits: 3, label: 'Transfer-Wertung' }
];

for (const { pattern, minHits, label } of CAPTAIN_X2_PATTERNS) {
  const hitsByFile = VIEW_SOURCES
    .map(({ file, src }) => ({ file, hits: countOccurrences(src, pattern) }))
    .filter((entry) => entry.hits > 0);
  const total = hitsByFile.reduce((sum, entry) => sum + entry.hits, 0);
  assert.ok(
    total >= minHits,
    `Captain-Verdopplung (${label}, "${pattern}") nur ${total}× statt mindestens ` +
    `${minHits}× gefunden – WM-Freeze verletzt. Aktuell in: ` +
    `${hitsByFile.map((e) => `${e.file}×${e.hits}`).join(', ') || '(keiner Datei)'}.`
  );
}

// Die WM selbst muss den Captain behalten – ein Turnier, das ihn abschaltet
// (CL), darf das WM-Verhalten nicht mitziehen.
assert.equal(APP.captainEnabled, true, 'WM 2026 muss das Captain-Feature behalten.');
assert.equal(APP.captainMultiplier, 2, 'WM-2026-Captain muss ×2 zählen.');

console.log('wm2026 freeze test passed');
