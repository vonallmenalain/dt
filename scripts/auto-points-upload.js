#!/usr/bin/env node
/* =============================================================================
 *  scripts/auto-points-upload.js
 *
 *  Server-seitiges Pendant zur manuellen Seite `adm-upload-points.html`.
 *  Wird via GitHub Actions (Cron, alle paar Minuten) aufgerufen, damit
 *  Punkt-Updates auch dann automatisch in Firebase landen, wenn KEIN
 *  Browser-Tab geöffnet ist.
 *
 *  Ablauf pro Lauf:
 *    1. Lädt Spielplan (`fixturesCollection`) aus Firestore – keine API-Kosten.
 *    2. Bestimmt Kandidaten-Spiele:
 *         - Anstoss liegt zwischen WINDOW_END_MIN und WINDOW_START_MIN
 *           Minuten in der Vergangenheit  (Default: 100 … 260 Min).
 *         - Status in Firestore ist NICHT bereits FT/AET/PEN.
 *       So bleibt für nicht-relevante Cron-Ticks nur ein einzelner billiger
 *       Firestore-Read und Null API-Calls.
 *    3. Falls Kandidaten existieren: kompletter Punkte-Workflow analog zum
 *       Browser-Skript – API-Fixtures laden, Detail-Stats pro beendetem
 *       Spiel auswerten, Punkte summieren, in Firestore schreiben und
 *       Meta-Dokument (`pointsUpdatedAt`, `pointsVersion`) hochzählen.
 *    4. Aktualisiert Status/Resultat im `fixturesCollection`, sodass das
 *       gerade verarbeitete Spiel bei den nächsten Ticks automatisch nicht
 *       mehr als Kandidat zählt (=> Quota-Schutz).
 *
 *  Wichtig: Das Meta-Feld `pointsUpdatedAt` wird ausschliesslich nach
 *  einem erfolgreichen Schreibvorgang erhöht. Damit ist die Info auf
 *  rangliste.html ("Zuletzt aktualisiert / Spiel X") nur dann frisch,
 *  wenn die Daten eines neuen Spiels wirklich in Firebase liegen.
 *
 *  Env-Variablen (alle aus GitHub Actions Secrets):
 *    RAPIDAPI_KEY                 RapidAPI / API-Football Key (zwingend)
 *    FIREBASE_SERVICE_ACCOUNT     Service-Account-JSON als String (zwingend)
 *    TOURNAMENT_KEY               Optional, Default `wm2026`. Beliebige Keys
 *                                 aus tournament-config.js (z.B. `em2024`).
 *    WINDOW_START_MIN             Optional, Default 100. Untere Grenze des
 *                                 Trigger-Fensters in Minuten nach Anpfiff.
 *    WINDOW_END_MIN               Optional, Default 260. Obere Grenze.
 *    FORCE_RUN                    Falls `1`/`true`: Pre-Check überspringen
 *                                 und Upload erzwingen (Debug/Catch-Up).
 *    DRY_RUN                      Falls `1`/`true`: nicht in Firestore
 *                                 schreiben, nur Log-Ausgabe.
 *
 *  Exit-Codes:
 *    0  – Lauf abgeschlossen (entweder nichts zu tun, oder Upload erfolgreich)
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

// Node 18+ stellt globalen fetch bereit. Für ältere Node-Versionen
// versuchen wir node-fetch nachzuladen; im normalen GitHub-Actions-
// Setup (actions/setup-node@v4 mit node-version 20) ist das kein Thema.
let fetchFn = (typeof fetch === 'function') ? fetch : null;
if (!fetchFn) {
  try {
    fetchFn = require('node-fetch');
  } catch (err) {
    console.error('[auto-points] Globales fetch fehlt und node-fetch nicht installiert. Node 18+ verwenden.');
    process.exit(1);
  }
}

/* ─────────────────────────────────────────────────────────────────────────────
 *  Konfiguration (aus tournament-config.js gespiegelt)
 *
 *  Bewusst eine kompakte Kopie statt das Browser-Modul zu eval'en: das
 *  Browser-Modul referenziert `window.location` und `window.firebase`, was
 *  in Node nicht trivial ist. Diese Werte ändern sich selten und werden
 *  per Test (siehe `verifyTournamentConfigAlignment`) gegen die Browser-
 *  Datei abgeglichen, sobald jemand sie ändert.
 * ───────────────────────────────────────────────────────────────────────────── */
const TOURNAMENTS = {
  wm2022: {
    key: 'wm2022',
    shortLabel: 'WM 2022',
    type: 'WM',
    year: '2022',
    dataFile: 'data-wm2022.js',
    api: { competitionParam: 'league', competitionId: 1, season: '2022' },
    firestore: {
      metaCollection: 'app_meta',
      metaDocId: 'turnier_wm2022',
      pointsCollection: 'Punkte Spieler WM 2022',
      fixturesCollection: 'Spiele WM 2022'
    }
  },
  em2024: {
    key: 'em2024',
    shortLabel: 'EM 2024',
    type: 'EM',
    year: '2024',
    dataFile: 'data-em2024.js',
    api: { competitionParam: 'league', competitionId: 4, season: '2024' },
    firestore: {
      metaCollection: 'app_meta',
      metaDocId: 'turnier_em2024',
      pointsCollection: 'Punkte Spieler EM 2024',
      fixturesCollection: 'Spiele EM 2024'
    }
  },
  wm2026: {
    key: 'wm2026',
    shortLabel: 'WM 2026',
    type: 'WM',
    year: '2026',
    dataFile: 'data-wm2026.js',
    api: { competitionParam: 'league', competitionId: 1, season: '2026' },
    firestore: {
      metaCollection: 'app_meta',
      metaDocId: 'turnier_wm2026',
      pointsCollection: 'Punkte Spieler WM 2026',
      fixturesCollection: 'Spiele WM 2026'
    }
  },
  em2028: {
    key: 'em2028',
    shortLabel: 'EM 2028',
    type: 'EM',
    year: '2028',
    dataFile: 'data-em2028.js',
    api: { competitionParam: 'league', competitionId: 4, season: '2028' },
    firestore: {
      metaCollection: 'app_meta',
      metaDocId: 'turnier_em2028',
      pointsCollection: 'Punkte Spieler EM 2028',
      fixturesCollection: 'Spiele EM 2028'
    }
  },
  wm2030: {
    key: 'wm2030',
    shortLabel: 'WM 2030',
    type: 'WM',
    year: '2030',
    dataFile: 'data-wm2030.js',
    api: { competitionParam: 'league', competitionId: 1, season: '2030' },
    firestore: {
      metaCollection: 'app_meta',
      metaDocId: 'turnier_wm2030',
      pointsCollection: 'Punkte Spieler WM 2030',
      fixturesCollection: 'Spiele WM 2030'
    }
  }
};

const RULES = {
  START: 5,
  SUBBED_IN: 2,
  SUBBED_OUT: -2,
  GOAL_GK: 10,
  GOAL_DEF: 7,
  GOAL_MID: 6,
  GOAL_ATT: 5,
  OWN_GOAL: -5,
  ASSIST_GK_DEF: 5,
  ASSIST_MID: 4,
  ASSIST_ATT: 3,
  TEAM_GOAL: 1,
  DEF_BASE_PTS: 6,
  GEGENTOR_GK_DEF: -2,
  YELLOW_CARD: -3,
  RED_CARD: -7,
  PEN_SAVED: 7,
  PEN_MISSED: -7,
  PEN_COMMITED: -5,
  PEN_WON: 3,
  WIN: 3,
  DRAW: 1,
  LOSS: -3
};

/* ─────────────────────────────────────────────────────────────────────────────
 *  Helpers
 * ───────────────────────────────────────────────────────────────────────────── */
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
 *  Upload-Workflow überhaupt anlaufen muss.
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
    const inWindow = ageMs >= windowStartMs && ageMs <= windowEndMs;
    const notFinished = !FINISHED_STATUSES.has(fxInfo.statusShort);

    if (inWindow && notFinished) candidates.push(fxInfo);
  });

  return { all, candidates };
}

/* ─────────────────────────────────────────────────────────────────────────────
 *  Punkte-Berechnung pro Spiel
 *
 *  1:1 Logik aus adm-upload-points.html – nur in Node-Form. Verändert
 *  `allPlayerPoints` in place.
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
      batch.set(docRef, obj, { merge: true });
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
 *  Haupt-Workflow (analog zum manuellen Browser-Klick)
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
  // Auslassungen früherer Läufe driften.
  for (let i = 0; i < finishedGames.length; i++) {
    const game = finishedGames[i];
    const fixId = game.fixture.id;
    const detailUrl = `https://v3.football.api-sports.io/fixtures?id=${fixId}`;

    try {
      const detailRes = await fetchFn(detailUrl, { headers });
      if (!detailRes.ok) {
        logWarn(`Detail-Call für Spiel ${fixId} lieferte HTTP ${detailRes.status} – überspringe.`);
        continue;
      }
      const detailData = await detailRes.json();
      if (detailData.response && detailData.response.length > 0) {
        processFixtureDetail(detailData.response[0], game, allPlayerPoints, playersData);
      }
    } catch (err) {
      logWarn(`Fehler bei Detail-Call für Spiel ${fixId}: ${err.message}`);
    }

    if ((i + 1) % 10 === 0 || i === finishedGames.length - 1) {
      logInfo(`Detail-Calls: ${i + 1}/${finishedGames.length}`);
    }

    // Höflichkeitsabstand zwischen Calls (RapidAPI Rate-Limit Schonung).
    await delay(350);
  }

  const writeSuccess = await writePointsToFirestore(db, tournament, allPlayerPoints, opts);
  logInfo(`${writeSuccess} Spieler-Dokumente ${opts.dryRun ? '(DRY-RUN) berechnet' : 'in Firestore geschrieben'}.`);

  if (writeSuccess > 0) {
    await bumpPointsMetaVersion(db, tournament, opts);
    logInfo(`Meta-Dokument ${tournament.firestore.metaCollection}/${tournament.firestore.metaDocId} ${opts.dryRun ? '(DRY-RUN) ' : ''}aktualisiert.`);
  } else {
    logWarn('Keine Spieler mit Punkten – Meta-Version nicht hochgezählt.');
  }

  try {
    const updated = await updateFixtureStatusInFirestore(db, tournament, finishedGames, opts);
    logInfo(`Fixture-Status für ${updated} Spiele ${opts.dryRun ? '(DRY-RUN) berechnet' : 'aktualisiert'}.`);
  } catch (err) {
    logWarn(`Fixture-Status-Update fehlgeschlagen (Punkte sind trotzdem geschrieben): ${err.message}`);
  }

  return {
    ok: true,
    writeSuccess,
    finishedGames: finishedGames.length,
    candidatesNowFinished: candidateFixtureIds
      ? finishedGames.filter(g => candidateFixtureIds.has(String(g.fixture.id))).length
      : finishedGames.length
  };
}

/* ─────────────────────────────────────────────────────────────────────────────
 *  Entrypoint
 * ───────────────────────────────────────────────────────────────────────────── */
async function main() {
  const tournamentKey = (process.env.TOURNAMENT_KEY || 'wm2026').trim().toLowerCase();
  const tournament = TOURNAMENTS[tournamentKey];
  if (!tournament) {
    logError(`Unbekannter TOURNAMENT_KEY="${tournamentKey}". Bekannt: ${Object.keys(TOURNAMENTS).join(', ')}`);
    process.exit(1);
  }
  if (!tournament.api.competitionId) {
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
    ` Trigger-Fenster: ${opts.windowStartMin}–${opts.windowEndMin} min nach Anpfiff.` +
    (opts.forceRun ? ' [FORCE_RUN]' : '') +
    (opts.dryRun ? ' [DRY_RUN]' : ''));

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
        const ageMin = Math.round((nowMs() - c.kickoffMs) / 60_000);
        logInfo(`  • Kandidat ${c.id} (${c.label}) – Status="${c.statusShort || 'unbekannt'}", Anpfiff vor ${ageMin} min.`);
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
