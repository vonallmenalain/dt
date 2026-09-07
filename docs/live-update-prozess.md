# Live-Update-Prozess und Betriebscheck

Zeiten in GitHub Actions sind UTC; App- und Turnierzeiten laufen auf
`Europe/Zurich`.

Aktives Turnier der Cron-Jobs: **Champions League 2026/27** (`cl2627`), seit
dem 29.08.2026. Die WM-Abschnitte weiter unten bleiben als Referenz stehen –
der Mechanismus ist derselbe, nur Turnier, Collections und Cron-Fenster
unterscheiden sich.

---

## Champions League 2026/27

Stand des Checks: 2026-09-07 (Vortag von Spieltag 1). Erst-Check
2026-08-29, Spielplan-Check 2026-09-03.

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

### Betriebscheck vom 07.09.2026 (Vortag von Spieltag 1)

Geprueft am Tag vor dem ersten Anpfiff (08.09.2026, 18:45 CH):

- **`Auto Punkte-Upload` lief seit dem 03.09. nicht mehr – das ist korrekt.**
  Die Runs #575–#582 waren Push-Runs (Aenderungen an Workflow, Skript oder
  `tournament-config.js` auf `main`; sie enden nach ~15 s am Phasen-Guard).
  Der Cron ist auf die Spieltage beschraenkt; der erste Takt der Saison ist
  **Dienstag, 08.09.2026, 17:02 CH** (15:02 UTC). Vorher ist im Tab Actions
  nichts zu erwarten.
- **`Auto Spielplan-Sync`** laeuft taeglich gruen (Runs #121–#130, zuletzt
  07.09. 09:11 UTC): 144 Ligaphasen-Spiele in 8 Runden, Fixture-Guard ok.
  Dry-Run #131 (07.09.) zeigt fuer Spieltag 1 **3 Termine 08.–10.09.,
  Anstoss 18:45/21:00**, alle 18 Paarungen bekannt, Status NS. Damit passt
  `DREAMTEAM_START` (18:45) – Checklisten-Punkt 6 erledigt. Spieltag 2–7
  ebenfalls 18:45/21:00, Spieltag 8 nur 21:00. Venue-IDs liefert die API
  weiterhin nicht (kosmetisch: kein Stadionbild).
- **Manueller `force_run` (Run #583, 07.09. 11:48 UTC) sauber durch:**
  Phasen-Guard uebersprungen, Firebase-Init, Fixture-Plan 144 Dokumente,
  Kader 1161 Spieler aus `data-cl2627.js` (Positions-Overrides 89/120
  wirksam), API-Call `league=2&season=2026` (234 Spiele, 90 Quali
  verworfen), Listen-Guard ok, erwartungsgemaess 0 Kandidaten, kein
  Punkte-Write, Audit-Log geschrieben. Checklisten-Punkt 4 erledigt –
  Secrets, Kaderdatei und API-Zugang fuer die CL sind damit verifiziert.
- Firestore-Rules zuletzt am 06.09. deployt (Run #14, gruen).
- `npm test` (alle Suiten) gruen.

Zwei Optimierungen aus dem Check (PR vom 07.09.):

1. **`AUTO_POINTS_FROM` von 18:00 auf 17:30 CH vorgezogen.** Der Cron
   startet um 17:02, aber erst ab `AUTO_POINTS_FROM` darf ein Scheduled
   Run Firestore lesen und auf das Live-Fenster (18:15) warten. Bisher
   haette erst der Takt von 18:02 den Concurrency-Slot halten koennen –
   43 Minuten vor dem Anpfiff. Jetzt tut das schon der Takt von 17:32:
   75 Minuten Puffer gegen verspaetete oder ausgelassene GitHub-Takte.
   Nicht frueher, weil die Session eines Runs spaetestens 350 min nach
   Start endet: ab 17:32 reicht sie bis 23:22 CH und traegt so auch die
   21:00-Spiele ueber den Abpfiff (ca. 22:50–22:55) hinaus.
2. **Tick-Resilienz.** Ein API-/Firestore-Fehler, der alle Retries
   ueberdauert, beendete bisher den ganzen Scheduled Run (Exit 2) – mitten
   im Spiel, und das Live-Scoring hing dann am naechsten Cron-Takt. Jetzt
   wird der Tick geloggt (`Live-Tick N/520 fehlgeschlagen (k/5 in Folge)`)
   und nach 30 s der naechste versucht; erst 5 Fehler in Folge beenden den
   Run sichtbar rot. `force_run`- und Push-Runs brechen weiterhin sofort ab.

#### Was am 08.09. im Tab Actions zu sehen ist (Zeiten CH)

| Zeit | Erwartung |
| --- | --- |
| 17:02, 17:07, … 17:27 | Scheduled Runs, je ~15 s, Log `Auto-Punkte-Phase ist nicht aktiv` (vor 17:30). |
| ab 17:32 | Der erste Run liest den Spielplan, findet `Kandidaten in diesem Tick: 0`, loggt `Naechstes Live-Fenster beginnt um …16:15:00.000Z; warte …` und bleibt **in progress**. |
| 18:15 | Derselbe Run: die 18:45-Spiele werden Kandidaten (`Live-Tick 1/520`), Startelfen sobald publiziert – Punkte fuer die Startaufstellung erscheinen damit schon VOR dem Anpfiff. |
| 18:45 – ca. 23:00 | Live-Ticks alle ~30 s; jede Punkteaenderung erhoeht `pointsVersion`, offene Browser laden ueber den Meta-Listener nach. Um 20:30 kommen die 21:00-Spiele dazu. |
| laufend | Hinter dem aktiven Run steht genau EIN Run als **Queued/Pending**; jeder weitere Cron-Takt ersetzt ihn. Die vielen **cancelled** Runs („Canceling since a higher priority waiting request … exists") sind normal und kein Fehler. |
| ca. 23:22 | Session-Max erreicht (350 min ab 17:32); der wartende Run uebernimmt innerhalb ~1 min und faehrt den Final-Recheck (bis 4 h nach Anpfiff, fuer die 21:00-Spiele also bis 01:00). |
| 09./10.09. | Dasselbe Muster; Cron-Fenster jeweils 17:02–01:59. |

Manuelle Eingriffe an einem Spieltag: ein `Run workflow` landet in derselben
Concurrency-Gruppe und startet erst, wenn der laufende Monitor-Run endet –
er ersetzt dabei den wartenden Cron-Run. Waehrend ein Live-Run laeuft, also
nichts manuell starten. Laeuft nichts mehr (kein Run „in progress"), startet
`force_run` sofort und zieht offene Spiele nach.

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

### Spielplan in Firestore – erledigt (Stand 03.09.2026)

Der Spieltag-Kalender ist bei api-football angekommen: `Auto Spielplan-Sync`
laeuft seit dem **30.08.2026 gruen** (Runs 121–126), der Lauf vom 03.09.2026
08:49 UTC meldet

```text
144 Spiele im Turnier-Scope (League Stage - 1: 18, … League Stage - 8: 18).
Fixture-Guard ok: API=144, Firestore bisher=144, Minimum=144, Final-Erwartung=189.
144 Fixture-Dokumente in Firestore geschrieben.
Public Fixture-Bundle geschrieben (144 Fixtures, cacheGenerationMs=1788425362123).
Meta app_meta/turnier_cl2627 aktualisiert (fixturesVersion erhöht).
```

Damit sind Punkt 1 und 2 der Checkliste unten erfuellt. Venue-IDs liefert die
API fuer die Saison (noch) nicht (`0 eindeutige Venue-IDs`) – Stadionname/
-bild fehlen deshalb vorerst in den Spiel-Details, das ist rein kosmetisch.
**Anstosszeiten geprueft (Dry-Run #131 vom 07.09.2026):** Spieltag 1 liegt
auf drei Terminen (08.–10.09.) mit Anstoss 18:45 und 21:00 – das erste
Spiel beginnt um 18:45, `DREAMTEAM_START` passt.

Der Abschnitt darunter beschreibt den Zwischenstand vor der Kalender-
Publikation und bleibt als Referenz fuer die naechste Saison stehen.

#### Zwischenstand bis zur Kalender-Publikation (historisch)

`Spiele CL 2026-27` war leer, und das sollte bis zur Kalender-Publikation so
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
Paarungs- und Venue-Abdeckung. Der **Termin-Report** darunter listet je
kommendem Anstoss-Tag Anzahl und Anstosszeiten, fuer die naechsten sieben
Tage mit allen Paarungen – er steht in JEDEM Lauf im Log, auch im
taeglichen Sync ohne Dry-Run. Vor einem Spieltag beantwortet er „wie viele
Spiele laufen morgen wann?" ohne Firestore-Konsole.

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

### Team-Bau-Deadline und Anzeige-Umschaltung: 08.09.2026, 18:45 CH

Seit dem 30.08.2026 steht `DREAMTEAM_START` (cl2627) auf **18:45** statt
21:00 – dem fruehestmoeglichen Anstoss des ersten Abends (in jeder
bisherigen Ligaphasen-Saison gab es 18:45-Spiele). Damit schliesst die
Team-Abgabe, BEVOR ein Spiel laeuft, und die Startseite wechselt zum
ersten Anpfiff in die Nach-Start-Ansicht mit den Live-Kacheln. Der Wert
steht dreifach (bewusst, mit Tests dagegen): `tournament-config.js`
(`DREAMTEAM_START` + `MATCH_CALENDAR_CL2627` Spieltag 1), Pre-Flight in
`index.html` (`DOMAIN_START`), `firestore.rules`
(`isBeforeClTeamDeadline`, 1788885900000 ms = 16:45 UTC).

**Geprueft am 07.09.2026:** der 08.09. beginnt tatsaechlich um 18:45
(Dry-Run #131) – die Deadline passt, nichts anzuheben.

### Startseite: Live-Ansicht der Spiele (Browser-Seite)

Die Sektion „Aktuelle Spiele" der Startseite hat drei Ansichten:
**Live** (alle gerade laufenden Partien, OHNE Deckel – am letzten
Ligaphasen-Spieltag laufen alle 18 gleichzeitig), **Abgeschlossen** und
**Kommend** (je max. 10). Der Live-Tab erscheint nur, solange etwas
laeuft, traegt einen Zaehler und ist dann die Standard-Ansicht; Kacheln
zeigen Zwischenstand + Spielminute, Details (Torschuetzen, Spieler,
Punkte, Manager) oeffnet der Klick. Ein lokaler 30-s-Uhr-Tick haelt
Countdown („Live in 12 Minuten") und den optimistischen Wechsel auf
Live am Anstoss aktuell, auch bevor der erste Server-Write eintrifft;
die Daten selbst kommen weiterhin ausschliesslich ueber den
Meta-Listener (fixturesVersion → Bundle-Read). Damit die Kacheln am
Spieltag echte Paarungen zeigen, muss der Spielplan-Sync bis dahin
gruen gelaufen sein (siehe „Offener Punkt" oben).

### Checkliste vor dem ersten Anpfiff (08.09.2026, 18:45 CH)

1. `Auto Spielplan-Sync` ist gruen und `Spiele CL 2026-27` enthaelt 144
   Ligaphasen-Spiele auf acht verschiedenen Terminen.
2. `app_meta/turnier_cl2627` hat eine positive `fixturesVersion` und ein
   `fixturesCacheGeneratedAt`, das zur `cacheGenerationMs` im Bundle passt.
3. `cl2627` steht auf `available: true` + `dataReady: true` (seit
   29.08.2026 erledigt) – dt.alae.app zeigt die CL, die WM bleibt als
   Archiv im Profil-Dropdown erreichbar.
4. Ein manueller `Auto Punkte-Upload` mit `force_run` laeuft sauber durch
   (Guard, API-Call, Firestore-Write, Meta-Bump) – **erledigt 07.09.2026,
   Run #583** (vor dem ersten Spiel erwartungsgemaess ohne Punkte-Write,
   siehe Betriebscheck oben).
5. Die Firestore-Rules sind deployt (`Deploy Firestore Rules`) – auch
   die neue 18:45-Deadline (Push auf `main` mit geaenderter
   `firestore.rules` deployt automatisch).
6. Anstosszeiten des 08.09. gegen `DREAMTEAM_START` pruefen – **erledigt
   07.09.2026** (18:45/21:00, Dry-Run #131).

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
   `2026-09-08T17:30:00+02:00` bis `2027-06-06T23:59:00+02:00`).
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
- `Live-Tick N/520 fehlgeschlagen (k/5 in Folge)`:
  ein API-/Firestore-Fehler hat alle Retries ueberdauert; die Session
  laeuft weiter und versucht nach 30 s den naechsten Tick. Erst 5 Fehler
  in Folge beenden den Run mit Exit 2 (rot) – dann Key, Quota und
  Firestore pruefen.
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
