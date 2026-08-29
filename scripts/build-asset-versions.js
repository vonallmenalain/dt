#!/usr/bin/env node
'use strict';

/* =============================================================================
 *  build-asset-versions.js
 *
 *  Stempelt beim Deploy die Asset-Version in alle HTML-Seiten und den
 *  Service Worker: jedes Vorkommen des Platzhalters `__BUILD__` wird durch
 *  eine deploy-eindeutige Kennung ersetzt (Netlify-Commit-SHA, gekürzt).
 *
 *  Warum: Alle lokalen JS/CSS/Daten-Dateien werden mit `?v=__BUILD__`
 *  eingebunden. Nach dem Stempeln identifiziert die URL den Inhalt
 *  eindeutig – der Service Worker darf solche Assets cache-first (ohne
 *  Netz-Roundtrip) ausliefern, und ein Deploy erzeugt automatisch neue
 *  URLs samt neuem Cache (CACHE_VERSION im Service Worker trägt denselben
 *  Stempel). Früher wurden die `?v=`-Werte pro Seite von Hand gepflegt und
 *  liefen auseinander (index -13, rangliste -16, spieleranalyse -25, …) –
 *  gemeinsame Dateien lagen dadurch mehrfach im Cache und unversionierte
 *  Dateien (admin.js, data-*.js, …) mussten bei jedem Seitenwechsel übers
 *  Netz revalidiert werden. scripts/test-asset-versions.js hält den
 *  Repo-Stand konsistent.
 *
 *  Aufruf (macht Netlify automatisch, siehe netlify.toml – NACH
 *  build-firebase-config.js):
 *      node scripts/build-asset-versions.js
 *
 *  Versionsquelle, in dieser Reihenfolge:
 *    1. DT_ASSET_VERSION   – manueller Override (z.B. für lokale Tests)
 *    2. COMMIT_REF         – von Netlify gesetzter Git-SHA des Deploys
 *    3. Zeitstempel        – Fallback, falls beides fehlt
 *
 *  Ohne Build (lokale Entwicklung) bleibt überall das Literal `__BUILD__`
 *  stehen. Das ist gewollt: alle Seiten teilen sich dann dieselbe
 *  (konstante) Version, und der Service Worker erkennt den ungestempelten
 *  Zustand und bleibt im Dev-Modus network-first (siehe service-worker.js).
 * ============================================================================= */

const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const PLACEHOLDER = '__BUILD__';

function resolveVersion() {
  const override = String(process.env.DT_ASSET_VERSION || '').trim();
  if (override) return override;

  const sha = String(process.env.COMMIT_REF || '').trim();
  if (/^[0-9a-f]{7,40}$/i.test(sha)) return sha.slice(0, 12).toLowerCase();

  // Fallback: Minutengenauer Zeitstempel, z.B. 20260829-1042.
  const d = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}`
    + `-${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}`;
}

const version = resolveVersion();

// Nur URL-sichere Zeichen zulassen – der Wert landet unkodiert in URLs,
// im Cache-Namen des Service Workers und in Log-Zeilen.
if (!/^[0-9A-Za-z._-]{1,64}$/.test(version)) {
  console.error(`\n✗ Asset-Version "${version}" enthält unerlaubte Zeichen.\n`);
  process.exit(1);
}

const targets = fs.readdirSync(ROOT)
  .filter((name) => name.endsWith('.html'))
  .concat(['service-worker.js'])
  .map((name) => path.join(ROOT, name));

let stampedFiles = 0;
let stampedTotal = 0;

for (const file of targets) {
  let source;
  try {
    source = fs.readFileSync(file, 'utf8');
  } catch (err) {
    console.error(`\n✗ ${file} ist nicht lesbar: ${err.message}\n`);
    process.exit(1);
  }

  const count = source.split(PLACEHOLDER).length - 1;
  if (count === 0) continue;

  fs.writeFileSync(file, source.split(PLACEHOLDER).join(version), 'utf8');
  stampedFiles += 1;
  stampedTotal += count;
}

if (stampedTotal === 0) {
  console.error(
    `\n✗ Kein ${PLACEHOLDER}-Platzhalter gefunden.\n`
    + '  Entweder lief dieses Script schon (zweiter Lauf im selben Build),\n'
    + '  oder die Platzhalter wurden aus den HTML-Seiten entfernt.\n'
  );
  process.exit(1);
}

console.log(`✓ Asset-Version "${version}" in ${stampedFiles} Dateien eingesetzt (${stampedTotal} Stellen).`);
