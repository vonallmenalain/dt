# Auto Punkte-Upload (Cron)

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

2. **Punkte-Workflow (analog zur Seite `adm-upload-points.html`):**
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
| `AUTO_UPLOAD_TOURNAMENT_KEY`    | `wm2026`| Welcher Turnier-Key aus `tournament-config.js` automatisiert werden soll.                       |
| `AUTO_UPLOAD_WINDOW_START_MIN`  | `100`   | Frühestens X Minuten nach Anstoss als "fertig" einplanen (≈ Ende regulärer Spielzeit).          |
| `AUTO_UPLOAD_WINDOW_END_MIN`    | `260`   | Spätester Trigger nach Anstoss (deckt Verlängerung/Elfmeterschiessen + mehrere Polls ab).      |

Für die WM 2026 sind die Defaults sinnvoll. Wenn du z.B. EM 2024
nachträglich noch automatisieren wolltest, einfach
`AUTO_UPLOAD_TOURNAMENT_KEY=em2024` setzen.

## Manuelles Auslösen

Im Tab **Actions** → Workflow **Auto Punkte-Upload** → Button
**Run workflow**. Optional kann man:

- `tournament_key` setzen (überschreibt das Default-Turnier).
- `force_run` aktivieren – überspringt den Pre-Check und führt einen
  vollständigen Recompute aus (analog zum manuellen Button auf
  `adm-upload-points.html`).
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

## Verhältnis zur Seite `adm-upload-points.html`

- Der manuelle Button auf `adm-upload-points.html` bleibt **unverändert
  funktionsfähig** und macht exakt denselben Upload (gleiche Punkte­regeln,
  gleiche Firestore-Targets). Sinnvoll für einmalige Catch-Ups oder zum
  Re-Computen nach manuellen Daten-Korrekturen.
- Die frühere Browser-Auto-Modus-Box wurde entfernt – diese Aufgabe
  übernimmt jetzt vollständig dieser Cron-Workflow.
