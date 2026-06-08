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
 *    1. Lädt Spielplan (`fixturesCollection`) aus Firestore – keine API-Kosten.
 *    2. Bestimmt Kandidaten-Spiele: Anpfiff liegt mindestens
 *       `WINDOW_START_MIN` Minuten entfernt/zurueck UND der Status ist
 *       entweder noch nicht FT/AET/PEN oder liegt als finaler Status noch
 *       im Reconciliation-Fenster (`FINAL_RECHECK_MIN`). Mit den Defaults
 *       -10/150 startet der Live-Load 10 Minuten vor Anpfiff.
 *       `WINDOW_END_MIN` dient danach als Schwelle, ab der ein offenes
 *       Spiel als "ueberfaellig" (Catch-up) markiert/geloggt wird – es
 *       gibt bewusst KEINE harte obere Zeitgrenze mehr fuer offene Spiele,
 *       damit verlaengerte oder verpasste Spiele automatisch nachgezogen
 *       werden. Wenn keine Kandidaten existieren, beendet sich der Lauf
 *       ohne API-Call (Quota-Schutz).
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
 *  Env-Variablen (aus GitHub Actions Secrets / Variables):
 *    RAPIDAPI_KEY              RapidAPI / API-Football Key (zwingend)
 *    FIREBASE_SERVICE_ACCOUNT  Service-Account-JSON als String (zwingend)
 *    TOURNAMENT_KEY            Optional. Default = Fallback aus
 *                              tournament-config.js. Aktuell ist nur
 *                              `wm2026` produktiv konfiguriert; andere
 *                              Keys führen zu einem expliziten Abbruch.
 *    WINDOW_START_MIN          Optional, Default -10. Start des Live-
 *                              Fensters relativ zum Anpfiff.
 *    WINDOW_END_MIN            Optional, Default 150. Normales Ende des
 *                              Live-Fensters relativ zum Anpfiff. Danach
 *                              bleibt ein offenes Spiel als Catch-up-
 *                              Kandidat aktiv (siehe Ablauf-Schritt 2).
 *    FINAL_RECHECK_MIN         Optional, Default 360. Beendete Spiele
 *                              bleiben bis so viele Minuten nach Anpfiff
 *                              Kandidaten, damit nachtraegliche API-
 *                              Korrekturen automatisch nachgezogen werden.
 *    LIVE_TICKS_PER_RUN        Optional, Default 5. Anzahl Ticks innerhalb
 *                              eines GitHub-Runs, wenn Kandidaten aktiv
 *                              sind. FORCE_RUN macht immer nur einen Tick.
 *    LIVE_TICK_INTERVAL_SEC    Optional, Default 60. Abstand zwischen den
 *                              Live-Ticks innerhalb desselben Runs.
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
  console.error('[auto-points] firebase-admin ist nicht installiert. Bitte `npm install` ausführen.');
  process.exit(1);
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

const FINISHED_STATUSES = new Set(['FT', 'AET', 'PEN']);
const LIVE_STATUSES = new Set(['1H', 'HT', '2H', 'ET', 'BT', 'P', 'SUSP', 'INT', 'LIVE']);
const SCORING_STATUSES = new Set([...FINISHED_STATUSES, ...LIVE_STATUSES]);
const DEFAULT_WINDOW_START_MIN = -10;
const DEFAULT_WINDOW_END_MIN = 150;
const DEFAULT_FINAL_RECHECK_MIN = 360;
const DEFAULT_LIVE_TICKS_PER_RUN = 5;
const DEFAULT_LIVE_TICK_INTERVAL_SEC = 60;
const WORKSPACE_ROOT = path.resolve(__dirname, '..');

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

function logInfo(msg) {
  console.log(`[auto-points] ${msg}`);
}

function logWarn(msg) {
  console.warn(`[auto-points] ⚠️ ${msg}`);
}

function logError(msg) {
  console.error(`[auto-points] ❌ ${msg}`);
}

function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
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

function formatAgeMin(ageMin) {
  if (typeof ageMin !== 'number' || !Number.isFinite(ageMin)) return 'unbekannter Abstand';
  if (ageMin < 0) return `${Math.abs(ageMin)} min VOR ANPFIFF`;
  if (ageMin === 0) return '0 min NACH ANPFIFF';
  return `${ageMin} min NACH ANPFIFF`;
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
 *  Pre-Check (nur Firestore – keine API-Quota)
 *
 *  Lädt einmalig den kompletten Spielplan und entscheidet, ob der teure
 *  Upload-Workflow überhaupt anlaufen muss. Ein Spiel zählt als Kandidat,
 *  wenn sein Anpfiff (kickoffTimestamp) mindestens `windowStartMin`
 *  Minuten entfernt ist und das Spiel in Firestore noch nicht als beendet
 *  markiert ist oder noch im finalen Reconciliation-Fenster liegt. Mit den
 *  Live-Defaults -10/150 startet der teure API-Teil kurz vor dem Kickoff
 *  und läuft während des Spiels. Nach `windowEndMin` bleibt ein offenes
 *  Spiel als Catch-up-Kandidat aktiv, bis Firestore den Finalstatus kennt.
 *  Danach wird ein finaler Status noch `finalRecheckMin` Minuten nach
 *  Anpfiff weiter geprüft, damit nachtraegliche API-Korrekturen nicht
 *  manuell nachgezogen werden muessen.
 * ───────────────────────────────────────────────────────────────────────────── */
async function findCandidateFixtures(db, tournament, opts) {
  const collectionName = tournament.firestore.fixturesCollection;
  const snap = await db.collection(collectionName).get();

  const now = nowMs();
  const windowStartMs = opts.windowStartMin * 60_000;
  const windowEndMs = opts.windowEndMin * 60_000;
  const finalRecheckMs = opts.finalRecheckMin * 60_000;

  const all = [];
  const candidates = [];

  snap.forEach(doc => {
    const data = doc.data() || {};
    const kickoffSec = data.kickoffTimestamp;
    const statusShort = (data.status && data.status.short) || '';
    const homeName = (data.homeTeam && data.homeTeam.name) || '';
    const awayName = (data.awayTeam && data.awayTeam.name) || '';

    const fxInfo = {
      id: doc.id,
      kickoffMs: (typeof kickoffSec === 'number') ? kickoffSec * 1000 : null,
      statusShort,
      statusLong: (data.status && data.status.long) || '',
      statusElapsed: (data.status && data.status.elapsed) != null ? data.status.elapsed : null,
      goalsHome: (data.goals && data.goals.home) != null ? data.goals.home : null,
      goalsAway: (data.goals && data.goals.away) != null ? data.goals.away : null,
      score: data.score || {},
      homeWinner: (data.homeTeam && data.homeTeam.winner != null) ? data.homeTeam.winner : null,
      awayWinner: (data.awayTeam && data.awayTeam.winner != null) ? data.awayTeam.winner : null,
      label: (homeName && awayName) ? `${homeName} vs ${awayName}` : `Spiel ${doc.id}`
    };
    all.push(fxInfo);

    if (!fxInfo.kickoffMs) return;

    const ageMs = now - fxInfo.kickoffMs;
    const isFinished = FINISHED_STATUSES.has(fxInfo.statusShort);
    const notFinished = !isFinished;
    const inFinalRecheck = isFinished && opts.finalRecheckMin > 0 && ageMs >= 0 && ageMs <= finalRecheckMs;

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
    // Beendete Spiele werden danach noch fuer `FINAL_RECHECK_MIN` Minuten
    // nach Anpfiff erneut geprueft. Damit zieht der naechste Cron-Tick
    // spaete API-Korrekturen an Scorern, Assists, Karten usw. automatisch
    // nach.
    //
    // Quota-Schutz bleibt erhalten: pro Tick faellt zuerst nur EIN
    // Firestore-Read (Spielplan) an. Das Phasen-Fenster
    // (AUTO_POINTS_UNTIL) begrenzt Catch-up und Reconciliation zeitlich
    // nach oben.
    if (ageMs >= windowStartMs && (notFinished || inFinalRecheck)) {
      fxInfo.ageMin = Math.round(ageMs / 60_000);
      fxInfo.overdue = notFinished && ageMs > windowEndMs;
      fxInfo.finalRecheck = inFinalRecheck;
      candidates.push(fxInfo);
    }
  });

  return { all, candidates };
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

function collectLineupPlayerIds(lineup, key) {
  const ids = new Set();
  const rows = lineup && Array.isArray(lineup[key]) ? lineup[key] : [];
  rows.forEach(row => {
    const id = row && row.player && row.player.id;
    if (id != null) ids.add(String(id));
  });
  return ids;
}

function findLineupForTeam(fixtureData, teamId) {
  const lineups = fixtureData && Array.isArray(fixtureData.lineups) ? fixtureData.lineups : [];
  const target = teamId != null ? String(teamId) : '';
  return lineups.find(entry => entry && entry.team && String(entry.team.id) === target) || null;
}

function getPrimaryStats(pStats) {
  return (pStats && Array.isArray(pStats.statistics) && pStats.statistics[0]) || {};
}

function getMinutes(stats) {
  return (stats && stats.games && typeof stats.games.minutes === 'number') ? stats.games.minutes : 0;
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

  const statusShort = getFixtureStatusShort(game);
  const matchHasStarted = SCORING_STATUSES.has(statusShort);
  const matchIsFinished = FINISHED_STATUSES.has(statusShort);

  const homeName = (game.teams && game.teams.home && game.teams.home.name) || '';
  const awayName = (game.teams && game.teams.away && game.teams.away.name) || '';
  const homeGoals = getGoalValue(game.goals && game.goals.home);
  const awayGoals = getGoalValue(game.goals && game.goals.away);
  const matchOutcome = resolveMatchOutcome(game, matchHasStarted, matchIsFinished, homeGoals, awayGoals);
  const fixId = game.fixture.id;
  const resultString = `${homeName} ${homeGoals} : ${awayGoals} ${awayName}`;
  let processedPlayers = 0;

  const subbedOutPlayerIds = events
    .filter(e => e.type && e.type.toLowerCase() === 'subst')
    .map(e => e.player && e.player.id)
    .filter(id => id != null)
    .map(id => String(id));

  const subbedInPlayerIds = events
    .filter(e => e.type && e.type.toLowerCase() === 'subst')
    .map(e => e.assist && e.assist.id)
    .filter(id => id != null)
    .map(id => String(id));

  const ownGoalsMap = {};
  events.forEach(e => {
    if (e.type && e.type.toLowerCase() === 'goal' && e.detail && e.detail.toLowerCase() === 'own goal') {
      if (e.player && e.player.id) {
        const id = String(e.player.id);
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
    const starterIds = collectLineupPlayerIds(lineup, 'startXI');
    const substituteIds = collectLineupPlayerIds(lineup, 'substitutes');
    const statsByPid = new Map();

    (teamStats.players || []).forEach(pStats => {
      const id = pStats && pStats.player && pStats.player.id;
      if (id != null) statsByPid.set(String(id), pStats);
    });

    const participantIds = new Set();
    statsByPid.forEach((pStats, pid) => {
      const stats = getPrimaryStats(pStats);
      const minutes = getMinutes(stats);
      const isApiStarter = stats.games && stats.games.substitute === false;
      if (minutes > 0 || (matchHasStarted && isApiStarter)) {
        participantIds.add(pid);
      }
    });

    if (matchHasStarted) {
      starterIds.forEach(pid => participantIds.add(pid));
      subbedInPlayerIds.forEach(pid => {
        if (substituteIds.has(pid) || statsByPid.has(pid)) participantIds.add(pid);
      });
    }

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
      const started = matchHasStarted && (
        starterIds.has(pid) ||
        (stats.games && stats.games.substitute === false)
      );
      const subbedIn = !started && (
        minutes > 0 ||
        subbedInPlayerIds.includes(pid) ||
        (stats.games && stats.games.substitute === true)
      );

      if (!started && !subbedIn) return;

      const detailPts = {};
      Object.keys(RULES).forEach(k => { detailPts[k] = 0; });

      const playerInfo = playersData.find(x => String(x['player.id']) === pid);
      const pos = normalizePosition((playerInfo && playerInfo.Position) || 'UNKNOWN');

      if (started) {
        detailPts.START = RULES.START;
        pObj.START += RULES.START;
      } else {
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

      const ownGoals = ownGoalsMap[pid] || 0;
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

      if (matchHasStarted) {
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

function cloneExistingPointObject(source, player) {
  const target = buildEmptyPlayerObject(player);
  if (!source || typeof source !== 'object') return target;

  target.playerName = source.playerName || player.Spielername;
  Object.keys(RULES).forEach(k => {
    target[k] = (typeof source[k] === 'number') ? source[k] : 0;
  });

  Object.entries(source).forEach(([key, value]) => {
    if (key.startsWith('Spiel_') && value && typeof value === 'object') {
      target[key] = value;
    }
  });

  target.totalPoints = (typeof source.totalPoints === 'number') ? source.totalPoints : 0;
  return target;
}

function recalculateTotalPoints(pointObject) {
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
async function writePointsToFirestore(db, tournament, allPlayerPoints, opts, onlyPlayerIds = null, existingPoints = null) {
  const FieldValue = admin.firestore.FieldValue;
  const collection = tournament.firestore.pointsCollection;
  const targetIds = onlyPlayerIds
    ? Array.from(onlyPlayerIds).map(id => String(id)).filter(id => allPlayerPoints[id])
    : Object.keys(allPlayerPoints);
  const isPartialWrite = !!onlyPlayerIds;

  let batch = db.batch();
  let countInBatch = 0;
  let written = 0;
  let deleted = 0;
  let skipped = 0;

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
      countInBatch++;
    }

    if (hasPoints) written++;
    else deleted++;

    if (countInBatch === 400) {
      await batch.commit();
      batch = db.batch();
      countInBatch = 0;
    }
  }

  if (countInBatch > 0) {
    await batch.commit();
  }

  return {
    written,
    deleted,
    skipped,
    touched: written + deleted
  };
}

async function bumpPointsMetaVersion(db, tournament, opts) {
  if (opts.dryRun) return;
  const FieldValue = admin.firestore.FieldValue;
  const ref = db.collection(tournament.firestore.metaCollection).doc(tournament.firestore.metaDocId);
  await ref.set({
    tournamentKey: tournament.key,
    tournamentType: tournament.type,
    tournamentYear: tournament.year,
    tournamentLabel: tournament.shortLabel,
    year: tournament.year,
    pointsVersion: FieldValue.increment(1),
    pointsUpdatedAt: Date.now()
  }, { merge: true });
}

async function bumpFixturesMetaVersion(db, tournament, opts) {
  if (opts.dryRun) return;
  const FieldValue = admin.firestore.FieldValue;
  const ref = db.collection(tournament.firestore.metaCollection).doc(tournament.firestore.metaDocId);
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

function buildFixtureStatusUpdate(game) {
  return {
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
}

function fixtureStatusMatchesSnapshot(update, snapshot) {
  if (!snapshot) return false;
  return snapshot.statusLong === update.status.long &&
    snapshot.statusShort === update.status.short &&
    snapshot.statusElapsed === update.status.elapsed &&
    snapshot.goalsHome === update.goals.home &&
    snapshot.goalsAway === update.goals.away &&
    snapshot.homeWinner === update['homeTeam.winner'] &&
    snapshot.awayWinner === update['awayTeam.winner'] &&
    JSON.stringify(stableNormalize(snapshot.score || {})) === JSON.stringify(stableNormalize(update.score || {}));
}

async function updateFixtureStatusInFirestore(db, tournament, games, opts, fixtureSnapshotsById = null) {
  const collection = tournament.firestore.fixturesCollection;
  if (!collection || !games || games.length === 0) return { updated: 0, skipped: 0 };
  if (opts.dryRun) return { updated: games.length, skipped: 0 };

  const FieldValue = admin.firestore.FieldValue;
  let batch = db.batch();
  let batchCount = 0;
  let totalUpdated = 0;
  let skipped = 0;

  for (const game of games) {
    const fixtureId = String(game.fixture.id);
    const docRef = db.collection(collection).doc(fixtureId);
    const update = buildFixtureStatusUpdate(game);
    const snapshot = fixtureSnapshotsById ? fixtureSnapshotsById.get(fixtureId) : null;

    if (fixtureStatusMatchesSnapshot(update, snapshot)) {
      skipped++;
      continue;
    }

    batch.set(docRef, { ...update, updatedAt: FieldValue.serverTimestamp() }, { merge: true });
    batchCount++;
    totalUpdated++;

    if (batchCount === 400) {
      await batch.commit();
      batch = db.batch();
      batchCount = 0;
    }
  }

  if (batchCount > 0) await batch.commit();
  return { updated: totalUpdated, skipped };
}

async function fetchFixtureDetailsByIds(headers, fixtureIds) {
  const idsToFetch = Array.from(fixtureIds || []).map(id => String(id)).filter(Boolean);
  const detailsById = new Map();
  if (idsToFetch.length === 0) return detailsById;

  const batches = chunk(idsToFetch, 20);
  logInfo(`Detail-Calls in ${batches.length} Batch(es) zu max. 20 IDs (${idsToFetch.length} Fixtures insgesamt).`);

  for (let b = 0; b < batches.length; b++) {
    const ids = batches[b];
    const detailUrl = `https://v3.football.api-sports.io/fixtures?ids=${ids.join('-')}`;

    let detailRes;
    try {
      detailRes = await fetchFn(detailUrl, { headers });
    } catch (err) {
      throw new Error(`Detail-Batch ${b + 1}/${batches.length} fehlgeschlagen (Netzwerkfehler): ${err.message}`);
    }
    if (!detailRes.ok) {
      throw new Error(`Detail-Batch ${b + 1}/${batches.length} lieferte HTTP ${detailRes.status}.`);
    }

    let detailData;
    try {
      detailData = await detailRes.json();
    } catch (err) {
      throw new Error(`Detail-Batch ${b + 1}/${batches.length}: Antwort liess sich nicht als JSON parsen: ${err.message}`);
    }
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
  logInfo(`Kader geladen: ${playersData.length} Spieler aus ${tournament.dataFile}` +
    ` (Positions-Overrides angewendet: ${overrideStats.applied}/${overrideStats.total}).`);

  const allPlayerPoints = {};

  const headers = {
    'x-rapidapi-key': apiKey,
    'x-rapidapi-host': 'v3.football.api-sports.io'
  };

  const baseQuery = `${tournament.api.competitionParam}=${tournament.api.competitionId}&season=${tournament.api.season}`;
  const fixturesUrl = `https://v3.football.api-sports.io/fixtures?${baseQuery}`;

  logInfo(`Lade Fixtures von API: ${fixturesUrl}`);
  const fixRes = await fetchFn(fixturesUrl, { headers });
  if (!fixRes.ok) throw new Error(`API-Fixtures lieferte HTTP ${fixRes.status}`);
  const fixData = await fixRes.json();
  if (!fixData || !Array.isArray(fixData.response)) {
    throw new Error('API hat keine gültigen Fixture-Daten geliefert.');
  }

  const allApiGames = fixData.response.filter(f => f && f.fixture && f.fixture.id != null);
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

  const scoringGames = shouldFullRecompute
    ? uniqueGamesByFixtureId([
        ...(opts.forceRun ? allApiGames.filter(isScoringFixture) : finishedGames),
        ...liveCandidateGames
      ])
    : uniqueGamesByFixtureId(scoringCandidateGames);
  const liveGamesForTick = scoringGames.filter(g => !isFinishedFixture(g));

  logInfo(
    `API meldet ${finishedGames.length} beendete Spiele insgesamt, ` +
    `${liveGamesForTick.length} laufende Spiele in diesem Tick, ` +
    `${scoringGames.length} Spiel(e) fuer diesen Punkte-Tick.`
  );

  if (candidateFixtureIds && finishedCandidateIds && finishedCandidateIds.size > 0) {
    logInfo(`${finishedCandidateIds.size} der ${candidateFixtureIds.size} Kandidaten sind laut API beendet.`);
    if (newlyFinishedCandidateIds && newlyFinishedCandidateIds.size > 0) {
      logInfo(`${newlyFinishedCandidateIds.size} Kandidat(en) sind neu final – fuehre volle Neuberechnung aller beendeten Spiele aus.`);
    }
  }

  if (scoringGames.length === 0) {
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

  let changedPlayerIds = null;
  let existingPoints = null;
  let modeLabel = 'vollstaendige Neuberechnung';
  if (shouldFullRecompute) {
    playersData.forEach(p => { allPlayerPoints[String(p['player.id'])] = buildEmptyPlayerObject(p); });
  } else {
    modeLabel = 'Delta/Reconciliation';
    changedPlayerIds = new Set();
    logInfo('Lade bestehende Punktedokumente als Basis fuer Delta/Reconciliation.');
    existingPoints = await readExistingPointsFromFirestore(db, tournament);
    const replaceFixtureIds = new Set(scoringGames.map(g => String(g.fixture.id)));
    Object.assign(
      allPlayerPoints,
      buildPointBaseFromExisting(playersData, existingPoints, replaceFixtureIds, changedPlayerIds)
    );
  }
  logInfo(`Punkte-Modus: ${modeLabel}.`);

  const fixtureIds = scoringGames.map(g => String(g.fixture.id));
  const detailsById = await fetchFixtureDetailsByIds(headers, fixtureIds);

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
  const scoringById = new Map(scoringGames.map(g => [String(g.fixture.id), g]));
  fixtureIds.forEach(fixId => {
    processedPlayers += processFixtureDetail(
      detailsById.get(fixId),
      scoringById.get(fixId),
      allPlayerPoints,
      playersData,
      { changedPlayerIds }
    );
  });

  Object.values(allPlayerPoints).forEach(recalculateTotalPoints);

  const writeResult = await writePointsToFirestore(db, tournament, allPlayerPoints, opts, changedPlayerIds, existingPoints);
  logInfo(
    `${writeResult.written} Spieler-Dokumente ${opts.dryRun ? '(DRY-RUN) berechnet' : 'in Firestore geschrieben'}, ` +
    `${writeResult.deleted} geloescht/geleert, ${writeResult.skipped} unveraendert uebersprungen, ` +
    `${processedPlayers} Spielereinsaetze verarbeitet.`
  );

  if (writeResult.touched > 0) {
    await bumpPointsMetaVersion(db, tournament, opts);
    logInfo(`Meta-Dokument ${tournament.firestore.metaCollection}/${tournament.firestore.metaDocId} ${opts.dryRun ? '(DRY-RUN) ' : ''}aktualisiert.`);
  } else {
    logWarn('Keine Spieler-Punktedokumente veraendert – pointsVersion nicht hochgezaehlt.');
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
    const fixtureWriteResult = await updateFixtureStatusInFirestore(db, tournament, statusGames, opts, fixtureSnapshotsById);
    logInfo(`Fixture-Status für ${fixtureWriteResult.updated} Spiele ${opts.dryRun ? '(DRY-RUN) berechnet' : 'aktualisiert'}, ` +
      `${fixtureWriteResult.skipped} unveraendert uebersprungen.`);

    // Im Live-Modus soll neben den Punkten auch der Spielstand/Status sofort
    // in den Clients ankommen. Darum erhoehen wir fixturesVersion bei jedem
    // Tick, der API-Statusdaten fuer ein Live-/Finalspiel geschrieben hat.
    if (fixtureWriteResult.updated > 0) {
      await bumpFixturesMetaVersion(db, tournament, opts);
      logInfo(`fixturesVersion ${opts.dryRun ? '(DRY-RUN) ' : ''}erhoeht – Clients laden frische Spielstaende sofort nach.`);
    }
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
    candidatesNowFinished
  };
}

/* ─────────────────────────────────────────────────────────────────────────────
 *  Entrypoint
 * ───────────────────────────────────────────────────────────────────────────── */
async function runUploadTick(db, tournament, opts, tickIndex, totalTicks) {
  if (totalTicks > 1) {
    logInfo(`Live-Tick ${tickIndex}/${totalTicks}.`);
  }

  let candidateIds = null;
  let fixtureSnapshotsById = null;
  if (opts.forceRun) {
    logInfo('FORCE_RUN aktiv – Pre-Check übersprungen, Workflow wird in jedem Fall ausgeführt.');
  } else {
    const { all, candidates } = await findCandidateFixtures(db, tournament, opts);
    logInfo(`Spielplan: ${all.length} Spiele in Firestore. Kandidaten in diesem Tick: ${candidates.length}.`);
    if (candidates.length === 0) {
      logInfo('Nichts zu tun – kein Spiel im Live-/Catch-up-Fenster mit offenem Status. Beende ohne API-Call.');
      return { hadCandidates: false, result: null };
    }
    candidates.forEach(c => {
      const ageMin = (typeof c.ageMin === 'number') ? c.ageMin : Math.round((nowMs() - c.kickoffMs) / 60_000);
      const tag = c.finalRecheck ? ' [FINAL-RECHECK]' : (c.overdue ? ' [CATCH-UP / ueberfaellig]' : '');
      logInfo(`  • Kandidat ${c.id} (${c.label}) – Status="${c.statusShort || 'unbekannt'}", ${formatAgeMin(ageMin)}.${tag}`);
    });
    candidateIds = new Set(candidates.map(c => String(c.id)));
    fixtureSnapshotsById = new Map(candidates.map(c => [String(c.id), c]));
  }

  const result = await runFullPointsUpload(db, tournament, opts, candidateIds, fixtureSnapshotsById);
  logInfo(`Lauf-Tick beendet. Beendete Spiele (gesamt): ${result.finishedGames}, ` +
    `Scoring-Spiele: ${result.scoringGames}, Live-Spiele: ${result.liveGames}, ` +
    `Spieler-Dokumente geschrieben: ${result.writeSuccess}, geloescht: ${result.deleteSuccess}, ` +
    `Kandidaten jetzt beendet: ${result.candidatesNowFinished}.`);

  return { hadCandidates: true, result };
}

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
    windowStartMin: envInt('WINDOW_START_MIN', DEFAULT_WINDOW_START_MIN),
    windowEndMin: envInt('WINDOW_END_MIN', DEFAULT_WINDOW_END_MIN),
    finalRecheckMin: Math.max(0, envInt('FINAL_RECHECK_MIN', DEFAULT_FINAL_RECHECK_MIN)),
    liveTicksPerRun: Math.min(10, Math.max(1, envInt('LIVE_TICKS_PER_RUN', DEFAULT_LIVE_TICKS_PER_RUN))),
    liveTickIntervalSec: Math.max(0, envInt('LIVE_TICK_INTERVAL_SEC', DEFAULT_LIVE_TICK_INTERVAL_SEC)),
    forceRun: envBool('FORCE_RUN', false),
    dryRun: envBool('DRY_RUN', false)
  };

  logInfo(`Starte Auto-Upload für ${tournament.shortLabel} (${tournament.key}).` +
    ` Trigger-Fenster: ${opts.windowStartMin} bis ${opts.windowEndMin} min relativ zum Anpfiff` +
    ` (Live + Catch-up), Final-Recheck bis ${opts.finalRecheckMin} min nach Anpfiff.` +
    ` Live-Ticks pro Run: ${opts.forceRun ? 1 : opts.liveTicksPerRun}, Abstand: ${opts.liveTickIntervalSec}s.` +
    (opts.forceRun ? ' [FORCE_RUN]' : '') +
    (opts.dryRun ? ' [DRY_RUN]' : ''));

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
    const totalTicks = opts.forceRun ? 1 : opts.liveTicksPerRun;
    for (let tick = 1; tick <= totalTicks; tick++) {
      const tickResult = await runUploadTick(db, tournament, opts, tick, totalTicks);
      if (!tickResult.hadCandidates || opts.forceRun) break;
      if (tick < totalTicks) {
        logInfo(`Warte ${opts.liveTickIntervalSec}s bis zum naechsten Live-Tick.`);
        await delay(opts.liveTickIntervalSec * 1000);
      }
    }
    logInfo('Auto-Punkte-Run abgeschlossen.');
  } catch (err) {
    logError(`Upload-Workflow fehlgeschlagen: ${err.message}`);
    if (err.stack) console.error(err.stack);
    process.exit(2);
  }
}

main().catch(err => {
  logError('Unerwarteter Fehler: ' + (err && err.message || err));
  if (err && err.stack) console.error(err.stack);
  process.exit(2);
});
