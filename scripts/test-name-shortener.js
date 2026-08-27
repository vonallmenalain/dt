'use strict';

/* =============================================================================
 *  test-name-shortener.js
 *
 *  Guard für die Namenslogik (name-shortener.js), die an zwei Stellen greift:
 *
 *    - im Generator (scripts/generate-kader.js → buildDisplayName) mit den
 *      API-Feldern name/firstname/lastname,
 *    - im Browser (data.js → shortenPlayerName) allein auf dem fertigen
 *      Anzeigenamen der Kaderdateien.
 *
 *  Geprüft wird beides an Beispielen UND – wichtiger – an den echten
 *  Kaderdateien: nach Kürzung + name-overrides.js darf KEIN Spieler mehr
 *  drei Wörter im Namen tragen, ausser er hat einen erlaubten Grund
 *  (Nachnamens-Partikel wie "van Dijk", vorangestellter Artikel wie
 *  "El Chadaille", abgekürztes Profil wie "A. Le Borgne" oder einen
 *  ausdrücklichen Override wie "Randal Kolo Muani").
 * ============================================================================= */

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const APP = require('../tournament-config.js');
const { shortenPlayerName, buildDisplayName, surnameFromLastName } = require('../name-shortener.js');
const { playerDisplayName } = require('./generate-kader.js');

function words(name) {
  return String(name || '').trim().split(/\s+/).filter(Boolean);
}

/* ── 1) Browser-Pfad: kürzen allein aus dem Anzeigenamen ─────────────────── */
(function testShorten() {
  // Die vom Anwender gemeldeten Fälle (Ist → Soll).
  const cases = {
    'Aurélien Djani Tchouaméni': 'Aurélien Tchouaméni',
    'Ryan Jiro Gravenberch': 'Ryan Gravenberch',
    'Joshua Walter Kimmich': 'Joshua Kimmich',
    'Manuel Obafemi Akanji': 'Manuel Akanji',
    'Scott Francis McTominay': 'Scott McTominay',
    'Florian Richard Wirtz': 'Florian Wirtz',
    'Jules Olivier Koundé': 'Jules Koundé',
    'Cody Mathès Gakpo': 'Cody Gakpo',
    'Nico Cedric Schlotterbeck': 'Nico Schlotterbeck',
    'Felix Kalu Nmecha': 'Felix Nmecha',
    // Auch vier und mehr Wörter landen bei zwei.
    'Vinícius José Paixão de Oliveira Júnior': 'Vinícius Júnior',
    // Partikel-Nachname bleibt ganz, der Zweitvorname davor fällt weg.
    'Mohamed Amine Ben Hmida': 'Mohamed Ben Hmida',
    'Jan Paul Van Hecke': 'Jan Van Hecke',
    // Mehrfache Leerzeichen und HTML-Entitäten aus der API.
    'Elias  Benkara': 'Elias Benkara',
    'Nico O&apos;Reilly': "Nico O'Reilly"
  };
  Object.keys(cases).forEach((input) => {
    assert.equal(shortenPlayerName(input), cases[input]);
  });

  // Unverändert: Nachnamens-Partikel, Bindestrich-Namen, vorangestellte
  // Artikel im Vornamen, abgekürzte Profile, schon kurze Namen.
  const unchanged = [
    'Alexis Mac Allister',
    'Vanja Milinković-Savić',
    'Virgil van Dijk',
    'Frenkie de Jong',
    'Marc-André ter Stegen',
    'Kevin De Bruyne',
    'Giovani Lo Celso',
    'Raffaele Di Gennaro',
    'Mattia Della Rocca',
    'Argus Vanden Driessche',
    'Ameen Al Dakhil',
    'Bilal El Khannouss',
    'Robin Le Normand',
    'Lucas da Cunha',
    'Micky Van de Ven',
    'Nicolas De La Cruz',
    'El Chadaille Bitshiabu',
    'A. Le Borgne',
    'T. van der Leij',
    'M. E. Suleiman',
    'Trent Alexander-Arnold',
    'Lamine Yamal',
    'Rodri'
  ];
  unchanged.forEach((name) => {
    assert.equal(shortenPlayerName(name), name, `"${name}" darf nicht verändert werden.`);
  });

  // Leerwerte bleiben leer statt "undefined" anzuzeigen.
  assert.equal(shortenPlayerName(''), '');
  assert.equal(shortenPlayerName(null), '');
  assert.equal(shortenPlayerName(undefined), '');

  console.log('ok - shortenPlayerName kürzt Mittelnamen und lässt Partikel stehen');
})();

/* ── 2) Nachname aus dem API-Feld `lastname` ─────────────────────────────── */
(function testSurname() {
  // Spanischer Muttername fällt weg …
  assert.equal(surnameFromLastName('Cubarsí Paredes'), 'Cubarsí');
  assert.equal(surnameFromLastName('Yamal Nasraoui Ebana'), 'Yamal');
  assert.equal(surnameFromLastName('Hernández Cascante'), 'Hernández');
  // … zusammengesetzte Nachnamen bleiben ganz.
  assert.equal(surnameFromLastName('Mac Allister'), 'Mac Allister');
  assert.equal(surnameFromLastName('van Dijk'), 'van Dijk');
  assert.equal(surnameFromLastName('ter Stegen'), 'ter Stegen');
  assert.equal(surnameFromLastName('van der Leij'), 'van der Leij');
  console.log('ok - surnameFromLastName schneidet den Mutternamen ab, nicht den Vaternamen');
})();

/* ── 3) Generator-Pfad: name/firstname/lastname ──────────────────────────── */
(function testBuildDisplayName() {
  // Der Generator benutzt genau diese Funktion.
  assert.equal(
    playerDisplayName({ name: 'A. Tchouaméni', firstname: 'Aurélien Djani', lastname: 'Tchouaméni' }),
    buildDisplayName({ name: 'A. Tchouaméni', firstname: 'Aurélien Djani', lastname: 'Tchouaméni' })
  );

  // Kurzer, gebräuchlicher `name` gewinnt (≤ 2 Wörter, keine Initiale).
  assert.equal(
    buildDisplayName({ name: 'Dayot Upamecano', firstname: 'Dayotchanculle Oswald', lastname: 'Upamecano' }),
    'Dayot Upamecano'
  );
  assert.equal(
    buildDisplayName({ name: 'Lamine Yamal', firstname: 'Lamine', lastname: 'Yamal Nasraoui Ebana' }),
    'Lamine Yamal'
  );
  assert.equal(buildDisplayName({ name: 'Rodri', firstname: 'Rodrigo', lastname: 'Hernández Cascante' }), 'Rodri');

  // Abgekürzter `name`: die Initiale bestimmt, WELCHER Vorname gemeint ist.
  // Genau daran scheiterte die alte Logik ("Damián Emiliano Martínez").
  assert.equal(
    buildDisplayName({ name: 'E. Martínez', firstname: 'Damián Emiliano', lastname: 'Martínez' }),
    'Emiliano Martínez'
  );
  assert.equal(
    buildDisplayName({ name: 'A. Tchouaméni', firstname: 'Aurélien Djani', lastname: 'Tchouaméni' }),
    'Aurélien Tchouaméni'
  );
  assert.equal(
    buildDisplayName({ name: 'J. Kimmich', firstname: 'Joshua Walter', lastname: 'Kimmich' }),
    'Joshua Kimmich'
  );
  // Der Muttername kommt gar nicht mehr in den Anzeigenamen …
  assert.equal(
    buildDisplayName({ name: 'P. Cubarsí Paredes', firstname: 'Pau', lastname: 'Cubarsí Paredes' }),
    'Pau Cubarsí'
  );
  // … auch dann nicht, wenn der Kurzname ihn mitschleppt.
  assert.equal(
    buildDisplayName({ name: 'Pau Cubarsí Paredes', firstname: 'Pau', lastname: 'Cubarsí Paredes' }),
    'Pau Cubarsí'
  );
  // Mittelnamen im lastname-Feld: der Kurzname nennt den richtigen
  // Nachnamen. Alle Fälle stammen aus dem Diagnoselauf gegen die API –
  // vorher standen sie als "Erling Braut", "Henrikh Hamlet" usw. im Pool,
  // weil vom lastname-Feld das ERSTE Wort genommen wurde (Mutternamen-Regel).
  const middleNames = [
    [{ name: 'E. Haaland', firstname: 'Erling', lastname: 'Braut Haaland' }, 'Erling Haaland'],
    [{ name: 'H. Mkhitaryan', firstname: 'Henrikh', lastname: 'Hamlet Mkhitaryan' }, 'Henrikh Mkhitaryan'],
    [{ name: 'A. Christensen', firstname: 'Andreas', lastname: 'Bødtker Christensen' }, 'Andreas Christensen'],
    [{ name: 'C. Nørgaard', firstname: 'Christian', lastname: 'Thers Nørgaard' }, 'Christian Nørgaard'],
    [{ name: 'W. Anton', firstname: 'Waldemar', lastname: 'Riptsov Anton' }, 'Waldemar Anton'],
    [{ name: 'T. Setford', firstname: 'Tommy', lastname: 'Hogan Setford' }, 'Tommy Setford'],
    // Auch zwei Mittelnamen.
    [{ name: 'M. Hjulmand', firstname: 'Morten', lastname: 'Blom Due Hjulmand' }, 'Morten Hjulmand'],
    [{ name: 'D. Mukasa', firstname: 'Divine', lastname: 'Tayon Mahogany Mukasa' }, 'Divine Mukasa']
  ];
  middleNames.forEach(([player, want]) => {
    assert.equal(buildDisplayName(player), want,
      `${player.name} / ${player.lastname} muss "${want}" ergeben.`);
  });

  // Zusammengesetzte Nachnamen bleiben dreiteilig.
  assert.equal(
    buildDisplayName({ name: 'A. Mac Allister', firstname: 'Alexis', lastname: 'Mac Allister' }),
    'Alexis Mac Allister'
  );
  // Partikel-Nachname aus dem abgekürzten Kurznamen – nicht nach dem ersten
  // Wort abschneiden.
  assert.equal(
    buildDisplayName({ name: 'T. van der Leij', firstname: 'Thom', lastname: 'van der Leij' }),
    'Thom van der Leij'
  );
  assert.equal(
    buildDisplayName({ name: 'M. ter Stegen', firstname: 'Marc-André', lastname: 'ter Stegen' }),
    'Marc-André ter Stegen'
  );
  // Ohne Stammdaten (Kaderabruf ohne Profil) bleibt der abgekürzte Name.
  assert.equal(buildDisplayName({ name: 'A. Le Borgne', firstname: '', lastname: '' }), 'A. Le Borgne');
  // Fehlt `lastname`, steckt der Nachname noch im Kurznamen.
  assert.equal(buildDisplayName({ name: 'A. Hakimi', firstname: 'Achraf', lastname: '' }), 'Achraf Hakimi');
  // Fehlt `name`, tragen firstname/lastname allein.
  assert.equal(buildDisplayName({ name: '', firstname: 'Max', lastname: 'Muster' }), 'Max Muster');
  console.log('ok - buildDisplayName trifft Rufnamen per Initiale und kürzt Doppelnachnamen');
})();

/* ── 4) Verdrahtung: Flag pro Turnier, data.js, Service Worker ───────────── */
(function testWiring() {
  assert.equal(APP.tournaments.cl2627.shortenPlayerNames, true,
    'cl2627 muss die Namens-Kürzung eingeschaltet haben.');
  assert.equal(APP.tournaments.cl2526.shortenPlayerNames, true,
    'cl2526 (Testkanal) muss dieselben Namen zeigen wie 26/27.');
  assert.notEqual(APP.tournaments.wm2026.shortenPlayerNames, true,
    'Die WM ist eingefroren – dort darf die Kürzung nicht greifen.');

  const dataJs = fs.readFileSync(path.join(__dirname, '..', 'data.js'), 'utf8');
  assert.match(dataJs, /name-shortener\.js/, 'data.js muss name-shortener.js laden.');
  assert.match(dataJs, /shortenPlayerNames/, 'data.js muss das Turnier-Flag auswerten.');
  assert.match(dataJs, /__NAME_SHORTENING_APPLIED__/,
    'Die Kürzung soll ihr Ergebnis für die Fehlersuche exponieren.');
  // Reihenfolge: erst kürzen, dann Overrides – sonst würden handgepflegte
  // Namen wie "Randal Kolo Muani" nachträglich wieder gekürzt.
  assert.ok(
    dataJs.indexOf('__NAME_SHORTENING_APPLIED__') < dataJs.indexOf('__NAME_OVERRIDES_APPLIED__'),
    'Die Namens-Kürzung muss VOR den Namens-Overrides laufen.'
  );

  const sw = fs.readFileSync(path.join(__dirname, '..', 'service-worker.js'), 'utf8');
  assert.match(sw, /'\.\/name-shortener\.js'/,
    'name-shortener.js muss im Service-Worker-Cache stehen, sonst fehlt sie offline.');
  console.log('ok - Flag, data.js-Reihenfolge und Service-Worker-Cache sind verdrahtet');
})();

/* ── 4b) Ende-zu-Ende: data.js wirklich ausführen ────────────────────────── */
/* Die Blöcke in data.js sind Strings, die per document.write eingehängt
 * werden – ein Syntaxfehler darin fällt bei einer reinen Textprüfung nicht
 * auf. Deshalb wird data.js hier in einem vm-Kontext mit Mini-DOM
 * ausgeführt und das Ergebnis am fertigen `playersData` geprüft. */
function runDataJs(tournamentKey) {
  const context = {};
  vm.createContext(context);
  context.window = context;
  // Konsolen-Ausgaben von data.js im Test unterdrücken.
  context.console = { log() {}, warn() {}, error() {} };
  const loaded = [];

  context.document = {
    write(html) {
      const src = /src="([^"]+)"/.exec(html);
      if (src) {
        loaded.push(src[1]);
        vm.runInContext(fs.readFileSync(path.join(__dirname, '..', src[1]), 'utf8'), context,
          { filename: src[1] });
        return;
      }
      const inline = /^<script>([\s\S]*)<\/script>$/.exec(String(html).trim());
      assert.ok(inline, `data.js schreibt etwas Unerwartetes: ${String(html).slice(0, 60)}`);
      vm.runInContext(inline[1], context, { filename: `data.js:inline-${loaded.length}` });
    }
  };

  // data.js liest genau diese vier Dinge aus APP_CONFIG. Der Stub setzt das
  // gewünschte Turnier, ohne die Verfügbarkeits-/Preview-Logik zu bemühen.
  const tournament = APP.tournaments[tournamentKey];
  context.APP_CONFIG = {
    tournaments: APP.tournaments,
    activeTournamentKey: tournamentKey,
    primaryEntity: tournament.primaryEntity || 'nation',
    isTournamentLoadable() { return true; },
    data: { fileName() { return tournament.dataFile; } }
  };

  vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'data.js'), 'utf8'), context,
    { filename: 'data.js' });

  return { context, loaded, players: vm.runInContext('playersData', context) };
}

(function testEndToEnd() {
  const cl = runDataJs('cl2627');
  assert.ok(cl.loaded.includes('name-shortener.js'), 'data.js muss name-shortener.js einhängen.');
  assert.equal(cl.context.__NAME_SHORTENING_APPLIED__.active, true);
  assert.equal(cl.context.__NAME_SHORTENING_APPLIED__.error, undefined);
  assert.equal(cl.context.__NAME_OVERRIDES_APPLIED__.error, undefined);
  assert.ok(cl.context.__NAME_SHORTENING_APPLIED__.total > 0,
    'Für cl2627 muss ein Kaderpool geladen worden sein.');
  // Bewusst KEINE Erwartung an `count`: die Kaderdateien laufen schon im
  // Generator durch dieselbe name-shortener.js (generate-kader.js →
  // playerDisplayName). Für die Ladezeit-Kürzung bleibt dann nichts mehr
  // übrig – sie ist der Fallback für ältere/fremde Dateien. Geprüft wird
  // deshalb das ERGEBNIS: die Namen unten müssen stimmen, egal ob sie im
  // Generator oder erst beim Laden gekürzt wurden.

  const byId = new Map(cl.players.map((p) => [p['player.id'], p]));
  const expected = {
    1271: 'Aurélien Tchouaméni',   // gekürzt
    542: 'Ryan Gravenberch',
    502: 'Joshua Kimmich',
    5: 'Manuel Akanji',
    903: 'Scott McTominay',
    203224: 'Florian Wirtz',
    1257: 'Jules Koundé',
    247: 'Cody Gakpo',
    26243: 'Nico Schlotterbeck',
    637: 'Felix Nmecha',
    19599: 'Emiliano Martínez',    // Override (Rufname)
    396623: 'Pau Cubarsí',         // Override (Doppelnachname)
    1149: 'Dayot Upamecano',       // Override (Rufname)
    6716: 'Alexis Mac Allister',   // unverändert (Partikel)
    290: 'Virgil van Dijk'         // unverändert (Partikel)
  };
  Object.keys(expected).forEach((id) => {
    const player = byId.get(Number(id));
    assert.ok(player, `Spieler ${id} fehlt im cl2627-Pool.`);
    assert.equal(player.Spielername, expected[id]);
  });

  // Wo die Kette zur Ladezeit wirklich eingreift, bleibt der Originalname
  // für die Fehlersuche erhalten (hier der Rufname-Override).
  assert.equal(byId.get(1149).SpielernameOriginal, 'Dayotchanculle Upamecano');
  // Und wo nichts zu tun war, wird auch kein Original erfunden.
  assert.equal(byId.get(290).SpielernameOriginal, undefined);

  // Die WM läuft durch dieselbe Kette, ohne einen Namen zu verändern.
  const wm = runDataJs('wm2026');
  assert.equal(wm.context.__NAME_SHORTENING_APPLIED__.active, false);
  assert.equal(wm.context.__NAME_SHORTENING_APPLIED__.count, 0);
  const wmFile = loadPlayersData('data-wm2026.js');
  const wmNames = new Map(wmFile.map((p) => [p['player.id'], p.Spielername]));
  const wmChanged = wm.players.filter((p) => wmNames.get(p['player.id']) !== p.Spielername);
  assert.equal(wmChanged.length, 0,
    `Die WM-Namen dürfen sich nicht ändern, betroffen: ${wmChanged.map((p) => p.Spielername).join(', ')}`);

  console.log(
    `ok - data.js ausgeführt: cl2627 ${cl.context.__NAME_SHORTENING_APPLIED__.count} gekürzt + ` +
    `${cl.context.__NAME_OVERRIDES_APPLIED__.count} Overrides, WM unverändert`
  );
})();

/* ── 5) Ganze Spielerliste: nach Kürzung + Overrides keine Mittelnamen ───── */
function loadPlayersData(file) {
  const source = fs.readFileSync(path.join(__dirname, '..', file), 'utf8');
  const context = { playersData: null };
  vm.createContext(context);
  vm.runInContext(`${source}\nthis.playersData = playersData;`, context);
  return context.playersData;
}

function loadNameOverrides() {
  const source = fs.readFileSync(path.join(__dirname, '..', 'name-overrides.js'), 'utf8');
  const context = { window: {} };
  vm.createContext(context);
  vm.runInContext(source, context);
  return context.window.NAME_OVERRIDES || {};
}

const { isSurnameParticle, GIVEN_NAME_PREFIXES } = require('../name-shortener.js');
const GIVEN_PREFIX_SET = new Set(GIVEN_NAME_PREFIXES);

function normalizeToken(token) {
  return String(token || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z]/g, '');
}

// Erlaubte Gründe für drei und mehr Wörter – jeder andere Fall ist ein
// Mittelname, der durchgerutscht ist.
function allowedLongName(name, isOverridden) {
  const parts = words(name);
  if (parts.length <= 2) return true;
  if (isOverridden) return true;                                  // ausdrücklich so gewollt
  if (parts.some((w) => /^[A-Za-zÀ-ÖØ-öø-ÿ]\.$/.test(w))) return true; // abgekürztes Profil
  if (isSurnameParticle(parts[parts.length - 2])) return true;    // "van Dijk", "Mac Allister"
  if (GIVEN_PREFIX_SET.has(normalizeToken(parts[0]))) return true; // "El Chadaille Bitshiabu"
  return false;
}

const overrides = loadNameOverrides();
['cl2526', 'cl2627'].forEach((key) => {
  const tournament = APP.tournaments[key];
  const byId = overrides[key] || {};
  const pool = loadPlayersData(tournament.dataFile);

  // Dieselbe Kette wie data.js: kürzen, dann Overrides.
  const finalNames = pool.map((p) => {
    const id = String(p['player.id']);
    const shortened = shortenPlayerName(p.Spielername);
    const override = byId[id];
    return { id, before: p.Spielername, after: override || shortened, overridden: !!override };
  });

  const leftovers = finalNames
    .filter((n) => !allowedLongName(n.after, n.overridden))
    .map((n) => `${n.before} → ${n.after} (id=${n.id})`);
  assert.equal(leftovers.length, 0,
    `${key}: Diese Namen tragen weiterhin einen Mittelnamen:\n  ${leftovers.join('\n  ')}`);

  // Overrides dürfen den Namen nicht leeren und keine Kürzung erwarten, die
  // schon passiert ist: ein Override, der exakt dem Kürzungsergebnis
  // entspricht, ist ein No-op – erlaubt, aber er darf nicht der einzige
  // Grund für einen langen Namen sein (deshalb oben `overridden`).
  finalNames.forEach((n) => {
    assert.ok(String(n.after).trim().length > 0, `${key}: leerer Anzeigename für id=${n.id}.`);
  });

  const shortenedCount = finalNames.filter((n) => n.after !== n.before).length;
  const longNames = finalNames.filter((n) => words(n.after).length >= 3).length;
  console.log(
    `ok - ${key}: ${shortenedCount} von ${pool.length} Namen angepasst, ` +
    `${longNames} mit drei Wörtern (Partikel/Abkürzung/Override)`
  );
});

/* ── 6) Die WM bleibt unangetastet ───────────────────────────────────────── */
(function testWorldCupUntouched() {
  // Doppelte Absicherung zum Flag: die WM-Kaderdatei wird nicht durch die
  // Kürzung geschleust, ihre Namen bleiben genau so, wie sie sind.
  const wm = loadPlayersData('data-wm2026.js');
  assert.ok(wm.length > 0, 'data-wm2026.js sollte Spieler enthalten.');
  const overrides = loadNameOverrides();
  assert.equal(overrides.wm2026, undefined, 'Für die WM darf es keinen Namens-Override-Block geben.');
  console.log(`ok - WM 2026 unberührt (${wm.length} Spieler, Flag aus)`);
})();

console.log('name shortener tests passed');
