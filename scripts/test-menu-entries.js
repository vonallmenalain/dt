'use strict';

/* =============================================================================
 *  test-menu-entries.js
 *
 *  Guard für die Vollständigkeit des Profil-Dropdowns.
 *
 *  Die Regel, die dieser Test festnagelt:
 *
 *      JEDER Menüeintrag wird von einem Modul registriert, das auf ALLEN
 *      Seiten (und in der App-Shell) geladen ist.
 *
 *  Warum das eine Regel und keine Empfehlung ist: Seit app.html laufen die
 *  Seiten als Frames, und die sichtbare Leiste gehört der Shell – das
 *  Dropdown einer eingebetteten Seite sieht niemand. Ein Eintrag, den nur
 *  eine Seite registriert, ist deshalb entweder auf allen anderen Seiten weg
 *  oder überhaupt nie sichtbar. Genau so verschwanden die Einreichungs-
 *  Schalter des Team-Builders aus dem Menü.
 *
 *  Geprüft wird:
 *    1. jede Seite mit Profil-Icon lädt alle vier Menü-Module,
 *    2. NUR diese Module registrieren Einträge,
 *    3. die vier immer sichtbaren Einträge sind da (Mein Team, Tippgruppen,
 *       Turnier-Wechsel, Abmelden),
 *    4. submit-tools.js verhält sich richtig (Sandbox: Schalter, Speicherung,
 *       Live-Abgleich zwischen Seiten, Admin-Gate).
 * ============================================================================= */

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ROOT = path.join(__dirname, '..');
const readRoot = (file) => fs.readFileSync(path.join(ROOT, file), 'utf8');

/* Module, die Einträge ins Profil-Dropdown hängen. Wer hier dazukommt, muss
   auf allen Seiten eingebunden sein – genau das prüft Teil 1 und 2. */
const MENU_MODULE = {
  'nav.js':          'Turnier-Wechsel + Archiv',
  'tippgruppen.js':  'Tippgruppen',
  'view-mode.js':    'Ansicht (Vor/Nach Start)',
  'submit-tools.js': 'Team-Einreichung (Nachzügler, Testteams)'
};

/* ── 1) Jede Seite mit Profil-Icon lädt alle Menü-Module ────────────────── */

const seiten = fs.readdirSync(ROOT)
  .filter((f) => f.endsWith('.html') && !f.startsWith('adm-'))
  .filter((f) => readRoot(f).includes('auth-modal.js'));

assert.ok(seiten.length >= 8,
  `Erwartet werden mindestens 8 Seiten mit Profil-Dropdown, gefunden: ${seiten.length}.`);
assert.ok(seiten.includes('app.html'),
  'app.html (die Shell) trägt die sichtbare Leiste und muss die Module ebenfalls laden.');

seiten.forEach((seite) => {
  const html = readRoot(seite);
  Object.keys(MENU_MODULE).forEach((modul) => {
    assert.ok(html.includes(`src="${modul}?v=__BUILD__"`),
      `${seite} lädt ${modul} nicht (${MENU_MODULE[modul]}). Ohne das fehlen die ` +
      'Einträge auf dieser Seite – im Profil-Dropdown darf nie etwas fehlen.');
  });
});

/* ── 2) Nur diese Module registrieren Einträge ──────────────────────────── */

const jsDateien = fs.readdirSync(ROOT)
  .filter((f) => f.endsWith('.js'))
  .filter((f) => !['auth-modal.js'].includes(f))         // die Registrierstelle selbst
  .filter((f) => !f.endsWith('.min.js'));

jsDateien.forEach((datei) => {
  if (MENU_MODULE[datei]) return;
  const src = readRoot(datei);
  assert.ok(!/\b(devMenu|menu)\.register\s*\(/.test(src),
    `${datei} registriert einen Menüeintrag. Seitenspezifische Einträge sind ` +
    'in der App-Shell unsichtbar – der Eintrag gehört in eines der Module ' +
    `(${Object.keys(MENU_MODULE).join(', ')}), das jede Seite lädt.`);
});

/* ── 3) Die vier immer sichtbaren Einträge ──────────────────────────────── */

const AUTH_MODAL = readRoot('auth-modal.js');
assert.match(AUTH_MODAL, /id:\s*'dt-auth-nav-myteam'/,
  '„Mein Team" ist fest im Dropdown verdrahtet und muss dort bleiben.');
assert.match(AUTH_MODAL, /id:\s*'dt-auth-nav-logout'/,
  '„Abmelden" ist fest im Dropdown verdrahtet und muss dort bleiben.');

// Beide Kanäle: `menu` (jede angemeldete Person) und `devMenu` (nur Admins).
assert.match(readRoot('nav.js'), /Modal\.menu\.register\(/,
  'Der Turnier-Wechsel muss über `menu.register` laufen – er gehört allen ' +
  'Accounts, nicht nur Admins.');
assert.match(readRoot('tippgruppen.js'), /Modal\.menu\.register\(/,
  'Der Tippgruppen-Eintrag muss über `menu.register` laufen – er gehört ' +
  'allen Accounts, nicht nur Admins.');

/* ── 4) submit-tools.js in der Sandbox ──────────────────────────────────── */

function ladeSubmitTools({ isAdmin = true, gespeichert = null } = {}) {
  const speicher = new Map();
  if (gespeichert !== null) speicher.set('dreamteam_cl2627_admin_test_team_mode', gespeichert);

  const eintraege = new Map();
  let refreshes = 0;
  let snapshotCb = null;
  const geschrieben = [];

  const docRef = {
    onSnapshot: (cb) => { snapshotCb = cb; return () => {}; },
    set: (data) => { geschrieben.push(data); return Promise.resolve(); }
  };

  const windowListeners = new Map();
  const sandbox = {
    console: { log() {}, warn() {}, error() {} },
    setInterval: () => 0,
    clearInterval: () => {},
    document: { addEventListener() {} }
  };
  sandbox.window = sandbox;
  sandbox.localStorage = {
    getItem: (k) => (speicher.has(k) ? speicher.get(k) : null),
    setItem: (k, v) => speicher.set(k, String(v)),
    removeItem: (k) => speicher.delete(k)
  };
  sandbox.addEventListener = (type, fn) => {
    if (!windowListeners.has(type)) windowListeners.set(type, []);
    windowListeners.get(type).push(fn);
  };
  sandbox.APP_CONFIG = {
    year: '2026',
    storage: { key: (name) => `dreamteam_cl2627_${name}` },
    firestore: { metaCollection: 'app_meta', metaDocId: () => 'turnier_cl2627' },
    getDb: () => ({ collection: () => ({ doc: () => docRef }) })
  };
  sandbox.firebase = { firestore: { FieldValue: { increment: (n) => ({ inc: n }) } } };
  sandbox.DreamTeamAdmin = {
    isAdmin: () => isAdmin,
    onAdminChange: (cb) => { cb({ isAdmin }); return () => {}; }
  };
  sandbox.DreamTeamAuthModal = {
    devMenu: {
      register(item) { eintraege.set(item.id, item); return () => {}; },
      unregister(id) { eintraege.delete(id); },
      refresh() { refreshes += 1; }
    }
  };

  vm.createContext(sandbox);
  vm.runInContext(readRoot('submit-tools.js'), sandbox, { filename: 'submit-tools.js' });

  return {
    Tools: sandbox.window.DreamTeamSubmitTools,
    eintraege,
    wert: (id) => {
      const item = eintraege.get(id);
      return typeof item.value === 'function' ? item.value() : item.value;
    },
    klick: (id) => eintraege.get(id).onSelect(),
    snapshot: (data) => snapshotCb({ exists: true, data: () => data }),
    geschrieben,
    gespeichert: () => speicher.get('dreamteam_cl2627_admin_test_team_mode') || null,
    /* Schreibt so, wie es eine ANDERE Seite täte: nur in den Speicher,
       ohne das Modul hier anzufassen. */
    fremdSchreiben: (wert) => {
      if (wert === null) speicher.delete('dreamteam_cl2627_admin_test_team_mode');
      else speicher.set('dreamteam_cl2627_admin_test_team_mode', wert);
    },
    refreshes: () => refreshes,
    storageEvent: (key) => (windowListeners.get('storage') || []).forEach((fn) => fn({ key }))
  };
}

/* 4a) Beide Schalter sind da – auf jeder Seite, die die Datei lädt. */
{
  const s = ladeSubmitTools();
  assert.deepEqual(Array.from(s.eintraege.keys()).sort(), ['team-latesubmit', 'team-testmode'],
    'submit-tools.js muss beide Einreichungs-Schalter registrieren.');
  assert.equal(s.eintraege.get('team-latesubmit').group, 'Team-Einreichung');
  assert.equal(s.eintraege.get('team-testmode').group, 'Team-Einreichung');
}

/* 4b) Testteam-Modus: umschalten, speichern, melden. */
{
  const s = ladeSubmitTools();
  const gesehen = [];
  s.Tools.onTestTeamModeChange((on) => gesehen.push(on));

  assert.equal(s.wert('team-testmode'), 'aus');
  assert.equal(s.Tools.isTestTeamMode(), false);

  s.klick('team-testmode');
  assert.equal(s.wert('team-testmode'), 'an');
  assert.equal(s.Tools.isTestTeamMode(), true);
  assert.equal(s.gespeichert(), '1', 'Der Modus muss den Reload überleben (localStorage).');
  assert.deepEqual(gesehen, [false, true],
    'Abonnenten (z.B. der Team-Builder) müssen sofort und bei jeder Änderung erfahren, was gilt.');

  s.klick('team-testmode');
  assert.equal(s.gespeichert(), null, 'Ausschalten muss den Wert wieder entfernen.');
}

/* 4c) Ein bereits offener Frame zieht über das storage-Event nach. */
{
  const s = ladeSubmitTools();
  const gesehen = [];
  s.Tools.onTestTeamModeChange((on) => gesehen.push(on));

  // Eine ANDERE Seite schreibt den Wert; hier kommt nur das Event an.
  s.fremdSchreiben('1');
  s.storageEvent('dreamteam_cl2627_admin_test_team_mode');

  assert.equal(s.Tools.isTestTeamMode(), true,
    'Ein storage-Event von einer anderen Seite muss den Modus hier nachziehen – ' +
    'sonst bleibt ein schon offener Team-Builder auf dem alten Stand.');
  assert.deepEqual(gesehen, [false, true]);

  s.fremdSchreiben(null);
  s.storageEvent('dreamteam_cl2627_admin_test_team_mode');
  assert.equal(s.Tools.isTestTeamMode(), false, 'Das gilt auch fürs Ausschalten.');

  // Ein fremder Key darf nichts auslösen.
  const vorher = gesehen.length;
  s.storageEvent('irgendein-anderer-key');
  assert.equal(gesehen.length, vorher,
    'Ein storage-Event zu einem anderen Key darf den Modus nicht anfassen.');
}

/* 4d) Nachzügler-Schalter: Firestore-Stand kommt an, Klick schreibt. */
{
  const s = ladeSubmitTools();
  const gesehen = [];
  s.Tools.onLateSubmitChange((open) => gesehen.push(open));

  assert.equal(s.wert('team-latesubmit'), 'gesperrt',
    'Vor der Firestore-Antwort gilt konservativ „gesperrt".');

  s.snapshot({ lateSubmitOpen: true });
  assert.equal(s.Tools.isLateSubmitOpen(), true);
  assert.equal(s.wert('team-latesubmit'), 'offen');
  assert.deepEqual(gesehen, [false, true],
    'Der Team-Builder muss die Öffnung sofort erfahren, egal auf welcher Seite sie passiert.');
}

/* 4e) Ohne Admin passiert nichts. */
{
  const s = ladeSubmitTools({ isAdmin: false });
  s.klick('team-testmode');
  assert.equal(s.gespeichert(), null,
    'Ohne angemeldeten Admin darf ein Klick nichts umschalten (UI-Schranke; ' +
    'die echte Sperre liegt in den Firestore Rules).');
}

console.log('✓ test-menu-entries: Profil-Dropdown ist auf allen Seiten vollständig, submit-tools.js verhält sich richtig.');
