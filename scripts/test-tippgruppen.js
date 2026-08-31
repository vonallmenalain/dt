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

function findByClass(root, className) {
  const stack = root.children.slice();
  while (stack.length) {
    const n = stack.shift();
    if (String(n.className || '').split(/\s+/).indexOf(className) !== -1) return n;
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
function bootSandbox({ storageSeed, search, firebaseAuth, db } = {}) {
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

  const query = search || '';
  const sandbox = {
    console, setTimeout, clearTimeout, setInterval: () => 0, clearInterval: () => {},
    document: documentStub, URL, URLSearchParams,
    navigator: { userAgent: 'node' },
    location: { href: 'https://dt.alae.app/index.html' + query, hostname: 'dt.alae.app', search: query },
    history: { replaceState() {} },
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
  // Anmeldestatus steuerbar (Default: abgemeldet). Der Menue-Eintrag
  // registriert sich unabhaengig davon – das Dropdown selbst ist ohnehin
  // nur fuer Angemeldete erreichbar.
  sandbox.__authUser = null;
  sandbox.DreamTeamAuth = {
    getCurrentUser: () => sandbox.__authUser,
    isSignedInAndVerified: () => !!(sandbox.__authUser && sandbox.__authUser.emailVerified),
    onAuthStateChange(cb) {
      cb({ user: sandbox.__authUser, isVerified: !!(sandbox.__authUser && sandbox.__authUser.emailVerified) });
      return () => {};
    }
  };
  // Firebase-SDK-Stub (fuer waitForAuthResolution + FieldValue-Sentinels)
  // und Firestore-Stub (fuer fetchGroup/joinGroup) nur, wenn der Testfall
  // sie mitbringt.
  if (firebaseAuth) {
    sandbox.firebase = {
      auth: () => firebaseAuth,
      firestore: {
        FieldValue: {
          arrayUnion: (v) => ({ __op: 'arrayUnion', value: v }),
          arrayRemove: (v) => ({ __op: 'arrayRemove', value: v }),
          delete: () => ({ __op: 'delete' }),
          serverTimestamp: () => ({ __op: 'serverTimestamp' })
        }
      }
    };
  }
  if (db) sandbox.APP_CONFIG = { getDb: () => db };

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
// Bindung waeren private Gruppen per ungefilterter Query auflistbar.
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

// Modul und Rules meinen dieselbe Collection und dieselben
// Sichtbarkeits-Werte ('public' | 'private' – NICHT mehr 'hidden').
{
  const moduleSrc = readRoot('tippgruppen.js');
  assert.ok(moduleSrc.includes("const COLLECTION   = 'tippgruppen'"),
    'tippgruppen.js: Collection-Name muss zu den Rules passen');

  const schemaFn = RULES.slice(RULES.indexOf('function tippgruppeSchemaOk'), RULES.indexOf('function validTippgruppeCreate'));
  assert.ok(schemaFn.includes("visibility == 'private'"),
    "firestore.rules: Schema muss visibility 'private' erlauben");
  assert.ok(!schemaFn.includes("'hidden'"),
    "firestore.rules: der alte Wert 'hidden' darf im Schema nicht mehr vorkommen");
  assert.ok(moduleSrc.includes("visibility === 'public' ? 'public' : 'private'"),
    "tippgruppen.js: Erstellen muss 'private' schreiben (nicht 'hidden')");
  // Nur CODE pruefen – der Kommentar zum Alt-Wert-Fallback darf 'hidden'
  // weiterhin erwaehnen.
  const moduleCode = moduleSrc.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
  assert.ok(!/['"]hidden['"]/.test(moduleCode),
    "tippgruppen.js: kein String-Wert 'hidden' mehr im Modul-Code");
}

/* ─────────────────────────────────────────────────────────────────────────────
 *  4) Einladungs-Link: erst entscheiden, wenn die Auth-Aufloesung da ist
 *
 *  Firebase stellt die Session ASYNCHRON wieder her. Der Einladungs-Dialog
 *  darf einer bereits angemeldeten Person deshalb NIE die Anmelde-
 *  Aufforderung zeigen, nur weil der Session-Restore beim Boot noch
 *  unterwegs ist (genau dieser Bug stand in Version 1) – er wartet auf den
 *  ersten onAuthStateChanged-Callback des SDK.
 * ───────────────────────────────────────────────────────────────────────────── */
const INVITE_GROUP = {
  name: 'Büro-Runde', visibility: 'private',
  creatorUid: 'u-creator', creatorName: 'Alice Müller',
  memberUids: ['u-creator', 'u2'],
  memberNames: { 'u-creator': 'Alice Müller', u2: 'Bob' }
};

function makeInviteStubs() {
  let authCallback = null;
  const firebaseAuth = {
    onAuthStateChanged(cb) { authCallback = cb; return () => { authCallback = null; }; }
  };
  const db = {
    collection: (name) => ({
      doc: (id) => ({
        get: async () => (name === 'tippgruppen' && id === 'g1'
          ? { id: 'g1', exists: true, data: () => ({ ...INVITE_GROUP }) }
          : { exists: false })
      })
    })
  };
  return { firebaseAuth, db, fireAuth: (user) => { if (authCallback) authCallback(user); } };
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 25));

(async () => {
  // (a) Angemeldet, Session-Restore kommt NACH dem Boot: kein Anmelde-
  //     Prompt, sondern (nach der Aufloesung) direkt die Gruppen-Vorschau.
  {
    const stubs = makeInviteStubs();
    const { sandbox, body } = bootSandbox({
      search: '?tippgruppe=g1',
      firebaseAuth: stubs.firebaseAuth,
      db: stubs.db
    });

    const popupBody = findByClass(body, 'dt-tg-body');
    assert.ok(popupBody, 'Einladungs-Dialog muss sich beim Boot oeffnen');
    assert.match(textOf(popupBody), /wird geladen/,
      'vor der Auth-Aufloesung zeigt der Dialog den Ladezustand');
    assert.doesNotMatch(textOf(popupBody), /Melde dich an/,
      'vor der Auth-Aufloesung darf KEINE Anmelde-Aufforderung erscheinen');

    // Session-Restore trifft ein (wie auth.js: erst Wrapper-Stand, dann Event).
    const user = { uid: 'u-me', email: 'me@example.com', emailVerified: true };
    sandbox.__authUser = user;
    stubs.fireAuth(user);
    await settle();

    const text = textOf(popupBody);
    assert.match(text, /Einladung: Büro-Runde/,
      'nach der Aufloesung erscheint direkt die Gruppen-Vorschau');
    assert.match(text, /Alice Müller \(Ersteller\)/, 'die Vorschau nennt den Ersteller');
    assert.match(text, /Bob/, 'die Vorschau listet die Mitglieder');
    assert.match(text, /Beitreten/, 'der Beitritts-Knopf steht bereit');
    assert.doesNotMatch(text, /Melde dich an/,
      'angemeldete Personen sehen die Anmelde-Aufforderung nie');
  }

  // (b) Wirklich abgemeldet (SDK loest mit null auf): Anmelde-Prompt.
  {
    const stubs = makeInviteStubs();
    const { body } = bootSandbox({
      search: '?tippgruppe=g1',
      firebaseAuth: stubs.firebaseAuth,
      db: stubs.db
    });

    stubs.fireAuth(null);
    await settle();

    const popupBody = findByClass(body, 'dt-tg-body');
    assert.match(textOf(popupBody), /Melde dich an/,
      'abgemeldete Personen bekommen die Anmelde-Aufforderung');
    assert.match(textOf(popupBody), /Anmelden \/ Registrieren/);
  }

  // (c) Bereits Mitglied: Vorschau zeigt den Bestandsstatus.
  {
    const stubs = makeInviteStubs();
    const { sandbox, body } = bootSandbox({
      search: '?tippgruppe=g1',
      firebaseAuth: stubs.firebaseAuth,
      db: stubs.db
    });

    const member = { uid: 'u2', email: 'bob@example.com', emailVerified: true };
    sandbox.__authUser = member;
    stubs.fireAuth(member);
    await settle();

    const popupBody = findByClass(body, 'dt-tg-body');
    assert.match(textOf(popupBody), /bereits Mitglied/,
      'Mitglieder sehen den Bestandsstatus statt des Beitritts');
  }

  /* ───────────────────────────────────────────────────────────────────────────
   *  5) Beitritt: Token-Refresh-Retry, Realitaets-Check, ehrliche Fehler
   *
   *  Direkt nach der E-Mail-Bestaetigung traegt das gecachte ID-Token noch
   *  email_verified=false → die Rules lehnen den ersten Write mit
   *  permission-denied ab, obwohl der Client "verifiziert" anzeigt (so sah
   *  ein frisch verifizierter Zweit-Account "Beitritt fehlgeschlagen",
   *  obwohl der Beitritt kurz darauf klappte). Der Client heilt das jetzt
   *  selbst: Token frisch holen + einmal wiederholen; schlaegt der Write
   *  trotzdem fehl, wird die Wirklichkeit geprueft (Mitglied? → Erfolg)
   *  und sonst ein konkreter Fehler MIT Retry-Knopf gezeigt.
   * ─────────────────────────────────────────────────────────────────────────── */
  function findButton(root, label) {
    const stack = root.children.slice();
    while (stack.length) {
      const n = stack.shift();
      if (n.tagName === 'BUTTON' && textOf(n).indexOf(label) !== -1) return n;
      stack.push(...n.children);
    }
    return null;
  }

  function makeJoinStubs({ updateOutcomes, memberAfterAttempt }) {
    let authCallback = null;
    let updateCalls = 0;
    let joinedOnServer = false;
    const deniedError = () => Object.assign(new Error('Missing or insufficient permissions.'), { code: 'permission-denied' });

    const groupData = () => ({
      ...INVITE_GROUP,
      memberUids: joinedOnServer ? INVITE_GROUP.memberUids.concat(['u-join']) : INVITE_GROUP.memberUids.slice(),
      memberNames: joinedOnServer
        ? { ...INVITE_GROUP.memberNames, 'u-join': 'Zweiti' }
        : { ...INVITE_GROUP.memberNames }
    });

    const db = {
      collection: (name) => ({
        doc: (id) => ({
          get: async () => (name === 'tippgruppen' && id === 'g1'
            ? { id: 'g1', exists: true, data: groupData }
            : { exists: false }),
          update: async (payload) => {
            updateCalls += 1;
            assert.ok(payload && payload['memberNames.u-join'],
              'Join-Update muss den eigenen memberNames-Eintrag setzen');
            const outcome = updateOutcomes[Math.min(updateCalls, updateOutcomes.length) - 1];
            if (memberAfterAttempt) joinedOnServer = true; // Write kam trotz Fehlermeldung an
            if (outcome === 'denied') throw deniedError();
            joinedOnServer = true;
          }
        })
      })
    };

    const firebaseAuth = {
      onAuthStateChanged(cb) { authCallback = cb; return () => { authCallback = null; }; }
    };

    let tokenRefreshes = 0;
    const joiner = {
      uid: 'u-join', email: 'zwei@example.com', emailVerified: true,
      getIdToken(force) { if (force) tokenRefreshes += 1; return Promise.resolve('token'); }
    };

    return {
      db, firebaseAuth, joiner,
      fireAuth: (user) => { if (authCallback) authCallback(user); },
      counts: () => ({ updateCalls, tokenRefreshes })
    };
  }

  async function bootToPreviewAndJoin(stubs) {
    const booted = bootSandbox({ search: '?tippgruppe=g1', firebaseAuth: stubs.firebaseAuth, db: stubs.db });
    booted.sandbox.__authUser = stubs.joiner;
    stubs.fireAuth(stubs.joiner);
    await settle();
    const popupBody = findByClass(booted.body, 'dt-tg-body');
    assert.match(textOf(popupBody), /Beitreten/, 'Vorschau mit Beitritts-Knopf muss stehen');
    const joinBtn = findButton(popupBody, 'Beitreten');
    joinBtn.listeners.click[0]({ currentTarget: joinBtn, stopPropagation() {} });
    await settle();
    return { popupBody, sandbox: booted.sandbox };
  }

  // (d) Veraltetes Token: erster Write permission-denied → Token-Refresh,
  //     zweiter Write klappt → Erfolg, keine Fehlermeldung.
  {
    const stubs = makeJoinStubs({ updateOutcomes: ['denied', 'ok'] });
    const { popupBody, sandbox } = await bootToPreviewAndJoin(stubs);

    const text = textOf(popupBody);
    assert.match(text, /beigetreten/, 'nach dem Retry erscheint die Erfolgsmeldung');
    assert.doesNotMatch(text, /fehlgeschlagen|abgelehnt/, 'kein Fehlertext nach geheiltem Beitritt');
    const counts = stubs.counts();
    assert.equal(counts.tokenRefreshes, 1, 'genau ein erzwungener Token-Refresh');
    assert.equal(counts.updateCalls, 2, 'genau ein Retry');
    const sel = JSON.parse(sandbox.localStorage.getItem('dreamteam_tippgruppe_selected'));
    assert.equal(sel && sel.id, 'g1', 'Beitritt aktiviert die Gruppe');
  }

  // (e) Write meldet Fehler, kam aber an (Antwort verloren): der
  //     Realitaets-Check erkennt die Mitgliedschaft → Erfolg statt Fehler.
  {
    const stubs = makeJoinStubs({ updateOutcomes: ['denied', 'denied'], memberAfterAttempt: true });
    const { popupBody } = await bootToPreviewAndJoin(stubs);

    const text = textOf(popupBody);
    assert.match(text, /beigetreten/, 'Mitgliedschaft zaehlt, auch wenn der Write-Fehler meldete');
    assert.doesNotMatch(text, /fehlgeschlagen|abgelehnt/,
      'keine Fehlermeldung, wenn der Beitritt in Wahrheit funktioniert hat');
  }

  // (f) Echter, bleibender Fehler: konkreter Text + Weg nach vorn.
  {
    const stubs = makeJoinStubs({ updateOutcomes: ['denied', 'denied'] });
    const { popupBody } = await bootToPreviewAndJoin(stubs);

    const text = textOf(popupBody);
    assert.match(text, /abgelehnt|Beitritt/, 'permission-denied wird verstaendlich uebersetzt');
    assert.ok(findButton(popupBody, 'Erneut versuchen'),
      'nach einem Fehler gibt es einen Retry-Knopf (keine Sackgasse)');
    assert.ok(findButton(popupBody, 'Schliessen'), 'und einen Schliessen-Knopf');
    assert.equal(stubs.counts().tokenRefreshes, 1,
      'auch im Fehlerfall wurde der Token-Refresh-Retry versucht');
  }

  console.log('✓ test-tippgruppen: Dropdown-Eintrag, Filter, Einladungs-Flow (inkl. Token-Retry + Realitaets-Check), Einbindung und Firestore-Rules sind konsistent.');
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
