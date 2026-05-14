/* =============================================================================
 *  admin.js
 *
 *  Zentrale, sehr leichte Admin-Erkennung für DreamTeam.
 *
 *  Aufgabe:
 *    - Hält eine kleine Allowlist von Firebase-Auth-UIDs (siehe ADMIN_UIDS),
 *      die in der App als Admin gelten.
 *    - Hängt sich an `firebase.auth().onAuthStateChanged` und exponiert den
 *      aktuellen Admin-Status synchron sowie als Observer-API.
 *    - Wird von nav.js und index.html verwendet, um die Dev-Knöpfe
 *      ("DEV: Vor/Nach Start" und den Turnier-Switcher) nur für Admins
 *      einzublenden.
 *
 *  Wichtig (Security):
 *    Diese Datei ist eine reine UI-Hilfe und schützt **nicht** vor
 *    manipulierten Clients. Wer den Browser-Debugger öffnet, kann beide
 *    Dev-Knöpfe weiter benutzen. Da diese Knöpfe ausschließlich lokale
 *    Effekte haben (localStorage-Override für Ansichtsmodus bzw. Turnier),
 *    ist das akzeptabel.
 *
 *  Wenn echte Admin-Privilegien (z.B. für Schreibzugriffe in Firestore)
 *  benötigt werden, müssen zusätzlich Custom Claims gesetzt und die
 *  Firestore Rules entsprechend angepasst werden — das macht diese Datei
 *  bewusst NICHT.
 *
 *  Öffentliche API (window.DreamTeamAdmin):
 *    ADMIN_UIDS              → eingefrorenes Array der Admin-UIDs
 *    isAdmin()               → boolean (aktueller User ist Admin?)
 *    getUid()                → string | null (aktueller User-UID)
 *    isAdminUid(uid)         → boolean (UID-spezifischer Check)
 *    onAdminChange(cb)       → unsubscribe()
 *                              cb({ isAdmin, uid }) feuert sofort einmal
 *                              mit dem aktuellen Stand, dann bei jeder
 *                              Änderung.
 *
 *  Voraussetzungen:
 *    - firebase-app-compat + firebase-auth-compat müssen geladen sein,
 *      sonst bleibt der Admin-Status dauerhaft `false` (gewünschtes
 *      Verhalten: keine Dev-Knöpfe für Gäste).
 * ============================================================================= */
(function () {
    'use strict';

    /**
     * Allowlist aller UIDs, die als Admin gelten. Bewusst hier hardcoded,
     * damit kein Build-/Backend-Setup nötig ist und die Liste explizit im
     * Code reviewbar bleibt.
     *
     * Neue Admins: einfach weitere UID-Strings ergänzen.
     */
    const ADMIN_UIDS = Object.freeze([
        'lSw9kxsnp8a7qb0s7UzuTQVwRAu1'
    ]);

    const listeners = new Set();
    let currentUid = null;
    let currentIsAdmin = false;
    let firebaseHooked = false;

    function isAdminUid(uid) {
        return typeof uid === 'string' && ADMIN_UIDS.indexOf(uid) !== -1;
    }

    function notifyAll() {
        const payload = { isAdmin: currentIsAdmin, uid: currentUid };
        listeners.forEach((cb) => {
            try { cb(payload); } catch (err) {
                console.error('[DreamTeamAdmin] listener error:', err);
            }
        });
    }

    function setAuthUser(user) {
        const nextUid = (user && user.uid) || null;
        const nextIsAdmin = isAdminUid(nextUid);
        if (nextUid === currentUid && nextIsAdmin === currentIsAdmin) return;
        currentUid = nextUid;
        currentIsAdmin = nextIsAdmin;
        notifyAll();
    }

    function tryHookFirebase() {
        if (firebaseHooked) return true;
        if (typeof window.firebase === 'undefined' || !window.firebase || !window.firebase.auth) {
            return false;
        }
        try {
            window.firebase.auth().onAuthStateChanged(setAuthUser);
            firebaseHooked = true;
            return true;
        } catch (err) {
            console.warn('[DreamTeamAdmin] Could not hook firebase auth:', err);
            return false;
        }
    }

    if (!tryHookFirebase()) {
        // Firebase-Auth-Compat kann nach uns geladen werden (z.B. wenn admin.js
        // sehr früh eingebunden wird). Wir pollen kurz, bis die SDK verfügbar
        // ist; danach übernimmt onAuthStateChanged das Update.
        let attempts = 0;
        const maxAttempts = 50; // ~5 Sekunden
        const interval = setInterval(() => {
            attempts += 1;
            if (tryHookFirebase() || attempts >= maxAttempts) {
                clearInterval(interval);
            }
        }, 100);
    }

    window.DreamTeamAdmin = {
        ADMIN_UIDS,
        isAdmin()   { return currentIsAdmin; },
        getUid()    { return currentUid; },
        isAdminUid,
        onAdminChange(cb) {
            if (typeof cb !== 'function') return function () {};
            listeners.add(cb);
            try {
                cb({ isAdmin: currentIsAdmin, uid: currentUid });
            } catch (err) {
                console.error('[DreamTeamAdmin] listener error (initial):', err);
            }
            return function () { listeners.delete(cb); };
        }
    };
})();
