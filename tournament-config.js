/* =============================================================================
 *  tournament-config.js
 *
 *  Zentrale Steuerung für die DreamTeam-App im Multi-Tournament-Modus.
 *  Definiert alle turnierspezifischen Werte (Labels, Daten-Dateien, API-Werte,
 *  Firestore-Collections, LocalStorage-/Cache-Prefixes, Spielstartzeitpunkt,
 *  Fallback-Spiele) an EINEM Ort.
 *
 *  Aktives Turnier wird in dieser Reihenfolge bestimmt:
 *    1. URL-Parameter ?tournament=em2024|wm2026|...
 *    2. Dev-Auswahl in localStorage (`dreamteam_active_tournament`)
 *    3. Default (`wm2026`)
 *
 *  Ungültige Werte fallen sicher auf das Default-Turnier zurück.
 * ============================================================================= */

window.APP_CONFIG = (() => {
  const DEFAULT_TOURNAMENT_KEY = "wm2026";
  const ACTIVE_TOURNAMENT_STORAGE_KEY = "dreamteam_active_tournament";
  const URL_PARAM_NAME = "tournament";

  /* ─────────────────────────────────────────────────────────
   * Fallback-Spiele pro Turnier (für leere Datenstände / Dev).
   * Echte Spiele aus Firestore haben Vorrang.
   * ───────────────────────────────────────────────────────── */
  const FALLBACK_FIXTURES_EM2024 = [
    {
      id: "em2024_test_1",
      teamA: "Germany",
      homeLogo: "https://media.api-sports.io/football/teams/25.png",
      teamB: "Scotland",
      awayLogo: "https://media.api-sports.io/football/teams/1108.png",
      date: "2024-06-14T21:00:00+02:00",
      venue: "Allianz Arena",
      venueCity: "München",
      statusShort: "NS"
    },
    {
      id: "em2024_test_2",
      teamA: "Hungary",
      homeLogo: "https://media.api-sports.io/football/teams/769.png",
      teamB: "Switzerland",
      awayLogo: "https://media.api-sports.io/football/teams/15.png",
      date: "2024-06-15T15:00:00+02:00",
      venue: "RheinEnergieStadion",
      venueCity: "Köln",
      statusShort: "NS"
    },
    {
      id: "em2024_test_3",
      teamA: "Spain",
      homeLogo: "https://media.api-sports.io/football/teams/9.png",
      teamB: "Croatia",
      awayLogo: "https://media.api-sports.io/football/teams/3.png",
      date: "2024-06-15T18:00:00+02:00",
      venue: "Olympiastadion",
      venueCity: "Berlin",
      statusShort: "NS"
    }
  ];

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

  /* ─────────────────────────────────────────────────────────
   * Definition aller bekannten Turniere
   * ───────────────────────────────────────────────────────── */
  const TOURNAMENTS = {
    wm2022: {
      key: "wm2022",
      type: "WM",
      year: "2022",
      name: "Weltmeisterschaft 2022",
      shortLabel: "WM 2022",
      longLabel: "FIFA World Cup 2022",
      brandName: "DreamTeam WM 2022",
      pageTitlePrefix: "WM 2022 DreamTeam",
      competitionName: "FIFA World Cup",
      timezone: "Europe/Zurich",
      // Spielstart laut alter Konfiguration: WM 2022 begann am 20.11.2022.
      DREAMTEAM_START: "2022-11-20T17:00:00+01:00",
      storagePrefix: "dreamteam_wm2022",
      cachePrefix: "dreamteam-wm2022",
      dataFile: "data-wm2022.js",
      api: {
        competitionParam: "league",
        competitionId: 1,
        season: "2022"
      },
      firestore: {
        metaCollection: "app_meta",
        metaDocId: "turnier_wm2022",
        teamsCollection: "Teams WM 2022",
        pointsCollection: "Punkte Spieler WM 2022",
        fixturesCollection: "Spiele WM 2022"
      },
      fallbackFixtures: []
    },

    em2024: {
      key: "em2024",
      type: "EM",
      year: "2024",
      name: "Europameisterschaft 2024",
      shortLabel: "EM 2024",
      longLabel: "UEFA Euro 2024",
      brandName: "DreamTeam EM 2024",
      pageTitlePrefix: "EM 2024 DreamTeam",
      competitionName: "UEFA Euro",
      timezone: "Europe/Zurich",
      DREAMTEAM_START: "2024-06-14T21:00:00+02:00",
      storagePrefix: "dreamteam_em2024",
      cachePrefix: "dreamteam-em2024",
      dataFile: "data-em2024.js",
      api: {
        competitionParam: "league",
        competitionId: 4,
        season: "2024"
      },
      firestore: {
        metaCollection: "app_meta",
        metaDocId: "turnier_em2024",
        teamsCollection: "Teams EM 2024",
        pointsCollection: "Punkte Spieler EM 2024",
        fixturesCollection: "Spiele EM 2024"
      },
      fallbackFixtures: FALLBACK_FIXTURES_EM2024
    },

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
      DREAMTEAM_START: "2026-06-11T21:00:00+02:00",
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
      fallbackFixtures: FALLBACK_FIXTURES_WM2026
    },

    em2028: {
      key: "em2028",
      type: "EM",
      year: "2028",
      name: "Europameisterschaft 2028",
      shortLabel: "EM 2028",
      longLabel: "UEFA Euro 2028",
      brandName: "DreamTeam EM 2028",
      pageTitlePrefix: "EM 2028 DreamTeam",
      competitionName: "UEFA Euro",
      timezone: "Europe/Zurich",
      DREAMTEAM_START: "2028-06-09T21:00:00+02:00",
      storagePrefix: "dreamteam_em2028",
      cachePrefix: "dreamteam-em2028",
      dataFile: "data-em2028.js",
      api: {
        competitionParam: "league",
        competitionId: 4,
        season: "2028"
      },
      firestore: {
        metaCollection: "app_meta",
        metaDocId: "turnier_em2028",
        teamsCollection: "Teams EM 2028",
        pointsCollection: "Punkte Spieler EM 2028",
        fixturesCollection: "Spiele EM 2028"
      },
      fallbackFixtures: []
    },

    wm2030: {
      key: "wm2030",
      type: "WM",
      year: "2030",
      name: "Weltmeisterschaft 2030",
      shortLabel: "WM 2030",
      longLabel: "FIFA World Cup 2030",
      brandName: "DreamTeam WM 2030",
      pageTitlePrefix: "WM 2030 DreamTeam",
      competitionName: "FIFA World Cup",
      timezone: "Europe/Zurich",
      DREAMTEAM_START: "2030-06-08T21:00:00+02:00",
      storagePrefix: "dreamteam_wm2030",
      cachePrefix: "dreamteam-wm2030",
      dataFile: "data-wm2030.js",
      api: {
        competitionParam: "league",
        competitionId: 1,
        season: "2030"
      },
      firestore: {
        metaCollection: "app_meta",
        metaDocId: "turnier_wm2030",
        teamsCollection: "Teams WM 2030",
        pointsCollection: "Punkte Spieler WM 2030",
        fixturesCollection: "Spiele WM 2030"
      },
      fallbackFixtures: []
    }
  };

  /* ─────────────────────────────────────────────────────────
   * Aktives Turnier robust auflösen.
   * Reihenfolge: URL-Parameter > LocalStorage > Default.
   * Ungültige Werte werden ignoriert.
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

  function readStoredTournamentKey() {
    try {
      if (typeof window === "undefined" || !window.localStorage) return null;
      const value = window.localStorage.getItem(ACTIVE_TOURNAMENT_STORAGE_KEY);
      return value ? value.trim().toLowerCase() : null;
    } catch (err) {
      return null;
    }
  }

  function persistTournamentKey(key) {
    try {
      if (typeof window === "undefined" || !window.localStorage) return;
      window.localStorage.setItem(ACTIVE_TOURNAMENT_STORAGE_KEY, key);
    } catch (err) {
      // Storage kann in Privacy-Modi blockiert sein – kein Hard-Fail.
    }
  }

  function resolveActiveTournamentKey() {
    const fromUrl = readUrlTournamentKey();
    if (fromUrl && TOURNAMENTS[fromUrl]) {
      // URL-Auswahl persistieren, damit nachfolgende Seitenaufrufe
      // konsistent dasselbe Turnier zeigen.
      persistTournamentKey(fromUrl);
      return fromUrl;
    }

    const fromStorage = readStoredTournamentKey();
    if (fromStorage && TOURNAMENTS[fromStorage]) {
      return fromStorage;
    }

    return DEFAULT_TOURNAMENT_KEY;
  }

  let ACTIVE_TOURNAMENT_KEY = resolveActiveTournamentKey();

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
      return TOURNAMENTS[DEFAULT_TOURNAMENT_KEY];
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
   * Dev-Switch: Aktives Turnier wechseln.
   * Speichert Auswahl in localStorage und lädt die Seite neu.
   * Optional kann zusätzlich der URL-Parameter aktualisiert werden.
   * ───────────────────────────────────────────────────────── */
  function setActiveTournament(key, options) {
    const opts = options || {};
    const normalized = (key || "").toLowerCase();

    if (!TOURNAMENTS[normalized]) {
      console.warn(`[APP_CONFIG] Unbekanntes Turnier: ${key}`);
      return false;
    }

    persistTournamentKey(normalized);

    if (opts.reload === false) {
      ACTIVE_TOURNAMENT_KEY = normalized;
      return true;
    }

    try {
      const url = new URL(window.location.href);
      if (opts.updateUrl !== false) {
        url.searchParams.set(URL_PARAM_NAME, normalized);
      }
      window.location.replace(url.toString());
    } catch (err) {
      window.location.reload();
    }

    return true;
  }

  return {
    tournaments: TOURNAMENTS,

    get activeTournamentKey() {
      return ACTIVE_TOURNAMENT_KEY;
    },

    get activeTournament() {
      return getActiveTournament();
    },

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

    get fallbackFixtures() {
      const list = getActiveTournament().fallbackFixtures;
      return Array.isArray(list) ? list : [];
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
      activeTournamentKey: ACTIVE_TOURNAMENT_STORAGE_KEY,

      appPrefix() {
        return getActiveTournament().storagePrefix || `dreamteam_${getActiveTournament().key}`;
      },

      key(name) {
        return `${this.appPrefix()}_${name}`;
      },

      builderCacheKey() {
        return this.key("builder_cache");
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
