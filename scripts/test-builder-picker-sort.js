'use strict';

/* =============================================================================
 *  test-builder-picker-sort.js
 *
 *  Guard für die Reihenfolge der Spielerliste im TeamBuilder.
 *
 *  Früher entschied `sortKey` = primäre Entität + Name. Bei der WM war das
 *  die Nation, bei der CL nach dem Club-Remap (data.js) aber der KLUB – die
 *  ungefilterte Liste war damit nach Klub sortiert und begann bei „Arsenal".
 *  Sie folgt jetzt derselben Ordnung wie die Spieler-Analyse: erreichte
 *  Punkte, bei Gleichstand die Leistung der Vorsaison, zuletzt der Name.
 *
 *  team-builder.js ist eine Browser-IIFE mit DOM- und Firebase-Zugriffen und
 *  lässt sich in Node nicht als Ganzes ausführen. Geprüft wird deshalb der
 *  ECHTE Vergleicher: sein Quelltext wird aus der Datei geschnitten und in
 *  einer Sandbox ausgeführt. Ändert sich die Sortierung, schlägt der Test an.
 * ============================================================================= */

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ROOT = path.join(__dirname, '..');
const source = fs.readFileSync(path.join(ROOT, 'team-builder.js'), 'utf8');

/* ── 1) Der Vergleicher ersetzt die alte Klub-Sortierung ────────────────── */
assert.ok(!/\bsortKey\s*:/.test(source),
  'team-builder.js: `sortKey` ist wieder da – die Liste würde erneut nach der primären Entität (CL: Klub) sortieren.');
assert.ok(!/sortKey\.localeCompare/.test(source),
  'team-builder.js: die Picker-Liste vergleicht wieder `sortKey` statt Punkte/Vorsaison-Leistung.');

const pickerSortStart = source.indexOf('function getFilteredPickerPlayers');
assert.ok(pickerSortStart > -1, 'getFilteredPickerPlayers nicht gefunden.');
assert.match(source.slice(pickerSortStart), /comparePickerPlayers\(a, b\)/,
  'getFilteredPickerPlayers muss comparePickerPlayers verwenden.');

assert.match(source, /seasonValue:\s*Number\(p\['Vorsaison\.Wert'\]\)/,
  'team-builder.js: der Sortierschlüssel Vorsaison.Wert wird nicht mehr aus den Kaderdaten gelesen.');

/* ── 2) Den echten Vergleicher ausschneiden und ausführen ───────────────── */
const blockStart = source.indexOf('    function getPickerSortPoints(');
const blockEnd = source.indexOf('    function getFilteredPickerPlayers(');
assert.ok(blockStart > -1 && blockEnd > blockStart,
  'getPickerSortPoints/comparePickerPlayers nicht am erwarteten Ort – Test anpassen.');

const sandbox = { builderPointsMap: null };
vm.createContext(sandbox);
vm.runInContext(`${source.slice(blockStart, blockEnd)}\nthis.comparePickerPlayers = comparePickerPlayers;`, sandbox);
const comparePickerPlayers = sandbox.comparePickerPlayers;

/* Wie preparedPlayers in team-builder.js, nur auf die Sortierfelder reduziert. */
function prepared(id, name, seasonValue, seasonRating) {
  return { id: String(id), name, seasonValue, seasonRating };
}

/* ── 3) Ohne Punkte entscheidet die Vorsaison-Leistung ──────────────────── */
const zaire = prepared(1, 'Zzz Zweitliga', 0, 0);          // alphabetisch zuletzt, ohne Einsätze
const star = prepared(2, 'Mmm Stammspieler', 5000, 7.4);   // volle Vorsaison
const rotation = prepared(3, 'Aaa Rotation', 1200, 6.9);   // alphabetisch zuerst, wenig Einsätze

let sorted = [zaire, rotation, star].sort(comparePickerPlayers).map((p) => p.name);
assert.deepEqual(sorted, ['Mmm Stammspieler', 'Aaa Rotation', 'Zzz Zweitliga'],
  'Vor Turnierstart muss die Vorsaison-Leistung entscheiden, nicht das Alphabet.');

/* Gleiche Leistung → Rating, dann Name. */
const sameValueA = prepared(4, 'Berta', 900, 7.1);
const sameValueB = prepared(5, 'Anton', 900, 6.2);
const sameAll = prepared(6, 'Caesar', 900, 7.1);
sorted = [sameValueB, sameAll, sameValueA].sort(comparePickerPlayers).map((p) => p.name);
assert.deepEqual(sorted, ['Berta', 'Caesar', 'Anton'],
  'Bei gleichem Vorsaison-Wert entscheidet das Rating, erst danach der Name.');

/* Ohne Vorsaison-Daten (WM, ältere Kaderdateien) bleibt es alphabetisch. */
sorted = [prepared(7, 'Zoe', 0, 0), prepared(8, 'Anna', 0, 0), prepared(9, 'Mia', 0, 0)]
  .sort(comparePickerPlayers).map((p) => p.name);
assert.deepEqual(sorted, ['Anna', 'Mia', 'Zoe'],
  'Ohne Vorsaison-Daten muss die alte alphabetische Reihenfolge übrig bleiben.');

/* ── 4) Sobald Punkte da sind, entscheiden sie zuerst ───────────────────── */
sandbox.builderPointsMap = { '1': 42, '2': 0, '3': 7 };
sorted = [rotation, star, zaire].sort(comparePickerPlayers).map((p) => p.name);
assert.deepEqual(sorted, ['Zzz Zweitliga', 'Aaa Rotation', 'Mmm Stammspieler'],
  'Nach Turnierstart müssen die erreichten Punkte vor der Vorsaison-Leistung stehen.');

/* Fehlende Einträge in der Punkte-Map zählen als 0, nicht als NaN. */
sandbox.builderPointsMap = { '2': 5 };
sorted = [zaire, rotation, star].sort(comparePickerPlayers).map((p) => p.name);
assert.deepEqual(sorted, ['Mmm Stammspieler', 'Aaa Rotation', 'Zzz Zweitliga'],
  'Spieler ohne Punkte-Eintrag müssen mit 0 Punkten einsortiert werden.');

/* ── 5) Die Picker-Liste sieht nachgeladene Punkte ──────────────────────── */
/* Die Punkte kommen asynchron (loadBuilderPoints). Ohne erneutes Rendern
 * bliebe die bereits gezeichnete Liste in der Reihenfolge von vorher. */
const loadStart = source.indexOf('async function loadBuilderPoints');
assert.ok(loadStart > -1, 'loadBuilderPoints nicht gefunden.');
assert.match(source.slice(loadStart, loadStart + 1800), /renderPickerPlayers\(true\)/,
  'loadBuilderPoints muss die Picker-Liste neu rendern, sonst passt ihre Reihenfolge nicht zu den geladenen Punkten.');

console.log('builder picker sort test passed');
