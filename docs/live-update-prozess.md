# Live-Update-Prozess und Betriebscheck

Stand des Checks: 2026-06-13. Zeiten in GitHub Actions sind UTC; App- und
Turnierzeiten sind fuer die WM 2026 auf `Europe/Zurich` ausgelegt.

## Kurzfazit

Der Live-Update-Prozess ist korrekt verdrahtet, aber der Check vom
2026-06-13 hat gezeigt: GitHub Scheduled Runs kamen in der Nacht nicht
zuverlaessig alle 5 Minuten durch. Der Punkte-Upload darf deshalb nicht
darauf angewiesen sein, dass nach einem kurzen 5-Minuten-Live-Run sofort
der naechste Scheduled Run startet.

- Repo `vonallmenalain/dt`, Default-Branch `main`, GitHub Actions aktiviert.
- Workflows `Auto Punkte-Upload` und `Auto Spielplan-Sync` sind aktiv.
- Actions-Permissions: `enabled=true`, `allowed_actions=all`.
- Secrets vorhanden: `RAPIDAPI_KEY`, `FIREBASE_SERVICE_ACCOUNT`.
- Repo-Variables vorhanden: `TOURNAMENT_KEY=wm2026`,
  `POINTS_WINDOW_START_MIN=-10`, `POINTS_WINDOW_END_MIN=150`,
  `POINTS_FINAL_RECHECK_MIN=360`. Alte kleinere Live-Overrides wie
  `POINTS_LIVE_TICKS_PER_RUN=30` oder
  `POINTS_LIVE_TICK_INTERVAL_SEC=10` werden bei Scheduled Runs defensiv
  auf mindestens 240 Ticks und 60 Sekunden Abstand gehoben.
- Nicht gesetzte optionale Variables sind kein Problem; das Script nutzt
  Defaults: `POINTS_IDLE_WAIT_MAX_MIN=240`, `POINTS_SESSION_MAX_MIN=330`,
  `POINTS_API_RETRY_ATTEMPTS=3`,
  `POINTS_API_RETRY_BASE_DELAY_MS=1000`.

Incident-Check `USA vs Paraguay`, Anpfiff 2026-06-13 03:00 CH-Zeit:

- Run `27441377588` wartete bis 2026-06-13 00:50 UTC und lief nur bis
  00:55 UTC, also nur bis 5 Minuten vor Anpfiff.
- Run `27449508200` lief von 00:55 bis 01:01 UTC und sah das Spiel noch
  als `NS`.
- Run `27453089793` lief von 01:53 bis 01:58 UTC, schrieb `HT`/45.
  Minute und den Zwischenstand, beendete sich dann nach 30 Ticks.
- Danach kam bis zum manuellen `FORCE_RUN` `27456733186` um 04:37 UTC
  kein weiterer Scheduled Run durch. Der manuelle Run sah 4 beendete
  Spiele und schrieb den finalen Stand sofort.

Ursache: Der Browser-Live-Listener war nicht der Engpass. Das serverseitige
Monitoring war zu kurz fuer unzuverlaessige Scheduled-Run-Takte. Fix:
Scheduled Runs laufen jetzt mit einer langen, final-first Session, damit
ein einzelner durchkommender GitHub-Lauf ein laufendes Spiel bis nach
Abpfiff tragen kann.

Weitere gepruefte Runs:

- `Auto Punkte-Upload`, Run `27383142943`, 2026-06-11 23:07 UTC:
  erfolgreich, damalige 30/10-Konfiguration, ein Final-Recheck-Kandidat
  (`Mexico vs South Africa`).
- `Auto Spielplan-Sync`, Run `27404668725`, 2026-06-12 08:37 UTC:
  erfolgreich, 72 Fixtures geladen und nach Firestore geschrieben,
  `fixturesVersion` erhoeht.

Firestore-Snapshot beim Check:

- Meta-Dokument: `app_meta/turnier_wm2026`.
- `teamsVersion=183`, `pointsVersion=8`, `fixturesVersion=83`.
- `pointsUpdatedAt=2026-06-12 06:51:01` CH-Zeit.
- `fixturesUpdatedAt=2026-06-12 10:37:59` CH-Zeit.
- Collections vorhanden und lesbar: `Teams WM 2026`,
  `Punkte Spieler WM 2026`, `Spiele WM 2026`.
- Eroeffnungsspiel-Fixture `1489369`: `Mexico vs South Africa`, Status `FT`.

## Beteiligte Dateien

- `.github/workflows/auto-points-upload.yml`: GitHub Action fuer Punkte.
- `.github/workflows/sync-fixtures.yml`: GitHub Action fuer Spielplan.
- `scripts/auto-points-upload.js`: Server-Logik fuer Punkte, Live-Ticks,
  Pre-Check, API-Retries, Firestore-Writes.
- `scripts/sync-fixtures.js`: Server-Logik fuer Fixtures und Venues.
- `tournament-config.js`: einzige Quelle fuer Turnier, API-Werte,
  Collections und Auto-Punkte-Phase.
- `cache.js`: Browser-Cache und Firestore-Meta-Listener.
- `rangliste.html`: konsumiert Cache/Meta und zeigt Live-/Last-Update-Status.

## GitHub-Zeitplan

### Auto Punkte-Upload

Workflow: `.github/workflows/auto-points-upload.yml`

Cron:

```yaml
- cron: "*/5 * 11-30 6 *"
- cron: "*/5 * 1-21 7 *"
```

Das bedeutet: alle 5 Minuten auf GitHub-Actions-Zeitbasis UTC, aber nur
vom 11. bis 30. Juni 2026 und vom 1. bis 21. Juli 2026. GitHub kann
scheduled workflows verzoegern oder einzelne Takte auslassen; der Code ist
deshalb so gebaut, dass ein Run auf das naechste Live-Fenster warten,
ein laufendes Spiel lange monitoren und verpasste offene Spiele per
Catch-up nachziehen kann.

Job-Eckdaten:

- `runs-on: ubuntu-latest`
- Node.js `20`
- `timeout-minutes: 360`
- `concurrency.cancel-in-progress: false`

`cancel-in-progress: false` ist bewusst: ein wartender oder laufender
Live-Run wird nicht automatisch abgebrochen, wenn GitHub einen weiteren
Schedule-Run startet. Damit kann ein einzelner aktiver Run ein Spiel bis
nach Abpfiff begleiten.

### Auto Spielplan-Sync

Workflow: `.github/workflows/sync-fixtures.yml`

Cron:

```yaml
- cron: "0 4 * * *"
```

Das laeuft taeglich um 04:00 UTC, also waehrend der Sommerzeit etwa
06:00 Uhr in der Schweiz. Der Sync aktualisiert die Fixtures und erhoeht
bei erfolgreichen Writes `fixturesVersion`.

## Wann starten die Ticks?

Es gibt zwei verschiedene "Ticks":

1. GitHub-Cron-Tick: GitHub soll den Workflow etwa alle 5 Minuten im
   WM-Cron-Fenster starten. Das ist ein Trigger-Versuch, keine harte
   Verfuegbarkeitsgarantie.
2. Live-Tick im Script: innerhalb eines `Auto Punkte-Upload`-Runs fuehrt
   `scripts/auto-points-upload.js` bei Scheduled Runs mindestens 240
   interne Ticks aus, mit mindestens 60 Sekunden Abstand.

Der interne Tick 1 startet nach Checkout, Node-Setup, `npm install` und
Script-Start. Danach passiert im Script:

1. Turnier-Key aufloesen (`TOURNAMENT_KEY`, sonst Default `wm2026`).
2. Guard pruefen: ohne `FORCE_RUN` arbeitet das Script nur zwischen
   `AUTO_POINTS_FROM=2026-06-11T20:50:00+02:00` und
   `AUTO_POINTS_UNTIL=2026-07-21T08:00:00+02:00`.
3. Firebase Admin initialisieren.
4. `Live-Tick 1/240` loggen (oder mehr, falls hoeher konfiguriert).
5. Spielplan aus `Spiele WM 2026` lesen und Kandidaten bestimmen.

Mit den aktuellen Einstellungen oeffnet das Live-Fenster pro Spiel 10
Minuten vor Anpfiff:

```text
candidate_start = kickoff - 10 Minuten
normal_window_end = kickoff + 150 Minuten
final_recheck_end = kickoff + 360 Minuten
```

Ein Spiel ist Kandidat, wenn:

- es mindestens im Startfenster liegt, also `now >= kickoff - 10min`, und
- es in Firestore noch nicht `FT`, `AET` oder `PEN` ist, oder
- es bereits final ist, aber noch innerhalb des Final-Recheck-Fensters
  liegt.

Wichtig: Fuer offene Spiele gibt es nach `POINTS_WINDOW_END_MIN` keine
harte Abschaltung. Wenn ein Spiel wegen API-/Netzwerkproblemen oder
GitHub-Verzoegerung verpasst wurde, bleibt es Catch-up-Kandidat, bis der
Finalstatus erfolgreich nach Firestore geschrieben wurde.

Wenn ein Tick keine Kandidaten findet, aber das naechste Live-Fenster
innerhalb von `POINTS_IDLE_WAIT_MAX_MIN=240` Minuten liegt und die
Session noch genug Zeit hat, wartet der Run ohne API-Call bis zum
Fensterstart. Sobald ein offenes Spiel Kandidat ist, bleibt der Scheduled
Run lange genug aktiv, um den finalen Status in normalen Faellen selbst
zu sehen, statt nach 5 Minuten auf einen weiteren GitHub-Schedule-Takt
angewiesen zu sein.

## Ablauf Auto Punkte-Upload

1. GitHub startet den Workflow per Cron oder `workflow_dispatch`.
2. Workflow setzt Env aus Secrets, Variables und manuellen Inputs.
3. Script prueft Turnier, API-Konfiguration und Auto-Punkte-Phase.
4. Pre-Check liest nur `Spiele WM 2026` aus Firestore.
5. Ohne Kandidat: kein API-Call, keine Writes, Exit 0.
6. Mit Kandidat: API-Football Fixture-Liste und Fixture-Details laden.
7. Punkte berechnen:
   - laufende und Final-Recheck-Spiele als Delta/Reconciliation,
   - bei neu finalen Spielen oder `FORCE_RUN=1` volle Neuberechnung.
8. Punkte in `Punkte Spieler WM 2026` schreiben; unveraenderte Dokumente
   werden uebersprungen.
9. Fixture-Status/Resultat in `Spiele WM 2026` aktualisieren.
10. Nur bei echten Aenderungen:
    - `pointsVersion` und `pointsUpdatedAt` im Meta-Dokument erhoehen,
    - `fixturesVersion` und `fixturesUpdatedAt` erhoehen, wenn Fixture-
      Daten geaendert wurden.
11. Relevante Ticks werden in `Admin Auto Points Logs WM 2026`
    protokolliert.

## Ablauf Spielplan-Sync

1. GitHub startet den Workflow taeglich um 04:00 UTC oder manuell.
2. Script laedt alle Fixtures von API-Football mit
   `league=1&season=2026&timezone=Europe/Zurich`.
3. Venue-IDs werden dedupliziert und einmalig abgefragt, ausser
   `SKIP_VENUES=1`.
4. Pro Spiel wird ein Firestore-Dokument fuer `Spiele WM 2026` gebaut.
5. Writes erfolgen in Batches nach Firestore.
6. Bei erfolgreichen Writes wird `fixturesVersion` im Meta-Dokument
   erhoeht. Dadurch laden offene Browser die Fixtures neu.

## Browser-Live-Update

Der Browser pollt nicht laufend alle Punkte. Er beobachtet das Meta-
Dokument:

```text
app_meta/turnier_wm2026
```

`DreamTeamCache.bootstrap()` in `cache.js` haengt einen Firestore
`onSnapshot`-Listener an dieses Dokument. Wenn dort eine Version steigt,
entscheidet der Cache anhand der Meta-Felder, was neu geladen werden muss:

- `teamsVersion` -> `Teams WM 2026`
- `pointsVersion` -> `Punkte Spieler WM 2026`
- `fixturesVersion` -> `Spiele WM 2026`

`rangliste.html` rendert danach mit den frischen Daten neu und aktualisiert
auch die Anzeige "Spielpunkte aktualisiert", "Live Punkte-Update",
"Anpfiff erreicht" oder "Naechstes Spiel".

Damit Live-Update funktioniert, muss also nicht ein Browser oder eine
Admin-Seite offen sein. Entscheidend ist, dass der GitHub-Workflow schreibt
und das Meta-Dokument die passende Version erhoeht.

## Notwendige Voraussetzungen

GitHub:

- Actions im Repo aktiviert.
- Workflows liegen auf dem Default-Branch `main`.
- Workflows sind nicht deaktiviert.
- Secrets `RAPIDAPI_KEY` und `FIREBASE_SERVICE_ACCOUNT` existieren und
  sind gueltig.
- `TOURNAMENT_KEY` ist leer oder `wm2026`.
- Optional gesetzte Variables muessen numerisch gueltig sein.

API-Football:

- RapidAPI-Key ist aktiv.
- Genug API-Quota fuer Fixture-Liste und Detail-Calls.
- `tournament-config.js` hat die richtige API-Konfiguration:
  `competitionParam=league`, `competitionId=1`, `season=2026`.

Firestore:

- Service Account hat Schreibrechte auf das Firebase-Projekt
  `dreamteam-d2121`.
- Collections aus `tournament-config.js` existieren oder duerfen erstellt
  werden.
- `app_meta/turnier_wm2026` ist fuer Clients lesbar.
- Public Reads fuer `Teams WM 2026`, `Punkte Spieler WM 2026`,
  `Spiele WM 2026` und das Meta-Dokument sind in `firestore.rules`
  erlaubt.

App/Deployment:

- Aktuelle statische Dateien sind deployed.
- `cache.js`, `points-utils.js`, `tournament-config.js` und die Zielseite
  werden vom Browser aktuell geladen.
- Der Client kann Firestore erreichen; blockierte Netzwerke oder harte
  Browser-Privacy-Settings koennen den Live-Listener verhindern.

## Manuelle Pruefung

GitHub:

```bash
gh workflow list --repo vonallmenalain/dt --all
gh variable list --repo vonallmenalain/dt
gh secret list --repo vonallmenalain/dt
gh run list --repo vonallmenalain/dt --limit 12
```

Workflow manuell testen:

1. GitHub -> Actions -> `Auto Punkte-Upload` -> `Run workflow`.
2. Fuer Diagnose zuerst `dry_run=true`.
3. Fuer kompletten Catch-up/Recompute `force_run=true`.
4. Logs pruefen:
   - effektive Konfiguration,
   - Kandidatenzahl,
   - API-Calls,
   - geschriebene Spieler-Dokumente,
   - Meta-Versionen.

Typische Log-Bedeutung:

- `Kandidaten in diesem Tick: 0` und `Beende ohne API-Call`:
  normal ausserhalb eines Live-/Catch-up-Fensters.
- `Live-Tick 1/240` bis `Live-Tick 240/240`:
  lange Scheduled-Monitor-Session laeuft. Manuelle `FORCE_RUN`-Runs haben
  weiterhin nur einen Tick.
- `Tick-Budget ... ausgeschoepft`:
  ein Run endete trotz offenem/live Spiel; dann muessen Tick-Anzahl,
  Tick-Abstand oder Session-Max erhoeht werden.
- `0 Spieler-Dokumente geschrieben ... unveraendert uebersprungen`:
  Daten waren identisch; dann steigt `pointsVersion` nicht.
- `Meta-Dokument ... aktualisiert`:
  Browser sollten ueber den Meta-Listener neu laden.

## Stoerungsdiagnose

Wenn kein Live-Update sichtbar ist:

1. In GitHub Actions pruefen, ob `Auto Punkte-Upload` nach dem Anpfiff
   erfolgreich laeuft.
2. Im Run-Log pruefen, ob Kandidaten gefunden wurden.
3. Falls keine Kandidaten: `Spiele WM 2026` auf Kickoff, `fixtureId` und
   `status.short` pruefen.
4. Falls Kandidaten, aber keine Writes: API-Details, Lineups und
   `unveraendert uebersprungen` pruefen.
5. Falls Writes, aber Browser nicht frisch: `app_meta/turnier_wm2026`
   auf `pointsVersion`/`fixturesVersion` pruefen.
6. Falls Meta stimmt, aber Client nicht: Firestore-Regeln, Browser-Konsole
   und Service-Worker/Deployment-Cache pruefen.
