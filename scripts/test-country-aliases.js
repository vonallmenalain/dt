'use strict';

/* =============================================================================
 *  test-country-aliases.js
 *
 *  Guard für die mehrsprachige Freitextsuche (country-aliases.js).
 *
 *  Für die WM war das Mapping komplett: „Deutschland" findet Spieler mit der
 *  API-Nationalität „Germany". In der CL griff es aus zwei Gründen nicht:
 *
 *    1. Der Spielerpool ist ein weltweit gemischter Klub-Pool. Zwei Drittel
 *       der vorkommenden Nationalitäten (Nigeria, Griechenland, Kamerun, …)
 *       standen gar nicht in der Tabelle.
 *    2. Der Club-Remap in data.js legt bei club-zentrierten Turnieren den
 *       KLUB in die primären Felder (Nationalteam.*) und die Nation in die
 *       sekundären (Club.*). Die Suche hat die Aliase aber nur für das
 *       primäre Feld angefragt – und damit für einen Klubnamen.
 *
 *  Läuft ohne Browser: country-aliases.js ist eine reine IIFE ohne DOM- oder
 *  Firebase-Abhängigkeiten, die Kaderdateien sind `const playersData = [...]`.
 * ============================================================================= */

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ROOT = path.join(__dirname, '..');

function readSource(file) {
  return fs.readFileSync(path.join(ROOT, file), 'utf8');
}

function loadPlayersData(file) {
  const context = { playersData: null };
  vm.createContext(context);
  vm.runInContext(`${readSource(file)}\nthis.playersData = playersData;`, context);
  assert.ok(Array.isArray(context.playersData), `${file} stellt kein playersData-Array bereit.`);
  return context.playersData;
}

/* country-aliases.js exportiert auf `window` bzw. `globalThis`. */
const aliasContext = {};
vm.createContext(aliasContext);
vm.runInContext(readSource('country-aliases.js'), aliasContext);
const { getCountryAliases, getCountrySearchAliases } = aliasContext;
assert.equal(typeof getCountryAliases, 'function', 'getCountryAliases fehlt.');
assert.equal(typeof getCountrySearchAliases, 'function', 'getCountrySearchAliases fehlt.');

/* ── 1) Jede vorkommende Nationalität ist abgedeckt ─────────────────────── */
const KADER = ['data-wm2026.js', 'data-cl2526.js', 'data-cl2627.js'];
const nationsByFile = new Map();
for (const file of KADER) {
  const nations = new Set();
  for (const player of loadPlayersData(file)) {
    const nation = String(player['Nationalteam.name'] || '').trim();
    if (nation) nations.add(nation);
  }
  nationsByFile.set(file, nations);
}

for (const [file, nations] of nationsByFile) {
  const missing = [...nations].filter((nation) => getCountryAliases(nation).length === 0);
  assert.deepEqual(
    missing, [],
    `${file}: ohne Alias-Eintrag bleibt die Suche einsprachig – fehlend in country-aliases.js: ${missing.join(', ')}`
  );
}

/* ── 2) Deutsch → Englisch, auch bei abweichender Schreibweise ──────────── */
/* Die Kaderdaten nennen dasselbe Land je nach Quelle anders. Der deutsche
 * Name muss trotzdem an jeder Schreibweise hängen. */
const EXPECTED = [
  ['Germany', 'Deutschland'],
  ['Switzerland', 'Schweiz'],
  ['Netherlands', 'Niederlande'],
  ['Nigeria', 'NGA'],
  ['Greece', 'Griechenland'],
  ['North Macedonia', 'Nordmazedonien'],
  ['Republic of Ireland', 'Irland'],
  ['Korea Republic', 'Südkorea'],
  ["Côte d'Ivoire", 'Elfenbeinküste'],
  ['Czechia', 'Tschechien'],
  ['Türkiye', 'Türkei']
];
for (const [english, german] of EXPECTED) {
  const aliases = getCountryAliases(english);
  assert.ok(
    aliases.some((alias) => alias.toLowerCase() === german.toLowerCase()),
    `„${german}" fehlt in den Aliasen von „${english}" (gefunden: ${aliases.join(', ') || '–'}).`
  );
}

/* ── 3) Mehrere Felder auf einmal (Club-Remap) ──────────────────────────── */
const combined = getCountrySearchAliases('Bayern München', 'Germany');
assert.ok(combined.includes('Deutschland'),
  'getCountrySearchAliases muss die Aliase ALLER übergebenen Felder liefern – sonst greift die CL-Suche nicht.');
assert.equal(getCountrySearchAliases('Switzerland'), getCountrySearchAliases('Switzerland', ''),
  'Der Ein-Argument-Aufruf (WM) muss unverändert bleiben.');

/* ── 4) Ende-zu-Ende: „Deutschland" findet einen CL-Spieler ─────────────── */
/* Spiegelt den Club-Remap aus data.js (Klub → primär, Nation → sekundär)
 * und den Suchindex der Views. Schlägt fehl, sobald eine der beiden Seiten
 * auseinanderläuft. */
function normalizeSearchText(value) {
  return String(value == null ? '' : value)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/ß/g, 'ss')
    .toLowerCase();
}

const clubRemapped = loadPlayersData('data-cl2627.js').map((p) => ({
  Spielername: p.Spielername,
  'Nationalteam.name': p['Club.name'],   // primär: Klub
  'Club.name': p['Nationalteam.name']    // sekundär: Nation
}));

function buildHaystack(player) {
  return normalizeSearchText([
    player.Spielername,
    player['Nationalteam.name'],
    getCountrySearchAliases(player['Nationalteam.name'], player['Club.name']),
    player['Club.name']
  ].join(' '));
}

const germans = clubRemapped.filter((p) => p['Club.name'] === 'Germany');
assert.ok(germans.length > 0, 'Der CL-Pool enthält keine deutschen Spieler – Testannahme prüfen.');
for (const player of germans) {
  assert.ok(buildHaystack(player).includes('deutschland'),
    `„Deutschland" findet ${player.Spielername} (Germany) nicht.`);
}

/* Gegenprobe: die Suche darf nicht plötzlich jeden Spieler treffen. */
const nonGerman = clubRemapped.find((p) => p['Club.name'] === 'Spain');
assert.ok(nonGerman, 'Kein spanischer Spieler im CL-Pool – Testannahme prüfen.');
assert.ok(!buildHaystack(nonGerman).includes('deutschland'),
  `„Deutschland" trifft fälschlich ${nonGerman.Spielername} (Spain).`);
assert.ok(buildHaystack(nonGerman).includes('spanien'),
  `„Spanien" findet ${nonGerman.Spielername} (Spain) nicht.`);

/* ── 5) Alle Suchindizes fragen BEIDE Entitätsfelder an ─────────────────── */
/* Ohne das zweite Feld sucht die CL die Aliase eines Klubnamens – und
 * findet nie ein Land. */
const CALL_SITES = [
  ['spieleranalyse.js', /getCountrySearchAliases\(\s*p\['Nationalteam\.name'\]\s*,\s*p\['Club\.name'\]\s*\)/],
  ['team-builder.js', /getCountrySearchAliases\(p\['Nationalteam\.name'\], p\['Club\.name'\]\)/],
  ['adm-position-overrides.html', /getCountrySearchAliases\(player\._nation, player\._club\)/]
];
for (const [file, pattern] of CALL_SITES) {
  assert.match(readSource(file), pattern,
    `${file}: die Suche muss die Länder-Aliase für das primäre UND das sekundäre Feld anfragen (Club-Remap).`);
}

/* Der Remap selbst muss bleiben, sonst zeigt die obige Erwartung ins Leere. */
assert.match(readSource('data.js'), /p\["Nationalteam\.name"\] = cn \|\| nn \|\| ""/,
  'data.js: der Club-Remap fehlt – die Annahme „Nation liegt bei der CL in Club.*" gilt dann nicht mehr.');

console.log('country aliases test passed');
