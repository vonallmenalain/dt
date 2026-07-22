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
  const ENABLE_FIRESTORE_PERSISTENCE = false;
  let firestorePersistenceAttempted = false;

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
  /* Gemeinsames CL-Theme (dunkelblau + hellblau) – Vorschlag, jederzeit
   * anpassbar. Wird vom Theme-Hook (Dateiende) als CSS-Variablen injiziert
   * und von theme-cl.css konsumiert. Gilt nur für CL-Turniere; die WM 2026
   * hat KEIN `theme` und bleibt daher unverändert (grün/gold). */
  const CL_THEME = {
    primary: "#3d8bff",     // kräftiges Blau: Buttons, aktive Elemente
    accent: "#7db4ff",      // Hellblau: Links, Überschriften, Akzente
    background: "#0a1633",  // Dunkelblau: Seitenhintergrund
    surface: "#132347",     // Karten-/Navbar-Fläche
    surfaceAlt: "#0f1c3d",  // leicht abgesetzte Fläche
    text: "#dce8ff",        // helle, bläuliche Grundschrift
    textMuted: "#9db6e8",   // gedämpfte Sekundärschrift
    navGradient: "linear-gradient(135deg, #081029 0%, #10265a 45%, #16346f 100%)"
  };

  /* Transfer-Regeln für die CL (Vorschlag/Standardwerte, anpassbar):
   * 2 Transfer-Aktionen für die GESAMTE Champions League, pro Aktion bis
   * zu 3 Spieler tauschbar, jederzeit (vorerst ohne Zeitfenster). Die WM
   * 2026 hat KEIN `transfers` → kein Transfer-Feature (unverändert). */
  const CL_TRANSFERS = {
    enabled: true,
    totalTransfers: 2,
    maxPlayersPerTransfer: 3,
    anytime: true
  };

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
      fixtureCount: {
        minPublished: 72,
        expectedFinal: 104
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
    },

    /* ═════════════════════════════════════════════════════════════
     * Champions League 2026/27  —  GERÜST (Meilenstein M1)
     *
     * Bewusst `available: false` UND `dataReady: false`: dieses Turnier
     * ist weder per URL-Parameter, Dev-Switcher noch Domain-Mapping
     * auswählbar, solange keine `data-cl2627.js` existiert und die Flags
     * nicht auf true stehen. Der Block ist damit vollständig INERT – die
     * produktive WM 2026 bleibt unberührt.
     *
     * Freischaltung (später, ~27.08.2026 nach der Auslosung):
     *   1. `data-cl2627.js` (Kader der 36 qualifizierten Klubs) deployen.
     *   2. `available: true`, `dataReady: true` setzen.
     *   3. `defaultActiveFrom` sorgt dann dafür, dass dt.alae.app ab
     *      diesem Datum automatisch auf die CL defaultet (die WM bleibt
     *      per Admin-Switcher / `?tournament=wm2026` erreichbar).
     *
     * Viele Werte unten sind PLATZHALTER (TBD) und werden präzisiert,
     * sobald Auslosung und Spielplan feststehen. Da der Block inert ist,
     * hat das keine Laufzeitwirkung.
     * ═════════════════════════════════════════════════════════════ */
    cl2627: {
      key: "cl2627",
      type: "CL",
      year: "2026",
      name: "Champions League 2026/27",
      shortLabel: "CL 2026/27",
      longLabel: "UEFA Champions League 2026/27",
      brandName: "DreamTeam CL 2026/27",
      pageTitlePrefix: "CL 2026/27 DreamTeam",
      competitionName: "UEFA Champions League",
      timezone: "Europe/Zurich",

      // NOCH NICHT freigeschaltet – siehe Kommentar oben.
      available: false,
      dataReady: false,

      // Turnierstruktur-Diskriminator. Die CL 2024/25+ hat KEINE
      // Vierergruppen mehr, sondern eine gemeinsame Ligaphase (36 Klubs,
      // je 8 Spiele) mit anschliessender Playoff-/K.-o.-Runde. Konsumenten
      // behandeln ein fehlendes Feld als "groups" (WM-Verhalten), sodass
      // die WM-Config unangetastet bleibt. Die zugehörige Ligaphasen-
      // Logik kommt in M2.
      structure: "league",

      // Primäre Anzeige-Entität: bei der CL steht der KLUB im Fokus
      // (nicht das Land wie bei der WM). data.js schiebt dafür beim Laden
      // den Klub in die primären Anzeigefelder und die Nation in die
      // sekundären – so werden alle Views club-zentriert, ohne die
      // (eingefrorenen) WM-Views anzufassen.
      primaryEntity: "club",

      // Domain(s), für die dieses Turnier ab `defaultActiveFrom` zum
      // Standard wird (siehe resolveScheduledDomainKey). Wirkt erst, wenn
      // das Turnier `available` ist.
      defaultDomains: ["dt.alae.app"],
      // Ab diesem Zeitpunkt defaultet die oben genannte Domain auf die CL –
      // Auslosung 27.08.2026 (Schweizer Zeit). Genaues Datum TBD.
      defaultActiveFrom: "2026-08-27T00:00:00+02:00",

      // TBD: erster Ligaphasen-Spieltag (Team-Bau-Deadline / Reveal).
      DREAMTEAM_START: "2026-09-16T21:00:00+02:00",
      // TBD: aktives Zeitfenster für den Auto-Punkte-Upload (CL-Saison
      // ~Sep 2026 bis Finale ~Ende Mai/Anfang Juni 2027). Wird in M7
      // zusammen mit den Cron-Fenstern präzisiert.
      AUTO_POINTS_FROM: "2026-09-16T18:00:00+02:00",
      AUTO_POINTS_UNTIL: "2027-06-06T23:59:00+02:00",

      storagePrefix: "dreamteam_cl2627",
      cachePrefix: "dreamteam-cl2627",
      dataFile: "data-cl2627.js",

      api: {
        competitionParam: "league",
        // API-Football Liga-ID der UEFA Champions League.
        competitionId: 2,
        // API-Football führt die Saison 2026/27 unter dem Startjahr.
        season: "2026"
      },

      // TBD: Ligaphase 36 Klubs × 8 Spiele / 2 = 144 Ligaspiele, plus
      // Playoffs/K.-o. Genaue Zahlen in M2/M7.
      fixtureCount: {
        minPublished: 144,
        expectedFinal: 189
      },

      firestore: {
        metaCollection: "app_meta",
        metaDocId: "turnier_cl2627",
        teamsCollection: "Teams CL 2026-27",
        pointsCollection: "Punkte Spieler CL 2026-27",
        fixturesCollection: "Spiele CL 2026-27"
      },

      // CL hat eine Ligaphase statt Vierergruppen – kein Gruppen-/Bracket-
      // Schema aus der WM, sondern eine gemeinsame 36er-Tabelle.
      fallbackFixtures: [],

      // Ligaphasen-Parameter (Meilenstein M2a). Steuern die Auflösung
      // „Klub noch im Turnier" in computeTournamentLeagueStatus:
      //   Ränge 1–8   → direkt Achtelfinale
      //   Ränge 9–24  → Playoff-Runde (Hin/Rück)
      //   Ränge 25–36 → ausgeschieden (erst NACH Abschluss der Ligaphase)
      leaguePhase: {
        teamCount: 36,
        matchesPerTeam: 8,
        directQualifyThrough: 8,
        playoffThrough: 24
      },

      // K.-o.-Phase: Playoffs/Achtel/Viertel/Halbfinale sind Hin- und
      // Rückspiele (Sieger nach Gesamtergebnis, bei Gleichstand
      // Verlängerung/Elfmeter im Rückspiel). Der Final ist ein Einzelspiel.
      // Einzelspiel-Runden werden am Runden-Text erkannt (siehe
      // isSingleLegKnockoutRound); dieses Flag dient der Dokumentation.
      knockout: {
        twoLegged: true
      },

      // Eigene Punkteregeln (M0-Mechanik: pro Turnier überschreibbar).
      // `rules` wird bewusst NICHT gesetzt → es gelten vorerst die
      // eingefrorenen Defaults (= WM), bis du sie hier überschreibst.
      // Captain-Multiplikator: CL soll 1.5× statt 2×. Wird in M4 von den
      // CL-Views konsumiert (die WM-Views bleiben bei hartkodiertem 2×).
      captainMultiplier: 1.5,
      captainEnabled: false,

      // Transfer-Feature (siehe CL_TRANSFERS): 2 Transfers für die ganze
      // CL, je bis zu 3 Spieler, jederzeit. Konsumiert von transfer-utils.js.
      transfers: CL_TRANSFERS,

      // CL-Theme (dunkelblau + hellblau, siehe CL_THEME). Wird vom
      // Theme-Hook als CSS-Variablen injiziert; theme-cl.css konsumiert
      // sie. Farben jederzeit über CL_THEME anpassbar.
      theme: CL_THEME
    },

    /* ═════════════════════════════════════════════════════════════
     * Champions League 2025/26  —  TEST-/STAGING-Turnier (M2b-Gerüst)
     *
     * Ausschliesslich für die interne Validierung der Ligaphasen-Logik
     * gegen eine ABGESCHLOSSENE Saison mit bekannten Ergebnissen. Bleibt
     * dauerhaft `available: false` (nie öffentlich), ist aber als Admin-
     * VORSCHAU ladbar (Preview-Kanal), SOBALD `data-cl2526.js` existiert.
     * Nutzt dieselbe Liga-Logik/Struktur wie cl2627.
     *
     * Offen (siehe Übergabe): `data-cl2526.js` (Kader) + Fixtures müssen
     * noch generiert werden – dafür fehlt aktuell Generator-Tooling im
     * Repo und ein club-zentrierter Schema-Entscheid.
     * ═════════════════════════════════════════════════════════════ */
    cl2526: {
      key: "cl2526",
      type: "CL",
      year: "2025",
      name: "Champions League",
      shortLabel: "Champions League",
      longLabel: "UEFA Champions League 2025/2026",
      brandName: "DreamTeam Champions League",
      pageTitlePrefix: "Champions League DreamTeam",
      // Saison-Zusatz (klein unter dem Titel); bewusst getrennt vom Namen,
      // damit „25/26" nicht mehr im Label/Brand auftaucht.
      seasonLabel: "2025/2026",
      competitionName: "UEFA Champions League",
      timezone: "Europe/Zurich",

      // Nie öffentlich – reines internes Test-/Preview-Turnier.
      available: false,
      dataReady: false,

      structure: "league",
      primaryEntity: "club",
      captainMultiplier: 1.5,
      captainEnabled: false,

      // Abgeschlossene Saison: API-Football Liga-ID 2, Saison-Startjahr 2025.
      api: {
        competitionParam: "league",
        competitionId: 2,
        season: "2025"
      },

      leaguePhase: {
        teamCount: 36,
        matchesPerTeam: 8,
        directQualifyThrough: 8,
        playoffThrough: 24
      },
      knockout: { twoLegged: true },

      // Referenz: erster Spieltag der 25/26-Ligaphase.
      DREAMTEAM_START: "2025-09-16T21:00:00+02:00",

      storagePrefix: "dreamteam_cl2526",
      cachePrefix: "dreamteam-cl2526",
      dataFile: "data-cl2526.js",

      firestore: {
        metaCollection: "app_meta",
        metaDocId: "turnier_cl2526",
        teamsCollection: "Teams CL 2025-26 Test",
        pointsCollection: "Punkte Spieler CL 2025-26 Test",
        fixturesCollection: "Spiele CL 2025-26 Test"
      },

      fallbackFixtures: [],

      // Gleiches Transfer-Feature wie 2026/27 (zum Testen).
      transfers: CL_TRANSFERS,

      // Gleiches CL-Theme wie 2026/27 (dunkelblau) für konsistente Vorschau.
      theme: CL_THEME
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
   * Nationen-Lebenszyklus ("Spieler noch im Turnier").
   *
   * Bestimmt anhand der Fixture-Sammlung, welche Nationen noch
   * im Turnier sind. Die Logik spiegelt exakt die Qualifikations-
   * regeln, die in der Analyse-Ansicht (Turnier → Gruppenphase /
   * Finalrunde) gezeigt werden, damit beide Stellen denselben
   * Endstand liefern:
   *
   *   1. GRUPPENPHASE: Aus allen beendeten Gruppenspielen wird die
   *      komplette Tabelle pro Gruppe berechnet (Punkte, danach –
   *      bei Gleichstand – Direktvergleich, Tordifferenz, Tore,
   *      Fairplay, FIFA-Rang, Auslosungs­reihenfolge). Sobald ALLE
   *      Gruppen fertig gespielt sind, gilt:
   *        • Platz 1 + 2 jeder Gruppe  → qualifiziert (im Turnier)
   *        • die besten N Gruppendritten (N = bestThirdPlaces aus
   *          dem K.-o.-Baum, WM 2026: 8 von 12) → qualifiziert
   *        • alle übrigen Dritten und alle Vierten → ausgeschieden
   *      Solange noch nicht alle Gruppen fertig sind, gilt niemand
   *      als ausgeschieden (konservativ – Drittplatzierte lassen
   *      sich erst nach Abschluss aller Gruppen vergleichen).
   *
   *   2. K.-O.-RUNDE: Aus jedem beendeten K.-o.-Spiel wird der
   *      Verlierer bestimmt und als ausgeschieden markiert. Der
   *      Sieger bleibt im Turnier, auch wenn die Folgepaarung in
   *      den Fixtures noch nicht benannt ist. Penalty-Entscheidungen
   *      werden korrekt behandelt, weil zuerst das API-Sieger-Flag
   *      (`homeTeam.winner` / `awayTeam.winner`) genutzt wird und
   *      nur als Fallback die reinen Tore.
   *
   * Eine Nation ist "im Turnier", solange sie nicht in der
   * Ausgeschieden-Menge steht. Unbekannte Nationen (ohne Gruppen-
   * Konfiguration) werten wir konservativ als aktiv.
   *
   * Gruppen- vs. K.-o.-Spiel wird primär am Runden-Text der Fixture
   * (`league.round`, z. B. "Group A - 1" vs. "Round of 32") erkannt
   * und – falls kein Text vorhanden ist – an der Gruppen­zugehörig­
   * keit der beiden Teams (gleiche Gruppe → Gruppenspiel, sonst
   * K.-o.). Dadurch werden auch K.-o.-Fixtures mit noch unbenanntem
   * Gegner (z. B. "Dritter X/Y/Z") korrekt der jeweils benannten
   * Nation gutgeschrieben, statt sie fälschlich auszuschliessen.
   * ───────────────────────────────────────────────────────── */
  const FINISHED_FIXTURE_STATUSES = new Set(["FT", "AET", "PEN"]);

  function buildNationGroupIndex() {
    const index = new Map(); // normalisierter Name/Alias -> Gruppenbuchstabe
    getGroupStageGroups().forEach((group) => {
      const letter = String(group.group || "").toUpperCase();
      (group.teams || []).forEach((team) => {
        getTournamentTeamNames(team).forEach((name) => {
          const key = normalizeTournamentTeamName(name);
          if (key && !index.has(key)) index.set(key, letter);
        });
      });
    });
    return index;
  }

  // Map: normalisierter Name ODER Alias -> kanonischer Team-Key
  // (kanonisch = normalisierter Hauptname). Damit werden Aliase wie
  // "Turkey" auf dieselbe Nation wie "Turkiye" aufgelöst.
  function buildNationKeyIndex() {
    const index = new Map();
    getGroupStageGroups().forEach((group) => {
      (group.teams || []).forEach((team) => {
        const canonical = normalizeTournamentTeamName(team.name || team.slot || "");
        if (!canonical) return;
        getTournamentTeamNames(team).forEach((name) => {
          const key = normalizeTournamentTeamName(name);
          if (key && !index.has(key)) index.set(key, canonical);
        });
      });
    });
    return index;
  }

  function getFixtureSideName(fixture, side) {
    if (!fixture || typeof fixture !== "object") return "";
    const camel = side === "home" ? fixture.homeTeam : fixture.awayTeam;
    if (camel && typeof camel === "object" && camel.name) return String(camel.name);
    if (typeof camel === "string" && camel) return camel;
    const legacy = fixture.teams && fixture.teams[side];
    if (legacy && legacy.name) return String(legacy.name);
    return "";
  }

  function getFixtureSideLogo(fixture, side) {
    if (!fixture || typeof fixture !== "object") return "";
    const camel = side === "home" ? fixture.homeTeam : fixture.awayTeam;
    if (camel && typeof camel === "object" && camel.logo) return String(camel.logo);
    const legacy = fixture.teams && fixture.teams[side];
    if (legacy && legacy.logo) return String(legacy.logo);
    return "";
  }

  function getFixtureSideWinner(fixture, side) {
    if (!fixture || typeof fixture !== "object") return null;
    const camel = side === "home" ? fixture.homeTeam : fixture.awayTeam;
    if (camel && typeof camel === "object" && typeof camel.winner === "boolean") return camel.winner;
    const legacy = fixture.teams && fixture.teams[side];
    if (legacy && typeof legacy.winner === "boolean") return legacy.winner;
    return null;
  }

  function getFixtureStatusShort(fixture) {
    if (!fixture || typeof fixture !== "object") return "";
    if (fixture.status && fixture.status.short) return String(fixture.status.short);
    if (fixture.statusShort) return String(fixture.statusShort);
    return "";
  }

  function getFixtureKickoffValue(fixture) {
    const ts = Number(fixture && fixture.kickoffTimestamp);
    if (Number.isFinite(ts) && ts > 0) return ts > 1e11 ? ts : ts * 1000;
    const raw = fixture && (fixture.kickoffIso || fixture.date || fixture.datetime || fixture.kickoff);
    const ms = raw ? new Date(raw).getTime() : NaN;
    return Number.isFinite(ms) ? ms : 0;
  }

  function getFixtureRoundText(fixture) {
    if (!fixture || typeof fixture !== "object") return "";
    if (fixture.league && fixture.league.round) return String(fixture.league.round);
    if (fixture.round) return String(fixture.round);
    return "";
  }

  function getFixtureGoals(fixture) {
    const goals = (fixture && fixture.goals) || {};
    const rawHome = goals.home != null ? goals.home
      : (fixture && fixture.homeGoals != null ? fixture.homeGoals : null);
    const rawAway = goals.away != null ? goals.away
      : (fixture && fixture.awayGoals != null ? fixture.awayGoals : null);
    const home = rawHome != null ? Number(rawHome) : NaN;
    const away = rawAway != null ? Number(rawAway) : NaN;
    return {
      home: Number.isFinite(home) ? home : null,
      away: Number.isFinite(away) ? away : null
    };
  }

  /* Qualifikations-Parameter aus dem K.-o.-Baum:
   *  - groupRanks       : Gruppenplätze, die direkt qualifiziert sind
   *  - bestThirdPlaces  : Anzahl der besten Gruppendritten, die zusätzlich
   *                       qualifiziert sind (0 = keine Dritten). */
  function getKnockoutQualifierConfig() {
    const bracket = getActiveTournament().knockoutBracket || {};
    const q = bracket.qualifiers || {};
    const groupRanks = Array.isArray(q.groupRanks) && q.groupRanks.length
      ? q.groupRanks.map(Number).filter(Number.isFinite)
      : [1, 2];
    const bestThirdPlaces = Number.isFinite(Number(q.bestThirdPlaces)) ? Number(q.bestThirdPlaces) : 0;
    return { groupRanks, bestThirdPlaces };
  }

  /* Leere Tabellen-Zeilen pro Gruppe aufbauen (gespiegelt an der
   * Analyse-Ansicht). Fairplay/FIFA-Rang sind in der Gruppen-Konfig
   * i. d. R. nicht gesetzt und wirken dann als neutrale Tiebreaker. */
  function buildGroupStandingRows() {
    const byLetter = new Map();
    getGroupStageGroups().forEach((group) => {
      const letter = String(group.group || "").toUpperCase();
      if (!letter) return;
      const rows = (group.teams || []).map((team, idx) => {
        const names = getTournamentTeamNames(team);
        const key = normalizeTournamentTeamName(team.name || team.slot || names[0] || "");
        const fairPlayRaw = Number(
          team.fairPlayScore != null ? team.fairPlayScore
            : (team.fairPlay != null ? team.fairPlay : 0)
        );
        const fifaRaw = Number(
          team.fifaRank != null ? team.fifaRank
            : (team.fifaRanking != null ? team.fifaRanking : Infinity)
        );
        return {
          key,
          group: letter,
          order: idx + 1,
          played: 0, won: 0, drawn: 0, lost: 0,
          gf: 0, ga: 0, gd: 0, pts: 0,
          fairPlay: Number.isFinite(fairPlayRaw) ? fairPlayRaw : 0,
          fifaRank: Number.isFinite(fifaRaw) ? fifaRaw : Infinity,
          h2h: new Map(),
          rank: null
        };
      }).filter((row) => row.key);
      const rowsByKey = new Map(rows.map((row) => [row.key, row]));
      byLetter.set(letter, { letter, rows, rowsByKey, expectedPerTeam: Math.max(rows.length - 1, 0) });
    });
    return byLetter;
  }

  function getNationH2hRow(row, opponentKey) {
    if (!row.h2h.has(opponentKey)) {
      row.h2h.set(opponentKey, { played: 0, pts: 0, gf: 0, ga: 0 });
    }
    return row.h2h.get(opponentKey);
  }

  function applyGroupMatchToRows(rowsByKey, homeKey, awayKey, hg, ag) {
    const home = rowsByKey.get(homeKey);
    const away = rowsByKey.get(awayKey);
    if (!home || !away) return;

    const homePts = hg > ag ? 3 : (hg === ag ? 1 : 0);
    const awayPts = ag > hg ? 3 : (hg === ag ? 1 : 0);

    home.played += 1; away.played += 1;
    home.gf += hg; home.ga += ag; away.gf += ag; away.ga += hg;
    home.pts += homePts; away.pts += awayPts;
    if (hg > ag) { home.won += 1; away.lost += 1; }
    else if (ag > hg) { away.won += 1; home.lost += 1; }
    else { home.drawn += 1; away.drawn += 1; }
    home.gd = home.gf - home.ga;
    away.gd = away.gf - away.ga;

    const homeH2h = getNationH2hRow(home, awayKey);
    homeH2h.played += 1; homeH2h.pts += homePts; homeH2h.gf += hg; homeH2h.ga += ag;
    const awayH2h = getNationH2hRow(away, homeKey);
    awayH2h.played += 1; awayH2h.pts += awayPts; awayH2h.gf += ag; awayH2h.ga += hg;
  }

  function getNationH2hStats(row, tiedRows) {
    return tiedRows.reduce((acc, opponent) => {
      if (!opponent || opponent.key === row.key) return acc;
      const item = row.h2h.get(opponent.key);
      if (!item) return acc;
      acc.played += item.played;
      acc.pts += item.pts;
      acc.gf += item.gf;
      acc.ga += item.ga;
      return acc;
    }, { played: 0, pts: 0, gf: 0, ga: 0 });
  }

  function compareNationTiedRows(a, b, tiedRows) {
    const h2hA = getNationH2hStats(a, tiedRows);
    const h2hB = getNationH2hStats(b, tiedRows);
    const gdA = h2hA.gf - h2hA.ga;
    const gdB = h2hB.gf - h2hB.ga;
    if (h2hA.pts !== h2hB.pts) return h2hB.pts - h2hA.pts;
    if (gdA !== gdB) return gdB - gdA;
    if (h2hA.gf !== h2hB.gf) return h2hB.gf - h2hA.gf;
    if (a.gd !== b.gd) return b.gd - a.gd;
    if (a.gf !== b.gf) return b.gf - a.gf;
    if (a.fairPlay !== b.fairPlay) return b.fairPlay - a.fairPlay;
    if (a.fifaRank !== b.fifaRank) return a.fifaRank - b.fifaRank;
    return a.order - b.order;
  }

  function sortNationGroupRows(rows) {
    const buckets = new Map();
    rows.forEach((row) => {
      const key = String(row.pts);
      if (!buckets.has(key)) buckets.set(key, []);
      buckets.get(key).push(row);
    });
    return Array.from(buckets.keys())
      .map(Number)
      .sort((a, b) => b - a)
      .flatMap((points) => {
        const bucket = buckets.get(String(points)) || [];
        if (bucket.length <= 1) return bucket;
        return bucket.slice().sort((a, b) => compareNationTiedRows(a, b, bucket));
      })
      .map((row, idx) => {
        row.rank = idx + 1;
        return row;
      });
  }

  function compareNationThirdRows(a, b) {
    if (a.pts !== b.pts) return b.pts - a.pts;
    if (a.gd !== b.gd) return b.gd - a.gd;
    if (a.gf !== b.gf) return b.gf - a.gf;
    if (a.fairPlay !== b.fairPlay) return b.fairPlay - a.fairPlay;
    if (a.fifaRank !== b.fifaRank) return a.fifaRank - b.fifaRank;
    return String(a.group).localeCompare(String(b.group), "de");
  }

  function computeTournamentNationStatus(fixtures) {
    const groupIndex = buildNationGroupIndex();
    const keyIndex = buildNationKeyIndex();
    const hasGroupConfig = groupIndex.size > 0;
    const groupOf = (key) => groupIndex.get(key) || null;
    // Alias auf kanonischen Team-Key auflösen (Fallback: roher Schlüssel).
    const canon = (key) => (key && keyIndex.get(key)) || key;

    const list = fixtures && typeof fixtures === "object"
      ? (Array.isArray(fixtures) ? fixtures : Object.values(fixtures))
      : [];

    const standings = buildGroupStandingRows();
    const knockoutFixtures = [];
    const participantKeys = new Set();
    let knockoutPhaseReached = false;

    list.forEach((fixture) => {
      if (!fixture || typeof fixture !== "object") return;

      const homeName = getFixtureSideName(fixture, "home");
      const awayName = getFixtureSideName(fixture, "away");
      const homeKey = canon(normalizeTournamentTeamName(homeName));
      const awayKey = canon(normalizeTournamentTeamName(awayName));
      if (homeKey) participantKeys.add(homeKey);
      if (awayKey) participantKeys.add(awayKey);

      const isFinished = FINISHED_FIXTURE_STATUSES.has(getFixtureStatusShort(fixture));
      const roundText = getFixtureRoundText(fixture);
      const groupLikeRound = isGroupStageRound(roundText);
      const gh = homeKey ? groupOf(homeKey) : null;
      const ga = awayKey ? groupOf(awayKey) : null;

      // Klassifikation: Runden-Text hat Vorrang, sonst Gruppenzugehörigkeit.
      let kind = "unknown";
      if (roundText && !groupLikeRound) {
        kind = "knockout";
      } else if (hasGroupConfig && gh && ga && gh === ga) {
        kind = "group";
      } else if (hasGroupConfig && gh && ga && gh !== ga) {
        kind = "knockout";
      }

      if (kind === "knockout") {
        knockoutPhaseReached = true;
        knockoutFixtures.push({
          homeKey,
          awayKey,
          isFinished,
          homeWinner: getFixtureSideWinner(fixture, "home"),
          awayWinner: getFixtureSideWinner(fixture, "away"),
          goals: getFixtureGoals(fixture)
        });
      } else if (kind === "group" && isFinished) {
        const { home: hg, away: ag } = getFixtureGoals(fixture);
        if (Number.isFinite(hg) && Number.isFinite(ag)) {
          const entry = standings.get(gh);
          if (entry) applyGroupMatchToRows(entry.rowsByKey, homeKey, awayKey, hg, ag);
        }
      }
    });

    // Tabellen ranken.
    const groupResults = [];
    standings.forEach((entry) => {
      entry.ranked = sortNationGroupRows(entry.rows);
      groupResults.push(entry);
    });

    // Alle Gruppen fertig gespielt? Erst dann lassen sich Endstände und
    // (vor allem) die besten Drittplatzierten zuverlässig bestimmen.
    const allGroupsComplete = groupResults.length > 0 && groupResults.every((entry) =>
      entry.expectedPerTeam > 0 &&
      entry.rows.length > 0 &&
      entry.rows.every((row) => row.played === entry.expectedPerTeam)
    );

    const { groupRanks, bestThirdPlaces } = getKnockoutQualifierConfig();
    const advancedRanks = new Set(groupRanks);

    const advanced = new Set();
    const eliminated = new Set();

    if (allGroupsComplete) {
      groupResults.forEach((entry) => {
        (entry.ranked || []).forEach((row) => {
          if (advancedRanks.has(row.rank)) advanced.add(row.key);
        });
      });

      if (bestThirdPlaces > 0) {
        const thirds = groupResults
          .map((entry) => (entry.ranked || [])[2])
          .filter(Boolean)
          .slice()
          .sort(compareNationThirdRows);
        thirds.forEach((row, idx) => {
          if (idx < bestThirdPlaces) advanced.add(row.key);
        });
      }

      // Nach Abschluss der Gruppenphase: jede nicht qualifizierte
      // Nation ist ausgeschieden.
      groupResults.forEach((entry) => {
        entry.rows.forEach((row) => {
          if (!advanced.has(row.key)) eliminated.add(row.key);
        });
      });
    }

    // K.-o.-Verlierer ausscheiden lassen (gewinnt eine bereits in der
    // Gruppenphase qualifizierte Nation nicht, fliegt sie hier raus).
    knockoutFixtures.forEach((kf) => {
      if (!kf.isFinished) return;
      let loserKey = null;
      if (kf.homeWinner === true && kf.awayKey) loserKey = kf.awayKey;
      else if (kf.awayWinner === true && kf.homeKey) loserKey = kf.homeKey;
      else {
        const { home: hg, away: ag } = kf.goals;
        if (Number.isFinite(hg) && Number.isFinite(ag) && hg !== ag) {
          loserKey = hg > ag ? kf.awayKey : kf.homeKey;
        }
      }
      if (loserKey) eliminated.add(loserKey);
    });

    const aliveKeys = new Set();
    participantKeys.forEach((key) => {
      if (!eliminated.has(key)) aliveKeys.add(key);
    });

    function isNationAlive(nationName) {
      if (!hasGroupConfig) return true;
      const key = canon(normalizeTournamentTeamName(nationName));
      if (!key) return true;
      return !eliminated.has(key);
    }

    function countActivePlayers(players, getNation) {
      if (!Array.isArray(players)) return 0;
      const resolve = typeof getNation === "function"
        ? getNation
        : (p) => (p && (p.nation || p["Nationalteam.name"])) || "";
      return players.reduce((sum, p) => sum + (isNationAlive(resolve(p)) ? 1 : 0), 0);
    }

    return {
      // `knockoutStarted` bleibt als Kompatibilitäts-Feld erhalten: true,
      // sobald die K.-o.-Phase erkennbar ist oder die Gruppen-Endstände
      // feststehen (ab dann werden Nationen ausgeschieden).
      knockoutStarted: knockoutPhaseReached || allGroupsComplete,
      allGroupsComplete,
      aliveKeys,
      eliminatedKeys: eliminated,
      participantKeys,
      isNationAlive,
      countActivePlayers
    };
  }

  /* ─────────────────────────────────────────────────────────
   * Ligaphasen-Lebenszyklus ("Klub noch im Turnier").
   *
   * CL-Variante von computeTournamentNationStatus für Turniere mit
   * `structure: "league"` (z. B. Champions League 2026/27). Statt
   * Vierergruppen gibt es eine gemeinsame Tabelle aus `teamCount`
   * Klubs, die je `matchesPerTeam` Spiele bestreiten. Nach Abschluss
   * der KOMPLETTEN Ligaphase gilt:
   *   • Ränge 1..directQualifyThrough → weiter (direkt Achtelfinale)
   *   • Ränge ..playoffThrough        → weiter (Playoff-Runde)
   *   • alle dahinter                 → ausgeschieden
   * Solange die Ligaphase nicht vollständig gespielt ist, gilt – wie
   * bei der WM – konservativ niemand als ausgeschieden.
   *
   * K.-o.-Runde: Playoffs/Achtel/Viertel/Halbfinale sind Hin- und
   * Rückspiele. Ein Klub scheidet erst aus, wenn BEIDE Legs beendet
   * sind und das Gesamtergebnis feststeht; bei Gleichstand entscheidet
   * das Sieger-Flag des entscheidenden Rückspiels (Verlängerung/
   * Elfmeter). Der Final ist ein Einzelspiel.
   *
   * Rückgabeform ist kompatibel zu computeTournamentNationStatus
   * (isNationAlive / countActivePlayers / aliveKeys / …); „Nation"
   * entspricht hier dem Klub.
   * ───────────────────────────────────────────────────────── */
  function getLeagueRow(rows, key) {
    if (!rows.has(key)) {
      rows.set(key, {
        key, played: 0, won: 0, drawn: 0, lost: 0,
        gf: 0, ga: 0, gd: 0, pts: 0, awayGf: 0, awayWon: 0, rank: null
      });
    }
    return rows.get(key);
  }

  function applyLeagueMatchToRows(rows, homeKey, awayKey, hg, ag) {
    const home = getLeagueRow(rows, homeKey);
    const away = getLeagueRow(rows, awayKey);
    home.played += 1; away.played += 1;
    home.gf += hg; home.ga += ag;
    away.gf += ag; away.ga += hg;
    away.awayGf += ag;
    if (hg > ag) { home.won += 1; home.pts += 3; away.lost += 1; }
    else if (ag > hg) { away.won += 1; away.awayWon += 1; away.pts += 3; home.lost += 1; }
    else { home.drawn += 1; away.drawn += 1; home.pts += 1; away.pts += 1; }
    home.gd = home.gf - home.ga;
    away.gd = away.gf - away.ga;
  }

  function compareLeagueRows(a, b) {
    if (a.pts !== b.pts) return b.pts - a.pts;
    if (a.gd !== b.gd) return b.gd - a.gd;
    if (a.gf !== b.gf) return b.gf - a.gf;
    if (a.awayGf !== b.awayGf) return b.awayGf - a.awayGf;
    if (a.won !== b.won) return b.won - a.won;
    if (a.awayWon !== b.awayWon) return b.awayWon - a.awayWon;
    // Deterministischer Fallback. Die offiziellen weiteren Tiebreaker
    // (Disziplinar-Wertung, UEFA-Koeffizient) sind hier bewusst NICHT
    // abgebildet und werden bei Bedarf später ergänzt.
    return String(a.key).localeCompare(String(b.key), "de");
  }

  function isLeaguePhaseRound(roundText) {
    const v = String(roundText || "").trim().toLowerCase();
    if (!v) return false;
    return /league\s*(stage|phase)|liga.?phase|regular season|matchday|spieltag/.test(v);
  }

  // Qualifikations-/Vorrunde einer Ligaphasen-Competition (CL): alle Runden
  // VOR der Ligaphase. Diese sollen in den CL-Ansichten NICHT als „echte"
  // Champions-League-Spiele gezeigt werden (erst ab der Ligarunde).
  //   Ausschluss: Preliminary/Qualifying-Runden sowie die Quali-„Play-offs".
  //   KEIN Ausschluss: „Knockout Round Play-offs" (K.-o.-Phase), Ligaphase,
  //   Achtel-/Viertel-/Halbfinale, Finale.
  function isQualificationRound(roundText) {
    const v = String(roundText || "").trim().toLowerCase();
    if (!v) return false;
    if (/qualifying|qualification|preliminary/.test(v)) return true;
    if (/play[\s-]*offs?\b/.test(v) && !/knockout|league/.test(v)) return true;
    return false;
  }

  function isSingleLegKnockoutRound(roundText) {
    const v = String(roundText || "").trim().toLowerCase();
    return /final/.test(v) && !/semi|quarter|halb|viertel/.test(v);
  }

  function decideKnockoutLegLoser(leg) {
    if (leg.homeWinner === true) return leg.awayKey;
    if (leg.awayWinner === true) return leg.homeKey;
    const hg = leg.goals.home;
    const ag = leg.goals.away;
    if (Number.isFinite(hg) && Number.isFinite(ag) && hg !== ag) {
      return hg > ag ? leg.awayKey : leg.homeKey;
    }
    return null;
  }

  function computeTournamentLeagueStatus(fixtures, opts) {
    const active = getActiveTournament();
    const lp = (opts && opts.leaguePhase) || active.leaguePhase || {};
    const matchesPerTeam = Number.isFinite(Number(lp.matchesPerTeam)) ? Number(lp.matchesPerTeam) : 8;
    const teamCount = Number.isFinite(Number(lp.teamCount)) ? Number(lp.teamCount) : 36;
    const playoffThrough = Number.isFinite(Number(lp.playoffThrough)) ? Number(lp.playoffThrough) : 24;

    const list = fixtures && typeof fixtures === "object"
      ? (Array.isArray(fixtures) ? fixtures : Object.values(fixtures))
      : [];

    const rows = new Map();
    const names = new Map();  // key → Anzeigename (erste Fundstelle)
    const logos = new Map();  // key → Logo-URL (erste Fundstelle)
    const participantKeys = new Set();
    const ties = new Map();
    let knockoutPhaseReached = false;

    list.forEach((fixture) => {
      if (!fixture || typeof fixture !== "object") return;

      const homeName = getFixtureSideName(fixture, "home");
      const awayName = getFixtureSideName(fixture, "away");
      const homeKey = normalizeTournamentTeamName(homeName);
      const awayKey = normalizeTournamentTeamName(awayName);
      if (homeKey) {
        participantKeys.add(homeKey);
        if (!names.has(homeKey)) names.set(homeKey, homeName);
        if (!logos.has(homeKey)) { const l = getFixtureSideLogo(fixture, "home"); if (l) logos.set(homeKey, l); }
      }
      if (awayKey) {
        participantKeys.add(awayKey);
        if (!names.has(awayKey)) names.set(awayKey, awayName);
        if (!logos.has(awayKey)) { const l = getFixtureSideLogo(fixture, "away"); if (l) logos.set(awayKey, l); }
      }

      const roundText = getFixtureRoundText(fixture);
      const isFinished = FINISHED_FIXTURE_STATUSES.has(getFixtureStatusShort(fixture));

      if (isLeaguePhaseRound(roundText)) {
        if (isFinished && homeKey && awayKey) {
          const { home: hg, away: ag } = getFixtureGoals(fixture);
          if (Number.isFinite(hg) && Number.isFinite(ag)) {
            applyLeagueMatchToRows(rows, homeKey, awayKey, hg, ag);
          }
        }
        return;
      }

      // Alles mit (nicht-Liga-)Runden-Text zählt als K.-o.-Spiel.
      if (!roundText || !homeKey || !awayKey) return;
      knockoutPhaseReached = true;
      const pair = [homeKey, awayKey].slice().sort();
      const tieKey = roundText.trim().toLowerCase() + "|" + pair.join("#");
      if (!ties.has(tieKey)) {
        ties.set(tieKey, {
          single: isSingleLegKnockoutRound(roundText),
          a: pair[0], b: pair[1], legs: []
        });
      }
      ties.get(tieKey).legs.push({
        homeKey, awayKey,
        isFinished,
        homeWinner: getFixtureSideWinner(fixture, "home"),
        awayWinner: getFixtureSideWinner(fixture, "away"),
        goals: getFixtureGoals(fixture)
      });
    });

    // Ligaphase komplett? Erst dann stehen die Ränge – und damit die
    // Ausscheider dahinter – zuverlässig fest.
    const leagueParticipants = Array.from(rows.values());
    const leaguePhaseComplete =
      leagueParticipants.length >= teamCount &&
      leagueParticipants.length > 0 &&
      leagueParticipants.every((r) => r.played >= matchesPerTeam);

    const eliminated = new Set();

    // Tabelle ranken (immer – nützlich für die spätere Analyse-Ansicht).
    const ranked = leagueParticipants.slice().sort(compareLeagueRows);
    ranked.forEach((row, idx) => {
      row.rank = idx + 1;
      row.name = names.get(row.key) || row.key;
      row.logo = logos.get(row.key) || "";
    });

    if (leaguePhaseComplete) {
      ranked.forEach((row) => {
        if (row.rank > playoffThrough) eliminated.add(row.key);
      });
    }

    // K.-o.-Verlierer ausscheiden lassen.
    ties.forEach((tie) => {
      const finishedLegs = tie.legs.filter((l) => l.isFinished);
      if (finishedLegs.length === 0) return;

      if (tie.single) {
        const loser = decideKnockoutLegLoser(finishedLegs[finishedLegs.length - 1]);
        if (loser) eliminated.add(loser);
        return;
      }

      // Hin/Rück: erst mit beiden beendeten Legs entscheiden.
      if (finishedLegs.length < 2) return;

      const agg = {};
      agg[tie.a] = 0; agg[tie.b] = 0;
      let goalsOk = true;
      finishedLegs.forEach((leg) => {
        const hg = leg.goals.home;
        const ag = leg.goals.away;
        if (!Number.isFinite(hg) || !Number.isFinite(ag)) { goalsOk = false; return; }
        agg[leg.homeKey] = (agg[leg.homeKey] || 0) + hg;
        agg[leg.awayKey] = (agg[leg.awayKey] || 0) + ag;
      });

      if (goalsOk && agg[tie.a] !== agg[tie.b]) {
        eliminated.add(agg[tie.a] < agg[tie.b] ? tie.a : tie.b);
        return;
      }

      // Gesamt-Gleichstand (oder Tore unklar) → Sieger-Flag des
      // entscheidenden Legs (Verlängerung/Elfmeter) heranziehen.
      for (const leg of finishedLegs) {
        if (leg.homeWinner === true) { eliminated.add(leg.awayKey); break; }
        if (leg.awayWinner === true) { eliminated.add(leg.homeKey); break; }
      }
    });

    const aliveKeys = new Set();
    participantKeys.forEach((key) => {
      if (!eliminated.has(key)) aliveKeys.add(key);
    });

    function isNationAlive(name) {
      const key = normalizeTournamentTeamName(name);
      if (!key) return true;
      return !eliminated.has(key);
    }

    function countActivePlayers(players, getEntity) {
      if (!Array.isArray(players)) return 0;
      const resolve = typeof getEntity === "function"
        ? getEntity
        : (p) => (p && (p.club || p.nation || p["Team.name"])) || "";
      return players.reduce((sum, p) => sum + (isNationAlive(resolve(p)) ? 1 : 0), 0);
    }

    return {
      structure: "league",
      knockoutStarted: knockoutPhaseReached || leaguePhaseComplete,
      leaguePhaseComplete,
      standings: ranked,
      aliveKeys,
      eliminatedKeys: eliminated,
      participantKeys,
      isNationAlive,
      countActivePlayers
    };
  }

  /* Dispatcher: wählt anhand von `structure` die passende Lebenszyklus-
   * Berechnung. Fehlt das Feld (WM 2026), gilt "groups" – der WM-Pfad
   * bleibt damit unverändert. */
  function computeTournamentStatus(fixtures, opts) {
    const structure = getActiveTournament().structure || "groups";
    if (structure === "league") return computeTournamentLeagueStatus(fixtures, opts);
    return computeTournamentNationStatus(fixtures);
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
   * Zeitgesteuerter Domain-Default.
   *
   * Turniere dürfen eine oder mehrere Domains (`defaultDomains`) ab einem
   * Stichtag (`defaultActiveFrom`) als Standard beanspruchen. So wechselt
   * z. B. dt.alae.app ab dem Auslosungsdatum automatisch von der WM auf
   * die CL, ohne dass das statische DOMAIN_TOURNAMENT_MAP angefasst wird.
   *
   * Es zählen ausschliesslich `available` Turniere. Von mehreren
   * zutreffenden gewinnt das mit dem jüngsten bereits erreichten
   * `defaultActiveFrom`. Liefert null, wenn (noch) keines greift – dann
   * gilt die bisherige Domain-/Fallback-Logik unverändert.
   *
   * DORMANT bis zur CL-Freischaltung: solange `cl2627` `available: false`
   * ist, liefert diese Funktion immer null und dt.alae.app bleibt bei der
   * WM – auch nach dem Stichtag.
   *
   * @param {string} [hostname]  Default: aktuelle Hostname.
   * @param {number} [nowMs]     Default: Date.now() (für Tests injizierbar).
   */
  function resolveScheduledDomainKey(hostname, nowMs) {
    const host = (hostname || currentHostname() || "").toLowerCase();
    if (!host) return null;
    const now = Number.isFinite(nowMs) ? nowMs : Date.now();

    let bestKey = null;
    let bestFrom = -Infinity;
    Object.keys(TOURNAMENTS).forEach((key) => {
      if (!isTournamentAvailable(key)) return;
      const t = TOURNAMENTS[key];
      const domains = Array.isArray(t.defaultDomains)
        ? t.defaultDomains.map((d) => String(d).toLowerCase())
        : [];
      if (domains.indexOf(host) === -1) return;
      const fromMs = t.defaultActiveFrom ? new Date(t.defaultActiveFrom).getTime() : NaN;
      if (!Number.isFinite(fromMs) || now < fromMs) return;
      if (fromMs > bestFrom) {
        bestFrom = fromMs;
        bestKey = key;
      }
    });
    return bestKey;
  }

  /**
   * Liefert das standardmässig zur aktuellen Domain gehörende Turnier
   * (ohne Berücksichtigung von URL- oder Dev-Override).
   *
   * Reihenfolge:
   *   1. Zeitgesteuerter Domain-Default (`defaultDomains` +
   *      `defaultActiveFrom`, siehe resolveScheduledDomainKey) – so
   *      wechselt z. B. dt.alae.app ab dem Auslosungsdatum automatisch
   *      auf die CL.
   *   2. Statisches Domain-Mapping (DOMAIN_TOURNAMENT_MAP).
   *   3. Globaler Fallback (FALLBACK_TOURNAMENT_KEY).
   */
  function resolveDomainDefaultKey() {
    const scheduled = resolveScheduledDomainKey();
    if (scheduled) return scheduled;
    const fromDomain = getDomainTournamentKey();
    if (fromDomain) return fromDomain;
    return FALLBACK_TOURNAMENT_KEY;
  }

  /* ─────────────────────────────────────────────────────────
   * Preview-Kanal (Admin-Vorschau nicht freigeschalteter Turniere).
   *
   * Damit ein Admin die CL VOR der offiziellen Freischaltung testen
   * kann, gibt es einen bewusst separaten „Preview"-Kanal:
   *   • `?preview=<key>` in der URL, ODER
   *   • ein host-spezifisch persistierter Preview-Override in
   *     localStorage (`dreamteam_preview_${hostname}`), gesetzt vom
   *     Admin-Switcher in nav.js.
   *
   * Dieser Kanal lädt ausdrücklich auch Turniere mit `available: false`
   * (sofern sie eine `data-<key>.js` deklarieren). Er ist WISSENS-
   * basiert: normale Nutzer kennen den geheimen Parameter nicht und
   * landen daher nie im Preview. Der Admin-Switcher blendet die
   * Vorschau-Option zusätzlich nur für eingeloggte Admins ein. Echter
   * Schutz (Firestore-Schreibzugriffe) liegt weiterhin in den
   * Firestore Rules – hier geht es rein um die angezeigte Datensicht.
   * ───────────────────────────────────────────────────────── */
  function previewOverrideStorageKey(hostname) {
    const host = (hostname || currentHostname() || "unknown").toLowerCase();
    return `dreamteam_preview_${host}`;
  }

  function readUrlPreviewKey() {
    try {
      if (typeof window === "undefined" || !window.location) return null;
      const params = new URLSearchParams(window.location.search);
      const value = params.get("preview");
      return value ? value.trim().toLowerCase() : null;
    } catch (err) {
      return null;
    }
  }

  function readPreviewOverride() {
    try {
      if (typeof window === "undefined" || !window.localStorage) return null;
      const value = window.localStorage.getItem(previewOverrideStorageKey());
      return value ? value.trim().toLowerCase() : null;
    } catch (err) {
      return null;
    }
  }

  function persistPreviewOverride(key) {
    try {
      if (typeof window === "undefined" || !window.localStorage) return;
      window.localStorage.setItem(previewOverrideStorageKey(), key);
    } catch (err) {
      // Storage evtl. blockiert – kein Hard-Fail.
    }
  }

  function clearPreviewOverride() {
    try {
      if (typeof window === "undefined" || !window.localStorage) return;
      window.localStorage.removeItem(previewOverrideStorageKey());
    } catch (err) {
      // ignore
    }
  }

  /* ─────────────────────────────────────────────────────────
   * Vorschau-ABSICHT (Session-scoped).
   *
   * Unterscheidet, ob die aktive Vorschau in DIESER Browser-Session
   * BEWUSST aktiviert wurde (Switcher-Klick oder `?preview=` in der URL)
   * oder ob sie nur ein aus einer FRÜHEREN Session in localStorage
   * hängengebliebener Rest ist.
   *
   * Wichtig für die Selbstheilung (recoverFromBrokenPreview): eine
   * bewusst aktivierte Vorschau bleibt bestehen (der Admin will sie
   * sehen, auch wenn Daten fehlen) – eine still persistierte, nicht mehr
   * ladbare Vorschau darf die Produktiv-Domain hingegen NICHT blockieren
   * und fällt automatisch auf das Standard-Turnier (WM) zurück.
   *
   * sessionStorage (überlebt den Reload, nicht aber das Schliessen des
   * Tabs) plus ein Speicher-Fallback für Node/Tests, wo kein window
   * existiert.
   * ───────────────────────────────────────────────────────── */
  const PREVIEW_INTENT_SESSION_KEY = "dreamteam_preview_intent";
  let previewIntentKeyMem = null;

  function readPreviewIntent() {
    try {
      if (typeof window !== "undefined" && window.sessionStorage) {
        const value = window.sessionStorage.getItem(PREVIEW_INTENT_SESSION_KEY);
        if (value) return value.trim().toLowerCase();
      }
    } catch (err) {
      // sessionStorage evtl. blockiert – Fallback nutzen.
    }
    return previewIntentKeyMem;
  }

  function writePreviewIntent(key) {
    previewIntentKeyMem = key ? String(key).toLowerCase() : null;
    try {
      if (typeof window === "undefined" || !window.sessionStorage) return;
      if (previewIntentKeyMem) {
        window.sessionStorage.setItem(PREVIEW_INTENT_SESSION_KEY, previewIntentKeyMem);
      } else {
        window.sessionStorage.removeItem(PREVIEW_INTENT_SESSION_KEY);
      }
    } catch (err) {
      // ignore – Speicher-Fallback (previewIntentKeyMem) reicht.
    }
  }

  /**
   * Ist ein Turnier als VORSCHAU ladbar? Genau dann, wenn es existiert,
   * (noch) nicht regulär verfügbar ist (`available`/`dataReady`) und eine
   * `data-<key>.js` deklariert. Bereits verfügbare Turniere brauchen
   * keine Vorschau und sind hier bewusst ausgeschlossen.
   */
  function isTournamentPreviewable(key) {
    const t = key ? TOURNAMENTS[key] : null;
    if (!t) return false;
    if (isTournamentAvailable(key)) return false;
    return typeof t.dataFile === "string" && t.dataFile.length > 0;
  }

  function getPreviewableTournamentKeys() {
    return Object.keys(TOURNAMENTS).filter(isTournamentPreviewable);
  }

  /**
   * Ist ein Turnier tatsächlich LADBAR (Kaderdatei etc.)? Regulär
   * verfügbare Turniere immer; ein nicht freigeschaltetes Turnier nur,
   * wenn es gerade das aktive Preview-Turnier ist. data.js nutzt dies,
   * um im Preview die richtige data-<key>.js zu laden statt auf wm2026
   * zurückzufallen.
   */
  function isTournamentLoadable(key) {
    if (isTournamentAvailable(key)) return true;
    if (key && key === ACTIVE_PREVIEW_KEY && isTournamentPreviewable(key)) return true;
    return false;
  }

  // Neuladen mit bereinigter URL (entfernt volatile ?tournament=/?preview=,
  // da die Auswahl nun persistiert ist).
  function reloadWithCleanUrl() {
    try {
      const url = new URL(window.location.href);
      url.searchParams.delete(URL_PARAM_NAME);
      url.searchParams.delete("preview");
      window.location.replace(url.toString());
    } catch (err) {
      window.location.reload();
    }
  }

  /**
   * Vorschau für ein nicht freigeschaltetes Turnier aktivieren
   * (Admin-Switcher). Persistiert host-spezifisch und lädt neu.
   */
  function setPreviewTournament(key, options) {
    const opts = options || {};
    const normalized = (key || "").toLowerCase();
    if (!isTournamentPreviewable(normalized)) {
      console.warn(`[APP_CONFIG] Turnier "${key}" ist nicht als Vorschau verfügbar.`);
      return false;
    }
    // Ein evtl. bestehender regulärer Dev-Override würde sonst mit dem
    // Preview konkurrieren – Preview gewinnt, also Dev-Override räumen.
    clearDevOverride();
    persistPreviewOverride(normalized);
    // BEWUSSTE Aktivierung: markiert die Vorschau als gewollt, damit die
    // Selbstheilung sie nicht sofort wieder auf die WM zurückwirft.
    writePreviewIntent(normalized);

    if (opts.reload === false) {
      ACTIVE_PREVIEW_KEY = normalized;
      ACTIVE_TOURNAMENT_KEY = normalized;
      return true;
    }
    reloadWithCleanUrl();
    return true;
  }

  /**
   * Vorschau beenden und auf die normale Auflösung (Domain-Default)
   * zurückkehren.
   */
  function clearPreview(options) {
    const opts = options || {};
    clearPreviewOverride();
    writePreviewIntent(null);
    if (opts.reload === false) {
      ACTIVE_PREVIEW_KEY = null;
      ACTIVE_TOURNAMENT_KEY = resolveDomainDefaultKey();
      return true;
    }
    reloadWithCleanUrl();
    return true;
  }

  function isPreviewActive() {
    return !!ACTIVE_PREVIEW_KEY;
  }

  /**
   * Selbstheilung gegen eine „hängende" Admin-Vorschau.
   *
   * Wenn die aktive Ansicht eine (still aus einer früheren Session
   * persistierte) Vorschau ist und deren Daten nicht geladen werden können,
   * darf sie die Produktiv-Domain NICHT stumm blockieren – sonst wirkt die
   * Seite für den Admin „kaputt". In diesem Fall wird die Vorschau-Persistenz
   * entfernt und auf das reguläre Standard-Turnier der Domain (z. B. WM 2026)
   * zurückgesetzt.
   *
   * Bewusst NICHT zurückgesetzt wird eine in DIESER Session absichtlich
   * aktivierte Vorschau (Switcher/`?preview=`): Der Admin will sie sehen,
   * auch wenn (noch) Daten fehlen – dort greift stattdessen der sichtbare
   * Vorschau-Hinweis mit 1-Klick-Ausstieg (siehe nav.js).
   *
   * Reine Zustands-/Reload-Logik. Die WM ist nie betroffen: Ist keine
   * Vorschau aktiv, ist dies ein No-op und liefert false.
   *
   * @param {object} [options]  options.reload === false → nur Zustand ändern
   *                            (für Tests), sonst Reload auf bereinigte URL.
   * @returns {boolean} true, wenn eine kaputte Vorschau zurückgesetzt wurde.
   */
  function recoverFromBrokenPreview(options) {
    const opts = options || {};
    if (!ACTIVE_PREVIEW_KEY) return false;            // keine Vorschau → WM/Default unberührt
    const key = ACTIVE_PREVIEW_KEY;
    // Bewusst aktivierte Vorschau: bestehen lassen (kein Auto-Rückfall,
    // kein Reload-Loop). Der sichtbare Hinweis-Banner übernimmt die UX.
    if (readPreviewIntent() === key) return false;

    clearPreviewOverride();
    writePreviewIntent(null);

    if (opts.reload === false) {
      ACTIVE_PREVIEW_KEY = null;
      ACTIVE_TOURNAMENT_KEY = resolveDomainDefaultKey();
      return true;
    }

    try {
      console.warn(
        `[APP_CONFIG] Vorschau "${key}" konnte nicht laden – automatischer ` +
        `Rückfall auf das Standard-Turnier (${resolveDomainDefaultKey()}).`
      );
    } catch (_) { /* ignore */ }
    reloadWithCleanUrl();
    return true;
  }

  /**
   * Zentrale Auflösung des aktiven Turnier-Keys.
   * Reihenfolge: Preview > URL > host-spezifischer Dev-Override > Domain
   * > Fallback. Reguläre Kanäle akzeptieren ausschliesslich verfügbare
   * Turniere (siehe `isTournamentAvailable`); nur der Preview-Kanal lädt
   * bewusst auch gesperrte Turniere.
   */
  function resolveTournamentKey() {
    cleanupLegacyKeys();

    // 0) Preview-Kanal (nur explizit via ?preview= oder persistierter
    //    Preview-Override). Lädt bewusst auch (noch) nicht freigeschaltete
    //    Turniere – siehe Kommentar oben.
    const fromUrlPreview = readUrlPreviewKey();
    if (fromUrlPreview && isTournamentPreviewable(fromUrlPreview)) {
      persistPreviewOverride(fromUrlPreview);
      // Explizit via URL angefordert = bewusste Absicht → nicht auto-heilen.
      writePreviewIntent(fromUrlPreview);
      ACTIVE_PREVIEW_KEY = fromUrlPreview;
      return fromUrlPreview;
    }
    const persistedPreview = readPreviewOverride();
    if (persistedPreview && isTournamentPreviewable(persistedPreview)) {
      ACTIVE_PREVIEW_KEY = persistedPreview;
      return persistedPreview;
    }
    // Veralteter Preview (Turnier inzwischen regulär verfügbar oder
    // entfernt) → aufräumen und regulär auflösen.
    if (persistedPreview) {
      clearPreviewOverride();
    }
    ACTIVE_PREVIEW_KEY = null;

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

  // Aktiver Vorschau-Key (Preview-Kanal, siehe resolveTournamentKey).
  // Wird gesetzt, wenn ein Admin ein (noch) nicht freigeschaltetes
  // Turnier via geheimem `?preview=<key>` bzw. persistiertem Preview-
  // Override betrachtet. isTournamentLoadable() und data.js
  // berücksichtigen ihn, damit die passende data-<key>.js geladen wird.
  let ACTIVE_PREVIEW_KEY = null;

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
   * Punkteregeln & Labels.
   *
   * Dies sind die eingefrorenen DEFAULT-Werte und entsprechen exakt
   * dem Regelwerk der WM 2026. Ein einzelner Turnier-Block in
   * TOURNAMENTS darf `rules` / `ruleLabels` überschreiben (z. B. die
   * Champions League mit einem eigenen Punktesystem); fehlt die
   * Überschreibung, gelten diese Defaults.
   *
   * Die WM 2026 nutzt bewusst KEINE eigene Überschreibung und bleibt
   * damit fest an diese Werte gebunden. Ein Freeze-Test stellt sicher,
   * dass sie sich nicht mehr ändern (siehe
   * scripts/test-wm2026-freeze.js).
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
    DEF_BASE_PTS: "Defensiv-Basis"
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

    const db = window.firebase.firestore();

    if (
      ENABLE_FIRESTORE_PERSISTENCE &&
      !firestorePersistenceAttempted &&
      db &&
      typeof db.enablePersistence === "function"
    ) {
      firestorePersistenceAttempted = true;
      db.enablePersistence({ synchronizeTabs: true }).catch((err) => {
        console.warn("[APP_CONFIG] Firestore Offline Persistence konnte nicht aktiviert werden:", err);
      });
    }

    return db;
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

    // In ein reguläres Turnier wechseln beendet eine evtl. aktive Vorschau.
    clearPreviewOverride();

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
    clearPreviewOverride();
    writePreviewIntent(null);

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

    // Preview-Kanal (Admin-Vorschau nicht freigeschalteter Turniere).
    isTournamentPreviewable,
    isTournamentLoadable,
    getPreviewableTournamentKeys,
    setPreviewTournament,
    clearPreview,
    isPreviewActive,
    recoverFromBrokenPreview,

    get previewableTournamentKeys() {
      return getPreviewableTournamentKeys();
    },

    get activePreviewKey() {
      return ACTIVE_PREVIEW_KEY;
    },

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
    resolveScheduledDomainKey,
    getDomainTournamentKey,
    resetToDomainDefault,
    clearDevOverride,

    get key() {
      return getActiveTournament().key;
    },

    // Primäre Anzeige-Entität des aktiven Turniers: "club" (CL) oder
    // "nation" (WM, Default). Steuert den Club-Remap in data.js.
    get primaryEntity() {
      var pe = getActiveTournament().primaryEntity;
      return pe === "club" ? "club" : "nation";
    },

    // Captain-Feature: WM nutzt einen Captain (×2), die CL bewusst NICHT.
    // Default true; nur wenn ein Turnier `captainEnabled: false` setzt, ist
    // die Captain-Wahl (und der ×2-Multiplikator) deaktiviert.
    get captainEnabled() {
      return getActiveTournament().captainEnabled !== false;
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

    // Optionaler Saison-Zusatz (z. B. „2025/2026") – nur Turniere, die ihn
    // setzen (aktuell die CL). Leerstring, wenn nicht vorhanden.
    get seasonLabel() {
      return getActiveTournament().seasonLabel || "";
    },

    // Ist dieses Fixture ein Qualifikationsspiel, das in den Spiel-Ansichten
    // ausgeblendet werden soll? Nur für Ligaphasen-Turniere (CL) aktiv; die
    // WM (structure ≠ "league") liefert immer false → unverändert.
    isQualificationFixture(fixtureOrRound) {
      const t = getActiveTournament();
      if (!t || t.structure !== "league") return false;
      const round = typeof fixtureOrRound === "string"
        ? fixtureOrRound
        : (fixtureOrRound && ((fixtureOrRound.league && fixtureOrRound.league.round) || fixtureOrRound.round)) || "";
      return isQualificationRound(round);
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

    get fixtureCount() {
      return getActiveTournament().fixtureCount || null;
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

    normalizeTeamName(value) {
      return normalizeTournamentTeamName(value);
    },

    /**
     * Liefert den Lebenszyklus-Status der Teilnehmer anhand der
     * Fixture-Sammlung. Dispatcht nach `structure`:
     *   • "groups" (WM 2026) → Nationen-Status (computeTournamentNationStatus)
     *   • "league"  (CL)     → Klub-/Ligaphasen-Status (computeTournamentLeagueStatus)
     * Rückgabe ist in beiden Fällen kompatibel (isNationAlive(name),
     * countActivePlayers(players, getEntity), aliveKeys, …).
     */
    getTournamentStatus(fixtures) {
      return computeTournamentStatus(fixtures);
    },

    // Rückwärtskompatibler Alias – bestehende WM-Views rufen dies auf.
    getNationStatus(fixtures) {
      return computeTournamentStatus(fixtures);
    },

    // Direktzugriff auf die Ligaphasen-Berechnung (Tests / spätere
    // CL-Views). `opts.leaguePhase` überschreibt die Turnier-Parameter.
    computeLeagueStatus(fixtures, opts) {
      return computeTournamentLeagueStatus(fixtures, opts);
    },

    firebaseConfig,

    /* Punkteregeln & Labels des AKTIVEN Turniers.
     *
     * Ein Turnier-Block darf eigene `rules` / `ruleLabels` mitbringen;
     * fehlen sie, gelten die eingefrorenen Defaults oben (= WM 2026).
     * Dadurch bleibt die WM unverändert, selbst wenn ein anderes
     * Turnier (z. B. CL) später ein eigenes Punktesystem definiert.
     * Getter statt statischer Referenz, damit die Auflösung immer dem
     * aktiven Turnier folgt – analog zu allen anderen turnier-
     * spezifischen Werten in diesem Objekt. */
    get rules() {
      const t = getActiveTournament();
      return (t && t.rules) || rules;
    },

    get ruleLabels() {
      const t = getActiveTournament();
      return (t && t.ruleLabels) || ruleLabels;
    },

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

  /* Turnier-/Theme-Hook.
   *
   * 1) Aktives Turnier als `data-tournament` am <html>-Element hinterlegen,
   *    damit turnierspezifisches CSS darauf targeten kann.
   * 2) Falls das aktive Turnier ein `theme` hat (nur CL), dessen Tokens als
   *    CSS-Variablen (`--cl-*`) injizieren und das theme-cl.css laden.
   *
   * Für die WM 2026 rein additiv/inert: sie hat KEIN `theme`, also wird
   * weder CSS injiziert noch theme-cl.css geladen – das Aussehen bleibt
   * unverändert. CL-eigene Seiten (spätere View-Dateien) können denselben
   * Hook früh im <head> nachbilden, um ein Aufblitzen zu vermeiden. */
  try {
    if (typeof document !== "undefined" && document.documentElement) {
      var __docEl = document.documentElement;
      var __key = APP_CONFIG.activeTournamentKey;
      __docEl.setAttribute("data-tournament", __key);

      var __theme = APP_CONFIG.activeTournament && APP_CONFIG.activeTournament.theme;
      if (__theme && typeof __theme === "object") {
        var __head = document.head || __docEl;

        // (1) Theme-Tokens als CSS-Variablen auf dem aktiven Turnier-Scope.
        if (!document.getElementById("cl-theme-vars")) {
          var __map = {
            primary: "--cl-primary",
            accent: "--cl-accent",
            background: "--cl-background",
            surface: "--cl-surface",
            surfaceAlt: "--cl-surface-alt",
            text: "--cl-text",
            textMuted: "--cl-text-muted",
            navGradient: "--cl-nav-gradient"
          };
          var __css = ':root[data-tournament="' + __key + '"]{';
          for (var __k in __map) {
            if (__theme[__k]) __css += __map[__k] + ":" + __theme[__k] + ";";
          }
          __css += "}";
          var __style = document.createElement("style");
          __style.id = "cl-theme-vars";
          __style.textContent = __css;
          __head.appendChild(__style);
        }

        // (2) CL-Stylesheet (scoped auf [data-tournament^="cl"]) laden.
        if (!document.getElementById("cl-theme-css")) {
          var __link = document.createElement("link");
          __link.id = "cl-theme-css";
          __link.rel = "stylesheet";
          __link.href = "theme-cl.css";
          __head.appendChild(__link);
        }

        // (3) Browser-/Statusleisten-Farbe (theme-color) auf die Turnier-
        //     Hintergrundfarbe setzen – sonst bliebe die (grüne) WM-Farbe
        //     aus dem statischen <meta> stehen. Nur für Turniere MIT Theme.
        if (__theme.background) {
          var __tc = document.querySelector('meta[name="theme-color"]');
          if (!__tc) {
            __tc = document.createElement("meta");
            __tc.setAttribute("name", "theme-color");
            __head.appendChild(__tc);
          }
          __tc.setAttribute("content", __theme.background);
        }
      }
    }
  } catch (_) { /* DOM nicht verfügbar – ignorieren */ }
}
if (typeof module !== "undefined" && module.exports) {
  module.exports = APP_CONFIG;
}
