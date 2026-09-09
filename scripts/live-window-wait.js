#!/usr/bin/env node
/* =============================================================================
 *  scripts/live-window-wait.js
 *
 *  Vorlauf-Job des Workflows `Auto Punkte-Upload`: wartet auf den Beginn des
 *  naechsten Live-Fensters und uebergibt dann an den eigentlichen Upload-Job.
 *
 *  WARUM ES DIESEN JOB GIBT
 *  ------------------------
 *  GitHub startet scheduled workflows nur "so ungefaehr". Gemessen an den
 *  Runs dieses Repos liefert GitHub den `2-59/5`-Cron faktisch etwa einmal
 *  pro Stunde – am 08.09.2026 kam zwischen 15:02 UTC (erster Takt des
 *  Spieltags) und 18:29 UTC ueberhaupt kein Takt an, also 3 h 27 min lang
 *  nichts. Der Anpfiff war um 16:45 UTC; das Live-Fenster haette um
 *  16:15 UTC oeffnen muessen. Der Lauf musste von Hand gestartet werden.
 *
 *  Das Upload-Skript kann zwar selbst auf das Fenster warten, aber nur
 *  begrenzt: seine Session endet 350 min nach Start, und nach dem Aufwachen
 *  braucht sie noch rund 190 min zum Monitoren – bleiben ~160 min Wartezeit.
 *  Laenger geht in EINEM Job auch grundsaetzlich nicht, weil GitHub jeden
 *  Job nach 6 Stunden hart abbricht.
 *
 *  Ein *Workflow-Run* darf dagegen viel laenger laufen als ein Job. Deshalb
 *  ist das Warten hier in einen eigenen, sehr billigen Job ausgelagert
 *  (kein Secret, kein Firestore-Read, kein API-Call): er verbraucht seine
 *  6-Stunden-Frist mit Warten, und der Upload-Job startet danach mit
 *  frischem 6-Stunden-Budget genau dann, wenn das Live-Fenster oeffnet.
 *
 *  Ergebnis: es genuegt, dass GitHub IRGENDWANN in einem mehrstuendigen
 *  Fenster vor dem Anpfiff einen einzigen Takt liefert – statt wie bisher
 *  in den letzten ~75 Minuten davor.
 *
 *  VERHALTEN
 *  ---------
 *  Der Job blockiert den Upload-Job NIE. Er wartet nur dann, wenn das
 *  Warten etwas bringt; in jedem anderen Fall endet er sofort mit Exit 0:
 *
 *    - `FORCE_RUN=1`            -> sofort weiter (manueller Catch-up).
 *    - Push-Run                 -> sofort weiter (One-Shot, endet am Guard).
 *    - Fenster ist schon offen  -> sofort weiter (verspaeteter Takt, Catch-up,
 *                                  Final-Recheck nach Mitternacht).
 *    - Fenster > MAX_WAIT weg   -> sofort weiter (der Upload-Job stellt
 *                                  selbst fest, dass nichts zu tun ist, und
 *                                  endet nach ~20 s).
 *    - sonst                    -> bis zum Fensterbeginn schlafen.
 *
 *  Grundlage ist `matchCalendar` des aktiven Turniers aus
 *  `tournament-config.js` – dieselbe Quelle, aus der die Cron-Zeilen des
 *  Workflows von Hand abgeschrieben sind. Der Kalender nennt je Spieltag den
 *  FRUEHESTEN Anstoss; genau der bestimmt, wann das Live-Fenster oeffnet.
 *
 *  Env-Variablen:
 *    TOURNAMENT_KEY        Optional. Default = APP_CONFIG.serverTournamentKey.
 *    LIVE_WINDOW_LEAD_MIN  Optional, Default 30. Minuten, die das Live-Fenster
 *                          vor dem Anpfiff oeffnet. Muss zu
 *                          POINTS_WINDOW_START_MIN des Upload-Skripts passen.
 *    LIVE_WINDOW_MAX_WAIT_MIN
 *                          Optional, Default 320. So lange darf dieser Job
 *                          hoechstens warten. Muss unter `timeout-minutes`
 *                          des Vorlauf-Jobs bleiben.
 *    FORCE_RUN             Falls `1`/`true`: nicht warten.
 *
 *  Exit-Code: immer 0 – ein Problem hier darf den Upload-Job nicht kosten.
 * ============================================================================= */

'use strict';

const APP_CONFIG = require('../tournament-config.js');

/* Muss zu DEFAULT_WINDOW_START_MIN in auto-points-upload.js passen (-30). */
const DEFAULT_LEAD_MIN = 30;

/* Bewusst unter `timeout-minutes: 330` des Vorlauf-Jobs, damit der Job das
 * Warten regulaer beendet und den Upload-Job startet, statt in den Timeout
 * zu laufen. */
const DEFAULT_MAX_WAIT_MIN = 320;

function logInfo(message) {
  console.log(`[live-window] ${message}`);
}

function envInt(name, fallback) {
  const raw = (process.env[name] || '').trim();
  if (!raw) return fallback;
  const value = parseInt(raw, 10);
  return Number.isFinite(value) ? value : fallback;
}

function envBool(name, fallback) {
  const raw = (process.env[name] || '').trim().toLowerCase();
  if (!raw) return fallback;
  return raw === '1' || raw === 'true' || raw === 'yes';
}

function formatDurationMs(ms) {
  const totalSec = Math.max(0, Math.round((Number(ms) || 0) / 1000));
  const hours = Math.floor(totalSec / 3600);
  const minutes = Math.floor((totalSec % 3600) / 60);
  return hours > 0 ? `${hours} h ${minutes} min` : `${minutes} min`;
}

/* Alle Anstosszeiten des Turniers als Millisekunden, aufsteigend. Der
 * Kalender fuehrt je Eintrag mehrere Daten mit derselben Uhrzeit. */
function kickoffTimesMs(tournament) {
  const calendar = (tournament && tournament.matchCalendar) || [];
  const times = [];
  calendar.forEach(entry => {
    if (!entry || !entry.kickoff) return;
    (entry.dates || []).forEach(date => {
      const ms = new Date(`${date}T${entry.kickoff}:00${entry.offset || 'Z'}`).getTime();
      if (Number.isFinite(ms)) times.push(ms);
    });
  });
  return times.sort((a, b) => a - b);
}

/* Beginn des naechsten Live-Fensters, das noch in der Zukunft liegt.
 * `null`, wenn der Kalender keines mehr hergibt. */
function nextWindowStartMs(tournament, now, leadMin) {
  const leadMs = Math.max(0, leadMin) * 60_000;
  let next = null;
  kickoffTimesMs(tournament).forEach(kickoffMs => {
    const startMs = kickoffMs - leadMs;
    if (startMs > now && (next == null || startMs < next)) next = startMs;
  });
  return next;
}

/* Reine Entscheidungsfunktion – ohne Uhr und ohne Seiteneffekte, damit
 * `test-live-window-wait.js` sie direkt pruefen kann. */
function planWait(options) {
  const opts = options || {};
  const now = opts.now;
  const windowStartMs = opts.windowStartMs;
  const maxWaitMs = Math.max(0, opts.maxWaitMin || 0) * 60_000;

  if (opts.forceRun) return { waitMs: 0, reason: 'FORCE_RUN aktiv' };
  if (opts.oneShotRun) return { waitMs: 0, reason: 'One-Shot-Run (push)' };
  if (!Number.isFinite(windowStartMs)) {
    return { waitMs: 0, reason: 'kein kommendes Live-Fenster im Kalender' };
  }

  const waitMs = windowStartMs - now;
  if (waitMs <= 0) return { waitMs: 0, reason: 'Live-Fenster ist bereits offen' };
  if (waitMs > maxWaitMs) {
    return {
      waitMs: 0,
      reason: `naechstes Live-Fenster erst in ${formatDurationMs(waitMs)} – mehr als das Wartebudget`
    };
  }
  return { waitMs, reason: 'warten bis zum Fensterbeginn' };
}

function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function main() {
  const envKey = (process.env.TOURNAMENT_KEY || '').trim().toLowerCase();
  const tournamentKey = envKey || APP_CONFIG.serverTournamentKey;
  const tournament = APP_CONFIG.tournaments[tournamentKey];

  const leadMin = envInt('LIVE_WINDOW_LEAD_MIN', DEFAULT_LEAD_MIN);
  const maxWaitMin = envInt('LIVE_WINDOW_MAX_WAIT_MIN', DEFAULT_MAX_WAIT_MIN);
  const forceRun = envBool('FORCE_RUN', false);
  const trigger = String(process.env.GITHUB_EVENT_NAME || '').toLowerCase();
  const oneShotRun = trigger === 'push';

  if (!tournament) {
    logInfo(`Kein Turnier zu TOURNAMENT_KEY="${tournamentKey}" – ohne Warten weiter.`);
    return;
  }

  const now = Date.now();
  const windowStartMs = nextWindowStartMs(tournament, now, leadMin);
  logInfo(
    `Turnier ${tournament.shortLabel || tournamentKey}, Trigger "${trigger || 'lokal'}", ` +
    `Vorlauf ${leadMin} min, Wartebudget ${maxWaitMin} min.`
  );

  const plan = planWait({ now, windowStartMs, maxWaitMin, forceRun, oneShotRun });
  if (plan.waitMs <= 0) {
    logInfo(`Kein Warten: ${plan.reason}. Upload-Job startet sofort.`);
    return;
  }

  logInfo(
    `Naechstes Live-Fenster oeffnet ${new Date(windowStartMs).toISOString()} – ` +
    `warte ${formatDurationMs(plan.waitMs)}. Danach uebernimmt der Upload-Job.`
  );
  await delay(plan.waitMs);
  logInfo('Live-Fenster ist offen. Upload-Job startet jetzt.');
}

module.exports = {
  DEFAULT_LEAD_MIN,
  DEFAULT_MAX_WAIT_MIN,
  kickoffTimesMs,
  nextWindowStartMs,
  planWait
};

if (require.main === module) {
  main().catch(err => {
    // Ein Fehler im Vorlauf darf den Upload-Job nicht kosten.
    logInfo(`Vorlauf abgebrochen (${err && err.message ? err.message : err}) – Upload-Job startet trotzdem.`);
    process.exit(0);
  });
}
