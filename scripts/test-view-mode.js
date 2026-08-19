'use strict';

/* =============================================================================
 *  test-view-mode.js
 *
 *  Guard für den App-weiten Ansichts-Umschalter (`view-mode.js`).
 *
 *  Der Modus „Vor Start / Nach Start / Auto“ entscheidet applikationsweit,
 *  ob die Kader sichtbar sind, ob die Einreichung offen ist und welche
 *  Startseiten-Sektion erscheint. Umstellen liess er sich früher nur auf
 *  index.html; jetzt registriert `view-mode.js` die Einträge zentral im
 *  Profil-Dropdown und jede Seite hängt sich an `DreamTeamViewMode.onChange`.
 *
 *  Geprüft wird das echte Modul in einer Sandbox (Mini-DOM + Fakes für
 *  APP_CONFIG / DreamTeamAdmin / DreamTeamAuthModal) plus die Verdrahtung
 *  in HTML, Service Worker und den Seiten-Skripten.
 * ============================================================================= */

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ROOT = path.join(__dirname, '..');
const readRoot = (file) => fs.readFileSync(path.join(ROOT, file), 'utf8');
const VIEW_MODE_SRC = readRoot('view-mode.js');

const HOUR = 60 * 60 * 1000;

/* ─────────────────────────────────────────────────────────────────────────
 * Sandbox: so viel Browser wie view-mode.js anfasst – nicht mehr.
 * ───────────────────────────────────────────────────────────────────────── */
function loadViewMode({ startMs, isAdmin = false, authResolved = true, stored = null }) {
  const storage = new Map();
  if (stored !== null) storage.set('dreamteamIndexViewMode', stored);

  const localStorage = {
    getItem: (k) => (storage.has(k) ? storage.get(k) : null),
    setItem: (k, v) => storage.set(k, String(v)),
    removeItem: (k) => storage.delete(k)
  };

  const dataset = {};
  const windowListeners = new Map();
  const dispatched = [];
  const timers = { intervals: 0, timeouts: 0 };

  const devItems = new Map();
  const devMenu = {
    register(item) { devItems.set(item.id, item); return () => devItems.delete(item.id); },
    unregister(id) { devItems.delete(id); },
    refresh() { devMenu.refreshCount += 1; },
    has(id) { return devItems.has(id); }
  };
  devMenu.refreshCount = 0;

  const adminListeners = [];
  const DreamTeamAdmin = {
    isAdmin: () => isAdmin,
    isAuthResolved: () => authResolved,
    isAuthReady: () => authResolved,
    getDevViewOverride() {
      // Spiegelt admin.js: Override gilt nur für angemeldete Admins.
      if (!isAdmin) return null;
      const value = localStorage.getItem('dreamteamIndexViewMode');
      return (value === 'pre' || value === 'post') ? value : null;
    },
    onAdminChange(cb) {
      adminListeners.push(cb);
      cb({ isAdmin, uid: isAdmin ? 'admin-uid' : null, authResolved });
      return () => {};
    }
  };

  /* Nachbau von APP_CONFIG.onReveal – inklusive des entscheidenden Details,
     dass der Callback SYNCHRON läuft, wenn der Anpfiff bereits zurückliegt. */
  function onReveal(callback) {
    if (typeof callback !== 'function') return () => {};
    const ms = startMs - Date.now();
    if (ms <= 0) { callback(); return () => {}; }
    timers.timeouts += 1;
    return () => {};
  }

  const APP_CONFIG = { DREAMTEAM_START: new Date(startMs), onReveal };

  const windowObj = {
    localStorage,
    APP_CONFIG,
    DreamTeamAdmin,
    DreamTeamAuthModal: { devMenu },
    addEventListener(type, cb) {
      if (!windowListeners.has(type)) windowListeners.set(type, []);
      windowListeners.get(type).push(cb);
    },
    dispatchEvent(event) { dispatched.push(event); return true; }
  };

  const sandbox = {
    window: windowObj,
    document: { documentElement: { dataset } },
    console,
    CustomEvent: function CustomEvent(type, init) {
      this.type = type;
      this.detail = init && init.detail;
    },
    setTimeout: () => { timers.timeouts += 1; return 0; },
    clearTimeout: () => {},
    setInterval: () => { timers.intervals += 1; return 0; },
    clearInterval: () => {}
  };
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(VIEW_MODE_SRC, sandbox);

  return {
    ViewMode: windowObj.DreamTeamViewMode,
    dataset,
    devItems,
    devMenu,
    dispatched,
    timers,
    storage,
    fireStorageEvent(key) {
      (windowListeners.get('storage') || []).forEach((cb) => cb({ key }));
    },
    fireAdminChange() {
      adminListeners.forEach((cb) => cb({ isAdmin, uid: isAdmin ? 'admin-uid' : null, authResolved }));
    }
  };
}

/* ── 1) Menüeinträge: drei Modi, Gruppe „Ansicht“ ───────────────────────── */
{
  const { devItems } = loadViewMode({ startMs: Date.now() + 48 * HOUR, isAdmin: true });

  assert.deepEqual(
    [...devItems.keys()].sort(),
    ['view-mode-auto', 'view-mode-post', 'view-mode-pre'],
    'view-mode.js muss genau einen Eintrag je Modus registrieren.'
  );

  devItems.forEach((item, id) => {
    assert.equal(item.group, 'Ansicht', `${id}: falsche Menügruppe.`);
    assert.equal(item.keepOpen, true, `${id}: Dropdown muss nach dem Klick offen bleiben.`);
    assert.equal(typeof item.onSelect, 'function', `${id}: onSelect fehlt.`);
  });

  assert.deepEqual(
    [...devItems.values()].map((i) => i.label),
    ['Auto', 'Vor Start', 'Nach Start'],
    'Beschriftung/Reihenfolge der Modi hat sich geändert.'
  );
}

/* ── 2) Admin: umstellen wirkt sofort und meldet den Wechsel ────────────── */
{
  const { ViewMode, dataset, devItems, dispatched } =
    loadViewMode({ startMs: Date.now() + 48 * HOUR, isAdmin: true });

  assert.equal(ViewMode.get(), 'auto', 'Ohne gespeicherten Wert gilt „auto“.');
  assert.equal(ViewMode.getEffective(), 'pre', 'Vor dem Anpfiff muss „auto“ auf „pre“ auflösen.');
  assert.equal(dataset.view, 'pre', '<html data-view> wird beim Boot gesetzt.');

  // Payloads stammen aus dem vm-Realm – als einfache Objekte übernehmen,
  // damit deepEqual nicht über fremde Prototypen stolpert.
  const seen = [];
  ViewMode.onChange((p) => seen.push({
    mode: p.mode, effective: p.effective, effectiveChanged: p.effectiveChanged
  }));

  // Klick auf „Nach Start“ – exakt der Weg über das Dropdown.
  devItems.get('view-mode-post').onSelect();

  assert.equal(ViewMode.get(), 'post');
  assert.equal(ViewMode.getEffective(), 'post', 'Der Admin-Override muss greifen.');
  assert.equal(ViewMode.isPost(), true);
  assert.equal(dataset.view, 'post', '<html data-view> muss dem neuen Modus folgen.');
  assert.equal(dataset.viewMode, 'post');
  assert.deepEqual(seen, [{ mode: 'post', effective: 'post', effectiveChanged: true }],
    'Seiten-Skripte müssen genau einmal über den Wechsel informiert werden.');
  assert.equal(dispatched.length, 1, 'Es muss zusätzlich ein Fenster-Event gefeuert werden.');
  assert.equal(dispatched[0].type, 'dreamteam:viewmode-change');

  // Aktiver Modus ist im Menü markiert und beschriftet.
  assert.equal(devItems.get('view-mode-post').accent(), 'active');
  assert.equal(devItems.get('view-mode-pre').accent(), null);
  assert.match(devItems.get('view-mode-post').value(), /aktiv/);
  assert.match(devItems.get('view-mode-auto').value(), /→ Vor Start/,
    '„Auto“ soll zeigen, worauf die Zeit gerade zeigt.');

  ViewMode.set('auto');
  assert.equal(ViewMode.getEffective(), 'pre', 'Zurück auf „auto“ → wieder zeitbasiert.');
  assert.equal(seen.length, 2);
  assert.equal(seen[1].effectiveChanged, true);
}

/* ── 3) „auto“ wird als Wert geschrieben, nicht gelöscht ────────────────── */
{
  // Das Inline-Skript im <head> von index.html unterscheidet „kein Key“ von
  // „explizit auto“: nur bei explizitem „auto“ ignoriert es den
  // sessionStorage-Cache eines früheren Overrides. Wird der Key stattdessen
  // entfernt, zeichnet der nächste Reload kurz die alte Sektion.
  const { ViewMode, storage } = loadViewMode({
    startMs: Date.now() + 48 * HOUR, isAdmin: true, stored: 'post'
  });
  ViewMode.set('auto');
  assert.equal(storage.get('dreamteamIndexViewMode'), 'auto',
    'Beim Zurückstellen auf „auto“ muss der Wert geschrieben und der Key behalten werden.');

  const head = readRoot('index.html');
  assert.match(head, /override !== 'auto'/,
    'index.html: Das Pre-Flight-Skript wertet „auto“ nicht mehr aus – Annahme oben prüfen.');
}

/* ── 4) Nicht-Admins bekommen keinen Override ───────────────────────────── */
{
  const { ViewMode, dataset } = loadViewMode({
    startMs: Date.now() + 48 * HOUR, isAdmin: false, stored: 'post'
  });
  assert.equal(ViewMode.getEffective(), 'pre',
    'Ein manipulierter localStorage-Wert darf bei normalen Nutzern nicht wirken.');
  assert.equal(dataset.view, 'pre');
  assert.equal(ViewMode.isOverrideActive(), false);
}

/* ── 5) Auth noch nicht aufgelöst: Override hält (Flicker-Schutz) ───────── */
{
  const { ViewMode } = loadViewMode({
    startMs: Date.now() + 48 * HOUR, isAdmin: false, authResolved: false, stored: 'post'
  });
  assert.equal(ViewMode.getEffective(), 'post',
    'Solange der Admin-Status noch offen ist, hält ein gespeicherter Override – sonst flackert die Seite.');
}

/* ── 6) Nach dem Anpfiff: keine Endlos-Rekursion ────────────────────────── */
{
  // APP_CONFIG.onReveal ruft seinen Callback SYNCHRON auf, wenn der Anpfiff
  // vorbei ist. Ohne Schranke in scheduleAutoReveal() würde
  // refresh() → scheduleAutoReveal() → onReveal() → refresh() endlos laufen
  // und jede Seite nach Turnierstart mit einem Stack-Overflow sterben.
  const { ViewMode, dataset, timers } = loadViewMode({ startMs: Date.now() - HOUR });
  assert.equal(ViewMode.getEffective(), 'post', 'Nach dem Anpfiff gilt „post“.');
  assert.equal(dataset.view, 'post');
  assert.equal(timers.timeouts, 0,
    'Liegt der Anpfiff zurück, darf kein Reveal-Timer mehr geplant werden.');
}

/* ── 7) Zweiter Tab: storage-Event zieht nach ───────────────────────────── */
{
  const h = loadViewMode({ startMs: Date.now() + 48 * HOUR, isAdmin: true });
  const seen = [];
  h.ViewMode.onChange((p) => seen.push(p));

  h.storage.set('dreamteamIndexViewMode', 'post');   // anderer Tab schreibt
  h.fireStorageEvent('dreamteamIndexViewMode');
  assert.equal(h.dataset.view, 'post', 'Ein Moduswechsel in einem anderen Tab muss hier ankommen.');
  assert.equal(seen.length, 1);

  h.fireStorageEvent('irgendein_anderer_key');
  assert.equal(seen.length, 1, 'Fremde storage-Keys dürfen nichts auslösen.');
}

/* ── 8) Admin-Wechsel ohne Moduswechsel meldet nichts ───────────────────── */
{
  // Die Seiten-Skripte hängen für Login/Logout ohnehin selbst an
  // DreamTeamAdmin.onAdminChange. Würde dieses Modul dieselbe Änderung
  // zusätzlich melden, rendern Rangliste & Co. jedes Mal doppelt.
  const h = loadViewMode({ startMs: Date.now() + 48 * HOUR, isAdmin: true });
  const seen = [];
  h.ViewMode.onChange(() => seen.push(1));

  h.fireAdminChange();
  assert.equal(seen.length, 0,
    'Ein Admin-Wechsel ohne Moduswechsel darf keine zusätzliche Benachrichtigung auslösen.');

  // Ein echter Moduswechsel meldet dagegen weiterhin.
  h.ViewMode.set('post');
  assert.equal(seen.length, 1);
}

/* ── 9) Verdrahtung: der Schalter liegt auf JEDER Seite ─────────────────── */
{
  const PAGES = ['index.html', 'teams.html', 'rangliste.html', 'team-builder.html',
                 'spieleranalyse.html', 'punktesystem.html', 'liga-tabelle.html'];

  PAGES.forEach((page) => {
    const html = readRoot(page);
    const viewIdx = html.indexOf('<script src="view-mode.js">');
    const modalIdx = html.indexOf('auth-modal.js"></script>');
    assert.ok(viewIdx > -1, `${page}: view-mode.js wird nicht geladen – dort fehlt der Umschalter.`);
    assert.ok(modalIdx > -1 && viewIdx > modalIdx,
      `${page}: view-mode.js muss nach auth-modal.js stehen (devMenu wird dort definiert).`);
  });

  assert.match(readRoot('service-worker.js'), /'\.\/view-mode\.js'/,
    'service-worker.js: view-mode.js fehlt in APP_SHELL – offline gäbe es den Umschalter nicht.');
}

/* ── 10) Verdrahtung: die Seiten reagieren ohne Reload ──────────────────── */
{
  const CONSUMERS = ['index.js', 'teams.js', 'rangliste.js', 'spieleranalyse.js', 'team-builder.js'];
  CONSUMERS.forEach((file) => {
    assert.match(readRoot(file), /DreamTeamViewMode[\s\S]{0,400}?onChange/,
      `${file}: hängt sich nicht an DreamTeamViewMode.onChange – ein Moduswechsel bliebe dort unsichtbar.`);
  });

  // Die Startseite darf den Eintrag nicht mehr zusätzlich selbst registrieren,
  // sonst stünde er doppelt im Dropdown.
  assert.ok(!/index-view-mode/.test(readRoot('index.js')),
    'index.js registriert wieder einen eigenen Ansichts-Eintrag – der Umschalter stünde doppelt im Menü.');

  // auth-modal.js muss `accent` als Funktion auswerten, sonst bliebe die
  // aktive Zeile im Menü unmarkiert (bzw. bekäme eine kaputte CSS-Klasse).
  assert.match(readRoot('auth-modal.js'), /resolveDevValue\(item\.accent, item\)/,
    'auth-modal.js: `accent` wird nicht mehr über resolveDevValue aufgelöst.');
}

console.log('test-view-mode.js: alle Checks bestanden.');
