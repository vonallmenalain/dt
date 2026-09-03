'use strict';

/* =============================================================================
 *  kader-serializer.js
 *
 *  Gemeinsames Ausgabeformat der Kader-Generatoren (generate-cl-pool.js,
 *  generate-kader.js) und des zugehoerigen Transform-Standes von
 *  data-cl2627.js.
 *
 *  Warum nicht mehr `const playersData = [ ...pretty-printed... ]`:
 *  Die Kaderdatei wird im Browser bei JEDEM Seitenaufruf synchron geparst
 *  (data.js → document.write). Zwei Hebel machen das deutlich billiger,
 *  ohne die Daten anzutasten:
 *
 *    1. Kompaktes JSON in einem String + JSON.parse: Pretty-Print-
 *       Whitespace (~40 % der Datei) faellt weg, und JSON.parse eines
 *       Strings parst in allen Engines deutlich schneller als ein gleich
 *       grosses JS-Objektliteral.
 *    2. Anzeige-tote Felder fallen weg: Felder, die keine einzige
 *       App-Ansicht liest (DISPLAY_DEAD_FIELDS), kosten nur Parse-Zeit.
 *       Die Generatoren berechnen sie weiterhin (Logging/Plausibilitaet),
 *       nur serialisiert werden sie nicht mehr.
 *
 *  Alle Node-Konsumenten (auto-points-upload.js, Tests) laden die Datei
 *  per vm.runInContext und sehen weiterhin ein fertiges Array – das
 *  Format ist fuer sie transparent.
 * ============================================================================= */

/* Felder ohne einen einzigen Leser in App, Admin-Seiten oder Cron-Scripts
 * (Stand: grep ueber *.js/*.html ausser data-*). Wer eines davon wieder
 * anzeigen will, entfernt es hier UND ergaenzt die Anzeige.
 *
 * `Gewicht` stand hier faelschlich: der Spieler-Steckbrief der Analyse
 * (spieleranalyse.js) liest es – allerdings ueber eine dynamische
 * Key-Suche ("gewicht"/"weight"), die der grep nicht gefunden hat. Folge
 * in data-cl2627.js: bei jedem Spieler „K.A.". Seit dem Fix blendet die
 * Anzeige das Gewicht aus, wenn die Kaderdatei das Feld nicht fuehrt; der
 * naechste Generator-Lauf schreibt es wieder mit (~5 Byte je Spieler).
 * scripts/test-cl2627-pool.js fuehrt es deshalb als OPTIONAL. */
const DISPLAY_DEAD_FIELDS = ['Vorsaison.Minuten', 'Vorsaison.Spiele'];

function serializePlayersData(players) {
  if (!Array.isArray(players)) {
    throw new Error('serializePlayersData erwartet ein Array.');
  }
  const slim = players.map((player) => {
    const copy = { ...player };
    for (const key of DISPLAY_DEAD_FIELDS) delete copy[key];
    return copy;
  });
  // Doppelt stringifizieren: innen das kompakte JSON, aussen ein sauber
  // escaptes JS-String-Literal (Apostrophe, Umlaute, Backslashes).
  return `const playersData = JSON.parse(${JSON.stringify(JSON.stringify(slim))});\n`;
}

/* Banner-Zeilen, die die Generatoren in den Datei-Kopf uebernehmen, damit
 * beim naechsten Blick in die Datei klar ist, warum sie so aussieht. */
const FORMAT_BANNER_LINES = [
  ' *',
  ' *  Format: kompaktes JSON via JSON.parse (parst schneller als ein',
  ' *  Objektliteral); ohne Anzeige-tote Felder (' + DISPLAY_DEAD_FIELDS.join(', ') + ').',
  ' *  Details: scripts/kader-serializer.js.'
];

module.exports = { serializePlayersData, DISPLAY_DEAD_FIELDS, FORMAT_BANNER_LINES };
