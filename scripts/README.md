# DreamTeam Cron-Scripts

In diesem Ordner liegen die server-seitigen Auto-Workflows, die früher
über zwei Admin-HTML-Seiten manuell im Browser ausgelöst wurden. Die
Browser-Seiten gibt es nicht mehr – die Aktionen laufen ausschliesslich
serverseitig als GitHub Actions, weil Firestore-Schreibzugriffe nicht
aus dem Browser stattfinden sollen:

| Script                  | Früheres Browser-Pendant (entfernt) | Default-Cron               |
| ----------------------- | ----------------------------------- | -------------------------- |
| `auto-points-upload.js` | `adm-upload-points.html` (entfernt) | alle 5 Minuten             |
| `sync-fixtures.js`      | `adm-sync-fixtures.html` (entfernt) | täglich 04:00 UTC (≈ 06:00 CH) |

Beide Workflows laufen vollautomatisch als GitHub-Action und benutzen
dieselben zwei Repo-Secrets (`RAPIDAPI_KEY`, `FIREBASE_SERVICE_ACCOUNT`).
Manuelle Catch-Ups oder Re-Computes werden über den **Run workflow**-
Button im Actions-Tab ausgelöst (siehe Abschnitte "Manuelles Auslösen"
weiter unten).

---

## 1) Auto Punkte-Upload (Cron)

Vollautomatischer Server-seitiger Punkte-Upload für DreamTeam.
Läuft als GitHub-Actions-Cron alle 5 Minuten und schreibt – sobald die
API neue Spieldaten liefert – die berechneten Punkte direkt in Firebase,
ohne dass jemand einen Browser-Tab geöffnet haben muss.

## Was macht der Workflow?

1. **Pre-Check (nur Firestore-Reads, KEINE API-Calls):**
   Es wird der Spielplan geladen und geprüft, ob mindestens ein Spiel im
   Trigger-Fenster (Default: 100–260 Minuten nach Anstoss) liegt, dessen
   Status in Firestore noch nicht `FT`/`AET`/`PEN` ist. Ist das nicht der
   Fall, beendet sich der Job sofort. Damit kostet jeder Cron-Tick
   ausserhalb der Spieltage praktisch nichts.

2. **Punkte-Workflow (vormals in der entfernten Seite `adm-upload-points.html`):**
   - Lädt alle Fixtures vom `api-football`-Endpunkt.
   - Holt Detail-Stats für jedes als beendet gemeldete Spiel.
   - Wendet die zentralen Punkteregeln aus `tournament-config.js` an
     (inkl. Positions-Overrides aus `position-overrides.js`).
   - Schreibt die aktualisierten Spieler-Dokumente (`Punkte Spieler …`)
     per Batch.
   - Aktualisiert Status/Resultat im Spielplan-Dokument, damit das gerade
     verarbeitete Spiel beim nächsten Tick **nicht erneut** zu einem
     API-Call führt (Quota-Schutz).
   - Erhöht `pointsVersion` und setzt `pointsUpdatedAt` im Meta-Dokument
     – **erst dann**, wenn wirklich Punkte geschrieben wurden. Genau
     dieses Feld liest `rangliste.html` für die "Zuletzt aktualisiert"-
     Anzeige; sie wird also exakt dann frisch, wenn ein neues Spiel in
     Firestore ist.

## Einmalige Einrichtung

### 1. Repo-Secrets anlegen

`Settings → Secrets and variables → Actions → "New repository secret"`:

| Name                       | Inhalt                                                  |
| -------------------------- | ------------------------------------------------------- |
| `RAPIDAPI_KEY`             | Dein RapidAPI / api-football Key.                       |
| `FIREBASE_SERVICE_ACCOUNT` | Inhalt einer Firebase-Service-Account-JSON als String.  |

#### Service-Account-JSON erzeugen

1. [Firebase Console](https://console.firebase.google.com/) → Projekt
   `dreamteam-d2121` → Zahnrad → **Project settings** → Reiter
   **Service accounts**.
2. Button **Generate new private key** → JSON-Datei herunterladen.
3. Den **kompletten JSON-Inhalt** (inkl. `\n` im `private_key`) in das
   GitHub-Secret `FIREBASE_SERVICE_ACCOUNT` einfügen. Nicht Base64-en­ko­dieren,
   nicht trimmen – die Datei 1:1 reinkopieren.

> Der Service Account braucht die Standard-Rolle "Firebase Admin SDK
> Administrator Service Agent", die beim Anlegen automatisch gesetzt wird.
> Damit darf das Skript in alle Collections des Projekts schreiben.

### 2. Optionale Repo-Variables

`Settings → Secrets and variables → Actions → Tab "Variables"`:

| Name                            | Default | Bedeutung                                                                                       |
| ------------------------------- | ------- | ----------------------------------------------------------------------------------------------- |
| `AUTO_UPLOAD_TOURNAMENT_KEY`    | `wm2026`| Aktuell ist nur `wm2026` produktiv konfiguriert. Andere Keys lassen das Skript mit einer klaren Fehlermeldung abbrechen, damit Fehlkonfigurationen sofort auffallen. |
| `AUTO_UPLOAD_WINDOW_START_MIN`  | `100`   | Frühestens X Minuten nach Anstoss als "fertig" einplanen (≈ Ende regulärer Spielzeit).          |
| `AUTO_UPLOAD_WINDOW_END_MIN`    | `260`   | Spätester Trigger nach Anstoss (deckt Verlängerung/Elfmeterschiessen + mehrere Polls ab).      |

Für die WM 2026 sind die Defaults sinnvoll. Sobald ein neues Turnier
ergänzt werden soll, muss es zuerst in `tournament-config.js` als
`available: true && dataReady: true` aktiviert und in beiden
Cron-Scripts (`auto-points-upload.js`, `sync-fixtures.js`) in der
internen `TOURNAMENTS`-Map ergänzt werden – erst dann darf
`AUTO_UPLOAD_TOURNAMENT_KEY` auf den neuen Key zeigen.

## Manuelles Auslösen

Im Tab **Actions** → Workflow **Auto Punkte-Upload** → Button
**Run workflow**. Optional kann man:

- `tournament_key` setzen (überschreibt das Default-Turnier).
- `force_run` aktivieren – überspringt den Pre-Check und führt einen
  vollständigen Recompute aus (entspricht dem früheren manuellen Button
  auf der entfernten Seite `adm-upload-points.html`).
- `dry_run` aktivieren – Skript loggt nur, schreibt nichts in Firestore.

## Lokal testen (optional)

```bash
cd scripts
npm install

export RAPIDAPI_KEY="…"
export FIREBASE_SERVICE_ACCOUNT="$(cat ~/Downloads/dreamteam-d2121-xxx.json)"
export TOURNAMENT_KEY="wm2026"
export DRY_RUN=1

npm run auto-upload
```

Mit `DRY_RUN=1` wird nichts in Firestore geschrieben, der gesamte
Workflow inklusive API-Calls läuft aber bis zum Ende. Mit `FORCE_RUN=1`
kann man den Pre-Check überspringen, um z.B. einen kompletten
Catch-Up-Lauf zu erzwingen (verbraucht entsprechend mehr API-Quota).

## Was ist mit der früheren Seite `adm-upload-points.html` passiert?

- Die Seite wurde entfernt, weil produktive Firestore-Schreibzugriffe
  nicht aus dem Browser kommen sollen (Security: Service-Account-
  Berechtigungen gehören nicht in clientseitigen Code).
- Manuelle Catch-Ups bzw. Re-Computes laufen jetzt über
  **Actions → Auto Punkte-Upload → Run workflow** (siehe oben). Mit
  `force_run = true` erzwingt man einen kompletten Recompute, identisch
  zum früheren manuellen Button.

---

## 2) Auto Spielplan-Sync (Cron)

Vollautomatischer Server-seitiger Spielplan-Import für DreamTeam.
Läuft als GitHub-Actions-Cron **einmal pro Tag** und schreibt alle
Fixtures + Stadiondaten des aktiven Turniers nach Firebase. Sobald
die API z.B. die Finalrunden-Paarungen (Achtel-, Viertel-, Halbfinale,
Final) veröffentlicht, sind sie ohne weiteres Zutun in der App
sichtbar.

### Was macht der Workflow?

1. Lädt alle Fixtures via api-football für die konfigurierte
   Competition + Season (Zeitzone Europe/Zurich, identisch zum
   Browser-Skript).
2. Sammelt alle eindeutigen Venue-IDs und holt jede Venue genau
   einmal (kein Quota-Verschwender, neue Stadien werden automatisch
   nachgeladen).
3. Schreibt pro Spiel ein Firestore-Dokument in `fixturesCollection`
   (z.B. `Spiele WM 2026`) im etablierten Spielplan-Schema (gleiche
   Felder/Keys wie zuvor in der entfernten Seite `adm-sync-fixtures.html`).
4. Erhöht `fixturesVersion` und setzt `fixturesUpdatedAt` im
   Meta-Dokument – das ist das Signal, mit dem `index.html` &
   `rangliste.html` ihren Cache invalidieren.

### Repo-Secrets

Es werden dieselben zwei Secrets wie für den Auto-Punkte-Upload
verwendet – einmal anlegen reicht für beide Workflows:

| Name                       | Inhalt                                                 |
| -------------------------- | ------------------------------------------------------ |
| `RAPIDAPI_KEY`             | Dein RapidAPI / api-football Key.                      |
| `FIREBASE_SERVICE_ACCOUNT` | Inhalt einer Firebase-Service-Account-JSON als String. |

### Optionale Repo-Variables

`Settings → Secrets and variables → Actions → Tab "Variables"`:

| Name                           | Default  | Bedeutung                                                            |
| ------------------------------ | -------- | -------------------------------------------------------------------- |
| `FIXTURES_SYNC_TOURNAMENT_KEY` | `wm2026` | Aktuell ist nur `wm2026` produktiv konfiguriert. Andere Keys lassen das Skript mit einer klaren Fehlermeldung abbrechen. |

### Manuelles Auslösen

Im Tab **Actions** → Workflow **Auto Spielplan-Sync** → Button
**Run workflow**. Optional kann man:

- `tournament_key` setzen (überschreibt das Default-Turnier).
- `dry_run` aktivieren – Skript loggt nur, schreibt nichts in Firestore.
- `skip_venues` aktivieren – überspringt die Venue-Detail-Calls (spart
  Quota, wenn sich an den Stadien nichts ändert).

### Lokal testen (optional)

```bash
cd scripts
npm install

export RAPIDAPI_KEY="…"
export FIREBASE_SERVICE_ACCOUNT="$(cat ~/Downloads/dreamteam-d2121-xxx.json)"
export TOURNAMENT_KEY="wm2026"
export DRY_RUN=1

npm run sync-fixtures
```

### Was ist mit der früheren Seite `adm-sync-fixtures.html` passiert?

- Die Seite wurde entfernt – aus denselben Sicherheitsgründen wie
  `adm-upload-points.html` (keine Firestore-Schreibzugriffe aus dem
  Browser).
- Der tägliche Cron-Workflow sorgt automatisch dafür, dass z.B. die
  Finalrunden-Spiele in Firebase landen, sobald die API sie kennt.
- Ad-hoc-Refreshes laufen über **Actions → Auto Spielplan-Sync → Run
  workflow** (siehe oben).
