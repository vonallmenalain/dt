'use strict';

/* =============================================================================
 *  test-cl-current-matches-view.js
 *
 *  Regressionstest für die Bühne „Aktuelle Spiele" auf der Startseite
 *  (index.js, Namespace `clcm-`):
 *
 *   1) Standard-Ansicht: Läuft ein Spiel, ist „Live" Standard. Läuft nichts,
 *      steht heute aber noch ein Anpfiff an, ist „Kommend" Standard – sonst
 *      landete man am Spieltag auf den Resultaten des LETZTEN Spieltags,
 *      während gleich angepfiffen wird. Erst wenn für heute nichts mehr
 *      ansteht, ist „Abgeschlossen" wieder Standard.
 *   2) Kachel-Layout: Der Status-Badge („Live in 22 Minuten", „Live 63. Min")
 *      steht in einer eigenen, kachelbreiten Zeile und NICHT in der
 *      Mittelspalte – dort hat er die Aussenspalten samt Klublogos aus der
 *      Kachel geschoben.
 *
 *  Läuft ohne Browser: die Entscheidungslogik wird als Quelltext aus
 *  index.js geschnitten und hier mit Stubs ausgeführt – geprüft wird also
 *  der ausgelieferte Code, nicht eine Kopie davon.
 * ============================================================================= */

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const readRoot = (file) => fs.readFileSync(path.join(ROOT, file), 'utf8');

const indexJs = readRoot('index.js');
const indexCss = readRoot('index.css');

/* ── Quelltext-Schnipsel aus index.js holen ────────────────────────────── */
function sliceBetween(source, startMarker, endMarker, searchFrom = 0) {
  const start = source.indexOf(startMarker, searchFrom);
  assert.notEqual(start, -1, `index.js: Marker „${startMarker}" nicht gefunden.`);
  const end = source.indexOf(endMarker, start + startMarker.length);
  assert.notEqual(end, -1, `index.js: Marker „${endMarker}" nicht gefunden.`);
  return source.slice(start, end);
}

// Funktion ab „function name(" bis zur passenden schliessenden Klammer.
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

// Schweizer Kalendertag-Helfer (SWISS_TIME_ZONE … getSwissCalendarDayDiff).
const swissHelpers = sliceBetween(indexJs, "const SWISS_TIME_ZONE = 'Europe/Zurich';", 'function formatSwissMatchTime');
const hasKickoffTodaySrc = sliceFunction(indexJs, 'clcmHasKickoffToday');
// Für den Test wird die Uhr gesetzt statt gelesen – der Default-Parameter
// muss dafür wirklich ersetzt werden, sonst liefe der Test gegen Date.now().
const hasKickoffTodayTestSrc = hasKickoffTodaySrc.replace('nowMs = Date.now()', 'nowMs = nowMsDefault');
assert.notEqual(hasKickoffTodayTestSrc, hasKickoffTodaySrc,
  'index.js: clcmHasKickoffToday nimmt die Zeit nicht mehr als Parameter (nowMs = Date.now()).');
// Die Ansichts-Wahl aus renderClCurrentMatches (dieselbe erste Zeile steht
// auch in clcmUpdateToggle – deshalb ab der Render-Funktion suchen).
const renderStart = indexJs.indexOf('function renderClCurrentMatches(');
assert.notEqual(renderStart, -1, 'index.js: renderClCurrentMatches nicht gefunden.');
const viewChoiceSrc = sliceBetween(indexJs, "const liveCount = clcmCountByGroup('live');", '// Unveränderte Anzeige', renderStart);

/* ── Entscheidungslogik ausführbar machen ──────────────────────────────── */
// eslint-disable-next-line no-new-func
const makeDecider = new Function(`
  ${swissHelpers}
  return function decide(entries, startView, chosenByUser, nowMs) {
    let clcmEntries = entries;
    let clcmView = startView;
    let clcmViewChosenByUser = chosenByUser;
    const clcmCountByGroup = (group) => clcmEntries.filter((e) => e.group === group).length;
    ${hasKickoffTodayTestSrc}
    const nowMsDefault = nowMs;
    ${viewChoiceSrc}
    return clcmView;
  };
`);
const decide = makeDecider();

const SWISS = (iso) => new Date(iso);               // ISO mit Offset → eindeutig
const NOW = SWISS('2026-09-09T18:23:00+02:00').getTime();   // Spieltag, 18:23 Schweizer Zeit

const entry = (group, kickoffIso) => ({
  group,
  view: { kickoffDate: kickoffIso ? SWISS(kickoffIso) : null }
});

const FINISHED_LAST_MATCHDAY = entry('abgeschlossen', '2026-09-02T21:00:00+02:00');
const TODAY_1845 = entry('kommend', '2026-09-09T18:45:00+02:00');
const TODAY_2100 = entry('kommend', '2026-09-09T21:00:00+02:00');
const TOMORROW_2100 = entry('kommend', '2026-09-10T21:00:00+02:00');
const RUNNING = entry('live', '2026-09-09T18:45:00+02:00');

/* ── 1) Standard-Ansicht ───────────────────────────────────────────────── */
{
  // Vor dem Anpfiff am Spieltag: „Kommend" statt der Resultate von letzter Woche.
  assert.equal(decide([FINISHED_LAST_MATCHDAY, TODAY_1845, TODAY_2100], 'abgeschlossen', false, NOW), 'kommend',
    'Am Spieltag ohne laufendes Spiel muss „Kommend" die Standard-Ansicht sein.');

  // Läuft etwas, gewinnt „Live" – dort stehen die Zwischenstände.
  assert.equal(decide([RUNNING, FINISHED_LAST_MATCHDAY, TODAY_2100], 'abgeschlossen', false, NOW), 'live',
    'Solange ein Spiel läuft, bleibt „Live" die Standard-Ansicht.');

  // Zwischen zwei Anstosszeiten (18:45er beendet, 21:00er stehen an): „Kommend".
  assert.equal(decide([FINISHED_LAST_MATCHDAY, TODAY_2100], 'abgeschlossen', false, NOW), 'kommend',
    'Steht heute noch ein Anpfiff an, ist „Kommend" Standard.');

  // Nach dem letzten Anpfiff des Tages: zurück auf „Abgeschlossen".
  assert.equal(decide([FINISHED_LAST_MATCHDAY, TOMORROW_2100], 'abgeschlossen', false, NOW), 'abgeschlossen',
    'Ohne Anpfiff heute bleibt „Abgeschlossen" Standard.');

  // Spielfreier Tag mit Spielen erst morgen: ebenfalls „Abgeschlossen".
  assert.equal(decide([FINISHED_LAST_MATCHDAY, TOMORROW_2100], 'kommend', false, NOW), 'abgeschlossen',
    'An einem spielfreien Tag darf die Automatik nicht auf „Kommend" hängen bleiben.');
}

/* ── 2) Eigene Wahl schlägt die Automatik ──────────────────────────────── */
{
  assert.equal(decide([FINISHED_LAST_MATCHDAY, TODAY_2100], 'abgeschlossen', true, NOW), 'abgeschlossen',
    'Wer selbst auf „Abgeschlossen" schaltet, darf am Spieltag nicht zurückgeworfen werden.');
  assert.equal(decide([RUNNING, FINISHED_LAST_MATCHDAY, TODAY_2100], 'kommend', true, NOW), 'kommend',
    'Eine eigene Wahl überlebt auch ein anpfeifendes Spiel.');

  // Verschwindet der Live-Tab, kann die Wahl „Live" niemandem mehr gehören.
  assert.equal(decide([FINISHED_LAST_MATCHDAY, TODAY_2100], 'live', true, NOW), 'kommend',
    'Nach dem Verschwinden des Live-Tabs entscheidet wieder die Automatik → „Kommend".');
  assert.equal(decide([FINISHED_LAST_MATCHDAY, TOMORROW_2100], 'live', true, NOW), 'abgeschlossen',
    'Nach dem Verschwinden des Live-Tabs ohne Anpfiff heute → „Abgeschlossen".');
}

/* ── 3) Niemand landet auf einer leeren Bühne ──────────────────────────── */
{
  // Vor dem allerersten Anpfiff der Saison gibt es nichts Abgeschlossenes.
  assert.equal(decide([TOMORROW_2100], 'abgeschlossen', false, NOW), 'kommend',
    'Ohne abgeschlossene Spiele muss die Bühne auf „Kommend" ausweichen.');
  // Nach dem Final gibt es keine kommenden Spiele mehr.
  assert.equal(decide([FINISHED_LAST_MATCHDAY], 'kommend', false, NOW), 'abgeschlossen',
    'Ohne kommende Spiele muss die Bühne auf „Abgeschlossen" ausweichen.');
}

/* ── 4) Tagesgrenze zählt nach Schweizer Kalendertag ───────────────────── */
{
  const lateNight = SWISS('2026-09-09T23:50:00+02:00').getTime();
  assert.equal(decide([FINISHED_LAST_MATCHDAY, entry('kommend', '2026-09-10T00:30:00+02:00')], 'abgeschlossen', false, lateNight),
    'abgeschlossen',
    'Ein Anpfiff nach Mitternacht gehört zum nächsten Kalendertag – heute steht nichts mehr an.');
}

/* ── 5) Kachel-Layout: Badge in eigener Zeile ──────────────────────────── */
{
  const tileHtml = sliceFunction(indexJs, 'clcmTileHtml');
  assert.match(tileHtml, /clcmTileBadgeHtml\(entry\)/,
    'index.js: clcmTileHtml rendert den Status-Badge nicht mehr – Live-Minute und Countdown fehlen auf der Kachel.');

  const centerHtml = sliceFunction(indexJs, 'clcmTileCenterHtml');
  assert.ok(!/clcm-badge/.test(centerHtml),
    'index.js: Der Status-Badge steht wieder in .clcm-center – die Mittelspalte wächst dann auf die Textbreite und schiebt die Logos aus der Kachel.');

  assert.match(indexCss, /\.clcm-tile-badge \{[^}]*grid-column: 1 \/ -1;/,
    'index.css: .clcm-tile-badge belegt keine eigene, kachelbreite Rasterzeile mehr.');
  assert.match(indexCss, /\.clcm-tile-main \{[\s\S]*?grid-template-columns: minmax\(0, 1fr\) minmax\(0, auto\) minmax\(0, 1fr\);/,
    'index.css: .clcm-tile-main begrenzt die Mittelspalte nicht mehr mit minmax(0, …) – breite Inhalte schieben die Logos aus der Kachel.');
}

console.log('test-cl-current-matches-view.js: alle Checks bestanden.');
