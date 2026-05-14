/* =============================================================================
 *  auth.js
 *
 *  Modular Lazy-Registration helper for DreamTeam.
 *
 *  Public API (exposed as `window.DreamTeamAuth`):
 *
 *    init(options)                        Initialise once. Options:
 *                                            {
 *                                              db                 – firebase.firestore() instance (required)
 *                                              teamsCollection    – Firestore collection name for teams (required)
 *                                              pendingStorageKey  – localStorage key for the pending team payload
 *                                                                   (default: 'dreamteam_pending_team')
 *                                              emailLinkStorageKey
 *                                                                 – localStorage key under which we cache the
 *                                                                   e-mail address used when sending an
 *                                                                   email-link sign-in (default:
 *                                                                   'dreamteam_emaillink_email')
 *                                              actionUrl          – optional ActionCodeSettings.url for both the
 *                                                                   verification email (deep-link back to the
 *                                                                   app) and the passwordless email-link flow
 *                                              languageCode       – optional BCP-47 language code applied to
 *                                                                   firebase.auth() so verification e-mails
 *                                                                   *and* the Firebase-hosted action handler
 *                                                                   page (/__/auth/action) are localised
 *                                                                   (default: 'de')
 *                                              persistence        – how long the signed-in session is kept
 *                                                                   on this device. One of:
 *                                                                     'local'   → survives browser restarts
 *                                                                                 (IndexedDB, default)
 *                                                                     'session' → only for the current tab
 *                                                                     'none'    → in-memory only, lost on
 *                                                                                 reload
 *                                                                   The default ('local') means a returning
 *                                                                   user does NOT need to sign in again on
 *                                                                   the same device / browser until they
 *                                                                   explicitly log out, clear site data, or
 *                                                                   the auth token is revoked server-side.
 *                                            }
 *
 *    getCurrentUser()                     → firebase.User | null
 *    isSignedInAndVerified()              → boolean
 *    onAuthStateChange(cb)                → unsubscribe()      cb({ user, isVerified })
 *
 *    registerWithEmail(email, password)   → Promise<{ user }>            Creates user + sends verification email
 *    login(email, password)               → Promise<{ user }>
 *    signInWithGoogle()                   → Promise<{ user }>            Google popup sign-in
 *    sendSignInLinkToEmail(email)         → Promise<void>                Sends passwordless email-link
 *    isSignInWithEmailLink(url?)          → boolean
 *    completeEmailLinkSignIn(options?)    → Promise<{ user } | null>     Completes email-link flow on return.
 *                                                                       options.email lets the caller supply
 *                                                                       the address (e.g. from a UI prompt).
 *                                                                       When the cached e-mail is missing and
 *                                                                       no override is given, this falls back
 *                                                                       to window.prompt(...).
 *    resendVerification()                 → Promise<void>
 *    reloadUser()                         → Promise<firebase.User|null>  Forces emailVerified refresh
 *    logout()                             → Promise<void>
 *    sendPasswordReset(email)             → Promise<void>
 *
 *    setPendingTeam(payload)              Stores team JSON in localStorage
 *    getPendingTeam()                     → payload | null
 *    clearPendingTeam()                   void
 *    hasPendingTeam()                     → boolean
 *
 *    fetchUserTeam(uid?)                  → Promise<{ id, data } | null>
 *    saveTeamForUser(payload)             → Promise<{ id, data }>          Creates a new team doc
 *    updateTeam(teamId, payload)          → Promise<void>                  Updates existing team doc
 *    finalizePendingTeam()                → Promise<{ id, data } | null>   If pending team in LS + user verified,
 *                                                                          writes it to Firestore and clears LS.
 *                                                                          Returns the saved team or null.
 *
 *  The module is intentionally UI-less. `auth-modal.js` provides a thin
 *  presentation layer; you can swap it out without touching this file.
 *
 *  Requires the Firebase compat SDK (firebase-app-compat, firebase-auth-compat,
 *  firebase-firestore-compat) to be loaded before this script.
 * ============================================================================= */
(function () {
    'use strict';

    /* ---------------------------------------------------------------------------
     *  Configuration (filled by init()).
     * ------------------------------------------------------------------------- */
    const state = {
        initialised:           false,
        db:                    null,
        teamsCollection:       null,
        pendingStorageKey:     'dreamteam_pending_team',
        emailLinkStorageKey:   'dreamteam_emaillink_email',
        actionUrl:             null,
        languageCode:          'de',
        persistence:           'local',
        currentUser:           null,
        // Track the loaded user team while editing so submit() knows the doc id.
        loadedTeamId:          null,
        // Subscribers to onAuthStateChange (our own, not firebase's raw)
        listeners:             new Set()
    };

    /* ---------------------------------------------------------------------------
     *  Internals
     * ------------------------------------------------------------------------- */
    function requireInit() {
        if (!state.initialised) {
            throw new Error('[DreamTeamAuth] init() must be called before use.');
        }
    }

    function ensureFirebase() {
        if (typeof firebase === 'undefined' || !firebase.auth) {
            throw new Error('[DreamTeamAuth] firebase-auth-compat SDK is not loaded.');
        }
    }

    function notifyListeners() {
        const payload = {
            user:       state.currentUser,
            isVerified: !!(state.currentUser && state.currentUser.emailVerified)
        };
        state.listeners.forEach(cb => {
            try { cb(payload); } catch (err) { console.error('[DreamTeamAuth] listener error:', err); }
        });
    }

    /**
     * Resolve a string persistence option ('local' | 'session' | 'none') to
     * the firebase.auth.Auth.Persistence enum value. Returns null if the
     * SDK does not expose persistence (very old builds) or the value is
     * unknown.
     */
    function resolvePersistenceMode(mode) {
        const Persistence = firebase.auth && firebase.auth.Auth && firebase.auth.Auth.Persistence;
        if (!Persistence) return null;
        switch (String(mode || '').toLowerCase()) {
            case 'local':   return Persistence.LOCAL   || null;
            case 'session': return Persistence.SESSION || null;
            case 'none':    return Persistence.NONE    || null;
            default:        return Persistence.LOCAL   || null;
        }
    }

    /**
     * Apply the desired auth persistence mode with a graceful fallback so
     * environments without IndexedDB (Safari Private Mode etc.) still get a
     * working — even if shorter-lived — session.
     */
    function applyAuthPersistence(mode) {
        const desired = resolvePersistenceMode(mode);
        if (!desired) return;

        firebase.auth().setPersistence(desired).catch((err) => {
            console.warn('[DreamTeamAuth] Could not apply auth persistence "' + mode + '":', err);
            const Persistence = firebase.auth.Auth && firebase.auth.Auth.Persistence;
            const fallback = Persistence && (Persistence.SESSION || Persistence.NONE);
            if (fallback && fallback !== desired) {
                firebase.auth().setPersistence(fallback).catch(() => { /* swallow */ });
            }
        });
    }

    /* ---------------------------------------------------------------------------
     *  Lifecycle
     * ------------------------------------------------------------------------- */
    function init(options) {
        if (state.initialised) return;
        ensureFirebase();

        if (!options || !options.db) {
            throw new Error('[DreamTeamAuth] init() requires { db, teamsCollection }.');
        }
        if (!options.teamsCollection) {
            throw new Error('[DreamTeamAuth] init() requires teamsCollection.');
        }

        state.db                  = options.db;
        state.teamsCollection     = options.teamsCollection;
        state.pendingStorageKey   = options.pendingStorageKey   || state.pendingStorageKey;
        state.emailLinkStorageKey = options.emailLinkStorageKey || state.emailLinkStorageKey;
        state.actionUrl           = options.actionUrl || null;
        state.languageCode        = options.languageCode || state.languageCode;
        state.persistence         = (options.persistence || state.persistence).toLowerCase();
        state.initialised         = true;

        // Apply the language to Firebase Auth so that verification e-mails and
        // the Firebase-hosted action handler page (/__/auth/action) — including
        // the "E-Mail-Adresse bestätigen" / "Bestätigung abschließen" screen —
        // are rendered in the configured language instead of the English default.
        try {
            firebase.auth().languageCode = state.languageCode;
        } catch (err) {
            console.warn('[DreamTeamAuth] Could not set Firebase auth languageCode:', err);
        }

        // Configure how long the signed-in session is kept on this device.
        //
        // We deliberately set this *explicitly* (instead of relying on the
        // SDK default) so the "stay signed in" guarantee is robust against
        // future SDK default changes and easy to audit. With LOCAL persistence
        // Firebase stores the refresh token in IndexedDB, which survives tab
        // closures and browser restarts — the user only needs to sign in
        // again after an explicit logout, when site data is cleared, or when
        // the underlying auth token is invalidated server-side.
        //
        // Some environments (Safari Private Mode, iOS WebViews with
        // restricted storage, enterprise lock-down policies) cannot use
        // IndexedDB. In that case Firebase rejects the LOCAL request; we
        // gracefully fall back to SESSION (per-tab) so the rest of the auth
        // flow keeps working — at the cost of the user having to sign in
        // again after closing the tab.
        applyAuthPersistence(state.persistence);

        // Keep our auth state in sync. We re-check emailVerified by reloading
        // when the tab becomes visible again (after the user clicked the
        // verification link in another tab / email client).
        firebase.auth().onAuthStateChanged(async (user) => {
            state.currentUser = user || null;
            notifyListeners();

            // If the user is signed-in but not yet flagged as verified, force a
            // refresh — they may have clicked the link in another tab. We
            // intentionally fire-and-forget to avoid blocking the initial UI.
            if (user && !user.emailVerified) {
                reloadUser().catch(() => { /* swallow */ });
            }
        });

        document.addEventListener('visibilitychange', () => {
            if (document.visibilityState === 'visible') {
                reloadUser().catch(() => { /* swallow */ });
            }
        });

        window.addEventListener('focus', () => {
            reloadUser().catch(() => { /* swallow */ });
        });

        // Best-effort: if the page was opened via a passwordless email-link,
        // finish the sign-in automatically. The promise resolves to null when
        // the URL is not an email-link, so this is safe to fire-and-forget.
        completeEmailLinkSignIn().catch((err) => {
            console.warn('[DreamTeamAuth] Auto email-link sign-in failed:', err);
        });
    }

    function getCurrentUser()        { return state.currentUser; }
    function isSignedInAndVerified() { return !!(state.currentUser && state.currentUser.emailVerified); }

    function onAuthStateChange(cb) {
        if (typeof cb !== 'function') return () => {};
        state.listeners.add(cb);
        // Fire immediately with current state so the consumer can sync up.
        try { cb({ user: state.currentUser, isVerified: isSignedInAndVerified() }); } catch (e) { /* noop */ }
        return () => state.listeners.delete(cb);
    }

    /* ---------------------------------------------------------------------------
     *  Auth actions – classic email / password
     * ------------------------------------------------------------------------- */
    async function registerWithEmail(email, password) {
        requireInit();
        const cred = await firebase.auth().createUserWithEmailAndPassword(email, password);
        const user = cred.user;

        const settings = state.actionUrl ? { url: state.actionUrl, handleCodeInApp: false } : undefined;
        await user.sendEmailVerification(settings);

        return { user };
    }

    async function login(email, password) {
        requireInit();
        const cred = await firebase.auth().signInWithEmailAndPassword(email, password);
        return { user: cred.user };
    }

    async function resendVerification() {
        requireInit();
        const user = firebase.auth().currentUser;
        if (!user) throw new Error('Kein angemeldeter Benutzer.');
        const settings = state.actionUrl ? { url: state.actionUrl, handleCodeInApp: false } : undefined;
        await user.sendEmailVerification(settings);
    }

    async function reloadUser() {
        const user = firebase.auth().currentUser;
        if (!user) return null;
        await user.reload();
        // user is the same reference; emailVerified will be updated in-place.
        state.currentUser = firebase.auth().currentUser;
        notifyListeners();
        return state.currentUser;
    }

    async function logout() {
        requireInit();
        state.loadedTeamId = null;
        await firebase.auth().signOut();
    }

    async function sendPasswordReset(email) {
        requireInit();
        await firebase.auth().sendPasswordResetEmail(email);
    }

    /* ---------------------------------------------------------------------------
     *  Auth actions – Google Sign-In
     *
     *  Uses signInWithPopup. The provider configuration requests the user's
     *  e-mail and basic profile (which Firebase requests by default for Google,
     *  but we set it explicitly for clarity). On success the standard
     *  onAuthStateChanged listener fires, which in turn drives the existing
     *  pending-team finalisation logic in the host app.
     * ------------------------------------------------------------------------- */
    async function signInWithGoogle() {
        requireInit();
        const provider = new firebase.auth.GoogleAuthProvider();
        provider.addScope('email');
        provider.addScope('profile');

        // Force the account chooser so users can pick between multiple Google
        // identities on shared devices.
        provider.setCustomParameters({ prompt: 'select_account' });

        const result = await firebase.auth().signInWithPopup(provider);
        return { user: result.user };
    }

    /* ---------------------------------------------------------------------------
     *  Auth actions – Passwordless Email-Link
     *
     *  Flow:
     *    1) sendSignInLinkToEmail(email) sends an action link to the given
     *       address and remembers that address in localStorage so we can
     *       silently complete the sign-in when the user returns.
     *    2) When the user clicks the link in their inbox they land back on
     *       the app's URL with a `?apiKey=…&mode=signIn&oobCode=…` query.
     *       completeEmailLinkSignIn() detects this, reads the cached e-mail
     *       (or prompts the user if it's missing — e.g. they opened the link
     *       on a different device), and calls firebase.auth().signInWithEmailLink.
     *    3) On success the URL is cleaned and onAuthStateChanged fires,
     *       finalising the pending team just like the password flow.
     * ------------------------------------------------------------------------- */
    function getEmailLinkSettings() {
        // Email-link sign-in REQUIRES handleCodeInApp = true and a deep-link
        // URL back to the application. We fall back to the current page if
        // the caller did not configure one explicitly.
        const url = state.actionUrl || (window.location.origin + window.location.pathname);
        return { url, handleCodeInApp: true };
    }

    function storeEmailForLink(email) {
        try {
            window.localStorage.setItem(state.emailLinkStorageKey, email);
        } catch (err) {
            console.warn('[DreamTeamAuth] Could not persist email-link address:', err);
        }
    }

    function readStoredEmailForLink() {
        try {
            return window.localStorage.getItem(state.emailLinkStorageKey) || null;
        } catch (err) {
            return null;
        }
    }

    function clearStoredEmailForLink() {
        try { window.localStorage.removeItem(state.emailLinkStorageKey); } catch (err) { /* noop */ }
    }

    async function sendSignInLinkToEmail(email) {
        requireInit();
        const trimmed = (email || '').trim();
        if (!trimmed) throw new Error('Bitte eine gültige E-Mail-Adresse angeben.');

        await firebase.auth().sendSignInLinkToEmail(trimmed, getEmailLinkSettings());

        // CRUCIAL: remember the address so we can complete sign-in without
        // asking the user again when they come back via the link.
        storeEmailForLink(trimmed);
    }

    function isSignInWithEmailLink(url) {
        ensureFirebase();
        try {
            return !!firebase.auth().isSignInWithEmailLink(url || window.location.href);
        } catch (err) {
            return false;
        }
    }

    /**
     * Clean the email-link parameters out of the current URL so a reload won't
     * try to re-consume the (already used) oobCode.
     */
    function cleanEmailLinkFromUrl() {
        try {
            const url = new URL(window.location.href);
            ['apiKey', 'oobCode', 'mode', 'continueUrl', 'lang', 'tenantId']
                .forEach(p => url.searchParams.delete(p));
            const cleaned = url.pathname + (url.searchParams.toString() ? '?' + url.searchParams.toString() : '') + url.hash;
            window.history.replaceState({}, document.title, cleaned);
        } catch (err) {
            /* noop */
        }
    }

    async function completeEmailLinkSignIn(options) {
        requireInit();
        options = options || {};

        if (!isSignInWithEmailLink(window.location.href)) return null;

        // Try the override → cached → prompt chain.
        let email = (options.email || '').trim();
        if (!email) email = readStoredEmailForLink();
        if (!email && typeof window.prompt === 'function') {
            // Same device hint missing (e.g. user opened the link on a
            // different device) → fall back to a prompt so we can still
            // complete the sign-in.
            email = window.prompt('Bitte gib zur Bestätigung deine E-Mail-Adresse erneut ein:');
            email = (email || '').trim();
        }
        if (!email) throw new Error('E-Mail-Adresse zum Abschluss der Anmeldung fehlt.');

        const cred = await firebase.auth().signInWithEmailLink(email, window.location.href);

        clearStoredEmailForLink();
        cleanEmailLinkFromUrl();

        return { user: cred.user };
    }

    /* ---------------------------------------------------------------------------
     *  Pending team in localStorage
     *
     *  We store the entire team payload (manager, players, captain, etc.) so we
     *  can write it to Firestore the moment the user returns with a verified
     *  email — even from a fresh tab or after a reload.
     * ------------------------------------------------------------------------- */
    function setPendingTeam(payload) {
        requireInit();
        try {
            localStorage.setItem(state.pendingStorageKey, JSON.stringify({
                createdAt: Date.now(),
                payload
            }));
        } catch (err) {
            console.warn('[DreamTeamAuth] Could not persist pending team:', err);
        }
    }

    function getPendingTeam() {
        try {
            const raw = localStorage.getItem(state.pendingStorageKey);
            if (!raw) return null;
            const parsed = JSON.parse(raw);
            return parsed && parsed.payload ? parsed.payload : null;
        } catch (err) {
            return null;
        }
    }

    function clearPendingTeam() {
        try { localStorage.removeItem(state.pendingStorageKey); } catch (err) { /* noop */ }
    }

    function hasPendingTeam() {
        return !!getPendingTeam();
    }

    /* ---------------------------------------------------------------------------
     *  Firestore helpers
     *
     *  All team documents carry a `userId` field that must equal the Firebase
     *  Auth uid. The Firestore Security Rules enforce that:
     *      - read is public
     *      - create requires request.auth.token.email_verified == true
     *        and request.resource.data.userId == request.auth.uid
     *      - update/delete requires the same plus matching existing userId
     * ------------------------------------------------------------------------- */
    async function fetchUserTeam(uid) {
        requireInit();
        const targetUid = uid || (state.currentUser && state.currentUser.uid);
        if (!targetUid) return null;

        const snap = await state.db.collection(state.teamsCollection)
            .where('userId', '==', targetUid)
            .limit(1)
            .get();

        if (snap.empty) {
            state.loadedTeamId = null;
            return null;
        }

        const doc = snap.docs[0];
        state.loadedTeamId = doc.id;
        return { id: doc.id, data: doc.data() };
    }

    function buildTeamDocument(payload) {
        const user = state.currentUser;
        if (!user) throw new Error('Nicht angemeldet.');
        if (!user.emailVerified) throw new Error('E-Mail-Adresse ist nicht verifiziert.');

        const FieldValue = firebase.firestore.FieldValue;
        return {
            ...payload,
            userId:    user.uid,
            userEmail: user.email || null,
            status:    'verified',
            updatedAt: FieldValue.serverTimestamp()
        };
    }

    async function saveTeamForUser(payload) {
        requireInit();
        const FieldValue = firebase.firestore.FieldValue;
        const docData = {
            ...buildTeamDocument(payload),
            timestamp: FieldValue.serverTimestamp()
        };

        const ref = await state.db.collection(state.teamsCollection).add(docData);
        state.loadedTeamId = ref.id;
        return { id: ref.id, data: docData };
    }

    async function updateTeam(teamId, payload) {
        requireInit();
        if (!teamId) throw new Error('teamId fehlt.');
        await state.db.collection(state.teamsCollection).doc(teamId).update(buildTeamDocument(payload));
    }

    /**
     * Save-or-update convenience: looks up the user's existing team and either
     * updates it (edit flow) or creates a new one (lazy-register flow).
     */
    async function saveOrUpdateTeam(payload) {
        requireInit();
        if (!isSignedInAndVerified()) {
            throw new Error('E-Mail-Adresse muss verifiziert sein, bevor das Team gespeichert werden kann.');
        }

        let teamId = state.loadedTeamId;
        if (!teamId) {
            const existing = await fetchUserTeam();
            teamId = existing ? existing.id : null;
        }

        if (teamId) {
            await updateTeam(teamId, payload);
            return { id: teamId, mode: 'update' };
        }
        const created = await saveTeamForUser(payload);
        return { id: created.id, mode: 'create' };
    }

    /**
     * If the user is verified AND there is a pending team in localStorage,
     * write it to Firestore and clear the local copy. Safe to call on every
     * page load.
     */
    async function finalizePendingTeam() {
        requireInit();
        if (!isSignedInAndVerified()) return null;

        const pending = getPendingTeam();
        if (!pending) return null;

        const saved = await saveOrUpdateTeam(pending);
        clearPendingTeam();
        return saved;
    }

    function getLoadedTeamId() { return state.loadedTeamId; }
    function setLoadedTeamId(id) { state.loadedTeamId = id || null; }

    /* ---------------------------------------------------------------------------
     *  Public surface
     * ------------------------------------------------------------------------- */
    window.DreamTeamAuth = {
        init,
        getCurrentUser,
        isSignedInAndVerified,
        onAuthStateChange,

        registerWithEmail,
        login,
        signInWithGoogle,
        sendSignInLinkToEmail,
        isSignInWithEmailLink,
        completeEmailLinkSignIn,
        resendVerification,
        reloadUser,
        logout,
        sendPasswordReset,

        setPendingTeam,
        getPendingTeam,
        clearPendingTeam,
        hasPendingTeam,

        fetchUserTeam,
        saveTeamForUser,
        updateTeam,
        saveOrUpdateTeam,
        finalizePendingTeam,

        getLoadedTeamId,
        setLoadedTeamId
    };
})();
