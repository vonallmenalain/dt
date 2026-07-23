/* spieleranalyse.js – Haupt-Seitenskript, aus spieleranalyse.html extrahiert (Performance Phase 2).
   Wird als klassisches Skript an unveraenderter Position am Body-Ende geladen –
   die Ausfuehrungs-Reihenfolge relativ zu den uebrigen Skripten ist identisch. */

    /* =========================================================
       INIT – APP CONFIG
       ========================================================= */
    const APP = window.APP_CONFIG;

    if (!APP) {
        throw new Error("APP_CONFIG fehlt. Lade tournament-config.js vor spieleranalyse.html.");
    }

    const TOURNAMENT_YEAR   = APP.year;
    const TOURNAMENT_LABEL  = APP.tournamentLabel;
    const PAGE_TITLE_PREFIX = APP.pageTitlePrefix;
    const PLAYER_BATCH_SIZE = 20;

    document.title = `${PAGE_TITLE_PREFIX} - Analyse`;

    /* =========================================================
       STATE
       ========================================================= */
    let allTeams = [];
    let pointsData = {};
    let perfectTeamIds = new Set();
    let currentSort = 'pts';
    let metaUnsubscribe = null;
    let isMetaRefreshRunning = false;
    let hasRenderedOnce = false;
    let staticFiltersInitialized = false;

    let filteredPlayersCache = [];
    let renderedPlayerCount = 0;
    let playerListScrollTop = 0;

    let currentView = 'players';
    let scheduleCatalog = [];
    let currentPlayerName = null;
    let currentPlayerId = null;
    let currentScheduleNationFilter = 'ALL';
    let currentScheduleStatusFilter = 'current';
    let scheduleNationList = [];
    let currentTournamentTab = 'groups';
    let tournamentBracketZoom = 1;
    let tournamentBracketPinch = null;
    const TOURNAMENT_BRACKET_ZOOM_MIN = 0.55;
    const TOURNAMENT_BRACKET_ZOOM_MAX = 2.2;
    const TOURNAMENT_BRACKET_ZOOM_RESET = 1;
    const expandedTournamentGroups = new Set();
    const TOURNAMENT_MODE_AUTO = 'auto';
    const TOURNAMENT_MODE_MANUAL = 'manual';
    const TOURNAMENT_MANUAL_STORAGE_VERSION = 2;
    const TOURNAMENT_MANUAL_STORAGE_KEY = `dreamteamTournamentManual:${APP.key || TOURNAMENT_YEAR || 'current'}`;
    const TOURNAMENT_MANUAL_PREDICTIONS = {
        wm2026: {
            groupOrders: {
                A: ['Mexico', 'Korea Republic', 'Czechia', 'South Africa'],
                B: ['Switzerland', 'Canada', 'Bosnia and Herzegovina', 'Qatar'],
                C: ['Brazil', 'Morocco', 'Scotland', 'Haiti'],
                D: ['USA', 'Turkiye', 'Australia', 'Paraguay'],
                E: ['Germany', 'Ecuador', 'Ivory Coast', 'Curacao'],
                F: ['Netherlands', 'Japan', 'Sweden', 'Tunisia'],
                G: ['Belgium', 'Egypt', 'Iran', 'New Zealand'],
                H: ['Spain', 'Uruguay', 'Saudi Arabia', 'Cape Verde'],
                I: ['France', 'Senegal', 'Norway', 'Iraq'],
                J: ['Argentina', 'Austria', 'Algeria', 'Jordan'],
                K: ['Portugal', 'Colombia', 'DR Congo', 'Uzbekistan'],
                L: ['England', 'Croatia', 'Panama', 'Ghana']
            },
            thirdOrder: ['G', 'D', 'J', 'I', 'L', 'E', 'F', 'A', 'C', 'K', 'H', 'B']
        }
    };
    let tournamentManualState = loadTournamentManualState();
    let currentTournamentMode = tournamentManualState.mode === TOURNAMENT_MODE_MANUAL
        ? TOURNAMENT_MODE_MANUAL
        : TOURNAMENT_MODE_AUTO;
    let tournamentManualDragState = null;

    let matchCatalog = [];
    let matchByNumber = new Map();
    let playerSelectedMap = new Map();
    // Map<playerIdString, Array<{ manager: string, isCaptain: boolean }>>
    // Used to show "selected by which managers" in the expanded schedule view.
    let playerManagersMap = new Map();

    // Schedule (Spiele) expandable cards: track which match cards are
    // currently expanded and a pending focus target (e.g. when arriving
    // from a deep-link in the Rangliste).
    const expandedScheduleMatchKeys = new Set();
    let pendingScheduleFocus = null;

    // Comparisons view state
    let currentCmpTab = 'manager';
    let cmpMgrA = '';
    let cmpMgrB = '';
    let cmpPlayerA = '';
    let cmpPlayerB = '';
    let cmpHidePlayerEqual = false;
    const cmpExpandedPositions = new Set();
    let cmpWhatIfMgr = '';
    let enrichedTeamsCache = [];
    let positionAggregatesCache = null;
    // Cache the most recently applied fixtures so popstate-triggered re-renders
    // (e.g. Browser-Back) keep the schedule available without requiring a reload.
    let lastFixtures = null;

    const CACHE_OPTIONS = {
        db: APP.getDb(),
        year: TOURNAMENT_YEAR,
        allowEmptyPoints: true,
        allowEmptyFixtures: true,
        log: false
    };

    const RULES = APP.rules || {
        START: 5, SUBBED_IN: 2, SUBBED_OUT: -2,
        GOAL_GK: 10, GOAL_DEF: 7, GOAL_MID: 6, GOAL_ATT: 5,
        OWN_GOAL: -5, ASSIST_GK_DEF: 5, ASSIST_MID: 4, ASSIST_ATT: 3,
        TEAM_GOAL: 1, DEF_BASE_PTS: 6, GEGENTOR_GK_DEF: -2,
        YELLOW_CARD: -3, RED_CARD: -7, PEN_SAVED: 7, PEN_MISSED: -7,
        PEN_COMMITED: -5, PEN_WON: 3, WIN: 3, DRAW: 1, LOSS: -3
    };

    const RULE_NAMES = APP.ruleLabels || {
        START: "Startaufstellung", SUBBED_IN: "Eingewechselt", SUBBED_OUT: "Ausgewechselt",
        GOAL_GK: "Tore", GOAL_DEF: "Tore", GOAL_MID: "Tore", GOAL_ATT: "Tore",
        OWN_GOAL: "Eigentore", ASSIST_GK_DEF: "Assists", ASSIST_MID: "Assists", ASSIST_ATT: "Assists",
        TEAM_GOAL: "Tore (Mannschaft)", GEGENTOR_GK_DEF: "Gegentore",
        YELLOW_CARD: "Gelbe Karten", RED_CARD: "Rote Karten",
        PEN_SAVED: "Elfmeter gehalten", PEN_MISSED: "Elfmeter verschossen",
        PEN_COMMITED: "Elfmeter verursacht", PEN_WON: "Elfmeter herausgeholt",
        WIN: "Siege", DRAW: "Unentschieden", LOSS: "Niederlagen", DEF_BASE_PTS: "Defensiv-Basis"
    };

    const RULE_NAMES_MATCH = {
        START: "Startaufstellung", SUBBED_IN: "Eingewechselt", SUBBED_OUT: "Ausgewechselt",
        GOAL_GK: "Tor", GOAL_DEF: "Tor", GOAL_MID: "Tor", GOAL_ATT: "Tor",
        OWN_GOAL: "Eigentor", ASSIST_GK_DEF: "Assist", ASSIST_MID: "Assist", ASSIST_ATT: "Assist",
        TEAM_GOAL: "Tor (Mannschaft)", GEGENTOR_GK_DEF: "Gegentore",
        YELLOW_CARD: "Gelbe Karte", RED_CARD: "Rote Karte",
        PEN_SAVED: "Elfmeter gehalten", PEN_MISSED: "Elfmeter verschossen",
        PEN_COMMITED: "Elfmeter verursacht", PEN_WON: "Elfmeter herausgeholt",
        WIN: "Sieg", DRAW: "Unentschieden", LOSS: "Niederlage"
    };

    /* =========================================================
       UTILITIES
       ========================================================= */
    function translatePosition(pos) {
        if (!pos) return 'K.A.';
        const p = String(pos).toUpperCase();
        if (p === 'GOALKEEPER') return 'Torwart';
        if (p === 'DEFENDER') return 'Verteidiger';
        if (p === 'MIDFIELDER') return 'Mittelfeldspieler';
        if (p === 'ATTACKER' || p === 'FORWARD') return 'Stürmer';
        return pos;
    }

    function escapeHtml(text) {
        return String(text ?? '')
            .replace(/&/g, '&amp;').replace(/</g, '&lt;')
            .replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#039;');
    }

    function normalizePlayerPhotoUrl(photo) {
        const value = String(photo || '').trim();
        if (!value) return '';
        const lower = value.toLowerCase();
        if (lower === '-' || lower === 'null' || lower === 'undefined' || lower === 'n/a') return '';
        if (lower.includes('placeholder.com') || lower.includes('via.placeholder')) return '';
        return value;
    }

    function renderPlayerPhotoShell(photo, name, className, options = {}) {
        const url = normalizePlayerPhotoUrl(photo);
        const classes = ['player-photo-shell', className, url ? 'has-player-photo' : '', options.extraClass || '']
            .filter(Boolean)
            .join(' ');
        const label = name ? `Foto von ${name}` : 'Spielerfoto';
        const isCaptain = !!options.isCaptain;
        const ariaLabel = isCaptain ? `${label}, als Captain gewaehlt` : label;
        const captainTitle = options.captainTitle || 'Von einem Manager als Captain gewaehlt';
        const loading = options.loading || 'lazy';
        const width = options.width ? ` width="${escapeHtml(options.width)}"` : '';
        const height = options.height ? ` height="${escapeHtml(options.height)}"` : '';
        const img = url
            ? `<img src="${escapeHtml(url)}" alt="${escapeHtml(label)}" loading="${escapeHtml(loading)}" decoding="async"${width}${height} onerror="this.parentElement.classList.remove('has-player-photo')">`
            : '';
        const captainBadge = isCaptain
            ? `<span class="player-photo-captain-badge" title="${escapeHtml(captainTitle)}" aria-hidden="true">C</span>`
            : '';

        return `<span class="${escapeHtml(classes)}" role="img" aria-label="${escapeHtml(ariaLabel)}">${img}<span class="player-photo-placeholder" aria-hidden="true"></span>${captainBadge}</span>`;
    }

    function updateDetailPlayerPhoto(player) {
        const frame = document.getElementById('player-photo-frame');
        const photoEl = document.getElementById('detail-photo');
        if (!frame || !photoEl) return;

        const label = `Foto von ${player.Spielername}`;
        const url = normalizePlayerPhotoUrl(player.Spielerfoto);
        const captainOptions = getPlayerCaptainPhotoOptions(player['player.id']);
        frame.setAttribute('aria-label', captainOptions.isCaptain ? `${label}, als Captain gewaehlt` : label);
        photoEl.alt = label;
        photoEl.onerror = () => frame.classList.remove('has-player-photo');

        if (url) {
            frame.classList.add('has-player-photo');
            photoEl.src = url;
        } else {
            frame.classList.remove('has-player-photo');
            photoEl.removeAttribute('src');
        }

        let captainBadge = frame.querySelector('.player-photo-captain-badge');
        if (!captainOptions.isCaptain) {
            if (captainBadge) captainBadge.remove();
            return;
        }
        if (!captainBadge) {
            captainBadge = document.createElement('span');
            captainBadge.className = 'player-photo-captain-badge';
            captainBadge.setAttribute('aria-hidden', 'true');
            captainBadge.textContent = 'C';
            frame.appendChild(captainBadge);
        }
        captainBadge.title = captainOptions.captainTitle || 'Von einem Manager als Captain gewaehlt';
    }

    /* Diacritic- und sonderzeichenunabhängige Suche:
       z. B. „Vinícius Júnior“ → „vinicius junior“, „Dembélé“ → „dembele“,
       „Ødegaard“ → „odegaard“. So findet die Suche Spieler auch dann,
       wenn nur Schweizer Standardbuchstaben getippt werden. */
    function normalizeSearchText(value) {
        if (value == null) return '';
        return String(value)
            .normalize('NFD')
            .replace(/[\u0300-\u036f]/g, '')
            .replace(/ß/g, 'ss')
            .replace(/Æ/g, 'AE').replace(/æ/g, 'ae')
            .replace(/Œ/g, 'OE').replace(/œ/g, 'oe')
            .replace(/Ø/g, 'O').replace(/ø/g, 'o')
            .replace(/Ð/g, 'D').replace(/ð/g, 'd')
            .replace(/Þ/g, 'Th').replace(/þ/g, 'th')
            .replace(/Ł/g, 'L').replace(/ł/g, 'l')
            .replace(/İ/g, 'I').replace(/ı/g, 'i')
            .replace(/Ħ/g, 'H').replace(/ħ/g, 'h')
            .toLowerCase();
    }

    function getSearchTokens(value) {
        return normalizeSearchText(value).trim().split(/\s+/).filter(Boolean);
    }

    function searchMatchesAll(haystacks, tokens) {
        if (!tokens || !tokens.length) return true;
        const combined = (Array.isArray(haystacks) ? haystacks : [haystacks])
            .map(h => normalizeSearchText(h))
            .join(' ');
        return tokens.every(tok => combined.includes(tok));
    }

    /* ---------- Comparison link helpers ----------
       Player links are identified by ID whenever it is known. The name is
       only used as fallback (for legacy shapes / virtual placeholders that
       do not have an ID) to keep links functional. */
    function cmpPlayerHref(name, playerId) {
        if (playerId) return `spieleranalyse.html?playerId=${encodeURIComponent(playerId)}`;
        if (name) return `spieleranalyse.html?player=${encodeURIComponent(name)}`;
        return '';
    }
    function cmpManagerHref(name) {
        if (!name) return '';
        return `teams.html?manager=${encodeURIComponent(name)}`;
    }
    function cmpRankingHref(manager) {
        return manager ? `rangliste.html?focus=${encodeURIComponent(manager)}` : 'rangliste.html';
    }
    function cmpPlayerLink(name, inner, extraClass = '', playerId = null) {
        if (!name && !playerId) return inner;
        const cls = ('cmp-link cmp-link-player ' + extraClass).trim();
        const labelName = name || '';
        return `<a href="${cmpPlayerHref(name, playerId)}" class="${cls}" title="${escapeHtml(labelName)} in der Spieler-Analyse öffnen">${inner}</a>`;
    }
    function cmpManagerLink(name, inner, extraClass = '') {
        if (!name) return inner;
        const cls = ('cmp-link cmp-link-manager ' + extraClass).trim();
        return `<a href="${cmpManagerHref(name)}" class="${cls}" title="Team von ${escapeHtml(name)} ansehen">${inner}</a>`;
    }
    function cmpRankingLink(inner, extraClass = '', manager = '') {
        const cls = ('cmp-link cmp-link-ranking ' + extraClass).trim();
        const title = manager ? `${escapeHtml(manager)} in der Rangliste anzeigen` : 'Rangliste öffnen';
        return `<a href="${cmpRankingHref(manager)}" class="${cls}" title="${title}">${inner}</a>`;
    }
    function cmpPlayerImgLink(name, inner, playerId = null) {
        if (!name && !playerId) return inner;
        const labelName = name || '';
        return `<a href="${cmpPlayerHref(name, playerId)}" class="cmp-img-link" aria-label="${escapeHtml(labelName)} in der Spieler-Analyse öffnen" title="${escapeHtml(labelName)} in der Spieler-Analyse öffnen">${inner}</a>`;
    }
    function cmpManagerImgLink(name, inner) {
        if (!name) return inner;
        return `<a href="${cmpManagerHref(name)}" class="cmp-img-link" aria-label="Team von ${escapeHtml(name)} ansehen" title="Team von ${escapeHtml(name)} ansehen">${inner}</a>`;
    }

    function formatPoints(value) {
        const num = Number(value) || 0;
        return `${num > 0 ? '+' : ''}${num}`;
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
        if (typeof playersData === 'undefined' || !Array.isArray(playersData)) return;
        for (let i = 0; i < playersData.length; i++) {
            const pd = playersData[i];
            if (!pd) continue;
            const rawId = pd['player.id'];
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

    function getPlayerByName(name) {
        if (!name) return null;
        __dtEnsurePlayerIndexes();
        const list = __dtPlayerIndexByName.get(name);
        return list ? list[0] : null;
    }

    function getPlayerByStoredSnapshot(savedPlayer) {
        if (!savedPlayer || !savedPlayer.name) return null;
        __dtEnsurePlayerIndexes();
        const list = __dtPlayerIndexByName.get(savedPlayer.name);
        if (!list) return null;
        for (let i = 0; i < list.length; i++) {
            const p = list[i];
            if (!savedPlayer.nation || (p['Nationalteam.name'] || '') === savedPlayer.nation) return p;
        }
        return null;
    }

    function resolveStoredPlayer(savedPlayer) {
        const byId = getPlayerById(savedPlayer && savedPlayer.playerId);
        if (byId && (!savedPlayer || !savedPlayer.name || byId.Spielername === savedPlayer.name)) return byId;
        return getPlayerByStoredSnapshot(savedPlayer) || byId;
    }

    function resolvePlayerIdentity(playerId, playerName) {
        const byId = getPlayerById(playerId);
        if (byId && (!playerName || byId.Spielername === playerName)) return byId;
        return (playerName ? getPlayerByName(playerName) : null) || byId;
    }

    function prefersReducedMotion() {
        return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    }

    /* =========================================================
       MOBILE FILTER TOGGLE
       ========================================================= */
    const mobileFilterBtn = document.getElementById('mobile-filter-btn');
    const analysisSidebar = document.getElementById('analysis-sidebar');
    const mobileFilterOverlay = document.getElementById('mobile-filter-overlay');
    const mobileSidebarClose = document.getElementById('mobile-sidebar-close');

    const MOBILE_FILTER_POPUP_ID = 'spieleranalyse-mobile-filter';
    function isMobileFilterOpen() {
        return !!analysisSidebar?.classList.contains('mobile-open');
    }
    function buildAnalysisHistoryState(extra = {}) {
        return {
            view: currentView,
            player: currentPlayerName,
            playerId: currentPlayerId,
            club: document.getElementById('club-filter')?.value || 'ALL',
            scheduleNation: currentScheduleNationFilter,
            scheduleStatus: currentScheduleStatusFilter,
            tournamentTab: currentTournamentTab,
            cmpTab: currentCmpTab,
            cmpMgrA, cmpMgrB, cmpPlayerA, cmpPlayerB, cmpWhatIfMgr,
            ...(window.history.state && typeof window.history.state === 'object' ? window.history.state : {}),
            ...extra
        };
    }
    function setMobileFilterUi(isOpen) {
        analysisSidebar.classList.toggle('mobile-open', isOpen);
        document.body.classList.toggle('mobile-filter-open', isOpen);
        mobileFilterBtn.classList.toggle('open', isOpen);
        mobileFilterBtn.setAttribute('aria-expanded', String(isOpen));
    }
    function openMobileFilter({ pushHistory = true, scroll = true } = {}) {
        if (window.innerWidth > 860) return;
        const wasOpen = isMobileFilterOpen();
        setMobileFilterUi(true);
        if (pushHistory && (!wasOpen || window.history.state?.dtPopupId !== MOBILE_FILTER_POPUP_ID)) {
            window.history.pushState(buildAnalysisHistoryState({ dtPopupId: MOBILE_FILTER_POPUP_ID }), '', window.location.href);
        }
        if (scroll) requestAnimationFrame(() => scrollElementToTop(analysisSidebar, { smooth: true }));
    }
    function closeMobileFilter({ pushHistory = true } = {}) {
        const wasOpen = isMobileFilterOpen();
        setMobileFilterUi(false);
        if (!pushHistory || !wasOpen) return;
        if (window.history.state?.dtPopupId === MOBILE_FILTER_POPUP_ID) {
            window.history.pushState(buildAnalysisHistoryState({ dtPopupId: null }), '', window.location.href);
        }
    }
    mobileFilterBtn.addEventListener('click', () => {
        if (isMobileFilterOpen()) closeMobileFilter({ pushHistory: true });
        else openMobileFilter({ pushHistory: true });
    });

    

    mobileFilterOverlay?.addEventListener('click', () => closeMobileFilter({ pushHistory: true }));
    mobileSidebarClose?.addEventListener('click', () => closeMobileFilter({ pushHistory: true }));

    function getMobileFilterLabelMeta() {
        if (currentView === 'comparisons') {
            return { text: 'Vergleich wählen', flag: '', prefix: '⚔️' };
        }
        if (currentView === 'games') {
            if (currentScheduleNationFilter && currentScheduleNationFilter !== 'ALL') {
                return { text: currentScheduleNationFilter, flag: getNationFlag(currentScheduleNationFilter), prefix: '🌍' };
            }
            return { text: 'Land suchen', flag: '', prefix: '🌍' };
        }
        if (currentView === 'tournament') {
            return { text: 'Turnier', flag: '', prefix: '🏆' };
        }
        return { text: 'Spieler suchen', flag: '', prefix: '🔍' };
    }

    function updateMobileFilterButtonLabel() {
        const meta = getMobileFilterLabelMeta();
        const label = `${meta.prefix} ${meta.text}`;
        const span = mobileFilterBtn.querySelector('span');
        if (span) {
            if (meta.flag) {
                span.innerHTML = `<img src="${escapeHtml(meta.flag)}" alt="" style="width:18px;height:12px;border-radius:2px;object-fit:cover;vertical-align:-1px;margin-right:7px;">${escapeHtml(meta.text)}`;
            } else {
                span.textContent = label;
            }
        }
        mobileFilterBtn.setAttribute('aria-label', label);
    }

    /* =========================================================
       URL MANAGEMENT
       ========================================================= */
    function getStateFromUrl() {
        const params = new URLSearchParams(window.location.search);
        let viewParam = params.get('view');
        // Backward compatibility: legacy "countries" links from other pages
        // now redirect to the new comparisons section.
        if (viewParam === 'countries') viewParam = 'comparisons';
        // Preferred player addressing is by ID (?playerId=…). The legacy
        // ?player=<name> parameter is still honoured for backward
        // compatibility (e.g. bookmarks, shared links).
        const rawPlayerId = params.get('playerId') || params.get('pid') || null;
        const scheduleStatus = params.get('scheduleStatus') || 'current';
        return {
            view: ['players','comparisons','games','tournament'].includes(viewParam) ? viewParam : 'players',
            playerId: rawPlayerId,
            player: params.get('player') || null,
            club: params.get('club') || 'ALL',
            scheduleNation: params.get('scheduleNation') || 'ALL',
            scheduleStatus: ['current','upcoming','finished','all'].includes(scheduleStatus) ? scheduleStatus : 'current',
            hasScheduleStatus: params.has('scheduleStatus'),
            tournamentTab: ['groups','knockout'].includes(params.get('tourTab')) ? params.get('tourTab') : 'groups',
            matchId: params.get('matchId') || params.get('match') || null,
            matchNr: params.get('matchNr') || null,
            cmpTab: ['manager','player','whatif'].includes(params.get('cmpTab')) ? params.get('cmpTab') : 'manager',
            cmpMgrA: params.get('cmpMgrA') || '',
            cmpMgrB: params.get('cmpMgrB') || '',
            cmpPlayerA: params.get('cmpPlayerA') || '',
            cmpPlayerB: params.get('cmpPlayerB') || '',
            cmpWhatIfMgr: params.get('cmpWhatIfMgr') || ''
        };
    }

    function updateUrl(push = false) {
        const params = new URLSearchParams();

        if (currentView === 'comparisons') {
            params.set('view', 'comparisons');
            if (currentCmpTab && currentCmpTab !== 'manager') params.set('cmpTab', currentCmpTab);
            if (cmpMgrA) params.set('cmpMgrA', cmpMgrA);
            if (cmpMgrB) params.set('cmpMgrB', cmpMgrB);
            if (cmpPlayerA) params.set('cmpPlayerA', cmpPlayerA);
            if (cmpPlayerB) params.set('cmpPlayerB', cmpPlayerB);
            if (cmpWhatIfMgr) params.set('cmpWhatIfMgr', cmpWhatIfMgr);
        } else if (currentView === 'games') {
            params.set('view', 'games');
            if (currentScheduleNationFilter && currentScheduleNationFilter !== 'ALL') {
                params.set('scheduleNation', currentScheduleNationFilter);
            }
            if (currentScheduleStatusFilter && currentScheduleStatusFilter !== 'current') {
                params.set('scheduleStatus', currentScheduleStatusFilter);
            }
        } else if (currentView === 'tournament') {
            params.set('view', 'tournament');
            if (currentTournamentTab && currentTournamentTab !== 'groups') {
                params.set('tourTab', currentTournamentTab);
            }
        } else {
            // The player is addressed by ID in the URL; the name is no
            // longer written to the URL. Falls back to the name only if
            // no ID is known (e.g. unresolved legacy state).
            if (currentPlayerId) {
                params.set('playerId', currentPlayerId);
            } else if (currentPlayerName) {
                params.set('player', currentPlayerName);
            }
            const clubFilter = document.getElementById('club-filter').value;
            if (clubFilter && clubFilter !== 'ALL') {
                params.set('club', clubFilter);
            }
        }

        const url = `${window.location.pathname}${params.toString() ? '?' + params.toString() : ''}`;
        const popupState = window.history.state?.dtPopupId !== undefined
            ? { dtPopupId: window.history.state.dtPopupId }
            : {};
        const stateObj = buildAnalysisHistoryState(popupState);

        if (push) {
            window.history.pushState(stateObj, '', url);
        } else {
            window.history.replaceState(stateObj, '', url);
        }
    }

    /* =========================================================
       VIEW SWITCHING
       ========================================================= */
    function setView(viewName, push = false) {
        currentView = ['players','comparisons','games','tournament'].includes(viewName) ? viewName : 'players';

        document.getElementById('btn-view-players').classList.toggle('active', currentView === 'players');
        document.getElementById('btn-view-comparisons').classList.toggle('active', currentView === 'comparisons');
        document.getElementById('btn-view-games').classList.toggle('active', currentView === 'games');
        document.getElementById('btn-view-tournament').classList.toggle('active', currentView === 'tournament');
        document.getElementById('btn-view-players').setAttribute('aria-selected', String(currentView === 'players'));
        document.getElementById('btn-view-comparisons').setAttribute('aria-selected', String(currentView === 'comparisons'));
        document.getElementById('btn-view-games').setAttribute('aria-selected', String(currentView === 'games'));
        document.getElementById('btn-view-tournament').setAttribute('aria-selected', String(currentView === 'tournament'));
        document.getElementById('view-players').classList.toggle('active', currentView === 'players');
        document.getElementById('view-comparisons').classList.toggle('active', currentView === 'comparisons');
        document.getElementById('view-games').classList.toggle('active', currentView === 'games');
        document.getElementById('view-tournament').classList.toggle('active', currentView === 'tournament');
        document.getElementById('sidebar-players').classList.toggle('active', currentView === 'players');
        document.getElementById('sidebar-schedule').classList.toggle('active', currentView === 'games');

        // The comparisons and tournament views bring their own UI inside the main panel and
        // do not rely on the analysis sidebar. Hide the mobile filter
        // button in that case so users do not see an empty filter sheet.
        const hideSidebar = currentView === 'comparisons' || currentView === 'tournament';
        const mobileBtn = document.getElementById('mobile-filter-btn');
        if (mobileBtn) {
            mobileBtn.style.display = hideSidebar ? 'none' : '';
        }
        const sidebarEl = document.getElementById('analysis-sidebar');
        if (sidebarEl) {
            sidebarEl.style.display = hideSidebar ? 'none' : '';
        }

        // Render schedule when switching to games view
        if (currentView === 'games') {
            renderScheduleView();
            renderScheduleCountryList();
        }
        if (currentView === 'comparisons') {
            renderComparisonsView();
        }
        if (currentView === 'tournament') {
            renderTournamentView();
        }

        updateUrl(push);
        updateMobileFilterButtonLabel();
    }

    /* =========================================================
       SIDEBAR HEIGHT (desktop)
       ========================================================= */
    function syncSidebarHeight() {
        if (window.innerWidth <= 860) return;

        const sidebar = document.getElementById('analysis-sidebar');
        const mainContent = document.getElementById('main-content');
        sidebar.style.height = '';

        requestAnimationFrame(() => {
            const viewportMax = window.innerHeight - 110;
            const mainHeight = Math.ceil(mainContent.getBoundingClientRect().height);
            const target = Math.min(Math.max(mainHeight, 420), viewportMax);
            sidebar.style.height = target + 'px';
        });
    }

    function getNavigationOffset() {
        const nav = document.querySelector('body > nav.navbar');
        const navHeight = nav ? Math.ceil(nav.getBoundingClientRect().height) : 0;
        return navHeight + 8;
    }

    function scrollElementToTop(element, { smooth = true } = {}) {
        if (!element) return;
        const top = window.scrollY + element.getBoundingClientRect().top - getNavigationOffset();
        const behavior = smooth && !prefersReducedMotion() ? 'smooth' : 'auto';
        window.scrollTo({ top: Math.max(0, top), behavior });
    }

    /* =========================================================
       MOBILE: scroll to hero after player select
       ========================================================= */
    function scrollToHeroOnMobile() {
        if (window.innerWidth > 860) return;
        const hero = document.getElementById('player-hero-card');
        if (!hero) return;
        setTimeout(() => {
            scrollElementToTop(hero, { smooth: true });
        }, 80);
    }

    function jumpToFiltersOnMobile() {
        if (window.innerWidth > 860) return;
        const sidebar = analysisSidebar;
        if (!sidebar.classList.contains('mobile-open')) openMobileFilter({ pushHistory: true, scroll: false });
        sidebar.classList.remove('mobile-filter-highlight');
        void sidebar.offsetWidth;
        sidebar.classList.add('mobile-filter-highlight');
        scrollElementToTop(mobileFilterBtn, { smooth: true });
        setTimeout(() => sidebar.classList.remove('mobile-filter-highlight'), 1100);
    }

    /* =========================================================
       NATION FLAG HELPER
       ========================================================= */
    let nationFlagLookup = null;

    function normalizeNationFlagKey(value) {
        if (typeof normalizeCountryKey === 'function') return normalizeCountryKey(value);
        if (value === null || value === undefined) return '';
        return String(value)
            .normalize('NFD')
            .replace(/[\u0300-\u036f]/g, '')
            .replace(/['`´’]/g, '')
            .replace(/&/g, ' and ')
            .replace(/[^a-zA-Z0-9]+/g, ' ')
            .trim()
            .replace(/\s+/g, ' ')
            .toLowerCase();
    }

    function getNationFlagAliasNames(nationName) {
        const names = [nationName];
        if (typeof getCountryAliases === 'function') {
            names.push(...getCountryAliases(nationName));
        }
        return names.filter(Boolean);
    }

    function buildNationFlagLookup() {
        const lookup = new Map();
        const add = (name, logo) => {
            const key = normalizeNationFlagKey(name);
            if (key && logo && !lookup.has(key)) lookup.set(key, logo);
        };

        playersData.forEach(player => {
            const nation = player && player['Nationalteam.name'];
            const logo = player && player['Nationalteam.logo'];
            if (!nation || !logo) return;
            getNationFlagAliasNames(nation).forEach(name => add(name, logo));
        });

        return lookup;
    }

    function getNationFlag(nationName) {
        if (!nationName) return '';
        if (!nationFlagLookup) nationFlagLookup = buildNationFlagLookup();

        for (const name of getNationFlagAliasNames(nationName)) {
            const flag = nationFlagLookup.get(normalizeNationFlagKey(name));
            if (flag) return flag;
        }

        return '';
    }

    function handleFlagImageError(img) {
        if (!img) return;
        const fallback = img.dataset ? img.dataset.fallbackSrc : '';
        if (fallback && img.src !== fallback) {
            img.dataset.fallbackSrc = '';
            img.src = fallback;
            return;
        }
        const placeholder = document.createElement('span');
        placeholder.className = img.className || '';
        placeholder.setAttribute('aria-hidden', 'true');
        placeholder.textContent = '🏳️';
        img.replaceWith(placeholder);
    }
    window.handleFlagImageError = handleFlagImageError;

    function renderFlagImageHtml(className, primaryUrl, fallbackUrl, altText, placeholderClass = className) {
        const src = primaryUrl || fallbackUrl || '';
        if (!src) return `<span class="${escapeHtml(placeholderClass)}" aria-hidden="true">🏳️</span>`;
        const fallbackAttr = primaryUrl && fallbackUrl && primaryUrl !== fallbackUrl
            ? ` data-fallback-src="${escapeHtml(fallbackUrl)}"`
            : '';
        return `<img class="${escapeHtml(className)}" src="${escapeHtml(src)}" alt="${escapeHtml(altText || '')}" loading="lazy"${fallbackAttr} onerror="handleFlagImageError(this)">`;
    }

    /* =========================================================
       RESULT PARSING
       ========================================================= */
    function parseResultString(resultString) {
        const match = String(resultString || '').match(/^(.*?)\s+(\d+)\s*:\s*(\d+)\s+(.*?)$/);
        if (!match) return null;
        return {
            homeName: match[1].trim(), homeGoals: Number(match[2]),
            awayGoals: Number(match[3]), awayName: match[4].trim()
        };
    }

    function getOutcomeFromMatchEvents(matchObj) {
        const lineup = matchObj?.Aufstellung || {};
        if (typeof lineup.WIN === 'number' && lineup.WIN !== 0) return 'win';
        if (typeof lineup.LOSS === 'number' && lineup.LOSS !== 0) return 'loss';
        if (typeof lineup.DRAW === 'number' && lineup.DRAW !== 0) return 'draw';
        if (typeof matchObj?.WIN === 'number' && matchObj.WIN !== 0) return 'win';
        if (typeof matchObj?.LOSS === 'number' && matchObj.LOSS !== 0) return 'loss';
        if (typeof matchObj?.DRAW === 'number' && matchObj.DRAW !== 0) return 'draw';
        return null;
    }

    function getMatchVisualData(matchObj, playerNation) {
        const opponentNation = matchObj.Gegner || '';
        const parsed = parseResultString(matchObj.Resultat || '');
        const eventOutcome = getOutcomeFromMatchEvents(matchObj);
        let leftName = opponentNation || '-', rightName = playerNation || '-';
        let leftGoals = '-', rightGoals = '-';
        let resultClass = eventOutcome || 'draw';

        if (parsed) {
            if (parsed.homeName === playerNation) {
                leftName = opponentNation || parsed.awayName; rightName = playerNation;
                leftGoals = parsed.awayGoals; rightGoals = parsed.homeGoals;
            } else if (parsed.awayName === playerNation) {
                leftName = opponentNation || parsed.homeName; rightName = playerNation;
                leftGoals = parsed.homeGoals; rightGoals = parsed.awayGoals;
            } else if (parsed.homeName === opponentNation) {
                leftName = opponentNation; rightName = parsed.awayName;
                leftGoals = parsed.homeGoals; rightGoals = parsed.awayGoals;
            } else {
                leftName = parsed.homeName; rightName = parsed.awayName;
                leftGoals = parsed.homeGoals; rightGoals = parsed.awayGoals;
            }
            if (Number(rightGoals) > Number(leftGoals)) resultClass = 'win';
            else if (Number(rightGoals) < Number(leftGoals)) resultClass = 'loss';
            else resultClass = eventOutcome || 'draw';
        }

        return {
            leftName, rightName, leftGoals, rightGoals,
            leftFlag: getNationFlag(leftName), rightFlag: getNationFlag(rightName), resultClass
        };
    }

    function getNeutralMatchVisual(resultText, teamA, teamB) {
        const parsed = parseResultString(resultText || '');
        let leftName = teamA || '-', rightName = teamB || '-';
        let leftGoals = '-', rightGoals = '-';
        if (parsed) {
            leftName = parsed.homeName || leftName; rightName = parsed.awayName || rightName;
            leftGoals = parsed.homeGoals; rightGoals = parsed.awayGoals;
        }
        return {
            leftName, rightName, leftGoals, rightGoals,
            leftFlag: getNationFlag(leftName), rightFlag: getNationFlag(rightName)
        };
    }

    /* =========================================================
       PLAYER SELECTION MAP
       ========================================================= */
    function buildPlayerSelectedMap() {
        playerSelectedMap = new Map();
        playerManagersMap = new Map();
        allTeams.forEach(team => {
            const manager = team.manager || 'Unbekannt';
            (team.players || []).forEach(tp => {
                const fullP = resolveStoredPlayer(tp);
                const key = fullP ? String(fullP['player.id']) : String(tp.playerId);
                playerSelectedMap.set(key, (playerSelectedMap.get(key) || 0) + 1);
                if (!playerManagersMap.has(key)) playerManagersMap.set(key, []);
                playerManagersMap.get(key).push({ manager, isCaptain: !!tp.isCaptain });
            });
        });
        // Sort managers alphabetically; captains first within the same player for emphasis.
        playerManagersMap.forEach(list => {
            list.sort((a, b) => {
                if (a.isCaptain !== b.isCaptain) return a.isCaptain ? -1 : 1;
                return a.manager.localeCompare(b.manager, 'de');
            });
        });
    }

    function getPointDocTotal(pointDoc) {
        return window.DreamTeamPoints && typeof window.DreamTeamPoints.getPlayerTotal === 'function'
            ? window.DreamTeamPoints.getPlayerTotal(pointDoc)
            : (pointDoc && typeof pointDoc.totalPoints === 'number' ? pointDoc.totalPoints : 0);
    }

    function getPlayerTotalPoints(playerId) {
        return getPointDocTotal(pointsData[String(playerId)]);
    }

    function isTeamsLocked() {
        try {
            return !!(window.APP_CONFIG && window.APP_CONFIG.isPreStart && window.APP_CONFIG.isPreStart());
        } catch (_) { return true; }
    }

    function getManagersForPlayer(playerId) {
        // Vor Turnierstart bleiben die Draft-Entscheidungen geheim.
        if (isTeamsLocked()) return [];
        return playerManagersMap.get(String(playerId)) || [];
    }

    function isPlayerDrafted(playerId) {
        // Vor Turnierstart: niemand wurde "öffentlich" gedraftet.
        if (isTeamsLocked()) return false;
        return (playerSelectedMap.get(String(playerId)) || 0) > 0;
    }

    function getCaptainManagersForPlayer(playerId) {
        return getManagersForPlayer(playerId).filter(m => m && m.isCaptain);
    }

    function getPlayerCaptainPhotoOptions(playerId) {
        const captains = getCaptainManagersForPlayer(playerId);
        if (!captains.length) return { isCaptain: false };
        const names = captains.map(m => m.manager || 'Unbekannt').filter(Boolean);
        const captainTitle = captains.length === 1
            ? `Captain von ${names[0]}`
            : `Captain von ${captains.length} Managern: ${names.join(', ')}`;
        return { isCaptain: true, captainTitle };
    }

    /* =========================================================
       STATIC FILTERS INIT
       ========================================================= */
    function initStaticFilters() {
        if (staticFiltersInitialized) return;

        const nations = [...new Set(playersData.map(p => p['Nationalteam.name']))].filter(Boolean).sort();
        const nationSelect = document.getElementById('nation-filter');
        nations.forEach(n => {
            nationSelect.innerHTML += `<option value="${escapeHtml(n)}">${escapeHtml(n)}</option>`;
        });

        const clubs = [...new Set(playersData.map(p => p['Club.name']))]
            .filter(c => c && c !== "Vereinslos").sort();
        const clubSelect = document.getElementById('club-filter');
        clubs.forEach(c => {
            clubSelect.innerHTML += `<option value="${escapeHtml(c)}">${escapeHtml(c)}</option>`;
        });

        staticFiltersInitialized = true;
    }

    /* =========================================================
       PERFECT TEAM
       ========================================================= */
    function calculatePerfectTeamIds() {
        perfectTeamIds = new Set();
        const allPlayersWithPts = playersData.map(p => ({
            id: String(p['player.id']),
            nation: p['Nationalteam.name'],
            pos: p.Position ? p.Position.toUpperCase() : 'UNKNOWN',
            pts: getPlayerTotalPoints(p['player.id'])
        }));

        const selectedNations = new Set();
        const teamSlots = { GK: [], DEF: [], MID: [], ATT: [] };
        const maxSlots = { GK: 2, DEF: 4, MID: 5, ATT: 4 };
        const sortedAll = [...allPlayersWithPts].sort((a, b) => b.pts - a.pts);

        for (const p of sortedAll) {
            let slotKey = '';
            if (p.pos === 'GOALKEEPER') slotKey = 'GK';
            else if (p.pos === 'DEFENDER') slotKey = 'DEF';
            else if (p.pos === 'MIDFIELDER') slotKey = 'MID';
            else if (p.pos === 'ATTACKER' || p.pos === 'FORWARD') slotKey = 'ATT';
            if (slotKey && !selectedNations.has(p.nation) && teamSlots[slotKey].length < maxSlots[slotKey]) {
                teamSlots[slotKey].push(p);
                selectedNations.add(p.nation);
                perfectTeamIds.add(p.id);
            }
        }
    }

    /* =========================================================
       COUNTRY STATS
       ========================================================= */
    /* =========================================================
       MATCH CATALOG
       ========================================================= */
    function buildMatchCatalog() {
        const rawMatchMap = new Map();

        Object.entries(pointsData || {}).forEach(([playerId, docData]) => {
            const fullP = getPlayerById(playerId);
            if (!fullP) return;
            const nation = fullP['Nationalteam.name'] || '?';
            const club = fullP['Club.name'] || 'Vereinslos';

            Object.entries(docData || {}).forEach(([key, val]) => {
                if (!key.startsWith('Spiel_') || typeof val !== 'object' || !val) return;
                const rawMatchId = Number(val.MatchID);
                if (!Number.isFinite(rawMatchId)) return;

                if (!rawMatchMap.has(rawMatchId)) {
                    rawMatchMap.set(rawMatchId, {
                        rawMatchId, number: null, resultText: val.Resultat || '',
                        nations: new Set(), playersByNation: {}, outcomeByNation: {}, dateTime: val.Datum || val.Date || val.Kickoff || '', venue: val.Stadion || val.Venue || val.Ort || val.Spielort || ''
                    });
                }

                const match = rawMatchMap.get(rawMatchId);
                match.resultText = match.resultText || val.Resultat || '';
                match.nations.add(nation);
                if (val.Gegner) match.nations.add(val.Gegner);
                const outcome = getOutcomeFromMatchEvents(val);
                if (outcome) match.outcomeByNation[nation] = outcome;

                if (!match.playersByNation[nation]) match.playersByNation[nation] = [];
                match.playersByNation[nation].push({
                    playerId: String(fullP['player.id']),
                    name: fullP.Spielername, nation, club,
                    position: translatePosition(fullP.Position),
                    photo: fullP.Spielerfoto || '',
                    totalPoints: typeof val.TotalPunkte === 'number' ? val.TotalPunkte : 0,
                    drafted: isPlayerDrafted(fullP['player.id'])
                });
            });
        });

        const sortedMatchIds = Array.from(rawMatchMap.keys()).sort((a, b) => a - b);
        const catalog = [];

        sortedMatchIds.forEach((rawId, idx) => {
            const match = rawMatchMap.get(rawId);
            const parsed = parseResultString(match.resultText || '');
            const teams = parsed
                ? [parsed.homeName, parsed.awayName]
                : Array.from(match.nations).sort((a, b) => a.localeCompare(b, 'de')).slice(0, 2);
            const teamA = teams[0] || '-', teamB = teams[1] || '-';

            Object.keys(match.playersByNation).forEach(nation => {
                match.playersByNation[nation].sort((a, b) => {
                    if (b.totalPoints !== a.totalPoints) return b.totalPoints - a.totalPoints;
                    return a.name.localeCompare(b.name, 'de');
                });
            });

            catalog.push({
                rawMatchId: rawId, number: idx + 1,
                resultText: match.resultText || '', teamA, teamB, dateTime: match.dateTime || '', venue: match.venue || '',
                playersByNation: match.playersByNation, outcomeByNation: match.outcomeByNation || {}
            });
        });

        matchCatalog = catalog;
        matchByNumber = new Map(catalog.map(m => [String(m.number), m]));
    }

    /* =========================================================
       PLAYER LIST RENDERING
       ========================================================= */
    function buildFilteredPlayers() {
        const searchTokens = getSearchTokens(document.getElementById('search-input').value);
        const posFilter = document.getElementById('pos-filter').value;
        const natFilter = document.getElementById('nation-filter').value;
        const clubFilter = document.getElementById('club-filter').value;

        const filteredData = playersData.filter(p => {
            /* Deutsche Länderaliasse (siehe country-aliases.js) mit in den
               Heuhaufen aufnehmen, damit z. B. „Schweiz“ Spieler aus dem
               Nationalteam „Switzerland“ findet. */
            const nationAliases = (typeof getCountrySearchAliases === 'function')
                ? getCountrySearchAliases(p['Nationalteam.name'])
                : '';
            const matchSearch = !searchTokens.length || searchMatchesAll(
                [p.Spielername, p['Nationalteam.name'], nationAliases, p['Club.name']],
                searchTokens
            );
            const translatedPos = translatePosition(p.Position);
            const matchPos  = posFilter === 'ALL' || translatedPos === posFilter;
            const matchNat  = natFilter === 'ALL' || p['Nationalteam.name'] === natFilter;
            const matchClub = clubFilter === 'ALL' || p['Club.name'] === clubFilter;
            return matchSearch && matchPos && matchNat && matchClub;
        });

        if (currentSort === 'pts') {
            filteredData.sort((a, b) => {
                const ptsA = getPlayerTotalPoints(a['player.id']);
                const ptsB = getPlayerTotalPoints(b['player.id']);
                if (ptsB !== ptsA) return ptsB - ptsA;
                return a.Spielername.localeCompare(b.Spielername, 'de');
            });
        } else {
            filteredData.sort((a, b) => a.Spielername.localeCompare(b.Spielername, 'de'));
        }

        return filteredData;
    }

    function appendNextPlayerBatch() {
        const list = document.getElementById('player-list');
        const nextBatch = filteredPlayersCache.slice(renderedPlayerCount, renderedPlayerCount + PLAYER_BATCH_SIZE);
        if (!nextBatch.length) return;

        nextBatch.forEach(player => {
            const div = document.createElement('div');
            div.className = 'list-item';
            div.setAttribute('role', 'listitem');
            if (player.Spielername === currentPlayerName) div.classList.add('active');

            const pts = getPlayerTotalPoints(player['player.id']);
            const isDrafted = isPlayerDrafted(player['player.id']);

            div.innerHTML = `
                ${renderPlayerPhotoShell(player.Spielerfoto, player.Spielername, 'list-avatar', { width: 38, height: 38, ...getPlayerCaptainPhotoOptions(player['player.id']) })}
                <div class="list-info">
                    <div class="list-name">${escapeHtml(player.Spielername)}</div>
                    <div class="list-pos">${escapeHtml(translatePosition(player.Position))} | ${escapeHtml(player['Nationalteam.name'])}</div>
                </div>
                ${isDrafted ? '<span class="games-picked-badge" aria-label="Wurde gedraftet">Gewählt</span>' : ''}
                <div class="list-pts ${pts < 0 ? 'neg' : ''}" aria-label="${pts > 0 ? '+' : ''}${pts} Punkte">${pts > 0 ? '+' : ''}${pts}</div>
            `;

            div.onclick = () => {
                const preservedScrollTop = list.scrollTop;
                playerListScrollTop = preservedScrollTop;
                document.querySelectorAll('#player-list .list-item').forEach(el => el.classList.remove('active'));
                div.classList.add('active');
                currentPlayerId = String(player['player.id']);
                currentPlayerName = player.Spielername;
                triggerHeroSwitch(() => showPlayerDetails(player));
                updateUrl(false);
                closeMobileFilter({ pushHistory: true });

                requestAnimationFrame(() => {
                    const maxScrollTop = Math.max(0, list.scrollHeight - list.clientHeight);
                    list.scrollTop = Math.min(preservedScrollTop, maxScrollTop);
                    playerListScrollTop = list.scrollTop;
                });
            };

            list.appendChild(div);
        });

        renderedPlayerCount += nextBatch.length;
    }

    function fillPlayerListUntilScrollable(requiredScrollHeight = 0) {
        const list = document.getElementById('player-list');
        const minHeight = Math.max(list.clientHeight + 5, requiredScrollHeight);
        let safety = 0;
        while (renderedPlayerCount < filteredPlayersCache.length && list.scrollHeight <= minHeight && safety < 40) {
            appendNextPlayerBatch();
            safety++;
        }
    }

    function restorePlayerListScroll(targetScrollTop = playerListScrollTop) {
        const list = document.getElementById('player-list');
        const desiredScrollTop = Math.max(0, Number(targetScrollTop) || 0);
        const requiredScrollHeight = desiredScrollTop + list.clientHeight + 80;
        fillPlayerListUntilScrollable(requiredScrollHeight);
        const maxScrollTop = Math.max(0, list.scrollHeight - list.clientHeight);
        list.scrollTop = Math.min(desiredScrollTop, maxScrollTop);
        playerListScrollTop = list.scrollTop;
    }

    function renderPlayerList(data, preserveScroll = true) {
        const list = document.getElementById('player-list');
        const preservedScrollTop = preserveScroll ? playerListScrollTop : 0;
        list.innerHTML = '';
        filteredPlayersCache = data;
        renderedPlayerCount = 0;

        if (!data.length) {
            playerListScrollTop = 0;
            list.innerHTML = '<div class="list-empty">Keine Spieler gefunden.</div>';
            syncSidebarHeight();
            return;
        }

        appendNextPlayerBatch();
        restorePlayerListScroll(preservedScrollTop);
        syncSidebarHeight();
        requestAnimationFrame(() => restorePlayerListScroll(preservedScrollTop));
    }

    function applyFilters() {
        const filteredData = buildFilteredPlayers();
        renderPlayerList(filteredData);
        return filteredData;
    }

    /* =========================================================
       HERO SWITCH ANIMATION
       ========================================================= */
    function triggerHeroSwitch(callback) {
        if (prefersReducedMotion()) {
            callback();
            return;
        }
        const hero = document.getElementById('player-hero-card');
        if (!hero) { callback(); return; }
        hero.classList.add('is-switching');
        setTimeout(() => {
            callback();
            requestAnimationFrame(() => {
                requestAnimationFrame(() => {
                    hero.classList.remove('is-switching');
                });
            });
        }, 160);
    }

    /* =========================================================
       SHOW PLAYER DETAILS
       ========================================================= */
    function showPlayerDetails(player) {
        currentPlayerId = String(player['player.id']);
        currentPlayerName = player.Spielername;

        document.getElementById('empty-state').style.display = 'none';
        document.getElementById('detail-view').style.display = 'flex';

        updateDetailPlayerPhoto(player);

        // Glow pulse on portrait frame
        const frame = document.getElementById('player-photo-frame');
        if (!prefersReducedMotion()) {
            frame.classList.remove('glow-active');
            void frame.offsetWidth;
            frame.classList.add('glow-active');
        }

        // Name
        document.getElementById('detail-name').textContent = player.Spielername;

        // Position pill
        document.getElementById('detail-position').textContent = translatePosition(player.Position);

        // Nation
        const nationFlagEl = document.getElementById('detail-nation-flag');
        nationFlagEl.src = player['Nationalteam.logo'] || '';
        nationFlagEl.alt = `Fahne von ${player['Nationalteam.name'] || ''}`;
        document.getElementById('detail-nation-name').textContent = player['Nationalteam.name'] || '–';

        // Club
        const clubLogoEl = document.getElementById('detail-club-logo');
        clubLogoEl.src = player['Club.logo'] || '';
        clubLogoEl.alt = `Logo von ${player['Club.name'] || ''}`;
        document.getElementById('detail-club-name').textContent = player['Club.name'] || 'Vereinslos';

        // DOB
        let dob = '–';
        if (player.Geburtsdatum) {
            const parts = player.Geburtsdatum.split('T')[0].split('-');
            if (parts.length === 3) dob = `${parts[2]}.${parts[1]}.${parts[0]}`;
        }
        document.getElementById('detail-dob').textContent = dob;
        document.getElementById('detail-height').textContent = player.Groesse ? player.Groesse + ' cm' : 'K.A.';

        let foundWeight = null;
        for (let key in player) {
            if (key.toLowerCase().includes('gewicht') || key.toLowerCase().includes('weight')) {
                if (player[key]) { foundWeight = player[key]; break; }
            }
        }
        if (foundWeight && foundWeight !== "0" && foundWeight !== "null" && foundWeight !== "-") {
            let wStr = String(foundWeight).trim();
            document.getElementById('detail-weight').textContent = wStr.toLowerCase().includes('kg') ? wStr : wStr + ' kg';
        } else {
            document.getElementById('detail-weight').textContent = 'K.A.';
        }

        // Points badge
        const ptsDoc = pointsData[String(player['player.id'])];
        const totalPts = getPointDocTotal(ptsDoc);
        const badge = document.getElementById('detail-total-pts');
        badge.textContent = `${totalPts > 0 ? '+' : ''}${totalPts} Pkt.`;
        badge.className = `player-score-pill ${totalPts > 0 ? 'pos' : (totalPts < 0 ? 'neg' : 'zero')}`;

        // Managers — vor Turnierstart bleiben Draft-Entscheidungen geheim.
        const pickedBy = [];
        const captainedBy = [];
        const teamsLocked = isTeamsLocked();
        if (!teamsLocked) {
            allTeams.forEach(team => {
                const manager = team.manager || 'Unbekannt';
                const teamPlayer = (team.players || []).find(tp =>
                    String(tp.playerId) === String(player['player.id']) || tp.name === player.Spielername
                );
                if (teamPlayer) {
                    const isCaptain = !!teamPlayer.isCaptain;
                    pickedBy.push({ manager, isCaptain });
                    if (isCaptain) captainedBy.push(manager);
                }
            });
            pickedBy.sort((a, b) => {
                if (a.isCaptain !== b.isCaptain) return a.isCaptain ? -1 : 1;
                return a.manager.localeCompare(b.manager, 'de');
            });
        }

        const mgrBox = document.getElementById('detail-managers');
        if (teamsLocked) {
            mgrBox.innerHTML = '<div style="color:var(--text-muted);font-size:0.85rem;font-style:italic;">🔒 Wird mit Turnierstart enthüllt.</div>';
        } else {
            mgrBox.innerHTML = pickedBy.length > 0
                ? pickedBy.map(({ manager, isCaptain }) => {
                    const capHtml = isCaptain ? '<span class="manager-badge-cap" title="Captain" aria-hidden="true">C</span>' : '';
                    const label = isCaptain
                        ? `Team von ${manager} ansehen, Captain`
                        : `Team von ${manager} ansehen`;
                    return `<a href="teams.html?manager=${encodeURIComponent(manager)}" class="manager-badge${isCaptain ? ' is-captain' : ''}" aria-label="${escapeHtml(label)}">${capHtml}<span>${escapeHtml(manager)}</span></a>`;
                }).join('')
                : '<div style="color:var(--text-muted);font-size:0.85rem;font-style:italic;">Nicht gedraftet</div>';
        }

        // Awards + points breakdown
        const combinedPointsBox = document.getElementById('card-points-container');
        const gameBox = document.getElementById('detail-points-games');
        const awardBox = document.getElementById('award-section');

        combinedPointsBox.innerHTML = '';
        gameBox.innerHTML = '';
        awardBox.innerHTML = '';

        if (captainedBy.length > 0) {
            awardBox.innerHTML += `<div class="award-badge award-captain" title="Als Captain gewählt von: ${escapeHtml(captainedBy.join(', '))}">👑 Captain</div>`;
        }
        if (perfectTeamIds.has(String(player['player.id']))) {
            awardBox.innerHTML += `<a href="index.html" class="award-badge award-perfect" style="text-decoration:none;" title="Dieser Spieler hat es ins theoretische PerfectTeam geschafft.">🏆 PerfectTeam</a>`;
        }

        if (ptsDoc) {
            let gamesArray = [];
            let countGoals = 0, countAssists = 0, countSubbedIn = 0, countYellow = 0, countRed = 0, countErrors = 0;
            let plusEvents = [], minusEvents = [];

            let defBasePts = ptsDoc.DEF_BASE_PTS || 0;
            let gegenPts = ptsDoc.GEGENTOR_GK_DEF || 0;
            let countDefBase = RULES.DEF_BASE_PTS !== 0 ? Math.round(defBasePts / RULES.DEF_BASE_PTS) : 0;
            let countGegen = RULES.GEGENTOR_GK_DEF !== 0 && gegenPts !== 0 ? Math.round(gegenPts / RULES.GEGENTOR_GK_DEF) : 0;

            if (defBasePts > 0) {
                plusEvents.push({ name: 'Defensiv-Basis', count: countDefBase, points: defBasePts });
            } else if (defBasePts < 0) {
                minusEvents.push({ name: 'Defensiv-Basis', count: countDefBase, points: defBasePts });
            }

            if (gegenPts < 0) {
                const gegentorLabel = Math.abs(countGegen) === 1 ? 'Gegentor' : 'Gegentore';
                minusEvents.push({ name: gegentorLabel, count: Math.abs(countGegen), points: gegenPts });
            }

            Object.entries(ptsDoc).forEach(([key, val]) => {
                if (['totalPoints', 'playerName', 'lastUpdated', 'DEF_BASE_PTS', 'GEGENTOR_GK_DEF'].includes(key)) return;
                if (key.startsWith('Spiel_') && typeof val === 'object') {
                    gamesArray.push(val);
                } else if (typeof val === 'number' && val !== 0 && RULES[key]) {
                    const count = Math.round(val / RULES[key]);
                    const displayName = RULE_NAMES[key] || key;
                    const points = val;
                    if (points > 0) plusEvents.push({ name: displayName, count, points });
                    else if (points < 0) minusEvents.push({ name: displayName, count, points });
                    if (['GOAL_GK','GOAL_DEF','GOAL_MID','GOAL_ATT'].includes(key)) countGoals += count;
                    if (['ASSIST_GK_DEF','ASSIST_MID','ASSIST_ATT'].includes(key)) countAssists += count;
                    if (key === 'SUBBED_IN') countSubbedIn += count;
                    if (key === 'YELLOW_CARD') countYellow += count;
                    if (key === 'RED_CARD') countRed += count;
                    if (['OWN_GOAL','PEN_MISSED','PEN_COMMITED'].includes(key)) countErrors += count;
                }
            });

            plusEvents.sort((a, b) => b.points - a.points);
            minusEvents.sort((a, b) => a.points - b.points);

            const totalPlus  = plusEvents.reduce((sum, e) => sum + e.points, 0);
            const totalMinus = minusEvents.reduce((sum, e) => sum + e.points, 0);

            const headerRow = (color) => `
                <div class="stat-header-row">
                    <span style="flex:2;text-align:left;color:${color}">Aktion</span>
                    <span style="flex:1;text-align:center;color:${color}">Anzahl</span>
                    <span style="flex:1;text-align:right;color:${color}">Punkte</span>
                </div>`;

            const plusHTML = plusEvents.length > 0
                ? headerRow('var(--green-light)') + plusEvents.map(e => `
                    <div class="stat-row">
                        <span class="stat-name">${escapeHtml(e.name)}</span>
                        <span class="stat-count">${e.count}x</span>
                        <span class="stat-total pos">+${e.points}</span>
                    </div>`).join('')
                : '<div class="empty-cat">Noch keine Pluspunkte gesammelt.</div>';

            const minusHTML = minusEvents.length > 0
                ? headerRow('var(--red-soft)') + minusEvents.map(e => `
                    <div class="stat-row">
                        <span class="stat-name">${escapeHtml(e.name)}</span>
                        <span class="stat-count">${e.count}x</span>
                        <span class="stat-total neg">${e.points}</span>
                    </div>`).join('')
                : '<div class="empty-cat">Keine Minuspunkte! Vorbildlich.</div>';

            combinedPointsBox.innerHTML = `
                <div class="analysis-card-header" style="border-bottom:1px solid var(--glass-border);">
                    <div class="analysis-card-title">
                        <span class="act-accent" aria-hidden="true"></span>
                        📊 Punkteaufschlüsselung
                    </div>
                </div>
                <div class="taktik-header" onclick="toggleDetails(this)" aria-expanded="false">
                    <div class="taktik-grid">
                        <div class="pts-section-head">
                            <span class="pts-section-label pos">📈 Pluspunkte</span>
                            <span class="taktik-sum pos">+${totalPlus}</span>
                        </div>
                        <div class="minus-header-col pts-section-head">
                            <span class="pts-section-label neg">📉 Minuspunkte</span>
                            <div style="display:flex;align-items:center;gap:12px;">
                                <span class="taktik-sum neg">${totalMinus}</span>
                                <span class="toggle-icon" aria-hidden="true">▼</span>
                            </div>
                        </div>
                    </div>
                </div>
                <div class="taktik-content">
                    <div class="taktik-grid" style="align-items:start;padding-top:14px;">
                        <div class="card-plus">${plusHTML}</div>
                        <div class="card-minus" style="padding-left:20px;border-left:1px solid var(--glass-border);">${minusHTML}</div>
                    </div>
                </div>
            `;

            if (countGoals >= 2)   awardBox.innerHTML += `<div class="award-badge award-goleador" title="Wird ab 2 Toren im Turnier verliehen.">🔥 Goleador</div>`;
            if (countAssists >= 2) awardBox.innerHTML += `<div class="award-badge award-spielmacher" title="Wird ab 2 Assists im Turnier verliehen.">🎯 Spielmacher</div>`;
            if (countSubbedIn >= 2) awardBox.innerHTML += `<div class="award-badge award-joker" title="Wird ab 2 Einwechslungen als Joker verliehen.">🃏 Super-Joker</div>`;
            if (countRed >= 1 || countYellow >= 2) awardBox.innerHTML += `<div class="award-badge award-hitzkopf" title="Wird bei einer Roten oder ab 2 Gelben Karten verliehen.">🛑 Hitzkopf</div>`;
            if (countErrors >= 1) awardBox.innerHTML += `<div class="award-badge award-pechvogel" title="Wird bei Eigentoren oder verschossenen/verursachten Elfmetern verliehen.">🤕 Pechvogel</div>`;

            if (gamesArray.length > 0) {
                gamesArray.sort((a, b) => Number(a.MatchID) - Number(b.MatchID));

                gamesArray.forEach(val => {
                    const matchVisual  = getMatchVisualData(val, player['Nationalteam.name']);
                    const matchNumber  = getMatchNumberByRawId(val.MatchID);
                    const liveInfo = getLiveInfoForMatchId(val.MatchID);
                    const liveIndicatorHtml = liveInfo
                        ? `<div class="match-live-indicator" title="Dieses Spiel laeuft noch">${escapeHtml(liveInfo.label)}</div>`
                        : '';

                    let detailsHTML = '';
                    if (val.Aufstellung) {
                        Object.entries(val.Aufstellung).forEach(([k, v]) => {
                            if (k === 'DEF_BASE_PTS') {
                                if (v !== 0) {
                                    detailsHTML += `<div class="game-detail-row"><span>Defensiv-Basis:</span><strong>${v > 0 ? '+' : ''}${v}</strong></div>`;
                                }
                            } else if (k === 'GEGENTOR_GK_DEF') {
                                if (v !== 0) {
                                    const count = RULES.GEGENTOR_GK_DEF !== 0 ? Math.abs(Math.round(v / RULES.GEGENTOR_GK_DEF)) : 0;
                                    const label = count === 1 ? 'Gegentor' : `Gegentore ${count}x`;
                                    detailsHTML += `<div class="game-detail-row"><span>${label}:</span><strong>${v > 0 ? '+' : ''}${v}</strong></div>`;
                                }
                            } else if (v !== 0) {
                                const displayName = RULE_NAMES_MATCH[k] || k;
                                detailsHTML += `<div class="game-detail-row"><span>${escapeHtml(displayName)}:</span><strong>${v > 0 ? '+' : ''}${v}</strong></div>`;
                            }
                        });
                    }
                    if (detailsHTML === '') {
                        detailsHTML = '<div style="color:var(--text-muted);font-size:0.82rem;">Keine Punkte-Ereignisse in diesem Spiel.</div>';
                    }

                    const leftFlagHtml = matchVisual.leftFlag
                        ? `<img src="${matchVisual.leftFlag}" class="match-flag" alt="${escapeHtml(matchVisual.leftName)}" loading="lazy">`
                        : `<span class="match-flag" style="display:inline-flex;align-items:center;justify-content:center;font-size:11px;">🏳️</span>`;
                    const rightFlagHtml = matchVisual.rightFlag
                        ? `<img src="${matchVisual.rightFlag}" class="match-flag" alt="${escapeHtml(matchVisual.rightName)}" loading="lazy">`
                        : `<span class="match-flag" style="display:inline-flex;align-items:center;justify-content:center;font-size:11px;">🏳️</span>`;

                    const leftNationEncoded  = encodeURIComponent(matchVisual.leftName);
                    const rightNationEncoded = encodeURIComponent(matchVisual.rightName);

                    const card = document.createElement('div');
                    card.className = `match-card${liveInfo ? ' is-live' : ''}`;
                    card.innerHTML = `
                        <div class="match-header" onclick="toggleDetails(this)">
                            <div class="match-duel">
                                <div class="match-side">
                                    ${leftFlagHtml}
                                    <div class="match-side-copy">
                                    <button class="match-country-btn match-side-name" type="button"
                                            onclick="event.stopPropagation(); openGamesViewWithNation(decodeURIComponent('${leftNationEncoded}'), '${matchNumber || ''}')"
                                            aria-label="${escapeHtml(matchVisual.leftName)} in Spiele-Ansicht öffnen">
                                        ${escapeHtml(matchVisual.leftName)}
                                    </button>
                                    </div>
                                </div>
                                <div class="match-score ${matchVisual.resultClass}">
                                    ${matchVisual.leftGoals} : ${matchVisual.rightGoals}
                                </div>
                                <div class="match-side right">
                                    <div class="match-side-copy">
                                    <button class="match-country-btn match-side-name" type="button"
                                            onclick="event.stopPropagation(); openGamesViewWithNation(decodeURIComponent('${rightNationEncoded}'), '${matchNumber || ''}')"
                                            aria-label="${escapeHtml(matchVisual.rightName)} in Spiele-Ansicht öffnen">
                                        ${escapeHtml(matchVisual.rightName)}
                                    </button>
                                    </div>
                                    ${rightFlagHtml}
                                </div>
                            </div>
                            <div class="match-summary-right">
                                ${liveIndicatorHtml}
                                <div class="match-total ${val.TotalPunkte < 0 ? 'neg' : ''}">${val.TotalPunkte > 0 ? '+' : ''}${val.TotalPunkte} Pkt.</div>
                                <span class="toggle-icon" aria-hidden="true">▼</span>
                            </div>
                        </div>
                        <div class="match-details-content">
                            ${matchNumber ? `<div style="font-size:0.72rem;font-weight:800;color:var(--text-muted);margin-bottom:10px;">SPIEL ${matchNumber}</div>` : ''}
                            ${detailsHTML}
                        </div>
                    `;
                    gameBox.appendChild(card);
                });
            } else {
                gameBox.innerHTML = '<div style="color:var(--text-muted);padding:10px;font-style:italic;">Noch keine Spiele absolviert.</div>';
            }
        } else {
            combinedPointsBox.innerHTML = `
                <div class="analysis-card-header" style="border-bottom:1px solid var(--glass-border);">
                    <div class="analysis-card-title">
                        <span class="act-accent" aria-hidden="true"></span>
                        📊 Punkteaufschlüsselung
                    </div>
                </div>
                <div class="taktik-header" onclick="toggleDetails(this)" aria-expanded="false">
                    <div class="taktik-grid">
                        <div class="pts-section-head">
                            <span class="pts-section-label pos">📈 Pluspunkte</span>
                            <span class="taktik-sum pos">+0</span>
                        </div>
                        <div class="minus-header-col pts-section-head">
                            <span class="pts-section-label neg">📉 Minuspunkte</span>
                            <div style="display:flex;align-items:center;gap:12px;">
                                <span class="taktik-sum neg">0</span>
                                <span class="toggle-icon" aria-hidden="true">▼</span>
                            </div>
                        </div>
                    </div>
                </div>
                <div class="taktik-content">
                    <div class="empty-cat">Keine Daten vorhanden.</div>
                </div>
            `;
            gameBox.innerHTML = '<div style="color:var(--text-muted);padding:10px;font-style:italic;">Noch keine Spiele absolviert.</div>';
        }

        document.querySelectorAll('.list-item').forEach(el => {
            const nameEl = el.querySelector('.list-name');
            el.classList.toggle('active', !!nameEl && nameEl.textContent === player.Spielername);
        });

        syncSidebarHeight();
    }

    /* =========================================================
       MATCH HELPERS
       ========================================================= */
    function getMatchNumberByRawId(rawId) {
        const num = Number(rawId);
        const found = matchCatalog.find(m => Number(m.rawMatchId) === num);
        return found ? found.number : null;
    }

    /* =========================================================
       SCHEDULE NATION FILTER
       ========================================================= */
    function buildScheduleNationList() {
        const nations = new Set();
        scheduleCatalog.forEach(m => {
            if (m.teamA && m.teamA !== '-') nations.add(m.teamA);
            if (m.teamB && m.teamB !== '-') nations.add(m.teamB);
        });
        scheduleNationList = Array.from(nations).sort((a, b) => a.localeCompare(b, 'de'));
    }

    function renderScheduleCountryList() {
        const list = document.getElementById('schedule-country-list');
        if (!list) return;

        if (!scheduleNationList.length) {
            list.innerHTML = '<div class="sidebar-empty">Keine Länder gefunden.</div>';
            return;
        }

        list.innerHTML = ['ALL', ...scheduleNationList].map(nation => {
            const isAll = nation === 'ALL';
            const flagHtml = isAll
                ? `<span class="games-country-flag-small" style="display:inline-flex;align-items:center;justify-content:center;font-size:11px;">🌍</span>`
                : (() => {
                    const flag = getNationFlag(nation);
                    return flag
                        ? `<img src="${escapeHtml(flag)}" class="games-country-flag-small" alt="${escapeHtml(nation)}" loading="lazy">`
                        : `<span class="games-country-flag-small" style="display:inline-flex;align-items:center;justify-content:center;font-size:11px;">🏳️</span>`;
                })();
            const label = isAll ? 'Alle Länder' : nation;
            const isActive = currentScheduleNationFilter === nation;
            const nationEncoded = encodeURIComponent(nation);
            return `
                <div class="games-country-item ${isActive ? 'active' : ''}"
                     role="listitem"
                     onclick="selectScheduleNation(decodeURIComponent('${nationEncoded}'))"
                     aria-label="${escapeHtml(label)}">
                    <div class="games-country-left">
                        ${flagHtml}
                        <div class="games-country-name-small">${escapeHtml(label)}</div>
                    </div>
                </div>
            `;
        }).join('');
    }

    function selectScheduleNation(nation) {
        currentScheduleNationFilter = nation || 'ALL';
        renderScheduleView();
        renderScheduleCountryList();
        updateUrl(false);
        updateMobileFilterButtonLabel();
        closeMobileFilter({ pushHistory: true });
    }
    window.selectScheduleNation = selectScheduleNation;

    const OPTIMISTIC_SCHEDULE_LIVE_WINDOW_MIN = 150;
    const RECENT_SCHEDULE_FINISHED_WINDOW_MS = 48 * 60 * 60 * 1000;
    const SCHEDULE_STATUS_FILTERS = ['current', 'upcoming', 'finished', 'all'];

    function normalizeScheduleEpochMs(value) {
        if (value === undefined || value === null || value === '') return null;
        if (typeof value.toMillis === 'function') {
            const ms = Number(value.toMillis());
            return Number.isFinite(ms) && ms > 0 ? ms : null;
        }
        if (typeof value.toDate === 'function') {
            const date = value.toDate();
            const ms = date instanceof Date ? date.getTime() : NaN;
            return Number.isFinite(ms) && ms > 0 ? ms : null;
        }
        if (value instanceof Date) {
            const ms = value.getTime();
            return Number.isFinite(ms) && ms > 0 ? ms : null;
        }
        if (typeof value === 'number') {
            if (!Number.isFinite(value) || value <= 0) return null;
            return value >= 100000000000 ? value : value * 1000;
        }
        if (typeof value === 'string') {
            const raw = value.trim();
            if (!raw) return null;
            const numeric = Number(raw);
            if (Number.isFinite(numeric)) return normalizeScheduleEpochMs(numeric);
            const parsed = Date.parse(raw);
            return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
        }
        if (typeof value === 'object') {
            const seconds = Number(value.seconds ?? value._seconds);
            if (Number.isFinite(seconds) && seconds > 0) {
                const nanos = Number(value.nanoseconds ?? value._nanoseconds ?? 0);
                return seconds * 1000 + (Number.isFinite(nanos) ? Math.floor(nanos / 1000000) : 0);
            }
        }
        return null;
    }

    function firstScheduleEpochMs(values) {
        for (const value of values) {
            const ms = normalizeScheduleEpochMs(value);
            if (ms) return ms;
        }
        return null;
    }

    function getScheduleKickoffMs(match) {
        return firstScheduleEpochMs([
            match?.kickoffMs,
            match?.kickoffTimestamp,
            match?.kickoffIso,
            match?.fixture?.timestamp,
            match?.fixture?.date,
            match?.date,
            match?.datetime,
            match?.kickoff
        ]);
    }

    function getScheduleTimingState(match, referenceMs = Date.now()) {
        const statusShort = String(match?.status?.short || match?.statusShort || '').toUpperCase();
        const kickoffMs = getScheduleKickoffMs(match);
        const isFinished = ['FT', 'AET', 'PEN'].includes(statusShort);
        const explicitLive = ['1H', '2H', 'HT', 'ET', 'BT', 'P', 'SUSP', 'INT', 'LIVE'].includes(statusShort);
        const elapsedMs = kickoffMs ? referenceMs - kickoffMs : null;
        const optimisticLive = !isFinished && !explicitLive && elapsedMs !== null && elapsedMs >= 0 && elapsedMs <= OPTIMISTIC_SCHEDULE_LIVE_WINDOW_MIN * 60000;
        const updateOpen = !isFinished && !explicitLive && elapsedMs !== null && elapsedMs > OPTIMISTIC_SCHEDULE_LIVE_WINDOW_MIN * 60000;
        return {
            kickoffMs,
            isFinished,
            isLive: explicitLive || optimisticLive,
            isUpdateOpen: updateOpen
        };
    }

    function isRecentScheduleFinished(match, timingState, referenceMs = Date.now()) {
        if (!timingState?.isFinished) return false;
        const kickoffMs = timingState.kickoffMs || getScheduleKickoffMs(match);
        if (!kickoffMs) return false;
        const ageMs = referenceMs - kickoffMs;
        return ageMs >= 0 && ageMs <= RECENT_SCHEDULE_FINISHED_WINDOW_MS;
    }

    function getScheduleStatusInfo(match, referenceMs = Date.now()) {
        const statusShort = String(match?.status?.short || match?.statusShort || '').toUpperCase();
        const timingState = getScheduleTimingState(match, referenceMs);
        const isLive = timingState.isLive || ['1H', '2H', 'HT', 'ET', 'BT', 'P', 'SUSP', 'INT', 'LIVE'].includes(statusShort);
        const isUpdateOpen = timingState.isUpdateOpen;
        const hasKickoffReached = !timingState.kickoffMs || referenceMs >= timingState.kickoffMs;
        const catalogMatch = typeof findMatchCatalogForScheduleEntry === 'function'
            ? findMatchCatalogForScheduleEntry(match)
            : null;
        const hasRecordedResult = !!(catalogMatch && getScheduleScoreParts(match, catalogMatch));
        // Pre-match lineups can create a temporary "0:0" points result before
        // kickoff. Keep those games upcoming until the actual start time.
        const resultCountsAsPlayed = hasRecordedResult && hasKickoffReached;
        const isFinished = timingState.isFinished || ['FT', 'AET', 'PEN'].includes(statusShort) || (!isLive && !isUpdateOpen && resultCountsAsPlayed);
        return {
            timingState,
            isFinished,
            isLive,
            isUpdateOpen,
            isUpcoming: !isFinished && !isLive && !isUpdateOpen,
            isRecentFinished: isRecentScheduleFinished(match, { ...timingState, isFinished }, referenceMs),
            hasRecordedResult,
            resultCountsAsPlayed
        };
    }

    function formatScheduleLiveMinute(match) {
        const statusShort = String(match?.status?.short || match?.statusShort || '').toUpperCase();
        const elapsedRaw = match?.status?.elapsed ?? match?.statusElapsed;
        const elapsed = elapsedRaw !== undefined && elapsedRaw !== null ? Number(elapsedRaw) : null;
        if (Number.isFinite(elapsed) && elapsed > 0) return `Live ${elapsed}. Min`;
        if (statusShort === 'HT') return 'Halbzeit';
        if (statusShort === 'BT') return 'Pause';
        if (statusShort === 'SUSP' || statusShort === 'INT') return 'Unterbrochen';
        if (statusShort === 'ET') return 'Verlaengerung';
        if (statusShort === 'P') return 'Elfmeterschiessen';
        return 'Live';
    }

    function getLiveInfoForMatchId(matchId) {
        if (matchId === undefined || matchId === null || !scheduleCatalog.length) return null;
        const target = String(matchId);
        const match = scheduleCatalog.find(m => {
            if (!m) return false;
            return [m.id, m.fixtureId, m.gameNumber, m.matchId]
                .some(value => value !== undefined && value !== null && String(value) === target);
        });
        if (!match) return null;
        const timingState = getScheduleTimingState(match);
        if (!timingState.isLive) return null;
        return {
            match,
            label: formatScheduleLiveMinute(match)
        };
    }

    function buildScheduleCatalog(data) {
        // Prefer structured fixtures from Firestore (data.fixtures is an object keyed by fixtureId)
        const fixturesObj = data?.fixtures;
        if (fixturesObj && typeof fixturesObj === 'object' && !Array.isArray(fixturesObj) && Object.keys(fixturesObj).length > 0) {
            const fixturesArray = Object.values(fixturesObj)
                // Qualifikationsspiele (CL) ausblenden – nur echte Champions
                // League ab der Ligarunde. WM bleibt unberührt.
                .filter(f => !(APP && typeof APP.isQualificationFixture === 'function' && APP.isQualificationFixture(f)))
                .sort((a, b) => (getScheduleKickoffMs(a) || 0) - (getScheduleKickoffMs(b) || 0));

            scheduleCatalog = fixturesArray.map(f => {
                const fixtureId = f.fixtureId ?? f.apiFixtureId ?? f.id ?? f.fixture?.id;
                const kickoffMs = getScheduleKickoffMs(f);
                return {
                    id: fixtureId,
                    teamA: f.homeTeam?.name || '-',
                    teamAId: f.homeTeam?.id ?? null,
                    teamALogo: f.homeTeam?.logo || '',
                    teamB: f.awayTeam?.name || '-',
                    teamBId: f.awayTeam?.id ?? null,
                    teamBLogo: f.awayTeam?.logo || '',
                    homeTeamId: f.homeTeam?.id ?? null,
                    awayTeamId: f.awayTeam?.id ?? null,
                    date: f.kickoffIso || f.fixture?.date || '',
                    kickoffMs,
                    kickoffTimestamp: f.kickoffTimestamp || null,
                    venue: f.venue?.name || 'Spielort folgt',
                    venueCity: f.venue?.city || '',
                    venueImage: f.venue?.image || '',
                    status: f.status || (f.statusShort ? { short: f.statusShort, long: f.statusLong || '', elapsed: f.statusElapsed ?? null } : null),
                    goals: f.goals || null,
                    score: f.score || {},
                    goalEvents: Array.isArray(f.goalEvents) ? f.goalEvents : (Array.isArray(f.events) ? f.events : []),
                    round: f.league?.round || '',
                    homeWinner: f.homeTeam?.winner ?? null,
                    awayWinner: f.awayTeam?.winner ?? null
                };
            });
            return;
        }

        // Fallback: legacy explicit arrays in data
        const explicit = [data?.matches, data?.matchCatalog, data?.games].find(a => Array.isArray(a) && a.length) || [];
        if (explicit.length) {
            scheduleCatalog = explicit.map((m, i) => ({
                id: m.id || m.gameNumber || m.matchId || i + 1,
                teamA: m.teamA || m.home || m.homeTeam || '-',
                teamAId: m.teamAId ?? m.homeTeamId ?? m.homeId ?? null,
                teamALogo: '',
                teamB: m.teamB || m.away || m.awayTeam || '-',
                teamBId: m.teamBId ?? m.awayTeamId ?? m.awayId ?? null,
                teamBLogo: '',
                homeTeamId: m.homeTeamId ?? m.teamAId ?? m.homeId ?? null,
                awayTeamId: m.awayTeamId ?? m.teamBId ?? m.awayId ?? null,
                date: m.date || m.datetime || '',
                kickoffTimestamp: null,
                venue: m.venue || m.stadium || m.location || 'Spielort folgt',
                venueCity: '',
                venueImage: '',
                status: null,
                goals: null,
                score: m.score || {},
                goalEvents: Array.isArray(m.goalEvents) ? m.goalEvents : (Array.isArray(m.events) ? m.events : []),
                round: '',
                homeWinner: null,
                awayWinner: null
            }));
            return;
        }

        scheduleCatalog = matchCatalog.map(m => ({
            id: m.number,
            teamA: m.teamA,
            teamALogo: '',
            teamB: m.teamB,
            teamBLogo: '',
            date: m.dateTime || '',
            kickoffTimestamp: null,
            venue: m.venue || 'Spielort folgt',
            venueCity: '',
            venueImage: '',
            status: null,
            goals: null,
            score: {},
            goalEvents: [],
            round: '',
            homeWinner: null,
            awayWinner: null
        }));
    }

    /* ---------- Schedule helpers (shared by collapsed & expanded views) ---------- */

    // Stable key for tracking which schedule card is expanded. Uses the
    // fixture id when available, else falls back to the rawMatchId from
    // matchCatalog, else to the date+teams pairing.
    function getScheduleMatchKey(m, mc) {
        if (m && m.id !== undefined && m.id !== null) return `fx_${m.id}`;
        if (mc && mc.rawMatchId !== undefined && mc.rawMatchId !== null) return `mid_${mc.rawMatchId}`;
        return `pair_${m?.teamA || '?'}__${m?.teamB || '?'}__${m?.date || ''}`;
    }

    // Locate the matchCatalog entry that corresponds to a schedule entry.
    // First match on fixture id (== rawMatchId), then on team pairing.
    function findMatchCatalogForScheduleEntry(m) {
        if (!m) return null;
        const fxId = m.id !== undefined && m.id !== null ? Number(m.id) : null;
        if (Number.isFinite(fxId)) {
            const byId = matchCatalog.find(c => Number(c.rawMatchId) === fxId);
            if (byId) return byId;
        }
        return matchCatalog.find(c =>
            (c.teamA === m.teamA && c.teamB === m.teamB) ||
            (c.teamA === m.teamB && c.teamB === m.teamA)
        ) || null;
    }

    function findScheduleEntryForRawMatchId(rawMatchId) {
        const id = Number(rawMatchId);
        if (!Number.isFinite(id)) return null;
        return scheduleCatalog.find(match => Number(match?.id) === id) || null;
    }

    function formatScheduleSignedPoints(points) {
        const value = Number(points) || 0;
        return `${value > 0 ? '+' : ''}${value}`;
    }

    function getSchedulePointsClass(points) {
        const value = Number(points) || 0;
        if (value > 0) return 'pos';
        if (value < 0) return 'neg';
        return 'zero';
    }

    function getScheduleScoreParts(m, mc) {
        const goals = m?.goals || {};
        const score = m?.score || {};
        const fulltime = score.fulltime || score.fullTime || score.ft || {};
        const regular = score.regular || score.regularTime || {};
        const home = goals.home ?? goals.homeGoals ?? score.home ?? score.homeGoals ?? fulltime.home ?? fulltime.homeGoals ?? regular.home ?? m?.homeGoals ?? m?.scoreHome ?? m?.homeScore ?? null;
        const away = goals.away ?? goals.awayGoals ?? score.away ?? score.awayGoals ?? fulltime.away ?? fulltime.awayGoals ?? regular.away ?? m?.awayGoals ?? m?.scoreAway ?? m?.awayScore ?? null;
        if (home !== null || away !== null) return { home: home ?? 0, away: away ?? 0 };

        const parsed = mc ? parseResultString(mc.resultText || '') : null;
        if (!parsed) return null;
        return { home: parsed.homeGoals, away: parsed.awayGoals };
    }

    // Liefert den offiziellen Endstand für ein abgeschlossenes Spiel inkl.
    // Hinweis, ob nach Verlaengerung (n.V.) oder nach Elfmeterschiessen
    // (n.E.) entschieden wurde. Bei Elfmeterschiessen wird das
    // Elfmeterschiessen-Ergebnis selbst als Stand angezeigt (z.B. "3:4"),
    // sonst der Spielstand nach 90 bzw. 120 Minuten.
    function getScheduleFinalScoreInfo(m, mc) {
        const base = getScheduleScoreParts(m, mc);
        const score = m?.score || {};
        const num = v => (v === null || v === undefined || v === '' ? null : Number(v));
        const fulltime = score.fulltime || score.fullTime || score.ft || {};
        const extratime = score.extratime || score.extraTime || score.et || {};
        const penalty = score.penalty || {};

        const ftHome = num(fulltime.home ?? fulltime.homeGoals);
        const ftAway = num(fulltime.away ?? fulltime.awayGoals);
        const etHome = num(extratime.home ?? extratime.homeGoals);
        const etAway = num(extratime.away ?? extratime.awayGoals);
        const penHome = num(penalty.home ?? penalty.homeGoals);
        const penAway = num(penalty.away ?? penalty.awayGoals);

        const hasFulltime = Number.isFinite(ftHome) && Number.isFinite(ftAway);
        const hasExtratime = Number.isFinite(etHome) && Number.isFinite(etAway);
        const hasPenalty = Number.isFinite(penHome) && Number.isFinite(penAway);

        let home = hasFulltime ? ftHome : (base ? Number(base.home) : null);
        let away = hasFulltime ? ftAway : (base ? Number(base.away) : null);
        let note = '';

        if (hasExtratime) {
            // Manche Datenquellen liefern die Verlaengerung als Endstand
            // (kumulativ inkl. der ersten 90 Minuten), andere nur die in der
            // Verlaengerung erzielten Tore. Anhand der Plausibilitaet
            // unterscheiden: ein kumulativer Endstand kann fuer keine Seite
            // unter dem Stand nach 90 Minuten liegen. Sonst werden die Tore
            // der Verlaengerung zum 90-Minuten-Stand addiert.
            let etFinalHome = etHome;
            let etFinalAway = etAway;
            if (Number.isFinite(ftHome) && Number.isFinite(ftAway)) {
                const cumulativePlausible = etHome >= ftHome && etAway >= ftAway;
                etFinalHome = cumulativePlausible ? etHome : ftHome + etHome;
                etFinalAway = cumulativePlausible ? etAway : ftAway + etAway;
            }
            if (etFinalHome !== home || etFinalAway !== away) {
                home = etFinalHome;
                away = etFinalAway;
                note = 'n.V.';
            }
        }

        if (hasPenalty) {
            home = penHome;
            away = penAway;
            note = 'n.E.';
        }

        if (!Number.isFinite(home) || !Number.isFinite(away)) {
            return base ? { home: Number(base.home), away: Number(base.away), note: '' } : null;
        }
        return { home, away, note };
    }

    // Ermittelt die siegreiche Seite eines Spiels ('home'/'away'/null).
    // Nutzt bevorzugt das API-Sieger-Flag (berücksichtigt automatisch
    // Elfmeterschiessen), fällt sonst auf den Endstand zurück.
    function getScheduleMatchWinnerSide(m, mc) {
        if (typeof m?.homeWinner === 'boolean' || typeof m?.awayWinner === 'boolean') {
            if (m.homeWinner === true) return 'home';
            if (m.awayWinner === true) return 'away';
            if (m.homeWinner === false && m.awayWinner === false) return null;
        }
        const info = getScheduleFinalScoreInfo(m, mc);
        if (!info) return null;
        if (info.home > info.away) return 'home';
        if (info.away > info.home) return 'away';
        return null;
    }

    function getScheduleGoalEventName(...values) {
        for (const value of values) {
            if (value === undefined || value === null) continue;
            if (typeof value === 'object') {
                const nested = getScheduleGoalEventName(
                    value.name,
                    value.fullName,
                    value.playerName,
                    value.teamName,
                    value.displayName,
                    value.value,
                    value.stringValue
                );
                if (nested) return nested;
                continue;
            }
            const text = String(value).replace(/\s+/g, ' ').trim();
            if (text) return text;
        }
        return '';
    }

    function getScheduleGoalEventNumber(...values) {
        for (const value of values) {
            if (value === undefined || value === null || value === '') continue;
            if (typeof value === 'object') {
                const nested = getScheduleGoalEventNumber(
                    value.value,
                    value.integerValue,
                    value.doubleValue,
                    value.seconds
                );
                if (nested !== null) return nested;
                continue;
            }
            const n = Number(value);
            if (Number.isFinite(n)) return n;
        }
        return null;
    }

    function getScheduleGoalEventArray(value) {
        if (Array.isArray(value)) return value;
        if (value && typeof value === 'object') return Object.values(value).filter(Boolean);
        return [];
    }

    function shortenScheduleGoalEventPersonDisplayName(value) {
        const cleanName = getScheduleGoalEventName(value).replace(/\s*\([^)]*\)\s*/g, ' ').replace(/\s+/g, ' ').trim();
        const parts = cleanName.split(/\s+/).filter(Boolean);
        if (parts.length < 2) return cleanName;
        const first = parts[0].replace(/\./g, '');
        if (!first) return cleanName;
        return `${first.charAt(0).toUpperCase()}. ${parts.slice(1).join(' ')}`;
    }

    function formatScheduleGoalEventPersonName(value) {
        return shortenScheduleGoalEventPersonDisplayName(value);
    }

    function normalizeSchedulePersonLookupName(value) {
        return String(value || '')
            .normalize('NFD')
            .replace(/[\u0300-\u036f]/g, '')
            .replace(/\./g, '')
            .replace(/\s+/g, ' ')
            .trim()
            .toLowerCase();
    }

    function getSchedulePlayerShortName(player) {
        const fullName = player && player.Spielername ? String(player.Spielername).trim() : '';
        const parts = fullName.split(/\s+/).filter(Boolean);
        if (parts.length < 2) return fullName;
        return `${parts[0].charAt(0)} ${parts.slice(1).join(' ')}`;
    }

    function findScheduleGoalEventPlayer(playerId, displayName, teamName) {
        const cleanName = formatScheduleGoalEventPersonName(displayName);
        const byIdentity = resolvePlayerIdentity(playerId, cleanName);
        if (byIdentity) return byIdentity;
        if (!cleanName) return null;

        const targetName = normalizeSchedulePersonLookupName(cleanName);
        const teamKey = normalizeScheduleTeamKey(teamName);
        const candidates = playersData.filter(player => {
            if (!player) return false;
            if (teamKey && normalizeScheduleTeamKey(player['Nationalteam.name']) !== teamKey) return false;
            const full = normalizeSchedulePersonLookupName(player.Spielername);
            const short = normalizeSchedulePersonLookupName(getSchedulePlayerShortName(player));
            const last = normalizeSchedulePersonLookupName(String(player.Spielername || '').split(/\s+/).filter(Boolean).slice(-1)[0] || '');
            return targetName === full || targetName === short || (!!last && targetName === last);
        });
        return candidates.length === 1 ? candidates[0] : null;
    }

    function renderScheduleGoalPerson(name, playerId, teamName, className) {
        const displayName = formatScheduleGoalEventPersonName(name) || getScheduleGoalEventName(name);
        if (!displayName) return '';
        const player = findScheduleGoalEventPlayer(playerId, displayName, teamName);
        if (!player) return escapeHtml(displayName);

        const idEncoded = encodeURIComponent(String(player['player.id']));
        const nameEncoded = encodeURIComponent(player.Spielername);
        const title = `${player.Spielername} in der Spieler-Analyse öffnen`;
        return `<button type="button" class="${className}" onclick="event.stopPropagation(); openPlayerFromGames(decodeURIComponent('${idEncoded}'), decodeURIComponent('${nameEncoded}'))" onkeydown="event.stopPropagation()" title="${escapeHtml(title)}" aria-label="${escapeHtml(title)}">${escapeHtml(displayName)}</button>`;
    }

    function normalizeScheduleTeamKey(value) {
        if (typeof getCanonicalCountryKey === 'function') return getCanonicalCountryKey(value);
        return normalizeNationFlagKey(value);
    }

    function normalizeScheduleGoalEvent(raw) {
        const time = raw?.time || {};
        const team = raw?.team || {};
        const player = raw?.player || {};
        const assist = raw?.assist || {};
        return {
            elapsed: getScheduleGoalEventNumber(raw?.elapsed, raw?.minute, time.elapsed, time.minute),
            extra: getScheduleGoalEventNumber(raw?.extra, time.extra),
            teamId: getScheduleGoalEventName(raw?.teamId, team.id),
            teamName: getScheduleGoalEventName(raw?.teamName, team.name, team),
            playerId: getScheduleGoalEventName(raw?.playerId, player.id),
            playerName: getScheduleGoalEventName(raw?.playerName, player.name, player),
            assistId: getScheduleGoalEventName(raw?.assistId, assist.id),
            assistName: getScheduleGoalEventName(raw?.assistName, assist.name, assist),
            detail: getScheduleGoalEventName(raw?.detail),
            type: getScheduleGoalEventName(raw?.type),
            comments: getScheduleGoalEventName(raw?.comments)
        };
    }

    // Liefert die Elfmeterschiessen-Bilanz eines Spiels (z. B. {home:2, away:3})
    // oder null, wenn kein Elfmeterschiessen stattgefunden hat.
    function getSchedulePenaltyShootout(match) {
        const score = match?.score || {};
        const penalty = score.penalty || {};
        const num = v => (v === null || v === undefined || v === '' ? null : Number(v));
        const home = num(penalty.home ?? penalty.homeGoals);
        const away = num(penalty.away ?? penalty.awayGoals);
        if (Number.isFinite(home) && Number.isFinite(away)) return { home, away };
        return null;
    }

    // Erkennt Tore aus dem Elfmeterschiessen. Diese sollen NICHT als
    // Torschuetzen des Spiels aufgelistet werden, damit alle Spiele mit
    // Elfmeterschiessen gleich dargestellt werden (die Datenlage der
    // Schuetzen ist zwischen den Spielen uneinheitlich). Der Anbieter
    // verbucht Elfmeterschiessen-Schuesse am Ende der Verlaengerung
    // (elapsed 120) mit hochzaehlendem "extra"-Wert und nur dann, wenn das
    // Spiel tatsaechlich ins Elfmeterschiessen ging. Ein in der regulaeren
    // Spiel-/Verlaengerungszeit verwandelter Elfmeter behaelt seine echte
    // Spielminute und wird dadurch nicht ausgeblendet.
    function isSchedulePenaltyShootoutEvent(event, match) {
        if (!event) return false;
        const comments = String(event.comments || '').toLowerCase();
        if (comments.includes('shootout') || comments.includes('elfmeterschie')) return true;
        if (!isSchedulePenaltyGoalEvent(event)) return false;
        return Number(event.elapsed) === 120 && !!getSchedulePenaltyShootout(match);
    }

    function getScheduleGoalEvents(match) {
        const storedGoalEvents = getScheduleGoalEventArray(match?.goalEvents);
        const source = storedGoalEvents.length
            ? storedGoalEvents
            : getScheduleGoalEventArray(match?.events).filter((event) => {
                const type = String(event?.type || '').toLowerCase();
                const detail = String(event?.detail || '').toLowerCase();
                return type === 'goal' && !detail.includes('missed');
            });

        return source
            .map(normalizeScheduleGoalEvent)
            .filter((event) => event.playerName
                && !String(event.detail || '').toLowerCase().includes('missed')
                && !isSchedulePenaltyShootoutEvent(event, match))
            .sort((a, b) => {
                const elapsedA = a.elapsed ?? 999;
                const elapsedB = b.elapsed ?? 999;
                if (elapsedA !== elapsedB) return elapsedA - elapsedB;
                const extraA = a.extra ?? 0;
                const extraB = b.extra ?? 0;
                if (extraA !== extraB) return extraA - extraB;
                return a.playerName.localeCompare(b.playerName, 'de');
            });
    }

    function formatScheduleGoalMinute(event) {
        if (!Number.isFinite(event.elapsed)) return '';
        return `${event.elapsed}${Number.isFinite(event.extra) && event.extra > 0 ? '+' + event.extra : ''}'`;
    }

    function isScheduleOwnGoalEvent(event) {
        return String(event?.detail || '').toLowerCase().includes('own goal');
    }

    function isSchedulePenaltyGoalEvent(event) {
        const detail = String(event?.detail || '').toLowerCase();
        const type = String(event?.type || '').toLowerCase();
        return detail.includes('penalty') || type.includes('penalty');
    }

    function getScheduleTeamIdsForName(match, teamName) {
        const teamKey = normalizeScheduleTeamKey(teamName);
        const ids = [];
        if (teamKey && normalizeScheduleTeamKey(match?.teamA) === teamKey) {
            ids.push(match?.teamAId, match?.homeTeamId, match?.homeId);
        }
        if (teamKey && normalizeScheduleTeamKey(match?.teamB) === teamKey) {
            ids.push(match?.teamBId, match?.awayTeamId, match?.awayId);
        }
        return new Set(ids.filter(value => value !== undefined && value !== null && value !== '').map(value => String(value)));
    }

    function renderScheduleGoalEventList(match, teamName, classPrefix = 'sc') {
        const teamKey = normalizeScheduleTeamKey(teamName);
        const teamIds = getScheduleTeamIdsForName(match, teamName);
        const events = getScheduleGoalEvents(match).filter((event) => {
            if (event.teamId && teamIds.has(String(event.teamId))) return true;
            const eventTeamKey = normalizeScheduleTeamKey(event.teamName);
            return eventTeamKey && eventTeamKey === teamKey;
        });
        if (!events.length) return '';

        const rows = events.map((event) => {
            const minute = formatScheduleGoalMinute(event);
            const scorer = formatScheduleGoalEventPersonName(event.playerName) || event.playerName;
            const assist = formatScheduleGoalEventPersonName(event.assistName);
            const scorerHtml = renderScheduleGoalPerson(scorer, event.playerId, event.teamName || teamName, `${classPrefix}-goal-player`);
            const penaltyHtml = isSchedulePenaltyGoalEvent(event)
                ? ` <span class="${classPrefix}-goal-penalty">(P)</span>`
                : '';
            const assistPlayerHtml = assist
                ? renderScheduleGoalPerson(assist, event.assistId, event.teamName || teamName, `${classPrefix}-goal-assist-player`)
                : '';
            const assistHtml = assist
                ? ` <span class="${classPrefix}-goal-assist">(${assistPlayerHtml || escapeHtml(assist)})</span>`
                : (isScheduleOwnGoalEvent(event) ? ` <span class="${classPrefix}-goal-own">(Eigentor)</span>` : '');
            return `<div class="${classPrefix}-goal-row">${minute ? `<span class="${classPrefix}-goal-minute">${escapeHtml(minute)}</span>` : ''}<span class="${classPrefix}-goal-text"><span class="${classPrefix}-goal-line">${scorerHtml || escapeHtml(scorer)}${penaltyHtml}${assistHtml}</span></span></div>`;
        }).join('');

        return `<div class="${classPrefix}-goals-list" aria-label="Torschuetzen ${escapeHtml(teamName)}">${rows}</div>`;
    }

    function refreshScheduleGoalLineOverflow(root = document) {
        const scope = root && typeof root.querySelectorAll === 'function' ? root : document;
        const apply = () => {
            scope.querySelectorAll('.sc-goal-text, .match-goal-text').forEach((textEl) => {
                const lineEl = textEl.querySelector('.sc-goal-line, .match-goal-line');
                const isVisible = textEl.getClientRects().length > 0 && textEl.clientWidth > 0;
                const isOverflowing = isVisible && lineEl && lineEl.scrollWidth > textEl.clientWidth + 1;
                textEl.classList.toggle('has-scroll', !!isOverflowing);
            });
        };
        apply();
        requestAnimationFrame(apply);
    }

    function getScheduleDisplayMatchNumber(m, mc) {
        const idx = scheduleCatalog.indexOf(m);
        if (idx >= 0) return idx + 1;
        if (mc && mc.number) return mc.number;
        return null;
    }

    function getScheduleDraftedPointsSummary(players, hasMatchData) {
        if (!hasMatchData) return { total: 0, count: 0 };
        return (players || []).reduce((acc, p) => {
            if (!p) return acc;
            acc.total += Number(p.totalPoints) || 0;
            acc.count += 1;
            return acc;
        }, { total: 0, count: 0 });
    }

    function getDraftedPlayersForScheduleTeam(m, mc, teamName) {
        // Prefer drafted players from a played match (matchCatalog) – has
        // actual match-day points / line-up information.
        if (mc) {
            const drafted = (mc.playersByNation?.[teamName] || []).filter(p => p.drafted);
            if (drafted.length) return drafted;
        }
        // Fallback for upcoming matches (no points data yet): list all
        // drafted players whose nationality matches the team. Mirrors how
        // index.html "Nächste Spiele" works.
        if (!teamName || teamName === '-') return [];
        const fallback = [];
        playersData.forEach(p => {
            if ((p['Nationalteam.name'] || '') !== teamName) return;
            if (!isPlayerDrafted(p['player.id'])) return;
            fallback.push({
                playerId: String(p['player.id']),
                name: p.Spielername,
                nation: p['Nationalteam.name'],
                club: p['Club.name'] || 'Vereinslos',
                position: translatePosition(p.Position),
                photo: p.Spielerfoto || '',
                totalPoints: 0,
                drafted: true
            });
        });
        fallback.sort((a, b) => a.name.localeCompare(b.name, 'de'));
        return fallback;
    }

    function getAllPlayersForExpandedView(m, mc, teamName) {
        // Expanded body shows ALL players of the nation that scored
        // points in this match (i.e. appeared in the points data). Sorted
        // by total points (desc) – on ties fall back to name. The manager
        // selection is still highlighted via the card styling but no
        // longer affects the order.
        if (mc) {
            const players = (mc.playersByNation?.[teamName] || []).slice();
            if (players.length) {
                players.sort((a, b) => {
                    const ptsA = Number(a.totalPoints) || 0;
                    const ptsB = Number(b.totalPoints) || 0;
                    if (ptsA !== ptsB) return ptsB - ptsA;
                    return (a.name || '').localeCompare(b.name || '', 'de');
                });
                return players;
            }
        }
        // Upcoming match without points data yet → show drafted players
        // for that nation as a sensible fallback. No points exist yet,
        // so we fall back to alphabetical order by name.
        const drafted = getDraftedPlayersForScheduleTeam(m, mc, teamName).slice();
        drafted.sort((a, b) => {
            const ptsA = Number(a.totalPoints) || 0;
            const ptsB = Number(b.totalPoints) || 0;
            if (ptsA !== ptsB) return ptsB - ptsA;
            return (a.name || '').localeCompare(b.name || '', 'de');
        });
        return drafted;
    }

    function getFirstName(name) {
        const s = String(name || '').trim();
        if (!s) return '';
        const first = s.split(/\s+/)[0];
        return first || s;
    }

    // Build the "selected by managers" block for a schedule player card.
    // - 0 managers: returns empty string (no block).
    // - 1-INLINE managers: shown as inline chips (alphabetical, captain marked).
    // - more: show INLINE_COUNT chips + a "+N" toggle that expands to the full
    //   list inside the same card without collapsing the schedule entry.
    function renderSchedulePlayerManagers(playerId) {
        const managers = getManagersForPlayer(playerId);
        if (!managers.length) return '';

        const INLINE_LIMIT = 3;
        const total = managers.length;

        const renderChip = (m, extraCls = '') => {
            const cap = m.isCaptain ? ' is-captain' : '';
            const capIcon = m.isCaptain ? '<span class="sc-mgr-cap" title="Captain">C</span>' : '';
            const href = `teams.html?manager=${encodeURIComponent(m.manager)}`;
            const label = m.isCaptain
                ? `${m.manager} (Captain) – Team öffnen`
                : `${m.manager} – Team öffnen`;
            // Show only the first name in the chip to keep the cards
            // narrow on small viewports; the full name is still in the
            // tooltip and aria-label for accessibility.
            const display = getFirstName(m.manager);
            return `<a href="${href}"
                class="sc-mgr-chip${cap}${extraCls ? ' ' + extraCls : ''}"
                onclick="event.stopPropagation();"
                title="${escapeHtml(label)}"
                aria-label="${escapeHtml(label)}">${capIcon}<span class="sc-mgr-name">${escapeHtml(display)}</span></a>`;
        };

        const countLabel = total === 1 ? '1 Manager' : `${total} Manager`;

        if (total <= INLINE_LIMIT) {
            const chips = managers.map(m => renderChip(m)).join('');
            return `<div class="sc-mgr-block" data-total="${total}">
                <div class="sc-mgr-head">${escapeHtml(countLabel)}</div>
                <div class="sc-mgr-list">${chips}</div>
            </div>`;
        }

        const preview = managers.slice(0, INLINE_LIMIT).map(m => renderChip(m, 'sc-mgr-chip-preview')).join('');
        const allChips = managers.map(m => renderChip(m, 'sc-mgr-chip-full')).join('');
        const extraCount = total - INLINE_LIMIT;
        return `<div class="sc-mgr-block sc-mgr-block-collapsible" data-total="${total}">
            <div class="sc-mgr-head">${escapeHtml(countLabel)}</div>
            <div class="sc-mgr-list sc-mgr-list-preview">${preview}<button type="button"
                class="sc-mgr-more"
                aria-expanded="false"
                aria-label="${extraCount} weitere Manager anzeigen"
                onclick="event.stopPropagation(); toggleSchedulePlayerManagers(this)"
            >+${extraCount}</button></div>
            <div class="sc-mgr-list sc-mgr-list-extra" hidden>${allChips}<button type="button"
                class="sc-mgr-less"
                aria-label="Weitere Manager ausblenden"
                onclick="event.stopPropagation(); toggleSchedulePlayerManagers(this)"
            >Weniger</button></div>
        </div>`;
    }

    // Compact position labels for the narrow player cards in the
    // expanded schedule view. The full label is still exposed via the
    // tooltip / aria attributes, so accessibility is preserved.
    function shortenPositionLabel(pos) {
        const s = String(pos || '').trim();
        if (!s) return '';
        const map = {
            'Mittelfeldspieler': 'Mittelfeld',
            'Verteidiger': 'Abwehr',
            'Torhüter': 'Tor',
            'Stürmer': 'Sturm',
        };
        return map[s] || s;
    }

    function renderSchedulePlayerCard(p, hasMatchData) {
        const nameEncoded = encodeURIComponent(p.name);
        const idEncoded = p.playerId ? encodeURIComponent(p.playerId) : '';
        const pts = Number(p.totalPoints) || 0;
        let ptsClass = 'zero';
        if (pts > 0) ptsClass = 'pos';
        else if (pts < 0) ptsClass = 'neg';
        const ptsLabel = hasMatchData
            ? `${pts > 0 ? '+' : ''}${pts} Pkt.`
            : '— Pkt.';
        const draftedCls = p.drafted ? ' drafted' : '';
        const photoHtml = renderPlayerPhotoShell(p.photo, p.name, 'sc-player-card-photo', { width: 72, height: 72, ...getPlayerCaptainPhotoOptions(p.playerId) });
        const managersHtml = renderSchedulePlayerManagers(p.playerId);
        return `<div class="sc-player-card${draftedCls}">
            <button type="button" class="sc-player-card-main"
                onclick="event.stopPropagation(); openPlayerFromGames(decodeURIComponent('${idEncoded}'), decodeURIComponent('${nameEncoded}'))"
                title="${escapeHtml(p.name)} – Spieler-Analyse öffnen"
                aria-label="${escapeHtml(p.name)} – Spieler-Analyse öffnen">
                ${photoHtml}
                <div class="sc-player-card-name">${escapeHtml(p.name)}</div>
                ${p.position ? `<div class="sc-player-card-meta" title="${escapeHtml(p.position)}">${escapeHtml(shortenPositionLabel(p.position))}</div>` : ''}
                <div class="sc-player-card-pts ${ptsClass}">${escapeHtml(ptsLabel)}</div>
            </button>
            ${managersHtml}
        </div>`;
    }

    window.toggleSchedulePlayerManagers = function(btn) {
        if (!btn) return;
        const block = btn.closest('.sc-mgr-block-collapsible');
        if (!block) return;
        const preview = block.querySelector('.sc-mgr-list-preview');
        const extra = block.querySelector('.sc-mgr-list-extra');
        const moreBtn = block.querySelector('.sc-mgr-more');
        if (!preview || !extra) return;
        const isExpanded = !extra.hasAttribute('hidden');
        if (isExpanded) {
            extra.setAttribute('hidden', '');
            preview.removeAttribute('hidden');
            if (moreBtn) moreBtn.setAttribute('aria-expanded', 'false');
        } else {
            preview.setAttribute('hidden', '');
            extra.removeAttribute('hidden');
            if (moreBtn) moreBtn.setAttribute('aria-expanded', 'true');
        }
        if (typeof syncSidebarHeight === 'function') syncSidebarHeight();
    };

    function renderExpandedScheduleBody(m, mc) {
        const hasMatchData = !!mc;
        const homePlayers = getAllPlayersForExpandedView(m, mc, m.teamA);
        const awayPlayers = getAllPlayersForExpandedView(m, mc, m.teamB);

        const homeFlagUrl = getNationFlag(m.teamA);
        const awayFlagUrl = getNationFlag(m.teamB);
        const homeLogo = renderFlagImageHtml('sc-expanded-team-logo', m.teamALogo, homeFlagUrl, m.teamA, 'sc-team-logo-placeholder');
        const awayLogo = renderFlagImageHtml('sc-expanded-team-logo', m.teamBLogo, awayFlagUrl, m.teamB, 'sc-team-logo-placeholder');

        const emptyMsg = `<div class="sc-expanded-empty">Keine Spieler erfasst.</div>`;
        const homeGoalsHtml = renderScheduleGoalEventList(m, m.teamA);
        const awayGoalsHtml = renderScheduleGoalEventList(m, m.teamB);
        const homeBody = homePlayers.length
            ? homePlayers.map(p => renderSchedulePlayerCard(p, hasMatchData)).join('')
            : emptyMsg;
        const awayBody = awayPlayers.length
            ? awayPlayers.map(p => renderSchedulePlayerCard(p, hasMatchData)).join('')
            : emptyMsg;

        const note = hasMatchData
            ? ''
            : `<div class="sc-expanded-note">Noch keine Spielpunkte erfasst – angezeigt sind die gedrafteten Spieler der Nationen, sortiert nach Position.</div>`;

        return `<div class="sc-expanded-body">
            <div class="sc-expanded-grid">
                <div class="sc-expanded-team">
                    <div class="sc-expanded-team-header">
                        ${homeLogo}
                        <span class="sc-expanded-team-name">${escapeHtml(m.teamA)}</span>
                    </div>
                    ${homeGoalsHtml}
                    <div class="sc-expanded-players">${homeBody}</div>
                </div>
                <div class="sc-expanded-team right">
                    <div class="sc-expanded-team-header">
                        ${awayLogo}
                        <span class="sc-expanded-team-name">${escapeHtml(m.teamB)}</span>
                    </div>
                    ${awayGoalsHtml}
                    <div class="sc-expanded-players">${awayBody}</div>
                </div>
            </div>
            ${note}
        </div>`;
    }

    function compareScheduleKickoffAsc(a, b) {
        const da = getScheduleKickoffMs(a) || Number.MAX_SAFE_INTEGER;
        const db = getScheduleKickoffMs(b) || Number.MAX_SAFE_INTEGER;
        if (da !== db) return da - db;
        return String(a.id || '').localeCompare(String(b.id || ''), 'de');
    }

    function compareScheduleKickoffDesc(a, b) {
        const da = getScheduleKickoffMs(a) || 0;
        const db = getScheduleKickoffMs(b) || 0;
        if (da !== db) return db - da;
        return String(a.id || '').localeCompare(String(b.id || ''), 'de');
    }

    function applyScheduleStatusFilter(matches) {
        const filter = SCHEDULE_STATUS_FILTERS.includes(currentScheduleStatusFilter)
            ? currentScheduleStatusFilter
            : 'current';
        const now = Date.now();
        const enriched = (matches || []).map((match) => ({
            match,
            info: getScheduleStatusInfo(match, now)
        }));

        if (filter === 'upcoming') {
            return enriched
                .filter(({ info }) => info.isUpcoming)
                .map(({ match }) => match)
                .sort(compareScheduleKickoffAsc);
        }

        if (filter === 'finished') {
            return enriched
                .filter(({ info }) => info.isFinished)
                .map(({ match }) => match)
                .sort(compareScheduleKickoffDesc);
        }

        if (filter === 'all') {
            return enriched
                .map(({ match }) => match)
                .sort(compareScheduleKickoffAsc);
        }

        const nextUpcoming = enriched
            .filter(({ info }) => info.isUpcoming)
            .map(({ match }) => match)
            .sort(compareScheduleKickoffAsc)
            .slice(0, 8);
        const nextUpcomingSet = new Set(nextUpcoming);
        return enriched
            .filter(({ match, info }) => {
                return info.isLive || info.isUpdateOpen || info.isRecentFinished || nextUpcomingSet.has(match);
            })
            .map(({ match }) => match)
            .sort(compareScheduleKickoffAsc);
    }

    function updateScheduleStatusFilterButtons() {
        document.querySelectorAll('[data-schedule-status-filter]').forEach((btn) => {
            const isActive = btn.getAttribute('data-schedule-status-filter') === currentScheduleStatusFilter;
            btn.classList.toggle('active', isActive);
            btn.setAttribute('aria-selected', String(isActive));
        });
    }

    function setScheduleStatusFilter(filter, push = false) {
        currentScheduleStatusFilter = SCHEDULE_STATUS_FILTERS.includes(filter) ? filter : 'current';
        updateScheduleStatusFilterButtons();
        renderScheduleView();
        updateUrl(push);
        syncSidebarHeight();
    }

    function renderScheduleView() {
        const el = document.getElementById('schedule-list');
        if (!el) return;
        updateScheduleStatusFilterButtons();

        if (!scheduleCatalog.length) {
            el.innerHTML = `<div class="schedule-empty-state">
                <div style="font-size:2.5rem;margin-bottom:12px;">📅</div>
                <div style="font-size:0.95rem;font-weight:700;color:var(--text-muted,#8b949e);">Kein Spielplan verfügbar</div>
                <div style="font-size:0.8rem;color:rgba(139,148,158,0.6);margin-top:4px;">Bitte zuerst Spielplan über Admin synchronisieren.</div>
            </div>`;
            return;
        }

        function renderScheduleAvatars(players, alignRight = false, showPoints = false) {
            if (!players || !players.length) return '';
            const avatarsHtml = players.map(p => {
                const nameEncoded = encodeURIComponent(p.name);
                const idEncoded = p.playerId ? encodeURIComponent(p.playerId) : '';
                const pts = Number(p.totalPoints) || 0;
                const ptsHtml = showPoints
                    ? `<span class="sc-player-avatar-points ${getSchedulePointsClass(pts)}">${escapeHtml(formatScheduleSignedPoints(pts))}</span>`
                    : '';
                const ptsLabel = showPoints ? `, ${formatScheduleSignedPoints(pts)} Punkte in diesem Spiel` : '';
                return `<button type="button" class="sc-player-avatar-btn${showPoints ? ' has-points' : ''}" onclick="event.stopPropagation(); openPlayerFromGames(decodeURIComponent('${idEncoded}'), decodeURIComponent('${nameEncoded}'))" title="${escapeHtml(p.name)}" aria-label="${escapeHtml(p.name)} – Spieler öffnen${escapeHtml(ptsLabel)}">${renderPlayerPhotoShell(p.photo, p.name, 'sc-player-avatar', { width: 30, height: 30, ...getPlayerCaptainPhotoOptions(p.playerId) })}${ptsHtml}</button>`;
            }).filter(Boolean).join('');
            if (!avatarsHtml) return '';
            const cls = alignRight ? 'sc-player-avatars sc-player-avatars-away' : 'sc-player-avatars';
            return `<div class="${cls}">${avatarsHtml}</div>`;
        }

        // Filter by nation if selected
        let filteredSchedule = scheduleCatalog;
        if (currentScheduleNationFilter !== 'ALL') {
            filteredSchedule = scheduleCatalog.filter(m =>
                m.teamA === currentScheduleNationFilter || m.teamB === currentScheduleNationFilter
            );
        }
        filteredSchedule = applyScheduleStatusFilter(filteredSchedule);

        if (!filteredSchedule.length) {
            const filterLabels = {
                current: 'aktuelle',
                upcoming: 'kommende',
                finished: 'abgeschlossene',
                all: ''
            };
            const statusText = filterLabels[currentScheduleStatusFilter] || '';
            const emptyLabel = currentScheduleNationFilter !== 'ALL'
                ? `Keine ${statusText ? statusText + ' ' : ''}Spiele fuer dieses Land gefunden.`
                : `Keine ${statusText ? statusText + ' ' : ''}Spiele gefunden.`;
            el.innerHTML = `<div class="schedule-empty-state">
                <div style="font-size:2rem;margin-bottom:10px;">🔍</div>
                <div style="font-size:0.9rem;font-weight:700;color:var(--text-muted,#8b949e);">${escapeHtml(emptyLabel)}</div>
            </div>`;
            return;
        }

        // Group by date for section headers
        function getDateKey(m) {
            const kickoffMs = getScheduleKickoffMs(m);
            const dt = kickoffMs ? new Date(kickoffMs) : (m.date ? new Date(m.date) : null);
            if (!dt || Number.isNaN(dt.getTime())) return '_nodate';
            return dt.toISOString().slice(0, 10);
        }

        const grouped = new Map();
        filteredSchedule.forEach(m => {
            const key = getDateKey(m);
            if (!grouped.has(key)) grouped.set(key, []);
            grouped.get(key).push(m);
        });

        let html = '';

        for (const [dateKey, matches] of grouped) {
            let sectionLabel = '';
            if (dateKey === '_nodate') {
                sectionLabel = 'Datum folgt';
            } else {
                const dt = new Date(dateKey);
                sectionLabel = dt.toLocaleDateString('de-CH', { weekday: 'long', day: '2-digit', month: 'long', year: 'numeric' });
            }

            html += `<div class="schedule-date-group">
                <div class="schedule-date-header">
                    <span class="schedule-date-line"></span>
                    <span class="schedule-date-label">${escapeHtml(sectionLabel)}</span>
                    <span class="schedule-date-line"></span>
                </div>
                <div class="schedule-matches-group">`;

            matches.forEach(m => {
                const kickoffMs = getScheduleKickoffMs(m);
                const dt = kickoffMs ? new Date(kickoffMs) : (m.date ? new Date(m.date) : null);
                const validDt = dt && !Number.isNaN(dt.getTime());
                const timeLabel = validDt ? dt.toLocaleTimeString('de-CH', { hour: '2-digit', minute: '2-digit' }) : '--:--';

                const mc = findMatchCatalogForScheduleEntry(m);
                const scoreParts = getScheduleScoreParts(m, mc);
                const statusInfo = getScheduleStatusInfo(m);
                const isFinished = statusInfo.isFinished;
                const isLive = statusInfo.isLive;
                const isUpdateOpen = statusInfo.isUpdateOpen;
                const kickoffMetaHtml = isFinished && validDt
                    ? `<div class="sc-kickoff-meta">Anpfiff ${escapeHtml(timeLabel)}</div>`
                    : '';

                // Score / time center display
                let centerHtml = '';
                let matchStatusCls = '';
                if (isLive) {
                    const elapsed = m.status?.elapsed ? `${m.status.elapsed}'` : '';
                    centerHtml = `<div class="sc-live-pill"><span class="sc-live-dot"></span>Live${elapsed ? ` ${escapeHtml(elapsed)}` : ''}</div>`;
                    centerHtml += scoreParts
                        ? `<div class="sc-score sc-live">${escapeHtml(String(scoreParts.home))}<span class="sc-colon">:</span>${escapeHtml(String(scoreParts.away))}</div>`
                        : `<div class="sc-time">${escapeHtml(timeLabel)}</div><div class="sc-vs">VS</div>`;
                    matchStatusCls = 'sc-card--live';
                } else if (isUpdateOpen) {
                    centerHtml = `<div class="sc-pending-pill">Update offen</div>`;
                    centerHtml += scoreParts
                        ? `<div class="sc-score sc-pending">${escapeHtml(String(scoreParts.home))}<span class="sc-colon">:</span>${escapeHtml(String(scoreParts.away))}</div>`
                        : `<div class="sc-time">${escapeHtml(timeLabel)}</div>`;
                    matchStatusCls = 'sc-card--pending';
                } else if (isFinished && scoreParts) {
                    const finalScore = getScheduleFinalScoreInfo(m, mc) || scoreParts;
                    const finalNoteTitle = finalScore.note === 'n.E.' ? 'Nach Elfmeterschiessen' : (finalScore.note === 'n.V.' ? 'Nach Verlaengerung' : '');
                    const finalNoteHtml = finalScore.note
                        ? ` <span class="sc-score-note" title="${escapeHtml(finalNoteTitle)}">${escapeHtml(finalScore.note)}</span>`
                        : '';
                    centerHtml = `<div class="sc-finished-pill">Abgeschlossen</div>`;
                    centerHtml += `<div class="sc-score sc-finished">${escapeHtml(String(finalScore.home))}<span class="sc-colon">:</span>${escapeHtml(String(finalScore.away))}${finalNoteHtml}</div>`;
                    centerHtml += kickoffMetaHtml;
                    matchStatusCls = 'sc-card--finished';
                } else if (isFinished) {
                    centerHtml = `<div class="sc-finished-pill">Abgeschlossen</div><div class="sc-time">${escapeHtml(timeLabel)}</div>${kickoffMetaHtml}`;
                    matchStatusCls = 'sc-card--finished';
                } else {
                    centerHtml = `<div class="sc-time">${escapeHtml(timeLabel)}</div><div class="sc-vs">VS</div>`;
                }

                // Team logos (flag from player data)
                const homeFlagUrl = getNationFlag(m.teamA);
                const awayFlagUrl = getNationFlag(m.teamB);
                const homeLogo = renderFlagImageHtml('sc-team-logo', m.teamALogo, homeFlagUrl, m.teamA, 'sc-team-logo-placeholder');
                const awayLogo = renderFlagImageHtml('sc-team-logo', m.teamBLogo, awayFlagUrl, m.teamB, 'sc-team-logo-placeholder');

                // Venue text (no image)
                const venueName = m.venue && m.venue !== 'Spielort folgt' ? String(m.venue).trim() : '';
                const venueCity = venueName && m.venueCity ? String(m.venueCity).trim() : '';
                const venueTitle = [venueName, venueCity].filter(Boolean).join(' · ');
                const venueHtml = venueName
                    ? `<div class="sc-venue-center" title="${escapeHtml(venueTitle)}"><span class="sc-venue-name">🏟️ ${escapeHtml(venueName)}</span>${venueCity ? `<span class="sc-venue-city">${escapeHtml(venueCity)}</span>` : ''}</div>`
                    : '';

                // Resolve catalog entry to enable drafted lookup, spielNr label
                // and expanded view rendering.
                const matchKey = getScheduleMatchKey(m, mc);
                const isExpanded = expandedScheduleMatchKeys.has(matchKey);
                const displayMatchNumber = getScheduleDisplayMatchNumber(m, mc);
                const groupStageLabel = APP && typeof APP.groupStageLabelForMatch === 'function'
                    ? APP.groupStageLabelForMatch(m, { matches: scheduleCatalog })
                    : '';
                const roundText = groupStageLabel || (m.round ? m.round.replace(/Regular Season -\s*/i, '').replace(/Group Stage -\s*/i, 'Gruppe: ') : '');
                const spielNrLabel = groupStageLabel ? '' : (displayMatchNumber ? `Spiel ${displayMatchNumber}` : '');
                const mobileMetaMain = [displayMatchNumber ? `Spiel ${displayMatchNumber}` : '', timeLabel].filter(Boolean).join(' · ');
                const mobileMetaVenue = [venueName, venueCity].filter(Boolean).join(' · ');
                const mobileExpandedMetaHtml = (mobileMetaMain || roundText || mobileMetaVenue)
                    ? `<div class="sc-mobile-expanded-meta">
                        ${mobileMetaMain ? `<div class="sc-mobile-expanded-meta-line sc-mobile-expanded-meta-main">${escapeHtml(mobileMetaMain)}</div>` : ''}
                        ${roundText ? `<div class="sc-mobile-expanded-meta-line sc-mobile-expanded-meta-group">${escapeHtml(roundText)}</div>` : ''}
                        ${mobileMetaVenue ? `<div class="sc-mobile-expanded-meta-line sc-mobile-expanded-meta-venue">${escapeHtml(mobileMetaVenue)}</div>` : ''}
                    </div>`
                    : '';

                // Small drafted-player avatars are shown in the collapsed
                // card as a quick visual hint of "who from my managers'
                // selection is on the pitch here". They get hidden via
                // CSS once the card is expanded, since the expanded view
                // re-renders the same players in larger cards.
                const homeDrafted = getDraftedPlayersForScheduleTeam(m, mc, m.teamA);
                const awayDrafted = getDraftedPlayersForScheduleTeam(m, mc, m.teamB);
                const showMatchPlayerPoints = !!mc;
                const homeGoalsHtml = renderScheduleGoalEventList(m, m.teamA);
                const awayGoalsHtml = renderScheduleGoalEventList(m, m.teamB);
                const goalsStripHtml = (homeGoalsHtml || awayGoalsHtml)
                    ? `<div class="sc-goals-strip">
                        <div class="sc-goals-strip-side">${homeGoalsHtml}</div>
                        <div class="sc-goals-strip-side right">${awayGoalsHtml}</div>
                    </div>`
                    : '';
                const homeAvatars = renderScheduleAvatars(homeDrafted, false, showMatchPlayerPoints);
                const awayAvatars = renderScheduleAvatars(awayDrafted, true, showMatchPlayerPoints);

                const ariaLabelPrefix = groupStageLabel || spielNrLabel;
                const ariaLabel = `${ariaLabelPrefix ? ariaLabelPrefix + ': ' : ''}${m.teamA} gegen ${m.teamB} – ${isExpanded ? 'Details ausblenden' : 'Details anzeigen'}`;

                html += `<div class="sc-card ${matchStatusCls}${isExpanded ? ' is-expanded' : ''}"
                    data-match-key="${escapeHtml(matchKey)}"
                    ${mc && mc.rawMatchId !== undefined ? `data-raw-match-id="${escapeHtml(String(mc.rawMatchId))}"` : ''}
                    ${m.id !== undefined && m.id !== null ? `data-fixture-id="${escapeHtml(String(m.id))}"` : ''}
                    ${mc && mc.number ? `data-spiel-nr="${escapeHtml(String(mc.number))}"` : ''}
                    role="button"
                    tabindex="0"
                    aria-expanded="${isExpanded ? 'true' : 'false'}"
                    aria-label="${escapeHtml(ariaLabel)}"
                    onclick="toggleScheduleCard(this)"
                    onkeydown="handleScheduleCardKey(event, this)">
                    <div class="sc-card-inner">
                        <div class="sc-team sc-team-home">
                            <div class="sc-team-info">
                                ${homeLogo}
                                <span class="sc-team-name">${escapeHtml(m.teamA)}</span>
                            </div>
                            ${homeGoalsHtml}
                            ${homeAvatars}
                        </div>
                        <div class="sc-center">
                            ${centerHtml}
                            ${spielNrLabel ? `<div class="sc-card-spielnr">${escapeHtml(spielNrLabel)}</div>` : ''}
                            ${roundText ? `<div class="sc-round${groupStageLabel ? ' sc-round-group' : ''}">${escapeHtml(roundText)}</div>` : ''}
                            ${venueHtml}
                        </div>
                        ${mobileExpandedMetaHtml}
                        <div class="sc-team sc-team-away">
                            <div class="sc-team-info sc-team-info-away">
                                <span class="sc-team-name">${escapeHtml(m.teamB)}</span>
                                ${awayLogo}
                            </div>
                            ${awayGoalsHtml}
                            ${awayAvatars}
                        </div>
                        ${goalsStripHtml}
                        <span class="sc-card-toggle" aria-hidden="true">▾</span>
                    </div>
                    ${renderExpandedScheduleBody(m, mc)}
                </div>`;
            });

            html += `</div></div>`;
        }

        el.innerHTML = html;
        refreshScheduleGoalLineOverflow(el);
        syncSidebarHeight();
        applyPendingScheduleFocus();
    }

    /* =========================================================
       TOURNAMENT VIEW (groups + knockout)
       ========================================================= */
    const FIFA_THIRD_PLACE_WINNER_ORDER = ['A', 'B', 'D', 'E', 'G', 'I', 'K', 'L'];
    const FIFA_THIRD_PLACE_WINNER_MATCH = { A: 79, B: 85, D: 81, E: 74, G: 82, I: 77, K: 87, L: 80 };
    const FIFA_THIRD_PLACE_ASSIGNMENT_DATA = 'EFGHIJKL:EJIFHGLK|DFGHIJKL:HGIDJFLK|DEGHIJKL:EJIDHGLK|DEFHIJKL:EJIDHFLK|DEFGIJKL:EGIDJFLK|DEFGHJKL:EGJDHFLK|DEFGHIKL:EGIDHFLK|DEFGHIJL:EGJDHFLI|DEFGHIJK:EGJDHFIK|CFGHIJKL:HGICJFLK|CEGHIJKL:EJICHGLK|CEFHIJKL:EJICHFLK|CEFGIJKL:EGICJFLK|CEFGHJKL:EGJCHFLK|CEFGHIKL:EGICHFLK|CEFGHIJL:EGJCHFLI|CEFGHIJK:EGJCHFIK|CDGHIJKL:HGICJDLK|CDFHIJKL:CJIDHFLK|CDFGIJKL:CGIDJFLK|CDFGHJKL:CGJDHFLK|CDFGHIKL:CGIDHFLK|CDFGHIJL:CGJDHFLI|CDFGHIJK:CGJDHFIK|CDEHIJKL:EJICHDLK|CDEGIJKL:EGICJDLK|CDEGHJKL:EGJCHDLK|CDEGHIKL:EGICHDLK|CDEGHIJL:EGJCHDLI|CDEGHIJK:EGJCHDIK|CDEFIJKL:CJEDIFLK|CDEFHJKL:CJEDHFLK|CDEFHIKL:CEIDHFLK|CDEFHIJL:CJEDHFLI|CDEFHIJK:CJEDHFIK|CDEFGJKL:CGEDJFLK|CDEFGIKL:CGEDIFLK|CDEFGIJL:CGEDJFLI|CDEFGIJK:CGEDJFIK|CDEFGHKL:CGEDHFLK|CDEFGHJL:CGJDHFLE|CDEFGHJK:CGJDHFEK|CDEFGHIL:CGEDHFLI|CDEFGHIK:CGEDHFIK|CDEFGHIJ:CGJDHFEI|BFGHIJKL:HJBFIGLK|BEGHIJKL:EJIBHGLK|BEFHIJKL:EJBFIHLK|BEFGIJKL:EJBFIGLK|BEFGHJKL:EJBFHGLK|BEFGHIKL:EGBFIHLK|BEFGHIJL:EJBFHGLI|BEFGHIJK:EJBFHGIK|BDGHIJKL:HJBDIGLK|BDFHIJKL:HJBDIFLK|BDFGIJKL:IGBDJFLK|BDFGHJKL:HGBDJFLK|BDFGHIKL:HGBDIFLK|BDFGHIJL:HGBDJFLI|BDFGHIJK:HGBDJFIK|BDEHIJKL:EJBDIHLK|BDEGIJKL:EJBDIGLK|BDEGHJKL:EJBDHGLK|BDEGHIKL:EGBDIHLK|BDEGHIJL:EJBDHGLI|BDEGHIJK:EJBDHGIK|BDEFIJKL:EJBDIFLK|BDEFHJKL:EJBDHFLK|BDEFHIKL:EIBDHFLK|BDEFHIJL:EJBDHFLI|BDEFHIJK:EJBDHFIK|BDEFGJKL:EGBDJFLK|BDEFGIKL:EGBDIFLK|BDEFGIJL:EGBDJFLI|BDEFGIJK:EGBDJFIK|BDEFGHKL:EGBDHFLK|BDEFGHJL:HGBDJFLE|BDEFGHJK:HGBDJFEK|BDEFGHIL:EGBDHFLI|BDEFGHIK:EGBDHFIK|BDEFGHIJ:HGBDJFEI|BCGHIJKL:HJBCIGLK|BCFHIJKL:HJBCIFLK|BCFGIJKL:IGBCJFLK|BCFGHJKL:HGBCJFLK|BCFGHIKL:HGBCIFLK|BCFGHIJL:HGBCJFLI|BCFGHIJK:HGBCJFIK|BCEHIJKL:EJBCIHLK|BCEGIJKL:EJBCIGLK|BCEGHJKL:EJBCHGLK|BCEGHIKL:EGBCIHLK|BCEGHIJL:EJBCHGLI|BCEGHIJK:EJBCHGIK|BCEFIJKL:EJBCIFLK|BCEFHJKL:EJBCHFLK|BCEFHIKL:EIBCHFLK|BCEFHIJL:EJBCHFLI|BCEFHIJK:EJBCHFIK|BCEFGJKL:EGBCJFLK|BCEFGIKL:EGBCIFLK|BCEFGIJL:EGBCJFLI|BCEFGIJK:EGBCJFIK|BCEFGHKL:EGBCHFLK|BCEFGHJL:HGBCJFLE|BCEFGHJK:HGBCJFEK|BCEFGHIL:EGBCHFLI|BCEFGHIK:EGBCHFIK|BCEFGHIJ:HGBCJFEI|BCDHIJKL:HJBCIDLK|BCDGIJKL:IGBCJDLK|BCDGHJKL:HGBCJDLK|BCDGHIKL:HGBCIDLK|BCDGHIJL:HGBCJDLI|BCDGHIJK:HGBCJDIK|BCDFIJKL:CJBDIFLK|BCDFHJKL:CJBDHFLK|BCDFHIKL:CIBDHFLK|BCDFHIJL:CJBDHFLI|BCDFHIJK:CJBDHFIK|BCDFGJKL:CGBDJFLK|BCDFGIKL:CGBDIFLK|BCDFGIJL:CGBDJFLI|BCDFGIJK:CGBDJFIK|BCDFGHKL:CGBDHFLK|BCDFGHJL:CGBDHFLJ|BCDFGHJK:HGBCJFDK|BCDFGHIL:CGBDHFLI|BCDFGHIK:CGBDHFIK|BCDFGHIJ:HGBCJFDI|BCDEIJKL:EJBCIDLK|BCDEHJKL:EJBCHDLK|BCDEHIKL:EIBCHDLK|BCDEHIJL:EJBCHDLI|BCDEHIJK:EJBCHDIK|BCDEGJKL:EGBCJDLK|BCDEGIKL:EGBCIDLK|BCDEGIJL:EGBCJDLI|BCDEGIJK:EGBCJDIK|BCDEGHKL:EGBCHDLK|BCDEGHJL:HGBCJDLE|BCDEGHJK:HGBCJDEK|BCDEGHIL:EGBCHDLI|BCDEGHIK:EGBCHDIK|BCDEGHIJ:HGBCJDEI|BCDEFJKL:CJBDEFLK|BCDEFIKL:CEBDIFLK|BCDEFIJL:CJBDEFLI|BCDEFIJK:CJBDEFIK|BCDEFHKL:CEBDHFLK|BCDEFHJL:CJBDHFLE|BCDEFHJK:CJBDHFEK|BCDEFHIL:CEBDHFLI|BCDEFHIK:CEBDHFIK|BCDEFHIJ:CJBDHFEI|BCDEFGKL:CGBDEFLK|BCDEFGJL:CGBDJFLE|BCDEFGJK:CGBDJFEK|BCDEFGIL:CGBDEFLI|BCDEFGIK:CGBDEFIK|BCDEFGIJ:CGBDJFEI|BCDEFGHL:CGBDHFLE|BCDEFGHK:CGBDHFEK|BCDEFGHJ:HGBCJFDE|BCDEFGHI:CGBDHFEI|AFGHIJKL:HJIFAGLK|AEGHIJKL:EJIAHGLK|AEFHIJKL:EJIFAHLK|AEFGIJKL:EJIFAGLK|AEFGHJKL:EGJFAHLK|AEFGHIKL:EGIFAHLK|AEFGHIJL:EGJFAHLI|AEFGHIJK:EGJFAHIK|ADGHIJKL:HJIDAGLK|ADFHIJKL:HJIDAFLK|ADFGIJKL:IGJDAFLK|ADFGHJKL:HGJDAFLK|ADFGHIKL:HGIDAFLK|ADFGHIJL:HGJDAFLI|ADFGHIJK:HGJDAFIK|ADEHIJKL:EJIDAHLK|ADEGIJKL:EJIDAGLK|ADEGHJKL:EGJDAHLK|ADEGHIKL:EGIDAHLK|ADEGHIJL:EGJDAHLI|ADEGHIJK:EGJDAHIK|ADEFIJKL:EJIDAFLK|ADEFHJKL:HJEDAFLK|ADEFHIKL:HEIDAFLK|ADEFHIJL:HJEDAFLI|ADEFHIJK:HJEDAFIK|ADEFGJKL:EGJDAFLK|ADEFGIKL:EGIDAFLK|ADEFGIJL:EGJDAFLI|ADEFGIJK:EGJDAFIK|ADEFGHKL:HGEDAFLK|ADEFGHJL:HGJDAFLE|ADEFGHJK:HGJDAFEK|ADEFGHIL:HGEDAFLI|ADEFGHIK:HGEDAFIK|ADEFGHIJ:HGJDAFEI|ACGHIJKL:HJICAGLK|ACFHIJKL:HJICAFLK|ACFGIJKL:IGJCAFLK|ACFGHJKL:HGJCAFLK|ACFGHIKL:HGICAFLK|ACFGHIJL:HGJCAFLI|ACFGHIJK:HGJCAFIK|ACEHIJKL:EJICAHLK|ACEGIJKL:EJICAGLK|ACEGHJKL:EGJCAHLK|ACEGHIKL:EGICAHLK|ACEGHIJL:EGJCAHLI|ACEGHIJK:EGJCAHIK|ACEFIJKL:EJICAFLK|ACEFHJKL:HJECAFLK|ACEFHIKL:HEICAFLK|ACEFHIJL:HJECAFLI|ACEFHIJK:HJECAFIK|ACEFGJKL:EGJCAFLK|ACEFGIKL:EGICAFLK|ACEFGIJL:EGJCAFLI|ACEFGIJK:EGJCAFIK|ACEFGHKL:HGECAFLK|ACEFGHJL:HGJCAFLE|ACEFGHJK:HGJCAFEK|ACEFGHIL:HGECAFLI|ACEFGHIK:HGECAFIK|ACEFGHIJ:HGJCAFEI|ACDHIJKL:HJICADLK|ACDGIJKL:IGJCADLK|ACDGHJKL:HGJCADLK|ACDGHIKL:HGICADLK|ACDGHIJL:HGJCADLI|ACDGHIJK:HGJCADIK|ACDFIJKL:CJIDAFLK|ACDFHJKL:HJFCADLK|ACDFHIKL:HFICADLK|ACDFHIJL:HJFCADLI|ACDFHIJK:HJFCADIK|ACDFGJKL:CGJDAFLK|ACDFGIKL:CGIDAFLK|ACDFGIJL:CGJDAFLI|ACDFGIJK:CGJDAFIK|ACDFGHKL:HGFCADLK|ACDFGHJL:CGJDAFLH|ACDFGHJK:HGJCAFDK|ACDFGHIL:HGFCADLI|ACDFGHIK:HGFCADIK|ACDFGHIJ:HGJCAFDI|ACDEIJKL:EJICADLK|ACDEHJKL:HJECADLK|ACDEHIKL:HEICADLK|ACDEHIJL:HJECADLI|ACDEHIJK:HJECADIK|ACDEGJKL:EGJCADLK|ACDEGIKL:EGICADLK|ACDEGIJL:EGJCADLI|ACDEGIJK:EGJCADIK|ACDEGHKL:HGECADLK|ACDEGHJL:HGJCADLE|ACDEGHJK:HGJCADEK|ACDEGHIL:HGECADLI|ACDEGHIK:HGECADIK|ACDEGHIJ:HGJCADEI|ACDEFJKL:CJEDAFLK|ACDEFIKL:CEIDAFLK|ACDEFIJL:CJEDAFLI|ACDEFIJK:CJEDAFIK|ACDEFHKL:HEFCADLK|ACDEFHJL:HJFCADLE|ACDEFHJK:HJECAFDK|ACDEFHIL:HEFCADLI|ACDEFHIK:HEFCADIK|ACDEFHIJ:HJECAFDI|ACDEFGKL:CGEDAFLK|ACDEFGJL:CGJDAFLE|ACDEFGJK:CGJDAFEK|ACDEFGIL:CGEDAFLI|ACDEFGIK:CGEDAFIK|ACDEFGIJ:CGJDAFEI|ACDEFGHL:HGFCADLE|ACDEFGHK:HGECAFDK|ACDEFGHJ:HGJCAFDE|ACDEFGHI:HGECAFDI|ABGHIJKL:HJBAIGLK|ABFHIJKL:HJBAIFLK|ABFGIJKL:IJBFAGLK|ABFGHJKL:HJBFAGLK|ABFGHIKL:HGBAIFLK|ABFGHIJL:HJBFAGLI|ABFGHIJK:HJBFAGIK|ABEHIJKL:EJBAIHLK|ABEGIJKL:EJBAIGLK|ABEGHJKL:EJBAHGLK|ABEGHIKL:EGBAIHLK|ABEGHIJL:EJBAHGLI|ABEGHIJK:EJBAHGIK|ABEFIJKL:EJBAIFLK|ABEFHJKL:EJBFAHLK|ABEFHIKL:EIBFAHLK|ABEFHIJL:EJBFAHLI|ABEFHIJK:EJBFAHIK|ABEFGJKL:EJBFAGLK|ABEFGIKL:EGBAIFLK|ABEFGIJL:EJBFAGLI|ABEFGIJK:EJBFAGIK|ABEFGHKL:EGBFAHLK|ABEFGHJL:HJBFAGLE|ABEFGHJK:HJBFAGEK|ABEFGHIL:EGBFAHLI|ABEFGHIK:EGBFAHIK|ABEFGHIJ:HJBFAGEI|ABDHIJKL:IJBDAHLK|ABDGIJKL:IJBDAGLK|ABDGHJKL:HJBDAGLK|ABDGHIKL:IGBDAHLK|ABDGHIJL:HJBDAGLI|ABDGHIJK:HJBDAGIK|ABDFIJKL:IJBDAFLK|ABDFHJKL:HJBDAFLK|ABDFHIKL:HIBDAFLK|ABDFHIJL:HJBDAFLI|ABDFHIJK:HJBDAFIK|ABDFGJKL:FJBDAGLK|ABDFGIKL:IGBDAFLK|ABDFGIJL:FJBDAGLI|ABDFGIJK:FJBDAGIK|ABDFGHKL:HGBDAFLK|ABDFGHJL:HGBDAFLJ|ABDFGHJK:HGBDAFJK|ABDFGHIL:HGBDAFLI|ABDFGHIK:HGBDAFIK|ABDFGHIJ:HGBDAFIJ|ABDEIJKL:EJBAIDLK|ABDEHJKL:EJBDAHLK|ABDEHIKL:EIBDAHLK|ABDEHIJL:EJBDAHLI|ABDEHIJK:EJBDAHIK|ABDEGJKL:EJBDAGLK|ABDEGIKL:EGBAIDLK|ABDEGIJL:EJBDAGLI|ABDEGIJK:EJBDAGIK|ABDEGHKL:EGBDAHLK|ABDEGHJL:HJBDAGLE|ABDEGHJK:HJBDAGEK|ABDEGHIL:EGBDAHLI|ABDEGHIK:EGBDAHIK|ABDEGHIJ:HJBDAGEI|ABDEFJKL:EJBDAFLK|ABDEFIKL:EIBDAFLK|ABDEFIJL:EJBDAFLI|ABDEFIJK:EJBDAFIK|ABDEFHKL:HEBDAFLK|ABDEFHJL:HJBDAFLE|ABDEFHJK:HJBDAFEK|ABDEFHIL:HEBDAFLI|ABDEFHIK:HEBDAFIK|ABDEFHIJ:HJBDAFEI|ABDEFGKL:EGBDAFLK|ABDEFGJL:EGBDAFLJ|ABDEFGJK:EGBDAFJK|ABDEFGIL:EGBDAFLI|ABDEFGIK:EGBDAFIK|ABDEFGIJ:EGBDAFIJ|ABDEFGHL:HGBDAFLE|ABDEFGHK:HGBDAFEK|ABDEFGHJ:HGBDAFEJ|ABDEFGHI:HGBDAFEI|ABCHIJKL:IJBCAHLK|ABCGIJKL:IJBCAGLK|ABCGHJKL:HJBCAGLK|ABCGHIKL:IGBCAHLK|ABCGHIJL:HJBCAGLI|ABCGHIJK:HJBCAGIK|ABCFIJKL:IJBCAFLK|ABCFHJKL:HJBCAFLK|ABCFHIKL:HIBCAFLK|ABCFHIJL:HJBCAFLI|ABCFHIJK:HJBCAFIK|ABCFGJKL:CJBFAGLK|ABCFGIKL:IGBCAFLK|ABCFGIJL:CJBFAGLI|ABCFGIJK:CJBFAGIK|ABCFGHKL:HGBCAFLK|ABCFGHJL:HGBCAFLJ|ABCFGHJK:HGBCAFJK|ABCFGHIL:HGBCAFLI|ABCFGHIK:HGBCAFIK|ABCFGHIJ:HGBCAFIJ|ABCEIJKL:EJBAICLK|ABCEHJKL:EJBCAHLK|ABCEHIKL:EIBCAHLK|ABCEHIJL:EJBCAHLI|ABCEHIJK:EJBCAHIK|ABCEGJKL:EJBCAGLK|ABCEGIKL:EGBAICLK|ABCEGIJL:EJBCAGLI|ABCEGIJK:EJBCAGIK|ABCEGHKL:EGBCAHLK|ABCEGHJL:HJBCAGLE|ABCEGHJK:HJBCAGEK|ABCEGHIL:EGBCAHLI|ABCEGHIK:EGBCAHIK|ABCEGHIJ:HJBCAGEI|ABCEFJKL:EJBCAFLK|ABCEFIKL:EIBCAFLK|ABCEFIJL:EJBCAFLI|ABCEFIJK:EJBCAFIK|ABCEFHKL:HEBCAFLK|ABCEFHJL:HJBCAFLE|ABCEFHJK:HJBCAFEK|ABCEFHIL:HEBCAFLI|ABCEFHIK:HEBCAFIK|ABCEFHIJ:HJBCAFEI|ABCEFGKL:EGBCAFLK|ABCEFGJL:EGBCAFLJ|ABCEFGJK:EGBCAFJK|ABCEFGIL:EGBCAFLI|ABCEFGIK:EGBCAFIK|ABCEFGIJ:EGBCAFIJ|ABCEFGHL:HGBCAFLE|ABCEFGHK:HGBCAFEK|ABCEFGHJ:HGBCAFEJ|ABCEFGHI:HGBCAFEI|ABCDIJKL:IJBCADLK|ABCDHJKL:HJBCADLK|ABCDHIKL:HIBCADLK|ABCDHIJL:HJBCADLI|ABCDHIJK:HJBCADIK|ABCDGJKL:CJBDAGLK|ABCDGIKL:IGBCADLK|ABCDGIJL:CJBDAGLI|ABCDGIJK:CJBDAGIK|ABCDGHKL:HGBCADLK|ABCDGHJL:HGBCADLJ|ABCDGHJK:HGBCADJK|ABCDGHIL:HGBCADLI|ABCDGHIK:HGBCADIK|ABCDGHIJ:HGBCADIJ|ABCDFJKL:CJBDAFLK|ABCDFIKL:CIBDAFLK|ABCDFIJL:CJBDAFLI|ABCDFIJK:CJBDAFIK|ABCDFHKL:HFBCADLK|ABCDFHJL:CJBDAFLH|ABCDFHJK:HJBCAFDK|ABCDFHIL:HFBCADLI|ABCDFHIK:HFBCADIK|ABCDFHIJ:HJBCAFDI|ABCDFGKL:CGBDAFLK|ABCDFGJL:CGBDAFLJ|ABCDFGJK:CGBDAFJK|ABCDFGIL:CGBDAFLI|ABCDFGIK:CGBDAFIK|ABCDFGIJ:CGBDAFIJ|ABCDFGHL:CGBDAFLH|ABCDFGHK:HGBCAFDK|ABCDFGHJ:HGBCAFDJ|ABCDFGHI:HGBCAFDI|ABCDEJKL:EJBCADLK|ABCDEIKL:EIBCADLK|ABCDEIJL:EJBCADLI|ABCDEIJK:EJBCADIK|ABCDEHKL:HEBCADLK|ABCDEHJL:HJBCADLE|ABCDEHJK:HJBCADEK|ABCDEHIL:HEBCADLI|ABCDEHIK:HEBCADIK|ABCDEHIJ:HJBCADEI|ABCDEGKL:EGBCADLK|ABCDEGJL:EGBCADLJ|ABCDEGJK:EGBCADJK|ABCDEGIL:EGBCADLI|ABCDEGIK:EGBCADIK|ABCDEGIJ:EGBCADIJ|ABCDEGHL:HGBCADLE|ABCDEGHK:HGBCADEK|ABCDEGHJ:HGBCADEJ|ABCDEGHI:HGBCADEI|ABCDEFKL:CEBDAFLK|ABCDEFJL:CJBDAFLE|ABCDEFJK:CJBDAFEK|ABCDEFIL:CEBDAFLI|ABCDEFIK:CEBDAFIK|ABCDEFIJ:CJBDAFEI|ABCDEFHL:HFBCADLE|ABCDEFHK:HEBCAFDK|ABCDEFHJ:HJBCAFDE|ABCDEFHI:HEBCAFDI|ABCDEFGL:CGBDAFLE|ABCDEFGK:CGBDAFEK|ABCDEFGJ:CGBDAFEJ|ABCDEFGI:CGBDAFEI|ABCDEFGH:HGBCAFDE';
    const FIFA_THIRD_PLACE_ASSIGNMENTS = new Map(
        FIFA_THIRD_PLACE_ASSIGNMENT_DATA.split('|')
            .map(item => item.split(':'))
            .filter(parts => parts.length === 2 && parts[0] && parts[1])
    );

    function createDefaultTournamentManualState() {
        return {
            version: TOURNAMENT_MANUAL_STORAGE_VERSION,
            mode: TOURNAMENT_MODE_AUTO,
            manualPredictionInitialized: false,
            groupOrders: {},
            thirdOrder: [],
            winners: {}
        };
    }

    function normalizeTournamentManualState(raw) {
        const base = createDefaultTournamentManualState();
        if (!raw || typeof raw !== 'object') return base;
        const mode = raw.mode === TOURNAMENT_MODE_MANUAL ? TOURNAMENT_MODE_MANUAL : TOURNAMENT_MODE_AUTO;
        return {
            ...base,
            ...raw,
            version: TOURNAMENT_MANUAL_STORAGE_VERSION,
            mode,
            manualPredictionInitialized: raw.manualPredictionInitialized === true,
            groupOrders: raw.groupOrders && typeof raw.groupOrders === 'object' ? raw.groupOrders : {},
            thirdOrder: Array.isArray(raw.thirdOrder) ? raw.thirdOrder.map(value => String(value).toUpperCase()) : [],
            winners: raw.winners && typeof raw.winners === 'object' ? raw.winners : {}
        };
    }

    function loadTournamentManualState() {
        try {
            const raw = window.localStorage ? window.localStorage.getItem(TOURNAMENT_MANUAL_STORAGE_KEY) : null;
            if (!raw) return createDefaultTournamentManualState();
            return normalizeTournamentManualState(JSON.parse(raw));
        } catch (_) {
            return createDefaultTournamentManualState();
        }
    }

    function saveTournamentManualState() {
        tournamentManualState = normalizeTournamentManualState({
            ...tournamentManualState,
            mode: currentTournamentMode
        });
        try {
            if (window.localStorage) {
                window.localStorage.setItem(TOURNAMENT_MANUAL_STORAGE_KEY, JSON.stringify(tournamentManualState));
            }
        } catch (_) { /* localStorage may be unavailable */ }
    }

    function isTournamentManualMode() {
        return currentTournamentMode === TOURNAMENT_MODE_MANUAL;
    }

    function syncTournamentModeUi() {
        document.querySelectorAll('[data-tournament-mode]').forEach(btn => {
            const isActive = btn.dataset.tournamentMode === currentTournamentMode;
            btn.classList.toggle('active', isActive);
            btn.setAttribute('aria-pressed', String(isActive));
        });
        const resetBtn = document.getElementById('tournament-manual-reset');
        if (resetBtn) resetBtn.hidden = !isTournamentManualMode();
        const hint = document.getElementById('tournament-manual-hint');
        if (hint) {
            // Only relevant where rows can actually be reordered (group stage).
            hint.hidden = !(isTournamentManualMode() && currentTournamentTab === 'groups');
        }
        const knockoutHint = document.getElementById('tournament-knockout-manual-hint');
        if (knockoutHint) {
            knockoutHint.hidden = !(isTournamentManualMode() && currentTournamentTab === 'knockout');
        }
    }

    function setTournamentMode(mode) {
        currentTournamentMode = mode === TOURNAMENT_MODE_MANUAL ? TOURNAMENT_MODE_MANUAL : TOURNAMENT_MODE_AUTO;
        saveTournamentManualState();
        syncTournamentModeUi();
        renderTournamentView();
    }

    function normalizeTournamentName(value) {
        if (value === null || value === undefined) return '';
        return String(value)
            .normalize('NFD')
            .replace(/[\u0300-\u036f]/g, '')
            .replace(/['`]/g, '')
            .replace(/&/g, ' and ')
            .replace(/[^a-zA-Z0-9]+/g, ' ')
            .trim()
            .replace(/\s+/g, ' ')
            .toLowerCase();
    }

    function getTournamentGroupsConfig() {
        const groups = APP && Array.isArray(APP.groupStageGroups) ? APP.groupStageGroups : [];
        return groups.map(group => ({
            group: String(group.group || '').toUpperCase(),
            teams: (group.teams || []).map((team, idx) => ({
                ...team,
                group: String(group.group || '').toUpperCase(),
                order: idx + 1,
                name: team.name || team.slot || `Team ${idx + 1}`
            }))
        })).filter(group => group.group && group.teams.length);
    }

    function getTournamentTeamNames(team) {
        if (!team) return [];
        if (typeof team === 'string') return [team];
        return [team.name, team.slot, ...(Array.isArray(team.aliases) ? team.aliases : [])].filter(Boolean);
    }

    function buildTournamentTeamResolver(groups) {
        const allTeams = [];
        const byKey = new Map();
        const byGroup = new Map();

        groups.forEach(group => {
            const groupTeams = [];
            group.teams.forEach(team => {
                const row = {
                    ...team,
                    key: normalizeTournamentName(team.name || team.slot),
                    displayName: team.name || team.slot,
                    group: group.group
                };
                allTeams.push(row);
                groupTeams.push(row);
                getTournamentTeamNames(row).forEach(name => {
                    const key = normalizeTournamentName(name);
                    if (key) byKey.set(key, row);
                });
            });
            byGroup.set(group.group, groupTeams);
        });

        return { allTeams, byKey, byGroup };
    }

    function findTournamentTeam(name, resolver, groupLetter = null) {
        const key = normalizeTournamentName(name);
        if (!key || !resolver) return null;
        const candidates = groupLetter ? (resolver.byGroup.get(String(groupLetter).toUpperCase()) || []) : resolver.allTeams;
        const direct = candidates.find(team => getTournamentTeamNames(team).some(alias => normalizeTournamentName(alias) === key));
        return direct || resolver.byKey.get(key) || null;
    }

    function getTournamentFlag(team) {
        if (!team) return '';
        const names = getTournamentTeamNames(team);
        for (const name of names) {
            const flag = getNationFlag(name);
            if (flag) return flag;
        }
        return '';
    }

    function getTournamentMatchScore(m, mc) {
        const goals = m?.goals || {};
        const home = goals.home ?? goals.homeGoals ?? m?.homeGoals ?? m?.scoreHome ?? m?.homeScore ?? null;
        const away = goals.away ?? goals.awayGoals ?? m?.awayGoals ?? m?.scoreAway ?? m?.awayScore ?? null;
        if (home !== null && away !== null) {
            return {
                homeName: m.teamA || m.home || m.homeTeam || '',
                awayName: m.teamB || m.away || m.awayTeam || '',
                homeGoals: Number(home),
                awayGoals: Number(away)
            };
        }

        const parsed = parseResultString(mc?.resultText || m?.resultText || '');
        if (!parsed) return null;
        return {
            homeName: parsed.homeName,
            awayName: parsed.awayName,
            homeGoals: parsed.homeGoals,
            awayGoals: parsed.awayGoals
        };
    }

    function collectTournamentPlayedMatches(resolver) {
        const matches = [];
        const seen = new Set();

        const addMatch = (m, mc, fallbackKey) => {
            const scheduledMatch = mc?.rawMatchId !== undefined && mc?.rawMatchId !== null
                ? findScheduleEntryForRawMatchId(mc.rawMatchId)
                : (scheduleCatalog.includes(m) ? m : null);
            if (scheduledMatch) {
                const statusInfo = getScheduleStatusInfo(scheduledMatch);
                if (!statusInfo.isLive && !statusInfo.isUpdateOpen && !statusInfo.isFinished) return;
            }

            const score = getTournamentMatchScore(m, mc);
            if (!score) return;
            if (!Number.isFinite(score.homeGoals) || !Number.isFinite(score.awayGoals)) return;

            const group = APP && typeof APP.getGroupStageGroup === 'function'
                ? APP.getGroupStageGroup(score.homeName, score.awayName)
                : null;
            if (!group) return;

            const homeTeam = findTournamentTeam(score.homeName, resolver, group);
            const awayTeam = findTournamentTeam(score.awayName, resolver, group);
            if (!homeTeam || !awayTeam || homeTeam.key === awayTeam.key) return;

            const key = mc?.rawMatchId !== undefined && mc?.rawMatchId !== null
                ? `raw_${mc.rawMatchId}`
                : (m?.id !== undefined && m?.id !== null ? `fx_${m.id}` : fallbackKey);
            if (seen.has(key)) return;
            seen.add(key);

            matches.push({
                key,
                group: String(group).toUpperCase(),
                homeTeam,
                awayTeam,
                homeGoals: score.homeGoals,
                awayGoals: score.awayGoals,
                matchNumber: mc?.number || null,
                rawMatchId: mc?.rawMatchId || null,
                date: m?.date || mc?.dateTime || ''
            });
        };

        scheduleCatalog.forEach((m, idx) => {
            const mc = findMatchCatalogForScheduleEntry(m);
            addMatch(m, mc, `schedule_${idx}`);
        });

        matchCatalog.forEach((mc, idx) => {
            addMatch({
                id: mc.rawMatchId,
                teamA: mc.teamA,
                teamB: mc.teamB,
                resultText: mc.resultText,
                date: mc.dateTime
            }, mc, `catalog_${idx}`);
        });

        return matches.sort((a, b) => {
            const ga = a.group.localeCompare(b.group, 'de');
            if (ga !== 0) return ga;
            const da = a.date ? new Date(a.date).getTime() : NaN;
            const db = b.date ? new Date(b.date).getTime() : NaN;
            if (Number.isFinite(da) && Number.isFinite(db) && da !== db) return da - db;
            return (a.matchNumber || 9999) - (b.matchNumber || 9999);
        });
    }

    function createTournamentStandingRow(team) {
        const fairPlay = Number(team.fairPlayScore ?? team.fairPlay ?? team.teamConductScore ?? 0);
        const fifaRank = Number(team.fifaRank ?? team.fifaRanking ?? team.worldRanking ?? Infinity);
        return {
            ...team,
            key: team.key || normalizeTournamentName(team.name || team.slot),
            displayName: team.displayName || team.name || team.slot,
            played: 0,
            won: 0,
            drawn: 0,
            lost: 0,
            gf: 0,
            ga: 0,
            gd: 0,
            pts: 0,
            fairPlay: Number.isFinite(fairPlay) ? fairPlay : 0,
            fifaRank: Number.isFinite(fifaRank) ? fifaRank : Infinity,
            h2h: new Map(),
            rank: null,
            rankNote: ''
        };
    }

    function getTournamentH2hRow(row, opponentKey) {
        if (!row.h2h.has(opponentKey)) {
            row.h2h.set(opponentKey, { played: 0, pts: 0, gf: 0, ga: 0 });
        }
        return row.h2h.get(opponentKey);
    }

    function applyTournamentMatchToRows(rowsByKey, match) {
        const home = rowsByKey.get(match.homeTeam.key);
        const away = rowsByKey.get(match.awayTeam.key);
        if (!home || !away) return;

        const hg = Number(match.homeGoals);
        const ag = Number(match.awayGoals);
        const homePts = hg > ag ? 3 : (hg === ag ? 1 : 0);
        const awayPts = ag > hg ? 3 : (hg === ag ? 1 : 0);

        home.played += 1;
        away.played += 1;
        home.gf += hg;
        home.ga += ag;
        away.gf += ag;
        away.ga += hg;
        home.pts += homePts;
        away.pts += awayPts;
        if (hg > ag) { home.won += 1; away.lost += 1; }
        else if (ag > hg) { away.won += 1; home.lost += 1; }
        else { home.drawn += 1; away.drawn += 1; }
        home.gd = home.gf - home.ga;
        away.gd = away.gf - away.ga;

        const homeH2h = getTournamentH2hRow(home, away.key);
        homeH2h.played += 1;
        homeH2h.pts += homePts;
        homeH2h.gf += hg;
        homeH2h.ga += ag;

        const awayH2h = getTournamentH2hRow(away, home.key);
        awayH2h.played += 1;
        awayH2h.pts += awayPts;
        awayH2h.gf += ag;
        awayH2h.ga += hg;
    }

    function getTournamentH2hStats(row, tiedRows) {
        return tiedRows.reduce((acc, opponent) => {
            if (!opponent || opponent.key === row.key) return acc;
            const item = row.h2h.get(opponent.key);
            if (!item) return acc;
            acc.played += item.played;
            acc.pts += item.pts;
            acc.gf += item.gf;
            acc.ga += item.ga;
            return acc;
        }, { played: 0, pts: 0, gf: 0, ga: 0, gd: 0 });
    }

    function compareTournamentTiedRows(a, b, tiedRows) {
        const h2hA = getTournamentH2hStats(a, tiedRows);
        const h2hB = getTournamentH2hStats(b, tiedRows);
        h2hA.gd = h2hA.gf - h2hA.ga;
        h2hB.gd = h2hB.gf - h2hB.ga;

        if (h2hA.pts !== h2hB.pts) return h2hB.pts - h2hA.pts;
        if (h2hA.gd !== h2hB.gd) return h2hB.gd - h2hA.gd;
        if (h2hA.gf !== h2hB.gf) return h2hB.gf - h2hA.gf;
        if (a.gd !== b.gd) return b.gd - a.gd;
        if (a.gf !== b.gf) return b.gf - a.gf;
        if (a.fairPlay !== b.fairPlay) return b.fairPlay - a.fairPlay;
        if (a.fifaRank !== b.fifaRank) return a.fifaRank - b.fifaRank;
        return a.order - b.order;
    }

    function sortTournamentGroupRows(rows) {
        const buckets = new Map();
        rows.forEach(row => {
            const key = String(row.pts);
            if (!buckets.has(key)) buckets.set(key, []);
            buckets.get(key).push(row);
        });

        return Array.from(buckets.keys())
            .map(Number)
            .sort((a, b) => b - a)
            .flatMap(points => {
                const bucket = buckets.get(String(points)) || [];
                if (bucket.length <= 1) return bucket;
                return bucket.slice().sort((a, b) => compareTournamentTiedRows(a, b, bucket));
            })
            .map((row, idx, rankedRows) => {
                row.rank = idx + 1;
                row.rankNote = getTournamentRankNote(row, rankedRows);
                return row;
            });
    }

    function getTournamentRankNote(row, rankedRows) {
        const samePoints = rankedRows.filter(other => other.key !== row.key && other.pts === row.pts);
        if (!samePoints.length) return 'Punkte';
        const tiedRows = [row, ...samePoints];
        const h2h = getTournamentH2hStats(row, tiedRows);
        const h2hValues = tiedRows.map(item => {
            const value = getTournamentH2hStats(item, tiedRows);
            return `${value.pts}|${value.gf - value.ga}|${value.gf}`;
        });
        if (new Set(h2hValues).size > 1 && h2h.played > 0) return 'Direktduell';
        if (new Set(tiedRows.map(item => item.gd)).size > 1) return 'Tordiff.';
        if (new Set(tiedRows.map(item => item.gf)).size > 1) return 'Tore';
        if (new Set(tiedRows.map(item => item.fairPlay)).size > 1) return 'Fair Play';
        if (tiedRows.some(item => Number.isFinite(item.fifaRank)) && new Set(tiedRows.map(item => item.fifaRank)).size > 1) return 'FIFA-Rang';
        return 'offen';
    }

    function compareTournamentThirdRows(a, b) {
        if (a.pts !== b.pts) return b.pts - a.pts;
        if (a.gd !== b.gd) return b.gd - a.gd;
        if (a.gf !== b.gf) return b.gf - a.gf;
        if (a.fairPlay !== b.fairPlay) return b.fairPlay - a.fairPlay;
        if (a.fifaRank !== b.fifaRank) return a.fifaRank - b.fifaRank;
        return a.group.localeCompare(b.group, 'de');
    }

    function buildTournamentStandings() {
        const groups = getTournamentGroupsConfig();
        const resolver = buildTournamentTeamResolver(groups);
        const playedMatches = collectTournamentPlayedMatches(resolver);
        const groupsByLetter = new Map();

        groups.forEach(group => {
            const rows = group.teams.map(createTournamentStandingRow);
            const rowsByKey = new Map(rows.map(row => [row.key, row]));
            groupsByLetter.set(group.group, { group: group.group, rows, rowsByKey, rankedRows: [], playedMatches: 0 });
        });

        playedMatches.forEach(match => {
            const group = groupsByLetter.get(match.group);
            if (!group) return;
            applyTournamentMatchToRows(group.rowsByKey, match);
            group.playedMatches += 1;
        });

        const groupResults = Array.from(groupsByLetter.values()).map(group => {
            group.rankedRows = sortTournamentGroupRows(group.rows);
            return group;
        });

        const thirdRows = groupResults
            .map(group => group.rankedRows[2] ? { ...group.rankedRows[2], sourceGroup: group } : null)
            .filter(Boolean)
            .sort(compareTournamentThirdRows)
            .map((row, idx) => ({ ...row, thirdRank: idx + 1, qualifiesAsThird: idx < 8 }));

        const groupRankMap = new Map();
        groupResults.forEach(group => {
            group.rankedRows.forEach(row => {
                groupRankMap.set(`${group.group}:${row.rank}`, row);
            });
        });

        const thirdByGroup = new Map(thirdRows.map(row => [row.group, row]));
        const totalPlayed = playedMatches.length;

        return { groups: groupResults, thirdRows, groupRankMap, thirdByGroup, playedMatches, totalPlayed };
    }

    function areTournamentOrdersEqual(a, b) {
        if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false;
        return a.every((value, idx) => String(value) === String(b[idx]));
    }

    function sanitizeTournamentOrder(savedOrder, validOrder) {
        const valid = (validOrder || []).map(value => String(value));
        const validSet = new Set(valid);
        const seen = new Set();
        const clean = [];
        (Array.isArray(savedOrder) ? savedOrder : []).forEach(value => {
            const key = String(value);
            if (!validSet.has(key) || seen.has(key)) return;
            seen.add(key);
            clean.push(key);
        });
        valid.forEach(key => {
            if (seen.has(key)) return;
            seen.add(key);
            clean.push(key);
        });
        return clean;
    }

    function sanitizeTournamentManualGroupOrders(savedGroupOrders, context) {
        const groups = (context?.groups || []).map(group => ({
            key: String(group.group || '').toUpperCase(),
            size: (group.rows || []).length,
            originalKeys: (group.rows || []).map(row => String(row.key)).filter(Boolean)
        })).filter(group => group.key && group.size > 0);
        const allKeys = groups.flatMap(group => group.originalKeys);
        const allSet = new Set(allKeys);
        const seen = new Set();
        const clean = {};
        const source = savedGroupOrders && typeof savedGroupOrders === 'object' ? savedGroupOrders : {};

        groups.forEach(group => {
            const order = [];
            (Array.isArray(source[group.key]) ? source[group.key] : []).forEach(value => {
                const key = String(value);
                if (!allSet.has(key) || seen.has(key) || order.length >= group.size) return;
                seen.add(key);
                order.push(key);
            });
            clean[group.key] = order;
        });

        groups.forEach(group => {
            const order = clean[group.key];
            group.originalKeys.forEach(key => {
                if (order.length >= group.size || seen.has(key)) return;
                seen.add(key);
                order.push(key);
            });
            allKeys.forEach(key => {
                if (order.length >= group.size || seen.has(key)) return;
                seen.add(key);
                order.push(key);
            });
        });

        return clean;
    }

    function getTournamentManualPredictionConfig() {
        const key = String(APP?.key || TOURNAMENT_YEAR || '').toLowerCase();
        return TOURNAMENT_MANUAL_PREDICTIONS[key] || null;
    }

    function getTournamentDefaultGroupOrder(group) {
        return (group?.rows || [])
            .slice()
            .sort((a, b) => (a.order || 0) - (b.order || 0))
            .map(row => row.key);
    }

    function hasTournamentManualOrder(order) {
        return Array.isArray(order) && order.length > 0;
    }

    function hasTournamentManualWinnerPicks() {
        return tournamentManualState?.winners
            && typeof tournamentManualState.winners === 'object'
            && Object.keys(tournamentManualState.winners).length > 0;
    }

    function isTournamentManualStateUntouched(context) {
        if (hasTournamentManualWinnerPicks()) return false;

        const groups = context?.groups || [];
        const cleanGroupOrders = sanitizeTournamentManualGroupOrders(tournamentManualState.groupOrders, context);
        for (const group of groups) {
            const groupKey = String(group.group || '').toUpperCase();
            const savedOrder = tournamentManualState.groupOrders?.[groupKey];
            if (!hasTournamentManualOrder(savedOrder)) continue;

            const cleanOrder = cleanGroupOrders[groupKey] || [];
            const defaultOrder = getTournamentDefaultGroupOrder(group);
            if (!areTournamentOrdersEqual(cleanOrder, defaultOrder)) return false;
        }

        const savedThirdOrder = tournamentManualState.thirdOrder;
        if (hasTournamentManualOrder(savedThirdOrder)) {
            const validThirdGroups = groups.map(group => String(group.group || '').toUpperCase()).filter(Boolean);
            const cleanThirdOrder = sanitizeTournamentOrder(savedThirdOrder, validThirdGroups);
            if (!areTournamentOrdersEqual(cleanThirdOrder, validThirdGroups)) return false;
        }

        return true;
    }

    function findTournamentPredictionRow(group, teamName) {
        const key = normalizeTournamentName(teamName);
        if (!key) return null;
        return (group?.rows || []).find(row =>
            row.key === key
            || getTournamentTeamNames(row).some(name => normalizeTournamentName(name) === key)
        ) || null;
    }

    function buildTournamentManualPrediction(context) {
        const config = getTournamentManualPredictionConfig();
        const groupPrediction = config?.groupOrders || {};
        const groupOrders = {};

        (context?.groups || []).forEach(group => {
            const groupKey = String(group.group || '').toUpperCase();
            const seen = new Set();
            const order = [];
            (groupPrediction[groupKey] || []).forEach(teamName => {
                const row = findTournamentPredictionRow(group, teamName);
                if (!row || seen.has(row.key)) return;
                seen.add(row.key);
                order.push(row.key);
            });
            (group.rows || []).forEach(row => {
                if (seen.has(row.key)) return;
                seen.add(row.key);
                order.push(row.key);
            });
            groupOrders[groupKey] = order;
        });

        const validThirdGroups = (context?.groups || [])
            .map(group => String(group.group || '').toUpperCase())
            .filter(Boolean);
        const thirdOrder = sanitizeTournamentOrder(config?.thirdOrder || [], validThirdGroups);

        return { groupOrders, thirdOrder };
    }

    function buildTournamentManualAutoOrders(context) {
        const groupOrders = {};

        (context?.groups || []).forEach(group => {
            const groupKey = String(group.group || '').toUpperCase();
            const sourceRows = (group.rankedRows && group.rankedRows.length)
                ? group.rankedRows
                : (group.rows || []);
            groupOrders[groupKey] = sourceRows.map(row => row.key).filter(Boolean);
        });

        const thirdOrder = (context?.thirdRows || [])
            .map(row => String(row.group || '').toUpperCase())
            .filter(Boolean);

        return { groupOrders, thirdOrder };
    }

    function buildTournamentManualDefaultOrders(context) {
        const prediction = buildTournamentManualPrediction(context);
        const autoOrders = buildTournamentManualAutoOrders(context);
        const groupOrders = {};

        (context?.groups || []).forEach(group => {
            const groupKey = String(group.group || '').toUpperCase();
            const validOrder = (group.rows || []).map(row => row.key);
            const hasPlayedMatches = Number(group.playedMatches || 0) > 0;
            const sourceOrder = hasPlayedMatches
                ? autoOrders.groupOrders[groupKey]
                : prediction.groupOrders[groupKey];
            groupOrders[groupKey] = sanitizeTournamentOrder(sourceOrder || [], validOrder);
        });

        const validThirdGroups = (context?.groups || [])
            .map(group => String(group.group || '').toUpperCase())
            .filter(Boolean);
        const thirdSource = Number(context?.totalPlayed || 0) > 0
            ? autoOrders.thirdOrder
            : prediction.thirdOrder;
        const thirdOrder = sanitizeTournamentOrder(thirdSource || [], validThirdGroups);

        return { groupOrders, thirdOrder };
    }

    function ensureTournamentManualPredictionDefaults(context) {
        if (!context?.groups?.length) return false;

        tournamentManualState = normalizeTournamentManualState(tournamentManualState);
        const defaultOrders = buildTournamentManualDefaultOrders(context);
        const canReplaceExistingDefaults = !tournamentManualState.manualPredictionInitialized
            && isTournamentManualStateUntouched(context);
        const hasAnySavedGroupOrder = Object.values(tournamentManualState.groupOrders || {})
            .some(order => hasTournamentManualOrder(order));
        const cleanSavedGroupOrders = sanitizeTournamentManualGroupOrders(tournamentManualState.groupOrders, context);
        const defaultGroupOrders = sanitizeTournamentManualGroupOrders(defaultOrders.groupOrders || {}, context);
        let changed = false;

        context.groups.forEach(group => {
            const groupKey = String(group.group || '').toUpperCase();
            const savedOrder = tournamentManualState.groupOrders[groupKey];
            const cleanSavedOrder = cleanSavedGroupOrders[groupKey] || [];
            const defaultOrder = defaultGroupOrders[groupKey] || [];
            const nextOrder = (canReplaceExistingDefaults || !hasAnySavedGroupOrder)
                ? defaultOrder
                : cleanSavedOrder;

            if (!areTournamentOrdersEqual(savedOrder, nextOrder)) {
                tournamentManualState.groupOrders[groupKey] = nextOrder;
                changed = true;
            }
        });

        const validThirdGroups = context.groups.map(group => String(group.group || '').toUpperCase()).filter(Boolean);
        const cleanSavedThirdOrder = hasTournamentManualOrder(tournamentManualState.thirdOrder)
            ? sanitizeTournamentOrder(tournamentManualState.thirdOrder, validThirdGroups)
            : [];
        const defaultThirdOrder = sanitizeTournamentOrder(defaultOrders.thirdOrder || [], validThirdGroups);
        const nextThirdOrder = (canReplaceExistingDefaults || !cleanSavedThirdOrder.length)
            ? defaultThirdOrder
            : cleanSavedThirdOrder;

        if (!areTournamentOrdersEqual(tournamentManualState.thirdOrder, nextThirdOrder)) {
            tournamentManualState.thirdOrder = nextThirdOrder;
            changed = true;
        }

        if (!tournamentManualState.manualPredictionInitialized) {
            tournamentManualState.manualPredictionInitialized = true;
            changed = true;
        }

        return changed;
    }

    function resetTournamentManualStateToPrediction() {
        if (!isTournamentManualMode()) return;
        const autoContext = attachTournamentBestThirdAssignments(buildTournamentStandings());
        if (!autoContext?.groups?.length) return;
        const defaultOrders = buildTournamentManualDefaultOrders(autoContext);
        const groupOrders = {};

        autoContext.groups.forEach(group => {
            const groupKey = String(group.group || '').toUpperCase();
            const validOrder = (group.rows || []).map(row => row.key);
            groupOrders[groupKey] = sanitizeTournamentOrder(defaultOrders.groupOrders[groupKey] || [], validOrder);
        });

        const validThirdGroups = autoContext.groups.map(group => String(group.group || '').toUpperCase()).filter(Boolean);
        tournamentManualState = normalizeTournamentManualState({
            ...tournamentManualState,
            mode: TOURNAMENT_MODE_MANUAL,
            manualPredictionInitialized: true,
            groupOrders,
            thirdOrder: sanitizeTournamentOrder(defaultOrders.thirdOrder || [], validThirdGroups),
            winners: {}
        });
        saveTournamentManualState();
        renderTournamentView();
    }

    function buildTournamentBestThirdAssignments(context) {
        const qualifiedGroups = (context.thirdRows || [])
            .filter(row => row.qualifiesAsThird)
            .map(row => String(row.group || '').toUpperCase())
            .filter(Boolean)
            .sort((a, b) => a.localeCompare(b, 'de'))
            .join('');
        const encoded = FIFA_THIRD_PLACE_ASSIGNMENTS.get(qualifiedGroups) || '';
        const byMatch = new Map();
        const byWinnerGroup = new Map();
        if (encoded.length === FIFA_THIRD_PLACE_WINNER_ORDER.length) {
            encoded.split('').forEach((thirdGroup, idx) => {
                const winnerGroup = FIFA_THIRD_PLACE_WINNER_ORDER[idx];
                const matchNumber = FIFA_THIRD_PLACE_WINNER_MATCH[winnerGroup];
                if (!matchNumber || !thirdGroup) return;
                byMatch.set(matchNumber, thirdGroup);
                byWinnerGroup.set(winnerGroup, thirdGroup);
            });
        }
        return { key: qualifiedGroups, byMatch, byWinnerGroup };
    }

    function attachTournamentBestThirdAssignments(context) {
        const assignments = buildTournamentBestThirdAssignments(context);
        context.bestThirdAssignmentKey = assignments.key;
        context.bestThirdByMatch = assignments.byMatch;
        context.bestThirdByWinnerGroup = assignments.byWinnerGroup;
        return context;
    }

    function hydrateTournamentManualOrders(context) {
        tournamentManualState = normalizeTournamentManualState(tournamentManualState);
        let changed = false;
        const cleanGroupOrders = sanitizeTournamentManualGroupOrders(tournamentManualState.groupOrders, context);

        context.groups.forEach(group => {
            const groupKey = String(group.group || '').toUpperCase();
            const clean = cleanGroupOrders[groupKey] || [];
            if (!areTournamentOrdersEqual(tournamentManualState.groupOrders[groupKey], clean)) {
                tournamentManualState.groupOrders[groupKey] = clean;
                changed = true;
            }
        });

        const validThirdGroups = context.groups.map(group => String(group.group || '').toUpperCase()).filter(Boolean);
        const cleanThirdOrder = sanitizeTournamentOrder(tournamentManualState.thirdOrder, validThirdGroups);
        if (!areTournamentOrdersEqual(tournamentManualState.thirdOrder, cleanThirdOrder)) {
            tournamentManualState.thirdOrder = cleanThirdOrder;
            changed = true;
        }

        if (changed) saveTournamentManualState();
    }

    function cloneTournamentRowForManual(row, rank, groupKey) {
        return {
            ...row,
            group: groupKey || row.group,
            originalGroup: row.originalGroup || row.group,
            rank,
            rankNote: 'Manuell'
        };
    }

    function applyTournamentManualState(autoContext) {
        const predictionChanged = ensureTournamentManualPredictionDefaults(autoContext);
        hydrateTournamentManualOrders(autoContext);
        if (predictionChanged) saveTournamentManualState();
        const rowsByTeamKey = new Map();
        autoContext.groups.forEach(group => {
            (group.rows || []).forEach(row => {
                if (row && row.key) rowsByTeamKey.set(row.key, row);
            });
        });

        const groupResults = autoContext.groups.map(group => {
            const groupKey = String(group.group || '').toUpperCase();
            const rankedRows = (tournamentManualState.groupOrders[groupKey] || [])
                .map((teamKey, idx) => {
                    const row = rowsByTeamKey.get(teamKey);
                    return row ? cloneTournamentRowForManual(row, idx + 1, groupKey) : null;
                })
                .filter(Boolean);
            const manualRowsByKey = new Map(rankedRows.map(row => [row.key, row]));
            return {
                ...group,
                rows: rankedRows,
                rankedRows,
                rowsByKey: manualRowsByKey
            };
        });

        const groupByLetter = new Map(groupResults.map(group => [String(group.group).toUpperCase(), group]));
        const groupRankMap = new Map();
        groupResults.forEach(group => {
            group.rankedRows.forEach(row => {
                groupRankMap.set(`${group.group}:${row.rank}`, row);
            });
        });

        const thirdRows = (tournamentManualState.thirdOrder || [])
            .map(groupLetter => {
                const group = groupByLetter.get(String(groupLetter).toUpperCase());
                const row = group && group.rankedRows[2] ? group.rankedRows[2] : null;
                return row ? { ...row, sourceGroup: group } : null;
            })
            .filter(Boolean)
            .map((row, idx) => ({
                ...row,
                thirdRank: idx + 1,
                qualifiesAsThird: idx < 8,
                rankNote: 'Manuell'
            }));

        const context = attachTournamentBestThirdAssignments({
            ...autoContext,
            groups: groupResults,
            thirdRows,
            groupRankMap,
            thirdByGroup: new Map(thirdRows.map(row => [row.group, row]))
        });
        pruneTournamentManualWinners(context);
        return context;
    }

    function buildTournamentContext() {
        const autoContext = attachTournamentBestThirdAssignments(buildTournamentStandings());
        if (!isTournamentManualMode()) return autoContext;
        return applyTournamentManualState(autoContext);
    }

    function formatTournamentDate(value) {
        const dt = value ? new Date(value) : null;
        if (!dt || Number.isNaN(dt.getTime())) return '';
        const dateLabel = dt.toLocaleDateString('de-CH', { day: '2-digit', month: '2-digit' });
        const hasExplicitTime = /T|\d{1,2}:\d{2}/.test(String(value));
        if (!hasExplicitTime) return dateLabel;
        const timeLabel = dt.toLocaleTimeString('de-CH', { hour: '2-digit', minute: '2-digit' });
        return `${dateLabel}, ${timeLabel}`;
    }

    function renderTournamentTeamCell(row) {
        const flag = getTournamentFlag(row);
        const flagHtml = renderFlagImageHtml('tg-team-flag', flag, '', row.displayName || row.name);
        return `<div class="tg-team-cell">${flagHtml}<span class="tg-team-name">${escapeHtml(row.displayName || row.name)}</span></div>`;
    }

    function formatTournamentManualRowMeta(row) {
        const gd = Number(row.gd || 0);
        const gdText = gd > 0 ? `+${gd}` : String(gd);
        return `${row.pts || 0} P / ${gdText}`;
    }

    function renderTournamentManualRankRow(row, options) {
        const status = row.rank <= 2 ? 'Top 2' : (row.rank === 3 ? 'Dritter' : 'Raus');
        const statusClass = row.rank <= 2 ? 'tg-row--qualified' : (row.rank === 3 ? 'tg-row--third' : 'tg-row--out');
        return `<div class="tg-manual-row ${statusClass}" data-manual-sort-item data-sort-kind="group" data-group="${escapeHtml(options.group)}" data-team-key="${escapeHtml(row.key)}" role="listitem">
            <span class="tg-rank-pill">${escapeHtml(row.rank)}</span>
            <span class="tg-manual-grip" aria-hidden="true"></span>
            ${renderTournamentTeamCell(row)}
            <div class="tg-manual-meta">
                <span>${escapeHtml(formatTournamentManualRowMeta(row))}</span>
                <span class="tg-manual-status">${escapeHtml(status)}</span>
            </div>
        </div>`;
    }

    function renderTournamentManualGroupTable(group) {
        const rowsHtml = group.rankedRows
            .map(row => renderTournamentManualRankRow(row, { group: group.group }))
            .join('');

        return `<section class="tournament-group-card is-manual">
            <div class="tournament-group-header">
                <div class="tournament-group-title">Gruppe ${escapeHtml(group.group)}</div>
                <div class="tournament-group-actions">
                    <div class="tournament-group-meta">${escapeHtml(group.playedMatches)} / 6 Spiele</div>
                </div>
            </div>
            <div class="tg-manual-list" data-manual-sort-list data-sort-kind="group" data-group="${escapeHtml(group.group)}" role="list" aria-label="Manuelle Rangliste Gruppe ${escapeHtml(group.group)}">
                ${rowsHtml}
            </div>
        </section>`;
    }

    function renderTournamentGroupTable(group) {
        if (isTournamentManualMode()) return renderTournamentManualGroupTable(group);

        const isExpanded = expandedTournamentGroups.has(String(group.group));
        const rowsHtml = group.rankedRows.map(row => {
            const cls = row.rank <= 2 ? 'tg-row--qualified' : (row.rank === 3 ? 'tg-row--third' : 'tg-row--out');
            const gd = row.gd > 0 ? `+${row.gd}` : String(row.gd);
            if (!isExpanded) {
                return `<tr class="${cls}">
                    <td><span class="tg-rank-pill">${escapeHtml(row.rank)}</span></td>
                    <td>${renderTournamentTeamCell(row)}</td>
                    <td class="tg-points">${escapeHtml(row.pts)}</td>
                </tr>`;
            }
            return `<tr class="${cls}">
                <td><span class="tg-rank-pill">${escapeHtml(row.rank)}</span></td>
                <td>${renderTournamentTeamCell(row)}</td>
                <td>${escapeHtml(row.played)}</td>
                <td>${escapeHtml(row.won)}</td>
                <td>${escapeHtml(row.drawn)}</td>
                <td>${escapeHtml(row.lost)}</td>
                <td>${escapeHtml(row.gf)}:${escapeHtml(row.ga)}</td>
                <td>${escapeHtml(gd)}</td>
                <td class="tg-points">${escapeHtml(row.pts)}</td>
                <td class="tg-tiebreak" title="${escapeHtml(row.rankNote)}">${escapeHtml(row.rankNote)}</td>
            </tr>`;
        }).join('');

        const tableHead = isExpanded
            ? '<tr><th>R</th><th>Team</th><th>Sp</th><th>S</th><th>U</th><th>N</th><th>Tore</th><th>Diff</th><th>Pk</th><th>Tie</th></tr>'
            : '<tr><th>R</th><th>Team</th><th>Punkte</th></tr>';
        const tableClass = isExpanded ? 'tournament-table' : 'tournament-table tournament-table--compact';
        const wrapClass = isExpanded ? 'tournament-table-wrap' : 'tournament-table-wrap tournament-table-wrap--compact';

        return `<section class="tournament-group-card${isExpanded ? ' is-expanded' : ''}">
            <div class="tournament-group-header">
                <div class="tournament-group-title">Gruppe ${escapeHtml(group.group)}</div>
                <div class="tournament-group-actions">
                    <div class="tournament-group-meta">${escapeHtml(group.playedMatches)} / 6 Spiele</div>
                    <button type="button" class="tournament-group-toggle" data-tournament-group-toggle="${escapeHtml(group.group)}" aria-expanded="${escapeHtml(isExpanded)}">
                        <span>Details</span>
                        <span class="tournament-group-toggle-icon" aria-hidden="true"></span>
                    </button>
                </div>
            </div>
            <div class="${wrapClass}">
                <table class="${tableClass}" aria-label="Tabelle Gruppe ${escapeHtml(group.group)}">
                    <thead>${tableHead}</thead>
                    <tbody>${rowsHtml}</tbody>
                </table>
            </div>
        </section>`;
    }

    function bindTournamentGroupToggles() {
        document.querySelectorAll('[data-tournament-group-toggle]').forEach(btn => {
            btn.addEventListener('click', () => {
                const groupKey = String(btn.getAttribute('data-tournament-group-toggle') || '');
                if (!groupKey) return;
                if (expandedTournamentGroups.has(groupKey)) {
                    expandedTournamentGroups.delete(groupKey);
                } else {
                    expandedTournamentGroups.add(groupKey);
                }
                renderTournamentView();
            });
        });
    }

    function renderTournamentManualThirdPlacesTable(context) {
        const rowsHtml = context.thirdRows.map(row => {
            const statusClass = row.qualifiesAsThird ? 'tg-status--in' : 'tg-status--out';
            const statusLabel = row.qualifiesAsThird ? 'drin' : 'raus';
            return `<div class="tg-manual-row ${row.qualifiesAsThird ? 'tg-row--third' : 'tg-row--out'}" data-manual-sort-item data-sort-kind="third" data-group="${escapeHtml(row.group)}" role="listitem">
                <span class="tg-rank-pill">${escapeHtml(row.thirdRank)}</span>
                <span class="tg-manual-grip" aria-hidden="true"></span>
                ${renderTournamentTeamCell(row)}
                <div class="tg-manual-meta">${escapeHtml(row.group)}</div>
                <span class="tg-status ${statusClass}">${escapeHtml(statusLabel)}</span>
            </div>`;
        }).join('');

        return `<section class="tournament-third-card">
            <div class="tournament-third-header">
                <div class="tournament-third-title">Drittplatzierte</div>
                <div class="tournament-third-meta">Top 8 qualifizieren sich</div>
            </div>
            <div class="tournament-third-manual-list" data-manual-sort-list data-sort-kind="third" role="list" aria-label="Manuelle Tabelle der Drittplatzierten">
                ${rowsHtml}
            </div>
        </section>`;
    }

    function renderTournamentThirdPlacesTable(context) {
        if (isTournamentManualMode()) return renderTournamentManualThirdPlacesTable(context);

        const rowsHtml = context.thirdRows.map(row => {
            const gd = row.gd > 0 ? `+${row.gd}` : String(row.gd);
            const statusClass = row.qualifiesAsThird ? 'tg-status--in' : 'tg-status--out';
            const statusLabel = row.qualifiesAsThird ? 'aktuell drin' : 'aktuell raus';
            return `<tr class="${row.qualifiesAsThird ? 'tg-row--third' : 'tg-row--out'}">
                <td><span class="tg-rank-pill">${escapeHtml(row.thirdRank)}</span></td>
                <td>${renderTournamentTeamCell(row)}</td>
                <td>${escapeHtml(row.group)}</td>
                <td>${escapeHtml(row.played)}</td>
                <td class="tg-points">${escapeHtml(row.pts)}</td>
                <td>${escapeHtml(gd)}</td>
                <td>${escapeHtml(row.gf)}</td>
                <td class="tg-tiebreak" title="${escapeHtml(row.rankNote)}">${escapeHtml(row.rankNote)}</td>
                <td><span class="tg-status ${statusClass}">${escapeHtml(statusLabel)}</span></td>
            </tr>`;
        }).join('');

        const note = context.thirdRows.some(row => row.rankNote === 'offen')
            ? `<div class="tournament-data-note">Fair-Play-Wertung und FIFA-Rangfolge werden berücksichtigt, sobald sie in der Turnier-Konfiguration pro Team vorhanden sind. Bis dahin bleiben exakt gleiche Fälle als offen markiert.</div>`
            : '';

        return `<section class="tournament-third-card">
            <div class="tournament-third-header">
                <div class="tournament-third-title">Drittplatzierte</div>
                <div class="tournament-third-meta">Top 8 qualifizieren sich</div>
            </div>
            <div class="tournament-table-wrap">
                <table class="tournament-table" aria-label="Tabelle aller Gruppendritten">
                    <thead>
                        <tr>
                            <th>R</th><th>Team</th><th>Gr.</th><th>Sp</th><th>Pk</th><th>Diff</th><th>Tore</th><th>Tie</th><th>Status</th>
                        </tr>
                    </thead>
                    <tbody>${rowsHtml}</tbody>
                </table>
            </div>
            ${note}
        </section>`;
    }

    function getTournamentManualSortItems(list) {
        if (!list) return [];
        return Array.from(list.children)
            .filter(item => item.matches && item.matches('[data-manual-sort-item]'));
    }

    function commitTournamentManualSortOrder(listOrLists) {
        const lists = Array.isArray(listOrLists) ? listOrLists : [listOrLists];
        const uniqueLists = Array.from(new Set(lists.filter(Boolean)));
        let changed = false;

        uniqueLists.forEach(list => {
            const kind = list.getAttribute('data-sort-kind');
            if (kind === 'group') {
                const group = String(list.getAttribute('data-group') || '').toUpperCase();
                if (!group) return;
                tournamentManualState.groupOrders[group] = getTournamentManualSortItems(list)
                    .map(item => item.getAttribute('data-team-key'))
                    .filter(Boolean);
                changed = true;
            } else if (kind === 'third') {
                tournamentManualState.thirdOrder = getTournamentManualSortItems(list)
                    .map(item => String(item.getAttribute('data-group') || '').toUpperCase())
                    .filter(Boolean);
                changed = true;
            }
        });

        if (!changed) return;
        saveTournamentManualState();
        renderTournamentView();
    }

    // Distance (px) from the viewport edge where dragging starts auto-scrolling
    // the page, plus the maximum scroll step per animation frame.
    const TOURNAMENT_DRAG_EDGE = 72;
    const TOURNAMENT_DRAG_MAX_SPEED = 20;
    const TOURNAMENT_DRAG_LIST_HIT_PAD = 18;
    const TOURNAMENT_DRAG_SNAP_DURATION = 170;
    // A plain click/tap must never lift the row. We wait for a real movement,
    // then keep the originally grabbed pixel under the pointer.
    const TOURNAMENT_DRAG_START_THRESHOLD = 6;

    function stopTournamentAutoScroll() {
        const state = tournamentManualDragState;
        if (state && state.autoScrollRAF) {
            cancelAnimationFrame(state.autoScrollRAF);
            state.autoScrollRAF = null;
        }
    }

    function tournamentAutoScrollTick() {
        const state = tournamentManualDragState;
        if (!state || !state.active) return;
        const viewportH = window.innerHeight || document.documentElement.clientHeight;
        const y = state.lastClientY;
        let delta = 0;
        if (y < TOURNAMENT_DRAG_EDGE) {
            delta = -Math.ceil(((TOURNAMENT_DRAG_EDGE - y) / TOURNAMENT_DRAG_EDGE) * TOURNAMENT_DRAG_MAX_SPEED);
        } else if (y > viewportH - TOURNAMENT_DRAG_EDGE) {
            delta = Math.ceil(((y - (viewportH - TOURNAMENT_DRAG_EDGE)) / TOURNAMENT_DRAG_EDGE) * TOURNAMENT_DRAG_MAX_SPEED);
        }
        if (delta !== 0) {
            const before = window.scrollY;
            window.scrollBy(0, delta);
            if (window.scrollY !== before) {
                updateTournamentDragVisual();
                updateTournamentDragPlaceholder();
            }
        }
        state.autoScrollRAF = requestAnimationFrame(tournamentAutoScrollTick);
    }

    function updateTournamentDragVisual() {
        const state = tournamentManualDragState;
        if (!state || !state.active) return;
        // Position the floating row so the exact pixel the user grabbed sits
        // directly under the cursor. We use left/top (not transform) so there
        // is no double-applied scroll offset and no "jump" between the click
        // point and where the row ends up.
        const left = state.lastClientX - state.offsetX;
        const top = state.lastClientY - state.offsetY;
        state.item.style.left = `${left}px`;
        state.item.style.top = `${top}px`;
    }

    function clearTournamentManualSnapTarget(state) {
        if (state && state.snapTargetItem) {
            state.snapTargetItem.classList.remove('is-snap-target');
            state.snapTargetItem = null;
        }
    }

    function setTournamentManualSnapTarget(state, item) {
        if (!state || state.snapTargetItem === item) return;
        clearTournamentManualSnapTarget(state);
        if (item) {
            item.classList.add('is-snap-target');
            state.snapTargetItem = item;
        }
    }

    function isTournamentManualPointInsideList(list, x, y) {
        if (!list) return false;
        const rect = list.getBoundingClientRect();
        if (!rect.width || !rect.height) return false;
        return x >= rect.left - TOURNAMENT_DRAG_LIST_HIT_PAD
            && x <= rect.right + TOURNAMENT_DRAG_LIST_HIT_PAD
            && y >= rect.top - TOURNAMENT_DRAG_LIST_HIT_PAD
            && y <= rect.bottom + TOURNAMENT_DRAG_LIST_HIT_PAD;
    }

    function getTournamentManualPointDistanceToList(list, x, y) {
        const rect = list.getBoundingClientRect();
        const cx = Math.min(Math.max(x, rect.left), rect.right);
        const cy = Math.min(Math.max(y, rect.top), rect.bottom);
        return Math.hypot(x - cx, y - cy);
    }

    function getTournamentManualInsertionTarget(list, y) {
        const items = getTournamentManualSortItems(list);
        const before = items.find(item => {
            const rect = item.getBoundingClientRect();
            return y < rect.top + (rect.height / 2);
        }) || null;
        return { type: 'insert', list, before };
    }

    function getTournamentManualNearestSlotItem(list, y) {
        let closest = null;
        let bestDistance = Infinity;
        getTournamentManualSortItems(list).forEach(item => {
            const rect = item.getBoundingClientRect();
            const distance = Math.abs(y - (rect.top + rect.height / 2));
            if (distance < bestDistance) {
                bestDistance = distance;
                closest = item;
            }
        });
        return closest;
    }

    function findTournamentManualDropTarget(state) {
        if (!state || !state.active) return null;
        const kind = state.sortKind;
        const lists = kind === 'group'
            ? Array.from(document.querySelectorAll('[data-manual-sort-list][data-sort-kind="group"]'))
            : [state.originList].filter(Boolean);
        const candidates = lists
            .filter(list => isTournamentManualPointInsideList(list, state.lastClientX, state.lastClientY))
            .sort((a, b) => getTournamentManualPointDistanceToList(a, state.lastClientX, state.lastClientY)
                - getTournamentManualPointDistanceToList(b, state.lastClientX, state.lastClientY));
        const list = candidates[0] || null;
        if (!list) return null;

        if (kind === 'group' && list !== state.originList) {
            const targetItem = getTournamentManualNearestSlotItem(list, state.lastClientY);
            return targetItem ? { type: 'swap', list, targetItem } : null;
        }

        return getTournamentManualInsertionTarget(list, state.lastClientY);
    }

    function moveTournamentManualPlaceholder(state, list, before) {
        if (!state || !state.placeholder || !list) return;
        const targetBefore = before && before.parentNode === list ? before : null;
        if (state.placeholder.parentNode !== list || state.placeholder.nextElementSibling !== targetBefore) {
            list.insertBefore(state.placeholder, targetBefore);
            state.moved = true;
        }
        state.list = list;
    }

    function restoreTournamentManualPlaceholderToOrigin(state) {
        if (!state || !state.originList || !state.placeholder) return;
        const items = getTournamentManualSortItems(state.originList);
        const before = items[state.originIndex] || null;
        moveTournamentManualPlaceholder(state, state.originList, before);
    }

    function updateTournamentDragPlaceholder() {
        const state = tournamentManualDragState;
        if (!state || !state.active || state.finishing) return;
        const target = findTournamentManualDropTarget(state);
        state.currentDropTarget = target;

        if (!target) {
            clearTournamentManualSnapTarget(state);
            restoreTournamentManualPlaceholderToOrigin(state);
            return;
        }

        if (target.type === 'swap') {
            restoreTournamentManualPlaceholderToOrigin(state);
            setTournamentManualSnapTarget(state, target.targetItem);
            state.moved = true;
            return;
        }

        clearTournamentManualSnapTarget(state);
        moveTournamentManualPlaceholder(state, target.list, target.before);
    }

    function shouldReduceTournamentMotion() {
        return !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
    }

    function animateTournamentManualSnap(item, rect) {
        return new Promise(resolve => {
            if (!item || !rect) {
                resolve();
                return;
            }
            const applyFinalRect = () => {
                item.style.left = `${rect.left}px`;
                item.style.top = `${rect.top}px`;
                item.style.width = `${rect.width}px`;
                item.style.height = `${rect.height}px`;
            };
            const animeRunner = typeof window.anime === 'function' ? window.anime : null;
            if (!animeRunner || shouldReduceTournamentMotion()) {
                applyFinalRect();
                requestAnimationFrame(resolve);
                return;
            }
            try {
                animeRunner.remove(item);
                animeRunner({
                    targets: item,
                    left: `${rect.left}px`,
                    top: `${rect.top}px`,
                    width: `${rect.width}px`,
                    height: `${rect.height}px`,
                    duration: TOURNAMENT_DRAG_SNAP_DURATION,
                    easing: 'easeOutCubic',
                    complete: resolve
                });
            } catch (_) {
                applyFinalRect();
                requestAnimationFrame(resolve);
            }
        });
    }

    function resetTournamentManualDraggedItemStyles(item) {
        if (!item) return;
        item.classList.remove('is-dragging');
        item.style.position = '';
        item.style.left = '';
        item.style.top = '';
        item.style.width = '';
        item.style.height = '';
        item.style.margin = '';
        item.style.transform = '';
        item.style.touchAction = '';
    }

    function buildTournamentManualDropPlan(state, shouldCommit) {
        if (!state || !state.active) return null;
        const target = shouldCommit ? (state.currentDropTarget || findTournamentManualDropTarget(state)) : null;

        if (!target) {
            restoreTournamentManualPlaceholderToOrigin(state);
            return {
                type: 'restore',
                rect: state.placeholder?.getBoundingClientRect() || state.originRect,
                commit: false,
                lists: []
            };
        }

        if (target.type === 'swap') {
            return {
                type: 'swap',
                rect: target.targetItem.getBoundingClientRect(),
                commit: true,
                lists: [state.originList, target.list],
                list: target.list,
                targetItem: target.targetItem
            };
        }

        moveTournamentManualPlaceholder(state, target.list, target.before);
        return {
            type: 'insert',
            rect: state.placeholder?.getBoundingClientRect() || state.originRect,
            commit: true,
            lists: [target.list]
        };
    }

    function placeTournamentManualItemAfterDrop(state, plan) {
        if (!state || !plan) return;
        if (plan.type === 'swap' && plan.targetItem && plan.targetItem.parentNode === plan.list) {
            plan.list.insertBefore(state.item, plan.targetItem);
            if (state.placeholder && state.placeholder.parentNode) {
                state.placeholder.parentNode.insertBefore(plan.targetItem, state.placeholder);
                state.placeholder.remove();
            } else {
                state.originList.appendChild(plan.targetItem);
            }
            return;
        }

        if (state.placeholder && state.placeholder.parentNode) {
            state.placeholder.parentNode.insertBefore(state.item, state.placeholder);
            state.placeholder.remove();
        } else {
            state.originList.appendChild(state.item);
        }
    }

    function finishTournamentManualDrag(shouldCommit) {
        const state = tournamentManualDragState;
        if (!state || state.finishing) return;
        state.finishing = true;
        stopTournamentAutoScroll();

        if (!state.active) {
            try { state.item.releasePointerCapture(state.pointerId); } catch (_) { /* ignore */ }
            tournamentManualDragState = null;
            return;
        }

        try { state.item.releasePointerCapture(state.pointerId); } catch (_) { /* ignore */ }
        const plan = buildTournamentManualDropPlan(state, shouldCommit);
        animateTournamentManualSnap(state.item, plan?.rect || state.originRect).then(() => {
            placeTournamentManualItemAfterDrop(state, plan);
            clearTournamentManualSnapTarget(state);
            resetTournamentManualDraggedItemStyles(state.item);
            document.body.classList.remove('is-tournament-dragging');
            const shouldPersist = !!(plan && plan.commit && (state.moved || plan.type === 'swap'));
            const lists = plan?.lists || [];
            tournamentManualDragState = null;
            if (shouldPersist) commitTournamentManualSortOrder(lists);
        });
    }

    function startTournamentManualDrag(state) {
        if (!state || state.active) return;
        // Re-measure the row right before we lift it out of the flow. This is
        // the row's current viewport position; combined with the click offset
        // we captured on pointerdown, the row stays exactly under the cursor.
        const rect = state.item.getBoundingClientRect();
        const placeholder = document.createElement('div');
        placeholder.className = 'tg-manual-placeholder';
        placeholder.style.height = `${rect.height}px`;
        state.placeholder = placeholder;
        state.originRect = rect;
        state.active = true;
        state.moved = false;

        state.item.parentNode.insertBefore(placeholder, state.item.nextSibling);
        // Keep the placeholder in the list, but render the floating row from
        // <body>. Some ancestor panels use transforms/filters, which make
        // position:fixed relative to that ancestor and caused the row to jump
        // far away from the cursor.
        document.body.appendChild(state.item);
        state.item.classList.add('is-dragging');
        // Set position, dimensions AND the initial location together so the
        // very first paint already shows the row under the cursor - no flash
        // at left:auto/top:auto, and no perceived "swap to nowhere" jump.
        const initialLeft = state.lastClientX - state.offsetX;
        const initialTop = state.lastClientY - state.offsetY;
        state.item.style.position = 'fixed';
        state.item.style.left = `${initialLeft}px`;
        state.item.style.top = `${initialTop}px`;
        state.item.style.width = `${rect.width}px`;
        state.item.style.height = `${rect.height}px`;
        state.item.style.margin = '0';
        state.item.style.touchAction = 'none';
        document.body.classList.add('is-tournament-dragging');
        try { state.item.setPointerCapture(state.pointerId); } catch (_) { /* ignore */ }
        if (state.pointerType !== 'mouse' && navigator.vibrate) {
            try { navigator.vibrate(14); } catch (_) { /* ignore */ }
        }
        // Snap the placeholder to the right slot on the first frame so the
        // user immediately sees where the row would land if released.
        updateTournamentDragPlaceholder();
        state.autoScrollRAF = requestAnimationFrame(tournamentAutoScrollTick);
    }

    function moveTournamentManualDrag(event) {
        const state = tournamentManualDragState;
        if (!state || state.finishing || event.pointerId !== state.pointerId) return;

        state.lastClientX = event.clientX;
        state.lastClientY = event.clientY;

        if (!state.active) {
            const dist = Math.hypot(event.clientX - state.startX, event.clientY - state.startY);
            if (dist > TOURNAMENT_DRAG_START_THRESHOLD) {
                startTournamentManualDrag(state);
            }
            if (!state.active) return;
        }

        event.preventDefault();
        updateTournamentDragVisual();
        updateTournamentDragPlaceholder();
    }

    function bindTournamentManualSortables() {
        if (!isTournamentManualMode()) return;
        document.querySelectorAll('[data-manual-sort-item]').forEach(item => {
            item.addEventListener('pointerdown', event => {
                if (event.pointerType === 'mouse' && event.button !== 0) return;
                if (tournamentManualDragState) finishTournamentManualDrag(false);
                const list = item.closest('[data-manual-sort-list]');
                if (!list) return;
                const pointerType = event.pointerType || 'mouse';
                const viaHandle = !!(event.target.closest && event.target.closest('.tg-manual-grip'));
                if (pointerType !== 'mouse' && !viaHandle) return;
                // Capture the offset of the click *inside the row*. This is
                // what keeps the dragged tile glued to the cursor at the
                // exact pixel the user grabbed - no matter how the row was
                // positioned on the page or how far the user drags.
                const rect = item.getBoundingClientRect();
                tournamentManualDragState = {
                    item,
                    list,
                    originList: list,
                    originIndex: getTournamentManualSortItems(list).indexOf(item),
                    sortKind: list.getAttribute('data-sort-kind'),
                    pointerId: event.pointerId,
                    pointerType,
                    startX: event.clientX,
                    startY: event.clientY,
                    lastClientX: event.clientX,
                    lastClientY: event.clientY,
                    offsetX: event.clientX - rect.left,
                    offsetY: event.clientY - rect.top,
                    active: false,
                    moved: false,
                    placeholder: null,
                    autoScrollRAF: null,
                    currentDropTarget: null,
                    snapTargetItem: null,
                    finishing: false,
                    originRect: rect
                };

                if (pointerType === 'mouse') {
                    // Mouse: remember the grab point now, but do not lift the
                    // row until the pointer actually moves. A click-and-release
                    // therefore has no visual side effects.
                    return;
                } else if (viaHandle) {
                    // Touch/pen on the dedicated handle: it can start as soon
                    // as the finger moves (touch-action:none prevents scroll).
                    event.preventDefault();
                }
            });
        });
    }

    function getTournamentAllBracketFixtures() {
        const bracket = APP && APP.knockoutBracket ? APP.knockoutBracket : {};
        return [
            ...(Array.isArray(bracket.roundOf32) ? bracket.roundOf32 : []),
            ...(Array.isArray(bracket.roundOf16) ? bracket.roundOf16 : []),
            ...(Array.isArray(bracket.quarterFinals) ? bracket.quarterFinals : []),
            ...(Array.isArray(bracket.semiFinals) ? bracket.semiFinals : []),
            bracket.final,
            bracket.thirdPlace
        ].filter(Boolean);
    }

    function getTournamentFixtureByMatchNumber(matchNumber) {
        const n = Number(matchNumber);
        if (!Number.isFinite(n)) return null;
        return getTournamentAllBracketFixtures().find(fixture => Number(fixture && fixture.match) === n) || null;
    }

    function getTournamentBestThirdGroupForFixture(slot, context, fixture) {
        if (!slot || slot.type !== 'bestThird') return '';
        const matchNumber = getTournamentFixtureMatchNumber(fixture);
        const assigned = matchNumber && context.bestThirdByMatch ? context.bestThirdByMatch.get(matchNumber) : '';
        if (assigned) return assigned;
        const groups = Array.isArray(slot.fromGroups) ? slot.fromGroups.map(value => String(value).toUpperCase()) : [];
        const possible = context.thirdRows.filter(row => row.qualifiesAsThird && groups.includes(row.group));
        return possible.length === 1 ? possible[0].group : '';
    }

    // Klassifiziert einen Runden-Text ('Round of 16', 'Group A', ...) als
    // K.-o.- (true) oder Gruppenspiel (false). Liefert null, wenn der Text
    // fehlt/nicht eindeutig ist – der Aufrufer soll dann auf die
    // Gruppenzugehoerigkeit der beiden Teams zurueckfallen.
    function isTournamentKnockoutRoundText(roundText) {
        const value = String(roundText || '').trim().toLowerCase();
        if (!value) return null;
        if (/group|matchday|spieltag|regular season/.test(value)) return false;
        return true;
    }

    // Baut einen Index aller bereits ausgetragenen K.-o.-Spiele, indiziert
    // nach dem (sortierten) Team-Paar. Wird verwendet, um im Auto-Modus
    // herauszufinden, wer ein bestimmtes K.-o.-Spiel (z. B. "Spiel 73")
    // tatsaechlich gewonnen hat, sobald es abgepfiffen ist.
    function buildTournamentKnockoutMatchIndex(context) {
        if (context.knockoutMatchIndex) return context.knockoutMatchIndex;

        const resolver = buildTournamentTeamResolver(getTournamentGroupsConfig());
        const index = new Map();

        const addMatch = (m, mc) => {
            const scheduledMatch = mc?.rawMatchId !== undefined && mc?.rawMatchId !== null
                ? findScheduleEntryForRawMatchId(mc.rawMatchId)
                : (scheduleCatalog.includes(m) ? m : null);
            const sourceMatch = scheduledMatch || m;

            if (scheduledMatch) {
                const statusInfo = getScheduleStatusInfo(scheduledMatch);
                if (!statusInfo.isFinished) return;
            }

            const homeName = sourceMatch?.teamA || sourceMatch?.home || sourceMatch?.homeTeam || '';
            const awayName = sourceMatch?.teamB || sourceMatch?.away || sourceMatch?.awayTeam || '';
            if (!homeName || !awayName) return;

            const roundText = sourceMatch?.round || (sourceMatch?.league && sourceMatch.league.round) || '';
            const knockoutByRound = isTournamentKnockoutRoundText(roundText);
            const groupMatch = APP && typeof APP.getGroupStageGroup === 'function'
                ? APP.getGroupStageGroup(homeName, awayName)
                : null;
            const isKnockout = knockoutByRound === null ? !groupMatch : knockoutByRound;
            if (!isKnockout) return;

            const homeTeam = findTournamentTeam(homeName, resolver);
            const awayTeam = findTournamentTeam(awayName, resolver);
            if (!homeTeam || !awayTeam || homeTeam.key === awayTeam.key) return;

            const winnerSide = getScheduleMatchWinnerSide(sourceMatch, mc);
            if (!winnerSide) return;

            const pairKey = [homeTeam.key, awayTeam.key].sort().join('__');
            index.set(pairKey, {
                homeKey: homeTeam.key,
                awayKey: awayTeam.key,
                winnerKey: winnerSide === 'home' ? homeTeam.key : awayTeam.key,
                scoreInfo: getScheduleFinalScoreInfo(sourceMatch, mc)
            });
        };

        scheduleCatalog.forEach(m => addMatch(m, findMatchCatalogForScheduleEntry(m)));
        matchCatalog.forEach(mc => addMatch({
            id: mc.rawMatchId,
            teamA: mc.teamA,
            teamB: mc.teamB,
            resultText: mc.resultText,
            date: mc.dateTime
        }, mc));

        context.knockoutMatchIndex = index;
        return index;
    }

    // Liefert Sieger-Seite + Endstand des tatsaechlich ausgetragenen Spiels
    // zwischen zwei (bereits aufgeloesten) Team-Zeilen, relativ zur
    // uebergebenen home/away-Reihenfolge des Bracket-Slots.
    function getTournamentKnockoutMatchForTeams(homeRow, awayRow, context) {
        if (!homeRow || !awayRow || homeRow.key === awayRow.key) return null;
        const index = buildTournamentKnockoutMatchIndex(context);
        const pairKey = [homeRow.key, awayRow.key].sort().join('__');
        const entry = index.get(pairKey);
        if (!entry) return null;

        const swapped = entry.homeKey !== homeRow.key;
        const winnerSide = entry.winnerKey === homeRow.key ? 'home' : (entry.winnerKey === awayRow.key ? 'away' : null);
        const scoreInfo = entry.scoreInfo
            ? (swapped ? { home: entry.scoreInfo.away, away: entry.scoreInfo.home, note: entry.scoreInfo.note } : entry.scoreInfo)
            : null;
        return { winnerSide, scoreInfo };
    }

    // Auto-Modus-Aequivalent zu getTournamentManualMatchResult: loest ein
    // K.-o.-Spiel anhand der TATSAECHLICHEN Ergebnisse auf (statt manueller
    // Tipps), damit Sieger im Turnierbaum automatisch weiterkommen, sobald
    // ihr Spiel abgepfiffen ist.
    function getTournamentAutoMatchResult(matchNumber, context, visiting = new Set()) {
        const n = Number(matchNumber);
        const empty = { home: null, away: null, winner: null, runnerUp: null, scoreInfo: null };
        if (!Number.isFinite(n) || visiting.has(n)) return empty;

        if (!context.autoMatchResultCache) context.autoMatchResultCache = new Map();
        if (context.autoMatchResultCache.has(n)) return context.autoMatchResultCache.get(n);

        const fixture = getTournamentFixtureByMatchNumber(n);
        if (!fixture) {
            context.autoMatchResultCache.set(n, empty);
            return empty;
        }

        const nextVisiting = new Set(visiting);
        nextVisiting.add(n);
        const home = resolveTournamentSlotRow(fixture.home, context, fixture, nextVisiting);
        const away = resolveTournamentSlotRow(fixture.away, context, fixture, nextVisiting);

        let winner = null;
        let runnerUp = null;
        let scoreInfo = null;
        if (home && away) {
            const played = getTournamentKnockoutMatchForTeams(home, away, context);
            if (played && played.winnerSide) {
                winner = played.winnerSide === 'home' ? home : away;
                runnerUp = played.winnerSide === 'home' ? away : home;
                scoreInfo = played.scoreInfo || null;
            }
        }

        const result = { home, away, winner, runnerUp, scoreInfo };
        context.autoMatchResultCache.set(n, result);
        return result;
    }

    function resolveTournamentSlotRow(slot, context, fixture = null, visiting = new Set()) {
        if (!slot || !context) return null;
        if (slot.type === 'groupRank') {
            return context.groupRankMap.get(`${slot.group}:${slot.rank}`) || null;
        }
        if (slot.type === 'bestThird') {
            const group = getTournamentBestThirdGroupForFixture(slot, context, fixture);
            const row = group && context.thirdByGroup ? context.thirdByGroup.get(group) : null;
            return row && row.qualifiesAsThird ? row : null;
        }
        if (slot.winnerOf || slot.runnerUpOf) {
            const sourceMatch = Number(slot.winnerOf || slot.runnerUpOf);
            if (!Number.isFinite(sourceMatch)) return null;
            const result = isTournamentManualMode()
                ? getTournamentManualMatchResult(sourceMatch, context, visiting)
                : getTournamentAutoMatchResult(sourceMatch, context, visiting);
            return slot.winnerOf ? result.winner : result.runnerUp;
        }
        return null;
    }

    function getTournamentManualMatchResult(matchNumber, context, visiting = new Set()) {
        const n = Number(matchNumber);
        if (!Number.isFinite(n) || visiting.has(n)) {
            return { home: null, away: null, winner: null, runnerUp: null };
        }
        const fixture = getTournamentFixtureByMatchNumber(n);
        if (!fixture) return { home: null, away: null, winner: null, runnerUp: null };

        const nextVisiting = new Set(visiting);
        nextVisiting.add(n);
        const home = resolveTournamentSlotRow(fixture.home, context, fixture, nextVisiting);
        const away = resolveTournamentSlotRow(fixture.away, context, fixture, nextVisiting);
        const winnerKey = String((tournamentManualState.winners || {})[String(n)] || '');
        const homeWins = !!(home && winnerKey && home.key === winnerKey);
        const awayWins = !!(away && winnerKey && away.key === winnerKey);
        const winner = homeWins ? home : (awayWins ? away : null);
        const runnerUp = winner ? (homeWins ? away : home) : null;
        return { home, away, winner, runnerUp };
    }

    function pruneTournamentManualWinners(context) {
        if (!tournamentManualState || !tournamentManualState.winners) return;
        let changed = false;
        let didPrune = true;
        while (didPrune) {
            didPrune = false;
            Object.entries({ ...tournamentManualState.winners }).forEach(([matchNumber, teamKey]) => {
                const result = getTournamentManualMatchResult(matchNumber, context);
                const validKeys = [result.home && result.home.key, result.away && result.away.key].filter(Boolean);
                if (!validKeys.includes(String(teamKey))) {
                    delete tournamentManualState.winners[matchNumber];
                    didPrune = true;
                    changed = true;
                }
            });
        }
        if (changed) saveTournamentManualState();
    }

    function setTournamentManualMatchWinner(matchNumber, teamKey) {
        if (!isTournamentManualMode()) return;
        const n = Number(matchNumber);
        const key = String(teamKey || '');
        if (!Number.isFinite(n) || !key) return;
        tournamentManualState.winners[String(n)] = key;
        saveTournamentManualState();
        renderTournamentView();
    }

    function bindTournamentKnockoutPicks() {
        document.querySelectorAll('[data-tournament-match-winner]').forEach(btn => {
            btn.addEventListener('click', () => {
                setTournamentManualMatchWinner(
                    btn.getAttribute('data-tournament-match-winner'),
                    btn.getAttribute('data-team-key')
                );
            });
        });
    }

    function formatTournamentSlotFallback(slot) {
        if (APP && typeof APP.formatKnockoutSlotLabel === 'function') {
            return APP.formatKnockoutSlotLabel(slot);
        }
        if (slot?.winnerOf) return `Sieger Spiel ${slot.winnerOf}`;
        if (slot?.runnerUpOf) return `Verlierer Spiel ${slot.runnerUpOf}`;
        return 'offen';
    }

    function resolveTournamentSlot(slot, context, fixture = null) {
        if (!slot) return { label: 'offen', placeholder: true, sub: '' };

        const row = resolveTournamentSlotRow(slot, context, fixture);
        if (row) {
            let sub = '';
            if (slot.type === 'groupRank') sub = `${slot.rank}. Gruppe ${slot.group}`;
            else if (slot.type === 'bestThird') sub = `Dritter Gruppe ${row.group}`;
            else if (slot.winnerOf) sub = `Sieger Spiel ${slot.winnerOf}`;
            else if (slot.runnerUpOf) sub = `Verlierer Spiel ${slot.runnerUpOf}`;
            return {
                label: row.displayName || row.name,
                flag: getTournamentFlag(row),
                sub,
                teamKey: row.key,
                row
            };
        }

        if (slot.type === 'bestThird') {
            const groups = Array.isArray(slot.fromGroups) ? slot.fromGroups.map(String) : [];
            const possible = context.thirdRows.filter(row => row.qualifiesAsThird && groups.includes(row.group));
            return {
                label: groups.length ? `Dritter ${groups.join('/')}` : 'Drittplatzierter',
                placeholder: true,
                sub: possible.length
                    ? `aktuell möglich: ${possible.map(row => row.displayName || row.name).join(', ')}`
                    : ''
            };
        }

        if (slot.winnerOf) return { label: `Sieger Spiel ${slot.winnerOf}`, placeholder: true, sub: '' };
        if (slot.runnerUpOf) return { label: `Verlierer Spiel ${slot.runnerUpOf}`, placeholder: true, sub: '' };

        return { label: formatTournamentSlotFallback(slot), placeholder: true, sub: '' };
    }

    // Liefert den Team-Key des Siegers des AKTUELLEN Fixtures (nicht der
    // Quellspiele) fuer die Sieger/Verlierer-Hervorhebung: im Manuellen
    // Modus der getippte Sieger, im Auto-Modus der tatsaechliche Sieger,
    // sobald das echte Spiel abgepfiffen ist.
    function getTournamentSlotWinnerKeyForFixture(matchNumber, context) {
        if (!matchNumber) return '';
        if (isTournamentManualMode()) {
            return String((tournamentManualState.winners || {})[String(matchNumber)] || '');
        }
        const auto = getTournamentAutoMatchResult(matchNumber, context);
        return auto && auto.winner ? auto.winner.key : '';
    }

    function renderTournamentSlot(slot, context, fixture, side, scoreInfo = null) {
        const resolved = resolveTournamentSlot(slot, context, fixture);
        const flagHtml = resolved.flag
            ? renderFlagImageHtml('tb-slot-flag', resolved.flag, '', resolved.label)
            : `<span class="tb-slot-flag" aria-hidden="true"></span>`;
        const matchNumber = getTournamentFixtureMatchNumber(fixture);
        const pickedWinner = matchNumber ? getTournamentSlotWinnerKeyForFixture(matchNumber, context) : '';
        const isWinner = !!(resolved.teamKey && pickedWinner && resolved.teamKey === pickedWinner);
        const isLoser = !!(resolved.teamKey && pickedWinner && resolved.teamKey !== pickedWinner);
        const isPickable = isTournamentManualMode() && !!matchNumber && !!resolved.teamKey && !resolved.placeholder;
        const tag = isPickable ? 'button' : 'div';
        const attrs = isPickable
            ? ` type="button" data-tournament-match-winner="${escapeHtml(matchNumber)}" data-team-key="${escapeHtml(resolved.teamKey)}" aria-label="${escapeHtml(resolved.label)} als Sieger von Spiel ${matchNumber} wählen"`
            : '';
        const goalValue = scoreInfo && Number.isFinite(scoreInfo[side]) ? scoreInfo[side] : null;
        const scoreHtml = goalValue !== null
            ? `<span class="tb-slot-score">${escapeHtml(goalValue)}</span>`
            : '';
        return `<${tag} class="tb-slot${isPickable ? ' tb-slot-btn' : ''}${resolved.placeholder ? ' tb-slot-placeholder' : ''}${isWinner ? ' tb-slot--winner' : ''}${isLoser ? ' tb-slot--loser' : ''}" data-side="${escapeHtml(side || '')}"${attrs}>
            ${flagHtml}
            <div class="tb-slot-main">
                <div class="tb-slot-label">${escapeHtml(resolved.label)}</div>
                ${resolved.sub ? `<div class="tb-slot-sub" title="${escapeHtml(resolved.sub)}">${escapeHtml(resolved.sub)}</div>` : ''}
            </div>
            ${scoreHtml}
        </${tag}>`;
    }

    function getTournamentRoundFixtures(roundKey) {
        const bracket = APP && APP.knockoutBracket ? APP.knockoutBracket : {};
        if (roundKey === 'finals') {
            return [bracket.final, bracket.thirdPlace].filter(Boolean);
        }
        if (APP && typeof APP.getKnockoutBracketRound === 'function') {
            return APP.getKnockoutBracketRound(roundKey);
        }
        return Array.isArray(bracket[roundKey]) ? bracket[roundKey] : [];
    }

    function getTournamentFixtureMatchNumber(fixture) {
        const n = Number(fixture?.match);
        return Number.isFinite(n) ? n : null;
    }

    function getTournamentSlotSourceMatch(slot) {
        if (!slot) return null;
        const raw = slot.winnerOf ?? slot.runnerUpOf;
        const n = Number(raw);
        return Number.isFinite(n) ? n : null;
    }

    function getTournamentFixtureSourceMatches(fixture) {
        return [getTournamentSlotSourceMatch(fixture?.home), getTournamentSlotSourceMatch(fixture?.away)]
            .filter(n => Number.isFinite(n));
    }

    function buildTournamentBracketNode(fixture, fixturesByMatch, matchRoundByNumber, visiting = new Set()) {
        const matchNumber = getTournamentFixtureMatchNumber(fixture);
        if (!matchNumber || visiting.has(matchNumber)) {
            return {
                fixture,
                matchNumber,
                roundKey: matchRoundByNumber.get(matchNumber) || '',
                children: [],
                leafMin: matchNumber || Infinity
            };
        }

        const nextVisiting = new Set(visiting);
        nextVisiting.add(matchNumber);

        const sourceMatches = getTournamentFixtureSourceMatches(fixture);
        const children = sourceMatches
            .map(source => fixturesByMatch.get(source))
            .filter(Boolean)
            .map(child => buildTournamentBracketNode(child, fixturesByMatch, matchRoundByNumber, nextVisiting))
            .sort((a, b) => {
                if (a.leafMin !== b.leafMin) return a.leafMin - b.leafMin;
                return (a.matchNumber || 9999) - (b.matchNumber || 9999);
            });

        const childMins = children.map(child => child.leafMin).filter(Number.isFinite);
        const fallbackMins = sourceMatches.filter(source => !fixturesByMatch.has(source));
        const allMins = [...childMins, ...fallbackMins, matchNumber].filter(Number.isFinite);

        return {
            fixture,
            matchNumber,
            roundKey: matchRoundByNumber.get(matchNumber) || '',
            children,
            leafMin: allMins.length ? Math.min(...allMins) : Infinity
        };
    }

    function buildTournamentBracketLayout(rounds) {
        const fixturesByMatch = new Map();
        const matchRoundByNumber = new Map();
        const roundIndexByKey = new Map(rounds.map((round, idx) => [round.key, idx]));

        rounds.forEach(round => {
            round.fixtures.forEach(fixture => {
                const matchNumber = getTournamentFixtureMatchNumber(fixture);
                if (!matchNumber) return;
                fixturesByMatch.set(matchNumber, fixture);
                matchRoundByNumber.set(matchNumber, round.key);
            });
        });

        const layout = new Map();
        let leafIndex = 0;

        const placeNode = (node) => {
            if (!node || !node.matchNumber) return null;
            if (layout.has(node.matchNumber)) return layout.get(node.matchNumber).rowStart;

            let rowStart = null;
            if (node.children.length) {
                const childRows = node.children.map(placeNode).filter(Number.isFinite);
                if (childRows.length) {
                    rowStart = (Math.min(...childRows) + Math.max(...childRows)) / 2;
                }
            }

            if (!Number.isFinite(rowStart)) {
                rowStart = 2 + (leafIndex * 2);
                leafIndex += 1;
            }
            rowStart = Math.round(rowStart);

            const col = (roundIndexByKey.get(node.roundKey) ?? 0) + 1;
            layout.set(node.matchNumber, { col, rowStart, roundKey: node.roundKey });
            return rowStart;
        };

        const bracket = APP && APP.knockoutBracket ? APP.knockoutBracket : {};
        const finalFixture = bracket.final || null;
        const root = finalFixture
            ? buildTournamentBracketNode(finalFixture, fixturesByMatch, matchRoundByNumber)
            : null;
        if (root) placeNode(root);

        const finalNumber = getTournamentFixtureMatchNumber(finalFixture);
        const finalLayout = finalNumber ? layout.get(finalNumber) : null;
        const thirdPlaceNumber = getTournamentFixtureMatchNumber(bracket.thirdPlace);
        if (thirdPlaceNumber && fixturesByMatch.has(thirdPlaceNumber)) {
            layout.set(thirdPlaceNumber, {
                col: (roundIndexByKey.get('finals') ?? rounds.length - 1) + 1,
                rowStart: finalLayout ? finalLayout.rowStart + 3 : 2 + (leafIndex * 2),
                roundKey: 'finals'
            });
            if (!finalLayout) leafIndex += 1;
        }

        rounds.forEach(round => {
            round.fixtures.forEach(fixture => {
                const matchNumber = getTournamentFixtureMatchNumber(fixture);
                if (!matchNumber || layout.has(matchNumber)) return;
                layout.set(matchNumber, {
                    col: (roundIndexByKey.get(round.key) ?? 0) + 1,
                    rowStart: 2 + (leafIndex * 2),
                    roundKey: round.key
                });
                leafIndex += 1;
            });
        });

        return layout;
    }

    function renderTournamentBracketMatch(fixture, round, context, layout) {
        const matchLabel = fixture.match ? `Spiel ${fixture.match}` : '';
        const meta = [formatTournamentDate(fixture.date), fixture.venue].filter(Boolean).join(' / ');
        const thirdPlaceMatch = getTournamentFixtureMatchNumber(APP.knockoutBracket?.thirdPlace);
        const isThirdPlace = thirdPlaceMatch && getTournamentFixtureMatchNumber(fixture) === thirdPlaceMatch;
        const gridStyle = layout
            ? ` style="grid-column: ${escapeHtml(layout.col)}; grid-row: ${escapeHtml(layout.rowStart)} / span 2;"`
            : '';
        const matchNumber = getTournamentFixtureMatchNumber(fixture);
        let scoreInfo = null;
        if (!isTournamentManualMode() && matchNumber) {
            const auto = getTournamentAutoMatchResult(matchNumber, context);
            scoreInfo = auto ? auto.scoreInfo : null;
        }
        const noteHtml = scoreInfo && scoreInfo.note
            ? `<div class="tb-match-note" title="${escapeHtml(scoreInfo.note === 'n.E.' ? 'Nach Elfmeterschiessen' : (scoreInfo.note === 'n.V.' ? 'Nach Verlaengerung' : scoreInfo.note))}">${escapeHtml(scoreInfo.note)}</div>`
            : '';
        return `<article class="tb-match" data-round="${escapeHtml(round.key)}"${gridStyle}>
            <div class="tb-match-head">
                <span>${escapeHtml(isThirdPlace ? 'Platz 3' : matchLabel)}</span>
                ${fixture.match ? `<span class="tb-match-number">#${escapeHtml(fixture.match)}</span>` : ''}
            </div>
            <div class="tb-match-teams">
                ${renderTournamentSlot(fixture.home, context, fixture, 'home', scoreInfo)}
                ${renderTournamentSlot(fixture.away, context, fixture, 'away', scoreInfo)}
                ${noteHtml}
            </div>
            ${meta ? `<div class="tb-match-meta">${escapeHtml(meta)}</div>` : ''}
        </article>`;
    }

    function renderTournamentBracket(context) {
        const rounds = [
            { key: 'roundOf32', label: 'Sechzehntelfinal' },
            { key: 'roundOf16', label: 'Achtelfinal' },
            { key: 'quarterFinals', label: 'Viertelfinal' },
            { key: 'semiFinals', label: 'Halbfinal' },
            { key: 'finals', label: 'Finale' }
        ];

        const layoutRounds = rounds.map(round => ({ ...round, fixtures: getTournamentRoundFixtures(round.key) }));
        const layout = buildTournamentBracketLayout(layoutRounds);
        const bracketHtml = layoutRounds.map((round, roundIdx) => {
            const matchesHtml = round.fixtures.map(fixture => {
                const matchNumber = getTournamentFixtureMatchNumber(fixture);
                return renderTournamentBracketMatch(fixture, round, context, layout.get(matchNumber));
            }).join('');
            return `<section class="tb-round">
                <div class="tb-round-title" style="grid-column: ${escapeHtml(roundIdx + 1)}; grid-row: 1;">${escapeHtml(round.label)}</div>
                ${matchesHtml || `<div class="tournament-empty" style="grid-column: ${escapeHtml(roundIdx + 1)}; grid-row: 2 / span 2;">Keine Paarungen konfiguriert.</div>`}
            </section>`;
        }).join('');

        return `<div class="tournament-bracket-zoom-stage"><div class="tournament-bracket">${bracketHtml}</div></div>`;

        /*
        const html = rounds.map(round => {
            const fixtures = getTournamentRoundFixtures(round.key);
            const matchesHtml = fixtures.map(fixture => {
                const matchLabel = fixture.match ? `Spiel ${fixture.match}` : '';
                const meta = [formatTournamentDate(fixture.date), fixture.venue].filter(Boolean).join(' · ');
                const isThirdPlace = round.key === 'finals' && fixture === APP.knockoutBracket?.thirdPlace;
                return `<article class="tb-match">
                    <div class="tb-match-head">
                        <span>${escapeHtml(isThirdPlace ? 'Platz 3' : matchLabel)}</span>
                        ${fixture.match ? `<span class="tb-match-number">#${escapeHtml(fixture.match)}</span>` : ''}
                    </div>
                    ${renderTournamentSlot(fixture.home, context)}
                    ${renderTournamentSlot(fixture.away, context)}
                    ${meta ? `<div class="tb-match-meta">${escapeHtml(meta)}</div>` : ''}
                </article>`;
            }).join('');
            return `<section class="tb-round">
                <div class="tb-round-title">${escapeHtml(round.label)}</div>
                ${matchesHtml || '<div class="tournament-empty">Keine Paarungen konfiguriert.</div>'}
            </section>`;
        }).join('');

        return `<div class="tournament-bracket">${html}</div>`;
        */
    }

    function clampTournamentBracketZoom(value) {
        return Math.min(TOURNAMENT_BRACKET_ZOOM_MAX, Math.max(TOURNAMENT_BRACKET_ZOOM_MIN, value || TOURNAMENT_BRACKET_ZOOM_RESET));
    }

    function getTournamentBracketWrap() {
        return document.getElementById('tournament-bracket');
    }

    function getTournamentBracketContent(wrap = getTournamentBracketWrap()) {
        return wrap ? wrap.querySelector('.tournament-bracket') : null;
    }

    function applyTournamentBracketZoom(value) {
        tournamentBracketZoom = clampTournamentBracketZoom(value);
        const wrap = getTournamentBracketWrap();
        if (!wrap) return;
        wrap.style.setProperty('--tournament-bracket-zoom', tournamentBracketZoom.toFixed(3));
        wrap.classList.toggle('is-bracket-zoomed', Math.abs(tournamentBracketZoom - TOURNAMENT_BRACKET_ZOOM_RESET) > 0.01);
    }

    function syncTournamentBracketZoomMetrics() {
        if (currentTournamentTab !== 'knockout') return;
        const wrap = getTournamentBracketWrap();
        const bracket = getTournamentBracketContent(wrap);
        if (!wrap || !bracket) return;

        const width = Math.ceil(Math.max(bracket.scrollWidth, bracket.offsetWidth));
        const height = Math.ceil(Math.max(bracket.scrollHeight, bracket.offsetHeight));
        if (!width || !height) return;

        wrap.style.setProperty('--tournament-bracket-width', `${width}px`);
        wrap.style.setProperty('--tournament-bracket-height', `${height}px`);
        wrap.classList.add('has-bracket-zoom-metrics');
        applyTournamentBracketZoom(tournamentBracketZoom);
    }

    function resetTournamentBracketZoom(options = {}) {
        tournamentBracketPinch = null;
        applyTournamentBracketZoom(TOURNAMENT_BRACKET_ZOOM_RESET);
        const wrap = getTournamentBracketWrap();
        if (wrap) {
            wrap.classList.remove('is-pinch-zooming');
            if (options.resetScroll !== false) {
                wrap.scrollLeft = 0;
                wrap.scrollTop = 0;
            }
        }
        if (!options.skipSidebarSync) syncSidebarHeight();
    }

    function getTournamentTouchDistance(touches) {
        const dx = touches[0].clientX - touches[1].clientX;
        const dy = touches[0].clientY - touches[1].clientY;
        return Math.hypot(dx, dy);
    }

    function getTournamentTouchCenter(touches) {
        return {
            x: (touches[0].clientX + touches[1].clientX) / 2,
            y: (touches[0].clientY + touches[1].clientY) / 2
        };
    }

    function isTournamentBracketZoomActiveTarget(event) {
        const wrap = getTournamentBracketWrap();
        return !!wrap && event.currentTarget === wrap && currentView === 'tournament' && currentTournamentTab === 'knockout';
    }

    function startTournamentBracketPinch(event) {
        if (!isTournamentBracketZoomActiveTarget(event) || !event.touches || event.touches.length < 2) return;

        syncTournamentBracketZoomMetrics();
        const wrap = getTournamentBracketWrap();
        const distance = getTournamentTouchDistance(event.touches);
        if (!wrap || !distance) return;

        const center = getTournamentTouchCenter(event.touches);
        const rect = wrap.getBoundingClientRect();
        tournamentBracketPinch = {
            startDistance: distance,
            startScale: tournamentBracketZoom,
            focusX: (wrap.scrollLeft + center.x - rect.left) / tournamentBracketZoom,
            focusY: (wrap.scrollTop + center.y - rect.top) / tournamentBracketZoom
        };
        wrap.classList.add('is-pinch-zooming');
        event.preventDefault();
    }

    function moveTournamentBracketPinch(event) {
        if (!tournamentBracketPinch || !isTournamentBracketZoomActiveTarget(event) || !event.touches || event.touches.length < 2) return;

        event.preventDefault();
        const wrap = getTournamentBracketWrap();
        const distance = getTournamentTouchDistance(event.touches);
        if (!wrap || !distance) return;

        const center = getTournamentTouchCenter(event.touches);
        const rect = wrap.getBoundingClientRect();
        const nextScale = clampTournamentBracketZoom(tournamentBracketPinch.startScale * (distance / tournamentBracketPinch.startDistance));
        applyTournamentBracketZoom(nextScale);

        wrap.scrollLeft = (tournamentBracketPinch.focusX * tournamentBracketZoom) - (center.x - rect.left);
        wrap.scrollTop = (tournamentBracketPinch.focusY * tournamentBracketZoom) - (center.y - rect.top);
    }

    function finishTournamentBracketPinch(event) {
        if (event && event.touches && event.touches.length >= 2) {
            startTournamentBracketPinch(event);
            return;
        }
        if (!tournamentBracketPinch) return;
        tournamentBracketPinch = null;
        const wrap = getTournamentBracketWrap();
        if (wrap) wrap.classList.remove('is-pinch-zooming');
        syncSidebarHeight();
    }

    function preventTournamentBracketNativeGesture(event) {
        if (isTournamentBracketZoomActiveTarget(event)) event.preventDefault();
    }

    function syncTournamentTabUi() {
        document.querySelectorAll('.tour-pill').forEach(btn => {
            const isActive = btn.dataset.tournamentTab === currentTournamentTab;
            btn.classList.toggle('active', isActive);
            btn.setAttribute('aria-selected', String(isActive));
        });
        ['groups', 'knockout'].forEach(t => {
            const panel = document.getElementById('tournament-tab-' + t);
            if (!panel) return;
            const isActive = t === currentTournamentTab;
            panel.hidden = !isActive;
            panel.classList.toggle('active', isActive);
        });
    }

    function setTournamentTab(tab, push = false) {
        const nextTab = ['groups','knockout'].includes(tab) ? tab : 'groups';
        currentTournamentTab = nextTab;
        if (nextTab !== 'knockout') resetTournamentBracketZoom({ skipSidebarSync: true });
        syncTournamentTabUi();
        renderTournamentView();
        updateUrl(push);
        syncSidebarHeight();
    }

    function renderTournamentView() {
        const groupsEl = document.getElementById('tournament-groups-list');
        const thirdEl = document.getElementById('tournament-third-places');
        const bracketEl = document.getElementById('tournament-bracket');
        if (!groupsEl || !thirdEl || !bracketEl) return;

        syncTournamentModeUi();
        const context = buildTournamentContext();
        if (!context.groups.length) {
            const empty = '<div class="tournament-empty">Keine Turniergruppen konfiguriert.</div>';
            groupsEl.innerHTML = empty;
            thirdEl.innerHTML = '';
            bracketEl.innerHTML = empty;
            return;
        }

        groupsEl.innerHTML = context.groups.map(renderTournamentGroupTable).join('');
        bindTournamentGroupToggles();
        thirdEl.innerHTML = renderTournamentThirdPlacesTable(context);
        bracketEl.innerHTML = renderTournamentBracket(context);
        if (currentTournamentTab === 'knockout') {
            syncTournamentBracketZoomMetrics();
            requestAnimationFrame(syncTournamentBracketZoomMetrics);
        }
        bindTournamentManualSortables();
        bindTournamentKnockoutPicks();
        syncSidebarHeight();
    }

    // Track an active "auto-scroll to a focused match" so deferred attempts
    // can be cancelled if the user starts scrolling manually or navigates
    // away to another card.
    let scheduleFocusKey = null;
    let scheduleFocusCancelled = false;
    function cancelScheduleFocusFollowUps() {
        scheduleFocusCancelled = true;
        scheduleFocusKey = null;
    }

    function applyPendingScheduleFocus() {
        if (!pendingScheduleFocus) return;
        const el = document.getElementById('schedule-list');
        if (!el) return;

        const { matchId, matchNr } = pendingScheduleFocus;

        let target = null;
        if (Number.isFinite(matchId)) {
            target = el.querySelector(`.sc-card[data-raw-match-id="${matchId}"]`)
                  || el.querySelector(`.sc-card[data-fixture-id="${matchId}"]`);
        }
        if (!target && Number.isFinite(matchNr)) {
            target = el.querySelector(`.sc-card[data-spiel-nr="${matchNr}"]`);
        }
        if (!target) return;

        const key = target.getAttribute('data-match-key');
        if (key) {
            collapseAllScheduleCardsExcept(key);
            expandedScheduleMatchKeys.add(key);
        }
        target.classList.add('is-expanded');
        target.setAttribute('aria-expanded', 'true');
        target.classList.remove('is-focus-flash');
        // Force reflow so the animation restarts when navigated to again.
        void target.offsetWidth;
        target.classList.add('is-focus-flash');

        // The target may be at the very bottom of a long list (e.g. a
        // Finalspiel) and lazy-loaded flag/photo images can shift
        // the layout after our first scroll attempt. We therefore use an
        // INSTANT scroll (smooth scrolling can also be cancelled by
        // browser scroll-restoration on first paint) and re-apply it
        // after a short delay so we still land on the card after images
        // have settled. A user-initiated scroll cancels the follow-up
        // attempts so we don't fight the user.
        pendingScheduleFocus = null;
        scheduleFocusKey = key || null;
        scheduleFocusCancelled = false;

        const performScroll = () => {
            if (scheduleFocusCancelled) return;
            if (scheduleFocusKey !== key) return;
            const list = document.getElementById('schedule-list');
            if (!list) return;
            const node = key
                ? (list.querySelector(`.sc-card[data-match-key="${(window.CSS && CSS.escape) ? CSS.escape(key) : key}"]`) || target)
                : target;
            if (node) scrollElementToTop(node, { smooth: false });
        };

        requestAnimationFrame(() => {
            performScroll();
            setTimeout(performScroll, 60);
            setTimeout(performScroll, 250);
            setTimeout(performScroll, 700);
        });
    }

    if (typeof window !== 'undefined') {
        window.addEventListener('wheel', cancelScheduleFocusFollowUps, { passive: true });
        window.addEventListener('touchmove', cancelScheduleFocusFollowUps, { passive: true });
        window.addEventListener('keydown', (e) => {
            if (['PageDown', 'PageUp', 'Home', 'End', 'ArrowDown', 'ArrowUp', ' '].includes(e.key)) {
                cancelScheduleFocusFollowUps();
            }
        });
    }

    function collapseAllScheduleCardsExcept(keepKey) {
        // Enforce the "only one expanded card at a time" rule by
        // collapsing every other schedule card – both in the DOM and in
        // the persisted set used to restore expansion across re-renders.
        expandedScheduleMatchKeys.forEach(k => {
            if (k !== keepKey) expandedScheduleMatchKeys.delete(k);
        });
        const list = document.getElementById('schedule-list');
        if (!list) return;
        list.querySelectorAll('.sc-card.is-expanded').forEach(other => {
            if (other.getAttribute('data-match-key') === keepKey) return;
            other.classList.remove('is-expanded', 'is-focus-flash');
            other.setAttribute('aria-expanded', 'false');
        });
    }

    window.toggleScheduleCard = function(cardEl) {
        if (!cardEl) return;
        const key = cardEl.getAttribute('data-match-key');
        if (!key) return;
        const willExpand = !cardEl.classList.contains('is-expanded');
        if (willExpand) {
            collapseAllScheduleCardsExcept(key);
            expandedScheduleMatchKeys.add(key);
            cardEl.classList.add('is-expanded');
        } else {
            expandedScheduleMatchKeys.delete(key);
            cardEl.classList.remove('is-expanded', 'is-focus-flash');
        }
        cardEl.setAttribute('aria-expanded', String(willExpand));
        if (willExpand) refreshScheduleGoalLineOverflow(cardEl);
        syncSidebarHeight();
    };

    window.handleScheduleCardKey = function(event, cardEl) {
        if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault();
            window.toggleScheduleCard(cardEl);
        }
    };

    /* =========================================================
       COMPARISONS VIEW (Manager-Duell, Spieler-Duell, What-If)
       ========================================================= */
    const POSITION_KEYS = ['GOALKEEPER', 'DEFENDER', 'MIDFIELDER', 'ATTACKER'];
    const POSITION_LABELS = {
        GOALKEEPER: 'Torhüter',
        DEFENDER: 'Verteidiger',
        MIDFIELDER: 'Mittelfeld',
        ATTACKER: 'Sturm'
    };
    const POSITION_ICONS = {
        GOALKEEPER: '🧤',
        DEFENDER: '🛡️',
        MIDFIELDER: '🎯',
        ATTACKER: '⚽',
        BENCH: '🪑'
    };

    function cmpNormalizePosition(pos) {
        const upper = String(pos || '').toUpperCase();
        if (upper === 'FORWARD') return 'ATTACKER';
        if (POSITION_KEYS.includes(upper)) return upper;
        return 'UNKNOWN';
    }

    function getPlayerBasePoints(playerId) {
        return getPlayerTotalPoints(playerId);
    }

    // An "Einsatz" is counted as either being in the starting line-up
    // (START) or coming on from the bench (SUBBED_IN) in any tournament match.
    function getPlayerAppearances(playerId) {
        const doc = pointsData[String(playerId)];
        if (!doc) return 0;
        const startPts = RULES.START || 1;
        const subInPts = RULES.SUBBED_IN || 1;
        const startVal = typeof doc.START === 'number' ? doc.START : 0;
        const subVal = typeof doc.SUBBED_IN === 'number' ? doc.SUBBED_IN : 0;
        const starts = startPts ? Math.round(startVal / startPts) : 0;
        const subs = subInPts ? Math.round(subVal / subInPts) : 0;
        return starts + subs;
    }

    function invalidateComparisonCaches() {
        enrichedTeamsCache = [];
        positionAggregatesCache = null;
    }

    // Build enriched team data (similar to teams.html / rangliste.html)
    function getEnrichedTeams() {
        if (enrichedTeamsCache && enrichedTeamsCache.length) return enrichedTeamsCache;
        const teams = (allTeams || []).map(team => {
            const merged = (team.players || []).map((p, idx) => {
                const fullP = resolveStoredPlayer(p);
                const pos = cmpNormalizePosition((fullP && fullP.Position) || p.pos || 'UNKNOWN');
                const slotNum = p.slot ? parseInt(String(p.slot).replace('slot-', ''), 10) : -1;
                const basePts = fullP ? getPlayerBasePoints(fullP['player.id']) : 0;
                const finalPts = p.isCaptain ? basePts * 2 : basePts;
                return {
                    name: p.name,
                    playerId: fullP ? String(fullP['player.id']) : null,
                    pos,
                    slotNum,
                    isCaptain: !!p.isCaptain,
                    basePts,
                    pts: finalPts,
                    photo: fullP ? fullP.Spielerfoto : '',
                    nation: fullP ? fullP['Nationalteam.name'] : '?',
                    flag: fullP ? fullP['Nationalteam.logo'] : '',
                    club: fullP ? (fullP['Club.name'] || '') : '',
                    clubLogo: fullP ? (fullP['Club.logo'] || '') : ''
                };
            }).sort((a, b) => a.slotNum - b.slotNum);

            const totalScore = merged.reduce((s, p) => s + p.pts, 0);
            const positionTotals = { GOALKEEPER: 0, DEFENDER: 0, MIDFIELDER: 0, ATTACKER: 0, BENCH: 0 };
            merged.forEach(player => {
                if (positionTotals[player.pos] !== undefined) positionTotals[player.pos] += player.pts;
                if (player.slotNum >= 11) positionTotals.BENCH += player.pts;
            });
            const captain = merged.find(p => p.isCaptain) || null;
            return {
                manager: team.manager || 'Unbekannt',
                players: merged,
                totalScore,
                positionTotals,
                captain
            };
        });

        // Compute ranks by total score (1 = highest)
        const ranking = [...teams].sort((a, b) => {
            if (b.totalScore !== a.totalScore) return b.totalScore - a.totalScore;
            return a.manager.localeCompare(b.manager, 'de');
        });
        ranking.forEach((t, i) => { t.rank = i + 1; });

        teams.sort((a, b) => a.manager.localeCompare(b.manager, 'de'));
        enrichedTeamsCache = teams;
        return enrichedTeamsCache;
    }

    function getEnrichedTeamByManager(name) {
        if (!name) return null;
        return getEnrichedTeams().find(t => t.manager === name) || null;
    }

    // Build aggregates over all players for spieler-duell comparisons.
    // Only players with at least one tournament appearance (Einsatz) are
    // included so position averages, top-N and "best" calculations are not
    // diluted by squad members that never played.
    function getPositionAggregates() {
        if (positionAggregatesCache) return positionAggregatesCache;
        const buckets = { GOALKEEPER: [], DEFENDER: [], MIDFIELDER: [], ATTACKER: [] };
        playersData.forEach(p => {
            const pos = cmpNormalizePosition(p.Position);
            if (!buckets[pos]) return;
            const id = String(p['player.id']);
            if (getPlayerAppearances(id) <= 0) return;
            const pts = getPlayerBasePoints(id);
            buckets[pos].push({ id, name: p.Spielername, pts, raw: p });
        });
        Object.keys(buckets).forEach(pos => {
            buckets[pos].sort((a, b) => b.pts - a.pts);
        });
        positionAggregatesCache = buckets;
        return buckets;
    }

    function getPositionRank(playerId) {
        const player = getPlayerById(playerId);
        if (!player) return null;
        const pos = cmpNormalizePosition(player.Position);
        const bucket = getPositionAggregates()[pos];
        if (!bucket) return null;
        const idx = bucket.findIndex(p => p.id === String(playerId));
        if (idx < 0) return null;
        return { rank: idx + 1, total: bucket.length, position: pos };
    }

    function getAverageByPosition(pos) {
        const bucket = getPositionAggregates()[pos];
        if (!bucket || !bucket.length) return 0;
        const sum = bucket.reduce((s, p) => s + p.pts, 0);
        return sum / bucket.length;
    }

    function getBestByPosition(pos) {
        const bucket = getPositionAggregates()[pos];
        if (!bucket || !bucket.length) return null;
        return bucket[0];
    }

    function getTopNAverageByPosition(pos, n = 10) {
        const bucket = getPositionAggregates()[pos];
        if (!bucket || !bucket.length) return 0;
        const slice = bucket.slice(0, Math.min(n, bucket.length));
        const sum = slice.reduce((s, p) => s + p.pts, 0);
        return sum / slice.length;
    }

    function buildPlayerStats(playerId) {
        const player = getPlayerById(playerId);
        if (!player) return null;
        const doc = pointsData[String(playerId)] || {};

        const pos = cmpNormalizePosition(player.Position);
        const stats = {
            player,
            id: String(playerId),
            position: pos,
            positionLabel: translatePosition(player.Position),
            nation: player['Nationalteam.name'] || '–',
            nationFlag: player['Nationalteam.logo'] || '',
            club: player['Club.name'] || '–',
            clubLogo: player['Club.logo'] || '',
            photo: player.Spielerfoto || '',
            totalPoints: getPointDocTotal(doc),
            goals: 0, assists: 0, starts: 0, subbedIn: 0, subbedOut: 0,
            yellow: 0, red: 0,
            penGoals: 0, penMissed: 0, penSaved: 0, penCommitted: 0, penWon: 0,
            wins: 0, draws: 0, losses: 0,
            ownGoals: 0,
            games: 0
        };

        // Count drafted by managers (popularity) — pre-start sind die
        // Draft-Entscheidungen geheim, also stets 0.
        const teamsLockedForStats = isTeamsLocked();
        stats.draftCount = teamsLockedForStats
            ? 0
            : (playerSelectedMap.get(String(playerId)) || 0);
        let captainCount = 0;
        if (!teamsLockedForStats) {
            (allTeams || []).forEach(team => {
                (team.players || []).forEach(tp => {
                    const fullP = resolveStoredPlayer(tp);
                    const id = fullP ? String(fullP['player.id']) : String(tp.playerId || '');
                    if (id === String(playerId) && tp.isCaptain) captainCount++;
                });
            });
        }
        stats.captainCount = captainCount;

        Object.entries(doc).forEach(([key, val]) => {
            if (key.startsWith('Spiel_') && typeof val === 'object' && val) {
                stats.games += 1;
                return;
            }
            if (typeof val !== 'number' || !RULES[key]) return;
            const count = Math.round(val / RULES[key]);
            if (['GOAL_GK', 'GOAL_DEF', 'GOAL_MID', 'GOAL_ATT'].includes(key)) stats.goals += count;
            if (['ASSIST_GK_DEF', 'ASSIST_MID', 'ASSIST_ATT'].includes(key)) stats.assists += count;
            if (key === 'START') stats.starts += count;
            if (key === 'SUBBED_IN') stats.subbedIn += count;
            if (key === 'SUBBED_OUT') stats.subbedOut += count;
            if (key === 'YELLOW_CARD') stats.yellow += count;
            if (key === 'RED_CARD') stats.red += count;
            if (key === 'PEN_SAVED') stats.penSaved += count;
            if (key === 'PEN_MISSED') stats.penMissed += count;
            if (key === 'PEN_COMMITED') stats.penCommitted += count;
            if (key === 'PEN_WON') stats.penWon += count;
            if (key === 'WIN') stats.wins += count;
            if (key === 'DRAW') stats.draws += count;
            if (key === 'LOSS') stats.losses += count;
            if (key === 'OWN_GOAL') stats.ownGoals += count;
        });

        stats.appearances = stats.starts + stats.subbedIn;
        stats.pointsPerGame = stats.appearances > 0
            ? Math.round((stats.totalPoints / stats.appearances) * 10) / 10
            : null;

        return stats;
    }

    function classifyPlayerBadge(stats) {
        const badges = [];
        const rankInfo = getPositionRank(stats.id);
        if (rankInfo) {
            const avg = getAverageByPosition(rankInfo.position);
            if (rankInfo.rank === 1) badges.push({ cls: 'elite', text: '👑 Bester ' + POSITION_LABELS[rankInfo.position] });
            else if (rankInfo.rank <= 10) badges.push({ cls: 'elite', text: 'Top 10 ' + POSITION_LABELS[rankInfo.position] });
            else if (stats.totalPoints > avg * 1.25) badges.push({ cls: 'over', text: 'Über Durchschnitt' });
            else if (stats.totalPoints >= avg * 0.9) badges.push({ cls: 'solid', text: 'Solide' });
            else if (stats.totalPoints < avg * 0.5 && avg > 0) badges.push({ cls: 'weak', text: 'Enttäuschung' });
        }
        if (stats.draftCount >= 3 && stats.totalPoints > 0 && rankInfo && rankInfo.rank > 30) {
            badges.push({ cls: 'over-hyped', text: 'Overhyped' });
        }
        if (stats.draftCount === 0 && stats.totalPoints > 30) {
            badges.push({ cls: 'gem', text: 'Hidden Gem' });
        }
        return badges;
    }

    function populateComparisonPickers() {
        const teams = getEnrichedTeams();
        const managerOptions = teams.map(t => `<option value="${escapeHtml(t.manager)}">${escapeHtml(t.manager)}</option>`).join('');

        const ensureOptions = (sel, includeBlank = true) => {
            if (!sel) return;
            sel.innerHTML = (includeBlank ? '<option value="">— wählen —</option>' : '') + managerOptions;
        };

        ensureOptions(document.getElementById('cmp-mgr-a'));
        ensureOptions(document.getElementById('cmp-mgr-b'));
        ensureOptions(document.getElementById('cmp-whatif-mgr'));

        // Restore existing selections
        const restoreSelect = (id, val) => {
            const el = document.getElementById(id);
            if (!el) return;
            if (val && Array.from(el.options).some(o => o.value === val)) el.value = val;
        };
        restoreSelect('cmp-mgr-a', cmpMgrA);
        restoreSelect('cmp-mgr-b', cmpMgrB);
        restoreSelect('cmp-whatif-mgr', cmpWhatIfMgr);

        // Player comboboxes: reflect current selection
        syncPlayerCombo('a', cmpPlayerA);
        syncPlayerCombo('b', cmpPlayerB);
    }

    function syncPlayerCombo(sideKey, value) {
        const wrap = document.querySelector(`.cmp-combo[data-cmp-side="${sideKey}"]`);
        if (!wrap || typeof wrap._setSelectedById !== 'function') return;
        // Virtual tokens (e.g. "virtual:avg:DEFENDER") aren't real player IDs, so the
        // input stays empty; the virtual opponent is still rendered in the result panel.
        const realId = value && !String(value).startsWith('virtual:') ? value : '';
        wrap._setSelectedById(realId);
    }

    function setComparisonTab(tab, push = false) {
        if (!['manager', 'player', 'whatif'].includes(tab)) tab = 'manager';
        currentCmpTab = tab;
        document.querySelectorAll('.cmp-pill').forEach(btn => {
            const isActive = btn.dataset.cmpTab === tab;
            btn.classList.toggle('active', isActive);
            btn.setAttribute('aria-selected', String(isActive));
        });
        ['manager', 'player', 'whatif'].forEach(t => {
            const panel = document.getElementById('cmp-tab-' + t);
            if (!panel) return;
            const isActive = t === tab;
            panel.hidden = !isActive;
            panel.classList.toggle('active', isActive);
        });
        renderComparisonsView();
        updateUrl(push);
    }

    function renderComparisonsView() {
        if (!document.getElementById('view-comparisons')) return;
        if (currentCmpTab === 'manager') renderManagerDuell();
        else if (currentCmpTab === 'player') renderPlayerDuell();
        else if (currentCmpTab === 'whatif') renderWhatIfAnalysis();
    }

    /* ---------- Manager-Duell ---------- */
    function renderManagerDuell() {
        const out = document.getElementById('cmp-mgr-result');
        if (!out) return;

        if (isTeamsLocked()) {
            out.innerHTML = `
                <div class="cmp-empty">
                    <span class="cmp-empty-icon">🔒</span>
                    Wird mit Turnierstart enthüllt.
                </div>`;
            return;
        }

        const a = getEnrichedTeamByManager(cmpMgrA);
        const b = getEnrichedTeamByManager(cmpMgrB);

        if (!a && !b) {
            out.innerHTML = `
                <div class="cmp-empty">
                    <span class="cmp-empty-icon">⚔️</span>
                    Wähle zwei Manager für dein erstes Duell.
                </div>`;
            return;
        }
        if (!a || !b) {
            out.innerHTML = `
                <div class="cmp-empty">
                    <span class="cmp-empty-icon">👥</span>
                    Wähle einen zweiten Manager für das Duell.
                </div>`;
            return;
        }
        if (a.manager === b.manager) {
            out.innerHTML = `
                <div class="cmp-empty">
                    <span class="cmp-empty-icon">🤝</span>
                    Bitte zwei unterschiedliche Manager wählen.
                </div>`;
            return;
        }

        const initialA = (a.manager.charAt(0) || '?').toUpperCase();
        const initialB = (b.manager.charAt(0) || '?').toUpperCase();
        const diff = a.totalScore - b.totalScore;
        const winner = diff > 0 ? 'a' : (diff < 0 ? 'b' : 'draw');
        const diffAbs = Math.abs(diff);
        const diffBadgeClass = winner === 'draw' ? 'draw' : '';
        const winnerManagerName = winner === 'a' ? a.manager : (winner === 'b' ? b.manager : '');
        const winnerFirstName = (winnerManagerName || '').trim().split(/\s+/)[0] || '';
        const diffText = winner === 'draw' ? 'Unentschieden' : `${winnerFirstName} +${diffAbs} Pkt.`;

        const heroHtml = `
            <div class="cmp-h2h-hero">
                <div class="cmp-h2h-grid">
                    <div class="cmp-h2h-side ${winner === 'a' ? 'is-winner' : ''}">
                        ${cmpManagerImgLink(a.manager, `<div class="cmp-h2h-avatar">${escapeHtml(initialA)}</div>`)}
                        <div class="cmp-h2h-name">${cmpManagerLink(a.manager, escapeHtml(a.manager))}</div>
                        <div class="cmp-h2h-pts">${cmpRankingLink(String(a.totalScore), 'is-points', a.manager)}</div>
                        <div class="cmp-h2h-rank">${cmpRankingLink('Rang #' + (a.rank ?? '–'), '', a.manager)}</div>
                        ${winner === 'a' ? '<span class="cmp-winner-badge">🏆 Sieger</span>' : ''}
                    </div>
                    <div class="cmp-h2h-center">
                        <span class="cmp-vs-bubble">VS</span>
                        <span class="cmp-diff-badge ${diffBadgeClass}">${escapeHtml(diffText)}</span>
                    </div>
                    <div class="cmp-h2h-side ${winner === 'b' ? 'is-winner' : ''}">
                        ${cmpManagerImgLink(b.manager, `<div class="cmp-h2h-avatar">${escapeHtml(initialB)}</div>`)}
                        <div class="cmp-h2h-name">${cmpManagerLink(b.manager, escapeHtml(b.manager))}</div>
                        <div class="cmp-h2h-pts">${cmpRankingLink(String(b.totalScore), 'is-points', b.manager)}</div>
                        <div class="cmp-h2h-rank">${cmpRankingLink('Rang #' + (b.rank ?? '–'), '', b.manager)}</div>
                        ${winner === 'b' ? '<span class="cmp-winner-badge">🏆 Sieger</span>' : ''}
                    </div>
                </div>
            </div>`;

        // Captain comparison
        const capA = a.captain;
        const capB = b.captain;
        const capPtsA = capA ? capA.pts : 0;
        const capPtsB = capB ? capB.pts : 0;
        const capDiff = capPtsA - capPtsB;
        const capWinner = capDiff > 0 ? 'a' : (capDiff < 0 ? 'b' : 'draw');
        const capDiffAbs = Math.abs(capDiff);
        const capDiffText = capDiff === 0 ? '±0' : (capDiff > 0 ? `+${capDiffAbs}` : `-${capDiffAbs}`);
        const capArrowSym = capWinner === 'draw' ? '=' : (capWinner === 'a' ? '◀' : '▶');
        const capArrowCls = capWinner === 'draw' ? '' : (capWinner === 'a' ? 'win' : 'loss');
        const capDiffCls = capWinner === 'a' ? 'win' : (capWinner === 'b' ? 'loss' : 'draw');

        const renderCapAvatar = (cap) => {
            const photo = renderPlayerPhotoShell(cap && cap.photo, cap && cap.name, 'cmp-cap-photo', { width: 52, height: 52 });
            const inner = `<div class="cmp-cap-avatar">${photo}<div class="cmp-cap-c-badge" aria-label="Captain">C</div></div>`;
            return cap && (cap.name || cap.playerId) ? cmpPlayerImgLink(cap.name, inner, cap.playerId) : inner;
        };

        const captainCard = `
            <div class="analysis-card">
                <div class="analysis-card-header">
                    <div class="analysis-card-title"><span class="act-accent" aria-hidden="true"></span>👑 Captain-Duell</div>
                </div>
                <div class="analysis-card-body">
                    <div class="cmp-cap-row">
                        ${renderCapAvatar(capA)}
                        <div class="cmp-cap-side">
                            <span class="cmp-row-name">${capA ? cmpPlayerLink(capA.name, escapeHtml(capA.name), '', capA.playerId) : '— kein Captain —'}</span>
                            <span class="cmp-row-pts ${capWinner === 'a' ? 'win' : (capWinner === 'b' ? 'loss' : 'draw')}">${capPtsA} Pkt.</span>
                        </div>
                        <div class="cmp-cap-center">
                            <span class="cmp-cap-arrow ${capArrowCls}" aria-hidden="true">${capArrowSym}</span>
                            <span class="cmp-cap-diff ${capDiffCls}" aria-label="Differenz ${capDiffText} Punkte">${capDiffText}</span>
                        </div>
                        <div class="cmp-cap-side right">
                            <span class="cmp-row-name">${capB ? cmpPlayerLink(capB.name, escapeHtml(capB.name), '', capB.playerId) : '— kein Captain —'}</span>
                            <span class="cmp-row-pts ${capWinner === 'b' ? 'win' : (capWinner === 'a' ? 'loss' : 'draw')}">${capPtsB} Pkt.</span>
                        </div>
                        ${renderCapAvatar(capB)}
                    </div>
                    ${(capA && capB) ? `<div style="margin-top:10px;color:var(--text-muted);font-size:0.86rem;">
                        ${capWinner === 'draw'
                            ? 'Beide Captains lieferten gleich viele Punkte.'
                            : `Der Captain von <strong>${cmpManagerLink(capWinner === 'a' ? a.manager : b.manager, escapeHtml(capWinner === 'a' ? a.manager : b.manager))}</strong> brachte ${capDiffAbs} Punkte mehr.`}
                    </div>` : ''}
                </div>
            </div>`;

        // Position breakdown — expandable per position with player-level direct comparison
        // (bench players are already included in their respective position totals)
        const renderPlayerSide = (p, ptsClass, side) => {
            if (!p) {
                return `<div class="side ${side}"><span class="cmp-player-empty">— kein Spieler —</span></div>`;
            }
            const photoInner = renderPlayerPhotoShell(p.photo, p.name, 'cmp-player-photo-sm', { width: 32, height: 32 });
            const photoHtml = cmpPlayerImgLink(p.name, photoInner, p.playerId);
            const captainTag = p.isCaptain ? '<span class="cmp-cap-tag" title="Captain">C</span>' : '';
            const meta = p.slotNum >= 11 ? 'Bank' : (p.nation || '');
            const nameLinked = cmpPlayerLink(p.name, escapeHtml(p.name), '', p.playerId);
            const info = `
                <div class="cmp-player-info-mini">
                    <span class="cmp-player-name-mini">${nameLinked}${captainTag}</span>
                    ${meta ? `<span class="cmp-player-meta-mini">${escapeHtml(meta)}</span>` : ''}
                </div>`;
            const pts = `<span class="cmp-player-pts-mini ${ptsClass}">${p.pts}</span>`;
            if (side === 'left') {
                return `<div class="side left">${photoHtml}${info}${pts}</div>`;
            }
            return `<div class="side right">${pts}${info}${photoHtml}</div>`;
        };

        const positionBlocks = POSITION_KEYS.map(pos => {
            const ptsA = a.positionTotals[pos] || 0;
            const ptsB = b.positionTotals[pos] || 0;
            const w = ptsA > ptsB ? 'a' : (ptsA < ptsB ? 'b' : 'draw');
            const arrowSym = w === 'draw' ? '=' : (w === 'a' ? '◀' : '▶');
            const arrowCls = w === 'draw' ? '' : (w === 'a' ? 'win' : 'loss');
            const ptsAClass = w === 'a' ? 'win' : (w === 'b' ? 'loss' : 'draw');
            const ptsBClass = w === 'b' ? 'win' : (w === 'a' ? 'loss' : 'draw');
            const posDiff = ptsA - ptsB;
            const posDiffCls = posDiff > 0 ? 'win' : (posDiff < 0 ? 'loss' : 'draw');
            const posDiffText = posDiff === 0 ? '±0' : (posDiff > 0 ? `+${posDiff}` : `${posDiff}`);

            const playersA = a.players.filter(p => p.pos === pos).sort((x, y) => (y.pts || 0) - (x.pts || 0));
            const playersB = b.players.filter(p => p.pos === pos).sort((x, y) => (y.pts || 0) - (x.pts || 0));
            const maxLen = Math.max(playersA.length, playersB.length);

            let playerRowsHtml = '';
            if (maxLen === 0) {
                playerRowsHtml = `<div class="cmp-player-row" style="grid-template-columns:1fr;text-align:center;color:var(--text-muted);font-size:0.82rem;">Keine Spieler in dieser Position.</div>`;
            } else {
                for (let i = 0; i < maxLen; i++) {
                    const pa = playersA[i] || null;
                    const pb = playersB[i] || null;
                    const ppA = pa ? pa.pts : 0;
                    const ppB = pb ? pb.pts : 0;
                    let pw;
                    if (pa && pb) pw = ppA > ppB ? 'a' : (ppA < ppB ? 'b' : 'draw');
                    else if (pa) pw = 'a';
                    else if (pb) pw = 'b';
                    else pw = 'draw';
                    const pArrow = pw === 'draw' ? '=' : (pw === 'a' ? '◀' : '▶');
                    const pArrowCls = pw === 'draw' ? '' : (pw === 'a' ? 'win' : 'loss');
                    const pPtsAClass = pw === 'a' ? 'win' : (pw === 'b' ? 'loss' : 'draw');
                    const pPtsBClass = pw === 'b' ? 'win' : (pw === 'a' ? 'loss' : 'draw');
                    playerRowsHtml += `
                        <div class="cmp-player-row">
                            ${renderPlayerSide(pa, pPtsAClass, 'left')}
                            <div class="cmp-player-arrow ${pArrowCls}" aria-label="${pw === 'draw' ? 'Unentschieden' : (pw === 'a' ? 'Spieler A vorne' : 'Spieler B vorne')}">${pArrow}</div>
                            ${renderPlayerSide(pb, pPtsBClass, 'right')}
                        </div>`;
                }
            }

            const isOpen = cmpExpandedPositions.has(pos);
            const headerLabel = POSITION_LABELS[pos];
            return `
                <div class="cmp-pos-block ${isOpen ? 'is-open' : ''}" data-cmp-pos-block="${pos}">
                    <button type="button" class="cmp-pos-header" data-cmp-pos-toggle="${pos}" aria-expanded="${isOpen ? 'true' : 'false'}">
                        <span class="cmp-pos-label">${headerLabel}</span>
                        <span class="cmp-pos-summary">
                            <span class="cmp-pos-pts ${ptsAClass}">${ptsA}</span>
                            <span class="cmp-pos-center-col">
                                <span class="cmp-pos-arrow ${arrowCls}" aria-hidden="true">${arrowSym}</span>
                                <span class="cmp-pos-diff ${posDiffCls}" aria-label="Differenz ${posDiffText} Punkte">${posDiffText}</span>
                            </span>
                            <span class="cmp-pos-pts ${ptsBClass}">${ptsB}</span>
                        </span>
                        <span class="cmp-pos-chevron" aria-hidden="true">▾</span>
                    </button>
                    <div class="cmp-pos-players" role="region">${playerRowsHtml}</div>
                </div>`;
        }).join('');

        const positionsCard = `
            <div class="analysis-card">
                <div class="analysis-card-header">
                    <div class="analysis-card-title"><span class="act-accent" aria-hidden="true"></span>📊 Punkte nach Position</div>
                </div>
                <div class="analysis-card-body">
                    <div class="cmp-row-list">${positionBlocks}</div>
                </div>
            </div>`;

        // Matchwinner / differential players
        const playersByIdA = new Map(a.players.filter(p => p.playerId).map(p => [p.playerId, p]));
        const playersByIdB = new Map(b.players.filter(p => p.playerId).map(p => [p.playerId, p]));
        const sharedIds = new Set([...playersByIdA.keys()].filter(id => playersByIdB.has(id)));

        const topUniqueA = a.players
            .filter(p => p.playerId && !sharedIds.has(p.playerId))
            .sort((x, y) => y.pts - x.pts).slice(0, 3);
        const topUniqueB = b.players
            .filter(p => p.playerId && !sharedIds.has(p.playerId))
            .sort((x, y) => y.pts - x.pts).slice(0, 3);

        const renderMiniList = (items, side) => {
            const itemCls = side === 'b' ? 'cmp-diff-item is-right' : 'cmp-diff-item';
            if (!items.length) return `<div style="color:var(--text-muted);font-size:0.85rem;padding:8px 4px;">Keine unterschiedlichen Spieler.</div>`;
            return `<div class="cmp-diff-list">${items.map(p => {
                const photoInner = renderPlayerPhotoShell(p.photo, p.name, 'cmp-diff-photo', { width: 36, height: 36 });
                const photoLinked = cmpPlayerImgLink(p.name, photoInner, p.playerId);
                const nameLinked = cmpPlayerLink(p.name, escapeHtml(p.name), '', p.playerId);
                return `
                <div class="${itemCls}">
                    ${photoLinked}
                    <div class="cmp-diff-info">
                        <div class="cmp-diff-name">${nameLinked}${p.isCaptain ? ' <span class="cmp-badge elite" style="margin-left:4px;">C</span>' : ''}</div>
                        <div class="cmp-diff-meta">${escapeHtml(POSITION_LABELS[p.pos] || translatePosition(p.pos))} · ${escapeHtml(p.nation || '')}</div>
                    </div>
                    <div class="cmp-diff-pts ${p.pts > 0 ? 'pos' : (p.pts < 0 ? 'neg' : '')}">${formatPoints(p.pts)}</div>
                </div>`;
            }).join('')}</div>`;
        };

        const matchwinnerCard = `
            <div class="analysis-card">
                <div class="analysis-card-header">
                    <div class="analysis-card-title"><span class="act-accent" aria-hidden="true"></span>🔥 Matchwinner & Differenzspieler</div>
                </div>
                <div class="analysis-card-body">
                    <div class="cmp-matchwinner-grid">
                        <div class="cmp-matchwinner-col">
                            <div class="cmp-matchwinner-heading">${cmpManagerLink(a.manager, escapeHtml(a.manager))}</div>
                            ${renderMiniList(topUniqueA, 'a')}
                        </div>
                        <div class="cmp-matchwinner-col" style="text-align:right;">
                            <div class="cmp-matchwinner-heading">${cmpManagerLink(b.manager, escapeHtml(b.manager))}</div>
                            ${renderMiniList(topUniqueB, 'b')}
                        </div>
                    </div>
                </div>
            </div>`;

        // Storyline
        const story = buildManagerStoryline(a, b);
        const storyCard = `
            <div class="cmp-storyline">
                <div class="cmp-storyline-title">📖 Story des Duells</div>
                ${escapeHtml(story)}
            </div>`;

        out.innerHTML = heroHtml + positionsCard + captainCard + matchwinnerCard + storyCard;

        wireCmpPositionToggles(out);
    }

    function wireCmpPositionToggles(root) {
        if (!root) return;
        root.querySelectorAll('[data-cmp-pos-toggle]').forEach(btn => {
            btn.addEventListener('click', () => {
                const pos = btn.getAttribute('data-cmp-pos-toggle');
                const block = root.querySelector(`[data-cmp-pos-block="${pos}"]`);
                if (!block) return;
                const willOpen = !block.classList.contains('is-open');
                block.classList.toggle('is-open', willOpen);
                btn.setAttribute('aria-expanded', willOpen ? 'true' : 'false');
                if (willOpen) cmpExpandedPositions.add(pos);
                else cmpExpandedPositions.delete(pos);
            });
        });
    }

    function buildManagerStoryline(a, b) {
        if (!a || !b) return '';
        const totalDiff = a.totalScore - b.totalScore;
        const winner = totalDiff > 0 ? a : (totalDiff < 0 ? b : null);
        const loser = totalDiff > 0 ? b : (totalDiff < 0 ? a : null);
        if (!winner) return `${a.manager} und ${b.manager} stehen nach Gesamtpunkten exakt gleich – ein perfektes Unentschieden.`;

        const capDiff = (a.captain ? a.captain.pts : 0) - (b.captain ? b.captain.pts : 0);
        const capWinner = Math.abs(capDiff) > Math.abs(totalDiff) * 0.4
            ? (capDiff > 0 ? a : b)
            : null;

        const positionDiffs = POSITION_KEYS.map(pos => ({
            pos,
            diff: (a.positionTotals[pos] || 0) - (b.positionTotals[pos] || 0)
        }));
        const winnerPosDiffs = totalDiff > 0
            ? positionDiffs.filter(d => d.diff > 0).sort((x, y) => y.diff - x.diff)
            : positionDiffs.filter(d => d.diff < 0).sort((x, y) => x.diff - y.diff);
        const dominantPos = winnerPosDiffs[0];

        const parts = [];
        parts.push(`${winner.manager} gewinnt das Duell mit ${Math.abs(totalDiff)} Punkten Vorsprung.`);
        if (capWinner) {
            parts.push(`Der stärkere Captain (${capWinner.captain ? capWinner.captain.name : '–'}) entschied das Duell entscheidend.`);
        } else if (dominantPos) {
            parts.push(`Vor allem ${POSITION_LABELS[dominantPos.pos]} machte den Unterschied (${Math.abs(dominantPos.diff)} Pkt. mehr).`);
        }
        if (Math.abs(totalDiff) <= 10) {
            parts.push('Ein extrem enges Duell – jede einzelne Aktion zählte.');
        }
        return parts.join(' ');
    }

    /* ---------- Spieler-Duell ---------- */
    function renderPlayerDuell() {
        const out = document.getElementById('cmp-pl-result');
        if (!out) return;

        if (isTeamsLocked()) {
            out.innerHTML = `
                <div class="cmp-empty">
                    <span class="cmp-empty-icon">🔒</span>
                    Wird mit Turnierstart enthüllt.
                </div>`;
            return;
        }

        let stA = cmpPlayerA ? buildPlayerStats(cmpPlayerA) : null;
        let stB = null;

        // Special "virtual" comparisons handled via cmpPlayerB tokens (e.g. avg:GOALKEEPER)
        if (cmpPlayerB && cmpPlayerB.startsWith('virtual:')) {
            stB = buildVirtualOpponent(cmpPlayerB, stA);
        } else if (cmpPlayerB) {
            stB = buildPlayerStats(cmpPlayerB);
        }

        if (!stA && !stB) {
            out.innerHTML = `
                <div class="cmp-empty">
                    <span class="cmp-empty-icon">⚽</span>
                    Wähle zwei Spieler für den Vergleich.
                </div>`;
            return;
        }
        if (!stB) {
            out.innerHTML = `
                <div class="cmp-empty">
                    <span class="cmp-empty-icon">🆚</span>
                    Wähle einen zweiten Spieler oder nutze einen Schnellvergleich.
                </div>`;
            return;
        }
        if (!stA) {
            out.innerHTML = `
                <div class="cmp-empty">
                    <span class="cmp-empty-icon">🆚</span>
                    Wähle Spieler A für den Vergleich.
                </div>`;
            return;
        }

        const winner = stA.totalPoints > stB.totalPoints ? 'a'
            : (stA.totalPoints < stB.totalPoints ? 'b' : 'draw');

        const cardA = renderPlayerCardForCmp(stA, winner === 'a');
        const cardB = renderPlayerCardForCmp(stB, winner === 'b');

        const statRows = renderPlayerStatRows(stA, stB);

        const story = buildPlayerStoryline(stA, stB);

        const ranks = [];
        if (!stA.virtual) {
            const r = getPositionRank(stA.id);
            if (r) ranks.push(`${stA.player.Spielername}: Rang ${r.rank} von ${r.total} ${POSITION_LABELS[r.position]}`);
        }
        if (!stB.virtual) {
            const r = getPositionRank(stB.id);
            if (r) ranks.push(`${stB.player.Spielername}: Rang ${r.rank} von ${r.total} ${POSITION_LABELS[r.position]}`);
        }

        const hideEqualActive = cmpHidePlayerEqual;
        const hasDifferences = /data-equal="0"/.test(statRows);
        const showEmptyNotice = hideEqualActive && !hasDifferences;
        out.innerHTML = `
            <div class="cmp-player-grid">${cardA}${cardB}</div>
            ${ranks.length ? `<div class="analysis-card"><div class="analysis-card-body">
                <div style="font-size:0.78rem;font-weight:800;color:var(--text-muted);text-transform:uppercase;letter-spacing:0.4px;margin-bottom:6px;">Position-Ranking</div>
                ${ranks.map(r => `<div style="margin:4px 0;color:var(--text-main);font-size:0.92rem;">📌 ${escapeHtml(r)}</div>`).join('')}
            </div></div>` : ''}
            <div class="analysis-card cmp-stats-card${hideEqualActive ? ' is-hide-equal' : ''}">
                <div class="analysis-card-header">
                    <div class="analysis-card-title"><span class="act-accent" aria-hidden="true"></span>📊 Statistik-Vergleich</div>
                    <button type="button"
                            class="cmp-stats-toggle${hideEqualActive ? ' is-active' : ''}"
                            data-cmp-action="toggle-equal-stats"
                            aria-pressed="${hideEqualActive ? 'true' : 'false'}"
                            title="${hideEqualActive ? 'Gleiche Werte wieder einblenden' : 'Zeilen mit identischen Werten ausblenden'}">
                        <span class="cmp-stats-toggle-icon" aria-hidden="true">${hideEqualActive ? '👁️' : '🙈'}</span>
                        <span class="cmp-stats-toggle-label">${hideEqualActive ? 'Alle anzeigen' : 'Nur Differenzen'}</span>
                    </button>
                </div>
                <div class="analysis-card-body" style="padding:6px 6px;">${statRows}
                    <div class="cmp-stats-empty"${showEmptyNotice ? '' : ' hidden'}>Keine Unterschiede – alle Werte sind identisch.</div>
                </div>
            </div>
            <div class="cmp-storyline">
                <div class="cmp-storyline-title">📖 Fazit</div>
                ${escapeHtml(story)}
            </div>`;
    }

    function buildVirtualOpponent(token, refStats) {
        if (!refStats) return null;
        const [, kind, posOverride] = token.split(':');
        const pos = posOverride || refStats.position;
        if (kind === 'avg') {
            const avg = getAverageByPosition(pos);
            return {
                virtual: true,
                player: { Spielername: `Ø Durchschnitt ${POSITION_LABELS[pos] || pos}` },
                id: 'virtual-avg',
                position: pos,
                positionLabel: POSITION_LABELS[pos] || pos,
                nation: 'Alle',
                nationFlag: '',
                club: '–',
                clubLogo: '',
                photo: '',
                totalPoints: Math.round(avg),
                goals: '–', assists: '–', starts: '–', subbedIn: '–', subbedOut: '–',
                yellow: '–', red: '–',
                penGoals: '–', penMissed: '–', penSaved: '–', penCommitted: '–', penWon: '–',
                wins: '–', draws: '–', losses: '–',
                ownGoals: '–',
                games: '–', appearances: '–', pointsPerGame: null,
                draftCount: '–', captainCount: '–'
            };
        }
        if (kind === 'top10') {
            const avg = getTopNAverageByPosition(pos, 10);
            return {
                virtual: true,
                player: { Spielername: `Ø Top 10 ${POSITION_LABELS[pos] || pos}` },
                id: 'virtual-top10',
                position: pos,
                positionLabel: POSITION_LABELS[pos] || pos,
                nation: 'Top 10',
                nationFlag: '',
                club: '–',
                clubLogo: '',
                photo: '',
                totalPoints: Math.round(avg),
                goals: '–', assists: '–', starts: '–', subbedIn: '–', subbedOut: '–',
                yellow: '–', red: '–',
                penGoals: '–', penMissed: '–', penSaved: '–', penCommitted: '–', penWon: '–',
                wins: '–', draws: '–', losses: '–', ownGoals: '–',
                games: '–', appearances: '–', pointsPerGame: null,
                draftCount: '–', captainCount: '–'
            };
        }
        if (kind === 'best') {
            const best = getBestByPosition(pos);
            if (!best) return null;
            return buildPlayerStats(best.id);
        }
        return null;
    }

    function renderPlayerCardForCmp(stats, isWinner) {
        const playerName = stats.player.Spielername || '';
        const playerId = stats.virtual ? null : (stats.id || null);
        const photoInner = stats.virtual
            ? `<div class="cmp-player-photo" style="display:flex;align-items:center;justify-content:center;font-size:2rem;">📊</div>`
            : renderPlayerPhotoShell(stats.photo, playerName, 'cmp-player-photo', { width: 96, height: 96 });
        const photo = stats.virtual ? photoInner : cmpPlayerImgLink(playerName, photoInner, playerId);
        const nameDisplay = escapeHtml(playerName || '–');
        const nameHtml = stats.virtual ? nameDisplay : cmpPlayerLink(playerName, nameDisplay, '', playerId);

        const flag = stats.nationFlag ? `<img src="${escapeHtml(stats.nationFlag)}" alt="">` : '';
        const clubLogo = stats.clubLogo ? `<img src="${escapeHtml(stats.clubLogo)}" alt="" class="cmp-player-club-logo">` : '';
        const badges = stats.virtual ? [] : classifyPlayerBadge(stats);
        const badgesHtml = badges.length
            ? `<div class="cmp-player-badges">${badges.map(b => `<span class="cmp-badge ${b.cls}">${escapeHtml(b.text)}</span>`).join('')}</div>`
            : '';
        return `
            <div class="cmp-player-card ${isWinner ? 'is-winner' : ''}">
                ${isWinner ? '<span class="cmp-winner-badge" style="position:absolute;top:10px;right:10px;">🏆 Sieger</span>' : ''}
                ${photo}
                <div class="cmp-player-pos">${escapeHtml(stats.positionLabel || '')}</div>
                <div class="cmp-player-name">${nameHtml}</div>
                <div class="cmp-player-meta">
                    <span class="cmp-meta-row">${flag}<span>${escapeHtml(stats.nation || '–')}</span></span>
                    <span class="cmp-meta-row">${clubLogo}<span>${escapeHtml(stats.club || '–')}</span></span>
                </div>
                <div class="cmp-player-pts">${stats.totalPoints} Pkt.</div>
                ${badgesHtml}
            </div>`;
    }

    function renderPlayerStatRows(a, b) {
        const cmpNum = (x, y) => {
            const numX = Number(x), numY = Number(y);
            if (Number.isNaN(numX) || Number.isNaN(numY)) return 'draw';
            if (numX > numY) return 'a';
            if (numX < numY) return 'b';
            return 'draw';
        };
        const cmpLow = (x, y) => {
            const r = cmpNum(x, y);
            if (r === 'a') return 'b';
            if (r === 'b') return 'a';
            return 'draw';
        };
        const fmtVal = (v) => v === '–' || v === undefined || v === null ? '–' : v;

        const rows = [
            { label: 'Gesamtpunkte', a: a.totalPoints, b: b.totalPoints, cmp: cmpNum },
            { label: 'Position', a: a.positionLabel, b: b.positionLabel, cmp: () => 'draw' },
            { label: 'Nation', a: a.nation, b: b.nation, cmp: () => 'draw' },
            { label: 'Club', a: a.club, b: b.club, cmp: () => 'draw' },
            { label: 'Tore', a: a.goals, b: b.goals, cmp: cmpNum },
            { label: 'Assists', a: a.assists, b: b.assists, cmp: cmpNum },
            { label: 'Spiele (≈)', a: a.games, b: b.games, cmp: cmpNum },
            { label: 'Startelf', a: a.starts, b: b.starts, cmp: cmpNum },
            { label: 'Eingewechselt', a: a.subbedIn, b: b.subbedIn, cmp: cmpNum },
            { label: 'Ausgewechselt', a: a.subbedOut, b: b.subbedOut, cmp: cmpLow },
            { label: 'Gelbe Karten', a: a.yellow, b: b.yellow, cmp: cmpLow },
            { label: 'Rote Karten', a: a.red, b: b.red, cmp: cmpLow },
            { label: 'Eigentore', a: a.ownGoals, b: b.ownGoals, cmp: cmpLow },
            { label: 'Elfm. gehalten', a: a.penSaved, b: b.penSaved, cmp: cmpNum },
            { label: 'Elfm. verschossen', a: a.penMissed, b: b.penMissed, cmp: cmpLow },
            { label: 'Elfm. herausg.', a: a.penWon, b: b.penWon, cmp: cmpNum },
            { label: 'Elfm. verursacht', a: a.penCommitted, b: b.penCommitted, cmp: cmpLow },
            { label: 'Siege', a: a.wins, b: b.wins, cmp: cmpNum },
            { label: 'Unentschieden', a: a.draws, b: b.draws, cmp: () => 'draw' },
            { label: 'Niederlagen', a: a.losses, b: b.losses, cmp: cmpLow },
            { label: 'Pkt. pro Einsatz', a: a.pointsPerGame ?? '–', b: b.pointsPerGame ?? '–', cmp: cmpNum },
            { label: 'Drafts (Beliebtheit)', a: a.draftCount, b: b.draftCount, cmp: cmpNum },
            { label: 'Captain-Wahlen', a: a.captainCount, b: b.captainCount, cmp: cmpNum }
        ];

        return rows.map(r => {
            const winner = r.cmp(r.a, r.b);
            const valA = fmtVal(r.a);
            const valB = fmtVal(r.b);
            const skipHighlight = valA === '–' || valB === '–';
            const clsA = !skipHighlight && winner === 'a' ? 'win' : '';
            const clsB = !skipHighlight && winner === 'b' ? 'win' : '';
            const isEqual = String(valA) === String(valB);
            return `
                <div class="cmp-stat-row" data-equal="${isEqual ? '1' : '0'}">
                    <span class="stat-val left ${clsA}">${escapeHtml(String(valA))}</span>
                    <span class="label">${escapeHtml(r.label)}</span>
                    <span class="stat-val right ${clsB}">${escapeHtml(String(valB))}</span>
                </div>`;
        }).join('');
    }

    function buildPlayerStoryline(a, b) {
        if (!a || !b) return '';
        const diff = a.totalPoints - b.totalPoints;
        const winnerName = diff > 0 ? a.player.Spielername : (diff < 0 ? b.player.Spielername : null);

        if (b.virtual) {
            const factor = b.totalPoints > 0 ? Math.round((a.totalPoints / b.totalPoints) * 100) : 0;
            if (diff > 0) {
                return `${a.player.Spielername} liegt ${diff} Punkte über ${b.player.Spielername} und erreicht ${factor}% dieses Wertes – ein klar überdurchschnittlicher Spieler seiner Position.`;
            }
            if (diff < 0) {
                return `${a.player.Spielername} liegt ${Math.abs(diff)} Punkte unter ${b.player.Spielername} und erreicht nur ${factor}% – noch Luft nach oben.`;
            }
            return `${a.player.Spielername} entspricht exakt dem Wert von ${b.player.Spielername}.`;
        }

        if (!winnerName) {
            return `${a.player.Spielername} und ${b.player.Spielername} sind in der Gesamtbilanz exakt gleichauf.`;
        }
        const parts = [`${winnerName} gewinnt das Duell mit ${Math.abs(diff)} Punkten Vorsprung.`];
        const goalDiff = (Number(a.goals) || 0) - (Number(b.goals) || 0);
        const assistDiff = (Number(a.assists) || 0) - (Number(b.assists) || 0);
        if (Math.abs(goalDiff) >= 2) {
            parts.push(`Der Vorsprung kommt vor allem durch ${goalDiff > 0 ? a.player.Spielername : b.player.Spielername}'s ${Math.abs(goalDiff)} Tore mehr.`);
        } else if (Math.abs(assistDiff) >= 2) {
            parts.push(`Die zusätzlichen Assists machten den Unterschied.`);
        } else if (((Number(a.yellow) + Number(a.red) * 2) || 0) !== ((Number(b.yellow) + Number(b.red) * 2) || 0)) {
            parts.push(`Auch Disziplin spielte eine Rolle – Karten kosten wertvolle Punkte.`);
        }
        return parts.join(' ');
    }

    /* ---------- Was wäre möglich gewesen ---------- */
    function renderWhatIfAnalysis() {
        const out = document.getElementById('cmp-whatif-result');
        if (!out) return;

        if (isTeamsLocked()) {
            out.innerHTML = `
                <div class="cmp-empty">
                    <span class="cmp-empty-icon">🔒</span>
                    Wird mit Turnierstart enthüllt.
                </div>`;
            return;
        }

        const team = getEnrichedTeamByManager(cmpWhatIfMgr);
        if (!team) {
            out.innerHTML = `
                <div class="cmp-empty">
                    <span class="cmp-empty-icon">💭</span>
                    Wähle einen Manager, um verpasste Punkte zu analysieren.
                </div>`;
            return;
        }

        // Best alternative same-nation per player
        const altsSameNation = team.players.filter(p => p.playerId).map(p => {
            const candidates = playersData
                .filter(other => (other['Nationalteam.name'] || '') === (p.nation || '') && String(other['player.id']) !== p.playerId)
                .map(other => ({
                    id: String(other['player.id']),
                    name: other.Spielername,
                    pos: cmpNormalizePosition(other.Position),
                    pts: getPlayerBasePoints(other['player.id']),
                    samePos: cmpNormalizePosition(other.Position) === p.pos,
                    photo: other.Spielerfoto || '',
                    nation: other['Nationalteam.name'] || ''
                }))
                .sort((a, b) => b.pts - a.pts);
            const best = candidates.length ? candidates[0] : null;
            const bestSamePos = candidates.find(c => c.samePos) || null;
            return { player: p, best, bestSamePos };
        });

        // "Perfect team light" within nation rules (1 player per nation, fixed slots)
        const perfectLight = computePerfectLightTeam();
        const perfectScore = perfectLight.score;
        const teamScore = team.totalScore;
        const maxPercent = perfectScore > 0 ? Math.round((teamScore / perfectScore) * 100) : 0;
        const totalMissed = Math.max(0, perfectScore - teamScore);

        // Per-position diff vs. perfect team (signed). Both teams have the same
        // slot composition (GK 2 / DEF 4 / MID 5 / ATT 4), so summing these per-
        // position diffs plus the captain-bonus diff equals `totalMissed`.
        const currentBaseByPos = { GOALKEEPER: 0, DEFENDER: 0, MIDFIELDER: 0, ATTACKER: 0 };
        team.players.forEach(p => {
            if (currentBaseByPos[p.pos] !== undefined) currentBaseByPos[p.pos] += p.basePts;
        });
        const perfectBaseByPos = { GOALKEEPER: 0, DEFENDER: 0, MIDFIELDER: 0, ATTACKER: 0 };
        perfectLight.players.forEach(p => {
            if (perfectBaseByPos[p.pos] !== undefined) perfectBaseByPos[p.pos] += p.pts;
        });
        // Positive diff = perfect is better than current = missed points.
        // Negative diff = your team is stronger than perfect in this position
        // (possible because nation-allocation forces trade-offs between slots).
        const missedByPosition = {
            GOALKEEPER: perfectBaseByPos.GOALKEEPER - currentBaseByPos.GOALKEEPER,
            DEFENDER:   perfectBaseByPos.DEFENDER   - currentBaseByPos.DEFENDER,
            MIDFIELDER: perfectBaseByPos.MIDFIELDER - currentBaseByPos.MIDFIELDER,
            ATTACKER:   perfectBaseByPos.ATTACKER   - currentBaseByPos.ATTACKER
        };

        // Captain comparison: bonus delta to perfect-team captain so that
        // Σ missedByPosition + captainMissed == totalMissed.
        const currentCaptain = team.captain;
        const captainBonusCurrent = currentCaptain ? currentCaptain.basePts : 0;
        const captainBonusBest = perfectLight.captain ? perfectLight.captain.pts : 0;
        const captainMissed = Math.max(0, captainBonusBest - captainBonusCurrent);

        // Best captain pick *within* the current squad – used by the
        // "Captain-Optimierung" card as actionable advice ("with the players
        // you actually own, who should you have captained?").
        const bestPlayer = team.players.slice().sort((a, b) => b.basePts - a.basePts)[0] || null;
        const captainBonusBestOwn = bestPlayer ? bestPlayer.basePts : 0;
        const captainMissedOwn = Math.max(0, captainBonusBestOwn - captainBonusCurrent);

        // Top alternatives (biggest missed picks)
        const topMissed = altsSameNation
            .map(item => ({
                ...item,
                diff: item.bestSamePos ? item.bestSamePos.pts - item.player.basePts : 0
            }))
            .filter(x => x.diff > 0)
            .sort((a, b) => b.diff - a.diff)
            .slice(0, 8);

        // Best & worst picks of the manager
        const sortedPicks = team.players.slice().sort((a, b) => b.basePts - a.basePts);
        const bestPicks = sortedPicks.slice(0, 3);
        const worstPicks = sortedPicks.slice(-3).reverse();

        const summaryHtml = `
            <div class="cmp-summary-grid">
                ${cmpRankingLink(`
                <div class="cmp-summary-tile accent">
                    <div class="cmp-summary-label">Aktuelle Punkte</div>
                    <div class="cmp-summary-value">${teamScore}</div>
                </div>`, 'cmp-summary-link', team.manager)}
                <div class="cmp-summary-tile gold">
                    <div class="cmp-summary-label">Mögliches Maximum</div>
                    <div class="cmp-summary-value gold">${perfectScore}</div>
                </div>
                <div class="cmp-summary-tile warn">
                    <div class="cmp-summary-label">Verpasste Punkte</div>
                    <div class="cmp-summary-value neg">${totalMissed}</div>
                </div>
                <div class="cmp-summary-tile">
                    <div class="cmp-summary-label">Quote vom Maximum</div>
                    <div class="cmp-summary-value">${maxPercent}%</div>
                </div>
            </div>`;

        const renderWhatIfCapAvatar = (player, badgeChar, badgeClass) => {
            const photo = renderPlayerPhotoShell(player && player.photo, player && player.name, 'cmp-cap-photo', { width: 52, height: 52 });
            const badge = badgeChar
                ? `<div class="cmp-cap-c-badge ${badgeClass || ''}" aria-hidden="true">${badgeChar}</div>`
                : '';
            const inner = `<div class="cmp-cap-avatar">${photo}${badge}</div>`;
            return player && (player.name || player.playerId) ? cmpPlayerImgLink(player.name, inner, player.playerId) : inner;
        };

        const captainHtml = `
            <div class="analysis-card">
                <div class="analysis-card-header">
                    <div class="analysis-card-title"><span class="act-accent" aria-hidden="true"></span>👑 Captain-Optimierung</div>
                </div>
                <div class="analysis-card-body">
                    <div class="cmp-cap-row cmp-whatif-cap-row">
                        ${renderWhatIfCapAvatar(currentCaptain, 'C')}
                        <div class="cmp-cap-side">
                            <span class="cmp-row-name">${currentCaptain ? cmpPlayerLink(currentCaptain.name, escapeHtml(currentCaptain.name), '', currentCaptain.playerId) : '— kein Captain —'}</span>
                            <span class="cmp-row-pts">${captainBonusCurrent} Bonus</span>
                        </div>
                        <div class="cmp-cap-center">
                            <span class="cmp-cap-arrow ${captainMissedOwn > 0 ? 'loss' : ''}" aria-hidden="true">→</span>
                            <span class="cmp-cap-diff ${captainMissedOwn > 0 ? 'win' : 'draw'}" aria-label="Differenz +${captainMissedOwn} Punkte">${captainMissedOwn > 0 ? `+${captainMissedOwn}` : '±0'}</span>
                        </div>
                        <div class="cmp-cap-side right">
                            <span class="cmp-row-name">${bestPlayer ? cmpPlayerLink(bestPlayer.name, escapeHtml(bestPlayer.name), '', bestPlayer.playerId) : '–'}</span>
                            <span class="cmp-row-pts ${captainMissedOwn > 0 ? 'win' : 'draw'}">${captainBonusBestOwn} Bonus</span>
                        </div>
                        ${renderWhatIfCapAvatar(bestPlayer, '★', 'star')}
                    </div>
                    <div class="cmp-whatif-note ${captainMissedOwn > 0 ? 'is-warn' : ''}">
                        ${captainMissedOwn > 0
                            ? `Verpasste Captain-Punkte mit deinem Kader: <strong>+${captainMissedOwn}</strong>`
                            : `Du hast aus deinem Kader den optimalen Captain gewählt.`}
                    </div>
                </div>
            </div>`;

        const renderDiffTileValue = (diff) => {
            if (diff > 0) return `<div class="cmp-pos-tile-value neg">-${diff}</div>`;
            if (diff < 0) return `<div class="cmp-pos-tile-value pos">+${Math.abs(diff)}</div>`;
            return `<div class="cmp-pos-tile-value zero">±0</div>`;
        };
        const positionTilesHtml = `
            <div class="analysis-card">
                <div class="analysis-card-header">
                    <div class="analysis-card-title"><span class="act-accent" aria-hidden="true"></span>📍 Differenz zum perfekten Team nach Position</div>
                </div>
                <div class="analysis-card-body">
                    <div class="cmp-pos-grid">
                        ${POSITION_KEYS.map(pos => `
                            <div class="cmp-pos-tile">
                                <div class="cmp-pos-tile-label">${POSITION_ICONS[pos] || ''} ${POSITION_LABELS[pos]}</div>
                                ${renderDiffTileValue(missedByPosition[pos] || 0)}
                            </div>`).join('')}
                        <div class="cmp-pos-tile">
                            <div class="cmp-pos-tile-label">👑 Captain-Bonus</div>
                            ${renderDiffTileValue(captainMissed || 0)}
                        </div>
                    </div>
                </div>
            </div>`;

        const renderAltAvatar = (photo, name, playerId) => {
            const inner = renderPlayerPhotoShell(photo, name, 'cmp-alt-photo', { width: 40, height: 40 });
            return (name || playerId) ? cmpPlayerImgLink(name, inner, playerId) : inner;
        };

        const topMissedHtml = `
            <div class="analysis-card">
                <div class="analysis-card-header">
                    <div class="analysis-card-title"><span class="act-accent" aria-hidden="true"></span>🔄 Grösste verpasste Alternativen</div>
                </div>
                <div class="analysis-card-body">
                    ${topMissed.length === 0
                        ? `<div style="color:var(--text-muted);font-style:italic;text-align:center;">Du hast aus jedem Land den besten positionsgleichen Spieler gewählt – starke Auswahl!</div>`
                        : `<div class="cmp-alt-list">${topMissed.map(item => `
                            <div class="cmp-alt-row">
                                <div class="cmp-alt-side">
                                    ${renderAltAvatar(item.player.photo, item.player.name, item.player.playerId)}
                                    <div class="cmp-alt-info">
                                        <div class="cmp-alt-name">${cmpPlayerLink(item.player.name, escapeHtml(item.player.name), '', item.player.playerId)}</div>
                                        <div class="cmp-alt-meta">${escapeHtml(POSITION_LABELS[item.player.pos] || translatePosition(item.player.pos))} · ${escapeHtml(item.player.nation)}</div>
                                        <div class="cmp-alt-pts">${item.player.basePts} Pkt.</div>
                                    </div>
                                </div>
                                <div class="cmp-alt-arrow" aria-hidden="true">→</div>
                                <div class="cmp-alt-side">
                                    ${renderAltAvatar(item.bestSamePos.photo, item.bestSamePos.name, item.bestSamePos.id)}
                                    <div class="cmp-alt-info">
                                        <div class="cmp-alt-name is-best">${cmpPlayerLink(item.bestSamePos.name, escapeHtml(item.bestSamePos.name), '', item.bestSamePos.id)}</div>
                                        <div class="cmp-alt-meta">gleiche Nation &amp; Position</div>
                                        <div class="cmp-alt-pts is-best">${item.bestSamePos.pts} Pkt.</div>
                                    </div>
                                </div>
                                <div class="cmp-alt-diff pos" aria-label="Differenz +${item.diff} Punkte">+${item.diff}</div>
                            </div>`).join('')}</div>`}
                </div>
            </div>`;

        // Best/worst picks card
        const renderPickRow = (p) => {
            const photoInner = renderPlayerPhotoShell(p.photo, p.name, 'cmp-diff-photo', { width: 36, height: 36 });
            const photoLinked = cmpPlayerImgLink(p.name, photoInner, p.playerId);
            const nameLinked = cmpPlayerLink(p.name, escapeHtml(p.name), '', p.playerId);
            return `
            <div class="cmp-diff-item">
                ${photoLinked}
                <div class="cmp-diff-info">
                    <div class="cmp-diff-name">${nameLinked}${p.isCaptain ? ' <span class="cmp-badge elite" style="margin-left:4px;">C</span>' : ''}</div>
                    <div class="cmp-diff-meta">${escapeHtml(POSITION_LABELS[p.pos] || translatePosition(p.pos))} · ${escapeHtml(p.nation || '')}</div>
                </div>
                <div class="cmp-diff-pts ${p.basePts > 0 ? 'pos' : (p.basePts < 0 ? 'neg' : '')}">${formatPoints(p.basePts)}</div>
            </div>`;
        };

        const picksHtml = `
            <div class="analysis-card">
                <div class="analysis-card-header">
                    <div class="analysis-card-title"><span class="act-accent" aria-hidden="true"></span>🌟 Beste & schwächste Picks</div>
                </div>
                <div class="analysis-card-body">
                    <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;">
                        <div>
                            <div style="font-size:0.78rem;font-weight:800;color:var(--green-light);margin-bottom:8px;text-transform:uppercase;letter-spacing:0.4px;">Top 3 Picks</div>
                            <div class="cmp-diff-list">${bestPicks.map(renderPickRow).join('')}</div>
                        </div>
                        <div>
                            <div style="font-size:0.78rem;font-weight:800;color:var(--red-soft);margin-bottom:8px;text-transform:uppercase;letter-spacing:0.4px;">Schwächste 3</div>
                            <div class="cmp-diff-list">${worstPicks.map(renderPickRow).join('')}</div>
                        </div>
                    </div>
                </div>
            </div>`;

        // Storyline
        const story = buildWhatIfStoryline(team, missedByPosition, captainMissed, totalMissed, maxPercent, topMissed);
        const storyHtml = `
            <div class="cmp-storyline">
                <div class="cmp-storyline-title">📖 Deine Story</div>
                ${escapeHtml(story)}
            </div>`;

        out.innerHTML = summaryHtml + positionTilesHtml + captainHtml + topMissedHtml + picksHtml + storyHtml;
    }

    function computePerfectLightTeam() {
        // Greedy: highest-points players per position with one-per-nation constraint.
        // Mirrors the existing perfect-team logic for consistency.
        const all = playersData.map(p => ({
            id: String(p['player.id']),
            nation: p['Nationalteam.name'] || '',
            pos: cmpNormalizePosition(p.Position),
            pts: getPlayerBasePoints(p['player.id']),
            name: p.Spielername
        }));
        const slots = { GOALKEEPER: [], DEFENDER: [], MIDFIELDER: [], ATTACKER: [] };
        const max = { GOALKEEPER: 2, DEFENDER: 4, MIDFIELDER: 5, ATTACKER: 4 };
        const usedNations = new Set();
        const sorted = [...all].sort((a, b) => b.pts - a.pts);
        for (const p of sorted) {
            if (!slots[p.pos] || slots[p.pos].length >= max[p.pos]) continue;
            if (p.nation && usedNations.has(p.nation)) continue;
            slots[p.pos].push(p);
            if (p.nation) usedNations.add(p.nation);
        }
        const all15 = [].concat(slots.GOALKEEPER, slots.DEFENDER, slots.MIDFIELDER, slots.ATTACKER);
        // Captain = best of these
        const captain = all15.slice().sort((a, b) => b.pts - a.pts)[0] || null;
        const score = all15.reduce((s, p) => s + p.pts, 0) + (captain ? captain.pts : 0);
        return { players: all15, captain, score };
    }

    function buildWhatIfStoryline(team, missedByPosition, captainMissed, totalMissed, percent, topMissed) {
        const parts = [];
        // missedByPosition values are signed (positive = missed, negative = stronger than perfect team).
        const worstPos = POSITION_KEYS
            .map(p => ({ pos: p, missed: missedByPosition[p] || 0 }))
            .sort((a, b) => b.missed - a.missed)[0];
        if (worstPos && worstPos.missed > 0) {
            parts.push(`Dein grösstes verpasstes Potenzial lag im Bereich ${POSITION_LABELS[worstPos.pos]} (${worstPos.missed} Punkte gegenüber dem perfekten Team).`);
        }
        const bestPos = POSITION_KEYS
            .map(p => ({ pos: p, missed: missedByPosition[p] || 0 }))
            .sort((a, b) => a.missed - b.missed)[0];
        if (bestPos && bestPos.missed < 0) {
            parts.push(`Dafür warst du im Bereich ${POSITION_LABELS[bestPos.pos]} sogar ${Math.abs(bestPos.missed)} Punkte stärker als das Perfect-Team.`);
        }
        if (captainMissed > 0) {
            parts.push(`Eine andere Captain-Wahl hätte dir bis zu ${captainMissed} Bonuspunkte mehr gebracht.`);
        }
        if (topMissed && topMissed.length) {
            const top = topMissed[0];
            parts.push(`Die grösste verpasste Alternative: ${top.bestSamePos.name} statt ${top.player.name} (+${top.diff} Punkte).`);
        }
        parts.push(`Insgesamt hast du ${percent}% der theoretisch möglichen Punkte erreicht.`);
        if (totalMissed === 0) {
            parts.push('Beachtlich – kaum Verbesserungspotenzial!');
        }
        return parts.join(' ');
    }

    /* ---------- Player combobox (autocomplete) ---------- */
    function setupPlayerCombo(sideKey) {
        const wrap = document.querySelector(`.cmp-combo[data-cmp-side="${sideKey}"]`);
        if (!wrap || wrap._comboReady) return;
        wrap._comboReady = true;
        const input = wrap.querySelector('.cmp-combo-input');
        const dropdown = wrap.querySelector('.cmp-combo-dropdown');
        const clearBtn = wrap.querySelector('.cmp-combo-clear');
        if (!input || !dropdown || !clearBtn) return;

        let activeIndex = -1;
        let currentMatches = [];
        const MAX_RESULTS = 80;

        const getStateValue = () => sideKey === 'a' ? cmpPlayerA : cmpPlayerB;
        const setStateValue = (val) => {
            if (sideKey === 'a') cmpPlayerA = val;
            else cmpPlayerB = val;
        };

        const updateClear = () => {
            const val = getStateValue();
            const has = !!(val && !String(val).startsWith('virtual:'));
            clearBtn.hidden = !has;
        };

        const closeDropdown = () => {
            dropdown.hidden = true;
            input.setAttribute('aria-expanded', 'false');
            activeIndex = -1;
        };

        const openDropdown = () => {
            dropdown.hidden = false;
            input.setAttribute('aria-expanded', 'true');
        };

        const buildList = (term) => {
            const tokens = getSearchTokens(term);
            const matches = [...playersData]
                .filter(p => !tokens.length || searchMatchesAll(p.Spielername, tokens))
                .sort((a, b) => (a.Spielername || '').localeCompare(b.Spielername || '', 'de'))
                .slice(0, MAX_RESULTS);
            currentMatches = matches;
            activeIndex = matches.length ? 0 : -1;
            if (!matches.length) {
                dropdown.innerHTML = `<div class="cmp-combo-empty">Keine Spieler gefunden.</div>`;
                return;
            }
            dropdown.innerHTML = matches.map((p, i) => {
                const id = String(p['player.id']);
                const meta = `${translatePosition(p.Position)} · ${p['Nationalteam.name'] || '?'}`;
                return `<div class="cmp-combo-option${i === 0 ? ' is-active' : ''}" role="option" data-id="${escapeHtml(id)}" data-index="${i}" aria-selected="${i === 0 ? 'true' : 'false'}">
                    <span class="cmp-combo-option-name">${escapeHtml(p.Spielername || '')}</span>
                    <span class="cmp-combo-option-meta">${escapeHtml(meta)}</span>
                </div>`;
            }).join('');
        };

        const setHighlight = (newIndex) => {
            const opts = dropdown.querySelectorAll('.cmp-combo-option');
            if (!opts.length) return;
            if (newIndex < 0) newIndex = opts.length - 1;
            if (newIndex >= opts.length) newIndex = 0;
            opts.forEach((o, i) => {
                const active = i === newIndex;
                o.classList.toggle('is-active', active);
                o.setAttribute('aria-selected', String(active));
            });
            activeIndex = newIndex;
            const el = opts[newIndex];
            if (el && typeof el.scrollIntoView === 'function') {
                el.scrollIntoView({ block: 'nearest' });
            }
        };

        const choose = (player) => {
            if (!player) return;
            setStateValue(String(player['player.id']));
            input.value = player.Spielername || '';
            closeDropdown();
            updateClear();
            renderPlayerDuell();
            updateUrl(false);
        };

        const clearSelection = (focus = true) => {
            setStateValue('');
            input.value = '';
            updateClear();
            closeDropdown();
            renderPlayerDuell();
            updateUrl(false);
            if (focus) input.focus();
        };

        input.addEventListener('input', () => {
            // While typing the previously chosen player is no longer the active selection
            const val = getStateValue();
            if (val && !String(val).startsWith('virtual:')) {
                setStateValue('');
                renderPlayerDuell();
                updateUrl(false);
            }
            updateClear();
            buildList(input.value);
            openDropdown();
        });

        input.addEventListener('focus', () => {
            buildList(input.value);
            openDropdown();
        });

        input.addEventListener('keydown', (ev) => {
            if (ev.key === 'ArrowDown') {
                ev.preventDefault();
                if (dropdown.hidden) { buildList(input.value); openDropdown(); }
                setHighlight(activeIndex + 1);
            } else if (ev.key === 'ArrowUp') {
                ev.preventDefault();
                if (dropdown.hidden) { buildList(input.value); openDropdown(); }
                setHighlight(activeIndex - 1);
            } else if (ev.key === 'Enter') {
                if (!dropdown.hidden && currentMatches[activeIndex]) {
                    ev.preventDefault();
                    choose(currentMatches[activeIndex]);
                }
            } else if (ev.key === 'Escape') {
                if (!dropdown.hidden) {
                    ev.preventDefault();
                    closeDropdown();
                }
            } else if (ev.key === 'Tab') {
                closeDropdown();
            }
        });

        // Use mousedown so the click registers before the input loses focus
        dropdown.addEventListener('mousedown', (ev) => {
            const opt = ev.target.closest('.cmp-combo-option');
            if (!opt) return;
            ev.preventDefault();
            const idx = Number(opt.dataset.index);
            const player = currentMatches[idx];
            if (player) choose(player);
        });

        clearBtn.addEventListener('mousedown', (ev) => {
            ev.preventDefault();
            clearSelection(true);
        });

        document.addEventListener('mousedown', (ev) => {
            if (!wrap.contains(ev.target)) closeDropdown();
        });

        document.addEventListener('keydown', (ev) => {
            if (ev.key === 'Escape' && !dropdown.hidden) closeDropdown();
        });

        // Programmatic selection from URL/state restoration or quick-compare buttons
        wrap._setSelectedById = (id) => {
            if (!id) {
                input.value = '';
                updateClear();
                closeDropdown();
                return;
            }
            const player = getPlayerById(id);
            input.value = player ? (player.Spielername || '') : '';
            updateClear();
            closeDropdown();
        };

        updateClear();
    }

    /* ---------- Wire up event listeners (one-time) ---------- */
    function initComparisonsEventsOnce() {
        if (initComparisonsEventsOnce.done) return;
        initComparisonsEventsOnce.done = true;

        document.querySelectorAll('.cmp-pill').forEach(btn => {
            btn.addEventListener('click', () => setComparisonTab(btn.dataset.cmpTab, true));
        });

        const onMgrChange = (which) => {
            const sel = document.getElementById('cmp-mgr-' + which);
            if (!sel) return;
            sel.addEventListener('change', () => {
                if (which === 'a') cmpMgrA = sel.value;
                else cmpMgrB = sel.value;
                renderManagerDuell();
                updateUrl(false);
            });
        };
        onMgrChange('a'); onMgrChange('b');

        setupPlayerCombo('a');
        setupPlayerCombo('b');

        document.querySelectorAll('.cmp-quick-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                if (!cmpPlayerA) return;
                const stA = buildPlayerStats(cmpPlayerA);
                if (!stA) return;
                const kind = btn.dataset.quick;
                cmpPlayerB = `virtual:${kind}:${stA.position}`;
                if (kind === 'best') {
                    const best = getBestByPosition(stA.position);
                    if (best && best.id !== stA.id) cmpPlayerB = best.id;
                }
                syncPlayerCombo('b', cmpPlayerB);
                renderPlayerDuell();
                updateUrl(false);
            });
        });

        const playerResult = document.getElementById('cmp-pl-result');
        if (playerResult) {
            playerResult.addEventListener('click', (ev) => {
                const btn = ev.target.closest('[data-cmp-action="toggle-equal-stats"]');
                if (!btn) return;
                cmpHidePlayerEqual = !cmpHidePlayerEqual;
                const card = btn.closest('.cmp-stats-card');
                if (card) {
                    card.classList.toggle('is-hide-equal', cmpHidePlayerEqual);
                    btn.classList.toggle('is-active', cmpHidePlayerEqual);
                    btn.setAttribute('aria-pressed', cmpHidePlayerEqual ? 'true' : 'false');
                    btn.setAttribute('title',
                        cmpHidePlayerEqual ? 'Gleiche Werte wieder einblenden' : 'Zeilen mit identischen Werten ausblenden');
                    const icon = btn.querySelector('.cmp-stats-toggle-icon');
                    if (icon) icon.textContent = cmpHidePlayerEqual ? '👁️' : '🙈';
                    const label = btn.querySelector('.cmp-stats-toggle-label');
                    if (label) label.textContent = cmpHidePlayerEqual ? 'Alle anzeigen' : 'Nur Differenzen';
                    const empty = card.querySelector('.cmp-stats-empty');
                    if (empty) {
                        const visibleRows = card.querySelectorAll(
                            cmpHidePlayerEqual
                                ? '.cmp-stat-row[data-equal="0"]'
                                : '.cmp-stat-row'
                        );
                        empty.hidden = visibleRows.length > 0;
                    }
                }
            });
        }

        const whatIfSel = document.getElementById('cmp-whatif-mgr');
        if (whatIfSel) {
            whatIfSel.addEventListener('change', () => {
                cmpWhatIfMgr = whatIfSel.value;
                renderWhatIfAnalysis();
                updateUrl(false);
            });
        }
    }

    /* =========================================================
       GLOBAL FUNCTIONS (called from inline HTML)
       ========================================================= */
    // Open a player in the analysis view. Identification is by ID
    // (preferred); the second argument is kept for backward compatibility
    // with older inline call-sites that still pass a player name.
    function openPlayerFromGames(playerIdOrName, fallbackName) {
        let player = null;
        if (playerIdOrName != null && playerIdOrName !== '') {
            const idCandidate = String(playerIdOrName);
            player = resolvePlayerIdentity(idCandidate, fallbackName);
            if (!player) {
                player = getPlayerByName(idCandidate);
            }
        }
        if (!player && fallbackName) {
            player = getPlayerByName(fallbackName);
        }
        if (!player) return;
        currentPlayerId = String(player['player.id']);
        currentPlayerName = player.Spielername;
        // Push a new history entry when switching from Spiele into the Spieler view,
        // so the browser back button returns to the originating view.
        setView('players', true);
        triggerHeroSwitch(() => showPlayerDetails(player));
        scrollToPlayerTop();
    }
    window.openPlayerFromGames = openPlayerFromGames;

    function scrollToPlayerTop() {
        if (window.innerWidth <= 860) {
            scrollToHeroOnMobile();
            return;
        }
        const behavior = prefersReducedMotion() ? 'auto' : 'smooth';
        window.scrollTo({ top: 0, behavior });
    }

    // Backward compatible: clicking a country in the Spieler-Detail
    // navigates the user to the Spielplan view filtered by that nation,
    // since the dedicated Länder view has been replaced by Vergleiche.
    function openGamesViewWithNation(nation, matchNumber = null) {
        currentScheduleNationFilter = nation || 'ALL';
        currentScheduleStatusFilter = 'all';
        const matchNr = Number(matchNumber);
        if (Number.isFinite(matchNr) && matchNr > 0) {
            pendingScheduleFocus = { matchId: null, matchNr };
        }
        setView('games', true);
        renderScheduleView();
        renderScheduleCountryList();
    }
    window.openGamesViewWithNation = openGamesViewWithNation;

    window.toggleDetails = function(headerEl) {
        const content = headerEl.nextElementSibling;
        const icon = headerEl.querySelector('.toggle-icon');
        const isOpen = content.style.display === 'block';
        content.style.display = isOpen ? 'none' : 'block';
        if (icon) icon.textContent = isOpen ? '▼' : '▲';
        headerEl.setAttribute('aria-expanded', String(!isOpen));
        syncSidebarHeight();
    };

    /* =========================================================
       MAIN DATASET APPLICATION
       ========================================================= */
    function applyDataset(data, options = {}) {
        const preserveCurrentPlayer = !!options.preserveCurrentPlayer;

        // Letzten Datensatz cachen, damit ein Lock-State-Wechsel (Anpfiff
        // oder Admin-Override) ohne neuen Cache-Roundtrip re-rendern kann.
        try { window.__spaLastData = data; } catch (_) { /* ignore */ }

        pointsData = data.points || {};
        allTeams = Array.isArray(data.teams) ? data.teams : [];

        // Preserve fixtures across calls so popstate (e.g. Browser-Back from Länder)
        // does not lose the schedule and trigger "Kein Spielplan verfügbar".
        if (data.fixtures !== undefined) {
            lastFixtures = data.fixtures;
        }
        const dataForSchedule = (data.fixtures !== undefined)
            ? data
            : { ...data, fixtures: lastFixtures };

        buildPlayerSelectedMap();
        calculatePerfectTeamIds();
        initStaticFilters();
        buildMatchCatalog();
        buildScheduleCatalog(dataForSchedule);
        buildScheduleNationList();
        invalidateComparisonCaches();

        const state = getStateFromUrl();

        currentView = state.view;
        currentScheduleNationFilter = state.scheduleNation || 'ALL';
        currentScheduleStatusFilter = state.scheduleStatus || 'current';
        if (currentView === 'games' && (state.matchId || state.matchNr) && !state.hasScheduleStatus) {
            currentScheduleStatusFilter = 'all';
        }

        // Capture an incoming Spiele focus request (matchId / matchNr) so
        // setView('games') below can auto-expand and scroll to the right
        // card. We do not persist this to the URL once handled to keep
        // the URL clean for subsequent navigation.
        if (currentView === 'games' && (state.matchId || state.matchNr)) {
            pendingScheduleFocus = {
                matchId: state.matchId ? Number(state.matchId) : null,
                matchNr: state.matchNr ? Number(state.matchNr) : null
            };
        }

        currentCmpTab = state.cmpTab || 'manager';
        cmpMgrA = state.cmpMgrA || '';
        cmpMgrB = state.cmpMgrB || '';
        cmpPlayerA = state.cmpPlayerA || '';
        cmpPlayerB = state.cmpPlayerB || '';
        cmpWhatIfMgr = state.cmpWhatIfMgr || '';
        currentTournamentTab = state.tournamentTab || 'groups';
        if (currentTournamentTab !== 'knockout') resetTournamentBracketZoom({ skipSidebarSync: true });

        if (!preserveCurrentPlayer) {
            currentPlayerId = state.playerId || null;
            currentPlayerName = state.player || null;
        } else {
            if (state.playerId) currentPlayerId = state.playerId;
            if (state.player) currentPlayerName = state.player;
        }

        const clubFilterEl = document.getElementById('club-filter');
        if (state.club && Array.from(clubFilterEl.options).some(o => o.value === state.club)) {
            clubFilterEl.value = state.club;
        }

        const filteredData = applyFilters();
        populateComparisonPickers();

        // Sync comparison tab pills state without pushing history.
        document.querySelectorAll('.cmp-pill').forEach(btn => {
            const isActive = btn.dataset.cmpTab === currentCmpTab;
            btn.classList.toggle('active', isActive);
            btn.setAttribute('aria-selected', String(isActive));
        });
        ['manager', 'player', 'whatif'].forEach(t => {
            const panel = document.getElementById('cmp-tab-' + t);
            if (!panel) return;
            const isActive = t === currentCmpTab;
            panel.hidden = !isActive;
            panel.classList.toggle('active', isActive);
        });
        syncTournamentTabUi();
        syncTournamentModeUi();

        // Prefer resolving the target player by ID (canonical identity).
        // Fall back to a name lookup so legacy ?player=<name> URLs and
        // bookmarks keep working.
        let targetPlayer = null;
        if (currentPlayerId) {
            targetPlayer = resolvePlayerIdentity(currentPlayerId, currentPlayerName);
        }
        if (!targetPlayer && currentPlayerName) {
            targetPlayer = getPlayerByName(currentPlayerName);
        }
        if (!targetPlayer && filteredData.length > 0) {
            targetPlayer = filteredData[0];
        }
        if (targetPlayer) {
            currentPlayerId = String(targetPlayer['player.id']);
            currentPlayerName = targetPlayer.Spielername;
        } else {
            currentPlayerId = null;
            currentPlayerName = null;
        }

        if (targetPlayer) {
            showPlayerDetails(targetPlayer);
        } else {
            document.getElementById('detail-view').style.display = 'none';
            document.getElementById('empty-state').style.display = 'block';
            document.getElementById('empty-state').textContent = 'Keine Spieler für diese Filter gefunden.';
        }

        setView(currentView, false);

        // Normalise the URL so legacy ?player=<name> links (or any state
        // restored from history) are rewritten to the canonical
        // ?playerId=<id> form once the player has been resolved.
        updateUrl(false);

        hasRenderedOnce = true;
    }

    function isServerVerifiedCacheInfo(info) {
        return !!(info && info.verifiedFromServer === true && info.stale !== true);
    }

    /* In einer bewusst aktivierten Admin-Vorschau (z. B. CL-Test cl2526)
       liegen fuer das Turnier oft schlicht noch keine Live-Daten vor – das
       ist KEIN Server-/App-Fehler. Analog zu index.html zeigen wir dann
       einen ruhigen Hinweis statt der roten Fehlermeldung. */
    function isPreviewWithoutLiveData() {
        try {
            return !!(APP && typeof APP.isPreviewActive === 'function' && APP.isPreviewActive());
        } catch (_) {
            return false;
        }
    }

    function showPreviewNoDataNotice() {
        const list = document.getElementById('player-list');
        if (list) {
            list.innerHTML = `<div class="list-empty">🔭 Vorschau: Fuer ${escapeHtml(TOURNAMENT_LABEL)} liegen noch keine Live-Daten vor.</div>`;
        }
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
        const list = document.getElementById('player-list');
        if (list) {
            list.innerHTML = `<div class="list-empty" style="color:var(--red-soft);">${escapeHtml(message)}</div>`;
        }
    }

    /* =========================================================
       EVENT LISTENERS
       ========================================================= */
    document.getElementById('btn-view-players').addEventListener('click', () => setView('players', true));
    document.getElementById('btn-view-comparisons').addEventListener('click', () => setView('comparisons', true));
    document.getElementById('btn-view-games').addEventListener('click', () => setView('games', true));
    document.getElementById('btn-view-tournament').addEventListener('click', () => setView('tournament', true));
    document.querySelectorAll('.tour-pill').forEach(btn => {
        btn.addEventListener('click', () => setTournamentTab(btn.dataset.tournamentTab, true));
    });
    document.querySelectorAll('[data-tournament-mode]').forEach(btn => {
        btn.addEventListener('click', () => setTournamentMode(btn.dataset.tournamentMode));
    });
    const tournamentManualResetBtn = document.getElementById('tournament-manual-reset');
    if (tournamentManualResetBtn) {
        tournamentManualResetBtn.addEventListener('click', resetTournamentManualStateToPrediction);
    }
    const tournamentBracketWrap = getTournamentBracketWrap();
    if (tournamentBracketWrap) {
        tournamentBracketWrap.addEventListener('touchstart', startTournamentBracketPinch, { passive: false });
        tournamentBracketWrap.addEventListener('touchmove', moveTournamentBracketPinch, { passive: false });
        tournamentBracketWrap.addEventListener('touchend', finishTournamentBracketPinch, { passive: false });
        tournamentBracketWrap.addEventListener('touchcancel', finishTournamentBracketPinch, { passive: false });
        tournamentBracketWrap.addEventListener('gesturestart', preventTournamentBracketNativeGesture, { passive: false });
        tournamentBracketWrap.addEventListener('gesturechange', preventTournamentBracketNativeGesture, { passive: false });
    }
    window.addEventListener('resize', () => {
        if (currentTournamentTab === 'knockout') syncTournamentBracketZoomMetrics();
    });
    document.addEventListener('pointermove', moveTournamentManualDrag, { passive: false });
    document.addEventListener('pointerup', () => finishTournamentManualDrag(true), { passive: true });
    document.addEventListener('pointercancel', () => finishTournamentManualDrag(false), { passive: true });

    document.getElementById('tile-nation').addEventListener('click', () => {
        const nat = document.getElementById('detail-nation-name').textContent;
        if (nat && nat !== '–' && nat !== '-') {
            document.getElementById('search-input').value = '';
            document.getElementById('pos-filter').value = 'ALL';
            document.getElementById('club-filter').value = 'ALL';
            document.getElementById('nation-filter').value = nat;
            applyFilters();
            jumpToFiltersOnMobile();
            updateUrl(false);
        }
    });

    document.getElementById('tile-nation').addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); document.getElementById('tile-nation').click(); }
    });

    document.getElementById('tile-club').addEventListener('click', () => {
        const club = document.getElementById('detail-club-name').textContent;
        if (club && club !== 'Vereinslos' && club !== '–' && club !== '-') {
            document.getElementById('search-input').value = '';
            document.getElementById('pos-filter').value = 'ALL';
            document.getElementById('nation-filter').value = 'ALL';
            document.getElementById('club-filter').value = club;
            applyFilters();
            jumpToFiltersOnMobile();
            updateUrl(false);
        }
    });

    document.getElementById('tile-club').addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); document.getElementById('tile-club').click(); }
    });

    document.getElementById('search-input').addEventListener('input', () => { applyFilters(); updateUrl(false); });
    document.getElementById('pos-filter').addEventListener('change', () => { applyFilters(); updateUrl(false); });
    document.getElementById('nation-filter').addEventListener('change', () => { applyFilters(); updateUrl(false); });
    document.getElementById('club-filter').addEventListener('change', () => { applyFilters(); updateUrl(false); });

    document.getElementById('reset-filters').addEventListener('click', () => {
        document.getElementById('search-input').value = '';
        document.getElementById('pos-filter').value = 'ALL';
        document.getElementById('nation-filter').value = 'ALL';
        document.getElementById('club-filter').value = 'ALL';
        applyFilters(); updateUrl(false);
    });

    document.getElementById('sort-name').addEventListener('click', () => {
        currentSort = 'name';
        document.getElementById('sort-name').classList.add('active');
        document.getElementById('sort-pts').classList.remove('active');
        applyFilters(); updateUrl(false);
    });

    document.getElementById('sort-pts').addEventListener('click', () => {
        currentSort = 'pts';
        document.getElementById('sort-pts').classList.add('active');
        document.getElementById('sort-name').classList.remove('active');
        applyFilters(); updateUrl(false);
    });

    document.getElementById('schedule-reset-filters').addEventListener('click', () => {
        currentScheduleNationFilter = 'ALL';
        renderScheduleView();
        renderScheduleCountryList();
        updateUrl(false);
        updateMobileFilterButtonLabel();
    });

    document.querySelectorAll('[data-schedule-status-filter]').forEach((btn) => {
        btn.addEventListener('click', () => {
            setScheduleStatusFilter(btn.getAttribute('data-schedule-status-filter'), true);
        });
    });

    document.getElementById('schedule-sort-name').addEventListener('click', () => {
        scheduleNationList.sort((a, b) => a.localeCompare(b, 'de'));
        document.getElementById('schedule-sort-name').classList.add('active');
        document.getElementById('schedule-sort-az').classList.remove('active');
        renderScheduleCountryList();
    });

    document.getElementById('schedule-sort-az').addEventListener('click', () => {
        document.getElementById('schedule-sort-az').classList.add('active');
        document.getElementById('schedule-sort-name').classList.remove('active');
        renderScheduleCountryList();
    });

    document.getElementById('player-list').addEventListener('scroll', () => {
        const list = document.getElementById('player-list');
        playerListScrollTop = list.scrollTop;
        if (list.scrollTop + list.clientHeight >= list.scrollHeight - 80) appendNextPlayerBatch();
    });

    window.addEventListener('resize', () => {
        if (window.innerWidth > 860) closeMobileFilter({ pushHistory: false });
        syncSidebarHeight();
    });

    window.addEventListener('popstate', (event) => {
        if (!hasRenderedOnce) return;
        if (event.state?.dtPopupId === MOBILE_FILTER_POPUP_ID && window.innerWidth <= 860) {
            openMobileFilter({ pushHistory: false, scroll: false });
            return;
        }
        closeMobileFilter({ pushHistory: false });
        applyDataset(
            { points: pointsData, teams: allTeams, fixtures: lastFixtures },
            { preserveCurrentPlayer: false }
        );
    });

    /* =========================================================
       INIT
       ========================================================= */
    function applyAnalysisLockState() {
        document.body.classList.toggle('teams-locked', isTeamsLocked());
    }

    async function init() {
        applyAnalysisLockState();

        // Live-Umschaltung exakt zum DREAMTEAM_START: rerender, damit
        // "Gewählt von …" und Captain-Badges erscheinen, sobald der
        // Anpfiff erreicht ist.
        try {
            if (window.APP_CONFIG && typeof window.APP_CONFIG.onReveal === 'function') {
                window.APP_CONFIG.onReveal(() => {
                    applyAnalysisLockState();
                    if (typeof applyDataset === 'function' && hasRenderedOnce) {
                        // Re-apply current dataset to refresh derived state.
                        const lastData = window.__spaLastData;
                        if (lastData) applyDataset(lastData, { preserveCurrentPlayer: true });
                    }
                });
            }
        } catch (_) { /* ignore */ }

        // Admin-Override: bei Login/Logout des Admin-Accounts neu rendern.
        try {
            if (window.DreamTeamAdmin && typeof window.DreamTeamAdmin.onAdminChange === 'function') {
                window.DreamTeamAdmin.onAdminChange(() => {
                    applyAnalysisLockState();
                    const lastData = window.__spaLastData;
                    if (lastData && hasRenderedOnce && typeof applyDataset === 'function') {
                        applyDataset(lastData, { preserveCurrentPlayer: true });
                    }
                });
            }
        } catch (_) { /* ignore */ }

        try {
            initComparisonsEventsOnce();
            // bootstrap() ersetzt die alte Sequenz `getCachedBundle +
            // loadBundle + subscribeToMeta`. Damit sparen wir einen
            // Meta-Read pro Seitenaufruf, ohne die Live-Aktualität zu
            // verlieren.
            if (!metaUnsubscribe) {
                metaUnsubscribe = await DreamTeamCache.bootstrap({
                    ...CACHE_OPTIONS,
                    // Cached-first: letzter lokaler Stand sofort rendern,
                    // Server-Bestaetigung laeuft im Hintergrund (Pill unten).
                    renderCached: true,
                    onCachedReady: (data, info) => {
                        if (isServerVerifiedCacheInfo(info)) {
                            markServerVerified();
                            applyDataset(data, { preserveCurrentPlayer: false });
                            return;
                        }
                        if (cachedBundleHasContent(data)) {
                            try {
                                applyDataset(data, { preserveCurrentPlayer: false });
                                showSyncIndicator();
                            } catch (err) {
                                console.warn('[spieleranalyse] Cached-Render fehlgeschlagen:', err);
                            }
                        }
                        startFreshnessEscalation(() => {
                            if (hasRenderedOnce) {
                                showStaleNotice('Warte auf Serverbestaetigung …');
                            } else if (isPreviewWithoutLiveData()) {
                                hideSyncIndicator();
                                showPreviewNoDataNotice();
                            } else {
                                hideSyncIndicator();
                                showFreshnessError(`Spieleranalyse fuer ${TOURNAMENT_LABEL} wartet auf frische Serverdaten.`);
                            }
                        });
                    },
                    onUpdate: (data, info) => {
                        if (!isServerVerifiedCacheInfo(info)) {
                            if (hasRenderedOnce) {
                                showStaleNotice('Offline – angezeigt wird der letzte lokale Stand.');
                            } else if (isPreviewWithoutLiveData()) {
                                hideSyncIndicator();
                                showPreviewNoDataNotice();
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
                            applyDataset(data, { preserveCurrentPlayer: hasRenderedOnce });
                        } finally {
                            isMetaRefreshRunning = false;
                        }
                    },
                    onError: (err) => {
                        console.error('Meta-Listener Fehler:', err);
                        if (hasRenderedOnce) {
                            // Inhalt ist sichtbar → nicht-destruktiver Hinweis
                            // statt Ersetzen der Spielerliste.
                            showStaleNotice(isPreviewWithoutLiveData()
                                ? 'Vorschau: keine Live-Daten – letzter lokaler Stand.'
                                : 'Aktualisierung fehlgeschlagen – letzter lokaler Stand.');
                            return;
                        }
                        hideSyncIndicator();
                        if (isPreviewWithoutLiveData()) {
                            showPreviewNoDataNotice();
                            return;
                        }
                        showFreshnessError('Aktuelle Analyse-Daten konnten nicht vom Server geladen werden.');
                        document.getElementById('player-list').innerHTML = '<div class="list-empty" style="color:var(--red-soft);">Fehler beim Laden.</div>';
                    }
                });
            }
        } catch (e) {
            console.error(e);
            if (hasRenderedOnce) {
                showStaleNotice('Aktualisierung fehlgeschlagen – letzter lokaler Stand.');
            } else if (isPreviewWithoutLiveData()) {
                showPreviewNoDataNotice();
            } else {
                showFreshnessError('Aktuelle Analyse-Daten konnten nicht vom Server geladen werden.');
                document.getElementById('player-list').innerHTML = '<div class="list-empty" style="color:var(--red-soft);">Fehler beim Laden.</div>';
            }
        }
    }

    window.addEventListener('DOMContentLoaded', init);

    window.addEventListener('beforeunload', () => {
        if (typeof metaUnsubscribe === 'function') metaUnsubscribe();
    });
