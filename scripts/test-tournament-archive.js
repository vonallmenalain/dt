#!/usr/bin/env node
/* =============================================================================
 *  scripts/test-tournament-archive.js
 *
 *  Guard fuer den Turnier-Wechsel im Profil-Dropdown.
 *
 *  Seit dem 29.08.2026 ist die Champions League 2026/27 das produktive
 *  Turnier auf dt.alae.app. Die gespielte WM 2026 bleibt erreichbar, aber nur
 *  noch zum Nachlesen: jede angemeldete Person kann ueber das Profil-Menue
 *  hin- und zurueckwechseln, Teams aendern kann dort niemand mehr.
 *
 *  Geprueft wird:
 *    1. Konfiguration: welches Turnier ist Default, welches Archiv.
 *    2. Der Nutzer-Switcher in nav.js – im echten Modul, in einer Sandbox.
 *       Vor allem: die Eintraege landen im NICHT admin-gegateten Bereich
 *       (adminOnly === false). Landeten sie im Dev-Bereich, saehe sie nur
 *       der Admin – und genau das war der Zustand vorher.
 *    3. Die Trennung der beiden Bereiche in auth-modal.js.
 *    4. Der Schreibschutz des Archivs im Team-Builder.
 *
 *  Aufruf: npm run test:archive
 * ============================================================================= */

'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ROOT = path.join(__dirname, '..');
const readRoot = (file) => fs.readFileSync(path.join(ROOT, file), 'utf8');
const APP = require('../tournament-config.js');

/* ─────────────────────────────────────────────────────────────────────────────
 *  1) Konfiguration
 * ───────────────────────────────────────────────────────────────────────────── */
const available = APP.getAvailableTournamentKeys();
assert.ok(available.includes('cl2627'), 'cl2627 muss verfuegbar sein');
assert.ok(available.includes('wm2026'), 'wm2026 muss als Archiv verfuegbar bleiben');
assert.ok(!available.includes('cl2526'), 'der Teststand cl2526 darf nie oeffentlich sein');

assert.equal(APP.isTournamentArchived('wm2026'), true, 'WM 2026 muss Archiv sein');
assert.equal(APP.isTournamentArchived('cl2627'), false, 'die laufende CL darf kein Archiv sein');
assert.equal(APP.isTournamentArchived('nicht-existent'), false);

// dt.alae.app defaultet ueber den zeitgesteuerten Domain-Default auf die CL.
const clFromMs = new Date(APP.tournaments.cl2627.defaultActiveFrom).getTime();
assert.equal(
  APP.resolveScheduledDomainKey('dt.alae.app', clFromMs),
  'cl2627',
  'dt.alae.app muss ab defaultActiveFrom auf die CL defaulten'
);
assert.equal(
  APP.resolveScheduledDomainKey('dt.alae.app', clFromMs - 1),
  null,
  'vor dem Stichtag darf der zeitgesteuerte Default nicht greifen (dann gilt das Domain-Mapping)'
);
assert.equal(APP.domainTournamentMap['dt.alae.app'], 'wm2026',
  'das statische Mapping bleibt als Kette vor dem Stichtag stehen');

// Das Archiv hat kein Transferfenster – sonst waere der Builder dort trotz
// Sperre ueber den Transfer-Pfad erreichbar.
assert.equal(APP.tournaments.wm2026.transfers, undefined,
  'ein Archiv-Turnier darf kein Transfer-Feature haben');

/* ─────────────────────────────────────────────────────────────────────────────
 *  2) nav.js: buildTournamentUserMenu in einer Sandbox
 * ───────────────────────────────────────────────────────────────────────────── */
function runUserMenu({ activeKey }) {
  const registered = [];
  const devRegistered = [];
  const calls = [];

  const Modal = {
    devMenu: { register(item) { devRegistered.push(item); return () => {}; } },
    menu: { register(item) { registered.push(item); return () => {}; } }
  };

  const sandbox = {
    console,
    setInterval: () => 0,
    clearInterval: () => {},
    window: {
      DreamTeamAuthModal: Modal,
      location: { href: 'https://dt.alae.app/index.html', hostname: 'dt.alae.app', search: '' },
      localStorage: { getItem: () => null, setItem: () => {}, removeItem: () => {}, length: 0, key: () => null },
      sessionStorage: { getItem: () => null, removeItem: () => {}, length: 0, key: () => null }
    },
    document: { addEventListener() {} },
    URL,
    URLSearchParams
  };
  sandbox.window.window = sandbox.window;
  sandbox.globalThis = sandbox;

  vm.createContext(sandbox);
  vm.runInContext(readRoot('nav.js'), sandbox, { filename: 'nav.js' });

  // Nur so viel APP_CONFIG, wie der Switcher anfasst – die echten Werte
  // kommen aus tournament-config.js.
  const appStub = {
    tournaments: APP.tournaments,
    activeTournamentKey: activeKey,
    domainDefaultKey: 'cl2627',
    getAvailableTournamentKeys: () => APP.getAvailableTournamentKeys(),
    isTournamentArchived: (key) => APP.isTournamentArchived(key),
    setActiveTournament: (key) => calls.push(['setActiveTournament', key]),
    resetToDomainDefault: () => calls.push(['resetToDomainDefault'])
  };

  sandbox.buildTournamentUserMenu(appStub);
  return { registered, devRegistered, calls };
}

// (a) Standardfall: die CL laeuft, das Archiv wird angeboten.
{
  const { registered, devRegistered, calls } = runUserMenu({ activeKey: 'cl2627' });

  assert.equal(registered.length, 1, 'genau ein Eintrag: das Archiv');
  const entry = registered[0];
  assert.equal(entry.id, 'tournament-switch-wm2026');
  assert.match(entry.label, /WM 2026/, `Label nennt das Turnier: "${entry.label}"`);
  assert.match(entry.label, /ansehen/, 'Label macht klar, dass es ums Nachlesen geht');
  assert.equal(entry.value, 'Archiv', 'Archiv ist als solches markiert');
  assert.ok(entry.icon, 'Nutzer-Eintraege tragen ein Icon wie die uebrigen');
  assert.match(String(entry.title), /nicht mehr (ä|ae)ndern/,
    'der Tooltip sagt, dass dort nichts mehr geaendert werden kann');
  assert.equal(devRegistered.length, 0, 'der Nutzer-Switcher darf nichts im Dev-Bereich anlegen');

  entry.onSelect();
  assert.deepEqual(calls, [['setActiveTournament', 'wm2026']]);
}

// (b) Im Archiv: der Weg zurueck steht bereit und raeumt den Override weg.
{
  const { registered, calls } = runUserMenu({ activeKey: 'wm2026' });

  assert.equal(registered.length, 1);
  const entry = registered[0];
  assert.equal(entry.id, 'tournament-switch-cl2627');
  assert.match(entry.label, /Zur(ü|ue)ck zu/, `Rueckweg ist als solcher benannt: "${entry.label}"`);
  assert.equal(entry.value, '', 'das laufende Turnier traegt keine Archiv-Markierung');

  entry.onSelect();
  assert.deepEqual(calls, [['resetToDomainDefault']],
    'zurueck auf den Domain-Default raeumt den Override weg, statt einen zweiten zu setzen');
}

/* ─────────────────────────────────────────────────────────────────────────────
 *  3) auth-modal.js: Nutzer-Bereich ist NICHT admin-gegatet
 * ───────────────────────────────────────────────────────────────────────────── */
const modalSrc = readRoot('auth-modal.js');

assert.match(modalSrc, /\bmenu\b\s*$|devMenu,\s*\n\s*menu/m,
  'auth-modal.js muss `menu` exportieren');
assert.ok(modalSrc.includes('function renderUserMenu()'), 'renderUserMenu fehlt');

// Der Dev-Bereich haengt am Admin-Status, der Nutzer-Bereich nicht.
const userMenuBody = modalSrc.slice(
  modalSrc.indexOf('function renderUserMenu()'),
  modalSrc.indexOf('function renderDevMenu()')
);
assert.ok(userMenuBody.length > 0);
assert.ok(!userMenuBody.includes('devIsAdmin'),
  'renderUserMenu darf den Admin-Status nicht abfragen – sonst sehen normale Nutzer nichts');
const devMenuBody = modalSrc.slice(modalSrc.indexOf('function renderDevMenu()'));
assert.ok(devMenuBody.slice(0, 400).includes('devIsAdmin'),
  'renderDevMenu muss weiterhin am Admin-Status haengen');

// Reihenfolge im Dropdown: Nutzer-Eintraege vor „Abmelden".
const menuHostAt = modalSrc.indexOf("id: 'dt-auth-nav-menu'");
const logoutAt = modalSrc.indexOf("id: 'dt-auth-nav-logout'");
assert.ok(menuHostAt > 0 && logoutAt > 0);
assert.ok(menuHostAt < logoutAt, '„Abmelden" muss der letzte Haupteintrag bleiben');

// Bestehende Aufrufer bleiben admin-only.
assert.ok(modalSrc.includes('registerMenuItem(item, true)'), 'devMenu muss adminOnly=true setzen');
assert.ok(modalSrc.includes('registerMenuItem(item, false)'), 'menu muss adminOnly=false setzen');

// Das CSS fuer den neuen Bereich existiert.
const modalCss = readRoot('auth-modal.css');
['.dt-auth-nav-menu[hidden]', '.dt-auth-nav-menu-label', '.dt-auth-nav-menu-value']
  .forEach(sel => assert.ok(modalCss.includes(sel), `CSS-Regel fehlt: ${sel}`));

/* ─────────────────────────────────────────────────────────────────────────────
 *  4) Team-Builder: das Archiv ist fuer alle gesperrt
 * ───────────────────────────────────────────────────────────────────────────── */
const builderSrc = readRoot('team-builder.js');
const startedFn = builderSrc.slice(
  builderSrc.indexOf('function isTournamentStarted()'),
  builderSrc.indexOf('function isTournamentStarted()') + 1800
);

const archivedAt = startedFn.indexOf('APP_CONFIG.isArchived');
const lateAt = startedFn.indexOf('if (lateSubmitOpen)');
assert.ok(archivedAt > 0, 'isTournamentStarted muss das Archiv-Flag pruefen');
assert.ok(lateAt > 0);
assert.ok(archivedAt < lateAt,
  'die Archiv-Pruefung muss VOR lateSubmitOpen stehen – sonst oeffnet ein alter ' +
  'Nachzuegler-Schalter aus der Turnierzeit das Archiv wieder fuer alle');

console.log('✓ test-tournament-archive: CL ist Standard, WM bleibt lesbares Archiv fuer alle Angemeldeten.');
