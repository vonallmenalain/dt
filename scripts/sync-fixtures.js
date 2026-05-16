#!/usr/bin/env node
/* =============================================================================
 *  scripts/sync-fixtures.js
 *
 *  Server-seitiger Auto-Sync für den Spielplan. Wird via GitHub Actions
 *  (einmal pro Tag) aufgerufen und aktualisiert den Spielplan inkl.
 *  Finalrunden-Spiele automatisch, sobald die Paarungen bei der API
 *  feststehen.
 *
 *  Ablauf pro Lauf:
 *    1. Lädt alle Fixtures des aktiven Turniers von api-football
 *       (Zeitzone Europe/Zurich).
 *    2. Sammelt eindeutige Venue-IDs und holt jede Venue genau einmal.
 *    3. Baut pro Spiel ein Firestore-Dokument im etablierten Schema.
 *    4. Schreibt die Dokumente in Batches à 400 nach `fixturesCollection`.
 *    5. Erhöht `fixturesVersion` und setzt `fixturesUpdatedAt` im
 *       Meta-Dokument – das Signal, mit dem der Client den Cache
 *       invalidiert.
 *
 *  Env-Variablen (aus GitHub Actions Secrets / Variables):
 *    RAPIDAPI_KEY              RapidAPI / API-Football Key (zwingend)
 *    FIREBASE_SERVICE_ACCOUNT  Service-Account-JSON als String (zwingend)
 *    TOURNAMENT_KEY            Optional. Default = Fallback aus
 *                              tournament-config.js. Aktuell ist nur
 *                              `wm2026` produktiv konfiguriert.
 *    DRY_RUN                   Falls `1`/`true`: nichts schreiben, nur loggen.
 *    SKIP_VENUES               Falls `1`/`true`: Venue-Detail-Calls
 *                              auslassen (spart API-Quota).
 *
 *  Exit-Codes:
 *    0  – Lauf abgeschlossen (Spielplan synchronisiert oder Dry-Run ok).
 *    1  – Konfigurationsfehler / nicht behebbar.
 *    2  – API/Netzwerkfehler oder Firestore-Schreibfehler.
 * ============================================================================= */

'use strict';

let admin;
try {
  admin = require('firebase-admin');
} catch (err) {
  console.error('[sync-fixtures] firebase-admin ist nicht installiert. Bitte `npm install` ausführen.');
  process.exit(1);
}

let fetchFn = (typeof fetch === 'function') ? fetch : null;
if (!fetchFn) {
  try {
    fetchFn = require('node-fetch');
  } catch (err) {
    console.error('[sync-fixtures] Globales fetch fehlt und node-fetch nicht installiert. Node 18+ verwenden.');
    process.exit(1);
  }
}

// Zentrale Turnier-Konfiguration aus tournament-config.js (siehe dort).
// Keine zweite Tabelle hier pflegen – sonst driften Browser- und Cron-
// Konfiguration auseinander.
const APP_CONFIG = require('../tournament-config.js');
const TOURNAMENTS = APP_CONFIG.tournaments;

const API_HOST = 'v3.football.api-sports.io';
const VENUE_DELAY_MS = 300;

/* ─────────────────────────────────────────────────────────────────────────────
 *  Helpers
 * ───────────────────────────────────────────────────────────────────────────── */
function envBool(name, fallback = false) {
  const v = (process.env[name] || '').trim().toLowerCase();
  if (v === '1' || v === 'true' || v === 'yes' || v === 'on') return true;
  if (v === '0' || v === 'false' || v === 'no' || v === 'off') return false;
  return fallback;
}

function logInfo(msg) {
  console.log(`[sync-fixtures] ${msg}`);
}

function logWarn(msg) {
  console.warn(`[sync-fixtures] ⚠️ ${msg}`);
}

function logError(msg) {
  console.error(`[sync-fixtures] ❌ ${msg}`);
}

function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function buildApiHeaders(apiKey) {
  return {
    'x-rapidapi-key': apiKey,
    'x-rapidapi-host': API_HOST
  };
}

async function fetchJson(url, apiKey) {
  const res = await fetchFn(url, { headers: buildApiHeaders(apiKey) });
  if (!res.ok) {
    throw new Error(`HTTP ${res.status} bei ${url}`);
  }
  return res.json();
}

/* ─────────────────────────────────────────────────────────────────────────────
 *  Firebase Admin Initialisierung
 * ───────────────────────────────────────────────────────────────────────────── */
function initFirebase() {
  const raw = process.env.FIREBASE_SERVICE_ACCOUNT;
  if (!raw) {
    throw new Error('FIREBASE_SERVICE_ACCOUNT (Service-Account-JSON) ist nicht gesetzt.');
  }
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    throw new Error('FIREBASE_SERVICE_ACCOUNT konnte nicht als JSON geparst werden: ' + err.message);
  }
  if (!parsed.project_id || !parsed.private_key) {
    throw new Error('FIREBASE_SERVICE_ACCOUNT enthält weder project_id noch private_key – falsches Format?');
  }
  if (admin.apps.length === 0) {
    admin.initializeApp({
      credential: admin.credential.cert(parsed),
      projectId: parsed.project_id
    });
  }
  return admin.firestore();
}

/* ─────────────────────────────────────────────────────────────────────────────
 *  API-Aufrufe – Fixtures + Venues
 * ───────────────────────────────────────────────────────────────────────────── */
function buildFixturesUrl(tournament) {
  const q = `${tournament.api.competitionParam}=${tournament.api.competitionId}` +
            `&season=${tournament.api.season}` +
            `&timezone=Europe/Zurich`;
  return `https://${API_HOST}/fixtures?${q}`;
}

function buildVenueUrl(venueId) {
  return `https://${API_HOST}/venues?id=${venueId}`;
}

async function fetchVenueDetails(venueId, apiKey, venueCache) {
  if (!venueId) return null;
  const idStr = String(venueId);
  if (venueCache.has(idStr)) {
    return venueCache.get(idStr);
  }

  try {
    await delay(VENUE_DELAY_MS);
    const data = await fetchJson(buildVenueUrl(venueId), apiKey);
    const venueData = data && data.response && data.response[0];

    const details = venueData ? {
      id: venueData.id || venueId,
      name: venueData.name || '',
      address: venueData.address || '',
      city: venueData.city || '',
      country: venueData.country || '',
      capacity: venueData.capacity || null,
      surface: venueData.surface || '',
      image: venueData.image || ''
    } : null;

    venueCache.set(idStr, details);
    return details;
  } catch (err) {
    logWarn(`Venue ${venueId} konnte nicht geladen werden: ${err.message}`);
    venueCache.set(idStr, null);
    return null;
  }
}

/* ─────────────────────────────────────────────────────────────────────────────
 *  Firestore-Dokument bauen – Spielplan-Schema (siehe rangliste.html für
 *  Konsumenten).
 * ───────────────────────────────────────────────────────────────────────────── */
function buildFixtureDocument(fixture, venueDetails, tournament) {
  const f = fixture.fixture || {};
  const league = fixture.league || {};
  const teams = fixture.teams || {};
  const goals = fixture.goals || {};
  const FieldValue = admin.firestore.FieldValue;

  return {
    fixtureId: f.id,
    tournamentKey: tournament.key,
    tournamentType: tournament.type,
    tournamentYear: tournament.year,
    tournamentLabel: tournament.shortLabel,

    league: {
      id: league.id || null,
      name: league.name || '',
      country: league.country || '',
      logo: league.logo || '',
      flag: league.flag || '',
      season: league.season || null,
      round: league.round || ''
    },

    kickoffIso: f.date || '',
    kickoffTimestamp: f.timestamp || null,
    timezone: f.timezone || 'Europe/Zurich',

    referee: f.referee || '',

    status: {
      long: (f.status && f.status.long) || '',
      short: (f.status && f.status.short) || '',
      elapsed: (f.status && f.status.elapsed != null) ? f.status.elapsed : null
    },

    venue: {
      id: (f.venue && f.venue.id) || null,
      name: (venueDetails && venueDetails.name) || (f.venue && f.venue.name) || '',
      city: (venueDetails && venueDetails.city) || (f.venue && f.venue.city) || '',
      country: (venueDetails && venueDetails.country) || '',
      address: (venueDetails && venueDetails.address) || '',
      capacity: (venueDetails && venueDetails.capacity) || null,
      surface: (venueDetails && venueDetails.surface) || '',
      image: (venueDetails && venueDetails.image) || ''
    },

    homeTeam: {
      id: (teams.home && teams.home.id) || null,
      name: (teams.home && teams.home.name) || '',
      logo: (teams.home && teams.home.logo) || '',
      winner: (teams.home && teams.home.winner != null) ? teams.home.winner : null
    },

    awayTeam: {
      id: (teams.away && teams.away.id) || null,
      name: (teams.away && teams.away.name) || '',
      logo: (teams.away && teams.away.logo) || '',
      winner: (teams.away && teams.away.winner != null) ? teams.away.winner : null
    },

    goals: {
      home: (goals.home != null) ? goals.home : null,
      away: (goals.away != null) ? goals.away : null
    },

    score: fixture.score || {},

    updatedAt: FieldValue.serverTimestamp()
  };
}

/* ─────────────────────────────────────────────────────────────────────────────
 *  Firestore-Schreib-Workflow
 * ───────────────────────────────────────────────────────────────────────────── */
async function writeFixturesToFirestore(db, tournament, fixtureDocuments, opts) {
  const collection = tournament.firestore.fixturesCollection;

  if (opts.dryRun) {
    logInfo(`[DRY-RUN] Würde ${fixtureDocuments.length} Dokumente nach "${collection}" schreiben.`);
    return fixtureDocuments.length;
  }

  let batch = db.batch();
  let batchCount = 0;
  let totalWritten = 0;

  for (let i = 0; i < fixtureDocuments.length; i++) {
    const { id, data } = fixtureDocuments[i];
    const docRef = db.collection(collection).doc(id);
    batch.set(docRef, data, { merge: true });
    batchCount++;

    if (batchCount === 400) {
      await batch.commit();
      totalWritten += batchCount;
      batch = db.batch();
      batchCount = 0;
      logInfo(`Batch committed (${totalWritten} Dokumente bisher).`);
    }
  }

  if (batchCount > 0) {
    await batch.commit();
    totalWritten += batchCount;
  }

  return totalWritten;
}

async function bumpFixturesMetaVersion(db, tournament, opts) {
  if (opts.dryRun) {
    logInfo(`[DRY-RUN] Würde Meta ${tournament.firestore.metaCollection}/${tournament.firestore.metaDocId} hochzählen.`);
    return;
  }
  const FieldValue = admin.firestore.FieldValue;
  const ref = db
    .collection(tournament.firestore.metaCollection)
    .doc(tournament.firestore.metaDocId);
  await ref.set({
    tournamentKey: tournament.key,
    tournamentType: tournament.type,
    tournamentYear: tournament.year,
    tournamentLabel: tournament.shortLabel,
    year: tournament.year,
    fixturesVersion: FieldValue.increment(1),
    fixturesUpdatedAt: Date.now()
  }, { merge: true });
}

/* ─────────────────────────────────────────────────────────────────────────────
 *  Haupt-Workflow
 * ───────────────────────────────────────────────────────────────────────────── */
async function runSync(db, tournament, opts) {
  const apiKey = process.env.RAPIDAPI_KEY;
  if (!apiKey) throw new Error('RAPIDAPI_KEY ist nicht gesetzt.');

  const fixturesUrl = buildFixturesUrl(tournament);
  logInfo(`Lade Fixtures von API: ${fixturesUrl}`);
  const fixData = await fetchJson(fixturesUrl, apiKey);

  if (!fixData || !Array.isArray(fixData.response)) {
    throw new Error('API hat keine gültigen Fixture-Daten geliefert.');
  }

  const allFixtures = fixData.response;
  logInfo(`${allFixtures.length} Spiele von der API erhalten.`);

  // Eindeutige Venues sammeln und (optional) laden.
  const uniqueVenueIds = new Set();
  allFixtures.forEach(f => {
    const venueId = f && f.fixture && f.fixture.venue && f.fixture.venue.id;
    if (venueId) uniqueVenueIds.add(venueId);
  });
  logInfo(`${uniqueVenueIds.size} eindeutige Venue-IDs in den Fixtures gefunden.`);

  const venueCache = new Map();
  if (opts.skipVenues) {
    logInfo('SKIP_VENUES aktiv – Venue-Details werden nicht abgefragt. Es werden nur Name/City aus dem Fixture verwendet.');
  } else {
    const venueIds = Array.from(uniqueVenueIds);
    for (let i = 0; i < venueIds.length; i++) {
      await fetchVenueDetails(venueIds[i], apiKey, venueCache);
      if ((i + 1) % 5 === 0 || i === venueIds.length - 1) {
        logInfo(`Venue-Calls: ${i + 1}/${venueIds.length}`);
      }
    }
  }

  // Fixture-Dokumente bauen.
  const fixtureDocuments = [];
  for (const fixture of allFixtures) {
    const fixtureId = fixture && fixture.fixture && fixture.fixture.id;
    if (!fixtureId) {
      logWarn('Fixture ohne fixture.id übersprungen.');
      continue;
    }
    const venueId = fixture.fixture.venue && fixture.fixture.venue.id;
    const venueDetails = venueId ? (venueCache.get(String(venueId)) || null) : null;
    fixtureDocuments.push({
      id: String(fixtureId),
      data: buildFixtureDocument(fixture, venueDetails, tournament)
    });
  }

  const totalWritten = await writeFixturesToFirestore(db, tournament, fixtureDocuments, opts);
  logInfo(`${totalWritten} Fixture-Dokumente ${opts.dryRun ? '(DRY-RUN) berechnet' : 'in Firestore geschrieben'}.`);

  if (totalWritten > 0) {
    await bumpFixturesMetaVersion(db, tournament, opts);
    logInfo(`Meta ${tournament.firestore.metaCollection}/${tournament.firestore.metaDocId} ${opts.dryRun ? '(DRY-RUN) ' : ''}aktualisiert (fixturesVersion erhöht).`);
  } else {
    logWarn('Keine Fixtures geschrieben – Meta-Version nicht hochgezählt.');
  }

  return {
    totalFixtures: allFixtures.length,
    totalWritten,
    uniqueVenues: uniqueVenueIds.size
  };
}

/* ─────────────────────────────────────────────────────────────────────────────
 *  Entrypoint
 * ───────────────────────────────────────────────────────────────────────────── */
async function main() {
  const envKey = (process.env.TOURNAMENT_KEY || '').trim().toLowerCase();
  const tournamentKey = envKey || APP_CONFIG.activeTournamentKey;
  const tournament = TOURNAMENTS[tournamentKey];

  if (!tournament || !APP_CONFIG.isTournamentAvailable(tournamentKey)) {
    logError(
      `Ungültiger oder nicht verfügbarer TOURNAMENT_KEY="${tournamentKey}". ` +
      `Aktuell verfügbar laut tournament-config.js: ` +
      `${APP_CONFIG.getAvailableTournamentKeys().join(', ') || '(keine)'}. ` +
      `Env-Variable TOURNAMENT_KEY leer lassen, um den Default zu verwenden.`
    );
    process.exit(1);
  }
  if (!tournament.api || !tournament.api.competitionId) {
    logError(`Für Turnier ${tournament.shortLabel} ist keine API competitionId konfiguriert.`);
    process.exit(1);
  }

  const opts = {
    dryRun: envBool('DRY_RUN', false),
    skipVenues: envBool('SKIP_VENUES', false)
  };

  logInfo(`Starte Spielplan-Sync für ${tournament.shortLabel} (${tournament.key}).` +
    (opts.dryRun ? ' [DRY_RUN]' : '') +
    (opts.skipVenues ? ' [SKIP_VENUES]' : ''));

  let db;
  try {
    db = initFirebase();
  } catch (err) {
    logError(err.message);
    process.exit(1);
  }

  try {
    const result = await runSync(db, tournament, opts);
    logInfo(`✅ Lauf beendet. Fixtures (API): ${result.totalFixtures}, ` +
      `geschrieben: ${result.totalWritten}, Venues: ${result.uniqueVenues}.`);
  } catch (err) {
    logError(`Spielplan-Sync fehlgeschlagen: ${err.message}`);
    if (err.stack) console.error(err.stack);
    process.exit(2);
  }
}

main().catch(err => {
  logError('Unerwarteter Fehler: ' + (err && err.message || err));
  if (err && err.stack) console.error(err.stack);
  process.exit(2);
});
