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
| `auth-action.html`                | Custom Firebase email-action handler (replaces the default `/__/auth/action` page so verifications no longer require two extra confirmation clicks). |
| `LAZY_REGISTRATION_INTEGRATION.md`| This document.                                                                         |

> Hinweis zu den Firestore-Rules: Die Rules werden **nicht mehr im Repo
> gepflegt**, sondern direkt in der Firebase Console unter
> **Firestore Database → Regeln** verwaltet (Copy & Paste). So entfällt
> der `firebase deploy --only firestore:rules`-Schritt komplett.

## Files changed

| File                | Change                                                                                                                                                                                                |
|---------------------|--------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|
| `team-builder.html` | • Loaded `firebase-auth-compat`, `auth.js`, `auth-modal.js`, `auth-modal.css`. <br/>• Replaced `submitTeam()` with a version that delegates to `DreamTeamAuth`. <br/>• Added an auth-state listener that finalises the pending team after verification, and loads the user's existing team for editing. |

> The auth icon is now mounted directly into the global navbar. `nav.js`
> auto-initialises `DreamTeamAuth` and `DreamTeamAuthModal` on every page
> that loads them, so the user gets a consistent login state across the
> whole app. Make sure each page loads `firebase-auth-compat.js`,
> `auth.js`, `auth-modal.js` and `auth-modal.css` (in addition to the
> existing `firebase-app-compat.js` / `firebase-firestore-compat.js`).

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

The small auth icon in the navbar shows the current state at a glance:

* **Grey** person icon → signed out.
* **Green** person icon → signed in & e-mail verified.
* **Amber** person icon → signed in but e-mail not yet verified.

When signed out, clicking the icon opens the sign-in modal directly
(chooser view). When signed in & verified, clicking it instead opens a
small dropdown anchored to the icon with:

* the current e-mail address,
* a **Mein Team** entry that navigates to `team-builder.html` (the
  builder auto-loads the user's existing team for editing as long as
  the tournament has not started yet),
* a **Abmelden** button.

After `signInWithEmailAndPassword`, the auth listener in
`team-builder.html` detects a verified user with **no** pending team
in `localStorage` and calls `loadUserTeamIntoBuilder(user)`:

* `db.collection(TEAMS_COLLECTION).where('userId','==',uid).limit(1).get()`
* Rebuilds `selectedTeam`, `selectedCaptainId`, manager name from
  `data.players[].slot/playerId/isCaptain`.
* Re-renders the pitch.
* Changes the submit button label to **"Team aktualisieren ✓"**.

Submitting → `persistPayload()` calls `DreamTeamAuth.saveOrUpdateTeam()`,
which performs an `update()` on the existing doc id.

### 4. Logout

Clicking **Abmelden** in the navbar dropdown calls
`DreamTeamAuth.logout()`. The submit label in `team-builder.html` falls
back to the create label and the in-memory `editingTeamId` is reset.

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

DreamTeamAuth.fetchUserTeam(uid?);             // { id, data } | null — by userId, then email fallback
DreamTeamAuth.findTeamByEmail(email);          // { id, data } | null — case-insensitive match
DreamTeamAuth.saveOrUpdateTeam(payload);       // create-or-update; throws { code: 'team-exists-for-email' }
                                               // when a foreign UID already owns a team for this address
DreamTeamAuth.finalizePendingTeam();           // idempotent
```

## Firestore document shape

```js
// /Teams WM 2026/{auto-id}
{
    userId:            "abc123…",                       // == auth.uid (mandatory)
    userEmail:         "Alice@example.com",             // original casing as supplied by the IdP
    userEmailLower:    "alice@example.com",             // case-normalised for indexed lookups
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

### Anti-duplicate guard (one team per e-mail address)

`auth.js` persists a `userEmailLower` field on every team document and
performs an application-level duplicate check inside
`saveOrUpdateTeam(payload)` before creating a new document:

1. Look up the user's team by `userId` (canonical owner).
2. If none found, fall back to looking up by `userEmailLower` — this
   matches the team across sign-in providers (Google ↔ E-Mail/Password ↔
   E-Mail-Link). When found, the builder loads that team for editing
   instead of presenting a blank slate.
3. If a team already exists for the e-mail under a *different* Firebase
   UID and the user tries to submit a brand-new team, `saveOrUpdateTeam`
   throws an error with `code === 'team-exists-for-email'`. `team-builder.html`
   catches that code and shows the toast
   "Unter dieser E-Mail-Adresse ist bereits ein Team erfasst." before
   loading the existing document into the builder for editing.

This closes the gap where a user could create a team via Google, then
sign in via e-mail + password with the same address and silently end up
with a second team document under a fresh UID.

> **Note:** To allow cross-provider *editing* of the same team (Google
> created it → user later signs in via password and updates it), the
> Firestore rule for the `Teams …` collections must permit updates when
> the signed-in user's verified e-mail matches the document's stored
> `userEmailLower`. See the rules snippet below.

## Firebase console checklist

In the [Firebase console](https://console.firebase.google.com/project/dreamteam-d2121):

1. **Authentication → Sign-in method** — enable **Email/Password**.
2. **Authentication → Templates → Email verification** — adjust the
   template if you want a custom sender name / subject.

   **Wichtig (Custom Action Handler):** Damit Nutzer:innen nach dem Klick
   auf den Bestätigungs-Link nicht zuerst Firebases englische
   „Verify Email Address / COMPLETE VERIFICATION"-Seite und danach noch
   die deutsche „Ihre E-Mail-Adresse wurde bestätigt / WEITER"-Seite
   sehen müssen, sondern sofort wieder in der App landen, muss in der
   Firebase Console der **eigene Action-Handler** aktiviert werden:

   - Im Console-Pfad **Authentication → Templates** für jedes der vier
     Template-Formulare („Email address verification", „Password reset",
     „Email address change", „SMS verification") auf das Stift-Symbol
     klicken und unten **„customise action URL"** öffnen.
   - Dort die Adresse `https://dt.alae.app/auth-action.html` eintragen
     (eine zentrale Domain reicht — `auth-action.html` liest den
     `continueUrl`-Parameter und schickt die Nutzer:innen anschließend
     zurück auf die Ursprungs-Domain, auch wenn das z. B. die
     `em24dt.alae.app` war).
   - Die Adresse `https://dt.alae.app/auth-action.html` muss zudem
     unter **Authentication → Settings → Authorized domains** stehen
     (`dt.alae.app` reicht; die Datei liegt dort ausgeliefert vor).

   Sobald die Custom-Action-URL gespeichert ist, sieht der Klick-Flow so
   aus:

   ```text
   Klick im E-Mail-Postfach
        │
        ▼
   auth-action.html  ← appliziert oobCode still im Hintergrund
        │             (kein zusätzlicher Klick nötig)
        ▼
   continueUrl        ← Original-Seite der App, eingeloggt &
                        E-Mail verifiziert
   ```

   Die optionale `actionUrl` aus `DreamTeamAuth.init()` wird Firebase
   weiterhin als `continueUrl` mitgegeben und bestimmt, wohin
   `auth-action.html` nach erfolgreicher Bestätigung springt.
3. **Authentication → Settings → Authorized domains** — add
   `dt.alae.app`, `em24dt.alae.app`, and any Netlify preview domains.
4. **Firestore → Rules** — die Regeln werden direkt in der Firebase
   Console gepflegt (Copy & Paste). Der aktuelle, deploy-fertige Inhalt
   ist im PR „firestore.rules entfernen + Cache-Version bumpen"
   dokumentiert. Es ist kein `firebase deploy --only firestore:rules`
   mehr nötig.

   **Wichtige Anpassung (Anti-Duplikat-Schutz):** Damit dieselbe
   Person ihr Team auch nach einem Wechsel der Anmelde-Methode
   (Google ↔ E-Mail/Passwort ↔ E-Mail-Link) bearbeiten kann, müssen
   die Update-Regeln Schreibzugriff erlauben, sobald die verifizierte
   E-Mail des angemeldeten Benutzers mit dem `userEmailLower`-Feld des
   bestehenden Dokuments übereinstimmt. Beispiel für eine Teams-
   Sammlung (z.B. `Teams WM 2026`):

   ```text
   match /Teams\ WM\ 2026/{teamId} {
       allow read: if true;

       allow create: if request.auth != null
                  && request.auth.token.email_verified == true
                  && request.resource.data.userId == request.auth.uid
                  && request.resource.data.userEmailLower
                       == request.auth.token.email.lower();

       allow update, delete: if request.auth != null
                  && request.auth.token.email_verified == true
                  && (
                       resource.data.userId == request.auth.uid
                       || (
                           resource.data.userEmailLower is string
                        && resource.data.userEmailLower
                             == request.auth.token.email.lower()
                       )
                     );
   }
   ```

   Ohne die zweite Bedingung im `update`-Block würde der
   Cross-Provider-Edit-Fall in der Firestore-Schicht blockiert,
   obwohl die App das Team korrekt nachlädt.

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
