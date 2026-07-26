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

### Captain

Die **WM 2026** hat einen Captain, dessen Punkte doppelt zählen (×2). Die
**Champions League hat keinen Captain** – dort setzt der Turnier-Block
`captainEnabled: false`, und das schaltet Captain-Wahl, „C"-Badge und
Verdopplung überall ab (Team-Builder, Rangliste, Teams, Punktesystem-Seite;
gespeicherte `isCaptain`-Flags aus Alt-Teams werden beim Rendern verworfen).
Ein turnier-eigener Multiplikator wird bewusst **nicht** konfiguriert: das
Flag ist die einzige Quelle. `APP_CONFIG.captainMultiplier` liefert daraus
abgeleitet 2 (Captain an) bzw. 1 (Captain aus).

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
| `auto-points-upload.js` | Punkte berechnen + nach Firestore schreiben, Meta-Version hochzählen.     | alle 5 Minuten im WM-Fenster  |
| `sync-fixtures.js`      | Fixtures + Venues von api-football laden + nach Firestore schreiben.      | täglich 04:00 UTC (≈ 06:00 CH)|
| `generate-kader.js`     | `data-<key>.js` aus den Wettbewerbs-Einsätzen einer Saison erzeugen.      | manuell                       |
| `generate-cl-pool.js`   | `data-<key>.js` einer CL-Saison **vor** der Auslosung erzeugen.           | manuell                       |

Beide Scripts lesen die Turnier-Konfiguration **direkt aus
`tournament-config.js`** – keine lokale Kopie pflegen.

**Turnier-Scope: nur Spiele ab Turnierstart.** Bei Ligaphasen-Turnieren
(Champions League) liefert api-football unter derselben Liga-/Saison-Abfrage
auch die Qualifikationsrunden *vor* der Ligaphase mit. Die gehören nicht zum
Turnier, das die App wertet, und werden in beiden Scripts verworfen – der
Spielplan-Sync löscht bereits gespeicherte Qualifikationsspiele zusätzlich aus
Firestore (Opt-out: `skip_purge`). Massgeblich ist der Runden-Text; die
Klassifikation liegt zentral in `tournament-config.js`
(`isQualificationFixtureFor` / `leagueKnockoutRoundKey`). Referenz CL 2025/26:
281 API-Spiele → **189 ab Ligaphase** (144 Ligaphase + 16 K.-o.-Playoffs
("Round of 32") + 16 Achtel + 8 Viertel + 4 Halb + 1 Final), 92 Qualifikations-
spiele fallen weg. Turniere mit Gruppenphase (WM) sind nicht betroffen.
Regressionstest: `npm run test:cl-scope`.

Der detaillierte Live-Update-Ablauf inkl. GitHub-Actions-Check,
Tick-Zeitpunkt, Firestore-Signalen und Betriebs-Checkliste steht in
[`docs/live-update-prozess.md`](docs/live-update-prozess.md).

### Kader erzeugen: zwei Wege

Beide schreiben dieselbe Datei (`data-<key>.js`, globales `playersData`)
im selben club-zentrierten Schema – sie unterscheiden sich nur in der
Datenquelle:

| Situation                                        | Script                | Quelle                                                     |
| ------------------------------------------------ | --------------------- | ---------------------------------------------------------- |
| Saison läuft oder ist abgeschlossen               | `generate-kader.js`   | `/players?league=<comp>&season=<saison>` (gespielte Einsätze)|
| Saison hat noch nicht begonnen, Auslosung fehlt   | `generate-cl-pool.js` | qualifizierte Klubs → `/players/squads` → `/players/profiles`|

**Warum zwei Scripts.** `generate-kader.js` liest Spieler mit Einsätzen im
Wettbewerb. Für eine abgeschlossene Saison (CL 2025/26) ist das ideal, vor
Saisonstart liefert es nichts. `generate-cl-pool.js` dreht die Richtung um
und geht über die Klubs:

1. Abschlusstabellen aller nationalen UEFA-Ligen der Vorsaison lesen. An
   den Tabellenzeilen hängt eine `description` („Promotion - Champions
   League (League phase)" vs. „… (Qualification)") – daraus ergibt sich,
   wer **direkt** in der Ligaphase steht und wer nur in die Qualifikation
   geht. Nur Erstere zählen zum Vorschau-Pool.
2. Titelverteidiger ergänzen (CL- und Europa-League-Sieger der Vorsaison,
   ermittelt aus dem jeweiligen Endspiel).
3. Aktuellen Kader je Klub laden und je Spieler das Profil holen.

**Frauen-Wettbewerbe.** api-football führt die Frauenligen unter denselben
Ländern und hängt an deren Tabellen ebenfalls „Champions League"-
Beschreibungen. Ohne Filter landeten im ersten Lauf 13 Frauenteams im Pool
(Arsenal W, Bayern Munich W, …). `isWomensEntry` sortiert sie über drei
unabhängige Netze aus (Ligaame, Beschreibung, api-football-Teamsuffix
„ W") und protokolliert jede Aussortierung.

**Namenslogik ist geteilt, nicht kopiert.** `buildRecord`,
`playerDisplayName`, `resolveNationFlag`, `mapPosition` und die Sortierung
importiert `generate-cl-pool.js` aus `generate-kader.js`. Ein Spieler, der
schon in `data-cl2526.js` steht, erscheint deshalb im neuen Pool mit
identischem Namen und identischem Schema.

**Spieler ohne Stammdaten.** Für einen Teil der gemeldeten Kaderspieler
(meist Nachwuchs) führt api-football kein Profil: abgekürzter Name, keine
Nationalität, kein Geburtsdatum. `data-cl2526.js` enthält solche Einträge
ebenfalls (70 von 1131), deshalb bleiben sie per Default drin – der Lauf
listet sie aber vollständig im Log auf. Wer sie draussen haben will,
setzt den Workflow-Input `skip_incomplete`.

**Nachvollziehbarkeit.** Neben der Kaderdatei entsteht
`scripts/cl-pool-<key>-clubs.json` mit der Herleitung je Klub (Liga, Rang,
API-Beschreibung). Korrekturen von Hand gehen über
`scripts/cl-pool-<key>-clubs.manual.json` (`{ "add": [...], "remove": [...] }`),
ohne das Script anzufassen.

Auslösen: **Actions → „CL Vorschau-Spielerpool" → Run workflow**. Erst mit
`probe: true` laufen lassen – der Lauf kostet dann nur die Tabellen-Calls
und loggt die erkannten Klubs, ohne Kaderdaten zu ziehen oder Dateien zu
schreiben.

### Pre-Check / Live-Load (auto-points-upload)

Ein Cron-Tick lädt zunächst nur den Spielplan aus Firestore und prüft,
ob ein Spiel im Live-/Catch-up-Fenster (Default: 30 Minuten vor bis
150 Minuten nach Anstoss) liegt, dessen Status noch nicht `FT`/`AET`/`PEN`
ist, oder ob ein beendetes Spiel noch im Final-Recheck-Fenster liegt
(Default: 240 Minuten nach Anpfiff). Ist das nicht der Fall, beendet sich
der Job sofort. Damit kostet ein Tick ausserhalb der Spieltage praktisch
nichts (1 Firestore-Read, 0 API-Calls).

Während eines aktiven Fensters macht das Script standardmässig eine
längere Monitor-Session mit 520 Live-Ticks im Abstand von 30 Sekunden innerhalb
desselben GitHub-Runs. Wenn GitHub den Schedule zu früh startet, aber
das nächste Live-Fenster bald beginnt und danach noch genug Restzeit fuer
das eigentliche Live-Fenster plus Puffer bleibt, wartet der Run ohne API-Calls
darauf. Dadurch hängt das Live-Scoring nicht mehr davon ab, dass GitHub
den Cron wirklich alle 5 Minuten ausführt. Laufende und
Final-Recheck-Kandidaten werden als Delta auf bestehende Punktedokumente
geschrieben; sobald ein Kandidat neu final wird oder `FORCE_RUN=1`
genutzt wird, erfolgt eine vollständige Neuberechnung.
Beendete Spiele bleiben im Final-Recheck-Fenster Kandidaten, damit
nachträgliche API-Korrekturen an Scorern, Assists, Karten oder Resultat
automatisch im nächsten Tick nachgezogen werden. Unveränderte
Punkte-/Fixture-Dokumente werden übersprungen, damit `pointsVersion` und
`fixturesVersion` nur bei echten Änderungen steigen.

API-Football-Requests werden bei transienten Netzwerk-/HTTP-Fehlern
standardmässig bis zu dreimal versucht. Damit bricht ein Live-Lauf nicht
wegen eines einzelnen 429/5xx oder kurzen Netzwerkfehlers komplett ab.

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

#### Repo-Variables

Die Workflows lesen bewusst keine Repository Variables mehr. Produktive
Defaults liegen nur im Code, damit GitHub Actions und lokale Skripte nicht
auseinanderlaufen:

| Wert                       | Default                            | Quelle                                                          |
| -------------------------- | ---------------------------------- | --------------------------------------------------------------- |
| Turnier                    | `wm2026`                           | `tournament-config.js`                                          |
| Auto-Punkte Startfenster   | `-30` Minuten                      | `scripts/auto-points-upload.js`                                 |
| Auto-Punkte normales Ende  | `150` Minuten                      | `scripts/auto-points-upload.js`                                 |
| Final-Recheck              | `240` Minuten                      | `scripts/auto-points-upload.js`                                 |
| Live-Ticks pro Run         | `520`                              | `scripts/auto-points-upload.js`                                 |
| Live-Tick-Intervall        | `30` Sekunden                      | `scripts/auto-points-upload.js`                                 |
| Idle-Wait                  | `240` Minuten                      | `scripts/auto-points-upload.js`                                 |
| Session-Max                | `350` Minuten                      | `scripts/auto-points-upload.js`                                 |
| API-Retry-Versuche         | `3`                                | `scripts/auto-points-upload.js`                                 |
| API-Retry-Basis-Backoff    | `1000` ms                          | `scripts/auto-points-upload.js`                                 |

In `Settings → Secrets and variables → Actions → Variables` sollten deshalb
keine `POINTS_*`-Variables und kein `TOURNAMENT_KEY` gesetzt sein.

### Manuelles Auslösen

Tab **Actions** → Workflow auswählen → **Run workflow**.

Beim Workflow `Auto Punkte-Upload` gibt es nur noch einen Input:

- `force_run` aus: normalen Live-Monitor/Scheduled Run manuell starten,
  zum Beispiel wenn ein laufender Schedule abgebrochen ist.
- `force_run` an: Pre-Check überspringen und kompletten Catch-up/Recompute
  erzwingen.

Beim Workflow `Auto Spielplan-Sync` gibt es weiterhin Test-Inputs:

- `tournament_key` – überschreibt das Default-Turnier.
- `dry_run` – Skript loggt nur, schreibt nichts in Firestore.
- `skip_venues` – Venue-Detail-Calls auslassen (spart API-Quota, wenn sich
  an den Stadien nichts ändert).
- `skip_purge` – bereits gespeicherte Spiele *vor* Turnierstart nicht löschen
  (normalerweise aus: der Sync räumt Qualifikationsspiele aus Firestore weg).

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

### Regressionstests

Die Tests laufen ohne Browser, Firebase und API-Key (reine Node-Module +
Quelltext-Checks):

```bash
cd scripts
npm test                 # alle Suites nacheinander
npm run test:freeze      # einzelne Suite, siehe scripts/package.json
```

`test:cl2627-pool` prüft die erzeugte `data-cl2627.js` gegen
`data-cl2526.js`: gleiches Schema, gültige Positionen, eindeutige
`player.id`, deterministische Sortierung – und vor allem, dass jeder in
beiden Turnieren vorkommende Spieler **denselben Anzeigenamen** trägt.
Weil der 26/27-Pool über einen anderen API-Weg entsteht, ist genau das der
Punkt, an dem eine Abweichung sonst unbemerkt durchrutschen würde.

`test:freeze` ist der **WM-2026-Freeze-Guard**: Punktesystem, Regel-Labels
und die Captain-Verdopplung (×2) der WM sind eingefroren und dürfen sich
durch Änderungen an anderen Turnieren nicht mitverändern. Er zählt die
Verdopplung über alle View-Dateien zusammen, damit ein blosser Umzug von
Code zwischen den Dateien nicht ausschlägt – ein Entfernen oder Ändern
dagegen schon.

`test:cl-team-writes` bewacht die CL-Ansicht an zwei Stellen, die nur
zusammen funktionieren: die **Benennung** (beide CL-Turniere heissen
überall „Champions League DreamTeam" + Saison-Zusatz, nie „CL 26/27") und
die **Team-Writes** in `firestore.rules`. Fehlt dort der `create`/`update`/
`delete`-Zweig für die Team-Collection eines CL-Turniers, scheitert jede
Einreichung mit `permission-denied` – im Builder sichtbar als „Fehler beim
Speichern. Bitte Verbindung prüfen." Zusätzlich prüft er, dass die
Deadline-Konstante in den Rules zu `cl2627.DREAMTEAM_START` passt (der Wert
steht zwangsläufig doppelt).

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

### Testteam-Modus (nur Admin)

Für Tests, die mehr als ein Team brauchen (Rangliste, Sortierung,
Punkteverteilung), gibt es im Profil-Dropdown unter **Dev → Team-
Einreichung → „Testteams (mehrere)"** einen Schalter. Ist er an:

* startet der Builder leer, statt das bestehende Team des Accounts zu
  laden,
* legt **jede** Einreichung ein neues Doc an (`saveOrUpdateTeam(payload,
  { forceCreate: true })` – der Anti-Duplikat-Schutz greift dann nicht),
* bleibt man nach dem Speichern im Builder stehen: Manager-Namen ändern
  und das nächste Testteam abschicken, ohne die Aufstellung neu zu bauen.
  Der Name muss weiterhin eindeutig sein (Duplikat-Prüfung bleibt aktiv).

Der Schalter ist pro Turnier in `localStorage` gemerkt
(`<storagePrefix>_admin_test_team_mode`) und nur für Admin-UIDs sichtbar
(`admin.js`). Der Admin-Check steckt zusätzlich in `saveOrUpdateTeam`,
damit ein manipulierter localStorage-Wert bei normalen Accounts nichts
bewirkt. Ausschalten lädt wieder das bestehende Team zum Bearbeiten.

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
DreamTeamAuth.saveOrUpdateTeam(payload, opts?);// create-or-update
                                               // opts.forceCreate: immer neu (nur Admin)
DreamTeamAuth.isAdminUser();                   // Admin-Account angemeldet?
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
     `app_meta/turnier_wm2026` – dazu die beiden CL-Pendants
     (`Teams CL 2025-26 Test` / `Teams CL 2026-27` samt Spielen, Punkten
     und Meta-Dokumenten).
   - Team-Writes gibt es für `Teams WM 2026`, `Teams CL 2025-26 Test`
     (Test-Turnier, ohne Zeit-Gate) und `Teams CL 2026-27`. Bei der CL
     2026/27 sind **neue** Teams und Löschungen bis zum ersten
     Ligaphasen-Spiel (2026-09-08 19:00 UTC) erlaubt, **Updates**
     dauerhaft – sonst liesse sich das Transferfenster während der Saison
     nicht nutzen.
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
