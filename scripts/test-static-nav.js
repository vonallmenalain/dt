#!/usr/bin/env node
/* =============================================================================
 *  scripts/test-static-nav.js
 *
 *  Haelt die statische Navigation der Hauptseiten deckungsgleich.
 *
 *  Seit „Instant Navigation" steht die Navigationsleiste (oben + mobile
 *  Bottom-Bar) als STATIC-NAV-Block direkt im HTML jeder Hauptseite, damit
 *  sie mit dem ersten Frame gezeichnet wird und bei View Transitions als
 *  feststehende Leiste durchlaeuft. nav.js hydriert sie nur noch
 *  (?tournament=-Parameter, Markenlabel, Auth-Knopf).
 *
 *  Diese Duplizierung driftet still, wenn jemand einen Nav-Eintrag nur in
 *  nav.js (Fallback fuer Seiten ohne statisches Markup) oder nur in einer
 *  Seite aendert – genau das prueft dieser Test:
 *    1. Jede Hauptseite traegt genau einen STATIC-NAV-Block.
 *    2. Die Bloecke sind identisch (bis auf den seiten-eigenen active-Link).
 *    3. Der active-Link zeigt auf die Seite selbst (oben UND unten).
 *    4. Die Links decken sich mit den navItems in nav.js (gleiche Reihenfolge).
 *    5. Das Markenlabel-Preflight spiegelt die shortLabels aus
 *       tournament-config.js.
 *    6. nav.js besitzt weiterhin beide Pfade (hydrieren + injizieren).
 *
 *  Aufruf: npm run test:staticnav
 * ============================================================================= */

'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const APP = require('../tournament-config.js');

const ROOT = path.join(__dirname, '..');
const readRoot = (file) => fs.readFileSync(path.join(ROOT, file), 'utf8');

const PAGES = [
  'index.html', 'punktesystem.html', 'rangliste.html',
  'spieleranalyse.html', 'team-builder.html', 'teams.html'
];

const START = '<!-- ===== STATIC NAV';
const END = '<!-- ===== /STATIC NAV ===== -->';

let failures = 0;
function check(label, condition, detail) {
  if (condition) return;
  failures++;
  console.error(`✗ ${label}${detail ? ` – ${detail}` : ''}`);
}

function extractBlock(page, src) {
  const start = src.indexOf(START);
  const end = src.indexOf(END);
  check(`${page}: STATIC-NAV-Block vorhanden`, start > -1 && end > start);
  if (start === -1 || end === -1) return null;
  check(`${page}: STATIC-NAV-Block nur einmal vorhanden`,
    src.indexOf(START, start + 1) === -1);
  return src.slice(start, end + END.length);
}

/* ── 1+2+3) Bloecke einsammeln, normalisieren, vergleichen ─────────────── */
const blocks = {};
for (const page of PAGES) {
  const block = extractBlock(page, readRoot(page));
  if (!block) continue;
  blocks[page] = block;

  // Der active-Link der Seite muss auf die Seite selbst zeigen –
  // einmal oben (Textlink) und einmal unten (Icon-Link), sonst nirgends.
  const activeCount = (block.match(/class="nav-item active"/g) || []).length;
  check(`${page}: genau zwei active-Links (oben + unten)`, activeCount === 2,
    `gefunden: ${activeCount}`);
  const wrongActive = [...block.matchAll(/href="([^"]+)" class="nav-item active"/g)]
    .map((m) => m[1])
    .filter((href) => href !== page);
  check(`${page}: active-Link zeigt auf die Seite selbst`, wrongActive.length === 0,
    wrongActive.join(', '));
}

const normalized = Object.entries(blocks).map(([page, block]) => [
  page,
  block.replace(/class="nav-item active"/g, 'class="nav-item"')
]);
if (normalized.length > 1) {
  const [refPage, refBlock] = normalized[0];
  for (const [page, block] of normalized.slice(1)) {
    check(`${page}: STATIC-NAV-Block identisch mit ${refPage}`, block === refBlock);
  }
}

/* ── 4) Links decken sich mit navItems in nav.js ────────────────────────── */
{
  const navJs = readRoot('nav.js');
  const navItemsMatch = navJs.match(/const navItems = \[([\s\S]*?)\];/);
  check('nav.js: navItems gefunden', !!navItemsMatch);

  if (navItemsMatch && normalized.length) {
    const jsHrefs = [...navItemsMatch[1].matchAll(/href:\s*"([^"]+)"/g)].map((m) => m[1]);
    check('nav.js: navItems nicht leer', jsHrefs.length > 0);

    const block = normalized[0][1];
    const topPart = block.slice(0, block.indexOf('bottom-nav'));
    const bottomPart = block.slice(block.indexOf('bottom-nav'));
    const topHrefs = [...topPart.matchAll(/href="([^"]+)" class="nav-item"/g)].map((m) => m[1]);
    const bottomHrefs = [...bottomPart.matchAll(/href="([^"]+)" class="nav-item"/g)].map((m) => m[1]);

    assert.deepEqual(topHrefs, jsHrefs,
      'STATIC NAV (oben) und nav.js → navItems fuehren nicht dieselben Links in derselben Reihenfolge.');
    assert.deepEqual(bottomHrefs, jsHrefs,
      'STATIC NAV (unten) und nav.js → navItems fuehren nicht dieselben Links in derselben Reihenfolge.');
  }
}

/* ── 5) Markenlabel-Spiegel stimmt mit tournament-config ueberein ───────── */
{
  const clLabel = APP.tournaments.cl2627.shortLabel;
  const wmLabel = APP.tournaments.wm2026.shortLabel;
  const expected = `/^cl/.test(k)?"${clLabel}":"${wmLabel}"`;
  for (const [page, block] of Object.entries(blocks)) {
    check(`${page}: Markenlabel-Spiegel = Config-shortLabels`, block.includes(expected),
      `erwartet ${expected}`);
  }
}

/* ── 6) nav.js kann weiterhin beides: hydrieren und injizieren ──────────── */
{
  const navJs = readRoot('nav.js');
  check('nav.js: hydrateStaticNav vorhanden', navJs.includes('function hydrateStaticNav'));
  check('nav.js: Injektions-Fallback vorhanden',
    navJs.includes('insertAdjacentHTML("afterbegin", navHTML)'));
}

/* ── 7) View-Transition-Opt-in und Leisten-Namen in styles.css ──────────── */
{
  const styles = readRoot('styles.css');
  check('styles.css: @view-transition-Opt-in', /@view-transition\s*\{\s*navigation:\s*auto/.test(styles));
  check('styles.css: Navbar aus dem Root-Uebergang geloest',
    styles.includes('view-transition-name: dt-topnav'));
  check('styles.css: Bottom-Nav aus dem Root-Uebergang geloest',
    styles.includes('view-transition-name: dt-bottomnav'));
  check('styles.css: geteiltes .skel vorhanden', /\.skel\s*\{/.test(styles));
}

if (failures > 0) {
  console.error(`\ntest-static-nav: ${failures} Check(s) fehlgeschlagen.`);
  process.exit(1);
}
console.log('✓ test-static-nav: Statische Navigation ist auf allen Seiten deckungsgleich.');
