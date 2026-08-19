'use strict';

/* =============================================================================
 *  test-cl-bracket-penalties.js
 *
 *  Regressionstest: im CL-Turnierbaum muss ein Elfmeterschiessen als Endstand
 *  der Paarung stehen – genau wie auf der Spielkarte unter „Spiele" und im
 *  WM-Turnierbaum.
 *
 *  Hintergrund: der Baum hat nur die Tore aus `goals` aufsummiert. Ein Final,
 *  das nach 1:1 im Elfmeterschiessen entschieden wurde, stand deshalb mit
 *  „1:1 · n.E." und 1 zu 1 im Baum – der Sieger war am Resultat nicht
 *  ablesbar. Jetzt zaehlt das Elfmeterschiessen (z. B. 4:3).
 *
 *  spieleranalyse.js ist eine Browser-IIFE mit DOM-/Firebase-Abhaengigkeiten
 *  und laesst sich nicht als Ganzes laden. Der Test schneidet deshalb die
 *  betroffenen Funktionen per Klammer-Matching heraus und fuehrt sie mit
 *  minimalen Stubs aus – so wird echtes Verhalten geprueft, nicht nur Text.
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
  'getSchedulePenaltyShootout',
  'isFixtureFinishedForLeague',
  'buildActualKnockoutTies',
  'renderActualLegs',
  'renderActualSlot'
].map(grab).join('\n\n');

/* ── Stubs: nur das, was die ausgeschnittenen Funktionen wirklich brauchen ─ */
const sandbox = { module: { exports: {} } };
vm.createContext(sandbox);
vm.runInContext(`
  const escapeHtml = (v) => String(v);
  const normalizeTournamentName = (v) => String(v || '').trim().toLowerCase();
  const getScheduleKickoffMs = (m) => Date.parse(m.date) || 0;
  const leagueKnockoutTier = (round) => {
    const r = String(round || '').toLowerCase();
    if (r.includes('round of 16')) return 'r16';
    if (r.includes('quarter')) return 'qf';
    if (r.includes('semi')) return 'sf';
    if (r === 'final') return 'final';
    return null;
  };
  let scheduleCatalog = [];
  ${EXTRACTED}
  module.exports = {
    setCatalog: (c) => { scheduleCatalog = c; },
    buildActualKnockoutTies, renderActualLegs, renderActualSlot
  };
`, sandbox);
const B = sandbox.module.exports;

/* ── Fixtures in der Form, die scheduleCatalog liefert ──────────────────── */
function fixture(round, home, away, hg, ag, opts = {}) {
  return {
    round,
    teamA: home, teamB: away, teamALogo: '', teamBLogo: '',
    status: { short: opts.pen ? 'PEN' : 'FT' },
    goals: { home: hg, away: ag },
    score: opts.pen
      ? { fulltime: { home: hg, away: ag }, penalty: { home: opts.pen[0], away: opts.pen[1] } }
      : { fulltime: { home: hg, away: ag } },
    date: opts.date || '2026-05-30T21:00:00Z',
    homeWinner: opts.homeWinner ?? null,
    awayWinner: opts.awayWinner ?? null
  };
}

const scoreOf = (html) => {
  const m = html.match(/<span class="clb-score">([^<]*)<\/span>/);
  return m ? m[1] : null;
};
const legsOf = (html) => {
  const m = html.match(/<div class="clb-legs">([^<]*)<\/div>/);
  return m ? m[1] : null;
};

/* ── 1) Einzelspiel-Final nach Elfmeterschiessen ────────────────────────── */
{
  // Arsenal – Paris Saint Germain 1:1, Paris gewinnt 4:3 im Elfmeterschiessen.
  B.setCatalog([fixture('Final', 'Paris Saint Germain', 'Arsenal', 1, 1, {
    pen: [4, 3], homeWinner: true, awayWinner: false
  })]);
  const tie = [...B.buildActualKnockoutTies().final.values()][0];

  // Team A ist der alphabetisch erste Klub – hier Arsenal.
  assert.equal(tie.a.name, 'Arsenal');
  assert.equal(tie.b.name, 'Paris Saint Germain');
  assert.equal(tie.pens && tie.pens.a, 3, 'Elfmeterschiessen muss in A/B-Orientierung vorliegen (Arsenal 3).');
  assert.equal(tie.pens && tie.pens.b, 4, 'Elfmeterschiessen muss in A/B-Orientierung vorliegen (Paris 4).');
  assert.equal(tie.winner, 'b', 'Paris hat das Elfmeterschiessen gewonnen.');

  assert.equal(legsOf(B.renderActualLegs(tie)), '3:4 · n.E.',
    'Unter der Paarung muss das Elfmeterschiessen stehen (nicht 1:1).');
  assert.equal(scoreOf(B.renderActualSlot(tie, 'home', null)), '3',
    'Endstand des Verlierers ist sein Elfmeterschiessen-Resultat.');
  assert.equal(scoreOf(B.renderActualSlot(tie, 'away', null)), '4',
    'Endstand des Siegers ist sein Elfmeterschiessen-Resultat.');
  assert.match(B.renderActualSlot(tie, 'away', null), /clb-slot--winner/,
    'Der Sieger muss als Sieger markiert sein.');
}

/* ── 2) Sieger auch ohne Sieger-Flag allein aus dem Elfmeterschiessen ───── */
{
  B.setCatalog([fixture('Final', 'Arsenal', 'Paris Saint Germain', 1, 1, { pen: [3, 4] })]);
  const tie = [...B.buildActualKnockoutTies().final.values()][0];
  assert.equal(tie.winner, 'b', 'Ohne Sieger-Flag muss das Elfmeterschiessen den Sieger liefern.');
}

/* ── 3) Hin-/Rückspiel: nur das Leg mit Schiessen zeigt dessen Resultat ─── */
{
  B.setCatalog([
    fixture('Semi-finals', 'Inter', 'Barcelona', 1, 1, { date: '2026-04-28T19:00:00Z' }),
    fixture('Semi-finals', 'Barcelona', 'Inter', 2, 2, {
      date: '2026-05-05T19:00:00Z', pen: [5, 4], homeWinner: true, awayWinner: false
    })
  ]);
  const tie = [...B.buildActualKnockoutTies().sf.values()][0];
  assert.equal(tie.a.name, 'Barcelona');
  assert.equal(legsOf(B.renderActualLegs(tie)), '1:1 · 5:4 · n.E.',
    'Hinspiel bleibt das Torresultat, das Rückspiel zeigt das Elfmeterschiessen.');
  assert.equal(tie.winner, 'a', 'Barcelona gewinnt das Elfmeterschiessen.');
}

/* ── 4) Ohne Elfmeterschiessen bleibt alles beim Aggregat ───────────────── */
{
  B.setCatalog([
    fixture('Quarter-finals', 'Arsenal', 'Sporting CP', 1, 0, { date: '2026-04-07T19:00:00Z' }),
    fixture('Quarter-finals', 'Sporting CP', 'Arsenal', 0, 0, { date: '2026-04-14T19:00:00Z' })
  ]);
  const tie = [...B.buildActualKnockoutTies().qf.values()][0];
  assert.equal(tie.pens, null, 'Ohne Schiessen darf kein Elfmeter-Resultat entstehen.');
  assert.equal(legsOf(B.renderActualLegs(tie)), '1:0 · 0:0', 'Kein „n.E." ohne Elfmeterschiessen.');
  assert.equal(scoreOf(B.renderActualSlot(tie, 'home', null)), '1', 'Aggregat bleibt das Aggregat.');
}

/* ── 5) Entfernte Texte dürfen nirgends mehr auftauchen ─────────────────── */
{
  const html = fs.readFileSync(path.join(ROOT, 'spieleranalyse.html'), 'utf8');
  const gone = [
    'Ligatabelle und Finalrunde der Champions League.',
    'Tatsächlicher Turnierbaum aus den gespielten Finalrunden-Spielen',
    'Manueller Modus: Tippe in jeder Paarung auf den Sieger',
    'Manager-Duelle, Spieler-Duelle und verpasste Punkte auf einen Blick.'
  ];
  gone.forEach(text => {
    assert.ok(!source.includes(text), `Entfernter Text steht wieder in spieleranalyse.js: „${text}"`);
    assert.ok(!html.includes(text), `Entfernter Text steht wieder in spieleranalyse.html: „${text}"`);
  });
}

console.log('✓ test-cl-bracket-penalties: Elfmeterschiessen steht im Turnierbaum, entfernte Texte sind weg.');
