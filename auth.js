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
 *                                              actionUrl          – optional ActionCodeSettings.url for the
 *                                                                   verification email (deep-link back to the app)
 *                                              languageCode       – optional BCP-47 language code applied to
 *                                                                   firebase.auth() so verification e-mails
 *                                                                   *and* the Firebase-hosted action handler
 *                                                                   page (/__/auth/action) are localised
 *                                                                   (default: 'de')
 *                                            }
 *
 *    getCurrentUser()                     → firebase.User | null
 *    isSignedInAndVerified()              → boolean
 *    onAuthStateChange(cb)                → unsubscribe()      cb({ user, isVerified })
 *
 *    registerWithEmail(email, password)   → Promise<{ user }>            Creates user + sends verification email
 *    login(email, password)               → Promise<{ user }>
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
        initialised:        false,
        db:                 null,
        teamsCollection:    null,
        pendingStorageKey:  'dreamteam_pending_team',
        actionUrl:          null,
        languageCode:       'de',
        currentUser:        null,
        // Track the loaded user team while editing so submit() knows the doc id.
        loadedTeamId:       null,
        // Subscribers to onAuthStateChange (our own, not firebase's raw)
        listeners:          new Set()
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

        state.db                = options.db;
        state.teamsCollection   = options.teamsCollection;
        state.pendingStorageKey = options.pendingStorageKey || state.pendingStorageKey;
        state.actionUrl         = options.actionUrl || null;
        state.languageCode      = options.languageCode || state.languageCode;
        state.initialised       = true;

        // Apply the language to Firebase Auth so that verification e-mails and
        // the Firebase-hosted action handler page (/__/auth/action) — including
        // the "E-Mail-Adresse bestätigen" / "Bestätigung abschließen" screen —
        // are rendered in the configured language instead of the English default.
        try {
            firebase.auth().languageCode = state.languageCode;
        } catch (err) {
            console.warn('[DreamTeamAuth] Could not set Firebase auth languageCode:', err);
        }

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
     *  Auth actions
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
