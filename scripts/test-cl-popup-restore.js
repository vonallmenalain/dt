'use strict';

/* =============================================================================
 *  test-cl-popup-restore.js
 *
 *  Regressionstest für den Zurück-Button auf der CL-Startseite
 *  (index.js, Namespace `clpop-`):
 *
 *  Aus einer offenen Detailkarte („Top Manager", „Aktuelle Spiele") führen
 *  Links WEG von der Startseite – Spieler und Klub-Badge in die Analyse, der
 *  Manager-Name zu „Teams", der Rang zur Rangliste. Damit „Zurück" nicht auf
 *  einer index.html mit geschlossener Karte landet, trägt die offene Karte
 *  einen Marker in der eigenen URL (`index.html#pop=<typ>:<schlüssel>`) und
 *  die Scrollposition dahinter in `history.state`.
 *
 *  Geprüft wird:
 *   1) Marker schreiben/lesen/entfernen – inklusive Schlüsseln mit
 *      Leerzeichen, Umlauten und Doppelpunkt (Spiel-Keys sehen aus wie
 *      „id:12345"; ohne Kodierung bräche das Parsen am ersten Trenner).
 *   2) Wiederherstellung: Der Marker wartet auf seine Kachel, öffnet die
 *      Karte GENAU einmal und reicht die gemerkte Scrollposition weiter.
 *      Ist bereits eine Karte offen (bfcache) oder das Zeitfenster
 *      abgelaufen, passiert nichts mehr.
 *   3) Scroll-Lock: Die gemerkte Position gewinnt gegen das frisch geladene
 *      Dokument (dort ist window.scrollY 0) – sonst stünde die Seite nach
 *      dem Schliessen der Karte am Anfang.
 *   4) Verdrahtung: clpopOpen schreibt den Marker, clpopClose entfernt ihn,
 *      beide Bereiche melden ihre Wiederherstellung an und der Render der
 *      Startseite ruft clpopTryRestore().
 *
 *  Läuft ohne Browser: die Logik wird als Quelltext aus index.js geschnitten
 *  und hier mit Stubs ausgeführt – geprüft wird also der ausgelieferte Code,
 *  nicht eine Kopie davon.
 * ============================================================================= */

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const indexJs = fs.readFileSync(path.join(ROOT, 'index.js'), 'utf8');

/* ── Quelltext-Schnipsel aus index.js holen ────────────────────────────── */
function sliceBetween(source, startMarker, endMarker) {
  const start = source.indexOf(startMarker);
  assert.notEqual(start, -1, `index.js: Marker „${startMarker}" nicht gefunden.`);
  const end = source.indexOf(endMarker, start + startMarker.length);
  assert.notEqual(end, -1, `index.js: Marker „${endMarker}" nicht gefunden.`);
  return source.slice(start, end);
}

function sliceFunction(source, name) {
  const start = source.indexOf(`function ${name}(`);
  assert.notEqual(start, -1, `index.js: Funktion ${name} nicht gefunden.`);
  let depth = 0;
  for (let i = source.indexOf('{', start); i < source.length; i += 1) {
    if (source[i] === '{') depth += 1;
    else if (source[i] === '}') {
      depth -= 1;
      if (depth === 0) return source.slice(start, i + 1);
    }
  }
  throw new Error(`index.js: Funktion ${name} ist nicht geschlossen.`);
}

// Marker-Konstanten, Helfer und das einmalige Lesen beim Laden.
const controllerSrc = sliceBetween(indexJs,
  "const CLPOP_HASH_PREFIX = '#pop=';",
  'function clpopPrefersReducedMotion');

/* ── Mini-Umgebung: location + history wie im Browser ──────────────────── */
function makeEnv(href, state = null, nowMs = 1_000_000) {
  const url = new URL(href);
  const location = {
    get pathname() { return url.pathname; },
    get search() { return url.search; },
    get hash() { return url.hash; }
  };
  const history = {
    state,
    replaceState(nextState, _title, nextHref) {
      const next = new URL(nextHref, url);
      assert.equal(next.origin, url.origin, 'clpop darf die Seite nicht wechseln, nur den Marker setzen.');
      url.pathname = next.pathname;
      url.search = next.search;
      url.hash = next.hash;
      this.state = nextState;
    }
  };
  const clock = { now: nowMs };
  const DateStub = { now: () => clock.now };
  // eslint-disable-next-line no-new-func
  const make = new Function('location', 'history', 'Date', `
    'use strict';
    let clpopOpenKey = null;
    let clpopClosing = false;
    ${controllerSrc}
    return {
      parseMarker: clpopParseMarker,
      markerHref: clpopMarkerHref,
      save: clpopSaveMarker,
      drop: clpopDropMarker,
      register: clpopRegisterRestore,
      tryRestore: clpopTryRestore,
      target: () => clpopRestoreTarget,
      setOpenKey: (key) => { clpopOpenKey = key; },
      setClosing: (value) => { clpopClosing = value; }
    };
  `);
  return { api: make(location, history, DateStub), url, history, clock };
}

/* ── 1) Marker schreiben, lesen, entfernen ─────────────────────────────── */
{
  const { api, url, history } = makeEnv('https://dt.alae.app/index.html?tournament=cl2627');

  api.save({ type: 'tm', key: 'Alain von Allmen' }, 640);
  assert.equal(url.search, '?tournament=cl2627',
    'Der Marker darf die Query der Seite nicht anfassen (die Shell baut daraus ihre Route).');
  assert.equal(url.hash, '#pop=tm:Alain%20von%20Allmen',
    'Die offene Manager-Karte muss als Fragment in der URL stehen.');
  assert.deepEqual(history.state.clpop, { type: 'tm', key: 'Alain von Allmen', scrollY: 640 },
    'Scrollposition und Schlüssel müssen im History-Eintrag mitreisen.');

  assert.deepEqual(api.parseMarker(url.hash), { type: 'tm', key: 'Alain von Allmen' },
    'Der geschriebene Marker muss sich unverändert zurücklesen lassen.');

  // Spiel-Keys enthalten selbst einen Doppelpunkt – der Trenner ist der
  // ERSTE, deshalb muss der Schlüssel kodiert sein.
  const gameHref = api.markerHref('cm', 'id:12345');
  assert.ok(gameHref.endsWith('#pop=cm:id%3A12345'),
    `Spiel-Schlüssel müssen kodiert werden, sonst zerfällt der Marker: ${gameHref}`);
  assert.deepEqual(api.parseMarker('#pop=cm:id%3A12345'), { type: 'cm', key: 'id:12345' },
    'Ein Spiel-Schlüssel mit Doppelpunkt muss vollständig zurückkommen.');

  // Umlaute (Managernamen) überstehen die Kodierung.
  const umlautHash = '#' + api.markerHref('tm', 'Jürg Müller').split('#')[1];
  assert.deepEqual(api.parseMarker(umlautHash), { type: 'tm', key: 'Jürg Müller' },
    'Umlaute im Managernamen müssen den Marker unbeschadet überstehen.');

  // Fremde/kaputte Fragmente dürfen nichts auslösen.
  assert.equal(api.parseMarker(''), null, 'Ohne Fragment gibt es nichts wiederherzustellen.');
  assert.equal(api.parseMarker('#/index.html'), null, 'Eine Shell-Route ist kein Karten-Marker.');
  assert.equal(api.parseMarker('#pop=tm'), null, 'Ein Marker ohne Trenner darf nicht greifen.');
  assert.equal(api.parseMarker('#pop=:x'), null, 'Ein Marker ohne Typ darf nicht greifen.');
  assert.equal(api.parseMarker('#pop=tm:%E0%A4%A'), null, 'Ein kaputt kodierter Marker darf nicht werfen.');

  // Schliessen räumt Fragment UND History-State auf, ohne fremde Felder zu verlieren.
  history.state = { ...history.state, fremd: 'bleibt' };
  api.drop();
  assert.equal(url.hash, '', 'Nach dem Schliessen darf kein Marker in der URL stehen bleiben.');
  assert.equal(url.search, '?tournament=cl2627', 'Das Aufräumen darf die Query nicht wegwerfen.');
  assert.deepEqual(history.state, { fremd: 'bleibt' },
    'Beim Aufräumen darf nur der clpop-Eintrag verschwinden.');
}

/* ── 2) Wiederherstellung nach dem Zurück ──────────────────────────────── */
{
  const marked = 'https://dt.alae.app/index.html#pop=tm:Alain%20von%20Allmen';
  const state = { clpop: { type: 'tm', key: 'Alain von Allmen', scrollY: 640 } };

  // a) Kachel ist noch nicht da → Marker wartet und wird beim nächsten Render eingelöst.
  {
    const { api, url } = makeEnv(marked, state);
    const calls = [];
    let ready = false;
    api.register('tm', (key, opts) => {
      calls.push({ key, opts });
      return ready;   // erst der zweite Versuch findet die Kachel
    });

    api.tryRestore();
    assert.equal(calls.length, 1, 'Der erste Render muss einen Versuch machen.');
    assert.ok(api.target(), 'Ohne Kachel muss der Marker für den nächsten Render stehen bleiben.');
    assert.equal(url.hash, '#pop=tm:Alain%20von%20Allmen', 'Ein wartender Marker darf nicht verschwinden.');

    ready = true;
    api.tryRestore();
    assert.equal(calls.length, 2, 'Sobald die Kachel steht, muss die Karte aufgehen.');
    assert.deepEqual(calls[1], { key: 'Alain von Allmen', opts: { restore: true, scrollY: 640 } },
      'Die Wiederherstellung bekommt Schlüssel und gemerkte Scrollposition.');

    api.tryRestore();
    assert.equal(calls.length, 2, 'Eine wiederhergestellte Karte darf beim nächsten Render nicht erneut aufspringen.');
  }

  // b) Ohne History-State (Browser hat ihn verworfen) öffnet die Karte trotzdem – Scroll 0.
  {
    const { api } = makeEnv(marked, null);
    const calls = [];
    api.register('tm', (key, opts) => { calls.push(opts); return true; });
    api.tryRestore();
    assert.deepEqual(calls, [{ restore: true, scrollY: 0 }],
      'Fehlt der History-State, muss die Karte trotzdem aufgehen (nur ohne Scroll-Erinnerung).');
  }

  // c) Karte schon offen (bfcache): kein zweiter Aufbau.
  {
    const { api } = makeEnv(marked, state);
    let called = 0;
    api.register('tm', () => { called += 1; return true; });
    api.setOpenKey('Alain von Allmen');
    api.tryRestore();
    assert.equal(called, 0, 'Ist die Karte noch offen, darf sie nicht ein zweites Mal aufgebaut werden.');
    assert.equal(api.target(), null, 'Der Marker gilt dann als erledigt.');
  }

  // d) Zeitfenster abgelaufen: die Karte springt nicht mehr auf, der Marker verschwindet.
  {
    const { api, url, clock } = makeEnv(marked, state);
    let called = 0;
    api.register('tm', () => { called += 1; return true; });
    clock.now += 20_001;
    api.tryRestore();
    assert.equal(called, 0, 'Nach dem Zeitfenster darf keine Karte mehr unvermittelt aufspringen.');
    assert.equal(url.hash, '', 'Ein abgelaufener Marker muss aus der URL verschwinden.');
  }

  // e) Unbekannter Typ (alter Link, neue Version): sauber ignorieren.
  {
    const { api, url } = makeEnv('https://dt.alae.app/index.html#pop=xx:1', null);
    api.register('tm', () => true);
    api.tryRestore();
    assert.equal(url.hash, '', 'Ein Marker ohne zuständigen Bereich muss verschwinden statt zu warten.');
  }

  // f) Ohne Marker passiert gar nichts.
  {
    const { api } = makeEnv('https://dt.alae.app/index.html', null);
    let called = 0;
    api.register('tm', () => { called += 1; return true; });
    api.tryRestore();
    assert.equal(called, 0, 'Ohne Marker darf beim Laden keine Karte aufgehen.');
  }
}

/* ── 3) Scroll-Lock nimmt die gemerkte Position ────────────────────────── */
{
  const lockSrc = sliceFunction(indexJs, 'clpopLockBody');
  // eslint-disable-next-line no-new-func
  const makeLock = new Function('document', 'window', `
    'use strict';
    let clpopLockScrollY = 0;
    ${lockSrc}
    return { lock: clpopLockBody, scrollY: () => clpopLockScrollY };
  `);

  const makeDoc = () => {
    const classes = new Set();
    return {
      body: {
        style: {},
        classList: {
          contains: (c) => classes.has(c),
          add: (c) => classes.add(c),
          remove: (c) => classes.delete(c)
        }
      }
    };
  };

  // Frisch geladenes Dokument nach dem Zurück: window.scrollY ist 0, gemeint
  // ist die Position von vorher.
  const restored = makeDoc();
  const restoredLock = makeLock(restored, { scrollY: 0 });
  restoredLock.lock(640);
  assert.equal(restored.body.style.top, '-640px',
    'Beim Wiederherstellen muss die gemerkte Scrollposition den Lock bestimmen.');
  assert.equal(restoredLock.scrollY(), 640,
    'Nach dem Schliessen muss die Seite auf die gemerkte Position zurückspringen.');

  // Normaler Klick: es zählt weiterhin die echte Scrollposition.
  const fresh = makeDoc();
  const freshLock = makeLock(fresh, { scrollY: 210 });
  freshLock.lock(undefined);
  assert.equal(fresh.body.style.top, '-210px',
    'Ohne gemerkte Position muss der Lock die aktuelle Scrollposition nehmen.');
}

/* ── 4) Verdrahtung im ausgelieferten Code ─────────────────────────────── */
{
  const openSrc = sliceFunction(indexJs, 'clpopOpen');
  assert.match(openSrc, /clpopSaveMarker\(cfg\.marker, clpopLockScrollY\)/,
    'index.js: clpopOpen schreibt den Marker nicht mehr – „Zurück" verliert die offene Karte.');
  assert.match(openSrc, /clpopLockBody\(restore \?/,
    'index.js: clpopOpen reicht die gemerkte Scrollposition nicht mehr an den Lock weiter.');

  const closeSrc = sliceFunction(indexJs, 'clpopClose');
  assert.match(closeSrc, /clpopDropMarker\(\)/,
    'index.js: clpopClose räumt den Marker nicht mehr weg – ein Reload risse die Karte wieder auf.');

  const cltmOpenSrc = sliceFunction(indexJs, 'cltmOpen');
  assert.match(cltmOpenSrc, /marker: \{ type: 'tm', key: manager\.manager \|\| '' \}/,
    'index.js: Die Manager-Karte meldet keinen Marker mehr an.');
  assert.match(cltmOpenSrc, /\}, tileEl, opts\);/,
    'index.js: cltmOpen reicht die Restore-Optionen nicht mehr durch.');

  const clcmOpenSrc = sliceFunction(indexJs, 'clcmOpen');
  assert.match(clcmOpenSrc, /marker: \{ type: 'cm', key: entry\.key \}/,
    'index.js: Die Spiel-Karte meldet keinen Marker mehr an.');
  assert.match(clcmOpenSrc, /\}, tileEl, opts\);/,
    'index.js: clcmOpen reicht die Restore-Optionen nicht mehr durch.');

  assert.match(indexJs, /clpopRegisterRestore\('tm',/,
    'index.js: Für „Top Manager" ist keine Wiederherstellung angemeldet.');
  assert.match(indexJs, /clpopRegisterRestore\('cm',/,
    'index.js: Für „Aktuelle Spiele" ist keine Wiederherstellung angemeldet.');

  // Die Bühne hinter der Karte muss in der Ansicht stehen, aus der die
  // Kachel angeklickt wurde – sonst wächst die Karte aus dem Nichts.
  const tmRestoreSrc = sliceBetween(indexJs, "clpopRegisterRestore('tm',", '\n    });');
  assert.match(tmRestoreSrc, /cltmSetView\('alle'\)/,
    'index.js: Eine Kachel hinter „Top" schaltet die Bühne nicht mehr auf „Alle".');
  const cmRestoreSrc = sliceBetween(indexJs, "clpopRegisterRestore('cm',", '\n    });');
  assert.match(cmRestoreSrc, /clcmSetView\(entry\.group\)/,
    'index.js: Ein Spiel aus einer anderen Ansicht schaltet die Bühne nicht mehr um.');

  const renderSrc = sliceFunction(indexJs, 'renderPostStartHome');
  assert.match(renderSrc, /clpopTryRestore\(\);/,
    'index.js: renderPostStartHome versucht die Wiederherstellung nicht mehr – der Marker bliebe wirkungslos.');
}

console.log('test-cl-popup-restore.js: alle Checks bestanden.');
