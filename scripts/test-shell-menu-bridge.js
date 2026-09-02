'use strict';

/* =============================================================================
 *  test-shell-menu-bridge.js
 *
 *  Guard für die Shell-Brücke des Profil-Dropdowns (auth-modal.js).
 *
 *  Seit der App-Shell (app.html, shell.js) laufen die Seiten als Frames und
 *  die sichtbare Navigationsleiste gehört der Shell – die Leiste der
 *  eingebetteten Seite versteckt styles.css. Einträge, die eine Seite über
 *  `devMenu.register` anmeldet (Team-Builder: „Einreichung für alle" und
 *  „Testteams (mehrere)"), landeten dadurch in einem Dropdown, das niemand
 *  sieht. Die Brücke spiegelt sie in die Shell, solange der Frame der
 *  sichtbare ist.
 *
 *  Geprüft wird die echte Datei in einer Sandbox (Mini-DOM + Fake-Shell)
 *  plus die zwei Verabredungen, auf denen die Brücke aufsitzt:
 *    • shell.js schaltet Frames über `hidden` um,
 *    • der Team-Builder registriert seine Einträge weiterhin.
 * ============================================================================= */

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ROOT = path.join(__dirname, '..');
const readRoot = (file) => fs.readFileSync(path.join(ROOT, file), 'utf8');

/* ─────────────────────────────────────────────────────────────────────────
 * Sandbox: so viel Browser wie auth-modal.js beim Registrieren anfasst.
 * Das Dropdown selbst wird nie gebaut (install() bleibt aussen vor), die
 * render*-Aufrufe steigen ohne Host-Element sofort wieder aus.
 * ───────────────────────────────────────────────────────────────────────── */
function loadAuthModal({ embedded = true, framed = true } = {}) {
  const shellEintraege = new Map();
  let shellRefreshes = 0;

  const shellModal = {
    devMenu: {
      register(item) { shellEintraege.set(String(item.id), item); return () => {}; },
      unregister(id) { shellEintraege.delete(String(id)); },
      refresh() { shellRefreshes += 1; },
      has(id) { return shellEintraege.has(String(id)); }
    },
    menu: {
      register(item) { shellEintraege.set(String(item.id), item); return () => {}; },
      unregister(id) { shellEintraege.delete(String(id)); },
      refresh() { shellRefreshes += 1; }
    }
  };

  // Frame-Element: die Shell schaltet daran `hidden` um.
  const frameElement = framed ? { hidden: true } : null;
  const observers = [];
  const windowListeners = new Map();

  const documentElementAttrs = embedded ? { 'data-dt-embedded': '' } : {};
  const document = {
    documentElement: {
      hasAttribute: (name) => Object.prototype.hasOwnProperty.call(documentElementAttrs, name),
      setAttribute: (name, value) => { documentElementAttrs[name] = value; },
      removeAttribute: (name) => { delete documentElementAttrs[name]; }
    },
    createElement: () => ({ style: {}, classList: { add() {}, remove() {}, toggle() {} },
                            setAttribute() {}, appendChild() {}, addEventListener() {} }),
    querySelector: () => null,
    addEventListener: () => {},
    body: { appendChild() {} }
  };

  const sandbox = {
    console: { log() {}, warn() {}, error() {} },
    setTimeout: () => 0,
    clearTimeout: () => {},
    setInterval: () => 0,
    clearInterval: () => {},
    MutationObserver: function (cb) {
      this.observe = (target, opts) => observers.push({ cb, target, opts });
      this.disconnect = () => {};
    },
    document
  };
  sandbox.window = sandbox;
  sandbox.frameElement = frameElement;
  sandbox.parent = framed ? { DreamTeamAuthModal: shellModal } : sandbox;
  sandbox.addEventListener = (type, fn) => {
    if (!windowListeners.has(type)) windowListeners.set(type, []);
    windowListeners.get(type).push(fn);
  };

  vm.createContext(sandbox);
  vm.runInContext(readRoot('auth-modal.js'), sandbox, { filename: 'auth-modal.js' });

  return {
    Modal: sandbox.window.DreamTeamAuthModal,
    shellIds: () => Array.from(shellEintraege.keys()).sort(),
    shellRefreshes: () => shellRefreshes,
    frameElement,
    /** Sichtbarkeit umschalten – wie shell.js beim Seitenwechsel. */
    setzeSichtbar(sichtbar) {
      frameElement.hidden = !sichtbar;
      observers.forEach((o) => { if (o.target === frameElement) o.cb([], null); });
    },
    feuere(type) { (windowListeners.get(type) || []).forEach((fn) => fn({})); },
    beobachteteAttribute: () => observers
      .filter((o) => o.target === frameElement)
      .flatMap((o) => (o.opts && o.opts.attributeFilter) || [])
  };
}

const EINTRAG = {
  id: 'team-testmode',
  group: 'Team-Einreichung',
  label: 'Testteams (mehrere)',
  value: () => 'aus',
  onSelect: () => {}
};

/* ── 1) Eingebettet: Eintrag wandert mit der Sichtbarkeit ───────────────── */
{
  const f = loadAuthModal();
  f.Modal.devMenu.register(EINTRAG);
  assert.deepEqual(f.shellIds(), [],
    'Ein Eintrag aus einem VERSTECKTEN Frame darf nicht in der Shell stehen.');

  f.setzeSichtbar(true);
  assert.deepEqual(f.shellIds(), ['team-testmode'],
    'Wird der Frame sichtbar, muss sein Eintrag in der Shell auftauchen.');

  f.setzeSichtbar(false);
  assert.deepEqual(f.shellIds(), [],
    'Wechselt die Shell die Seite, darf kein Eintrag des alten Frames stehenbleiben.');

  f.setzeSichtbar(true);
  assert.deepEqual(f.shellIds(), ['team-testmode'],
    'Ein warmer Frame muss beim Zurückkommen seinen Eintrag wieder mitbringen.');

  // Das Item wird unverändert weitergereicht: label/value/onSelect sind
  // Closures des Frames und sollen dort laufen, die Shell rendert nur.
  f.Modal.devMenu.register(Object.assign({}, EINTRAG, { value: () => 'an' }));
  assert.equal(f.shellIds().length, 1, 'Ein erneutes register() ersetzt den Eintrag, es dupliziert ihn nicht.');

  f.Modal.devMenu.unregister('team-testmode');
  assert.deepEqual(f.shellIds(), [],
    'unregister() im Frame muss den Eintrag auch aus der Shell nehmen.');
}

/* ── 2) refresh() erreicht die Shell ───────────────────────────────────── */
{
  const f = loadAuthModal();
  f.Modal.devMenu.register(EINTRAG);
  f.setzeSichtbar(true);
  const vorher = f.shellRefreshes();
  f.Modal.devMenu.refresh();
  assert.ok(f.shellRefreshes() > vorher,
    'devMenu.refresh() muss auch das Dropdown der Shell neu auswerten – sonst ' +
    'bleibt der Statustext („an"/„aus") dort stehen.');
}

/* ── 3) Seite verlässt den Frame ───────────────────────────────────────── */
{
  const f = loadAuthModal();
  f.Modal.devMenu.register(EINTRAG);
  f.setzeSichtbar(true);
  f.feuere('pagehide');
  assert.deepEqual(f.shellIds(), [],
    'Bei pagehide (Reload/interne Navigation) müssen die Einträge aus der Shell verschwinden.');
  f.feuere('pageshow');
  assert.deepEqual(f.shellIds(), ['team-testmode'],
    'Kommt die Seite aus dem bfcache zurück, muss der Eintrag wieder in der Shell stehen.');
}

/* ── 4) Nicht eingebettet: alles bleibt wie vorher ─────────────────────── */
{
  const direkt = loadAuthModal({ embedded: false });
  direkt.Modal.devMenu.register(EINTRAG);
  direkt.setzeSichtbar(true);
  assert.deepEqual(direkt.shellIds(), [],
    'Ohne data-dt-embedded gibt es keine Shell – dann darf nichts gespiegelt werden.');

  const ohneFrame = loadAuthModal({ framed: false });
  ohneFrame.Modal.devMenu.register(EINTRAG);
  assert.equal(ohneFrame.shellIds().length, 0,
    'Direkt aufgerufene Seiten (kein frameElement) registrieren nur bei sich selbst.');
}

/* ── 5) Beobachtet wird genau das Signal, das shell.js setzt ───────────── */
{
  const f = loadAuthModal();
  f.Modal.devMenu.register(EINTRAG);
  assert.deepEqual(f.beobachteteAttribute(), ['hidden'],
    'Die Brücke hängt am `hidden`-Attribut des Frames.');
}

/* ── 6) Verabredungen ausserhalb von auth-modal.js ─────────────────────── */
const SHELL = readRoot('shell.js');
assert.match(SHELL, /oldEl\.hidden\s*=\s*true/,
  'shell.js muss den alten Frame weiterhin über `hidden` ausblenden – daran ' +
  'erkennt die Brücke in auth-modal.js, dass ihre Einträge aus der Leiste gehören.');
assert.match(SHELL, /newEl\.hidden\s*=\s*false/,
  'shell.js muss `hidden` vom neuen Frame nehmen – das ist das Signal zum Spiegeln.');

const BUILDER = readRoot('team-builder.js');
['team-testmode', 'team-latesubmit'].forEach((id) => {
  assert.ok(BUILDER.includes(`id: '${id}'`),
    `team-builder.js muss den Dropdown-Eintrag "${id}" weiterhin registrieren.`);
});
assert.match(BUILDER, /initTestTeamModeToggle\(\);/,
  'initTestTeamModeToggle() muss in setupUI() aufgerufen werden.');

const APP_HTML = readRoot('app.html');
assert.match(APP_HTML, /auth-modal\.js/,
  'app.html (die Shell) muss auth-modal.js laden – sonst gibt es kein Ziel für die Brücke.');

console.log('✓ test-shell-menu-bridge: Dropdown-Einträge der Seiten erreichen die Leiste der App-Shell.');
