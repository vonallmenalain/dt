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
 *       `WINDOW_START_MIN` Minuten in der Vergangenheit UND der Status
 *       ist in Firestore noch nicht FT/AET/PEN. `WINDOW_END_MIN` dient
 *       nur noch als Schwelle, ab der ein offenes Spiel als
 *       "ueberfaellig" (Catch-up) markiert/geloggt wird – es gibt
 *       bewusst KEINE obere Zeitgrenze mehr fuer die Kandidatur, damit
 *       Spiele, die das urspruengliche Fenster wegen API-/Netz-Problemen
 *       verpasst haben, beim naechsten Tick automatisch nachgezogen
 *       werden. Wenn keine Kandidaten existieren, beendet sich der Lauf
 *       ohne API-Call (Quota-Schutz).
 *    3. Punkte-Workflow: API-Fixtures laden, Detail-Stats pro beendetem
 *       Spiel auswerten, Punkte summieren, in Firestore schreiben und
 *       Meta-Dokument (`pointsUpdatedAt`, `pointsVersion`) hochzählen.
 *       `pointsUpdatedAt` wird ausschliesslich nach einem erfolgreichen
 *       Schreibvorgang erhöht – die "Zuletzt aktualisiert"-Anzeige auf
 *       rangliste.html ist also nur dann frisch, wenn neue Daten wirklich
 *       in Firebase liegen.
 *    4. Aktualisiert Status/Resultat im `fixturesCollection`, sodass das
 *       Spiel beim nächsten Tick nicht erneut als Kandidat gewertet wird,
 *       und erhöht `fixturesVersion` im Meta-Dokument, sobald ein
 *       Kandidat tatsächlich beendet wurde – so laden Clients die
 *       frischen Spielstände/Resultate sofort nach (statt erst beim
 *       täglichen Spielplan-Sync).
 *
 *  Env-Variablen (aus GitHub Actions Secrets / Variables):
 *    RAPIDAPI_KEY              RapidAPI / API-Football Key (zwingend)
 *    FIREBASE_SERVICE_ACCOUNT  Service-Account-JSON als String (zwingend)
 *    TOURNAMENT_KEY            Optional. Default = Fallback aus
 *                              tournament-config.js. Aktuell ist nur
 *                              `wm2026` produktiv konfiguriert; andere
 *                              Keys führen zu einem expliziten Abbruch.
 *    WINDOW_START_MIN          Optional, Default 100. Untere Grenze des
 *                              Trigger-Fensters in Minuten NACH ANPFIFF
 *                              (nicht nach Abpfiff!).
 *    WINDOW_END_MIN            Optional, Default 260. Nur noch
 *                              Catch-up-Schwelle: offene Spiele, deren
 *                              Anpfiff laenger als dieser Wert zurueck-
 *                              liegt, werden als "ueberfaellig" geloggt.
 *                              Begrenzt die Kandidatur NICHT mehr nach
 *                              oben (siehe Ablauf-Schritt 2).
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
 *  wenn sein Anpfiff (kickoffTimestamp) zwischen `windowStartMin` und
 *  `windowEndMin` Minuten in der Vergangenheit liegt – die Maße beziehen
 *  sich also auf den ANPFIFF, nicht auf den Abpfiff. Beispiel mit den
 *  Defaults 100/260: das Skript triggert ab ca. 100 min nach Anpfiff
 *  (ungefähr beim regulären Abpfiff) bis 260 min danach.
 * ───────────────────────────────────────────────────────────────────────────── */
async function findCandidateFixtures(db, tournament, opts) {
  const collectionName = tournament.firestore.fixturesCollection;
  const snap = await db.collection(collectionName).get();

  const now = nowMs();
  const windowStartMs = opts.windowStartMin * 60_000;
  const windowEndMs = opts.windowEndMin * 60_000;

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
      label: (homeName && awayName) ? `${homeName} vs ${awayName}` : `Spiel ${doc.id}`
    };
    all.push(fxInfo);

    if (!fxInfo.kickoffMs) return;

    const ageMs = now - fxInfo.kickoffMs;
    const notFinished = !FINISHED_STATUSES.has(fxInfo.statusShort);

    // Ein Spiel ist Kandidat, sobald sein Anpfiff mindestens
    // `windowStartMin` Minuten zurueckliegt UND es in Firestore noch
    // NICHT als beendet (FT/AET/PEN) markiert ist. Es gibt bewusst
    // KEINE obere Zeitgrenze mehr fuer die Kandidatur (frueher
    // `windowEndMin`):
    //
    //   Ein Spiel, das das urspruengliche Trigger-Fenster wegen API-/
    //   Netzwerkproblemen verpasst hat, blieb sonst dauerhaft ungescored,
    //   bis jemand manuell FORCE_RUN ausloest. Mit diesem Catch-up
    //   triggert jeder weitere Tick erneut, bis der Status in Firestore
    //   auf beendet gesetzt wurde (was nach erfolgreicher Verarbeitung
    //   in updateFixtureStatusInFirestore passiert).
    //
    // Quota-Schutz bleibt erhalten: pro Tick faellt nur EIN Firestore-
    // Read (Spielplan) an; die teuren Detail-Calls werden in
    // runFullPointsUpload uebersprungen, solange die API das Spiel noch
    // nicht als beendet meldet. Das Phasen-Fenster (AUTO_POINTS_UNTIL)
    // begrenzt das Catch-up zeitlich nach oben.
    if (ageMs >= windowStartMs && notFinished) {
      fxInfo.ageMin = Math.round(ageMs / 60_000);
      fxInfo.overdue = ageMs > windowEndMs;
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

function processFixtureDetail(fixtureData, game, allPlayerPoints, playersData) {
  const events = fixtureData.events || [];
  const playersDataList = fixtureData.players || [];

  const homeName = game.teams.home.name;
  const awayName = game.teams.away.name;
  const homeGoals = game.goals.home || 0;
  const awayGoals = game.goals.away || 0;
  const isDraw = game.teams.home.winner === null;
  const homeWon = game.teams.home.winner === true;
  const awayWon = game.teams.away.winner === true;
  const fixId = game.fixture.id;
  const resultString = `${homeName} ${homeGoals} : ${awayGoals} ${awayName}`;

  const subbedOutPlayerIds = events
    .filter(e => e.type && e.type.toLowerCase() === 'subst')
    .map(e => e.player && e.player.id);

  const ownGoalsMap = {};
  events.forEach(e => {
    if (e.type && e.type.toLowerCase() === 'goal' && e.detail && e.detail.toLowerCase() === 'own goal') {
      if (e.player && e.player.id) ownGoalsMap[e.player.id] = (ownGoalsMap[e.player.id] || 0) + 1;
    }
  });

  playersDataList.forEach(teamStats => {
    const isHome = teamStats.team.id === game.teams.home.id;
    const opponentName = isHome ? awayName : homeName;
    const teamGoals = isHome ? homeGoals : awayGoals;
    const teamConceded = isHome ? awayGoals : homeGoals;
    const isWin = isHome ? homeWon : awayWon;
    const isLoss = !isDraw && !isWin;

    (teamStats.players || []).forEach(pStats => {
      const pid = String(pStats.player.id);
      if (!allPlayerPoints[pid]) return;

      const pObj = allPlayerPoints[pid];
      const stats = pStats.statistics && pStats.statistics[0];
      if (!stats) return;

      const minutes = (stats.games && stats.games.minutes) || 0;
      if (minutes <= 0) return;

      const detailPts = {};
      Object.keys(RULES).forEach(k => { detailPts[k] = 0; });

      const playerInfo = playersData.find(x => String(x['player.id']) === pid);
      const pos = normalizePosition((playerInfo && playerInfo.Position) || 'UNKNOWN');

      if (stats.games.substitute === false) {
        detailPts.START = RULES.START;
        pObj.START += RULES.START;
      } else {
        detailPts.SUBBED_IN = RULES.SUBBED_IN;
        pObj.SUBBED_IN += RULES.SUBBED_IN;
      }

      if (subbedOutPlayerIds.includes(pStats.player.id)) {
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

      const ownGoals = ownGoalsMap[pStats.player.id] || 0;
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

      if (isWin)        { detailPts.WIN = RULES.WIN;   pObj.WIN += RULES.WIN; }
      else if (isDraw)  { detailPts.DRAW = RULES.DRAW; pObj.DRAW += RULES.DRAW; }
      else if (isLoss)  { detailPts.LOSS = RULES.LOSS; pObj.LOSS += RULES.LOSS; }

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
    });
  });
}

/* ─────────────────────────────────────────────────────────────────────────────
 *  Schreib-Workflow
 * ───────────────────────────────────────────────────────────────────────────── */
async function writePointsToFirestore(db, tournament, allPlayerPoints, opts) {
  const FieldValue = admin.firestore.FieldValue;
  const collection = tournament.firestore.pointsCollection;

  let batch = db.batch();
  let countInBatch = 0;
  let totalWritten = 0;

  for (const pid of Object.keys(allPlayerPoints)) {
    const obj = allPlayerPoints[pid];
    if (obj.START === 0 && obj.SUBBED_IN === 0) continue;

    obj.lastUpdated = FieldValue.serverTimestamp();

    if (!opts.dryRun) {
      const docRef = db.collection(collection).doc(String(pid));
      // Spielerdokumente werden bei jedem Lauf vollstaendig neu berechnet.
      // Deshalb das Dokument komplett ersetzen statt mergen: dadurch
      // verschwinden veraltete Felder (z. B. ein `Spiel_<id>`, das die
      // API nachtraeglich entfernt hat) zuverlaessig aus dem Dokument
      // und Summe-zu-Detail-Inkonsistenzen werden vermieden.
      batch.set(docRef, obj);
      countInBatch++;
    }

    totalWritten++;

    if (countInBatch === 400) {
      await batch.commit();
      batch = db.batch();
      countInBatch = 0;
    }
  }

  if (countInBatch > 0) {
    await batch.commit();
  }

  return totalWritten;
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

async function updateFixtureStatusInFirestore(db, tournament, finishedGames, opts) {
  const collection = tournament.firestore.fixturesCollection;
  if (!collection || !finishedGames || finishedGames.length === 0) return 0;
  if (opts.dryRun) return finishedGames.length;

  const FieldValue = admin.firestore.FieldValue;
  let batch = db.batch();
  let batchCount = 0;
  let totalUpdated = 0;

  for (const game of finishedGames) {
    const fixtureId = String(game.fixture.id);
    const docRef = db.collection(collection).doc(fixtureId);

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
      'awayTeam.winner': (game.teams && game.teams.away && game.teams.away.winner != null) ? game.teams.away.winner : null,
      updatedAt: FieldValue.serverTimestamp()
    };

    batch.set(docRef, update, { merge: true });
    batchCount++;
    totalUpdated++;

    if (batchCount === 400) {
      await batch.commit();
      batch = db.batch();
      batchCount = 0;
    }
  }

  if (batchCount > 0) await batch.commit();
  return totalUpdated;
}

/* ─────────────────────────────────────────────────────────────────────────────
 *  Haupt-Workflow
 * ───────────────────────────────────────────────────────────────────────────── */
async function runFullPointsUpload(db, tournament, opts, candidateFixtureIds) {
  const apiKey = process.env.RAPIDAPI_KEY;
  if (!apiKey) throw new Error('RAPIDAPI_KEY ist nicht gesetzt.');

  const playersData = loadPlayersData(tournament);
  const overrideStats = applyPositionOverrides(playersData, tournament.key);
  logInfo(`Kader geladen: ${playersData.length} Spieler aus ${tournament.dataFile}` +
    ` (Positions-Overrides angewendet: ${overrideStats.applied}/${overrideStats.total}).`);

  const allPlayerPoints = {};
  playersData.forEach(p => { allPlayerPoints[String(p['player.id'])] = buildEmptyPlayerObject(p); });

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

  const finishedGames = fixData.response.filter(f =>
    FINISHED_STATUSES.has((f && f.fixture && f.fixture.status && f.fixture.status.short) || '')
  );

  logInfo(`API meldet ${finishedGames.length} beendete Spiele insgesamt.`);

  if (finishedGames.length === 0) {
    return { ok: true, writeSuccess: 0, finishedGames: 0, candidatesNowFinished: 0 };
  }

  // Quoten-Sicherheit: wenn keiner der Kandidaten laut API beendet ist,
  // brechen wir hier ab. Spart die N Detail-Calls. Manuelle Catch-Up
  // Läufe (FORCE_RUN) überspringen diese Prüfung.
  if (candidateFixtureIds && candidateFixtureIds.size > 0 && !opts.forceRun) {
    const finishedCandidateIds = new Set(
      finishedGames.map(g => String(g.fixture.id)).filter(id => candidateFixtureIds.has(id))
    );
    if (finishedCandidateIds.size === 0) {
      logInfo('Keiner der Kandidaten ist laut API bereits beendet – überspringe Detail-Calls.');
      return { ok: true, writeSuccess: 0, finishedGames: finishedGames.length, candidatesNowFinished: 0 };
    }
    logInfo(`${finishedCandidateIds.size} der ${candidateFixtureIds.size} Kandidaten sind laut API beendet.`);
  }

  // Detail-Calls für ALLE beendeten Spiele (nicht nur Kandidaten), damit
  // die Punkte-Summen identisch zum Browser-Skript sind und nicht durch
  // Auslassungen früherer Läufe driften. API-FOOTBALL erlaubt bis zu
  // 20 Fixture-IDs pro Aufruf (Parameter `ids=id-id-id`). Bei einer
  // vollständigen Neuberechnung nach dem Finale reduziert das die Zahl
  // der Requests von rund 100+ auf wenige Batches.
  const fixtureIds = finishedGames.map(g => String(g.fixture.id));
  const finishedById = new Map(finishedGames.map(g => [String(g.fixture.id), g]));
  const expectedIds = new Set(fixtureIds);
  const processedIds = new Set();

  const batches = chunk(fixtureIds, 20);
  logInfo(`Detail-Calls in ${batches.length} Batch(es) zu max. 20 IDs (${fixtureIds.length} Fixtures insgesamt).`);

  for (let b = 0; b < batches.length; b++) {
    const ids = batches[b];
    const detailUrl = `https://v3.football.api-sports.io/fixtures?ids=${ids.join('-')}`;

    let detailRes;
    try {
      detailRes = await fetchFn(detailUrl, { headers });
    } catch (err) {
      // Netzwerkfehler beenden den Lauf, damit keine unvollstaendigen
      // Punktestaende veroeffentlicht werden. Beim naechsten Tick wird
      // ein neuer Versuch unternommen.
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
      const summary = finishedById.get(fixId);
      if (!summary) {
        logWarn(`Detail-Batch ${b + 1}: unerwartete Fixture-ID ${fixId} in der Antwort, wird ignoriert.`);
        continue;
      }
      processFixtureDetail(fixtureDetail, summary, allPlayerPoints, playersData);
      processedIds.add(fixId);
    }

    logInfo(`Detail-Batch ${b + 1}/${batches.length} verarbeitet (${detailData.response.length} Fixtures).`);

    // Höflichkeitsabstand zwischen Batches (RapidAPI Rate-Limit Schonung).
    if (b < batches.length - 1) await delay(350);
  }

  // Veröffentlichungs-Guard: Punkte werden nur dann nach Firestore
  // geschrieben, wenn ALLE erwarteten Fixtures verarbeitet wurden.
  // Damit sehen Nutzer nie einen halbfertigen Zwischenstand
  // (z. B. tiefere Gesamtpunktzahlen wegen eines transienten Fehlers).
  const missingIds = [...expectedIds].filter(id => !processedIds.has(id));
  if (missingIds.length > 0) {
    throw new Error(
      `Punkte-Update abgebrochen: ${missingIds.length} von ${expectedIds.size} ` +
      `beendeten Fixtures fehlen in den Detail-Antworten ` +
      `(IDs: ${missingIds.join(', ')}). Es wird nichts publiziert; ` +
      `der naechste Cron-Lauf versucht es erneut.`
    );
  }

  const writeSuccess = await writePointsToFirestore(db, tournament, allPlayerPoints, opts);
  logInfo(`${writeSuccess} Spieler-Dokumente ${opts.dryRun ? '(DRY-RUN) berechnet' : 'in Firestore geschrieben'}.`);

  if (writeSuccess > 0) {
    await bumpPointsMetaVersion(db, tournament, opts);
    logInfo(`Meta-Dokument ${tournament.firestore.metaCollection}/${tournament.firestore.metaDocId} ${opts.dryRun ? '(DRY-RUN) ' : ''}aktualisiert.`);
  } else {
    logWarn('Keine Spieler mit Punkten – Meta-Version nicht hochgezählt.');
  }

  // Anzahl der Kandidaten, die laut API jetzt beendet sind. Bei FORCE_RUN
  // gibt es kein Kandidaten-Set – dann werten wir den Lauf als
  // vollstaendige Neuberechnung und behandeln die Fixtures als geaendert.
  const candidatesNowFinished = candidateFixtureIds
    ? finishedGames.filter(g => candidateFixtureIds.has(String(g.fixture.id))).length
    : finishedGames.length;

  try {
    const updated = await updateFixtureStatusInFirestore(db, tournament, finishedGames, opts);
    logInfo(`Fixture-Status für ${updated} Spiele ${opts.dryRun ? '(DRY-RUN) berechnet' : 'aktualisiert'}.`);

    // fixturesVersion nur dann erhoehen, wenn sich ein Spielstatus
    // tatsaechlich geaendert hat (ein Kandidat ist jetzt beendet) bzw.
    // bei einer vollstaendigen Neuberechnung (FORCE_RUN). Ohne diesen
    // Bump laedt cache.js die aktualisierten Spielstaende/Resultate erst
    // beim naechsten taeglichen Spielplan-Sync nach – Clients saehen
    // sonst neue Punkte, aber veraltete Match-Status/Resultate.
    if (updated > 0 && (candidateFixtureIds == null || candidatesNowFinished > 0)) {
      await bumpFixturesMetaVersion(db, tournament, opts);
      logInfo(`fixturesVersion ${opts.dryRun ? '(DRY-RUN) ' : ''}erhöht – Clients laden frische Spielstände sofort nach.`);
    }
  } catch (err) {
    logWarn(`Fixture-Status-Update fehlgeschlagen (Punkte sind trotzdem geschrieben): ${err.message}`);
  }

  return {
    ok: true,
    writeSuccess,
    finishedGames: finishedGames.length,
    candidatesNowFinished
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
    windowStartMin: envInt('WINDOW_START_MIN', 100),
    windowEndMin: envInt('WINDOW_END_MIN', 260),
    forceRun: envBool('FORCE_RUN', false),
    dryRun: envBool('DRY_RUN', false)
  };

  logInfo(`Starte Auto-Upload für ${tournament.shortLabel} (${tournament.key}).` +
    ` Trigger-Fenster: ${opts.windowStartMin}–${opts.windowEndMin} min NACH ANPFIFF` +
    ` (Spiel läuft bzw. ist gerade frisch beendet).` +
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

  let candidateIds = null;
  try {
    if (opts.forceRun) {
      logInfo('FORCE_RUN aktiv – Pre-Check übersprungen, Workflow wird in jedem Fall ausgeführt.');
    } else {
      const { all, candidates } = await findCandidateFixtures(db, tournament, opts);
      logInfo(`Spielplan: ${all.length} Spiele in Firestore. Kandidaten in diesem Tick: ${candidates.length}.`);
      if (candidates.length === 0) {
        logInfo('Nichts zu tun – kein Spiel im Trigger-Fenster mit offenem Status. Beende ohne API-Call.');
        return;
      }
      candidates.forEach(c => {
        const ageMin = (typeof c.ageMin === 'number') ? c.ageMin : Math.round((nowMs() - c.kickoffMs) / 60_000);
        const tag = c.overdue ? ' [CATCH-UP / ueberfaellig]' : '';
        logInfo(`  • Kandidat ${c.id} (${c.label}) – Status="${c.statusShort || 'unbekannt'}", ${ageMin} min NACH ANPFIFF.${tag}`);
      });
      candidateIds = new Set(candidates.map(c => String(c.id)));
    }
  } catch (err) {
    logError(`Pre-Check fehlgeschlagen: ${err.message}`);
    process.exit(2);
  }

  try {
    const result = await runFullPointsUpload(db, tournament, opts, candidateIds);
    logInfo(`✅ Lauf beendet. Beendete Spiele (gesamt): ${result.finishedGames}, ` +
      `Spieler-Dokumente: ${result.writeSuccess}, ` +
      `Kandidaten jetzt beendet: ${result.candidatesNowFinished}.`);
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
