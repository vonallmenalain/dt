'use strict';

/* =============================================================================
 *  test-cl-team-writes.js
 *
 *  Zwei Dinge, die in der CL-Ansicht nur zusammen funktionieren:
 *
 *   1) BENENNUNG – beide CL-Turniere heissen überall „Champions League
 *      DreamTeam" plus kleinem Saison-Zusatz. Die Abkürzung „CL" und die
 *      Kurzform „26/27" dürfen in KEINEM Anzeige-Label mehr vorkommen
 *      (Kommentare im Code sind davon nicht betroffen).
 *
 *   2) TEAM-WRITES – die Firestore-Rules müssen die Team-Collection des
 *      Turniers für create/update/delete abdecken. Fehlt der Zweig, läuft
 *      jede Einreichung in ein permission-denied, das im Builder als
 *      „Fehler beim Speichern. Bitte Verbindung prüfen." landet – genau der
 *      Bug, den dieser Test verhindert.
 *
 *  Läuft ohne Browser/Firebase: tournament-config.js als Node-Modul plus
 *  ein Quelltext-Check auf firestore.rules.
 * ============================================================================= */

const assert = require('node:assert/strict');
const fs     = require('node:fs');
const path   = require('node:path');
const APP    = require('../tournament-config.js');

/* Kommentare raus: die Rules sind dicht kommentiert, und ein Semikolon in
 * einem Kommentar würde die Block-Extraktion unten vorzeitig beenden. */
const RULES = fs.readFileSync(path.join(__dirname, '..', 'firestore.rules'), 'utf8')
  .replace(/\/\/[^\n]*/g, '');

/* ── 1) Benennung: „Champions League DreamTeam" + Saison-Zusatz ────────── */

const NAMED = {
  cl2526: '2025/2026',
  cl2627: '2026/2027'
};

for (const [key, season] of Object.entries(NAMED)) {
  const t = APP.tournaments && APP.tournaments[key];
  assert.ok(t, `${key}-Block fehlt in TOURNAMENTS.`);

  assert.equal(t.name, 'Champions League',
    `${key}.name muss „Champions League" heissen (ohne Saison).`);
  assert.equal(t.shortLabel, 'Champions League',
    `${key}.shortLabel muss „Champions League" heissen – der Nav-Brand baut darauf auf.`);
  assert.equal(t.brandName, 'DreamTeam Champions League',
    `${key}.brandName weicht vom vereinbarten Muster ab.`);
  assert.equal(t.pageTitlePrefix, 'Champions League DreamTeam',
    `${key}.pageTitlePrefix muss „Champions League DreamTeam" sein (Tab-Titel).`);
  assert.equal(t.longLabel, `UEFA Champions League ${season}`,
    `${key}.longLabel muss die volle Saison ausschreiben.`);
  assert.equal(t.seasonLabel, season,
    `${key}.seasonLabel muss „${season}" sein – daraus wird „Saison ${season}".`);

  // Kein „CL" und keine Kurzform „25/26"/„26/27" in irgendeinem Label.
  const shortSeason = season.replace(/^\d{2}(\d{2})\/\d{2}(\d{2})$/, '$1/$2');
  for (const field of ['name', 'shortLabel', 'brandName', 'pageTitlePrefix', 'longLabel', 'seasonLabel']) {
    const value = String(t[field] || '');
    assert.ok(!/\bCL\b/.test(value),
      `${key}.${field} enthält die Abkürzung „CL" ("${value}") – ausgeschrieben erwartet.`);
    assert.ok(!value.includes(shortSeason),
      `${key}.${field} enthält die Kurzform „${shortSeason}" ("${value}") – volle Saison erwartet.`);
  }
}

/* Beide CL-Turniere teilen sich denselben Anzeigenamen. Im Dev-Turnier-
 * Menü (nav.js) hängt deshalb der Saison-Zusatz dran, sonst wären die
 * Einträge nicht auseinanderzuhalten. */
const NAV = fs.readFileSync(path.join(__dirname, '..', 'nav.js'), 'utf8');
assert.ok(/function devTournamentLabel/.test(NAV),
  'nav.js braucht devTournamentLabel(), sonst heissen beide CL-Einträge im Dev-Menü gleich.');
assert.ok(/devTournamentLabel\(t, key\)/.test(NAV),
  'Die Turnier-Listen im Dev-Menü müssen devTournamentLabel() benutzen.');

/* ── 2) Firestore-Rules decken die Team-Writes beider CL-Turniere ab ───── */

/** Schneidet den Rumpf eines `allow <op>:`-Blocks aus den Rules heraus
 *  (bis zum abschliessenden Semikolon). */
function allowBlock(op) {
  const start = RULES.indexOf(`allow ${op}:`);
  assert.notEqual(start, -1, `Kein "allow ${op}:"-Block in firestore.rules gefunden.`);
  const end = RULES.indexOf(';', start);
  assert.notEqual(end, -1, `"allow ${op}:"-Block ist nicht terminiert.`);
  return RULES.slice(start, end);
}

for (const key of ['cl2526', 'cl2627']) {
  const t = APP.tournaments[key];
  const collection = t.firestore.teamsCollection;
  const metaDocId  = t.firestore.metaDocId;

  // Lesen muss öffentlich sein (Teams-Ansicht, Rangliste).
  assert.ok(RULES.includes(`collection == '${collection}'`),
    `firestore.rules kennen die Team-Collection "${collection}" (${key}) nicht.`);

  for (const op of ['create', 'update', 'delete']) {
    assert.ok(allowBlock(op).includes(`collection == '${collection}'`),
      `firestore.rules erlauben kein "${op}" auf "${collection}" (${key}) – `
      + 'Einreichungen scheitern dann mit permission-denied.');
  }

  // teamsVersion-Bump nach jeder Einreichung: ohne Update-Recht auf dem
  // Meta-Dokument sehen andere Geräte veraltete Teams.
  assert.ok(allowBlock('update').includes(`docId == '${metaDocId}'`),
    `firestore.rules erlauben keinen teamsVersion-Bump auf app_meta/${metaDocId} (${key}).`);
}

/* Die Abgabe-Deadline der CL steht doppelt: als Millisekunden-Konstante in
 * den Rules und als DREAMTEAM_START in der Config. Läuft das auseinander,
 * sperren die Rules zum falschen Zeitpunkt. */
const clDeadlineMatch = RULES.match(/isBeforeClTeamDeadline\(\)\s*\{[^}]*?<\s*(\d+)/);
assert.ok(clDeadlineMatch, 'isBeforeClTeamDeadline() fehlt in firestore.rules.');
assert.equal(
  Number(clDeadlineMatch[1]),
  new Date(APP.tournaments.cl2627.DREAMTEAM_START).getTime(),
  'Die CL-Deadline in firestore.rules stimmt nicht mit cl2627.DREAMTEAM_START überein.'
);

/* Der Nachzügler-Schalter der CL muss auf das CL-Meta-Dokument zeigen –
 * ein Copy-Paste auf turnier_wm2026 wäre wirkungslos. */
assert.ok(/clLateSubmitOpen\(\)\s*\{[\s\S]*?app_meta\/turnier_cl2627/.test(RULES),
  'clLateSubmitOpen() muss app_meta/turnier_cl2627 lesen.');

console.log('cl team writes + naming test passed');
