'use strict';

/* =============================================================================
 *  test-player-pool-filter.js
 *
 *  Guard fuer den Pool-Filter aus data.js (`hidePlayersWithoutProfile`).
 *
 *  Fuer einen Teil der gemeldeten Kaderspieler fuehrt api-football gar kein
 *  Profil: kein Geburtsdatum, keine Nationalitaet, nur das Silhouetten-
 *  Platzhalterbild und ein abgekuerzter Name ("A. Le Borgne"). Das sind
 *  praktisch ausschliesslich Akademiespieler – durch den abgekuerzten
 *  Vornamen standen sie alphabetisch zuoberst und haben die Spielerliste
 *  angefuehrt.
 *
 *  Geprueft wird beides: dass der Filter das Richtige trifft (an den echten
 *  Kaderdateien nachgerechnet) und dass er ausschliesslich dort greift, wo er
 *  eingeschaltet ist – die WM darf sich nicht mitveraendern.
 *
 *  Dazu der zweite Filter aus derselben Stelle (`dedupePlayerProfiles`):
 *  api-football fuehrt einzelne Spieler unter ZWEI player.id-Werten. Beide
 *  Eintraege sind gepflegt, kommen also durch den Filter oben durch – der
 *  Spieler stand damit zweimal in der Liste, teils in zwei verschiedenen
 *  Positionsreihen, und liess sich doppelt aufstellen.
 * ============================================================================= */

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const APP = require('../tournament-config.js');

function loadPlayersData(file) {
  const source = fs.readFileSync(path.join(__dirname, '..', file), 'utf8');
  const context = { playersData: null };
  vm.createContext(context);
  vm.runInContext(`${source}\nthis.playersData = playersData;`, context);
  return context.playersData;
}

// Dasselbe Kriterium wie in data.js: nur wenn BEIDES fehlt.
function isProfileless(p) {
  const hasBirth = String(p['Geburtsdatum'] == null ? '' : p['Geburtsdatum']).trim() !== '';
  const hasNation = String(p['Nationalteam.name'] == null ? '' : p['Nationalteam.name']).trim() !== '';
  return !hasBirth && !hasNation;
}

/* ── 1) Flag ist gesetzt, wo es hingehoert ─────────────────────────────── */
assert.equal(APP.tournaments.cl2627.hidePlayersWithoutProfile, true,
  'cl2627 muss Spieler ohne Stammdaten ausblenden.');
assert.notEqual(APP.tournaments.wm2026.hidePlayersWithoutProfile, true,
  'Die WM ist eingefroren – der Filter darf dort nicht greifen.');

/* ── 2) Die WM waere ohnehin nicht betroffen ───────────────────────────── */
/* Doppelte Absicherung: selbst wenn das Flag versehentlich gesetzt wuerde,
 * duerfte sich am WM-Pool nichts aendern. */
const wm = loadPlayersData('data-wm2026.js');
assert.equal(wm.filter(isProfileless).length, 0,
  'data-wm2026.js enthaelt Spieler ohne Stammdaten – der Filter waere dort nicht mehr folgenlos.');

/* ── 3) Der Filter trifft genau die Nachwuchs-Eintraege ────────────────── */
const pool = loadPlayersData('data-cl2627.js');
const hidden = pool.filter(isProfileless);
assert.ok(hidden.length > 0, 'Erwartet werden Eintraege ohne Stammdaten in data-cl2627.js.');
assert.ok(hidden.length < pool.length * 0.2,
  `${hidden.length} von ${pool.length} Spielern wuerden ausgeblendet – das ist zu viel, ` +
  'da stimmt etwas mit den Quelldaten nicht.');

// Abgekuerzter Vorname ("A. Le Borgne") kommt AUSSCHLIESSLICH in dieser
// Gruppe vor. Waere das nicht so, wuerde der Filter echte Spieler treffen
// bzw. abgekuerzte Namen stehen lassen – beides waere ein Regressionsfall.
const abbreviated = pool.filter((p) => /^[A-Za-zÀ-ÖØ-öø-ÿ]\.\s/.test(p.Spielername || ''));
for (const p of abbreviated) {
  assert.ok(isProfileless(p),
    `"${p.Spielername}" (${p['Club.name']}) hat einen abgekuerzten Vornamen, aber gepflegte ` +
    'Stammdaten – der Filter wuerde ihn stehen lassen.');
}
const remaining = pool.filter((p) => !isProfileless(p));
assert.equal(remaining.filter((p) => /^[A-Za-zÀ-ÖØ-öø-ÿ]\.\s/.test(p.Spielername || '')).length, 0,
  'Nach dem Filter darf kein abgekuerzter Vorname mehr in der Liste stehen.');

/* ── 4) Kein echter Spieler faellt raus ────────────────────────────────── */
/* Ein Teil der Ausblend-Gruppe stand schon im 25/26-Pool – das ist kein
 * Widerspruch: die Kaderdatei 25/26 enthaelt alle FUER den Wettbewerb
 * gemeldeten Spieler, auch die der UEFA-Liste B (Nachwuchs, zusaetzlich zum
 * 25er-Kader registrierbar), unabhaengig von Einsaetzen.
 *
 * Entscheidend ist die Konsistenz: wer heute ausgeblendet wird, muss auch
 * damals schon ohne Stammdaten gewesen sein. Waere jemand in 25/26 gepflegt
 * und in 26/27 leer, waere das eine Datenregression im Generator – und der
 * Filter wuerde einen echten Spieler verschlucken. */
const previousById = new Map(loadPlayersData('data-cl2526.js').map((p) => [p['player.id'], p]));
const regressions = hidden
  .filter((p) => previousById.has(p['player.id']))
  .filter((p) => !isProfileless(previousById.get(p['player.id'])))
  .map((p) => {
    const before = previousById.get(p['player.id']);
    return `${before.Spielername} (${before['Club.name']}, Geb. ${before.Geburtsdatum})`;
  });
// Laengenvergleich statt deepEqual: die Arrays stammen aus einem
// vm-Kontext (anderes Realm), deshalb wuerde deepStrictEqual schon an den
// unterschiedlichen Array-Prototypen scheitern – auch bei leeren Arrays.
assert.equal(regressions.length, 0,
  'Diese Spieler hatten in data-cl2526.js gepflegte Stammdaten und in data-cl2627.js nicht mehr – ' +
  `der Filter wuerde echte Spieler ausblenden:\n  ${regressions.join('\n  ')}`);

/* ── 4b) Doppelprofile: nach der Ladekette steht niemand zweimal drin ───── */
/* Geprueft wird am Ergebnis, nicht an der Regel: data.js wird ausgefuehrt
 * wie im Browser, und danach darf es keine zwei Eintraege mit gleichem
 * Anzeigenamen UND gleichem Geburtsdatum mehr geben. */
function runDataJs(tournamentKey) {
  const context = {};
  vm.createContext(context);
  context.window = context;
  context.console = { log() {}, warn() {}, error() {} };
  context.document = {
    write(html) {
      const src = /src="([^"]+)"/.exec(html);
      if (src) {
        const file = src[1].split('?')[0];
        vm.runInContext(fs.readFileSync(path.join(__dirname, '..', file), 'utf8'), context,
          { filename: file });
        return;
      }
      const inline = /^<script>([\s\S]*)<\/script>$/.exec(String(html).trim());
      assert.ok(inline, `data.js schreibt etwas Unerwartetes: ${String(html).slice(0, 60)}`);
      vm.runInContext(inline[1], context, { filename: 'data.js:inline' });
    }
  };
  const tournament = APP.tournaments[tournamentKey];
  context.APP_CONFIG = {
    tournaments: APP.tournaments,
    activeTournamentKey: tournamentKey,
    primaryEntity: tournament.primaryEntity || 'nation',
    isTournamentLoadable() { return true; },
    data: { fileName() { return tournament.dataFile; } }
  };
  vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'data.js'), 'utf8'), context,
    { filename: 'data.js' });
  return { context, players: vm.runInContext('playersData', context) };
}

function duplicateLabels(players) {
  const seen = new Map();
  const found = [];
  players.forEach((p) => {
    const birth = String(p['Geburtsdatum'] == null ? '' : p['Geburtsdatum']).trim();
    const name = String(p['Spielername'] == null ? '' : p['Spielername']).trim();
    if (!birth || !name) return;
    const key = `${name}|${birth}`;
    if (seen.has(key)) found.push(`${name} (${seen.get(key)} / ${p['player.id']})`);
    else seen.set(key, p['player.id']);
  });
  return found;
}

assert.equal(APP.tournaments.cl2627.dedupePlayerProfiles, true,
  'Fuer cl2627 muss der Doppelprofil-Filter eingeschaltet sein.');
assert.notEqual(APP.tournaments.wm2026.dedupePlayerProfiles, true,
  'Die WM bleibt eingefroren – kein Doppelprofil-Filter.');
assert.notEqual(APP.tournaments.cl2526.dedupePlayerProfiles, true,
  'cl2526 bleibt als Teststand unveraendert.');

const cl = runDataJs('cl2627');
assert.equal(cl.context.__PLAYER_POOL_DEDUPE__.active, true);
assert.equal(cl.context.__PLAYER_POOL_DEDUPE__.error, undefined,
  'Der Doppelprofil-Filter darf nicht in den Fehlerpfad laufen.');
const clDuplicates = duplicateLabels(cl.players);
assert.equal(clDuplicates.length, 0,
  `Nach der Ladekette stehen Spieler doppelt in cl2627: ${clDuplicates.join(', ')}`);

// Die Regel darf nur greifen, wo sie soll – und nur dort etwas wegnehmen.
const wmRun = runDataJs('wm2026');
assert.equal(wmRun.context.__PLAYER_POOL_DEDUPE__.active, false);
assert.equal(wmRun.players.length, loadPlayersData('data-wm2026.js').length,
  'Die WM-Spielerzahl darf sich durch den Filter nicht aendern.');

// Der behaltene Eintrag ist der mit der besseren Beleglage, nicht der
// zufaellig erste: bei Doppelprofilen traegt genau einer die Einsatzdaten.
const rawById = new Map(loadPlayersData('data-cl2627.js').map((p) => [String(p['player.id']), p]));
(cl.context.__PLAYER_POOL_DEDUPE__.dropped || []).forEach((label) => {
  const id = /\((\d+)\)\s*$/.exec(label);
  assert.ok(id, `Unerwartetes Format im Dedupe-Log: ${label}`);
  const droppedPlayer = rawById.get(id[1]);
  assert.ok(droppedPlayer, `Verworfener Spieler ${id[1]} steht nicht in der Kaderdatei.`);
  const kept = cl.players.find((p) =>
    p.Spielername === droppedPlayer.Spielername && p.Geburtsdatum === droppedPlayer.Geburtsdatum);
  assert.ok(kept, `Zu ${label} ist kein Eintrag uebrig geblieben – der Filter hat beide entfernt.`);
  assert.ok((kept['Vorsaison.Wert'] || 0) >= (droppedPlayer['Vorsaison.Wert'] || 0),
    `Bei ${label} wurde der Eintrag mit der besseren Beleglage verworfen.`);
});

/* ── 5) data.js implementiert genau dieses Kriterium ───────────────────── */
const dataJs = fs.readFileSync(path.join(__dirname, '..', 'data.js'), 'utf8');
assert.match(dataJs, /hidePlayersWithoutProfile/,
  'data.js muss das Turnier-Flag auswerten.');
assert.match(dataJs, /!hasBirth && !hasNation/,
  'data.js muss BEIDE Bedingungen verlangen – sonst fielen gepflegte Spieler raus.');
assert.match(dataJs, /__PLAYER_POOL_FILTER__/,
  'Der Filter soll sein Ergebnis fuer die Fehlersuche exponieren.');
assert.match(dataJs, /dedupePlayerProfiles/,
  'data.js muss das Doppelprofil-Flag auswerten.');
assert.match(dataJs, /__PLAYER_POOL_DEDUPE__/,
  'Auch der Doppelprofil-Filter soll sein Ergebnis exponieren.');

console.log(
  `player pool filter test passed – ${hidden.length} von ${pool.length} Spielern werden ` +
  `in cl2627 ausgeblendet, dazu ${cl.context.__PLAYER_POOL_DEDUPE__.removed} Doppelprofil(e); ` +
  `${cl.players.length} bleiben sichtbar.`
);
