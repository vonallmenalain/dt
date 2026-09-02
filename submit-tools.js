/* =============================================================================
 *  submit-tools.js – App-weite Admin-Schalter rund um die Team-Einreichung
 *
 *  Warum eigene Datei: Beide Schalter hingen ursprünglich im Team-Builder und
 *  waren damit NUR auf team-builder.html im Profil-Dropdown zu finden. Seit
 *  der App-Shell (app.html) laufen die Seiten ausserdem als Frames – die
 *  sichtbare Leiste gehört der Shell, das Dropdown einer eingebetteten Seite
 *  sieht niemand. Ein Eintrag, den nur eine Seite registriert, ist also
 *  entweder auf allen anderen Seiten weg oder überhaupt nicht sichtbar.
 *
 *  Regel im Projekt (siehe README, Abschnitt „Profil-Dropdown"): JEDER
 *  Menüeintrag wird von einem Modul registriert, das auf ALLEN Seiten und in
 *  der Shell geladen ist – nav.js (Turnier), tippgruppen.js (Tippgruppen),
 *  view-mode.js (Ansicht) und diese Datei (Team-Einreichung). Dann ist das
 *  Menü überall vollständig, egal welche Seite offen ist.
 *
 *  Zwei Schalter, beide nur für angemeldete Admins sichtbar (das Dev-Menü
 *  rendert für alle anderen gar nichts, siehe auth-modal.js → devMenu):
 *
 *    1. „Einreichung für alle" – Feld `lateSubmitOpen` im Meta-Dokument des
 *       Turniers. Gilt für ALLE Nutzer und öffnet die Einreichung auch nach
 *       dem Turnierstart wieder. Der Wert kommt live aus Firestore, die
 *       eigentliche Sperre steht in den Firestore Rules
 *       (firestore.rules → lateSubmitOpen()).
 *
 *    2. „Testteams (mehrere)" – localStorage, pro Turnier. Ist er an, legt
 *       jede Einreichung ein NEUES Team an, statt das bestehende Team des
 *       Accounts zu aktualisieren. Der Admin-Check steckt zusätzlich in
 *       DreamTeamAuth.saveOrUpdateTeam, damit der Modus nicht über einen
 *       manipulierten localStorage-Wert an normale Accounts durchschlägt.
 *
 *  Öffentliche API (window.DreamTeamSubmitTools):
 *    isLateSubmitOpen()          → boolean (aktueller Stand aus Firestore)
 *    onLateSubmitChange(cb)      → unsubscribe(); cb(open) feuert sofort
 *                                  einmal mit dem aktuellen Stand
 *    isTestTeamMode()            → boolean; nur true, solange auch wirklich
 *                                  ein Admin angemeldet ist
 *    onTestTeamModeChange(cb)    → unsubscribe(); cb(on) feuert sofort
 *    TEST_TEAM_MODE_KEY          → verwendeter localStorage-Key
 *
 *  Voraussetzungen: tournament-config.js, admin.js und auth-modal.js müssen
 *  vorher geladen sein (wie bei view-mode.js).
 * ============================================================================= */
(function () {
    'use strict';

    const GROUP = 'Team-Einreichung';
    const GROUP_ORDER = 30;

    const APP = window.APP_CONFIG;
    if (!APP) {
        console.warn('[SubmitTools] APP_CONFIG fehlt – Schalter werden nicht registriert.');
        return;
    }

    const TEST_TEAM_MODE_KEY = APP.storage.key('admin_test_team_mode');

    /* Zustand. `lateSubmitOpen` bleibt konservativ `false`, bis Firestore
       geantwortet hat – die Sperre schlägt im Zweifel zu, nie in die andere
       Richtung. */
    let lateSubmitOpen = false;
    let lateSubmitBusy = false;
    let metaSubscribed = false;

    const lateListeners = new Set();
    const testListeners = new Set();

    function isAdminSignedIn() {
        const Admin = window.DreamTeamAdmin;
        return !!(Admin && typeof Admin.isAdmin === 'function' && Admin.isAdmin());
    }

    function notify(listeners, value) {
        listeners.forEach((cb) => {
            try {
                cb(value);
            } catch (err) {
                console.warn('[SubmitTools] Listener fehlgeschlagen:', err);
            }
        });
    }

    function refreshMenu() {
        const Modal = window.DreamTeamAuthModal;
        if (Modal && Modal.devMenu && typeof Modal.devMenu.refresh === 'function') {
            Modal.devMenu.refresh();
        }
    }

    /* ── 1) Nachzügler-Schalter (Firestore) ─────────────────────────────── */

    function metaDoc() {
        const collection = APP.firestore.metaCollection || 'app_meta';
        return APP.getDb().collection(collection).doc(APP.firestore.metaDocId());
    }

    /** Live-Listener auf das Meta-Dokument: hält den Schalter für ALLE
     *  Clients synchron, sodass ein Admin-Umschalten sofort überall ankommt. */
    function subscribeLateSubmit() {
        if (metaSubscribed) return;
        metaSubscribed = true;
        try {
            metaDoc().onSnapshot(
                (snap) => {
                    const data = (snap && snap.exists) ? snap.data() : null;
                    applyLateSubmit(!!(data && data.lateSubmitOpen === true));
                },
                (err) => {
                    console.warn('[SubmitTools] Meta-Listener (lateSubmitOpen) fehlgeschlagen:', err);
                }
            );
        } catch (err) {
            console.warn('[SubmitTools] Konnte Meta-Listener nicht einrichten:', err);
        }
    }

    function applyLateSubmit(open) {
        const next = !!open;
        if (next === lateSubmitOpen) {
            refreshMenu();
            return;
        }
        lateSubmitOpen = next;
        notify(lateListeners, lateSubmitOpen);
        refreshMenu();
    }

    async function writeLateSubmit(open) {
        const FieldValue = window.firebase.firestore.FieldValue;
        await metaDoc().set({
            year:           APP.year,
            lateSubmitOpen: !!open,
            // teamsVersion mit-bumpen, damit andere Clients ihren
            // Teams-Cache ohnehin frisch ziehen.
            teamsVersion:   FieldValue.increment(1),
            teamsUpdatedAt: Date.now()
        }, { merge: true });
    }

    /* ── 2) Testteam-Modus (localStorage) ───────────────────────────────── */

    function readTestTeamMode() {
        try {
            return window.localStorage.getItem(TEST_TEAM_MODE_KEY) === '1';
        } catch (err) {
            return false;
        }
    }

    function writeTestTeamMode(on) {
        try {
            if (on) window.localStorage.setItem(TEST_TEAM_MODE_KEY, '1');
            else    window.localStorage.removeItem(TEST_TEAM_MODE_KEY);
        } catch (err) {
            /* Storage geblockt – der Modus gilt dann nur für diese Sitzung. */
        }
    }

    let testTeamMode = readTestTeamMode();

    /** Nur wahr, solange auch wirklich ein Admin angemeldet ist – ein Logout
     *  schaltet den Modus faktisch ab, ohne den gemerkten Wert zu verlieren. */
    function isTestTeamMode() {
        return testTeamMode && isAdminSignedIn();
    }

    function setTestTeamMode(on) {
        const next = !!on;
        if (next === testTeamMode) {
            refreshMenu();
            return;
        }
        testTeamMode = next;
        writeTestTeamMode(next);
        notify(testListeners, isTestTeamMode());
        refreshMenu();
    }

    /* Der Modus steht nur im localStorage – anders als beim Nachzügler-
       Schalter gibt es keinen Firestore-Listener, der ihn verteilt. Das
       `storage`-Event feuert in JEDEM anderen Dokument desselben Origins
       (andere Tabs, und in der App-Shell auch die bereits geladenen
       Seiten-Frames), nur nicht in dem, das geschrieben hat – genau die
       fehlende Verbindung. Ohne das bliebe ein schon offener Team-Builder
       auf dem alten Stand, bis er neu lädt. */
    window.addEventListener('storage', (event) => {
        if (event && event.key && event.key !== TEST_TEAM_MODE_KEY) return;
        const next = readTestTeamMode();
        if (next === testTeamMode) return;
        testTeamMode = next;
        notify(testListeners, isTestTeamMode());
        refreshMenu();
    });

    /* ── Dev-Menü-Einträge ──────────────────────────────────────────────── */

    function registerDevMenu() {
        const Modal = window.DreamTeamAuthModal;
        if (!Modal || !Modal.devMenu || typeof Modal.devMenu.register !== 'function') return false;

        // register() ersetzt einen bestehenden Eintrag anhand der id, ein
        // erneuter Aufruf ist also unschädlich.

        Modal.devMenu.register({
            id: 'team-latesubmit',
            group: GROUP,
            groupOrder: GROUP_ORDER,
            order: 1,
            label: 'Einreichung für alle',
            value: () => (lateSubmitBusy ? 'speichere…' : (lateSubmitOpen ? 'offen' : 'gesperrt')),
            accent: 'active',
            disabled: () => lateSubmitBusy,
            title: 'Team-Einreichung trotz Turnierstart für ALLE freischalten/sperren',
            // Offen lassen, damit der neue Zustand direkt ablesbar ist.
            keepOpen: true,
            onSelect: async () => {
                if (!isAdminSignedIn() || lateSubmitBusy) return;

                const next = !lateSubmitOpen;
                lateSubmitBusy = true;
                refreshMenu();
                try {
                    await writeLateSubmit(next);
                    // Der onSnapshot-Listener übernimmt den neuen Zustand für
                    // uns und alle anderen Clients; wir setzen ihn hier
                    // optimistisch trotzdem, falls der Listener minimal
                    // verzögert feuert.
                    lateSubmitBusy = false;
                    applyLateSubmit(next);
                } catch (err) {
                    console.error('[SubmitTools] Umschalten des Nachzügler-Schalters fehlgeschlagen:', err);
                    lateSubmitBusy = false;
                    refreshMenu();
                }
            }
        });

        Modal.devMenu.register({
            id: 'team-testmode',
            group: GROUP,
            groupOrder: GROUP_ORDER,
            order: 2,
            label: 'Testteams (mehrere)',
            value: () => (testTeamMode ? 'an' : 'aus'),
            accent: 'info',
            title: 'Mehrere Teams mit demselben Admin-Account einreichen: jede Einreichung legt ein neues Team an.',
            keepOpen: true,
            onSelect: () => {
                if (!isAdminSignedIn()) return;
                setTestTeamMode(!testTeamMode);
            }
        });

        return true;
    }

    /* ── Boot ───────────────────────────────────────────────────────────── */

    /* auth-modal.js und admin.js können nach dieser Datei geladen werden –
       dann kurz pollen, wie an den übrigen Gates im Projekt. */
    function whenReady(fn) {
        if (fn()) return;
        let attempts = 0;
        const timer = setInterval(() => {
            attempts += 1;
            if (fn() || attempts >= 50) clearInterval(timer);
        }, 100);
    }

    whenReady(registerDevMenu);

    /* Der Admin-Status entscheidet, ob der Testteam-Modus überhaupt greift –
       nach einem Login/Logout müssen die Anzeigen neu ausgewertet werden. */
    whenReady(function hookAdmin() {
        const Admin = window.DreamTeamAdmin;
        if (!Admin || typeof Admin.onAdminChange !== 'function') return false;
        Admin.onAdminChange(() => {
            notify(testListeners, isTestTeamMode());
            refreshMenu();
        });
        return true;
    });

    /* Firestore steht auf manchen Seiten erst nach dem Boot bereit. */
    whenReady(function hookFirestore() {
        if (!window.firebase || !window.firebase.firestore) return false;
        subscribeLateSubmit();
        return true;
    });

    window.DreamTeamSubmitTools = {
        TEST_TEAM_MODE_KEY,
        isLateSubmitOpen() { return lateSubmitOpen; },
        onLateSubmitChange(cb) {
            if (typeof cb !== 'function') return function () {};
            lateListeners.add(cb);
            try { cb(lateSubmitOpen); } catch (err) { /* Aufrufer-Fehler */ }
            return function () { lateListeners.delete(cb); };
        },
        isTestTeamMode,
        onTestTeamModeChange(cb) {
            if (typeof cb !== 'function') return function () {};
            testListeners.add(cb);
            try { cb(isTestTeamMode()); } catch (err) { /* Aufrufer-Fehler */ }
            return function () { testListeners.delete(cb); };
        }
    };
})();
