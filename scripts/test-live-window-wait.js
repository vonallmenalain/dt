#!/usr/bin/env node
/* =============================================================================
 *  scripts/test-live-window-wait.js
 *
 *  Prueft den Vorlauf-Job (`scripts/live-window-wait.js`), der im Workflow
 *  `Auto Punkte-Upload` vor dem Upload-Job auf die Oeffnung des Live-Fensters
 *  wartet.
 *
 *  Der Job darf genau eines nicht: den Upload-Job unnoetig aufhalten. Er
 *  wartet deshalb nur, wenn das Fenster wirklich erst noch aufgeht UND das
 *  Warten ins Budget passt. In jedem anderen Fall gibt er sofort frei –
 *  besonders bei verspaeteten Takten und beim Final-Recheck nach Mitternacht,
 *  wo der Upload-Job offene Spiele nachziehen muss.
 *
 *  Aufruf: npm run test:live-wait
 * ============================================================================= */

'use strict';

const APP_CONFIG = require('../tournament-config.js');
const {
  DEFAULT_LEAD_MIN,
  DEFAULT_MAX_WAIT_MIN,
  kickoffTimesMs,
  nextWindowStartMs,
  planWait
} = require('./live-window-wait.js');

let failures = 0;
function check(label, condition, detail) {
  if (condition) return;
  failures++;
  console.error(`✗ ${label}${detail ? ` – ${detail}` : ''}`);
}

const MIN = 60 * 1000;
const cl = APP_CONFIG.tournaments.cl2627;

/* ─────────────────────────────────────────────────────────────────────────────
 *  1) Kalender-Auswertung
 * ───────────────────────────────────────────────────────────────────────────── */
const kickoffs = kickoffTimesMs(cl);
const calendarDates = cl.matchCalendar.reduce((sum, entry) => sum + entry.dates.length, 0);

check('Jeder Kalendertermin liefert einen Anpfiff', kickoffs.length === calendarDates,
  `${kickoffs.length} statt ${calendarDates}`);
check('Anpfiffe sind aufsteigend sortiert',
  kickoffs.every((ms, i) => i === 0 || ms >= kickoffs[i - 1]));
check('Der erste Anpfiff ist der 08.09.2026, 18:45 CH',
  new Date(kickoffs[0]).toISOString() === '2026-09-08T16:45:00.000Z',
  new Date(kickoffs[0]).toISOString());

/* Das Live-Fenster oeffnet 30 Minuten vor Anpfiff – derselbe Wert wie
 * DEFAULT_WINDOW_START_MIN (-30) im Upload-Skript. */
check('Vorlauf des Live-Fensters betraegt 30 Minuten', DEFAULT_LEAD_MIN === 30);

const morningOfMatchDay = Date.parse('2026-09-08T09:02:00Z');
check('Naechstes Fenster am Spieltagmorgen ist der Abend desselben Tages',
  new Date(nextWindowStartMs(cl, morningOfMatchDay, DEFAULT_LEAD_MIN)).toISOString()
    === '2026-09-08T16:15:00.000Z',
  new Date(nextWindowStartMs(cl, morningOfMatchDay, DEFAULT_LEAD_MIN)).toISOString());

/* Kurz nach Fensteroeffnung zeigt der Kalender schon auf den naechsten
 * Spieltag – der laufende Abend wird nicht mehr "erwartet". */
const duringMatch = Date.parse('2026-09-08T17:30:00Z');
check('Waehrend des Spiels zeigt das naechste Fenster auf den Folgetag',
  new Date(nextWindowStartMs(cl, duringMatch, DEFAULT_LEAD_MIN)).toISOString()
    === '2026-09-09T16:15:00.000Z',
  String(nextWindowStartMs(cl, duringMatch, DEFAULT_LEAD_MIN)));

check('Nach dem letzten Anpfiff gibt es kein Fenster mehr',
  nextWindowStartMs(cl, Date.parse('2027-07-01T00:00:00Z'), DEFAULT_LEAD_MIN) === null);

/* ─────────────────────────────────────────────────────────────────────────────
 *  2) Warte-Entscheidung
 * ───────────────────────────────────────────────────────────────────────────── */
const now = Date.parse('2026-09-08T13:00:00Z');
const windowStartMs = Date.parse('2026-09-08T16:15:00Z');
const base = { now, windowStartMs, maxWaitMin: DEFAULT_MAX_WAIT_MIN };

const waiting = planWait(base);
check('Ein frueher Takt wartet bis zur Fensteroeffnung',
  waiting.waitMs === 195 * MIN, `${waiting.waitMs / MIN} min`);

check('FORCE_RUN wartet nie',
  planWait({ ...base, forceRun: true }).waitMs === 0);
check('Push-Runs warten nie',
  planWait({ ...base, oneShotRun: true }).waitMs === 0);

check('Ein offenes Fenster wird nicht beblockt',
  planWait({ ...base, now: Date.parse('2026-09-08T16:45:00Z') }).waitMs === 0);

/* Der Fall vom 08.09.2026: GitHub lieferte erst um 18:29 UTC einen Takt.
 * Dieser Run darf keine Sekunde warten, sondern muss die laufenden Spiele
 * sofort nachziehen. */
check('Der verspaetete Takt vom 08.09. startet sofort',
  planWait({ ...base, now: Date.parse('2026-09-08T18:29:00Z') }).waitMs === 0);

/* Nacht-Takte (Final-Recheck) zeigen auf den naechsten Spieltag, der weit
 * ausserhalb des Budgets liegt – auch sie muessen sofort durchlaufen. */
check('Nacht-Takte fuer den Final-Recheck laufen sofort',
  planWait({
    now: Date.parse('2026-09-09T01:28:00Z'),
    windowStartMs: Date.parse('2026-09-09T16:15:00Z'),
    maxWaitMin: DEFAULT_MAX_WAIT_MIN
  }).waitMs === 0);

check('Ohne kommendes Fenster wird nicht gewartet',
  planWait({ ...base, windowStartMs: null }).waitMs === 0);

/* Die Grenze des Budgets: exakt am Limit wird noch gewartet, eine Minute
 * darueber nicht mehr. */
const atLimit = planWait({
  now: windowStartMs - DEFAULT_MAX_WAIT_MIN * MIN,
  windowStartMs,
  maxWaitMin: DEFAULT_MAX_WAIT_MIN
});
check('Genau am Wartebudget wird noch gewartet',
  atLimit.waitMs === DEFAULT_MAX_WAIT_MIN * MIN, `${atLimit.waitMs / MIN} min`);
check('Eine Minute ueber dem Budget wird nicht gewartet',
  planWait({
    now: windowStartMs - (DEFAULT_MAX_WAIT_MIN + 1) * MIN,
    windowStartMs,
    maxWaitMin: DEFAULT_MAX_WAIT_MIN
  }).waitMs === 0);

/* ─────────────────────────────────────────────────────────────────────────────
 *  3) Das Budget muss zum Job-Timeout passen
 * ───────────────────────────────────────────────────────────────────────────── */
const fs = require('fs');
const path = require('path');
const workflow = fs.readFileSync(
  path.join(__dirname, '..', '.github', 'workflows', 'auto-points-upload.yml'), 'utf8');
const vorlaufBlock = workflow.slice(workflow.indexOf('  vorlauf:'), workflow.indexOf('  upload:'));
const timeoutMatch = vorlaufBlock.match(/timeout-minutes:\s*(\d+)/);
const vorlaufTimeout = timeoutMatch ? Number(timeoutMatch[1]) : NaN;

check('Der Vorlauf-Job hat ein timeout-minutes', Number.isFinite(vorlaufTimeout));
check('Das Wartebudget liegt unter dem Job-Timeout',
  DEFAULT_MAX_WAIT_MIN < vorlaufTimeout,
  `${DEFAULT_MAX_WAIT_MIN} min Warten vs. ${vorlaufTimeout} min Timeout`);
// GitHub bricht jeden Job nach 6 Stunden hart ab.
check('Der Vorlauf-Job bleibt unter GitHubs 6-Stunden-Grenze', vorlaufTimeout <= 360);
check('Der Upload-Job laeuft auch, wenn der Vorlauf scheitert',
  /if:\s*\$\{\{\s*!cancelled\(\)\s*\}\}/.test(workflow));

if (failures > 0) {
  console.error(`\ntest-live-window-wait: ${failures} Check(s) fehlgeschlagen.`);
  process.exit(1);
}
console.log('✓ test-live-window-wait: Vorlauf wartet nur, wo Warten hilft.');
