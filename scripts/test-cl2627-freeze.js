'use strict';

/* =============================================================================
 *  test-cl2627-freeze.js
 *
 *  Freeze-Guard für den Spielerpool der CL 2026/27.
 *
 *  WARUM DAS EXISTIERT
 *  ---------------------------------------------------------------------------
 *  Ab dem Start (Spieltag 1, 08.09.2026) ist der Pool eine gesetzte Grösse,
 *  keine Datenquelle mehr, die man nachzieht. Zwei Dinge hängen daran:
 *
 *    1. Die Punkte. scripts/auto-points-upload.js liest die Position aus
 *       data-cl2627.js und wendet position-overrides.js an – ein Tor zählt
 *       je nach Position 10/7/6/5 Punkte. Wer eine Position mitten im
 *       Turnier ändert, ändert rückwirkend die Punkte für Tore, die längst
 *       gefallen sind.
 *    2. Die abgegebenen Teams. Verschwindet ein Spieler aus dem Pool, wird
 *       für ihn kein Punkte-Dokument mehr angelegt (er sammelt also nichts
 *       mehr), und im Builder erscheint sein Slot als „Orphan" mit dem
 *       Hinweis „Bitte ersetzen". Das trifft genau die Manager, die ihn
 *       ausgewählt haben – ohne deren Zutun.
 *
 *  Ein erneuter Lauf von generate-cl-pool.js nach dem Start ist deshalb
 *  keine Aktualisierung, sondern ein Eingriff. Dieser Test macht ihn
 *  sichtbar: Er hält den eingefrorenen Stand aus
 *  scripts/cl2627-pool-freeze.json gegen das, was die App tatsächlich
 *  laden würde.
 *
 *  WAS EINGEFROREN IST – UND WAS NICHT
 *  ---------------------------------------------------------------------------
 *  Eingefroren ist genau das, was Punkte und Teams berührt: die Menge der
 *  `player.id` und je Spieler die WIRKSAME Position (Kaderdatei plus
 *  Override, also das, was auch der Punkte-Job benutzt).
 *
 *  Bewusst NICHT eingefroren sind Anzeigedaten: Name, Foto, Klub, Flagge,
 *  Geburtsdatum, Vorsaison-Werte. Eine Namenskorrektur oder ein
 *  nachgeliefertes Foto darf jederzeit rein.
 *
 *  WENN DIESER TEST ROT IST
 *  ---------------------------------------------------------------------------
 *  Dann hat sich etwas Punkterelevantes geändert. Das ist kein Fehler,
 *  den man wegdrückt – es ist eine Entscheidung:
 *
 *    * Vor dem Start: Änderung gewollt? Dann die Freeze-Datei neu erzeugen
 *      (siehe unten) und im Commit begründen, was sich warum ändert.
 *    * Nach dem Start: im Zweifel NICHT übernehmen. Wer es trotzdem tut,
 *      schreibt in den Commit, welche Teams und welche Punkte betroffen
 *      sind.
 *
 *  Neu erzeugen (schreibt den aktuellen Stand als neuen Sollwert):
 *      node scripts/test-cl2627-freeze.js --update
 *
 *  Läuft ohne Browser, Firebase und API-Key.
 * ============================================================================= */

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ROOT = path.join(__dirname, '..');
const FREEZE_FILE = path.join(__dirname, 'cl2627-pool-freeze.json');
const TOURNAMENT_KEY = 'cl2627';

function loadPlayersData(file) {
  const source = fs.readFileSync(path.join(ROOT, file), 'utf8');
  const context = { playersData: null };
  vm.createContext(context);
  vm.runInContext(`${source}\nthis.playersData = playersData;`, context, { filename: file });
  assert.ok(Array.isArray(context.playersData), `${file} stellt kein playersData-Array bereit.`);
  return context.playersData;
}

function loadPositionOverrides(tournamentKey) {
  const context = { window: {} };
  vm.createContext(context);
  vm.runInContext(
    fs.readFileSync(path.join(ROOT, 'position-overrides.js'), 'utf8'),
    context,
    { filename: 'position-overrides.js' }
  );
  return (context.window.POSITION_OVERRIDES || {})[tournamentKey] || {};
}

/* Die WIRKSAME Position – dieselbe Reihenfolge wie in data.js (Browser) und
 * in auto-points-upload.js (Punkte-Job): Kaderdatei, dann Override. */
function effectivePositions() {
  const pool = loadPlayersData('data-cl2627.js');
  const overrides = loadPositionOverrides(TOURNAMENT_KEY);
  const positions = {};
  const names = new Map();
  for (const player of pool) {
    const id = String(player['player.id']);
    positions[id] = overrides[id] || player.Position;
    names.set(id, player.Spielername);
  }
  return { positions, names, overrideCount: Object.keys(overrides).length, playerCount: pool.length };
}

const current = effectivePositions();

/* ── --update: aktuellen Stand als neuen Sollwert festschreiben ─────────── */
if (process.argv.includes('--update')) {
  const previous = fs.existsSync(FREEZE_FILE)
    ? JSON.parse(fs.readFileSync(FREEZE_FILE, 'utf8'))
    : {};
  const sorted = {};
  Object.keys(current.positions)
    .sort((a, b) => Number(a) - Number(b))
    .forEach((id) => { sorted[id] = current.positions[id]; });
  const doc = {
    tournament: TOURNAMENT_KEY,
    frozenAt: new Date().toISOString().slice(0, 10),
    deadline: previous.deadline || '2026-09-08T18:45:00+02:00',
    playerCount: current.playerCount,
    overrideCount: current.overrideCount,
    positions: sorted
  };
  fs.writeFileSync(FREEZE_FILE, `${JSON.stringify(doc, null, 1)}\n`, 'utf8');
  console.log(
    `cl2627-pool-freeze.json neu geschrieben: ${doc.playerCount} Spieler, ` +
    `${doc.overrideCount} Overrides. Bitte im Commit begründen, was sich ändert.`
  );
  process.exit(0);
}

/* ── Abgleich ───────────────────────────────────────────────────────────── */
assert.ok(fs.existsSync(FREEZE_FILE),
  'scripts/cl2627-pool-freeze.json fehlt – ohne Sollwert kann der Pool nicht eingefroren sein.');
const frozen = JSON.parse(fs.readFileSync(FREEZE_FILE, 'utf8'));
assert.equal(frozen.tournament, TOURNAMENT_KEY);

const label = (id) => `${current.names.get(id) || frozen.positions[id] ? (current.names.get(id) || '(nicht mehr im Pool)') : ''} (${id})`;

const added = Object.keys(current.positions).filter((id) => !(id in frozen.positions));
const removed = Object.keys(frozen.positions).filter((id) => !(id in current.positions));
const changed = Object.keys(current.positions)
  .filter((id) => id in frozen.positions && frozen.positions[id] !== current.positions[id])
  .map((id) => `${label(id)}: ${frozen.positions[id]} → ${current.positions[id]}`);

const problems = [];
if (added.length) {
  problems.push(`${added.length} Spieler NEU im Pool: ${added.map(label).join(', ')}`);
}
if (removed.length) {
  problems.push(
    `${removed.length} Spieler WEG aus dem Pool (deren Punkte-Dokumente entfallen, ` +
    `ihre Slots werden in abgegebenen Teams zu Orphans): ${removed.join(', ')}`
  );
}
if (changed.length) {
  problems.push(
    `${changed.length} Position(en) GEÄNDERT – das verschiebt Punkte auch rückwirkend: ` +
    changed.join(' | ')
  );
}

assert.equal(problems.length, 0,
  'Der eingefrorene Spielerpool der CL 26/27 weicht ab.\n\n  ' +
  problems.join('\n  ') +
  '\n\n  Gewollt? Dann `node scripts/test-cl2627-freeze.js --update` ausführen und ' +
  'im Commit begründen.\n  Nicht gewollt? Dann die Änderung an data-cl2627.js bzw. ' +
  'position-overrides.js zurücknehmen.\n');

// Die Zählwerte sind redundant zur Map, stehen aber im Kopf der Freeze-Datei
// und sollen nicht auseinanderlaufen.
assert.equal(current.playerCount, frozen.playerCount,
  `Spielerzahl weicht ab: ${current.playerCount} statt ${frozen.playerCount}.`);
assert.equal(current.overrideCount, frozen.overrideCount,
  `Override-Zahl weicht ab: ${current.overrideCount} statt ${frozen.overrideCount}.`);

const byPosition = {};
Object.values(current.positions).forEach((pos) => { byPosition[pos] = (byPosition[pos] || 0) + 1; });
console.log(
  `✓ test-cl2627-freeze: Pool eingefroren seit ${frozen.frozenAt} – ` +
  `${current.playerCount} Spieler (${byPosition.GOALKEEPER} Tor / ${byPosition.DEFENDER} Abwehr / ` +
  `${byPosition.MIDFIELDER} Mittelfeld / ${byPosition.ATTACKER} Sturm), ${current.overrideCount} Overrides.`
);
