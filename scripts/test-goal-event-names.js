#!/usr/bin/env node
/* =============================================================================
 *  scripts/test-goal-event-names.js
 *
 *  Regressionstest für die Torschützen-Namen (index.js und spieleranalyse.js).
 *
 *  Ausgangslage: api-football liefert in den Tor-Ereignissen den
 *  REGISTERNAMEN eines Spielers ("Raphael Dias Belloli"), im Kader steht
 *  dagegen der geläufige Name ("Raphinha"). In der Detailkarte eines Spiels
 *  stand deshalb unter „Torschützen" ein anderer Name als auf der
 *  Spielerkarte darunter – gleicher Spieler, gleiche Punkte, zwei Namen.
 *
 *  Geprüft wird, dass die Anzeige den KADERNAMEN gewinnen lässt, sobald sich
 *  das Ereignis einem Spieler aus dem Pool zuordnen lässt (über die
 *  api-football-ID oder den Namen) – inklusive der Korrekturen aus
 *  name-shortener.js und name-overrides.js. Nur wenn kein Spieler passt,
 *  bleibt der Name des Anbieters stehen.
 *
 *  Läuft ohne Browser: die Render-Logik wird als Quelltext aus index.js bzw.
 *  spieleranalyse.js geschnitten und hier mit Stubs ausgeführt – geprüft wird
 *  also der ausgelieferte Code, nicht eine Kopie davon.
 *
 *  Aufruf: npm run test:goal-names
 * ============================================================================= */

'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const APP = require('../tournament-config.js');

const ROOT = path.join(__dirname, '..');
const readRoot = (file) => fs.readFileSync(path.join(ROOT, file), 'utf8');

let failures = 0;
function check(label, condition, detail) {
  if (condition) {
    console.log(`✓ ${label}`);
    return;
  }
  failures++;
  console.error(`✗ ${label}${detail ? ` – ${detail}` : ''}`);
}

/* ─────────────────────────────────────────────────────────────────────────────
 *  Kaderdatei laden und durch dieselbe Namenskette schicken wie data.js
 * ───────────────────────────────────────────────────────────────────────────── */
function loadPlayersData(file) {
  const source = readRoot(file);
  const context = { playersData: null };
  vm.createContext(context);
  vm.runInContext(`${source}\nthis.playersData = playersData;`, context, { filename: file });
  assert.ok(Array.isArray(context.playersData), `${file} stellt kein playersData-Array bereit.`);
  return context.playersData;
}

function loadNameOverrides(tournamentKey) {
  const context = { window: {} };
  vm.createContext(context);
  vm.runInContext(readRoot('name-overrides.js'), context, { filename: 'name-overrides.js' });
  return (context.window.NAME_OVERRIDES || {})[tournamentKey] || {};
}

/* Der Pool so, wie ihn die App im Browser sieht: gekürzte Namen, Overrides
 * angewendet und – weil die CL klub-zentriert ist – der Klub in den
 * primären Feldern (Nationalteam.*), siehe Club-Remap in data.js. */
function loadAppPlayers(file, tournamentKey) {
  const shortener = require('../name-shortener.js');
  const overrides = loadNameOverrides(tournamentKey);
  const tournament = APP.tournaments[tournamentKey];
  const shorten = tournament.shortenPlayerNames === true;
  const clubPrimary = tournament.primaryEntity === 'club';

  return loadPlayersData(file).map((raw) => {
    const player = Object.assign({}, raw);
    if (shorten) player.Spielername = shortener.shortenPlayerName(player.Spielername);
    const override = overrides[player['player.id']];
    if (override) player.Spielername = override;
    if (clubPrimary) {
      const club = player['Club.name'];
      const nation = player['Nationalteam.name'];
      player['Nationalteam.name'] = club || nation || '';
      player['Club.name'] = nation || '';
    }
    return player;
  });
}

const appPlayers = loadAppPlayers('data-cl2627.js', 'cl2627');
const byId = new Map(appPlayers.map((p) => [String(p['player.id']), p]));

// Der Fall aus der Meldung: api-football kennt 1496 als "Raphael Dias
// Belloli", die App zeigt "Raphinha".
const RAPHINHA_ID = '1496';
const raphinha = byId.get(RAPHINHA_ID);
check('Kader kennt 1496 als "Raphinha"',
  !!raphinha && raphinha.Spielername === 'Raphinha',
  `gefunden: ${raphinha ? raphinha.Spielername : 'kein Eintrag'}`);

const YAMAL_ID = '386828';
const yamal = byId.get(YAMAL_ID);
check('Kader kennt 386828 als "Lamine Yamal"',
  !!yamal && yamal.Spielername === 'Lamine Yamal',
  `gefunden: ${yamal ? yamal.Spielername : 'kein Eintrag'}`);

/* ─────────────────────────────────────────────────────────────────────────────
 *  Testdaten: ein Spiel mit drei Toren
 * ───────────────────────────────────────────────────────────────────────────── */
const MATCH = {
  teamA: 'Barcelona',
  teamB: 'Feyenoord',
  teamAId: '529',
  teamBId: '209',
  goalEvents: [
    {
      // Registername des Anbieters, Vorlage ebenfalls mit Registernamen.
      elapsed: 3, extra: null, teamId: '529', teamName: 'Barcelona',
      playerId: RAPHINHA_ID, playerName: 'Raphael Dias Belloli',
      assistId: YAMAL_ID, assistName: 'Lamine Yamal',
      detail: 'Normal Goal'
    },
    {
      // Vorlage mit Registername – auch die muss der Kadername gewinnen.
      elapsed: 22, extra: null, teamId: '529', teamName: 'Barcelona',
      playerId: YAMAL_ID, playerName: 'Lamine Yamal',
      assistId: RAPHINHA_ID, assistName: 'Raphael Dias Belloli',
      detail: 'Normal Goal'
    },
    {
      // Nicht im Pool: der Name des Anbieters bleibt stehen (gekürzt).
      elapsed: 70, extra: null, teamId: '209', teamName: 'Feyenoord',
      playerId: '999999999', playerName: 'Jonathan Doe',
      assistId: '', assistName: '',
      detail: 'Normal Goal'
    }
  ]
};

/* ─────────────────────────────────────────────────────────────────────────────
 *  Quelltext-Schnipsel ausführbar machen
 * ───────────────────────────────────────────────────────────────────────────── */
function sliceBetween(source, file, startMarker, endMarker) {
  const start = source.indexOf(startMarker);
  assert.notEqual(start, -1, `${file}: Marker „${startMarker}" nicht gefunden.`);
  const end = source.indexOf(endMarker, start + startMarker.length);
  assert.notEqual(end, -1, `${file}: Marker „${endMarker}" nicht gefunden.`);
  return source.slice(start, end);
}

function sliceFunction(source, file, name) {
  const start = source.indexOf(`function ${name}(`);
  assert.notEqual(start, -1, `${file}: Funktion ${name} nicht gefunden.`);
  let depth = 0;
  for (let i = source.indexOf('{', start); i < source.length; i += 1) {
    if (source[i] === '{') depth += 1;
    else if (source[i] === '}') {
      depth -= 1;
      if (depth === 0) return source.slice(start, i + 1);
    }
  }
  throw new Error(`${file}: Funktion ${name} ist nicht geschlossen.`);
}

// Gemeinsame Stubs für beide Seiten: Textfluchten, Team-Schlüssel und der
// Zugriff auf den Pool.
const STUBS = `
  const escapeHtml = (v) => String(v ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#039;');
  const normalizeKey = (v) => String(v ?? '').trim().toLowerCase();
  const getPlayerById = (id) => (id === undefined || id === null || id === '')
    ? undefined
    : poolById.get(String(id));
  const getPlayerByName = (name) => name
    ? playersData.find((p) => p.Spielername === name)
    : undefined;
`;

/* ── index.js: Detailkarte „Aktuelle Spiele" und Spielkacheln ──────────── */
const indexJs = readRoot('index.js');
const indexGoalSrc = sliceBetween(indexJs, 'index.js',
  'function getGoalEventName(', 'function refreshGoalLineOverflow(');

const renderIndexGoals = vm.runInNewContext(`
  (function (playersData, poolById) {
    ${STUBS}
    const normalizeCountry = normalizeKey;
    ${indexGoalSrc}
    return (match, teamName) => renderGoalEventList(match, teamName, 'clcm');
  })
`, {}, { filename: 'index.js#goal-events' })(appPlayers, byId);

/* ── spieleranalyse.js: Spielplan-Ansicht ─────────────────────────────── */
const analyseJs = readRoot('spieleranalyse.js');
const analyseGoalSrc = sliceBetween(analyseJs, 'spieleranalyse.js',
  'function getScheduleGoalEventName(', 'function refreshScheduleGoalLineOverflow(');
const resolveIdentitySrc = sliceFunction(analyseJs, 'spieleranalyse.js', 'resolvePlayerIdentity');

const renderAnalyseGoals = vm.runInNewContext(`
  (function (playersData, poolById) {
    ${STUBS}
    const getCanonicalCountryKey = normalizeKey;
    const normalizeNationFlagKey = normalizeKey;
    ${resolveIdentitySrc}
    ${analyseGoalSrc}
    return (match, teamName) => renderScheduleGoalEventList(match, teamName, 'sc');
  })
`, {}, { filename: 'spieleranalyse.js#goal-events' })(appPlayers, byId);

/* ─────────────────────────────────────────────────────────────────────────────
 *  Prüfungen
 * ───────────────────────────────────────────────────────────────────────────── */
const VIEWS = [
  { label: 'index.js (Detailkarte)', render: renderIndexGoals },
  { label: 'spieleranalyse.js (Spielplan)', render: renderAnalyseGoals }
];

for (const view of VIEWS) {
  const home = view.render(MATCH, 'Barcelona');
  const away = view.render(MATCH, 'Feyenoord');

  check(`${view.label}: Torschütze steht als "Raphinha" in der Liste`,
    home.includes('>Raphinha<'), home);

  check(`${view.label}: der Registername "Dias Belloli" taucht nirgends auf`,
    !home.includes('Dias Belloli'), home);

  check(`${view.label}: Vorlage steht als "Raphinha" in der Liste`,
    home.includes('(<') ? /\(<[^>]*>Raphinha</.test(home) : home.includes('(Raphinha)'), home);

  check(`${view.label}: zweiter Torschütze bleibt "L. Yamal"`,
    home.includes('>L. Yamal<'), home);

  check(`${view.label}: Spieler ohne Kadereintrag behält den Anbieternamen`,
    away.includes('>J. Doe<'), away);

  // Der Apostroph der Spielminute steht HTML-escaped in der Ausgabe.
  check(`${view.label}: die Minuten stehen weiterhin an der Tor-Zeile`,
    home.includes('>3&#039;<') && home.includes('>22&#039;<'), home);
}

/* Ein Ereignis ohne Vorlage darf keine erfinden – auch nicht über eine
 * mitgelieferte assistId. */
const NO_ASSIST_MATCH = {
  teamA: 'Barcelona', teamB: 'Feyenoord', teamAId: '529', teamBId: '209',
  goalEvents: [{
    elapsed: 9, extra: null, teamId: '529', teamName: 'Barcelona',
    playerId: RAPHINHA_ID, playerName: 'Raphael Dias Belloli',
    assistId: YAMAL_ID, assistName: '',
    detail: 'Normal Goal'
  }]
};

for (const view of VIEWS) {
  const html = view.render(NO_ASSIST_MATCH, 'Barcelona');
  check(`${view.label}: ohne Vorlage im Ereignis wird keine angezeigt`,
    !html.includes('Yamal'), html);
  check(`${view.label}: der Torschütze steht trotzdem als "Raphinha" da`,
    html.includes('>Raphinha<'), html);
}

if (failures > 0) {
  console.error(`\n${failures} Prüfung(en) fehlgeschlagen.`);
  process.exit(1);
}
console.log('\nAlle Torschützen-Namen-Prüfungen bestanden.');
