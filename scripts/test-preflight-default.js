#!/usr/bin/env node
/* =============================================================================
 *  scripts/test-preflight-default.js
 *
 *  Haelt die Pre-Flight-Skripte im <head> der Seiten mit
 *  tournament-config.js deckungsgleich.
 *
 *  Warum es sie ueberhaupt gibt: bevor tournament-config.js geladen ist, muss
 *  schon feststehen, welches Turnier gilt – sonst blitzt beim ersten Paint
 *  das falsche Theme auf (CL ist blau, die WM gruen), die falsche
 *  Kaderdatei wird vorgeladen, und auf der Startseite erscheint kurz die
 *  falsche Sektion (vor/nach Anpfiff). Die Aufloesung steht deshalb inline
 *  ein zweites Mal da – hartkodiert, weil an dieser Stelle noch kein Modul
 *  verfuegbar ist.
 *
 *  Diese Doppelung ist genau die Sorte, die still driftet: bei der
 *  CL-Freischaltung zeigte die Config auf cl2627, das Pre-Flight aber weiter
 *  auf wm2026. Der Test vergleicht deshalb beide Seiten gegeneinander.
 *
 *  Aufruf: npm run test:preflight
 * ============================================================================= */

'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const APP = require('../tournament-config.js');

const ROOT = path.join(__dirname, '..');
const readRoot = (file) => fs.readFileSync(path.join(ROOT, file), 'utf8');

/* Alle Seiten, die das Turnier-Pre-Flight tragen. Neue Seiten gehoeren hier
 * dazu – fehlt eine, blitzt dort das falsche Theme auf. */
const PAGES = [
  'index.html', 'punktesystem.html', 'rangliste.html',
  'spieleranalyse.html', 'team-builder.html', 'teams.html'
];

/* Aus dem Pre-Flight die Domain-Map und den Fallback lesen, so wie sie
 * dort stehen: ({"dt.alae.app":"cl2627"})[h]||"wm2026" */
function parsePreflight(src) {
  const m = src.match(/\(\{([^}]*)\}\)\[h\]\|\|"([a-z0-9]+)"/);
  if (!m) return null;
  const map = {};
  m[1].split(',').filter(Boolean).forEach(pair => {
    const kv = pair.match(/"([^"]+)"\s*:\s*"([^"]+)"/);
    if (kv) map[kv[1]] = kv[2];
  });
  return { map, fallback: m[2] };
}

let failures = 0;
function check(label, condition, detail) {
  if (condition) return;
  failures++;
  console.error(`✗ ${label}${detail ? ` – ${detail}` : ''}`);
}

/* ── 1) Jede Seite traegt dasselbe, korrekte Pre-Flight ─────────────────── */
const reference = parsePreflight(readRoot(PAGES[0]));
check('Pre-Flight in index.html ist lesbar', !!reference);

PAGES.forEach(page => {
  const parsed = parsePreflight(readRoot(page));
  check(`${page} traegt das Turnier-Pre-Flight`, !!parsed);
  if (!parsed || !reference) return;
  check(`${page} nutzt dieselbe Domain-Map wie index.html`,
    JSON.stringify(parsed.map) === JSON.stringify(reference.map),
    JSON.stringify(parsed.map));
  check(`${page} nutzt denselben Fallback wie index.html`,
    parsed.fallback === reference.fallback, parsed.fallback);
});

/* ── 2) Pre-Flight == tatsaechliche Aufloesung aus der Config ───────────── */
if (reference) {
  Object.keys(reference.map).forEach(host => {
    const expected = APP.resolveScheduledDomainKey(host, Date.now())
      || APP.domainTournamentMap[host];
    check(`Pre-Flight-Default fuer ${host} stimmt mit tournament-config.js ueberein`,
      reference.map[host] === expected,
      `Pre-Flight "${reference.map[host]}" vs. Config "${expected}"`);
    check(`Pre-Flight-Default fuer ${host} ist ein verfuegbares Turnier`,
      APP.isTournamentAvailable(reference.map[host]));
  });

  // Der Fallback im Pre-Flight ist FALLBACK_TOURNAMENT_KEY. Den exportiert
  // die Config nicht direkt; ohne window (Node) ist er aber genau das, worauf
  // die Aufloesung faellt.
  check('Pre-Flight-Fallback stimmt mit FALLBACK_TOURNAMENT_KEY ueberein',
    reference.fallback === APP.domainDefaultKey,
    `Pre-Flight "${reference.fallback}" vs. Config "${APP.domainDefaultKey}"`);
}

/* ── 3) Startzeitpunkt-Map der Startseite (Pre/Post-Ansicht) ────────────── */
const indexSrc = readRoot('index.html');
const startBlock = indexSrc.slice(indexSrc.indexOf('var DOMAIN_START'), indexSrc.indexOf('var host ='));
check('index.html hat die DOMAIN_START-Map', startBlock.length > 0);

const startEntries = Array.from(startBlock.matchAll(/'([^']+)':\s*'([^']+)'/g));
check('DOMAIN_START enthaelt mindestens einen Eintrag', startEntries.length > 0);
startEntries.forEach(([, host, iso]) => {
  const key = APP.resolveScheduledDomainKey(host, Date.now()) || APP.domainTournamentMap[host];
  const expected = key && APP.tournaments[key] && APP.tournaments[key].DREAMTEAM_START;
  check(`DOMAIN_START["${host}"] ist der Anpfiff des dort aktiven Turniers (${key})`,
    !!expected && new Date(iso).getTime() === new Date(expected).getTime(),
    `Pre-Flight "${iso}" vs. Config "${expected}"`);
});

const fallbackStart = (startBlock.match(/var FALLBACK_START = '([^']+)'/)
  || indexSrc.match(/var FALLBACK_START = '([^']+)'/) || [])[1];
check('FALLBACK_START ist gesetzt', !!fallbackStart);
if (fallbackStart) {
  const expected = APP.tournaments[APP.domainDefaultKey].DREAMTEAM_START;
  check('FALLBACK_START ist der Anpfiff des Fallback-Turniers',
    new Date(fallbackStart).getTime() === new Date(expected).getTime(),
    `Pre-Flight "${fallbackStart}" vs. Config "${expected}"`);
}

/* ── 4) Kaderdatei-Preload trifft die richtige Datei ────────────────────── */
// Das Pre-Flight leitet die Datei aus dem Key ab: /^cl\d{4}$/ → data-<key>.js,
// sonst data-wm2026.js. Fuer jedes verfuegbare Turnier muss dabei die in der
// Config hinterlegte dataFile herauskommen.
APP.getAvailableTournamentKeys().forEach(key => {
  const derived = /^cl\d{4}$/.test(key) ? `data-${key}.js` : 'data-wm2026.js';
  check(`Preload-Ableitung trifft die dataFile von ${key}`,
    derived === APP.tournaments[key].dataFile,
    `abgeleitet "${derived}" vs. Config "${APP.tournaments[key].dataFile}"`);
});

if (failures > 0) {
  console.error(`\ntest-preflight-default: ${failures} Check(s) fehlgeschlagen.`);
  process.exit(1);
}
console.log('✓ test-preflight-default: Pre-Flight und tournament-config.js sind deckungsgleich.');
