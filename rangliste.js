/* rangliste.js – Haupt-Seitenskript, aus rangliste.html extrahiert (Performance Phase 2).
   Wird als klassisches Skript an unveraenderter Position am Body-Ende geladen –
   die Ausfuehrungs-Reihenfolge relativ zu den uebrigen Skripten ist identisch. */

    const APP = window.APP_CONFIG;
    // Captain-Feature aktiv? (WM ja, CL nein – siehe tournament-config.js)
    const CAPTAIN_ENABLED = !(APP && APP.captainEnabled === false);

    if (!APP) {
        throw new Error("APP_CONFIG fehlt. Lade tournament-config.js vor rangliste.html.");
    }

    const TOURNAMENT_YEAR = APP.year;
    const PAGE_TITLE_PREFIX = APP.pageTitlePrefix;
    const TOURNAMENT_LABEL = APP.tournamentLabel;

    const VIEW_STATE_KEY = APP.storage.key("rangliste_view_state");
    const HISTORY_MAIN_KEY = APP.storage.key("rangliste_history_main");
    const HISTORY_COMPARE_KEY = APP.storage.key("rangliste_history_compare");
    const CHART_MODE_KEY = APP.storage.key("rangliste_history_chart_mode");
    const ROUND_FILTER_KEY = APP.storage.key("rangliste_round_filter");

    // Einmal-Migration der historischen, un­gepräfixten Session-Keys
    // auf die turnier-namespaceten Keys. Danach werden Legacy-Keys
    // nicht mehr beachtet oder geschrieben.
    [
        "rangliste_view_state",
        "rangliste_history_main",
        "rangliste_history_compare",
        "rangliste_history_chart_mode",
        "rangliste_round_filter"
    ].forEach(name => APP.storage.migrate(name, name, { storage: "session" }));

    /* =====================================================
       ROUND FILTER – Konfiguration
       ===================================================== */
    const ROUND_OPTIONS = [
        { key: "GROUP_1", label: "1. Runde Gruppenphase" },
        { key: "GROUP_2", label: "2. Runde Gruppenphase" },
        { key: "GROUP_3", label: "3. Runde Gruppenphase" },
        { key: "ROUND_32", label: "Sechzehntelfinale" },
        { key: "ROUND_16", label: "Achtelfinale" },
        { key: "QF",      label: "Viertelfinale" },
        { key: "SF",      label: "Halbfinale" },
        { key: "F",       label: "Finalspiele" }
    ];

    const ALL_ROUND_KEYS = ROUND_OPTIONS.map(o => o.key);

    function classifyRoundText(roundText) {
        if (roundText === null || roundText === undefined) return null;
        const r = String(roundText).toLowerCase().trim();
        if (!r) return null;

        // K.O.-Phase zuerst pruefen (sonst koennte z.B. "Final" mit
        // "1st Round" verwechselt werden, wenn Group-Regex "1" fingert).
        if (/round\s*of\s*32/.test(r) || /sechzehntel[- ]?finale?/.test(r) || /1\s*\/\s*16[- ]?\s*final/.test(r) || /\br\s*32\b/.test(r) || /\b1\/16\b/.test(r)) return "ROUND_32";
        if (/round\s*of\s*16/.test(r) || /achtelfinale/.test(r) || /1\s*\/\s*8[- ]?\s*final/.test(r) || /\br\s*16\b/.test(r) || /\b1\/8\b/.test(r)) return "ROUND_16";
        if (/quarter[- ]?final/.test(r) || /viertelfinale/.test(r) || /1\s*\/\s*4[- ]?\s*final/.test(r) || /\bqf\b/.test(r) || /\b1\/4\b/.test(r)) return "QF";
        if (/semi[- ]?final/.test(r) || /halbfinale/.test(r) || /1\s*\/\s*2[- ]?\s*final/.test(r) || /\bsf\b/.test(r) || /\b1\/2\b/.test(r)) return "SF";
        if (/3rd\s*[- ]?\s*place/.test(r) || /spiel\s*um\s*platz\s*3/.test(r) || /^final\b/.test(r) || /\bfinale?\b/.test(r)) return "F";

        // Gruppenphase: tolerant gegenueber Formaten wie
        //   "Group Stage - 1", "Group A - 1", "Group 1", "Matchday 1",
        //   "1. Spieltag", "1st Round", "Round 1", "Vorrunde - 1".
        const isGroup = /group/.test(r) || /spieltag/.test(r) || /matchday/.test(r) || /vorrunde/.test(r) || /^round\b/.test(r) || /\brunde\b/.test(r) || /round\s*\d/.test(r);
        const numberMatch = r.match(/(\d+)/);
        if (isGroup && numberMatch) {
            const n = Number(numberMatch[1]);
            if (n === 1) return "GROUP_1";
            if (n === 2) return "GROUP_2";
            if (n === 3) return "GROUP_3";
        }

        // Fallback: explizite "1st/2nd/3rd"-Formulierungen
        if (/\b1(st)?\b/.test(r) && /round|spieltag|matchday|runde|group/.test(r)) return "GROUP_1";
        if (/\b2(nd)?\b/.test(r) && /round|spieltag|matchday|runde|group/.test(r)) return "GROUP_2";
        if (/\b3(rd)?\b/.test(r) && /round|spieltag|matchday|runde|group/.test(r)) return "GROUP_3";

        return null;
    }

    const db = APP.getDb();

    document.title = `${PAGE_TITLE_PREFIX} - Rangliste`;

    const rankingTitleEl = document.getElementById("ranking-title");
    const loadingEl = document.getElementById("loading");

    if (rankingTitleEl) {
        rankingTitleEl.innerHTML = `<span class="gold-text">Rangliste</span>`;
    }

    if (loadingEl) {
        loadingEl.textContent = `Berechne Rangliste für ${TOURNAMENT_LABEL}... ⏳`;
    }

    let metaUnsubscribe = null;
    let isMetaRefreshRunning = false;
    let hasRenderedOnce = false;

    let rankingTeams = [];
    let teamsByManager = new Map();
    let historyLabels = [];
    let selectedMainManager = null;
    let selectedCompareManagers = [];
    let historyChart = null;
    let chartMode = getStoredSessionValue(CHART_MODE_KEY) === "points" ? "points" : "rank";
    let currentView = "ranking";

    let lastRawData = null;
    let lastUpdateCountdownTimer = null;
    let matchIdRoundMap = new Map();
    let allMatchIdsRaw = [];
    let selectedRoundKeys = loadSelectedRoundKeys();

    const CACHE_OPTIONS = {
        db,
        year: TOURNAMENT_YEAR,
        // Vor Turnierstart liegen noch keine Punkte vor. Die Rangliste
        // zeigt dann lediglich die bereits eingereichten Teams mit 0
        // Punkten, anstatt mit einem Fehler abzubrechen.
        allowEmptyPoints: true,
        log: false
    };

    const compareChartPalette = [
        "#60a5fa",
        "#fb923c",
        "#a78bfa",
        "#f87171",
        "#34d399",
        "#fbbf24",
        "#f472b6",
        "#38bdf8",
        "#818cf8"
    ];

    function getStoredSessionValue(primaryKey) {
        try {
            return sessionStorage.getItem(primaryKey);
        } catch (err) {
            return null;
        }
    }

    function setStoredSessionValue(primaryKey, value) {
        try {
            sessionStorage.setItem(primaryKey, value);
        } catch (err) {
            // Storage kann in Privacy-Modi blockiert sein – kein Hard-Fail.
        }
    }

    function loadSelectedRoundKeys() {
        try {
            const raw = getStoredSessionValue(ROUND_FILTER_KEY);
            if (!raw) return new Set(ALL_ROUND_KEYS);
            const parsed = JSON.parse(raw);
            if (!Array.isArray(parsed)) return new Set(ALL_ROUND_KEYS);
            const filtered = parsed.filter(k => ALL_ROUND_KEYS.includes(k));
            const legacyRoundKeys = ALL_ROUND_KEYS.filter(k => k !== "ROUND_32");
            if (!filtered.includes("ROUND_32") && legacyRoundKeys.every(k => filtered.includes(k))) {
                filtered.push("ROUND_32");
            }
            return new Set(filtered.length ? filtered : ALL_ROUND_KEYS);
        } catch (e) {
            return new Set(ALL_ROUND_KEYS);
        }
    }

    function persistSelectedRoundKeys() {
        setStoredSessionValue(
            ROUND_FILTER_KEY,
            JSON.stringify([...selectedRoundKeys])
        );
    }

    function buildMatchIdRoundMap(fixtures) {
        const map = new Map();
        const unclassified = new Set();
        Object.entries(fixtures || {}).forEach(([docId, fixture]) => {
            if (!fixture || typeof fixture !== "object") return;
            const fid = fixture.fixtureId ?? docId;
            const roundText = (fixture.league && fixture.league.round) || "";
            const key = classifyRoundText(roundText);
            map.set(String(fid), { round: roundText, key });
            if (!key && roundText) {
                unclassified.add(roundText);
            }
        });

        if (unclassified.size > 0) {
            console.warn(
                "[Rangliste] Folgende Rundenbezeichnungen konnten nicht klassifiziert werden:",
                Array.from(unclassified)
            );
        }

        return map;
    }

    function isAllRoundsSelected() {
        if (selectedRoundKeys.size !== ALL_ROUND_KEYS.length) return false;
        return ALL_ROUND_KEYS.every(k => selectedRoundKeys.has(k));
    }

    function getFilteredMatchIds() {
        if (isAllRoundsSelected()) return null;

        // Falls die Fixtures-Sammlung leer ist, koennen wir nicht
        // sinnvoll filtern -> kein Filter anwenden, damit die Rangliste
        // nicht versehentlich auf 0 faellt.
        if (!matchIdRoundMap.size) {
            console.warn("[Rangliste] Runden-Filter ist gesetzt, aber Fixture-Daten fehlen – Filter wird ignoriert.");
            return null;
        }

        const filtered = allMatchIdsRaw.filter(mid => {
            const info = matchIdRoundMap.get(String(mid));
            return info && info.key && selectedRoundKeys.has(info.key);
        });

        // Diagnostik: zeige, wie viele Match-IDs aus den Punktdaten
        // ueberhaupt in den Fixtures vorkommen / klassifiziert sind.
        const unmatched = allMatchIdsRaw.filter(mid => !matchIdRoundMap.has(String(mid)));
        const unclassifiedIds = allMatchIdsRaw.filter(mid => {
            const info = matchIdRoundMap.get(String(mid));
            return info && !info.key;
        });

        if (filtered.length === 0 && allMatchIdsRaw.length > 0) {
            console.warn(
                "[Rangliste] Keine Spiele entsprechen dem aktuellen Runden-Filter.",
                {
                    selectedRoundKeys: Array.from(selectedRoundKeys),
                    totalPointsMatchIds: allMatchIdsRaw.length,
                    unmatchedAgainstFixtures: unmatched.length,
                    unclassifiedRoundTexts: unclassifiedIds.length,
                    sampleRoundTexts: Array.from(new Set(
                        Array.from(matchIdRoundMap.values())
                            .map(v => v && v.round)
                            .filter(Boolean)
                    )).slice(0, 12)
                }
            );
        }

        return filtered;
    }

    function escapeHtml(value) {
        return String(value ?? "")
            .replace(/&/g, "&amp;")
            .replace(/</g, "&lt;")
            .replace(/>/g, "&gt;")
            .replace(/"/g, "&quot;")
            .replace(/'/g, "&#039;");
    }

    let rankingNationFlagLookup = null;

    function normalizeRankingNationFlagKey(value) {
        if (value === null || value === undefined) return "";
        return String(value)
            .normalize("NFD")
            .replace(/[\u0300-\u036f]/g, "")
            .replace(/['`\u00b4\u2019]/g, "")
            .replace(/&/g, " and ")
            .replace(/[^a-zA-Z0-9]+/g, " ")
            .trim()
            .replace(/\s+/g, " ")
            .toLowerCase();
    }

    function getRankingNationFlagAliasNames(nationName) {
        const names = [nationName];
        if (typeof getCountryAliases === "function") {
            names.push(...getCountryAliases(nationName));
        }
        return names.filter(Boolean);
    }

    function buildRankingNationFlagLookup() {
        const lookup = new Map();
        const add = (name, logo) => {
            const key = normalizeRankingNationFlagKey(name);
            if (key && logo && !lookup.has(key)) lookup.set(key, logo);
        };

        if (typeof playersData !== "undefined" && Array.isArray(playersData)) {
            playersData.forEach(player => {
                const nation = player && player["Nationalteam.name"];
                const logo = player && player["Nationalteam.logo"];
                if (!nation || !logo) return;
                getRankingNationFlagAliasNames(nation).forEach(name => add(name, logo));
            });
        }

        return lookup;
    }

    function getRankingNationFlag(nationName) {
        if (!nationName) return "";
        if (!rankingNationFlagLookup) rankingNationFlagLookup = buildRankingNationFlagLookup();

        for (const name of getRankingNationFlagAliasNames(nationName)) {
            const flag = rankingNationFlagLookup.get(normalizeRankingNationFlagKey(name));
            if (flag) return flag;
        }

        return "";
    }

    function handleRankingFlagImageError(img) {
        if (!img) return;
        const fallback = img.dataset ? img.dataset.fallbackSrc : "";
        if (fallback && img.src !== fallback) {
            img.dataset.fallbackSrc = "";
            img.src = fallback;
            return;
        }
        const placeholder = document.createElement("span");
        placeholder.className = `${img.className || ""} placeholder`.trim();
        placeholder.setAttribute("aria-hidden", "true");
        placeholder.textContent = "?";
        img.replaceWith(placeholder);
    }
    window.handleRankingFlagImageError = handleRankingFlagImageError;

    function renderRankingFlagImageHtml(className, primaryUrl, fallbackUrl, altText) {
        const src = primaryUrl || fallbackUrl || "";
        if (!src) {
            return `<span class="${escapeHtml(className)} placeholder" aria-hidden="true">?</span>`;
        }
        const fallbackAttr = primaryUrl && fallbackUrl && primaryUrl !== fallbackUrl
            ? ` data-fallback-src="${escapeHtml(fallbackUrl)}"`
            : "";
        return `<img class="${escapeHtml(className)}" src="${escapeHtml(src)}" alt="${escapeHtml(altText || "")}" loading="lazy"${fallbackAttr} onerror="handleRankingFlagImageError(this)">`;
    }

    // Performance: O(1)-Lookups statt linearer Scans über den gesamten
    // Spielerpool (~1200 Einträge). `playersData` wird zur Ladezeit einmal
    // befüllt und danach weder in Länge noch Reihenfolge verändert (data.js
    // mutiert ausschliesslich Position-Felder in place), deshalb darf der
    // Index lazy einmal aufgebaut und wiederverwendet werden. Die Map-
    // Befüllung "erster Treffer gewinnt" spiegelt exakt die bisherige
    // Array.find-Semantik wider.
    let __dtPlayerIndexById = null;
    let __dtPlayerIndexByName = null;
    function __dtEnsurePlayerIndexes() {
        if (__dtPlayerIndexById) return;
        __dtPlayerIndexById = new Map();
        __dtPlayerIndexByName = new Map();
        if (typeof playersData === "undefined" || !Array.isArray(playersData)) return;
        for (let i = 0; i < playersData.length; i++) {
            const pd = playersData[i];
            if (!pd) continue;
            const rawId = pd["player.id"];
            if (rawId !== undefined && rawId !== null) {
                const key = String(rawId);
                if (!__dtPlayerIndexById.has(key)) __dtPlayerIndexById.set(key, pd);
            }
            const name = pd.Spielername;
            if (name) {
                const list = __dtPlayerIndexByName.get(name);
                if (list) list.push(pd);
                else __dtPlayerIndexByName.set(name, [pd]);
            }
        }
    }

    function getPlayerById(playerId) {
        if (playerId === undefined || playerId === null) return null;
        __dtEnsurePlayerIndexes();
        return __dtPlayerIndexById.get(String(playerId)) || null;
    }

    function getPlayerByStoredSnapshot(savedPlayer) {
        if (!savedPlayer || !savedPlayer.name) return null;
        __dtEnsurePlayerIndexes();
        const list = __dtPlayerIndexByName.get(savedPlayer.name);
        if (!list) return null;
        for (let i = 0; i < list.length; i++) {
            const pd = list[i];
            if (!savedPlayer.nation || (pd["Nationalteam.name"] || "") === savedPlayer.nation) return pd;
        }
        return null;
    }

    function resolveStoredPlayer(savedPlayer) {
        const byId = getPlayerById(savedPlayer && savedPlayer.playerId);
        if (byId && (!savedPlayer || !savedPlayer.name || byId.Spielername === savedPlayer.name)) return byId;
        return getPlayerByStoredSnapshot(savedPlayer) || byId;
    }

    function buildPlayerPointsMap(rawPoints) {
        const map = {};
        Object.entries(rawPoints || {}).forEach(([id, docData]) => {
            map[String(id)] = window.DreamTeamPoints && typeof window.DreamTeamPoints.getPlayerTotal === "function"
                ? window.DreamTeamPoints.getPlayerTotal(docData)
                : (docData && typeof docData.totalPoints === "number" ? docData.totalPoints : 0);
        });
        return map;
    }

    function getMatchChronologyValue(matchId, fixtures) {
        const fixture = findFixtureByMatchId(fixtures, matchId);
        const kickoffMs = getFixtureKickoffMs(fixture);
        if (kickoffMs !== null) {
            return {
                hasFixtureTime: true,
                value: kickoffMs
            };
        }

        const numericId = Number(matchId);
        return {
            hasFixtureTime: false,
            value: Number.isFinite(numericId) ? numericId : Number.MAX_SAFE_INTEGER
        };
    }

    function compareMatchIdsByChronology(a, b, fixtures) {
        const aInfo = getMatchChronologyValue(a, fixtures);
        const bInfo = getMatchChronologyValue(b, fixtures);

        if (aInfo.hasFixtureTime !== bInfo.hasFixtureTime) {
            return aInfo.hasFixtureTime ? -1 : 1;
        }
        if (aInfo.value !== bInfo.value) return aInfo.value - bInfo.value;

        return String(a).localeCompare(String(b), "de", { numeric: true });
    }

    function sortMatchIdsByChronology(matchIds, fixtures) {
        return Array.from(matchIds || []).sort((a, b) => compareMatchIdsByChronology(a, b, fixtures));
    }

    function extractMatchData(rawPoints, fixtures = {}) {
        const playerMatchPoints = {};
        const nationStatus = {};
        let maxNationGames = 0;
        const matchIdsSet = new Set();

        Object.entries(rawPoints || {}).forEach(([playerId, docData]) => {
            const fullP = getPlayerById(playerId);
            const nation = fullP ? fullP["Nationalteam.name"] : null;
            const perMatch = {};

            Object.entries(docData || {}).forEach(([key, val]) => {
                if (!key.startsWith("Spiel_") || !val || typeof val !== "object") return;

                const matchId = Number(val.MatchID);
                if (!Number.isFinite(matchId)) return;

                matchIdsSet.add(matchId);
                perMatch[matchId] = typeof val.TotalPunkte === "number" ? val.TotalPunkte : 0;

                if (nation) {
                    if (!nationStatus[nation]) {
                        nationStatus[nation] = {
                            latestMatchId: -Infinity,
                            outcome: "draw",
                            matchIds: new Set()
                        };
                    }

                    nationStatus[nation].matchIds.add(matchId);

                    const chronology = getMatchChronologyValue(matchId, fixtures);
                    const currentLatest = nationStatus[nation].latestChronology || {
                        hasFixtureTime: false,
                        value: -Infinity,
                        matchId: -Infinity
                    };
                    const isLaterMatch =
                        chronology.value > currentLatest.value ||
                        (
                            chronology.value === currentLatest.value &&
                            Number(matchId) > Number(currentLatest.matchId)
                        );

                    if (isLaterMatch) {
                        let outcome = "draw";
                        const lineup = val.Aufstellung || {};

                        if (typeof lineup.WIN === "number" && lineup.WIN !== 0) outcome = "win";
                        else if (typeof lineup.LOSS === "number" && lineup.LOSS !== 0) outcome = "loss";
                        else if (typeof lineup.DRAW === "number" && lineup.DRAW !== 0) outcome = "draw";

                        nationStatus[nation].latestMatchId = matchId;
                        nationStatus[nation].latestChronology = {
                            ...chronology,
                            matchId
                        };
                        nationStatus[nation].outcome = outcome;
                    }
                }
            });

            playerMatchPoints[String(playerId)] = perMatch;
        });

        Object.values(nationStatus).forEach(info => {
            info.totalGames = info.matchIds.size;
            if (info.totalGames > maxNationGames) maxNationGames = info.totalGames;
        });

        return {
            playerMatchPoints,
            nationStatus,
            maxNationGames,
            matchIds: sortMatchIdsByChronology(matchIdsSet, fixtures)
        };
    }

    function enrichTeams(rawTeams, playerPointsMap, playerMatchPoints, nationLifecycle, fixtures) {
        const teams = Array.isArray(rawTeams) ? rawTeams : [];

        // Anpfiff je Spiel (ms) für die zeitbasierte Transfer-Wertung – gecacht.
        const kickoffCache = Object.create(null);
        function kickoffMsForMatch(matchId) {
            const key = String(matchId);
            if (key in kickoffCache) return kickoffCache[key];
            const fx = findFixtureByMatchId(fixtures || {}, matchId);
            const ms = getFixtureKickoffMs(fx);
            kickoffCache[key] = ms;
            return ms;
        }

        return teams.map(team => {
            const mergedPlayers = (team.players || []).map((p, idx) => {
                const fullP = resolveStoredPlayer(p);

                const playerId = fullP
                    ? String(fullP["player.id"])
                    : (p.playerId != null ? String(p.playerId) : `fallback-${idx}-${Math.random()}`);
                const basePts = fullP ? (playerPointsMap[playerId] || 0) : 0;
                const isOrphan = !fullP;
                // Captain nur bei Turnieren mit Captain-Feature (WM), nicht CL.
                const isCap = CAPTAIN_ENABLED && !!p.isCaptain;
                const finalPts = isCap ? basePts * 2 : basePts;
                const matchesMap = fullP ? (playerMatchPoints[playerId] || {}) : {};
                const matchCount = Object.keys(matchesMap).length;

                return {
                    id: playerId,
                    name: fullP ? fullP.Spielername : (p.name || "Unbekannt"),
                    pts: finalPts,
                    basePts,
                    isCaptain: isCap,
                    // Wenn der Spieler nicht mehr im aktuellen Kader auftaucht
                    // (z.B. nach einem Kader-Update), greifen wir auf den im
                    // Team-Doc gespeicherten Snapshot zurück. So bleiben Foto
                    // und Land sichtbar, statt durch Platzhalter / "?" ersetzt
                    // zu werden.
                    photo: fullP ? (fullP.Spielerfoto || "https://via.placeholder.com/50") : (p.photo || "https://via.placeholder.com/50"),
                    nation: fullP ? (fullP["Nationalteam.name"] || "?") : (p.nation || "?"),
                    isOrphan,
                    matchPoints: matchesMap,
                    matchCount
                };
            });

            mergedPlayers.sort((a, b) => b.pts - a.pts);

            // Gesamtpunkte: Teams MIT Transfers zeitbasiert werten (altes 15 bis
            // zum Transfer, neues 15 danach – Kapitän ×2 je Segment). Teams OHNE
            // Transfers (WM immer, CL bis zum ersten Transfer) nutzen die
            // bisherige Skalar-Summe → Ergebnis identisch, aber günstiger.
            const hasTransfers = !!(window.TransferUtils
                && typeof window.TransferUtils.managerTotalOverTime === "function"
                && Array.isArray(team.transfers) && team.transfers.length);
            let totalScore;
            if (hasTransfers) {
                totalScore = window.TransferUtils.managerTotalOverTime({
                    currentTeamIds: mergedPlayers.map(p => String(p.id)),
                    transfers: team.transfers,
                    initialCaptain: team.initialCaptain || (mergedPlayers.find(p => p.isCaptain) || {}).id || null,
                    playerMatchPoints: playerMatchPoints || {},
                    getKickoffMs: kickoffMsForMatch,
                    captainMultiplier: CAPTAIN_ENABLED ? 2 : 1
                });
            } else {
                totalScore = mergedPlayers.reduce((sum, p) => sum + p.pts, 0);
            }
            const totalPlayedMatches = mergedPlayers.reduce((sum, p) => sum + p.matchCount, 0);
            // "Spieler noch im Turnier": Anzahl der Spieler, deren Nation
            // noch nicht ausgeschieden ist. Die Elimination wird zentral
            // (fixture-basiert) in APP_CONFIG.getNationStatus bestimmt.
            const activePlayers = nationLifecycle && typeof nationLifecycle.countActivePlayers === "function"
                ? nationLifecycle.countActivePlayers(mergedPlayers, player => player.nation)
                : mergedPlayers.length;

            return {
                ...team,
                manager: team.manager || "Unbekannt",
                mergedPlayers,
                totalScore,
                totalPlayedMatches,
                activePlayers,
                history: [],
                displayRank: null,
                currentRank: null,
                bestRank: null,
                lowestRank: null,
                averageRank: 0
            };
        });
    }

    function timestampToMillis(value) {
        if (!value) return 0;
        if (typeof value.toMillis === "function") {
            const ms = Number(value.toMillis());
            if (Number.isFinite(ms)) return ms;
        }
        if (typeof value.toDate === "function") {
            const date = value.toDate();
            const ms = date instanceof Date ? date.getTime() : NaN;
            if (Number.isFinite(ms)) return ms;
        }
        if (value instanceof Date) {
            const ms = value.getTime();
            return Number.isFinite(ms) ? ms : 0;
        }
        if (typeof value === "number") return Number.isFinite(value) ? value : 0;
        if (typeof value === "string") {
            const parsed = Date.parse(value);
            return Number.isFinite(parsed) ? parsed : 0;
        }
        if (typeof value === "object") {
            const seconds = Number(value.seconds ?? value._seconds);
            if (Number.isFinite(seconds)) {
                const nanos = Number(value.nanoseconds ?? value._nanoseconds ?? 0);
                return seconds * 1000 + (Number.isFinite(nanos) ? Math.floor(nanos / 1000000) : 0);
            }
        }
        return 0;
    }

    function getTeamSubmissionMillis(team) {
        const candidates = [
            team && team.timestamp,
            team && team.submittedAt,
            team && team.createdAt,
            team && team.createdAtMs
        ];
        for (const candidate of candidates) {
            const ms = timestampToMillis(candidate);
            if (ms > 0) return ms;
        }
        return 0;
    }

    function compareTeamsBySubmissionAsc(a, b) {
        const aMs = getTeamSubmissionMillis(a);
        const bMs = getTeamSubmissionMillis(b);
        if (aMs !== bMs) {
            if (aMs <= 0) return 1;
            if (bMs <= 0) return -1;
            return aMs - bMs;
        }
        return compareTeamsByManagerName(a, b);
    }

    function compareTeamsByManagerName(a, b) {
        return String(a && a.manager || "").localeCompare(String(b && b.manager || ""), "de");
    }

    function compareTeamsByScoreThenSubmission(a, b) {
        const diff = (b.totalScore || 0) - (a.totalScore || 0);
        if (diff !== 0) return diff;
        return compareTeamsBySubmissionAsc(a, b);
    }

    function getRankScore(value) {
        const score = Number(value);
        return Number.isFinite(score) ? score : 0;
    }

    function assignSharedRanks(sortedTeams, getScore, setRank) {
        let currentRank = null;
        let previousScore = null;

        sortedTeams.forEach((team, index) => {
            const score = getRankScore(getScore(team));
            if (index === 0 || score !== previousScore) {
                currentRank = index + 1;
            }
            setRank(team, currentRank);
            previousScore = score;
        });
    }

    function computeRankingsWithHistory(teams, matchIds) {
        // Vor dem ersten Spiel werden bewusst keine Verlaufseintraege erzeugt.
        // Sonst wuerde der Graph bereits bei "0 Spielen" einen Wert zeigen,
        // bei dem alle Manager 0 Punkte haben und nur alphabetisch sortiert
        // sind.
        const snapshotCount = matchIds.length;
        const labels = Array.from({ length: snapshotCount }, (_, i) => String(i + 1));

        teams.forEach(team => {
            team.history = [];
            let runningScore = 0;

            for (let i = 0; i < snapshotCount; i++) {
                const matchId = matchIds[i];

                if (matchId !== undefined) {
                    const stepPoints = (team.mergedPlayers || []).reduce((sum, player) => {
                        const baseMatchPts = player.matchPoints && player.matchPoints[matchId] ? player.matchPoints[matchId] : 0;
                        return sum + (player.isCaptain ? baseMatchPts * 2 : baseMatchPts);
                    }, 0);
                    runningScore += stepPoints;
                }

                team.history.push({
                    step: i + 1,
                    matchId,
                    score: runningScore,
                    rank: null
                });
            }
        });

        for (let i = 0; i < snapshotCount; i++) {
            const snapshotSorted = [...teams].sort((a, b) => {
                const diff = (b.history[i]?.score || 0) - (a.history[i]?.score || 0);
                if (diff !== 0) return diff;
                return compareTeamsBySubmissionAsc(a, b);
            });

            assignSharedRanks(snapshotSorted, team => team.history[i]?.score, (team, rank) => {
                team.history[i].rank = rank;
            });
        }

        if (teams.length && snapshotCount > 0) {
            const lastIndex = snapshotCount - 1;
            const currentSorted = [...teams].sort(compareTeamsByScoreThenSubmission);

            assignSharedRanks(currentSorted, team => team.totalScore, (team, rank) => {
                team.history[lastIndex].score = team.totalScore;
                team.history[lastIndex].rank = rank;
            });
        }

        teams.forEach(team => {
            if (!team.history.length) {
                // Vor dem 1. Spiel: keine Rang-Statistiken berechnen
                team.currentRank = null;
                team.bestRank = null;
                team.lowestRank = null;
                team.averageRank = null;
                return;
            }

            const last = team.history[team.history.length - 1];
            team.currentRank = last ? last.rank : null;
            team.bestRank = Math.min(...team.history.map(h => h.rank));
            team.lowestRank = Math.max(...team.history.map(h => h.rank));
            const avg = team.history.reduce((sum, h) => sum + h.rank, 0) / team.history.length;
            team.averageRank = Number(avg.toFixed(1));
        });

        const sortedCurrent = [...teams].sort(compareTeamsByScoreThenSubmission);
        assignSharedRanks(sortedCurrent, team => team.totalScore, (team, rank) => {
            team.displayRank = rank;
        });

        return {
            teams: sortedCurrent,
            labels
        };
    }

    function buildRankingData(data, selectedMatchIds) {
        const { playerMatchPoints, matchIds: rawMatchIds } = extractMatchData(
            data.points || {},
            data.fixtures || {}
        );

        const useFilter = Array.isArray(selectedMatchIds);
        const useSet = useFilter ? new Set(selectedMatchIds.map(String)) : null;

        const matchIds = useFilter
            ? rawMatchIds.filter(mid => useSet.has(String(mid)))
            : rawMatchIds;

        let playerPointsMap;
        let scopedPlayerMatchPoints;

        if (useFilter) {
            playerPointsMap = {};
            scopedPlayerMatchPoints = {};

            Object.entries(playerMatchPoints).forEach(([playerId, perMatch]) => {
                const filtered = {};
                let sum = 0;
                Object.entries(perMatch || {}).forEach(([mid, pts]) => {
                    if (useSet.has(String(mid))) {
                        filtered[mid] = pts;
                        sum += pts;
                    }
                });
                scopedPlayerMatchPoints[playerId] = filtered;
                playerPointsMap[playerId] = sum;
            });
        } else {
            playerPointsMap = buildPlayerPointsMap(data.points || {});
            scopedPlayerMatchPoints = playerMatchPoints;
        }

        const nationLifecycle = (APP && typeof APP.getNationStatus === "function")
            ? APP.getNationStatus(data.fixtures || {})
            : null;
        const enrichedTeams = enrichTeams(data.teams || [], playerPointsMap, scopedPlayerMatchPoints, nationLifecycle, data.fixtures || {});
        return {
            ...computeRankingsWithHistory(enrichedTeams, matchIds),
            rawMatchIds
        };
    }

    function isTeamsLocked() {
        try {
            return !!(window.APP_CONFIG && window.APP_CONFIG.isPreStart && window.APP_CONFIG.isPreStart());
        } catch (_) { return true; }
    }

    function generateAvatarsHTML(top3, isList) {
        if (!top3 || top3.length === 0) return "";

        const p1 = top3[0];
        const p2 = top3[1];
        const p3 = top3[2];
        const baseClass = isList ? "list-avatar" : "podium-avatar";
        let html = "";

        // Vor Turnierstart bleiben die gedrafteten Spieler geheim:
        // wir rendern anonyme Silhouetten ohne Link/Name/Punkte.
        const locked = isTeamsLocked();

        const buildAvatar = (p, rankClass) => {
            if (!p) return "";
            if (locked) {
                return `
                    <span class="avatar-link ${baseClass} ${rankClass} is-locked" aria-label="Spieler noch versteckt" title="Wird mit Turnierstart enthüllt">
                        <span class="locked-avatar-icon" aria-hidden="true">🔒</span>
                    </span>
                `;
            }
            const captainClass = p.isCaptain ? "is-captain" : "";
            const titleText = p.isCaptain ? `${p.name} (Captain)` : p.name;
            const href = p.id
                ? `spieleranalyse.html?playerId=${encodeURIComponent(p.id)}`
                : `spieleranalyse.html?player=${encodeURIComponent(p.name)}`;

            return `
                <a href="${href}" class="avatar-link ${baseClass} ${rankClass} ${captainClass}" title="${escapeHtml(titleText)}">
                    <img src="${escapeHtml(p.photo)}" alt="${escapeHtml(p.name)}">
                    <div class="hover-pts">${p.pts} Pkt.</div>
                </a>
            `;
        };

        if (p2) html += buildAvatar(p2, "rank-2");
        if (p1) html += buildAvatar(p1, "rank-1");
        if (p3) html += buildAvatar(p3, "rank-3");

        return html;
    }

    function buildSparklineSVG(history, color = "var(--green-light)", width = 120, height = 28) {
        const totalRanks = Math.max(rankingTeams.length, 1);
        const values = Array.isArray(history) ? history.map(h => h.rank) : [];

        if (!values.length) {
            return `<svg class="sparkline-svg" viewBox="0 0 ${width} ${height}" preserveAspectRatio="none"></svg>`;
        }

        const padX = 4;
        const padY = 4;
        const innerW = Math.max(width - padX * 2, 1);
        const innerH = Math.max(height - padY * 2, 1);
        const steps = Math.max(values.length - 1, 1);

        const points = values.map((rank, idx) => {
            const x = padX + (idx / steps) * innerW;
            const ratio = totalRanks <= 1 ? 0.5 : (rank - 1) / (totalRanks - 1);
            const y = padY + ratio * innerH;
            return { x, y };
        });

        const polyline = points.map(p => `${p.x.toFixed(2)},${p.y.toFixed(2)}`).join(" ");
        const last = points[points.length - 1];

        return `
            <svg class="sparkline-svg" viewBox="0 0 ${width} ${height}" preserveAspectRatio="none" aria-hidden="true">
                <polyline points="${polyline}" class="sparkline-line" style="stroke:${color};"></polyline>
                <circle cx="${last.x.toFixed(2)}" cy="${last.y.toFixed(2)}" r="3.1" class="sparkline-end" style="fill:${color};"></circle>
            </svg>
        `;
    }

    function buildSparklineButton(managerName, history, isPodium = false) {
        const width = isPodium ? 118 : 120;
        const height = isPodium ? 30 : 28;
        const svg = buildSparklineSVG(history, "var(--green-light)", width, height);

        return `
            <button type="button" class="sparkline-trigger" data-manager="${escapeHtml(managerName)}" title="Historie von ${escapeHtml(managerName)} anzeigen">
                <div class="sparkline-box">
                    ${svg}
                </div>
            </button>
        `;
    }

    function bindSparklineEvents() {
        document.querySelectorAll(".sparkline-trigger").forEach(btn => {
            btn.addEventListener("click", (e) => {
                e.preventDefault();
                e.stopPropagation();
                const managerName = btn.dataset.manager;
                openManagerHistory(managerName);
            });
        });
    }

    function renderRankingView() {
        const podium = document.getElementById("podium");
        const list = document.getElementById("rank-list");

        podium.innerHTML = "";
        list.innerHTML = "";
        podium.style.display = "none";
        list.style.display = "none";

        if (!rankingTeams.length) {
            list.style.display = "flex";
            list.innerHTML = `<div style="text-align:center;padding:40px 20px;background:var(--dark-card);border:1px solid var(--glass-border);border-radius:16px;color:var(--text-muted);">Es wurden noch keine Teams für ${escapeHtml(TOURNAMENT_LABEL)} erstellt.</div>`;
            return;
        }

        podium.style.display = "flex";

        const podiumOrder = [
            { rank: 2, data: rankingTeams[1], css: "podium-2", medal: "🥈" },
            { rank: 1, data: rankingTeams[0], css: "podium-1", medal: "🏆" },
            { rank: 3, data: rankingTeams[2], css: "podium-3", medal: "🥉" }
        ];

        let podiumHTML = "";
        podiumOrder.forEach(pos => {
            if (!pos.data) return;

            const avatarsHTML = generateAvatarsHTML(pos.data.mergedPlayers.slice(0, 3), false);
            const managerLink = `<a href="teams.html?manager=${encodeURIComponent(pos.data.manager)}" class="manager-link">${escapeHtml(pos.data.manager)}</a>`;
            const sparklineHTML = buildSparklineButton(pos.data.manager, pos.data.history, true);
            const displayRank = pos.data.currentRank || pos.data.displayRank || pos.rank;

            podiumHTML += `
                <div class="podium-box ${pos.css}" data-manager="${escapeHtml(pos.data.manager)}">
                    <div class="medal">${pos.medal}</div>
                    <div class="pod-rank-number">Rang ${displayRank}</div>
                    <div class="pod-name">${managerLink}</div>
                    <div class="pod-sparkline-wrap">${sparklineHTML}</div>
                    <div class="pod-pts">${pos.data.totalScore}</div>
                    <div class="pod-pts-label">Punkte</div>
                    <div class="avatar-group">${avatarsHTML}</div>
                </div>
            `;
        });

        podium.innerHTML = podiumHTML;

        if (rankingTeams.length > 3) {
            list.style.display = "flex";
            let listHTML = "";

            for (let i = 3; i < rankingTeams.length; i++) {
                const t = rankingTeams[i];
                const listAvatarsHTML = generateAvatarsHTML(t.mergedPlayers.slice(0, 3), true);
                const managerLink = `<a href="teams.html?manager=${encodeURIComponent(t.manager)}" class="manager-link">${escapeHtml(t.manager)}</a>`;
                const sparklineHTML = buildSparklineButton(t.manager, t.history, false);
                const displayRank = t.currentRank || t.displayRank || (i + 1);

                listHTML += `
                    <div class="rank-row" data-manager="${escapeHtml(t.manager)}">
                        <div class="rank-left">
                            <div class="rank-number">${displayRank}.</div>
                            <div class="rank-name-wrap">
                                <div class="rank-name">${managerLink}</div>
                            </div>
                        </div>

                        <div class="rank-sparkline-wrap">${sparklineHTML}</div>

                        <div class="rank-middle">
                            <div class="avatar-group">${listAvatarsHTML}</div>
                        </div>

                        <div class="rank-right">
                            ${t.totalScore}
                            <span class="rank-right-label">Pkt.</span>
                        </div>
                    </div>
                `;
            }

            list.innerHTML = listHTML;
        }

        bindSparklineEvents();
        applyFocusFromUrl();
    }

    function applyFocusFromUrl() {
        try {
            const params = new URLSearchParams(window.location.search);
            const focusManager = params.get("focus");
            if (!focusManager) return;
            // Only auto-focus once per page load to avoid re-scrolling on each
            // re-render that happens when fresh data arrives from the cache.
            if (window.__rangFocusApplied === focusManager) return;

            const target = document.querySelector(`[data-manager="${CSS.escape(focusManager)}"]`);
            if (!target) return;

            window.__rangFocusApplied = focusManager;
            requestAnimationFrame(() => {
                target.scrollIntoView({ behavior: "smooth", block: "center" });
                target.classList.add("rank-focus-highlight");
                setTimeout(() => target.classList.remove("rank-focus-highlight"), 2400);
            });
        } catch (_e) { /* ignore */ }
    }

    function getPreferredMainManager() {
        const saved = getStoredSessionValue(HISTORY_MAIN_KEY);
        if (saved && teamsByManager.has(saved)) return saved;
        const managerOptions = [...rankingTeams].sort(compareTeamsByManagerName);
        if (managerOptions.length) return managerOptions[0].manager;
        return null;
    }

    function getSavedCompareManagers() {
        try {
            const savedRaw = getStoredSessionValue(HISTORY_COMPARE_KEY) || "[]";
            const saved = JSON.parse(savedRaw);
            if (!Array.isArray(saved)) return [];
            return saved.filter(name => teamsByManager.has(name));
        } catch (e) {
            return [];
        }
    }

    function updateChartModeButtons() {
        document.getElementById("chart-mode-rank").classList.toggle("active", chartMode === "rank");
        document.getElementById("chart-mode-points").classList.toggle("active", chartMode === "points");
        document.querySelector(".history-chart-title").textContent = chartMode === "rank" ? "Rangentwicklung" : "Punkteentwicklung";
    }

    function getRoundFilterSummaryLabel() {
        if (isAllRoundsSelected()) return "Alle Runden";
        if (selectedRoundKeys.size === 0) return "Keine Runden gewählt";
        if (selectedRoundKeys.size === 1) {
            const key = [...selectedRoundKeys][0];
            const opt = ROUND_OPTIONS.find(o => o.key === key);
            return opt ? opt.label : "1 Runde gewählt";
        }
        return `${selectedRoundKeys.size} von ${ALL_ROUND_KEYS.length} Runden`;
    }

    let roundFilterOptionsRendered = false;

    function renderRoundFilterOptionsOnce() {
        const optionsEl = document.getElementById("round-filter-options");
        if (!optionsEl) return;
        if (roundFilterOptionsRendered) return;

        optionsEl.innerHTML = ROUND_OPTIONS.map(opt => {
            const checked = selectedRoundKeys.has(opt.key) ? "checked" : "";
            return `
                <label class="multi-option">
                    <input type="checkbox" value="${escapeHtml(opt.key)}" ${checked}>
                    <span>${escapeHtml(opt.label)}</span>
                </label>
            `;
        }).join("");

        roundFilterOptionsRendered = true;
    }

    function syncRoundFilterCheckboxes() {
        const optionsEl = document.getElementById("round-filter-options");
        if (!optionsEl) return;
        const inputs = optionsEl.querySelectorAll('input[type="checkbox"]');
        inputs.forEach(input => {
            const desired = selectedRoundKeys.has(input.value);
            if (input.checked !== desired) {
                input.checked = desired;
            }
        });
    }

    function renderRoundFilter() {
        const optionsEl = document.getElementById("round-filter-options");
        const labelEl = document.getElementById("round-filter-label");
        const toggleAllBtn = document.getElementById("round-filter-toggle-all");

        if (!optionsEl || !labelEl || !toggleAllBtn) return;

        // Optionen nur einmal rendern. Spaetere State-Updates werden
        // ohne DOM-Austausch ueber syncRoundFilterCheckboxes synchronisiert,
        // damit Klicks waehrend laufender Interaktion nicht verloren gehen.
        renderRoundFilterOptionsOnce();
        syncRoundFilterCheckboxes();

        labelEl.textContent = getRoundFilterSummaryLabel();
        toggleAllBtn.textContent = isAllRoundsSelected() ? "Alle abwählen" : "Alle auswählen";
    }

    function bindRoundFilterEvents() {
        const wrapper = document.getElementById("round-filter-multi");
        const toggleBtn = document.getElementById("round-filter-toggle");
        const menuEl = document.getElementById("round-filter-menu");
        const optionsEl = document.getElementById("round-filter-options");
        const toggleAllBtn = document.getElementById("round-filter-toggle-all");

        if (!wrapper || !toggleBtn || !menuEl || !optionsEl || !toggleAllBtn) return;

        toggleBtn.addEventListener("click", (e) => {
            e.stopPropagation();
            wrapper.classList.toggle("open");
        });

        // Klicks innerhalb des Menues sollen das Menue auf keinen Fall
        // schliessen – auch nicht wenn ein nachgelagerter Re-Render
        // den eigentlichen Klick-Target aus dem DOM entfernt.
        menuEl.addEventListener("click", (e) => {
            e.stopPropagation();
        });
        menuEl.addEventListener("mousedown", (e) => {
            e.stopPropagation();
        });

        optionsEl.addEventListener("change", (e) => {
            const target = e.target;
            if (!target || target.tagName !== "INPUT") return;

            const key = target.value;
            if (target.checked) {
                selectedRoundKeys.add(key);
            } else {
                selectedRoundKeys.delete(key);
            }

            persistSelectedRoundKeys();
            recomputeAndRender();
            // Menue offen halten, damit der User weitere Auswahl treffen kann.
            wrapper.classList.add("open");
        });

        toggleAllBtn.addEventListener("click", (e) => {
            e.stopPropagation();
            e.preventDefault();
            if (isAllRoundsSelected()) {
                selectedRoundKeys = new Set();
            } else {
                selectedRoundKeys = new Set(ALL_ROUND_KEYS);
            }
            persistSelectedRoundKeys();
            recomputeAndRender();
            wrapper.classList.add("open");
        });

        document.addEventListener("mousedown", (event) => {
            if (!wrapper.contains(event.target)) {
                wrapper.classList.remove("open");
            }
        });
    }

    function renderHistoryControls() {
        const mainSelect = document.getElementById("history-main-manager");
        const compareMenu = document.getElementById("compare-menu");
        const managerOptions = [...rankingTeams].sort(compareTeamsByManagerName);

        mainSelect.innerHTML = managerOptions.map(team => `
            <option value="${escapeHtml(team.manager)}">${escapeHtml(team.manager)}</option>
        `).join("");

        if (!selectedMainManager || !teamsByManager.has(selectedMainManager)) {
            selectedMainManager = getPreferredMainManager();
        }
        mainSelect.value = selectedMainManager || "";

        if (!Array.isArray(selectedCompareManagers)) selectedCompareManagers = [];
        selectedCompareManagers = selectedCompareManagers.filter(name => teamsByManager.has(name) && name !== selectedMainManager);

        compareMenu.innerHTML = managerOptions.map(team => {
            const checked = selectedCompareManagers.includes(team.manager) ? "checked" : "";
            const disabled = team.manager === selectedMainManager ? "disabled" : "";

            return `
                <label class="multi-option">
                    <input type="checkbox" value="${escapeHtml(team.manager)}" ${checked} ${disabled}>
                    <span>${escapeHtml(team.manager)}</span>
                </label>
            `;
        }).join("");

        updateCompareToggleLabel();
        updateChartModeButtons();
    }

    function updateCompareToggleLabel() {
        const label = document.getElementById("compare-toggle-label");
        if (!selectedCompareManagers.length) {
            label.textContent = "Keine weiteren Manager gewählt";
            return;
        }

        if (selectedCompareManagers.length === 1) {
            label.textContent = selectedCompareManagers[0];
            return;
        }

        label.textContent = `${selectedCompareManagers.length} Manager gewählt`;
    }

    function renderHistorySummary() {
        const team = teamsByManager.get(selectedMainManager);
        const titleEl = document.getElementById("summary-manager-name");
        const gridEl = document.getElementById("history-summary-grid");
        const pointsEl = document.getElementById("summary-total-points");

        if (!team) {
            titleEl.textContent = "-";
            pointsEl.textContent = "0 Pkt.";
            gridEl.innerHTML = "";
            return;
        }

        titleEl.textContent = team.manager;
        pointsEl.textContent = `${team.totalScore} Pkt.`;

        const fmtRank = (v) => (v === null || v === undefined ? "—" : v);
        const fmtAvg = (v) => (v === null || v === undefined ? "—" : Number(v).toFixed(1));

        gridEl.innerHTML = `
            <div class="summary-stat">
                <div class="summary-stat-title">Aktueller Rang</div>
                <div class="summary-stat-value green">${fmtRank(team.currentRank)}</div>
            </div>
            <div class="summary-stat">
                <div class="summary-stat-title">Bester Rang</div>
                <div class="summary-stat-value blue">${fmtRank(team.bestRank)}</div>
            </div>
            <div class="summary-stat">
                <div class="summary-stat-title">Tiefster Rang</div>
                <div class="summary-stat-value red">${fmtRank(team.lowestRank)}</div>
            </div>
            <div class="summary-stat">
                <div class="summary-stat-title">Durchschnittsrang</div>
                <div class="summary-stat-value gray">${fmtAvg(team.averageRank)}</div>
            </div>
            <div class="summary-stat">
                <div class="summary-stat-title">Absolvierte Spiele</div>
                <div class="summary-stat-value purple">${team.totalPlayedMatches}</div>
            </div>
            <div class="summary-stat">
                <div class="summary-stat-title">Spieler noch im Turnier</div>
                <div class="summary-stat-value orange">${team.activePlayers}</div>
            </div>
        `;
    }

    function destroyHistoryChart() {
        if (historyChart) {
            historyChart.destroy();
            historyChart = null;
        }
    }

    function getYAxisTickCallbackForRank(totalRanks) {
        return function(value) {
            if (!Number.isInteger(value)) return "";
            if (value < 1 || value > totalRanks) return "";
            if (value === 1) return "1";
            if (value % 5 === 0) return String(value);
            if (value === totalRanks && value !== 1) return String(value);
            return "";
        };
    }

    function getYAxisTickCallbackForPoints(maxValue) {
        return function(value) {
            if (!Number.isInteger(value)) return "";
            if (value === 0) return "0";
            if (value % 5 === 0) return String(value);
            if (value === maxValue && value !== 0) return String(value);
            return "";
        };
    }

    function isChartGameNavigationEnabled() {
        return window.innerWidth > 900 && window.matchMedia("(hover: hover) and (pointer: fine)").matches;
    }

    function openGameInPlayerAnalysis(gameNumber) {
        if (!gameNumber) return;
        // `matchNr` is the Spielnummer (1-based, chronological) used by the
        // schedule view to auto-expand AND scroll/focus the matching card.
        window.location.href = `spieleranalyse.html?view=games&matchNr=${encodeURIComponent(gameNumber)}`;
    }

    function getNearestGameNumberFromChartEvent(event) {
        if (!historyChart || !historyLabels.length) return null;

        const nearestElements = historyChart.getElementsAtEventForMode(
            event,
            "nearest",
            { intersect: false },
            false
        );

        if (nearestElements && nearestElements.length) {
            return nearestElements[0].index + 1;
        }

        const canvas = historyChart.canvas;
        const rect = canvas.getBoundingClientRect();
        const clickX = event.clientX - rect.left;
        const clickY = event.clientY - rect.top;

        const xScale = historyChart.scales.x;
        const chartArea = historyChart.chartArea;

        if (!xScale || !chartArea) return null;

        const withinX = clickX >= chartArea.left - 10 && clickX <= chartArea.right + 10;
        const withinY = clickY >= chartArea.top - 10 && clickY <= xScale.bottom + 26;

        if (!withinX || !withinY) return null;

        let nearestIndex = null;
        let nearestDistance = Infinity;

        historyLabels.forEach((_, idx) => {
            const pixelX = xScale.getPixelForTick(idx);
            const distance = Math.abs(pixelX - clickX);

            if (distance < nearestDistance) {
                nearestDistance = distance;
                nearestIndex = idx;
            }
        });

        if (nearestIndex === null) return null;

        const avgGap = historyLabels.length > 1
            ? Math.abs(xScale.getPixelForTick(1) - xScale.getPixelForTick(0))
            : 36;

        if (nearestDistance > Math.max(24, avgGap * 0.6)) {
            return null;
        }

        return nearestIndex + 1;
    }

    function updateHistoryChartCanvasState() {
        const canvas = document.getElementById("history-chart");
        if (!canvas) return;

        if (isChartGameNavigationEnabled() && historyChart && historyLabels.length) {
            canvas.style.cursor = "pointer";
            canvas.title = "Klick auf Punkt oder Spielnummer, um das Spiel in der Analyse zu öffnen";
        } else {
            canvas.style.cursor = "default";
            canvas.title = "";
        }
    }

    function handleHistoryChartClick(event) {
        if (!isChartGameNavigationEnabled()) return;
        if (!historyChart) return;

        const gameNumber = getNearestGameNumberFromChartEvent(event);
        if (!gameNumber) return;

        openGameInPlayerAnalysis(gameNumber);
    }

    function renderHistoryChart() {
        const canvas = document.getElementById("history-chart");
        const emptyEl = document.getElementById("history-empty");

        destroyHistoryChart();

        if (!historyLabels.length || !selectedMainManager || !teamsByManager.has(selectedMainManager)) {
            emptyEl.style.display = "block";
            updateHistoryChartCanvasState();
            return;
        }

        emptyEl.style.display = "none";

        const managersForChart = [
            selectedMainManager,
            ...selectedCompareManagers.filter(name => name !== selectedMainManager)
        ];

        const datasets = managersForChart.map((managerName, idx) => {
            const team = teamsByManager.get(managerName);
            // Eigene Linie (idx 0): Farbe aus der CSS-Variable auflösen, damit
            // sie dem Turnier-Theme folgt (WM grün, CL blau). Canvas kann kein
            // var() – deshalb den berechneten Wert lesen.
            const mainSeriesColor = (getComputedStyle(document.documentElement).getPropertyValue('--green-light').trim() || "#4ade80");
            const color = idx === 0 ? mainSeriesColor : compareChartPalette[(idx - 1) % compareChartPalette.length];

            return {
                label: managerName,
                data: team.history.map(h => chartMode === "rank" ? h.rank : h.score),
                borderColor: color,
                backgroundColor: color,
                borderWidth: idx === 0 ? 3.5 : 2.5,
                tension: 0.28,
                fill: false,
                pointRadius: idx === 0 ? 4 : 3.4,
                pointHoverRadius: idx === 0 ? 6.5 : 5.5,
                pointBackgroundColor: color,
                pointBorderColor: "#1c2333",
                pointBorderWidth: 2,
                clip: false
            };
        });

        const totalRanks = Math.max(rankingTeams.length, 1);
        const pointValues = datasets.flatMap(ds => ds.data || []);
        const maxPointsValue = Math.max(...pointValues, 0);
        const pointMaxRounded = Math.max(5, Math.ceil(maxPointsValue / 5) * 5);

        historyChart = new Chart(canvas, {
            type: "line",
            data: {
                labels: historyLabels,
                datasets
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                layout: {
                    padding: {
                        top: 16,
                        bottom: 12,
                        left: 10,
                        right: 18
                    }
                },
                interaction: {
                    mode: "nearest",
                    intersect: false
                },
                plugins: {
                    legend: {
                        display: true,
                        position: "top",
                        labels: {
                            usePointStyle: true,
                            boxWidth: 10,
                            boxHeight: 10,
                            padding: 14,
                            color: "#8b949e",
                            font: { weight: "bold" }
                        }
                    },
                    tooltip: {
                        backgroundColor: "rgba(22,27,34,0.96)",
                        borderColor: "rgba(255,255,255,0.1)",
                        borderWidth: 1,
                        titleColor: "#e6edf3",
                        bodyColor: "#8b949e",
                        padding: 12,
                        callbacks: {
                            title: (items) => {
                                if (!items.length) return "";
                                const item = items[0];
                                const manager = item.dataset && item.dataset.label;
                                const team = manager ? teamsByManager.get(manager) : null;
                                const point = team && team.history[item.dataIndex] ? team.history[item.dataIndex] : null;
                                const fixture = point ? findFixtureByMatchId(lastRawData && lastRawData.fixtures, point.matchId) : null;
                                const homeName = getFixtureTeamName(fixture, "home");
                                const awayName = getFixtureTeamName(fixture, "away");

                                if (homeName && awayName) {
                                    return `Spiel ${item.label}: ${homeName} - ${awayName}`;
                                }

                                return `Spiel ${item.label}`;
                            },
                            label: (ctx) => {
                                const manager = ctx.dataset.label;
                                const team = teamsByManager.get(manager);
                                const point = team && team.history[ctx.dataIndex] ? team.history[ctx.dataIndex] : null;
                                if (!point) return manager;

                                if (chartMode === "rank") {
                                    return `${manager}: Rang ${point.rank} • ${point.score} Pkt.`;
                                }
                                return `${manager}: ${point.score} Pkt. • Rang ${point.rank}`;
                            }
                        }
                    }
                },
                scales: {
                    x: {
                        grid: { color: "rgba(255,255,255,0.06)" },
                        ticks: {
                            color: "#8b949e",
                            autoSkip: false,
                            maxRotation: 0,
                            minRotation: 0,
                            callback: function(value, index) {
                                const number = index + 1;
                                const total = historyLabels.length;
                                if (number === 1 || number === total || number % 5 === 0) {
                                    return number;
                                }
                                return "";
                            }
                        }
                    },
                    y: chartMode === "rank" ? {
                        reverse: true,
                        min: 0.5,
                        max: totalRanks + 0.5,
                        ticks: {
                            color: "#8b949e",
                            stepSize: 1,
                            precision: 0,
                            callback: getYAxisTickCallbackForRank(totalRanks)
                        },
                        title: {
                            display: true,
                            text: "Rang",
                            color: "#8b949e",
                            font: { weight: "bold" }
                        },
                        grid: { color: "rgba(255,255,255,0.06)" }
                    } : {
                        beginAtZero: true,
                        min: 0,
                        max: pointMaxRounded,
                        ticks: {
                            color: "#8b949e",
                            stepSize: 5,
                            precision: 0,
                            callback: getYAxisTickCallbackForPoints(pointMaxRounded)
                        },
                        title: {
                            display: true,
                            text: "Punkte",
                            color: "#8b949e",
                            font: { weight: "bold" }
                        },
                        grid: { color: "rgba(255,255,255,0.06)" }
                    }
                }
            }
        });

        updateHistoryChartCanvasState();
    }

    function renderHistoryView() {
        renderHistoryControls();
        renderHistorySummary();
        renderHistoryChart();
    }

    function getStateFromUrl() {
        const params = new URLSearchParams(window.location.search);
        const view = params.get("view") === "history" ? "history" : "ranking";
        const manager = params.get("manager");
        const compareRaw = params.get("compare") || "";
        const compare = compareRaw ? compareRaw.split("|").filter(Boolean) : [];
        const mode = params.get("chart") === "points" ? "points" : "rank";

        return { view, manager, compare, mode };
    }

    function updateUrlState(push = false) {
        const params = new URLSearchParams();

        if (currentView === "history") {
            params.set("view", "history");
            if (selectedMainManager) params.set("manager", selectedMainManager);
            if (selectedCompareManagers.length) params.set("compare", selectedCompareManagers.join("|"));
            if (chartMode === "points") params.set("chart", "points");
        }

        const newUrl = window.location.pathname + (params.toString() ? `?${params.toString()}` : "");
        const stateObj = {
            view: currentView,
            manager: selectedMainManager,
            compare: [...selectedCompareManagers],
            mode: chartMode
        };

        if (push) {
            window.history.pushState(stateObj, "", newUrl);
        } else {
            window.history.replaceState(stateObj, "", newUrl);
        }

        setStoredSessionValue(VIEW_STATE_KEY, currentView);
        if (selectedMainManager) setStoredSessionValue(HISTORY_MAIN_KEY, selectedMainManager);
        setStoredSessionValue(HISTORY_COMPARE_KEY, JSON.stringify(selectedCompareManagers));
        setStoredSessionValue(CHART_MODE_KEY, chartMode);
    }

    function applyStateObject(state, shouldRender = true) {
        const fallbackView = getStoredSessionValue(VIEW_STATE_KEY) === "history" ? "history" : "ranking";
        currentView = state && state.view ? state.view : fallbackView;

        if (state && state.manager && teamsByManager.has(state.manager)) {
            selectedMainManager = state.manager;
        } else if (!selectedMainManager || !teamsByManager.has(selectedMainManager)) {
            selectedMainManager = getPreferredMainManager();
        }

        const compareCandidates = state && Array.isArray(state.compare) ? state.compare : getSavedCompareManagers();
        selectedCompareManagers = compareCandidates.filter(name => teamsByManager.has(name) && name !== selectedMainManager);

        chartMode = state && state.mode === "points"
            ? "points"
            : (getStoredSessionValue(CHART_MODE_KEY) === "points" ? "points" : "rank");

        if (shouldRender) {
            renderHistoryView();
            applyViewVisibility();
        }
    }

    function applyViewVisibility() {
        const rankingView = document.getElementById("view-ranking");
        const historyView = document.getElementById("view-history");
        const btnRanking = document.getElementById("btn-ranking");
        const btnHistory = document.getElementById("btn-history");

        if (currentView === "history") {
            rankingView.classList.remove("active");
            historyView.classList.add("active");
            btnRanking.classList.remove("active");
            btnRanking.setAttribute("aria-pressed", "false");
            btnHistory.classList.add("active");
            btnHistory.setAttribute("aria-pressed", "true");
        } else {
            historyView.classList.remove("active");
            rankingView.classList.add("active");
            btnHistory.classList.remove("active");
            btnHistory.setAttribute("aria-pressed", "false");
            btnRanking.classList.add("active");
            btnRanking.setAttribute("aria-pressed", "true");
        }
    }

    function switchTab(tabName, pushState = false) {
        currentView = tabName === "history" ? "history" : "ranking";
        if (currentView === "history") {
            renderHistoryView();
        }
        applyViewVisibility();
        updateUrlState(pushState);
    }

    function openManagerHistory(managerName) {
        if (!teamsByManager.has(managerName)) return;

        selectedMainManager = managerName;
        selectedCompareManagers = selectedCompareManagers.filter(name => name !== managerName);
        currentView = "history";

        renderHistoryView();
        applyViewVisibility();
        updateUrlState(true);
    }

    function getLatestMatchIdFromPoints(points, fixtures = {}) {
        const knownMatchIds = allMatchIdsRaw.length
            ? allMatchIdsRaw
            : extractMatchData(points || {}, fixtures).matchIds;
        return knownMatchIds.length ? knownMatchIds[knownMatchIds.length - 1] : null;
    }

    function findFixtureByMatchId(fixtures, matchId) {
        if (matchId === null || matchId === undefined) return null;
        const map = fixtures || {};
        const direct = map[matchId] || map[String(matchId)];
        if (direct && typeof direct === "object") return direct;
        const target = String(matchId);
        for (const fx of Object.values(map)) {
            if (!fx || typeof fx !== "object") continue;
            const fid = fx.fixtureId !== undefined && fx.fixtureId !== null ? String(fx.fixtureId) : null;
            if (fid === target) return fx;
        }
        return null;
    }

    /**
     * Fallback fuer Turniere ohne (vollstaendige) Fixture-Sammlung:
     * Liest die Mannschaftsnamen aus dem Resultat-String eines
     * Spiel_<matchId>-Eintrags der Punktedaten. Erwartetes Format:
     * "<HomeName> <H>:<A> <AwayName>" (z.B. "Schweiz 2 : 1 Italien").
     */
    function findTeamsFromPointsByMatchId(points, matchId) {
        if (matchId === null || matchId === undefined) return null;
        const spielKey = `Spiel_${matchId}`;
        for (const playerDoc of Object.values(points || {})) {
            if (!playerDoc || typeof playerDoc !== "object") continue;
            const spiel = playerDoc[spielKey];
            if (!spiel || typeof spiel !== "object") continue;
            const resultat = typeof spiel.Resultat === "string" ? spiel.Resultat : "";
            if (!resultat) continue;
            const m = resultat.match(/^(.+?)\s+\d+\s*:\s*\d+\s+(.+)$/);
            if (m) {
                const home = m[1].trim();
                const away = m[2].trim();
                if (home && away) return { home, away };
            }
        }
        return null;
    }

    function formatUpdatedAt(ms) {
        const d = new Date(ms);
        if (Number.isNaN(d.getTime())) return "";
        const today = new Date();
        const isSameDay = d.getFullYear() === today.getFullYear()
            && d.getMonth() === today.getMonth()
            && d.getDate() === today.getDate();
        const timeStr = d.toLocaleTimeString("de-CH", { hour: "2-digit", minute: "2-digit" });
        if (isSameDay) {
            return `Heute, ${timeStr} Uhr`;
        }
        const dateStr = d.toLocaleDateString("de-CH", { day: "2-digit", month: "2-digit", year: "numeric" });
        return `${dateStr}, ${timeStr} Uhr`;
    }

    const LIVE_FIXTURE_STATUSES = new Set(["1H", "HT", "2H", "ET", "BT", "P", "SUSP", "INT", "LIVE"]);
    const FINISHED_FIXTURE_STATUSES = new Set(["FT", "AET", "PEN"]);
    const PENDING_FIXTURE_WINDOW_MS = 4 * 60 * 60 * 1000;

    function getFixtureTeamName(fixture, side) {
        if (!fixture || typeof fixture !== "object") return "";
        const primary = side === "home" ? fixture.homeTeam : fixture.awayTeam;
        if (primary && primary.name) return String(primary.name);
        const legacyTeam = fixture.teams && fixture.teams[side];
        if (legacyTeam && legacyTeam.name) return String(legacyTeam.name);
        return "";
    }

    function getFixtureTeamLogo(fixture, side, teamName) {
        if (!fixture || typeof fixture !== "object") return getRankingNationFlag(teamName);
        const primary = side === "home" ? fixture.homeTeam : fixture.awayTeam;
        if (primary && primary.logo) return String(primary.logo);
        const legacyTeam = fixture.teams && fixture.teams[side];
        if (legacyTeam && legacyTeam.logo) return String(legacyTeam.logo);
        return getRankingNationFlag(teamName);
    }

    function getFixtureGoal(fixture, side) {
        const goals = fixture && fixture.goals;
        if (!goals || goals[side] === null || goals[side] === undefined) return 0;
        const n = Number(goals[side]);
        return Number.isFinite(n) ? n : 0;
    }

    function getFixtureId(fixture, fallbackId) {
        if (fixture && fixture.fixtureId !== undefined && fixture.fixtureId !== null) return String(fixture.fixtureId);
        if (fallbackId !== undefined && fallbackId !== null) return String(fallbackId);
        return "";
    }

    function getFixtureStatusShort(fixture) {
        return fixture && fixture.status && fixture.status.short
            ? String(fixture.status.short)
            : "";
    }

    function isFixtureFinished(fixture) {
        return FINISHED_FIXTURE_STATUSES.has(getFixtureStatusShort(fixture));
    }

    function isFixtureLive(fixture) {
        return LIVE_FIXTURE_STATUSES.has(getFixtureStatusShort(fixture));
    }

    function getFixtureKickoffMs(fixture) {
        if (!fixture || typeof fixture !== "object") return null;

        const rawTs = fixture.kickoffTimestamp;
        const numericTs = Number(rawTs);
        if (Number.isFinite(numericTs) && numericTs > 0) {
            return numericTs > 10000000000 ? numericTs : numericTs * 1000;
        }

        const rawDate = fixture.kickoffIso || fixture.date || fixture.datetime || fixture.kickoff || "";
        if (rawDate) {
            const parsed = Date.parse(rawDate);
            if (Number.isFinite(parsed)) return parsed;
        }

        return null;
    }

    function getSortedFixtureInfos(fixtures) {
        return Object.entries(fixtures || {})
            .map(([id, fixture]) => ({
                id,
                fixture,
                kickoffMs: getFixtureKickoffMs(fixture)
            }))
            .filter(item => item.fixture && typeof item.fixture === "object" && item.kickoffMs !== null)
            .sort((a, b) => {
                if (a.kickoffMs !== b.kickoffMs) return a.kickoffMs - b.kickoffMs;
                return String(getFixtureId(a.fixture, a.id)).localeCompare(String(getFixtureId(b.fixture, b.id)));
            });
    }

    function findNextFixtures(fixtures, nowMs = Date.now()) {
        const candidates = getSortedFixtureInfos(fixtures).filter(item => (
            item.kickoffMs > nowMs &&
            !isFixtureLive(item.fixture) &&
            !isFixtureFinished(item.fixture)
        ));
        if (!candidates.length) return [];
        const earliestMs = candidates[0].kickoffMs;
        return candidates.filter(item => item.kickoffMs === earliestMs);
    }

    function findPendingKickoffFixtures(fixtures, nowMs = Date.now()) {
        return getSortedFixtureInfos(fixtures).filter(item => {
            if (item.kickoffMs > nowMs) return false;
            if (isFixtureLive(item.fixture) || isFixtureFinished(item.fixture)) return false;
            return (nowMs - item.kickoffMs) <= PENDING_FIXTURE_WINDOW_MS;
        });
    }

    function isOpeningFixture(fixtures, fixtureInfo) {
        if (!fixtureInfo) return false;
        const sorted = getSortedFixtureInfos(fixtures);
        if (!sorted.length) return false;
        const firstId = getFixtureId(sorted[0].fixture, sorted[0].id);
        const currentId = getFixtureId(fixtureInfo.fixture, fixtureInfo.id);
        return String(firstId) === String(currentId);
    }

    function getFixtureSequenceNumber(fixtures, matchId) {
        const target = String(matchId);
        if (!target) return 0;
        const sorted = getSortedFixtureInfos(fixtures);
        const index = sorted.findIndex(item => String(getFixtureId(item.fixture, item.id)) === target);
        return index >= 0 ? index + 1 : 0;
    }

    function formatFixtureKickoff(ms) {
        const d = new Date(ms);
        if (Number.isNaN(d.getTime())) return "";
        const today = new Date();
        const isSameDay = d.getFullYear() === today.getFullYear()
            && d.getMonth() === today.getMonth()
            && d.getDate() === today.getDate();
        const timeStr = d.toLocaleTimeString("de-CH", { hour: "2-digit", minute: "2-digit" });
        if (isSameDay) return `Heute, ${timeStr} Uhr`;
        const dateStr = d.toLocaleDateString("de-CH", { day: "2-digit", month: "2-digit", year: "numeric" });
        return `${dateStr}, ${timeStr} Uhr`;
    }

    function getCountdownParts(diffMs) {
        const totalSeconds = Math.max(0, Math.floor(diffMs / 1000));
        const days = Math.floor(totalSeconds / 86400);
        const hours = Math.floor((totalSeconds % 86400) / 3600);
        const minutes = Math.floor((totalSeconds % 3600) / 60);
        const seconds = totalSeconds % 60;
        return { days, hours, minutes, seconds };
    }

    function formatCountdown(diffMs) {
        const { days, hours, minutes, seconds } = getCountdownParts(diffMs);
        const pad = (value) => String(value).padStart(2, "0");

        if (days > 0) {
            return `${days} Tag${days === 1 ? "" : "e"} ${pad(hours)}:${pad(minutes)}:${pad(seconds)}`;
        }

        return `${pad(hours)}:${pad(minutes)}:${pad(seconds)}`;
    }

    function buildCountdownHtml(diffMs) {
        const { days, hours, minutes, seconds } = getCountdownParts(diffMs);
        const cells = [
            { value: String(days), label: days === 1 ? "Tag" : "Tage" },
            { value: String(hours).padStart(2, "0"), label: "Std" },
            { value: String(minutes).padStart(2, "0"), label: "Min" },
            { value: String(seconds).padStart(2, "0"), label: "Sek" }
        ];

        return `<div class="rl-match-countdown" aria-hidden="true">` +
            cells.map(cell =>
                `<span class="rl-match-cd-cell">` +
                    `<span class="rl-match-cd-num">${cell.value}</span>` +
                    `<span class="rl-match-cd-label">${cell.label}</span>` +
                `</span>`
            ).join("") +
            `</div>`;
    }

    function formatElapsedSinceKickoff(kickoffMs, nowMs) {
        const minutes = Math.max(0, Math.floor((nowMs - kickoffMs) / 60000));
        if (minutes < 1) return "Anpfiff jetzt";
        if (minutes < 60) return `Seit ${minutes} Min`;
        const hours = Math.floor(minutes / 60);
        const rest = minutes % 60;
        return rest > 0 ? `Seit ${hours} Std ${rest} Min` : `Seit ${hours} Std`;
    }

    function formatFixtureScore(fixture) {
        const goals = fixture && fixture.goals;
        if (!goals || goals.home === null || goals.home === undefined || goals.away === null || goals.away === undefined) {
            return "";
        }
        const home = Number(goals.home);
        const away = Number(goals.away);
        if (!Number.isFinite(home) || !Number.isFinite(away)) return "";
        return `${home}:${away}`;
    }

    function formatLiveUpdateMarker(status) {
        const short = status && status.short ? String(status.short) : "";
        const elapsed = status && status.elapsed !== undefined && status.elapsed !== null
            ? Number(status.elapsed)
            : null;
        if (Number.isFinite(elapsed) && elapsed > 0) return `Live ${elapsed}. Min`;
        if (short === "HT") return "Halbzeit";
        if (short === "BT") return "Pause";
        if (short === "SUSP") return "Unterbrochen";
        if (short === "INT") return "Unterbrochen";
        if (short === "ET") return "Verlaengerung";
        if (short === "P") return "Elfmeterschiessen";
        return "Live";
    }

    function findLiveFixtures(fixtures) {
        const entries = Object.entries(fixtures || {});
        return entries
            .map(([id, fixture]) => ({ id, fixture }))
            .filter(item => isFixtureLive(item.fixture))
            .sort((a, b) => {
                const aTs = Number(a.fixture && a.fixture.kickoffTimestamp) || 0;
                const bTs = Number(b.fixture && b.fixture.kickoffTimestamp) || 0;
                return aTs - bTs;
            });
    }

    function buildGameAnalysisHref(matchId, fixtures) {
        const linkParams = new URLSearchParams();
        linkParams.set("view", "games");
        linkParams.set("matchId", String(matchId));
        const orderedAllMatchIds = Array.from(new Set(allMatchIdsRaw));
        let spielNr = orderedAllMatchIds.findIndex(mid => String(mid) === String(matchId)) + 1;
        if (spielNr <= 0) {
            spielNr = getFixtureSequenceNumber(fixtures, matchId);
        }
        if (spielNr > 0) linkParams.set("matchNr", String(spielNr));
        return {
            href: `spieleranalyse.html?${linkParams.toString()}`,
            labelPrefix: spielNr > 0 ? `Spiel ${spielNr}` : `Spiel #${matchId}`
        };
    }

    function buildFixtureLinkHtml(fixtureInfo, fixtures) {
        if (!fixtureInfo) return "";
        const fixture = fixtureInfo.fixture;
        const matchId = getFixtureId(fixture, fixtureInfo.id);
        const homeName = getFixtureTeamName(fixture, "home") || "Heimteam";
        const awayName = getFixtureTeamName(fixture, "away") || "Auswärtsteam";
        const link = buildGameAnalysisHref(matchId, fixtures);
        const titleText = `${link.labelPrefix}: ${homeName} - ${awayName} in der Spiele-Analyse öffnen`;

        return `<a class="rl-hero-update-game-link" href="${escapeHtml(link.href)}" ` +
            `title="${escapeHtml(titleText)}" aria-label="${escapeHtml(titleText)}">` +
            `<span class="rl-hero-update-game-label">${escapeHtml(link.labelPrefix)}:</span>` +
            `<span class="rl-hero-update-game-teams">${escapeHtml(homeName)} - ${escapeHtml(awayName)}</span>` +
            `</a>`;
    }

    function buildLiveScoreboardHtml(fixtureInfo, fixtures, minuteLabel) {
        if (!fixtureInfo) return "";
        const fixture = fixtureInfo.fixture;
        const matchId = getFixtureId(fixture, fixtureInfo.id);
        const homeName = getFixtureTeamName(fixture, "home") || "Heimteam";
        const awayName = getFixtureTeamName(fixture, "away") || "Auswaertsteam";
        const homeLogo = getFixtureTeamLogo(fixture, "home", homeName);
        const awayLogo = getFixtureTeamLogo(fixture, "away", awayName);
        const homeGoals = getFixtureGoal(fixture, "home");
        const awayGoals = getFixtureGoal(fixture, "away");
        const link = buildGameAnalysisHref(matchId, fixtures);
        const titleText = `${link.labelPrefix}: ${homeName} - ${awayName} in der Spiele-Analyse oeffnen`;
        const ariaText = `${homeName} gegen ${awayName}, ${homeGoals}:${awayGoals}, ${minuteLabel}. ${link.labelPrefix} in der Spiele-Analyse oeffnen`;

        return `<a class="rl-live-scoreboard-link" href="${escapeHtml(link.href)}" ` +
            `title="${escapeHtml(titleText)}" aria-label="${escapeHtml(ariaText)}">` +
            `<span class="rl-live-team home">` +
                `${renderRankingFlagImageHtml("rl-live-team-flag", homeLogo, getRankingNationFlag(homeName), homeName)}` +
                `<span class="rl-live-team-name">${escapeHtml(homeName)}</span>` +
            `</span>` +
            `<span class="rl-live-score-stack">` +
                `<span class="rl-live-score-main">${homeGoals}:${awayGoals}</span>` +
                `<span class="rl-live-minute-pill">${escapeHtml(minuteLabel)}</span>` +
            `</span>` +
            `<span class="rl-live-team away">` +
                `<span class="rl-live-team-name">${escapeHtml(awayName)}</span>` +
                `${renderRankingFlagImageHtml("rl-live-team-flag", awayLogo, getRankingNationFlag(awayName), awayName)}` +
            `</span>` +
            `</a>`;
    }

    function setLastUpdateCountdownActive(active) {
        if (active) {
            if (!lastUpdateCountdownTimer) {
                lastUpdateCountdownTimer = window.setInterval(() => {
                    if (lastRawData) renderLastUpdateInfo(lastRawData);
                }, 1000);
            }
            return;
        }

        if (lastUpdateCountdownTimer) {
            window.clearInterval(lastUpdateCountdownTimer);
            lastUpdateCountdownTimer = null;
        }
    }

    function renderLastUpdateInfo(data) {
        const containerEl = document.getElementById("rl-hero-update");
        const labelEl = document.getElementById("rl-hero-update-label");
        const timeEl = document.getElementById("rl-hero-update-time");
        const gameEl = document.getElementById("rl-hero-update-game");
        if (!containerEl || !timeEl || !gameEl) return;

        const meta = data && data.meta;
        const points = data && data.points;
        const fixtures = data && data.fixtures;

        const pointsUpdatedAt = meta && typeof meta.pointsUpdatedAt === "number" ? meta.pointsUpdatedAt : null;
        const fixturesUpdatedAt = meta && typeof meta.fixturesUpdatedAt === "number" ? meta.fixturesUpdatedAt : null;

        const latestMatchId = getLatestMatchIdFromPoints(points, fixtures);
        const hasRealPointMatches = latestMatchId !== null;
        const latestPointsUpdatedAt = hasRealPointMatches ? pointsUpdatedAt : null;
        const liveFixtureInfos = findLiveFixtures(fixtures);
        const nowMs = Date.now();
        const pendingFixtureInfos = liveFixtureInfos.length ? [] : findPendingKickoffFixtures(fixtures, nowMs);
        const nextFixtureInfos = liveFixtureInfos.length || pendingFixtureInfos.length ? [] : findNextFixtures(fixtures, nowMs);

        const hasLive = liveFixtureInfos.length > 0;
        const hasPending = pendingFixtureInfos.length > 0;
        const hasNext = nextFixtureInfos.length > 0;

        containerEl.classList.toggle("is-live", hasLive);
        containerEl.classList.toggle("is-countdown", hasNext);
        containerEl.classList.toggle("is-pending", hasPending);
        timeEl.removeAttribute("aria-label");
        timeEl.removeAttribute("role");
        if (labelEl) {
            labelEl.textContent = hasLive
                ? "Live Punkte-Update"
                : hasNext
                    ? (nextFixtureInfos.length > 1
                        ? "Nächste Spiele"
                        : (isOpeningFixture(fixtures, nextFixtureInfos[0]) && !hasRealPointMatches ? "Countdown zum Eröffnungsspiel" : "Nächstes Spiel"))
                    : hasPending
                        ? "Anpfiff erreicht"
                        : "Spielpunkte aktualisiert";
        }

        if (hasLive) {
            containerEl.style.display = "";
            timeEl.innerHTML = liveFixtureInfos.map(info => {
                const updateMarker = formatLiveUpdateMarker(info.fixture.status || {});
                return buildLiveScoreboardHtml(info, fixtures, updateMarker);
            }).join("");
            gameEl.innerHTML = "";
            setLastUpdateCountdownActive(false);
            return;
        }

        if (hasPending) {
            const firstPending = pendingFixtureInfos[0];
            const kickoffText = formatFixtureKickoff(firstPending.kickoffMs);

            containerEl.style.display = "";
            timeEl.textContent = formatElapsedSinceKickoff(firstPending.kickoffMs, nowMs);
            gameEl.innerHTML =
                pendingFixtureInfos.map(info => buildFixtureLinkHtml(info, fixtures)).join("") +
                (kickoffText ? `<span class="rl-hero-update-meta">Anpfiff ${escapeHtml(kickoffText)}</span>` : "");
            setLastUpdateCountdownActive(true);
            return;
        }

        if (hasNext) {
            const firstNext = nextFixtureInfos[0];
            const kickoffText = formatFixtureKickoff(firstNext.kickoffMs);
            const latestPointsMeta = latestPointsUpdatedAt
                ? `<span class="rl-hero-update-meta">Letzte Spielpunkte: ${escapeHtml(formatUpdatedAt(latestPointsUpdatedAt))}</span>`
                : "";

            containerEl.style.display = "";
            const countdownMs = firstNext.kickoffMs - nowMs;
            timeEl.setAttribute("role", "timer");
            timeEl.setAttribute("aria-label", formatCountdown(countdownMs));
            timeEl.innerHTML = buildCountdownHtml(countdownMs);
            gameEl.innerHTML =
                nextFixtureInfos.map(info => buildFixtureLinkHtml(info, fixtures)).join("") +
                (kickoffText ? `<span class="rl-hero-update-meta">Anpfiff ${escapeHtml(kickoffText)}</span>` : "") +
                latestPointsMeta;
            setLastUpdateCountdownActive(true);
            return;
        }

        if (!hasRealPointMatches) {
            containerEl.style.display = "none";
            setLastUpdateCountdownActive(false);
            return;
        }

        containerEl.style.display = "";

        if (latestPointsUpdatedAt) {
            timeEl.textContent = formatUpdatedAt(latestPointsUpdatedAt);
        } else {
            timeEl.textContent = "Spielpunkte erfasst";
        }

        const fixture = findFixtureByMatchId(fixtures, latestMatchId);

        let homeName = "";
        let awayName = "";
        if (fixture && typeof fixture === "object") {
            // Primaer das aktuelle Fixture-Schema (homeTeam/awayTeam)
            // beruecksichtigen, das von scripts/sync-fixtures.js
            // geschrieben wird. Auf das aeltere teams.home/teams.away
            // Schema nur als Fallback zurueckfallen.
            if (fixture.homeTeam && fixture.homeTeam.name) {
                homeName = String(fixture.homeTeam.name);
            } else if (fixture.teams && fixture.teams.home && fixture.teams.home.name) {
                homeName = String(fixture.teams.home.name);
            }
            if (fixture.awayTeam && fixture.awayTeam.name) {
                awayName = String(fixture.awayTeam.name);
            } else if (fixture.teams && fixture.teams.away && fixture.teams.away.name) {
                awayName = String(fixture.teams.away.name);
            }
        }

        // Fallback: Mannschaften aus Resultat-String der Punktedaten
        // ableiten (relevant fuer Turniere, in denen die
        // Fixtures-Sammlung evtl. unvollstaendig ist).
        if (!homeName || !awayName) {
            const fb = findTeamsFromPointsByMatchId(points, latestMatchId);
            if (fb) {
                if (!homeName) homeName = fb.home;
                if (!awayName) awayName = fb.away;
            }
        }

        const link = buildGameAnalysisHref(latestMatchId, fixtures);
        const scoreText = fixture ? formatFixtureScore(fixture) : "";
        const titleText = homeName && awayName
            ? `${link.labelPrefix}: ${homeName} - ${awayName} in der Spiele-Analyse öffnen`
            : `${link.labelPrefix} in der Spiele-Analyse öffnen`;

        const inner = (homeName && awayName)
            ? `<span class="rl-hero-update-game-label">${escapeHtml(link.labelPrefix)}:</span>` +
              `<span class="rl-hero-update-game-teams">${escapeHtml(homeName)} - ${escapeHtml(awayName)}</span>`
            : escapeHtml(link.labelPrefix);

        gameEl.innerHTML =
            `<a class="rl-hero-update-game-link" href="${escapeHtml(link.href)}" ` +
            `title="${escapeHtml(titleText)}" ` +
            `aria-label="${escapeHtml(titleText)}">${inner}</a>` +
            (scoreText ? `<span class="rl-hero-update-meta">Resultat ${escapeHtml(scoreText)}</span>` : "");
        setLastUpdateCountdownActive(false);
    }

    function applyRankingData(data) {
        lastRawData = data;
        matchIdRoundMap = buildMatchIdRoundMap(data.fixtures || {});

        const { matchIds: extractedMatchIds } = extractMatchData(data.points || {}, data.fixtures || {});
        allMatchIdsRaw = extractedMatchIds;

        renderLastUpdateInfo(data);

        // Diagnostik fuer manuelle Pruefung in der Browser-Konsole.
        window.__ranglisteDebug = {
            fixturesCount: Object.keys(data.fixtures || {}).length,
            pointsMatchIdsCount: allMatchIdsRaw.length,
            roundsByMatchId: Array.from(matchIdRoundMap.entries())
                .map(([mid, info]) => ({ matchId: mid, round: info.round, key: info.key })),
            uniqueRoundTexts: Array.from(new Set(
                Array.from(matchIdRoundMap.values()).map(v => v && v.round).filter(Boolean)
            )),
            unmatchedPointMatchIds: allMatchIdsRaw.filter(mid => !matchIdRoundMap.has(String(mid))),
            getSelectedRoundKeys: () => Array.from(selectedRoundKeys)
        };

        recomputeAndRender();

        const stateFromUrl = getStateFromUrl();
        applyStateObject(stateFromUrl, true);

        document.getElementById("loading").style.display = "none";
        updateUrlState(false);

        hasRenderedOnce = true;
    }

    function isServerVerifiedCacheInfo(info) {
        return !!(info && info.verifiedFromServer === true && info.stale !== true);
    }

    /* =========================================================
       CACHED-FIRST RENDERING
       Der letzte lokale Cache-Stand wird sofort angezeigt, die
       Server-Bestaetigung laeuft im Hintergrund (dezenter Pill
       unten). Zur sichtbaren Warnung eskalieren wir erst, wenn
       nach FRESHNESS_TIMEOUT_MS keine serververifizierten Daten
       angekommen sind – oder ein Refresh wirklich fehlschlaegt.
       ========================================================= */
    const FRESHNESS_TIMEOUT_MS = 5000;
    let freshnessTimerId = null;
    let hasVerifiedData = false;

    function showSyncIndicator(message) {
        let el = document.getElementById('dt-sync-indicator');
        if (!el) {
            el = document.createElement('div');
            el.id = 'dt-sync-indicator';
            el.setAttribute('role', 'status');
            document.body.appendChild(el);
        }
        el.style.cssText = 'position:fixed;left:50%;bottom:18px;transform:translateX(-50%);'
            + 'z-index:1200;padding:6px 14px;border-radius:999px;font-size:0.78rem;'
            + 'letter-spacing:0.02em;color:var(--text-muted,#cbd5e1);'
            + 'background:rgba(10,14,26,0.85);border:1px solid rgba(255,255,255,0.14);'
            + 'pointer-events:none;opacity:1;transition:opacity .25s ease;';
        el.textContent = message || 'Daten werden aktualisiert …';
        return el;
    }

    /* Nicht-destruktive Variante fuer "Offline/veraltet"-Hinweise, wenn
       bereits Inhalt sichtbar ist (die harten Fehlerpfade der Seite wuerden
       den gerenderten Stand ersetzen). */
    function showStaleNotice(message) {
        const el = showSyncIndicator(message);
        el.style.color = '#fca5a5';
        el.style.borderColor = 'rgba(248,113,113,0.45)';
    }

    function hideSyncIndicator() {
        const el = document.getElementById('dt-sync-indicator');
        if (el) el.style.opacity = '0';
    }

    function startFreshnessEscalation(onTimeout) {
        if (hasVerifiedData || freshnessTimerId) return;
        freshnessTimerId = setTimeout(() => {
            freshnessTimerId = null;
            if (!hasVerifiedData) onTimeout();
        }, FRESHNESS_TIMEOUT_MS);
    }

    function markServerVerified() {
        hasVerifiedData = true;
        if (freshnessTimerId) {
            clearTimeout(freshnessTimerId);
            freshnessTimerId = null;
        }
        hideSyncIndicator();
    }

    function cachedBundleHasContent(data) {
        if (!data) return false;
        if (Array.isArray(data.teams) && data.teams.length) return true;
        return !!(data.points && Object.keys(data.points).length);
    }

    function showFreshnessError(message) {
        const el = document.getElementById("loading");
        if (!el) return;
        el.style.display = "block";
        el.textContent = message;
    }

    function recomputeAndRender() {
        if (!lastRawData) return;

        const filteredMatchIds = getFilteredMatchIds();
        const result = buildRankingData(lastRawData, filteredMatchIds);

        rankingTeams = result.teams;
        historyLabels = result.labels;
        teamsByManager = new Map(rankingTeams.map(team => [team.manager, team]));

        renderRankingView();
        renderRoundFilter();

        if (currentView === "history") {
            renderHistoryView();
        } else {
            renderHistoryControls();
        }
    }

    function handleCompareMenuClickOutside(event) {
        const wrapper = document.getElementById("compare-multi-select");
        if (!wrapper.contains(event.target)) {
            wrapper.classList.remove("open");
        }
    }

    function bindStaticEvents() {
        bindRoundFilterEvents();
        renderRoundFilter();

        document.getElementById("btn-ranking").addEventListener("click", () => switchTab("ranking", true));
        document.getElementById("btn-history").addEventListener("click", () => switchTab("history", true));

        document.getElementById("history-main-manager").addEventListener("change", (e) => {
            selectedMainManager = e.target.value;
            selectedCompareManagers = selectedCompareManagers.filter(name => name !== selectedMainManager);
            renderHistoryView();
            updateUrlState(false);
        });

        document.getElementById("compare-toggle").addEventListener("click", () => {
            document.getElementById("compare-multi-select").classList.toggle("open");
        });

        document.getElementById("compare-menu").addEventListener("change", (e) => {
            const target = e.target;
            if (!target || target.tagName !== "INPUT") return;

            const managerName = target.value;
            if (target.checked) {
                if (!selectedCompareManagers.includes(managerName) && managerName !== selectedMainManager) {
                    selectedCompareManagers.push(managerName);
                }
            } else {
                selectedCompareManagers = selectedCompareManagers.filter(name => name !== managerName);
            }

            renderHistoryView();
            document.getElementById("compare-multi-select").classList.add("open");
            updateUrlState(false);
        });

        document.getElementById("chart-mode-rank").addEventListener("click", () => {
            chartMode = "rank";
            updateChartModeButtons();
            renderHistoryChart();
            updateUrlState(false);
        });

        document.getElementById("chart-mode-points").addEventListener("click", () => {
            chartMode = "points";
            updateChartModeButtons();
            renderHistoryChart();
            updateUrlState(false);
        });

        document.getElementById("history-chart").addEventListener("click", handleHistoryChartClick);

        document.addEventListener("click", handleCompareMenuClickOutside);

        window.addEventListener("resize", updateHistoryChartCanvasState);

        window.addEventListener("popstate", () => {
            if (!rankingTeams.length) return;
            const stateFromUrl = getStateFromUrl();
            applyStateObject(stateFromUrl, true);
        });
    }

    function applyRanglisteLockState() {
        document.body.classList.toggle('teams-locked', isTeamsLocked());
    }

    async function initRanking() {
        bindStaticEvents();
        applyRanglisteLockState();

        // Live-Umschaltung exakt zum DREAMTEAM_START: wenn die Seite
        // beim Anpfiff geöffnet ist, sollen die Avatare nicht mehr
        // 🔒-Silhouetten zeigen, sondern die echten Spieler.
        try {
            if (window.APP_CONFIG && typeof window.APP_CONFIG.onReveal === 'function') {
                window.APP_CONFIG.onReveal(() => {
                    applyRanglisteLockState();
                    if (typeof renderRankingView === 'function') {
                        renderRankingView();
                    }
                });
            }
        } catch (_) { /* ignore */ }

        // Admin-Dev-Override wirkt sofort: bei Statusänderung neu rendern.
        try {
            if (window.DreamTeamAdmin && typeof window.DreamTeamAdmin.onAdminChange === 'function') {
                window.DreamTeamAdmin.onAdminChange(() => {
                    applyRanglisteLockState();
                    if (typeof renderRankingView === 'function' && hasRenderedOnce) {
                        renderRankingView();
                    }
                });
            }
        } catch (_) { /* ignore */ }

        try {
            // bootstrap() ersetzt die alte Sequenz `getCachedBundle +
            // loadBundle + subscribeToMeta`. Damit fällt der separate
            // Meta-Read in der Initialisierung weg und nur Punkte werden
            // bei einem Versionssprung neu geladen – die Spielerliste
            // (Teams) bleibt während des Turniers im Cache.
            if (!metaUnsubscribe) {
                metaUnsubscribe = await DreamTeamCache.bootstrap({
                    ...CACHE_OPTIONS,
                    // Cached-first: letzter lokaler Stand sofort rendern,
                    // Server-Bestaetigung laeuft im Hintergrund (Pill unten).
                    renderCached: true,
                    onCachedReady: (data, info) => {
                        if (isServerVerifiedCacheInfo(info)) {
                            markServerVerified();
                            applyRankingData(data);
                            return;
                        }
                        if (cachedBundleHasContent(data)) {
                            try {
                                applyRankingData(data);
                                showSyncIndicator();
                            } catch (err) {
                                console.warn('[rangliste] Cached-Render fehlgeschlagen:', err);
                            }
                        }
                        startFreshnessEscalation(() => {
                            if (hasRenderedOnce) {
                                showStaleNotice('Warte auf Serverbestaetigung …');
                            } else {
                                hideSyncIndicator();
                                showFreshnessError(`Rangliste fuer ${TOURNAMENT_LABEL} wartet auf frische Serverdaten.`);
                            }
                        });
                    },
                    onUpdate: (data, info) => {
                        if (!isServerVerifiedCacheInfo(info)) {
                            if (hasRenderedOnce) {
                                showStaleNotice('Offline – angezeigt wird der letzte lokale Stand.');
                            } else {
                                hideSyncIndicator();
                                showFreshnessError('Offline oder Server nicht erreichbar. Es liegen noch keine lokalen Daten vor.');
                            }
                            return;
                        }
                        markServerVerified();
                        if (isMetaRefreshRunning) return;
                        isMetaRefreshRunning = true;
                        try {
                            applyRankingData(data);
                        } finally {
                            isMetaRefreshRunning = false;
                        }
                    },
                    onError: (err) => {
                        console.error("Meta-Listener Fehler:", err);
                        if (hasRenderedOnce) {
                            // Inhalt ist sichtbar → nicht-destruktiver Hinweis
                            // statt erneutem Einblenden des Loading-Blocks.
                            showStaleNotice('Aktualisierung fehlgeschlagen – letzter lokaler Stand.');
                            return;
                        }
                        hideSyncIndicator();
                        showFreshnessError(`Aktuelle Ranglistendaten fuer ${TOURNAMENT_LABEL} konnten nicht vom Server geladen werden.`);
                        document.getElementById("loading").innerHTML = `<span style="font-size:1.5rem;opacity:0.4;">⚠️</span> Fehler beim Berechnen der Rangliste für ${escapeHtml(TOURNAMENT_LABEL)}.`;
                    }
                });
            }
        } catch (e) {
            console.error(e);
            showFreshnessError(`Aktuelle Ranglistendaten fuer ${TOURNAMENT_LABEL} konnten nicht vom Server geladen werden.`);
            if (!hasRenderedOnce) {
                document.getElementById("loading").innerHTML = `<span style="font-size:1.5rem;opacity:0.4;">⚠️</span> Fehler beim Berechnen der Rangliste für ${escapeHtml(TOURNAMENT_LABEL)}.`;
            }
        }
    }

    document.addEventListener("DOMContentLoaded", initRanking);

    window.addEventListener("beforeunload", () => {
        if (typeof metaUnsubscribe === "function") {
            metaUnsubscribe();
        }
        setLastUpdateCountdownActive(false);
        document.removeEventListener("click", handleCompareMenuClickOutside);
        window.removeEventListener("resize", updateHistoryChartCanvasState);
    });
