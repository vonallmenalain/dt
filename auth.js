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
 *    fetchSignInMethodsForEmail(email)    → Promise<string[]>            Provider IDs already linked to email
 *                                                                       (e.g. ['google.com'], ['password'],
 *                                                                       ['emailLink']). Empty array when the
 *                                                                       address is unknown OR when "email
 *                                                                       enumeration protection" is enabled.
 *
 *    setPendingTeam(payload)              Stores team JSON in localStorage
 *    getPendingTeam()                     → payload | null
 *    clearPendingTeam()                   void
 *    hasPendingTeam()                     → boolean
 *
 *    fetchUserTeam(uid?)                  → Promise<{ id, data } | null>   Matches by userId, then by user e-mail
 *                                                                           as a cross-provider fallback.
 *    hasSubmittedTeam(uid?)               → Promise<boolean>               Same lookup, without changing editor state.
 *    findTeamByEmail(email)               → Promise<{ id, data } | null>   Case-insensitive e-mail lookup. Used
 *                                                                           by saveOrUpdateTeam() to refuse a
 *                                                                           second team for the same address.
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

        // Force-refresh the ID token whenever the local user is flagged as
        // verified. `user.reload()` only updates the in-memory user profile;
        // it does NOT mint a new ID token. Firestore Security Rules evaluate
        // `request.auth.token.email_verified`, which is read from the cached
        // token until it expires (~1h) or is explicitly refreshed. Without
        // this call, the very first write right after a user clicks the
        // verification link fails with `permission-denied` even though the
        // client-side `emailVerified` flag is true. This is especially
        // visible on mobile, where the email-link is opened in a separate
        // app/browser and the original tab returns to a stale token.
        if (state.currentUser && state.currentUser.emailVerified) {
            try {
                await state.currentUser.getIdToken(/* forceRefresh */ true);
            } catch (err) {
                console.warn('[DreamTeamAuth] Token-Refresh fehlgeschlagen:', err);
            }
        }

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
        // Hand over the configured actionUrl as continueUrl so the custom
        // email-action handler (auth-action.html) can bounce the user back
        // to the correct page after they successfully set a new password.
        // Without this, the password-reset link arrives at the action
        // handler with no continueUrl and the handler can only fall back
        // to the site root.
        const settings = state.actionUrl ? { url: state.actionUrl, handleCodeInApp: false } : undefined;
        await firebase.auth().sendPasswordResetEmail(email, settings);
    }

    /* ---------------------------------------------------------------------------
     *  Sign-in method discovery
     *
     *  Returns the list of provider IDs already linked to the given e-mail
     *  address (e.g. ['google.com'], ['password'], ['emailLink'], or any
     *  combination). Useful to give a precise hint when a user tries to
     *  sign in with the "wrong" method – e.g. they originally created the
     *  account via Google and now try the classic password form.
     *
     *  Notes:
     *    - With Firebase's "Email enumeration protection" enabled this
     *      endpoint always returns an empty array, so callers must treat
     *      an empty result as "unknown" rather than "no account".
     *    - Network/permission errors are caught and yield [] as well so
     *      that callers can fall back to the generic error message.
     * ------------------------------------------------------------------------- */
    async function fetchSignInMethodsForEmail(email) {
        requireInit();
        const trimmed = (email || '').trim();
        if (!trimmed) return [];
        try {
            const methods = await firebase.auth().fetchSignInMethodsForEmail(trimmed);
            return Array.isArray(methods) ? methods : [];
        } catch (err) {
            console.warn('[DreamTeamAuth] fetchSignInMethodsForEmail failed:', err);
            return [];
        }
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
    /**
     * Normalise an e-mail address for case-insensitive lookups. Firebase
     * already lower-cases the local part for most providers, but we apply
     * `toLowerCase()` defensively so that comparisons across providers
     * (Google vs. email/password) always match. Whitespace is trimmed.
     */
    function normalizeEmail(email) {
        return (email || '').trim().toLowerCase() || null;
    }

    /**
     * Find any team document whose stored e-mail matches the given address.
     *
     * The check is intentionally case-insensitive and falls back to the
     * legacy `userEmail` field for documents that were written before we
     * started persisting `userEmailLower`.
     *
     * Returns the first matching `{ id, data }` or `null` when nothing
     * matches.
     */
    async function findTeamByEmail(email) {
        requireInit();
        const normalized = normalizeEmail(email);
        if (!normalized) return null;

        // Preferred path: indexed lookup on the dedicated lower-cased field.
        try {
            const snap = await state.db.collection(state.teamsCollection)
                .where('userEmailLower', '==', normalized)
                .limit(1)
                .get();
            if (!snap.empty) {
                const doc = snap.docs[0];
                return { id: doc.id, data: doc.data() };
            }
        } catch (err) {
            // Composite-index / missing-field errors should not stop the
            // legacy fallback below; surface them in the console for ops.
            console.warn('[DreamTeamAuth] userEmailLower lookup failed, trying legacy field:', err);
        }

        // Legacy fallback: older documents only carry the original-case
        // `userEmail`. We try both the as-typed address and the lower-cased
        // variant because writes prior to this change might have stored
        // either form.
        try {
            const snap = await state.db.collection(state.teamsCollection)
                .where('userEmail', '==', normalized)
                .limit(1)
                .get();
            if (!snap.empty) {
                const doc = snap.docs[0];
                return { id: doc.id, data: doc.data() };
            }
        } catch (err) {
            console.warn('[DreamTeamAuth] legacy userEmail lookup failed:', err);
        }

        return null;
    }

    /**
     * Look up the current user's team. Strategy:
     *   1) Match by `userId` (the canonical owner field, enforced by rules).
     *   2) If none found, fall back to an e-mail match so a user who
     *      previously created their team via a different sign-in provider
     *      (e.g. Google) ends up editing the same document when they later
     *      log in via e-mail + password (and vice versa).
     *
     * `rememberLoadedTeamId` preserves the legacy editor side effect for
     * fetchUserTeam(), while letting pure UI status checks stay read-only.
     */
    async function lookupUserTeam(uid, rememberLoadedTeamId) {
        requireInit();
        const user      = state.currentUser;
        const targetUid = uid || (user && user.uid);
        if (!targetUid) return null;

        const byUid = await state.db.collection(state.teamsCollection)
            .where('userId', '==', targetUid)
            .limit(1)
            .get();

        if (!byUid.empty) {
            const doc = byUid.docs[0];
            if (rememberLoadedTeamId) state.loadedTeamId = doc.id;
            return { id: doc.id, data: doc.data() };
        }

        // No team for this UID — fall back to matching by e-mail so the
        // cross-provider case (same address, two Firebase UIDs) still
        // resolves to the original team instead of looking like a blank
        // slate that invites a duplicate submission.
        const email = user && user.email;
        if (email) {
            const byEmail = await findTeamByEmail(email);
            if (byEmail) {
                if (rememberLoadedTeamId) state.loadedTeamId = byEmail.id;
                return byEmail;
            }
        }

        if (rememberLoadedTeamId) state.loadedTeamId = null;
        return null;
    }

    async function fetchUserTeam(uid) {
        return lookupUserTeam(uid, true);
    }

    async function hasSubmittedTeam(uid) {
        return !!(await lookupUserTeam(uid, false));
    }

    function buildTeamDocument(payload) {
        const user = state.currentUser;
        if (!user) throw new Error('Nicht angemeldet.');
        if (!user.emailVerified) throw new Error('E-Mail-Adresse ist nicht verifiziert.');

        const FieldValue = firebase.firestore.FieldValue;
        return {
            ...payload,
            userId:         user.uid,
            userEmail:      user.email || null,
            userEmailLower: normalizeEmail(user.email),
            status:         'verified',
            updatedAt:      FieldValue.serverTimestamp()
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
     * Error thrown when a brand-new team submission would create a
     * duplicate for the signed-in user's e-mail address. Surfaces a
     * `code` of `'team-exists-for-email'` so callers can render a
     * user-facing message without having to string-match on the error
     * `message`.
     */
    function teamExistsForEmailError(email, existing) {
        const err = new Error('Unter dieser E-Mail-Adresse ist bereits ein Team erfasst.');
        err.code  = 'team-exists-for-email';
        err.email = email || null;
        if (existing) {
            err.existingTeamId = existing.id;
            err.existingTeam   = existing;
        }
        return err;
    }

    /**
     * Save-or-update convenience: looks up the user's existing team and either
     * updates it (edit flow) or creates a new one (lazy-register flow).
     *
     * Crucially, this also performs a *cross-provider* duplicate check: if
     * any team already exists for the signed-in user's e-mail address —
     * even one written under a different Firebase UID, e.g. because the
     * user previously signed in via Google and is now back via e-mail +
     * password — we refuse to create a second team and throw a
     * `'team-exists-for-email'` error instead. This is the application-
     * level safety net behind the user-visible
     *   "Unter dieser E-Mail-Adresse ist bereits ein Team erfasst"
     * message.
     */
    async function saveOrUpdateTeam(payload) {
        requireInit();
        if (!isSignedInAndVerified()) {
            throw new Error('E-Mail-Adresse muss verifiziert sein, bevor das Team gespeichert werden kann.');
        }

        // Make sure the ID token Firestore evaluates carries the current
        // `email_verified` claim. The cached token may still report
        // `false` immediately after the user clicked the verification link,
        // even though `user.emailVerified` has already flipped to `true`.
        try { await state.currentUser.getIdToken(/* forceRefresh */ true); }
        catch (e) { /* non-fatal — fall through and let Firestore decide */ }

        const user  = state.currentUser;
        const email = user && user.email;

        let teamId     = state.loadedTeamId;
        let loadedTeam = null;
        if (!teamId) {
            loadedTeam = await fetchUserTeam();
            teamId = loadedTeam ? loadedTeam.id : null;
        }

        if (teamId) {
            try {
                await updateTeam(teamId, payload);
                return { id: teamId, mode: 'update' };
            } catch (err) {
                // Cross-provider edge case: we resolved the team via the
                // e-mail fallback (different Firebase UID), but the
                // Firestore Security Rules still gate updates by
                // `userId == request.auth.uid`. Translate the resulting
                // permission-denied into the more actionable
                // 'team-exists-for-email' so the UI can render the
                // matching message rather than a generic save error.
                const isPermissionError =
                    err && (err.code === 'permission-denied'
                         || err.code === 'firestore/permission-denied'
                         || (typeof err.message === 'string' && /permission/i.test(err.message)));
                const ownerMismatch = loadedTeam
                    && loadedTeam.data
                    && user
                    && loadedTeam.data.userId
                    && loadedTeam.data.userId !== user.uid;
                if (isPermissionError && ownerMismatch) {
                    throw teamExistsForEmailError(email, loadedTeam);
                }
                throw err;
            }
        }

        // No team for this UID yet → before creating a new document, make
        // sure no other team is already registered under the same e-mail
        // (the user might have first registered with another sign-in
        // provider). This is what keeps a single e-mail address from
        // owning two separate team documents.
        if (email) {
            const existingByEmail = await findTeamByEmail(email);
            if (existingByEmail) throw teamExistsForEmailError(email, existingByEmail);
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
        fetchSignInMethodsForEmail,

        setPendingTeam,
        getPendingTeam,
        clearPendingTeam,
        hasPendingTeam,

        fetchUserTeam,
        hasSubmittedTeam,
        findTeamByEmail,
        saveTeamForUser,
        updateTeam,
        saveOrUpdateTeam,
        finalizePendingTeam,

        getLoadedTeamId,
        setLoadedTeamId
    };
})();
