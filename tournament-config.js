/* =============================================================================
 *  tournament-config.js
 *
 *  EINZIGE Quelle der Wahrheit für alle turnierspezifischen Werte:
 *  Labels, Daten-Dateien, API-Werte, Firestore-Collections, LocalStorage-/
 *  Cache-Prefixes, Spielstartzeitpunkt, Fallback-Spiele und Punkteregeln.
 *
 *  Wird sowohl im Browser (Frontend, via `<script src="tournament-config.js">`
 *  als `window.APP_CONFIG`) als auch in Node (Cron-Scripts unter `scripts/`
 *  via `require('../tournament-config')`) eingebunden. Es darf nirgendwo
 *  sonst eine zweite Turnier-Tabelle, ein zweiter Regelsatz oder eine
 *  zweite Firestore-Collection-Liste existieren – wer ein neues Turnier
 *  ergänzen oder Regeln ändern will, tut das ausschliesslich hier.
 *
 *  Aktuell ist NUR `wm2026` produktiv. Andere Turniere bleiben als Templates
 *  in der Konfiguration, sind aber per `available: false` und/oder
 *  `dataReady: false` deaktiviert und können weder per URL-Parameter, per
 *  Dev-Switcher noch per Domain-Mapping aktiviert werden, solange keine
 *  passende `data-<key>.js`-Datei existiert.
 *
 *  Aktives Turnier wird in dieser Reihenfolge bestimmt (nur Browser):
 *    1. URL-Parameter ?tournament=<key>             (Test-Override, nicht
 *       persistent – wirkt nur auf den aktuellen Seitenaufruf)
 *    2. Host-spezifischer Dev-Override aus localStorage
 *       (`dreamteam_dev_override_${hostname}`)
 *    3. Domain-Mapping (DOMAIN_TOURNAMENT_MAP)
 *    4. Genereller Fallback (`FALLBACK_TOURNAMENT_KEY`)
 *
 *  In Node-Scripts gilt zusätzlich:
 *    process.env.TOURNAMENT_KEY  > sonst FALLBACK_TOURNAMENT_KEY
 *
 *  Ungültige oder deaktivierte Werte fallen sicher auf das Default-Turnier
 *  zurück. Damit brechen alte Bookmarks zu nicht mehr verfügbaren Turnieren
 *  die App nicht.
 * ============================================================================= */

const APP_CONFIG = (() => {
  // Ultimativer Fallback, falls keine Domain-Zuordnung greift (z. B. lokal
  // oder auf Deploy-Previews). Bewusst nur an dieser einen Stelle hart
  // gesetzt – alle anderen Module sollen den aktiven Key konsumieren.
  const FALLBACK_TOURNAMENT_KEY = "wm2026";

  const URL_PARAM_NAME = "tournament";

  /* ─────────────────────────────────────────────────────────
   * Domain → Turnier Mapping.
   * Diese Map ist die einzige Quelle der Wahrheit für die
   * Auswahl des Standard-Turniers pro Domain.
   * Aktuell ist nur `dt.alae.app → wm2026` produktiv aktiv.
   * ───────────────────────────────────────────────────────── */
  const DOMAIN_TOURNAMENT_MAP = {
    "dt.alae.app": "wm2026"
  };

  /* ─────────────────────────────────────────────────────────
   * LocalStorage-Schlüssel für den Dev-Override.
   *
   * Bewusst HOST-spezifisch, damit eine alte Test-Auswahl auf
   * dem Mobile-Client nicht über Domains hinweg "klebt".
   *
   * Alte/generische Keys aus früheren Iterationen werden beim
   * ersten Laden migriert/aufgeräumt – siehe `cleanupLegacyKeys()`.
   * ───────────────────────────────────────────────────────── */
  function currentHostname() {
    try {
      if (typeof window === "undefined" || !window.location) return "";
      return String(window.location.hostname || "").toLowerCase();
    } catch (err) {
      return "";
    }
  }

  function devOverrideStorageKey(hostname) {
    const host = (hostname || currentHostname() || "unknown").toLowerCase();
    return `dreamteam_dev_override_${host}`;
  }

  // Alte/generische Keys, die früher (vor dem Domain-Mapping) das
  // aktive Turnier global gespeichert haben. Diese würden auf einer
  // anderen Domain das falsche Turnier aufzwingen und werden deshalb
  // bewusst entfernt.
  const LEGACY_GLOBAL_OVERRIDE_KEYS = [
    "dreamteam_active_tournament",
    "selectedTournament",
    "activeTournament",
    "dreamteam_tournament",
    "tournamentOverride"
  ];

  /* ─────────────────────────────────────────────────────────
   * Fallback-Spiele pro Turnier (für leere Datenstände / Dev).
   * Echte Spiele aus Firestore haben Vorrang.
   * ───────────────────────────────────────────────────────── */
  // Provisorische Platzhalter-Spiele für WM 2026 – werden ersetzt,
  // sobald echte Daten aus der API/Firestore vorliegen.
  const FALLBACK_FIXTURES_WM2026 = [
    {
      id: "wm2026_placeholder_1",
      teamA: "TBD",
      homeLogo: "",
      teamB: "TBD",
      awayLogo: "",
      date: "2026-06-11T21:00:00+02:00",
      venue: "Estadio Azteca",
      venueCity: "Mexico City",
      statusShort: "NS"
    },
    {
      id: "wm2026_placeholder_2",
      teamA: "TBD",
      homeLogo: "",
      teamB: "TBD",
      awayLogo: "",
      date: "2026-06-12T18:00:00+02:00",
      venue: "MetLife Stadium",
      venueCity: "East Rutherford",
      statusShort: "NS"
    },
    {
      id: "wm2026_placeholder_3",
      teamA: "TBD",
      homeLogo: "",
      teamB: "TBD",
      awayLogo: "",
      date: "2026-06-12T21:00:00+02:00",
      venue: "BC Place",
      venueCity: "Vancouver",
      statusShort: "NS"
    }
  ];

  const GROUP_STAGE_GROUPS_WM2026 = [
    { group: "A", teams: [
      { slot: "A1", name: "Mexico", aliases: ["Mexiko"] },
      { slot: "A2", name: "South Africa", aliases: ["Suedafrika", "Sudafrika"] },
      { slot: "A3", name: "Korea Republic", aliases: ["South Korea", "Suedkorea", "Sudkorea"] },
      { slot: "A4", name: "Czechia", aliases: ["Czech Republic", "Tschechien"] }
    ] },
    { group: "B", teams: [
      { slot: "B1", name: "Canada", aliases: ["Kanada"] },
      { slot: "B2", name: "Bosnia and Herzegovina", aliases: ["Bosnia & Herzegovina", "Bosnien und Herzegowina"] },
      { slot: "B3", name: "Qatar", aliases: ["Katar"] },
      { slot: "B4", name: "Switzerland", aliases: ["Schweiz"] }
    ] },
    { group: "C", teams: [
      { slot: "C1", name: "Brazil", aliases: ["Brasilien"] },
      { slot: "C2", name: "Morocco", aliases: ["Marokko"] },
      { slot: "C3", name: "Haiti", aliases: [] },
      { slot: "C4", name: "Scotland", aliases: ["Schottland"] }
    ] },
    { group: "D", teams: [
      { slot: "D1", name: "USA", aliases: ["United States", "United States of America", "Vereinigte Staaten"] },
      { slot: "D2", name: "Paraguay", aliases: [] },
      { slot: "D3", name: "Australia", aliases: ["Australien"] },
      { slot: "D4", name: "Turkiye", aliases: ["Turkey", "Tuerkei", "Turkey", "Turkei"] }
    ] },
    { group: "E", teams: [
      { slot: "E1", name: "Germany", aliases: ["Deutschland"] },
      { slot: "E2", name: "Curacao", aliases: ["Curacao", "Curacao"] },
      { slot: "E3", name: "Ivory Coast", aliases: ["Cote d Ivoire", "Cote d'Ivoire", "Elfenbeinkueste", "Elfenbeinkuste"] },
      { slot: "E4", name: "Ecuador", aliases: ["Ekuador"] }
    ] },
    { group: "F", teams: [
      { slot: "F1", name: "Netherlands", aliases: ["Niederlande", "Holland"] },
      { slot: "F2", name: "Japan", aliases: [] },
      { slot: "F3", name: "Sweden", aliases: ["Schweden"] },
      { slot: "F4", name: "Tunisia", aliases: ["Tunesien"] }
    ] },
    { group: "G", teams: [
      { slot: "G1", name: "Belgium", aliases: ["Belgien"] },
      { slot: "G2", name: "Egypt", aliases: ["Aegypten", "Egypt"] },
      { slot: "G3", name: "Iran", aliases: ["IR Iran"] },
      { slot: "G4", name: "New Zealand", aliases: ["Neuseeland"] }
    ] },
    { group: "H", teams: [
      { slot: "H1", name: "Spain", aliases: ["Spanien"] },
      { slot: "H2", name: "Cape Verde", aliases: ["Cape Verde Islands", "Cabo Verde", "Kap Verde"] },
      { slot: "H3", name: "Saudi Arabia", aliases: ["Saudi-Arabien", "Saudiarabien"] },
      { slot: "H4", name: "Uruguay", aliases: [] }
    ] },
    { group: "I", teams: [
      { slot: "I1", name: "France", aliases: ["Frankreich"] },
      { slot: "I2", name: "Senegal", aliases: [] },
      { slot: "I3", name: "Iraq", aliases: ["Irak"] },
      { slot: "I4", name: "Norway", aliases: ["Norwegen"] }
    ] },
    { group: "J", teams: [
      { slot: "J1", name: "Argentina", aliases: ["Argentinien"] },
      { slot: "J2", name: "Algeria", aliases: ["Algerien"] },
      { slot: "J3", name: "Austria", aliases: ["Oesterreich", "Austria"] },
      { slot: "J4", name: "Jordan", aliases: ["Jordanien"] }
    ] },
    { group: "K", teams: [
      { slot: "K1", name: "Portugal", aliases: [] },
      { slot: "K2", name: "DR Congo", aliases: ["Congo DR", "Democratic Republic of the Congo", "Kongo DR"] },
      { slot: "K3", name: "Uzbekistan", aliases: ["Usbekistan"] },
      { slot: "K4", name: "Colombia", aliases: ["Kolumbien"] }
    ] },
    { group: "L", teams: [
      { slot: "L1", name: "England", aliases: [] },
      { slot: "L2", name: "Croatia", aliases: ["Kroatien"] },
      { slot: "L3", name: "Ghana", aliases: [] },
      { slot: "L4", name: "Panama", aliases: [] }
    ] }
  ];

  const GROUP_STAGE_PAIRING_PATTERN = [
    { matchday: 1, pairings: [[1, 2], [3, 4]] },
    { matchday: 2, pairings: [[4, 2], [1, 3]] },
    { matchday: 3, pairings: [[4, 1], [2, 3]] }
  ];

  const KNOCKOUT_BRACKET_WM2026 = {
    qualifiers: { groupRanks: [1, 2], bestThirdPlaces: 8, eliminatedGroupRanks: [4] },
    roundOf32: [
      { match: 73, date: "2026-06-28T21:00:00+02:00", venue: "Los Angeles Stadium", home: { type: "groupRank", group: "A", rank: 2 }, away: { type: "groupRank", group: "B", rank: 2 } },
      { match: 74, date: "2026-06-29T22:30:00+02:00", venue: "Boston Stadium", home: { type: "groupRank", group: "E", rank: 1 }, away: { type: "bestThird", fromGroups: ["A", "B", "C", "D", "F"] } },
      { match: 75, date: "2026-06-30T03:00:00+02:00", venue: "Estadio Monterrey", home: { type: "groupRank", group: "F", rank: 1 }, away: { type: "groupRank", group: "C", rank: 2 } },
      { match: 76, date: "2026-06-29T19:00:00+02:00", venue: "Houston Stadium", home: { type: "groupRank", group: "C", rank: 1 }, away: { type: "groupRank", group: "F", rank: 2 } },
      { match: 77, date: "2026-06-30T23:00:00+02:00", venue: "New York New Jersey Stadium", home: { type: "groupRank", group: "I", rank: 1 }, away: { type: "bestThird", fromGroups: ["C", "D", "F", "G", "H"] } },
      { match: 78, date: "2026-06-30T19:00:00+02:00", venue: "Dallas Stadium", home: { type: "groupRank", group: "E", rank: 2 }, away: { type: "groupRank", group: "I", rank: 2 } },
      { match: 79, date: "2026-07-01T03:00:00+02:00", venue: "Mexico City Stadium", home: { type: "groupRank", group: "A", rank: 1 }, away: { type: "bestThird", fromGroups: ["C", "E", "F", "H", "I"] } },
      { match: 80, date: "2026-07-01T18:00:00+02:00", venue: "Atlanta Stadium", home: { type: "groupRank", group: "L", rank: 1 }, away: { type: "bestThird", fromGroups: ["E", "H", "I", "J", "K"] } },
      { match: 81, date: "2026-07-02T02:00:00+02:00", venue: "San Francisco Bay Area Stadium", home: { type: "groupRank", group: "D", rank: 1 }, away: { type: "bestThird", fromGroups: ["B", "E", "F", "I", "J"] } },
      { match: 82, date: "2026-07-01T22:00:00+02:00", venue: "Seattle Stadium", home: { type: "groupRank", group: "G", rank: 1 }, away: { type: "bestThird", fromGroups: ["A", "E", "H", "I", "J"] } },
      { match: 83, date: "2026-07-03T01:00:00+02:00", venue: "Toronto Stadium", home: { type: "groupRank", group: "K", rank: 2 }, away: { type: "groupRank", group: "L", rank: 2 } },
      { match: 84, date: "2026-07-02T21:00:00+02:00", venue: "Los Angeles Stadium", home: { type: "groupRank", group: "H", rank: 1 }, away: { type: "groupRank", group: "J", rank: 2 } },
      { match: 85, date: "2026-07-03T05:00:00+02:00", venue: "BC Place Vancouver", home: { type: "groupRank", group: "B", rank: 1 }, away: { type: "bestThird", fromGroups: ["E", "F", "G", "I", "J"] } },
      { match: 86, date: "2026-07-04T00:00:00+02:00", venue: "Miami Stadium", home: { type: "groupRank", group: "J", rank: 1 }, away: { type: "groupRank", group: "H", rank: 2 } },
      { match: 87, date: "2026-07-04T03:30:00+02:00", venue: "Kansas City Stadium", home: { type: "groupRank", group: "K", rank: 1 }, away: { type: "bestThird", fromGroups: ["D", "E", "I", "J", "L"] } },
      { match: 88, date: "2026-07-03T20:00:00+02:00", venue: "Dallas Stadium", home: { type: "groupRank", group: "D", rank: 2 }, away: { type: "groupRank", group: "G", rank: 2 } }
    ],
    roundOf16: [
      { match: 89, date: "2026-07-04T23:00:00+02:00", venue: "Philadelphia Stadium", home: { winnerOf: 74 }, away: { winnerOf: 77 } },
      { match: 90, date: "2026-07-04T19:00:00+02:00", venue: "Houston Stadium", home: { winnerOf: 73 }, away: { winnerOf: 75 } },
      { match: 91, date: "2026-07-05T22:00:00+02:00", venue: "New York New Jersey Stadium", home: { winnerOf: 76 }, away: { winnerOf: 78 } },
      { match: 92, date: "2026-07-06T02:00:00+02:00", venue: "Mexico City Stadium", home: { winnerOf: 79 }, away: { winnerOf: 80 } },
      { match: 93, date: "2026-07-06T21:00:00+02:00", venue: "Dallas Stadium", home: { winnerOf: 83 }, away: { winnerOf: 84 } },
      { match: 94, date: "2026-07-07T02:00:00+02:00", venue: "Seattle Stadium", home: { winnerOf: 81 }, away: { winnerOf: 82 } },
      { match: 95, date: "2026-07-07T18:00:00+02:00", venue: "Atlanta Stadium", home: { winnerOf: 86 }, away: { winnerOf: 88 } },
      { match: 96, date: "2026-07-07T22:00:00+02:00", venue: "BC Place Vancouver", home: { winnerOf: 85 }, away: { winnerOf: 87 } }
    ],
    quarterFinals: [
      { match: 97, date: "2026-07-09T22:00:00+02:00", venue: "Boston Stadium", home: { winnerOf: 89 }, away: { winnerOf: 90 } },
      { match: 98, date: "2026-07-10T21:00:00+02:00", venue: "Los Angeles Stadium", home: { winnerOf: 93 }, away: { winnerOf: 94 } },
      { match: 99, date: "2026-07-11T23:00:00+02:00", venue: "Miami Stadium", home: { winnerOf: 91 }, away: { winnerOf: 92 } },
      { match: 100, date: "2026-07-12T03:00:00+02:00", venue: "Kansas City Stadium", home: { winnerOf: 95 }, away: { winnerOf: 96 } }
    ],
    semiFinals: [
      { match: 101, date: "2026-07-14T21:00:00+02:00", venue: "Dallas Stadium", home: { winnerOf: 97 }, away: { winnerOf: 98 } },
      { match: 102, date: "2026-07-15T21:00:00+02:00", venue: "Atlanta Stadium", home: { winnerOf: 99 }, away: { winnerOf: 100 } }
    ],
    thirdPlace: { match: 103, date: "2026-07-18T23:00:00+02:00", venue: "Miami Stadium", home: { runnerUpOf: 101 }, away: { runnerUpOf: 102 } },
    final: { match: 104, date: "2026-07-19T21:00:00+02:00", venue: "New York New Jersey Stadium", home: { winnerOf: 101 }, away: { winnerOf: 102 } }
  };

  /* ─────────────────────────────────────────────────────────
   * Definition aller bekannten Turniere.
   *
   *  - `available: true`  →  darf via URL-Param / Dev-Switcher /
   *                          Domain-Mapping ausgewählt werden.
   *  - `dataReady: true`  →  zugehörige `data-<key>.js` existiert
   *                          und ist im Build vorhanden.
   *
   *  Nur Turniere mit `available: true && dataReady: true` werden
   *  von `getAvailableTournamentKeys()` / `isTournamentAvailable()`
   *  als wirklich nutzbar zurückgeliefert. Templates für künftige
   *  Turniere bleiben deaktiviert, bis ihre Kader-Datei vorhanden
   *  ist.
   * ───────────────────────────────────────────────────────── */
  const TOURNAMENTS = {
    wm2026: {
      key: "wm2026",
      type: "WM",
      year: "2026",
      name: "Weltmeisterschaft 2026",
      shortLabel: "WM 2026",
      longLabel: "FIFA World Cup 2026",
      brandName: "DreamTeam WM 2026",
      pageTitlePrefix: "WM 2026 DreamTeam",
      competitionName: "FIFA World Cup",
      timezone: "Europe/Zurich",
      available: true,
      dataReady: true,
      DREAMTEAM_START: "2026-06-11T21:00:00+02:00",
      // Aktives Zeitfenster für den serverseitigen Auto-Punkte-Upload
      // (scripts/auto-points-upload.js). Außerhalb dieses Fensters
      // beendet sich das Skript vor jeglichem Firebase-Init und ohne
      // API-Call. Der GitHub-Actions-Cron ist zusätzlich auf den
      // WM-Zeitraum eingeschränkt – diese Werte sind die zweite
      // Verteidigungslinie und gelten auch für manuell ausgelöste
      // Läufe ohne FORCE_RUN.
      AUTO_POINTS_FROM: "2026-06-11T20:50:00+02:00",
      AUTO_POINTS_UNTIL: "2026-07-21T08:00:00+02:00",
      storagePrefix: "dreamteam_wm2026",
      cachePrefix: "dreamteam-wm2026",
      dataFile: "data-wm2026.js",
      api: {
        competitionParam: "league",
        competitionId: 1,
        season: "2026"
      },
      firestore: {
        metaCollection: "app_meta",
        metaDocId: "turnier_wm2026",
        teamsCollection: "Teams WM 2026",
        pointsCollection: "Punkte Spieler WM 2026",
        fixturesCollection: "Spiele WM 2026"
      },
      fallbackFixtures: FALLBACK_FIXTURES_WM2026,
      groupStageGroups: GROUP_STAGE_GROUPS_WM2026,
      groupStagePairingPattern: GROUP_STAGE_PAIRING_PATTERN,
      knockoutBracket: KNOCKOUT_BRACKET_WM2026
    }

    /* ─────────────────────────────────────────────────────────
     * Weitere Turnier-Blöcke können hier ergänzt werden.
     *
     * Wenn ein neues Turnier ergänzt werden soll, neuen Block
     * nach demselben Schema wie `wm2026` anlegen, eine passende
     * `data-<key>.js` mit-deployen und dann `available: true` +
     * `dataReady: true` setzen.
     * ───────────────────────────────────────────────────────── */
  };

  /* ─────────────────────────────────────────────────────────
   * Verfügbarkeit prüfen.
   *
   * Ein Turnier gilt nur dann als wirklich nutzbar, wenn es
   * sowohl `available !== false` als auch `dataReady === true`
   * besitzt. So bleiben Templates für künftige Turniere zwar in
   * der Map sichtbar, sind aber nicht aktivierbar, solange keine
   * passende `data-<key>.js` mitausgeliefert wird.
   * ───────────────────────────────────────────────────────── */
  function isTournamentAvailable(key) {
    const t = key ? TOURNAMENTS[key] : null;
    if (!t) return false;
    if (t.available === false) return false;
    if (t.dataReady !== true) return false;
    return true;
  }

  function getAvailableTournamentKeys() {
    return Object.keys(TOURNAMENTS).filter(isTournamentAvailable);
  }

  function normalizeTournamentTeamName(value) {
    if (value === null || value === undefined) return "";
    return String(value)
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/['`]/g, "")
      .replace(/&/g, " and ")
      .replace(/[^a-zA-Z0-9]+/g, " ")
      .trim()
      .replace(/\s+/g, " ")
      .toLowerCase();
  }

  function getGroupStageGroups() {
    const list = getActiveTournament().groupStageGroups;
    return Array.isArray(list) ? list : [];
  }

  function getGroupStagePairingPattern() {
    const list = getActiveTournament().groupStagePairingPattern;
    return Array.isArray(list) ? list : [];
  }

  function getTournamentTeamNames(team) {
    if (!team) return [];
    if (typeof team === "string") return [team];
    return [team.name, ...(Array.isArray(team.aliases) ? team.aliases : [])].filter(Boolean);
  }

  function getMatchTeamNames(match) {
    const m = match || {};
    const homeTeam = (m.homeTeam && typeof m.homeTeam === "object") ? m.homeTeam.name : m.homeTeam;
    const awayTeam = (m.awayTeam && typeof m.awayTeam === "object") ? m.awayTeam.name : m.awayTeam;
    return [
      m.teamA || m.home || homeTeam || "",
      m.teamB || m.away || awayTeam || ""
    ];
  }

  function findGroupStageGroup(teamA, teamB) {
    const teamKeys = [normalizeTournamentTeamName(teamA), normalizeTournamentTeamName(teamB)].filter(Boolean);
    if (!teamKeys.length) return null;

    const groups = getGroupStageGroups().map((entry) => ({
      group: entry.group,
      teamKeys: (entry.teams || []).flatMap(getTournamentTeamNames).map(normalizeTournamentTeamName).filter(Boolean)
    }));

    const matchingBoth = groups.find((entry) => (
      teamKeys.length >= 2 &&
      teamKeys.every((key) => entry.teamKeys.includes(key))
    ));
    if (matchingBoth) return matchingBoth.group;

    const matchingOne = groups.filter((entry) => (
      teamKeys.some((key) => entry.teamKeys.includes(key))
    ));
    return matchingOne.length === 1 ? matchingOne[0].group : null;
  }

  function parseGroupStageMatchday(roundText) {
    const value = String(roundText || "").trim().toLowerCase();
    if (!value) return null;
    const match = value.match(/(?:group|matchday|spieltag|regular season)[^\d]*(\d+)/);
    const n = match ? Number(match[1]) : NaN;
    return Number.isFinite(n) && n >= 1 && n <= 3 ? n : null;
  }

  function isGroupStageRound(roundText) {
    const value = String(roundText || "").trim().toLowerCase();
    if (!value) return true;
    return /group|matchday|spieltag|regular season/.test(value);
  }

  function getMatchSortValue(match) {
    const ts = Number(match && match.kickoffTimestamp);
    if (Number.isFinite(ts) && ts > 0) return ts * 1000;
    const raw = match && (match.date || match.datetime || match.kickoff || match.kickoffIso);
    const ms = raw ? new Date(raw).getTime() : NaN;
    return Number.isFinite(ms) ? ms : Number.MAX_SAFE_INTEGER;
  }

  function getMatchIdentity(match) {
    if (!match) return "";
    const id = match.fixtureId || match.id || match.gameNumber || match.matchId || "";
    if (id) return `id:${id}`;
    const [teamA, teamB] = getMatchTeamNames(match).map(normalizeTournamentTeamName);
    const date = match.date || match.datetime || match.kickoff || match.kickoffIso || "";
    return `pair:${date}|${teamA}|${teamB}`;
  }

  function getGroupStageMatchday(match, matches) {
    const m = match || {};
    const roundText = String(m.round || (m.league && m.league.round) || "").trim();
    const explicit = parseGroupStageMatchday(roundText);
    if (explicit) return explicit;

    const [teamA, teamB] = getMatchTeamNames(m);
    const group = findGroupStageGroup(teamA, teamB);
    if (!group || !Array.isArray(matches) || !matches.length) return null;

    const targetId = getMatchIdentity(m);
    const groupMatches = matches
      .filter((item) => {
        const names = getMatchTeamNames(item);
        return findGroupStageGroup(names[0], names[1]) === group;
      })
      .sort((a, b) => {
        const da = getMatchSortValue(a);
        const db = getMatchSortValue(b);
        if (da !== db) return da - db;
        return getMatchIdentity(a).localeCompare(getMatchIdentity(b), "de");
      });

    const appearances = {};
    for (const item of groupMatches) {
      const names = getMatchTeamNames(item).map(normalizeTournamentTeamName);
      const nextMatchday = Math.max(appearances[names[0]] || 0, appearances[names[1]] || 0) + 1;
      if (item === m || getMatchIdentity(item) === targetId) return Math.min(nextMatchday, 3);
      appearances[names[0]] = (appearances[names[0]] || 0) + 1;
      appearances[names[1]] = (appearances[names[1]] || 0) + 1;
    }

    return null;
  }

  function buildGroupStagePairings(groupLetter) {
    const groupKey = String(groupLetter || "").toUpperCase();
    const group = getGroupStageGroups().find((entry) => String(entry.group || "").toUpperCase() === groupKey);
    if (!group) return [];

    return getGroupStagePairingPattern().map((round) => ({
      matchday: round.matchday,
      pairings: (round.pairings || []).map(([a, b]) => ({
        home: group.teams[a - 1] || null,
        away: group.teams[b - 1] || null
      }))
    }));
  }

  function buildGroupStageLabelForMatch(match, options) {
    const m = match || {};
    const roundText = String(m.round || (m.league && m.league.round) || "").trim();
    if (!isGroupStageRound(roundText)) return "";

    const [teamA, teamB] = getMatchTeamNames(m);
    const group = findGroupStageGroup(teamA, teamB);
    if (!group) return "";

    const n = Number(
      options && typeof options === "object"
        ? (options.matchday || getGroupStageMatchday(m, options.matches))
        : getGroupStageMatchday(m, null)
    );
    return Number.isFinite(n) && n > 0
      ? `Gruppe ${group} - Spiel ${n}`
      : `Gruppe ${group}`;
  }

  function formatGroupRankLabel(rank) {
    const labels = {
      1: "Sieger",
      2: "Zweiter",
      3: "Dritter",
      4: "Vierter"
    };
    return labels[rank] || `${rank}.`;
  }

  function formatKnockoutSlotLabel(slot) {
    if (!slot) return "";
    if (slot.type === "groupRank") {
      return `${formatGroupRankLabel(slot.rank)} Gruppe ${slot.group}`;
    }
    if (slot.type === "bestThird") {
      const groups = Array.isArray(slot.fromGroups) ? slot.fromGroups.join("/") : "";
      return groups ? `Dritter aus Gruppe ${groups}` : "Drittplatzierter";
    }
    if (slot.winnerOf) return `Sieger Spiel ${slot.winnerOf}`;
    if (slot.runnerUpOf) return `Verlierer Spiel ${slot.runnerUpOf}`;
    return "";
  }

  function getKnockoutBracketRound(roundKey) {
    const bracket = getActiveTournament().knockoutBracket || {};
    const round = bracket[roundKey];
    return Array.isArray(round) ? round : [];
  }

  function buildRoundOf32Preview() {
    return getKnockoutBracketRound("roundOf32").map((fixture) => ({
      ...fixture,
      homeLabel: formatKnockoutSlotLabel(fixture.home),
      awayLabel: formatKnockoutSlotLabel(fixture.away)
    }));
  }

  /* ─────────────────────────────────────────────────────────
   * Aktives Turnier robust auflösen.
   *
   * Reihenfolge:
   *   1. URL-Parameter ?tournament=<key>     (volatile Test-Override)
   *   2. Host-spezifischer Dev-Override       (localStorage)
   *   3. Domain-Mapping (DOMAIN_TOURNAMENT_MAP)
   *   4. Globaler Fallback (FALLBACK_TOURNAMENT_KEY)
   *
   * Ungültige oder nicht verfügbare Keys werden ignoriert und führen
   * letztlich auf den globalen Fallback zurück.
   * ───────────────────────────────────────────────────────── */
  function readUrlTournamentKey() {
    try {
      if (typeof window === "undefined" || !window.location) return null;
      const params = new URLSearchParams(window.location.search);
      const value = params.get(URL_PARAM_NAME);
      return value ? value.trim().toLowerCase() : null;
    } catch (err) {
      return null;
    }
  }

  function readDevOverrideKey() {
    try {
      if (typeof window === "undefined" || !window.localStorage) return null;
      const value = window.localStorage.getItem(devOverrideStorageKey());
      return value ? value.trim().toLowerCase() : null;
    } catch (err) {
      return null;
    }
  }

  function persistDevOverrideKey(key) {
    try {
      if (typeof window === "undefined" || !window.localStorage) return;
      window.localStorage.setItem(devOverrideStorageKey(), key);
    } catch (err) {
      // Storage kann in Privacy-Modi blockiert sein – kein Hard-Fail.
    }
  }

  function clearDevOverride() {
    try {
      if (typeof window === "undefined" || !window.localStorage) return;
      window.localStorage.removeItem(devOverrideStorageKey());
    } catch (err) {
      // ignore
    }
  }

  // Einmal-Aufräumen alter, nicht host-spezifischer Override-Keys
  // sowie alter Dev-Overrides, die auf inzwischen nicht mehr
  // verfügbare Turniere zeigen. Wichtig, damit weder generische
  // Legacy-Keys noch tote Werte die Auswahl verfälschen können.
  function cleanupLegacyKeys() {
    try {
      if (typeof window === "undefined" || !window.localStorage) return;

      LEGACY_GLOBAL_OVERRIDE_KEYS.forEach((legacyKey) => {
        if (window.localStorage.getItem(legacyKey) !== null) {
          window.localStorage.removeItem(legacyKey);
        }
      });

      // Host-spezifischer Override, der auf ein nicht (mehr)
      // verfügbares Turnier zeigt → entfernen.
      const hostKey = devOverrideStorageKey();
      const stored = window.localStorage.getItem(hostKey);
      if (stored && !isTournamentAvailable(stored.trim().toLowerCase())) {
        window.localStorage.removeItem(hostKey);
      }
    } catch (err) {
      // ignore
    }
  }

  function getDomainTournamentKey(hostname) {
    const host = (hostname || currentHostname() || "").toLowerCase();
    if (!host) return null;
    if (Object.prototype.hasOwnProperty.call(DOMAIN_TOURNAMENT_MAP, host)) {
      const mapped = DOMAIN_TOURNAMENT_MAP[host];
      return mapped && isTournamentAvailable(mapped) ? mapped : null;
    }
    return null;
  }

  /**
   * Liefert das standardmässig zur aktuellen Domain gehörende Turnier
   * (ohne Berücksichtigung von URL- oder Dev-Override).
   * Wenn die Domain nicht im Mapping enthalten ist, wird der globale
   * Fallback zurückgegeben.
   */
  function resolveDomainDefaultKey() {
    const fromDomain = getDomainTournamentKey();
    if (fromDomain) return fromDomain;
    return FALLBACK_TOURNAMENT_KEY;
  }

  /**
   * Zentrale Auflösung des aktiven Turnier-Keys.
   * Reihenfolge: URL > host-spezifischer Dev-Override > Domain > Fallback.
   * Akzeptiert ausschliesslich verfügbare Turniere (siehe
   * `isTournamentAvailable`); alles andere fällt durch.
   */
  function resolveTournamentKey() {
    cleanupLegacyKeys();

    const fromUrl = readUrlTournamentKey();
    if (fromUrl && isTournamentAvailable(fromUrl)) {
      // Bewusst NICHT persistieren – ?tournament= ist ein einmaliger
      // Test-Override und darf den Domain-Default nicht dauerhaft
      // umstellen.
      return fromUrl;
    }

    const fromOverride = readDevOverrideKey();
    if (fromOverride && isTournamentAvailable(fromOverride)) {
      return fromOverride;
    }

    return resolveDomainDefaultKey();
  }

  // Backwards-Kompatibilität: Andere Aufrufer dürfen weiterhin
  // `resolveActiveTournamentKey()` benutzen.
  const resolveActiveTournamentKey = resolveTournamentKey;

  let ACTIVE_TOURNAMENT_KEY = resolveTournamentKey();

  /* ─────────────────────────────────────────────────────────
   * Firebase-Konfiguration (Projekt-weit identisch).
   * ───────────────────────────────────────────────────────── */
  const firebaseConfig = {
    apiKey: "AIzaSyAOrgxmb_NZM1H_HZpMG1XfK9azDgV2zCQ",
    authDomain: "dreamteam-d2121.firebaseapp.com",
    projectId: "dreamteam-d2121",
    storageBucket: "dreamteam-d2121.firebasestorage.app",
    messagingSenderId: "1044159021561",
    appId: "1:1044159021561:web:89c88336b707ab1f4dbd28"
  };

  /* ─────────────────────────────────────────────────────────
   * Punkteregeln & Labels (turnierübergreifend identisch).
   * ───────────────────────────────────────────────────────── */
  const rules = {
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

  const ruleLabels = {
    START: "Startaufstellung",
    SUBBED_IN: "Eingewechselt",
    SUBBED_OUT: "Ausgewechselt",
    GOAL_GK: "Tore",
    GOAL_DEF: "Tore",
    GOAL_MID: "Tore",
    GOAL_ATT: "Tore",
    OWN_GOAL: "Eigentore",
    ASSIST_GK_DEF: "Assists",
    ASSIST_MID: "Assists",
    ASSIST_ATT: "Assists",
    TEAM_GOAL: "Tore (Mannschaft)",
    GEGENTOR_GK_DEF: "Gegentore",
    YELLOW_CARD: "Gelbe Karten",
    RED_CARD: "Rote Karten",
    PEN_SAVED: "Elfmeter gehalten",
    PEN_MISSED: "Elfmeter verschossen",
    PEN_COMMITED: "Elfmeter verursacht",
    PEN_WON: "Elfmeter herausgeholt",
    WIN: "Siege",
    DRAW: "Unentschieden",
    LOSS: "Niederlagen",
    DEF_BASE_PTS: "Abwehr-Bonus"
  };

  function getActiveTournament() {
    const tournament = TOURNAMENTS[ACTIVE_TOURNAMENT_KEY];
    if (!tournament) {
      // Notfall-Fallback – sollte nie eintreten, da Auflösung validiert.
      return TOURNAMENTS[FALLBACK_TOURNAMENT_KEY];
    }
    return tournament;
  }

  function requireCompetitionId() {
    const tournament = getActiveTournament();
    const id = tournament.api && tournament.api.competitionId;

    if (id === null || id === undefined || id === "") {
      throw new Error(
        `Für ${tournament.shortLabel} ist noch keine API competitionId gesetzt.`
      );
    }

    return id;
  }

  function getDb() {
    if (!window.firebase) {
      throw new Error("Firebase SDK ist noch nicht geladen.");
    }

    if (!window.firebase.apps.length) {
      window.firebase.initializeApp(firebaseConfig);
    }

    return window.firebase.firestore();
  }

  /* ─────────────────────────────────────────────────────────
   * Dev-Switch: Aktives Turnier per Dev-Override wechseln.
   *
   * Speichert die Auswahl host-spezifisch in localStorage
   * (`dreamteam_dev_override_${hostname}`) und lädt die Seite neu.
   *
   * Wichtig: Der Override gilt nur für die aktuelle Domain und nur
   * für aktuell verfügbare Turniere. Nicht verfügbare/deaktivierte
   * Keys werden ignoriert.
   * ───────────────────────────────────────────────────────── */
  function setActiveTournament(key, options) {
    const opts = options || {};
    const normalized = (key || "").toLowerCase();

    if (!isTournamentAvailable(normalized)) {
      console.warn(`[APP_CONFIG] Turnier "${key}" ist aktuell nicht verfügbar.`);
      return false;
    }

    // Wenn die Wahl exakt dem Domain-Default entspricht, brauchen wir
    // keinen aktiven Override. Wir entfernen einen evtl. bestehenden
    // Override, damit der Indicator "Domain-Default" wieder korrekt ist.
    if (normalized === resolveDomainDefaultKey()) {
      clearDevOverride();
    } else {
      persistDevOverrideKey(normalized);
    }

    if (opts.reload === false) {
      ACTIVE_TOURNAMENT_KEY = normalized;
      return true;
    }

    try {
      const url = new URL(window.location.href);
      // ?tournament=... bewusst entfernen, damit der frisch gesetzte
      // Override nicht mit einer alten URL-Selektion kollidiert.
      url.searchParams.delete(URL_PARAM_NAME);
      window.location.replace(url.toString());
    } catch (err) {
      window.location.reload();
    }

    return true;
  }

  /**
   * Setzt das aktive Turnier zurück auf den Domain-Default.
   * Entfernt den host-spezifischen Dev-Override und lädt neu.
   */
  function resetToDomainDefault(options) {
    const opts = options || {};
    clearDevOverride();

    if (opts.reload === false) {
      ACTIVE_TOURNAMENT_KEY = resolveDomainDefaultKey();
      return true;
    }

    try {
      const url = new URL(window.location.href);
      url.searchParams.delete(URL_PARAM_NAME);
      window.location.replace(url.toString());
    } catch (err) {
      window.location.reload();
    }

    return true;
  }

  function isDevOverrideActive() {
    const override = readDevOverrideKey();
    if (!override || !isTournamentAvailable(override)) return false;
    return override !== resolveDomainDefaultKey();
  }

  function isUrlOverrideActive() {
    const fromUrl = readUrlTournamentKey();
    if (!fromUrl || !isTournamentAvailable(fromUrl)) return false;
    // URL-Override gilt als "aktiv", wenn er vom Resultat nach Override-
    // Auflösung abweicht – also wenn er real gerade verwendet wird.
    return ACTIVE_TOURNAMENT_KEY === fromUrl;
  }

  return {
    tournaments: TOURNAMENTS,
    domainTournamentMap: DOMAIN_TOURNAMENT_MAP,

    get activeTournamentKey() {
      return ACTIVE_TOURNAMENT_KEY;
    },

    get activeTournament() {
      return getActiveTournament();
    },

    get availableTournamentKeys() {
      return getAvailableTournamentKeys();
    },

    isTournamentAvailable,
    getAvailableTournamentKeys,

    get domainDefaultKey() {
      return resolveDomainDefaultKey();
    },

    get domainDefaultTournament() {
      return TOURNAMENTS[resolveDomainDefaultKey()] || TOURNAMENTS[FALLBACK_TOURNAMENT_KEY];
    },

    get hostname() {
      return currentHostname();
    },

    isDevOverrideActive,
    isUrlOverrideActive,
    resolveTournamentKey,
    getDomainTournamentKey,
    resetToDomainDefault,
    clearDevOverride,

    get key() {
      return getActiveTournament().key;
    },

    get type() {
      return getActiveTournament().type;
    },

    get year() {
      return getActiveTournament().year;
    },

    get name() {
      return getActiveTournament().name;
    },

    get shortLabel() {
      return getActiveTournament().shortLabel;
    },

    get longLabel() {
      return getActiveTournament().longLabel || getActiveTournament().name;
    },

    get brandName() {
      return getActiveTournament().brandName;
    },

    get pageTitlePrefix() {
      return getActiveTournament().pageTitlePrefix;
    },

    get tournamentLabel() {
      return getActiveTournament().shortLabel;
    },

    get competitionName() {
      return getActiveTournament().competitionName || "";
    },

    get timezone() {
      return getActiveTournament().timezone || "Europe/Zurich";
    },

    get DREAMTEAM_START() {
      const raw = getActiveTournament().DREAMTEAM_START;
      // Konsistent als Date-Objekt zurückgeben, wie es alte Aufrufer erwarten.
      return raw instanceof Date ? raw : new Date(raw);
    },

    /* ─────────────────────────────────────────────────────────
     * Pre-/Post-Start-Helper.
     *
     * Zentrale Quelle der Wahrheit für die App-weite Frage
     * „Dürfen Team-Inhalte (Kader, Pick-Listen, Aggregate über
     *  gedraftete Spieler etc.) angezeigt werden?".
     *
     * Vor `DREAMTEAM_START` werden die Teams der Teilnehmer
     * applikationsweit versteckt; erst ab dem Anpfiff
     * (z.B. WM 2026: 2026-06-11T21:00 +02:00, also 21:00 Uhr
     * Schweizer Zeit) sind sie öffentlich sichtbar.
     *
     * Berücksichtigt den Admin-Dev-Override aus admin.js
     * (`DreamTeamAdmin.getDevViewOverride()` → "pre" / "post"),
     * der nur für angemeldete Admin-Accounts gilt. Manipulierte
     * localStorage-Werte bei normalen Usern werden ignoriert.
     * ───────────────────────────────────────────────────────── */
    getEffectiveViewMode() {
      const Admin = (typeof window !== "undefined") ? window.DreamTeamAdmin : null;
      const override = (Admin && typeof Admin.getDevViewOverride === "function")
        ? Admin.getDevViewOverride()
        : null;
      if (override === "pre") return "pre";
      if (override === "post") return "post";

      try {
        const raw = getActiveTournament().DREAMTEAM_START;
        const start = raw instanceof Date ? raw : new Date(raw);
        if (start instanceof Date && !isNaN(start.getTime())) {
          return Date.now() >= start.getTime() ? "post" : "pre";
        }
      } catch (_) { /* fall through to conservative default */ }

      // Wenn aus irgendeinem Grund keine Startzeit ermittelbar ist,
      // bewusst restriktiv defaulten: Teams bleiben versteckt.
      return "pre";
    },

    isPreStart() {
      return this.getEffectiveViewMode() === "pre";
    },

    isPostStart() {
      return this.getEffectiveViewMode() === "post";
    },

    /**
     * Sind die Kader der Teilnehmer aktuell öffentlich sichtbar?
     * Vor `DREAMTEAM_START` → false; ab Anpfiff → true. Honoriert
     * Admin-Override (siehe `getEffectiveViewMode`).
     */
    isTeamsRevealed() {
      return this.isPostStart();
    },

    /**
     * Plant einen einmaligen Callback genau zum `DREAMTEAM_START`,
     * damit eine bereits offene Seite nahtlos von Pre- auf Post-
     * Start umschaltet. Browser drosseln sehr lange Timer; deshalb
     * unterteilen wir den Wartezeitraum in 6h-Etappen. Liefert eine
     * Cancel-Funktion zurück.
     */
    onReveal(callback) {
      if (typeof callback !== "function") return function () {};
      if (typeof window === "undefined") return function () {};

      let cancelled = false;
      let timerId = null;
      const SIX_HOURS_MS = 6 * 60 * 60 * 1000;
      const self = this;

      function tick() {
        if (cancelled) return;
        const start = self.DREAMTEAM_START;
        if (!(start instanceof Date) || isNaN(start.getTime())) return;
        const ms = start.getTime() - Date.now();
        if (ms <= 0) {
          try { callback(); } catch (err) {
            console.error("[APP_CONFIG] onReveal callback error:", err);
          }
          return;
        }
        const delay = Math.min(ms, SIX_HOURS_MS);
        timerId = setTimeout(tick, delay);
      }

      tick();
      return function cancel() {
        cancelled = true;
        if (timerId) {
          clearTimeout(timerId);
          timerId = null;
        }
      };
    },

    get fallbackFixtures() {
      const list = getActiveTournament().fallbackFixtures;
      return Array.isArray(list) ? list : [];
    },

    get groupStageGroups() {
      return getGroupStageGroups();
    },

    get groupStagePairingPattern() {
      return getGroupStagePairingPattern();
    },

    get knockoutBracket() {
      return getActiveTournament().knockoutBracket || null;
    },

    getGroupStageGroup(teamA, teamB) {
      return findGroupStageGroup(teamA, teamB);
    },

    getGroupStageMatchday(match, matches) {
      return getGroupStageMatchday(match, matches);
    },

    getGroupStagePairings(groupLetter) {
      return buildGroupStagePairings(groupLetter);
    },

    groupStageLabelForMatch(match, options) {
      return buildGroupStageLabelForMatch(match, options);
    },

    getRoundOf32Fixtures() {
      const bracket = getActiveTournament().knockoutBracket;
      return bracket && Array.isArray(bracket.roundOf32) ? bracket.roundOf32 : [];
    },

    getRoundOf32Preview() {
      return buildRoundOf32Preview();
    },

    getKnockoutBracketRound(roundKey) {
      return getKnockoutBracketRound(roundKey);
    },

    formatKnockoutSlotLabel(slot) {
      return formatKnockoutSlotLabel(slot);
    },

    firebaseConfig,
    rules,
    ruleLabels,

    api: {
      get competitionParam() {
        return getActiveTournament().api.competitionParam || "league";
      },

      get competitionId() {
        return requireCompetitionId();
      },

      get season() {
        return getActiveTournament().api.season || getActiveTournament().year;
      },

      isConfigured() {
        const id = getActiveTournament().api && getActiveTournament().api.competitionId;
        return id !== null && id !== undefined && id !== "";
      },

      buildBaseQuery() {
        return `${this.competitionParam}=${this.competitionId}&season=${this.season}`;
      },

      fixturesUrl() {
        return `https://v3.football.api-sports.io/fixtures?${this.buildBaseQuery()}`;
      },

      teamsUrl() {
        return `https://v3.football.api-sports.io/teams?${this.buildBaseQuery()}`;
      },

      playersUrl(page = 1) {
        return `https://v3.football.api-sports.io/players?${this.buildBaseQuery()}&page=${page}`;
      },

      playerDetailUrl(playerId) {
        return `https://v3.football.api-sports.io/players?id=${playerId}&season=${this.season}`;
      },

      fixtureDetailUrl(fixtureId) {
        return `https://v3.football.api-sports.io/fixtures?id=${fixtureId}`;
      },

      venueUrl(venueId) {
        return `https://v3.football.api-sports.io/venues?id=${venueId}`;
      },

      fixturesWithTimezoneUrl() {
        return `${this.fixturesUrl()}&timezone=Europe/Zurich`;
      }
    },

    firestore: {
      get metaCollection() {
        return (
          (getActiveTournament().firestore &&
            getActiveTournament().firestore.metaCollection) ||
          "app_meta"
        );
      },

      metaDocId() {
        const fs = getActiveTournament().firestore;
        if (fs && fs.metaDocId) return fs.metaDocId;
        return `turnier_${getActiveTournament().key}`;
      },

      teamsCollection() {
        const fs = getActiveTournament().firestore;
        if (fs && fs.teamsCollection) return fs.teamsCollection;
        return `Teams ${getActiveTournament().shortLabel}`;
      },

      pointsCollection() {
        const fs = getActiveTournament().firestore;
        if (fs && fs.pointsCollection) return fs.pointsCollection;
        return `Punkte Spieler ${getActiveTournament().shortLabel}`;
      },

      fixturesCollection() {
        const fs = getActiveTournament().firestore;
        if (fs && fs.fixturesCollection) return fs.fixturesCollection;
        return `Spiele ${getActiveTournament().shortLabel}`;
      }
    },

    storage: {
      get devOverrideKey() {
        return devOverrideStorageKey();
      },

      // Backwards-Kompatibilität für Aufrufer, die früher den
      // generischen Key abgefragt haben. Zeigt nun den host-spezifischen
      // Override-Key.
      get activeTournamentKey() {
        return devOverrideStorageKey();
      },

      /* ─────────────────────────────────────────────────────────
       * Bewusst NICHT turnier-namespaced.
       *
       * Diese Keys sind globale Admin-/Tester-Toggles, die
       *   a) turnier-übergreifend gelten sollen, und
       *   b) bereits vor dem Laden von `tournament-config.js`
       *      lesbar sein müssen (z. B. das Pre-Flight-Inline-
       *      Skript im <head> von index.html, das `<html>`-
       *      `data-view` setzt, bevor irgendwelche App-Skripte
       *      laufen).
       *
       * Wer neue globale Dev-Keys einführt, listet sie hier
       * zentral statt sie als String-Literal in mehreren Dateien
       * zu duplizieren. Alle „normalen“ App-Keys laufen über
       * `APP.storage.key(name)`.
       * ───────────────────────────────────────────────────────── */
      globalKeys: {
        indexViewMode: "dreamteamIndexViewMode"
      },

      appPrefix() {
        return getActiveTournament().storagePrefix || `dreamteam_${getActiveTournament().key}`;
      },

      key(name) {
        return `${this.appPrefix()}_${name}`;
      },

      builderCacheKey() {
        return this.key("builder_cache");
      },

      /**
       * Einmal-Migration eines alten, un­gepräfixten Legacy-Keys auf
       * den turnier-namespaceten Key.
       *
       *  - Existiert nur der Legacy-Key, wird sein Wert auf den neuen
       *    Key kopiert.
       *  - Existieren beide, hat der neue Key Vorrang (Legacy gilt als
       *    überholt).
       *  - In jedem Fall wird der Legacy-Key entfernt, sobald sein
       *    Inhalt auf den neuen Key übertragen wurde – damit ist die
       *    Altlast endgültig weg und der Wert verbleibt sauber unter
       *    `APP.storage.key(name)`.
       *
       * Funktioniert für `localStorage` (Default) und `sessionStorage`.
       * Schluckt Storage-Errors (Privacy-Mode, deaktivierter Storage).
       *
       * @param {string} name         Logischer Name, wird via key() namespaced.
       * @param {string} legacyKey    Vollständiger alter Storage-Key.
       * @param {object} [options]
       * @param {"local"|"session"} [options.storage="local"]
       * @returns {string|null}       Migrierter / vorhandener Wert oder null.
       */
      migrate(name, legacyKey, options) {
        if (!legacyKey) return null;
        const which = (options && options.storage) === "session" ? "session" : "local";
        const newKey = this.key(name);
        try {
          if (typeof window === "undefined") return null;
          const store = which === "session" ? window.sessionStorage : window.localStorage;
          if (!store) return null;

          const legacyValue = store.getItem(legacyKey);
          const currentValue = store.getItem(newKey);

          if (legacyValue !== null && currentValue === null) {
            store.setItem(newKey, legacyValue);
          }
          if (legacyValue !== null) {
            store.removeItem(legacyKey);
          }
          return store.getItem(newKey);
        } catch (err) {
          return null;
        }
      }
    },

    cache: {
      get prefix() {
        return getActiveTournament().cachePrefix || `dreamteam-${getActiveTournament().key}`;
      }
    },

    data: {
      mode: "per-tournament-file",

      fileName() {
        return getActiveTournament().dataFile || "data.js";
      },

      get currentFile() {
        return this.fileName();
      }
    },

    setActiveTournament,
    getDb
  };
})();

if (typeof window !== "undefined") {
  window.APP_CONFIG = APP_CONFIG;
}
if (typeof module !== "undefined" && module.exports) {
  module.exports = APP_CONFIG;
}
