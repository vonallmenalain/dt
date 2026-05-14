# Lazy Registration for DreamTeam

This document describes the lazy-registration flow that has been added on top
of the existing DreamTeam (Firebase compat v10.8.0) front-end. Users can build
and view teams without an account; authentication is only requested at the
moment they try to write to Firestore.

## Overview

```
                            ┌────────────────────────────────────┐
                            │ All other views (public, read-only)│
                            └────────────────────────────────────┘
                                          │
                                          ▼
   ┌──────────────────────┐   build      ┌────────────────────┐
   │  team-builder.html   ├──────────────►  selectedTeam (mem) │
   └─────────┬────────────┘              └────────────────────┘
             │ submit
             ▼
   ┌──────────────────────────────┐  no/unverified   ┌─────────────────────┐
   │  DreamTeamAuth.isSignedIn…?  ├──────────────────►  Auth modal opens   │
   └─────────┬────────────────────┘                  └──────┬──────────────┘
             │ yes & verified                              │ register
             ▼                                              ▼
   ┌──────────────────────────────┐              ┌──────────────────────────┐
   │  Save / Update Firestore doc │              │ Stash payload in LS;     │
   │  (status: 'verified')        │              │ sendEmailVerification(). │
   └──────────────────────────────┘              └──────┬───────────────────┘
                                                       │ user clicks link
                                                       ▼
                                          ┌──────────────────────────┐
                                          │ Tab regains focus →      │
                                          │ user.reload() →          │
                                          │ emailVerified === true   │
                                          │ → finalize pending team  │
                                          └──────────────────────────┘
```

## Files added

| File                              | Purpose                                                                                |
|-----------------------------------|----------------------------------------------------------------------------------------|
| `auth.js`                         | `window.DreamTeamAuth` — Firebase Auth + Firestore + pending-team helpers (UI-free).   |
| `auth-modal.css`                  | Minimal, namespaced (`.dt-auth-*`) styles for the modal and the top-right login chip. |
| `auth-modal.js`                   | `window.DreamTeamAuthModal` — the modal UI (register / login / verify views).          |
| `firestore.rules`                 | Public-read / verified-owner-write rules for every `Teams …` collection.               |
| `LAZY_REGISTRATION_INTEGRATION.md`| This document.                                                                         |

## Files changed

| File                | Change                                                                                                                                                                                                |
|---------------------|--------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|
| `team-builder.html` | • Loaded `firebase-auth-compat`, `auth.js`, `auth-modal.js`, `auth-modal.css`. <br/>• Replaced `submitTeam()` with a version that delegates to `DreamTeamAuth`. <br/>• Added an auth-state listener that finalises the pending team after verification, and loads the user's existing team for editing. |

> No other HTML page was modified. The chip + modal are mounted by
> `DreamTeamAuthModal.install()` and only appear on the team-builder for now.
> Add the same three `<script>`/`<link>` lines and call `install()` on any
> other page where you want the same behaviour.

## How the flow works

### 1. Submit a new team (lazy register)

`team-builder.html` → `submitTeam()`:

```text
if (DreamTeamAuth.isSignedInAndVerified())
    persistPayload(...)                  // create or update doc in Firestore
else
    DreamTeamAuth.setPendingTeam(...)    // localStorage
    DreamTeamAuthModal.open({mode:'register'})
        → createUserWithEmailAndPassword
        → sendEmailVerification
        → modal switches to "verify" view
```

The pending team payload lives in `localStorage` under the key
`dreamteam_<tournament_key>_pending_team` (e.g.
`dreamteam_wm2026_pending_team`).

### 2. Email verification round-trip

When the user clicks the link in their inbox, Firebase verifies the email
server-side. Returning to the DreamTeam tab triggers:

* `visibilitychange` / `focus` →
* `DreamTeamAuth.reloadUser()` → `firebase.auth().currentUser.reload()` →
* `onAuthStateChange` listeners fire with `isVerified: true` →
* `tryFinalizePendingTeam()` writes the doc with `userId`, `status: 'verified'`
  and clears the pending entry, then redirects to `teams.html`.

This works on the original tab *and* on a freshly reloaded tab.

### 3. Login & edit

The floating top-right chip says **"Anmelden"** when signed out.

1. Click → `DreamTeamAuthModal.open({mode:'login'})`.
2. After `signInWithEmailAndPassword`, the auth listener detects a verified
   user with **no** pending team in `localStorage` and calls
   `loadUserTeamIntoBuilder(user)`:
   * `db.collection(TEAMS_COLLECTION).where('userId','==',uid).limit(1).get()`
   * Rebuilds `selectedTeam`, `selectedCaptainId`, manager name from
     `data.players[].slot/playerId/isCaptain`.
   * Re-renders the pitch.
   * Changes the submit button label to **"Team aktualisieren ✓"**.
3. Submit → `persistPayload()` calls `DreamTeamAuth.saveOrUpdateTeam()`,
   which performs an `update()` on the existing doc id.

### 4. Logout

Clicking the chip while verified shows a confirmation and calls
`DreamTeamAuth.logout()`. The submit label falls back to the create label;
the in-memory `editingTeamId` is reset.

### 5. Stay signed in across sessions

`DreamTeamAuth.init()` explicitly configures Firebase Auth with
`LOCAL` persistence (the SDK default, made explicit so it is robust
against future SDK changes and easy to audit). That means:

* Closing the tab, closing the browser, or rebooting the device does
  **not** sign the user out. Firebase keeps the refresh token in
  IndexedDB and silently re-issues an access token on the next visit.
* The user only has to authenticate again when they:
  * click the **Abmelden** button (chip → confirm),
  * clear the site's storage manually,
  * use a different device or browser profile,
  * or sit in an environment that cannot use IndexedDB
    (e.g. Safari Private Mode) — in which case we transparently fall
    back to `SESSION` persistence so the rest of the flow still works
    for the current tab.

If a particular page wants a shorter-lived session (e.g. an admin
console on a shared device), pass `persistence: 'session'` (per-tab)
or `persistence: 'none'` (in-memory only) to `DreamTeamAuth.init()`.

## Public API quick reference

```js
// Initialise (called once by team-builder.html)
DreamTeamAuth.init({
    db:                 firebase.firestore(),
    teamsCollection:    'Teams WM 2026',
    pendingStorageKey:  'dreamteam_wm2026_pending_team',
    actionUrl:          'https://dt.alae.app/team-builder.html',
    languageCode:       'de'   // localises Firebase verification e-mails and the
                               // Firebase-hosted action handler page (default: 'de')
});

DreamTeamAuthModal.install();   // mounts the chip + builds the modal DOM

DreamTeamAuth.registerWithEmail(email, password);
DreamTeamAuth.login(email, password);
DreamTeamAuth.resendVerification();
DreamTeamAuth.reloadUser();
DreamTeamAuth.logout();
DreamTeamAuth.sendPasswordReset(email);

DreamTeamAuth.isSignedInAndVerified();
DreamTeamAuth.getCurrentUser();
DreamTeamAuth.onAuthStateChange(({ user, isVerified }) => { ... });

DreamTeamAuth.setPendingTeam(payload);
DreamTeamAuth.getPendingTeam();
DreamTeamAuth.clearPendingTeam();
DreamTeamAuth.hasPendingTeam();

DreamTeamAuth.fetchUserTeam(uid?);             // { id, data } | null
DreamTeamAuth.saveOrUpdateTeam(payload);       // create-or-update
DreamTeamAuth.finalizePendingTeam();           // idempotent
```

## Firestore document shape

```js
// /Teams WM 2026/{auto-id}
{
    userId:            "abc123…",                       // == auth.uid (mandatory)
    userEmail:         "alice@example.com",
    manager:           "Alice Müller",
    managerNormalized: "alice müller",
    players: [
        { slot: "slot-0",  playerId: 42,  name: "Yann Sommer",  nation: "Switzerland", pos: "GOALKEEPER", isCaptain: false },
        // ... 14 more entries
    ],
    status:    "verified",
    timestamp: <serverTimestamp>,
    updatedAt: <serverTimestamp>
}
```

Existing legacy team documents (no `userId`) remain readable; only writes
are restricted by the new rules.

## Firebase console checklist

In the [Firebase console](https://console.firebase.google.com/project/dreamteam-d2121):

1. **Authentication → Sign-in method** — enable **Email/Password**.
2. **Authentication → Templates → Email verification** — adjust the
   template if you want a custom sender name / subject. The link target is
   handled by Firebase; the optional `actionUrl` passed to
   `DreamTeamAuth.init()` controls where users land after clicking.
3. **Authentication → Settings → Authorized domains** — add
   `dt.alae.app`, `em24dt.alae.app`, and any Netlify preview domains.
4. **Firestore → Rules** — paste the contents of `firestore.rules`
   (`firebase deploy --only firestore:rules` if you have the CLI set up).

## Testing checklist

1. As a logged-out visitor, browse `teams.html`, `rangliste.html`,
   `spieleranalyse.html` — all should still work (public read).
2. Open `team-builder.html`, build a full 15-player team with a captain.
3. Click **Team abschicken ✓** → modal opens in *Register* mode.
4. Submit email + password → modal switches to *"Check your inbox"*. The
   pending payload is now in `localStorage` under
   `dreamteam_<key>_pending_team`.
5. Click the verification link in the email, then return to the tab.
   The team should auto-save and redirect to `teams.html?manager=…`.
6. Refresh the team-builder. The login chip top-right reads
   `<email> · Abmelden`. Click it → confirm sign-out.
7. Click the chip again → choose **Anmelden** tab → log in. The builder
   should populate with your existing team and the submit button now reads
   **Team aktualisieren ✓**.
8. Change a player → click submit → Firestore doc is *updated* (same id).
9. Verify in the Firestore console that `userId` matches your auth uid and
   that anonymous writes are rejected.
