#!/usr/bin/env node
/* =============================================================================
 *  scripts/test-sync-fixtures-report.js
 *
 *  Regressionstest fuer den Termin-Report des Spielplan-Syncs
 *  (summarizeKickoffDates in sync-fixtures.js): je kommendem Anstoss-Tag
 *  Anzahl und Anstosszeiten, fuer die naechsten Tage die Paarungen.
 *
 *  Geprueft wird:
 *    1. Zaehlung je Tag und je Anstosszeit (z. B. „18:45 ×2, 21:00 ×4").
 *    2. Paarungen nur fuer Termine innerhalb der Detail-Tage, nach Anstoss
 *       und Heimklub sortiert, mit Runde und Status.
 *    3. Vergangene Termine erscheinen nicht; „heute" wird in der Turnier-
 *       Zeitzone bestimmt, nicht in UTC.
 *
 *  Aufruf: npm run test:sync-report
 * ============================================================================= */

'use strict';

const assert = require('node:assert/strict');
const { summarizeKickoffDates } = require('./sync-fixtures.js');

function fixture(id, isoDate, home, away, round = 'League Stage - 1', status = 'NS') {
  return {
    fixture: { id, date: isoDate, status: { short: status } },
    league: { round },
    teams: { home: { name: home }, away: { name: away } }
  };
}

const fixtures = [
  fixture(3, '2026-09-08T21:00:00+02:00', 'Klub E', 'Klub F'),
  fixture(1, '2026-09-08T18:45:00+02:00', 'Klub A', 'Klub B'),
  fixture(4, '2026-09-08T21:00:00+02:00', 'Klub G', 'Klub H'),
  fixture(2, '2026-09-08T18:45:00+02:00', 'Klub C', 'Klub D'),
  fixture(5, '2026-09-09T21:00:00+02:00', 'Klub I', 'Klub J'),
  fixture(6, '2026-10-13T21:00:00+02:00', 'Klub K', 'Klub L', 'League Stage - 2'),
  fixture(7, '2026-09-01T21:00:00+02:00', 'Alt A', 'Alt B', 'Play-offs', 'FT')
];
const now = new Date('2026-09-07T12:00:00+02:00').getTime();
const lines = summarizeKickoffDates(fixtures, { nowMs: now, detailDays: 7, timeZone: 'Europe/Zurich' });

/* 1) Zaehlung je Tag und Anstosszeit */
assert.equal(lines[0], '  • 2026-09-08: 4 Spiel(e) – Anstoss 18:45 ×2, 21:00 ×2');

/* 2) Paarungen: nach Anstoss, dann Heimklub sortiert; Runde + Status */
assert.equal(lines[1], '      18:45  Klub A – Klub B (League Stage - 1, NS)');
assert.equal(lines[2], '      18:45  Klub C – Klub D (League Stage - 1, NS)');
assert.equal(lines[3], '      21:00  Klub E – Klub F (League Stage - 1, NS)');
assert.equal(lines[4], '      21:00  Klub G – Klub H (League Stage - 1, NS)');
assert.equal(lines[5], '  • 2026-09-09: 1 Spiel(e) – Anstoss 21:00 ×1');
assert.equal(lines[6], '      21:00  Klub I – Klub J (League Stage - 1, NS)');
// Termin ausserhalb der Detail-Tage: nur die Zaehlzeile
assert.equal(lines[7], '  • 2026-10-13: 1 Spiel(e) – Anstoss 21:00 ×1');
assert.equal(lines.length, 8, 'keine Paarungszeile fuer Termine ausserhalb der Detail-Tage');

/* 3) Vergangenes weg, „heute" in der Turnier-Zeitzone */
assert.ok(!lines.some(line => line.includes('2026-09-01')), 'vergangener Termin darf nicht erscheinen');
assert.equal(
  summarizeKickoffDates([fixture(9, '2026-09-07T21:00:00+02:00', 'X', 'Y')], { nowMs: now }).length,
  2,
  'ein Spiel von heute Abend zaehlt noch als kommend'
);
// 00:30 Zuercher Zeit am 08.09. ist 22:30 UTC am 07.09.: der 07.09. ist in
// Zuerich vorbei und darf nicht mehr als kommend gelten.
const shortlyAfterMidnight = new Date('2026-09-08T00:30:00+02:00').getTime();
assert.deepEqual(
  summarizeKickoffDates([fixture(10, '2026-09-07T21:00:00+02:00', 'X', 'Y')], {
    nowMs: shortlyAfterMidnight,
    timeZone: 'Europe/Zurich'
  }),
  [],
  '„heute" muss in der Turnier-Zeitzone bestimmt werden, nicht in UTC'
);
assert.deepEqual(summarizeKickoffDates([], { nowMs: now }), []);
assert.deepEqual(summarizeKickoffDates(null, { nowMs: now }), []);

console.log('✓ test-sync-fixtures-report: Termin-Report zaehlt, sortiert und blendet Vergangenes aus.');
