# Live-Update-Prozess und Betriebscheck

Zeiten in GitHub Actions sind UTC; App- und Turnierzeiten laufen auf
`Europe/Zurich`.

Aktives Turnier der Cron-Jobs: **Champions League 2026/27** (`cl2627`), seit
dem 29.08.2026. Die WM-Abschnitte weiter unten bleiben als Referenz stehen –
der Mechanismus ist derselbe, nur Turnier, Collections und Cron-Fenster
unterscheiden sich.

---

## Champions League 2026/27

Stand des Checks: 2026-08-29.

### Was scharfgeschaltet wurde

- **Turnier der Cron-Jobs.** Beide Server-Skripte nehmen ohne
  `TOURNAMENT_KEY` jetzt `APP_CONFIG.serverTournamentKey` – das Turnier,
  dessen `defaultActiveFrom` zuletzt erreicht wurde. Vorher landeten sie in
  Node immer auf `FALLBACK_TOURNAMENT_KEY` (kein Hostname, also kein
  Domain-Mapping) und liefen weiter auf der WM.
- **Cron-Fenster** des Punkte-Workflows: die Spieltage der CL-Saison,
  jeweils 15:00–23:59 UTC (siehe unten).
- **Freischaltung**: `available`/`dataReady` auf `true`; dt.alae.app
  defaultet über `defaultActiveFrom` auf die CL. Die WM ist `archived` –
  lesbar für alle Angemeldeten, Team-Builder gesperrt.
- **Runden-Erkennung**: `isLeaguePhaseRound` kennt neben
  `League Stage - 1`..`- 8` auch das blanke `Group Stage`, das
  api-football fuer die Saison 2026/27 liefert.
- **Platzhalter-Guard** im Spielplan-Sync (siehe „Offener Punkt").

### Befund vom 29.08.2026 (Dry-Run, `tournament_key=cl2627`)

```text
234 Spiele von der API erhalten.
 90 Spiele VOR Turnierstart verworfen
    (1st/2nd/3rd Qualifying Round: 76, Play-offs: 14).
144 Spiele im Turnier-Scope (Group Stage: 144).
  • Group Stage: 144 Spiele, 1 Termin(e) 2026-09-08..2026-09-08,
    Anstoss 21:00, Paarung bekannt 144/144, Venue-Name 120/144,
    Venue-ID 0/144, Status NS:144
Firestore bisher: 0 Dokumente in "Spiele CL 2026-27".
```

Lesart: die Auslosung vom 27.08. ist bei api-football angekommen – **alle
144 Paarungen stehen**. Der **Spieltag-Kalender fehlt aber noch**: alle 144
Partien liegen auf demselben Termin (08.09. 21:00), die Runde heisst pauschal
`Group Stage` statt `League Stage - 1`..`- 8`, und es gibt keine Venue-IDs.
Das ist der uebliche Zwischenstand zwischen Auslosung und Kalender-
Publikation.

### Offener Punkt: der Spielplan ist noch nicht in Firestore

`Spiele CL 2026-27` ist leer, und das soll bis zur Kalender-Publikation so
bleiben. Wuerde der Platzhalter geschrieben, laegen in der App 144 Spiele auf
Spieltag 1: „naechstes Spiel", Countdown und Spieltag-Gruppierung waeren
falsch, und der Live-Monitor wuerde am 08.09. um 20:30 alle 144 Partien
gleichzeitig als Kandidaten oeffnen.

`assertFixtureSyncIsSafe` bricht deshalb ab, solange die Ligaphase auf
weniger als `leaguePhase.matchesPerTeam` (= 8) verschiedenen Anstoss-Tagen
liegt. 36 Klubs x 8 Spiele verteilen sich zwingend auf 8 Spieltage.

**Konsequenz fuer den Betrieb:** der taegliche `Auto Spielplan-Sync` laeuft
bis dahin auf Rot, mit genau dieser Meldung im Log. Das ist das Signal, auf
das man wartet – **sobald der Lauf gruen wird, steht der echte Spielplan in
Firestore** und `fixturesVersion` ist erhoeht. Erwartet wird das ein paar
Tage nach der Auslosung, also deutlich vor dem 08.09.

Pruefen, ohne etwas zu schreiben:

Actions → `Auto Spielplan-Sync` → Run workflow → `dry_run` = an. Der
Spielplan-Report im Log zeigt je Runde Termine, Anstosszeiten sowie
Paarungs- und Venue-Abdeckung.

Falls der Kalender wider Erwarten nicht rechtzeitig kommt, gibt es den
bewussten Einmal-Ausweg `allow_placeholder_schedule` – dann liegen die
Paarungen in der App, aber mit falschen Terminen. Nur mit Ansage benutzen.

### Cron-Fenster der Spieltage

```yaml
- cron: "2-59/5 15-23 8-10 9 *"             # Spieltag 1: 08.-10.09.2026
- cron: "2-59/5 15-23 13-14,20-21 10 *"     # Spieltag 2+3
- cron: "2-59/5 15-23 3-4,24-25 11 *"       # Spieltag 4+5
- cron: "2-59/5 15-23 8-9 12 *"             # Spieltag 6
- cron: "2-59/5 15-23 19-20,27 1 *"         # Spieltag 7+8
- cron: "2-59/5 15-23 16-17,23-24 2 *"      # K.-o.-Playoffs
- cron: "2-59/5 15-23 9-10,16-17 3 *"       # Achtelfinale
- cron: "2-59/5 15-23 6-7,13-14,27-28 4 *"  # Viertel- + Halbfinale Hinspiele
- cron: "2-59/5 15-23 4-5 5 *"              # Halbfinale Rueckspiele
- cron: "2-59/5 15-23 5 6 *"                # Final: 05.06.2027
```

15:00–23:59 UTC deckt beide Anstosszeiten in beiden Zeitzonen ab: 18:45 und
21:00 Schweizer Zeit sind 16:45/19:00 UTC im Sommer und 17:45/20:00 UTC im
Winter, jeweils inklusive der 30 Minuten Vorlauf des Live-Fensters. Der
Final-Recheck nach Mitternacht braucht keine eigenen Cron-Zeilen: ein Run,
der abends startet, monitort mit seiner langen Session (bis 350 Minuten)
ueber den Abpfiff hinaus.

Die Cron-Zeilen sind eine handgepflegte Kopie von `MATCH_CALENDAR_CL2627`
(YAML kann nicht rechnen). `npm run test:live-schedule` prueft, dass jeder
Spieltag aus dem Kalender in einem Fenster liegt – verschieben sich Termine,
wird der Test rot.

**Achtung bei Verlegungen.** Wird eine Partie auf einen Tag ausserhalb dieser
Fenster verlegt, laeuft sie nicht live mit. Die Punkte gehen nicht verloren:
offene Spiele bleiben Catch-up-Kandidaten und werden beim naechsten
Cron-Fenster nachgezogen. Wer sie sofort will, startet den Workflow manuell
mit `force_run`.

### Firestore-Objekte der CL

- Meta-Dokument: `app_meta/turnier_cl2627`
- Teams: `Teams CL 2026-27`
- Punkte: `Punkte Spieler CL 2026-27`
- Spielplan: `Spiele CL 2026-27`
- Public Cache: `public_cache/cl2627_fixtures`, `cl2627_points_shard_NN`

Public Reads und Team-Writes fuer diese Collections stehen in
`firestore.rules` (Regressionstest: `npm run test:cl-team-writes`).

### Checkliste vor dem ersten Anpfiff (08.09.2026, 21:00 CH)

1. `Auto Spielplan-Sync` ist gruen und `Spiele CL 2026-27` enthaelt 144
   Ligaphasen-Spiele auf acht verschiedenen Terminen.
2. `app_meta/turnier_cl2627` hat eine positive `fixturesVersion` und ein
   `fixturesCacheGeneratedAt`, das zur `cacheGenerationMs` im Bundle passt.
3. `cl2627` steht auf `available: true` + `dataReady: true` (seit
   29.08.2026 erledigt) – dt.alae.app zeigt die CL, die WM bleibt als
   Archiv im Profil-Dropdown erreichbar.
4. Ein manueller `Auto Punkte-Upload` mit `force_run` laeuft sauber durch
   (Guard, API-Call, Firestore-Write, Meta-Bump).
5. Die Firestore-Rules sind deployt (`Deploy Firestore Rules`).

---

## Mechanismus (turnierunabhaengig)

### Beteiligte Dateien

- `.github/workflows/auto-points-upload.yml`: GitHub Action fuer Punkte.
- `.github/workflows/sync-fixtures.yml`: GitHub Action fuer Spielplan.
- `scripts/auto-points-upload.js`: Server-Logik fuer Punkte, Live-Ticks,
  Pre-Check, API-Retries, Firestore-Writes.
- `scripts/sync-fixtures.js`: Server-Logik fuer Fixtures und Venues.
- `tournament-config.js`: einzige Quelle fuer Turnier, API-Werte,
  Collections und Auto-Punkte-Phase.
- `cache.js`: Browser-Cache und Firestore-Meta-Listener.
- `rangliste.html`: konsumiert Cache/Meta und zeigt Live-/Last-Update-Status.

### GitHub-Zeitplan

#### Auto Punkte-Upload

Workflow: `.github/workflows/auto-points-upload.yml`

Cron: alle 5 Minuten, aber nur in den Fenstern der Spieltage des aktiven
Turniers – aktuell die CL-Spieltage, siehe oben. Fuer die WM waren es
durchgehende Fenster vom 11.–30. Juni und 1.–21. Juli 2026.

GitHub kann scheduled workflows verzoegern oder einzelne Takte auslassen;
der Code ist deshalb so gebaut, dass ein Run auf das naechste Live-Fenster
warten, ein laufendes Spiel lange monitoren und verpasste offene Spiele per
Catch-up nachziehen kann.
Die Minute 2/7/12/... vermeidet den besonders anfaelligen Stundenwechsel.

Job-Eckdaten:

- `runs-on: ubuntu-latest`
- Node.js `20`
- `timeout-minutes: 360`
- `concurrency.cancel-in-progress: false`

`cancel-in-progress: false` ist bewusst: ein wartender oder laufender
Live-Run wird nicht automatisch abgebrochen, wenn GitHub einen weiteren
Schedule-Run startet. Damit kann ein einzelner aktiver Run ein Spiel bis
nach Abpfiff begleiten.

#### Auto Spielplan-Sync

Workflow: `.github/workflows/sync-fixtures.yml`

Cron:

```yaml
- cron: "0 4 * * *"
```

Das laeuft taeglich um 04:00 UTC, also waehrend der Sommerzeit etwa
06:00 Uhr in der Schweiz. Der Sync aktualisiert die Fixtures und erhoeht
bei erfolgreichen Writes `fixturesVersion`.

### Wann starten die Ticks?

Es gibt zwei verschiedene "Ticks":

1. GitHub-Cron-Tick: GitHub soll den Workflow etwa alle 5 Minuten in den
   Cron-Fenstern der Spieltage starten. Das ist ein Trigger-Versuch, keine
   harte Verfuegbarkeitsgarantie.
2. Live-Tick im Script: innerhalb eines `Auto Punkte-Upload`-Runs fuehrt
   `scripts/auto-points-upload.js` bei Scheduled Runs mindestens 520
   interne Ticks aus, mit mindestens 30 Sekunden Abstand.

Der interne Tick 1 startet nach Checkout, Node-Setup, `npm install` und
Script-Start. Danach passiert im Script:

1. Turnier-Key aufloesen (`TOURNAMENT_KEY`, sonst
   `APP_CONFIG.serverTournamentKey` – aktuell `cl2627`).
2. Guard pruefen: ohne `FORCE_RUN` arbeitet das Script nur innerhalb von
   `AUTO_POINTS_FROM`/`AUTO_POINTS_UNTIL` des Turniers (CL 2026/27:
   `2026-09-08T18:00:00+02:00` bis `2027-06-06T23:59:00+02:00`).
3. Firebase Admin initialisieren.
4. `Live-Tick 1/520` loggen (oder mehr, falls hoeher konfiguriert).
5. Spielplan beim ersten Tick aus der Fixtures-Collection des Turniers
   lesen, im
   run-weiten In-Memory-Fixture-Plan-Cache halten und daraus Kandidaten
   bestimmen.

Mit den aktuellen Einstellungen oeffnet das Live-Fenster pro Spiel 30
Minuten vor Anpfiff:

```text
candidate_start = kickoff - 30 Minuten
normal_window_end = kickoff + 150 Minuten
final_recheck_end = kickoff + 240 Minuten
```

Ein Spiel ist Kandidat, wenn:

- es mindestens im Startfenster liegt, also `now >= kickoff - 30min`, und
- es in Firestore noch nicht `FT`, `AET` oder `PEN` ist, oder
- es bereits final ist, aber noch innerhalb des Final-Recheck-Fensters
  liegt.

Wichtig: Fuer offene Spiele gibt es nach `POINTS_WINDOW_END_MIN` keine
harte Abschaltung. Wenn ein Spiel wegen API-/Netzwerkproblemen oder
GitHub-Verzoegerung verpasst wurde, bleibt es Catch-up-Kandidat, bis der
Finalstatus erfolgreich nach Firestore geschrieben wurde.

Wenn ein Tick keine Kandidaten findet, aber das naechste Live-Fenster
innerhalb von `POINTS_IDLE_WAIT_MAX_MIN=240` Minuten liegt und die
Session danach noch genug Restzeit fuer das Live-Fenster plus Puffer hat,
wartet der Run ohne API-Call bis zum Fensterstart.
Ist das Live-Fenster noch zu weit weg, beendet sich der Run und laesst
einen spaeteren Cron-Takt naeher am Spiel starten. Sobald ein offenes
Spiel Kandidat ist, bleibt der Scheduled Run lange genug aktiv, um den
finalen Status in normalen Faellen selbst zu sehen, statt nach 5 Minuten
auf einen weiteren GitHub-Schedule-Takt angewiesen zu sein.

### Ablauf Auto Punkte-Upload

1. GitHub startet den Workflow per Cron oder `workflow_dispatch`.
2. Workflow setzt Env aus Secrets und, nur bei manuellen Runs,
   `workflow_dispatch`-Inputs.
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

Der In-Memory-Fixture-Plan-Cache lebt nur innerhalb eines laufenden
GitHub-Action-Prozesses. Tick 1 liest den kompletten Spielplan; danach
verwenden weitere 30-Sekunden-Live-Ticks denselben Cache. Wenn das Script
Fixture-Status oder Resultate schreibt, wird dieser Cache sofort mit
denselben Werten aktualisiert. `POINTS_FIXTURE_PLAN_REFRESH_EVERY_TICKS`
steuert einen Sicherheitsrefresh (Default 20 Ticks, `0` = nur initial),
falls waehrend einer langen Session extern am Spielplan gearbeitet wurde.
UI, Punkteberechnung, Ranking und Live-Takt bleiben dadurch unveraendert.

### Ablauf Spielplan-Sync

1. GitHub startet den Workflow taeglich um 04:00 UTC oder manuell.
2. Script laedt alle Fixtures von API-Football mit
   `league=1&season=2026&timezone=Europe/Zurich`.
3. Venue-IDs werden dedupliziert und einmalig abgefragt, ausser
   `SKIP_VENUES=1`.
4. Pro Spiel wird ein Firestore-Dokument fuer `Spiele WM 2026` gebaut.
5. Writes erfolgen in Batches nach Firestore.
6. Nach erfolgreichen Writes wird `public_cache/wm2026_fixtures` als
   oeffentliches Fixture-Bundle geschrieben.
7. Danach wird `fixturesVersion` im Meta-Dokument erhoeht und
   `fixturesCacheGeneratedAt` auf dieselbe `cacheGenerationMs` wie im
   Bundle gesetzt. Dadurch laden offene Browser die Fixtures neu.

### Browser-Live-Update

Der Browser pollt nicht laufend alle Punkte. Er beobachtet das Meta-
Dokument des aktiven Turniers:

```text
app_meta/turnier_cl2627     # CL 2026/27
app_meta/turnier_wm2026     # WM 2026
```

`DreamTeamCache.bootstrap()` in `cache.js` haengt einen Firestore
`onSnapshot`-Listener an dieses Dokument. Wenn dort eine Version steigt,
entscheidet der Cache anhand der Meta-Felder, was neu geladen werden muss
(Collection-Namen aus `tournament-config.js`, hier fuer die CL):

- `teamsVersion` -> `Teams CL 2026-27`
- `pointsVersion` -> `Punkte Spieler CL 2026-27`
- `fixturesVersion` -> zuerst `public_cache/cl2627_fixtures`, nur bei
  fehlendem, ungueltigem oder veraltetem Bundle weiter `Spiele CL 2026-27`

`rangliste.html` rendert danach mit den frischen Daten neu und aktualisiert
auch die Anzeige "Spielpunkte aktualisiert", "Live Punkte-Update",
"Anpfiff erreicht" oder "Naechstes Spiel".

Das Fixture-Bundle enthaelt die vollstaendigen Fixture-Daten des Turniers
unter einem einzigen Dokument. Wenn `fixturesCacheGeneratedAt` im Meta-
Dokument zur `cacheGenerationMs` im Bundle passt, kostet der Fixture-
Refresh im Browser nur einen Dokument-Read. Passt es nicht, fehlt das
Bundle oder ist es ungueltig, bleibt der bisherige Fallback auf die ganze
Collection aktiv.

Damit Live-Update funktioniert, muss also nicht ein Browser oder eine
Admin-Seite offen sein. Entscheidend ist, dass der GitHub-Workflow schreibt
und das Meta-Dokument die passende Version erhoeht.

#### Freshness-First Browser Cache

Seit dem Freshness-First-Fix vom 2026-06-23 gilt fuer die oeffentlichen
Live-Seiten: lokale Browserdaten sind nie Quelle der Wahrheit. `app_meta`
ist nur dann ein Freshness-Signal, wenn es beim Initialisieren direkt vom
Server gelesen wurde. Ein Session-Meta oder ein altes LocalStorage-Meta
darf keinen Server-Read ersetzen, sobald Rangliste, Punkte, Teams mit
Punkten, Spielplan oder Analyse angezeigt werden.

Die Dataset-Caches fuer Teams, Punkte und Fixtures verwenden ein
versioniertes Envelope-Schema:

```text
{
  schemaVersion: 2,
  savedAt,
  data,
  meta: {
    teamsVersion,
    pointsVersion,
    fixturesVersion,
    teamsUpdatedAt,
    pointsUpdatedAt,
    fixturesUpdatedAt,
    fixturesCacheGeneratedAt,
    pointsCacheGeneratedAt,
    pointsShardCount
  }
}
```

Ein lokaler Dataset-Cache gilt nur als frisch, wenn sein Envelope exakt
zur aktuellen Server-Meta passt. Alte v1-Envelopes ohne Meta-Bindung oder
Envelopes mit anderer Version/Generation werden verworfen und vom Server
neu geladen. `last_good_points` und `last_good_fixtures` duerfen online
nicht als aktuelle Daten angezeigt werden. Bei Offline-/Serverfehlern darf
die UI nur einen klar markierten stale/offline-Status zeigen
(`verifiedFromServer=false`, `stale=true`, `offlineFallback=true`), aber
keine normale Live-Anzeige.

LocalStorage-Write-Fehler sind freshness-kritisch. Wenn ein benoetigter
Dataset-Cache nicht gespeichert werden kann, wird die lokale Meta nicht als
aktuell gespeichert und die dynamischen Dataset-Cache-Keys werden geloescht.
Die aktuelle Session darf die frisch vom Server geladenen Daten trotzdem
anzeigen; beim naechsten Laden muss wieder der Server gelesen werden.

Wichtige `app_meta`-Felder:

- Notwendig fuer Freshness: `teamsVersion`, `pointsVersion`,
  `fixturesVersion` sowie die jeweiligen `UpdatedAt`-Felder.
- Optional fuer Public Cache: `fixturesCacheGeneratedAt`,
  `pointsCacheGeneratedAt`, `pointsShardCount`.
- Nicht mehr clientkritisch: `pointsDeltaDocId`,
  `pointsDeltaBaseVersion`, `pointsDeltaNextVersion`. Diese Delta-Felder
  waren eine Read-Optimierung und werden vom Client aktuell bewusst nicht
  fuer Freshness verwendet.

Public Fixture Bundles werden nur akzeptiert, wenn `kind`, Turnier-Key,
Jahr und `cacheGenerationMs` exakt zur Server-Meta passen. Fehlt
`fixturesCacheGeneratedAt` bei einer positiven `fixturesVersion` oder passt
die Generation nicht, liest der Client direkt `Spiele WM 2026`.

Firestore Offline Persistence ist standardmaessig deaktiviert. Cached
Firestore-Snapshots aus Listenern werden weiterhin ignoriert; der Initial-
Load nutzt einen expliziten Server-Read.

### Notwendige Voraussetzungen

GitHub:

- Actions im Repo aktiviert.
- Workflows liegen auf dem Default-Branch `main`.
- Workflows sind nicht deaktiviert.
- Secrets `RAPIDAPI_KEY` und `FIREBASE_SERVICE_ACCOUNT` existieren und
  sind gueltig.
- Actions-Variables sind fuer die produktiven Runs leer bzw. geloescht.
- `TOURNAMENT_KEY` bleibt bei Scheduled Runs leer: das Turnier kommt aus
  `APP_CONFIG.serverTournamentKey` (Kalender, nicht Domain).
- Einmalige Abweichungen werden nur ueber `workflow_dispatch`-Inputs
  gesetzt.

API-Football:

- RapidAPI-Key ist aktiv.
- Genug API-Quota fuer Fixture-Liste und Detail-Calls.
- `tournament-config.js` hat die richtige API-Konfiguration. CL 2026/27:
  `competitionParam=league`, `competitionId=2`, `season=2026`
  (WM 2026 war `competitionId=1`).
- Das Kontingent des api-football-Abos reicht. Ein Live-Tick kostet einen
  Fixture-Listen-Call plus einen Detail-Batch je 20 laufenden Spielen; bei
  neun Partien an einem Abend sind das zwei Calls pro Tick.

Firestore:

- Service Account hat Schreibrechte auf das Firebase-Projekt
  `dreamteam-d2121`.
- Collections aus `tournament-config.js` existieren oder duerfen erstellt
  werden.
- Das Meta-Dokument des Turniers ist fuer Clients lesbar
  (`app_meta/turnier_cl2627` bzw. `app_meta/turnier_wm2026`).
- Public Reads fuer die Teams-, Punkte- und Spiele-Collection des Turniers,
  das zugehoerige Public-Cache-Bundle und das Meta-Dokument sind in
  `firestore.rules` erlaubt – fuer beide Turniere. Client-Writes auf das
  Bundle bleiben verboten; Schreibzugriffe laufen ueber das Admin-SDK.
- Die Rules sind auch wirklich deployt (Workflow `Deploy Firestore Rules`);
  die Datei im Repo allein reicht nicht.

App/Deployment:

- Aktuelle statische Dateien sind deployed.
- `cache.js`, `points-utils.js`, `tournament-config.js` und die Zielseite
  werden vom Browser aktuell geladen.
- Der Client kann Firestore erreichen; blockierte Netzwerke oder harte
  Browser-Privacy-Settings koennen den Live-Listener verhindern.

### Manuelle Pruefung

GitHub:

```bash
gh workflow list --repo vonallmenalain/dt --all
gh variable list --repo vonallmenalain/dt
gh secret list --repo vonallmenalain/dt
gh run list --repo vonallmenalain/dt --limit 12
```

Workflow manuell testen:

1. GitHub -> Actions -> `Auto Punkte-Upload` -> `Run workflow`.
2. `force_run` aus lassen, um den normalen Live-Monitor/Scheduled Run
   manuell neu zu starten. `tournament_key` leer lassen – sonst wird der
   Kalender-Default uebersteuert.
3. `force_run=true` setzen, um kompletten Catch-up/Recompute zu erzwingen.
4. Logs pruefen:
   - effektive Konfiguration,
   - Kandidatenzahl,
   - API-Calls,
   - geschriebene Spieler-Dokumente,
   - Meta-Versionen.

Typische Log-Bedeutung:

- `Kandidaten in diesem Tick: 0` und `Beende ohne API-Call`:
  normal ausserhalb eines Live-/Catch-up-Fensters.
- `Live-Tick 1/520` bis `Live-Tick 520/520`:
  lange Scheduled-Monitor-Session laeuft. Manuelle `FORCE_RUN`-Runs haben
  weiterhin nur einen Tick.
- `Tick-Budget ... ausgeschoepft`:
  ein Run endete trotz offenem/live Spiel; dann muessen Tick-Anzahl,
  Tick-Abstand oder Session-Max erhoeht werden.
- `0 Spieler-Dokumente geschrieben ... unveraendert uebersprungen`:
  Daten waren identisch; dann steigt `pointsVersion` nicht.
- `Meta-Dokument ... aktualisiert`:
  Browser sollten ueber den Meta-Listener neu laden.

### Stoerungsdiagnose

Wenn kein Live-Update sichtbar ist:

1. In GitHub Actions pruefen, ob `Auto Punkte-Upload` nach dem Anpfiff
   erfolgreich laeuft.
2. Im Run-Log pruefen, ob Kandidaten gefunden wurden.
3. Falls keine Kandidaten: die Spiele-Collection des Turniers auf Kickoff,
   `fixtureId` und `status.short` pruefen. Ist sie leer, hat der
   Spielplan-Sync noch nie erfolgreich geschrieben – sein Log sagt warum.
4. Falls Kandidaten, aber keine Writes: API-Details, Lineups und
   `unveraendert uebersprungen` pruefen.
5. Falls Writes, aber Browser nicht frisch: das Meta-Dokument des Turniers
   auf `pointsVersion`/`fixturesVersion` pruefen.
6. Falls Meta stimmt, aber Client nicht: Firestore-Regeln, Browser-Konsole
   und Service-Worker/Deployment-Cache pruefen.

---

## WM 2026 (Referenz / Incident-Historie)

Stand des Checks: 2026-06-13.

### Kurzfazit

Der Live-Update-Prozess ist korrekt verdrahtet, aber der Check vom
2026-06-13 hat gezeigt: GitHub Scheduled Runs kamen in der Nacht nicht
zuverlaessig alle 5 Minuten durch. Der Punkte-Upload darf deshalb nicht
darauf angewiesen sein, dass nach einem kurzen 5-Minuten-Live-Run sofort
der naechste Scheduled Run startet.

- Repo `vonallmenalain/dt`, Default-Branch `main`, GitHub Actions aktiviert.
- Workflows `Auto Punkte-Upload` und `Auto Spielplan-Sync` sind aktiv.
- Actions-Permissions: `enabled=true`, `allowed_actions=all`.
- Secrets vorhanden: `RAPIDAPI_KEY`, `FIREBASE_SERVICE_ACCOUNT`.
- Repo-Variables werden fuer Scheduled Runs bewusst nicht gelesen. Alte
  `POINTS_*`-Variables oder `TOURNAMENT_KEY` in GitHub Actions koennen
  geloescht werden; produktive Defaults liegen in `tournament-config.js`
  und `scripts/auto-points-upload.js`.
- Manuelle `workflow_dispatch`-Inputs bleiben als Einmal-Overrides fuer
  Tests moeglich.

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
