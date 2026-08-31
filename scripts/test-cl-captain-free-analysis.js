'use strict';

/* =============================================================================
 *  test-cl-captain-free-analysis.js
 *
 *  Regressionstest: In einem Turnier ohne Captain (CL, `captainEnabled: false`)
 *  darf die Analyse-Seite – und dort vor allem der Bereich „Vergleiche" –
 *  nirgends mehr einen Captain zeigen.
 *
 *  Hintergrund: die Captain-Vergleiche in spieleranalyse.js waren als einzige
 *  Ansicht nicht an das Turnier-Flag gebunden. In der CL erschienen deshalb
 *  weiterhin die Karte „Captain-Duell" (mit „— kein Captain —"), die Karte
 *  „Captain-Optimierung", die Kachel „Captain-Bonus" und die Zeile
 *  „Captain-Wahlen". Schlimmer noch: das „mögliche Maximum" der What-If-
 *  Analyse enthielt einen Captain-Bonus, den es in der CL gar nicht gibt –
 *  „Verpasste Punkte" und „Quote vom Maximum" waren dadurch falsch.
 *
 *  spieleranalyse.js ist eine Browser-IIFE mit DOM-/Firebase-Abhaengigkeiten
 *  und laesst sich nicht als Ganzes laden. Der Test schneidet deshalb die
 *  betroffenen Funktionen per Klammer-Matching heraus und fuehrt sie mit
 *  minimalen Stubs aus – einmal mit und einmal ohne Captain-Feature. So wird
 *  echtes Render-Verhalten geprueft, nicht nur Text im Quelltext.
 * ============================================================================= */

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ROOT = path.join(__dirname, '..');
const source = fs.readFileSync(path.join(ROOT, 'spieleranalyse.js'), 'utf8');

/* ── Funktion per Namen aus der IIFE herausschneiden ────────────────────── */
function grab(name) {
  const start = source.indexOf(`function ${name}(`);
  assert.notEqual(start, -1, `Funktion ${name} fehlt in spieleranalyse.js.`);
  let depth = 0;
  let seen = false;
  for (let i = start; i < source.length; i++) {
    if (source[i] === '{') { depth++; seen = true; }
    else if (source[i] === '}') { depth--; if (seen && depth === 0) return source.slice(start, i + 1); }
  }
  throw new Error(`Klammern von ${name} sind unausgeglichen.`);
}

const EXTRACTED = [
  'cmpNormalizePosition',
  'getEnrichedTeams',
  'getEnrichedTeamByManager',
  'renderManagerDuell',
  'wireCmpPositionToggles',
  'buildManagerStoryline',
  'renderPlayerStatRows',
  'renderWhatIfAnalysis',
  'computePerfectLightTeam',
  'buildWhatIfStoryline'
].map(grab).join('\n\n');

/* ── Testdaten: zwei Manager mit je 15 Spielern, A hat einen Captain ─────
 * Der Kader ist bewusst klein gehalten; entscheidend ist nur, dass es einen
 * gespeicherten Captain gibt und dass Punkte vergeben sind. */
const POOL = [];
const SQUAD = { GOALKEEPER: 2, DEFENDER: 4, MIDFIELDER: 5, ATTACKER: 4 };
let pid = 0;
// Genug Spieler pro Position, damit auch das „perfekte Team" gefuellt wird.
for (const [pos, count] of Object.entries(SQUAD)) {
  for (let i = 0; i < count * 3; i++) {
    pid++;
    POOL.push({
      'player.id': pid,
      Spielername: `${pos}-${i}`,
      Position: pos,
      'Nationalteam.name': `Land ${pid}`,
      'Nationalteam.logo': '',
      'Club.name': `Club ${pid}`,
      'Club.logo': '',
      Spielerfoto: '',
      pts: 100 - pid            // absteigend, damit die Reihenfolge feststeht
    });
  }
}
const POINTS = new Map(POOL.map((p) => [String(p['player.id']), p.pts]));

function squadFor(offset) {
  const players = [];
  let slot = 1;
  for (const [pos, count] of Object.entries(SQUAD)) {
    const ofPos = POOL.filter((p) => p.Position === pos);
    for (let i = 0; i < count; i++) {
      const p = ofPos[(i + offset) % ofPos.length];
      players.push({ playerId: p['player.id'], name: p.Spielername, pos, slot: `slot-${slot++}` });
    }
  }
  return players;
}

const TEAM_A = { manager: 'Alice', players: squadFor(0) };
const TEAM_B = { manager: 'Bob', players: squadFor(1) };
// Alice hat einen gespeicherten Captain – in der CL muss er wirkungslos sein.
TEAM_A.players[6].isCaptain = true;

/* ── Sandbox: nur das, was die ausgeschnittenen Funktionen brauchen ──────── */
function buildHarness(captainEnabled) {
  const sandbox = { module: { exports: {} }, console };
  vm.createContext(sandbox);
  vm.runInContext(`
    const CAPTAIN_ENABLED = ${captainEnabled ? 'true' : 'false'};
    const IS_CLUB_ENTITY = false;
    const POSITION_KEYS = ['GOALKEEPER', 'DEFENDER', 'MIDFIELDER', 'ATTACKER'];
    const POSITION_LABELS = { GOALKEEPER: 'Torhüter', DEFENDER: 'Verteidiger', MIDFIELDER: 'Mittelfeld', ATTACKER: 'Sturm' };
    const POSITION_ICONS = { GOALKEEPER: '🧤', DEFENDER: '🛡️', MIDFIELDER: '🎯', ATTACKER: '⚽', BENCH: '🪑' };
    const cmpExpandedPositions = new Set();

    let allTeams = [];
    let playersData = [];
    let pointsById = new Map();
    let enrichedTeamsCache = [];
    let cmpMgrA = '';
    let cmpMgrB = '';
    let cmpWhatIfMgr = '';

    const escapeHtml = (v) => String(v === undefined || v === null ? '' : v);
    const entWord = () => 'Land';
    const translatePosition = (p) => String(p);
    const formatPoints = (n) => String(n);
    const isTeamsLocked = () => false;
    const renderPlayerPhotoShell = () => '<span class="photo"></span>';
    const cmpPlayerLink = (name, html) => html;
    const cmpPlayerImgLink = (name, inner) => inner;
    const cmpManagerLink = (name, html) => html;
    const cmpManagerImgLink = (name, inner) => inner;
    const cmpRankingLink = (html) => html;
    const getPlayerById = (id) => playersData.find((p) => String(p['player.id']) === String(id)) || null;
    const resolveStoredPlayer = (stored) => getPlayerById(stored && stored.playerId);
    const getPlayerBasePoints = (id) => pointsById.get(String(id)) || 0;

    // Minimaler DOM-Ersatz: die Render-Funktionen schreiben nach innerHTML.
    const nodes = {};
    const document = {
      getElementById: (id) => {
        if (!nodes[id]) nodes[id] = { innerHTML: '', querySelectorAll: () => [] };
        return nodes[id];
      }
    };

    ${EXTRACTED}

    module.exports = {
      setData: (teams, pool, points) => {
        allTeams = teams;
        playersData = pool;
        pointsById = points;
        enrichedTeamsCache = [];
      },
      renderManagerDuell: (a, b) => {
        cmpMgrA = a; cmpMgrB = b;
        renderManagerDuell();
        return nodes['cmp-mgr-result'].innerHTML;
      },
      renderWhatIf: (mgr) => {
        cmpWhatIfMgr = mgr;
        renderWhatIfAnalysis();
        return nodes['cmp-whatif-result'].innerHTML;
      },
      renderPlayerStatRows,
      computePerfectLightTeam,
      getEnrichedTeamByManager
    };
  `, sandbox);
  const api = sandbox.module.exports;
  api.setData(
    JSON.parse(JSON.stringify([TEAM_A, TEAM_B])),
    POOL,
    new Map(POINTS)
  );
  return api;
}

const CL = buildHarness(false);
const WM = buildHarness(true);

/* Spieler-Statistiken, wie buildPlayerStats sie liefert (nur die Felder,
 * die renderPlayerStatRows liest). */
function statsStub(name, captainCount) {
  return {
    player: { Spielername: name },
    totalPoints: 50, positionLabel: 'Sturm', nation: 'Land 1', club: 'Club 1',
    goals: 1, assists: 1, games: 3, starts: 3, subbedIn: 0, subbedOut: 0,
    yellow: 0, red: 0, ownGoals: 0, penSaved: 0, penMissed: 0, penWon: 0,
    penCommitted: 0, wins: 1, draws: 1, losses: 1, pointsPerGame: 16.7,
    draftCount: 2, captainCount
  };
}

/* ── 1) CL: kein Captain im Manager-Duell ───────────────────────────────── */
const clDuell = CL.renderManagerDuell('Alice', 'Bob');
assert.ok(clDuell.length > 0, 'Das Manager-Duell muss in der CL weiterhin rendern.');
assert.doesNotMatch(clDuell, /Captain/i,
  'Ohne Captain-Feature darf im Manager-Duell kein Captain mehr auftauchen (Karte „Captain-Duell").');
assert.match(clDuell, /Punkte nach Position/,
  'Die uebrigen Karten des Manager-Duells muessen erhalten bleiben.');
assert.match(clDuell, /Matchwinner/,
  'Die uebrigen Karten des Manager-Duells muessen erhalten bleiben.');

/* ── 2) CL: kein Captain in der What-If-Analyse ─────────────────────────── */
const clWhatIf = CL.renderWhatIf('Alice');
assert.ok(clWhatIf.length > 0, 'Die What-If-Analyse muss in der CL weiterhin rendern.');
assert.doesNotMatch(clWhatIf, /Captain/i,
  'Ohne Captain-Feature duerfen weder „Captain-Optimierung" noch die Kachel „Captain-Bonus" erscheinen.');
assert.match(clWhatIf, /Differenz zum perfekten Team/,
  'Die uebrigen Karten der What-If-Analyse muessen erhalten bleiben.');
assert.match(clWhatIf, /verpasste Alternativen/,
  'Die uebrigen Karten der What-If-Analyse muessen erhalten bleiben.');

/* ── 3) CL: keine Zeile „Captain-Wahlen" im Spieler-Duell ───────────────── */
const clRows = CL.renderPlayerStatRows(statsStub('A', 3), statsStub('B', 1));
assert.doesNotMatch(clRows, /Captain/i,
  'Ohne Captain-Feature darf die Zeile „Captain-Wahlen" nicht mehr erscheinen.');
assert.match(clRows, /Drafts \(Beliebtheit\)/,
  'Die uebrigen Statistik-Zeilen muessen erhalten bleiben.');

/* ── 4) CL: keine ×2-Wertung und kein Captain im angereicherten Team ────── */
const clTeam = CL.getEnrichedTeamByManager('Alice');
assert.equal(clTeam.captain, null,
  'Ohne Captain-Feature darf ein Team keinen Captain haben – auch nicht aus einem Alt-Flag.');
const clSumBase = clTeam.players.reduce((s, p) => s + p.basePts, 0);
assert.equal(clTeam.totalScore, clSumBase,
  'Ohne Captain-Feature darf kein Spieler doppelt zaehlen.');
assert.ok(clTeam.players.every((p) => p.isCaptain === false),
  'Gespeicherte isCaptain-Flags muessen in der CL verworfen werden.');

/* ── 5) CL: „mögliches Maximum" ohne Captain-Bonus ──────────────────────── */
const clPerfect = CL.computePerfectLightTeam();
assert.equal(clPerfect.captain, null,
  'Das perfekte Team der CL darf keinen Captain kueren.');
assert.equal(clPerfect.score, clPerfect.players.reduce((s, p) => s + p.pts, 0),
  'Ohne Captain-Feature ist das Maximum die reine Summe der 15 – sonst waeren ' +
  '„Verpasste Punkte" und „Quote vom Maximum" um einen Bonus verfaelscht, den es nicht gibt.');

/* ── 6) WM: Captain bleibt unveraendert erhalten ────────────────────────── */
const wmDuell = WM.renderManagerDuell('Alice', 'Bob');
assert.match(wmDuell, /Captain-Duell/,
  'Mit Captain-Feature (WM) muss die Karte „Captain-Duell" weiterhin erscheinen.');

const wmWhatIf = WM.renderWhatIf('Alice');
assert.match(wmWhatIf, /Captain-Optimierung/,
  'Mit Captain-Feature (WM) muss die Karte „Captain-Optimierung" weiterhin erscheinen.');
assert.match(wmWhatIf, /Captain-Bonus/,
  'Mit Captain-Feature (WM) muss die Kachel „Captain-Bonus" weiterhin erscheinen.');

const wmRows = WM.renderPlayerStatRows(statsStub('A', 3), statsStub('B', 1));
assert.match(wmRows, /Captain-Wahlen/,
  'Mit Captain-Feature (WM) muss die Zeile „Captain-Wahlen" weiterhin erscheinen.');

const wmTeam = WM.getEnrichedTeamByManager('Alice');
assert.ok(wmTeam.captain, 'Mit Captain-Feature (WM) muss der gespeicherte Captain erhalten bleiben.');
const wmSumBase = wmTeam.players.reduce((s, p) => s + p.basePts, 0);
assert.equal(wmTeam.totalScore, wmSumBase + wmTeam.captain.basePts,
  'Die WM-Verdopplung (×2) des Captains darf nicht angetastet werden.');

const wmPerfect = WM.computePerfectLightTeam();
assert.ok(wmPerfect.captain, 'Das perfekte Team der WM muss weiterhin einen Captain kueren.');
assert.equal(wmPerfect.score,
  wmPerfect.players.reduce((s, p) => s + p.pts, 0) + wmPerfect.captain.pts,
  'Das WM-Maximum enthaelt weiterhin den Captain-Bonus.');

/* ── 7) Das Turnier-Flag bleibt die einzige Quelle ──────────────────────── */
assert.match(source, /const CAPTAIN_ENABLED = !\(APP && APP\.captainEnabled === false\);/,
  'spieleranalyse.js muss das Captain-Feature aus APP_CONFIG.captainEnabled ableiten.');

const APP = require('../tournament-config.js');
assert.equal(APP.tournaments.cl2627.captainEnabled, false,
  'Voraussetzung des Tests: die CL hat kein Captain-Feature.');

console.log('✓ test-cl-captain-free-analysis: Analyse/Vergleiche sind in der CL captainfrei, die WM behaelt ihren Captain.');
