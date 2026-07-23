/* teams.js – Haupt-Seitenskript, aus teams.html extrahiert (Performance Phase 2).
   Wird als klassisches Skript an unveraenderter Position am Body-Ende geladen –
   die Ausfuehrungs-Reihenfolge relativ zu den uebrigen Skripten ist identisch. */

    const APP = window.APP_CONFIG;

    if (!APP) {
        throw new Error("APP_CONFIG fehlt. Lade tournament-config.js vor teams.html.");
    }

    const TOURNAMENT_YEAR  = APP.year;
    const TOURNAMENT_LABEL = APP.tournamentLabel;
    const PAGE_TITLE_PREFIX = APP.pageTitlePrefix;
    const CARD_BASE_TRANSFORM = 'perspective(1000px) rotateX(0deg) rotateY(0deg) scale3d(1, 1, 1)';
    const MANAGER_STORAGE_KEY = APP.storage.key("lastViewedManager");
    // Einmal-Migration des historischen, un­gepräfixten Keys auf den
    // turnier-namespaceten Key. Danach wird der Legacy-Key nie wieder
    // geschrieben und ist endgültig aus dem LocalStorage entfernt.
    APP.storage.migrate("lastViewedManager", "lastViewedManager");

    const db = APP.getDb();

    document.title = `${PAGE_TITLE_PREFIX} - Teams`;

    // Set hero tournament label
    const heroLabelEl = document.getElementById('hero-tournament-label');
    if (heroLabelEl) heroLabelEl.textContent = TOURNAMENT_LABEL;

    let allTeams = [];
    let playerPointsData = {};
    let playerPointDocs = {};
    let fixturesData = {};
    // Captain-Feature aktiv? (WM ja, CL nein – siehe tournament-config.js)
    const CAPTAIN_ENABLED = !(window.APP_CONFIG && window.APP_CONFIG.captainEnabled === false);
    // Fixture-basierter Nationen-Lebenszyklus (siehe APP_CONFIG.getNationStatus).
    // Bestimmt, welche Spieler noch im Turnier sind (Nation nicht ausgeschieden).
    let nationLifecycle = null;
    let badgeSnapshotsData = null;
    let globalPickCounts = {};
    let perfectTeamIds = new Set();
    let metaUnsubscribe = null;
    let hasRenderedOnce = false;
    let isMetaRefreshRunning = false;
    let modalPickerInitialized = false;
    let badgeCatalogInitialized = false;
    let badgeCatalogLastTrigger = null;
    let badgeCatalogCloseTimer = null;
    let currentTeamBadgeIds = new Set();
    let currentTeamBadgeOrder = [];
    let currentTeamFallbackBadges = [];

    const CACHE_OPTIONS = {
        db,
        year: TOURNAMENT_YEAR,
        includeFixtures: true,
        allowEmptyPoints: true,
        log: false
    };

    /* =====================================================
       STORAGE HELPERS
       ===================================================== */
    function getStoredManagerName() {
        try {
            return localStorage.getItem(MANAGER_STORAGE_KEY);
        } catch (err) {
            return null;
        }
    }

    function setStoredManagerName(managerName) {
        if (!managerName) return;
        try {
            localStorage.setItem(MANAGER_STORAGE_KEY, managerName);
        } catch (err) {
            // Storage kann in Privacy-Modi blockiert sein – kein Hard-Fail.
        }
    }

    /* =====================================================
       ANIMATE VALUE
       ===================================================== */
    function animateValue(id, start, end, duration, suffix) {
        const obj = document.getElementById(id);
        if (!obj) return;

        let startTimestamp = null;
        const step = (timestamp) => {
            if (!startTimestamp) startTimestamp = timestamp;
            const progress = Math.min((timestamp - startTimestamp) / duration, 1);
            const current = Math.floor(progress * (end - start) + start);
            obj.innerHTML = current + suffix;
            if (progress < 1) window.requestAnimationFrame(step);
        };
        window.requestAnimationFrame(step);
    }

    /* =====================================================
       DATA PROCESSING
       ===================================================== */
    // HTML-Escape für alle Werte, die wir per Template-String in
    // innerHTML/insertAdjacentHTML einfügen. Die Team-Dokumente in
    // Firestore enthalten u.a. den vom User gespeicherten Spielernamen
    // und – historisch – auch Foto-URL, Nation und Club. Ohne Escaping
    // wäre ein manipuliertes Team-Dokument ein Stored-XSS-Vektor für
    // alle Besucher dieser Seite.
    function escapeHtml(v) {
        return String(v ?? '')
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#039;');
    }

    function toSafeClassToken(value) {
        return String(value || 'badge')
            .toLowerCase()
            .replace(/[^a-z0-9_-]+/g, '-')
            .replace(/^-+|-+$/g, '') || 'badge';
    }

    function getBadgeCatalogApi() {
        return window.DreamTeamBadges || null;
    }

    function getBadgeCatalogItems() {
        const api = getBadgeCatalogApi();
        if (api && typeof api.getCatalog === 'function') return api.getCatalog();
        return Array.isArray(window.BADGE_CATALOG) ? window.BADGE_CATALOG.slice() : [];
    }

    function getResolvedBadge(input) {
        const api = getBadgeCatalogApi();
        if (api && typeof api.resolveBadge === 'function') return api.resolveBadge(input);
        const label = typeof input === 'object' && input
            ? (input.label || input.id || 'Badge')
            : (String(input || '').trim() || 'Badge');
        const id = toSafeClassToken(label);
        return {
            id: `unknown-${id}`,
            label,
            emoji: '🏷️',
            description: 'Eine besondere Auszeichnung für dieses Team.',
            howToEarn: 'Bleib im Turnier aktiv; die genaue Bedingung ergibt sich aus der laufenden Wertung.',
            category: 'Weitere',
            tone: 'neutral',
            style: 'neutral',
            isFallback: true
        };
    }

    function resolveBadgeForAward(award) {
        const resolved = getResolvedBadge({
            id: award && (award.id || award.type),
            type: award && award.type,
            label: award && award.label
        });
        if (!resolved.isFallback) return resolved;
        return {
            ...resolved,
            label: (award && award.label) || resolved.label,
            emoji: (award && award.emoji) || resolved.emoji
        };
    }

    function getBadgeEmoji(badge) {
        return (badge && (badge.emoji || badge.icon)) || '🏷️';
    }

    function getBadgeAwardContext() {
        return {
            rules: APP.rules,
            playersData: typeof playersData !== 'undefined' ? playersData : [],
            pickCounts: globalPickCounts,
            perfectTeamIds
        };
    }

    function getTeamBadgeAwards(team) {
        const api = getBadgeCatalogApi();
        if (!api || typeof api.getBadgesForTeam !== 'function' || !team) return [];

        const awards = api.getBadgesForTeam(
            team,
            allTeams,
            playerPointDocs,
            fixturesData,
            badgeSnapshotsData,
            getBadgeAwardContext()
        );

        const resolvedAwards = awards.map(award => ({
            ...award,
            badge: resolveBadgeForAward(award)
        }));
        const uniqueResolvedAwards = [];
        const seenAwardIds = new Set();

        resolvedAwards.forEach((award) => {
            const badgeId = award && award.badge && award.badge.id;
            if (!badgeId || seenAwardIds.has(badgeId)) return;
            seenAwardIds.add(badgeId);
            uniqueResolvedAwards.push(award);
        });

        return uniqueResolvedAwards;
    }

    function buildBadgeCatalogOwnership() {
        const ownership = new Map();

        (allTeams || []).forEach((team) => {
            getTeamBadgeAwards(team).forEach((award) => {
                const badgeId = award && award.badge && award.badge.id;
                if (!badgeId) return;
                if (!ownership.has(badgeId)) ownership.set(badgeId, []);
                ownership.get(badgeId).push({
                    manager: team.manager,
                    award
                });
            });
        });

        ownership.forEach((owners) => {
            owners.sort((a, b) => String(a.manager || '').localeCompare(String(b.manager || ''), 'de'));
        });

        return ownership;
    }

    function buildFavoriteClubSummary() {
        const clubs = new Map();

        (allTeams || []).forEach((team) => {
            const favorite = team && team.favoriteClub;
            if (!favorite || !favorite.name || favorite.count < 2) return;

            const key = String(favorite.name);
            if (!clubs.has(key)) {
                clubs.set(key, {
                    name: key,
                    logo: favorite.logo || '',
                    managers: [],
                    playerCount: 0
                });
            }

            const entry = clubs.get(key);
            entry.managers.push(team.manager);
            entry.playerCount += Number(favorite.count) || 0;
            if (!entry.logo && favorite.logo) entry.logo = favorite.logo;
        });

        return Array.from(clubs.values()).sort((a, b) => {
            if (b.managers.length !== a.managers.length) return b.managers.length - a.managers.length;
            return a.name.localeCompare(b.name, 'de');
        });
    }

    function formatAwardDetailSummary(award) {
        const details = Array.isArray(award && award.details) ? award.details : [];
        const detailText = details
            .filter(item => item && item.label && item.value)
            .map(item => `${item.label}: ${item.value}`)
            .join(' · ');
        return detailText || (award && award.title) || '';
    }

    function getBadgeOwnerCountLabel(badge, ownerEntries, clubSummary) {
        if (badge && badge.id === 'club') {
            const clubCount = clubSummary.length;
            if (clubCount === 1) return '1 Lieblingsclub';
            return clubCount > 1 ? `${clubCount} Lieblingsclubs` : 'Noch offen';
        }

        const ownerCount = ownerEntries.length;
        if (ownerCount === 1) return '1 Manager';
        return ownerCount > 1 ? `${ownerCount} Manager` : 'Noch offen';
    }

    function buildBadgeManagerListHtml(ownerEntries) {
        if (!ownerEntries.length) {
            return '<span class="badge-catalog-empty">Noch nicht vergeben.</span>';
        }

        return ownerEntries.map(({ manager, award }) => {
            const managerName = String(manager || 'Manager');
            const href = `teams.html?manager=${encodeURIComponent(managerName)}`;
            const meta = formatAwardDetailSummary(award);
            const title = meta ? `${managerName} · ${meta}` : managerName;
            return `
                <a class="badge-manager-link" href="${escapeHtml(href)}" data-manager-name="${escapeHtml(managerName)}" title="${escapeHtml(title)}">
                    <span class="badge-manager-name">${escapeHtml(managerName)}</span>
                    ${meta ? `<span class="badge-manager-meta">${escapeHtml(meta)}</span>` : ''}
                </a>
            `;
        }).join('');
    }

    function buildFavoriteClubListHtml(clubSummary) {
        if (!clubSummary.length) {
            return '<span class="badge-catalog-empty">Noch kein Lieblingsclub-Badge vergeben.</span>';
        }

        return clubSummary.map((club) => {
            const managerCount = club.managers.length;
            const managerLabel = managerCount === 1 ? '1 Manager' : `${managerCount} Manager`;
            const playerLabel = club.playerCount === 1 ? '1 Spieler' : `${club.playerCount} Spieler`;
            const countLabel = `${managerLabel} · ${playerLabel}`;
            const title = `${club.name}: ${countLabel}`;
            return `
                <span class="badge-club-item" title="${escapeHtml(title)}">
                    ${club.logo ? `<img class="badge-club-logo" src="${escapeHtml(club.logo)}" alt="" aria-hidden="true" loading="lazy" width="18" height="18">` : ''}
                    <span class="badge-club-name">${escapeHtml(club.name)}</span>
                    <span class="badge-club-count">${escapeHtml(countLabel)}</span>
                </span>
            `;
        }).join('');
    }

    function buildBadgeDetailsHtml(badge, ownerEntries, clubSummary) {
        const description = String(badge.description || '').trim();
        const ownerSection = badge.id === 'club'
            ? `
                <div class="badge-catalog-section">
                    <div class="badge-catalog-section-title">Lieblingsclubs</div>
                    <div class="badge-club-list">${buildFavoriteClubListHtml(clubSummary)}</div>
                </div>
            `
            : `
                <div class="badge-catalog-section">
                    <div class="badge-catalog-section-title">Manager</div>
                    <div class="badge-manager-list">${buildBadgeManagerListHtml(ownerEntries)}</div>
                </div>
            `;

        return `
            ${description ? `<p class="badge-catalog-description">${escapeHtml(description)}</p>` : ''}
            ${ownerSection}
        `;
    }

    function buildBadgeCatalogCards(activeBadge) {
        const catalog = getBadgeCatalogItems().map(item => getResolvedBadge(item));
        const items = [];
        const seen = new Set();

        catalog.forEach((badge) => {
            if (!badge || seen.has(badge.id)) return;
            items.push(badge);
            seen.add(badge.id);
        });

        currentTeamFallbackBadges.forEach((badge) => {
            if (!badge || seen.has(badge.id)) return;
            items.push(badge);
            seen.add(badge.id);
        });

        if (activeBadge && !seen.has(activeBadge.id)) {
            items.push(activeBadge);
            seen.add(activeBadge.id);
        }

        const orderIndex = (badge) => {
            const index = currentTeamBadgeOrder.indexOf(badge && badge.id);
            return index === -1 ? Number.MAX_SAFE_INTEGER : index;
        };

        return items.sort((a, b) => {
            const aCurrent = currentTeamBadgeIds.has(a.id);
            const bCurrent = currentTeamBadgeIds.has(b.id);
            const aActive = activeBadge && a.id === activeBadge.id;
            const bActive = activeBadge && b.id === activeBadge.id;

            if (aCurrent !== bCurrent) return aCurrent ? -1 : 1;
            if (aCurrent && bCurrent && aActive !== bActive) return aActive ? -1 : 1;
            if (aCurrent && bCurrent) return orderIndex(a) - orderIndex(b);
            if (aActive !== bActive) return aActive ? -1 : 1;
            return 0;
        });
    }

    function renderBadgeCatalogGrid(activeBadgeInput) {
        const grid = document.getElementById('badge-catalog-grid');
        if (!grid) return;

        const activeBadge = getResolvedBadge(activeBadgeInput);
        const items = buildBadgeCatalogCards(activeBadge);
        const ownership = buildBadgeCatalogOwnership();
        const clubSummary = buildFavoriteClubSummary();
        grid.innerHTML = items.map((badge, index) => {
            const isCurrent = currentTeamBadgeIds.has(badge.id);
            const isActive = badge.id === activeBadge.id;
            const isExpanded = isActive;
            const tone = toSafeClassToken(badge.tone || badge.style || 'neutral');
            const delay = Math.min(index, 6) * 24;
            const ownerEntries = ownership.get(badge.id) || [];
            const panelId = `badge-catalog-panel-${toSafeClassToken(badge.id)}`;
            const ownerCountLabel = getBadgeOwnerCountLabel(badge, ownerEntries, clubSummary);
            const classes = [
                'badge-catalog-card',
                isCurrent ? 'is-current' : '',
                isActive ? 'is-active' : '',
                isExpanded ? 'is-expanded' : ''
            ].filter(Boolean).join(' ');

            return `
                <article class="${classes}" data-badge-id="${escapeHtml(badge.id)}" data-tone="${escapeHtml(tone)}" style="--badge-card-delay:${delay}ms">
                    <button type="button" class="badge-catalog-toggle" aria-expanded="${isExpanded ? 'true' : 'false'}" aria-controls="${escapeHtml(panelId)}">
                        <div class="badge-catalog-card-top">
                            <span class="badge-catalog-icon" aria-hidden="true">${escapeHtml(getBadgeEmoji(badge))}</span>
                            <div>
                                <div class="badge-catalog-name-row">
                                    <div class="badge-catalog-name">${escapeHtml(badge.label)}</div>
                                    ${isCurrent ? '<span class="badge-catalog-status">Aktuell erhalten</span>' : ''}
                                </div>
                                <span class="badge-catalog-owner-count">${escapeHtml(ownerCountLabel)}</span>
                            </div>
                            <span class="badge-catalog-chevron" aria-hidden="true">⌄</span>
                        </div>
                    </button>
                    <div class="badge-catalog-panel" id="${escapeHtml(panelId)}" ${isExpanded ? '' : 'hidden'}>
                        ${buildBadgeDetailsHtml(badge, ownerEntries, clubSummary)}
                    </div>
                </article>
            `;
        }).join('');
    }

    function toggleBadgeCatalogCard(toggle) {
        const card = toggle && toggle.closest('.badge-catalog-card');
        if (!card) return;
        const panelId = toggle.getAttribute('aria-controls');
        const panel = panelId ? document.getElementById(panelId) : null;
        const isExpanded = toggle.getAttribute('aria-expanded') === 'true';

        toggle.setAttribute('aria-expanded', isExpanded ? 'false' : 'true');
        card.classList.toggle('is-expanded', !isExpanded);
        if (panel) panel.hidden = isExpanded;
    }

    function getBadgeCatalogAnimationMs(closing) {
        const reduced = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
        if (reduced) return 1;
        return closing ? 150 : 220;
    }

    function isBadgeCatalogOpen() {
        const overlay = document.getElementById('badge-catalog-overlay');
        return !!overlay && overlay.classList.contains('is-open');
    }

    function openBadgeCatalogModal(badgeInput, trigger) {
        const overlay = document.getElementById('badge-catalog-overlay');
        const modal = document.getElementById('badge-catalog-modal');
        if (!overlay || !modal) return;

        const activeBadge = getResolvedBadge(badgeInput);
        renderBadgeCatalogGrid(activeBadge);
        badgeCatalogLastTrigger = trigger || document.activeElement;

        if (badgeCatalogCloseTimer) {
            clearTimeout(badgeCatalogCloseTimer);
            badgeCatalogCloseTimer = null;
        }

        overlay.classList.remove('is-closing');
        overlay.setAttribute('aria-hidden', 'false');
        document.body.classList.add('modal-open');

        requestAnimationFrame(() => {
            overlay.classList.add('is-open');
            try { modal.focus({ preventScroll: true }); } catch (err) { modal.focus(); }

            const grid = document.getElementById('badge-catalog-grid');
            const activeCard = grid
                ? Array.from(grid.querySelectorAll('.badge-catalog-card')).find(card => card.dataset.badgeId === activeBadge.id)
                : null;
            if (activeCard) {
                setTimeout(() => activeCard.scrollIntoView({ block: 'nearest' }), getBadgeCatalogAnimationMs(false));
            }
        });
    }

    function closeBadgeCatalogModal() {
        const overlay = document.getElementById('badge-catalog-overlay');
        if (!overlay || !overlay.classList.contains('is-open')) return;

        overlay.classList.add('is-closing');
        overlay.classList.remove('is-open');
        if (!isTeamPickerOpen()) document.body.classList.remove('modal-open');

        const returnFocusTo = badgeCatalogLastTrigger;
        badgeCatalogCloseTimer = setTimeout(() => {
            overlay.classList.remove('is-closing');
            overlay.setAttribute('aria-hidden', 'true');
            badgeCatalogCloseTimer = null;
            if (returnFocusTo && typeof returnFocusTo.focus === 'function' && document.contains(returnFocusTo)) {
                try { returnFocusTo.focus({ preventScroll: true }); } catch (err) { returnFocusTo.focus(); }
            }
            badgeCatalogLastTrigger = null;
        }, getBadgeCatalogAnimationMs(true));
    }

    function trapBadgeCatalogFocus(event) {
        const modal = document.getElementById('badge-catalog-modal');
        if (!modal) return;

        const focusable = Array.from(modal.querySelectorAll('a[href], button:not([disabled]), textarea, input, select, [tabindex]:not([tabindex="-1"])'))
            .filter(el => !el.hasAttribute('disabled') && el.offsetParent !== null);
        if (!focusable.length) {
            event.preventDefault();
            modal.focus();
            return;
        }

        const first = focusable[0];
        const last = focusable[focusable.length - 1];
        if (event.shiftKey && document.activeElement === first) {
            event.preventDefault();
            last.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
            event.preventDefault();
            first.focus();
        }
    }

    function initBadgeCatalogModalEvents() {
        if (badgeCatalogInitialized) return;
        badgeCatalogInitialized = true;

        const awardsEl = document.getElementById('manager-awards');
        const overlay = document.getElementById('badge-catalog-overlay');
        const closeBtn = document.getElementById('badge-catalog-close');

        if (awardsEl) {
            awardsEl.addEventListener('click', (event) => {
                const badgeButton = event.target.closest('.manager-award');
                if (!badgeButton) return;
                openBadgeCatalogModal({
                    id: badgeButton.dataset.badgeId,
                    label: badgeButton.dataset.badgeLabel
                }, badgeButton);
            });
        }

        if (closeBtn) {
            closeBtn.addEventListener('click', closeBadgeCatalogModal);
        }

        if (overlay) {
            overlay.addEventListener('click', (event) => {
                const managerLink = event.target.closest('.badge-manager-link');
                if (managerLink) {
                    const managerName = managerLink.dataset.managerName || '';
                    const targetTeam = allTeams.find(team => team.manager === managerName);
                    if (targetTeam) {
                        event.preventDefault();
                        closeBadgeCatalogModal();
                        selectManager(targetTeam);
                    }
                    return;
                }

                const toggle = event.target.closest('.badge-catalog-toggle');
                if (toggle) {
                    event.preventDefault();
                    toggleBadgeCatalogCard(toggle);
                    return;
                }

                if (event.target === overlay) closeBadgeCatalogModal();
            });
        }

        document.addEventListener('keydown', (event) => {
            if (!isBadgeCatalogOpen()) return;
            if (event.key === 'Escape') {
                event.preventDefault();
                closeBadgeCatalogModal();
            } else if (event.key === 'Tab') {
                trapBadgeCatalogFocus(event);
            }
        });
    }

    function buildPlayerPointsMap(rawPoints) {
        playerPointsData = {};
        playerPointDocs = rawPoints && typeof rawPoints === 'object' && !Array.isArray(rawPoints) ? rawPoints : {};
        Object.entries(rawPoints || {}).forEach(([id, docData]) => {
            playerPointsData[id] = window.DreamTeamPoints && typeof window.DreamTeamPoints.getPlayerTotal === 'function'
                ? window.DreamTeamPoints.getPlayerTotal(docData)
                : (docData && typeof docData.totalPoints === 'number' ? docData.totalPoints : 0);
        });
    }

    function normalizePosition(pos) {
        const upper = String(pos || '').toUpperCase();
        if (upper === 'FORWARD') return 'ATTACKER';
        return upper || 'UNKNOWN';
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

    function getPlayerByStoredSnapshot(savedPlayer) {
        if (!savedPlayer || !savedPlayer.name) return null;
        __dtEnsurePlayerIndexes();
        const list = __dtPlayerIndexByName.get(savedPlayer.name);
        if (!list) return null;
        for (let i = 0; i < list.length; i++) {
            const pd = list[i];
            if (!savedPlayer.nation || (pd['Nationalteam.name'] || '') === savedPlayer.nation) return pd;
        }
        return null;
    }

    function resolveStoredPlayer(savedPlayer) {
        const byId = getPlayerById(savedPlayer && savedPlayer.playerId);
        if (byId && (!savedPlayer || !savedPlayer.name || byId.Spielername === savedPlayer.name)) return byId;
        return getPlayerByStoredSnapshot(savedPlayer) || byId;
    }

    function getFavoriteClubAwardData(mergedPlayers) {
        const clubMap = {};
        (mergedPlayers || []).forEach(player => {
            if (!player.club || player.club === '?' || player.club === 'Vereinslos') return;
            if (!clubMap[player.club]) {
                clubMap[player.club] = { name: player.club, logo: player.clubLogo || '', count: 0, points: 0 };
            }
            clubMap[player.club].count += 1;
            clubMap[player.club].points += player.pts;
        });
        const clubs = Object.values(clubMap);
        if (!clubs.length) return null;
        clubs.sort((a, b) => b.count !== a.count ? b.count - a.count : b.points - a.points);
        return clubs[0].count >= 2 ? clubs[0] : null;
    }

    function timestampToMillis(value) {
        if (!value) return 0;
        if (typeof value.toMillis === 'function') {
            const ms = Number(value.toMillis());
            if (Number.isFinite(ms)) return ms;
        }
        if (typeof value.toDate === 'function') {
            const date = value.toDate();
            const ms = date instanceof Date ? date.getTime() : NaN;
            if (Number.isFinite(ms)) return ms;
        }
        if (value instanceof Date) {
            const ms = value.getTime();
            return Number.isFinite(ms) ? ms : 0;
        }
        if (typeof value === 'number') return Number.isFinite(value) ? value : 0;
        if (typeof value === 'string') {
            const parsed = Date.parse(value);
            return Number.isFinite(parsed) ? parsed : 0;
        }
        if (typeof value === 'object') {
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
        return String(a && a.manager || '').localeCompare(String(b && b.manager || ''), 'de');
    }

    // Anpfiff je Spiel (ms) für die zeitbasierte Transfer-Wertung.
    function teamsFixtureKickoffMs(fixture) {
        if (!fixture || typeof fixture !== 'object') return null;
        const ts = Number(fixture.kickoffTimestamp);
        if (Number.isFinite(ts) && ts > 0) return ts > 10000000000 ? ts : ts * 1000;
        const raw = fixture.kickoffIso || fixture.date || fixture.datetime || fixture.kickoff || '';
        if (raw) { const p = Date.parse(raw); if (Number.isFinite(p)) return p; }
        return null;
    }
    function teamsFindFixture(fixtures, matchId) {
        const map = fixtures || {};
        const direct = map[matchId] || map[String(matchId)];
        if (direct && typeof direct === 'object') return direct;
        const target = String(matchId);
        for (const fx of Object.values(map)) {
            if (fx && typeof fx === 'object' && String(fx.fixtureId) === target) return fx;
        }
        return null;
    }

    function enrichTeamsWithScores(rawTeams) {
        const teams = Array.isArray(rawTeams) ? rawTeams : [];

        // Geteilter Kontext für die zeitbasierte Wertung (nur bei Bedarf gebaut):
        // Punkte je Spiel je Spieler + Anpfiff je Spiel (gecacht).
        const TU = window.TransferUtils, DP = window.DreamTeamPoints;
        let sharedPmp = null, kickoffFn = null;
        function ensureTransferScoring() {
            if (sharedPmp) return;
            sharedPmp = {};
            if (DP && typeof DP.getPlayerMatchTotals === 'function') {
                Object.keys(playerPointDocs || {}).forEach(id => {
                    sharedPmp[id] = DP.getPlayerMatchTotals(playerPointDocs[id]);
                });
            }
            const cache = Object.create(null);
            kickoffFn = (matchId) => {
                const key = String(matchId);
                if (key in cache) return cache[key];
                cache[key] = teamsFixtureKickoffMs(teamsFindFixture(fixturesData, matchId));
                return cache[key];
            };
        }

        return teams.map(team => {
            const mergedPlayers = (team.players || []).map((p, idx) => {
                const fullP = resolveStoredPlayer(p);

                const slotNum = p.slot ? parseInt(String(p.slot).replace('slot-', ''), 10) : -1;
                // Live-Position aus playersData bevorzugen, damit manuelle
                // Overrides aus position-overrides.js auch in bereits
                // gespeicherten Teams sofort greifen. Auf den im Team
                // gespeicherten p.pos fallen wir nur zurück, wenn der Spieler
                // nicht mehr im aktuellen Kader gefunden wird.
                const pos = normalizePosition((fullP && fullP.Position) || p.pos || 'UNKNOWN');
                const basePts = fullP ? (playerPointsData[fullP['player.id']] || 0) : 0;
                // Captain nur, wenn das Turnier ihn nutzt (WM). In der CL gibt
                // es keinen Captain → kein ×2 und kein „C"-Badge, auch nicht bei
                // Alt-Teams mit gespeichertem Captain.
                const isCap = CAPTAIN_ENABLED && !!p.isCaptain;
                const finalPts = isCap ? basePts * 2 : basePts;

                // Stored-XSS-Härtung: Anzeigewerte stammen primär aus den
                // kanonischen Spielerdaten (data-wm2026.js). Wenn der Spieler
                // dort nicht mehr auftaucht, fallen wir auf den im Team-
                // Dokument mitgespeicherten Snapshot (name, photo, club,
                // clubLogo, flag) zurück. Das verhindert Foto-Platzhalter
                // und „?"-Felder bei Spielern, die nach einem Kader-Update
                // verschwunden sind. Sämtliche Strings fliessen weiterhin
                // ausschliesslich über escapeHtml() in den DOM.
                const isOrphan = !fullP;
                return {
                    name: fullP ? fullP.Spielername : (p.name || 'Unbekannt'),
                    pos,
                    slotNum,
                    pts: finalPts,
                    isCaptain: isCap,
                    photo: fullP ? fullP.Spielerfoto : (p.photo || 'https://via.placeholder.com/100'),
                    nation: fullP ? fullP['Nationalteam.name'] : (p.nation || '?'),
                    flag: fullP ? fullP['Nationalteam.logo'] : (p.flag || ''),
                    club: fullP ? fullP['Club.name'] : (p.club || '?'),
                    clubLogo: fullP ? fullP['Club.logo'] : (p.clubLogo || ''),
                    id: fullP ? String(fullP['player.id']) : (p.playerId != null ? String(p.playerId) : `fallback-${idx}-${Math.random()}`),
                    isOrphan,
                    rank: null
                };
            }).sort((a, b) => a.slotNum - b.slotNum);

            // Zeitbasierte Transfer-Wertung: für Teams MIT Transfers zählen
            // Spieler nur, solange sie im Team waren. Die aktuellen Spieler
            // erhalten ihre gefensterten Punkte; ausgetauschte Spieler werden
            // separat ausgewiesen (ihre Punkte bis zum Transfer sind im Total).
            let teamTotal;
            let transferredOut = [];
            const hasTransferFreeze = !!(TU && typeof TU.managerBreakdownOverTime === 'function'
                && Array.isArray(team.transfers) && team.transfers.length);
            if (hasTransferFreeze) {
                ensureTransferScoring();
                const currentIds = mergedPlayers.map(p => String(p.id));
                const currentSet = new Set(currentIds);
                const currentCaptain = CAPTAIN_ENABLED ? ((mergedPlayers.find(p => p.isCaptain) || {}).id || null) : null;
                const bd = TU.managerBreakdownOverTime({
                    currentTeamIds: currentIds,
                    transfers: team.transfers,
                    initialCaptain: team.initialCaptain || currentCaptain,
                    playerMatchPoints: sharedPmp,
                    getKickoffMs: kickoffFn,
                    captainMultiplier: CAPTAIN_ENABLED ? 2 : 1
                });
                mergedPlayers.forEach(p => { p.pts = bd.perPlayer[String(p.id)] || 0; });
                // Start-15 rekonstruieren. „transferiert-IN" = aktuell im Team,
                // aber NICHT im Start-15. „ausgetauscht" = im Start-15, aber NICHT
                // mehr aktuell. Beide Mengen sind gleich gross (Teamgrösse konstant)
                // → gleich viele „T"-Badges wie ausgetauschte Spieler. Ein nur
                // verschobener oder raus-und-wieder-rein gesetzter Spieler bleibt
                // in beiden Mengen und zählt daher NICHT als Transfer.
                const initialIdsArr = (typeof TU.reconstructInitialTeamIds === 'function')
                    ? TU.reconstructInitialTeamIds(currentIds, team.transfers).map(String)
                    : currentIds.slice();
                const initialIds = new Set(initialIdsArr);
                mergedPlayers.forEach(p => { p.isTransferIn = !initialIds.has(String(p.id)); });
                transferredOut = initialIdsArr
                    .filter(id => !currentSet.has(id))
                    .map(id => {
                        const fp = resolveStoredPlayer({ playerId: id });
                        return {
                            id,
                            name: fp ? fp.Spielername : String(id),
                            photo: fp ? (fp.Spielerfoto || '') : '',
                            nation: fp ? (fp['Nationalteam.name'] || '?') : '?',
                            flag: fp ? (fp['Nationalteam.logo'] || '') : '',
                            club: fp ? (fp['Club.name'] || '') : '',
                            clubLogo: fp ? (fp['Club.logo'] || '') : '',
                            pos: fp ? normalizePosition(fp.Position) : 'UNKNOWN',
                            pts: bd.perPlayer[id] || 0,
                            isCaptain: false,
                            isOrphan: !fp,
                            isTransferOut: true,
                            slotNum: -1
                        };
                    })
                    .sort((a, b) => b.pts - a.pts);
                teamTotal = bd.total;
            } else {
                teamTotal = mergedPlayers.reduce((sum, p) => sum + p.pts, 0);
            }

            const positionTotals = { GOALKEEPER: 0, DEFENDER: 0, MIDFIELDER: 0, ATTACKER: 0, BENCH: 0 };

            mergedPlayers.forEach(player => {
                const posKey = normalizePosition(player.pos);
                if (positionTotals[posKey] !== undefined) positionTotals[posKey] += player.pts;
                if (player.slotNum >= 11) positionTotals.BENCH += player.pts;
            });

            const captainCard = mergedPlayers.find(player => player.isCaptain) || null;
            const captainPoints = captainCard ? captainCard.pts : 0;
            const captainShare = teamTotal > 0 ? captainPoints / teamTotal : 0;
            const orphanPlayers = mergedPlayers.filter(player => player.isOrphan);

            return {
                ...team,
                mergedPlayers,
                totalScore: teamTotal,
                transferredOut,
                positionTotals,
                captainPoints,
                captainShare,
                orphanCount: orphanPlayers.length,
                orphanPlayers,
                favoriteClub: getFavoriteClubAwardData(mergedPlayers),
                scoutingCount: 0,
                perfectHits: 0,
                currentRank: null
            };
        }).sort(compareTeamsBySubmissionAsc);
    }

    function compareTeamsByScoreThenSubmission(a, b) {
        if (b.totalScore !== a.totalScore) return b.totalScore - a.totalScore;
        return compareTeamsBySubmissionAsc(a, b);
    }

    function assignTeamRanks(teams) {
        const ranking = [...teams].sort(compareTeamsByScoreThenSubmission);
        let currentRank = null;
        let previousScore = null;

        ranking.forEach((team, index) => {
            const score = Number(team.totalScore) || 0;
            if (index === 0 || score !== previousScore) {
                currentRank = index + 1;
            }
            team.currentRank = currentRank;
            previousScore = score;
        });
        return ranking;
    }

    function buildGlobalPickCounts(teams) {
        const counts = {};
        (teams || []).forEach(team => {
            (team.mergedPlayers || []).forEach(player => {
                if (!player.id) return;
                counts[player.id] = (counts[player.id] || 0) + 1;
            });
        });
        return counts;
    }

    function buildPerfectTeamIds() {
        const ids = new Set();
        const allPlayersWithPts = playersData.map(p => ({
            ...p,
            pts: playerPointsData[String(p['player.id'])] || 0
        }));

        const selectedNations = new Set();
        const teamSlots = { GK: [], DEF: [], MID: [], ATT: [] };
        const maxSlots = { GK: 2, DEF: 4, MID: 5, ATT: 4 };
        const sortedAll = [...allPlayersWithPts].sort((a, b) => b.pts - a.pts);

        for (const p of sortedAll) {
            const pos = normalizePosition(p.Position);
            let slotKey = '';
            if (pos === 'GOALKEEPER') slotKey = 'GK';
            else if (pos === 'DEFENDER') slotKey = 'DEF';
            else if (pos === 'MIDFIELDER') slotKey = 'MID';
            else if (pos === 'ATTACKER') slotKey = 'ATT';
            if (!slotKey) continue;

            const nationName = p['Nationalteam.name'];
            if (!selectedNations.has(nationName) && teamSlots[slotKey].length < maxSlots[slotKey]) {
                teamSlots[slotKey].push(p);
                selectedNations.add(nationName);
            }
        }

        const displayedAllPlayers = [
            ...teamSlots.GK.slice(0, 1),
            ...teamSlots.DEF.slice(0, 3),
            ...teamSlots.MID.slice(0, 4),
            ...teamSlots.ATT.slice(0, 3),
            teamSlots.GK[1] || null,
            teamSlots.DEF[3] || null,
            teamSlots.MID[4] || null,
            teamSlots.ATT[3] || null
        ].filter(Boolean);

        displayedAllPlayers.forEach(player => { ids.add(String(player['player.id'])); });
        return ids;
    }

    function augmentTeamsWithDerivedAwards(teams) {
        return (teams || []).map(team => {
            const scoutingCount = (team.mergedPlayers || []).filter(player => (globalPickCounts[player.id] || 0) === 1).length;
            const perfectHits = (team.mergedPlayers || []).filter(player => perfectTeamIds.has(String(player.id))).length;
            return { ...team, scoutingCount, perfectHits };
        });
    }

    /* =====================================================
       RENDER MANAGER AWARDS
       ===================================================== */
    function renderManagerAwards(team) {
        const awardsEl = document.getElementById('manager-awards');
        if (!awardsEl) return;
        if (!team) {
            currentTeamBadgeIds = new Set();
            currentTeamBadgeOrder = [];
            currentTeamFallbackBadges = [];
            awardsEl.innerHTML = '';
            return;
        }

        const uniqueResolvedAwards = getTeamBadgeAwards(team);

        currentTeamBadgeIds = new Set(uniqueResolvedAwards.map(award => award.badge.id));
        currentTeamBadgeOrder = uniqueResolvedAwards.map(award => award.badge.id);
        currentTeamFallbackBadges = uniqueResolvedAwards
            .filter(award => award.badge && award.badge.isFallback)
            .map(award => award.badge);

        awardsEl.innerHTML = uniqueResolvedAwards.map(award => {
            const safeType  = escapeHtml(toSafeClassToken(award.type || award.badge.id));
            const safeBadgeId = escapeHtml(award.badge.id);
            const safeTitle = escapeHtml(award.title || award.badge.description || award.badge.label);
            const safeLabel = escapeHtml(award.label || award.badge.label);
            const safeLogo  = escapeHtml(award.logo);
            const safeEmoji = escapeHtml(award.emoji || getBadgeEmoji(award.badge));
            return `
            <button type="button" class="manager-award ${safeType}" title="${safeTitle}" data-badge-id="${safeBadgeId}" data-badge-label="${safeLabel}" aria-label="${safeLabel} öffnen">
                ${award.logo
                    ? `<img src="${safeLogo}" alt="" aria-hidden="true" width="18" height="18">`
                    : `<span class="award-emoji">${safeEmoji}</span>`
                }
                <span>${safeLabel}</span>
            </button>
        `;
        }).join('');
    }

    /* =====================================================
       HERO PILLS
       ===================================================== */
    function updateHeroPills(team) {
        const countPill   = document.getElementById('hero-teams-count');
        const managerPill = document.getElementById('hero-current-manager');
        const rankPill    = document.getElementById('hero-current-rank');
        const countVal    = document.getElementById('hero-count-val');
        const managerVal  = document.getElementById('hero-manager-val');
        const rankVal     = document.getElementById('hero-rank-val');

        if (countPill && countVal) {
            countVal.textContent = allTeams.length;
            countPill.style.display = '';
        }

        if (team && managerPill && managerVal) {
            managerVal.textContent = team.manager;
            managerPill.style.display = '';
        }

        // Rang ist pre-start nicht aussagekräftig (alle 0 Punkte) und
        // suggeriert ggf., dass Kader-Daten schon ausgewertet wurden –
        // wir blenden ihn deshalb mit dem Lock-State aus.
        if (team && rankPill && rankVal && !isTeamsLocked()) {
            rankVal.textContent = team.currentRank || '–';
            rankPill.style.display = '';
        } else if (rankPill) {
            rankPill.style.display = 'none';
        }
    }

    /* =====================================================
       MOBILE PICKER BUTTON
       ===================================================== */
    function updateMobilePickerBtn(team) {
        const nameEl = document.getElementById('mobile-picker-name');
        const metaEl = document.getElementById('mobile-picker-meta');
        if (!nameEl) return;

        if (team) {
            nameEl.textContent = team.manager;
            if (metaEl) {
                if (isTeamsLocked()) {
                    metaEl.textContent = '🔒 Kader noch versteckt';
                } else {
                    const rankStr = team.currentRank ? ` · Rang ${team.currentRank}` : '';
                    const rosterStr = team.orphanCount > 0 ? ` · ⚠ ${team.orphanCount} Spielerdaten fehlen` : '';
                    metaEl.textContent = `${team.totalScore} Pkt.${rankStr}${rosterStr}`;
                }
            }
        } else {
            nameEl.textContent = '– Kein Team gewählt –';
            if (metaEl) metaEl.textContent = '';
        }
    }

    /* =====================================================
       MANAGER LIST (Desktop Sidebar)
       ===================================================== */
    function getCurrentManager() {
        const urlParams = new URLSearchParams(window.location.search);
        return urlParams.get('manager') || getStoredManagerName();
    }

    function renderManagerList(teamsToRender) {
        const listEl = document.getElementById('manager-list');
        if (!listEl) return;

        listEl.innerHTML = '';
        const currentManager = getCurrentManager();

        const sortedTeams = [...(teamsToRender || [])].sort(compareTeamsByManagerName);

        sortedTeams.forEach(team => {
            const div = document.createElement('div');
            div.className = 'manager-item';
            div.setAttribute('role', 'option');
            div.setAttribute('aria-selected', team.manager === currentManager ? 'true' : 'false');
            if (team.manager === currentManager) div.classList.add('active');
            if (!isTeamsLocked() && team.orphanCount > 0) {
                div.classList.add('has-roster-warning');
                div.title = `${team.orphanCount} Spielerdaten konnten nicht mehr zugeordnet werden`;
            }

            const nameSpan = document.createElement('span');
            nameSpan.textContent = team.manager;

            const rankSpan = document.createElement('span');
            rankSpan.className = 'manager-item-rank';
            // Vor Turnierstart sind alle Punkte 0 und Ränge zufällig – wir
            // unterdrücken den Rang in der Liste, damit nichts an die
            // (noch geheimen) Kader-Informationen erinnert.
            if (!isTeamsLocked()) {
                const rankText = team.currentRank ? `#${team.currentRank}` : '';
                const warningText = team.orphanCount > 0 ? `⚠ ${team.orphanCount}` : '';
                rankSpan.textContent = [rankText, warningText].filter(Boolean).join(' · ');
            } else {
                rankSpan.textContent = '';
            }

            div.appendChild(nameSpan);
            div.appendChild(rankSpan);

            div.addEventListener('click', () => {
                selectManager(team);
            });

            listEl.appendChild(div);
        });
    }

    /* =====================================================
       MOBILE PICKER MODAL – LIST
       ===================================================== */
    function renderMobileManagerPicker(teamsToRender) {
        const listEl = document.getElementById('team-picker-list');
        if (!listEl) return;

        listEl.innerHTML = '';
        const currentManager = getCurrentManager();

        const sortedTeams = [...(teamsToRender || [])].sort(compareTeamsByManagerName);

        sortedTeams.forEach(team => {
            const item = document.createElement('div');
            item.className = 'team-picker-item';
            item.setAttribute('role', 'option');
            item.setAttribute('aria-selected', team.manager === currentManager ? 'true' : 'false');
            if (team.manager === currentManager) item.classList.add('active');

            const nameSpan = document.createElement('span');
            nameSpan.className = 'team-picker-item-name';
            nameSpan.textContent = team.manager;

            const ptsSpan = document.createElement('span');
            ptsSpan.className = 'team-picker-item-pts';
            if (isTeamsLocked()) {
                ptsSpan.textContent = '🔒';
            } else {
                const rankText = team.currentRank ? `#${team.currentRank} · ` : '';
                const warningText = team.orphanCount > 0 ? ` · ⚠ ${team.orphanCount}` : '';
                ptsSpan.textContent = `${rankText}${team.totalScore} Pkt.${warningText}`;
            }

            item.appendChild(nameSpan);
            item.appendChild(ptsSpan);

            item.addEventListener('click', () => {
                selectManager(team);
                closeTeamPickerModal();
            });

            listEl.appendChild(item);
        });
    }

    /* =====================================================
       SELECT MANAGER (shared logic)
       ===================================================== */
    function selectManager(team) {
        // Update sidebar active state
        document.querySelectorAll('.manager-item').forEach(el => {
            const span = el.querySelector('span');
            const isActive = span && span.textContent === team.manager;
            el.classList.toggle('active', isActive);
            el.setAttribute('aria-selected', isActive ? 'true' : 'false');
        });

        // Update modal active state if open
        document.querySelectorAll('.team-picker-item').forEach(el => {
            const nameSpan = el.querySelector('.team-picker-item-name');
            const isActive = nameSpan && nameSpan.textContent === team.manager;
            el.classList.toggle('active', isActive);
            el.setAttribute('aria-selected', isActive ? 'true' : 'false');
        });

        setStoredManagerName(team.manager);
        window.history.replaceState(null, '', '?manager=' + encodeURIComponent(team.manager));
        loadTeam(team);
    }

    /* =====================================================
       SEARCH FILTER
       ===================================================== */
    function getFilteredTeams(searchTerm) {
        const term = (searchTerm || '').toLowerCase().trim();
        if (!term) return allTeams;
        return allTeams.filter(t => t.manager.toLowerCase().includes(term));
    }

    function getDesktopSearchTerm() {
        const el = document.getElementById('manager-search');
        return el ? el.value : '';
    }

    function getMobileSearchTerm() {
        const el = document.getElementById('team-picker-search');
        return el ? el.value : '';
    }

    /* =====================================================
       MODAL OPEN / CLOSE
       ===================================================== */
    const TEAM_PICKER_POPUP_ID = 'teams-mobile-team-picker';
    function isTeamPickerOpen() {
        const overlay = document.getElementById('team-picker-overlay');
        return !!overlay?.classList.contains('visible');
    }
    function buildTeamPickerState(dtPopupId) {
        const params = new URLSearchParams(window.location.search);
        return {
            ...(window.history.state && typeof window.history.state === 'object' ? window.history.state : {}),
            dtPopupId,
            manager: params.get('manager') || currentDisplayedManager || null
        };
    }
    function openTeamPickerModal() {
        const overlay = document.getElementById('team-picker-overlay');
        const btn     = document.getElementById('mobile-picker-btn');
        if (!overlay) return;

        renderMobileManagerPicker(getFilteredTeams(getMobileSearchTerm()));

        overlay.classList.add('visible');
        document.body.classList.add('modal-open');
        if (btn) btn.setAttribute('aria-expanded', 'true');
        overlay.focus();

        // Scroll active item into view
        requestAnimationFrame(() => {
            const activeItem = overlay.querySelector('.team-picker-item.active');
            if (activeItem) activeItem.scrollIntoView({ block: 'nearest' });
        });
    }
    function openTeamPickerModalWithHistory({ pushHistory = true } = {}) {
        const wasOpen = isTeamPickerOpen();
        openTeamPickerModal();
        if (pushHistory && (!wasOpen || window.history.state?.dtPopupId !== TEAM_PICKER_POPUP_ID)) {
            window.history.pushState(buildTeamPickerState(TEAM_PICKER_POPUP_ID), '', window.location.href);
        }
    }

    function closeTeamPickerModal() {
        const overlay = document.getElementById('team-picker-overlay');
        const btn     = document.getElementById('mobile-picker-btn');
        if (!overlay) return;

        overlay.classList.remove('visible');
        if (!isBadgeCatalogOpen()) document.body.classList.remove('modal-open');
        if (btn) {
            btn.setAttribute('aria-expanded', 'false');
            btn.focus();
        }
    }
    function closeTeamPickerModalWithHistory({ pushHistory = true } = {}) {
        const wasOpen = isTeamPickerOpen();
        closeTeamPickerModal();
        if (pushHistory && wasOpen && window.history.state?.dtPopupId === TEAM_PICKER_POPUP_ID) {
            window.history.pushState(buildTeamPickerState(null), '', window.location.href);
        }
    }

    function initModalEvents() {
        if (modalPickerInitialized) return;
        modalPickerInitialized = true;

        const openBtn   = document.getElementById('mobile-picker-btn');
        const closeBtn  = document.getElementById('team-picker-close');
        const overlay   = document.getElementById('team-picker-overlay');
        const searchEl  = document.getElementById('team-picker-search');

        if (openBtn) {
            openBtn.addEventListener('click', () => openTeamPickerModalWithHistory({ pushHistory: true }));
        }

        if (closeBtn) {
            closeBtn.addEventListener('click', () => closeTeamPickerModalWithHistory({ pushHistory: true }));
        }

        // Close on backdrop click
        if (overlay) {
            overlay.addEventListener('click', (e) => {
                if (e.target === overlay) closeTeamPickerModalWithHistory({ pushHistory: true });
            });
        }

        // Escape key
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape' && overlay && overlay.classList.contains('visible')) {
                closeTeamPickerModalWithHistory({ pushHistory: true });
            }
        });
        window.addEventListener('popstate', (event) => {
            if (event.state?.dtPopupId === TEAM_PICKER_POPUP_ID) {
                openTeamPickerModalWithHistory({ pushHistory: false });
                return;
            }
            closeTeamPickerModalWithHistory({ pushHistory: false });

            // Re-apply the manager from the URL so that pressing back/forward actually
            // restores the previously displayed team instead of leaving the UI out of sync.
            const params = new URLSearchParams(window.location.search);
            const managerFromUrl = params.get('manager');
            if (managerFromUrl && Array.isArray(allTeams) && allTeams.length) {
                const targetTeam = allTeams.find(t => t.manager === managerFromUrl);
                const currentlyDisplayedEl = document.getElementById('display-manager-name');
                const currentlyDisplayed = currentlyDisplayedEl ? currentlyDisplayedEl.textContent.trim() : '';
                if (targetTeam && targetTeam.manager !== currentlyDisplayed) {
                    selectManager(targetTeam);
                }
            }
        });

        // Modal search filter
        if (searchEl) {
            searchEl.addEventListener('input', () => {
                renderMobileManagerPicker(getFilteredTeams(searchEl.value));
            });
        }
    }

    /* =====================================================
       HEADER ANIMATION
       ===================================================== */
    function animateHeader() {
        const els = [
            document.getElementById('display-manager-name'),
            document.getElementById('manager-awards'),
            document.getElementById('team-roster-warning'),
            document.getElementById('display-total-points'),
            document.getElementById('display-rank-link'),
            document.getElementById('display-alive')
        ];

        els.forEach(el => { if (el) el.classList.remove('animate-header-text'); });
        void (els[0] && els[0].offsetWidth);
        els.forEach(el => { if (el) el.classList.add('animate-header-text'); });
    }

    /* =====================================================
       VANILLA TILT
       ===================================================== */
    function hardResetCard(card) {
        if (!card) return;
        try { if (card.vanillaTilt) card.vanillaTilt.reset(); } catch (e) {}
        requestAnimationFrame(() => { card.style.transform = CARD_BASE_TRANSFORM; });
        setTimeout(() => { card.style.transform = CARD_BASE_TRANSFORM; }, 220);
    }

    /**
     * vanilla-tilt@1.8.0 hat einen Race in destroy(): der Aufruf clear-t
     * zuerst transitionTimeout, ruft dann reset() → onMouseEnter() →
     * setTransition(), das den Timeout SOFORT WIEDER SETZT, und nullt
     * danach this.element. Wenn der frisch geplante Timeout feuert,
     * läuft er gegen this.element === null und crasht mit
     * „Cannot read properties of null (reading 'style')". Auf dem Desktop
     * passiert das bei jedem Manager-Wechsel und nach dem
     * onCachedReady→onUpdate-Boot von DreamTeamCache; sichtbares Symptom
     * ist genau das vom User gemeldete „Mouse-Over-Effekt verschwunden",
     * weil VanillaTilt nach dem Crash keine neuen Init-Aufrufe mehr
     * verarbeitet.
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
        const cards = document.querySelectorAll(".player-card");

        cards.forEach(card => {
            safeDestroyTilt(card);
            card.style.transform = CARD_BASE_TRANSFORM;

            if (!card.dataset.tiltBound) {
                card.addEventListener('mouseleave', () => hardResetCard(card));
                card.addEventListener('blur', () => hardResetCard(card));
                card.dataset.tiltBound = '1';
            }
        });

        // Only enable tilt on pointer:fine (non-touch) devices
        if (!window.matchMedia("(hover: hover) and (pointer: fine)").matches) return;
        if (!cards.length) return;
        if (typeof VanillaTilt === 'undefined') return;

        VanillaTilt.init(cards, {
            max: 14,
            speed: 280,
            glare: true,
            "max-glare": 0.3,
            scale: 1,
            transition: true,
            reset: true,
            "reset-to-start": true,
            gyroscope: false
        });
    }

    // Safety net: Falls eine asynchrone Render-Phase neue .player-card-
    // Elemente in den DOM einfügt, ohne dass das aufrufende Code-Pfad
    // initCardTilt() unmittelbar nachzieht (z.B. nach bfcache-Restore,
    // nach onCachedReady→onUpdate-Sequenz im DreamTeamCache-Bootstrap
    // oder nach Service-Worker-Cache-Refresh in der laufenden Session),
    // beobachten wir das Pitch-Container-Set und reinitialisieren Tilt,
    // sobald frische Karten erscheinen. Ohne diesen Beobachter blieb der
    // Mouse-Over-Effekt nach dem Pre-Launch-Polish (#214/#215) auf der
    // Desktop-Ansicht zeitweise aus, weil VanillaTilt.init() die Karten
    // nicht erwischte, die NACH dem geplanten setTimeout-Slot in den
    // DOM kamen.
    let tiltObserverInited = false;
    let tiltObserverTimer = null;
    function initTiltObserver() {
        if (tiltObserverInited) return;
        if (typeof MutationObserver === 'undefined') return;

        const teamView = document.getElementById('team-view');
        if (!teamView) return;

        tiltObserverInited = true;
        const observer = new MutationObserver((mutations) => {
            const hasNewCard = mutations.some(m =>
                Array.from(m.addedNodes).some(n =>
                    n.nodeType === 1 && (
                        (typeof n.matches === 'function' && n.matches('.player-card, .card-wrapper, .mobile-card-wrapper'))
                        || (typeof n.querySelector === 'function' && n.querySelector && n.querySelector('.player-card'))
                    )
                )
            );
            if (!hasNewCard) return;

            if (tiltObserverTimer) clearTimeout(tiltObserverTimer);
            // Etwas grosszuegigeres Debounce als der setTimeout(180) in
            // loadTeam(), damit der reguläre Render-Pfad zuerst fertig
            // wird und der Observer nur nachzieht, wenn der reguläre
            // Pfad ausnahmsweise NICHT initCardTilt() ausgelöst hat.
            tiltObserverTimer = setTimeout(() => {
                tiltObserverTimer = null;
                if (Date.now() - tiltLastInitAt < 200) return;
                initCardTilt();
            }, 240);
        });

        observer.observe(teamView, { childList: true, subtree: true });
    }

    /* =====================================================
       CARD HTML BUILDER
       ===================================================== */
    function formatOrphanPlayerNames(players) {
        const names = (players || []).map(player => player && player.name).filter(Boolean);
        if (!names.length) return '';
        const visibleNames = names.slice(0, 4).join(', ');
        const remaining = names.length - 4;
        return remaining > 0 ? `${visibleNames} und ${remaining} weitere` : visibleNames;
    }

    function updateTeamRosterWarning(team) {
        const warningEl = document.getElementById('team-roster-warning');
        if (!warningEl) return;

        const orphanPlayers = team && Array.isArray(team.orphanPlayers) ? team.orphanPlayers : [];
        if (!team || isTeamsLocked() || orphanPlayers.length === 0) {
            warningEl.classList.remove('visible');
            warningEl.innerHTML = '';
            return;
        }

        const count = orphanPlayers.length;
        const names = formatOrphanPlayerNames(orphanPlayers);
        warningEl.innerHTML = `
            <span class="team-roster-warning-icon" aria-hidden="true">⚠️</span>
            <span>${count} Spieler in diesem Team ${count === 1 ? 'konnte' : 'konnten'} nicht mehr eindeutig zugeordnet werden${names ? `: ${escapeHtml(names)}` : ''}.</span>
        `;
        warningEl.classList.add('visible');
    }

    function buildCardHtml(mergedP, idx, wrapperClass) {
        const ptsClass  = mergedP.pts > 0 ? 'pos' : (mergedP.pts < 0 ? 'neg' : '');
        const sign      = mergedP.pts > 0 ? '+' : '';
        const analysisUrl = mergedP.id && !mergedP.isOrphan
            ? `spieleranalyse.html?playerId=${encodeURIComponent(mergedP.id)}`
            : `spieleranalyse.html?player=${encodeURIComponent(mergedP.name)}`;
        const animStyle = `animation-delay: ${idx * 0.04}s;`;
        const capClass  = mergedP.isCaptain ? 'is-captain' : '';
        const orphanClass = mergedP.isOrphan ? 'is-orphan' : '';
        const capBadge  = mergedP.isCaptain ? '<div class="captain-badge" title="Captain: Erhält doppelte Punkte!">C</div>' : '';
        const transferBadge = mergedP.isTransferIn ? '<div class="transfer-badge" title="In das Team transferiert">T</div>' : '';
        const orphanBadge = mergedP.isOrphan ? '<div class="orphan-card-badge" title="Spielerdaten konnten nicht mehr zugeordnet werden">Spielerdaten fehlen</div>' : '';
        const ptsId     = `pts-${mergedP.id}-${mergedP.slotNum}`;

        // Defense-in-Depth: Sämtliche dynamischen Werte werden HTML-
        // escaped, auch wenn sie inzwischen aus den kanonischen Daten
        // (data-wm2026.js) stammen. analysisUrl ist bereits via
        // encodeURIComponent geschützt; in einem href="…"-Attribut ist
        // zusätzliches escapeHtml() schadlos.
        const safeAnalysisUrl = escapeHtml(analysisUrl);
        const safeWrapperCls  = escapeHtml(wrapperClass);
        const safeAnimStyle   = escapeHtml(animStyle);
        const safeCapClass    = escapeHtml(capClass);
        const safeOrphanClass = escapeHtml(orphanClass);
        const safePtsClass    = escapeHtml(ptsClass);
        const safePtsId       = escapeHtml(ptsId);
        const safeSignPts     = escapeHtml(`${sign}${mergedP.pts}`);
        const safePhoto       = escapeHtml(mergedP.photo);
        const safeName        = escapeHtml(mergedP.name);
        const safeFlag        = escapeHtml(mergedP.flag);
        const safeNation      = escapeHtml(mergedP.nation);
        const safeClubLogo    = escapeHtml(mergedP.clubLogo);
        const safeClub        = escapeHtml(mergedP.club);

        return `
            <div class="${safeWrapperCls}" style="${safeAnimStyle}">
                <a href="${safeAnalysisUrl}" class="player-card ${safeCapClass} ${safeOrphanClass}">
                    ${capBadge}
                    ${transferBadge}
                    ${orphanBadge}
                    <div class="card-pts ${safePtsClass}" id="${safePtsId}">${safeSignPts}</div>
                    <div class="avatar-wrapper"><img src="${safePhoto}" class="card-avatar" alt="${safeName}" loading="lazy" width="92" height="92"></div>
                    <div class="card-info">
                        <div class="card-name">${safeName}</div>
                        <div class="card-sub-info"><img src="${safeFlag}" class="small-icon" alt="${safeNation}" loading="lazy" width="24" height="17"> <span>${safeNation}</span></div>
                        <div class="card-sub-info"><img src="${safeClubLogo}" class="small-icon club" alt="${safeClub}" loading="lazy" width="19" height="19"> <span>${safeClub}</span></div>
                    </div>
                </a>
            </div>
        `;
    }

    /* Rendert die ausgetauschten Spieler als Karten unter dem Team (nur bei
       CL-Teams mit Transfer). Reuset buildCardHtml (zeigt Punkte); ohne
       Punkte-Animation, der Wert steht direkt in der Karte. */
    function renderTransferredOut(team) {
        const section = document.getElementById('transferred-out-section');
        const container = document.getElementById('transferred-out-cards');
        if (!section || !container) return;
        const list = (team && Array.isArray(team.transferredOut)) ? team.transferredOut : [];
        if (!list.length) {
            section.style.display = 'none';
            container.innerHTML = '';
            return;
        }
        container.innerHTML = list.map((p, i) => buildCardHtml(p, i, 'card-wrapper')).join('');
        section.style.display = '';
    }

    /* =====================================================
       CLEAR BOARD
       ===================================================== */
    function clearBoard() {
        const outSection = document.getElementById('transferred-out-section');
        if (outSection) outSection.style.display = 'none';
        const outCards = document.getElementById('transferred-out-cards');
        if (outCards) outCards.innerHTML = '';
        const desktopIds = ['row-GK', 'row-DEF', 'row-MID', 'row-ATT', 'bench-GK', 'bench-DEF', 'bench-MID', 'bench-ATT'];
        const mobileIds  = ['mobile-row-GK', 'mobile-row-DEF', 'mobile-row-MID', 'mobile-row-ATT', 'mobile-bench-all'];

        // Vor dem Wegwerfen der DOM-Knoten alle aktiven VanillaTilt-
        // Instanzen sauber abbauen. Sonst halten interne Listener (mousemove
        // im rAF-Loop) weiter Referenzen auf die gerade entfernten Karten,
        // was bei der naechsten Render-Phase zu „Cannot read properties of
        // null (reading 'style')" innerhalb von vanilla-tilt.min.js fuehren
        // kann (sichtbar nach jedem Manager-Wechsel oder Cache→Update-
        // Sequenz).
        document.querySelectorAll('.player-card').forEach(card => {
            safeDestroyTilt(card);
        });

        [...desktopIds, ...mobileIds].forEach(id => {
            const el = document.getElementById(id);
            if (el) el.innerHTML = '';
        });

        // Reset mobile column counts
        ['mobile-row-GK', 'mobile-row-DEF', 'mobile-row-MID', 'mobile-row-ATT', 'mobile-bench-all'].forEach(id => {
            const el = document.getElementById(id);
            if (el) el.style.removeProperty('--cols');
        });

        // Reset mobile pts labels
        ['mobile-pts-GK', 'mobile-pts-DEF', 'mobile-pts-MID', 'mobile-pts-ATT', 'mobile-pts-BENCH'].forEach(id => {
            const el = document.getElementById(id);
            if (el) el.textContent = '';
        });
    }

    function appendCardHtml(targetId, html) {
        const el = document.getElementById(targetId);
        if (el) el.insertAdjacentHTML('beforeend', html);
    }

    /* =====================================================
       PRE-START TEAM LOCK
       -----------------------------------------------------
       Vor dem Anpfiff (APP_CONFIG.DREAMTEAM_START) bleiben
       alle Kader versteckt. Diese Helfer setzen den
       Sperr-Zustand (body.teams-locked) und steuern den
       Countdown im #team-lock-placeholder. Admins können
       per Dev-Toggle vorzeitig in den Post-Start-Modus
       wechseln (siehe APP_CONFIG.getEffectiveViewMode). */
    function isTeamsLocked() {
        try {
            return !!(window.APP_CONFIG && window.APP_CONFIG.isPreStart && window.APP_CONFIG.isPreStart());
        } catch (_) {
            return true;
        }
    }

    function getRevealDate() {
        try {
            return (window.APP_CONFIG && window.APP_CONFIG.DREAMTEAM_START) || null;
        } catch (_) { return null; }
    }

    let _lockCountdownTimer = null;
    function stopLockCountdown() {
        if (_lockCountdownTimer) {
            clearInterval(_lockCountdownTimer);
            _lockCountdownTimer = null;
        }
    }
    function tickLockCountdown() {
        const start = getRevealDate();
        const d = document.getElementById('team-lock-cd-d');
        const h = document.getElementById('team-lock-cd-h');
        const m = document.getElementById('team-lock-cd-m');
        const s = document.getElementById('team-lock-cd-s');
        if (!d || !h || !m || !s) return;
        if (!(start instanceof Date) || isNaN(start.getTime())) {
            d.textContent = h.textContent = m.textContent = s.textContent = '–';
            return;
        }
        let ms = start.getTime() - Date.now();
        if (ms <= 0) {
            stopLockCountdown();
            applyTeamsLockState();
            return;
        }
        const days = Math.floor(ms / (24 * 3600 * 1000));
        ms -= days * 24 * 3600 * 1000;
        const hours = Math.floor(ms / (3600 * 1000));
        ms -= hours * 3600 * 1000;
        const mins = Math.floor(ms / (60 * 1000));
        ms -= mins * 60 * 1000;
        const secs = Math.floor(ms / 1000);
        d.textContent = String(days);
        h.textContent = String(hours).padStart(2, '0');
        m.textContent = String(mins).padStart(2, '0');
        s.textContent = String(secs).padStart(2, '0');
    }
    function startLockCountdown() {
        stopLockCountdown();
        const revealTimeEl = document.getElementById('team-lock-reveal-time');
        const start = getRevealDate();
        if (revealTimeEl && start instanceof Date && !isNaN(start.getTime())) {
            try {
                const fmt = new Intl.DateTimeFormat('de-CH', {
                    weekday: 'long',
                    day: '2-digit', month: '2-digit', year: 'numeric',
                    hour: '2-digit', minute: '2-digit',
                    timeZone: 'Europe/Zurich'
                });
                revealTimeEl.textContent = `Enthüllung am ${fmt.format(start)} Uhr`;
            } catch (_) {
                revealTimeEl.textContent = `Enthüllung am ${start.toLocaleString('de-CH')}`;
            }
        }
        tickLockCountdown();
        _lockCountdownTimer = setInterval(tickLockCountdown, 1000);
    }

    function applyTeamsLockState() {
        const locked = isTeamsLocked();
        document.body.classList.toggle('teams-locked', locked);
        if (locked) {
            startLockCountdown();
        } else {
            stopLockCountdown();
        }
    }

    // Live-Umschaltung exakt zum DREAMTEAM_START (Tab kann offen bleiben).
    let _autoRevealCancel = null;
    function scheduleTeamsAutoReveal() {
        if (typeof _autoRevealCancel === 'function') {
            _autoRevealCancel();
            _autoRevealCancel = null;
        }
        if (!(window.APP_CONFIG && typeof window.APP_CONFIG.onReveal === 'function')) return;
        _autoRevealCancel = window.APP_CONFIG.onReveal(() => {
            applyTeamsLockState();
            // Aktuell angezeigtes Team neu rendern, damit Kader sichtbar wird.
            const currentDisplayed = document.getElementById('display-manager-name');
            if (currentDisplayed && Array.isArray(allTeams)) {
                const name = currentDisplayed.textContent.trim();
                const team = allTeams.find(t => t.manager === name);
                if (team) loadTeam(team);
            }
        });
    }

    /* =====================================================
       LOAD TEAM
       ===================================================== */
    /* "Spieler noch im Turnier": Anzahl der Spieler eines Teams, deren
       Nation noch nicht aus dem Turnier ausgeschieden ist. Wird neben
       dem Rang angezeigt. Vor Turnierstart bleibt der Chip versteckt
       (zusätzlich via body.teams-locked-CSS abgesichert). */
    function computeActivePlayers(team) {
        const players = (team && Array.isArray(team.mergedPlayers)) ? team.mergedPlayers : [];
        if (nationLifecycle && typeof nationLifecycle.countActivePlayers === 'function') {
            return nationLifecycle.countActivePlayers(players, p => p && p.nation);
        }
        return players.length;
    }

    function updateAliveDisplay(team) {
        const wrap = document.getElementById('display-alive');
        const valueEl = document.getElementById('display-alive-value');
        if (!wrap || !valueEl) return;

        const players = (team && Array.isArray(team.mergedPlayers)) ? team.mergedPlayers : [];
        const total = players.length;

        if (isTeamsLocked() || total === 0) {
            wrap.hidden = true;
            return;
        }

        const active = computeActivePlayers(team);
        valueEl.textContent = `${active}/${total}`;
        wrap.title = `Spieler noch im Turnier: ${active} von ${total} (Nation nicht ausgeschieden)`;
        wrap.hidden = false;
    }

    function loadTeam(team) {
        const emptyState = document.getElementById('empty-state');
        const teamView   = document.getElementById('team-view');
        if (emptyState) emptyState.style.display = 'none';
        if (teamView)   teamView.style.display = 'block';

        // Header
        const nameEl = document.getElementById('display-manager-name');
        if (nameEl) nameEl.textContent = team.manager;
        updateTeamRosterWarning(null);

        const rankEl = document.getElementById('display-rank');
        if (rankEl) rankEl.textContent = team.currentRank ? team.currentRank : '–';

        const rankLink = document.getElementById('display-rank-link');
        if (rankLink) {
            rankLink.href = 'rangliste.html';
            rankLink.title = team.currentRank ? `Zur Rangliste wechseln (aktueller Rang ${team.currentRank})` : 'Zur Rangliste wechseln';
        }

        updateAliveDisplay(team);

        // Wenn Teams aktuell gesperrt sind, NICHT das Kader rendern: nur
        // Manager-Name (Header) und Lock-Placeholder werden gezeigt. Wir
        // überspringen Awards, Punkte-Animation, Hero-Pills und Karten.
        if (isTeamsLocked()) {
            applyTeamsLockState();
            clearBoard();
            const awardsEl = document.getElementById('manager-awards');
            if (awardsEl) awardsEl.innerHTML = '';
            currentTeamBadgeIds = new Set();
            currentTeamBadgeOrder = [];
            currentTeamFallbackBadges = [];
            updateTeamRosterWarning(null);
            updateMobilePickerBtn(team);
            return;
        }

        renderManagerAwards(team);
        updateTeamRosterWarning(team);
        animateHeader();
        animateValue("display-total-points", 0, team.totalScore, 900, " Pkt.");

        // Update mobile picker button
        updateMobilePickerBtn(team);

        // Update hero pills
        updateHeroPills(team);

        clearBoard();

        let cardDelayCount = 0;
        const playersToRender = Array.isArray(team.mergedPlayers) ? team.mergedPlayers : [];

        playersToRender.forEach((mergedP, idx) => {
            // Desktop card
            const desktopHtml = buildCardHtml(mergedP, idx, 'card-wrapper');
            // Mobile card
            const isBench = mergedP.slotNum >= 11;
            const mobileHtml = buildCardHtml(mergedP, idx, 'mobile-card-wrapper');

            // Route desktop
            if (mergedP.slotNum === 11) {
                appendCardHtml('bench-GK', desktopHtml);
            } else if (mergedP.slotNum === 12) {
                appendCardHtml('bench-DEF', desktopHtml);
            } else if (mergedP.slotNum === 13) {
                appendCardHtml('bench-MID', desktopHtml);
            } else if (mergedP.slotNum >= 14) {
                appendCardHtml('bench-ATT', desktopHtml);
            } else {
                let rowId = 'row-ATT';
                if (mergedP.pos === 'GOALKEEPER') rowId = 'row-GK';
                else if (mergedP.pos === 'DEFENDER') rowId = 'row-DEF';
                else if (mergedP.pos === 'MIDFIELDER') rowId = 'row-MID';
                appendCardHtml(rowId, desktopHtml);
            }

            // Route mobile
            if (isBench) {
                appendCardHtml('mobile-bench-all', mobileHtml);
            } else {
                let mobileRowId = 'mobile-row-ATT';
                if (mergedP.pos === 'GOALKEEPER') mobileRowId = 'mobile-row-GK';
                else if (mergedP.pos === 'DEFENDER') mobileRowId = 'mobile-row-DEF';
                else if (mergedP.pos === 'MIDFIELDER') mobileRowId = 'mobile-row-MID';
                appendCardHtml(mobileRowId, mobileHtml);
            }

            // Animate points counter
            const ptsId = `pts-${mergedP.id}-${mergedP.slotNum}`;
            setTimeout(() => {
                animateValue(ptsId, 0, mergedP.pts, 750, "");
            }, cardDelayCount * 40 + 100);

            cardDelayCount++;
        });

        renderTransferredOut(team);

        // Set CSS grid columns for each mobile section based on player count
        const mobileColMap = {
            'mobile-row-GK':  { pts: team.positionTotals.GOALKEEPER, ptsId: 'mobile-pts-GK' },
            'mobile-row-DEF': { pts: team.positionTotals.DEFENDER,   ptsId: 'mobile-pts-DEF' },
            'mobile-row-MID': { pts: team.positionTotals.MIDFIELDER,  ptsId: 'mobile-pts-MID' },
            'mobile-row-ATT': { pts: team.positionTotals.ATTACKER,    ptsId: 'mobile-pts-ATT' },
            'mobile-bench-all': { pts: team.positionTotals.BENCH,     ptsId: 'mobile-pts-BENCH' }
        };

        Object.entries(mobileColMap).forEach(([rowId, { pts, ptsId }]) => {
            const rowEl = document.getElementById(rowId);
            if (rowEl) {
                const count = rowEl.children.length;
                // Use the exact player count as column count so they perfectly fill one row
                const cols = Math.max(1, count);
                rowEl.style.setProperty('--cols', cols);
            }
            const ptsEl = document.getElementById(ptsId);
            if (ptsEl && typeof pts === 'number') {
                const sign = pts > 0 ? '+' : '';
                ptsEl.textContent = `${sign}${pts} Pkt.`;
            }
        });

        requestAnimationFrame(() => {
            setTimeout(() => { initCardTilt(); }, 180);
        });
    }

    /* =====================================================
       APPLY DATASET
       ===================================================== */
    function getPreferredManager(teams, preferCurrentDisplayed) {
        const urlParams = new URLSearchParams(window.location.search);
        const managerFromUrl = urlParams.get('manager');
        const managerFromStorage = getStoredManagerName();

        let currentDisplayedManager = null;
        if (preferCurrentDisplayed) {
            const teamView = document.getElementById('team-view');
            const nameEl   = document.getElementById('display-manager-name');
            if (teamView && teamView.style.display !== 'none' && nameEl) {
                currentDisplayedManager = nameEl.textContent.trim() || null;
            }
        }

        const managerExists = (name) => !!teams.find(t => t.manager === name);

        if (managerFromUrl && managerExists(managerFromUrl)) return managerFromUrl;
        if (currentDisplayedManager && managerExists(currentDisplayedManager)) return currentDisplayedManager;
        if (managerFromStorage && managerExists(managerFromStorage)) return managerFromStorage;
        if (teams.length > 0) return teams[0].manager;
        return null;
    }

    function updateManagerUrlAndStorage(managerName) {
        if (!managerName) return;
        setStoredManagerName(managerName);
        window.history.replaceState(null, '', '?manager=' + encodeURIComponent(managerName));
    }

    function applyDataset(data, options) {
        const preferCurrentDisplayed = !!(options && options.preferCurrentDisplayed);

        buildPlayerPointsMap(data.points || {});
        fixturesData = data.fixtures && typeof data.fixtures === 'object' && !Array.isArray(data.fixtures) ? data.fixtures : {};
        nationLifecycle = (APP && typeof APP.getNationStatus === 'function')
            ? APP.getNationStatus(fixturesData)
            : null;
        badgeSnapshotsData = data.badgeSnapshots && typeof data.badgeSnapshots === 'object' ? data.badgeSnapshots : null;
        allTeams = enrichTeamsWithScores(data.teams || []);
        allTeams = assignTeamRanks(allTeams);
        allTeams.sort(compareTeamsByManagerName);
        globalPickCounts = buildGlobalPickCounts(allTeams);
        perfectTeamIds = buildPerfectTeamIds();
        allTeams = augmentTeamsWithDerivedAwards(allTeams);

        if (!allTeams.length) {
            const teamView   = document.getElementById('team-view');
            const emptyState = document.getElementById('empty-state');
            if (teamView)   teamView.style.display = 'none';
            if (emptyState) {
                emptyState.style.display = 'block';
                emptyState.innerHTML = `<span class="empty-icon">📭</span>Noch keine Teams für ${TOURNAMENT_LABEL} vorhanden.`;
            }
            const rankEl = document.getElementById('display-rank');
            if (rankEl) rankEl.textContent = '–';
            renderManagerList([]);
            return;
        }

        // Update hero teams count
        const heroCountPill = document.getElementById('hero-teams-count');
        const heroCountVal  = document.getElementById('hero-count-val');
        if (heroCountPill && heroCountVal) {
            heroCountVal.textContent = allTeams.length;
            heroCountPill.style.display = '';
        }

        const preferredManager = getPreferredManager(allTeams, preferCurrentDisplayed);
        updateManagerUrlAndStorage(preferredManager);

        renderManagerList(getFilteredTeams(getDesktopSearchTerm()));

        // Ab hier steht sichtbarer Inhalt (Manager-Liste). Das Flag muss VOR
        // loadTeam gesetzt werden: Wirft loadTeam (oder wird es nie erreicht),
        // duerfen spaetere Fehlerpfade die gerenderte Liste nicht mehr mit
        // dem destruktiven Fehlerblock ueberdecken.
        hasRenderedOnce = true;

        const teamToLoad = allTeams.find(t => t.manager === preferredManager) || allTeams[0];
        if (teamToLoad) {
            try {
                loadTeam(teamToLoad);
            } catch (err) {
                console.error('[teams] loadTeam fehlgeschlagen:', err);
            }
        }
    }

    function isServerVerifiedCacheInfo(info) {
        return !!(info && info.verifiedFromServer === true && info.stale !== true);
    }

    /* In einer bewusst aktivierten Admin-Vorschau (z. B. CL-Test cl2526)
       liegen fuer das Turnier oft schlicht noch keine Live-Daten vor – das
       ist KEIN Server-/App-Fehler. Analog zu index.html zeigen wir dann
       einen ruhigen Hinweis statt des roten Fehlerblocks. */
    function isPreviewWithoutLiveData() {
        try {
            return !!(APP && typeof APP.isPreviewActive === 'function' && APP.isPreviewActive());
        } catch (_) {
            return false;
        }
    }

    function showPreviewNoDataNotice() {
        const teamView   = document.getElementById('team-view');
        const emptyState = document.getElementById('empty-state');
        if (teamView)   teamView.style.display = 'none';
        if (emptyState) {
            emptyState.style.display = 'block';
            emptyState.innerHTML = `<span class="empty-icon">🔭</span>Vorschau: Fuer ${TOURNAMENT_LABEL} liegen noch keine Live-Daten vor.`;
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
        const teamView = document.getElementById('team-view');
        const emptyState = document.getElementById('empty-state');
        if (!hasRenderedOnce && teamView) teamView.style.display = 'none';
        if (emptyState) {
            emptyState.style.display = 'block';
            emptyState.textContent = message;
        }
    }

    /* =====================================================
       SEARCH EVENT LISTENERS
       ===================================================== */
    function initSearchListeners() {
        const desktopSearch = document.getElementById('manager-search');
        if (desktopSearch) {
            desktopSearch.addEventListener('input', () => {
                renderManagerList(getFilteredTeams(desktopSearch.value));
            });
        }
    }

    /* =====================================================
       INIT
       ===================================================== */
    async function init() {
        applyTeamsLockState();
        scheduleTeamsAutoReveal();

        // Wenn ein Admin den Dev-Override umstellt, ändert sich
        // isTeamsLocked() – wir reagieren live, ohne Page-Reload.
        if (window.DreamTeamAdmin && typeof window.DreamTeamAdmin.onAdminChange === 'function') {
            window.DreamTeamAdmin.onAdminChange(() => {
                applyTeamsLockState();
                const currentDisplayed = document.getElementById('display-manager-name');
                if (currentDisplayed && Array.isArray(allTeams)) {
                    const name = currentDisplayed.textContent.trim();
                    const team = allTeams.find(t => t.manager === name);
                    if (team) loadTeam(team);
                }
            });
        }

        initSearchListeners();
        initModalEvents();
        initBadgeCatalogModalEvents();
        initTiltObserver();

        try {
            // bootstrap() ersetzt die alte Sequenz aus getCachedBundle +
            // loadBundle + subscribeToMeta. Damit fällt der separate
            // Meta-Read in der Initialisierung weg – die Teams-Liste
            // selbst bleibt sowieso turnierübergreifend im Cache, weil
            // sich teamsVersion nach Turnierstart nicht mehr ändert.
            if (!metaUnsubscribe) {
                metaUnsubscribe = await DreamTeamCache.bootstrap({
                    ...CACHE_OPTIONS,
                    // Cached-first: letzter lokaler Stand sofort rendern,
                    // Server-Bestaetigung laeuft im Hintergrund (Pill unten).
                    renderCached: true,
                    onCachedReady: (data, info) => {
                        if (isServerVerifiedCacheInfo(info)) {
                            markServerVerified();
                            applyDataset(data, { preferCurrentDisplayed: false });
                            return;
                        }
                        if (cachedBundleHasContent(data)) {
                            try {
                                applyDataset(data, { preferCurrentDisplayed: false });
                                showSyncIndicator();
                            } catch (err) {
                                console.warn('[teams] Cached-Render fehlgeschlagen:', err);
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
                                showFreshnessError(`Teams fuer ${TOURNAMENT_LABEL} warten auf frische Serverdaten.`);
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
                            applyDataset(data, { preferCurrentDisplayed: hasRenderedOnce });
                        } finally {
                            isMetaRefreshRunning = false;
                        }
                    },
                    onError: (err) => {
                        console.error('Meta-Listener Fehler:', err);
                        if (hasRenderedOnce) {
                            // Inhalt ist sichtbar → nicht-destruktiver Hinweis
                            // statt Ausblenden der Team-Ansicht.
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
                        showFreshnessError(`Aktuelle Teamdaten fuer ${TOURNAMENT_LABEL} konnten nicht vom Server geladen werden.`);
                        const teamView   = document.getElementById('team-view');
                        const emptyState = document.getElementById('empty-state');
                        if (teamView)   teamView.style.display = 'none';
                        if (emptyState) {
                            emptyState.style.display = 'block';
                            emptyState.innerHTML = `<span class="empty-icon">⚠️</span>Fehler beim Laden der Teams für ${TOURNAMENT_LABEL}.`;
                        }
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
                showFreshnessError(`Aktuelle Teamdaten fuer ${TOURNAMENT_LABEL} konnten nicht vom Server geladen werden.`);
                const teamView   = document.getElementById('team-view');
                const emptyState = document.getElementById('empty-state');
                if (teamView)   teamView.style.display = 'none';
                if (emptyState) {
                    emptyState.style.display = 'block';
                    emptyState.innerHTML = `<span class="empty-icon">⚠️</span>Fehler beim Laden der Teams für ${TOURNAMENT_LABEL}.`;
                }
            }
        }
    }

    window.addEventListener('DOMContentLoaded', init);

    window.addEventListener('pageshow', () => {
        setTimeout(() => { initCardTilt(); }, 120);
    });

    document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible') {
            setTimeout(() => { initCardTilt(); }, 80);
        }
    });

    window.addEventListener('beforeunload', () => {
        if (typeof metaUnsubscribe === 'function') metaUnsubscribe();
        stopLockCountdown();
        if (typeof _autoRevealCancel === 'function') _autoRevealCancel();
    });
