#!/usr/bin/env node
/* =============================================================================
 *  scripts/test-tippgruppen.js
 *
 *  Guard fuer das Tippgruppen-Feature (tippgruppen.js).
 *
 *  Tippgruppen sind ein bewusst verstecktes Feature: einziger Einstieg ist
 *  der Eintrag im Profil-Dropdown zwischen „Mein Team" und dem
 *  Turnier-Wechsel. Ist eine Gruppe aktiv, zeigen die Manager-Listen der
 *  App nur noch deren Mitglieder – rein clientseitig via
 *  DreamTeamTippgruppen.filterTeams().
 *
 *  Geprueft wird:
 *    1. Das echte Modul in einer Sandbox (Mini-DOM wie test-tournament-
 *       archive.js): Menue-Eintrag landet im Nutzer-Bereich VOR den
 *       Turnier-Wechsel-Eintraegen, der Statustext zeigt die aktive Gruppe,
 *       filterTeams() filtert korrekt ueber team.userId und onChange feuert
 *       beim Aufheben der Auswahl.
 *    2. Verdrahtung: alle Nutzer-Seiten binden tippgruppen.js/.css ein
 *       (nach auth-modal.js), der Service Worker precacht beide Dateien,
 *       und die vier Seiten-Skripte mit Manager-Listen schicken ihre Teams
 *       durch den Filter + haengen sich an onChange.
 *    3. firestore.rules decken die Collection 'tippgruppen' ab: get fuer
 *       Angemeldete, list nur query-gebunden (public / eigene
 *       Mitgliedschaft), Create/Update/Delete ueber die Validierungs-
 *       Helfer (Selbst-Beitritt/-Austritt, Ersteller-Loeschung).
 *
 *  Aufruf: npm run test:tippgruppen
 * ============================================================================= */

'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ROOT = path.join(__dirname, '..');
const readRoot = (file) => fs.readFileSync(path.join(ROOT, file), 'utf8');

/* ─────────────────────────────────────────────────────────────────────────────
 *  Mini-DOM (identisch zum Harness in test-tournament-archive.js)
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

function makeStorage(seed) {
  const map = new Map(Object.entries(seed || {}));
  return {
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => { map.set(k, String(v)); },
    removeItem: (k) => { map.delete(k); },
    key: () => null,
    get length() { return map.size; }
  };
}

/* ─────────────────────────────────────────────────────────────────────────────
 *  1) Modul in der Sandbox: Dropdown-Platzierung, Statustext, Filter
 * ───────────────────────────────────────────────────────────────────────────── */
function bootSandbox({ storageSeed } = {}) {
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
    location: { href: 'https://dt.alae.app/index.html', hostname: 'dt.alae.app', search: '' },
    localStorage: makeStorage(storageSeed),
    sessionStorage: makeStorage(),
    requestAnimationFrame: (fn) => fn(),
    addEventListener() {}, removeEventListener() {}
  };
  sandbox.window = sandbox;
  sandbox.globalThis = sandbox;
  sandbox.DreamTeamAdmin = {
    isAdmin: () => false,
    isAuthResolved: () => true,
    getDevViewOverride: () => null,
    onAdminChange(cb) { cb({ isAdmin: false, uid: null, authResolved: true }); return () => {}; }
  };
  // Abgemeldeter Zustand: der Menue-Eintrag registriert sich trotzdem
  // (das Dropdown selbst ist ohnehin nur fuer Angemeldete erreichbar).
  sandbox.DreamTeamAuth = {
    getCurrentUser: () => null,
    isSignedInAndVerified: () => false,
    onAuthStateChange(cb) { cb({ user: null, isVerified: false }); return () => {}; }
  };

  vm.createContext(sandbox);
  vm.runInContext(readRoot('auth-modal.js'), sandbox, { filename: 'auth-modal.js' });

  const Modal = sandbox.window.DreamTeamAuthModal;
  assert.ok(Modal && Modal.menu, 'DreamTeamAuthModal.menu muss existieren');
  Modal.install({ teamBuilderHref: 'team-builder.html' });

  // Turnier-Wechsel wie in nav.js (order beginnt dort bei 1).
  Modal.menu.register({
    id: 'tournament-switch-wm2026', order: 1, icon: '📚',
    label: 'WM 2026 ansehen', value: 'Archiv', onSelect: () => {}
  });

  vm.runInContext(readRoot('tippgruppen.js'), sandbox, { filename: 'tippgruppen.js' });

  const TG = sandbox.window.DreamTeamTippgruppen;
  assert.ok(TG, 'DreamTeamTippgruppen muss exportiert sein');
  return { sandbox, body, Modal, TG };
}

// (a) Platzierung: „Tippgruppen" steht im Nutzer-Bereich (unter „Mein Team",
//     der ist ein Fix-Eintrag darueber) und VOR dem Turnier-Wechsel.
{
  const { body } = bootSandbox();
  const menuHost = findById(body, 'dt-auth-nav-menu');
  assert.ok(menuHost, 'Nutzer-Bereich muss existieren');
  assert.equal(menuHost.hidden, false, 'Nutzer-Bereich muss sichtbar sein');
  assert.equal(menuHost.children.length, 2, 'Tippgruppen + Turnier-Wechsel');
  assert.match(textOf(menuHost.children[0]), /Tippgruppen/,
    '„Tippgruppen" muss VOR dem Turnier-Wechsel stehen (order < 1)');
  assert.match(textOf(menuHost.children[1]), /WM 2026 ansehen/,
    'der Turnier-Wechsel folgt nach „Tippgruppen"');

  const dropdown = menuHost.parent;
  const order = dropdown.children.map((c) => c.id || c.className);
  const at = (id) => order.indexOf(id);
  assert.ok(at('dt-auth-nav-myteam') < at('dt-auth-nav-menu'),
    'der Nutzer-Bereich (mit Tippgruppen) liegt unter „Mein Team"');
  assert.ok(at('dt-auth-nav-menu') < at('dt-auth-nav-logout'),
    '„Abmelden" bleibt der letzte Haupteintrag');
}

// (b) Statustext: die aktive Gruppe erscheint als value am Eintrag – die
//     einzige sichtbare Spur des Features in der App.
{
  const seed = {
    dreamteam_tippgruppe_selected: JSON.stringify({
      id: 'g1', name: 'Buero-Runde', memberUids: ['u1', 'u2'], savedAt: 1
    })
  };
  const { body, TG } = bootSandbox({ storageSeed: seed });
  const menuHost = findById(body, 'dt-auth-nav-menu');
  assert.match(textOf(menuHost.children[0]), /Buero-Runde/,
    'der Eintrag zeigt die aktive Gruppe als Statustext');

  assert.equal(TG.isFilterActive(), true);
  const sel = TG.getSelection();
  assert.equal(sel.id, 'g1');
  // JSON-Vergleich statt deepEqual: Arrays aus dem vm-Kontext haben einen
  // fremden Array-Prototyp (Cross-Realm).
  assert.equal(JSON.stringify(sel.memberUids), JSON.stringify(['u1', 'u2']));
}

// (c) filterTeams: filtert ueber team.userId; ohne Auswahl ein No-op.
{
  const seed = {
    dreamteam_tippgruppe_selected: JSON.stringify({
      id: 'g1', name: 'Buero-Runde', memberUids: ['u1', 'u2'], savedAt: 1
    })
  };
  const { TG } = bootSandbox({ storageSeed: seed });

  const teams = [
    { userId: 'u1', manager: 'Alice' },
    { userId: 'u3', manager: 'Charlie' },
    { manager: 'Legacy ohne userId' },
    { userId: 'u2', manager: 'Bob' }
  ];
  const filtered = TG.filterTeams(teams);
  assert.equal(JSON.stringify(Array.from(filtered, (t) => t.manager)), JSON.stringify(['Alice', 'Bob']),
    'nur Mitglieder der aktiven Gruppe bleiben uebrig (Teams ohne userId fallen raus)');
  assert.notEqual(filtered, teams, 'gefiltertes Ergebnis ist ein neues Array');

  // Auswahl aufheben → No-op-Filter + onChange feuert.
  let fired = 0;
  const unsubscribe = TG.onChange(() => { fired += 1; });
  TG.clearSelection();
  assert.equal(fired, 1, 'clearSelection benachrichtigt die Seiten');
  assert.equal(TG.isFilterActive(), false);
  assert.equal(TG.filterTeams(teams), teams,
    'ohne Auswahl kommt exakt das Original-Array zurueck (Identitaet = No-op)');
  unsubscribe();
}

// (d) Ohne gespeicherte Auswahl: kein Statustext, Filter inaktiv.
{
  const { body, TG } = bootSandbox();
  const menuHost = findById(body, 'dt-auth-nav-menu');
  const label = textOf(menuHost.children[0]);
  assert.match(label, /Tippgruppen/);
  assert.doesNotMatch(label, /Buero/, 'ohne Auswahl kein Gruppen-Statustext');
  assert.equal(TG.isFilterActive(), false);
  const teams = [{ userId: 'u1' }];
  assert.equal(TG.filterTeams(teams), teams);
}

/* ─────────────────────────────────────────────────────────────────────────────
 *  2) Verdrahtung: Seiten, Service Worker, Filter-Aufrufe
 * ───────────────────────────────────────────────────────────────────────────── */
const PAGES = [
  'index.html', 'punktesystem.html', 'rangliste.html', 'spieleranalyse.html',
  'team-builder.html', 'teams.html', 'liga-tabelle.html', 'app.html'
];

for (const page of PAGES) {
  const src = readRoot(page);
  assert.ok(src.includes('tippgruppen.js?v=__BUILD__'),
    `${page}: tippgruppen.js muss (versioniert) eingebunden sein`);
  assert.ok(src.includes('tippgruppen.css?v=__BUILD__'),
    `${page}: tippgruppen.css muss (versioniert) eingebunden sein`);
  assert.ok(src.indexOf('auth-modal.js') < src.indexOf('tippgruppen.js'),
    `${page}: tippgruppen.js muss NACH auth-modal.js stehen (Menue-API)`);
}

{
  const sw = readRoot('service-worker.js');
  assert.ok(sw.includes("'./tippgruppen.js'"), 'Service Worker muss tippgruppen.js precachen');
  assert.ok(sw.includes("'./tippgruppen.css'"), 'Service Worker muss tippgruppen.css precachen');
}

// Popup-CSS: display:flex am Overlay wuerde das hidden-Attribut sonst
// uebersteuern – ohne diese Regel liesse sich das Popup nie schliessen.
{
  const css = readRoot('tippgruppen.css');
  assert.ok(css.includes('.dt-tg-overlay[hidden]'),
    'tippgruppen.css: [hidden]-Absicherung des Overlays fehlt');
  for (const sel of ['.dt-tg-overlay', '.dt-tg-card', '.dt-tg-row', '.dt-tg-btn']) {
    assert.ok(css.includes(sel), `tippgruppen.css: Kern-Selektor ${sel} fehlt`);
  }
}

// Seiten mit Manager-Listen: Teams laufen durch den Filter, Aenderungen
// der Auswahl loesen einen Re-Render aus (onChange).
const FILTERED_PAGES = ['rangliste.js', 'teams.js', 'spieleranalyse.js', 'index.js'];
for (const file of FILTERED_PAGES) {
  const src = readRoot(file);
  assert.ok(src.includes('applyTippgruppenFilter'),
    `${file}: Teams muessen durch applyTippgruppenFilter laufen`);
  assert.ok(src.includes('DreamTeamTippgruppen.onChange'),
    `${file}: Auswahl-Wechsel muss einen Re-Render ausloesen (onChange)`);
}

// Der Filter sitzt an der jeweils zentralen Konsumstelle der Teams.
assert.ok(readRoot('rangliste.js').includes('enrichTeams(applyTippgruppenFilter(data.teams || [])'),
  'rangliste.js: Filter sitzt im Ranking-Aufbau (buildRankingData)');
assert.ok(readRoot('teams.js').includes('enrichTeamsWithScores(applyTippgruppenFilter(data.teams || []))'),
  'teams.js: Filter sitzt in applyDataset');
assert.ok(readRoot('spieleranalyse.js').includes('allTeams = applyTippgruppenFilter(allRawTeams)'),
  'spieleranalyse.js: Filter sitzt in applyDataset (Rohteams bleiben erhalten)');
assert.ok(readRoot('index.js').includes('const viewData = applyTippgruppenFilter(data)'),
  'index.js: render() arbeitet auf der gefilterten Kopie');

/* ─────────────────────────────────────────────────────────────────────────────
 *  3) firestore.rules: Collection 'tippgruppen' vollstaendig abgedeckt
 * ───────────────────────────────────────────────────────────────────────────── */
const RULES = readRoot('firestore.rules').replace(/\/\/[^\n]*/g, '');

// Helper existieren.
for (const fn of [
  'tippgruppeSchemaOk', 'validTippgruppeCreate', 'tippgruppeSelfJoin',
  'tippgruppeSelfLeave', 'validTippgruppeUpdate', 'validTippgruppeDelete'
]) {
  assert.ok(new RegExp(`function ${fn}\\(\\)`).test(RULES),
    `firestore.rules: Helper ${fn}() fehlt`);
}

function extractBlock(startMarker) {
  const start = RULES.indexOf(startMarker);
  assert.ok(start > 0, `firestore.rules: "${startMarker}" fehlt`);
  const end = RULES.indexOf(';', start);
  return RULES.slice(start, end);
}

// get: fuer jeden Angemeldeten (Doc-ID im Link ist das Geheimnis).
{
  const block = extractBlock('allow get:');
  assert.ok(block.includes("collection == 'tippgruppen'"), 'allow get muss tippgruppen decken');
  assert.ok(block.includes('request.auth != null'), 'allow get verlangt Anmeldung');
}

// list: NUR query-gebunden – public ODER eigene Mitgliedschaft. Ohne diese
// Bindung waeren versteckte Gruppen per ungefilterter Query auflistbar.
{
  const block = extractBlock('allow list:');
  assert.ok(block.includes("collection == 'tippgruppen'"), 'allow list muss tippgruppen decken');
  assert.ok(block.includes("resource.data.visibility == 'public'"),
    'allow list: public-Zweig fehlt');
  assert.ok(block.includes('request.auth.uid in resource.data.memberUids'),
    'allow list: Mitgliedschafts-Zweig fehlt');
}

// create/update/delete gehen ueber die Validierungs-Helfer.
assert.ok(/collection == 'tippgruppen'\s*&&\s*validTippgruppeCreate\(\)/.test(RULES),
  'firestore.rules: create-Zweig fuer tippgruppen fehlt');
assert.ok(/collection == 'tippgruppen'\s*&&\s*validTippgruppeUpdate\(\)/.test(RULES),
  'firestore.rules: update-Zweig fuer tippgruppen fehlt');
assert.ok(/collection == 'tippgruppen'\s*&&\s*validTippgruppeDelete\(\)/.test(RULES),
  'firestore.rules: delete-Zweig fuer tippgruppen fehlt');

// Der Selbst-Beitritt ist exakt: alle bisherigen Mitglieder bleiben, genau
// eine (die eigene) UID kommt dazu, Kapazitaet gedeckelt.
{
  const joinFn = RULES.slice(RULES.indexOf('function tippgruppeSelfJoin'), RULES.indexOf('function tippgruppeSelfLeave'));
  assert.ok(joinFn.includes('hasAll(resource.data.memberUids)'), 'SelfJoin: bestehende Mitglieder muessen erhalten bleiben');
  assert.ok(joinFn.includes('resource.data.memberUids.size() + 1'), 'SelfJoin: genau ein Neuzugang');
  assert.ok(joinFn.includes('<= 200'), 'SelfJoin: Mitglieder-Obergrenze fehlt');
  assert.ok(joinFn.includes('!(request.auth.uid in resource.data.memberUids)'), 'SelfJoin: kein Doppel-Beitritt');
}

// Updates duerfen Name/Sichtbarkeit/Ersteller nie anfassen.
{
  const updFn = RULES.slice(RULES.indexOf('function validTippgruppeUpdate'), RULES.indexOf('function validTippgruppeDelete'));
  assert.ok(updFn.includes("hasOnly(['memberUids', 'memberNames'])"),
    'Update: nur Mitgliedschafts-Felder duerfen sich aendern');
  assert.ok(updFn.includes('affectedKeys().hasOnly([request.auth.uid])'),
    'Update: nur der eigene memberNames-Eintrag darf sich aendern');
}

// Modul und Rules meinen dieselbe Collection.
{
  const moduleSrc = readRoot('tippgruppen.js');
  assert.ok(moduleSrc.includes("const COLLECTION   = 'tippgruppen'"),
    'tippgruppen.js: Collection-Name muss zu den Rules passen');
}

console.log('✓ test-tippgruppen: Dropdown-Eintrag, Filter, Einbindung und Firestore-Rules sind konsistent.');
