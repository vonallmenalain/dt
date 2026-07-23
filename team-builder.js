/* team-builder.js – Haupt-Seitenskript, aus team-builder.html extrahiert (Performance Phase 2).
   Wird als klassisches Skript an unveraenderter Position am Body-Ende geladen –
   die Ausfuehrungs-Reihenfolge relativ zu den uebrigen Skripten ist identisch. */

(function () {
    'use strict';

    /* =========================================================
       CONFIG & CONSTANTS
       ========================================================= */
    const APP = window.APP_CONFIG;
    if (!APP) throw new Error('APP_CONFIG fehlt.');

    // Captain-Feature: WM ja, CL nein (siehe tournament-config.js). Bei
    // deaktiviertem Captain entfällt die Captain-Wahl komplett (kein Knopf,
    // keine Pflicht, kein isCaptain im gespeicherten Team, kein ×2).
    const CAPTAIN_ENABLED = !(APP && APP.captainEnabled === false);

    const sourcePlayers =
        (typeof playersData !== 'undefined' && Array.isArray(playersData)) ? playersData : [];
    if (!sourcePlayers.length) throw new Error('playersData fehlt oder ist leer.');

    const TOURNAMENT_YEAR      = APP.year;
    const TOURNAMENT_LABEL     = APP.tournamentLabel;
    const PAGE_TITLE_PREFIX    = APP.pageTitlePrefix;
    const TEAMS_COLLECTION     = APP.firestore.teamsCollection();
    const META_COLLECTION      = APP.firestore.metaCollection || 'app_meta';
    const META_DOC_ID          = APP.firestore.metaDocId();
    const BUILDER_CACHE_KEY    = APP.storage.builderCacheKey();
    const SESSION_DATA_KEY     = APP.storage.key('data_cache');
    const CARD_BASE_TRANSFORM  = 'perspective(1000px) rotateX(0deg) rotateY(0deg) scale3d(1, 1, 1)';
    const PICKER_BATCH_SIZE    = 20;

    // Einmal-Migration historischer Keys auf das aktuelle
    // turnier-namespacete Naming. Danach werden weder
    // `dreamCache<YY>` noch `dreamteam_data_cache_<YYYY>` jemals
    // wieder gelesen oder geschrieben.
    APP.storage.migrate('builder_cache', 'dreamCache' + String(TOURNAMENT_YEAR).substring(2));
    APP.storage.migrate('data_cache', 'dreamteam_data_cache_' + TOURNAMENT_YEAR, { storage: 'session' });

    const db = APP.getDb();
    document.title = `${PAGE_TITLE_PREFIX} - Builder`;

    /* Update hero tournament label */
    const heroLabelEl = document.getElementById('hero-tournament-label');
    if (heroLabelEl) heroLabelEl.textContent = APP.shortLabel || 'DreamTeam';

    /* Primär-Entität des Turniers: WM ist nations-, die CL club-zentriert
       (siehe primaryEntity in tournament-config.js). Die „1 pro X"-Regel und
       die zugehörigen Labels heissen daher bei der CL „Club" statt „Nation". */
    function primaryEntityNoun() {
        return (window.APP_CONFIG && window.APP_CONFIG.primaryEntity === 'club') ? 'Club' : 'Nation';
    }
    function primaryEntityNounPlural() {
        return (window.APP_CONFIG && window.APP_CONFIG.primaryEntity === 'club') ? 'Clubs' : 'Nationen';
    }

    (function applyEntityLabels() {
        const isClub = (window.APP_CONFIG && window.APP_CONFIG.primaryEntity === 'club');
        const ruleNoun = document.getElementById('entity-rule-noun');
        if (ruleNoun) ruleNoun.textContent = primaryEntityNoun();

        const flags = document.getElementById('dsb-nations-flags');
        if (flags) flags.setAttribute('aria-label', `Gewählte ${primaryEntityNounPlural()}`);

        const filterSelect = document.getElementById('picker-nation-filter');
        if (filterSelect) filterSelect.setAttribute('aria-label', `Nach ${primaryEntityNoun()} filtern`);
        const filterAll = document.getElementById('picker-nation-filter-all');
        if (filterAll) filterAll.textContent = isClub ? '🌍 Alle Clubs' : '🌍 Alle Länder';

        // Sucht-Placeholder ohne „Land"-Wording in der CL.
        const search = document.getElementById('picker-search');
        if (search && isClub) search.setAttribute('placeholder', '🔍 Spieler oder Club suchen…');

        // Ohne Captain-Feature (CL) den „· 1 Captain"-Hinweis ausblenden.
        const capRule = document.getElementById('hero-captain-rule');
        if (capRule && !CAPTAIN_ENABLED) capRule.style.display = 'none';
    })();

    /* =========================================================
       SLOT DEFINITIONS
       ========================================================= */
    const finalSlots = [
        { id: '0',  pos: 'GOALKEEPER', cont: 'row-GOALKEEPER', label: 'Tor' },
        { id: '1',  pos: 'DEFENDER',   cont: 'row-DEFENDER',   label: 'Verteidigung' },
        { id: '2',  pos: 'DEFENDER',   cont: 'row-DEFENDER',   label: 'Verteidigung' },
        { id: '3',  pos: 'DEFENDER',   cont: 'row-DEFENDER',   label: 'Verteidigung' },
        { id: '4',  pos: 'MIDFIELDER', cont: 'row-MIDFIELDER', label: 'Mittelfeld' },
        { id: '5',  pos: 'MIDFIELDER', cont: 'row-MIDFIELDER', label: 'Mittelfeld' },
        { id: '6',  pos: 'MIDFIELDER', cont: 'row-MIDFIELDER', label: 'Mittelfeld' },
        { id: '7',  pos: 'MIDFIELDER', cont: 'row-MIDFIELDER', label: 'Mittelfeld' },
        { id: '8',  pos: 'ATTACKER',   cont: 'row-ATTACKER',   label: 'Sturm' },
        { id: '9',  pos: 'ATTACKER',   cont: 'row-ATTACKER',   label: 'Sturm' },
        { id: '10', pos: 'ATTACKER',   cont: 'row-ATTACKER',   label: 'Sturm' },
        { id: '11', pos: 'GOALKEEPER', cont: 'bench-slots',    label: 'Tor' },
        { id: '12', pos: 'DEFENDER',   cont: 'bench-slots',    label: 'Verteidigung' },
        { id: '13', pos: 'MIDFIELDER', cont: 'bench-slots',    label: 'Mittelfeld' },
        { id: '14', pos: 'ATTACKER',   cont: 'bench-slots',    label: 'Sturm' }
    ];

    const POSITION_LABELS = {
        GOALKEEPER: 'Tor',
        DEFENDER:   'Verteidigung',
        MIDFIELDER: 'Mittelfeld',
        ATTACKER:   'Sturm'
    };

    const POSITION_ICONS = {
        GOALKEEPER: '🧤',
        DEFENDER:   '🛡️',
        MIDFIELDER: '⚙️',
        ATTACKER:   '⚡'
    };

    /* Mobile position groups (pitch + bench) */
    const MOBILE_GROUPS = [
        {
            pos: 'GOALKEEPER', label: 'Torwart',
            slots: ['0'], benchSlots: ['11']
        },
        {
            pos: 'DEFENDER', label: 'Verteidigung',
            slots: ['1','2','3'], benchSlots: ['12']
        },
        {
            pos: 'MIDFIELDER', label: 'Mittelfeld',
            slots: ['4','5','6','7'], benchSlots: ['13']
        },
        {
            pos: 'ATTACKER', label: 'Sturm',
            slots: ['8','9','10'], benchSlots: ['14']
        }
    ];

    /* =========================================================
       PLAYER DATA PREP
       ========================================================= */
    function normalizePosition(pos) {
        const u = String(pos || '').trim().toUpperCase();
        if (!u) return '';
        if (u === 'FORWARD' || u === 'FW' || u === 'STÜRMER' || u === 'STUERMER') return 'ATTACKER';
        if (u === 'GOALKEEPER' || u === 'GK' || u === 'TORWART') return 'GOALKEEPER';
        if (u === 'DEFENDER' || u === 'DF' || u === 'VERTEIDIGER') return 'DEFENDER';
        if (u === 'MIDFIELDER' || u === 'MF' || u === 'MITTELFELD') return 'MIDFIELDER';
        return u;
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

    function searchTermMatches(haystack, needle) {
        if (!needle) return true;
        const tokens = normalizeSearchText(needle).split(/\s+/).filter(Boolean);
        if (!tokens.length) return true;
        const text = typeof haystack === 'string' ? haystack : normalizeSearchText(haystack);
        return tokens.every(tok => text.includes(tok));
    }

    const preparedPlayers = sourcePlayers.map((p, idx) => ({
        raw:       p,
        id:        String(p['player.id']),
        name:      p.Spielername || 'Unbekannt',
        photo:     p.Spielerfoto || '',
        position:  normalizePosition(p.Position),
        nation:    p['Nationalteam.name'] || '?',
        flag:      p['Nationalteam.logo'] || '',
        club:      p['Club.name'] || 'Vereinslos',
        clubLogo:  p['Club.logo'] || '',
        sortKey:   `${p['Nationalteam.name'] || ''} ${p.Spielername || ''}`.toLowerCase(),
        /* Suche auch über deutsche Länderaliasse (z. B. „Schweiz“ → Switzerland)
           ermöglichen, indem die Aliase aus country-aliases.js angehängt werden. */
        searchKey: normalizeSearchText(`${p.Spielername || ''} ${p['Nationalteam.name'] || ''} ${p['Club.name'] || ''} ${(typeof getCountrySearchAliases === 'function' ? getCountrySearchAliases(p['Nationalteam.name']) : '')}`),
        _idx:      idx
    }));

    const playerById = new Map(preparedPlayers.map(p => [p.id, p]));
    const allNations = [...new Set(preparedPlayers.map(p => p.nation).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'de'));

    /* =========================================================
       STATE
       ========================================================= */
    let selectedTeam       = {};
    let selectedCaptainId  = null;
    let currentEditingSlotId = null;

    let pickerFilteredPlayers = [];
    let pickerRenderedCount   = 0;
    let isSubmitting          = false;
    let feedbackTimer         = null;
    let pendingBuilderNotice  = '';

    /* Globaler Admin-Schalter "Nachzügler-Einreichung erlauben". Wird aus
       dem Meta-Dokument (Firestore) gelesen (siehe subscribeLateSubmitFlag)
       und gilt für ALLE Nutzer. Default konservativ `false` (= gesperrt),
       bis die Firestore-Antwort da ist – die Sperre schlägt also im
       Zweifel zu, nie in die andere Richtung. */
    let lateSubmitOpen        = false;

    /* Mobile filter chip state */
    let mobileFilterOnlyAvailable = false;
    let mobileFilterHideInvalid   = false;
    let mobileFilterNation        = 'ALL';

    let nextSlotActionTimer = null;
    let isFirstSlotRender   = true;

    /* =========================================================
       DOM REFERENCES
       ========================================================= */
    const dom = {
        clearTeamBtn:         document.getElementById('clear-team-btn'),
        managerName:          document.getElementById('manager-name'),
        submitBtn:            document.getElementById('submit-btn'),
        submitCard:           document.getElementById('submit-card'),
        nameWarning:          document.getElementById('name-warning'),
        duplicateWarning:     document.getElementById('duplicate-warning'),
        captainWarning:       document.getElementById('captain-warning'),
        builderNotice:        document.getElementById('builder-notice'),
        builderNoticeInner:   document.getElementById('builder-notice-inner'),
        pickerHost:           document.getElementById('picker-host'),
        pickerCard:           document.getElementById('picker-card'),
        pickerTitle:          document.getElementById('picker-title'),
        pickerSubtitle:       document.getElementById('picker-subtitle'),
        pickerSearch:         document.getElementById('picker-search'),
        clearPickerSearch:    document.getElementById('clear-picker-search'),
        clearAllPickerFilters:document.getElementById('clear-all-picker-filters'),
        pickerNationFilter:   document.getElementById('picker-nation-filter'),
        clearPickerFilters:   document.getElementById('clear-picker-filters'),
        pickerResultCount:    document.getElementById('picker-result-count'),
        pickerEmptyState:     document.getElementById('picker-empty-state'),
        pickerResults:        document.getElementById('picker-results'),
        pickerList:           document.getElementById('picker-list'),
        pickerCloseBtn:       document.getElementById('picker-close-btn'),
        pickerFilterChips:    document.getElementById('picker-filter-chips'),
        pickerNextSlotBar:    document.getElementById('picker-next-slot-bar'),
        pickerNextSlotLabel:  document.getElementById('picker-next-slot-label'),
        pitchContainer:       document.getElementById('pitch-container'),
        benchContainer:       document.getElementById('bench-slots'),
        mobileFeedback:       document.getElementById('mobile-feedback'),
        mobileBuilder:        document.getElementById('mobile-builder'),
        dsbPlayersPill:       document.getElementById('dsb-players-pill'),
        dsbCaptainPill:       document.getElementById('dsb-captain-pill'),
        dsbNationsPill:       document.getElementById('dsb-nations-pill'),
        dsbNationsFlags:      document.getElementById('dsb-nations-flags'),
        dsbProgressFill:      document.getElementById('dsb-progress-fill'),
        dsbProgressLabel:     document.getElementById('dsb-progress-label'),
        submitProgressFill:   document.getElementById('submit-progress-fill'),
        submitProgressLabel:  document.getElementById('submit-progress-label'),
        submitHints:          document.getElementById('submit-hints'),
        nextSlotAction:       document.getElementById('next-slot-action')
    };

    /* =========================================================
       UTILITIES
       ========================================================= */
    function escapeHtml(v) {
        return String(v ?? '')
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#039;');
    }

    function isMobileView() {
        return window.innerWidth <= 900;
    }

    function isDesktopHover() {
        return window.matchMedia('(hover: hover) and (pointer: fine)').matches;
    }

    function prefersReducedMotion() {
        return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    }

    function isValidSlotId(slotId) {
        return finalSlots.some(s => String(s.id) === String(slotId));
    }

    function getSlotConfig(slotId) {
        return finalSlots.find(s => s.id === String(slotId)) || null;
    }

    function getPlayerById(playerId) {
        return playerById.get(String(playerId)) || null;
    }

    function getPlayerByStoredSnapshot(savedPlayer) {
        if (!savedPlayer || !savedPlayer.name) return null;
        return preparedPlayers.find(player => {
            if (player.name !== savedPlayer.name) return false;
            return !savedPlayer.nation || player.nation === savedPlayer.nation;
        }) || null;
    }

    function resolveSavedPlayer(savedPlayer) {
        const byId = getPlayerById(savedPlayer && savedPlayer.playerId);
        if (byId && (!savedPlayer || !savedPlayer.name || byId.name === savedPlayer.name)) return byId;
        return getPlayerByStoredSnapshot(savedPlayer) || byId;
    }

    function getSlotPlayerId(slotId) {
        return selectedTeam[String(slotId)] ? String(selectedTeam[String(slotId)]) : null;
    }

    function getSelectedNationNames(excludeSlotId = null) {
        const nations = new Set();
        Object.entries(selectedTeam).forEach(([slotId, playerId]) => {
            if (excludeSlotId !== null && String(slotId) === String(excludeSlotId)) return;
            const player = getPlayerById(playerId);
            if (player && player.nation) nations.add(player.nation);
        });
        return nations;
    }

    function isNationTakenByOtherSlot(nation, excludeSlotId = null) {
        return getSelectedNationNames(excludeSlotId).has(nation);
    }

    function isPlayerSelectedElsewhere(playerId, excludeSlotId = null) {
        return Object.entries(selectedTeam).some(([slotId, selectedPlayerId]) => {
            if (excludeSlotId !== null && String(slotId) === String(excludeSlotId)) return false;
            return String(selectedPlayerId) === String(playerId);
        });
    }

    function getFirstAvailableSlotId() {
        const first = finalSlots.find(s => !selectedTeam[s.id]);
        return first ? first.id : finalSlots[0].id;
    }

    function getRequiredPositionForCurrentSlot() {
        const slot = getSlotConfig(currentEditingSlotId);
        return slot ? slot.pos : null;
    }

    function translatePosition(pos) {
        return POSITION_LABELS[normalizePosition(pos)] || pos || 'Spieler';
    }

    /* =========================================================
       MOBILE PICKER
       ========================================================= */
    function openMobilePicker() {
        if (!isMobileView()) return;
        dom.pickerHost.classList.add('mobile-open');
        document.body.classList.add('mobile-picker-open');
    }

    function closeMobilePicker() {
        dom.pickerHost.classList.remove('mobile-open');
        document.body.classList.remove('mobile-picker-open');
        /* Hide next-slot bar when closing */
        if (dom.pickerNextSlotBar) dom.pickerNextSlotBar.classList.remove('visible');
    }
    const MOBILE_PICKER_POPUP_ID = 'team-builder-mobile-picker';
    function isMobilePickerOpen() {
        return !!dom.pickerHost?.classList.contains('mobile-open');
    }
    function pushMobilePickerState(dtPopupId) {
        window.history.pushState({
            ...(window.history.state && typeof window.history.state === 'object' ? window.history.state : {}),
            dtPopupId,
            currentEditingSlotId
        }, '', window.location.href);
    }
    function openMobilePickerWithHistory(options = {}) {
        const { pushHistory = true } = options;
        const wasOpen = isMobilePickerOpen();
        openMobilePicker();
        if (pushHistory && isMobileView() && (!wasOpen || window.history.state?.dtPopupId !== MOBILE_PICKER_POPUP_ID)) {
            pushMobilePickerState(MOBILE_PICKER_POPUP_ID);
        }
    }
    function closeMobilePickerWithHistory(options = {}) {
        const { pushHistory = true } = options;
        const wasOpen = isMobilePickerOpen();
        closeMobilePicker();
        if (pushHistory && wasOpen && window.history.state?.dtPopupId === MOBILE_PICKER_POPUP_ID) {
            pushMobilePickerState(null);
        }
    }

    /* =========================================================
       MOBILE FILTER CHIPS
       ========================================================= */
    function getMobileFilterNationLabel() {
        if (mobileFilterNation === 'ALL') return null;
        return mobileFilterNation;
    }

    function renderMobileFilterChips() {
        if (!dom.pickerFilterChips) return;

        const selectedNations = getSelectedNationNames(currentEditingSlotId);
        const nationChips = allNations.map(n => {
            const isTaken = selectedNations.has(n);
            const isActive = mobileFilterNation === n;
            return {
                id: 'nation:' + n,
                label: (isTaken ? '🔴 ' : '') + n,
                active: isActive,
                cls: isActive ? 'active-nation' : ''
            };
        });

        const chips = [
            {
                id: 'available',
                label: mobileFilterOnlyAvailable ? '✓ Nur verfügbar' : 'Nur verfügbar',
                active: mobileFilterOnlyAvailable,
                cls: mobileFilterOnlyAvailable ? 'active' : ''
            },
            {
                id: 'hideinvalid',
                label: mobileFilterHideInvalid ? '✓ Ungültige aus.' : 'Ungültige ausbl.',
                active: mobileFilterHideInvalid,
                cls: mobileFilterHideInvalid ? 'active' : ''
            },
            ...nationChips
        ];

        /* Add reset chip at end if any filter is active */
        const anyActive = mobileFilterOnlyAvailable || mobileFilterHideInvalid || mobileFilterNation !== 'ALL' || (dom.pickerSearch && dom.pickerSearch.value.trim());
        if (anyActive) {
            chips.push({ id: 'reset', label: '✖ Reset', active: false, cls: 'reset-chip' });
        }

        dom.pickerFilterChips.innerHTML = chips.map(c => {
            return `<div class="filter-chip ${c.cls}" data-chip-id="${escapeHtml(c.id)}" role="button" tabindex="0" aria-pressed="${c.active}">${escapeHtml(c.label)}</div>`;
        }).join('');
    }

    function handleMobileFilterChipClick(chipId) {
        if (!chipId) return;

        if (chipId === 'available') {
            mobileFilterOnlyAvailable = !mobileFilterOnlyAvailable;
        } else if (chipId === 'hideinvalid') {
            mobileFilterHideInvalid = !mobileFilterHideInvalid;
        } else if (chipId === 'reset') {
            mobileFilterOnlyAvailable = false;
            mobileFilterHideInvalid   = false;
            mobileFilterNation        = 'ALL';
            if (dom.pickerSearch) dom.pickerSearch.value = '';
            updateSearchClearButton();
        } else if (chipId.startsWith('nation:')) {
            const nation = chipId.slice(7);
            mobileFilterNation = (mobileFilterNation === nation) ? 'ALL' : nation;
        }

        renderMobileFilterChips();
        renderPickerPlayers(true);
    }

    function clearAllPickerFilters() {
        mobileFilterOnlyAvailable = false;
        mobileFilterHideInvalid   = false;
        mobileFilterNation        = 'ALL';
        if (dom.pickerNationFilter) dom.pickerNationFilter.value = 'ALL';
        if (dom.pickerSearch) dom.pickerSearch.value = '';
        updateSearchClearButton();
        renderMobileFilterChips();
        renderPickerPlayers(true);
    }

    /* =========================================================
       NEXT-SLOT SUGGESTION (Mobile)
       ========================================================= */
    function getNextFreeSlot(afterSlotId) {
        const idx = finalSlots.findIndex(s => s.id === String(afterSlotId));
        if (idx < 0) return null;
        /* Search from next slot onwards, then wrap */
        for (let i = 1; i < finalSlots.length; i++) {
            const s = finalSlots[(idx + i) % finalSlots.length];
            if (!selectedTeam[s.id]) return s;
        }
        return null;
    }

    /* Like getNextFreeSlot, but prefers an empty slot in the same position
       group (e.g. fill all four midfielders in sequence before jumping
       elsewhere). Falls back to the regular next free slot if no same-pos
       slot is empty. Used to auto-advance the picker on desktop so that
       picking several players in a row does not overwrite the current
       slot. */
    function getNextFreeSlotPreferringSamePosition(afterSlotId) {
        const cur = getSlotConfig(afterSlotId);
        const idx = finalSlots.findIndex(s => s.id === String(afterSlotId));
        if (idx < 0) return getNextFreeSlot(afterSlotId);
        if (cur) {
            for (let i = 1; i < finalSlots.length; i++) {
                const s = finalSlots[(idx + i) % finalSlots.length];
                if (s.pos === cur.pos && !selectedTeam[s.id]) return s;
            }
        }
        return getNextFreeSlot(afterSlotId);
    }

    function updateNextSlotBar(justFilledSlotId) {
        if (!dom.pickerNextSlotBar || !dom.pickerNextSlotLabel) return;
        if (!isMobileView()) return;

        const nextSlot = getNextFreeSlot(justFilledSlotId);
        if (!nextSlot) {
            dom.pickerNextSlotBar.classList.remove('visible');
            return;
        }

        const icon = POSITION_ICONS[nextSlot.pos] || '⚽';
        const isBench = nextSlot.cont === 'bench-slots';
        const label = {
            GOALKEEPER: 'Torwart',
            DEFENDER:   'Verteidiger',
            MIDFIELDER: 'Mittelfeld',
            ATTACKER:   'Stürmer'
        }[nextSlot.pos] || nextSlot.label;

        dom.pickerNextSlotLabel.textContent = `${icon} Nächster freier Slot: ${label}${isBench ? ' (Bank)' : ''}`;
        dom.pickerNextSlotBar.dataset.nextSlotId = nextSlot.id;
        dom.pickerNextSlotBar.classList.add('visible');
    }

    function showNextSlotAction(afterSlotId) {
        if (!dom.nextSlotAction || !isMobileView()) return;
        const nextSlot = getNextFreeSlot(afterSlotId);

        clearTimeout(nextSlotActionTimer);
        dom.nextSlotAction.classList.remove('visible');

        if (!nextSlot) return;

        const icon = POSITION_ICONS[nextSlot.pos] || '⚽';
        const isBench = nextSlot.cont === 'bench-slots';
        const label = { GOALKEEPER: 'Torwart', DEFENDER: 'Verteidiger', MIDFIELDER: 'Mittelfeld', ATTACKER: 'Stürmer' }[nextSlot.pos] || nextSlot.label;
        dom.nextSlotAction.textContent = `${icon} Nächsten Slot wählen: ${label}${isBench ? ' (Bank)' : ''} →`;
        dom.nextSlotAction.dataset.nextSlotId = nextSlot.id;
        dom.nextSlotAction.style.display = '';

        requestAnimationFrame(() => {
            dom.nextSlotAction.classList.add('visible');
        });

        /* Auto-hide after 3.5 s */
        nextSlotActionTimer = setTimeout(() => {
            dom.nextSlotAction.classList.remove('visible');
        }, 3500);
    }

    /* =========================================================
       TOAST FEEDBACK
       ========================================================= */
    function showToast(message, type = '') {
        if (!message) return;
        clearTimeout(feedbackTimer);
        dom.mobileFeedback.textContent = message;
        dom.mobileFeedback.className = 'mobile-feedback visible' + (type ? ' ' + type + '-toast' : '');
        feedbackTimer = setTimeout(() => {
            dom.mobileFeedback.classList.remove('visible');
        }, 2200);
    }

    /* =========================================================
       BUILDER NOTICE
       ========================================================= */
    function showBuilderNotice(message, type = '') {
        if (!message) {
            dom.builderNotice.classList.remove('visible', 'roster-warning');
            if (dom.builderNoticeInner) dom.builderNoticeInner.textContent = '';
            return;
        }
        if (dom.builderNoticeInner) dom.builderNoticeInner.textContent = message;
        dom.builderNotice.classList.remove('roster-warning');
        if (type) dom.builderNotice.classList.add(type);
        dom.builderNotice.classList.add('visible');
    }

    function hideBuilderNotice() {
        dom.builderNotice.classList.remove('visible', 'roster-warning');
        if (dom.builderNoticeInner) dom.builderNoticeInner.textContent = '';
    }

    function getSelectedOrphanPlayers() {
        return Object.values(selectedTeam)
            .map(playerId => getPlayerById(playerId))
            .filter(player => player && player.isOrphan);
    }

    function formatOrphanNames(players) {
        const names = (players || []).map(player => player && player.name).filter(Boolean);
        if (!names.length) return '';
        const visibleNames = names.slice(0, 4).join(', ');
        const remaining = names.length - 4;
        return remaining > 0 ? `${visibleNames} und ${remaining} weitere` : visibleNames;
    }

    function buildRosterNotice(orphanPlayers) {
        const count = orphanPlayers.length;
        if (!count) return '';
        const names = formatOrphanNames(orphanPlayers);
        const detail = names ? ` (${names})` : '';
        const captainHint = orphanPlayers.some(player => String(player.id) === String(selectedCaptainId))
            ? ' Dein Captain ist betroffen; bitte ersetze ihn und setze danach einen neuen Captain.'
            : '';
        return `Achtung: ${count} Spieler aus deinem Team ${count === 1 ? 'steht' : 'stehen'} nicht im aktuellen WM-Kader${detail}. Bitte ersetze ${count === 1 ? 'diesen Spieler' : 'diese Spieler'}, bevor du dein Team speicherst.${captainHint}`;
    }

    function refreshRosterNotice(orphanPlayers = getSelectedOrphanPlayers()) {
        if (orphanPlayers.length) {
            showBuilderNotice(buildRosterNotice(orphanPlayers), 'roster-warning');
            return;
        }
        if (dom.builderNotice && dom.builderNotice.classList.contains('roster-warning')) {
            hideBuilderNotice();
        }
    }

    /* =========================================================
       DRAFT STATUS BAR UPDATE
       ========================================================= */
    function updateStatusBar() {
        const count = Object.keys(selectedTeam).length;
        const teamPlayerIds = Object.values(selectedTeam).map(String);
        const orphanPlayers = getSelectedOrphanPlayers();
        const orphanCount = orphanPlayers.length;
        const captainPlayer = selectedCaptainId !== null ? getPlayerById(selectedCaptainId) : null;
        const hasValidCaptain = !CAPTAIN_ENABLED || (selectedCaptainId !== null
            && teamPlayerIds.includes(String(selectedCaptainId))
            && !!(captainPlayer && !captainPlayer.isOrphan));

        /* Progress */
        const pct = Math.round((count / 15) * 100);
        if (dom.dsbProgressFill) dom.dsbProgressFill.style.width = pct + '%';
        if (dom.dsbProgressLabel) dom.dsbProgressLabel.textContent = pct + '%';
        if (dom.submitProgressFill) dom.submitProgressFill.style.width = pct + '%';
        if (dom.submitProgressLabel) dom.submitProgressLabel.textContent = `${count} / 15`;

        /* Players pill */
        if (dom.dsbPlayersPill) {
            dom.dsbPlayersPill.textContent = orphanCount
                ? `${count} / 15 gewählt · ${orphanCount} ersetzen`
                : `${count} / 15 gewählt`;
            dom.dsbPlayersPill.className = `dsb-pill ${orphanCount ? 'roster-warning' : 'players'}`;
        }

        /* Captain pill – bei Turnieren ohne Captain (CL) komplett ausblenden. */
        if (dom.dsbCaptainPill) {
            if (!CAPTAIN_ENABLED) {
                dom.dsbCaptainPill.style.display = 'none';
            } else if (hasValidCaptain) {
                dom.dsbCaptainPill.textContent = captainPlayer ? `👑 ${captainPlayer.name}` : '👑 Captain gewählt';
                dom.dsbCaptainPill.className = 'dsb-pill captain-ok';
            } else {
                dom.dsbCaptainPill.textContent = '👑 Captain fehlt';
                dom.dsbCaptainPill.className = 'dsb-pill captain-missing';
            }
        }

        /* Nations flags */
        if (dom.dsbNationsFlags) {
            const selectedNations = getSelectedNationNames();
            if (selectedNations.size === 0) {
                dom.dsbNationsFlags.innerHTML = '';
            } else {
                const html = Array.from(selectedNations).map(nation => {
                    const p = preparedPlayers.find(pl => pl.nation === nation);
                    return p && p.flag
                        ? `<img class="dsb-flag" src="${escapeHtml(p.flag)}" alt="${escapeHtml(nation)}" title="${escapeHtml(nation)}" loading="lazy">`
                        : `<span title="${escapeHtml(nation)}" style="font-size:12px;">🏳️</span>`;
                }).join('');
                dom.dsbNationsFlags.innerHTML = html;
            }
        }

        /* Submit hints */
        updateSubmitHints(count, hasValidCaptain, orphanCount);
        refreshRosterNotice(orphanPlayers);

        /* Submit card ready state */
        const nameInput = dom.managerName ? dom.managerName.value.trim() : '';
        const words = nameInput.split(' ').filter(w => w.length > 0);
        const isFullName = words.length >= 2;
        const isReady = count === 15 && isFullName && hasValidCaptain && orphanCount === 0;
        if (dom.submitCard) {
            dom.submitCard.classList.toggle('ready', isReady);
        }
    }

    function updateSubmitHints(count, hasValidCaptain, orphanCount = 0) {
        if (!dom.submitHints) return;
        const hints = [];
        const remaining = 15 - count;

        if (count === 15) {
            hints.push({ text: '✓ 15 Spieler gewählt', cls: 'ok' });
        } else {
            hints.push({ text: `${remaining} Slot${remaining !== 1 ? 's' : ''} noch offen`, cls: remaining > 0 ? 'warn' : 'ok' });
        }

        if (CAPTAIN_ENABLED) {
            if (hasValidCaptain) {
                const cap = getPlayerById(selectedCaptainId);
                hints.push({ text: `✓ Captain: ${cap ? cap.name : 'gesetzt'}`, cls: 'ok' });
            } else if (count === 15) {
                hints.push({ text: '⚠️ Captain fehlt', cls: 'warn' });
            }
        }

        if (orphanCount > 0) {
            hints.push({ text: `⚠ ${orphanCount} nicht aufgeboten`, cls: 'error' });
        }

        dom.submitHints.innerHTML = hints
            .map(h => `<span class="submit-hint-pill ${h.cls}">${escapeHtml(h.text)}</span>`)
            .join('');
    }

    /* =========================================================
       NATION FILTER DROPDOWN
       ========================================================= */
    function renderNationFilterOptions() {
        const currentValue = dom.pickerNationFilter.value || 'ALL';
        const selectedNations = getSelectedNationNames();

        const allOptionLabel = (window.APP_CONFIG && window.APP_CONFIG.primaryEntity === 'club')
            ? '🌍 Alle Clubs'
            : '🌍 Alle Länder';
        dom.pickerNationFilter.innerHTML = `<option value="ALL">${allOptionLabel}</option>` +
            allNations.map(nation => {
                const prefix = selectedNations.has(nation) ? '🔴 ' : '';
                return `<option value="${escapeHtml(nation)}">${prefix}${escapeHtml(nation)}</option>`;
            }).join('');

        const hasCurrent = Array.from(dom.pickerNationFilter.options).some(o => o.value === currentValue);
        dom.pickerNationFilter.value = hasCurrent ? currentValue : 'ALL';
    }

    function updateSearchClearButton() {
        if (!dom.clearPickerSearch) return;
        const hasText = dom.pickerSearch && dom.pickerSearch.value.trim().length > 0;
        dom.clearPickerSearch.classList.toggle('visible', hasText);
        if (dom.clearAllPickerFilters) {
            const anyFilterActive = hasText || mobileFilterOnlyAvailable || mobileFilterHideInvalid || mobileFilterNation !== 'ALL';
            dom.clearAllPickerFilters.classList.toggle('visible', anyFilterActive);
        }
    }

    /* =========================================================
       PLAYER CARD HTML (Desktop Pitch/Bench)
       ========================================================= */
    function buildSelectedCardHTML(slot, player) {
        const isCaptain = String(player.id) === String(selectedCaptainId);
        const isActive  = String(slot.id) === String(currentEditingSlotId);
        const isOrphan  = !!player.isOrphan;

        // Captain-Knopf nur bei Turnieren mit Captain-Feature (WM), nicht CL.
        const captainBtn = CAPTAIN_ENABLED
            ? `<button type="button"
                        class="builder-captain-btn${isCaptain ? ' active' : ''}"
                        title="${isCaptain ? 'Dein Captain!' : 'Zum Captain ernennen'}"
                        data-action="set-captain"
                        data-player-id="${escapeHtml(player.id)}"
                        aria-label="${isCaptain ? 'Captain: ' : 'Captain ernennen: '}${escapeHtml(player.name)}">C</button>`
            : '';

        // „T"-Badge oben links für in dieser Transfer-Session neu geholte
        // Spieler (nur wenn ohne Captain, sonst belegt „C" die linke Ecke).
        const transferBadge = (!CAPTAIN_ENABLED && isBuilderTransferIn(player.id))
            ? `<div class="builder-transfer-badge" title="In das Team transferiert">T</div>`
            : '';

        const removeBtn = `<button type="button"
                        class="builder-remove-btn"
                        title="Spieler entfernen"
                        data-action="remove-player"
                        data-slot-id="${escapeHtml(slot.id)}"
                        aria-label="${escapeHtml(player.name)} entfernen">✖</button>`;

        const avatarHtml = `<div class="avatar-wrapper">
                        <img src="${escapeHtml(player.photo)}" class="card-avatar" alt="${escapeHtml(player.name)}" loading="lazy">
                    </div>`;

        const cardInfoHtml = `<div class="card-info">
                        <div class="card-name">${escapeHtml(player.name)}</div>
                        <div class="card-sub-info">
                            ${player.flag ? `<img src="${escapeHtml(player.flag)}" class="small-icon" alt="${escapeHtml(player.nation)}" loading="lazy">` : ''}
                            <span>${escapeHtml(player.nation)}</span>
                        </div>
                        <div class="card-sub-info">
                            ${player.clubLogo ? `<img src="${escapeHtml(player.clubLogo)}" class="small-icon club" alt="${escapeHtml(player.club)}" loading="lazy">` : ''}
                            <span>${escapeHtml(player.club)}</span>
                        </div>
                    </div>`;

        const orphanBadge = isOrphan
            ? `<div class="orphan-badge" title="Spieler nicht mehr im aktuellen Kader – bitte ersetzen">Bitte ersetzen</div>`
            : '';

        // Erreichte Punkte – nur nach Turnierstart (davor haben alle 0) und
        // sobald die Punkte geladen sind. Anzeige wie in der Teams-Ansicht:
        // vorzeichenbehaftete Zahl, blaue/rote Pille.
        let ptsHtml = '';
        if (isTournamentStarted() && builderPointsMap && !isOrphan) {
            const rawPts = getBuilderPlayerPts(player.id);
            const ptsCls = rawPts > 0 ? '' : (rawPts < 0 ? 'neg' : '');
            const ptsSign = rawPts > 0 ? '+' : '';
            ptsHtml = `<div class="builder-card-pts ${ptsCls}" title="Bisher erreichte Punkte">${ptsSign}${rawPts}</div>`;
        }

        // Ersatzbank-Karten sehen identisch aus wie Feldspieler-Karten
        // (gleiche Größe, gleiches Layout) – sie erhalten die vollen Punkte,
        // deshalb sollen sie nicht kleiner wirken.
        const innerHtml = `${captainBtn}${removeBtn}${transferBadge}${ptsHtml}${avatarHtml}${cardInfoHtml}${orphanBadge}`;

        return `
            <div class="slot-wrapper${isActive ? ' is-active' : ''}" data-slot-id="${escapeHtml(slot.id)}" data-action="open-slot">
                <div class="builder-player-card${isCaptain ? ' is-captain' : ''}${isOrphan ? ' is-orphan' : ''}">
                    ${innerHtml}
                </div>
            </div>
        `;
    }

    function buildEmptySlotHTML(slot) {
        const isActive = String(slot.id) === String(currentEditingSlotId);
        const icon = POSITION_ICONS[slot.pos] || '➕';
        const addLabel = {
            GOALKEEPER: '+ Torwart wählen',
            DEFENDER:   '+ Verteidiger wählen',
            MIDFIELDER: '+ Mittelfeld wählen',
            ATTACKER:   '+ Stürmer wählen'
        }[slot.pos] || `+ ${slot.label} wählen`;

        return `
            <div class="slot-wrapper${isActive ? ' is-active' : ''}" data-slot-id="${escapeHtml(slot.id)}" data-action="open-slot">
                <div class="empty-slot" role="button" tabindex="0" aria-label="${addLabel}">
                    <div class="add-icon">${icon}</div>
                    <span>${addLabel}</span>
                </div>
            </div>
        `;
    }

    /* =========================================================
       RENDER ALL SLOTS (Desktop)
       ========================================================= */
    function renderAllSlots(newSlotId = null) {
        // Vor dem Wegwerfen der DOM-Knoten alle aktiven VanillaTilt-
        // Instanzen sauber abbauen. Sonst halten interne Listener weiter
        // Referenzen auf die gerade entfernten Karten und werfen beim
        // naechsten Mausevent „Cannot read properties of null (reading
        // 'style')" innerhalb von vanilla-tilt.min.js.
        document.querySelectorAll('.builder-player-card').forEach(card => {
            safeDestroyTilt(card);
        });

        ['row-GOALKEEPER','row-DEFENDER','row-MIDFIELDER','row-ATTACKER','bench-slots'].forEach(id => {
            const el = document.getElementById(id);
            if (el) el.innerHTML = '';
        });

        if (isFirstSlotRender && dom.pitchContainer) {
            dom.pitchContainer.classList.add('is-init');
            isFirstSlotRender = false;
            setTimeout(() => dom.pitchContainer && dom.pitchContainer.classList.remove('is-init'), 1000);
        }

        finalSlots.forEach(slot => {
            const playerId = getSlotPlayerId(slot.id);
            const player   = playerId ? getPlayerById(playerId) : null;
            const html     = player ? buildSelectedCardHTML(slot, player) : buildEmptySlotHTML(slot);
            const cont     = document.getElementById(slot.cont);
            if (cont) cont.insertAdjacentHTML('beforeend', html);
        });

        if (newSlotId != null && !prefersReducedMotion()) {
            const wrapper = document.querySelector(`.slot-wrapper[data-slot-id="${newSlotId}"]`);
            if (wrapper) {
                wrapper.classList.add('slot-wrapper--new');
                wrapper.addEventListener('animationend', () => wrapper.classList.remove('slot-wrapper--new'), { once: true });
            }
        }

        renderNationFilterOptions();
        updateStatusBar();
        validateForm();
        saveStateToLocal();
        initCardTilt();
        syncPanelHeights();
    }

    /* =========================================================
       MOBILE BUILDER RENDER
       ========================================================= */
    function renderMobileBuilder() {
        if (!dom.mobileBuilder) return;

        const html = MOBILE_GROUPS.map(group => {
            const allGroupSlots = [...group.slots, ...group.benchSlots];
            const filledCount   = allGroupSlots.filter(id => !!selectedTeam[id]).length;
            const totalCount    = allGroupSlots.length;
            const icon          = POSITION_ICONS[group.pos] || '⚽';

            const dotsHtml = allGroupSlots.map(id =>
                `<div class="mobile-pos-dot${selectedTeam[id] ? ' filled' : ''}"></div>`
            ).join('');

            const slotsHtml = allGroupSlots.map(slotId => {
                const slot      = getSlotConfig(slotId);
                const playerId  = getSlotPlayerId(slotId);
                const player    = playerId ? getPlayerById(playerId) : null;
                const isActive  = String(slotId) === String(currentEditingSlotId);
                const isBench   = slot && slot.cont === 'bench-slots';

                if (player) {
                    const isCaptain = String(player.id) === String(selectedCaptainId);
                    const isOrphan  = !!player.isOrphan;
                    const orphanTag = isOrphan
                        ? ' <span class="orphan-tag" title="Spieler nicht mehr im aktuellen Kader – bitte ersetzen">Ersetzen</span>'
                        : '';
                    const mPts = getBuilderPlayerPts(player.id);
                    const mPtsHtml = (isTournamentStarted() && builderPointsMap && !isOrphan)
                        ? `<span style="margin-left:auto;font-weight:800;color:${mPts < 0 ? '#ef4444' : 'rgb(var(--rgb-green-1))'};white-space:nowrap;">${mPts > 0 ? '+' : ''}${mPts} Pkt.</span>`
                        : '';
                    return `
                        <div class="mobile-slot-row${isActive ? ' is-active' : ''}${isOrphan ? ' is-orphan' : ''}" data-slot-id="${escapeHtml(slotId)}" data-action="open-slot" role="button" tabindex="0" aria-label="${escapeHtml(player.name)} – Slot öffnen${isOrphan ? ' (bitte ersetzen)' : ''}">
                            <div class="mobile-slot-avatar">
                                <img src="${escapeHtml(player.photo)}" alt="${escapeHtml(player.name)}" loading="lazy">
                            </div>
                            <div class="mobile-slot-info">
                                <div class="mobile-slot-name">${escapeHtml(player.name)}${isCaptain ? ' 👑' : ''}${orphanTag}${isBench ? ' <span style="font-size:9px;color:var(--text-muted);font-weight:600;">BANK</span>' : ''}</div>
                                <div class="mobile-slot-meta">
                                    ${player.flag ? `<img src="${escapeHtml(player.flag)}" alt="${escapeHtml(player.nation)}" loading="lazy">` : ''}
                                    <span>${escapeHtml(player.nation)}</span>
                                    ${player.clubLogo ? `<img src="${escapeHtml(player.clubLogo)}" class="club" alt="${escapeHtml(player.club)}" loading="lazy">` : ''}
                                    <span>${escapeHtml(player.club)}</span>
                                    ${mPtsHtml}
                                </div>
                            </div>
                            <div class="mobile-slot-actions">
                                ${CAPTAIN_ENABLED ? `<button type="button"
                                    class="mobile-captain-btn${isCaptain ? ' active' : ''}"
                                    data-action="set-captain"
                                    data-player-id="${escapeHtml(player.id)}"
                                    aria-label="${isCaptain ? 'Captain entfernen' : 'Zum Captain machen'}: ${escapeHtml(player.name)}">C</button>` : ''}
                                <button type="button"
                                    class="mobile-remove-btn"
                                    data-action="remove-player"
                                    data-slot-id="${escapeHtml(slotId)}"
                                    aria-label="${escapeHtml(player.name)} entfernen">✖</button>
                            </div>
                        </div>
                    `;
                } else {
                    const posLabel = {
                        GOALKEEPER: '+ Torwart wählen',
                        DEFENDER:   '+ Verteidiger wählen',
                        MIDFIELDER: '+ Mittelfeld wählen',
                        ATTACKER:   '+ Stürmer wählen'
                    }[group.pos] || '+ Wählen';
                    return `
                        <div class="mobile-slot-row is-empty${isActive ? ' is-active' : ''}" data-slot-id="${escapeHtml(slotId)}" data-action="open-slot" role="button" tabindex="0" aria-label="${posLabel}${isBench ? ' (Bank)' : ''}">
                            <div class="mobile-slot-avatar">
                                <span class="empty-icon">${icon}</span>
                            </div>
                            <div class="mobile-slot-info">
                                <div class="mobile-slot-name empty">${posLabel}${isBench ? ' <span style="font-size:9px;font-weight:600;">(Bank)</span>' : ''}</div>
                            </div>
                            <div class="mobile-slot-actions">
                                <button type="button" class="mobile-add-btn" tabindex="-1" aria-hidden="true">+</button>
                            </div>
                        </div>
                    `;
                }
            }).join('');

            /* Keep section open if it has an active slot or is the first unfilled */
            const hasActiveSlot = allGroupSlots.some(id => String(id) === String(currentEditingSlotId));
            const isOpen = hasActiveSlot || (filledCount < totalCount && MOBILE_GROUPS.indexOf(group) === MOBILE_GROUPS.findIndex(g => {
                const gSlots = [...g.slots, ...g.benchSlots];
                return gSlots.some(id => !selectedTeam[id]);
            }));

            return `
                <div class="mobile-position-section${isOpen ? ' open' : ''}" data-pos="${group.pos}">
                    <div class="mobile-pos-header" data-toggle-pos="${group.pos}" role="button" tabindex="0" aria-expanded="${isOpen ? 'true' : 'false'}">
                        <div class="mobile-pos-title">
                            <span class="mobile-pos-name">${group.label}</span>
                            <span class="mobile-pos-count">${filledCount}/${totalCount}</span>
                        </div>
                        <div class="mobile-pos-status">
                            <div class="mobile-pos-dots">${dotsHtml}</div>
                            <span class="mobile-pos-chevron">▼</span>
                        </div>
                    </div>
                    <div class="mobile-pos-body">
                        ${slotsHtml}
                    </div>
                </div>
            `;
        }).join('');

        dom.mobileBuilder.innerHTML = html;

        /* Event listeners for mobile builder are set up once via delegation in setupUI() */
    }

    /* =========================================================
       SCROLL SLOT INTO VIEW
       ========================================================= */
    function scrollSlotIntoView(slotId) {
        /* Desktop */
        const desktopEl = document.querySelector(`.slot-wrapper[data-slot-id="${String(slotId)}"]`);
        if (desktopEl) {
            requestAnimationFrame(() => desktopEl.scrollIntoView({ behavior: 'smooth', block: 'center', inline: 'center' }));
        }
        /* Mobile */
        const mobileEl = dom.mobileBuilder ? dom.mobileBuilder.querySelector(`[data-slot-id="${String(slotId)}"][data-action="open-slot"]`) : null;
        if (mobileEl) {
            requestAnimationFrame(() => mobileEl.scrollIntoView({ behavior: 'smooth', block: 'nearest' }));
        }
    }

    /* =========================================================
       SLOT GLOW ANIMATION
       ========================================================= */
    function glowSlot(slotId) {
        if (prefersReducedMotion()) return;
        const desktop = document.querySelector(`.slot-wrapper[data-slot-id="${slotId}"] .builder-player-card`);
        if (desktop) {
            desktop.classList.add('slot-glow-anim');
            setTimeout(() => desktop.classList.remove('slot-glow-anim'), 900);
        }
        const mobile = dom.mobileBuilder
            ? dom.mobileBuilder.querySelector(`[data-slot-id="${slotId}"][data-action="open-slot"]`)
            : null;
        if (mobile) {
            mobile.style.transition = 'box-shadow 0.2s';
            mobile.style.boxShadow = '0 0 20px rgba(74,222,128,0.4)';
            setTimeout(() => { mobile.style.boxShadow = ''; }, 800);
        }
    }

    /* =========================================================
       PICKER HEADER
       ========================================================= */
    function updatePickerHeader() {
        const slot = getSlotConfig(currentEditingSlotId);

        if (!slot) {
            dom.pickerTitle.textContent = 'Spieler wählen';
            dom.pickerSubtitle.textContent = 'Klicke auf einen Slot im Spielfeld oder auf der Bank.';
            return;
        }

        const currentPlayerId = getSlotPlayerId(slot.id);
        const currentPlayer   = currentPlayerId ? getPlayerById(currentPlayerId) : null;
        const icon = POSITION_ICONS[slot.pos] || '⚽';

        dom.pickerTitle.textContent = `${icon} ${slot.label} wählen`;
        dom.pickerSubtitle.textContent = currentPlayer
            ? `Slot ${parseInt(slot.id, 10) + 1}: aktuell ${currentPlayer.name}`
            : `Slot ${parseInt(slot.id, 10) + 1}: noch leer`;
    }

    /* =========================================================
       PLAYER ELIGIBILITY HELPER
       ========================================================= */
    function getPlayerEligibility(player, slotId) {
        const isSamePlayer    = String(getSlotPlayerId(slotId)) === String(player.id);
        const isPlayerBlocked = isPlayerSelectedElsewhere(player.id, slotId);
        const isNationBlocked = isNationTakenByOtherSlot(player.nation, slotId);
        const slot            = getSlotConfig(slotId);
        const isWrongPos      = slot ? player.position !== slot.pos : false;

        let reason = '';
        if (!isSamePlayer) {
            if (isWrongPos)      reason = 'Falsche Position';
            else if (isNationBlocked) reason = `${primaryEntityNoun()} bereits gewählt`;
            else if (isPlayerBlocked) reason = 'Bereits im Team';
        }

        const isDisabled = !isSamePlayer && (isPlayerBlocked || isNationBlocked || isWrongPos);
        return { isSamePlayer, isDisabled, reason };
    }

    /* =========================================================
       PICKER PLAYER LIST
       ========================================================= */
    function getFilteredPickerPlayers() {
        const requiredPos = getRequiredPositionForCurrentSlot();
        if (!requiredPos) return [];

        const searchTerm = (dom.pickerSearch ? dom.pickerSearch.value.trim() : '');
        const searchTokens = normalizeSearchText(searchTerm).split(/\s+/).filter(Boolean);

        /* On mobile use chip filters; on desktop use the select */
        const nationFilter = isMobileView()
            ? mobileFilterNation
            : (dom.pickerNationFilter ? dom.pickerNationFilter.value : 'ALL');

        const slotId = currentEditingSlotId;

        let players = preparedPlayers
            .filter(p => p.position === requiredPos)
            .filter(p => nationFilter === 'ALL' || p.nation === nationFilter)
            .filter(p => !searchTokens.length || searchTokens.every(tok => p.searchKey.includes(tok)));

        /* Mobile-only chip filters */
        if (isMobileView()) {
            if (mobileFilterHideInvalid) {
                players = players.filter(p => {
                    const { isDisabled } = getPlayerEligibility(p, slotId);
                    return !isDisabled;
                });
            }
            if (mobileFilterOnlyAvailable) {
                players = players.filter(p => {
                    const { isSamePlayer, isDisabled } = getPlayerEligibility(p, slotId);
                    return isSamePlayer || !isDisabled;
                });
            }
        }

        /* Smart sort:
           1. Currently selected player first
           2. Available (not blocked) players
           3. Alphabetical within each group */
        players.sort((a, b) => {
            const elig_a = getPlayerEligibility(a, slotId);
            const elig_b = getPlayerEligibility(b, slotId);

            if (elig_a.isSamePlayer && !elig_b.isSamePlayer) return -1;
            if (!elig_a.isSamePlayer && elig_b.isSamePlayer) return 1;

            const aOk = !elig_a.isDisabled;
            const bOk = !elig_b.isDisabled;
            if (aOk && !bOk) return -1;
            if (!aOk && bOk) return 1;

            return a.sortKey.localeCompare(b.sortKey, 'de');
        });

        return players;
    }

    function appendNextPickerBatch() {
        const nextBatch = pickerFilteredPlayers.slice(pickerRenderedCount, pickerRenderedCount + PICKER_BATCH_SIZE);
        if (!nextBatch.length) return;

        const currentSlotId = currentEditingSlotId;
        const fragment = document.createDocumentFragment();

        nextBatch.forEach(player => {
            const { isSamePlayer, isDisabled, reason } = getPlayerEligibility(player, currentSlotId);

            const row = document.createElement('div');
            row.className = `picker-row${isDisabled ? ' disabled' : ''}${isSamePlayer ? ' is-selected' : ''}`;

            const btnText = isSamePlayer ? '✓ Gewählt' : isDisabled ? 'Blockiert' : 'Wählen';

            const disabledReasonHtml = (!isSamePlayer && reason)
                ? `<div class="picker-disabled-reason">⚠ ${escapeHtml(reason)}</div>`
                : '';

            row.innerHTML = `
                <div class="picker-avatar-wrap">
                    <img src="${escapeHtml(player.photo)}" class="picker-avatar" alt="${escapeHtml(player.name)}" loading="lazy">
                </div>
                <div class="picker-info">
                    <div class="picker-name">${escapeHtml(player.name)}</div>
                    <div class="picker-meta">
                        ${player.flag ? `<img src="${escapeHtml(player.flag)}" alt="${escapeHtml(player.nation)}" loading="lazy">` : ''}
                        <span>${escapeHtml(player.nation)}</span>
                        <span class="dot">·</span>
                        ${player.clubLogo ? `<img src="${escapeHtml(player.clubLogo)}" class="club" alt="${escapeHtml(player.club)}" loading="lazy">` : ''}
                        <span>${escapeHtml(player.club)}</span>
                    </div>
                    ${disabledReasonHtml}
                </div>
                <button type="button" class="picker-choose-btn"${isDisabled ? ' disabled aria-disabled="true"' : ''} aria-label="${escapeHtml(player.name)} wählen">${escapeHtml(btnText)}</button>
            `;

            if (!isDisabled) {
                row.addEventListener('click', () => selectPlayer(player.id));
                const btn = row.querySelector('.picker-choose-btn');
                if (btn) {
                    btn.addEventListener('click', (e) => {
                        e.stopPropagation();
                        selectPlayer(player.id);
                    });
                }
            }

            fragment.appendChild(row);
        });

        dom.pickerList.appendChild(fragment);
        pickerRenderedCount += nextBatch.length;
    }

    function fillPickerUntilScrollable() {
        if (!pickerFilteredPlayers.length) return;
        let guard = 0;
        while (
            pickerRenderedCount < pickerFilteredPlayers.length &&
            dom.pickerResults.scrollHeight <= dom.pickerResults.clientHeight + 8 &&
            guard < 50
        ) {
            appendNextPickerBatch();
            guard++;
        }
    }

    function renderPickerPlayers(reset = true) {
        if (reset) {
            pickerFilteredPlayers = getFilteredPickerPlayers();
            pickerRenderedCount   = 0;
            dom.pickerList.innerHTML = '';
            dom.pickerResults.scrollTop = 0;

            dom.pickerResultCount.textContent = `${pickerFilteredPlayers.length} Spieler`;
            dom.pickerEmptyState.style.display = pickerFilteredPlayers.length ? 'none' : 'block';
        }

        if (!pickerFilteredPlayers.length) {
            syncPanelHeights();
            return;
        }

        appendNextPickerBatch();
        fillPickerUntilScrollable();
        syncPanelHeights();
    }

    function applyPickerFilters() {
        updateSearchClearButton();
        renderPickerPlayers(true);
    }

    /* =========================================================
       OPEN SLOT PICKER
       ========================================================= */
    function openSlotPicker(slotId) {
        if (!isBuilderEditable()) {
            showToast('⛔ Nach Turnierstart nur über „🔄 Transfer vornehmen".');
            return;
        }
        currentEditingSlotId = String(slotId);

        if (isMobileView()) {
            /* Hide next-slot bar until player is chosen */
            if (dom.pickerNextSlotBar) dom.pickerNextSlotBar.classList.remove('visible');
        }

        updatePickerHeader();
        renderAllSlots();
        renderMobileBuilder();
        renderMobileFilterChips();
        renderPickerPlayers(true);

        if (isMobileView()) {
            openMobilePickerWithHistory({ pushHistory: true });
        }
    }

    window.openSlotPicker = openSlotPicker;

    /* =========================================================
       SELECT PLAYER
       ========================================================= */
    function selectPlayer(playerId) {
        if (!isBuilderEditable()) return;
        const slotId = currentEditingSlotId;
        if (!slotId) return;

        const slot   = getSlotConfig(slotId);
        const player = getPlayerById(playerId);
        if (!slot || !player) return;

        if (player.position !== slot.pos) {
            showToast(`Falsche Position: ${translatePosition(player.position)} ≠ ${translatePosition(slot.pos)}`);
            return;
        }

        /* Detect whether this pick replaces an existing different player so
           we can show a clearer message. Picking the already-selected
           player again is a no-op as far as messaging goes. */
        const oldPlayerId = getSlotPlayerId(slotId);
        const oldPlayer   = oldPlayerId ? getPlayerById(oldPlayerId) : null;
        const isReplacement = !!(oldPlayer && String(oldPlayer.id) !== String(playerId));
        const isSameAgain   = !!(oldPlayer && String(oldPlayer.id) === String(playerId));

        /* Clear captain if old player in slot was captain */
        if (isReplacement && String(selectedCaptainId) === String(oldPlayer.id)) {
            selectedCaptainId = null;
        }

        selectedTeam[String(slotId)] = String(playerId);

        glowSlot(slotId);

        if (isReplacement) {
            showToast(`⟳ ${oldPlayer.name} wurde durch ${player.name} ersetzt`);
        } else if (!isSameAgain) {
            showToast(`✓ ${player.name} gewählt`);
        }

        if (isMobileView()) {
            renderAllSlots(slotId);
            renderMobileBuilder();
            updatePickerHeader();
            renderMobileFilterChips();
            renderPickerPlayers(true);

            closeMobilePicker();
            setTimeout(() => {
                scrollSlotIntoView(slotId);
                glowSlot(slotId);
                /* Show next-slot shortcut */
                showNextSlotAction(slotId);
            }, 80);
            if (transferMode) updateTransferUI();
            return;
        }

        /* Desktop: the picker stays open, so without intervention a second
           pick would silently overwrite the slot we just filled. We
           auto-advance only on a fresh fill (the slot was empty before),
           preferring an empty slot in the same position group. On an
           explicit replacement the user clicked that slot on purpose, so
           we stay put. */
        const nextSlot = (!isReplacement && !isSameAgain)
            ? getNextFreeSlotPreferringSamePosition(slotId)
            : null;
        const advanced = !!(nextSlot && String(nextSlot.id) !== String(slotId));
        if (advanced) {
            currentEditingSlotId = String(nextSlot.id);
        }

        renderAllSlots(slotId);
        renderMobileBuilder();
        updatePickerHeader();
        renderMobileFilterChips();
        renderPickerPlayers(true);

        if (advanced) {
            /* Pulse the new active slot so the change is obvious. */
            glowSlot(nextSlot.id);
            scrollSlotIntoView(nextSlot.id);
        }

        if (transferMode) updateTransferUI();
    }

    window.selectPlayer = selectPlayer;

    /* =========================================================
       REMOVE PLAYER
       ========================================================= */
    function removePlayer(slotId) {
        if (!isBuilderEditable()) {
            showToast('⛔ Nach Turnierstart nur über „🔄 Transfer vornehmen".');
            return;
        }
        const existingPlayerId = getSlotPlayerId(slotId);
        if (existingPlayerId && String(existingPlayerId) === String(selectedCaptainId)) {
            selectedCaptainId = null;
        }

        delete selectedTeam[String(slotId)];
        currentEditingSlotId = String(slotId);

        renderAllSlots();
        renderMobileBuilder();
        updatePickerHeader();
        renderPickerPlayers(true);

        showToast('Spieler entfernt');

        if (isMobileView()) {
            scrollSlotIntoView(slotId);
        }

        if (transferMode) updateTransferUI();
    }

    window.removePlayer = removePlayer;

    /* =========================================================
       SET CAPTAIN
       ========================================================= */
    function setCaptain(playerId) {
        if (!isBuilderEditable()) {
            showToast('⛔ Nach Turnierstart nur über „🔄 Transfer vornehmen".');
            return;
        }
        if (!Object.values(selectedTeam).map(String).includes(String(playerId))) return;
        const cap = getPlayerById(playerId);
        if (cap && cap.isOrphan) {
            showToast('⚠️ Dieser Spieler ist nicht im aktuellen WM-Kader. Bitte zuerst ersetzen.');
            refreshRosterNotice();
            return;
        }

        selectedCaptainId = String(playerId);
        renderAllSlots();
        renderMobileBuilder();
        validateForm();
        saveStateToLocal();
        updateStatusBar();
        if (transferMode) updateTransferUI();

        showToast(`👑 Captain: ${cap ? cap.name : 'gesetzt'}`, 'captain');

        /* Captain glow on desktop card */
        if (!prefersReducedMotion()) {
            const slot = finalSlots.find(s => String(selectedTeam[s.id]) === String(playerId));
            if (slot) {
                const card = document.querySelector(`.slot-wrapper[data-slot-id="${slot.id}"] .builder-player-card`);
                if (card) {
                    card.classList.add('captain-glow-anim');
                    setTimeout(() => card.classList.remove('captain-glow-anim'), 1000);
                }
            }
        }
    }

    window.setCaptain = setCaptain;

    /* =========================================================
       CLEAR TEAM
       ========================================================= */
    function clearTeam() {
        if (isTournamentStarted()) {
            showToast('⛔ Nach Turnierstart nicht möglich.');
            return;
        }
        selectedTeam       = {};
        selectedCaptainId  = null;
        currentEditingSlotId = getFirstAvailableSlotId();
        hideBuilderNotice();

        renderAllSlots();
        renderMobileBuilder();
        updatePickerHeader();
        renderPickerPlayers(true);

        if (isMobileView()) closeMobilePicker();
        showToast('Team geleert');
    }

    /* =========================================================
       VALIDATION
       ========================================================= */
    function validateForm() {
        const count     = Object.keys(selectedTeam).length;
        const nameInput = dom.managerName ? dom.managerName.value.trim() : '';
        const words     = nameInput.split(' ').filter(w => w.length > 0);
        const isFullName = words.length >= 2;

        if (dom.nameWarning) {
            dom.nameWarning.style.display = (nameInput.length > 0 && !isFullName) ? 'block' : 'none';
        }

        const teamPlayerIds  = Object.values(selectedTeam).map(String);
        const orphanPlayers  = getSelectedOrphanPlayers();
        const hasOrphanPlayers = orphanPlayers.length > 0;

        /* Captain is "valid" only when the chosen player still resolves to
         * a real (non-orphan) entry. An orphaned captain — i.e. one whose
         * player has been removed from the kader — must be re-assigned
         * before the team can be saved, otherwise the captain bonus would
         * permanently apply to a 0-points slot. */
        let hasValidCaptain = !CAPTAIN_ENABLED;
        if (CAPTAIN_ENABLED && selectedCaptainId !== null && teamPlayerIds.includes(String(selectedCaptainId))) {
            const captainPlayer = getPlayerById(selectedCaptainId);
            hasValidCaptain = !!(captainPlayer && !captainPlayer.isOrphan);
        }

        if (dom.captainWarning) {
            dom.captainWarning.style.display = (CAPTAIN_ENABLED && !hasValidCaptain && count === 15) ? 'block' : 'none';
        }

        const hasDuplicateWarning = dom.duplicateWarning && dom.duplicateWarning.style.display === 'block';
        const isEnabled = (count === 15 && isFullName && hasValidCaptain && !hasOrphanPlayers) && !isSubmitting && !hasDuplicateWarning;

        if (dom.submitBtn) dom.submitBtn.disabled = !isEnabled;

        updateStatusBar();
    }

    /* =========================================================
       LOCAL STORAGE
       ========================================================= */
    function saveStateToLocal() {
        try {
            localStorage.setItem(BUILDER_CACHE_KEY, JSON.stringify({
                manager:       dom.managerName ? dom.managerName.value : '',
                players:       selectedTeam,
                captain:       selectedCaptainId,
                currentSlotId: currentEditingSlotId,
                pickerSearch:  dom.pickerSearch ? dom.pickerSearch.value : '',
                pickerNation:  dom.pickerNationFilter ? dom.pickerNationFilter.value : 'ALL'
            }));
        } catch (e) {
            /* Quota exceeded – ignore */
        }
    }

    function getSavedBuilderStateRaw() {
        try {
            return localStorage.getItem(BUILDER_CACHE_KEY);
        } catch (err) {
            return null;
        }
    }

    function sanitizeLoadedTeamState(rawTeam) {
        const report = {
            team: {},
            removedCount: 0,
            wrongPositionCount: 0,
            missingPlayerCount: 0,
            duplicatePlayerCount: 0,
            nationConflictCount: 0,
            invalidSlotCount: 0
        };

        const usedPlayers = new Set();
        const usedNations = new Set();
        const input = rawTeam && typeof rawTeam === 'object' ? rawTeam : {};

        finalSlots.forEach(slot => {
            if (!Object.prototype.hasOwnProperty.call(input, slot.id)) return;
            const rawPlayerId = input[slot.id];
            if (!rawPlayerId) return;
            const playerId = String(rawPlayerId);
            const player   = getPlayerById(playerId);

            if (!player) { report.removedCount++; report.missingPlayerCount++; return; }
            if (player.position !== slot.pos) { report.removedCount++; report.wrongPositionCount++; return; }
            if (usedPlayers.has(player.id)) { report.removedCount++; report.duplicatePlayerCount++; return; }
            if (player.nation && usedNations.has(player.nation)) { report.removedCount++; report.nationConflictCount++; return; }

            report.team[slot.id] = player.id;
            usedPlayers.add(player.id);
            if (player.nation) usedNations.add(player.nation);
        });

        Object.keys(input).forEach(slotId => {
            if (!isValidSlotId(slotId)) { report.removedCount++; report.invalidSlotCount++; }
        });

        return report;
    }

    function buildSanitizeNotice(report) {
        if (!report || !report.removedCount) return '';
        const parts = [];
        if (report.wrongPositionCount)  parts.push(`${report.wrongPositionCount} wegen Positionsänderung`);
        if (report.missingPlayerCount)  parts.push(`${report.missingPlayerCount} unbekannte Spieler`);
        if (report.duplicatePlayerCount) parts.push(`${report.duplicatePlayerCount} doppelte Spieler`);
        if (report.nationConflictCount) parts.push(`${report.nationConflictCount} wegen Nationenregel`);
        const detail = parts.length ? ` (${parts.join(', ')})` : '';
        return `Hinweis: ${report.removedCount} Spieler aus deinem gespeicherten Entwurf wurden entfernt${detail}. Bitte prüfe dein Team.`;
    }

    function loadStateFromLocal() {
        const saved = getSavedBuilderStateRaw();
        if (!saved) return;

        try {
            const state = JSON.parse(saved);

            if (dom.managerName) dom.managerName.value = state.manager || '';
            if (dom.pickerSearch) dom.pickerSearch.value = state.pickerSearch || '';

            const report      = sanitizeLoadedTeamState(state.players || {});
            selectedTeam      = report.team;

            const teamPlayerIds  = Object.values(selectedTeam).map(String);
            selectedCaptainId    = state.captain && teamPlayerIds.includes(String(state.captain))
                ? String(state.captain)
                : null;

            currentEditingSlotId = isValidSlotId(state.currentSlotId)
                ? String(state.currentSlotId)
                : null;

            if (report.removedCount > 0) {
                pendingBuilderNotice = buildSanitizeNotice(report);
            }
        } catch (e) {
            /* Corrupt state – ignore */
        }
    }

    function restoreSavedNationFilter() {
        const saved = getSavedBuilderStateRaw();
        if (!saved) return;
        try {
            const state  = JSON.parse(saved);
            const nation = state.pickerNation || 'ALL';
            const exists = Array.from(dom.pickerNationFilter.options).some(o => o.value === nation);
            dom.pickerNationFilter.value = exists ? nation : 'ALL';
        } catch (e) {
            dom.pickerNationFilter.value = 'ALL';
        }
    }

    /* =========================================================
       PANEL HEIGHT SYNC (Desktop)
       ========================================================= */
    function syncPanelHeights() {
        if (window.innerWidth <= 1400 || isMobileView()) {
            if (dom.pickerCard) dom.pickerCard.style.height = '';
            return;
        }

        if (dom.pickerCard) dom.pickerCard.style.height = '';
        requestAnimationFrame(() => {
            const pitchEl = document.querySelector('.pitch-glass-frame');
            if (!pitchEl || !dom.pickerCard) return;
            const h = Math.ceil(pitchEl.getBoundingClientRect().height);
            if (h > 0) dom.pickerCard.style.height = h + 'px';
        });
    }

    /* =========================================================
       VANILLA TILT
       ========================================================= */
    function hardResetCard(card) {
        if (!card) return;
        try { card.vanillaTilt && card.vanillaTilt.reset(); } catch (e) {}
        requestAnimationFrame(() => { card.style.transform = CARD_BASE_TRANSFORM; });
        setTimeout(() => { card.style.transform = CARD_BASE_TRANSFORM; }, 220);
    }

    /**
     * vanilla-tilt@1.8.0 hat einen Race in destroy(): der Aufruf clear-t
     * zuerst transitionTimeout, ruft dann reset() → onMouseEnter() →
     * setTransition(), das den Timeout SOFORT WIEDER SETZT, und nullt
     * danach this.element. Wenn der frisch geplante Timeout feuert,
     * läuft er gegen this.element === null und crasht mit
     * „Cannot read properties of null (reading 'style')". Im Builder
     * trifft das jeden Slot-Wechsel und jedes renderAllSlots() –
     * sichtbares Symptom ist das vom User gemeldete „Mouse-Over-Effekt
     * verschwunden", weil VanillaTilt nach dem Crash keine neuen
     * Init-Aufrufe mehr verarbeitet.
     */
    function safeDestroyTilt(card) {
        if (!card || !card.vanillaTilt) return;
        const inst = card.vanillaTilt;
        try { inst.destroy(); } catch (e) {}
        try { clearTimeout(inst.transitionTimeout); } catch (e) {}
        try { card.style.transition = ''; } catch (e) {}
    }

    let tiltLastInitAt = 0;
    function initCardTilt() {
        tiltLastInitAt = Date.now();
        const cards = document.querySelectorAll('.builder-player-card');
        cards.forEach(card => {
            safeDestroyTilt(card);
            card.style.transform = CARD_BASE_TRANSFORM;
            if (!card.dataset.tiltBound) {
                card.addEventListener('mouseleave', () => hardResetCard(card));
                card.addEventListener('blur', () => hardResetCard(card));
                card.dataset.tiltBound = '1';
            }
        });

        if (!isDesktopHover() || typeof VanillaTilt === 'undefined' || !cards.length) return;

        VanillaTilt.init(cards, {
            max: 15,
            speed: 280,
            glare: true,
            'max-glare': 0.3,
            scale: 1,
            transition: true,
            reset: true,
            'reset-to-start': true,
            gyroscope: false
        });
    }

    // Safety net: MutationObserver fängt asynchrone Render-Phasen ab,
    // in denen neue .builder-player-card-Elemente in den DOM eingefügt
    // werden, ohne dass der Aufrufer initCardTilt() unmittelbar danach
    // ausführt (z.B. nach bfcache-Restore, Auto-Restore aus
    // localStorage, Lazy-Registration-Resume oder Service-Worker-Cache-
    // Refresh). Ohne diesen Beobachter ging der Mouse-Over-Tilt nach
    // dem Pre-Launch-Polish (#214/#215) auf Desktop zeitweise verloren,
    // weil VanillaTilt.init() den Render-Tick verpasste.
    let tiltObserverInited = false;
    let tiltObserverTimer = null;
    function initTiltObserver() {
        if (tiltObserverInited) return;
        if (typeof MutationObserver === 'undefined') return;

        const targets = [
            document.getElementById('desktop-builder'),
            document.getElementById('mobile-builder'),
            document.getElementById('builder-root'),
            document.body
        ].filter(Boolean);
        if (!targets.length) return;

        tiltObserverInited = true;
        const observer = new MutationObserver((mutations) => {
            const hasNewCard = mutations.some(m =>
                Array.from(m.addedNodes).some(n =>
                    n.nodeType === 1 && (
                        (typeof n.matches === 'function' && n.matches('.builder-player-card'))
                        || (typeof n.querySelector === 'function' && n.querySelector && n.querySelector('.builder-player-card'))
                    )
                )
            );
            if (!hasNewCard) return;

            if (tiltObserverTimer) clearTimeout(tiltObserverTimer);
            tiltObserverTimer = setTimeout(() => {
                tiltObserverTimer = null;
                if (Date.now() - tiltLastInitAt < 200) return;
                initCardTilt();
            }, 240);
        });

        // Erste Treffer reicht (Desktop oder Mobile Builder)
        observer.observe(targets[0], { childList: true, subtree: true });
    }

    /* =========================================================
       SLOT INTERACTION HANDLER (delegated)
       ========================================================= */
    function handleSlotInteraction(event) {
        const trigger = event.target.closest('[data-action]');
        if (!trigger) return;

        const action = trigger.getAttribute('data-action');
        if (!action) return;

        if (action === 'set-captain') {
            event.stopPropagation();
            const playerId = trigger.getAttribute('data-player-id');
            if (playerId) setCaptain(playerId);
            return;
        }

        if (action === 'remove-player') {
            event.stopPropagation();
            const slotId = trigger.getAttribute('data-slot-id');
            if (slotId) removePlayer(slotId);
            return;
        }

        if (action === 'open-slot') {
            const slotId = trigger.getAttribute('data-slot-id');
            if (slotId) openSlotPicker(slotId);
        }
    }

    /* =========================================================
       DUPLICATE CHECK
       ========================================================= */
    async function managerNameExists(name, ignoreTeamId = null) {
        const normalized = name.trim().toLowerCase();
        if (!normalized) return false;

        /* When editing an existing team we must ignore the user's own document,
           otherwise saving without changing the name would always be blocked.
           We therefore fetch up to two matches per query and treat the result
           as a duplicate only if at least one hit has a different doc id. */
        const limit = ignoreTeamId ? 2 : 1;

        const hasForeignMatch = (snap) =>
            snap.docs.some(doc => doc.id !== ignoreTeamId);

        const snap1 = await db.collection(TEAMS_COLLECTION)
            .where('managerNormalized', '==', normalized)
            .limit(limit).get();
        if (hasForeignMatch(snap1)) return true;

        const snap2 = await db.collection(TEAMS_COLLECTION)
            .where('manager', '==', name.trim())
            .limit(limit).get();
        return hasForeignMatch(snap2);
    }

    /* =========================================================
       TOURNAMENT STATUS CHECK
       =========================================================
       SICHERHEITSHINWEIS:
       Der Dev-Override (`dreamteamIndexViewMode = "pre" | "post"`) wird
       hier bewusst NUR berücksichtigt, wenn aktuell ein Admin-Account
       (siehe admin.js / DreamTeamAdmin.ADMIN_UIDS) eingeloggt ist.
       Damit lässt sich die Abgabe-Sperre nicht mehr clientseitig durch
       blosses Setzen des localStorage-Wertes umgehen – ein normaler
       Manipulator landet immer auf der echten APP_CONFIG.DREAMTEAM_START
       und sieht dieselbe gesperrte UI wie alle anderen Nutzer.
       Die *eigentliche* Sicherheitsschicht muss weiterhin in den
       Firestore Rules bzw. einer Cloud Function liegen.
       ========================================================= */
    function isTournamentStarted() {
        const Admin = window.DreamTeamAdmin;
        // Globaler Nachzuegler-Schalter: Hat der Admin die Einreichung
        // wieder geöffnet (Feld `lateSubmitOpen` im Meta-Dokument), gilt
        // das für ALLE Nutzer – nicht nur für den Admin. Der Wert kommt
        // aus Firestore (siehe subscribeLateSubmitFlag) und wird zusätzlich
        // von den Firestore Rules durchgesetzt.
        if (lateSubmitOpen) return false;
        const override = (Admin && typeof Admin.getDevViewOverride === 'function')
            ? Admin.getDevViewOverride()
            : null;
        if (override === 'pre') return false;
        if (override === 'post') return true;
        // Startzeitpunkt kommt zentral aus APP_CONFIG.DREAMTEAM_START
        // (turnierspezifisch in tournament-config.js gepflegt).
        const start = (window.APP_CONFIG && window.APP_CONFIG.DREAMTEAM_START)
            ? window.APP_CONFIG.DREAMTEAM_START
            : new Date();
        return new Date() >= start;
    }

    /* =========================================================
       LAZY-REGISTRATION INTEGRATION
       =========================================================
       The block below wires the modular DreamTeamAuth + AuthModal helpers
       into the existing team-builder state.

       Flow:
         1. User builds team without signing in (selectedTeam, captain…).
         2. Click "Submit Team":
              - If signed-in & verified → save/update to Firestore.
              - Otherwise → stash the payload in localStorage and open
                the registration modal.
         3. After registration, the modal shows "verify your email".
         4. When the user comes back with a verified mailbox, the
            visibilitychange / onAuthStateChange listener auto-finalises
            the pending team and redirects to teams.html.
         5. Login mode loads the user's existing team into the builder.
       ========================================================= */
    const PENDING_TEAM_KEY = APP.storage.key('pending_team');
    const SUBMIT_LABEL_CREATE = 'Team abschicken ✓';
    const SUBMIT_LABEL_UPDATE = 'Team aktualisieren ✓';

    let editingTeamId  = null;   // Firestore doc id if user is in edit mode
    let pendingFinalize = false; // guard against concurrent finalize attempts

    /* =========================================================
       CL-TRANSFERFENSTER
       Nach Turnierstart darf ein bereits eingereichtes Team per Transfer
       angepasst werden (max. maxPlayersPerTransfer Spieler pro Transfer,
       begrenzte Anzahl pro Saison – siehe CL_TRANSFERS/transfer-utils.js).
       Historie (transfers + initialCaptain) landet im Team-Doc; die
       zeitbasierte Wertung (Freeze) erfolgt in transfer-utils.js.
       ========================================================= */
    let transferMode            = false;  // aktiver Transfer-Bearbeitungsmodus
    let transferBaselineTeam    = null;   // { slotId: playerId } des gespeicherten Teams
    let transferBaselineCaptain = null;   // Kapitän des gespeicherten Teams
    let loadedTransfers         = [];     // bereits verbrauchte Transfers (aus dem Doc)
    let loadedInitialCaptain    = null;   // Kapitän des Start-15 (aus dem Doc)
    let builderPointsMap        = null;   // { playerId: totalPoints } – erst nach Turnierstart geladen
    let builderPointsLoading    = false;
    // Zeitgefensterte Punkte (nur bei Teams MIT Transfers) + ausgetauschte
    // Spieler – exakt wie in der Teams-Ansicht berechnet (managerBreakdown-
    // OverTime). builderWindowedPts hat Vorrang vor builderPointsMap.
    let builderWindowedPts      = null;   // { playerId: gefensterte Punkte }
    let builderTransferredOut   = [];     // [{id,name,photo,nation,flag,club,clubLogo,pts,...}]
    let builderPointDocs        = null;   // rohe Punkte-Dokumente (für Fenster-Wertung)
    let builderFixtures         = null;   // Fixtures (Anpfiff je Spiel)

    // Punkte eines Spielers für die Anzeige: gefenstert (falls vorhanden),
    // sonst Gesamtpunkte.
    function getBuilderPlayerPts(playerId) {
        const id = String(playerId);
        if (builderWindowedPts && Object.prototype.hasOwnProperty.call(builderWindowedPts, id)) {
            return Number(builderWindowedPts[id] || 0);
        }
        if (builderPointsMap && Object.prototype.hasOwnProperty.call(builderPointsMap, id)) {
            return Number(builderPointsMap[id] || 0);
        }
        return 0;
    }

    // Bereits erreichte Spieler-Punkte laden (nur nach Turnierstart sinnvoll –
    // davor haben alle 0). Einmaliger Bundle-Load; danach Karten neu rendern,
    // damit die Punkte auf den Spielerkarten erscheinen (Transfer-Entscheidung).
    async function loadBuilderPoints() {
        if (builderPointsMap || builderPointsLoading) return;
        if (!isTournamentStarted()) return;
        if (!window.DreamTeamCache || typeof DreamTeamCache.loadBundle !== 'function') return;
        if (!window.DreamTeamPoints || typeof DreamTeamPoints.getPlayerTotal !== 'function') return;
        builderPointsLoading = true;
        try {
            const bundle = await DreamTeamCache.loadBundle({
                db,
                year: TOURNAMENT_YEAR,
                allowEmptyPoints: true,
                allowEmptyFixtures: true,
                // Fixtures für die zeitgefensterte Transfer-Wertung (Punkte bis
                // zum Transfer / ausgetauschte Spieler – wie in der Teams-Ansicht).
                includeFixtures: true,
                log: false
            });
            const points = (bundle && bundle.data && bundle.data.points) || {};
            builderPointDocs = points;
            builderFixtures = (bundle && bundle.data && bundle.data.fixtures) || {};
            const map = {};
            Object.keys(points).forEach(id => { map[String(id)] = DreamTeamPoints.getPlayerTotal(points[id]); });
            builderPointsMap = map;
            computeBuilderTransferScoring();
            renderAllSlots();
            renderMobileBuilder();
            renderBuilderTransferredOut();
        } catch (e) {
            console.warn('[TeamBuilder] Spieler-Punkte konnten nicht geladen werden:', e);
        } finally {
            builderPointsLoading = false;
        }
    }

    // Anpfiff-Zeit eines Fixtures in ms (für die Fenster-Wertung) – 1:1 wie
    // in teams.html.
    function builderFixtureKickoffMs(fixture) {
        if (!fixture || typeof fixture !== 'object') return null;
        const ts = Number(fixture.kickoffTimestamp);
        if (Number.isFinite(ts) && ts > 0) return ts > 10000000000 ? ts : ts * 1000;
        const raw = fixture.kickoffIso || fixture.date || fixture.datetime || fixture.kickoff || '';
        if (raw) { const p = Date.parse(raw); if (Number.isFinite(p)) return p; }
        return null;
    }
    function builderFindFixture(fixtures, matchId) {
        const map = fixtures || {};
        const direct = map[matchId] || map[String(matchId)];
        if (direct && typeof direct === 'object') return direct;
        const target = String(matchId);
        for (const fx of Object.values(map)) {
            if (fx && typeof fx === 'object' && String(fx.fixtureId) === target) return fx;
        }
        return null;
    }

    // Zeitgefensterte Wertung für das gerade bearbeitete Team (nur bei Teams
    // MIT Transfers). Setzt builderWindowedPts (gefensterte Punkte je Spieler)
    // und builderTransferredOut (ausgetauschte Spieler mit „Punkten bis zum
    // Transfer") – exakt wie enrichTeamsWithScores in teams.html.
    function computeBuilderTransferScoring() {
        builderWindowedPts = null;
        builderTransferredOut = [];
        const TU = window.TransferUtils, DP = window.DreamTeamPoints;
        if (!TU || typeof TU.managerBreakdownOverTime !== 'function') return;
        if (!Array.isArray(loadedTransfers) || !loadedTransfers.length) return;
        if (!transferBaselineTeam) return;
        if (!builderPointDocs) return;

        const currentIds = Object.values(transferBaselineTeam).map(String);
        const pmp = {};
        if (DP && typeof DP.getPlayerMatchTotals === 'function') {
            Object.keys(builderPointDocs).forEach(id => { pmp[id] = DP.getPlayerMatchTotals(builderPointDocs[id]); });
        }
        const fxCache = Object.create(null);
        const getKickoffMs = (matchId) => {
            const key = String(matchId);
            if (key in fxCache) return fxCache[key];
            fxCache[key] = builderFixtureKickoffMs(builderFindFixture(builderFixtures, matchId));
            return fxCache[key];
        };
        const bd = TU.managerBreakdownOverTime({
            currentTeamIds: currentIds,
            transfers: loadedTransfers,
            initialCaptain: CAPTAIN_ENABLED ? (loadedInitialCaptain || null) : null,
            playerMatchPoints: pmp,
            getKickoffMs,
            captainMultiplier: CAPTAIN_ENABLED ? 2 : 1
        });
        builderWindowedPts = bd.perPlayer || {};

        const currentSet = new Set(currentIds);
        const initialIdsArr = (typeof TU.reconstructInitialTeamIds === 'function')
            ? TU.reconstructInitialTeamIds(currentIds, loadedTransfers).map(String)
            : currentIds.slice();
        builderTransferredOut = initialIdsArr
            .filter(id => !currentSet.has(id))
            .map(id => {
                const fp = getPlayerById(id);
                return {
                    id,
                    name: fp ? fp.name : String(id),
                    photo: fp ? (fp.photo || '') : '',
                    nation: fp ? (fp.nation || '?') : '?',
                    flag: fp ? (fp.flag || '') : '',
                    club: fp ? (fp.club || '') : '',
                    clubLogo: fp ? (fp.clubLogo || '') : '',
                    pts: (bd.perPlayer && bd.perPlayer[id]) || 0,
                    isOrphan: !fp
                };
            })
            .sort((a, b) => b.pts - a.pts);
    }

    // Rendert die ausgetauschten Spieler unter dem Feld (Karten wie in Teams).
    function renderBuilderTransferredOut() {
        const section = document.getElementById('builder-transferred-out-section');
        const container = document.getElementById('builder-transferred-out-cards');
        if (!section || !container) return;
        const list = Array.isArray(builderTransferredOut) ? builderTransferredOut : [];
        if (!list.length || !isTournamentStarted()) {
            section.hidden = true;
            container.innerHTML = '';
            return;
        }
        container.innerHTML = list.map((p) => {
            const cls = p.pts > 0 ? '' : (p.pts < 0 ? 'neg' : '');
            const sign = p.pts > 0 ? '+' : '';
            const flagImg = p.flag ? `<img src="${escapeHtml(p.flag)}" class="small-icon" alt="${escapeHtml(p.nation)}" loading="lazy">` : '';
            const clubImg = p.clubLogo ? `<img src="${escapeHtml(p.clubLogo)}" class="small-icon club" alt="${escapeHtml(p.club)}" loading="lazy">` : '';
            return `
                <div class="builder-to-card">
                    <div class="builder-card-pts ${cls}" title="Punkte bis zum Transfer">${sign}${p.pts}</div>
                    <div class="avatar-wrapper"><img src="${escapeHtml(p.photo)}" class="card-avatar" alt="${escapeHtml(p.name)}" loading="lazy"></div>
                    <div class="card-info">
                        <div class="card-name">${escapeHtml(p.name)}</div>
                        <div class="card-sub-info">${flagImg}<span>${escapeHtml(p.nation)}</span></div>
                        <div class="card-sub-info">${clubImg}<span>${escapeHtml(p.club)}</span></div>
                    </div>
                </div>
            `;
        }).join('');
        section.hidden = false;
    }

    function getTransferCfg() {
        return (window.TransferUtils && typeof window.TransferUtils.getTransferConfig === 'function')
            ? window.TransferUtils.getTransferConfig(window.APP_CONFIG)
            : null;
    }

    function transferRemaining() {
        const cfg = getTransferCfg();
        if (!cfg) return 0;
        return window.TransferUtils.remainingTransfers(cfg, (loadedTransfers || []).length);
    }

    // Transfer-Panel anzeigen? Feature aktiv + gespeichertes Team. Auch wenn
    // keine Transfers mehr übrig sind, zeigen wir das Panel (mit „aufgebraucht"),
    // statt der generischen „Einreichung gesperrt"-Ansicht.
    function isTransferEligible() {
        return !!(getTransferCfg() && editingTeamId);
    }

    // Pitch editierbar? Vor Turnierstart immer; nach Start nur im Transfer-Modus.
    function isBuilderEditable() {
        return !isTournamentStarted() || transferMode;
    }

    // Diff des aktuellen Teams gegenüber dem gespeicherten (Baseline).
    function computeTransferDiff() {
        const baselineIds = transferBaselineTeam ? Object.values(transferBaselineTeam).map(String) : [];
        const baseSet = new Set(baselineIds);
        const currentIds = Object.values(selectedTeam).map(String);
        const curSet = new Set(currentIds);
        const out = baselineIds.filter(id => !curSet.has(id));
        const inc = currentIds.filter(id => !baseSet.has(id));
        return { out, in: inc, currentIds };
    }

    // Ist dieser Spieler in der laufenden Transfer-Session NEU ins Team gekommen?
    // Vergleich rein per Spieler-ID → ein nur verschobener oder versehentlich
    // entfernter und wieder eingefügter Spieler gilt nicht als „neu".
    function isBuilderTransferIn(playerId) {
        if (!transferMode || !transferBaselineTeam) return false;
        const id = String(playerId);
        if (Object.values(transferBaselineTeam).map(String).indexOf(id) !== -1) return false;
        return Object.values(selectedTeam).map(String).indexOf(id) !== -1;
    }

    function enterTransferMode() {
        if (!isTransferEligible() || transferRemaining() <= 0) return;
        transferMode = true;
        renderAllSlots();
        renderMobileBuilder();
        updateTransferUI();
        const cfg = getTransferCfg();
        showToast(`🔄 Transfer-Modus: tausche bis zu ${cfg ? cfg.maxPlayersPerTransfer : 3} Spieler und bestätige.`);
    }

    function cancelTransferMode() {
        transferMode = false;
        if (transferBaselineTeam) {
            selectedTeam      = { ...transferBaselineTeam };
            selectedCaptainId = transferBaselineCaptain;
        }
        renderAllSlots();
        renderMobileBuilder();
        updatePickerHeader();
        renderPickerPlayers(true);
        validateForm();
        updateTransferUI();
        showToast('Transfer abgebrochen – dein Team ist unverändert.');
    }

    // Spiegelt Rest-Transfers, Änderungszähler und Button-Zustände wider.
    function updateTransferUI() {
        const cfg = getTransferCfg();
        const panel = document.getElementById('transfer-panel');
        if (!panel || !cfg) return;

        const remainingEl = document.getElementById('transfer-remaining');
        if (remainingEl) remainingEl.textContent = `Transfers übrig: ${transferRemaining()}/${cfg.totalTransfers}`;

        const idle = document.getElementById('transfer-idle');
        const active = document.getElementById('transfer-active');
        const idleNote = document.getElementById('transfer-idle-note');
        const maxEl = document.getElementById('transfer-max');
        if (maxEl) maxEl.textContent = String(cfg.maxPlayersPerTransfer);

        const startBtn = document.getElementById('transfer-start-btn');

        if (transferMode) {
            if (idle) idle.style.display = 'none';
            if (active) active.style.display = '';

            const { out, in: inc } = computeTransferDiff();
            const changesEl = document.getElementById('transfer-changes');
            if (changesEl) changesEl.textContent = String(out.length);

            const count = Object.keys(selectedTeam).length;
            const captainPlayer = selectedCaptainId != null ? getPlayerById(selectedCaptainId) : null;
            const hasValidCaptain = !CAPTAIN_ENABLED || (selectedCaptainId != null
                && Object.values(selectedTeam).map(String).includes(String(selectedCaptainId))
                && !!(captainPlayer && !captainPlayer.isOrphan));
            const orphanInTeam = getSelectedOrphanPlayers().length > 0;
            const okCount = out.length === inc.length && out.length >= 1 && out.length <= cfg.maxPlayersPerTransfer;

            const confirmBtn = document.getElementById('transfer-confirm-btn');
            if (confirmBtn) confirmBtn.disabled = !(count === 15 && hasValidCaptain && okCount && !orphanInTeam);

            const warnEl = document.getElementById('transfer-warn');
            if (warnEl) {
                let msg = '';
                if (out.length > cfg.maxPlayersPerTransfer) msg = `Zu viele Wechsel: ${out.length} (max. ${cfg.maxPlayersPerTransfer}). Bitte reduzieren.`;
                else if (count === 15 && out.length === 0) msg = 'Noch keine Änderung – tausche mindestens einen Spieler.';
                warnEl.textContent = msg;
                warnEl.style.display = msg ? 'block' : 'none';
            }
        } else {
            if (idle) idle.style.display = '';
            if (active) active.style.display = 'none';
            const remaining = transferRemaining();
            // Transfers aufgebraucht → „Transfer vornehmen" ausblenden und einen
            // eigenen Hinweis zeigen, statt der generischen Einreichungs-Sperre.
            if (startBtn) startBtn.style.display = remaining > 0 ? '' : 'none';
            if (idleNote) {
                idleNote.textContent = remaining > 0
                    ? `Das Turnier läuft. Du kannst dein Team noch per Transfer anpassen – bis zu ${cfg.maxPlayersPerTransfer} Spieler pro Transfer.`
                    : `Alle Transfers aufgebraucht (${cfg.totalTransfers}/${cfg.totalTransfers}). Dein Team ist für den Rest der Saison fixiert.`;
            }
            const remPill = document.getElementById('transfer-remaining');
            if (remPill) {
                remPill.style.background = remaining > 0 ? 'rgba(2,132,199,0.15)' : 'rgba(180,83,9,0.18)';
                remPill.style.color = remaining > 0 ? '#0369a1' : '#b45309';
            }
        }
    }

    async function confirmTransfer() {
        if (!transferMode) return;
        const cfg = getTransferCfg();
        if (!cfg) return;

        const managerNameVal = dom.managerName ? dom.managerName.value.trim() : '';
        const { out, in: inc } = computeTransferDiff();

        const check = window.TransferUtils.validateTransfer({
            config: cfg,
            usedTransfers: (loadedTransfers || []).length,
            currentTeamIds: transferBaselineTeam ? Object.values(transferBaselineTeam).map(String) : [],
            outPlayers: out,
            inPlayers: inc
        });
        if (!check.ok) { showToast('⚠️ ' + check.error); return; }

        const count = Object.keys(selectedTeam).length;
        const captainOk = !CAPTAIN_ENABLED || (selectedCaptainId != null
            && Object.values(selectedTeam).map(String).includes(String(selectedCaptainId)));
        const noOrphans = getSelectedOrphanPlayers().length === 0;
        if (count !== 15 || !captainOk || !noOrphans) {
            showToast(CAPTAIN_ENABLED
                ? '⚠️ Bitte vervollständige dein Team (15 Spieler, gültiger Captain).'
                : '⚠️ Bitte vervollständige dein Team (15 Spieler).');
            return;
        }

        const confirmBtn = document.getElementById('transfer-confirm-btn');
        if (confirmBtn) { confirmBtn.disabled = true; confirmBtn.textContent = '⏳ Speichere…'; }

        try {
            const entry = {
                at: Date.now(),
                out: out.map(String),
                in: inc.map(String),
                captain: CAPTAIN_ENABLED ? String(selectedCaptainId) : null
            };
            const transfers = (loadedTransfers || []).concat([entry]);
            const initialCaptain = CAPTAIN_ENABLED ? (loadedInitialCaptain || transferBaselineCaptain || null) : null;

            const payload = buildTeamPayload(managerNameVal);
            payload.transfers = transfers;
            if (initialCaptain != null) payload.initialCaptain = String(initialCaptain);

            transferMode = false; // während des Speicherns keine weiteren Edits
            await persistPayload(payload);
        } catch (e) {
            console.error('[TeamBuilder] Transfer fehlgeschlagen:', e);
            showToast('⚠️ Transfer konnte nicht gespeichert werden. Bitte Verbindung prüfen.');
            transferMode = true;
            if (confirmBtn) { confirmBtn.disabled = false; confirmBtn.textContent = '✓ Transfer bestätigen'; }
            updateTransferUI();
        }
    }

    /** Build the canonical Firestore payload from the current builder state.
     *
     * Note: Wir speichern bewusst einen kleinen *Snapshot* der Anzeigedaten
     * (photo, club, clubLogo) zusätzlich zur playerId. Damit bleibt eine
     * Spielerkarte auch dann visuell vollständig, wenn der Spieler später
     * komplett aus `playersData` verschwindet (Squad-Bereinigung, Pseudo-ID
     * wird durch echte API-ID ersetzt etc.). Pflichtfelder für die
     * Lookup-Identität bleiben weiterhin slot + playerId.
     */
    function buildTeamPayload(name) {
        const finalPlayers = Object.entries(selectedTeam).map(([slotId, playerId]) => {
            const player = getPlayerById(playerId);
            return {
                slot:      'slot-' + slotId,
                playerId:  player.id,
                name:      player.name,
                nation:    player.nation,
                pos:       player.position,
                photo:     player.photo || '',
                club:      player.club || '',
                clubLogo:  player.clubLogo || '',
                flag:      player.flag || '',
                isCaptain: CAPTAIN_ENABLED && String(player.id) === String(selectedCaptainId)
            };
        });
        return {
            manager:           name,
            managerNormalized: name.toLowerCase(),
            players:           finalPlayers
        };
    }

    function setSubmitBusy(busy, label) {
        if (!dom.submitBtn) return;
        dom.submitBtn.disabled    = busy || dom.submitBtn.disabled;
        dom.submitBtn.textContent = label || dom.submitBtn.textContent;
    }

    function setSubmitDefaultLabel() {
        if (!dom.submitBtn) return;
        /* Don't override the locked-state label after tournament start. */
        if (isTournamentStarted()) return;
        dom.submitBtn.textContent = editingTeamId ? SUBMIT_LABEL_UPDATE : SUBMIT_LABEL_CREATE;
    }

    /** Build a synthetic *orphan* player entry from a saved team-doc snapshot
     *  so the slot can still be rendered when the original player is no
     *  longer present in `playersData` (e.g. because the player was dropped
     *  in a kader update). The orphan is intentionally NOT added to
     *  `preparedPlayers`, so it never shows up in the picker — the user
     *  may keep it visible but cannot pick it again. The slot card uses
     *  `player.isOrphan` to render the "Bitte ersetzen" badge.
     */
    function buildOrphanPlayerFromSnapshot(savedPlayer) {
        if (!savedPlayer || savedPlayer.playerId == null) return null;
        const id = String(savedPlayer.playerId);
        const positionRaw = savedPlayer.pos || savedPlayer.position || '';
        return {
            raw:       null,
            id,
            name:      savedPlayer.name || 'Unbekannter Spieler',
            photo:     savedPlayer.photo || '',
            position:  normalizePosition(positionRaw),
            nation:    savedPlayer.nation || '?',
            flag:      savedPlayer.flag || '',
            club:      savedPlayer.club || '?',
            clubLogo:  savedPlayer.clubLogo || '',
            sortKey:   `${savedPlayer.nation || ''} ${savedPlayer.name || ''}`.toLowerCase(),
            searchKey: '',
            _idx:      -1,
            isOrphan:  true
        };
    }

    /** Load the user's existing team from Firestore into the builder. */
    async function loadUserTeamIntoBuilder(user) {
        if (!user || !user.emailVerified) return;
        try {
            const existing = await DreamTeamAuth.fetchUserTeam(user.uid);
            if (!existing) {
                editingTeamId = null;
                DreamTeamAuth.setLoadedTeamId(null);
                setSubmitDefaultLabel();
                return;
            }
            editingTeamId = existing.id;
            DreamTeamAuth.setLoadedTeamId(existing.id);

            const data = existing.data || {};

            /* Reconstruct the slot map from the saved players[] array.
             *
             * For each saved entry we resolve the player against the
             * current `playersData`. If we don't find one (e.g. the
             * player was removed from the kader after the team was
             * saved), we inject a synthetic *orphan* entry into the
             * lookup map. That keeps the slot visible (with name,
             * photo and club from the saved snapshot) and surfaces an
             * actionable warning to the manager — instead of silently
             * rendering an empty slot like before.
             */
            const newTeam = {};
            let newCaptain = null;
            const orphanList = [];
            (data.players || []).forEach(p => {
                const slotId = String(p.slot || '').replace(/^slot-/, '');
                if (!isValidSlotId(slotId)) return;
                const playerId = String(p.playerId);
                const resolvedPlayer = resolveSavedPlayer(p);
                const canonicalPlayerId = resolvedPlayer ? String(resolvedPlayer.id) : playerId;
                newTeam[slotId] = canonicalPlayerId;
                if (p.isCaptain) newCaptain = canonicalPlayerId;

                if (!resolvedPlayer && !playerById.has(playerId)) {
                    const orphan = buildOrphanPlayerFromSnapshot(p);
                    if (orphan) {
                        playerById.set(playerId, orphan);
                        orphanList.push(orphan);
                    }
                }
            });

            selectedTeam      = newTeam;
            selectedCaptainId = newCaptain;
            if (dom.managerName) dom.managerName.value = data.manager || '';

            /* Transfer-Baseline + bereits verbrauchte Transfers merken, damit
               ein späterer Transfer den Diff (raus/rein) korrekt bilden kann. */
            transferBaselineTeam    = { ...newTeam };
            transferBaselineCaptain = newCaptain;
            loadedTransfers         = Array.isArray(data.transfers) ? data.transfers : [];
            loadedInitialCaptain    = data.initialCaptain || null;
            transferMode            = false;

            renderAllSlots();
            renderMobileBuilder();
            updatePickerHeader();
            renderPickerPlayers(true);
            saveStateToLocal();
            validateForm();
            setSubmitDefaultLabel();
            /* Nach Laden ggf. das Transferfenster einblenden (Post-Start). */
            if (typeof applyTournamentClosedState === 'function') applyTournamentClosedState();

            /* Punkte + zeitgefensterte Transfer-Wertung: zeigt die Punkte pro
               Spieler und die ausgetauschten Spieler unter dem Feld. Sind die
               Punkte schon geladen, nur neu berechnen; sonst nachladen. */
            if (isTournamentStarted()) {
                if (builderPointsMap) {
                    computeBuilderTransferScoring();
                    renderAllSlots();
                    renderMobileBuilder();
                    renderBuilderTransferredOut();
                } else {
                    loadBuilderPoints();
                }
            }

            if (orphanList.length) {
                showBuilderNotice(buildRosterNotice(orphanList), 'roster-warning');
            } else {
                showToast('✏️ Dein Team wurde zur Bearbeitung geladen.');
            }
        } catch (err) {
            console.error('[TeamBuilder] Konnte Team nicht laden:', err);
            showToast('⚠️ Team konnte nicht geladen werden.');
        }
    }

    /** Save a payload to Firestore (create or update) and navigate to teams.html. */
    async function persistPayload(payload, { silent = false } = {}) {
        let result;
        try {
            result = await DreamTeamAuth.saveOrUpdateTeam(payload);
        } catch (err) {
            // Cross-provider duplicate guard: another team is already
            // registered for this e-mail. Surface a clear message and
            // forward the error so the caller can re-arm its UI state.
            if (err && err.code === 'team-exists-for-email') {
                showToast('⚠️ Unter dieser E-Mail-Adresse ist bereits ein Team erfasst.');
            }
            throw err;
        }

        /* Bump the meta doc so other clients refresh their cache.
         *
         * Wichtig: Wenn dieser Bump fehlschlägt (z.B. weil die Firestore
         * Rules ihn ablehnen), bleiben PWAs/Tabs auf anderen Geräten auf
         * ihrer lokal gecachten Teams-Liste sitzen, bis sich `teamsVersion`
         * im Meta-Dokument wieder erhöht. Das ist genau die Klasse von
         * Bug, die wir in der Vergangenheit gesehen haben (alte Teams
         * weiter sichtbar auf dem Handy nach Mutation am Laptop), deshalb
         * loggen wir Fehler hier laut und schlucken sie nicht stillschweigend. */
        try {
            const FieldValue = firebase.firestore.FieldValue;
            await db.collection(META_COLLECTION).doc(META_DOC_ID).set({
                year:           TOURNAMENT_YEAR,
                teamsVersion:   FieldValue.increment(1),
                teamsUpdatedAt: Date.now()
            }, { merge: true });
        } catch (err) {
            console.error('[TeamBuilder] teamsVersion-Bump fehlgeschlagen – andere Geräte sehen evtl. veraltete Teams:', err);
        }

        /* Clear local builder caches. */
        localStorage.removeItem(BUILDER_CACHE_KEY);
        try {
            if (window.DreamTeamCache && typeof DreamTeamCache.clearCache === 'function') {
                DreamTeamCache.clearCache({ db, year: TOURNAMENT_YEAR });
            }
        } catch (err) { /* ignore */ }
        sessionStorage.removeItem(SESSION_DATA_KEY);

        if (!silent) {
            showToast(result.mode === 'update' ? '✅ Team aktualisiert!' : '🎉 Team erfolgreich gespeichert!');
            setTimeout(() => {
                const targetUrl = new URL('teams.html', window.location.href);
                targetUrl.searchParams.set('manager', payload.manager);
                if (APP && APP.key) targetUrl.searchParams.set('tournament', APP.key);
                window.location.href = targetUrl.toString();
            }, 600);
        }

        return result;
    }

    /** Finalises a pending team after the user has verified their email. */
    async function tryFinalizePendingTeam() {
        if (pendingFinalize) return;
        if (!DreamTeamAuth.isSignedInAndVerified()) return;
        const pending = DreamTeamAuth.getPendingTeam();
        if (!pending) return;

        pendingFinalize = true;
        try {
            /* Route the write through DreamTeamAuth.saveOrUpdateTeam so the
               cross-provider duplicate guard ("one team per e-mail") fires
               here as well, not only on the direct submit path. Without
               this, a user could build a team while signed out, verify a
               fresh password account, and silently create a second team
               whose e-mail already owned one (created earlier via Google). */
            const result = await DreamTeamAuth.saveOrUpdateTeam(pending);
            DreamTeamAuth.setLoadedTeamId(result.id);
            DreamTeamAuth.clearPendingTeam();

            try {
                const FieldValue = firebase.firestore.FieldValue;
                await db.collection(META_COLLECTION).doc(META_DOC_ID).set({
                    year:           TOURNAMENT_YEAR,
                    teamsVersion:   FieldValue.increment(1),
                    teamsUpdatedAt: Date.now()
                }, { merge: true });
            } catch (err) {
                console.error('[TeamBuilder] teamsVersion-Bump nach E-Mail-Verifizierung fehlgeschlagen – andere Geräte sehen evtl. veraltete Teams:', err);
            }

            showToast(result.mode === 'update'
                ? '🎉 E-Mail bestätigt – Team aktualisiert!'
                : '🎉 E-Mail bestätigt – Team gespeichert!');
            setTimeout(() => {
                const targetUrl = new URL('teams.html', window.location.href);
                targetUrl.searchParams.set('manager', pending.manager);
                if (APP && APP.key) targetUrl.searchParams.set('tournament', APP.key);
                window.location.href = targetUrl.toString();
            }, 700);
        } catch (err) {
            console.error('[TeamBuilder] finalize failed:', err);
            if (err && err.code === 'team-exists-for-email') {
                /* Duplicate e-mail — clear the pending payload so the
                   visibilitychange/focus listeners don't keep retrying the
                   same write, and load the existing team into the builder
                   so the user can edit it instead of submitting again. */
                DreamTeamAuth.clearPendingTeam();
                showToast('⚠️ Unter dieser E-Mail-Adresse ist bereits ein Team erfasst. Dein bestehendes Team wird geladen.');
                const user = DreamTeamAuth.getCurrentUser();
                if (user) {
                    loadUserTeamIntoBuilder(user);
                }
            } else {
                showToast('⚠️ Konnte das Team nach Bestätigung nicht speichern.');
            }
        } finally {
            pendingFinalize = false;
        }
    }

    /* =========================================================
       SUBMIT
       ========================================================= */
    async function submitTeam() {
        if (isSubmitting) return;

        if (isTournamentStarted()) {
            showToast('⛔ Nach Turnierstart können keine neuen Teams mehr eingereicht werden.');
            return;
        }

        if (dom.duplicateWarning) dom.duplicateWarning.style.display = 'none';
        validateForm();

        const name          = dom.managerName ? dom.managerName.value.trim() : '';
        const count         = Object.keys(selectedTeam).length;
        const words         = name.split(' ').filter(w => w.length > 0);
        const isFullName    = words.length >= 2;
        const teamPlayerIds = Object.values(selectedTeam).map(String);
        const orphanPlayers = getSelectedOrphanPlayers();
        const captainPlayer = selectedCaptainId !== null ? getPlayerById(selectedCaptainId) : null;
        const hasValidCaptain = !CAPTAIN_ENABLED || (selectedCaptainId !== null
            && teamPlayerIds.includes(String(selectedCaptainId))
            && !!(captainPlayer && !captainPlayer.isOrphan));

        if (!(count === 15 && isFullName && hasValidCaptain && orphanPlayers.length === 0)) {
            if (orphanPlayers.length) {
                showBuilderNotice(buildRosterNotice(orphanPlayers), 'roster-warning');
            }
            validateForm();
            return;
        }

        isSubmitting = true;
        setSubmitBusy(true, '⏳ Speichere…');

        try {
            /* Duplicate manager-name check runs for both new and existing teams.
               When updating, the user's own document is ignored so that saving
               without a name change is still allowed. */
            const duplicateExists = await managerNameExists(name, editingTeamId);
            if (duplicateExists) {
                if (dom.duplicateWarning) dom.duplicateWarning.style.display = 'block';
                isSubmitting = false;
                setSubmitDefaultLabel();
                validateForm();
                return;
            }

            const payload = buildTeamPayload(name);

            if (DreamTeamAuth.isSignedInAndVerified()) {
                await persistPayload(payload);
                return;
            }

            /* Stash the team payload so it survives the verification flow. */
            DreamTeamAuth.setPendingTeam(payload);

            const currentUser = DreamTeamAuth.getCurrentUser();
            const modalMode   = currentUser && !currentUser.emailVerified ? 'verify' : 'chooser';

            DreamTeamAuthModal.open({
                mode: modalMode,
                onAuthenticated: ({ user, isVerified }) => {
                    /* If the user signed in with an already-verified account
                       we can finalise immediately. Otherwise the modal stays
                       on the verify view until they click the email link. */
                    if (isVerified) tryFinalizePendingTeam();
                }
            });

            isSubmitting = false;
            setSubmitDefaultLabel();
            validateForm();

        } catch (e) {
            console.error('[TeamBuilder] Submit fehlgeschlagen:', e);
            if (e && e.code === 'team-exists-for-email') {
                /* persistPayload already surfaced the user-facing toast.
                   Load the existing team into the builder so the user can
                   edit it in place instead of being stuck on a submission
                   that cannot succeed. */
                const user = DreamTeamAuth.getCurrentUser();
                if (user) loadUserTeamIntoBuilder(user);
            } else {
                showToast('⚠️ Fehler beim Speichern. Bitte Verbindung prüfen.');
            }
            isSubmitting = false;
            setSubmitDefaultLabel();
            validateForm();
        }
    }

    /* =========================================================
       AUTH BOOTSTRAP (lazy registration)
       ========================================================= */
    function initLazyAuth() {
        if (!window.DreamTeamAuth || !window.DreamTeamAuthModal) {
            console.warn('[TeamBuilder] Auth-Modul fehlt – Lazy-Registration deaktiviert.');
            return;
        }

        DreamTeamAuth.init({
            db,
            teamsCollection:   TEAMS_COLLECTION,
            pendingStorageKey: PENDING_TEAM_KEY,
            actionUrl:         window.location.origin + window.location.pathname
        });
        DreamTeamAuthModal.install();

        DreamTeamAuth.onAuthStateChange(({ user, isVerified }) => {
            if (!user) {
                editingTeamId = null;
                DreamTeamAuth.setLoadedTeamId(null);
                setSubmitDefaultLabel();
                return;
            }

            if (isVerified) {
                /* Verified + pending team → write it through and redirect. */
                if (DreamTeamAuth.hasPendingTeam()) {
                    tryFinalizePendingTeam();
                    return;
                }
                /* No pending team → user wants to edit their existing team. */
                if (!editingTeamId) {
                    loadUserTeamIntoBuilder(user);
                }
            }
        });
    }

    /* Initialise auth once the DOM and main IIFE are ready. */
    window.addEventListener('DOMContentLoaded', initLazyAuth);

    /* =========================================================
       TOURNAMENT CLOSED – UI LOCK
       =========================================================
       Die Sperre ist reaktiv: Beim ersten Aufruf (DOMContentLoaded) ist
       Firebase Auth meist noch nicht aufgelöst, deshalb gilt für ALLE
       Nutzer initial die Sperre nach Spielstart. Sobald sich der
       Admin-Status ändert (Login eines Admins → Override greift, oder
       Logout → Override fällt wieder weg), evaluieren wir den Zustand
       erneut und entsperren bzw. sperren die UI entsprechend.
       ========================================================= */
    function applyTournamentClosedState() {
        const closed = isTournamentStarted();
        // Nach Turnierstart die bereits erreichten Spieler-Punkte laden (einmalig),
        // damit sie auf den Karten erscheinen.
        if (closed) loadBuilderPoints();
        // Nach Turnierstart: statt reiner Sperre das Transferfenster anbieten,
        // wenn der Nutzer ein gespeichertes Team hat und noch Transfers übrig
        // sind (CL). Sonst wie bisher die Einreichungs-Sperre.
        const eligible = closed && isTransferEligible();
        const banner = document.getElementById('tournament-closed-banner');
        if (banner) banner.style.display = (closed && !eligible) ? 'flex' : 'none';

        const transferPanel = document.getElementById('transfer-panel');
        if (transferPanel) transferPanel.style.display = eligible ? 'block' : 'none';
        if (dom.submitCard) dom.submitCard.style.display = eligible ? 'none' : '';

        if (dom.submitBtn) {
            if (closed) {
                dom.submitBtn.disabled = true;
                dom.submitBtn.textContent = '⛔ Einreichung gesperrt';
                dom.submitBtn.setAttribute('aria-label', 'Einreichung gesperrt – Turnier hat begonnen');
            } else {
                dom.submitBtn.removeAttribute('aria-label');
                setSubmitDefaultLabel();
            }
        }

        if (dom.managerName) {
            if (closed) {
                dom.managerName.disabled = true;
                dom.managerName.placeholder = '⛔ Einreichung nach Turnierstart gesperrt';
            } else {
                dom.managerName.disabled = false;
                dom.managerName.placeholder = '';
            }
        }

        /* Beim Entsperren bestimmt validateForm() den korrekten
           disabled-Zustand des Submit-Buttons (15 Spieler, Captain,
           Manager-Name etc.). Beim Sperren bleibt disabled=true. */
        if (!closed) {
            validateForm();
        }

        if (eligible) updateTransferUI();
    }

    /**
     * Hängt sich an den Admin-Status (siehe admin.js / DreamTeamAdmin):
     * Der Dev-Override für Pre/Post-Spielstart wird ja nur dann
     * angewandt, wenn ein Admin angemeldet ist. Wenn sich das ändert
     * (Login / Logout / Admin-Status-Bestätigung nach Auth-Boot), muss
     * die Sperre neu ausgewertet werden – sonst bliebe ein Admin nach
     * Spielstart trotz "pre"-Override hinter der Sperre, und ein
     * frischer Logout aus dem Admin-Account würde nicht zur Sperre
     * zurückführen.
     */
    function bindTournamentLockToAdminState() {
        const Admin = window.DreamTeamAdmin;
        if (!Admin || typeof Admin.onAdminChange !== 'function') return;
        Admin.onAdminChange(() => {
            applyTournamentClosedState();
            updateLateSubmitToggle();
        });
    }

    /* =========================================================
       GLOBALER NACHZÜGLER-SCHALTER + ADMIN-DEV-KNOPF
       =========================================================
       Der Schalter lebt als Feld `lateSubmitOpen` im Meta-Dokument in
       Firestore und gilt damit für ALLE Nutzer: Legt der Admin ihn um,
       können auch normale (verifizierte) Nutzer trotz Turnierstart ein
       Team einreichen/ändern. Durchgesetzt wird das zusätzlich von den
       Firestore Rules (siehe firestore.rules → lateSubmitOpen()).

       Der Dev-Knopf, mit dem sich der Schalter umlegen lässt, ist nur
       für angemeldete Admins sichtbar (Admin-Gate wie beim Dev-Umschalter
       auf index.html). Das Schreiben ist zusätzlich in den Rules auf
       Admins beschränkt.
       ========================================================= */
    let lateSubmitToggleBusy = false;

    function updateLateSubmitToggle() {
        const btn = document.getElementById('dev-latesubmit-toggle');
        if (!btn) return;
        const Admin = window.DreamTeamAdmin;
        const isAdmin = !!(Admin && typeof Admin.isAdmin === 'function' && Admin.isAdmin());
        btn.classList.toggle('is-admin-visible', isAdmin);

        const on = !!lateSubmitOpen;
        btn.dataset.late = on ? 'on' : 'off';
        if (lateSubmitToggleBusy) {
            btn.textContent = 'DEV: Speichere…';
        } else {
            btn.textContent = on ? 'DEV: Einreichung offen ✓' : 'DEV: Einreichung gesperrt';
        }
        btn.setAttribute('aria-pressed', on ? 'true' : 'false');
        btn.disabled = lateSubmitToggleBusy;
    }

    /** Reagiert auf eine (lokale oder aus Firestore gepushte) Änderung des
     *  Nachzügler-Schalters: State übernehmen und die komplette
     *  Sperr-UI (Submit-Button, Manager-Name, Banner) neu auswerten. */
    function applyLateSubmitState(open) {
        const next = !!open;
        if (next === lateSubmitOpen) {
            updateLateSubmitToggle();
            return;
        }
        lateSubmitOpen = next;
        applyTournamentClosedState();
        updateLateSubmitToggle();
    }

    /** Live-Listener auf das Meta-Dokument: hält `lateSubmitOpen` für ALLE
     *  Clients synchron, sodass ein Admin-Umschalten sofort bei allen
     *  offenen Team-Buildern ankommt. */
    function subscribeLateSubmitFlag() {
        try {
            db.collection(META_COLLECTION).doc(META_DOC_ID).onSnapshot(
                (snap) => {
                    const data = (snap && snap.exists) ? snap.data() : null;
                    applyLateSubmitState(!!(data && data.lateSubmitOpen === true));
                },
                (err) => {
                    console.warn('[TeamBuilder] Meta-Listener (lateSubmitOpen) fehlgeschlagen:', err);
                }
            );
        } catch (err) {
            console.warn('[TeamBuilder] Konnte Meta-Listener nicht einrichten:', err);
        }
    }

    async function setLateSubmitFlag(open) {
        const FieldValue = firebase.firestore.FieldValue;
        await db.collection(META_COLLECTION).doc(META_DOC_ID).set({
            year:          TOURNAMENT_YEAR,
            lateSubmitOpen: !!open,
            // teamsVersion mit-bumpen, damit andere Clients ihren
            // Teams-Cache ohnehin frisch ziehen.
            teamsVersion:   FieldValue.increment(1),
            teamsUpdatedAt: Date.now()
        }, { merge: true });
    }

    function initLateSubmitToggle() {
        const btn = document.getElementById('dev-latesubmit-toggle');
        if (!btn) return;

        updateLateSubmitToggle();
        subscribeLateSubmitFlag();

        btn.addEventListener('click', async () => {
            const Admin = window.DreamTeamAdmin;
            const isAdmin = !!(Admin && typeof Admin.isAdmin === 'function' && Admin.isAdmin());
            if (!isAdmin || lateSubmitToggleBusy) return;

            const next = !lateSubmitOpen;
            lateSubmitToggleBusy = true;
            updateLateSubmitToggle();
            try {
                await setLateSubmitFlag(next);
                // Der onSnapshot-Listener übernimmt den neuen Zustand für
                // uns und alle anderen Clients; wir setzen ihn hier optimistisch
                // trotzdem, falls der Listener minimal verzögert feuert.
                lateSubmitToggleBusy = false;
                applyLateSubmitState(next);
                showToast(next
                    ? '🔓 Team-Einreichung ist jetzt für ALLE freigeschaltet (trotz Turnierstart).'
                    : '🔒 Team-Einreichung wieder für alle gesperrt.');
            } catch (err) {
                console.error('[TeamBuilder] Umschalten des Nachzügler-Schalters fehlgeschlagen:', err);
                lateSubmitToggleBusy = false;
                updateLateSubmitToggle();
                showToast('⚠️ Konnte den Schalter nicht speichern (nur Admins dürfen das).');
            }
        });
    }

    /* =========================================================
       SETUP & INIT
       ========================================================= */
    function setupUI() {
        loadStateFromLocal();

        if (!currentEditingSlotId) {
            currentEditingSlotId = getFirstAvailableSlotId();
        }

        renderNationFilterOptions();
        restoreSavedNationFilter();
        updateSearchClearButton();

        applyTournamentClosedState();
        bindTournamentLockToAdminState();
        initLateSubmitToggle();

        /* Button events */
        if (dom.clearTeamBtn) dom.clearTeamBtn.addEventListener('click', clearTeam);
        if (dom.submitBtn)    dom.submitBtn.addEventListener('click', submitTeam);

        /* CL-Transferfenster */
        const transferStartBtn = document.getElementById('transfer-start-btn');
        if (transferStartBtn) transferStartBtn.addEventListener('click', enterTransferMode);
        const transferConfirmBtn = document.getElementById('transfer-confirm-btn');
        if (transferConfirmBtn) transferConfirmBtn.addEventListener('click', confirmTransfer);
        const transferCancelBtn = document.getElementById('transfer-cancel-btn');
        if (transferCancelBtn) transferCancelBtn.addEventListener('click', cancelTransferMode);

        /* Manager name */
        if (dom.managerName) {
            dom.managerName.addEventListener('input', () => {
                if (dom.duplicateWarning) dom.duplicateWarning.style.display = 'none';
                saveStateToLocal();
                validateForm();
            });
        }

        /* Desktop pitch & bench interaction */
        if (dom.pitchContainer) dom.pitchContainer.addEventListener('click', handleSlotInteraction);
        const benchContainerEl = document.getElementById('bench-container') || document.getElementById('bench-slots');
        const benchEl = document.getElementById('bench-slots');
        if (benchEl && benchEl !== dom.pitchContainer) {
            benchEl.addEventListener('click', handleSlotInteraction);
        }

        /* Mobile builder — single delegated click + keydown handler (set up once to avoid accumulation) */
        if (dom.mobileBuilder) {
            dom.mobileBuilder.addEventListener('click', (e) => {
                /* Accordion toggle */
                const toggleEl = e.target.closest('[data-toggle-pos]');
                if (toggleEl) {
                    const section = toggleEl.closest('.mobile-position-section');
                    if (section) {
                        section.classList.toggle('open');
                        toggleEl.setAttribute('aria-expanded', section.classList.contains('open') ? 'true' : 'false');
                    }
                    return;
                }
                /* Slot interaction (open-slot, set-captain, remove-player) */
                handleSlotInteraction(e);
            });
            dom.mobileBuilder.addEventListener('keydown', (e) => {
                if (e.key !== 'Enter' && e.key !== ' ') return;
                const toggleEl = e.target.closest('[data-toggle-pos]');
                if (toggleEl) { e.preventDefault(); toggleEl.click(); return; }
                const slotEl = e.target.closest('[data-action="open-slot"]');
                if (slotEl) { e.preventDefault(); slotEl.click(); }
            });
        }

        /* Picker search & filters */
        if (dom.pickerSearch) {
            dom.pickerSearch.addEventListener('input', () => {
                saveStateToLocal();
                if (isMobileView()) renderMobileFilterChips();
                applyPickerFilters();
            });
        }

        if (dom.clearPickerSearch) {
            dom.clearPickerSearch.addEventListener('click', () => {
                if (dom.pickerSearch) dom.pickerSearch.value = '';
                saveStateToLocal();
                if (isMobileView()) renderMobileFilterChips();
                applyPickerFilters();
                if (dom.pickerSearch) dom.pickerSearch.focus();
            });
        }

        if (dom.clearAllPickerFilters) {
            dom.clearAllPickerFilters.addEventListener('click', () => {
                clearAllPickerFilters();
                saveStateToLocal();
                if (dom.pickerSearch) dom.pickerSearch.focus();
            });
        }

        if (dom.pickerNationFilter) {
            dom.pickerNationFilter.addEventListener('change', () => {
                saveStateToLocal();
                applyPickerFilters();
            });
        }

        if (dom.clearPickerFilters) {
            dom.clearPickerFilters.addEventListener('click', () => {
                clearAllPickerFilters();
                saveStateToLocal();
            });
        }

        /* Mobile filter chips – delegated click on chip wrap */
        if (dom.pickerFilterChips) {
            dom.pickerFilterChips.addEventListener('click', (e) => {
                const chip = e.target.closest('[data-chip-id]');
                if (chip) handleMobileFilterChipClick(chip.dataset.chipId);
            });
            dom.pickerFilterChips.addEventListener('keydown', (e) => {
                if (e.key !== 'Enter' && e.key !== ' ') return;
                const chip = e.target.closest('[data-chip-id]');
                if (chip) { e.preventDefault(); handleMobileFilterChipClick(chip.dataset.chipId); }
            });
        }

        /* Next-slot bar */
        if (dom.pickerNextSlotBar) {
            const handleNextSlot = () => {
                const nextSlotId = dom.pickerNextSlotBar.dataset.nextSlotId;
                if (nextSlotId) openSlotPicker(nextSlotId);
            };
            dom.pickerNextSlotBar.addEventListener('click', handleNextSlot);
            dom.pickerNextSlotBar.addEventListener('keydown', (e) => {
                if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); handleNextSlot(); }
            });
        }

        /* Infinite scroll */
        if (dom.pickerResults) {
            dom.pickerResults.addEventListener('scroll', () => {
                if (dom.pickerResults.scrollTop + dom.pickerResults.clientHeight >= dom.pickerResults.scrollHeight - 100) {
                    appendNextPickerBatch();
                }
            });
        }

        /* Picker close */
        if (dom.pickerCloseBtn) dom.pickerCloseBtn.addEventListener('click', () => closeMobilePickerWithHistory({ pushHistory: true }));

        if (dom.pickerHost) {
            dom.pickerHost.addEventListener('click', (e) => {
                if (!isMobileView()) return;
                if (e.target === dom.pickerHost) closeMobilePickerWithHistory({ pushHistory: true });
            });
        }

        /* Escape key closes picker */
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape' && dom.pickerHost && dom.pickerHost.classList.contains('mobile-open')) {
                closeMobilePickerWithHistory({ pushHistory: true });
            }
        });

        /* Next-slot action button (mobile floating bar) */
        if (dom.nextSlotAction) {
            const handleNextSlotAction = () => {
                const nextSlotId = dom.nextSlotAction.dataset.nextSlotId;
                if (!nextSlotId) return;
                clearTimeout(nextSlotActionTimer);
                dom.nextSlotAction.classList.remove('visible');
                openSlotPicker(nextSlotId);
            };
            dom.nextSlotAction.addEventListener('click', handleNextSlotAction);
            dom.nextSlotAction.addEventListener('keydown', (e) => {
                if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); handleNextSlotAction(); }
            });
        }

        /* Resize */
        window.addEventListener('resize', () => {
            if (!isMobileView()) closeMobilePickerWithHistory({ pushHistory: false });
            syncPanelHeights();
            fillPickerUntilScrollable();
        });
        window.addEventListener('popstate', (event) => {
            if (event.state?.dtPopupId === MOBILE_PICKER_POPUP_ID && isMobileView()) {
                const slotId = event.state.currentEditingSlotId;
                if (slotId) openSlotPicker(slotId);
                return;
            }
            closeMobilePickerWithHistory({ pushHistory: false });
        });

        /* Initial render */
        renderAllSlots();
        renderMobileBuilder();
        updatePickerHeader();
        renderMobileFilterChips();
        renderPickerPlayers(true);
        syncPanelHeights();
        initTiltObserver();

        if (pendingBuilderNotice) {
            showBuilderNotice(pendingBuilderNotice);
        }
    }

    window.addEventListener('DOMContentLoaded', setupUI);

    /* Re-init tilt after bfcache restore */
    window.addEventListener('pageshow', () => setTimeout(() => initCardTilt(), 100));
    document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible') setTimeout(() => initCardTilt(), 80);
    });

})();
