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
 *
 *  Hier laeuft das echte Modul in einem Mini-DOM. Der Punkt, um den es geht,
 *  laesst sich mit Textsuche nicht pruefen: dass ein Nutzer-Eintrag auch
 *  OHNE Admin-Status im Dropdown landet – und der Dev-Bereich weiterhin
 *  nicht. Vorher gab es nur den Dev-Kanal, der Umschalter waere also fuer
 *  normale Nutzer unsichtbar geblieben.
 * ───────────────────────────────────────────────────────────────────────────── */
function makeNode(tag) {
  const node = {
    tagName: String(tag).toUpperCase(), children: [], attrs: {}, className: '',
    hidden: false, listeners: {}, parent: null, style: {}, dataset: {},
    setAttribute(k, v) { this.attrs[k] = String(v); if (k === 'id') this.id = String(v); },
    getAttribute(k) { return k in this.attrs ? this.attrs[k] : null; },
    removeAttribute(k) { delete this.attrs[k]; },
    addEventListener(ev, fn) { (this.listeners[ev] = this.listeners[ev] || []).push(fn); },
    appendChild(c) { c.parent = this; this.children.push(c); return c; },
    contains() { return false; },
    querySelector(sel) { return findById(this, sel.replace('#', '')); },
    classList: { add() {}, remove() {}, contains() { return false; } }
  };
  // innerHTML wird nur zum Leeren benutzt (host.innerHTML = '').
  Object.defineProperty(node, 'innerHTML', {
    get() { return ''; }, set(v) { if (v === '') this.children = []; }, configurable: true
  });
  return node;
}

function findById(root, id) {
  const stack = root.children.slice();
  while (stack.length) {
    const n = stack.shift();
    if (n.id === id) return n;
    stack.push(...n.children);
  }
  return null;
}

function textOf(node) {
  return node.text !== undefined ? node.text : node.children.map(textOf).join('');
}

function renderDropdown({ isAdmin }) {
  const body = makeNode('body');
  const documentStub = {
    body, head: makeNode('head'), documentElement: makeNode('html'),
    createElement: makeNode,
    createTextNode: (t) => { const n = makeNode('#text'); n.text = String(t); return n; },
    querySelector: (sel) => (sel === '#dt-auth-nav-slot' ? body : null),
    getElementById: () => null,
    addEventListener() {}, removeEventListener() {},
    readyState: 'complete'
  };

  const sandbox = {
    console, setTimeout, clearTimeout, setInterval: () => 0, clearInterval: () => {},
    document: documentStub, URL, URLSearchParams,
    navigator: { userAgent: 'node' },
    location: { href: 'https://dt.alae.app/', hostname: 'dt.alae.app', search: '' },
    localStorage: { getItem: () => null, setItem() {}, removeItem() {} }
  };
  sandbox.sessionStorage = sandbox.localStorage;
  sandbox.window = sandbox;
  sandbox.globalThis = sandbox;
  sandbox.DreamTeamAdmin = {
    isAdmin: () => isAdmin,
    isAuthResolved: () => true,
    getDevViewOverride: () => null,
    onAdminChange(cb) { cb({ isAdmin, uid: isAdmin ? 'admin' : null, authResolved: true }); return () => {}; }
  };

  vm.createContext(sandbox);
  vm.runInContext(readRoot('auth-modal.js'), sandbox, { filename: 'auth-modal.js' });

  const Modal = sandbox.window.DreamTeamAuthModal;
  assert.ok(Modal, 'DreamTeamAuthModal muss exportiert sein');
  assert.ok(Modal.menu && typeof Modal.menu.register === 'function',
    'auth-modal.js muss den Nutzer-Kanal `menu` exportieren');

  Modal.install({ teamBuilderHref: 'team-builder.html' });

  const clicks = [];
  Modal.menu.register({
    id: 'tournament-switch-wm2026', icon: '📚',
    label: 'WM 2026 ansehen', value: 'Archiv',
    onSelect: () => clicks.push('user')
  });
  Modal.devMenu.register({
    id: 'dev-eintrag', group: 'Turnier', label: 'Nur fuer Admins',
    onSelect: () => clicks.push('dev')
  });

  const menuHost = findById(body, 'dt-auth-nav-menu');
  const devHost = findById(body, 'dt-auth-nav-dev');
  assert.ok(menuHost && devHost, 'beide Bereiche muessen im Dropdown liegen');
  return { body, menuHost, devHost, clicks, dropdown: menuHost.parent };
}

// (a) Normale angemeldete Person: sieht den Turnier-Wechsel, nicht den Dev-Bereich.
{
  const { menuHost, devHost, clicks, dropdown } = renderDropdown({ isAdmin: false });

  assert.equal(menuHost.hidden, false, 'der Nutzer-Bereich muss ohne Admin sichtbar sein');
  assert.equal(menuHost.children.length, 1, 'genau der registrierte Eintrag');
  assert.match(textOf(menuHost.children[0]), /WM 2026 ansehen/);
  assert.match(textOf(menuHost.children[0]), /Archiv/, 'die Archiv-Markierung wird gerendert');

  assert.equal(devHost.hidden, true, 'der Dev-Bereich bleibt ohne Admin versteckt');
  assert.equal(devHost.children.length, 0, 'ohne Admin werden keine Dev-Eintraege gerendert');

  // Klick loest den Handler aus.
  menuHost.children[0].listeners.click[0]({ stopPropagation() {} });
  assert.deepEqual(clicks, ['user']);

  // Reihenfolge: „Abmelden" bleibt der letzte Haupteintrag, der Dev-Bereich
  // ganz unten.
  const order = dropdown.children.map((c) => c.id || c.className);
  const at = (id) => order.indexOf(id);
  assert.ok(at('dt-auth-nav-myteam') < at('dt-auth-nav-menu'), 'Turnier-Wechsel steht unter „Mein Team"');
  assert.ok(at('dt-auth-nav-menu') < at('dt-auth-nav-logout'), '„Abmelden" bleibt der letzte Haupteintrag');
  assert.ok(at('dt-auth-nav-logout') < at('dt-auth-nav-dev'), 'der Dev-Bereich bleibt ganz unten');
}

// (b) Admin: sieht beides – die bestehenden devMenu-Aufrufer bleiben unberuehrt.
{
  const { menuHost, devHost } = renderDropdown({ isAdmin: true });
  assert.equal(menuHost.hidden, false, 'der Nutzer-Bereich gilt auch fuer Admins');
  assert.equal(menuHost.children.length, 1);
  assert.equal(devHost.hidden, false, 'mit Admin erscheint der Dev-Bereich');
  assert.ok(devHost.children.length >= 1, 'der Dev-Eintrag wird fuer Admins gerendert');
  assert.ok(devHost.children.some((c) => /Nur fuer Admins/.test(textOf(c))),
    'der registrierte Dev-Eintrag steht im Dev-Bereich, nicht im Nutzer-Bereich');
  assert.ok(!menuHost.children.some((c) => /Nur fuer Admins/.test(textOf(c))),
    'ein Dev-Eintrag darf nie im Nutzer-Bereich landen');
}

// Das CSS fuer den neuen Bereich existiert.
{
  const modalCss = readRoot('auth-modal.css');
  ['.dt-auth-nav-menu[hidden]', '.dt-auth-nav-menu-label', '.dt-auth-nav-menu-value']
    .forEach((sel) => assert.ok(modalCss.includes(sel), `CSS-Regel fehlt: ${sel}`));
}

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
