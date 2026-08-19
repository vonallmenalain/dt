/* =============================================================================
 *  view-mode.js
 *
 *  App-weiter Umschalter für den Anzeigemodus „Vor Start / Nach Start / Auto“.
 *
 *  Hintergrund:
 *    Der Modus entscheidet applikationsweit, ob die App im Zustand VOR dem
 *    Anpfiff (`DREAMTEAM_START`) oder NACH dem Anpfiff dargestellt wird –
 *    also unter anderem, ob die Kader der Teilnehmer sichtbar sind
 *    (`teams.html`, `rangliste.html`, `spieleranalyse.html`), ob die
 *    Team-Einreichung offen ist (`team-builder.html`) und welche Startseiten-
 *    Sektion `index.html` zeigt.
 *
 *    Bis dahin gab es den Umschalter nur auf der Startseite (index.js →
 *    initDevToggle). Der zugrunde liegende localStorage-Wert wirkte zwar
 *    schon app-weit (siehe APP_CONFIG.getEffectiveViewMode), umstellen liess
 *    er sich aber nur dort. Dieses Modul zieht den Schalter deshalb aus
 *    index.js heraus und registriert ihn auf JEDER Seite im Dev-Bereich des
 *    Profil-Dropdowns (siehe auth-modal.js → devMenu).
 *
 *  Zuständigkeiten:
 *    1. Einzige Schreibstelle für den gespeicherten Modus
 *       (localStorage-Key `dreamteamIndexViewMode`, Werte
 *       "auto" | "pre" | "post").
 *    2. Registriert die drei Menüeinträge (Auto / Vor Start / Nach Start)
 *       im Dev-Bereich des Profil-Dropdowns – auf allen Seiten, die diese
 *       Datei laden.
 *    3. Hält `<html data-view="pre|post">` und `<html data-view-mode="…">`
 *       app-weit aktuell, damit CSS überall auf den Modus reagieren kann
 *       (index.css nutzt `data-view` bereits für die Startseiten-Sektionen).
 *    4. Benachrichtigt die Seiten-Skripte über Moduswechsel
 *       (`DreamTeamViewMode.onChange(cb)` bzw. das Fenster-Event
 *       `dreamteam:viewmode-change`), damit sie ohne Reload neu rendern.
 *    5. Synchronisiert offene Tabs (storage-Event) und schaltet im
 *       Auto-Modus pünktlich zum Anpfiff um (APP_CONFIG.onReveal).
 *
 *  SICHERHEITSHINWEIS (unverändert zur bisherigen Logik):
 *    Der gespeicherte Override wirkt NUR für angemeldete Admin-Accounts
 *    (admin.js → DreamTeamAdmin.getDevViewOverride). Für alle anderen
 *    Nutzer – auch bei manipuliertem localStorage – fällt die App auf den
 *    echten `DREAMTEAM_START` zurück. Das ist eine reine UI-Schranke; die
 *    tatsächliche Absicherung von Schreibzugriffen liegt weiterhin in den
 *    Firestore Rules.
 *
 *  Öffentliche API (window.DreamTeamViewMode):
 *    MODES            → ["auto", "pre", "post"]
 *    LABELS           → { auto: "Auto", pre: "Vor Start", post: "Nach Start" }
 *    STORAGE_KEY      → verwendeter localStorage-Key
 *    get()            → gespeicherter Modus ("auto" | "pre" | "post")
 *    getLabel(mode?)  → Anzeigename des Modus
 *    set(mode)        → speichert, wendet an und benachrichtigt
 *    cycle()          → auto → pre → post → auto …
 *    getEffective()   → tatsächlich wirksamer Modus ("pre" | "post")
 *    getAutoMode()    → was „Auto“ gerade ergäbe ("pre" | "post")
 *    isPre() / isPost()
 *    isOverrideActive() → wirkt gerade ein Admin-Override?
 *    onChange(cb)     → unsubscribe(); cb({ mode, effective, effectiveChanged })
 *    refresh()        → Attribute + Menübeschriftung neu auswerten
 *
 *  Ladereihenfolge:
 *    Nach `tournament-config.js`, `admin.js` und `auth-modal.js` einbinden.
 *    Fehlt eines davon noch (async/defer), wird kurz gepollt – wie an den
 *    übrigen Dev-Gates im Projekt.
 * ============================================================================= */
(function () {
    'use strict';

    /* Bewusst NICHT turnier-namespaced – siehe APP_CONFIG.storage.globalKeys:
       das Pre-Flight-Inline-Skript im <head> von index.html liest den Key,
       bevor tournament-config.js geladen ist. */
    const STORAGE_KEY = (function () {
        try {
            const fromCfg = window.APP_CONFIG
                && window.APP_CONFIG.storage
                && window.APP_CONFIG.storage.globalKeys
                && window.APP_CONFIG.storage.globalKeys.indexViewMode;
            if (fromCfg) return fromCfg;
        } catch (_) { /* fall through */ }
        return 'dreamteamIndexViewMode';
    })();

    const MODES  = Object.freeze(['auto', 'pre', 'post']);
    const LABELS = Object.freeze({ auto: 'Auto', pre: 'Vor Start', post: 'Nach Start' });
    const TITLES = Object.freeze({
        auto: 'Ansicht folgt automatisch dem Anpfiff (DREAMTEAM_START)',
        pre:  'Ganze App im Zustand VOR dem Anpfiff (Teams versteckt, Einreichung offen)',
        post: 'Ganze App im Zustand NACH dem Anpfiff (Teams sichtbar, Einreichung gesperrt)'
    });

    const GROUP       = 'Ansicht';
    const GROUP_ORDER = 10;
    const CHANGE_EVENT = 'dreamteam:viewmode-change';

    const listeners = new Set();
    let lastEffective = null;
    let revealCancel  = null;

    /* ── Gespeicherter Modus ────────────────────────────────────────────── */

    function normalizeMode(value) {
        return MODES.indexOf(value) !== -1 ? value : 'auto';
    }

    function readStoredMode() {
        try {
            return normalizeMode(window.localStorage && window.localStorage.getItem(STORAGE_KEY));
        } catch (_) {
            // localStorage geblockt (Private Mode, strenge Policies) – dann
            // gibt es schlicht keinen Override.
            return 'auto';
        }
    }

    function writeStoredMode(mode) {
        try {
            // „auto“ wird bewusst als Wert GESCHRIEBEN und der Key nicht
            // entfernt: Das Pre-Flight-Inline-Skript im <head> von
            // index.html unterscheidet „kein Key“ von „explizit auto“ und
            // ignoriert bei explizitem „auto“ den sessionStorage-Cache
            // (`dreamteamLastView`) eines früheren Overrides. Ohne den Wert
            // würde nach dem Zurückstellen auf Auto beim nächsten Reload
            // kurz noch die alte Sektion gezeichnet.
            window.localStorage.setItem(STORAGE_KEY, mode);
            return true;
        } catch (_) {
            return false;
        }
    }

    /* ── Wirksamer Modus ────────────────────────────────────────────────── */

    function getDreamteamStart() {
        try {
            const start = window.APP_CONFIG && window.APP_CONFIG.DREAMTEAM_START;
            const date = start instanceof Date ? start : (start ? new Date(start) : null);
            if (date instanceof Date && !isNaN(date.getTime())) return date;
        } catch (_) { /* fall through */ }
        return null;
    }

    /** Was „Auto“ gerade ergibt – rein zeitbasiert, ohne Override. */
    function getAutoMode() {
        const start = getDreamteamStart();
        // Ohne ermittelbare Startzeit bewusst restriktiv: Teams bleiben
        // versteckt (gleiche Konvention wie APP_CONFIG.getEffectiveViewMode).
        if (!start) return 'pre';
        return Date.now() >= start.getTime() ? 'post' : 'pre';
    }

    function isAdminAuthResolved() {
        const Admin = window.DreamTeamAdmin;
        if (Admin && typeof Admin.isAuthResolved === 'function') return Admin.isAuthResolved();
        if (Admin && typeof Admin.isAuthReady === 'function')    return Admin.isAuthReady();
        return false;
    }

    /**
     * Der vom Admin gesetzte Override – gegated über admin.js, gilt also nur
     * für angemeldete Admin-Accounts. Ohne admin.js gibt es keinen Override.
     */
    function getActiveOverride() {
        const Admin = window.DreamTeamAdmin;
        if (!Admin || typeof Admin.getDevViewOverride !== 'function') return null;
        const override = Admin.getDevViewOverride();
        return (override === 'pre' || override === 'post') ? override : null;
    }

    function isOverrideActive() {
        return getActiveOverride() !== null;
    }

    /**
     * Tatsächlich wirksamer Modus ("pre" | "post").
     *
     * Firebase Auth liefert den persistierten User asynchron. Solange noch
     * unklar ist, ob der aktuelle Browser-User Admin ist, halten wir an einem
     * gespeicherten Override fest – sonst springt die App bei gespeichertem
     * „Nach Start“ kurz auf „Vor Start“, bis der Admin-Status ankommt
     * (derselbe Flicker-Schutz wie bisher in index.js).
     */
    function getEffective() {
        const override = getActiveOverride();
        if (override) return override;

        const stored = readStoredMode();
        if (stored !== 'auto' && window.DreamTeamAdmin && !isAdminAuthResolved()) {
            return stored;
        }
        return getAutoMode();
    }

    /* ── Anwenden + benachrichtigen ─────────────────────────────────────── */

    function applyDocumentState(effective, stored) {
        try {
            const html = document.documentElement;
            if (!html) return;
            html.dataset.view = effective;
            html.dataset.viewMode = stored;
        } catch (_) { /* dataset nicht verfügbar – rein kosmetisch */ }
    }

    function refreshDevMenu() {
        const Modal = window.DreamTeamAuthModal;
        if (Modal && Modal.devMenu && typeof Modal.devMenu.refresh === 'function') {
            Modal.devMenu.refresh();
        }
    }

    function emit(payload) {
        listeners.forEach((cb) => {
            try { cb(payload); } catch (err) {
                console.error('[DreamTeamViewMode] listener error:', err);
            }
        });
        try {
            let event;
            if (typeof CustomEvent === 'function') {
                event = new CustomEvent(CHANGE_EVENT, { detail: payload });
            } else {
                event = document.createEvent('CustomEvent');
                event.initCustomEvent(CHANGE_EVENT, false, false, payload);
            }
            window.dispatchEvent(event);
        } catch (_) { /* ältere Browser bekommen nur die Callback-API */ }
    }

    /**
     * Wertet den Modus neu aus, spiegelt ihn ins DOM, aktualisiert die
     * Menübeschriftung und benachrichtigt die Seiten-Skripte.
     *
     * Optionen:
     *   silent                  → nie benachrichtigen (Boot)
     *   onlyIfEffectiveChanged  → nur benachrichtigen, wenn sich "pre"/"post"
     *                             tatsächlich geändert hat
     */
    function refresh(options) {
        const opts = options || {};
        const stored    = readStoredMode();
        const effective = getEffective();
        const effectiveChanged = lastEffective !== null && lastEffective !== effective;
        const isFirst = lastEffective === null;

        lastEffective = effective;
        applyDocumentState(effective, stored);
        refreshDevMenu();
        scheduleAutoReveal();

        const quiet = opts.silent
            || isFirst
            || (opts.onlyIfEffectiveChanged && !effectiveChanged);
        if (quiet) return { mode: stored, effective, effectiveChanged: false };

        const payload = { mode: stored, effective, effectiveChanged };
        emit(payload);
        return payload;
    }

    function setMode(mode) {
        const next = normalizeMode(mode);
        if (next !== readStoredMode()) writeStoredMode(next);
        refresh();
        return next;
    }

    function cycleMode() {
        const current = readStoredMode();
        const nextIdx = (MODES.indexOf(current) + 1) % MODES.length;
        return setMode(MODES[nextIdx]);
    }

    /* ── Auto-Flip zum Anpfiff ──────────────────────────────────────────── */

    /**
     * Im Auto-Modus soll eine bereits geöffnete Seite exakt zum Anpfiff
     * umschalten. APP_CONFIG.onReveal übernimmt das Timer-Handling (inkl.
     * Etappen gegen Browser-Drosselung bei sehr langen Timeouts).
     *
     * Hinweis: Einige Seiten-Skripte (teams.js, rangliste.js,
     * spieleranalyse.js, index.js) planen ihren eigenen onReveal-Callback.
     * Zum Anpfiff rendern sie deshalb einmal doppelt – funktional
     * unproblematisch und der Preis dafür, dass dieses Modul auch auf
     * Seiten ohne eigene Reveal-Logik korrekt bleibt.
     */
    function scheduleAutoReveal() {
        if (typeof revealCancel === 'function') {
            revealCancel();
            revealCancel = null;
        }
        // Bei aktivem Override ist der Auto-Modus bewusst ausser Kraft.
        if (isOverrideActive()) return;

        // WICHTIG: APP_CONFIG.onReveal ruft seinen Callback SYNCHRON auf,
        // wenn der Anpfiff bereits vorbei ist. Ohne diese Schranke würde
        // refresh() → scheduleAutoReveal() → onReveal() → refresh() nach
        // Turnierstart endlos rekursieren. Liegt der Anpfiff zurück, gibt
        // es ohnehin nichts mehr zu planen.
        const start = getDreamteamStart();
        if (!start || Date.now() >= start.getTime()) return;

        const APP = window.APP_CONFIG;
        if (!APP || typeof APP.onReveal !== 'function') return;
        revealCancel = APP.onReveal(() => {
            revealCancel = null;
            refresh();
        });
    }

    /* ── Dev-Menü-Einträge ──────────────────────────────────────────────── */

    /**
     * Registriert je einen Eintrag pro Modus unter „Ansicht“. Bewusst drei
     * Zeilen statt eines durchklickbaren Schalters: so ist der aktive Modus
     * ablesbar und jeder andere mit einem Klick erreichbar – analog zur
     * Gruppe „Turnier“ im selben Menü.
     *
     * Sichtbar sind die Einträge nur für angemeldete Admins; das Dev-Menü
     * rendert für alle anderen Nutzer gar nichts (auth-modal.js → devMenu).
     */
    function registerDevMenu() {
        const Modal = window.DreamTeamAuthModal;
        if (!Modal || !Modal.devMenu || typeof Modal.devMenu.register !== 'function') return false;

        // register() ersetzt einen bestehenden Eintrag anhand der id, ein
        // erneuter Aufruf ist also unschädlich.

        MODES.forEach((mode, index) => {
            Modal.devMenu.register({
                id: `view-mode-${mode}`,
                group: GROUP,
                groupOrder: GROUP_ORDER,
                order: index + 1,
                label: LABELS[mode],
                value: () => {
                    const stored = readStoredMode();
                    const marks = [];
                    if (mode === 'auto') {
                        // Bei „Auto“ zeigen wir, worauf die Zeit gerade zeigt.
                        marks.push(`→ ${LABELS[getAutoMode()]}`);
                    }
                    if (mode === stored) marks.push('aktiv');
                    return marks.join(' · ');
                },
                accent: () => (readStoredMode() === mode ? 'active' : null),
                title: TITLES[mode],
                // Offen lassen: der neue Zustand ist direkt im Menü ablesbar
                // und lässt sich sofort wieder korrigieren.
                keepOpen: true,
                onSelect: () => setMode(mode)
            });
        });
        return true;
    }

    /* ── Boot ───────────────────────────────────────────────────────────── */

    function hookAdmin() {
        const Admin = window.DreamTeamAdmin;
        if (!Admin || typeof Admin.onAdminChange !== 'function') return false;
        // Der Admin-Status entscheidet, ob der Override überhaupt greift –
        // bei Login/Logout muss der wirksame Modus deshalb neu bewertet
        // werden.
        //
        // Benachrichtigt wird hier nur, wenn sich „pre“/„post“ dadurch
        // wirklich ändert: Die Seiten-Skripte hängen für den Admin-Wechsel
        // ohnehin selbst an DreamTeamAdmin.onAdminChange, und der häufigste
        // Fall (Firebase löst den Auth-Status nach dem Boot auf, ohne dass
        // sich der Modus ändert) würde sie sonst doppelt rendern lassen.
        Admin.onAdminChange(() => refresh({ onlyIfEffectiveChanged: true }));
        return true;
    }

    function hookStorageSync() {
        // Mehrere offene Tabs: Umstellen in einem Tab zieht die anderen nach.
        window.addEventListener('storage', (event) => {
            if (!event || event.key !== STORAGE_KEY) return;
            refresh();
        });
    }

    function pollFor(fn, done) {
        if (fn()) { if (typeof done === 'function') done(); return; }
        let attempts = 0;
        const maxAttempts = 50; // ~5s, wie an den übrigen Dev-Gates
        const interval = setInterval(() => {
            attempts += 1;
            if (fn() || attempts >= maxAttempts) {
                clearInterval(interval);
                if (typeof done === 'function') done();
            }
        }, 100);
    }

    // Sofort anwenden (still), damit `data-view` auf jeder Seite stimmt,
    // bevor die Seiten-Skripte ihren ersten Render fahren.
    refresh({ silent: true });

    // admin.js / auth-modal.js können nach uns geladen werden – kurz pollen.
    pollFor(hookAdmin);
    pollFor(registerDevMenu);
    hookStorageSync();

    window.DreamTeamViewMode = {
        MODES,
        LABELS,
        STORAGE_KEY,
        get: readStoredMode,
        getLabel(mode) { return LABELS[normalizeMode(mode || readStoredMode())]; },
        set: setMode,
        cycle: cycleMode,
        getEffective,
        getAutoMode,
        isPre()  { return getEffective() === 'pre'; },
        isPost() { return getEffective() === 'post'; },
        isOverrideActive,
        refresh,
        onChange(cb) {
            if (typeof cb !== 'function') return function () {};
            listeners.add(cb);
            return function () { listeners.delete(cb); };
        }
    };
})();
