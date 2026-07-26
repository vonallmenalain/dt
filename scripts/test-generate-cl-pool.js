'use strict';

/* =============================================================================
 *  test-generate-cl-pool.js
 *
 *  Unit-Tests für die reine Logik von generate-cl-pool.js (Vorschau-Pool der
 *  CL 2026/27). Kein Netzwerk, kein API-Key: geprüft wird nur, wie aus
 *  Tabellen-Beschreibungen, Endspiel-Fixtures und manuellen Korrekturen die
 *  Klubliste entsteht.
 * ============================================================================= */

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const {
  classifyClDescription,
  isWomensEntry,
  pickFinalWinner,
  applyManualOverrides,
  statFromSquadEntry,
  UEFA_ASSOCIATIONS
} = require('./generate-cl-pool.js');

/* ── Tabellen-Beschreibungen klassifizieren ─────────────────────────────── */
(function testClassify() {
  // Direkter Ligaphasen-Platz.
  assert.equal(
    classifyClDescription('Promotion - Champions League (League Phase: )'),
    'league-phase'
  );
  assert.equal(
    classifyClDescription('Promotion - UEFA Champions League (Group Stage: )'),
    'league-phase'
  );
  assert.equal(classifyClDescription('Promotion - Champions League'), 'league-phase');

  // Nur Qualifikationsweg – heute noch NICHT fix qualifiziert.
  assert.equal(
    classifyClDescription('Promotion - Champions League (Qualification: )'),
    'qualifying'
  );
  assert.equal(
    classifyClDescription('Promotion - Champions League (Play Offs: )'),
    'qualifying'
  );
  assert.equal(
    classifyClDescription('Promotion - Champions League (Qualifying Round)'),
    'qualifying'
  );

  // Kein CL-Bezug.
  assert.equal(classifyClDescription('Promotion - Europa League (League Phase: )'), null);
  assert.equal(classifyClDescription('Relegation'), null);
  assert.equal(classifyClDescription(''), null);
  assert.equal(classifyClDescription(null), null);

  // Andere Konföderationen dürfen nicht matchen.
  assert.equal(classifyClDescription('Promotion - AFC Champions League Elite'), null);
  assert.equal(classifyClDescription('Promotion - CAF Champions League (Group Stage)'), null);

  console.log('ok - CL-Tabellenbeschreibungen werden korrekt klassifiziert');
})();

/* ── Women's Champions League ausschliessen ─────────────────────────────── */
(function testWomensFilter() {
  // Alle Fälle stammen aus dem echten Probe-Lauf gegen die API (Saison 2025):
  // ohne Filter landeten 13 Frauenteams im Pool.
  const womens = [
    ['England / FA WSL', 'Champions League', 'Arsenal W'],
    ['Germany / Frauen Bundesliga', 'Promotion - Champions League Women (League phase)', 'Bayern Munich W'],
    ['Italy / Serie A Women', 'Champions League', 'Roma W'],
    ['Spain / Primera División Femenina', 'Champions League', 'Barcelona W'],
    ['Denmark / Kvindeliga', 'Champions League', 'Køge W'],
    ['Sweden / Damallsvenskan', 'Promotion - Champions League Women (Qualification - First stage: )', 'Häcken'],
    ['Romania / Liga 1 Feminin', 'Promotion - Champions League Women (League phase)', 'Farul Constanţa W'],
    // Ligen ohne Marker im Namen – nur der Teamname verrät sie.
    ['Norway / Toppserien', 'Champions League', 'Brann W'],
    ['Finland / Kansallinen Liiga', 'Champions League Qualification', 'HJK W']
  ];
  for (const [league, description, team] of womens) {
    assert.equal(
      isWomensEntry(league.split(' / ')[1], description, team),
      true,
      `${team} (${league}) muss als Frauen-Wettbewerb erkannt werden.`
    );
  }

  // Männer-Wettbewerbe dürfen nicht mitgefiltert werden.
  const mens = [
    ['Premier League', 'Promotion - Champions League (League phase)', 'Arsenal'],
    ['Bundesliga', 'Champions League', 'Bayern München'],
    ['Serie A', 'Promotion - Champions League (League phase)', 'AS Roma'],
    ['La Liga', 'Promotion - Champions League (League phase)', 'Barcelona'],
    ['Eliteserien', 'Promotion - Champions League (Qualification)', 'Bodo/Glimt'],
    ['Süper Lig', 'Champions League', 'Galatasaray'],
    ['Jupiler Pro League', 'Champions League', 'Club Brugge KV']
  ];
  for (const [league, description, team] of mens) {
    assert.equal(
      isWomensEntry(league, description, team),
      false,
      `${team} (${league}) darf nicht als Frauen-Wettbewerb gelten.`
    );
  }
  console.log('ok - Women\'s Champions League wird zuverlaessig aussortiert');
})();

/* ── Endspiel-Sieger aus Fixtures ───────────────────────────────────────── */
(function testFinalWinner() {
  function fx(round, timestamp, short, home, away, homeWon) {
    return {
      fixture: { timestamp, status: { short } },
      league: { round },
      teams: {
        home: { id: home.id, name: home.name, logo: '', winner: homeWon === true },
        away: { id: away.id, name: away.name, logo: '', winner: homeWon === false }
      }
    };
  }
  const paris = { id: 85, name: 'Paris Saint Germain' };
  const arsenal = { id: 42, name: 'Arsenal' };
  const real = { id: 541, name: 'Real Madrid' };

  const fixtures = [
    fx('Semi-finals', 1000, 'FT', real, paris, false),
    fx('Final', 2000, 'FT', paris, arsenal, true),
    // Noch nicht gespieltes Endspiel darf nicht gewinnen.
    fx('Final', 3000, 'NS', real, arsenal, undefined)
  ];
  const winner = pickFinalWinner(fixtures);
  assert.ok(winner, 'Endspiel-Sieger muss gefunden werden.');
  assert.equal(winner.id, 85);

  // Auswärtssieger im Elfmeterschiessen.
  assert.equal(pickFinalWinner([fx('Final', 10, 'PEN', real, arsenal, false)]).id, 42);
  // „Round of 16" enthält zwar „Final" nicht, aber Halb-/Viertelfinale schon –
  // beide dürfen nie als Endspiel durchgehen.
  assert.equal(pickFinalWinner([fx('Quarter-finals', 10, 'FT', real, arsenal, true)]), null);
  assert.equal(pickFinalWinner([]), null);

  console.log('ok - Endspiel-Sieger wird nur aus einem beendeten Final gelesen');
})();

/* ── Manuelle Korrekturen ───────────────────────────────────────────────── */
(function testManualOverrides() {
  const base = [
    { id: 1, name: 'Alpha', logo: '', country: 'Spain', via: 'Liga' },
    { id: 2, name: 'Beta', logo: '', country: 'Italy', via: 'Liga' }
  ];

  // Ohne Datei: unverändert.
  const missing = path.join(os.tmpdir(), 'cl-pool-does-not-exist.json');
  assert.deepEqual(applyManualOverrides(base, missing).map((c) => c.id), [1, 2]);

  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'cl-pool-test-'));
  const file = path.join(tmp, 'manual.json');

  fs.writeFileSync(file, JSON.stringify({
    remove: [2],
    add: [{ id: 3, name: 'Gamma', country: 'England', note: 'Playoff-Sieger' }]
  }));
  const result = applyManualOverrides(base, file);
  assert.deepEqual(result.map((c) => c.id), [1, 3]);
  assert.match(result[1].via, /manuell ergänzt: Playoff-Sieger/);

  // Doppeltes Hinzufügen eines bereits vorhandenen Klubs ist ein No-op.
  fs.writeFileSync(file, JSON.stringify({ add: [{ id: 1, name: 'Alpha' }] }));
  assert.equal(applyManualOverrides(base, file).length, 2);

  // Kaputtes JSON darf den Lauf nicht abbrechen.
  fs.writeFileSync(file, '{ nicht: json');
  assert.deepEqual(applyManualOverrides(base, file).map((c) => c.id), [1, 2]);

  fs.rmSync(tmp, { recursive: true, force: true });
  console.log('ok - manuelle Klub-Korrekturen greifen additiv und fehlertolerant');
})();

/* ── Klub gewinnt gegen Spieler-Statistik ───────────────────────────────── */
(function testStatFromSquadEntry() {
  const stat = statFromSquadEntry(
    { id: 529, name: 'Barcelona', logo: 'https://x/barca.png' },
    { id: 42, name: 'Lamine Yamal', position: 'Attacker' }
  );
  assert.equal(stat.team.name, 'Barcelona');
  assert.equal(stat.team.logo, 'https://x/barca.png');
  assert.equal(stat.games.position, 'Attacker');
  console.log('ok - Klubdaten stammen aus dem qualifizierten Verein, nicht aus der Statistik');
})();

/* ── UEFA-Verbandsliste ─────────────────────────────────────────────────── */
(function testAssociations() {
  // Die grossen Ligen dürfen nie fehlen – sonst wäre der Pool halb leer.
  for (const country of ['England', 'Spain', 'Italy', 'Germany', 'France', 'Netherlands', 'Portugal', 'Belgium']) {
    assert.ok(UEFA_ASSOCIATIONS.includes(country), `${country} fehlt in UEFA_ASSOCIATIONS.`);
  }
  // Keine Nicht-UEFA-Verbände (sonst kämen AFC/CONCACAF-Klubs in den Pool).
  for (const country of ['Brazil', 'Argentina', 'Japan', 'USA', 'Egypt']) {
    assert.ok(!UEFA_ASSOCIATIONS.includes(country), `${country} gehört nicht in UEFA_ASSOCIATIONS.`);
  }
  console.log('ok - UEFA-Verbandsliste deckt die Topligen ab und bleibt auf Europa beschränkt');
})();

console.log('generate-cl-pool tests passed');
