'use strict';

/* =============================================================================
 *  test-firebase-key-not-committed.js
 *
 *  Regressionstest: im Repo darf kein Google-/Firebase-API-Key stehen.
 *
 *  Der Key wird erst beim Deploy von scripts/build-firebase-config.js aus der
 *  Umgebungsvariable FIREBASE_API_KEY in tournament-config.js eingesetzt. Wer
 *  das Script lokal laufen laesst, hat den echten Key danach im
 *  Arbeitsverzeichnis – dieser Test faengt ab, dass er so in einen Commit
 *  rutscht (und mit ihm ein neuer Secret-Scanning-Alert).
 *
 *  Geprueft werden alle von git getrackten Textdateien, nicht nur
 *  tournament-config.js: ein Key hat auch in HTML, JSON oder Doku nichts
 *  verloren.
 * ============================================================================= */

const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');

/* Google-API-Keys beginnen mit "AIza" und haben 39 Zeichen. Bewusst nicht als
 * ein Stueck geschrieben, damit dieser Test nicht selbst als Fund gilt. */
const KEY_PATTERN = new RegExp('AIza' + '[0-9A-Za-z_-]{35}');

/* Binaerdateien und Kaderdaten (mehrere hundert KB generiertes JSON) auslassen –
 * sie enthalten keine Konfiguration und wuerden den Test nur langsam machen. */
const SKIP = /^(Files\/|Icons\/|scripts\/package-lock\.json$|data-[a-z0-9]+\.js$)/;

function trackedFiles() {
  const out = execFileSync('git', ['ls-files', '-z'], { cwd: ROOT, encoding: 'utf8' });
  return out.split('\0').filter(Boolean).filter(f => !SKIP.test(f));
}

const hits = [];
for (const file of trackedFiles()) {
  let content;
  try {
    content = fs.readFileSync(path.join(ROOT, file), 'utf8');
  } catch (_) {
    continue; // geloescht oder nicht lesbar → nichts zu pruefen
  }
  if (content.includes('\0')) continue; // Binaerdatei
  const match = content.match(KEY_PATTERN);
  if (match) hits.push(`${file}: …${match[0].slice(-6)}`);
}

assert.deepEqual(hits, [],
  'Google-API-Key im Repo gefunden. Der Key gehoert in die Umgebungsvariable '
  + 'FIREBASE_API_KEY (Netlify), nicht in einen Commit. Wurde '
  + 'scripts/build-firebase-config.js lokal ausgefuehrt? Dann '
  + '`git checkout tournament-config.js`.\nFundstellen:\n  ' + hits.join('\n  '));

/* Gegenprobe: der Platzhalter muss vorhanden sein. Sonst haette jemand die
 * Injektion entfernt und der Build wuerde kommentarlos ohne Key ausliefern. */
const config = fs.readFileSync(path.join(ROOT, 'tournament-config.js'), 'utf8');
assert.ok(config.includes('apiKey: "__FIREBASE_API_KEY__"'),
  'Platzhalter apiKey: "__FIREBASE_API_KEY__" fehlt in tournament-config.js – '
  + 'ohne ihn kann scripts/build-firebase-config.js den Key nicht einsetzen.');

console.log('✓ test-firebase-key-not-committed: kein API-Key im Repo, Platzhalter vorhanden.');
