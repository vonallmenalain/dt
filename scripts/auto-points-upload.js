#!/usr/bin/env node
/* =============================================================================
 *  scripts/auto-points-upload.js
 *
 *  Server-seitiger Auto-Upload der Punkte. Wird via GitHub Actions (Cron,
 *  alle paar Minuten) aufgerufen und schreibt die berechneten Punkte direkt
 *  nach Firebase – kein Browser-Tab und keine Admin-Seite nötig.
 *
 *  Ablauf pro Lauf:
 *    0. Phasen-Guard: wenn das aktive Turnier `AUTO_POINTS_FROM` /
 *       `AUTO_POINTS_UNTIL` definiert und die aktuelle Zeit ausserhalb
 *       dieses Fensters liegt, beendet sich der Lauf SOFORT mit Exit 0
 *       – ohne Firebase Admin zu initialisieren, ohne Firestore-Read
 *       und ohne API-Call. So entstehen ausserhalb der Turnierphase
 *       keine Quota-Kosten, selbst wenn der Workflow versehentlich
 *       läuft. `FORCE_RUN=1` übersteuert diesen Guard (manuelle Tests).
 *    1. Lädt Spielplan (`fixturesCollection`) initial aus Firestore und nutzt
 *       ihn danach run-weit aus dem In-Memory-Cache – keine API-Kosten.
 *    2. Bestimmt Kandidaten-Spiele: Anpfiff liegt mindestens
 *       `POINTS_WINDOW_START_MIN` Minuten entfernt/zurueck UND der Status ist
 *       entweder noch nicht FT/AET/PEN oder liegt als finaler Status noch
 *       im Reconciliation-Fenster (`POINTS_FINAL_RECHECK_MIN`). Mit den Defaults
 *       -30/150 startet der Live-Load 30 Minuten vor Anpfiff.
 *       `POINTS_WINDOW_END_MIN` dient danach als Schwelle, ab der ein offenes
 *       Spiel als "ueberfaellig" (Catch-up) markiert/geloggt wird – es
 *       gibt bewusst KEINE harte obere Zeitgrenze mehr fuer offene Spiele,
 *       damit verlaengerte oder verpasste Spiele automatisch nachgezogen
 *       werden. Wenn keine Kandidaten existieren, aber das naechste
 *       Live-Fenster bald beginnt, wartet der Run ohne API-Call darauf.
 *       So bleibt Live-Scoring robust, selbst wenn GitHub scheduled
 *       workflows nur unregelmaessig startet.
 *    3. Punkte-Workflow: API-Fixtures laden, Detail-Stats fuer Live- und
 *       Finalspiele auswerten, Punkte summieren, in Firestore schreiben
 *       und Meta-Dokument (`pointsUpdatedAt`, `pointsVersion`) hochzählen.
 *       Laufende und Final-Recheck-Kandidaten werden als Delta auf Basis
 *       der bestehenden Punktedokumente geschrieben; sobald ein Kandidat
 *       neu final wird oder FORCE_RUN aktiv ist, erfolgt eine volle
 *       Neuberechnung aller beendeten bzw. scoring-faehigen Spiele.
 *       `pointsUpdatedAt` wird ausschliesslich nach einem erfolgreichen
 *       Schreibvorgang erhöht – die "Zuletzt aktualisiert"-Anzeige auf
 *       rangliste.html ist also nur dann frisch, wenn neue Daten wirklich
 *       in Firebase liegen.
 *    4. Aktualisiert Status/Resultat im `fixturesCollection` und erhöht
 *       `fixturesVersion`, sobald Live-/Finaldaten geschrieben wurden –
 *       so laden Clients frische Spielstände/Resultate sofort nach.
 *
 *  Env-Variablen (aus GitHub Actions Secrets, manuellen Workflow-Inputs
 *  oder lokalen Tests; Scheduled Runs nutzen bei leeren Werten die Defaults):
 *    RAPIDAPI_KEY              RapidAPI / API-Football Key (zwingend)
 *    FIREBASE_SERVICE_ACCOUNT  Service-Account-JSON als String (zwingend)
 *    TOURNAMENT_KEY            Optional. Default = Fallback aus
 *                              tournament-config.js. Aktuell ist nur
 *                              `wm2026` produktiv konfiguriert; andere
 *                              Keys führen zu einem expliziten Abbruch.
 *    POINTS_WINDOW_START_MIN   Optional, Default -30. Start des Live-
 *                              Fensters relativ zum Anpfiff.
 *    POINTS_WINDOW_END_MIN     Optional, Default 150. Normales Ende des
 *                              Live-Fensters relativ zum Anpfiff. Danach
 *                              bleibt ein offenes Spiel als Catch-up-
 *                              Kandidat aktiv (siehe Ablauf-Schritt 2).
 *    POINTS_FINAL_RECHECK_MIN  Optional, Default 240. Beendete Spiele
 *                              bleiben bis so viele Minuten nach Anpfiff
 *                              Kandidaten, damit nachtraegliche API-
 *                              Korrekturen automatisch nachgezogen werden.
 *    POINTS_LIVE_TICKS_PER_RUN Optional, Default 520. Anzahl Ticks innerhalb
 *                              eines GitHub-Runs, wenn Kandidaten aktiv
 *                              sind. Scheduled Runs werden mindestens auf
 *                              520 Ticks gehoben; FORCE_RUN macht immer nur
 *                              einen Tick.
 *    POINTS_LIVE_TICK_INTERVAL_SEC
 *                              Optional, Default 30. Abstand zwischen den
 *                              Live-Ticks innerhalb desselben Runs.
 *                              Scheduled Runs werden mindestens auf 30s
 *                              gehoben, damit ein Lauf ein ganzes Spiel
 *                              zuverlaessig bis nach Abpfiff tragen kann.
 *    POINTS_IDLE_WAIT_MAX_MIN  Optional, Default 240. So lange darf ein Run
 *                              ohne Kandidaten auf das naechste Live-Fenster
 *                              warten, bevor er beendet.
 *    POINTS_SESSION_MAX_MIN    Optional, Default 350. Harte Obergrenze fuer
 *                              die gesamte Monitor-Session eines Runs.
 *    POINTS_API_RETRY_ATTEMPTS Optional, Default 3. API-Requests werden bei
 *                              transienten Fehlern so oft versucht.
 *    POINTS_API_RETRY_BASE_DELAY_MS
 *                              Optional, Default 1000. Basis-Wartezeit fuer
 *                              API-Retry-Backoff.
 *    POINTS_FIXTURE_PLAN_REFRESH_EVERY_TICKS
 *                              Optional, Default 20. Nach so vielen Live-
 *                              Ticks wird der run-weite Fixture-Plan-Cache
 *                              sicherheitshalber neu aus Firestore geladen.
 *                              Bei 0 nur initial laden.
 *    FORCE_RUN                 Falls `1`/`true`: Phasen-Guard UND
 *                              Pre-Check überspringen (manuelle Tests).
 *    DRY_RUN                   Falls `1`/`true`: nichts schreiben, nur loggen.
 *
 *  Exit-Codes:
 *    0  – Lauf abgeschlossen (nichts zu tun oder Upload erfolgreich)
 *    1  – Konfigurationsfehler / nicht behebbar
 *    2  – API/Netzwerkfehler oder Firestore-Schreibfehler
 * ============================================================================= */

'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');

let admin;
try {
  admin = require('firebase-admin');
} catch (err) {
  if (require.main === module) {
    console.error('[auto-points] firebase-admin ist nicht installiert. Bitte `npm install` ausführen.');
    process.exit(1);
  }
  admin = null;
}

let fetchFn = (typeof fetch === 'function') ? fetch : null;
if (!fetchFn) {
  try {
    fetchFn = require('node-fetch');
  } catch (err) {
    console.error('[auto-points] Globales fetch fehlt und node-fetch nicht installiert. Node 18+ verwenden.');
    process.exit(1);
  }
}

// Zentrale Turnier- und Regel-Konfiguration. Wird auch vom Browser
// (`window.APP_CONFIG`) gelesen, damit es nirgendwo eine zweite Tabelle
// gibt. Wer ein Turnier ergänzt oder eine Regel ändert, fasst NUR
// tournament-config.js an.
const APP_CONFIG = require('../tournament-config.js');
const TOURNAMENTS = APP_CONFIG.tournaments;
const RULES = APP_CONFIG.rules;
const {
  buildFixturesMapFromPlanCache,
  writePublicFixtureBundle
} = require('./fixture-public-cache.js');
const {
  DEFAULT_PUBLIC_POINTS_SHARD_COUNT,
  writePublicPointsCache,
  readPublicPointsShards
} = require('./points-public-cache.js');

const FINISHED_STATUSES = new Set(['FT', 'AET', 'PEN']);
const LIVE_STATUSES = new Set(['1H', 'HT', '2H', 'ET', 'BT', 'P', 'SUSP', 'INT', 'LIVE']);
const PRE_MATCH_LINEUP_STATUSES = new Set(['NS']);
const SCORING_STATUSES = new Set([...FINISHED_STATUSES, ...LIVE_STATUSES]);
const DEFAULT_WINDOW_START_MIN = -30;
const DEFAULT_WINDOW_END_MIN = 150;
const DEFAULT_FINAL_RECHECK_MIN = 240;
const DEFAULT_LIVE_TICKS_PER_RUN = 520;
const DEFAULT_LIVE_TICK_INTERVAL_SEC = 30;
const MAX_LIVE_TICKS_PER_RUN = 720;
const MIN_SCHEDULED_LIVE_TICKS_PER_RUN = 520;
const MIN_SCHEDULED_LIVE_TICK_INTERVAL_SEC = 30;
const DEFAULT_IDLE_WAIT_MAX_MIN = 240;
const DEFAULT_SESSION_MAX_MIN = 350;
const MIN_SCHEDULED_SESSION_MAX_MIN = 330;
const MAX_SESSION_MAX_MIN = 350;
const MIN_MONITOR_AFTER_WAKE_BUFFER_MIN = 10;
const DEFAULT_API_RETRY_ATTEMPTS = 3;
const DEFAULT_API_RETRY_BASE_DELAY_MS = 1000;
const DEFAULT_FIXTURE_PLAN_REFRESH_EVERY_TICKS = 20;
const WORKSPACE_ROOT = path.resolve(__dirname, '..');
const AUTO_POINTS_LOG_COLLECTION = 'Admin Auto Points Logs WM 2026';
const MAX_CHANGED_PLAYER_LOG_DOCS = 1200;
const MAX_AUDIT_FIXTURE_EVENTS = 300;

function getFixtureCountConfig(tournament) {
  const raw = tournament && tournament.fixtureCount && typeof tournament.fixtureCount === 'object'
    ? tournament.fixtureCount
    : {};
  const minPublished = Number(raw.minPublished || raw.min || 0);
  const expectedFinal = Number(raw.expectedFinal || raw.final || 0);
  return {
    minPublished: Number.isFinite(minPublished) && minPublished > 0 ? Math.floor(minPublished) : 0,
    expectedFinal: Number.isFinite(expectedFinal) && expectedFinal > 0 ? Math.floor(expectedFinal) : 0
  };
}

function cleanText(value) {
  return value == null ? '' : String(value).trim();
}

function isKnownFixtureTeamName(value) {
  const text = cleanText(value).toUpperCase();
  return !!text && text !== 'TBD' && text !== 'TBA' && text !== '-' && text !== '?';
}

function countKnownFixtureTeamSlots(fixtures) {
  return (fixtures || []).reduce((acc, fixture) => {
    const teams = fixture && fixture.teams ? fixture.teams : {};
    const home = teams.home || {};
    const away = teams.away || {};
    if (isKnownFixtureTeamName(home.name)) acc.names++;
    if (isKnownFixtureTeamName(away.name)) acc.names++;
    if (cleanText(home.logo)) acc.logos++;
    if (cleanText(away.logo)) acc.logos++;
    return acc;
  }, { names: 0, logos: 0 });
}

function assertApiFixtureListSafe(tournament, fixtures, contextLabel) {
  const fixtureCount = getFixtureCountConfig(tournament);
  const minPublished = fixtureCount.minPublished;
  if (!minPublished) return;

  const incomingCount = Array.isArray(fixtures) ? fixtures.length : 0;
  if (incomingCount < minPublished) {
    throw new Error(
      `${contextLabel} abgebrochen: API lieferte nur ${incomingCount} Fixtures, ` +
      `erwartet sind aktuell mindestens ${minPublished}.`
    );
  }

  const requiredKnownSlots = minPublished * 2;
  const knownSlots = countKnownFixtureTeamSlots(fixtures);
  if (knownSlots.names < requiredKnownSlots || knownSlots.logos < requiredKnownSlots) {
    throw new Error(
      `${contextLabel} abgebrochen: API-Fixture-Liste wirkt unvollstaendig ` +
      `(${knownSlots.names}/${requiredKnownSlots} Teamnamen, ` +
      `${knownSlots.logos}/${requiredKnownSlots} Logos fuer die publizierten Spiele).`
    );
  }
}

let activeAuditLog = null;

function envBool(name, fallback = false) {
  const v = (process.env[name] || '').trim().toLowerCase();
  if (v === '1' || v === 'true' || v === 'yes' || v === 'on') return true;
  if (v === '0' || v === 'false' || v === 'no' || v === 'off') return false;
  return fallback;
}

function envInt(name, fallback) {
  const v = parseInt(process.env[name] || '', 10);
  return Number.isFinite(v) ? v : fallback;
}

function envRaw(names) {
  const list = Array.isArray(names) ? names : [names];
  for (const name of list) {
    const raw = process.env[name];
    if (raw == null) continue;
    const value = String(raw).trim();
    if (value !== '') return value;
  }
  return '';
}

function envIntAny(names, fallback) {
  const raw = envRaw(names);
  if (!raw) return fallback;
  const value = parseInt(raw, 10);
  return Number.isFinite(value) ? value : fallback;
}

function envPositiveIntAny(names, fallback, max = null) {
  const value = envIntAny(names, null);
  const effective = Number.isInteger(value) && value > 0 ? value : fallback;
  return Number.isFinite(max) ? Math.min(max, effective) : effective;
}

function nowMs() {
  return Date.now();
}

/**
 * Parst einen ISO-8601-Zeitstempel (z. B. "2026-06-11T22:40:00+02:00")
 * defensiv und liefert Millisekunden seit Epoch zurück. Bei ungültigem
 * oder fehlendem Wert wird `null` zurückgegeben, damit der Aufrufer
 * entscheiden kann, was zu tun ist (üblicherweise: Feld ignorieren).
 */
function parseIsoToMs(value) {
  if (!value) return null;
  const ms = Date.parse(String(value));
  return Number.isFinite(ms) ? ms : null;
}

function normalizeEpochMs(value) {
  if (value == null || value === '') return null;

  if (typeof value.toMillis === 'function') {
    const ms = Number(value.toMillis());
    return Number.isFinite(ms) && ms > 0 ? ms : null;
  }

  if (typeof value.toDate === 'function') {
    const date = value.toDate();
    const ms = date instanceof Date ? date.getTime() : NaN;
    return Number.isFinite(ms) && ms > 0 ? ms : null;
  }

  if (value instanceof Date) {
    const ms = value.getTime();
    return Number.isFinite(ms) && ms > 0 ? ms : null;
  }

  if (typeof value === 'number') {
    if (!Number.isFinite(value) || value <= 0) return null;
    return value >= 100_000_000_000 ? value : value * 1000;
  }

  if (typeof value === 'string') {
    const raw = value.trim();
    if (!raw) return null;
    const numeric = Number(raw);
    if (Number.isFinite(numeric)) return normalizeEpochMs(numeric);
    const parsed = Date.parse(raw);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
  }

  if (typeof value === 'object') {
    const seconds = Number(value.seconds ?? value._seconds);
    if (Number.isFinite(seconds) && seconds > 0) {
      const nanos = Number(value.nanoseconds ?? value._nanoseconds ?? 0);
      return seconds * 1000 + (Number.isFinite(nanos) ? Math.floor(nanos / 1_000_000) : 0);
    }
  }

  return null;
}

function firstPositiveEpochMs(values) {
  for (const value of values) {
    const ms = normalizeEpochMs(value);
    if (ms) return ms;
  }
  return null;
}

function logInfo(msg) {
  console.log(`[auto-points] ${msg}`);
}

function recordAuditWarning(msg) {
  if (!activeAuditLog || !Array.isArray(activeAuditLog.warnings)) return;
  const value = String(msg || '').trim();
  if (!value) return;
  activeAuditLog.warnings.push(value);
}

function logWarn(msg) {
  recordAuditWarning(msg);
  console.warn(`[auto-points] ⚠️ ${msg}`);
}

function logError(msg) {
  console.error(`[auto-points] ❌ ${msg}`);
}

function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function createApiCallCounter() {
  return { fixtureList: 0, detailBatches: 0, total: 0 };
}

function incrementApiCallCounter(opts, key) {
  const audit = opts && opts.audit;
  if (!audit || !audit.apiCalls) return;
  if (key === 'fixtureList') {
    audit.apiCalls.fixtureList += 1;
  } else if (key === 'detailBatches') {
    audit.apiCalls.detailBatches += 1;
  }
  audit.apiCalls.total = audit.apiCalls.fixtureList + audit.apiCalls.detailBatches;
}

function getApiRetryAttempts(opts) {
  const n = opts && typeof opts.apiRetryAttempts === 'number' ? opts.apiRetryAttempts : DEFAULT_API_RETRY_ATTEMPTS;
  return Math.max(1, Math.floor(n));
}

function getApiRetryBaseDelayMs(opts) {
  const n = opts && typeof opts.apiRetryBaseDelayMs === 'number' ? opts.apiRetryBaseDelayMs : DEFAULT_API_RETRY_BASE_DELAY_MS;
  return Math.max(0, Math.floor(n));
}

function isRetriableHttpStatus(status) {
  return status === 408 || status === 425 || status === 429 || status >= 500;
}

function retryAfterHeaderMs(response) {
  if (!response || !response.headers || typeof response.headers.get !== 'function') return null;
  const raw = response.headers.get('retry-after');
  if (!raw) return null;

  const seconds = Number(raw);
  if (Number.isFinite(seconds) && seconds >= 0) return seconds * 1000;

  const dateMs = Date.parse(raw);
  if (Number.isFinite(dateMs)) return Math.max(0, dateMs - Date.now());
  return null;
}

function getApiRetryDelayMs(opts, attempt, response) {
  const retryAfterMs = retryAfterHeaderMs(response);
  if (retryAfterMs != null) return Math.min(retryAfterMs, 15_000);

  const base = getApiRetryBaseDelayMs(opts);
  if (base <= 0) return 0;
  return Math.min(base * Math.pow(2, Math.max(0, attempt - 1)), 8_000);
}

async function fetchApiJson(url, requestOptions, label, opts = {}, counterKey = null) {
  const attempts = getApiRetryAttempts(opts);
  let lastError = null;

  for (let attempt = 1; attempt <= attempts; attempt++) {
    let response = null;

    try {
      if (counterKey) incrementApiCallCounter(opts, counterKey);
      response = await fetchFn(url, requestOptions);
    } catch (err) {
      lastError = new Error(`${label}: Netzwerkfehler: ${err.message}`);
    }

    if (response) {
      if (response.ok) {
        try {
          return await response.json();
        } catch (err) {
          lastError = new Error(`${label}: Antwort liess sich nicht als JSON parsen: ${err.message}`);
        }
      } else {
        const suffix = response.statusText ? ` ${response.statusText}` : '';
        lastError = new Error(`${label}: HTTP ${response.status}${suffix}`);
        if (!isRetriableHttpStatus(response.status)) throw lastError;
      }
    }

    if (attempt < attempts) {
      const delayMs = getApiRetryDelayMs(opts, attempt, response);
      logWarn(`${label}: Versuch ${attempt}/${attempts} fehlgeschlagen (${lastError.message}). ` +
        `Neuer Versuch in ${(delayMs / 1000).toFixed(1)}s.`);
      if (delayMs > 0) await delay(delayMs);
    }
  }

  throw lastError || new Error(`${label}: API-Request fehlgeschlagen.`);
}

function createTickAudit(tournament, opts, tickIndex, totalTicks) {
  return {
    createdAtMs: Date.now(),
    tournamentKey: tournament.key,
    githubRunId: process.env.GITHUB_RUN_ID || '',
    githubRunAttempt: process.env.GITHUB_RUN_ATTEMPT || '',
    githubSha: process.env.GITHUB_SHA || '',
    githubWorkflow: process.env.GITHUB_WORKFLOW || '',
    trigger: process.env.GITHUB_EVENT_NAME || '',
    forceRun: !!opts.forceRun,
    dryRun: !!opts.dryRun,
    tickIndex,
    totalTicks,
    windowStartMin: opts.windowStartMin,
    windowEndMin: opts.windowEndMin,
    finalRecheckMin: opts.finalRecheckMin,
    liveTicksPerRun: opts.forceRun ? 1 : opts.liveTicksPerRun,
    liveTickIntervalSec: opts.liveTickIntervalSec,
    apiRetryAttempts: opts.apiRetryAttempts,
    apiRetryBaseDelayMs: opts.apiRetryBaseDelayMs,
    fixturePlanCacheHit: false,
    fixturePlanRefreshed: false,
    firestoreReadEstimate: { fixturePlanDocs: 0 },
    candidateFixtureIds: [],
    scoringFixtureIds: [],
    liveFixtureIds: [],
    finishedGamesTotal: 0,
    candidatesNowFinished: 0,
    newlyFinished: 0,
    newlyFinishedFixtureIds: [],
    ownGoalRecheckFixtureIds: [],
    ownGoalRecheckCount: 0,
    shouldFullRecompute: false,
    apiCalls: createApiCallCounter(),
    writeResult: { written: 0, deleted: 0, skipped: 0, touched: 0 },
    fixtureWriteResult: { updated: 0, skipped: 0 },
    earlyFixtureWriteResult: { updated: 0, skipped: 0 },
    detailFixtureWriteResult: { updated: 0, skipped: 0 },
    fixtureEvents: [],
    fixtureEventsCount: 0,
    fixtureEventsTruncated: false,
    pointsVersionIncreased: false,
    fixturesVersionIncreased: false,
    changedPlayers: new Map(),
    changedPlayersCount: 0,
    changedPlayersTruncated: false,
    warnings: [],
    error: null
  };
}

function isRelevantAuditTick(audit) {
  if (!audit) return false;
  return !!audit.forceRun ||
    (Array.isArray(audit.candidateFixtureIds) && audit.candidateFixtureIds.length > 0) ||
    (audit.apiCalls && audit.apiCalls.total > 0) ||
    (Array.isArray(audit.warnings) && audit.warnings.length > 0) ||
    !!audit.error;
}

function serializeAuditLog(audit) {
  const FieldValue = admin.firestore.FieldValue;
  return {
    createdAt: FieldValue.serverTimestamp(),
    createdAtMs: audit.createdAtMs || Date.now(),
    tournamentKey: audit.tournamentKey || '',
    githubRunId: audit.githubRunId || '',
    githubRunAttempt: audit.githubRunAttempt || '',
    githubSha: audit.githubSha || '',
    githubWorkflow: audit.githubWorkflow || '',
    trigger: audit.trigger || '',
    forceRun: !!audit.forceRun,
    dryRun: !!audit.dryRun,
    tickIndex: audit.tickIndex || 0,
    totalTicks: audit.totalTicks || 0,
    windowStartMin: audit.windowStartMin,
    windowEndMin: audit.windowEndMin,
    finalRecheckMin: audit.finalRecheckMin,
    liveTicksPerRun: audit.liveTicksPerRun,
    liveTickIntervalSec: audit.liveTickIntervalSec,
    apiRetryAttempts: audit.apiRetryAttempts || null,
    apiRetryBaseDelayMs: audit.apiRetryBaseDelayMs || null,
    fixturePlanCacheHit: !!audit.fixturePlanCacheHit,
    fixturePlanRefreshed: !!audit.fixturePlanRefreshed,
    firestoreReadEstimate: audit.firestoreReadEstimate || { fixturePlanDocs: 0 },
    candidateFixtureIds: Array.isArray(audit.candidateFixtureIds) ? audit.candidateFixtureIds : [],
    scoringFixtureIds: Array.isArray(audit.scoringFixtureIds) ? audit.scoringFixtureIds : [],
    liveFixtureIds: Array.isArray(audit.liveFixtureIds) ? audit.liveFixtureIds : [],
    finishedGamesTotal: audit.finishedGamesTotal || 0,
    candidatesNowFinished: audit.candidatesNowFinished || 0,
    newlyFinished: audit.newlyFinished || 0,
    newlyFinishedFixtureIds: Array.isArray(audit.newlyFinishedFixtureIds) ? audit.newlyFinishedFixtureIds : [],
    ownGoalRecheckFixtureIds: Array.isArray(audit.ownGoalRecheckFixtureIds) ? audit.ownGoalRecheckFixtureIds : [],
    ownGoalRecheckCount: audit.ownGoalRecheckCount || 0,
    shouldFullRecompute: !!audit.shouldFullRecompute,
    apiCalls: audit.apiCalls || createApiCallCounter(),
    writeResult: audit.writeResult || { written: 0, deleted: 0, skipped: 0, touched: 0 },
    fixtureWriteResult: audit.fixtureWriteResult || { updated: 0, skipped: 0 },
    earlyFixtureWriteResult: audit.earlyFixtureWriteResult || { updated: 0, skipped: 0 },
    detailFixtureWriteResult: audit.detailFixtureWriteResult || { updated: 0, skipped: 0 },
    fixtureEvents: Array.isArray(audit.fixtureEvents) ? audit.fixtureEvents : [],
    fixtureEventsCount: audit.fixtureEventsCount || 0,
    fixtureEventsTruncated: !!audit.fixtureEventsTruncated,
    pointsVersionIncreased: !!audit.pointsVersionIncreased,
    fixturesVersionIncreased: !!audit.fixturesVersionIncreased,
    changedPlayersCount: audit.changedPlayersCount || 0,
    changedPlayersTruncated: !!audit.changedPlayersTruncated,
    warnings: Array.isArray(audit.warnings) ? audit.warnings : [],
    error: audit.error || null
  };
}

async function writeChangedPlayerAuditDocs(db, logRef, changedPlayers) {
  const entries = changedPlayers instanceof Map ? Array.from(changedPlayers.entries()) : [];
  if (entries.length === 0) return;

  let batch = db.batch();
  let countInBatch = 0;
  let bytesInBatch = 0;

  for (const [playerId, payload] of entries) {
    const docRef = logRef.collection('changedPlayers').doc(String(playerId));
    batch.set(docRef, payload);
    countInBatch++;
    bytesInBatch += approxPointDocBytes(payload);

    // Auch hier gegen die 10-MiB-Transaktionsgrenze absichern (viele
    // geaenderte Spieler bei einem Full-Recompute, z. B. CL-Backfill).
    if (countInBatch >= MAX_POINTS_BATCH_COUNT || bytesInBatch >= MAX_POINTS_BATCH_BYTES) {
      await batch.commit();
      batch = db.batch();
      countInBatch = 0;
      bytesInBatch = 0;
    }
  }

  if (countInBatch > 0) {
    await batch.commit();
  }
}

async function maybeWriteTickAudit(db, audit) {
  if (!isRelevantAuditTick(audit)) return;

  try {
    const logRef = db.collection(AUTO_POINTS_LOG_COLLECTION).doc();
    const changedPlayers = audit.changedPlayers instanceof Map ? audit.changedPlayers : new Map();
    await logRef.set(serializeAuditLog(audit));
    await writeChangedPlayerAuditDocs(db, logRef, changedPlayers);
    logInfo(`Audit-Log geschrieben: ${AUTO_POINTS_LOG_COLLECTION}/${logRef.id}`);
  } catch (err) {
    console.warn(`[auto-points] ⚠️ Audit-Log konnte nicht geschrieben werden: ${err.message}`);
  }
}

/**
 * Teilt ein Array in Bloecke fester Maximalgroesse auf. Wird genutzt,
 * um Detail-Calls fuer Fixtures gebuendelt abzusetzen (API-FOOTBALL
 * unterstuetzt ueber den `ids`-Parameter bis zu 20 IDs pro Request).
 */
function chunk(items, size) {
  const result = [];
  if (!Array.isArray(items) || size <= 0) return result;
  for (let i = 0; i < items.length; i += size) {
    result.push(items.slice(i, i + size));
  }
  return result;
}

function normalizePosition(pos) {
  const value = String(pos || '').toUpperCase();
  if (value === 'FORWARD') return 'ATTACKER';
  return value;
}

function getFixtureStatusShort(game) {
  return (game && game.fixture && game.fixture.status && game.fixture.status.short) || '';
}

function isFinishedFixture(game) {
  return FINISHED_STATUSES.has(getFixtureStatusShort(game));
}

function isScoringFixture(game) {
  return SCORING_STATUSES.has(getFixtureStatusShort(game));
}

function isPreMatchLineupCandidate(game) {
  return PRE_MATCH_LINEUP_STATUSES.has(getFixtureStatusShort(game));
}

function getFirestoreStatusShort(data) {
  if (!data || typeof data !== 'object') return '';
  const value =
    (data.status && typeof data.status === 'object' && data.status.short) ||
    data.statusShort ||
    (data.fixture && data.fixture.status && data.fixture.status.short) ||
    '';
  return String(value || '').toUpperCase();
}

function getFirestoreStatusLong(data) {
  if (!data || typeof data !== 'object') return '';
  return String(
    (data.status && typeof data.status === 'object' && data.status.long) ||
    data.statusLong ||
    (data.fixture && data.fixture.status && data.fixture.status.long) ||
    ''
  );
}

function getFirestoreStatusElapsed(data) {
  if (!data || typeof data !== 'object') return null;
  const value =
    (data.status && typeof data.status === 'object' ? data.status.elapsed : null) ??
    data.statusElapsed ??
    (data.fixture && data.fixture.status ? data.fixture.status.elapsed : null);
  return value != null ? value : null;
}

function getFirestoreFixtureApiId(data, doc) {
  const candidates = [
    data && data.fixtureId,
    data && data.apiFixtureId,
    data && data.id,
    data && data.fixture && data.fixture.id,
    doc && doc.id
  ];
  for (const value of candidates) {
    if (value !== undefined && value !== null && String(value).trim() !== '') {
      return String(value).trim();
    }
  }
  return doc && doc.id ? String(doc.id) : '';
}

function getFirestoreFixtureKickoffMs(data) {
  if (!data || typeof data !== 'object') return null;
  return firstPositiveEpochMs([
    data.kickoffTimestamp,
    data.kickoffIso,
    data.fixture && data.fixture.timestamp,
    data.fixture && data.fixture.date
  ]);
}

function formatAgeMin(ageMin) {
  if (typeof ageMin !== 'number' || !Number.isFinite(ageMin)) return 'unbekannter Abstand';
  if (ageMin < 0) return `${Math.abs(ageMin)} min VOR ANPFIFF`;
  if (ageMin === 0) return '0 min NACH ANPFIFF';
  return `${ageMin} min NACH ANPFIFF`;
}

function formatDurationMs(ms) {
  const totalSec = Math.max(0, Math.round((Number(ms) || 0) / 1000));
  const hours = Math.floor(totalSec / 3600);
  const minutes = Math.floor((totalSec % 3600) / 60);
  const seconds = totalSec % 60;
  const parts = [];
  if (hours) parts.push(`${hours}h`);
  if (minutes || hours) parts.push(`${minutes}m`);
  parts.push(`${seconds}s`);
  return parts.join(' ');
}

function uniqueGamesByFixtureId(games) {
  const byId = new Map();
  (games || []).forEach(game => {
    const id = game && game.fixture && game.fixture.id;
    if (id == null) return;
    byId.set(String(id), game);
  });
  return Array.from(byId.values());
}

/* ─────────────────────────────────────────────────────────────────────────────
 *  Kader-Datei (data-<key>.js) per VM laden – exportiert `playersData`.
 *  Anschliessend optional Positions-Overrides aus position-overrides.js
 *  anwenden, damit das Server-Script exakt mit derselben Position rechnet
 *  wie der Client.
 * ───────────────────────────────────────────────────────────────────────────── */
function loadPlayersData(tournament) {
  const dataPath = path.join(WORKSPACE_ROOT, tournament.dataFile);
  if (!fs.existsSync(dataPath)) {
    throw new Error(`Kader-Datei "${tournament.dataFile}" nicht gefunden unter ${dataPath}`);
  }
  const code = fs.readFileSync(dataPath, 'utf-8');
  const ctx = { console };
  vm.createContext(ctx);
  // `const playersData = [...]` wird so direkt in den Context geschrieben
  // und am Ende explizit auf `this.playersData` gespiegelt.
  vm.runInContext(`${code}\n;this.playersData = playersData;`, ctx, {
    filename: tournament.dataFile,
    timeout: 15000
  });
  if (!Array.isArray(ctx.playersData)) {
    throw new Error(`${tournament.dataFile} hat playersData nicht als Array definiert.`);
  }
  return ctx.playersData;
}

function applyPositionOverrides(playersData, tournamentKey) {
  const overridesPath = path.join(WORKSPACE_ROOT, 'position-overrides.js');
  if (!fs.existsSync(overridesPath)) {
    logWarn('position-overrides.js nicht gefunden – Positionen aus der Kader-Datei werden 1:1 verwendet.');
    return { applied: 0, total: 0 };
  }
  const code = fs.readFileSync(overridesPath, 'utf-8');
  const ctx = { window: {}, console };
  vm.createContext(ctx);
  vm.runInContext(code, ctx, { filename: 'position-overrides.js', timeout: 5000 });

  const all = (ctx.window && ctx.window.POSITION_OVERRIDES) || {};
  const raw = (all[tournamentKey] && typeof all[tournamentKey] === 'object') ? all[tournamentKey] : {};
  const allowed = { GOALKEEPER: 1, DEFENDER: 1, MIDFIELDER: 1, ATTACKER: 1 };

  const lookup = {};
  Object.keys(raw).forEach(id => {
    const norm = normalizePosition(raw[id]);
    if (allowed[norm]) lookup[String(id)] = norm;
  });

  let applied = 0;
  for (const p of playersData) {
    if (!p) continue;
    const pid = (p['player.id'] != null) ? String(p['player.id']) : '';
    if (!pid) continue;
    const target = lookup[pid];
    if (!target) continue;
    const current = normalizePosition(p.Position);
    if (current === target) continue;
    if (typeof p.PositionOriginal === 'undefined') p.PositionOriginal = p.Position;
    p.Position = target;
    applied++;
  }
  return { applied, total: Object.keys(lookup).length };
}

function buildApiToAppPlayerIdMap(playersData) {
  const apiToApp = new Map();
  const duplicates = [];
  let explicitMappings = 0;

  (playersData || []).forEach(player => {
    if (!player || player['player.id'] == null) return;

    const appPlayerId = String(player['player.id']);
    const hasExplicitApiId = player.apiSportsPlayerId != null && String(player.apiSportsPlayerId) !== '';
    const apiPlayerId = hasExplicitApiId ? String(player.apiSportsPlayerId) : appPlayerId;

    if (hasExplicitApiId && apiPlayerId !== appPlayerId) explicitMappings++;

    const existingAppId = apiToApp.get(apiPlayerId);
    if (existingAppId && existingAppId !== appPlayerId) {
      duplicates.push(`${apiPlayerId} -> ${existingAppId} / ${appPlayerId}`);
      return;
    }
    apiToApp.set(apiPlayerId, appPlayerId);
  });

  if (duplicates.length > 0) {
    throw new Error(
      'Doppelte apiSportsPlayerId-Werte im Kader: ' +
      duplicates.join(', ')
    );
  }

  return { apiToApp, explicitMappings };
}

function toAppPlayerId(apiToAppPlayerId, rawPlayerId) {
  if (rawPlayerId == null) return null;
  const apiPlayerId = String(rawPlayerId);
  return (apiToAppPlayerId && apiToAppPlayerId.get(apiPlayerId)) || apiPlayerId;
}

function normalizeScoringText(value) {
  return String(value == null ? '' : value).replace(/\s+/g, ' ').trim();
}

function getScoringEventDetail(event) {
  return normalizeScoringText(event && event.detail);
}

function getScoringEventType(event) {
  return normalizeScoringText(event && event.type);
}

function getScoringEventPlayerId(event, apiToAppPlayerId) {
  const rawId = event && event.player && event.player.id != null
    ? event.player.id
    : event && event.playerId != null
      ? event.playerId
      : null;
  return toAppPlayerId(apiToAppPlayerId, rawId);
}

function getScoringEventTeamId(event) {
  if (event && event.team && event.team.id != null) return String(event.team.id);
  if (event && event.teamId != null) return String(event.teamId);
  return '';
}

function getScoringEventMinute(event, key) {
  const value = event && event.time && event.time[key] != null
    ? event.time[key]
    : event && event[key] != null
      ? event[key]
      : null;
  return value == null ? '' : String(value);
}

function isOwnGoalScoringEvent(event) {
  const detail = getScoringEventDetail(event).toLowerCase();
  const type = getScoringEventType(event).toLowerCase();
  return detail.includes('own goal') && (!type || type === 'goal');
}

function getFixtureGoalEventsForScoring(fixtureData, opts = {}) {
  const combined = [];
  const seen = new Set();
  const add = (event) => {
    if (!event || typeof event !== 'object') return;
    const playerId = getScoringEventPlayerId(event, opts.apiToAppPlayerId || null) || '';
    const detail = getScoringEventDetail(event).toLowerCase();
    const type = getScoringEventType(event).toLowerCase();
    const elapsed = getScoringEventMinute(event, 'elapsed');
    const extra = getScoringEventMinute(event, 'extra');
    const teamId = getScoringEventTeamId(event);
    const key = detail.includes('own goal')
      ? `own-goal|${playerId}|${teamId}|${elapsed}`
      : `${type}|${detail}|${playerId}|${teamId}|${elapsed}|${extra}`;
    if (seen.has(key)) return;
    seen.add(key);
    combined.push(event);
  };

  (Array.isArray(fixtureData && fixtureData.events) ? fixtureData.events : []).forEach(add);
  (Array.isArray(opts.firestoreGoalEvents) ? opts.firestoreGoalEvents : []).forEach(add);
  return combined;
}

function normalizeScoringTeamName(value) {
  return normalizeScoringText(value).toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

function playerBelongsToFixtureTeam(player, team) {
  const playerNation = normalizeScoringTeamName(player && player['Nationalteam.name']);
  const teamName = normalizeScoringTeamName(team && team.name);
  return !!playerNation && !!teamName && playerNation === teamName;
}

/* ─────────────────────────────────────────────────────────────────────────────
 *  Firebase Admin Initialisierung
 * ───────────────────────────────────────────────────────────────────────────── */
function initFirebase() {
  if (!admin) {
    throw new Error('firebase-admin ist nicht installiert. Bitte `npm install` ausführen.');
  }
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
 *  Pre-Check (nur Firestore – keine API-Quota)
 *
 *  Lädt den kompletten Spielplan run-weit gecacht und entscheidet, ob der teure
 *  Upload-Workflow überhaupt anlaufen muss. Ein Spiel zählt als Kandidat,
 *  wenn sein Anpfiff (kickoffTimestamp) mindestens `windowStartMin`
 *  Minuten entfernt ist und das Spiel in Firestore noch nicht als beendet
 *  markiert ist oder noch im finalen Reconciliation-Fenster liegt. Mit den
 *  Live-Defaults -30/150 startet der teure API-Teil vor dem Kickoff
 *  und läuft während des Spiels. Nach `windowEndMin` bleibt ein offenes
 *  Spiel als Catch-up-Kandidat aktiv, bis Firestore den Finalstatus kennt.
 *  Danach wird ein finaler Status noch `finalRecheckMin` Minuten nach
 *  Anpfiff weiter geprüft, damit nachtraegliche API-Korrekturen nicht
 *  manuell nachgezogen werden muessen.
 * ───────────────────────────────────────────────────────────────────────────── */
function normalizeFixturePlanCache(cache) {
  const target = cache && typeof cache === 'object' ? cache : {};
  if (!Array.isArray(target.all)) target.all = [];
  if (!(target.byId instanceof Map)) {
    const map = new Map();
    if (target.byId && typeof target.byId === 'object') {
      Object.keys(target.byId).forEach(key => map.set(String(key), target.byId[key]));
    }
    target.byId = map;
  }
  if (typeof target.loadedAtMs !== 'number') target.loadedAtMs = 0;
  if (typeof target.lastRefreshTick !== 'number') target.lastRefreshTick = 0;
  if (typeof target.cacheGenerationMs !== 'number') target.cacheGenerationMs = 0;
  return target;
}

function getCurrentTickIndex(opts) {
  const tickIndex = opts && opts.audit && Number.isFinite(opts.audit.tickIndex)
    ? opts.audit.tickIndex
    : opts && Number.isFinite(opts.tickIndex)
      ? opts.tickIndex
      : 0;
  return Math.max(0, Math.floor(tickIndex));
}

function getFixturePlanRefreshEveryTicks(opts) {
  const raw = opts && Number.isFinite(opts.fixturePlanRefreshEveryTicks)
    ? opts.fixturePlanRefreshEveryTicks
    : DEFAULT_FIXTURE_PLAN_REFRESH_EVERY_TICKS;
  return Math.max(0, Math.floor(raw));
}

function shouldRefreshFixturePlanCache(cache, opts) {
  if (!cache.loadedAtMs || !Array.isArray(cache.all) || cache.all.length === 0) return true;

  const refreshEveryTicks = getFixturePlanRefreshEveryTicks(opts);
  if (refreshEveryTicks <= 0) return false;

  const tickIndex = getCurrentTickIndex(opts);
  if (tickIndex <= 0 || !cache.lastRefreshTick) return false;
  return tickIndex - cache.lastRefreshTick >= refreshEveryTicks;
}

function rememberFixturePlanReadForAudit(opts, docsRead, refreshed, cacheHit) {
  const audit = opts && opts.audit;
  if (!audit) return;
  audit.fixturePlanCacheHit = !!cacheHit;
  audit.fixturePlanRefreshed = !!refreshed;
  if (!audit.firestoreReadEstimate || typeof audit.firestoreReadEstimate !== 'object') {
    audit.firestoreReadEstimate = { fixturePlanDocs: 0 };
  }
  audit.firestoreReadEstimate.fixturePlanDocs =
    (audit.firestoreReadEstimate.fixturePlanDocs || 0) + (docsRead || 0);
}

async function refreshFixturePlanCache(db, tournament, opts, cache) {
  const collectionName = tournament.firestore.fixturesCollection;
  const snap = await db.collection(collectionName).get();
  const loadedAtMs = nowMs();
  const tickIndex = getCurrentTickIndex(opts);

  cache.all = [];
  cache.byId = new Map();
  cache.loadedAtMs = loadedAtMs;
  cache.lastRefreshTick = tickIndex;

  snap.forEach(doc => {
    const data = doc.data() || {};
    const apiFixtureId = getFirestoreFixtureApiId(data, doc);
    const record = {
      id: apiFixtureId || String(doc.id),
      docId: String(doc.id),
      data
    };
    cache.all.push(record);
    if (record.id) cache.byId.set(String(record.id), record);
    cache.byId.set(String(doc.id), record);
  });

  rememberFixturePlanReadForAudit(opts, snap.size, true, false);
  logInfo(`Fixture-Plan-Cache aus Firestore geladen (${snap.size} Dokument-Reads geschaetzt).`);
  return cache;
}

function assertFixturePlanCacheSafe(tournament, cache) {
  const minPublished = getFixtureCountConfig(tournament).minPublished;
  if (!minPublished) return;
  const count = cache && Array.isArray(cache.all) ? cache.all.length : 0;
  if (count < minPublished) {
    throw new Error(
      `Fixture-Plan-Cache unvollstaendig: Firestore enthaelt nur ${count} Fixtures, ` +
      `erwartet sind aktuell mindestens ${minPublished}.`
    );
  }
}

function getFixturePlanCache(opts) {
  if (!opts.fixturePlanCache || typeof opts.fixturePlanCache !== 'object') {
    opts.fixturePlanCache = {};
  }
  return normalizeFixturePlanCache(opts.fixturePlanCache);
}

async function ensureFixturePlanCacheLoaded(db, tournament, opts, forceRefresh = false) {
  const cache = getFixturePlanCache(opts);
  const needsRefresh = forceRefresh || shouldRefreshFixturePlanCache(cache, opts);
  if (needsRefresh) {
    await refreshFixturePlanCache(db, tournament, opts, cache);
  } else {
    rememberFixturePlanReadForAudit(opts, 0, false, true);
  }
  assertFixturePlanCacheSafe(tournament, cache);
  return cache;
}

function buildFixtureInfoFromPlanRecord(record) {
  const data = (record && record.data) || {};
  const doc = { id: record && record.docId != null ? String(record.docId) : '' };
  const kickoffMs = getFirestoreFixtureKickoffMs(data);
  const apiFixtureId = getFirestoreFixtureApiId(data, doc);
  const statusShort = getFirestoreStatusShort(data);
  const homeName = (data.homeTeam && data.homeTeam.name) || '';
  const awayName = (data.awayTeam && data.awayTeam.name) || '';

  return {
    id: apiFixtureId,
    docId: doc.id,
    kickoffMs,
    statusShort,
    statusLong: getFirestoreStatusLong(data),
    statusElapsed: getFirestoreStatusElapsed(data),
    goalsHome: (data.goals && data.goals.home) != null ? data.goals.home : null,
    goalsAway: (data.goals && data.goals.away) != null ? data.goals.away : null,
    score: data.score || {},
    goalEvents: Array.isArray(data.goalEvents) ? data.goalEvents : [],
    homeWinner: (data.homeTeam && data.homeTeam.winner != null) ? data.homeTeam.winner : null,
    awayWinner: (data.awayTeam && data.awayTeam.winner != null) ? data.awayTeam.winner : null,
    label: (homeName && awayName) ? `${homeName} vs ${awayName}` : `Spiel ${apiFixtureId || doc.id}`
  };
}

function selectCandidateFixturesFromCache(cache, opts) {
  const now = nowMs();
  const windowStartMs = opts.windowStartMin * 60_000;
  const windowEndMs = opts.windowEndMin * 60_000;
  const finalRecheckMs = opts.finalRecheckMin * 60_000;

  const all = [];
  const candidates = [];
  let nextWakeAtMs = null;

  cache.all.forEach(record => {
    const fxInfo = buildFixtureInfoFromPlanRecord(record);
    all.push(fxInfo);

    if (!fxInfo.kickoffMs) return;

    const ageMs = now - fxInfo.kickoffMs;
    const isFinished = FINISHED_STATUSES.has(fxInfo.statusShort);
    const notFinished = !isFinished;
    const inFinalRecheck = isFinished && opts.finalRecheckMin > 0 && ageMs >= 0 && ageMs <= finalRecheckMs;
    const windowOpenMs = fxInfo.kickoffMs + windowStartMs;

    if (notFinished && windowOpenMs > now && (nextWakeAtMs == null || windowOpenMs < nextWakeAtMs)) {
      nextWakeAtMs = windowOpenMs;
    }

    // Ein Spiel ist Kandidat, sobald sein Anpfiff mindestens
    // `windowStartMin` Minuten entfernt/zurueckliegt UND es entweder in
    // Firestore noch NICHT als beendet (FT/AET/PEN) markiert ist oder noch
    // im finalen Reconciliation-Fenster liegt. Es gibt bewusst KEINE harte
    // obere Zeitgrenze fuer offene Spiele:
    //
    //   Ein Spiel, das das urspruengliche Trigger-Fenster wegen API-/
    //   Netzwerkproblemen verpasst hat, blieb sonst dauerhaft ungescored,
    //   bis jemand manuell FORCE_RUN ausloest. Mit diesem Catch-up
    //   triggert jeder weitere Tick erneut, bis der Status in Firestore
    //   auf beendet gesetzt wurde (was nach erfolgreicher Verarbeitung
    //   in updateFixtureStatusInFirestore passiert).
    //
    // Beendete Spiele werden danach noch fuer `POINTS_FINAL_RECHECK_MIN` Minuten
    // nach Anpfiff erneut geprueft. Damit zieht der naechste Cron-Tick
    // spaete API-Korrekturen an Scorern, Assists, Karten usw. automatisch
    // nach.
    //
    // Quota-Schutz bleibt erhalten: der Spielplan kommt aus dem
    // run-weiten Cache und wird nur initial bzw. per Sicherheitsrefresh
    // vollstaendig aus Firestore gelesen. Das Phasen-Fenster
    // (AUTO_POINTS_UNTIL) begrenzt Catch-up und Reconciliation zeitlich
    // nach oben.
    if (ageMs >= windowStartMs && (notFinished || inFinalRecheck)) {
      fxInfo.ageMin = Math.round(ageMs / 60_000);
      fxInfo.overdue = notFinished && ageMs > windowEndMs;
      fxInfo.finalRecheck = inFinalRecheck;
      candidates.push(fxInfo);
    }
  });

  return { all, candidates, nextWakeAtMs };
}

function buildStoredOwnGoalExpectations(fixtureInfos, apiToAppPlayerId = null) {
  const byFixture = new Map();

  (fixtureInfos || []).forEach(fxInfo => {
    const fixtureId = fxInfo && fxInfo.id != null ? String(fxInfo.id) : '';
    if (!fixtureId || !Array.isArray(fxInfo.goalEvents)) return;

    fxInfo.goalEvents.forEach(event => {
      if (!isOwnGoalScoringEvent(event)) return;
      const playerId = getScoringEventPlayerId(event, apiToAppPlayerId);
      if (!playerId) return;

      if (!byFixture.has(fixtureId)) byFixture.set(fixtureId, new Map());
      const fixtureMap = byFixture.get(fixtureId);
      const key = String(playerId);
      const current = fixtureMap.get(key) || {
        fixtureId,
        fixtureLabel: fxInfo.label || `Spiel ${fixtureId}`,
        playerId: key,
        playerName: normalizeScoringText(
          event.playerName ||
          (event.player && event.player.name) ||
          ''
        ),
        count: 0
      };
      current.count += 1;
      if (!current.playerName) {
        current.playerName = normalizeScoringText(
          event.playerName ||
          (event.player && event.player.name) ||
          ''
        );
      }
      fixtureMap.set(key, current);
    });
  });

  const byPlayer = new Map();
  byFixture.forEach(fixtureMap => {
    fixtureMap.forEach(expectation => {
      if (!byPlayer.has(expectation.playerId)) byPlayer.set(expectation.playerId, []);
      byPlayer.get(expectation.playerId).push(expectation);
    });
  });

  return { byFixture, byPlayer };
}

function rememberOwnGoalPointReadsForAudit(opts, docsRead) {
  const audit = opts && opts.audit;
  if (!audit) return;
  if (!audit.firestoreReadEstimate || typeof audit.firestoreReadEstimate !== 'object') {
    audit.firestoreReadEstimate = { fixturePlanDocs: 0 };
  }
  audit.firestoreReadEstimate.ownGoalPointDocs =
    (audit.firestoreReadEstimate.ownGoalPointDocs || 0) + (docsRead || 0);
}

async function findUnreconciledOwnGoalFixtures(db, tournament, fixtureInfos, opts = {}) {
  let expectations = buildStoredOwnGoalExpectations(fixtureInfos, null);
  if (expectations.byPlayer.size === 0) return [];

  try {
    const playersData = loadPlayersData(tournament);
    const apiPlayerIdMapStats = buildApiToAppPlayerIdMap(playersData);
    expectations = buildStoredOwnGoalExpectations(fixtureInfos, apiPlayerIdMapStats.apiToApp);
  } catch (err) {
    logWarn(`Eigentor-Recheck nutzt gespeicherte Spieler-IDs ohne API-Mapping: ${err.message}`);
  }

  const collection = tournament.firestore.pointsCollection;
  const playerIds = Array.from(expectations.byPlayer.keys());
  rememberOwnGoalPointReadsForAudit(opts, playerIds.length);

  const pointDocs = await Promise.all(playerIds.map(async pid => {
    const snap = await db.collection(collection).doc(String(pid)).get();
    return [String(pid), snap.exists ? (snap.data() || {}) : {}];
  }));
  const pointsByPlayer = new Map(pointDocs);
  const rechecksByFixture = new Map();

  expectations.byPlayer.forEach((playerExpectations, playerId) => {
    const pointObject = pointsByPlayer.get(String(playerId)) || {};

    playerExpectations.forEach(expectation => {
      const fixturePoint = pointObject[`Spiel_${expectation.fixtureId}`];
      const actualPoints = getFixtureLineupValue(fixturePoint, 'OWN_GOAL');
      const expectedPoints = expectation.count * RULES.OWN_GOAL;
      if (actualPoints === expectedPoints) return;

      if (!rechecksByFixture.has(expectation.fixtureId)) {
        rechecksByFixture.set(expectation.fixtureId, {
          id: expectation.fixtureId,
          label: expectation.fixtureLabel,
          details: []
        });
      }
      rechecksByFixture.get(expectation.fixtureId).details.push({
        playerId: expectation.playerId,
        playerName: expectation.playerName,
        count: expectation.count,
        actualPoints,
        expectedPoints
      });
    });
  });

  return Array.from(rechecksByFixture.values());
}

async function findCandidateFixtures(db, tournament, opts) {
  const cache = await ensureFixturePlanCacheLoaded(db, tournament, opts);
  return selectCandidateFixturesFromCache(cache, opts);
}

/* ─────────────────────────────────────────────────────────────────────────────
 *  Punkte-Berechnung pro Spiel.
 *  Verändert `allPlayerPoints` in place.
 * ───────────────────────────────────────────────────────────────────────────── */
function buildEmptyPlayerObject(player) {
  const pObj = { playerName: player.Spielername, totalPoints: 0 };
  Object.keys(RULES).forEach(k => { pObj[k] = 0; });
  return pObj;
}

function collectLineupPlayerIds(lineup, key, apiToAppPlayerId = null) {
  const ids = new Set();
  const rows = lineup && Array.isArray(lineup[key]) ? lineup[key] : [];
  rows.forEach(row => {
    const id = row && row.player && row.player.id;
    const appId = toAppPlayerId(apiToAppPlayerId, id);
    if (appId != null) ids.add(appId);
  });
  return ids;
}

function findLineupForTeam(fixtureData, teamId) {
  const lineups = fixtureData && Array.isArray(fixtureData.lineups) ? fixtureData.lineups : [];
  const target = teamId != null ? String(teamId) : '';
  return lineups.find(entry => entry && entry.team && String(entry.team.id) === target) || null;
}

function hasStartLineup(lineup) {
  const rows = lineup && Array.isArray(lineup.startXI) ? lineup.startXI : [];
  return rows.length > 0 && rows.length <= 11;
}

function hasAnyPublishedStartLineup(fixtureData) {
  const lineups = fixtureData && Array.isArray(fixtureData.lineups) ? fixtureData.lineups : [];
  return lineups.some(hasStartLineup);
}

function isScoringFixtureWithDetails(game, fixtureData) {
  if (isScoringFixture(game)) return true;
  return isPreMatchLineupCandidate(game) && hasAnyPublishedStartLineup(fixtureData);
}

function getPrimaryStats(pStats) {
  return (pStats && Array.isArray(pStats.statistics) && pStats.statistics[0]) || {};
}

function getMinutes(stats) {
  return (stats && stats.games && typeof stats.games.minutes === 'number') ? stats.games.minutes : 0;
}

function isApiStarterStat(stats) {
  return !!(stats && stats.games && stats.games.substitute === false);
}

function shouldTreatStatsAsStarter(stats, minutes, matchHasStarted, matchIsFinished, teamLineupPublished) {
  if (!matchHasStarted || teamLineupPublished || !isApiStarterStat(stats)) return false;
  if (minutes > 0) return true;
  return !matchIsFinished;
}

function getGoalValue(value) {
  const n = (typeof value === 'number') ? value : parseInt(value, 10);
  return Number.isFinite(n) ? n : 0;
}

function resolveMatchOutcome(game, matchHasStarted, matchIsFinished, homeGoals, awayGoals) {
  if (!matchHasStarted) {
    return { isDraw: false, homeWon: false, awayWon: false };
  }

  const homeWinner = game && game.teams && game.teams.home
    ? game.teams.home.winner
    : undefined;
  const awayWinner = game && game.teams && game.teams.away
    ? game.teams.away.winner
    : undefined;

  if (
    matchIsFinished &&
    (
      homeWinner === true ||
      awayWinner === true ||
      (homeWinner === null && awayWinner === null && homeGoals === awayGoals)
    )
  ) {
    return {
      isDraw: homeWinner === null && awayWinner === null && homeGoals === awayGoals,
      homeWon: homeWinner === true,
      awayWon: awayWinner === true
    };
  }

  if (homeGoals === awayGoals) {
    return { isDraw: true, homeWon: false, awayWon: false };
  }

  return {
    isDraw: false,
    homeWon: homeGoals > awayGoals,
    awayWon: awayGoals > homeGoals
  };
}

function processFixtureDetail(fixtureData, game, allPlayerPoints, playersData, opts = {}) {
  const events = fixtureData.events || [];
  const playersDataList = fixtureData.players || [];
  const apiToAppPlayerId = opts.apiToAppPlayerId || null;
  const playersById = new Map((playersData || [])
    .filter(player => player && player['player.id'] != null)
    .map(player => [String(player['player.id']), player]));

  const statusShort = getFixtureStatusShort(game);
  const matchHasStarted = SCORING_STATUSES.has(statusShort);
  const matchIsFinished = FINISHED_STATUSES.has(statusShort);
  const anyStartLineupPublished = hasAnyPublishedStartLineup(fixtureData);

  const homeName = (game.teams && game.teams.home && game.teams.home.name) || '';
  const awayName = (game.teams && game.teams.away && game.teams.away.name) || '';
  const homeGoals = getGoalValue(game.goals && game.goals.home);
  const awayGoals = getGoalValue(game.goals && game.goals.away);
  const matchOutcome = resolveMatchOutcome(game, matchHasStarted || anyStartLineupPublished, matchIsFinished, homeGoals, awayGoals);
  const fixId = game.fixture.id;
  const resultString = `${homeName} ${homeGoals} : ${awayGoals} ${awayName}`;
  let processedPlayers = 0;

  const subbedOutPlayerIds = events
    .filter(e => e.type && e.type.toLowerCase() === 'subst')
    .map(e => e.player && e.player.id)
    .filter(id => id != null)
    .map(id => toAppPlayerId(apiToAppPlayerId, id));

  const subbedInPlayerIds = events
    .filter(e => e.type && e.type.toLowerCase() === 'subst')
    .map(e => e.assist && e.assist.id)
    .filter(id => id != null)
    .map(id => toAppPlayerId(apiToAppPlayerId, id));

  const ownGoalsMap = {};
  getFixtureGoalEventsForScoring(fixtureData, {
    apiToAppPlayerId,
    firestoreGoalEvents: opts.firestoreGoalEvents
  }).forEach(e => {
    if (isOwnGoalScoringEvent(e)) {
      const id = getScoringEventPlayerId(e, apiToAppPlayerId);
      if (id) {
        ownGoalsMap[id] = (ownGoalsMap[id] || 0) + 1;
      }
    }
  });

  const teamsToProcess = [
    { team: game.teams && game.teams.home, isHome: true },
    { team: game.teams && game.teams.away, isHome: false }
  ];

  teamsToProcess.forEach(teamRef => {
    const teamId = teamRef.team && teamRef.team.id;
    if (teamId == null) return;

    const teamStats = playersDataList.find(entry =>
      entry && entry.team && String(entry.team.id) === String(teamId)
    ) || { team: teamRef.team, players: [] };

    const lineup = findLineupForTeam(fixtureData, teamId);
    const starterIds = collectLineupPlayerIds(lineup, 'startXI', apiToAppPlayerId);
    const substituteIds = collectLineupPlayerIds(lineup, 'substitutes', apiToAppPlayerId);
    const teamLineupPublished = hasStartLineup(lineup);
    const canAwardTeamLineupPoints = matchHasStarted || teamLineupPublished;
    const statsByPid = new Map();

    (teamStats.players || []).forEach(pStats => {
      const id = pStats && pStats.player && pStats.player.id;
      const appId = toAppPlayerId(apiToAppPlayerId, id);
      if (appId != null) statsByPid.set(appId, pStats);
    });

    const participantIds = new Set();
    statsByPid.forEach((pStats, pid) => {
      const stats = getPrimaryStats(pStats);
      const minutes = getMinutes(stats);
      if (
        minutes > 0 ||
        shouldTreatStatsAsStarter(stats, minutes, matchHasStarted, matchIsFinished, teamLineupPublished)
      ) {
        participantIds.add(pid);
      }
    });

    if (teamLineupPublished) {
      starterIds.forEach(pid => participantIds.add(pid));
    }
    if (matchHasStarted) {
      subbedInPlayerIds.forEach(pid => {
        if (substituteIds.has(pid) || statsByPid.has(pid)) participantIds.add(pid);
      });
    }
    Object.keys(ownGoalsMap).forEach(pid => {
      if (allPlayerPoints[pid] && playerBelongsToFixtureTeam(playersById.get(pid), teamRef.team)) {
        participantIds.add(pid);
      }
    });

    const isHome = teamRef.isHome;
    const opponentName = isHome ? awayName : homeName;
    const teamGoals = isHome ? homeGoals : awayGoals;
    const teamConceded = isHome ? awayGoals : homeGoals;
    const isDraw = matchOutcome.isDraw;
    const isWin = isHome ? matchOutcome.homeWon : matchOutcome.awayWon;
    const isLoss = !isDraw && !isWin;

    participantIds.forEach(pid => {
      if (!allPlayerPoints[pid]) return;

      const pObj = allPlayerPoints[pid];
      const pStats = statsByPid.get(pid) || { player: { id: pid }, statistics: [{}] };
      const stats = getPrimaryStats(pStats);
      const minutes = getMinutes(stats);
      const cameOnAsSub = subbedInPlayerIds.includes(pid);
      const started = (
        !cameOnAsSub &&
        (
          (teamLineupPublished && starterIds.has(pid)) ||
          shouldTreatStatsAsStarter(stats, minutes, matchHasStarted, matchIsFinished, teamLineupPublished)
        )
      );
      const subbedIn = matchHasStarted && !started && (
        minutes > 0 ||
        cameOnAsSub
      );
      const ownGoals = ownGoalsMap[pid] || 0;

      if (!started && !subbedIn && ownGoals <= 0) return;

      const detailPts = {};
      Object.keys(RULES).forEach(k => { detailPts[k] = 0; });

      const playerInfo = playersData.find(x => String(x['player.id']) === pid);
      const pos = normalizePosition((playerInfo && playerInfo.Position) || 'UNKNOWN');

      if (started) {
        detailPts.START = RULES.START;
        pObj.START += RULES.START;
      } else if (subbedIn) {
        detailPts.SUBBED_IN = RULES.SUBBED_IN;
        pObj.SUBBED_IN += RULES.SUBBED_IN;
      }

      if (subbedOutPlayerIds.includes(pid)) {
        detailPts.SUBBED_OUT = RULES.SUBBED_OUT;
        pObj.SUBBED_OUT += RULES.SUBBED_OUT;
      }

      const goals = (stats.goals && stats.goals.total) || 0;
      if (goals > 0) {
        if (pos === 'GOALKEEPER')      { detailPts.GOAL_GK = goals * RULES.GOAL_GK;   pObj.GOAL_GK += detailPts.GOAL_GK; }
        else if (pos === 'DEFENDER')   { detailPts.GOAL_DEF = goals * RULES.GOAL_DEF; pObj.GOAL_DEF += detailPts.GOAL_DEF; }
        else if (pos === 'MIDFIELDER') { detailPts.GOAL_MID = goals * RULES.GOAL_MID; pObj.GOAL_MID += detailPts.GOAL_MID; }
        else                           { detailPts.GOAL_ATT = goals * RULES.GOAL_ATT; pObj.GOAL_ATT += detailPts.GOAL_ATT; }
      }

      if (ownGoals > 0) {
        detailPts.OWN_GOAL = ownGoals * RULES.OWN_GOAL;
        pObj.OWN_GOAL += detailPts.OWN_GOAL;
      }

      const assists = (stats.goals && stats.goals.assists) || 0;
      if (assists > 0) {
        if (pos === 'GOALKEEPER' || pos === 'DEFENDER') {
          detailPts.ASSIST_GK_DEF = assists * RULES.ASSIST_GK_DEF;
          pObj.ASSIST_GK_DEF += detailPts.ASSIST_GK_DEF;
        } else if (pos === 'MIDFIELDER') {
          detailPts.ASSIST_MID = assists * RULES.ASSIST_MID;
          pObj.ASSIST_MID += detailPts.ASSIST_MID;
        } else {
          detailPts.ASSIST_ATT = assists * RULES.ASSIST_ATT;
          pObj.ASSIST_ATT += detailPts.ASSIST_ATT;
        }
      }

      if (pos === 'MIDFIELDER' || pos === 'ATTACKER') {
        detailPts.TEAM_GOAL = teamGoals * RULES.TEAM_GOAL;
        pObj.TEAM_GOAL += detailPts.TEAM_GOAL;
      }

      if (pos === 'GOALKEEPER' || pos === 'DEFENDER') {
        detailPts.DEF_BASE_PTS = RULES.DEF_BASE_PTS;
        pObj.DEF_BASE_PTS += RULES.DEF_BASE_PTS;
        if (teamConceded > 0) {
          detailPts.GEGENTOR_GK_DEF = teamConceded * RULES.GEGENTOR_GK_DEF;
          pObj.GEGENTOR_GK_DEF += detailPts.GEGENTOR_GK_DEF;
        }
      }

      const yellow = (stats.cards && stats.cards.yellow) || 0;
      if (yellow > 0) {
        detailPts.YELLOW_CARD = yellow * RULES.YELLOW_CARD;
        pObj.YELLOW_CARD += detailPts.YELLOW_CARD;
      }

      const red = (stats.cards && stats.cards.red) || 0;
      if (red > 0) {
        detailPts.RED_CARD = red * RULES.RED_CARD;
        pObj.RED_CARD += detailPts.RED_CARD;
      }

      const pMissed = (stats.penalty && stats.penalty.missed) || 0;
      const pCommited = (stats.penalty && stats.penalty.commited) || 0;
      const pSaved = (stats.penalty && stats.penalty.saved) || 0;
      const pWon = (stats.penalty && stats.penalty.won) || 0;

      if (pMissed > 0)   { detailPts.PEN_MISSED = pMissed * RULES.PEN_MISSED;   pObj.PEN_MISSED += detailPts.PEN_MISSED; }
      if (pCommited > 0) { detailPts.PEN_COMMITED = pCommited * RULES.PEN_COMMITED; pObj.PEN_COMMITED += detailPts.PEN_COMMITED; }
      if (pSaved > 0)    { detailPts.PEN_SAVED = pSaved * RULES.PEN_SAVED;     pObj.PEN_SAVED += detailPts.PEN_SAVED; }
      if (pWon > 0)      { detailPts.PEN_WON = pWon * RULES.PEN_WON;           pObj.PEN_WON += detailPts.PEN_WON; }

      if (canAwardTeamLineupPoints) {
        if (isWin)        { detailPts.WIN = RULES.WIN;   pObj.WIN += RULES.WIN; }
        else if (isDraw)  { detailPts.DRAW = RULES.DRAW; pObj.DRAW += RULES.DRAW; }
        else if (isLoss)  { detailPts.LOSS = RULES.LOSS; pObj.LOSS += RULES.LOSS; }
      }

      const matchPts = Object.values(detailPts).reduce((acc, val) => acc + val, 0);

      pObj[`Spiel_${fixId}`] = {
        Titel: `Spiel vs ${opponentName}`,
        MatchID: fixId,
        Gegner: opponentName,
        Resultat: resultString,
        TotalPunkte: matchPts,
        Aufstellung: detailPts
      };

      pObj.totalPoints += matchPts;
      processedPlayers++;
      if (opts.changedPlayerIds) opts.changedPlayerIds.add(pid);
    });
  });

  return processedPlayers;
}

function normalizeFixtureEventForAudit(event, fixtureId, game) {
  const time = event && event.time ? event.time : {};
  const team = event && event.team ? event.team : {};
  const player = event && event.player ? event.player : {};
  const assist = event && event.assist ? event.assist : {};
  const homeName = game && game.teams && game.teams.home && game.teams.home.name;
  const awayName = game && game.teams && game.teams.away && game.teams.away.name;

  return {
    fixtureId: String(fixtureId || ''),
    matchLabel: homeName && awayName ? `${homeName} - ${awayName}` : '',
    elapsed: (typeof time.elapsed === 'number') ? time.elapsed : null,
    extra: (typeof time.extra === 'number') ? time.extra : null,
    teamId: team.id != null ? String(team.id) : '',
    teamName: team.name || '',
    playerId: player.id != null ? String(player.id) : '',
    playerName: player.name || '',
    assistId: assist.id != null ? String(assist.id) : '',
    assistName: assist.name || '',
    type: event && event.type ? String(event.type) : '',
    detail: event && event.detail ? String(event.detail) : '',
    comments: event && event.comments ? String(event.comments) : ''
  };
}

function rememberFixtureEventsForAudit(opts, fixtureData, game) {
  const audit = opts && opts.audit;
  if (!audit || !fixtureData || !Array.isArray(fixtureData.events)) return;

  const fixtureId = fixtureData.fixture && fixtureData.fixture.id != null
    ? fixtureData.fixture.id
    : game && game.fixture && game.fixture.id;

  fixtureData.events.forEach(event => {
    audit.fixtureEventsCount = (audit.fixtureEventsCount || 0) + 1;
    if (!Array.isArray(audit.fixtureEvents)) audit.fixtureEvents = [];
    if (audit.fixtureEvents.length >= MAX_AUDIT_FIXTURE_EVENTS) {
      audit.fixtureEventsTruncated = true;
      return;
    }
    audit.fixtureEvents.push(normalizeFixtureEventForAudit(event, fixtureId, game));
  });
}

function cloneExistingPointObject(source, player) {
  const target = buildEmptyPlayerObject(player);
  if (!source || typeof source !== 'object') return target;

  target.playerName = source.playerName || player.Spielername;

  Object.entries(source).forEach(([key, value]) => {
    if (key.startsWith('Spiel_') && value && typeof value === 'object') {
      target[key] = { ...value };
    }
  });

  const hasFixtureDetails = Object.keys(target).some(key => key.startsWith('Spiel_'));
  if (!hasFixtureDetails) {
    Object.keys(RULES).forEach(k => {
      target[k] = (typeof source[k] === 'number') ? source[k] : 0;
    });
    target.totalPoints = (typeof source.totalPoints === 'number') ? source.totalPoints : 0;
  }
  recalculateTotalPoints(target);
  return target;
}

function recalculateTotalPoints(pointObject) {
  if (!pointObject || typeof pointObject !== 'object') return 0;

  const fixtureEntries = Object.entries(pointObject)
    .filter(([key, value]) => key.startsWith('Spiel_') && value && typeof value === 'object');

  if (fixtureEntries.length > 0) {
    const aggregate = {};
    Object.keys(RULES).forEach(ruleKey => { aggregate[ruleKey] = 0; });

    let total = 0;
    fixtureEntries.forEach(([, fixturePoint]) => {
      const lineup = fixturePoint.Aufstellung && typeof fixturePoint.Aufstellung === 'object'
        ? fixturePoint.Aufstellung
        : null;

      if (lineup) {
        let fixtureTotal = 0;
        Object.keys(RULES).forEach(ruleKey => {
          const value = (typeof lineup[ruleKey] === 'number') ? lineup[ruleKey] : 0;
          aggregate[ruleKey] += value;
          fixtureTotal += value;
        });
        fixturePoint.TotalPunkte = fixtureTotal;
        total += fixtureTotal;
      } else {
        total += (typeof fixturePoint.TotalPunkte === 'number') ? fixturePoint.TotalPunkte : 0;
      }
    });

    Object.keys(RULES).forEach(ruleKey => { pointObject[ruleKey] = aggregate[ruleKey]; });
    pointObject.totalPoints = total;
    return pointObject.totalPoints;
  }

  pointObject.totalPoints = Object.keys(RULES)
    .reduce((sum, key) => sum + ((typeof pointObject[key] === 'number') ? pointObject[key] : 0), 0);
  return pointObject.totalPoints;
}

function hasAnyPointValue(pointObject) {
  if (!pointObject || typeof pointObject !== 'object') return false;
  if (Object.keys(pointObject).some(key => key.startsWith('Spiel_'))) return true;
  return Object.keys(RULES).some(key => typeof pointObject[key] === 'number' && pointObject[key] !== 0);
}

function stableNormalize(value) {
  if (value === undefined) return null;
  if (value === null || typeof value !== 'object') return value;
  if (Array.isArray(value)) return value.map(stableNormalize);

  const out = {};
  Object.keys(value).sort().forEach(key => {
    const normalized = stableNormalize(value[key]);
    if (normalized !== undefined) out[key] = normalized;
  });
  return out;
}

function normalizePointObjectForComparison(pointObject) {
  const normalized = stableNormalize(pointObject || {});
  if (normalized && typeof normalized === 'object' && !Array.isArray(normalized)) {
    delete normalized.lastUpdated;
  }
  return normalized;
}

function pointObjectsEqual(a, b) {
  return JSON.stringify(normalizePointObjectForComparison(a)) ===
    JSON.stringify(normalizePointObjectForComparison(b));
}

function getPointTotal(pointObject) {
  return pointObject && typeof pointObject.totalPoints === 'number' ? pointObject.totalPoints : 0;
}

function getFixtureTotal(fixturePoint) {
  return fixturePoint && typeof fixturePoint.TotalPunkte === 'number' ? fixturePoint.TotalPunkte : 0;
}

function getFixtureLineupValue(fixturePoint, ruleKey) {
  const lineup = fixturePoint && fixturePoint.Aufstellung;
  return lineup && typeof lineup[ruleKey] === 'number' ? lineup[ruleKey] : 0;
}

function buildChangedFixtureAudit(fixtureKey, beforeFixture, afterFixture) {
  const before = beforeFixture && typeof beforeFixture === 'object' ? beforeFixture : null;
  const after = afterFixture && typeof afterFixture === 'object' ? afterFixture : null;
  const source = after || before || {};

  const ruleDeltas = {};
  Object.keys(RULES).forEach(ruleKey => {
    const delta = getFixtureLineupValue(after, ruleKey) - getFixtureLineupValue(before, ruleKey);
    if (delta !== 0) ruleDeltas[ruleKey] = delta;
  });

  return {
    fixtureKey,
    matchId: source.MatchID != null ? String(source.MatchID) : fixtureKey.replace(/^Spiel_/, ''),
    title: source.Titel || '',
    opponent: source.Gegner || '',
    result: source.Resultat || '',
    totalBefore: getFixtureTotal(before),
    totalAfter: getFixtureTotal(after),
    delta: getFixtureTotal(after) - getFixtureTotal(before),
    ruleDeltas
  };
}

function buildChangedPlayerAudit(playerId, player, before, after) {
  const beforeObj = before && typeof before === 'object' ? before : {};
  const afterObj = after && typeof after === 'object' ? after : {};
  const fixtureKeys = new Set();
  Object.keys(beforeObj).forEach(key => { if (key.startsWith('Spiel_')) fixtureKeys.add(key); });
  Object.keys(afterObj).forEach(key => { if (key.startsWith('Spiel_')) fixtureKeys.add(key); });

  const changedFixtureKeys = Array.from(fixtureKeys)
    .filter(key => JSON.stringify(stableNormalize(beforeObj[key] || null)) !== JSON.stringify(stableNormalize(afterObj[key] || null)))
    .sort();

  const changedRuleKeys = Object.keys(RULES)
    .filter(key => ((typeof beforeObj[key] === 'number') ? beforeObj[key] : 0) !== ((typeof afterObj[key] === 'number') ? afterObj[key] : 0))
    .sort();
  const changedFixtureDetails = changedFixtureKeys.map(key =>
    buildChangedFixtureAudit(key, beforeObj[key], afterObj[key])
  );

  const totalBefore = getPointTotal(beforeObj);
  const totalAfter = getPointTotal(afterObj);

  return {
    playerId: String(playerId),
    playerName: (player && player.Spielername) || afterObj.playerName || beforeObj.playerName || '',
    nation: (player && player['Nationalteam.name']) || '',
    position: normalizePosition((player && player.Position) || ''),
    totalBefore,
    totalAfter,
    delta: totalAfter - totalBefore,
    changedFixtureKeys,
    changedFixtureDetails,
    changedRuleKeys
  };
}

function rememberChangedPlayerForAudit(opts, playerId, player, before, after) {
  const audit = opts && opts.audit;
  if (!audit || !(audit.changedPlayers instanceof Map)) return;
  audit.changedPlayersCount = (audit.changedPlayersCount || 0) + 1;
  if (audit.changedPlayers.size >= MAX_CHANGED_PLAYER_LOG_DOCS) {
    audit.changedPlayersTruncated = true;
    return;
  }
  audit.changedPlayers.set(
    String(playerId),
    buildChangedPlayerAudit(playerId, player, before, after)
  );
}

function removeFixturePoints(pointObject, fixtureId) {
  if (!pointObject || fixtureId == null) return false;
  const key = `Spiel_${fixtureId}`;
  const previous = pointObject[key];
  if (!previous || typeof previous !== 'object') return false;

  const lineup = previous.Aufstellung || {};
  Object.keys(RULES).forEach(ruleKey => {
    const value = (typeof lineup[ruleKey] === 'number') ? lineup[ruleKey] : 0;
    pointObject[ruleKey] = ((typeof pointObject[ruleKey] === 'number') ? pointObject[ruleKey] : 0) - value;
  });
  delete pointObject[key];
  recalculateTotalPoints(pointObject);
  return true;
}

async function readExistingPointsFromFirestore(db, tournament) {
  const snap = await db.collection(tournament.firestore.pointsCollection).get();
  const points = {};
  snap.forEach(doc => {
    points[doc.id] = doc.data() || {};
  });
  return points;
}

async function readPointsMetaDocument(db, tournament) {
  const ref = db.collection(tournament.firestore.metaCollection).doc(tournament.firestore.metaDocId);
  const snap = await ref.get();
  return snap.exists ? (snap.data() || {}) : {};
}

function getCurrentPointsVersion(meta) {
  return meta && Number.isFinite(meta.pointsVersion) ? meta.pointsVersion : 0;
}

async function readExistingPointsForReconciliation(db, tournament, opts) {
  let meta = null;
  try {
    meta = await readPointsMetaDocument(db, tournament);
    const shardResult = await readPublicPointsShards(db, tournament, meta);
    if (shardResult && shardResult.ok) {
      logInfo(
        `Bestehende Punktebasis aus Public-Shards geladen ` +
        `(${Object.keys(shardResult.points || {}).length} Spieler, ${shardResult.shardCount} Shards).`
      );
      return shardResult.points || {};
    }
    logInfo(`Public-Points-Shards nicht nutzbar (${shardResult ? shardResult.reason : 'unknown'}), nutze Collection-Fallback.`);
  } catch (err) {
    logWarn(`Public-Points-Shards konnten nicht gelesen werden (${err.message}), nutze Collection-Fallback.`);
  }

  const points = await readExistingPointsFromFirestore(db, tournament);
  logInfo(`Bestehende Punktebasis aus Collection geladen (${Object.keys(points).length} Dokumente).`);
  return points;
}

function buildPointBaseFromExisting(playersData, existingPoints, fixtureIdsToReplace, changedPlayerIds) {
  const allPlayerPoints = {};
  const replaceIds = new Set(Array.from(fixtureIdsToReplace || []).map(id => String(id)));

  playersData.forEach(player => {
    const pid = String(player['player.id']);
    const obj = cloneExistingPointObject(existingPoints && existingPoints[pid], player);
    replaceIds.forEach(fixtureId => {
      if (removeFixturePoints(obj, fixtureId) && changedPlayerIds) {
        changedPlayerIds.add(pid);
      }
    });
    recalculateTotalPoints(obj);
    allPlayerPoints[pid] = obj;
  });

  return allPlayerPoints;
}

/* ─────────────────────────────────────────────────────────────────────────────
 *  Schreib-Workflow
 * ───────────────────────────────────────────────────────────────────────────── */

// Firestore-Commit-Limits: max. 500 Writes UND max. 10 MiB pro Transaktion.
// Bei Turnieren mit vielen Spielern und detailreichen Punktedokumenten (z. B.
// die CL mit 1131 Spielern und Ligaphasen-Details ueber viele Spiele) reisst
// ein 400er-Batch die 10-MiB-Grenze ("Transaction too big"). Deshalb wird
// zusaetzlich groessenbasiert geflusht – konservativ bei 8 MiB.
// Harte Obergrenze der Writes pro Batch (deterministisches Sicherheitsnetz,
// unabhaengig von der Groessenschaetzung). Bei CL-Punktedokumenten (~25-30 KB)
// bleiben 200 Writes klar unter 10 MiB.
const MAX_POINTS_BATCH_COUNT = 200;
const MAX_POINTS_BATCH_BYTES = 8 * 1024 * 1024;

// Grobe Byte-Schaetzung eines Punktedokuments fuer die groessenbasierte
// Flush-Entscheidung. WICHTIG: nur auf reinen Datenobjekten aufrufen (ohne
// FieldValue-Sentinel). Bei Fehlern konservativ HOCH schaetzen, damit lieber
// zu frueh als zu spaet geflusht wird.
function approxPointDocBytes(obj) {
  try {
    const s = JSON.stringify(obj);
    return s ? Buffer.byteLength(s, 'utf8') : 50 * 1024;
  } catch (_) {
    return 50 * 1024;
  }
}

async function writePointsToFirestore(db, tournament, allPlayerPoints, opts, onlyPlayerIds = null, existingPoints = null) {
  const FieldValue = admin.firestore.FieldValue;
  const collection = tournament.firestore.pointsCollection;
  const targetIds = onlyPlayerIds
    ? Array.from(onlyPlayerIds).map(id => String(id)).filter(id => allPlayerPoints[id])
    : Object.keys(allPlayerPoints);
  const isPartialWrite = !!onlyPlayerIds;

  let batch = db.batch();
  let countInBatch = 0;
  let bytesInBatch = 0;
  let written = 0;
  let deleted = 0;
  let skipped = 0;
  const deltaSet = {};
  const deltaDelete = [];

  for (const pid of targetIds) {
    const obj = allPlayerPoints[pid];
    const hasPoints = hasAnyPointValue(obj);
    const previous = existingPoints ? existingPoints[pid] : null;

    if (!hasPoints && !isPartialWrite) continue;

    if (existingPoints) {
      if (hasPoints && previous && pointObjectsEqual(obj, previous)) {
        skipped++;
        continue;
      }
      if (!hasPoints && (!previous || !hasAnyPointValue(previous))) {
        skipped++;
        continue;
      }
    }

    if (!hasPoints && isPartialWrite && !opts.allowPartialPointDeletes) {
      skipped++;
      continue;
    }

    // Groesse VOR dem Setzen von lastUpdated messen: obj ist hier noch reine
    // Datenstruktur (JSON-serialisierbar). Das FieldValue-Sentinel wuerde die
    // Schaetzung sonst verfaelschen bzw. JSON.stringify werfen lassen.
    const docBytes = hasPoints ? approxPointDocBytes(obj) : 64;

    if (hasPoints) {
      obj.lastUpdated = FieldValue.serverTimestamp();
    }

    if (!opts.dryRun) {
      const docRef = db.collection(collection).doc(String(pid));
      if (hasPoints) {
        // Spielerdokumente werden bei jedem Lauf vollstaendig neu berechnet
        // bzw. im Live-Modus fuer die betroffenen Spieler voll ersetzt.
        // Deshalb das Dokument komplett ersetzen statt mergen: dadurch
        // verschwinden veraltete Felder (z. B. ein `Spiel_<id>`, das die
        // API nachtraeglich entfernt hat) zuverlaessig aus dem Dokument
        // und Summe-zu-Detail-Inkonsistenzen werden vermieden.
        batch.set(docRef, obj);
      } else {
        batch.delete(docRef);
      }
      bytesInBatch += docBytes;
      countInBatch++;
    }

    if (hasPoints) {
      written++;
      deltaSet[String(pid)] = obj;
    } else {
      deleted++;
      deltaDelete.push(String(pid));
    }

    rememberChangedPlayerForAudit(
      opts,
      pid,
      opts && opts.playerLookup ? opts.playerLookup.get(String(pid)) : null,
      previous,
      hasPoints ? obj : null
    );

    if (countInBatch >= MAX_POINTS_BATCH_COUNT || bytesInBatch >= MAX_POINTS_BATCH_BYTES) {
      await batch.commit();
      batch = db.batch();
      countInBatch = 0;
      bytesInBatch = 0;
    }
  }

  if (countInBatch > 0) {
    await batch.commit();
  }

  return {
    written,
    deleted,
    skipped,
    touched: written + deleted,
    deltaSet,
    deltaDelete
  };
}

function buildNullPointsCacheMetaFields() {
  return {
    pointsCacheGeneratedAt: null,
    pointsShardCount: null,
    pointsDeltaDocId: null,
    pointsDeltaBaseVersion: null,
    pointsDeltaNextVersion: null
  };
}

function buildSuccessfulPointsCacheMetaFields(cacheResult, baseVersion, nextVersion) {
  const deltaDocId = cacheResult && cacheResult.deltaDocId ? cacheResult.deltaDocId : null;
  return {
    pointsCacheGeneratedAt: cacheResult.cacheGenerationMs,
    pointsShardCount: cacheResult.shardCount,
    pointsDeltaDocId: deltaDocId,
    pointsDeltaBaseVersion: deltaDocId ? baseVersion : null,
    pointsDeltaNextVersion: deltaDocId ? nextVersion : null
  };
}

function buildPublicPointsCacheSource(allPlayerPoints, existingPoints, writeResult) {
  const source = {};
  const deltaSet = writeResult && writeResult.deltaSet ? writeResult.deltaSet : {};

  Object.keys(allPlayerPoints || {}).forEach(playerId => {
    const pid = String(playerId);
    const current = allPlayerPoints[pid];
    if (!hasAnyPointValue(current)) return;

    if (Object.prototype.hasOwnProperty.call(deltaSet, pid)) {
      source[pid] = deltaSet[pid];
      return;
    }

    // Public-Shards werden aus der rekalkulierten Basis geschrieben. Das
    // verhindert, dass ein altes Shard-Dokument mit falschem totalPoints-
    // Aggregat fuer unveraenderte Spieler wieder in die naechste Cache-
    // Generation kopiert wird.
    source[pid] = current;
  });

  return source;
}

async function writePublicPointsCacheForNextVersion(
  db,
  tournament,
  allPlayerPoints,
  writeResult,
  baseVersion,
  nextVersion,
  opts,
  existingPointsForPublicCache = null
) {
  const pointsForCache = buildPublicPointsCacheSource(
    allPlayerPoints,
    existingPointsForPublicCache,
    writeResult
  );
  const cacheResult = await writePublicPointsCache(db, tournament, pointsForCache, {
    dryRun: opts.dryRun,
    shardCount: DEFAULT_PUBLIC_POINTS_SHARD_COUNT,
    cacheGenerationMs: Date.now(),
    pointsVersion: nextVersion,
    baseVersion,
    nextVersion,
    deltaSet: writeResult.deltaSet || {},
    deltaDelete: writeResult.deltaDelete || [],
    includePoint: hasAnyPointValue
  });

  logInfo(
    `Public Points Cache ${opts.dryRun ? '(DRY-RUN) berechnet' : 'geschrieben'} ` +
    `(${cacheResult.pointsCount} Spieler, ${cacheResult.shardCount} Shards, ` +
    `cacheGenerationMs=${cacheResult.cacheGenerationMs}).`
  );
  if (cacheResult.deltaWritten) {
    logInfo(`Public Points Delta geschrieben (${cacheResult.deltaBytes} Bytes).`);
  } else if (cacheResult.deltaTooLarge) {
    logWarn(`Public Points Delta ist zu gross (${cacheResult.deltaBytes} Bytes) - Clients nutzen Shards.`);
  }

  return cacheResult;
}

async function bumpPointsMetaVersion(db, tournament, opts, nextPointsVersion = null, pointsCacheMetaFields = null) {
  if (opts.dryRun) return;
  const FieldValue = admin.firestore.FieldValue;
  const ref = db.collection(tournament.firestore.metaCollection).doc(tournament.firestore.metaDocId);
  const payload = {
    tournamentKey: tournament.key,
    tournamentType: tournament.type,
    tournamentYear: tournament.year,
    tournamentLabel: tournament.shortLabel,
    year: tournament.year,
    pointsVersion: Number.isFinite(nextPointsVersion) ? nextPointsVersion : FieldValue.increment(1),
    pointsUpdatedAt: Date.now()
  };
  if (pointsCacheMetaFields && typeof pointsCacheMetaFields === 'object') {
    Object.assign(payload, pointsCacheMetaFields);
  }
  await ref.set(payload, { merge: true });
}

async function bumpFixturesMetaVersion(db, tournament, opts, fixturesCacheGeneratedAt = null) {
  if (opts.dryRun) return;
  const FieldValue = admin.firestore.FieldValue;
  const ref = db.collection(tournament.firestore.metaCollection).doc(tournament.firestore.metaDocId);
  const payload = {
    tournamentKey: tournament.key,
    tournamentType: tournament.type,
    tournamentYear: tournament.year,
    tournamentLabel: tournament.shortLabel,
    year: tournament.year,
    fixturesVersion: FieldValue.increment(1),
    fixturesUpdatedAt: Date.now()
  };
  if (typeof fixturesCacheGeneratedAt === 'number' && Number.isFinite(fixturesCacheGeneratedAt)) {
    payload.fixturesCacheGeneratedAt = fixturesCacheGeneratedAt;
  }
  await ref.set(payload, { merge: true });
}

function buildFixtureStatusUpdate(game) {
  const update = {
    status: {
      long: (game.fixture.status && game.fixture.status.long) || '',
      short: (game.fixture.status && game.fixture.status.short) || '',
      elapsed: (game.fixture.status && game.fixture.status.elapsed) != null ? game.fixture.status.elapsed : null
    },
    goals: {
      home: (game.goals && game.goals.home) != null ? game.goals.home : null,
      away: (game.goals && game.goals.away) != null ? game.goals.away : null
    },
    score: game.score || {},
    'homeTeam.winner': (game.teams && game.teams.home && game.teams.home.winner != null) ? game.teams.home.winner : null,
    'awayTeam.winner': (game.teams && game.teams.away && game.teams.away.winner != null) ? game.teams.away.winner : null
  };

  if (Array.isArray(game.events)) {
    update.goalEvents = normalizeFixtureGoalEvents(game);
  }

  return update;
}

function normalizeFixtureGoalEvents(game) {
  const fixtureId = game && game.fixture && game.fixture.id != null ? String(game.fixture.id) : '';
  return (Array.isArray(game && game.events) ? game.events : [])
    .filter(event => {
      const type = String(event && event.type ? event.type : '').toLowerCase();
      const detail = String(event && event.detail ? event.detail : '').toLowerCase();
      return type === 'goal' && !detail.includes('missed');
    })
    .map(event => {
      const time = event && event.time ? event.time : {};
      const team = event && event.team ? event.team : {};
      const player = event && event.player ? event.player : {};
      const assist = event && event.assist ? event.assist : {};
      return {
        fixtureId,
        elapsed: (typeof time.elapsed === 'number') ? time.elapsed : null,
        extra: (typeof time.extra === 'number') ? time.extra : null,
        teamId: team.id != null ? String(team.id) : '',
        teamName: team.name || '',
        playerId: player.id != null ? String(player.id) : '',
        playerName: player.name || '',
        assistId: assist.id != null ? String(assist.id) : '',
        assistName: assist.name || '',
        detail: event && event.detail ? String(event.detail) : ''
      };
    })
    .sort((a, b) => {
      const elapsedA = (typeof a.elapsed === 'number') ? a.elapsed : 999;
      const elapsedB = (typeof b.elapsed === 'number') ? b.elapsed : 999;
      if (elapsedA !== elapsedB) return elapsedA - elapsedB;
      const extraA = (typeof a.extra === 'number') ? a.extra : 0;
      const extraB = (typeof b.extra === 'number') ? b.extra : 0;
      if (extraA !== extraB) return extraA - extraB;
      return String(a.playerName || '').localeCompare(String(b.playerName || ''), 'de');
    });
}

function fixtureStatusMatchesSnapshot(update, snapshot) {
  if (!snapshot) return false;
  const statusMatches = snapshot.statusLong === update.status.long &&
    snapshot.statusShort === update.status.short &&
    snapshot.statusElapsed === update.status.elapsed &&
    snapshot.goalsHome === update.goals.home &&
    snapshot.goalsAway === update.goals.away &&
    snapshot.homeWinner === update['homeTeam.winner'] &&
    snapshot.awayWinner === update['awayTeam.winner'] &&
    JSON.stringify(stableNormalize(snapshot.score || {})) === JSON.stringify(stableNormalize(update.score || {}));

  if (!statusMatches) return false;
  if (update.goalEvents === undefined) return true;
  return JSON.stringify(stableNormalize(snapshot.goalEvents || [])) === JSON.stringify(stableNormalize(update.goalEvents || []));
}

function shouldPreserveExistingGoalEvents(update, snapshot) {
  if (!update || !snapshot) return false;
  if (!Array.isArray(update.goalEvents) || update.goalEvents.length > 0) return false;
  if (!Array.isArray(snapshot.goalEvents) || snapshot.goalEvents.length === 0) return false;
  const home = Number(update.goals && update.goals.home);
  const away = Number(update.goals && update.goals.away);
  const totalGoals = (Number.isFinite(home) ? home : 0) + (Number.isFinite(away) ? away : 0);
  return totalGoals > 0;
}

function preserveExistingGoalEventsIfNeeded(update, snapshot) {
  if (!shouldPreserveExistingGoalEvents(update, snapshot)) return update;
  const next = { ...update };
  delete next.goalEvents;
  return next;
}

function statusValue(value) {
  return String(value || '').toUpperCase();
}

function numberOrNull(value) {
  return (typeof value === 'number' && Number.isFinite(value)) ? value : null;
}

function isFixtureStatusRegression(update, snapshot) {
  if (!snapshot) return false;

  const currentStatus = statusValue(snapshot.statusShort);
  const nextStatus = statusValue(update && update.status && update.status.short);

  if (FINISHED_STATUSES.has(currentStatus) && !FINISHED_STATUSES.has(nextStatus)) {
    return true;
  }

  const currentElapsed = numberOrNull(snapshot.statusElapsed);
  const nextElapsed = numberOrNull(update && update.status && update.status.elapsed);
  if (
    currentStatus &&
    currentStatus === nextStatus &&
    LIVE_STATUSES.has(currentStatus) &&
    currentElapsed != null &&
    nextElapsed != null &&
    nextElapsed < currentElapsed
  ) {
    return true;
  }

  return false;
}

async function updateFixtureStatusInFirestore(db, tournament, games, opts, fixtureSnapshotsById = null) {
  const collection = tournament.firestore.fixturesCollection;
  if (!collection || !games || games.length === 0) return { updated: 0, skipped: 0 };
  if (opts.dryRun) return { updated: games.length, skipped: 0, updatedGames: uniqueGamesByFixtureId(games) };

  const FieldValue = admin.firestore.FieldValue;
  let batch = db.batch();
  let batchCount = 0;
  let totalUpdated = 0;
  let skipped = 0;
  const updatedGames = [];

  for (const game of games) {
    const fixtureId = String(game.fixture.id);
    const docRef = db.collection(collection).doc(fixtureId);
    const snapshot = fixtureSnapshotsById ? fixtureSnapshotsById.get(fixtureId) : null;
    const update = preserveExistingGoalEventsIfNeeded(buildFixtureStatusUpdate(game), snapshot);

    if (isFixtureStatusRegression(update, snapshot)) {
      logWarn(
        `Fixture ${fixtureId}: aelteren Status ignoriert ` +
        `(Firestore ${snapshot.statusShort || '-'} ${snapshot.statusElapsed != null ? snapshot.statusElapsed + "'" : ''}, ` +
        `API ${update.status.short || '-'} ${update.status.elapsed != null ? update.status.elapsed + "'" : ''}).`
      );
      skipped++;
      continue;
    }

    if (fixtureStatusMatchesSnapshot(update, snapshot)) {
      skipped++;
      continue;
    }

    batch.set(docRef, { ...update, updatedAt: FieldValue.serverTimestamp() }, { merge: true });
    batchCount++;
    totalUpdated++;
    updatedGames.push(game);

    if (batchCount === 400) {
      await batch.commit();
      batch = db.batch();
      batchCount = 0;
    }
  }

  if (batchCount > 0) await batch.commit();
  return { updated: totalUpdated, skipped, updatedGames };
}

function addFixtureWriteResultToAudit(audit, result, key = 'fixtureWriteResult') {
  if (!audit || !result) return;
  const current = audit[key] || { updated: 0, skipped: 0 };
  audit[key] = {
    updated: (current.updated || 0) + (result.updated || 0),
    skipped: (current.skipped || 0) + (result.skipped || 0)
  };
  if (key !== 'fixtureWriteResult') {
    addFixtureWriteResultToAudit(audit, result, 'fixtureWriteResult');
  }
}

function updateFixtureSnapshotsFromGames(fixtureSnapshotsById, games) {
  if (!fixtureSnapshotsById) return;

  (games || []).forEach(game => {
    if (!game || !game.fixture || game.fixture.id == null) return;
    const fixtureId = String(game.fixture.id);
    const previous = fixtureSnapshotsById.get(fixtureId) || { id: fixtureId };
    const update = preserveExistingGoalEventsIfNeeded(buildFixtureStatusUpdate(game), previous);
    fixtureSnapshotsById.set(fixtureId, {
      ...previous,
      statusLong: update.status.long,
      statusShort: update.status.short,
      statusElapsed: update.status.elapsed,
      goalsHome: update.goals.home,
      goalsAway: update.goals.away,
      score: update.score || {},
      goalEvents: update.goalEvents !== undefined ? update.goalEvents : (previous.goalEvents || []),
      homeWinner: update['homeTeam.winner'],
      awayWinner: update['awayTeam.winner']
    });
  });
}

function applyFixtureStatusUpdateToData(data, update, cacheGenerationMs) {
  const next = { ...(data || {}) };
  next.status = {
    ...(next.status && typeof next.status === 'object' ? next.status : {}),
    long: update.status.long,
    short: update.status.short,
    elapsed: update.status.elapsed
  };
  next.goals = {
    ...(next.goals && typeof next.goals === 'object' ? next.goals : {}),
    home: update.goals.home,
    away: update.goals.away
  };
  next.score = update.score || {};
  if (update.goalEvents !== undefined) {
    next.goalEvents = update.goalEvents;
  }
  next.homeTeam = {
    ...(next.homeTeam && typeof next.homeTeam === 'object' ? next.homeTeam : {}),
    winner: update['homeTeam.winner']
  };
  next.awayTeam = {
    ...(next.awayTeam && typeof next.awayTeam === 'object' ? next.awayTeam : {}),
    winner: update['awayTeam.winner']
  };
  next.updatedAt = new Date(cacheGenerationMs);
  return next;
}

function updateFixturePlanCacheFromGames(fixturePlanCache, games, cacheGenerationMs) {
  if (!fixturePlanCache) return;
  const cache = normalizeFixturePlanCache(fixturePlanCache);

  uniqueGamesByFixtureId(games).forEach(game => {
    if (!game || !game.fixture || game.fixture.id == null) return;
    const fixtureId = String(game.fixture.id);
    let record = cache.byId.get(fixtureId);
    if (!record) {
      record = {
        id: fixtureId,
        docId: fixtureId,
        data: { fixtureId }
      };
      cache.all.push(record);
    }
    const update = preserveExistingGoalEventsIfNeeded(buildFixtureStatusUpdate(game), record.data);
    record.data = applyFixtureStatusUpdateToData(record.data, update, cacheGenerationMs);
    record.id = getFirestoreFixtureApiId(record.data, { id: record.docId }) || fixtureId;
    cache.byId.set(fixtureId, record);
    if (record.id) cache.byId.set(String(record.id), record);
    if (record.docId) cache.byId.set(String(record.docId), record);
  });

  cache.cacheGenerationMs = cacheGenerationMs;
}

async function ensureFixturePlanCacheForBundle(db, tournament, opts) {
  const cache = getFixturePlanCache(opts);
  if (!cache.loadedAtMs || !Array.isArray(cache.all) || cache.all.length === 0) {
    await refreshFixturePlanCache(db, tournament, opts, cache);
  }
  return cache;
}

async function writeFixturePlanPublicBundle(db, tournament, opts, cacheGenerationMs, source) {
  const cache = await ensureFixturePlanCacheForBundle(db, tournament, opts);
  const fixturesBundle = buildFixturesMapFromPlanCache(cache, cacheGenerationMs);
  const bundleResult = await writePublicFixtureBundle(
    db,
    tournament,
    fixturesBundle,
    source,
    opts,
    cacheGenerationMs
  );
  cache.cacheGenerationMs = bundleResult.cacheGenerationMs;
  logInfo(`Public Fixture-Bundle ${opts.dryRun ? '(DRY-RUN) berechnet' : 'geschrieben'} ` +
    `(${bundleResult.fixturesCount} Fixtures, cacheGenerationMs=${bundleResult.cacheGenerationMs}).`);
  return bundleResult;
}

function getApiFixtureId(game) {
  const id = game && game.fixture && game.fixture.id;
  return id == null ? '' : String(id);
}

function preferDetailedFixtureGames(games, detailsById) {
  return uniqueGamesByFixtureId(games).map(game => {
    const id = getApiFixtureId(game);
    return (id && detailsById && detailsById.get(id)) || game;
  });
}

function getFixtureGoalTotal(game) {
  const goals = game && game.goals ? game.goals : {};
  const home = Number(goals.home);
  const away = Number(goals.away);
  return (Number.isFinite(home) ? home : 0) + (Number.isFinite(away) ? away : 0);
}

function shouldFetchFixtureGoalEvents(game) {
  return isScoringFixture(game) || getFixtureGoalTotal(game) > 0;
}

async function fetchFixtureGoalEvents(headers, fixtureId, opts = {}) {
  const id = String(fixtureId || '').trim();
  if (!id) return null;
  const eventsUrl = `https://v3.football.api-sports.io/fixtures/events?fixture=${id}`;

  try {
    const data = await fetchApiJson(
      eventsUrl,
      { headers },
      `Event-Details Fixture ${id}`,
      opts,
      'detailBatches'
    );
    return Array.isArray(data && data.response) ? data.response : [];
  } catch (err) {
    logWarn(`Event-Details fuer Fixture ${id} konnten nicht geladen werden: ${err.message}`);
    return null;
  }
}

async function publishFixtureStatusUpdates(db, tournament, games, opts, fixtureSnapshotsById, label, auditKey = 'fixtureWriteResult') {
  const uniqueGames = uniqueGamesByFixtureId(games);
  if (uniqueGames.length === 0) return { updated: 0, skipped: 0 };

  const fixtureWriteResult = await updateFixtureStatusInFirestore(
    db,
    tournament,
    uniqueGames,
    opts,
    fixtureSnapshotsById
  );

  addFixtureWriteResultToAudit(opts.audit, fixtureWriteResult, auditKey);
  logInfo(`Fixture-Status (${label}) fuer ${fixtureWriteResult.updated} Spiele ` +
    `${opts.dryRun ? '(DRY-RUN) berechnet' : 'aktualisiert'}, ` +
    `${fixtureWriteResult.skipped} unveraendert uebersprungen.`);

  if (fixtureWriteResult.updated > 0) {
    const updatedGames = Array.isArray(fixtureWriteResult.updatedGames)
      ? fixtureWriteResult.updatedGames
      : uniqueGames;
    const cacheGenerationMs = Date.now();
    updateFixtureSnapshotsFromGames(fixtureSnapshotsById, updatedGames);
    updateFixturePlanCacheFromGames(opts.fixturePlanCache, updatedGames, cacheGenerationMs);
    let fixturesCacheGeneratedAt = cacheGenerationMs;
    try {
      const bundleResult = await writeFixturePlanPublicBundle(
        db,
        tournament,
        opts,
        cacheGenerationMs,
        'auto-points-upload'
      );
      fixturesCacheGeneratedAt = bundleResult.cacheGenerationMs;
    } catch (err) {
      logWarn(
        `Public Fixture-Bundle konnte nicht geschrieben werden (${err.message}). ` +
        `fixturesVersion wird mit Fallback-Signal erhoeht; Clients lesen dann die Fixture-Collection.`
      );
    }
    await bumpFixturesMetaVersion(db, tournament, opts, fixturesCacheGeneratedAt);
    if (opts.audit) opts.audit.fixturesVersionIncreased = !opts.dryRun;
    logInfo(`fixturesVersion ${opts.dryRun ? '(DRY-RUN) ' : ''}erhoeht - Clients laden frische Spielstaende sofort nach.`);
  }

  return fixtureWriteResult;
}

async function fetchFixtureDetailsByIds(headers, fixtureIds, opts = {}) {
  const idsToFetch = Array.from(fixtureIds || []).map(id => String(id)).filter(Boolean);
  const detailsById = new Map();
  if (idsToFetch.length === 0) return detailsById;

  const batches = chunk(idsToFetch, 20);
  logInfo(`Detail-Calls in ${batches.length} Batch(es) zu max. 20 IDs (${idsToFetch.length} Fixtures insgesamt).`);

  for (let b = 0; b < batches.length; b++) {
    const ids = batches[b];
    const detailUrl = `https://v3.football.api-sports.io/fixtures?ids=${ids.join('-')}`;

    const detailData = await fetchApiJson(
      detailUrl,
      { headers },
      `Detail-Batch ${b + 1}/${batches.length}`,
      opts,
      'detailBatches'
    );

    if (!detailData || !Array.isArray(detailData.response)) {
      throw new Error(`Detail-Batch ${b + 1}/${batches.length}: ungueltige API-Antwort (kein response-Array).`);
    }

    for (const fixtureDetail of detailData.response) {
      const fixIdRaw = fixtureDetail && fixtureDetail.fixture && fixtureDetail.fixture.id;
      const fixId = (fixIdRaw != null) ? String(fixIdRaw) : '';
      if (!fixId) {
        logWarn(`Detail-Batch ${b + 1}: Eintrag ohne fixture.id wird ignoriert.`);
        continue;
      }
      detailsById.set(fixId, fixtureDetail);
    }

    logInfo(`Detail-Batch ${b + 1}/${batches.length} geladen (${detailData.response.length} Fixtures).`);

    if (b < batches.length - 1) await delay(350);
  }

  const eventCandidates = Array.from(detailsById.values()).filter(shouldFetchFixtureGoalEvents);
  if (eventCandidates.length > 0) {
    logInfo(`Event-Detail-Calls fuer ${eventCandidates.length} Fixture(s) vorgemerkt.`);
  }

  for (let i = 0; i < eventCandidates.length; i++) {
    const fixtureDetail = eventCandidates[i];
    const fixtureId = fixtureDetail && fixtureDetail.fixture && fixtureDetail.fixture.id;
    const events = await fetchFixtureGoalEvents(headers, fixtureId, opts);
    if (Array.isArray(events)) {
      fixtureDetail.events = events;
    }
    if ((i + 1) % 10 === 0 || i === eventCandidates.length - 1) {
      logInfo(`Event-Detail-Calls: ${i + 1}/${eventCandidates.length}`);
    }
    if (i < eventCandidates.length - 1) await delay(120);
  }

  return detailsById;
}

/* ─────────────────────────────────────────────────────────────────────────────
 *  Haupt-Workflow
 * ───────────────────────────────────────────────────────────────────────────── */
async function runFullPointsUpload(db, tournament, opts, candidateFixtureIds, fixtureSnapshotsById = null) {
  const apiKey = process.env.RAPIDAPI_KEY;
  if (!apiKey) throw new Error('RAPIDAPI_KEY ist nicht gesetzt.');

  const playersData = loadPlayersData(tournament);
  const overrideStats = applyPositionOverrides(playersData, tournament.key);
  const apiPlayerIdMapStats = buildApiToAppPlayerIdMap(playersData);
  const playerLookup = new Map(playersData.map(p => [String(p['player.id']), p]));
  opts.playerLookup = playerLookup;
  opts.apiToAppPlayerId = apiPlayerIdMapStats.apiToApp;
  logInfo(`Kader geladen: ${playersData.length} Spieler aus ${tournament.dataFile}` +
    ` (Positions-Overrides angewendet: ${overrideStats.applied}/${overrideStats.total}, ` +
    `API-ID-Mappings: ${apiPlayerIdMapStats.explicitMappings}).`);

  const allPlayerPoints = {};

  const headers = {
    'x-rapidapi-key': apiKey,
    'x-rapidapi-host': 'v3.football.api-sports.io'
  };

  const baseQuery = `${tournament.api.competitionParam}=${tournament.api.competitionId}&season=${tournament.api.season}`;
  const fixturesUrl = `https://v3.football.api-sports.io/fixtures?${baseQuery}`;

  logInfo(`Lade Fixtures von API: ${fixturesUrl}`);
  const fixData = await fetchApiJson(
    fixturesUrl,
    { headers },
    'API-Fixtures',
    opts,
    'fixtureList'
  );
  if (!fixData || !Array.isArray(fixData.response)) {
    throw new Error('API hat keine gültigen Fixture-Daten geliefert.');
  }

  const allApiGames = fixData.response.filter(f => f && f.fixture && f.fixture.id != null);
  assertApiFixtureListSafe(tournament, allApiGames, 'Punkte-Workflow');
  const apiGamesById = new Map(allApiGames.map(g => [String(g.fixture.id), g]));
  const finishedGames = allApiGames.filter(isFinishedFixture);
  const candidateGames = candidateFixtureIds
    ? Array.from(candidateFixtureIds).map(id => apiGamesById.get(String(id))).filter(Boolean)
    : [];

  if (candidateFixtureIds) {
    Array.from(candidateFixtureIds).forEach(id => {
      if (!apiGamesById.has(String(id))) {
        logWarn(`Kandidat ${id} wurde in der API-Fixture-Liste nicht gefunden.`);
      }
    });
  }

  const scoringCandidateGames = candidateFixtureIds
    ? candidateGames.filter(isScoringFixture)
    : [];
  const preMatchLineupCandidateGames = candidateFixtureIds
    ? candidateGames.filter(isPreMatchLineupCandidate)
    : [];
  const liveCandidateGames = scoringCandidateGames.filter(g => !isFinishedFixture(g));
  const finishedCandidateIds = candidateFixtureIds
    ? new Set(finishedGames.map(g => String(g.fixture.id)).filter(id => candidateFixtureIds.has(id)))
    : null;
  const newlyFinishedCandidateIds = finishedCandidateIds
    ? new Set(Array.from(finishedCandidateIds).filter(id => {
        const snapshot = fixtureSnapshotsById ? fixtureSnapshotsById.get(id) : null;
        return !snapshot || !FINISHED_STATUSES.has(snapshot.statusShort);
      }))
    : null;
  const shouldFullRecompute = opts.forceRun || (newlyFinishedCandidateIds && newlyFinishedCandidateIds.size > 0);

  const detailCandidateGames = shouldFullRecompute
    ? uniqueGamesByFixtureId([
        ...(opts.forceRun ? allApiGames.filter(isScoringFixture) : finishedGames),
        ...liveCandidateGames,
        ...preMatchLineupCandidateGames
      ])
    : uniqueGamesByFixtureId([
        ...scoringCandidateGames,
        ...preMatchLineupCandidateGames
      ]);
  const liveGamesForTick = detailCandidateGames.filter(g => LIVE_STATUSES.has(getFixtureStatusShort(g)));

  if (opts.audit) {
    opts.audit.finishedGamesTotal = finishedGames.length;
    opts.audit.candidatesNowFinished = finishedCandidateIds ? finishedCandidateIds.size : finishedGames.length;
    opts.audit.newlyFinished = newlyFinishedCandidateIds ? newlyFinishedCandidateIds.size : 0;
    opts.audit.newlyFinishedFixtureIds = newlyFinishedCandidateIds ? Array.from(newlyFinishedCandidateIds).sort() : [];
    opts.audit.shouldFullRecompute = !!shouldFullRecompute;
    opts.audit.scoringFixtureIds = detailCandidateGames.map(g => String(g.fixture.id));
    opts.audit.liveFixtureIds = liveGamesForTick.map(g => String(g.fixture.id));
  }

  logInfo(
    `API meldet ${finishedGames.length} beendete Spiele insgesamt, ` +
    `${liveGamesForTick.length} laufende Spiele in diesem Tick, ` +
    `${detailCandidateGames.length} Detail-Kandidat(en) fuer diesen Punkte-Tick ` +
    `(${preMatchLineupCandidateGames.length} vor Anpfiff moeglich).`
  );

  if (candidateFixtureIds && candidateGames.length > 0) {
    try {
      await publishFixtureStatusUpdates(
        db,
        tournament,
        candidateGames,
        opts,
        fixtureSnapshotsById,
        'frueh aus Fixture-Liste',
        'earlyFixtureWriteResult'
      );
    } catch (err) {
      logWarn(`Fruehes Fixture-Status-Update fehlgeschlagen; Punkte-Workflow laeuft weiter: ${err.message}`);
    }
  }

  if (candidateFixtureIds && finishedCandidateIds && finishedCandidateIds.size > 0) {
    logInfo(`${finishedCandidateIds.size} der ${candidateFixtureIds.size} Kandidaten sind laut API beendet.`);
    if (newlyFinishedCandidateIds && newlyFinishedCandidateIds.size > 0) {
      logInfo(`${newlyFinishedCandidateIds.size} Kandidat(en) sind neu final – fuehre volle Neuberechnung aller beendeten Spiele aus.`);
    }
  }

  if (detailCandidateGames.length === 0) {
    logInfo('Noch kein Kandidat mit Live-/Finalstatus – keine Detail-Calls und kein Punkte-Write.');
    return {
      ok: true,
      writeSuccess: 0,
      deleteSuccess: 0,
      finishedGames: finishedGames.length,
      scoringGames: 0,
      liveGames: 0,
      candidatesNowFinished: 0
    };
  }

  const scoringGames = detailCandidateGames;

  let changedPlayerIds = null;
  let existingPoints = null;
  let modeLabel = 'vollstaendige Neuberechnung';
  if (shouldFullRecompute) {
    playersData.forEach(p => { allPlayerPoints[String(p['player.id'])] = buildEmptyPlayerObject(p); });
  } else {
    modeLabel = 'Delta/Reconciliation';
    changedPlayerIds = new Set();
    logInfo('Lade bestehende Punktedokumente als Basis fuer Delta/Reconciliation.');
    existingPoints = await readExistingPointsForReconciliation(db, tournament, opts);
    const replaceFixtureIds = new Set(scoringGames.map(g => String(g.fixture.id)));
    Object.assign(
      allPlayerPoints,
      buildPointBaseFromExisting(playersData, existingPoints, replaceFixtureIds, changedPlayerIds)
    );
  }
  logInfo(`Punkte-Modus: ${modeLabel}.`);

  const fixtureIds = scoringGames.map(g => String(g.fixture.id));
  const detailsById = await fetchFixtureDetailsByIds(headers, fixtureIds, opts);
  const scoringById = new Map(scoringGames.map(g => [String(g.fixture.id), g]));

  if (preMatchLineupCandidateGames.length > 0) {
    const readyPreMatchCount = preMatchLineupCandidateGames.filter(game =>
      isScoringFixtureWithDetails(game, detailsById.get(String(game.fixture.id)))
    ).length;
    logInfo(`${readyPreMatchCount}/${preMatchLineupCandidateGames.length} Pre-Match-Kandidat(en) haben veroeffentlichte Startelfen.`);
    if (opts.audit) {
      opts.audit.preMatchLineupFixtureIds = preMatchLineupCandidateGames
        .filter(game => isScoringFixtureWithDetails(game, detailsById.get(String(game.fixture.id))))
        .map(game => String(game.fixture.id));
    }
  }

  fixtureIds.forEach(fixId => {
    const detail = detailsById.get(fixId);
    if (detail) rememberFixtureEventsForAudit(opts, detail, scoringById.get(fixId));
  });

  const detailedStatusGames = preferDetailedFixtureGames(scoringGames, detailsById);
  try {
    await publishFixtureStatusUpdates(
      db,
      tournament,
      detailedStatusGames,
      opts,
      fixtureSnapshotsById,
      'aus Detail-Antworten',
      'detailFixtureWriteResult'
    );
  } catch (err) {
    logWarn(`Fixture-Status-Update aus Detail-Antworten fehlgeschlagen; Punkte-Guard laeuft weiter: ${err.message}`);
  }

  // Veröffentlichungs-Guard: Punkte werden nur dann nach Firestore
  // geschrieben, wenn ALLE erwarteten Fixtures verarbeitet wurden.
  // Damit sehen Nutzer nie einen halbfertigen Zwischenstand
  // (z. B. tiefere Gesamtpunktzahlen wegen eines transienten Fehlers).
  const missingIds = fixtureIds.filter(id => !detailsById.has(id));
  if (missingIds.length > 0) {
    throw new Error(
      `Punkte-Update abgebrochen: ${missingIds.length} von ${fixtureIds.length} ` +
      `Live-/Final-Fixtures fehlen in den Detail-Antworten ` +
      `(IDs: ${missingIds.join(', ')}). Es wird nichts publiziert; ` +
      `der naechste Cron-Lauf versucht es erneut.`
    );
  }

  let processedPlayers = 0;
  fixtureIds.forEach(fixId => {
    const fixtureSnapshot = fixtureSnapshotsById ? fixtureSnapshotsById.get(String(fixId)) : null;
    processedPlayers += processFixtureDetail(
      detailsById.get(fixId),
      scoringById.get(fixId),
      allPlayerPoints,
      playersData,
      {
        changedPlayerIds,
        apiToAppPlayerId: opts.apiToAppPlayerId,
        firestoreGoalEvents: fixtureSnapshot && fixtureSnapshot.goalEvents
      }
    );
  });

  Object.values(allPlayerPoints).forEach(recalculateTotalPoints);

  const allowPartialPointDeletes = !changedPlayerIds || scoringGames.every(isFinishedFixture);
  if (changedPlayerIds && !allowPartialPointDeletes) {
    logInfo('Live-/Pre-Match-Delta: leere Spieler-Dokumente werden nicht geloescht, sondern uebersprungen.');
  }
  const writeResult = await writePointsToFirestore(
    db,
    tournament,
    allPlayerPoints,
    { ...opts, allowPartialPointDeletes },
    changedPlayerIds,
    existingPoints
  );
  if (opts.audit) {
    opts.audit.writeResult = {
      written: writeResult.written,
      deleted: writeResult.deleted,
      skipped: writeResult.skipped,
      touched: writeResult.touched
    };
  }
  logInfo(
    `${writeResult.written} Spieler-Dokumente ${opts.dryRun ? '(DRY-RUN) berechnet' : 'in Firestore geschrieben'}, ` +
    `${writeResult.deleted} geloescht/geleert, ${writeResult.skipped} unveraendert uebersprungen, ` +
    `${processedPlayers} Spielereinsaetze verarbeitet.`
  );

  let pointsVersionIncreased = false;
  if (writeResult.touched > 0) {
    let nextPointsVersion = null;
    let pointsCacheMetaFields = buildNullPointsCacheMetaFields();

    if (!opts.dryRun) {
      try {
        const currentMeta = await readPointsMetaDocument(db, tournament);
        const currentPointsVersion = getCurrentPointsVersion(currentMeta);
        nextPointsVersion = currentPointsVersion + 1;
        const cacheResult = await writePublicPointsCacheForNextVersion(
          db,
          tournament,
          allPlayerPoints,
          writeResult,
          currentPointsVersion,
          nextPointsVersion,
          opts,
          existingPoints
        );
        pointsCacheMetaFields = buildSuccessfulPointsCacheMetaFields(
          cacheResult,
          currentPointsVersion,
          nextPointsVersion
        );
      } catch (err) {
        logWarn(
          `Public Points Cache konnte nicht geschrieben werden (${err.message}). ` +
          `pointsVersion wird mit Collection-Fallback-Signal erhoeht.`
        );
        pointsCacheMetaFields = buildNullPointsCacheMetaFields();
      }
    }

    await bumpPointsMetaVersion(db, tournament, opts, nextPointsVersion, pointsCacheMetaFields);
    pointsVersionIncreased = !opts.dryRun;
    logInfo(`Meta-Dokument ${tournament.firestore.metaCollection}/${tournament.firestore.metaDocId} ${opts.dryRun ? '(DRY-RUN) ' : ''}aktualisiert.`);
  } else {
    logInfo('Keine Spieler-Punktedokumente veraendert - pointsVersion bleibt unveraendert.');
  }
  if (opts.audit) {
    opts.audit.pointsVersionIncreased = pointsVersionIncreased;
  }

  // Anzahl der Kandidaten, die laut API jetzt beendet sind. Bei FORCE_RUN
  // gibt es kein Kandidaten-Set – dann werten wir den Lauf als
  // vollstaendige Neuberechnung und behandeln die Fixtures als geaendert.
  const candidatesNowFinished = candidateFixtureIds
    ? finishedGames.filter(g => candidateFixtureIds.has(String(g.fixture.id))).length
    : finishedGames.length;

  try {
    const statusGames = shouldFullRecompute
      ? uniqueGamesByFixtureId([...(opts.forceRun ? scoringGames : finishedGames), ...liveCandidateGames])
      : scoringCandidateGames;
    const preferredStatusGames = preferDetailedFixtureGames(statusGames, detailsById);
    await publishFixtureStatusUpdates(
      db,
      tournament,
      preferredStatusGames,
      opts,
      fixtureSnapshotsById,
      'nach Punkte-Write'
    );
  } catch (err) {
    logWarn(`Fixture-Status-Update fehlgeschlagen (Punkte sind trotzdem geschrieben): ${err.message}`);
  }

  return {
    ok: true,
    writeSuccess: writeResult.written,
    deleteSuccess: writeResult.deleted,
    finishedGames: finishedGames.length,
    scoringGames: scoringGames.length,
    liveGames: liveGamesForTick.length,
    candidatesNowFinished,
    writeResult,
    fixtureWriteResult: opts.audit ? opts.audit.fixtureWriteResult : { updated: 0, skipped: 0 },
    pointsVersionIncreased,
    fixturesVersionIncreased: !!(opts.audit && opts.audit.fixturesVersionIncreased)
  };
}

/* ─────────────────────────────────────────────────────────────────────────────
 *  Entrypoint
 * ───────────────────────────────────────────────────────────────────────────── */
async function runUploadTick(db, tournament, opts, tickIndex, totalTicks) {
  const audit = createTickAudit(tournament, opts, tickIndex, totalTicks);
  const tickOpts = { ...opts, audit };
  activeAuditLog = audit;

  if (totalTicks > 1) {
    logInfo(`Live-Tick ${tickIndex}/${totalTicks}.`);
  }

  try {
    let candidateIds = null;
    let fixtureSnapshotsById = null;
    let nextWakeAtMs = null;
    let openCandidateCount = 0;
    let finalRecheckCandidateCount = 0;
    let ownGoalRecheckCandidateCount = 0;
    if (opts.forceRun) {
      logInfo('FORCE_RUN aktiv – Pre-Check übersprungen, Workflow wird in jedem Fall ausgeführt.');
      const cache = await ensureFixturePlanCacheLoaded(db, tournament, tickOpts);
      fixtureSnapshotsById = new Map(
        cache.all
          .map(buildFixtureInfoFromPlanRecord)
          .filter(c => c && c.id != null)
          .map(c => [String(c.id), c])
      );
      logInfo(`Fixture-Snapshots fuer Event-Fallback geladen: ${fixtureSnapshotsById.size}.`);
    } else {
      const { all, candidates: baseCandidates, nextWakeAtMs: nextWake } = await findCandidateFixtures(db, tournament, tickOpts);
      const candidates = [...baseCandidates];
      nextWakeAtMs = nextWake;
      const ownGoalRechecks = await findUnreconciledOwnGoalFixtures(db, tournament, all, tickOpts);
      if (ownGoalRechecks.length > 0) {
        ownGoalRechecks.forEach(recheck => {
          const existing = candidates.find(c => String(c.id) === String(recheck.id));
          if (existing) {
            existing.ownGoalRecheck = true;
            existing.ownGoalRecheckDetails = recheck.details;
            return;
          }
          const fxInfo = all.find(c => String(c.id) === String(recheck.id)) || {
            id: recheck.id,
            label: recheck.label
          };
          candidates.push({
            ...fxInfo,
            ownGoalRecheck: true,
            ownGoalRecheckDetails: recheck.details
          });
        });
        audit.ownGoalRecheckFixtureIds = ownGoalRechecks.map(r => String(r.id)).sort();
        audit.ownGoalRecheckCount = ownGoalRechecks.reduce((sum, r) => sum + ((r.details && r.details.length) || 0), 0);
        logInfo(`${ownGoalRechecks.length} Fixture(s) wegen fehlender Eigentor-Punkte erneut vorgemerkt: ${audit.ownGoalRecheckFixtureIds.join(', ')}.`);
      }
      openCandidateCount = candidates.filter(c => !FINISHED_STATUSES.has(c.statusShort)).length;
      finalRecheckCandidateCount = candidates.filter(c => c.finalRecheck).length;
      ownGoalRecheckCandidateCount = candidates.filter(c => c.ownGoalRecheck).length;
      logInfo(`Spielplan: ${all.length} Spiele im Fixture-Plan-Cache. Kandidaten in diesem Tick: ${candidates.length}.`);
      if (candidates.length === 0) {
        logInfo('Nichts zu tun – kein Spiel im Live-/Catch-up-Fenster mit offenem Status. Beende ohne API-Call.');
        return {
          hadCandidates: false,
          result: null,
          nextWakeAtMs,
          openCandidateCount,
          finalRecheckCandidateCount,
          ownGoalRecheckCandidateCount
        };
      }
      candidates.forEach(c => {
        const ageMin = (typeof c.ageMin === 'number') ? c.ageMin : Math.round((nowMs() - c.kickoffMs) / 60_000);
        const tag = c.ownGoalRecheck ? ' [OWN-GOAL-RECHECK]' : (c.finalRecheck ? ' [FINAL-RECHECK]' : (c.overdue ? ' [CATCH-UP / ueberfaellig]' : ''));
        logInfo(`  • Kandidat ${c.id} (${c.label}) – Status="${c.statusShort || 'unbekannt'}", ${formatAgeMin(ageMin)}.${tag}`);
      });
      candidateIds = new Set(candidates.map(c => String(c.id)));
      audit.candidateFixtureIds = Array.from(candidateIds).sort();
      fixtureSnapshotsById = new Map(
        all
          .filter(c => c && c.id != null)
          .map(c => [String(c.id), c])
      );
    }

    const result = await runFullPointsUpload(db, tournament, tickOpts, candidateIds, fixtureSnapshotsById);
    logInfo(`Lauf-Tick beendet. Beendete Spiele (gesamt): ${result.finishedGames}, ` +
      `Scoring-Spiele: ${result.scoringGames}, Live-Spiele: ${result.liveGames}, ` +
      `Spieler-Dokumente geschrieben: ${result.writeSuccess}, geloescht: ${result.deleteSuccess}, ` +
      `Kandidaten jetzt beendet: ${result.candidatesNowFinished}.`);

    return {
      hadCandidates: true,
      result,
      nextWakeAtMs,
      openCandidateCount,
      finalRecheckCandidateCount,
      ownGoalRecheckCandidateCount
    };
  } catch (err) {
    audit.error = err && err.message ? err.message : String(err);
    throw err;
  } finally {
    activeAuditLog = null;
    await maybeWriteTickAudit(db, audit);
  }
}

function sessionRemainingMs(opts) {
  if (!opts || !Number.isFinite(opts.sessionDeadlineMs)) return Number.POSITIVE_INFINITY;
  return Math.max(0, opts.sessionDeadlineMs - nowMs());
}

function plannedMonitorDurationMs(opts = {}) {
  const ticks = Math.max(1, opts.liveTicksPerRun || DEFAULT_LIVE_TICKS_PER_RUN);
  const intervalSec = Math.max(1, opts.liveTickIntervalSec || DEFAULT_LIVE_TICK_INTERVAL_SEC);
  return ticks * intervalSec * 1000;
}

function requiredMonitorAfterWakeMs(opts) {
  const windowStartMin = Number.isFinite(opts && opts.windowStartMin)
    ? opts.windowStartMin
    : DEFAULT_WINDOW_START_MIN;
  const windowEndMin = Number.isFinite(opts && opts.windowEndMin)
    ? opts.windowEndMin
    : DEFAULT_WINDOW_END_MIN;
  const liveWindowMin = Math.max(60, windowEndMin - windowStartMin);
  const requiredMin = liveWindowMin + MIN_MONITOR_AFTER_WAKE_BUFFER_MIN;
  return Math.min(plannedMonitorDurationMs(opts), requiredMin * 60_000);
}

function getIdleWaitMs(nextWakeAtMs, opts) {
  if (!Number.isFinite(nextWakeAtMs)) return null;

  const now = nowMs();
  const waitMs = Math.max(0, nextWakeAtMs - now);
  const maxIdleMs = Math.max(0, (opts && opts.idleWaitMaxMin) || 0) * 60_000;
  if (maxIdleMs <= 0 || waitMs > maxIdleMs) return null;

  const remainingMs = sessionRemainingMs(opts);
  const minWorkAfterWakeMs = Math.max(60_000, requiredMonitorAfterWakeMs(opts));
  if (remainingMs < waitMs + minWorkAfterWakeMs) {
    logInfo(
      `Naechstes Live-Fenster liegt in ${formatDurationMs(waitMs)}, ` +
      `aber die Restlaufzeit reicht nicht fuer ${formatDurationMs(minWorkAfterWakeMs)} Monitoring danach.`
    );
    return null;
  }

  return Math.max(1000, waitMs);
}

async function maybeWaitForNextLiveWindow(tickResult, opts, reason) {
  const waitMs = getIdleWaitMs(tickResult && tickResult.nextWakeAtMs, opts);
  if (waitMs == null) return false;

  logInfo(
    `${reason} Naechstes Live-Fenster beginnt um ` +
    `${new Date(tickResult.nextWakeAtMs).toISOString()}; warte ${formatDurationMs(waitMs)}.`
  );
  await delay(waitMs);
  return true;
}

async function main() {
  const envKey = (process.env.TOURNAMENT_KEY || '').trim().toLowerCase();
  const tournamentKey = envKey || APP_CONFIG.activeTournamentKey;
  const tournament = TOURNAMENTS[tournamentKey];
  const forceRun = envBool('FORCE_RUN', false);
  const dryRun = envBool('DRY_RUN', false);
  const triggerName = String(process.env.GITHUB_EVENT_NAME || '').toLowerCase();
  const isScheduledRun = triggerName === 'schedule';
  const isPushRun = triggerName === 'push';
  const isOneShotRun = forceRun || isPushRun;

  // Punkte-Sync akzeptiert regulär verfügbare UND als Vorschau ladbare
  // Turniere (z. B. das Test-Turnier cl2526). Der Sync schreibt nur in die
  // turnier-eigenen Collections + turnier-spezifischen Public-Cache-Doks,
  // daher ist das unbedenklich (analog sync-fixtures.js).
  const available = APP_CONFIG.isTournamentAvailable(tournamentKey);
  const previewable = typeof APP_CONFIG.isTournamentPreviewable === 'function'
    && APP_CONFIG.isTournamentPreviewable(tournamentKey);
  if (!tournament || !(available || previewable)) {
    const previewList = (typeof APP_CONFIG.getPreviewableTournamentKeys === 'function'
      ? APP_CONFIG.getPreviewableTournamentKeys() : []).join(', ') || '(keine)';
    logError(
      `Ungültiger TOURNAMENT_KEY="${tournamentKey}". ` +
      `Verfügbar: ${APP_CONFIG.getAvailableTournamentKeys().join(', ') || '(keine)'}; ` +
      `als Vorschau synchronisierbar: ${previewList}. ` +
      `Env-Variable TOURNAMENT_KEY leer lassen, um den Default zu verwenden.`
    );
    process.exit(1);
  }
  if (!tournament.api || !tournament.api.competitionId) {
    logError(`Für Turnier ${tournament.shortLabel} ist keine API competitionId konfiguriert.`);
    process.exit(1);
  }

  let windowStartMin = envIntAny(['POINTS_WINDOW_START_MIN', 'WINDOW_START_MIN'], DEFAULT_WINDOW_START_MIN);
  if (isScheduledRun && !forceRun && windowStartMin > 0) {
    logInfo(`Scheduled Run: positiver windowStartMin=${windowStartMin} defensiv auf ${DEFAULT_WINDOW_START_MIN} korrigiert.`);
    windowStartMin = DEFAULT_WINDOW_START_MIN;
  }

  let liveTicksPerRun = envPositiveIntAny(
    ['POINTS_LIVE_TICKS_PER_RUN', 'LIVE_TICKS_PER_RUN'],
    DEFAULT_LIVE_TICKS_PER_RUN,
    MAX_LIVE_TICKS_PER_RUN
  );
  if (isPushRun && !forceRun) {
    liveTicksPerRun = 1;
  }
  if (isScheduledRun && !forceRun && liveTicksPerRun < MIN_SCHEDULED_LIVE_TICKS_PER_RUN) {
    logInfo(`Scheduled Run: liveTicksPerRun=${liveTicksPerRun} defensiv auf ${MIN_SCHEDULED_LIVE_TICKS_PER_RUN} erhoeht.`);
    liveTicksPerRun = MIN_SCHEDULED_LIVE_TICKS_PER_RUN;
  }

  let liveTickIntervalSec = envPositiveIntAny(
    ['POINTS_LIVE_TICK_INTERVAL_SEC', 'LIVE_TICK_INTERVAL_SEC'],
    DEFAULT_LIVE_TICK_INTERVAL_SEC
  );
  if (isScheduledRun && !forceRun && liveTickIntervalSec < MIN_SCHEDULED_LIVE_TICK_INTERVAL_SEC) {
    logInfo(`Scheduled Run: liveTickIntervalSec=${liveTickIntervalSec} defensiv auf ${MIN_SCHEDULED_LIVE_TICK_INTERVAL_SEC} erhoeht.`);
    liveTickIntervalSec = MIN_SCHEDULED_LIVE_TICK_INTERVAL_SEC;
  }

  let sessionMaxMin = Math.min(
    MAX_SESSION_MAX_MIN,
    Math.max(1, envIntAny(['POINTS_SESSION_MAX_MIN', 'SESSION_MAX_MIN'], DEFAULT_SESSION_MAX_MIN))
  );
  if (isPushRun && !forceRun) {
    sessionMaxMin = 1;
  }
  if (isScheduledRun && !forceRun && sessionMaxMin < MIN_SCHEDULED_SESSION_MAX_MIN) {
    logInfo(`Scheduled Run: sessionMaxMin=${sessionMaxMin} defensiv auf ${MIN_SCHEDULED_SESSION_MAX_MIN} erhoeht.`);
    sessionMaxMin = MIN_SCHEDULED_SESSION_MAX_MIN;
  }

  const opts = {
    windowStartMin,
    windowEndMin: envIntAny(['POINTS_WINDOW_END_MIN', 'WINDOW_END_MIN'], DEFAULT_WINDOW_END_MIN),
    finalRecheckMin: Math.max(0, envIntAny(['POINTS_FINAL_RECHECK_MIN', 'FINAL_RECHECK_MIN'], DEFAULT_FINAL_RECHECK_MIN)),
    liveTicksPerRun,
    liveTickIntervalSec,
    idleWaitMaxMin: isPushRun && !forceRun
      ? 0
      : Math.max(0, envIntAny(['POINTS_IDLE_WAIT_MAX_MIN', 'IDLE_WAIT_MAX_MIN'], DEFAULT_IDLE_WAIT_MAX_MIN)),
    sessionMaxMin,
    apiRetryAttempts: Math.max(1, envIntAny(['POINTS_API_RETRY_ATTEMPTS', 'API_RETRY_ATTEMPTS'], DEFAULT_API_RETRY_ATTEMPTS)),
    apiRetryBaseDelayMs: Math.max(0, envIntAny(['POINTS_API_RETRY_BASE_DELAY_MS', 'API_RETRY_BASE_DELAY_MS'], DEFAULT_API_RETRY_BASE_DELAY_MS)),
    fixturePlanRefreshEveryTicks: Math.max(0, envIntAny('POINTS_FIXTURE_PLAN_REFRESH_EVERY_TICKS', DEFAULT_FIXTURE_PLAN_REFRESH_EVERY_TICKS)),
    fixturePlanCache: {},
    forceRun,
    dryRun
  };
  opts.sessionStartedAtMs = nowMs();
  opts.sessionDeadlineMs = opts.sessionStartedAtMs + opts.sessionMaxMin * 60_000;

  logInfo(`Starte Auto-Upload für ${tournament.shortLabel} (${tournament.key}).` +
    ` Trigger-Fenster: ${opts.windowStartMin} bis ${opts.windowEndMin} min relativ zum Anpfiff` +
    ` (Live + Catch-up), Final-Recheck bis ${opts.finalRecheckMin} min nach Anpfiff.` +
    ` Live-Ticks pro Run: ${isOneShotRun ? 1 : opts.liveTicksPerRun}, Abstand: ${opts.liveTickIntervalSec}s.` +
    ` Idle-Wait bis ${opts.idleWaitMaxMin} min, Session-Max ${isOneShotRun ? '1 Tick' : opts.sessionMaxMin + ' min'}.` +
    ` API-Retry: ${opts.apiRetryAttempts} Versuch(e), Basis ${opts.apiRetryBaseDelayMs}ms.` +
    ` Fixture-Plan-Refresh: ${opts.fixturePlanRefreshEveryTicks === 0 ? 'nur initial' : 'alle ' + opts.fixturePlanRefreshEveryTicks + ' Ticks'}.` +
    (opts.forceRun ? ' [FORCE_RUN]' : '') +
    (opts.dryRun ? ' [DRY_RUN]' : ''));
  logInfo(
    `Effektive Konfiguration: tournamentKey=${tournament.key}, ` +
    `windowStartMin=${opts.windowStartMin}, windowEndMin=${opts.windowEndMin}, ` +
    `finalRecheckMin=${opts.finalRecheckMin}, liveTicksPerRun=${isOneShotRun ? 1 : opts.liveTicksPerRun}, ` +
    `liveTickIntervalSec=${opts.liveTickIntervalSec}, fixturePlanRefreshEveryTicks=${opts.fixturePlanRefreshEveryTicks}, ` +
    `forceRun=${opts.forceRun}, dryRun=${opts.dryRun}.`
  );

  // ─────────────────────────────────────────────────────────────────────
  // Phasen-Guard: nur innerhalb des konfigurierten Turnierfensters wird
  // überhaupt gearbeitet. Vor- und nach dem Turnier soll der Workflow
  // weder Firebase initialisieren noch Firestore lesen noch die externe
  // API ansprechen. FORCE_RUN übersteuert den Guard, damit manuelle
  // Tests jederzeit möglich sind.
  // ─────────────────────────────────────────────────────────────────────
  if (!opts.forceRun) {
    const fromMs = parseIsoToMs(tournament.AUTO_POINTS_FROM);
    const untilMs = parseIsoToMs(tournament.AUTO_POINTS_UNTIL);
    const now = nowMs();

    const beforePhase = fromMs != null && now < fromMs;
    const afterPhase = untilMs != null && now > untilMs;

    if (beforePhase || afterPhase) {
      const fromStr = tournament.AUTO_POINTS_FROM || '(nicht gesetzt)';
      const untilStr = tournament.AUTO_POINTS_UNTIL || '(nicht gesetzt)';
      logInfo(
        `Auto-Punkte-Phase ist nicht aktiv – beende ohne Firebase-Read ` +
        `und ohne API-Call. (Fenster: ${fromStr} bis ${untilStr}, ` +
        `aktuell ${new Date(now).toISOString()}, ` +
        `${beforePhase ? 'vor Phasenstart' : 'nach Phasenende'}.) ` +
        `Tipp: workflow_dispatch mit force_run=true setzen, um den Guard zu übersteuern.`
      );
      return;
    }
  } else {
    logInfo('FORCE_RUN aktiv – Phasen-Guard (AUTO_POINTS_FROM/UNTIL) wird übersprungen.');
  }

  let db;
  try {
    db = initFirebase();
  } catch (err) {
    logError(err.message);
    process.exit(1);
  }

  try {
    const totalTicks = isOneShotRun ? 1 : opts.liveTicksPerRun;
    let tick = 1;
    while (tick <= totalTicks) {
      if (!opts.forceRun && sessionRemainingMs(opts) <= 0) {
        logInfo(`Monitor-Session nach ${opts.sessionMaxMin} min beendet.`);
        break;
      }

      const tickResult = await runUploadTick(db, tournament, opts, tick, totalTicks);
      if (opts.forceRun) break;

      if (!tickResult.hadCandidates) {
        const waited = await maybeWaitForNextLiveWindow(
          tickResult,
          opts,
          'Kein Kandidat in diesem Tick.'
        );
        if (!waited) break;
        continue;
      }

      const onlyReconciliation =
        tickResult.openCandidateCount === 0 &&
        (tickResult.finalRecheckCandidateCount > 0 || tickResult.ownGoalRecheckCandidateCount > 0) &&
        (!tickResult.result || tickResult.result.liveGames === 0);

      if (onlyReconciliation) {
        const waited = await maybeWaitForNextLiveWindow(
          tickResult,
          opts,
          'Nur Reconciliation-Kandidaten uebrig.'
        );
        if (!waited) {
          logInfo('Nur Reconciliation-Kandidaten uebrig und kein weiteres Live-Fenster in Reichweite - beende Session.');
          break;
        }
        continue;
      }

      const intervalMs = opts.liveTickIntervalSec * 1000;
      if (tick >= totalTicks) {
        const openMatchStillActive =
          tickResult.openCandidateCount > 0 ||
          !!(tickResult.result && tickResult.result.liveGames > 0);
        if (openMatchStillActive) {
          logWarn(
            `Tick-Budget (${totalTicks}) ausgeschoepft, obwohl noch ein offenes/live Spiel im Kandidatenfenster ist. ` +
            `Scheduled Runs sollten mindestens ${MIN_SCHEDULED_LIVE_TICKS_PER_RUN} Ticks mit ` +
            `${MIN_SCHEDULED_LIVE_TICK_INTERVAL_SEC}s Abstand haben.`
          );
        }
        break;
      }

      const waitMs = Math.min(intervalMs, sessionRemainingMs(opts));
      if (waitMs <= 0) {
        logInfo(`Monitor-Session nach ${opts.sessionMaxMin} min beendet.`);
        break;
      }
      logInfo(`Warte ${formatDurationMs(waitMs)} bis zum naechsten Live-Tick.`);
      await delay(waitMs);
      tick++;
    }
    logInfo('Auto-Punkte-Run abgeschlossen.');
  } catch (err) {
    logError(`Upload-Workflow fehlgeschlagen: ${err.message}`);
    if (err.stack) console.error(err.stack);
    process.exit(2);
  }
}

if (require.main === module) {
  main().catch(err => {
    logError('Unerwarteter Fehler: ' + (err && err.message || err));
    if (err && err.stack) console.error(err.stack);
    process.exit(2);
  });
}

module.exports = {
  buildEmptyPlayerObject,
  processFixtureDetail,
  recalculateTotalPoints,
  shouldTreatStatsAsStarter
};
