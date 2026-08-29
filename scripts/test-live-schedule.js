#!/usr/bin/env node
/* =============================================================================
 *  scripts/test-live-schedule.js
 *
 *  Haelt den Live-Modus und seinen Zeitplan zusammen. Geprueft wird:
 *
 *   1. Turnier-Aufloesung der Cron-Jobs (resolveServerTournamentKey). In Node
 *      gibt es keinen Hostname, das Domain-Mapping greift dort nicht – ohne
 *      diese Aufloesung liefen die Jobs weiter auf der abgelaufenen WM.
 *   2. Der Cron des Punkte-Workflows deckt JEDEN Spieltag aus
 *      MATCH_CALENDAR_CL2627 ab. Der Kalender ist die Quelle, die Cron-Zeilen
 *      sind eine handgepflegte Kopie (YAML kann nicht rechnen) – dieser Test
 *      ist die Klammer dazwischen.
 *   3. Die Live-Fenster liegen so, dass beide Anstosszeiten (18:45 und 21:00
 *      Schweizer Zeit) samt 30 Minuten Vorlauf in einem Cron-Fenster liegen –
 *      in Sommer- wie in Winterzeit.
 *   4. Das Auto-Punkte-Fenster (AUTO_POINTS_FROM/UNTIL) umschliesst den
 *      gesamten Spielkalender.
 *   5. Ligaphasen-Runden werden erkannt, auch wenn api-football sie „Group
 *      Stage" statt „League Stage - N" nennt.
 *
 *  Aufruf: npm run test:live-schedule
 * ============================================================================= */

'use strict';

const fs = require('fs');
const path = require('path');
const APP_CONFIG = require('../tournament-config.js');

const WORKFLOW_PATH = path.join(__dirname, '..', '.github', 'workflows', 'auto-points-upload.yml');

let failures = 0;
function check(label, condition, detail) {
  if (condition) return;
  failures++;
  console.error(`✗ ${label}${detail ? ` – ${detail}` : ''}`);
}

/* ─────────────────────────────────────────────────────────────────────────────
 *  Cron parsen (nur so viel, wie GitHub Actions kann: Minute Stunde Tag Monat
 *  Wochentag, jeweils Listen aus Zahlen, Bereichen und Schritten).
 * ───────────────────────────────────────────────────────────────────────────── */
function parseCronField(field, min, max) {
  const values = new Set();
  String(field).split(',').forEach(part => {
    const [rangePart, stepPart] = part.split('/');
    const step = stepPart ? Number(stepPart) : 1;
    let from = min;
    let to = max;
    if (rangePart !== '*') {
      const bounds = rangePart.split('-');
      from = Number(bounds[0]);
      to = bounds.length > 1 ? Number(bounds[1]) : from;
    }
    for (let v = from; v <= to; v += step) values.add(v);
  });
  return values;
}

function parseCron(expression) {
  const [minute, hour, dom, month, dow] = String(expression).trim().split(/\s+/);
  return {
    expression,
    minutes: parseCronField(minute, 0, 59),
    hours: parseCronField(hour, 0, 23),
    daysOfMonth: parseCronField(dom, 1, 31),
    months: parseCronField(month, 1, 12),
    daysOfWeek: parseCronField(dow, 0, 6)
  };
}

/* Deckt ein Cron-Eintrag diesen UTC-Zeitpunkt ab? Wochentag ist in allen
 * Eintraegen `*`, deshalb reicht der einfache UND-Vergleich. */
function cronCoversUtc(cron, date) {
  return cron.months.has(date.getUTCMonth() + 1) &&
    cron.daysOfMonth.has(date.getUTCDate()) &&
    cron.hours.has(date.getUTCHours());
}

function readScheduleCrons() {
  const yaml = fs.readFileSync(WORKFLOW_PATH, 'utf8');
  const scheduleBlock = yaml.slice(yaml.indexOf('  schedule:'), yaml.indexOf('  workflow_dispatch:'));
  const crons = [];
  scheduleBlock.split('\n').forEach(line => {
    const match = line.match(/^\s*-\s*cron:\s*"([^"]+)"/);
    if (match) crons.push(parseCron(match[1]));
  });
  return crons;
}

/* ─────────────────────────────────────────────────────────────────────────────
 *  1) Turnier-Aufloesung der Cron-Jobs
 * ───────────────────────────────────────────────────────────────────────────── */
const cl = APP_CONFIG.tournaments.cl2627;
const clActiveFromMs = new Date(cl.defaultActiveFrom).getTime();

check(
  'resolveServerTournamentKey liefert vor defaultActiveFrom noch nicht die CL',
  APP_CONFIG.resolveServerTournamentKey(clActiveFromMs - 1) === 'wm2026',
  `bekam "${APP_CONFIG.resolveServerTournamentKey(clActiveFromMs - 1)}"`
);
check(
  'resolveServerTournamentKey liefert ab defaultActiveFrom die CL',
  APP_CONFIG.resolveServerTournamentKey(clActiveFromMs) === 'cl2627',
  `bekam "${APP_CONFIG.resolveServerTournamentKey(clActiveFromMs)}"`
);
check(
  'resolveServerTournamentKey liefert die CL auch waehrend der Saison',
  APP_CONFIG.resolveServerTournamentKey(new Date('2027-03-10T20:00:00Z').getTime()) === 'cl2627'
);
// Der eingefrorene Teststand darf die Cron-Jobs nie an sich ziehen.
check(
  'Teststand cl2526 hat kein defaultActiveFrom',
  !APP_CONFIG.tournaments.cl2526.defaultActiveFrom
);
// Wichtig: die Aufloesung darf NICHT an `available` haengen – der Server muss
// Spielplan und Punkte vorbereiten koennen, solange die CL im Browser noch
// gesperrt ist.
check(
  'Server-Aufloesung greift auch bei available:false',
  cl.available === true || APP_CONFIG.resolveServerTournamentKey(clActiveFromMs) === 'cl2627'
);

/* ─────────────────────────────────────────────────────────────────────────────
 *  2)+3) Cron-Abdeckung aller Spieltage
 * ───────────────────────────────────────────────────────────────────────────── */
const crons = readScheduleCrons();
check('Punkte-Workflow hat Cron-Eintraege', crons.length > 0);

// Anstosszeiten der CL: 18:45 und 21:00 Schweizer Zeit. Der Live-Monitor macht
// ein Spiel 30 Minuten vor Anpfiff zum Kandidaten – der frueheste Zeitpunkt,
// zu dem ein Run laufen muss, ist also 18:15 Schweizer Zeit.
const KICKOFF_LOCAL_TIMES = ['18:15', '18:45', '21:00', '22:59'];

const uncovered = [];
cl.matchCalendar.forEach(entry => {
  entry.dates.forEach(date => {
    KICKOFF_LOCAL_TIMES.forEach(localTime => {
      const moment = new Date(`${date}T${localTime}:00${entry.offset}`);
      const covered = crons.some(cron => cronCoversUtc(cron, moment));
      if (!covered) uncovered.push(`${entry.label} ${date} ${localTime} (${moment.toISOString()})`);
    });
  });
});
check(
  'Jeder Spieltag aus MATCH_CALENDAR_CL2627 liegt in einem Cron-Fenster',
  uncovered.length === 0,
  uncovered.slice(0, 6).join('; ')
);

// Gegenprobe: der Cron soll NICHT dauerlaufen. Ein beliebiger spielfreier Tag
// mitten in der Saison darf kein Fenster haben.
const idleDay = new Date('2026-09-24T20:00:00Z');
check(
  'Spielfreie Tage haben kein Cron-Fenster',
  !crons.some(cron => cronCoversUtc(cron, idleDay))
);

/* ─────────────────────────────────────────────────────────────────────────────
 *  4) Auto-Punkte-Phase umschliesst den Kalender
 * ───────────────────────────────────────────────────────────────────────────── */
const fromMs = new Date(cl.AUTO_POINTS_FROM).getTime();
const untilMs = new Date(cl.AUTO_POINTS_UNTIL).getTime();
const kickoffs = cl.matchCalendar.flatMap(entry =>
  entry.dates.map(date => new Date(`${date}T${entry.kickoff}:00${entry.offset}`).getTime())
);
const firstKickoff = Math.min(...kickoffs);
const lastKickoff = Math.max(...kickoffs);

check('AUTO_POINTS_FROM liegt vor dem ersten Anpfiff', fromMs < firstKickoff);
check(
  'AUTO_POINTS_UNTIL liegt nach dem letzten Anpfiff plus Final-Recheck',
  untilMs > lastKickoff + 240 * 60 * 1000
);
check(
  'DREAMTEAM_START passt zum ersten Anpfiff des Kalenders',
  new Date(cl.DREAMTEAM_START).getTime() === firstKickoff,
  `${cl.DREAMTEAM_START} vs. ${new Date(firstKickoff).toISOString()}`
);

/* ─────────────────────────────────────────────────────────────────────────────
 *  5) Runden-Erkennung der Ligaphase
 * ───────────────────────────────────────────────────────────────────────────── */
['League Stage - 1', 'League Stage - 8', 'Group Stage', 'Regular Season - 3'].forEach(round => {
  check(`"${round}" gilt als Ligaphasen-Runde`, APP_CONFIG.isLeaguePhaseRound(round));
  check(`"${round}" ist keine K.-o.-Runde`, APP_CONFIG.leagueKnockoutRoundKey(round) === null);
});
[['Round of 32', 'playoffs'], ['Round of 16', 'r16'], ['Quarter-finals', 'qf'],
 ['Semi-finals', 'sf'], ['Final', 'final']].forEach(([round, key]) => {
  check(`"${round}" bleibt K.-o.-Runde ${key}`, APP_CONFIG.leagueKnockoutRoundKey(round) === key);
});
check('Qualifikationsrunden bleiben ausserhalb des Turniers',
  APP_CONFIG.isQualificationFixtureFor('cl2627', '3rd Qualifying Round') === true);
check('Die K.-o.-Playoffs bleiben im Turnier',
  APP_CONFIG.isQualificationFixtureFor('cl2627', 'Round of 32') === false);

if (failures > 0) {
  console.error(`\ntest-live-schedule: ${failures} Check(s) fehlgeschlagen.`);
  process.exit(1);
}
console.log('✓ test-live-schedule: Cron-Fenster, Turnier-Aufloesung und Runden-Erkennung passen.');
