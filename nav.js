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

    // Nach einem Deploy uebernimmt der neue SW per skipWaiting die Kontrolle
    // (controllerchange). Damit der Nutzer sofort frische Assets sieht, laden
    // wir die Seite dann EINMAL neu. Wichtig: nur ein einziges Mal pro
    // Tab-Session – sonst kann es (z. B. bei voruebergehend inkonsistenten
    // Deploys, die abwechselnd zwei SW-Versionen ausliefern) zu einer
    // Reload-Schleife kommen, bei der die Animation staendig neu nachlaedt.
    const SW_RELOAD_FLAG = 'dreamteam_sw_reloaded';
    let reloadAfterControllerChange = !!navigator.serviceWorker.controller;
    let controllerReloadStarted = false;
    navigator.serviceWorker.addEventListener('controllerchange', () => {
        if (!reloadAfterControllerChange || controllerReloadStarted) {
            reloadAfterControllerChange = true;
            return;
        }

        // Bereits in dieser Tab-Session einmal wegen SW-Wechsel neu geladen?
        // Dann NICHT erneut neu laden (verhindert die Reload-Schleife).
        let alreadyReloaded = false;
        try { alreadyReloaded = window.sessionStorage.getItem(SW_RELOAD_FLAG) === '1'; } catch (_) {}
        if (alreadyReloaded) return;

        controllerReloadStarted = true;
        try { window.sessionStorage.setItem(SW_RELOAD_FLAG, '1'); } catch (_) {}
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
 *  Turnier-Wechsel für Admins. Früher ein schwebendes Popover oben links,
 *  heute eine Gruppe von Einträgen im Dev-Bereich des Profil-Dropdowns
 *  (siehe auth-modal.js → devMenu) – zusammen mit den übrigen Dev-Optionen.
 *
 *  Aktuell ist nur `wm2026` produktiv verfügbar. Solange es nur ein Turnier
 *  zu wählen gibt, werden gar keine Einträge registriert – es gibt schlicht
 *  nichts auszuwählen. Sobald weitere Turniere in tournament-config.js
 *  aktiviert werden (`available: true && dataReady: true`) oder ein Turnier
 *  über den Preview-Kanal ladbar ist, erscheinen sie automatisch.
 *
 *  Wichtig:
 *  - Der eigentliche Standard kommt aus dem Domain-Mapping in
 *    tournament-config.js (dt.alae.app → WM 2026).
 *  - Die Auswahl ist nur ein TEST-OVERRIDE und wird host-spezifisch in
 *    localStorage abgelegt (`dreamteam_dev_override_${hostname}`).
 *  - Ist ein Override aktiv, gibt es zusätzlich den Eintrag
 *    "Zurück auf Domain-Default".
 *
 *  Sichtbarkeit:
 *  - Nur für eingeloggte Admins (das Dev-Menü rendert für alle anderen
 *    Nutzer gar nichts, siehe admin.js / window.DreamTeamAdmin).
 *  - Zusätzlich lässt sich der ganze Block mit ?dev=0 oder
 *    localStorage["dreamteam_hide_dev"]="1" lokal deaktivieren.
 * ============================================================================= */
function buildDevTournamentSwitcher(APP) {
    if (!APP || typeof APP.tournaments !== 'object') return;

    // auth-modal.js wird nach nav.js geladen. Beim regulären Boot steht es
    // zu DOMContentLoaded längst bereit; falls die Seite es doch später
    // einbindet, warten wir kurz – sonst gäbe es für Admins still keine
    // Turnier-Einträge.
    const Modal = window.DreamTeamAuthModal;
    if (!Modal || !Modal.devMenu || typeof Modal.devMenu.register !== 'function') {
        let attempts = 0;
        const maxAttempts = 50; // ~5s
        const interval = setInterval(() => {
            attempts += 1;
            const M = window.DreamTeamAuthModal;
            if (M && M.devMenu && typeof M.devMenu.register === 'function') {
                clearInterval(interval);
                buildDevTournamentSwitcher(APP);
            } else if (attempts >= maxAttempts) {
                clearInterval(interval);
            }
        }, 100);
        return;
    }

    try {
        const params = new URLSearchParams(window.location.search);
        if (params.get('dev') === '0') return;
        if (window.localStorage.getItem('dreamteam_hide_dev') === '1') return;
    } catch (_) {
        // Wenn Storage/Params nicht lesbar sind, registrieren wir trotzdem
        // (das Admin-Gate im Dev-Menü greift weiter).
    }

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
    // tournament-config.js).
    let previewKeys = [];
    if (Array.isArray(APP.previewableTournamentKeys)) {
        previewKeys = APP.previewableTournamentKeys.slice();
    } else if (typeof APP.getPreviewableTournamentKeys === 'function') {
        previewKeys = APP.getPreviewableTournamentKeys();
    }

    // Erst sinnvoll, sobald es überhaupt etwas zu wählen gibt: mehrere
    // verfügbare Turniere ODER mindestens eine Admin-Vorschau.
    if (tournamentKeys.length + previewKeys.length < 2) return;

    const overrideActive = typeof APP.isDevOverrideActive === 'function'
        ? APP.isDevOverrideActive()
        : false;
    const urlOverrideActive = typeof APP.isUrlOverrideActive === 'function'
        ? APP.isUrlOverrideActive()
        : false;

    const domainDefaultKey = APP.domainDefaultKey;
    const GROUP = 'Turnier';
    const GROUP_ORDER = 20;
    let order = 0;

    tournamentKeys.forEach((key) => {
        const t = APP.tournaments[key];
        const baseLabel = (t && t.shortLabel) ? t.shortLabel : key;
        const isDomainDefault = key === domainDefaultKey;
        const isActive = key === APP.activeTournamentKey;
        const marks = [];
        if (isActive) marks.push(overrideActive ? 'Override' : 'aktiv');
        if (isDomainDefault) marks.push('Domain');

        order += 1;
        Modal.devMenu.register({
            id: `tournament-${key}`,
            group: GROUP,
            groupOrder: GROUP_ORDER,
            order,
            label: baseLabel,
            value: marks.join(' · '),
            accent: isActive ? 'active' : null,
            disabled: isActive && !urlOverrideActive,
            onSelect: () => {
                if (typeof APP.setActiveTournament === 'function') {
                    APP.setActiveTournament(key);
                }
            }
        });
    });

    // Admin-Vorschau-Optionen (noch nicht freigeschaltete Turniere, z. B.
    // die CL vor der Freischaltung). Klick lädt das Turnier über den
    // Preview-Kanal.
    previewKeys.forEach((key) => {
        const t = APP.tournaments[key];
        const baseLabel = (t && t.shortLabel) ? t.shortLabel : key;
        const isActive = key === APP.activeTournamentKey;

        order += 1;
        Modal.devMenu.register({
            id: `tournament-preview-${key}`,
            group: GROUP,
            groupOrder: GROUP_ORDER,
            order,
            label: `${baseLabel} (Vorschau)`,
            value: isActive ? 'aktiv' : '',
            accent: 'info',
            disabled: isActive,
            onSelect: () => {
                if (typeof APP.setPreviewTournament === 'function') {
                    APP.setPreviewTournament(key);
                }
            }
        });
    });

    // Aktive Vorschau beenden → zurück auf die normale Auflösung.
    if (typeof APP.isPreviewActive === 'function' && APP.isPreviewActive()) {
        Modal.devMenu.register({
            id: 'tournament-preview-exit',
            group: GROUP,
            groupOrder: GROUP_ORDER,
            order: 900,
            label: 'Vorschau beenden',
            accent: 'info',
            onSelect: () => {
                if (typeof APP.clearPreview === 'function') APP.clearPreview();
            }
        });
    }

    if (overrideActive) {
        Modal.devMenu.register({
            id: 'tournament-reset-default',
            group: GROUP,
            groupOrder: GROUP_ORDER,
            order: 901,
            label: 'Zurück auf Domain-Default',
            accent: 'danger',
            onSelect: () => {
                if (typeof APP.resetToDomainDefault === 'function') APP.resetToDomainDefault();
            }
        });
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

/* =========================================================================
 *  Vorschau-Hinweis (kompakter Dev-Pill oben links).
 *
 *  Sobald eine Admin-VORSCHAU aktiv ist (Preview-Kanal, siehe
 *  tournament-config.js), einen dezenten, festen Hinweis mit 1-Klick-Ausstieg
 *  oben links einblenden – im Stil der übrigen Dev-Knöpfe. So lässt sich eine
 *  Vorschau nie mit der echten Produktiv-Seite verwechseln, ohne dass der
 *  Hinweis (wie der frühere Balken am unteren Rand) auf Mobil die untere
 *  Bereichsleiste (.bottom-nav: Dashboard/Analyse/…) überdeckt. Unabhängig
 *  davon, ob der (Admin-gate-abhängige) Turnier-Switcher sichtbar ist. Rein
 *  additiv: ohne aktive Vorschau ein No-op (die WM ist nie betroffen).
 * ========================================================================= */
function buildPreviewBadge(APP) {
    if (!APP || typeof APP.isPreviewActive !== 'function' || !APP.isPreviewActive()) return;
    if (document.getElementById('dt-preview-badge')) return;

    let previewLabel = 'Vorschau';
    let backLabel = 'Standard-Turnier';
    try {
        if (APP.activeTournament && APP.activeTournament.shortLabel) {
            previewLabel = APP.activeTournament.shortLabel;
        }
    } catch (_) { /* keep default */ }
    try {
        const def = APP.domainDefaultTournament;
        if (def && def.shortLabel) backLabel = def.shortLabel;
    } catch (_) { /* keep default */ }

    // Volltext bleibt für Screenreader / Hover erhalten – der sichtbare Pill
    // ist bewusst kompakt gehalten.
    const fullText = `🔧 Admin-Vorschau aktiv: ${previewLabel} – nicht die öffentliche Seite. Zur ${backLabel} zurück.`;

    const bar = document.createElement('div');
    bar.id = 'dt-preview-badge';
    bar.setAttribute('role', 'status');
    bar.setAttribute('aria-label', fullText);
    bar.title = fullText;
    // Kompakter Dev-Pill oben links statt breitem Balken am unteren Rand: so
    // stört er weder das Layout noch – auf Mobil – die untere Bereichsleiste
    // (.bottom-nav für Dashboard/Analyse/…). Optik im Stil der übrigen
    // Dev-Knöpfe (dunkel, transluzent, Blau-Akzent als Vorschau-Signal –
    // passend zum CL-Theme; erkennbar bleibt der Pill über 🔧 + „Vorschau").
    bar.style.cssText = [
        'position:fixed', 'top:8px', 'left:8px', 'z-index:2147483000',
        'display:inline-flex', 'align-items:center', 'gap:8px',
        'max-width:min(92vw,360px)', 'padding:4px 8px', 'border-radius:6px',
        'background:rgba(0,0,0,0.62)', 'border:1px solid rgba(125,180,255,0.55)',
        'color:rgba(125,180,255,0.95)',
        'font:700 11px/1.4 monospace,system-ui,-apple-system,"Segoe UI",Roboto,sans-serif',
        'box-shadow:0 2px 10px rgba(0,0,0,.35)',
        'user-select:none', '-webkit-user-select:none'
    ].join(';');

    const text = document.createElement('span');
    text.textContent = `🔧 Vorschau: ${previewLabel}`;
    text.style.cssText = [
        'min-width:0', 'overflow:hidden', 'text-overflow:ellipsis', 'white-space:nowrap'
    ].join(';');

    const btn = document.createElement('button');
    btn.type = 'button';
    btn.textContent = '↩';
    btn.setAttribute('aria-label', `Zur ${backLabel} zurück`);
    btn.title = `Zur ${backLabel} zurück`;
    btn.style.cssText = [
        'flex:0 0 auto', 'cursor:pointer', 'border:0', 'border-radius:4px',
        'padding:2px 7px', 'background:rgba(125,180,255,0.18)',
        'color:rgba(125,180,255,0.95)',
        'font:800 12px/1 monospace,system-ui,-apple-system,"Segoe UI",Roboto,sans-serif',
        'white-space:nowrap'
    ].join(';');
    btn.addEventListener('mouseenter', () => { btn.style.background = 'rgba(125,180,255,0.30)'; });
    btn.addEventListener('mouseleave', () => { btn.style.background = 'rgba(125,180,255,0.18)'; });
    btn.addEventListener('click', () => {
        try {
            if (typeof APP.clearPreview === 'function') { APP.clearPreview(); return; }
        } catch (_) { /* fall through */ }
        try {
            if (typeof APP.resetToDomainDefault === 'function') { APP.resetToDomainDefault(); return; }
        } catch (_) { /* fall through */ }
        window.location.reload();
    });

    bar.appendChild(text);
    bar.appendChild(btn);
    (document.body || document.documentElement).appendChild(bar);

    // Oben links ist jetzt nichts mehr im Weg: die Dev-Knöpfe sind ins
    // Profil-Dropdown gewandert, der Pill sitzt fix auf top:8px.
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

    // Die Ligatabelle ist KEIN eigenes Register mehr: Sie lebt jetzt in der
    // Analyse unter „Turnier" → „Ligatabelle" (siehe spieleranalyse). Für die
    // WM war hier ohnehin nichts; für die CL wird der frühere eigene
    // Ligatabellen-Eintrag bewusst nicht mehr in die Navigation gehängt.

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
    buildPreviewBadge(APP);

    registerServiceWorker();
});
