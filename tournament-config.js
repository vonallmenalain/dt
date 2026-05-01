window.APP_CONFIG = (() => {
  const TOURNAMENTS = {
    wm2022: {
      key: "wm2022",
      type: "WM",
      year: "2022",
      name: "Weltmeisterschaft 2022",
      shortLabel: "WM 2022",
      brandName: "DreamTeam WM 2022",
      pageTitlePrefix: "WM 2022 DreamTeam",
      dataFile: "data.js",
      api: {
        competitionParam: "league",
        competitionId: 1,
        season: "2022"
      }
    },

    em2024: {
      key: "em2024",
      type: "EM",
      year: "2024",
      name: "Europameisterschaft 2024",
      shortLabel: "EM 2024",
      brandName: "DreamTeam EM 2024",
      pageTitlePrefix: "EM 2024 DreamTeam",
      dataFile: "data.js",
      api: {
        competitionParam: "league",
        competitionId: 4,
        season: "2024"
      }
    },

    wm2026: {
      key: "wm2026",
      type: "WM",
      year: "2026",
      name: "Weltmeisterschaft 2026",
      shortLabel: "WM 2026",
      brandName: "DreamTeam WM 2026",
      pageTitlePrefix: "WM 2026 DreamTeam",
      dataFile: "data.js",
      api: {
        competitionParam: "league",
        competitionId: 1,
        season: "2026"
      }
    },

    em2028: {
      key: "em2028",
      type: "EM",
      year: "2028",
      name: "Europameisterschaft 2028",
      shortLabel: "EM 2028",
      brandName: "DreamTeam EM 2028",
      pageTitlePrefix: "EM 2028 DreamTeam",
      dataFile: "data.js",
      api: {
        competitionParam: "league",
        competitionId: 4,
        season: "2028"
      }
    },

    wm2030: {
      key: "wm2030",
      type: "WM",
      year: "2030",
      name: "Weltmeisterschaft 2030",
      shortLabel: "WM 2030",
      brandName: "DreamTeam WM 2030",
      pageTitlePrefix: "WM 2030 DreamTeam",
      dataFile: "data.js",
      api: {
        competitionParam: "league",
        competitionId: 1,
        season: "2030"
      }
    }
  };

  const ACTIVE_TOURNAMENT_KEY = "em2024";

  // ─────────────────────────────────────────────────────────
  // DREAMTEAM SPIELSTART – Umschaltzeitpunkt Pre/Post-Start
  // EM 2024: Eröffnungsspiel am 14. Juni 2024, 21:00 Uhr Schweizer Zeit
  // Zeitzone: Europe/Zurich (CEST = UTC+2 im Sommer)
  // Zum Ändern: Datum & Uhrzeit hier anpassen.
  // ─────────────────────────────────────────────────────────
  const DREAMTEAM_START = new Date("2024-06-14T21:00:00+02:00");

  const firebaseConfig = {
    apiKey: "AIzaSyAOrgxmb_NZM1H_HZpMG1XfK9azDgV2zCQ",
    authDomain: "dreamteam-d2121.firebaseapp.com",
    projectId: "dreamteam-d2121",
    storageBucket: "dreamteam-d2121.firebasestorage.app",
    messagingSenderId: "1044159021561",
    appId: "1:1044159021561:web:89c88336b707ab1f4dbd28"
  };

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
      throw new Error(`Unbekanntes Turnier: ${ACTIVE_TOURNAMENT_KEY}`);
    }
    return tournament;
  }

  function requireCompetitionId() {
    const tournament = getActiveTournament();
    const id = tournament.api?.competitionId;

    if (id === null || id === undefined || id === "") {
      throw new Error(`Für ${tournament.shortLabel} ist noch keine API competitionId gesetzt.`);
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

  return {
    tournaments: TOURNAMENTS,
    activeTournamentKey: ACTIVE_TOURNAMENT_KEY,

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

    get brandName() {
      return getActiveTournament().brandName;
    },

    get pageTitlePrefix() {
      return getActiveTournament().pageTitlePrefix;
    },

    get tournamentLabel() {
      return getActiveTournament().shortLabel;
    },

    firebaseConfig,
    rules,
    ruleLabels,
    DREAMTEAM_START,

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
        const id = getActiveTournament().api?.competitionId;
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
      }
    },

    firestore: {
      metaCollection: "app_meta",

      metaDocId() {
        return `turnier_${getActiveTournament().key}`;
      },

      teamsCollection() {
        return `Teams ${getActiveTournament().shortLabel}`;
      },

      pointsCollection() {
        return `Punkte Spieler ${getActiveTournament().shortLabel}`;
      }
    },

    storage: {
      appPrefix() {
        return `dreamteam_${getActiveTournament().key}`;
      },

      key(name) {
        return `${this.appPrefix()}_${name}`;
      },

      builderCacheKey() {
        return this.key("builder_cache");
      }
    },

    data: {
      mode: "single-current-file",
      currentFile: "data.js",

      fileName() {
        return this.currentFile;
      }
    },

    getDb
  };
})();