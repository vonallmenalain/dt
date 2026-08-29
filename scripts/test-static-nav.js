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

/* Die App-Shell (app.html) traegt denselben Nav-Block, aber ohne
 * active-Link (den setzt shell.js zur Laufzeit) und ohne Speculation
 * Rules (sie faengt ihre Nav-Klicks selbst ab). */
const SHELL_PAGE = 'app.html';
const NAV_BLOCK_PAGES = PAGES.concat([SHELL_PAGE]);

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
for (const page of NAV_BLOCK_PAGES) {
  const block = extractBlock(page, readRoot(page));
  if (!block) continue;
  blocks[page] = block;

  // Der active-Link der Seite muss auf die Seite selbst zeigen –
  // einmal oben (Textlink) und einmal unten (Icon-Link), sonst nirgends.
  // Die Shell startet ohne active (shell.js setzt ihn beim Routen).
  const expectedActive = page === SHELL_PAGE ? 0 : 2;
  const activeCount = (block.match(/class="nav-item active"/g) || []).length;
  check(`${page}: genau ${expectedActive} active-Link(s)`, activeCount === expectedActive,
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

/* ── 6b) Stufe 3: nur noch die Shell ────────────────────────────────────── */
/* Direktaufrufe der Seiten leiten im Pre-Flight in die Shell weiter
 * (app.html#/<seite>?<query>) – die alte Voll-Navigation existiert fuer
 * Nutzer nicht mehr. Deshalb: (a) jede Seite traegt die Weiterleitung
 * samt ?standalone=1-Notausstieg und Frame-Guard, (b) app.html selbst
 * NIE (Shell-in-Shell-Schleife), (c) die Seitenliste der Weiterleitung
 * ist deckungsgleich mit PAGE_FILES in shell.js, (d) Speculation Rules
 * sind ueberall entfernt (sie prerenderten die alte Vollansicht). */
{
  const FORWARD_SNIPPET = 'location.replace("app.html#/"+pf+location.search)';
  let forwardList = null;

  for (const page of PAGES) {
    const src = readRoot(page);
    check(`${page}: Shell-Weiterleitung im Pre-Flight`, src.includes(FORWARD_SNIPPET));
    check(`${page}: Notausstieg ?standalone=1 vorhanden`,
      src.includes('q.get("standalone")!=="1"'));
    check(`${page}: Weiterleitung nie im Frame`,
      src.includes('!d.hasAttribute("data-dt-embedded")&&q.get("standalone")'));
    check(`${page}: keine Speculation Rules mehr`, !src.includes('speculationrules'));

    const m = src.match(/var pk=\[([^\]]+)\]/);
    check(`${page}: Weiterleitungs-Seitenliste gefunden`, !!m);
    if (m) {
      const list = m[1].split(',').map((x) => x.trim().replace(/"/g, ''));
      if (!forwardList) forwardList = list;
      assert.deepEqual(list, forwardList,
        `${page}: Weiterleitungs-Seitenliste weicht von den anderen Seiten ab.`);
    }
  }

  const shellSrc = readRoot(SHELL_PAGE);
  check('app.html: KEINE Shell-Weiterleitung (Schleifen-Gefahr)',
    !shellSrc.includes(FORWARD_SNIPPET));

  // Pretty-URL-Erbe: Netlify hat frueher Links in ausgelieferten Seiten
  // auf endungslose Pfade umgeschrieben (rangliste statt rangliste.html)
  // und damit Klick-Abfangung + Weiterleitung auf dem Live-Server
  // ausgehebelt. Drei Schutzschichten muessen bestehen bleiben:
  const netlifyToml = readRoot('netlify.toml');
  check('netlify.toml: Post-Processing abgeschaltet (skip_processing)',
    netlifyToml.includes('skip_processing = true'));
  for (const page of PAGES) {
    const bare = '/' + page.replace('.html', '');
    check(`netlify.toml: Rewrite fuer ${bare} vorhanden`,
      netlifyToml.includes(`from = "${bare}"`));
    check(`${page}: Pre-Flight normalisiert endungslose Pfade`,
      readRoot(page).includes('if(pf.indexOf(".")===-1)pf+=".html";'));
  }
  check('shell.js: Klick-Abfangung normalisiert endungslose Pfade',
    readRoot('shell.js').includes("if (file.indexOf('.') === -1) file += '.html';"));

  // Seitenliste der Weiterleitung == PAGE_FILES in shell.js.
  const shellJsSrc = readRoot('shell.js');
  const pf = shellJsSrc.match(/var PAGE_FILES = \[([^\]]+)\]/);
  check('shell.js: PAGE_FILES gefunden', !!pf);
  if (pf && forwardList) {
    const shellList = pf[1].split(',').map((x) => x.trim().replace(/['\n]/g, '')).filter(Boolean);
    assert.deepEqual([...forwardList].sort(), [...shellList].sort(),
      'Weiterleitungs-Seitenliste (Pre-Flight) und PAGE_FILES (shell.js) fuehren nicht dieselben Seiten.');
  }
}
/* ── 6c) Kein Theme-Blitz: CL-Styling steht render-blocking im <head> ───── */
/* Die Navigation ist seit dem STATIC-NAV-Block ab dem ersten Frame sichtbar.
 * Ihr CL-Look darf deshalb nicht erst vom dynamischen Lader in
 * tournament-config.js kommen (gruener WM-Blitz), sondern muss statisch im
 * <head> liegen; theme-cl.css ist vollstaendig auf [data-tournament^="cl"]
 * gescopet und fuer die WM ein No-op. */
{
  for (const page of NAV_BLOCK_PAGES.concat(['liga-tabelle.html'])) {
    const src = readRoot(page);
    check(`${page}: theme-cl.css statisch verlinkt (id="cl-theme-css")`,
      /<link rel="stylesheet" href="theme-cl\.css\?v=[^"]+" id="cl-theme-css">/.test(src));
  }

  // theme-color-Meta steht VOR dem Pre-Flight und wird dort fuer CL gesetzt –
  // sonst blitzt die Android-Statusleiste kurz gruen.
  for (const page of NAV_BLOCK_PAGES) {
    const src = readRoot(page);
    const metaIdx = src.indexOf('name="theme-color"');
    const preflightIdx = src.indexOf('FOUC-Schutz');
    check(`${page}: theme-color-Meta vor dem Pre-Flight`,
      metaIdx > -1 && preflightIdx > -1 && metaIdx < preflightIdx);
    check(`${page}: Pre-Flight setzt theme-color fuer CL`,
      src.includes('tc.setAttribute("content","#0a1633")'));
  }

  // Der leere Auth-Slot reserviert die Knopf-Flaeche (44px), sonst waechst
  // die Leiste sichtbar nach, sobald der Auth-Knopf erscheint.
  const styles = readRoot('styles.css');
  const slotBlock = styles.match(/\.dt-auth-nav-slot \{[\s\S]*?\}/);
  check('styles.css: Auth-Slot reserviert Knopf-Flaeche',
    !!slotBlock && slotBlock[0].includes('min-height: var(--dt-nav-content)')
    && slotBlock[0].includes('min-width: var(--dt-nav-content)'));
}

/* ── 6d) App-Shell: Verdrahtung von app.html und Embed-Modus ────────────── */
{
  const shell = readRoot(SHELL_PAGE);
  check('app.html: Buehne vorhanden', shell.includes('id="dtShellStage"'));
  check('app.html: Fortschritts-Haarlinie vorhanden', shell.includes('id="dtShellProgress"'));
  check('app.html: shell.js versioniert eingebunden', /<script src="shell\.js\?v=[^"]+">/.test(shell));
  check('app.html: keine Speculation Rules (Shell faengt Klicks selbst ab)',
    !shell.includes('speculationrules'));
  check('app.html: keine Kader-/Cache-Skripte (Daten laufen nur in den Frames)',
    !shell.includes('src="data.js') && !shell.includes('src="cache.js'));

  // Jede einbettbare Seite erkennt den Embed-Modus im Pre-Flight …
  for (const page of PAGES) {
    check(`${page}: Pre-Flight setzt data-dt-embedded im Frame`,
      readRoot(page).includes('data-dt-embedded'));
  }

  // … styles.css versteckt dann die Seiten-Navigation, und nav.js laesst
  // SW-Registrierung + Hoehenmessung der Shell den Vortritt.
  const styles = readRoot('styles.css');
  check('styles.css: Embed-Modus versteckt Seiten-Navigation',
    styles.includes('html[data-dt-embedded] body > nav.navbar'));
  check('styles.css: Embed-Modus reserviert keinen Nav-Platz',
    styles.includes('html[data-dt-embedded] { --dt-nav-space: 0px; }'));

  const navJs = readRoot('nav.js');
  check('nav.js: Embed-Guard vorhanden', navJs.includes('data-dt-embedded'));

  const sw = readRoot('service-worker.js');
  check('service-worker.js: Shell in der App-Shell-Liste',
    sw.includes("'./app.html'") && sw.includes("'./shell.js'"));

  // shell.js: Sicherheitsnetz (echte Navigation als Fallback) und
  // Nest-Schutz muessen erhalten bleiben.
  const shellJs = readRoot('shell.js');
  check('shell.js: Fallback auf echte Navigation vorhanden',
    shellJs.includes('window.location.href = fullUrl'));
  check('shell.js: Nest-Schutz vorhanden',
    shellJs.includes('window.self !== window.top'));

  // Kaputt-Schalter gegen das Weiterleitungs-Ping-Pong: shell.js setzt bei
  // deterministischen Fehlern dreamteam_shell_broken, die Seiten-Pre-Flights
  // lassen die Weiterleitung dann aus. Beide Seiten muessen denselben
  // Schluessel fuehren, sonst laeuft die App bei einem Shell-Fehler in einer
  // Reload-Schleife (Klick -> Navigation -> Weiterleitung -> Fehler -> ...).
  check('shell.js: Kaputt-Schalter vorhanden',
    shellJs.includes("'dreamteam_shell_broken'") && shellJs.includes('markShellBroken'));
  for (const page of PAGES) {
    check(`${page}: Pre-Flight respektiert den Kaputt-Schalter`,
      readRoot(page).includes('sessionStorage.getItem("dreamteam_shell_broken")'));
  }

  // Stufe 2: `/` liefert die Shell (Netlify-Rewrite mit force, sonst
  // verdeckt die an `/` liegende index.html das Rewrite), und die
  // installierte App startet auf `/`. NICHT /index.html rewriten – die
  // Shell laedt genau diese Datei in ihre Frames (Shell-in-Shell-Gefahr).
  const netlify = readRoot('netlify.toml');
  check('netlify.toml: Root-Rewrite auf die Shell',
    netlify.includes('from = "/"') && netlify.includes('to = "/app.html"')
    && netlify.includes('status = 200') && netlify.includes('force = true'));
  check('netlify.toml: kein Rewrite auf /index.html',
    !netlify.includes('from = "/index.html"'));

  const manifest = JSON.parse(readRoot('Icons/site.webmanifest'));
  check('site.webmanifest: start_url ist die Root (= Shell)',
    manifest.start_url === '/');
  check('site.webmanifest: Splash-Farben passen zum CL-Theme',
    manifest.theme_color === '#0a1633' && manifest.background_color === '#0a1633');
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
