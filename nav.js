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
 *  TURNIER-WECHSEL FÜR ALLE ANGEMELDETEN NUTZER
 *
 *  Die WM 2026 ist gespielt, die Champions League läuft. Wer eingeloggt ist,
 *  soll trotzdem jederzeit in der abgeschlossenen WM nachlesen können –
 *  Rangliste, Teams, Resultate, Analyse. Dafür registriert diese Funktion
 *  Einträge im Nutzer-Bereich des Profil-Dropdowns (auth-modal.js → menu),
 *  gleich über „Abmelden".
 *
 *  Abgrenzung zum Dev-Switcher weiter unten:
 *    • Dieser hier ist für ALLE angemeldeten Nutzer und zeigt nur die
 *      regulär verfügbaren Turniere.
 *    • Der Dev-Switcher ist admin-only und kann zusätzlich Vorschau-Turniere
 *      laden, die (noch) nicht freigeschaltet sind.
 *
 *  Beide benutzen denselben Kanal wie eh und je: `setActiveTournament()`
 *  legt einen host-spezifischen Override in localStorage ab,
 *  `resetToDomainDefault()` räumt ihn weg. Ein Klick auf das Standard-
 *  Turnier räumt den Override also von selbst auf – es braucht keinen
 *  separaten „Zurück"-Eintrag.
 *
 *  Schreibschutz: Archiv-Turniere sind read-only. Das erzwingen die
 *  Firestore-Rules (Team-Writes seit dem Anpfiff gesperrt) und, damit die
 *  UI dazu passt, `archived: true` in tournament-config.js – der
 *  Team-Builder bleibt dort für alle gesperrt.
 * ============================================================================= */
function buildTournamentUserMenu(APP) {
    if (!APP || typeof APP.tournaments !== 'object') return;

    whenAuthModalReady((Modal) => {
        if (!Modal.menu || typeof Modal.menu.register !== 'function') return;

        const keys = (typeof APP.getAvailableTournamentKeys === 'function')
            ? APP.getAvailableTournamentKeys()
            : (Array.isArray(APP.availableTournamentKeys) ? APP.availableTournamentKeys.slice() : []);

        // Nichts zu wechseln → gar keinen Eintrag zeigen.
        if (keys.length < 2) return;

        const activeKey = APP.activeTournamentKey;
        const domainDefaultKey = APP.domainDefaultKey;
        let order = 0;

        keys.forEach((key) => {
            if (key === activeKey) return;
            const t = APP.tournaments[key] || {};
            const label = t.shortLabel || key;
            const archived = typeof APP.isTournamentArchived === 'function'
                && APP.isTournamentArchived(key);

            order += 1;
            Modal.menu.register({
                id: `tournament-switch-${key}`,
                order,
                icon: archived ? '📚' : '🏆',
                // „Zurück zu …" nur, wenn wir gerade woanders sind als beim
                // Standard – sonst ist es schlicht ein Wechsel.
                label: key === domainDefaultKey
                    ? `Zurück zu ${label}`
                    : `${label} ansehen`,
                value: archived ? 'Archiv' : '',
                title: archived
                    ? `${label} ist abgeschlossen – nur zum Nachlesen, Teams lassen sich dort nicht mehr ändern.`
                    : `Zu ${label} wechseln`,
                onSelect: () => {
                    if (key === domainDefaultKey && typeof APP.resetToDomainDefault === 'function') {
                        APP.resetToDomainDefault();
                    } else if (typeof APP.setActiveTournament === 'function') {
                        APP.setActiveTournament(key);
                    }
                }
            });
        });
    });
}

/* auth-modal.js wird nach nav.js geladen. Beim regulären Boot steht es zu
 * DOMContentLoaded längst bereit; falls eine Seite es doch später einbindet,
 * warten wir kurz – sonst gäbe es still keine Einträge. */
function whenAuthModalReady(callback) {
    const Modal = window.DreamTeamAuthModal;
    if (Modal && Modal.devMenu && typeof Modal.devMenu.register === 'function') {
        callback(Modal);
        return;
    }
    let attempts = 0;
    const maxAttempts = 50; // ~5s
    const interval = setInterval(() => {
        attempts += 1;
        const M = window.DreamTeamAuthModal;
        if (M && M.devMenu && typeof M.devMenu.register === 'function') {
            clearInterval(interval);
            callback(M);
        } else if (attempts >= maxAttempts) {
            clearInterval(interval);
        }
    }, 100);
}

/* =============================================================================
 *  DEV TOURNAMENT SWITCHER
 *
 *  Turnier-Wechsel für Admins. Früher ein schwebendes Popover oben links,
 *  heute eine Gruppe von Einträgen im Dev-Bereich des Profil-Dropdowns
 *  (siehe auth-modal.js → devMenu) – zusammen mit den übrigen Dev-Optionen.
 *
 *  Der Wechsel zwischen den regulär verfügbaren Turnieren steht inzwischen
 *  ALLEN angemeldeten Nutzern offen (siehe buildTournamentUserMenu oben).
 *  Dieser Block bleibt für das, was nur Admins dürfen: Vorschau-Turniere
 *  laden, die (noch) nicht freigeschaltet sind, und den Override wieder
 *  auflösen. Er zeigt zusätzlich an, welches Turnier gerade aktiv ist und
 *  welches der Domain-Default wäre.
 *
 *  Wichtig:
 *  - Der eigentliche Standard kommt aus tournament-config.js: zuerst der
 *    zeitgesteuerte Default (`defaultActiveFrom`, seit 27.08.2026
 *    dt.alae.app → Champions League), dann das statische Domain-Mapping.
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

    const Modal = window.DreamTeamAuthModal;
    if (!Modal || !Modal.devMenu || typeof Modal.devMenu.register !== 'function') {
        whenAuthModalReady(() => buildDevTournamentSwitcher(APP));
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

    /* Label für die Dev-Turnierliste. Die beiden CL-Turniere tragen
       bewusst denselben Anzeigenamen („Champions League" – ohne Saison,
       siehe tournament-config.js) und wären in der Liste sonst nicht
       auseinanderzuhalten. Hier – und NUR hier, im Admin-Menü – hängen
       wir deshalb den Saison-Zusatz an. */
    function devTournamentLabel(tournament, key) {
        const base = (tournament && tournament.shortLabel) ? tournament.shortLabel : key;
        const season = tournament && tournament.seasonLabel;
        return season ? `${base} ${season}` : base;
    }

    const domainDefaultKey = APP.domainDefaultKey;
    const domainDefaultLabel = (APP.domainDefaultTournament
            && devTournamentLabel(APP.domainDefaultTournament, domainDefaultKey))
        || domainDefaultKey
        || 'Standard-Turnier';
    const GROUP = 'Turnier';
    const GROUP_ORDER = 20;
    let order = 0;

    tournamentKeys.forEach((key) => {
        const t = APP.tournaments[key];
        const baseLabel = devTournamentLabel(t, key);
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
        const baseLabel = devTournamentLabel(t, key);
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

    // Aktive Vorschau beenden → zurück auf die normale Auflösung. Der
    // Zielname steht rechts daneben, damit klar ist, wohin der Klick führt –
    // diese Information stand früher im Vorschau-Pill oben links.
    if (typeof APP.isPreviewActive === 'function' && APP.isPreviewActive()) {
        Modal.devMenu.register({
            id: 'tournament-preview-exit',
            group: GROUP,
            groupOrder: GROUP_ORDER,
            order: 900,
            label: 'Vorschau beenden',
            value: `→ ${domainDefaultLabel}`,
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
            // Turnier-Parameter nur bei aktivem URL-Override (gleiches
            // Prinzip wie withTournamentParam unten): ein fest angehefteter
            // Key wuerde den Link nach einem Turnier-Wechsel auf das alte
            // Turnier pinnen - die ambiente Aufloesung reicht.
            const urlOverride = APP && typeof APP.isUrlOverrideActive === 'function'
                && APP.isUrlOverrideActive();
            if (urlOverride && APP && APP.key) {
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

    /* In der App-Shell eingebettet (app.html laedt die Seite als Frame)?
       Dann ist die eigene Navigation versteckt (styles.css) - Hoehen-
       Messung und Service-Worker-Registrierung uebernimmt die Shell.
       Auth-Init, Team-Status und Menue-Eintraege laufen normal weiter,
       damit die Seite selbst identisch funktioniert. */
    const isEmbedded = document.documentElement.hasAttribute("data-dt-embedded");


    /* Turnier-Parameter NUR anhaengen, wenn wirklich ein URL-Override die
       Aufloesung treibt (?tournament=... in der Adresszeile, das gerade
       benutzt wird). Frueher trug JEDER Link den aktiven Key - in der
       App-Shell landete der dann in der Hash-Route (app.html#/seite.html
       ?tournament=...) und pinnte den Frame nach einem Turnier-Wechsel
       auf das ALTE Turnier: Leiste neu, Inhalt alt (Durchmischung).
       Ohne Parameter loesen Shell und Frames identisch aus localStorage/
       Domain auf - der persistierte Wechsel greift damit ueberall. */
    function withTournamentParam(href) {
        if (!href) return href;
        let urlOverride = false;
        try {
            urlOverride = typeof APP.isUrlOverrideActive === 'function' && APP.isUrlOverrideActive();
        } catch (_) { /* im Zweifel: Links sauber lassen */ }
        if (!urlOverride) return href;
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

    /* Jede Seite hält oben `--dt-nav-space` frei (styles.css). Der Wert dort
       ist eine Rechnung aus Innenabstand + höchstem Kind und trifft den
       Normalfall – er kann die Leiste aber nicht kennen, wenn sie höher
       ausfällt als vorgesehen: auf schmalen Desktops (rund 900–1120px)
       brechen die sechs Links auf zwei Reihen um, und der Markenschriftzug
       ist je nach Turnier unterschiedlich lang. Genau dort lag der
       Bereichstitel bisher unter der Leiste.

       Deshalb misst die Navigation sich selbst und hebt die Variable an,
       wenn sie tatsächlich höher steht – bei Umbruch, nachladenden
       Schriften oder einem Breitenwechsel des Fensters.

       Sie senkt sie NIE unter den CSS-Wert: der Auth-Knopf hängt sich erst
       später ein (er wartet auf den Anmeldestatus), bis dahin ist die
       Leiste schmaler als im Endzustand. Ohne diese Untergrenze würde der
       Inhalt kurz zu weit oben stehen und dann nachrutschen. Der CSS-Wert
       wird dafür einmal über ein unsichtbares Messelement gelesen, bevor
       die Variable überhaupt überschrieben wird.

       Ein Kreislauf ist ausgeschlossen: die Höhe der Leiste hängt an
       `--dt-nav-pad`, nicht an dieser Variablen. */
    function syncNavHeightVar() {
        const nav = document.querySelector("body > nav.navbar");
        if (!nav) return;

        const root = document.documentElement;

        const probe = document.createElement("div");
        probe.style.cssText = "position:absolute;top:0;left:0;width:0;visibility:hidden;pointer-events:none;height:var(--dt-nav-space)";
        document.body.appendChild(probe);
        const cssFloor = probe.getBoundingClientRect().height;
        probe.remove();

        // Die Untergrenze gilt nur, solange der Auth-Knopf fehlt. Sobald er
        // steht, ist die Messung in jeder Breite die Wahrheit – sonst würde
        // ein am Desktop gelesener Startwert die schmalere mobile Leiste
        // nach einem Breitenwechsel überreservieren.
        const authSlot = nav.querySelector("#dt-auth-nav-slot");
        const isSettled = () => !authSlot || authSlot.children.length > 0;

        let applied = null;
        const apply = () => {
            const measured = Math.ceil(nav.getBoundingClientRect().height);
            const height = isSettled() ? measured : Math.max(cssFloor, measured);
            if (height > 0 && height !== applied) {
                applied = height;
                root.style.setProperty("--dt-nav-space", height + "px");
            }
        };

        apply();
        if (typeof ResizeObserver === "function") {
            new ResizeObserver(apply).observe(nav);
        } else {
            window.addEventListener("resize", apply);
        }
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
                <span class="brand-line">
                    <span class="brand-gold">${brandShortLabel}</span>
                    <span class="brand-green">${brandSecondary}</span>
                </span>
                <span class="brand-season"${APP.seasonLabel ? '' : ' hidden'}>${APP.seasonLabel ? `Saison ${APP.seasonLabel}` : ''}</span>
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

    /* Statische Navigation hydrieren statt neu bauen: Die Hauptseiten
       tragen die Leiste seit „Instant Navigation" direkt im HTML (siehe
       STATIC-NAV-Block dort), damit sie mit dem ersten Frame steht und
       bei View Transitions als feststehende Leiste durchläuft. Hier
       fehlen ihr nur noch die Laufzeit-Anteile: der ?tournament=-Parameter
       auf den Links (nur bei aktivem URL-Override, siehe
       withTournamentParam) und das Markenlabel aus der echten Config
       (der statische Stand kommt aus dem Pre-Flight-Spiegel und kann
       bei Overrides abweichen). */
    function hydrateStaticNav() {
        document.querySelectorAll("body > nav.navbar a[href], body > nav.bottom-nav a[href]").forEach((link) => {
            const href = link.getAttribute("href");
            if (!href || /^(https?:|#)/i.test(href)) return;
            link.setAttribute("href", withTournamentParam(href));
        });

        const brandLink = document.querySelector("body > nav.navbar .navbar-brand");
        if (brandLink) {
            brandLink.setAttribute("aria-label", brandAria);
            const gold = brandLink.querySelector(".brand-gold");
            if (gold && gold.textContent !== brandShortLabel) {
                gold.textContent = brandShortLabel;
            }
            const green = brandLink.querySelector(".brand-green");
            if (green && green.textContent !== brandSecondary) {
                green.textContent = brandSecondary;
            }
            // Saison-Zeile unter dem Markennamen: echte Quelle ist
            // APP.seasonLabel (nur CL gesetzt); der statische Brand-Filler
            // hat fuer den ersten Frame einen Spiegelwert eingesetzt.
            const seasonEl = brandLink.querySelector(".brand-season");
            if (seasonEl) {
                const season = (APP.seasonLabel || "").trim();
                const text = season ? `Saison ${season}` : "";
                if (seasonEl.textContent !== text) seasonEl.textContent = text;
                seasonEl.hidden = !text;
            }
        }
    }

    if (document.querySelector("body > nav.navbar")) {
        hydrateStaticNav();
    } else if (!isEmbedded) {
        // Seiten ohne statisches Markup (liga-tabelle.html, Admin-
        // Einstiege) bekommen die Leiste weiterhin komplett injiziert.
        document.body.insertAdjacentHTML("afterbegin", navHTML);
    }

    if (!isEmbedded) {
        syncNavHeightVar();
    }

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

    buildTournamentUserMenu(APP);
    buildDevTournamentSwitcher(APP);

    if (!isEmbedded) {
        registerServiceWorker();
    }
});
