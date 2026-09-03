'use strict';

/* =============================================================================
 *  test-cl2627-pool.js
 *
 *  Guard für den erzeugten Vorschau-Spielerpool data-cl2627.js.
 *
 *  Der Pool entsteht auf einem anderen Weg als data-cl2526.js (Klub-Kader
 *  statt Wettbewerbs-Einsätze, siehe scripts/generate-cl-pool.js). Genau
 *  deshalb muss geprüft werden, dass am Ende dasselbe herauskommt: gleiches
 *  Schema, gleiche Positionswerte und – für Spieler, die in beiden Turnieren
 *  vorkommen – derselbe Anzeigename. Sonst hiesse derselbe Spieler in der
 *  CL 26/27 plötzlich anders als in der 25/26.
 *
 *  Läuft ohne Browser, Firebase und API-Key: die Kaderdateien sind reine
 *  `const playersData = [...]`-Skripte und werden in einem Sandbox-Kontext
 *  ausgewertet.
 * ============================================================================= */

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const APP = require('../tournament-config.js');

function loadPlayersData(file) {
  const full = path.join(__dirname, '..', file);
  const source = fs.readFileSync(full, 'utf8');
  const context = { playersData: null };
  vm.createContext(context);
  vm.runInContext(`${source}\nthis.playersData = playersData;`, context);
  assert.ok(Array.isArray(context.playersData), `${file} stellt kein playersData-Array bereit.`);
  return context.playersData;
}

/* Anzeigename eines Turniers – also das, was die App am Ende zeigt.
 *
 * data.js schiebt jede Kaderdatei beim Laden durch dieselbe Kette:
 * erst die Kürzung auf „Vorname Nachname" (opt-in via `shortenPlayerNames`),
 * dann die handgepflegten Overrides, die das letzte Wort haben. Der Vergleich
 * unten muss auf DIESER Ebene laufen: die rohen Dateien entstanden zu
 * verschiedenen Zeitpunkten mit verschiedenen Generator-Ständen
 * (data-cl2526.js trägt noch ungekürzte Namen wie „Harry Edward Kane"), und
 * ob zwei Dateien byteweise dasselbe schreiben, sieht ohnehin niemand –
 * gleich heissen muss der Spieler in der Anzeige. */
function displayNames(file, tournamentKey) {
  const shortener = require('../name-shortener.js');
  const overridesContext = { window: {} };
  vm.createContext(overridesContext);
  vm.runInContext(
    fs.readFileSync(path.join(__dirname, '..', 'name-overrides.js'), 'utf8'),
    overridesContext,
    { filename: 'name-overrides.js' }
  );
  const overrides = (overridesContext.window.NAME_OVERRIDES || {})[tournamentKey] || {};
  const shorten = APP.tournaments[tournamentKey].shortenPlayerNames === true;

  const names = new Map();
  for (const player of loadPlayersData(file)) {
    let name = player.Spielername;
    if (shorten) name = shortener.shortenPlayerName(name);
    if (Object.prototype.hasOwnProperty.call(overrides, player['player.id'])) {
      name = overrides[player['player.id']];
    }
    names.set(player['player.id'], name);
  }
  return names;
}

const pool = loadPlayersData('data-cl2627.js');
const reference = loadPlayersData('data-cl2526.js');

/* ── 1) Grundform ───────────────────────────────────────────────────────── */
assert.ok(pool.length > 0, 'data-cl2627.js ist leer.');

const ids = pool.map((p) => p['player.id']);
assert.equal(new Set(ids).size, ids.length, 'player.id muss im Pool eindeutig sein.');
for (const id of ids) {
  assert.ok(Number.isFinite(Number(id)), `Ungültige player.id: ${id}`);
}

/* ── 2) Schema deckt die bestehende CL-Kaderdatei ab ────────────────────── */
/* Der Pool traegt zusaetzlich die Vorsaison.*-Felder (Sortierschluessel,
 * siehe scripts/generate-cl-pool.js), aber KEINE Anzeige-toten Felder mehr:
 * Der Serializer (scripts/kader-serializer.js) laesst Felder weg, die keine
 * einzige App-Ansicht liest (Vorsaison.Minuten, Vorsaison.Spiele) – sie
 * wuerden im Browser bei jedem Seitenaufruf nur Parse-Zeit kosten.
 * Geprueft wird deshalb: Basis-Schema aus data-cl2526.js minus tote Felder,
 * in derselben Reihenfolge, die serialisierten Zusatzfelder hinten dran.
 *
 * OPTIONAL_KEYS: `Gewicht` galt bis zum Steckbrief-Fix faelschlich als tot
 * und fehlt deshalb im eingefrorenen 26/27-Stand; der naechste Generator-
 * Lauf bringt es wieder mit. Beides ist gueltig – die Anzeige kommt mit und
 * ohne Feld zurecht (spieleranalyse.js). */
const { DISPLAY_DEAD_FIELDS } = require('./kader-serializer.js');
const OPTIONAL_KEYS = ['Gewicht'];
const expectedKeys = Object.keys(reference[0])
  .filter((k) => !DISPLAY_DEAD_FIELDS.includes(k) && !OPTIONAL_KEYS.includes(k));
const EXTRA_KEYS = ['Vorsaison.Rating', 'Vorsaison.Wert'];
for (const player of pool) {
  const keys = Object.keys(player).filter((k) => !OPTIONAL_KEYS.includes(k));
  assert.deepEqual(
    keys.slice(0, expectedKeys.length), expectedKeys,
    `Abweichendes Basis-Schema bei player.id ${player['player.id']} (${player.Spielername}).`
  );
  for (const extra of EXTRA_KEYS) {
    assert.ok(Object.prototype.hasOwnProperty.call(player, extra),
      `${player.Spielername}: Feld "${extra}" fehlt – ohne das greift die Leistungssortierung nicht.`);
    assert.ok(Number.isFinite(Number(player[extra])),
      `${player.Spielername}: "${extra}" ist keine Zahl (${player[extra]}).`);
    assert.ok(Number(player[extra]) >= 0,
      `${player.Spielername}: "${extra}" darf nicht negativ sein (${player[extra]}).`);
  }
  for (const dead of DISPLAY_DEAD_FIELDS) {
    assert.ok(!Object.prototype.hasOwnProperty.call(player, dead),
      `${player.Spielername}: totes Feld "${dead}" ist wieder da – alter Generator-Stand? ` +
      'Serialisierung laeuft ueber scripts/kader-serializer.js.');
  }
}

/* ── 2b) Der Sortierschluessel trennt tatsaechlich ──────────────────────── */
/* Wenn alle Werte 0 waeren, faende die Liste wieder alphabetisch statt nach
 * Leistung – genau der Zustand, den die Vorsaison-Daten beheben sollen.
 * (Der fruehere Minuten↔Wert-Abgleich entfiel mit den Minuten selbst; die
 * Abdeckungsquote unten faengt einen kaputten Statistik-Abruf genauso.) */
const withForm = pool.filter((p) => Number(p['Vorsaison.Wert']) > 0);
assert.ok(withForm.length > pool.length * 0.5,
  `Nur ${withForm.length} von ${pool.length} Spielern haben Vorsaison-Einsaetze – ` +
  'da hat der Statistik-Abruf nicht funktioniert.');

/* ── 3) Pflichtfelder ───────────────────────────────────────────────────── */
const POSITIONS = new Set(['GOALKEEPER', 'DEFENDER', 'MIDFIELDER', 'ATTACKER']);
for (const player of pool) {
  assert.ok(String(player.Spielername || '').trim(),
    `Spieler ${player['player.id']} hat keinen Namen.`);
  assert.ok(POSITIONS.has(player.Position),
    `Spieler ${player.Spielername} hat unerwartete Position "${player.Position}".`);
  assert.ok(String(player['Club.name'] || '').trim(),
    `Spieler ${player.Spielername} hat keinen Klub – der Pool ist club-zentriert.`);
}

/* ── 4) Namen bleiben zur CL 25/26 identisch ────────────────────────────── */
/* Das ist der eigentliche Zweck des geteilten Mappings: derselbe Spieler
 * heisst in beiden Turnieren gleich, obwohl die Daten aus unterschiedlichen
 * API-Endpunkten und von unterschiedlichen Generator-Ständen stammen.
 * Verglichen wird der Anzeigename (Kürzung + Overrides), nicht der Rohwert
 * in der Datei – siehe displayNames(). */
const poolNames = displayNames('data-cl2627.js', 'cl2627');
const referenceNames = displayNames('data-cl2526.js', 'cl2526');
const mismatches = [];
let overlap = 0;
for (const [id, name] of poolNames) {
  if (!referenceNames.has(id)) continue;
  overlap++;
  const previous = referenceNames.get(id);
  if (previous !== name) mismatches.push(`${id}: "${previous}" → "${name}"`);
}
assert.ok(overlap > 100,
  `Nur ${overlap} Spieler überlappen mit der CL 25/26 – das deutet auf einen kaputten Lauf hin.`);
assert.deepEqual(mismatches, [],
  `Anzeigenamen weichen von data-cl2526.js ab (Eintrag in name-overrides.js fehlt?):\n  ` +
  `${mismatches.join('\n  ')}`);

/* ── 5) Klubzahl passt zur Ligaphase ────────────────────────────────────── */
const clubs = new Set(pool.map((p) => p['Club.name']));
const teamCount = APP.tournaments.cl2627.leaguePhase.teamCount;
assert.ok(clubs.size <= teamCount,
  `${clubs.size} Klubs im Pool, die Ligaphase hat aber nur ${teamCount} Startplätze.`);

/* Die Herleitung je Klub muss zum Pool passen (gleiche Klubs, gleiche Zahl). */
const clubsDoc = JSON.parse(fs.readFileSync(path.join(__dirname, 'cl-pool-cl2627-clubs.json'), 'utf8'));
assert.equal(clubsDoc.clubs.length, clubsDoc.clubCount, 'clubCount passt nicht zur Klubliste.');
assert.equal(clubsDoc.clubCount, clubs.size,
  `cl-pool-cl2627-clubs.json führt ${clubsDoc.clubCount} Klubs, der Pool enthält ${clubs.size}.`);
for (const club of clubsDoc.clubs) {
  assert.ok(String(club.via || '').trim(),
    `Klub ${club.name} hat keine nachvollziehbare Herleitung ("via").`);
}

/* ── 6) Deterministische Sortierung ─────────────────────────────────────── */
/* Der Generator sortiert nach Klub, dann Position, dann Name – damit ein
 * erneuter Lauf einen leeren Diff erzeugt, wenn sich nichts geändert hat. */
const POSITION_ORDER = { GOALKEEPER: 0, DEFENDER: 1, MIDFIELDER: 2, ATTACKER: 3 };
for (let i = 1; i < pool.length; i++) {
  const a = pool[i - 1];
  const b = pool[i];
  const byClub = a['Club.name'].localeCompare(b['Club.name'], 'de');
  if (byClub !== 0) {
    assert.ok(byClub < 0, `Klub-Sortierung verletzt bei Index ${i}: ${a['Club.name']} vor ${b['Club.name']}.`);
    continue;
  }
  const byPosition = POSITION_ORDER[a.Position] - POSITION_ORDER[b.Position];
  if (byPosition !== 0) {
    assert.ok(byPosition < 0,
      `Positions-Sortierung verletzt bei ${a['Club.name']}: ${a.Position} vor ${b.Position}.`);
    continue;
  }
  assert.ok(a.Spielername.localeCompare(b.Spielername, 'de') <= 0,
    `Namens-Sortierung verletzt bei ${a['Club.name']}: ${a.Spielername} vor ${b.Spielername}.`);
}

/* ── 7) Overrides greifen nur auf vorhandene Spieler ────────────────────── */
/* name-overrides.js / position-overrides.js sind Browser-Globals; hier wird
 * nur der Quelltext ausgewertet, damit der Test ohne DOM läuft. */
function loadOverrides(file, globalName) {
  const source = fs.readFileSync(path.join(__dirname, '..', file), 'utf8');
  const context = { window: {} };
  vm.createContext(context);
  vm.runInContext(source, context);
  return context.window[globalName] || {};
}
const nameOverrides = loadOverrides('name-overrides.js', 'NAME_OVERRIDES');
const positionOverrides = loadOverrides('position-overrides.js', 'POSITION_OVERRIDES');
assert.ok(nameOverrides.cl2627, 'name-overrides.js braucht einen cl2627-Block.');
assert.ok(positionOverrides.cl2627, 'position-overrides.js braucht einen cl2627-Block.');

// Die Overrides der CL 25/26 müssen 1:1 auch für 26/27 hinterlegt sein –
// sonst hiesse ein Spieler nach dem Turnierwechsel plötzlich wieder anders.
assert.deepEqual(
  nameOverrides.cl2627, nameOverrides.cl2526,
  'Der cl2627-Namensblock muss dieselben Korrekturen tragen wie cl2526.'
);

// Positionen: cl2627 darf ÜBER cl2526 hinausgehen (der 26/27-Pool kommt aus
// den Vereinskadern und braucht eigene Korrekturen, u. a. die ersten
// DEFENDER-Einträge), aber keine 25/26-Korrektur verlieren oder still
// umdrehen. Ein bewusst geänderter Spieler – etwa ein Flügelspieler, der
// dauerhaft hinten spielt – gehört hier ausgetragen, nicht wegkommentiert.
Object.entries(positionOverrides.cl2526).forEach(([id, pos]) => {
  assert.equal(
    positionOverrides.cl2627[id], pos,
    `Der cl2627-Positionsblock muss die cl2526-Korrektur für player.id ${id} ` +
    `tragen (${pos}), steht aber auf ${positionOverrides.cl2627[id] || 'nichts'}.`
  );
});

const poolIds = new Set(ids.map(String));
const appliedNames = Object.keys(nameOverrides.cl2627).filter((id) => poolIds.has(String(id)));
const appliedPositions = Object.keys(positionOverrides.cl2627).filter((id) => poolIds.has(String(id)));

console.log(
  `cl2627 pool test passed – ${pool.length} Spieler aus ${clubs.size} Klubs, ` +
  `${overlap} Namen deckungsgleich mit cl2526, ` +
  `Overrides aktiv: ${appliedNames.length} Namen / ${appliedPositions.length} Positionen.`
);
