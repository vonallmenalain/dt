(function resetDreamTeamStateIfRequested() {
    try {
        const url = new URL(window.location.href);
        if (url.searchParams.get('reset-cache') !== '1') return;

        const keysToDelete = [];
        for (let i = 0; i < window.localStorage.length; i += 1) {
            const key = window.localStorage.key(i);
            if (key && key.toLowerCase().startsWith('dreamteam')) {
                keysToDelete.push(key);
            }
        }
        keysToDelete.forEach((key) => window.localStorage.removeItem(key));

        const sessionKeysToDelete = [];
        for (let i = 0; i < window.sessionStorage.length; i += 1) {
            const key = window.sessionStorage.key(i);
            if (key && key.toLowerCase().startsWith('dreamteam')) {
                sessionKeysToDelete.push(key);
            }
        }
        sessionKeysToDelete.forEach((key) => window.sessionStorage.removeItem(key));

        Promise.resolve()
            .then(async () => {
                if ('caches' in window) {
                    const cacheKeys = await caches.keys();
                    await Promise.all(cacheKeys.map((cacheKey) => caches.delete(cacheKey)));
                }
            })
            .then(async () => {
                if ('serviceWorker' in navigator) {
                    const registrations = await navigator.serviceWorker.getRegistrations();
                    await Promise.all(registrations.map((registration) => registration.unregister()));
                }
            })
            .finally(() => {
                url.searchParams.delete('reset-cache');
                const target = `${url.pathname}${url.searchParams.toString() ? `?${url.searchParams.toString()}` : ''}${url.hash}`;
                window.location.replace(target || '/');
            });
    } catch (err) {
        console.error('[PWA] reset-cache fehlgeschlagen:', err);
    }
})();



function registerServiceWorker() {
    if (!('serviceWorker' in navigator)) {
        return;
    }

    if (window.location.protocol === 'file:') {
        console.info('[PWA] Service Worker wird unter file:// nicht registriert. Nutze HTTPS oder localhost.');
        return;
    }

    let reloadAfterControllerChange = !!navigator.serviceWorker.controller;
    let controllerReloadStarted = false;
    navigator.serviceWorker.addEventListener('controllerchange', () => {
        if (!reloadAfterControllerChange || controllerReloadStarted) {
            reloadAfterControllerChange = true;
            return;
        }

        controllerReloadStarted = true;
        window.location.reload();
    });

    window.addEventListener('load', () => {
        navigator.serviceWorker.register('./service-worker.js', {
            scope: './',
            updateViaCache: 'none'
        })
            .then(registration => {
                console.log('[PWA] Service Worker registriert:', registration.scope);
                registration.update().catch(() => { /* Update-Check darf die App nicht blockieren. */ });

                let lastUpdateCheck = 0;
                const checkForServiceWorkerUpdate = () => {
                    const ageMs = Date.now() - lastUpdateCheck;
                    if (ageMs < 5 * 60 * 1000) return;
                    lastUpdateCheck = Date.now();
                    registration.update().catch(() => { /* Offline/Background: spaeter erneut versuchen. */ });
                };

                window.addEventListener('online', checkForServiceWorkerUpdate);
                window.addEventListener('focus', checkForServiceWorkerUpdate);
                document.addEventListener('visibilitychange', () => {
                    if (!document.hidden) checkForServiceWorkerUpdate();
                });
            })
            .catch(error => {
                console.error('[PWA] Service Worker Registrierung fehlgeschlagen:', error);
            });
    }, { once: true });
}

/* =============================================================================
 *  DEV TOURNAMENT SWITCHER
 *
 *  Sehr unauffälliger Dev-Knopf oben links (neben dem ggf. vorhandenen
 *  "DEV: Auto/Vor Start/Nach Start"-Toggle in index.html). Beschriftet nur
 *  mit "Dev". Erst beim Klick öffnet sich ein kleines Popover, in dem
 *  zwischen den aktuell verfügbaren Turnieren aus tournament-config.js
 *  gewechselt werden kann.
 *
 *  Aktuell ist nur `wm2026` produktiv verfügbar. Solange nur ein einziges
 *  Turnier verfügbar ist, wird der Switcher gar nicht erst gerendert – es
 *  gibt schlicht nichts auszuwählen. Sobald weitere Turniere in
 *  tournament-config.js aktiviert werden (`available: true && dataReady: true`),
 *  erscheint der Switcher automatisch wieder.
 *
 *  Wichtig:
 *  - Der eigentliche Standard kommt aus dem Domain-Mapping in
 *    tournament-config.js (dt.alae.app → WM 2026).
 *  - Der Dev-Knopf dient nur noch als TEST-OVERRIDE und schreibt
 *    seine Auswahl host-spezifisch in localStorage
 *    (`dreamteam_dev_override_${hostname}`).
 *  - Wenn ein Override aktiv ist, zeigt der Knopf das per Farbakzent an
 *    und erlaubt mit "↺ Domain-Default" das Zurücksetzen auf die
 *    domain-basierte Standardwahl.
 *
 *  Sichtbarkeit:
 *  - Nur für eingeloggte Admins sichtbar (siehe admin.js / window.DreamTeamAdmin).
 *  - Für alle anderen Nutzer bleibt der Wrapper komplett versteckt.
 *  - Zusätzlich kann ein Admin den Knopf mit ?dev=0 oder
 *    localStorage["dreamteam_hide_dev"]="1" lokal komplett deaktivieren.
 * ============================================================================= */
function buildDevTournamentSwitcher(APP) {
    if (!APP || typeof APP.tournaments !== 'object') return;

    try {
        const params = new URLSearchParams(window.location.search);
        if (params.get('dev') === '0') return;
        if (window.localStorage.getItem('dreamteam_hide_dev') === '1') return;
    } catch (_) {
        // Wenn Storage/Params nicht lesbar sind, zeigen wir den Switcher trotzdem
        // (Admin-Gate weiter unten greift).
    }

    if (document.getElementById('dev-tournament-switcher')) return;

    // Nur Turniere zeigen, die aktuell wirklich verfügbar sind
    // (siehe APP_CONFIG.getAvailableTournamentKeys – `available !== false`
    // und `dataReady === true`). Deaktivierte Templates für künftige
    // Turniere bleiben unsichtbar.
    let tournamentKeys = [];
    if (Array.isArray(APP.availableTournamentKeys)) {
        tournamentKeys = APP.availableTournamentKeys.slice();
    } else if (typeof APP.getAvailableTournamentKeys === 'function') {
        tournamentKeys = APP.getAvailableTournamentKeys();
    } else {
        // Sehr alter Fallback (sollte mit aktueller tournament-config.js
        // nicht mehr greifen) – wenigstens nicht crashen.
        tournamentKeys = Object.keys(APP.tournaments || {});
    }

    // Zusätzlich: (noch) nicht freigeschaltete Turniere, die als
    // Admin-Vorschau geladen werden können (Preview-Kanal, siehe
    // tournament-config.js). Diese Optionen sind – wie der ganze
    // Switcher – nur für eingeloggte Admins sichtbar (Admin-Gate unten).
    let previewKeys = [];
    if (Array.isArray(APP.previewableTournamentKeys)) {
        previewKeys = APP.previewableTournamentKeys.slice();
    } else if (typeof APP.getPreviewableTournamentKeys === 'function') {
        previewKeys = APP.getPreviewableTournamentKeys();
    }

    // Der Switcher erscheint, sobald es überhaupt etwas zu wählen gibt:
    // mehrere verfügbare Turniere ODER mindestens eine Admin-Vorschau.
    if (tournamentKeys.length + previewKeys.length < 2) return;

    const overrideActive = typeof APP.isDevOverrideActive === 'function'
        ? APP.isDevOverrideActive()
        : false;
    const urlOverrideActive = typeof APP.isUrlOverrideActive === 'function'
        ? APP.isUrlOverrideActive()
        : false;

    const RESET_VALUE = '__reset_to_domain_default__';
    const domainDefaultKey = APP.domainDefaultKey;
    const domainDefaultLabel = (APP.domainDefaultTournament && APP.domainDefaultTournament.shortLabel)
        || domainDefaultKey
        || '–';

    // Container nimmt Button + Popover auf, damit beides gemeinsam positioniert
    // werden kann (oben links, neben einem evtl. vorhandenen #dev-index-toggle).
    const wrapper = document.createElement('div');
    wrapper.id = 'dev-tournament-switcher';
    Object.assign(wrapper.style, {
        position: 'fixed',
        top: '8px',
        left: '8px',
        zIndex: '9999',
        fontFamily: 'monospace, system-ui, -apple-system, Segoe UI, sans-serif',
        userSelect: 'none',
        WebkitUserSelect: 'none'
    });

    // Falls der DEV-Ansichtsmodus-Knopf (#dev-index-toggle, nur auf index.html)
    // existiert, setzen wir den Turnier-Switcher direkt rechts daneben.
    function placeNextToIndexToggle() {
        const toggle = document.getElementById('dev-index-toggle');
        if (!toggle) return;
        const monitorLink = document.getElementById('admin-sync-monitor-link');
        const anchor = monitorLink && monitorLink.classList.contains('is-admin-visible')
            ? monitorLink
            : toggle;
        const rect = anchor.getBoundingClientRect();
        if (!rect || !rect.width) return;
        wrapper.style.left = `${Math.round(rect.right + 6)}px`;
        wrapper.style.top = `${Math.round(rect.top)}px`;
    }

    const button = document.createElement('button');
    button.type = 'button';
    button.id = 'dev-tournament-toggle';
    button.textContent = 'Dev';
    button.setAttribute('aria-haspopup', 'menu');
    button.setAttribute('aria-expanded', 'false');
    button.setAttribute(
        'aria-label',
        overrideActive
            ? `Dev: Turnier wechseln (Override aktiv, Domain-Default: ${domainDefaultLabel})`
            : `Dev: Turnier wechseln (Domain-Default: ${domainDefaultLabel})`
    );
    button.title = overrideActive
        ? `Dev Override aktiv – Domain-Default: ${domainDefaultLabel}`
        : `Domain-Default: ${domainDefaultLabel}`;
    Object.assign(button.style, {
        fontSize: '11px',
        fontFamily: 'monospace',
        fontWeight: '700',
        padding: '4px 8px',
        borderRadius: '6px',
        border: overrideActive
            ? '1px solid rgba(255, 120, 120, 0.55)'
            : '1px solid rgba(255, 255, 255, 0.2)',
        background: 'rgba(0, 0, 0, 0.55)',
        color: overrideActive ? 'rgba(255, 180, 162, 0.95)' : 'rgba(255, 255, 255, 0.7)',
        cursor: 'pointer',
        opacity: '0.55',
        transition: 'opacity 0.2s ease, background 0.2s ease',
        lineHeight: '1.4',
        letterSpacing: '0.3px'
    });
    button.addEventListener('mouseenter', () => {
        button.style.opacity = '0.9';
        button.style.background = 'rgba(0, 0, 0, 0.8)';
    });
    button.addEventListener('mouseleave', () => {
        button.style.opacity = '0.55';
        button.style.background = 'rgba(0, 0, 0, 0.55)';
    });

    // Popover mit den Auswahl-Optionen, standardmässig versteckt.
    const popover = document.createElement('div');
    popover.id = 'dev-tournament-popover';
    popover.setAttribute('role', 'menu');
    Object.assign(popover.style, {
        position: 'absolute',
        top: 'calc(100% + 6px)',
        left: '0',
        minWidth: '180px',
        padding: '6px',
        display: 'none',
        flexDirection: 'column',
        gap: '2px',
        background: 'rgba(20, 20, 20, 0.95)',
        border: overrideActive
            ? '1px solid rgba(255, 120, 120, 0.55)'
            : '1px solid rgba(255, 255, 255, 0.2)',
        borderRadius: '8px',
        boxShadow: '0 8px 24px rgba(0,0,0,0.45)',
        backdropFilter: 'blur(6px)',
        fontSize: '11px',
        fontWeight: '600',
        color: 'rgba(255,255,255,0.85)'
    });

    // Header zeigt den Domain-Default zur Orientierung.
    const header = document.createElement('div');
    header.textContent = overrideActive
        ? `Dev Override aktiv (Default: ${domainDefaultLabel})`
        : `Domain-Default: ${domainDefaultLabel}`;
    Object.assign(header.style, {
        padding: '4px 8px 6px',
        borderBottom: '1px solid rgba(255,255,255,0.08)',
        marginBottom: '4px',
        fontSize: '10px',
        fontWeight: '700',
        letterSpacing: '0.3px',
        color: overrideActive ? '#ffb4a2' : '#ffd166',
        textTransform: 'uppercase'
    });
    popover.appendChild(header);

    function closePopover() {
        popover.style.display = 'none';
        button.setAttribute('aria-expanded', 'false');
    }

    function openPopover() {
        placeNextToIndexToggle();
        popover.style.display = 'flex';
        button.setAttribute('aria-expanded', 'true');
    }

    function makeItem({ text, isActive, isDomain, accent, onClick }) {
        const item = document.createElement('button');
        item.type = 'button';
        item.setAttribute('role', 'menuitem');
        item.textContent = text;
        Object.assign(item.style, {
            display: 'block',
            width: '100%',
            textAlign: 'left',
            padding: '6px 8px',
            borderRadius: '6px',
            border: '1px solid transparent',
            background: isActive ? 'rgba(255, 209, 102, 0.12)' : 'transparent',
            color: accent || (isActive ? '#ffd166' : 'rgba(255,255,255,0.85)'),
            fontSize: '11px',
            fontWeight: isActive ? '800' : '600',
            cursor: 'pointer',
            outline: 'none',
            lineHeight: '1.3'
        });
        if (isDomain) {
            item.style.borderColor = 'rgba(255, 209, 102, 0.35)';
        }
        item.addEventListener('mouseenter', () => {
            item.style.background = 'rgba(255,255,255,0.08)';
        });
        item.addEventListener('mouseleave', () => {
            item.style.background = isActive ? 'rgba(255, 209, 102, 0.12)' : 'transparent';
        });
        item.addEventListener('click', (event) => {
            event.stopPropagation();
            try {
                onClick();
            } finally {
                closePopover();
            }
        });
        return item;
    }

    tournamentKeys.forEach((key) => {
        const t = APP.tournaments[key];
        const baseLabel = t && t.shortLabel ? t.shortLabel : key;
        const isDomainDefault = key === domainDefaultKey;
        const isActive = key === APP.activeTournamentKey;
        const marks = [];
        if (isDomainDefault) marks.push('★ Domain');
        if (isActive) marks.push(overrideActive ? 'Override aktiv' : 'aktiv');
        const suffix = marks.length ? ` — ${marks.join(' · ')}` : '';
        popover.appendChild(makeItem({
            text: `${baseLabel}${suffix}`,
            isActive,
            isDomain: isDomainDefault,
            onClick: () => {
                if (isActive && !urlOverrideActive) return;
                if (typeof APP.setActiveTournament === 'function') {
                    APP.setActiveTournament(key);
                }
            }
        }));
    });

    // Admin-Vorschau-Optionen (noch nicht freigeschaltete Turniere, z. B.
    // die CL vor dem 27.08.). Klick lädt das Turnier über den Preview-
    // Kanal – nur für Admins sichtbar.
    if (previewKeys.length) {
        const sep = document.createElement('div');
        Object.assign(sep.style, {
            borderTop: '1px solid rgba(255,255,255,0.10)',
            margin: '4px 0'
        });
        popover.appendChild(sep);

        previewKeys.forEach((key) => {
            const t = APP.tournaments[key];
            const baseLabel = t && t.shortLabel ? t.shortLabel : key;
            const isActive = key === APP.activeTournamentKey;
            popover.appendChild(makeItem({
                text: `${baseLabel} — Vorschau${isActive ? ' · aktiv' : ''}`,
                isActive,
                accent: '#8ec7ff',
                onClick: () => {
                    if (isActive) return;
                    if (typeof APP.setPreviewTournament === 'function') {
                        APP.setPreviewTournament(key);
                    }
                }
            }));
        });
    }

    // Aktive Vorschau beenden → zurück auf die normale Auflösung.
    if (typeof APP.isPreviewActive === 'function' && APP.isPreviewActive()) {
        popover.appendChild(makeItem({
            text: '↺ Vorschau beenden',
            accent: '#8ec7ff',
            onClick: () => {
                if (typeof APP.clearPreview === 'function') {
                    APP.clearPreview();
                }
            }
        }));
    }

    if (overrideActive) {
        popover.appendChild(makeItem({
            text: '↺ Zurück auf Domain-Default',
            accent: '#ffb4a2',
            onClick: () => {
                if (typeof APP.resetToDomainDefault === 'function') {
                    APP.resetToDomainDefault();
                }
            }
        }));
    }

    button.addEventListener('click', (event) => {
        event.stopPropagation();
        if (popover.style.display === 'none') {
            openPopover();
        } else {
            closePopover();
        }
    });

    document.addEventListener('click', (event) => {
        if (!wrapper.contains(event.target)) closePopover();
    });
    document.addEventListener('keydown', (event) => {
        if (event.key === 'Escape') closePopover();
    });
    window.addEventListener('resize', () => {
        if (popover.style.display !== 'none') placeNextToIndexToggle();
    });

    wrapper.appendChild(button);
    wrapper.appendChild(popover);

    // Admin-Gate: Wrapper ist standardmässig versteckt und wird ausschliesslich
    // sichtbar, wenn ein Admin (gem. admin.js / window.DreamTeamAdmin) eingeloggt
    // ist. Wir hängen ihn schon ins DOM, damit `placeNextToIndexToggle` korrekt
    // misst, sobald der Wrapper sichtbar wird.
    wrapper.style.display = 'none';
    document.body.appendChild(wrapper);

    function applyAdminVisibility(isAdmin) {
        if (isAdmin) {
            wrapper.style.display = '';
            placeNextToIndexToggle();
            setTimeout(placeNextToIndexToggle, 0);
            setTimeout(placeNextToIndexToggle, 250);
        } else {
            closePopover();
            wrapper.style.display = 'none';
        }
    }

    function hookAdmin() {
        if (!window.DreamTeamAdmin || typeof window.DreamTeamAdmin.onAdminChange !== 'function') {
            return false;
        }
        window.DreamTeamAdmin.onAdminChange(({ isAdmin }) => applyAdminVisibility(!!isAdmin));
        return true;
    }

    if (!hookAdmin()) {
        // admin.js kann nach nav.js geladen werden (defer / async). Kurz pollen,
        // bis DreamTeamAdmin verfügbar ist; danach gilt der Admin-Status.
        let attempts = 0;
        const maxAttempts = 50; // ~5s
        const interval = setInterval(() => {
            attempts += 1;
            if (hookAdmin() || attempts >= maxAttempts) {
                clearInterval(interval);
            }
        }, 100);
    }
}

/* =============================================================================
 *  Navbar auth icon — bootstrap
 *
 *  The actual icon + dropdown UI lives in auth-modal.js (window.DreamTeamAuthModal).
 *  This helper just makes sure the underlying DreamTeamAuth module is
 *  initialised on every page that hosts the global navbar so that the user
 *  sees a consistent login state across the app, and asks the modal to mount
 *  itself into the dedicated navbar slot.
 *
 *  Initialising twice is a no-op (DreamTeamAuth.init / install both guard
 *  themselves), so individual pages can still call init() with their own
 *  options (e.g. team-builder.html does this with its tournament-scoped
 *  pendingStorageKey).
 * ============================================================================= */
function initNavAuth(APP) {
    function buildPendingTeamKey() {
        try {
            if (APP && APP.storage && typeof APP.storage.key === 'function') {
                return APP.storage.key('pending_team');
            }
        } catch (_) { /* fall through */ }
        return 'dreamteam_pending_team';
    }

    function buildTeamBuilderHref() {
        let href = 'team-builder.html';
        try {
            if (APP && APP.key) {
                const url = new URL(href, window.location.href);
                url.searchParams.set('tournament', APP.key);
                const file = url.pathname.split('/').pop() || 'team-builder.html';
                href = `${file}${url.search ? url.search : ''}`;
            }
        } catch (_) { /* keep raw href */ }
        return href;
    }

    function tryInit() {
        // Need the auth helpers loaded; bail out gracefully on pages that
        // don't ship them (e.g. admin-only entry points).
        if (!window.DreamTeamAuth || !window.DreamTeamAuthModal) return false;

        // Auth module needs Firebase Auth + a Firestore handle. On pages that
        // didn't load firebase-auth-compat we still mount a "signed-out" icon
        // (it'll fall back to opening team-builder.html on click).
        const hasFirebaseAuth = typeof window.firebase !== 'undefined'
            && !!window.firebase
            && !!window.firebase.auth;
        const hasDbHelper     = !!(APP && typeof APP.getDb === 'function');
        const teamsCollection = (APP && APP.firestore && typeof APP.firestore.teamsCollection === 'function')
            ? APP.firestore.teamsCollection()
            : null;

        if (hasFirebaseAuth && hasDbHelper && teamsCollection) {
            try {
                window.DreamTeamAuth.init({
                    db:                window.firebase.firestore ? APP.getDb() : null,
                    teamsCollection,
                    pendingStorageKey: buildPendingTeamKey(),
                    actionUrl:         window.location.origin + window.location.pathname.replace(/[^/]*$/, '') + 'team-builder.html'
                });
            } catch (err) {
                console.warn('[nav] DreamTeamAuth.init failed (page may not need full auth):', err);
            }
        }

        try {
            window.DreamTeamAuthModal.install({
                navbarMountTarget: '#dt-auth-nav-slot',
                teamBuilderHref:   buildTeamBuilderHref()
            });
        } catch (err) {
            console.warn('[nav] DreamTeamAuthModal.install failed:', err);
        }
        return true;
    }

    if (tryInit()) return;

    // The auth scripts may load *after* nav.js (defer / async). Retry a few
    // times on a microtask delay to pick them up without spinning forever.
    let attempts = 0;
    const maxAttempts = 20;
    const retry = () => {
        attempts += 1;
        if (tryInit() || attempts >= maxAttempts) return;
        setTimeout(retry, 100);
    };
    setTimeout(retry, 50);
}

document.addEventListener("DOMContentLoaded", () => {
    const APP = window.APP_CONFIG;

    if (!APP) {
        console.error("APP_CONFIG fehlt. tournament-config.js wird nicht korrekt geladen.");
        return;
    }


    function withTournamentParam(href) {
        if (!href) return href;
        try {
            const url = new URL(href, window.location.href);
            if (APP && APP.key) url.searchParams.set('tournament', APP.key);
            return `${url.pathname.split('/').pop() || 'index.html'}${url.search ? url.search : ''}${url.hash || ''}`;
        } catch (_) {
            return href;
        }
    }

    const TEAM_BUILDER_ACTION = "team-builder";
    const TEAM_CREATE_LABEL = "Team erstellen";
    const TEAM_EDIT_LABEL = "Team bearbeiten";
    const TEAM_CREATE_ICON = "\u2795";
    const TEAM_EDIT_ICON = "\u270F\uFE0F";
    let teamBuilderStatusLookupSeq = 0;
    let teamBuilderStatusWatcherMounted = false;

    function navActionAttr(item) {
        return item && item.action ? ` data-nav-action="${item.action}"` : "";
    }

    function dispatchTeamBuilderStatus(hasTeam) {
        try {
            const detail = { hasTeam: !!hasTeam };
            let event;
            if (typeof CustomEvent === "function") {
                event = new CustomEvent("dreamteam:user-team-status", { detail });
            } else {
                event = document.createEvent("CustomEvent");
                event.initCustomEvent("dreamteam:user-team-status", false, false, detail);
            }
            window.dispatchEvent(event);
        } catch (_) { /* older browsers keep the static label */ }
    }

    function setTopTeamBuilderLabel(hasTeam) {
        const link = document.querySelector(`body > nav.navbar .nav-links .nav-item[data-nav-action="${TEAM_BUILDER_ACTION}"]`);
        if (!link) return;

        const label = hasTeam ? TEAM_EDIT_LABEL : TEAM_CREATE_LABEL;
        const icon = hasTeam ? TEAM_EDIT_ICON : TEAM_CREATE_ICON;

        link.textContent = `${icon} ${label}`;
        link.setAttribute("aria-label", label);
        link.dataset.hasSubmittedTeam = hasTeam ? "1" : "0";
    }

    function setTeamBuilderStatus(hasTeam) {
        setTopTeamBuilderLabel(hasTeam);
        dispatchTeamBuilderStatus(hasTeam);
    }

    async function refreshTeamBuilderStatus(authState) {
        const lookupSeq = ++teamBuilderStatusLookupSeq;
        const user = authState && authState.user;
        const isVerified = !!(authState && authState.isVerified);

        if (!user || !isVerified) {
            setTeamBuilderStatus(false);
            return;
        }

        const Auth = window.DreamTeamAuth;
        if (!Auth || (typeof Auth.hasSubmittedTeam !== "function" && typeof Auth.fetchUserTeam !== "function")) {
            setTeamBuilderStatus(false);
            return;
        }

        try {
            const hasTeam = typeof Auth.hasSubmittedTeam === "function"
                ? await Auth.hasSubmittedTeam(user.uid)
                : !!(await Auth.fetchUserTeam(user.uid));
            if (lookupSeq !== teamBuilderStatusLookupSeq) return;
            setTeamBuilderStatus(hasTeam);
        } catch (err) {
            if (lookupSeq !== teamBuilderStatusLookupSeq) return;
            console.warn("[nav] Team status lookup failed:", err);
            setTeamBuilderStatus(false);
        }
    }

    function initTeamBuilderStatusWatcher() {
        if (teamBuilderStatusWatcherMounted) return true;

        const Auth = window.DreamTeamAuth;
        if (!Auth || typeof Auth.onAuthStateChange !== "function") return false;

        teamBuilderStatusWatcherMounted = true;
        Auth.onAuthStateChange(refreshTeamBuilderStatus);
        return true;
    }

    const navItems = [
        { href: "index.html", label: "🏠 Dashboard", shortLabel: "Dashboard", icon: "🏠" },
        { href: "team-builder.html", label: "➕ Team erstellen", shortLabel: "Team", icon: "➕", action: TEAM_BUILDER_ACTION },
        { href: "teams.html", label: "🛡️ Teams", shortLabel: "Teams", icon: "🛡️" },
        { href: "spieleranalyse.html", label: "🔍 Analyse", shortLabel: "Analyse", icon: "🔍" },
        { href: "rangliste.html", label: "🏆 Rangliste", shortLabel: "Rangliste", icon: "🏆" },
        { href: "punktesystem.html", label: "📊 Punktesystem", shortLabel: "Punkte", icon: "📊" }
    ];

    const topNavLinks = navItems
        .map(item => `<a href="${withTournamentParam(item.href)}" class="nav-item"${navActionAttr(item)}>${item.label}</a>`)
        .join("");

    const bottomNavLinks = navItems
        .map(item => `
            <a href="${withTournamentParam(item.href)}" class="nav-item"${navActionAttr(item)}>
                <span class="icon">${item.icon}</span>
                <span>${item.shortLabel}</span>
            </a>
        `)
        .join("");

    // Brand-Texte werden komplett dynamisch aus APP_CONFIG gespeist,
    // damit kein Turnier-Begriff fix im Code bleibt.
    const brandShortLabel = APP.shortLabel || "DreamTeam";
    const brandSecondary = "DreamTeam";
    const brandAria = `${brandShortLabel} ${brandSecondary}`;

    const navHTML = `
        <nav class="navbar">
            <a href="${withTournamentParam('index.html')}" class="navbar-brand" aria-label="${brandAria}">
                <span class="brand-gold">${brandShortLabel}</span>
                <span class="brand-green">${brandSecondary}</span>
            </a>
            <div class="nav-actions">
                <div class="nav-links">
                    ${topNavLinks}
                </div>
                <div id="dt-auth-nav-slot" class="dt-auth-nav-slot" aria-label="Anmeldestatus"></div>
            </div>
        </nav>

        <nav class="bottom-nav">
            ${bottomNavLinks}
        </nav>
    `;

    document.body.insertAdjacentHTML("afterbegin", navHTML);

    initNavAuth(APP);
    setTeamBuilderStatus(false);
    if (!initTeamBuilderStatusWatcher()) {
        let teamStatusAttempts = 0;
        const maxTeamStatusAttempts = 20;
        const retryTeamStatusWatcher = () => {
            teamStatusAttempts += 1;
            if (initTeamBuilderStatusWatcher() || teamStatusAttempts >= maxTeamStatusAttempts) return;
            setTimeout(retryTeamStatusWatcher, 100);
        };
        setTimeout(retryTeamStatusWatcher, 50);
    }

    const currentPage = window.location.pathname.split("/").pop() || "index.html";
    const navLinks = document.querySelectorAll(".nav-item");

    navLinks.forEach(link => {
        const href = link.getAttribute("href");
        let hrefPage = href;
        try {
            hrefPage = new URL(href, window.location.href).pathname.split("/").pop() || "index.html";
        } catch (_) {
            hrefPage = href;
        }

        if (hrefPage === currentPage) {
            link.classList.add("active");
        }
        // Also mark index.html active when on root "/"
        if ((currentPage === "" || currentPage === "/") && hrefPage === "index.html") {
            link.classList.add("active");
        }
    });

    document.body.setAttribute("data-tournament-key", APP.key || "");
    document.body.setAttribute("data-tournament-label", APP.tournamentLabel || "");

    console.log("[nav] APP_CONFIG geladen:", {
        hostname: APP.hostname,
        domainDefaultKey: APP.domainDefaultKey,
        activeTournamentKey: APP.activeTournamentKey,
        devOverrideActive: typeof APP.isDevOverrideActive === "function" ? APP.isDevOverrideActive() : false,
        urlOverrideActive: typeof APP.isUrlOverrideActive === "function" ? APP.isUrlOverrideActive() : false,
        brandName: APP.brandName,
        pageTitlePrefix: APP.pageTitlePrefix
    });

    buildDevTournamentSwitcher(APP);

    registerServiceWorker();
});
