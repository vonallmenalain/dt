#!/usr/bin/env node
/* =============================================================================
 *  scripts/test-team-duplicate-guard.js
 *
 *  Guard gegen DOPPELTE Team-Einreichungen.
 *
 *  Der Bug: Ein Manager stand zweimal in der Teams-Liste – zwei Dokumente
 *  mit derselben UID, identischer Aufstellung und identischem Zeitstempel
 *  (auf die Sekunde). Ursache ist das Muster "erst lesen, dann schreiben"
 *  beim Anlegen (gibt es schon ein Team fuer diese UID/E-Mail?). Laufen
 *  zwei Kontexte parallel – zwei Tabs, PWA neben Browser, ein zweites Mal
 *  angestossenes Finalize nach der E-Mail-Bestaetigung –, lesen beide
 *  "noch kein Team" und legen anschliessend beide eines an. Mit
 *  Firestore-Auto-IDs entstehen dabei ZWEI Dokumente.
 *
 *  Die Absicherung hat zwei Ebenen, und beide werden hier geprueft:
 *
 *    1. CLIENT (auth.js): Neue Team-Dokumente liegen deterministisch unter
 *       der UID des Nutzers (`teams/{uid}`). Parallele Schreiber treffen
 *       damit zwangslaeufig dasselbe Dokument. Zusaetzlich serialisiert
 *       saveOrUpdateTeam() die Aufrufe innerhalb eines Tabs.
 *       Getestet wird das mit dem echten Modul in einer Sandbox: einmal
 *       zwei parallele Aufrufe im selben Kontext, einmal zwei getrennte
 *       Kontexte ("zwei Tabs") auf derselben Fake-Firestore.
 *
 *    2. SERVER (firestore.rules): Jeder create-Zweig einer Team-Collection
 *       verlangt `docId == request.auth.uid` (Admin ausgenommen, der legt
 *       im Testteam-Modus bewusst mehrere Teams an). Ohne diese Zeile
 *       haengt die Garantie allein am Client.
 *
 *  Aufruf: npm run test:duplicate-guard
 * ============================================================================= */

'use strict';

const assert = require('node:assert/strict');
const fs     = require('node:fs');
const path   = require('node:path');
const vm     = require('node:vm');

const ROOT     = path.join(__dirname, '..');
const AUTH_SRC = fs.readFileSync(path.join(ROOT, 'auth.js'), 'utf8');
const RULES    = fs.readFileSync(path.join(ROOT, 'firestore.rules'), 'utf8');

const TEAMS_COLLECTION = 'Teams Test';
const UID   = 'uid-carden';
const EMAIL = 'carden@example.com';

/* ─────────────────────────────────────────────────────────────────────────────
 *  Fake-Firestore
 *
 *  Nur so viel, wie auth.js anfasst: collection().doc().set/update,
 *  collection().add() und where().limit().get(). Jeder Zugriff ist
 *  absichtlich asynchron (setTimeout), damit sich parallele Aufrufe
 *  ueberholen koennen – genau das erzeugt den Wettlauf, um den es geht.
 * ───────────────────────────────────────────────────────────────────────────── */
function makeFirestore() {
  const store = new Map();          // collection -> Map(docId -> data)
  let autoIds = 0;
  const tick = () => new Promise(resolve => setTimeout(resolve, 5));

  const docsOf = (name) => {
    if (!store.has(name)) store.set(name, new Map());
    return store.get(name);
  };

  function makeQuery(name, filters) {
    return {
      where(field, _op, value) { return makeQuery(name, filters.concat([[field, value]])); },
      limit(n) { return { get: () => runQuery(name, filters, n) }; },
      get: () => runQuery(name, filters, Infinity)
    };
  }

  async function runQuery(name, filters, max) {
    await tick();
    const hits = [];
    docsOf(name).forEach((data, id) => {
      if (hits.length >= max) return;
      if (filters.every(([field, value]) => data[field] === value)) {
        hits.push({ id, data: () => ({ ...data }) });
      }
    });
    return { empty: hits.length === 0, docs: hits, size: hits.length };
  }

  return {
    collection(name) {
      return {
        where: (field, op, value) => makeQuery(name, [[field, value]]),
        doc(id) {
          return {
            id,
            async set(data, options) {
              await tick();
              const prev = (options && options.merge && docsOf(name).get(id)) || {};
              docsOf(name).set(id, { ...prev, ...data });
            },
            async update(data) {
              await tick();
              if (!docsOf(name).has(id)) {
                const err = new Error('No document to update');
                err.code = 'not-found';
                throw err;
              }
              docsOf(name).set(id, { ...docsOf(name).get(id), ...data });
            }
          };
        },
        async add(data) {
          await tick();
          const id = `auto-${++autoIds}`;
          docsOf(name).set(id, { ...data });
          return { id };
        }
      };
    },
    /* Test-Helfer */
    teams: () => Array.from(docsOf(TEAMS_COLLECTION).entries())
      .map(([id, data]) => ({ id, data }))
  };
}

/* ─────────────────────────────────────────────────────────────────────────────
 *  Ein "Tab": auth.js in einer eigenen Sandbox, mit eigener Firebase-Fassade,
 *  aber auf der GEMEINSAMEN Fake-Firestore.
 * ───────────────────────────────────────────────────────────────────────────── */
function openTab(db) {
  const user = {
    uid: UID,
    email: EMAIL,
    emailVerified: true,
    getIdToken: async () => 'token',
    reload: async () => {}
  };

  const authApi = {
    currentUser: user,
    onAuthStateChanged(cb) { cb(user); },
    setPersistence: async () => {},
    isSignInWithEmailLink: () => false,
    languageCode: 'de'
  };

  const firebase = {
    auth: Object.assign(() => authApi, { Auth: { Persistence: { LOCAL: 'local' } } }),
    firestore: { FieldValue: { serverTimestamp: () => 'SERVER_TIMESTAMP' } }
  };

  const storage = new Map();
  const localStorage = {
    getItem: (k) => (storage.has(k) ? storage.get(k) : null),
    setItem: (k, v) => storage.set(k, String(v)),
    removeItem: (k) => storage.delete(k)
  };

  const win = {
    addEventListener() {},
    location: { href: 'https://example.test/team-builder.html', origin: 'https://example.test', pathname: '/team-builder.html' },
    history: { replaceState() {} },
    localStorage
  };
  win.window = win;

  const sandbox = {
    window: win,
    document: { addEventListener() {}, visibilityState: 'visible', title: '' },
    localStorage,
    firebase,
    console: { log() {}, warn() {}, error() {} },
    setTimeout,
    clearTimeout,
    URL,
    JSON,
    Promise,
    Date
  };
  sandbox.globalThis = sandbox;

  vm.runInNewContext(AUTH_SRC, sandbox, { filename: 'auth.js' });

  const Auth = win.DreamTeamAuth;
  assert.ok(Auth, 'auth.js exportiert window.DreamTeamAuth nicht mehr.');
  Auth.init({ db, teamsCollection: TEAMS_COLLECTION });
  return Auth;
}

const payload = (manager) => ({
  manager,
  managerNormalized: manager.toLowerCase(),
  players: Array.from({ length: 15 }, (_, i) => ({ slot: `slot-${i}`, playerId: String(i) }))
});

/* ─────────────────────────────────────────────────────────────────────────────
 *  1) Zwei parallele Einreichungen im SELBEN Tab
 * ───────────────────────────────────────────────────────────────────────────── */
async function testSameTabRace() {
  const db = makeFirestore();
  const Auth = openTab(db);

  const results = await Promise.all([
    Auth.saveOrUpdateTeam(payload('Carden Wilson')),
    Auth.saveOrUpdateTeam(payload('Carden Wilson'))
  ]);

  const teams = db.teams();
  assert.equal(teams.length, 1,
    `Zwei parallele Einreichungen im selben Tab haben ${teams.length} Team-Dokumente erzeugt – erwartet: 1.`);
  assert.equal(teams[0].id, UID,
    'Ein neues Team muss unter der UID des Nutzers liegen, nicht unter einer Auto-ID.');
  assert.ok(results.every(r => r && r.id === UID),
    'saveOrUpdateTeam() muss in beiden Aufrufen dieselbe Doc-ID zurueckgeben.');
}

/* ─────────────────────────────────────────────────────────────────────────────
 *  2) Zwei getrennte Kontexte ("zwei Tabs" / PWA neben Browser)
 *
 *  Der harte Fall: Die Serialisierung in auth.js greift hier NICHT, weil
 *  jeder Tab seinen eigenen Modul-Zustand hat. Beide lesen "noch kein
 *  Team" und schreiben anschliessend. Nur die deterministische Doc-ID
 *  verhindert, dass daraus zwei Dokumente werden.
 * ───────────────────────────────────────────────────────────────────────────── */
async function testTwoTabRace() {
  const db = makeFirestore();
  const tabA = openTab(db);
  const tabB = openTab(db);

  await Promise.all([
    tabA.saveOrUpdateTeam(payload('Carden Wilson')),
    tabB.saveOrUpdateTeam(payload('Carden Wilson'))
  ]);

  const teams = db.teams();
  assert.equal(teams.length, 1,
    `Zwei Tabs haben ${teams.length} Team-Dokumente erzeugt – erwartet: 1 (Doppel-Einreichung!).`);
  assert.equal(teams[0].id, UID, 'Doc-ID des Teams muss die UID des Nutzers sein.');
  assert.equal(teams[0].data.userId, UID, 'userId im Dokument muss zur UID passen.');
  assert.equal(teams[0].data.players.length, 15, 'Das Team muss 15 Spieler behalten.');
}

/* ─────────────────────────────────────────────────────────────────────────────
 *  3) Zweite Einreichung nach abgeschlossener erster = Update, kein Zweit-Team
 * ───────────────────────────────────────────────────────────────────────────── */
async function testSecondSubmitUpdates() {
  const db = makeFirestore();
  const tabA = openTab(db);
  const tabB = openTab(db);

  const first = await tabA.saveOrUpdateTeam(payload('Carden Wilson'));
  assert.equal(first.mode, 'create', 'Die erste Einreichung muss ein create sein.');

  // Frischer Kontext ohne loadedTeamId – er muss das bestehende Team finden.
  const second = await tabB.saveOrUpdateTeam(payload('Carden Wilson'));
  assert.equal(second.mode, 'update',
    'Die zweite Einreichung desselben Accounts muss das bestehende Team aktualisieren.');
  assert.equal(db.teams().length, 1, 'Nach zwei Einreichungen darf es nur ein Team geben.');
}

/* ─────────────────────────────────────────────────────────────────────────────
 *  4) Firestore-Rules: create verlangt die eigene UID als Doc-ID
 * ───────────────────────────────────────────────────────────────────────────── */
function testRules() {
  const rules = RULES.replace(/\/\/[^\n]*/g, '');   // Kommentare raus
  const start = rules.indexOf('allow create:');
  assert.notEqual(start, -1, 'Kein "allow create:"-Block in firestore.rules gefunden.');
  const createBlock = rules.slice(start, rules.indexOf(';', start));

  const teamCollections = [
    'Teams WM 2026',
    'Teams CL 2025-26 Test',
    'Teams CL 2026-27'
  ];

  // Der create-Block ist eine Kette von "|| ( ... )"-Zweigen. Pro
  // Team-Collection muss der zugehoerige Zweig die Doc-ID-Bedingung tragen.
  const branches = createBlock.split('|| (');
  teamCollections.forEach((collection) => {
    const branch = branches.find(part => part.includes(`collection == '${collection}'`));
    assert.ok(branch,
      `firestore.rules haben keinen create-Zweig fuer "${collection}".`);
    assert.ok(/docId\s*==\s*request\.auth\.uid/.test(branch),
      `Der create-Zweig fuer "${collection}" verlangt nicht "docId == request.auth.uid" – `
      + 'damit koennte ein Account wieder zwei Team-Dokumente anlegen.');
    assert.ok(/isAdmin\(\)/.test(branch),
      `Der create-Zweig fuer "${collection}" muss den Admin ausnehmen (Testteam-Modus).`);
  });
}

/* ─────────────────────────────────────────────────────────────────────────────
 *  5) Quelltext-Wache: Auto-IDs nur noch im Testteam-Modus
 * ───────────────────────────────────────────────────────────────────────────── */
function testSourceGuards() {
  assert.ok(/\.doc\(state\.currentUser\.uid\)/.test(AUTH_SRC),
    'saveTeamForUser() muss neue Teams unter der UID anlegen (collection.doc(state.currentUser.uid)).');
  assert.ok(/options\.randomId[\s\S]{0,400}?\.add\(docData\)/.test(AUTH_SRC),
    'Die Auto-ID (collection.add) darf nur noch hinter options.randomId liegen (Testteam-Modus).');
  assert.ok(/saveTeamForUser\(payload, \{ randomId: true \}\)/.test(AUTH_SRC),
    'Der Testteam-Modus (forceCreate) muss saveTeamForUser mit randomId aufrufen.');
  assert.ok(/saveQueue\s*=/.test(AUTH_SRC),
    'saveOrUpdateTeam() muss die Aufrufe serialisieren (saveQueue).');
}

(async () => {
  await testSameTabRace();
  await testTwoTabRace();
  await testSecondSubmitUpdates();
  testRules();
  testSourceGuards();
  console.log('team duplicate guard test passed');
})().catch((err) => {
  console.error(err && err.stack ? err.stack : err);
  process.exit(1);
});
