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
  buildPlayedPosition,
  pickFinalWinner,
  isQualifyingPlayoffRound,
  pickTieWinners,
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

/* ── Leistungswert der Vorsaison ────────────────────────────────────────── */
(function testPerformance() {
  const { buildPerformance, competitionWeight, COMPETITION_WEIGHTS } = require('./generate-cl-pool.js');
  // Ligen-IDs, wie sie fetchUefaLeagues sammelt (type=League). 88 =
  // Eredivisie (erste Liga), 45 = FA Cup (Pokal, also NICHT enthalten).
  const leagueIds = new Set([39, 140, 135, 78, 61, 88, 106]);

  function stat(leagueId, minutes, appearences, rating) {
    return { league: { id: leagueId }, games: { minutes, appearences, rating } };
  }

  // Gewichte: CL hoeher als Topliga, Topliga hoeher als sonstige Liga,
  // sonstige Liga hoeher als Pokal.
  assert.ok(competitionWeight(2, leagueIds) > competitionWeight(39, leagueIds));
  assert.ok(competitionWeight(39, leagueIds) > competitionWeight(106, leagueIds));
  assert.ok(competitionWeight(106, leagueIds) > competitionWeight(45, leagueIds));
  assert.equal(competitionWeight(2, leagueIds), COMPETITION_WEIGHTS[2]);

  // Ein Topliga-Stammspieler mit CL-Einsaetzen.
  const star = buildPerformance([stat(140, 2500, 30, '7.5'), stat(2, 800, 10, '7.8')], leagueIds);
  assert.equal(star.minutes, 3300);
  assert.equal(star.games, 40);
  assert.equal(star.value, Math.round(2500 * 1.0 + 800 * 1.5));
  // Rating minutengewichtet, nicht einfacher Mittelwert.
  assert.ok(star.rating > 7.5 && star.rating < 7.6, `Rating war ${star.rating}`);

  // Gleiche Minutenzahl in einer schwaecheren Liga ergibt einen kleineren Wert.
  const grinder = buildPerformance([stat(106, 3300, 40, '7.0')], leagueIds);
  assert.ok(grinder.value < star.value,
    `Dauerspieler aus schwaecherer Liga (${grinder.value}) darf den Topliga-Star (${star.value}) nicht ueberholen.`);

  // Ohne Einsaetze bleibt alles 0 – und faellt damit ans Listenende.
  const bench = buildPerformance([stat(140, 0, 0, null)], leagueIds);
  assert.deepEqual(
    [bench.minutes, bench.games, bench.rating, bench.value],
    [0, 0, 0, 0]
  );
  assert.deepEqual(
    [buildPerformance(null, leagueIds).value, buildPerformance([], leagueIds).value],
    [0, 0]
  );

  /* Sammel-Eimer von api-football duerfen NICHT zaehlen. Echte Zeilen aus
   * dem Diagnoselauf (Saison 2025): der Anbieter dupliziert Wettbewerbs-
   * zahlen in "Friendlies Clubs" (667) und in eine "Super Cup"-Zeile ohne
   * league.id. Ungefiltert summierte das auf bis zu 8207 Minuten – rund
   * zwei Saisons – und Vanaken stand vor van Dijk. */
  function raw(league, minutes, appearences) {
    return { league, games: { minutes, appearences, rating: '7.0' } };
  }
  const ndicka = buildPerformance([
    raw({ id: 135, name: 'Serie A' }, 2683, 31),
    raw({ id: 667, name: 'Friendlies Clubs' }, 2693, 31),   // Duplikat der Serie A
    raw({ id: 3, name: 'UEFA Europa League' }, 752, 10)
  ], leagueIds);
  assert.equal(ndicka.minutes, 2683 + 752,
    'Freundschaftsspiel-Eimer (667) darf nicht in die Minuten einfliessen.');

  const vanaken = buildPerformance([
    raw({ id: null, name: 'Super Cup' }, 3574, 40),          // ein Supercup ist EIN Spiel
    raw({ id: 2, name: 'UEFA Champions League' }, 1260, 14),
    raw({ id: 144, name: 'Jupiler Pro League' }, 3373, 39)
  ], leagueIds);
  assert.equal(vanaken.minutes, 1260 + 3373,
    'Zeilen ohne league.id sind nicht zuordenbar und duerfen nicht zaehlen.');
  assert.ok(vanaken.minutes < 5400,
    'Nach dem Filter muss die Minutensumme in einer Saison plausibel sein.');

  // Nationen-Freundschaftsspiele (10) ebenso wenig.
  assert.equal(
    buildPerformance([raw({ id: 10, name: 'Friendlies' }, 720, 8)], leagueIds).minutes,
    0
  );

  // Fehlendes Rating darf den Durchschnitt nicht verfaelschen.
  const partial = buildPerformance([stat(140, 1000, 12, '7.0'), stat(45, 500, 6, null)], leagueIds);
  assert.equal(partial.rating, 7, 'Nur bewertete Minuten zaehlen in den Rating-Schnitt.');
  assert.equal(partial.minutes, 1500);

  console.log('ok - Vorsaison-Leistung gewichtet Wettbewerbe und mittelt das Rating nach Minuten');
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

/* ── Quali-Play-offs von der K.-o.-Runde unterscheiden ──────────────────── */
(function testPlayoffRoundDetection() {
  // Die Runde, die die letzten sieben Ligaphasen-Plätze vergibt.
  for (const round of ['Play-offs', 'Play Offs', 'play-offs', 'Playoff Round']) {
    assert.ok(isQualifyingPlayoffRound(round), `"${round}" ist die Quali-Play-off-Runde.`);
  }
  // Die gleichnamige K.-o.-Runde NACH der Ligaphase gehört NICHT dazu –
  // sonst landeten im Februar plötzlich Ligaphasen-Klubs als "Qualifikanten"
  // im Pool. Ebenso wenig die früheren Qualifikationsrunden (dort steht noch
  // nicht fest, wer die Ligaphase erreicht).
  for (const round of [
    'Knockout Round Play-offs',
    'League Stage - 3',
    'Round of 32',
    'Round of 16',
    '3rd Qualifying Round',
    'Final',
    '',
    null
  ]) {
    assert.ok(!isQualifyingPlayoffRound(round), `"${round}" ist nicht die Quali-Play-off-Runde.`);
  }
  console.log('ok - Quali-Play-offs werden von der K.-o.-Runde nach der Ligaphase getrennt');
})();

/* ── Paarungen über den Gesamtscore entscheiden ─────────────────────────── */
(function testTieWinners() {
  // api-football-Form: `goals` ist der Endstand INKLUSIVE Verlängerung,
  // das Elfmeterschiessen steht separat unter `score.penalty`.
  const leg = (home, away, hg, ag, opts = {}) => ({
    fixture: { id: opts.id || 0, status: { short: opts.status || 'FT' } },
    league: { round: 'Play-offs' },
    teams: {
      home: { id: home[0], name: home[1], logo: `https://x/${home[0]}.png` },
      away: { id: away[0], name: away[1], logo: `https://x/${away[0]}.png` }
    },
    goals: { home: hg, away: ag },
    score: { penalty: opts.penalty || { home: null, away: null } }
  });

  const CELTIC = [247, 'Celtic'];
  const LASK = [1004, 'LASK'];
  const LYON = [80, 'Lyon'];
  const FENER = [611, 'Fenerbahce'];
  const ZAGREB = [604, 'Dinamo Zagreb'];
  const VIKING = [327, 'Viking'];

  const { winners, pending } = pickTieWinners([
    // Rückspiel nach Verlängerung: 5:1 dreht das 3:0 aus dem Hinspiel.
    leg(CELTIC, LASK, 3, 0, { id: 1 }),
    leg(LASK, CELTIC, 5, 1, { id: 2, status: 'AET' }),
    // Gesamtscore 3:2 – die `winner`-Flags einzelner Spiele taugen dafür nicht,
    // denn Lyon gewinnt das Hinspiel und verliert die Paarung.
    leg(LYON, FENER, 1, 0, { id: 3 }),
    leg(FENER, LYON, 3, 1, { id: 4 })
  ]);
  const names = winners.map((t) => t.name).sort();
  assert.deepEqual(names, ['Fenerbahce', 'LASK'], `Unerwartete Sieger: ${names.join(', ')}`);
  assert.deepEqual(pending, []);
  const lask = winners.find((t) => t.name === 'LASK');
  assert.equal(lask.id, 1004, 'Die Team-ID wird für den Kader-Call gebraucht.');
  assert.equal(lask.logo, 'https://x/1004.png');

  // Gleichstand nach beiden Spielen → das Elfmeterschiessen entscheidet.
  const shootout = pickTieWinners([
    leg(ZAGREB, VIKING, 2, 1, { id: 5 }),
    leg(VIKING, ZAGREB, 1, 0, { id: 6, status: 'PEN', penalty: { home: 4, away: 2 } })
  ]);
  assert.deepEqual(shootout.winners.map((t) => t.name), ['Viking']);

  // Rückspiel noch nicht gespielt: kein Sieger raten, sondern offen melden.
  const open = pickTieWinners([
    leg(ZAGREB, VIKING, 2, 1, { id: 7 }),
    leg(VIKING, ZAGREB, 0, 0, { id: 8, status: 'NS' })
  ]);
  assert.deepEqual(open.winners, []);
  assert.equal(open.pending.length, 1, 'Unfertige Paarungen gehören in die Warnung.');

  // Gleichstand ohne Elfmeterdaten: ebenfalls offen statt Zufallssieger.
  const unresolved = pickTieWinners([
    leg(ZAGREB, VIKING, 1, 1, { id: 9 }),
    leg(VIKING, ZAGREB, 0, 0, { id: 10 })
  ]);
  assert.deepEqual(unresolved.winners, []);
  assert.equal(unresolved.pending.length, 1);

  console.log('ok - Play-off-Paarungen werden über den Gesamtscore inkl. Elfmeterschiessen entschieden');
})();

/* ── Einsatz-Beleg der Vorsaison ─────────────────────────────────────────── */
(function testPlayedPosition() {
  const stat = (leagueId, leagueName, position, minutes) => ({
    league: { id: leagueId, name: leagueName },
    games: { position, minutes }
  });

  // Der Regelfall, den der Report finden soll: der Verein meldet einen
  // Aussenverteidiger als Midfielder, gespielt hat er als Defender.
  const fullback = buildPlayedPosition([
    stat(135, 'Serie A', 'Defender', 2400),
    stat(2, 'UEFA Champions League', 'Defender', 600),
    stat(137, 'Coppa Italia', 'Midfielder', 180)
  ]);
  assert.equal(fullback.position, 'DEFENDER');
  assert.equal(fullback.minutes, 3000, 'Minuten derselben Position werden summiert.');
  assert.equal(fullback.total, 3180);
  assert.deepEqual(fullback.breakdown, { DEFENDER: 3000, MIDFIELDER: 180 });

  // Gewichtet wird nach Minuten, nicht nach Anzahl Wettbewerbszeilen: drei
  // kurze Mittelfeld-Einsätze schlagen eine volle Saison als Stürmer nicht.
  const striker = buildPlayedPosition([
    stat(78, 'Bundesliga', 'Attacker', 2700),
    stat(2, 'UEFA Champions League', 'Midfielder', 200),
    stat(81, 'DFB Pokal', 'Midfielder', 150),
    stat(529, 'Super Cup', 'Midfielder', 90)
  ]);
  assert.equal(striker.position, 'ATTACKER');

  // Dieselben Ausschlüsse wie beim Leistungswert (isCountedCompetition):
  // Freundschaftsspiele und Zeilen ohne league.id sind der Eimer, in den
  // api-football dupliziert – sie dürfen den Beleg nicht kippen.
  const friendlies = buildPlayedPosition([
    stat(39, 'Premier League', 'Defender', 900),
    stat(667, 'Friendlies Clubs', 'Attacker', 3000),
    { league: { id: null, name: 'Super Cup' }, games: { position: 'Attacker', minutes: 3000 } }
  ]);
  assert.equal(friendlies.position, 'DEFENDER');
  assert.deepEqual(friendlies.breakdown, { DEFENDER: 900 });

  // Ohne Einsatzminuten gibt es keinen Beleg – dann meldet der Report den
  // Spieler als nicht prüfbar, statt die Kadermeldung stillschweigend zu
  // bestätigen.
  assert.equal(buildPlayedPosition([]).position, '');
  assert.equal(buildPlayedPosition(null).position, '');
  assert.equal(buildPlayedPosition([stat(39, 'Premier League', 'Defender', 0)]).position, '');
  assert.equal(buildPlayedPosition([stat(39, 'Premier League', '', 900)]).position, '');

  // Exakter Gleichstand: deterministisch nach POSITION_ORDER, damit derselbe
  // Eingang nicht mal so und mal so berichtet wird.
  const tie = buildPlayedPosition([
    stat(140, 'La Liga', 'Midfielder', 1000),
    stat(143, 'Copa del Rey', 'Defender', 1000)
  ]);
  assert.equal(tie.position, 'DEFENDER');

  console.log('ok - Einsatz-Beleg gewichtet nach Minuten und ignoriert Freundschaftsspiele');
})();

console.log('generate-cl-pool tests passed');
