# DreamTeam

DreamTeam ist eine Webapp, mit der Userinnen und User vor einem Turnier ein
Fantasy-Team aus dem Spielerpool zusammenstellen und ihre Punkte über die
ganze Saison verfolgen. Die App ist statisch ausgeliefert (Netlify), Daten
liegen in Firebase Firestore; serverseitige Cron-Jobs aktualisieren
Spielplan und Punkte automatisch.

Aktuell ist nur die **WM 2026** produktiv konfiguriert.

---

## 1) Zentrale Steuerung: `tournament-config.js`

`tournament-config.js` ist die **einzige Quelle der Wahrheit** für alles,
was turnier­spezifisch ist:

- Labels (`shortLabel`, `brandName`, `pageTitlePrefix`, …)
- Datendatei (`dataFile` → `data-<key>.js`)
- API-Werte (`competitionId`, `season`)
- Firestore-Collections (`teamsCollection`, `pointsCollection`,
  `fixturesCollection`, Meta-Dokument)
- LocalStorage-/Cache-Prefixes
- Anpfiff-Zeitpunkt (`DREAMTEAM_START`)
- Fallback-Spiele
- Punkteregeln (`rules`) und Labels (`ruleLabels`)

Die Datei wird sowohl im Browser (`window.APP_CONFIG`) als auch in den
Node-Cron-Scripts (`require('../tournament-config.js')`) eingebunden. Es
darf **nirgendwo sonst** eine zweite Turnier-Tabelle oder ein zweiter
Regelsatz existieren – das war früher der Fall und hat zu Drift geführt.

### Neues Turnier ergänzen

1. Block in `tournament-config.js` ergänzen (analog `wm2026`) und
   zunächst auf `available: false`, `dataReady: false` lassen.
2. `data-<key>.js` mit dem Kader generieren (z.B. via
   `adm-generate-kader-…`).
3. Sobald die Datei deployed ist: `available: true`, `dataReady: true`.

Andere Stellen (Cron-Scripts, Workflows, Frontend-Skripte) müssen
**nicht** angefasst werden – sie lesen alles aus `tournament-config.js`.

### Aktives Turnier auflösen

Browser-Reihenfolge:

1. URL-Parameter `?tournament=<key>` (Test-Override, nicht persistent).
2. Host-spezifischer Dev-Override (`localStorage` →
   `dreamteam_dev_override_<hostname>`).
3. Domain-Mapping (`DOMAIN_TOURNAMENT_MAP`).
4. Globaler Fallback (`FALLBACK_TOURNAMENT_KEY = "wm2026"`).

Node-Cron-Scripts:

- `process.env.TOURNAMENT_KEY` (siehe Workflows weiter unten).
- Sonst Fallback aus `tournament-config.js`.

Ungültige oder nicht verfügbare Keys werden ignoriert und fallen auf
den Default zurück.

---

## 2) Backend / Cron-Scripts (`scripts/`)

Server-seitige Workflows, die als GitHub Actions laufen. Firestore-
Schreibzugriffe finden ausschliesslich hier statt, nicht im Browser.

| Script                  | Zweck                                                                     | Cron                          |
| ----------------------- | ------------------------------------------------------------------------- | ----------------------------- |
| `auto-points-upload.js` | Punkte berechnen + nach Firestore schreiben, Meta-Version hochzählen.     | alle 5 Minuten                |
| `sync-fixtures.js`      | Fixtures + Venues von api-football laden + nach Firestore schreiben.      | täglich 04:00 UTC (≈ 06:00 CH)|

Beide Scripts lesen die Turnier-Konfiguration **direkt aus
`tournament-config.js`** – keine lokale Kopie pflegen.

### Pre-Check (auto-points-upload)

Ein Cron-Tick lädt zunächst nur den Spielplan aus Firestore und prüft,
ob ein Spiel im Trigger-Fenster (Default 100–260 Minuten nach Anstoss)
liegt, dessen Status noch nicht `FT`/`AET`/`PEN` ist. Ist das nicht der
Fall, beendet sich der Job sofort. Damit kostet ein Tick ausserhalb
der Spieltage praktisch nichts (1 Firestore-Read, 0 API-Calls).

`pointsUpdatedAt` und `pointsVersion` im Meta-Dokument werden nur
nach einem erfolgreichen Schreibvorgang erhöht. Die "Zuletzt
aktualisiert"-Anzeige auf `rangliste.html` ist also exakt dann frisch,
wenn neue Daten in Firebase liegen.

### Einrichtung

#### Repo-Secrets

`Settings → Secrets and variables → Actions`:

| Name                       | Inhalt                                                |
| -------------------------- | ----------------------------------------------------- |
| `RAPIDAPI_KEY`             | RapidAPI / api-football Key.                          |
| `FIREBASE_SERVICE_ACCOUNT` | Firebase-Service-Account-JSON als String (nicht Base64). |

Service-Account-JSON erzeugen:

1. [Firebase Console](https://console.firebase.google.com/) → Projekt
   `dreamteam-d2121` → Zahnrad → **Project settings** → Tab
   **Service accounts** → **Generate new private key**.
2. Den **kompletten** JSON-Inhalt (inkl. `\n` im `private_key`) in das
   Secret einfügen, 1:1.

#### Optionale Repo-Variables

`Settings → Secrets and variables → Actions → Tab Variables` – alle
Variables sind optional und werden nur gebraucht, wenn man den
Default aus `tournament-config.js` überschreiben will:

| Name                       | Default                            | Bedeutung                                                       |
| -------------------------- | ---------------------------------- | --------------------------------------------------------------- |
| `TOURNAMENT_KEY`           | Fallback aus `tournament-config.js`| Turnier für beide Workflows.                                    |
| `POINTS_WINDOW_START_MIN`  | `100`                              | Auto-Punkte: untere Grenze des Trigger-Fensters (Min. nach Anpfiff). |
| `POINTS_WINDOW_END_MIN`    | `260`                              | Auto-Punkte: obere Grenze.                                      |

Wer dieselbe Variable früher pro Workflow doppelt (z.B.
`AUTO_UPLOAD_TOURNAMENT_KEY` + `FIXTURES_SYNC_TOURNAMENT_KEY`) gesetzt
hatte: nur noch `TOURNAMENT_KEY` setzen, beide Workflows lesen sie.

### Manuelles Auslösen

Tab **Actions** → Workflow auswählen → **Run workflow**. Inputs:

- `tournament_key` – überschreibt das Default-Turnier.
- `force_run` *(nur Auto-Punkte-Upload)* – Pre-Check überspringen
  (kompletter Recompute).
- `dry_run` – Skript loggt nur, schreibt nichts in Firestore.
- `skip_venues` *(nur Spielplan-Sync)* – Venue-Detail-Calls auslassen
  (spart API-Quota, wenn sich an den Stadien nichts ändert).

### Lokal testen

```bash
cd scripts
npm install

export RAPIDAPI_KEY="…"
export FIREBASE_SERVICE_ACCOUNT="$(cat ~/Downloads/dreamteam-d2121-xxx.json)"
export DRY_RUN=1

npm run auto-upload      # Auto-Punkte-Upload
npm run sync-fixtures    # Spielplan-Sync
```

Mit `DRY_RUN=1` läuft der ganze Workflow inkl. API-Calls bis zum Ende,
schreibt aber nichts in Firestore. `FORCE_RUN=1` überspringt im
Auto-Upload zusätzlich den Pre-Check.

`TOURNAMENT_KEY` lässt man typischerweise leer – dann gilt der Default
aus `tournament-config.js`.

---

## 3) Lazy Registration / Auth

Nutzerinnen und Nutzer können Teams **ohne Account** bauen und
ansehen. Authentifizierung (Firebase Auth, Compat v10.8.0) wird erst
verlangt, wenn ein Team gespeichert werden soll – siehe
`auth.js`, `auth-modal.js`, `auth-modal.css`, `auth-action.html`.

### Ablauf (vereinfacht)

```
Team bauen → submit
   │
   ├─ signed-in & verified → Firestore-Doc speichern (status: 'verified')
   │
   └─ sonst → Pending-Team in localStorage parken + Modal öffnen
              → Registrieren / Anmelden / E-Mail-Verifikation
              → Tab kommt zurück, user.reload(), pending team finalisieren
```

Das gestashte Payload liegt in
`localStorage[dreamteam_<tournament_key>_pending_team]`.

### Session-Persistenz

`DreamTeamAuth.init()` setzt explizit `LOCAL`-Persistenz. Closing
Tab/Browser meldet niemanden ab; Firebase erneuert das Access-Token
beim nächsten Besuch automatisch über IndexedDB. Falls IndexedDB
blockiert ist (Safari Private), fällt der Code transparent auf
`SESSION`-Persistenz zurück.

### Anti-Duplikat-Schutz (ein Team pro E-Mail)

`saveOrUpdateTeam(payload)` schreibt `userEmailLower` mit. Vor jedem
**neuen** Doc-Insert wird zuerst per `userId` und dann per
`userEmailLower` gesucht. Wenn unter derselben E-Mail-Adresse bereits
ein Team unter einer fremden UID liegt, wird mit Code
`team-exists-for-email` abgebrochen; `team-builder.html` zeigt
„Unter dieser E-Mail-Adresse ist bereits ein Team erfasst." und lädt
das bestehende Doc zum Editieren.

### Public API

```js
DreamTeamAuth.init({ db, teamsCollection, pendingStorageKey, actionUrl, languageCode });
DreamTeamAuthModal.install();

DreamTeamAuth.registerWithEmail(email, password);
DreamTeamAuth.login(email, password);
DreamTeamAuth.resendVerification();
DreamTeamAuth.reloadUser();
DreamTeamAuth.logout();
DreamTeamAuth.sendPasswordReset(email);

DreamTeamAuth.isSignedInAndVerified();
DreamTeamAuth.getCurrentUser();
DreamTeamAuth.onAuthStateChange(({ user, isVerified }) => { … });

DreamTeamAuth.setPendingTeam(payload);
DreamTeamAuth.getPendingTeam();
DreamTeamAuth.clearPendingTeam();
DreamTeamAuth.hasPendingTeam();

DreamTeamAuth.fetchUserTeam(uid?);             // by userId, dann email-Fallback
DreamTeamAuth.findTeamByEmail(email);          // case-insensitive
DreamTeamAuth.saveOrUpdateTeam(payload);       // create-or-update
DreamTeamAuth.finalizePendingTeam();           // idempotent
```

### Firestore-Dokument-Form

```js
// /Teams WM 2026/{auto-id}
{
    userId:            "abc123…",
    userEmail:         "Alice@example.com",
    userEmailLower:    "alice@example.com",
    manager:           "Alice Müller",
    managerNormalized: "alice müller",
    players: [
        {
            slot:      "slot-0",
            playerId:  42,
            name:      "Yann Sommer",
            nation:    "Switzerland",
            pos:       "GOALKEEPER",
            // Anzeige-Snapshot: bleibt im Team-Doc auch dann nutzbar, wenn
            // der Spieler später aus `data-wm2026.js` verschwindet (z.B.
            // nach einer Kader-Bereinigung oder Pseudo-ID-Migration). Die
            // App fällt erst dann auf diese Felder zurück, wenn der Spieler
            // nicht mehr in `playersData` gefunden wird.
            photo:     "https://media.api-sports.io/football/players/42.png",
            club:      "Inter",
            clubLogo:  "https://media.api-sports.io/football/teams/505.png",
            flag:      "https://media.api-sports.io/football/teams/15.png",
            isCaptain: false
        }
        // … 14 weitere Einträge
    ],
    status:    "verified",
    timestamp: <serverTimestamp>,
    updatedAt: <serverTimestamp>
}
```

Ältere Team-Dokumente besitzen `photo` / `club` / `clubLogo` / `flag` (noch)
nicht. Frontend-Code behandelt diese Felder konsequent als optional und
fällt auf die kanonischen Werte aus `data-wm2026.js` zurück. Beim nächsten
Speichern eines Teams (`saveOrUpdateTeam`) werden die Snapshot-Felder
automatisch ergänzt.

#### Orphan-Spieler im Builder

`team-builder.html` erkennt beim Laden eines bestehenden Teams aus
Firestore Spieler, deren `playerId` nicht mehr in `playersData` steht
(„Orphans"). Solche Slots werden mit dem Snapshot-Stand weiterhin
sichtbar gerendert, mit Badge **„Bitte ersetzen"** markiert und über das
Builder-Notice-Banner gemeldet. Der Submit-Button ist nur dann hart
gesperrt, wenn der **Captain** ein Orphan ist – andere Orphans erzeugen
nur eine Warnung, damit der Manager sein Team überhaupt erst neu
speichern kann.

---

## 4) Firebase Console Checklist

In der [Firebase Console](https://console.firebase.google.com/project/dreamteam-d2121):

1. **Authentication → Sign-in method** → **Email/Password** aktivieren.
2. **Authentication → Templates** – Vorlagen anpassen.
   **Custom Action Handler aktivieren:** Bei jeder der vier Template-
   Vorlagen ("Email address verification", "Password reset", "Email
   address change", "SMS verification") auf das Stift-Symbol klicken,
   unten **"customise action URL"** öffnen und
   `https://dt.alae.app/auth-action.html` eintragen. Dann landet der
   Nutzer nach Klick auf den Verifikations-Link direkt wieder in der
   App, ohne erst die englische Firebase-Bestätigungsseite zu sehen.
3. **Authentication → Settings → Authorized domains** – `dt.alae.app`
   und Netlify-Preview-Domains hinterlegen.
4. **Firestore → Rules** – Quelle der Wahrheit ist `firestore.rules`
   im Repo-Root. Den Inhalt 1:1 in die Firebase Console (Firestore →
   Rules) reinkopieren und **Veröffentlichen** klicken, oder via
   Firebase CLI deployen (`firebase deploy --only firestore:rules`).

   Die Datei ist bewusst kompakt gehalten und nutzt nur
   Console-kompatible Konstrukte (keine Funktions-Parameter, keine
   Pfade mit Leerzeichen). Collection-Namen mit Leerzeichen wie
   `Teams WM 2026` werden über `match /{collection}/{docId}` plus
   String-Vergleich erkannt – ein direkter Match-Pfad
   `/Teams WM 2026/...` ist in Firestore Rules **nicht** zulässig.

   Wesentliche Eigenschaften:

   - Public-Reads nur für `Teams WM 2026`, `Spiele WM 2026`,
     `Punkte Spieler WM 2026` und das Meta-Dokument
     `app_meta/turnier_wm2026`.
   - Team-Writes verlangen verifizierte E-Mail; Eigentum wird über
     `userId` **oder** `userEmailLower` erkannt (Cross-Provider).
   - Team-Schema: genau 15 Spieler, Felder als Allowlist.
   - Schreibzugriff auf Teams ist nach dem Anpfiff (2026-06-11
     19:00 UTC) gesperrt; Admin (UID
     `lSw9kxsnp8a7qb0s7UzuTQVwRAu1`) bleibt schreibberechtigt.
   - Verifizierte User dürfen `teamsVersion` im Meta-Dokument nur um
     +1 erhöhen.
   - Alle anderen Collections und Schreibzugriffe sind explizit
     verboten; Spielplan- und Punkte-Updates laufen über die Cron-
     Skripte mit Admin-SDK (umgeht Rules).

---

## 5) Testing-Checkliste (manuell)

1. Als Logged-out-Visitor `teams.html`, `rangliste.html`,
   `spieleranalyse.html` öffnen – alles muss lesbar sein.
2. `team-builder.html`: 15er-Team + Captain bauen.
3. **Team abschicken ✓** → Register-Modal.
4. E-Mail + Passwort → "Check your inbox". Pending-Payload liegt in
   `localStorage[dreamteam_<key>_pending_team]`.
5. Verifikations-Link klicken → zurück zum Tab → Team wird auto-
   gespeichert, Redirect zu `teams.html?manager=…`.
6. Page reload: Login-Chip rechts oben zeigt E-Mail. Logout testen.
7. Erneut Login → Builder lädt bestehendes Team, Button =
   **Team aktualisieren ✓**.
8. Spieler ändern + submit → Firestore-Doc wird **aktualisiert** (gleiche ID).
9. In der Firestore Console: `userId` matcht eigene Auth-UID, anonyme
   Writes werden abgelehnt.
