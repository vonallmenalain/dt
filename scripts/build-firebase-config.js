#!/usr/bin/env node
'use strict';

/* =============================================================================
 *  build-firebase-config.js
 *
 *  Setzt den Firebase-Web-API-Key beim Deploy in `tournament-config.js` ein.
 *  Der Key steht deshalb NICHT im Repo, sondern nur in der Umgebung des
 *  Build-Systems (Netlify → Site settings → Environment variables →
 *  FIREBASE_API_KEY) und in der Google Cloud Console.
 *
 *  Aufruf (macht Netlify automatisch, siehe netlify.toml):
 *      FIREBASE_API_KEY=AIza... node scripts/build-firebase-config.js
 *
 *  Verhalten:
 *    • Fehlt FIREBASE_API_KEY  → Abbruch mit Exit-Code 1. Netlify markiert
 *      den Deploy als fehlgeschlagen und laesst die bisherige Version online.
 *      Eine Seite ohne Key zu veroeffentlichen waere schlimmer als kein Deploy.
 *    • Fehlt der Platzhalter   → Abbruch. Entweder wurde die Datei schon
 *      ersetzt (zweiter Lauf) oder jemand hat den Key wieder hart eingetragen.
 *
 *  WICHTIG: Das Script schreibt `tournament-config.js` IN PLACE. Lokal
 *  ausgefuehrt hinterlaesst es den echten Key im Arbeitsverzeichnis –
 *  danach `git checkout tournament-config.js`, damit er nicht im naechsten
 *  Commit landet. Der Test scripts/test-firebase-key-not-committed.js faengt
 *  den Fall zusaetzlich ab.
 *
 *  Zur Einordnung: ein Firebase-Web-Key ist kein Geheimnis – er wird an jeden
 *  Browser ausgeliefert. Dieses Script sorgt fuer sauberes Secret-Scanning
 *  und einfaches Rotieren, nicht fuer Vertraulichkeit. Der Schutz der Daten
 *  kommt aus firestore.rules, den Key-Restriktionen (HTTP-Referrer + erlaubte
 *  APIs) und Firebase App Check.
 * ============================================================================= */

const fs = require('node:fs');
const path = require('node:path');

const TARGET = path.join(__dirname, '..', 'tournament-config.js');
const PLACEHOLDER = 'apiKey: "__FIREBASE_API_KEY__"';
const ENV_NAME = 'FIREBASE_API_KEY';

function fail(message) {
  console.error(`\n✗ ${ENV_NAME}-Injektion fehlgeschlagen:\n  ${message}\n`);
  process.exit(1);
}

const apiKey = String(process.env[ENV_NAME] || '').trim();

if (!apiKey) {
  fail(
    `Die Umgebungsvariable ${ENV_NAME} ist nicht gesetzt.\n`
    + '  Netlify: Site settings → Environment variables → FIREBASE_API_KEY.\n'
    + '  Lokal:   FIREBASE_API_KEY=AIza... node scripts/build-firebase-config.js'
  );
}

// Grobe Formpruefung: ein vertippter oder leerer Wert soll hier auffallen und
// nicht erst als kaputte App im Browser.
if (!/^AIza[0-9A-Za-z_-]{30,}$/.test(apiKey)) {
  fail(
    `${ENV_NAME} sieht nicht wie ein Google-API-Key aus (erwartet: "AIza…", `
    + `${apiKey.length} Zeichen erhalten).`
  );
}

let source;
try {
  source = fs.readFileSync(TARGET, 'utf8');
} catch (err) {
  fail(`${TARGET} ist nicht lesbar: ${err.message}`);
}

const occurrences = source.split(PLACEHOLDER).length - 1;

if (occurrences === 0) {
  fail(
    `Platzhalter ${PLACEHOLDER} nicht in tournament-config.js gefunden.\n`
    + '  Entweder lief dieses Script schon (dann ist der Key bereits gesetzt),\n'
    + '  oder der Key wurde wieder fest in die Datei geschrieben.'
  );
}

if (occurrences > 1) {
  fail(`Platzhalter ${occurrences}x gefunden – erwartet wird genau einer.`);
}

fs.writeFileSync(TARGET, source.replace(PLACEHOLDER, `apiKey: "${apiKey}"`), 'utf8');

// Bewusst nur die letzten Zeichen loggen: Build-Logs sind bei Netlify fuer
// jeden mit Repo-Zugriff sichtbar.
console.log(`✓ ${ENV_NAME} in tournament-config.js eingesetzt (…${apiKey.slice(-6)}).`);
