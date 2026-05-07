/* =============================================================================
 *  tournament-config.js
 *
 *  Zentrale Steuerung für die DreamTeam-App im Multi-Tournament-Modus.
 *  Definiert alle turnierspezifischen Werte (Labels, Daten-Dateien, API-Werte,
 *  Firestore-Collections, LocalStorage-/Cache-Prefixes, Spielstartzeitpunkt,
 *  Fallback-Spiele) an EINEM Ort.
 *
 *  Domain-Mapping (Standard pro Netlify-Site / Domain):
 *    - em24dt.alae.app  →  em2024 (EM 2024 DreamTeam)
 *    - dt.alae.app      →  wm2026 (WM 2026 DreamTeam)
 *    - localhost / 127.0.0.1 / Deploy Previews / unbekannte Hosts
 *      →  Fallback (`wm2026`)
 *
 *  Aktives Turnier wird in dieser Reihenfolge bestimmt:
 *    1. URL-Parameter ?tournament=em2024|wm2026|...   (Test-Override, nicht
 *       persistent – wirkt nur auf den aktuellen Seitenaufruf)
 *    2. Host-spezifischer Dev-Override aus localStorage
 *       (`dreamteam_dev_override_${hostname}`)
 *    3. Domain-Mapping (DOMAIN_TOURNAMENT_MAP)
 *    4. Genereller Fallback (`wm2026`)
 *
 *  Ungültige Werte fallen sicher auf das Default-Turnier zurück.
 *
 *  Wichtig: Damit dieselbe Codebasis auf mehreren Netlify-Domains
 *  unterschiedliche Turniere ausspielen kann, gibt es bewusst KEINEN
 *  globalen Default ausserhalb dieser Datei. Jede andere Stelle muss
 *  `APP_CONFIG.activeTournamentKey` / `APP_CONFIG.activeTournament`
 *  abfragen, statt selbst hart "em2024" oder "wm2026" zu wählen.
 * ============================================================================= */

window.APP_CONFIG = (() => {
  // Ultimativer Fallback, falls keine Domain-Zuordnung greift (z. B. lokal
  // oder auf Deploy-Previews). Bewusst nur an dieser einen Stelle hart
  // gesetzt – alle anderen Module sollen den aktiven Key konsumieren.
  const FALLBACK_TOURNAMENT_KEY = "wm2026";

  const URL_PARAM_NAME = "tournament";

  /* ─────────────────────────────────────────────────────────
   * Domain → Turnier Mapping.
   * Diese Map ist die einzige Quelle der Wahrheit für die
   * Auswahl des Standard-Turniers pro Domain.
   * ───────────────────────────────────────────────────────── */
  const DOMAIN_TOURNAMENT_MAP = {
    "em24dt.alae.app": "em2024",
    "dt.alae.app": "wm2026"
  };

  /* ─────────────────────────────────────────────────────────
   * LocalStorage-Schlüssel für den Dev-Override.
   *
   * Bewusst HOST-spezifisch, damit eine alte Test-Auswahl auf
   * dem Mobile-Client nicht über Domains hinweg "klebt"
   * (z. B. nicht versehentlich em2024 auf dt.alae.app erzwingt).
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
   *
   * Reihenfolge:
   *   1. URL-Parameter ?tournament=<key>     (volatile Test-Override)
   *   2. Host-spezifischer Dev-Override       (localStorage)
   *   3. Domain-Mapping (DOMAIN_TOURNAMENT_MAP)
   *   4. Globaler Fallback (FALLBACK_TOURNAMENT_KEY)
   *
   * Ungültige Werte (unbekannter Key) werden ignoriert.
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

  // Einmal-Aufräumen alter, nicht host-spezifischer Override-Keys.
  // Wichtig, damit auf Mobile-Clients keine alte Auswahl die Domain
  // überstimmt (z. B. EM 2024 auf dt.alae.app sichtbar machen).
  function cleanupLegacyKeys() {
    try {
      if (typeof window === "undefined" || !window.localStorage) return;
      LEGACY_GLOBAL_OVERRIDE_KEYS.forEach((legacyKey) => {
        if (window.localStorage.getItem(legacyKey) !== null) {
          window.localStorage.removeItem(legacyKey);
        }
      });
    } catch (err) {
      // ignore
    }
  }

  function getDomainTournamentKey(hostname) {
    const host = (hostname || currentHostname() || "").toLowerCase();
    if (!host) return null;
    if (Object.prototype.hasOwnProperty.call(DOMAIN_TOURNAMENT_MAP, host)) {
      const mapped = DOMAIN_TOURNAMENT_MAP[host];
      return mapped && TOURNAMENTS[mapped] ? mapped : null;
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
   */
  function resolveTournamentKey() {
    cleanupLegacyKeys();

    const fromUrl = readUrlTournamentKey();
    if (fromUrl && TOURNAMENTS[fromUrl]) {
      // Bewusst NICHT persistieren – ?tournament= ist ein einmaliger
      // Test-Override und darf den Domain-Default nicht dauerhaft
      // umstellen.
      return fromUrl;
    }

    const fromOverride = readDevOverrideKey();
    if (fromOverride && TOURNAMENTS[fromOverride]) {
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
   * Dev-Switch: Aktives Turnier per Dev-Override wechseln.
   *
   * Speichert die Auswahl host-spezifisch in localStorage
   * (`dreamteam_dev_override_${hostname}`) und lädt die Seite neu.
   *
   * Wichtig: Der Override gilt nur für die aktuelle Domain. Auf
   * jeder anderen Domain bleibt der domain-basierte Standard aktiv.
   * ───────────────────────────────────────────────────────── */
  function setActiveTournament(key, options) {
    const opts = options || {};
    const normalized = (key || "").toLowerCase();

    if (!TOURNAMENTS[normalized]) {
      console.warn(`[APP_CONFIG] Unbekanntes Turnier: ${key}`);
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
    if (!override || !TOURNAMENTS[override]) return false;
    return override !== resolveDomainDefaultKey();
  }

  function isUrlOverrideActive() {
    const fromUrl = readUrlTournamentKey();
    if (!fromUrl || !TOURNAMENTS[fromUrl]) return false;
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
      get devOverrideKey() {
        return devOverrideStorageKey();
      },

      // Backwards-Kompatibilität für Aufrufer, die früher den
      // generischen Key abgefragt haben. Zeigt nun den host-spezifischen
      // Override-Key.
      get activeTournamentKey() {
        return devOverrideStorageKey();
      },

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
