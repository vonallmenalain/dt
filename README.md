# DreamTeam

DreamTeam ist eine Webapp, mit der Userinnen und User vor einem Turnier ein
Fantasy-Team aus dem Spielerpool zusammenstellen und ihre Punkte über die
ganze Saison verfolgen. Die App ist statisch ausgeliefert (Netlify), Daten
liegen in Firebase Firestore; serverseitige Cron-Jobs aktualisieren
Spielplan und Punkte automatisch.

Produktiv ist die **Champions League 2026/27** (`cl2627`): dt.alae.app zeigt
sie seit dem 29.08.2026 standardmässig. Die gespielte **WM 2026** bleibt als
**Archiv** erreichbar – jede angemeldete Person kann im Profil-Dropdown
dorthin wechseln und Rangliste, Teams und Resultate nachlesen. Schreiben kann
dort niemand mehr (siehe „Archiv-Turnier").

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

### Archiv-Turnier

Ein gespieltes Turnier verschwindet nicht, es wird zum **Archiv**:
`archived: true` im Turnier-Block (aktuell `wm2026`). Das bedeutet:

- Es bleibt `available` – Rangliste, Teams, Spiele und Analyse sind normal
  benutzbar.
- Der **Team-Builder ist dort für alle gesperrt**. `isTournamentStarted()`
  liefert für ein Archiv immer `true`, noch vor dem Nachzügler-Schalter –
  sonst würde ein `lateSubmitOpen`, das aus der Turnierzeit im Meta-Dokument
  stehengeblieben ist, das Archiv wieder für alle öffnen. Ein Admin kommt
  über den Ansichts-Umschalter („Vor Start") weiterhin heran.
- Serverseitig sperren die Firestore-Rules Team-Writes ohnehin seit dem
  Anpfiff; das Flag ist die dazu passende UI.

**Wechseln** kann jede angemeldete Person im Profil-Dropdown: `nav.js`
registriert für jedes verfügbare Turnier ausser dem aktiven einen Eintrag
über `DreamTeamAuthModal.menu` (siehe unten). Der Klick benutzt denselben
Kanal wie der Admin-Switcher – `setActiveTournament()` legt den
host-spezifischen Override ab, ein Klick auf das Standard-Turnier räumt ihn
über `resetToDomainDefault()` wieder weg. Beides startet die App danach
**komplett neu auf der Root** (ohne Query/Hash) – nie in place, damit
Shell-Leiste und Inhalt garantiert im selben Turnier booten (siehe
„Turnier-Wechsel & Durchmischungsschutz" in Abschnitt 7).

`DreamTeamAuthModal` hat dafür zwei Register-Kanäle mit derselben Mechanik:

| Kanal     | Sichtbar für            | Ort im Dropdown        |
| --------- | ----------------------- | ---------------------- |
| `menu`    | jede angemeldete Person | über „Abmelden"        |
| `devMenu` | nur Admins              | Dev-Bereich ganz unten |

Regressionstest: `npm run test:archive`.

### Aktives Turnier auflösen

Browser-Reihenfolge:

1. Preview-Kanal (`?preview=<key>` bzw. persistierter Preview-Override) –
   nur für nicht freigeschaltete Turniere, Admin-Werkzeug.
2. URL-Parameter `?tournament=<key>` (Test-Override, nicht persistent).
3. Host-spezifischer Override (`localStorage` →
   `dreamteam_dev_override_<hostname>`). Den setzt heute auch der
   Turnier-Wechsel im Profil-Dropdown – siehe „Archiv-Turnier".
4. Zeitgesteuerter Domain-Default (`defaultDomains` + `defaultActiveFrom`):
   dt.alae.app → Champions League ab 27.08.2026.
5. Statisches Domain-Mapping (`DOMAIN_TOURNAMENT_MAP`).
6. Globaler Fallback (`FALLBACK_TOURNAMENT_KEY = "wm2026"`).

Dieselbe Auflösung steht ein zweites Mal als Inline-Skript im `<head>` jeder
Seite („Pre-Flight"): Theme, Kaderdatei-Preload und die Pre-/Post-Start-
Sektion müssen vor dem ersten Paint feststehen, da ist `tournament-config.js`
noch nicht geladen. Weil so eine Doppelung still driftet – bei der
CL-Freischaltung zeigte die Config auf `cl2627`, das Pre-Flight noch auf
`wm2026` – vergleicht `npm run test:preflight` beide Seiten gegeneinander.

Node-Cron-Scripts:

1. `process.env.TOURNAMENT_KEY` (siehe Workflows weiter unten) – bei
   Scheduled Runs bewusst leer, nur für manuelle Einmal-Läufe.
2. Sonst `resolveServerTournamentKey()`: das Turnier, dessen
   `defaultActiveFrom` zuletzt erreicht wurde.
3. Sonst `FALLBACK_TOURNAMENT_KEY`.

**Warum der Server anders auflöst als der Browser.** In Node gibt es keinen
Hostname, also greifen weder `DOMAIN_TOURNAMENT_MAP` noch der zeitgesteuerte
Domain-Default – die Cron-Jobs landeten deshalb immer auf dem globalen
Fallback und liefen nach dem Turnierende weiter auf der WM. Das fiel erst
auf, als api-football `league=1&season=2026` nicht mehr auslieferte und der
tägliche Spielplan-Sync ab dem 08.08.2026 jeden Tag mit „API lieferte nur 0
Spiele" scheiterte. `resolveServerTournamentKey()` benutzt dieselbe
Kalender-Logik wie der Browser (`defaultActiveFrom`), nur ohne Domain-Filter.

Bewusst **nicht** an `isTournamentAvailable` gekoppelt: der Server muss
Spielplan und Punkte vorbereiten können, solange das Turnier im Browser noch
gesperrt ist. Massgeblich ist „regulär verfügbar **oder** als Vorschau
ladbar" – genau das, was beide Skripte ohnehin akzeptieren. Ein Turnier ohne
`defaultActiveFrom` (WM 2026, Teststand `cl2526`) kommt hier nie zum Zug.

Ungültige oder nicht verfügbare Keys werden ignoriert und fallen auf
den Default zurück.

---

## 2) Backend / Cron-Scripts (`scripts/`)

Server-seitige Workflows, die als GitHub Actions laufen. Firestore-
Schreibzugriffe finden ausschliesslich hier statt, nicht im Browser.

| Script                  | Zweck                                                                     | Cron                          |
| ----------------------- | ------------------------------------------------------------------------- | ----------------------------- |
| `auto-points-upload.js` | Punkte berechnen + nach Firestore schreiben, Meta-Version hochzählen.     | alle 5 Minuten an CL-Spieltagen |
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
3. Sieger der Qualifikations-Play-offs ergänzen. Die letzten sieben
   Ligaphasen-Plätze vergibt keine nationale Tabelle, sondern die
   Play-off-Runde Ende August. Sie wird direkt aus dem Wettbewerb gelesen
   (`/fixtures?league=<comp>&season=<saison>`, Runde „Play-offs") und über
   den **Gesamtscore beider Spiele** ausgewertet – die `winner`-Flags der
   API gelten je Spiel und taugen für eine Paarung nicht; bei Gleichstand
   entscheidet `score.penalty`. Die gleichnamige K.-o.-Runde *nach* der
   Ligaphase („Knockout Round Play-offs") bleibt aussen vor. Noch nicht
   gespielte Paarungen werden gemeldet, nicht geraten – ein späterer Lauf
   holt sie nach.
4. Aktuellen Kader je Klub laden und je Spieler das Profil holen.

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

#### Anzeigenamen: `name-shortener.js`

api-football liefert drei Namensfelder, und keines taugt allein für die
Anzeige: `name` ist oft abgekürzt („A. Tchouaméni"), `firstname` enthält
Zweitvornamen („Aurélien Djani") und `lastname` in spanischsprachigen
Ländern den Mutternamen („Cubarsí Paredes"). Naiv zusammengesetzt entstehen
Namen mit drei und mehr Wörtern, die in Karten und Chips umbrechen.

`name-shortener.js` kürzt auf „Vorname Nachname" und wird an **zwei**
Stellen mit derselben Regel benutzt:

* im Generator über `buildDisplayName()` – dort ist der abgekürzte
  Kurzname bekannt, und der trägt beide Antworten: die Initiale wählt den
  Rufnamen („E. Martínez" + „Damián Emiliano" → „Emiliano"), der Rest
  nennt den Nachnamen („H. Mkhitaryan" → „Mkhitaryan"). Der Nachname
  kommt bewusst **nicht** aus `lastname`: dort steht je nach Herkunft ein
  Muttername („Cubarsí Paredes" → „Cubarsí", erstes Wort) oder ein
  Mittelname („Braut Haaland" → „Haaland", letztes Wort), und dem Feld ist
  nicht anzusehen, welche Sorte. Eine Regel darüber trifft immer die eine
  Sorte falsch – so stand Erling Haaland als „Erling Braut" im Pool. Nur
  ohne abgekürzten Kurznamen bleibt `lastname` die Quelle (dann weiterhin
  ohne Mutternamen);
* beim Laden im Browser über `data.js` → `shortenPlayerName()`, damit
  bereits erzeugte Kaderdateien sofort richtig aussehen, ohne sie neu zu
  generieren. Opt-in pro Turnier via `shortenPlayerNames` (die WM bleibt
  eingefroren); das Ergebnis steht zur Fehlersuche in
  `window.__NAME_SHORTENING_APPLIED__`, der Originalname am Spieler in
  `SpielernameOriginal`.

Erhalten bleiben Nachnamens-Partikel („Virgil van Dijk", „Alexis Mac
Allister", „Marc-André ter Stegen"), Bindestrich-Namen („Vanja
Milinković-Savić") und abgekürzte Profile („A. Le Borgne" – dort ist nicht
erkennbar, was Vor- und was Nachname ist).

Drei Sorten Ausnahmen kann keine Regel kennen; die stehen als
`player.id` → Name in **`name-overrides.js`** und laufen NACH der Kürzung,
haben also das letzte Wort: Rufnamen („Noni Madueke"), Doppelnachnamen im
Browser-Pfad („Pau Cubarsí") und Namen, bei denen drei Wörter richtig sind
(„Randal Kolo Muani", „Barış Alper Yılmaz").

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

`test:names` bewacht die Anzeigenamen (`name-shortener.js`): Beispiele für
beide Pfade, dann die **ganze** Spielerliste beider CL-Turniere – nach
Kürzung und Overrides darf kein Spieler mehr drei Wörter tragen, ausser er
hat einen erlaubten Grund (Partikel, abgekürztes Profil, ausdrücklicher
Override). Zusätzlich führt er `data.js` in einem vm-Kontext mit Mini-DOM
aus: die Blöcke dort sind Strings für `document.write`, ein Syntaxfehler
darin fiele bei einer reinen Textprüfung nicht auf.

`test:freeze` ist der **WM-2026-Freeze-Guard**: Punktesystem, Regel-Labels
und die Captain-Verdopplung (×2) der WM sind eingefroren und dürfen sich
durch Änderungen an anderen Turnieren nicht mitverändern. Er zählt die
Verdopplung über alle View-Dateien zusammen, damit ein blosser Umzug von
Code zwischen den Dateien nicht ausschlägt – ein Entfernen oder Ändern
dagegen schon.

`test:live-schedule` bewacht den Live-Modus: dass die Cron-Jobs in Node auf
dem richtigen Turnier landen (`resolveServerTournamentKey`), dass **jeder**
Spieltag aus `MATCH_CALENDAR_CL2627` in einem Cron-Fenster des
Punkte-Workflows liegt – inklusive beider Anstosszeiten und der 30 Minuten
Vorlauf, in Sommer- wie Winterzeit – und dass ein spielfreier Tag eben
**kein** Fenster hat. Die Cron-Zeilen sind zwangsläufig eine handgepflegte
Kopie des Kalenders (YAML kann nicht rechnen); dieser Test ist die Klammer
dazwischen. Verschieben sich Termine, wird er rot.

`test:fixture-guard` bewacht den Platzhalter-Guard im Spielplan-Sync: nach
einer Auslosung liefert api-football zuerst nur die Paarungen und legt alle
144 Ligaphasen-Spiele auf ein einziges Datum. Dieser Stand darf nicht nach
Firestore – sonst lägen in der App 144 Spiele auf Spieltag 1 und der
Live-Monitor öffnete am Anpfiff alle gleichzeitig als Kandidaten.

`test:archive` bewacht den Turnier-Wechsel: dass die CL Standard ist und die
WM als Archiv verfügbar bleibt, dass der Umschalter im **nicht**
admin-gegateten Bereich des Dropdowns landet (vorher sah ihn nur der Admin),
und dass die Archiv-Prüfung im Team-Builder vor dem Nachzügler-Schalter
steht.

`test:preflight` vergleicht die Inline-Pre-Flight-Skripte im `<head>` aller
Seiten mit `tournament-config.js` – Domain-Default, Fallback, Anpfiff-Map und
die Ableitung der Kaderdatei.

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

### Ansicht umschalten: Vor Start / Nach Start / Auto (nur Admin)

Der Anzeigemodus entscheidet **app-weit**, ob die App den Zustand vor
oder nach dem Anpfiff (`DREAMTEAM_START`) zeigt:

| Modus | Wirkung |
| --- | --- |
| **Auto** | folgt dem echten Anpfiff (Default für alle Nutzer) |
| **Vor Start** | Kader versteckt (`body.teams-locked`), Einreichung offen, Startseite zeigt `#indexHomePreStart` |
| **Nach Start** | Kader sichtbar, Einreichung gesperrt, Startseite zeigt `#indexHomePostStart` |

Umgestellt wird im **Profil-Dropdown → Dev → Ansicht** – und zwar auf
*jeder* Seite, nicht nur auf der Startseite. Der Wechsel wirkt sofort und
ohne Reload: `teams.html`, `rangliste.html` und `spieleranalyse.html`
blenden die gedrafteten Spieler direkt ein bzw. aus, `team-builder.html`
öffnet bzw. sperrt die Einreichung, `index.html` tauscht die Sektion.

Die Mechanik steckt in `view-mode.js` (`window.DreamTeamViewMode`):

```js
DreamTeamViewMode.get();            // "auto" | "pre" | "post" (gespeichert)
DreamTeamViewMode.set('post');      // umstellen + alle Seiten benachrichtigen
DreamTeamViewMode.getEffective();   // "pre" | "post" (wirksam, inkl. Admin-Gate)
DreamTeamViewMode.isPre();          // Kurzform
DreamTeamViewMode.onChange(({ mode, effective, effectiveChanged }) => { … });
```

Wer eine neue Seite baut, bindet `view-mode.js` nach `auth-modal.js` ein
(dann erscheint der Umschalter dort automatisch) und hängt seinen
Re-Render an `DreamTeamViewMode.onChange`. Zusätzlich hält das Modul
`<html data-view="pre|post">` aktuell, sodass CSS ohne JS auf den Modus
reagieren kann (nutzt `index.css` bereits für die Startseiten-Sektionen).

Gespeichert wird global in `localStorage['dreamteamIndexViewMode']` –
bewusst **nicht** turnier-namespaced, weil das Pre-Flight-Skript im
`<head>` von `index.html` den Wert liest, bevor `tournament-config.js`
geladen ist (FOUC-Schutz). Ein zweiter offener Tab zieht über das
`storage`-Event automatisch nach.

**Sicherheit:** Der Override gilt nur für angemeldete Admin-UIDs
(`admin.js` → `getDevViewOverride`). Bei allen anderen Nutzern wird ein
per DevTools gesetzter localStorage-Wert ignoriert und die App fällt auf
den echten `DREAMTEAM_START` zurück. Das ist eine reine UI-Schranke – die
Abgabe-Sperre selbst hängt zusätzlich an den Firestore Rules.

Regressionstest: `npm run test:view-mode` (`scripts/test-view-mode.js`).

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

### Tippgruppen (versteckter Manager-Filter)

Ein bewusst **unauffälliges** Feature (`tippgruppen.js`,
`tippgruppen.css`): Der einzige Einstieg ist der Dropdown-Eintrag
**„Tippgruppen"** zwischen „Mein Team" und dem Turnier-Wechsel (`order:
-10`, die Turnier-Einträge registrieren mit 1, 2, …). Es gibt keine
Banner oder Hinweise in der App – ist eine Gruppe aktiv, zeigen
Rangliste, Teams, Analyse und Dashboard schlicht nur noch die Manager,
die Mitglied der Gruppe sind. Welche Gruppe aktiv ist, steht allein als
Statustext am Dropdown-Eintrag.

**Datenmodell.** Ein Dokument pro Gruppe in der globalen Collection
`tippgruppen` (bewusst NICHT turnier-namespaced – Mitglieder sind
Accounts/UIDs, ein Account hat pro Turnier höchstens ein Team, dieselbe
Gruppe funktioniert damit in jedem Turnier):

```js
// /tippgruppen/{auto-id}
{
    name:        "Büro-Runde",          // 1..60 Zeichen
    visibility:  "public" | "hidden",
    creatorUid:  "abc123…",
    creatorName: "Alice Müller",         // Snapshot (Manager-Name/E-Mail)
    memberUids:  ["abc123…", …],         // max. 200
    memberNames: { "abc123…": "Alice Müller", … },
    createdAt:   <serverTimestamp>
}
```

**Öffentlich vs. versteckt.** Öffentliche Gruppen erscheinen bei allen
im Popup und sind frei beitretbar. Versteckte Gruppen erscheinen in
keiner Liste; der Zugang ist der Einladungs-Link
`index.html?tippgruppe=<docId>` – die zufällige Doc-ID ist das
Geheimnis. Der Link läuft normal durch die Stufe-3-Weiterleitung in die
App-Shell (Seiten-Parameter bleiben auf der Hash-Route), das Modul im
index-Frame öffnet dann den Bestätigungs-Dialog: **erst** Ersteller und
bisherige Mitglieder sehen, **dann** per Klick beitreten (nicht
angemeldete Nutzer werden zuerst durchs Auth-Modal geschickt).

**Firestore Rules** (Durchsetzung liegt wie immer serverseitig):

- `get`: jede angemeldete Person mit bekannter Doc-ID (Link-Vorschau).
- `list`: nur query-gebunden – `visibility == 'public'` oder
  `memberUids array-contains eigene UID`. Eine ungefilterte Query würde
  versteckte Gruppen ausliefern und wird abgelehnt.
- `create`: verifiziert, selbst Ersteller und einziges Mitglied,
  Schema-Allowlist.
- `update`: ausschliesslich **Selbst**-Beitritt/-Austritt (exakt die
  eigene UID + eigener `memberNames`-Eintrag; Name/Sichtbarkeit/
  Ersteller sind unveränderlich).
- `delete`: nur Ersteller oder Admin.

**Auswahl & Filter.** Ausgewählt ist höchstens eine Gruppe – gespeichert
in `localStorage['dreamteam_tippgruppe_selected']` (inkl. gecachter
`memberUids`, damit der Filter synchron arbeiten kann). Die
Seiten-Skripte schicken ihre Teams an der jeweils zentralen
Konsumstelle durch `DreamTeamTippgruppen.filterTeams(teams)` (Filter
über `team.userId`; ohne Auswahl ein No-op mit Identitäts-Rückgabe):

| Seite               | Filterstelle                                   |
| ------------------- | ---------------------------------------------- |
| `rangliste.js`      | `buildRankingData` → `enrichTeams(…)`          |
| `teams.js`          | `applyDataset` → `enrichTeamsWithScores(…)`    |
| `spieleranalyse.js` | `applyDataset` (Rohteams bleiben in `allRawTeams`) |
| `index.js`          | `render()` arbeitet auf gefilterter Kopie      |

Änderungen (Popup-Auswahl, storage-Event aus einem anderen Dokument der
App-Shell, Hintergrund-Abgleich der Mitgliederliste beim Boot) melden
sich über `DreamTeamTippgruppen.onChange(cb)` – die Seiten hängen dort
ihren bestehenden Re-Render an, ein Reload ist nie nötig. Beim
expliziten **Abmelden** wird die Auswahl aufgehoben (sonst bliebe ein
unsichtbarer Filter aktiv, den das nur für Angemeldete erreichbare
Dropdown nicht mehr zeigen könnte). Team-Builder-Statistiken
(Pick-Prozente) und das „Meistgewählte Spieler"-Karussell bleiben
bewusst ungefiltert – dort geht es um Spieler-Popularität, nicht um
Manager-Listen, und die Namens-Duplikatprüfung beim Einreichen muss
ohnehin global bleiben.

Regressionstest: `npm run test:tippgruppen` (Dropdown-Platzierung und
Filter laufen dabei im echten Modul in einer vm-Sandbox).

---

## 4) Firebase-Web-Key & Deploy

Der Firebase-Web-API-Key steht **nicht** im Repo. In `tournament-config.js`
sitzt nur ein Platzhalter:

```js
const firebaseConfig = {
  apiKey: "__FIREBASE_API_KEY__",
  ...
};
```

Beim Deploy ersetzt `scripts/build-firebase-config.js` ihn durch den Wert der
Umgebungsvariable `FIREBASE_API_KEY`. Netlify ruft das Script automatisch auf
(`netlify.toml` → `[build]`). Fehlt die Variable, bricht der Build mit
Exit-Code 1 ab: der Deploy schlägt fehl und die bisherige Version bleibt
online – besser als eine Seite ohne funktionierendes Firebase.

### Was das bringt – und was nicht

Ein Firebase-**Web**-Key ist kein Geheimnis. Er wird an jeden Browser
ausgeliefert und lässt sich dort im Quelltext lesen; das gilt für jeden Key,
egal woher er kommt. Der Build-Step bewirkt zwei Dinge:

- **Kein Secret-Scanning-Alert mehr.** GitHub sieht den Key nie.
- **Rotieren ist eine Konfig-Änderung**, kein Commit – kein Nachziehen von
  Git-Historie, kein neuer Alert.

Der eigentliche Schutz der Daten kommt aus drei anderen Ecken:

1. **`firestore.rules`** – Default-Deny, verifizierte E-Mail für Writes,
   Team-Schema als Allowlist. Das ist die Zugriffskontrolle.
2. **Key-Restriktionen** (Google Cloud Console → APIs & Services →
   Credentials → Browser-Key): *Application restrictions* auf HTTP-Referrer
   (`https://dt.alae.app/*`, Netlify-Preview-Domains, `http://localhost:*/*`),
   *API restrictions* nur auf die tatsächlich genutzten APIs (Identity
   Toolkit, Token Service, Firebase Installations, Cloud Firestore).
   Referrer lassen sich fälschen – das stoppt Gelegenheits-Missbrauch, keinen
   entschlossenen Angreifer.
3. **Firebase App Check** (reCAPTCHA v3 + Enforcement auf Firestore/Auth) –
   der einzige Mechanismus, der fremde Clients wirklich aussperrt. Noch nicht
   eingebaut.

### Key rotieren

Reihenfolge einhalten, sonst steht die App zwischendurch:

1. **Neuen Key anlegen:** Google Cloud Console → APIs & Services →
   Credentials → *Create credentials* → *API key*. Sofort einschränken
   (Referrer + APIs, siehe oben). Projekt bleibt `dreamteam-d2121`; die
   übrigen Felder (`authDomain`, `projectId`, `appId`, …) ändern sich nicht.
2. **Netlify:** Site settings → Environment variables → `FIREBASE_API_KEY`
   auf den neuen Wert setzen, Scope *All deploy contexts* (Deploy Previews
   brauchen ihn auch, sonst schlagen deren Builds fehl).
3. **Nichts von Hand nachziehen:** `CACHE_VERSION` und alle `?v=`-Parameter
   werden beim Deploy automatisch mit dem Commit-SHA gestempelt (siehe
   „Performance: Asset-Versionierung & Service Worker" unten). Jeder Deploy
   invalidiert damit den Service-Worker-Cache von selbst – Besucher ziehen
   die neue `tournament-config.js` (also den neuen Key) beim nächsten
   Besuch automatisch.
4. **Deployen** und auf der Live-Seite prüfen: Login, Team speichern,
   Rangliste laden.

   Achtung: Ist in Netlify **Auto Publishing gesperrt** (Deploys → Button
   *"Unlock to start auto publishing"*, Kopfzeile zeigt dann *"Published
   main@<älterer-commit>"*), wird der neue Build zwar erstellt, aber nicht
   veröffentlicht – live läuft weiter der zuletzt publizierte Stand. Dann den
   Deploy in der Netlify-Oberfläche manuell publishen, sonst prüfst du die
   alte Version und hältst den Key fälschlich für kaputt.
5. **Erst danach** den alten Key in der Cloud Console löschen. Ein paar Tage
   Abstand einplanen, damit Clients mit altem Cache Zeit haben nachzuziehen.

Lokal mit echtem Key testen:

```bash
FIREBASE_API_KEY=AIza... node scripts/build-firebase-config.js
# ... testen ...
git checkout tournament-config.js   # Key wieder rauswerfen
```

`npm test` (in `scripts/`) enthält `test:no-key`: der Test schlägt fehl,
sobald ein Google-API-Key in einer getrackten Datei auftaucht.

---

## 5) Firebase Console Checklist

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
     Ligaphasen-Spiel (2026-09-08 16:45 UTC, 18:45 Schweizer Zeit –
     frühestmöglicher Anstoss des ersten Abends) erlaubt, **Updates**
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

## 6) Testing-Checkliste (manuell)

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

---

## 7) Performance: Asset-Versionierung, Service Worker & Seitenwechsel

Ziel: Ein Seitenwechsel (index → Rangliste → Analyse …) kommt **komplett
ohne Netz-Roundtrip** aus – die App-Shell (HTML/JS/CSS/Kaderdaten) liegt
vollständig und versioniert im Service-Worker-Cache. Live-Daten sind davon
unabhängig: Punkte, Rangliste und Spiele kommen weiterhin über `cache.js`
versionsgeprüft aus Firestore (Meta-Dokument + Live-Listener).

### Eine Asset-Version für alles: `?v=__BUILD__`

Alle lokalen Script-/Stylesheet-/Daten-Referenzen der Nutzer-Seiten tragen
im Repo den Platzhalter `?v=__BUILD__`; dieselbe Marke steht als
`CACHE_VERSION = 'v__BUILD__'` im Service Worker. Beim Deploy ersetzt
`scripts/build-asset-versions.js` (läuft nach `build-firebase-config.js`,
siehe `netlify.toml`) den Platzhalter überall durch den **Commit-SHA**.
Folgen:

- **Eine Datei = eine URL = ein Cache-Eintrag.** Früher pflegte jede Seite
  eigene `?v=`-Strings (index `-13`, rangliste `-16`, spieleranalyse `-25`,
  …) – gemeinsame Dateien lagen dadurch mehrfach im Cache und wurden beim
  ersten Wechsel auf jede Seite erneut heruntergeladen.
- **Auch die grossen Brocken sind versioniert:** `data-*.js` (Kaderdatei),
  `admin.js`, `auth.js`, `auth-modal.js`, `view-mode.js`, Overrides usw.
  waren früher unversioniert und gingen bei **jedem** Seitenwechsel übers
  Netz (Revalidierung mit bis zu 3 s Timeout) – das war die Hauptursache
  der 1–2 s Ladezeit beim Navigieren.
- **Deploy = automatische Invalidierung.** Neue URLs + neue
  `CACHE_VERSION` → der neue SW installiert die Shell frisch, übernimmt
  per `skipWaiting`, und `nav.js` lädt die Seite beim `controllerchange`
  einmal neu. Manuelles Hochzählen entfällt.

`data.js` liest die Version aus dem `?v=` seines eigenen `<script>`-Tags
und reicht sie an die per `document.write` nachgeladenen Dateien weiter
(Kaderdatei, Positions-/Namens-Overrides, Namens-Kürzung); der
Kaderdatei-Preload im Pre-Flight jeder Seite hängt denselben Suffix an,
damit Preload und echter Request dieselbe URL treffen.

Regressionstest: `npm run test:versions`
(`scripts/test-asset-versions.js`) – schlägt fehl, sobald eine Referenz
den Platzhalter verliert oder ein externes Skript (ausser Firebase)
auftaucht.

### Service-Worker-Strategie

| Request                    | Strategie                                     |
| -------------------------- | --------------------------------------------- |
| Navigation (HTML)          | **stale-while-revalidate**: Cache antwortet sofort, Netz aktualisiert im Hintergrund |
| Asset mit `?v=` (gestempelt) | **cache-first** – kein Netz-Roundtrip        |
| Asset ohne `?v=` (Admin-Seiten) | network-first mit 3 s Timeout            |
| Bilder                     | stale-while-revalidate                        |

Dev-Modus: Läuft die Seite ungebaut (Platzhalter nicht ersetzt, z. B.
lokal), erkennt der SW das (`IS_DEV_BUILD`) und fällt für Navigationen und
versionierte Assets auf network-first zurück – Code-Änderungen bleiben
beim Entwickeln sofort sichtbar.

### Seitenübergänge & statische Navigation

- **Cross-Document View Transitions** (`@view-transition` in `styles.css`)
  ersetzen den harten Seitenwechsel durch einen kurzen Fade + leichtes
  Hochgleiten (110/230 ms). Das alte `<meta name="view-transition">` war
  ein wirkungsloser Origin-Trial-Rest. Browser ohne Unterstützung
  navigieren wie bisher; `prefers-reduced-motion` schaltet den Übergang
  komplett ab.
- **Die Navigationsleiste steht statisch im HTML** jeder Hauptseite
  (STATIC-NAV-Block direkt nach `<body>`): Sie wird mit dem ersten Frame
  gezeichnet (kein spätes Aufploppen mehr) und ist über
  `view-transition-name` aus dem Root-Übergang herausgelöst – bei
  Seitenwechseln wirkt sie wie eine feststehende App-Leiste. `nav.js`
  baut sie nicht mehr neu, sondern **hydriert** sie (Markenlabel aus
  `APP_CONFIG`, `?tournament=`-Parameter auf den Links, Auth-Knopf,
  Team-Builder-Status); Seiten ohne statisches Markup (liga-tabelle.html,
  Admin-Einstiege) bekommen sie weiterhin injiziert. Das Markenlabel wird
  vor dem ersten Paint von einem Mini-Inline-Skript aus
  `data-tournament` gefüllt (Spiegel der `shortLabel`-Werte).
  Regressionstest: `npm run test:staticnav`.
- **Skeletons statt Spinner:** Die Rangliste zeigt beim Laden eine
  Platzhalter-Vorschau des echten Layouts (Podium + Listenzeilen, Klasse
  `.skel` jetzt geteilt in `styles.css`); Fehlermeldungen ersetzen sie
  wie bisher.
- **Touch-Feedback:** Nav-Links, Pills und Toggles reagieren sofort auf
  den Tap (`:active`-Scale, eigener Ersatz für das graue Tap-Highlight).

### Prerendering (Speculation Rules, nur Chromium)

Jede Hauptseite trägt einen identischen `speculationrules`-Block im
`<head>`: Die vier meistgewechselten Seiten (Dashboard, Rangliste,
Analyse, Teams) werden **prerendert**, sobald ein Link angefasst wird
(`eagerness: moderate` = Hover bzw. Touch-Down); Punktesystem und
Team-Builder werden nur geprefetcht. Beim eigentlichen Tap ist die
Zielseite samt komplettem JS-Boot bereits fertig gerendert – auf
Android-Chrome fühlt sich der Wechsel damit augenblicklich an.
Safari/Firefox ignorieren den Block und fallen auf den SW-Cache-Pfad
zurück. Firestore-Reads beim Prerender deckelt der Session-Meta-Cache
(`cache.js`, 30 s). Konsistenz-Guard: Teil von `npm run test:staticnav`.

### Drittanbieter-Bibliotheken: lokal & gepinnt

- **Chart.js 4.5.0** liegt als `chart.umd.min.js` im Repo (vorher
  ungepinnt von jsdelivr). Die Rangliste lädt es **lazy**: erst wenn die
  Manager-Ansicht den Rangentwicklungs-Chart wirklich rendert
  (`ensureChartJs()` in `rangliste.js`); nach dem Boot wird die Datei per
  `fetch()` im Leerlauf in den SW-Cache vorgewärmt.
- **vanilla-tilt 1.8.0** liegt als `vanilla-tilt.min.js` im Repo (vorher
  cdnjs). Teams/Team-Builder binden es unverändert synchron ein.

Damit lädt ausser dem Firebase-SDK (gstatic, per HTTP-Cache langlebig)
kein Skript mehr von fremden Hosts.

### Kaderdatei-Format: kompaktes JSON, ohne tote Felder

Die Kaderdatei wird bei jedem Seitenaufruf synchron geparst – ihr Format
ist deshalb auf Parse-Geschwindigkeit optimiert
(`scripts/kader-serializer.js`, benutzt von beiden Generatoren):

- **`const playersData = JSON.parse('…')`** statt Objektliteral: kompaktes
  JSON ohne Pretty-Print-Whitespace (−120 KB bei `data-cl2627.js`), und
  `JSON.parse` eines Strings parst in allen Engines deutlich schneller als
  ein gleich grosses JS-Objektliteral.
- **Anzeige-tote Felder entfallen** (`Gewicht`, `Vorsaison.Minuten`,
  `Vorsaison.Spiele` – kein einziger Leser in App, Admin-Seiten oder
  Cron-Scripts). Die Generatoren berechnen sie weiterhin für Logging und
  Plausibilität, serialisieren sie aber nicht mehr. Wer eines wieder
  braucht: aus `DISPLAY_DEAD_FIELDS` nehmen und die Anzeige ergänzen.
- Alle Node-Konsumenten (Cron-Scripts, Tests) laden die Datei per
  `vm.runInContext` – das Format ist für sie transparent.
  `npm run test:cl2627-pool` prüft das Schema inklusive der Abwesenheit
  der toten Felder. **`data-wm2026.js` bleibt als Archiv eingefroren**
  (`test:freeze`), `data-cl2526.js` als historischer Teststand ebenso.

### App-Shell (app.html): Seitenwechsel ohne Neuladen

`app.html` + `shell.js` sind „Vorschlag E, Stufe 1": Die bestehenden
Seiten bleiben unveränderte, eigenständige Dokumente – die Shell lädt sie
als **persistente Frames** und blendet erst um, wenn die Zielseite fertig
gerendert ist. Bis dahin bleibt die alte Seite sichtbar und bedienbar
(dauert es >350 ms, erscheint eine Haarlinie unter der Navbar). Der
zuletzt besuchte Frame bleibt warm: Zurück ist augenblicklich, inklusive
Scrollposition und Zustand. Die Swap-Choreografie ist kritisch gedämpft
(340 ms, ohne Overshoot), vorwärts/rückwärts räumlich gespiegelt,
unterbrechbar (der jüngste Tap gewinnt, animiert ab dem aktuellen
Präsentationswert) und respektiert `prefers-reduced-motion`.

Warum Frames statt eines Seiten-Merges: Die Seitenskripte sind
unabhängige Vollseiten-Programme (globale Konstanten, Inline-Handler,
eigene History-Logik) mit kollidierenden CSS-Klassen. In eigenen
Dokumenten laufen sie **byte-identisch wie beim Direktaufruf** – die
Datenpfade verhalten sich exakt wie bisher (verifiziert: identische
Pipeline-Ergebnisse nackt vs. Shell). Bei jedem Fehler oder Timeout
fällt die Shell auf eine echte Navigation zurück.

Verdrahtung:

- Das Pre-Flight jeder Seite setzt `<html data-dt-embedded>`, sobald sie
  eingebettet läuft (`window.top ≠ window.self`); `styles.css` versteckt
  dann ihre Navigation und reserviert keinen Platz, `nav.js` überlässt
  Höhenmessung + SW-Registrierung der Shell. Direkt geöffnete Seiten
  (Deep-Links wie `teams.html?manager=…`) bleiben unverändert.
- Routen laufen als `app.html#/<seite>?<query>` – Reload landet wieder in
  der Shell. Interne Frame-Navigationen (Manager-Links etc.) synchronisiert
  der load-Listener zurück in Hash, Titel und aktiven Tab.
- Es leben höchstens 2 Frames (aktueller + letzter, LRU). Beide halten
  ihre Firestore-Meta-Listener – wie zwei offene Tabs heute; beim
  Zurückwechseln ist der Stand dadurch bereits aktuell.
- Einschränkung: der Ansichts-Umschalter (Vor-/Nach-Start) im Shell-Dropdown
  wirkt auf bereits geladene Frames erst nach deren Reload (Admin-Werkzeug).
  Der **Turnier-Wechsel** ist davon ausgenommen – er startet die App komplett
  neu (siehe unten).

**Stufe 2 (aktiv):** `/` liefert per Netlify-Rewrite (Status 200,
`force = true` gegen das Shadowing der index.html) die Shell; die
installierte PWA startet über `start_url: "/"` ebenfalls dort, und die
Manifest-Splash-Farben folgen dem CL-Theme.

**Stufe 3 (aktiv): nur noch die Shell.** Jeder **Direktaufruf** einer
Seite (alte Lesezeichen, geteilte Deep-Links wie `teams.html?manager=…`,
Homescreen-Installationen mit alter `start_url`) leitet im Pre-Flight
sofort in die Shell auf dieselbe Route weiter
(`app.html#/<seite>?<query>`) – die alte Voll-Navigation existiert für
Nutzer damit nicht mehr, und das Profil-/Auth-UI lädt beim Seitenwechsel
nie wieder neu. Die Query wird dabei **aufgeteilt**: `?tournament=`/
`?preview=` (Turnier-Kontext) und `?shelldebug=` wandern in die
app.html-URL, alle Seiten-Parameter (`?manager=`, `?view=` …) bleiben auf
der Hash-Route. Regeln:

- Weitergeleitet wird **nie im Frame** (`data-dt-embedded` – sonst
  Shell-in-Shell-Schleife) und nie auf `app.html` selbst.
- **`?standalone=1`** ist der bewusste Notausstieg: lädt die nackte
  Einzelseite (Debugging; der Parameter überlebt keine Navigation).
- Die Speculation Rules (früher Teil 3) sind entfernt – sie prerenderten
  die alte Vollansicht, die es nicht mehr gibt; im Shell-Modus übernimmt
  das Warmhalten der Frames diese Rolle.
- Die Seitenliste der Weiterleitung ist per Test deckungsgleich mit
  `PAGE_FILES` in shell.js (`npm run test:staticnav`).

**Turnier-Wechsel & Durchmischungsschutz.** Es darf nie passieren, dass
Shell-Leiste und Seiteninhalt verschiedene Turniere zeigen. Dafür greifen
vier Schichten ineinander (Guards: `npm run test:staticnav`, Abschnitt 6e):

1. **Wechsel = kompletter Neustart.** `setActiveTournament()`,
   `resetToDomainDefault()` und die Vorschau-Funktionen persistieren die
   Wahl und rufen `reloadWithCleanUrl()`: `location.replace("./")` auf dem
   **Top-Fenster** – Root, ohne Query, ohne Hash. Nie in place: In der
   Shell wäre ein Replace auf dieselbe URL samt `#/`-Hash nur eine
   Fragment-Navigation, also **gar kein Reload** (genau so fühlte sich der
   Wechsel früher „tot" an), und ein stehen gebliebener Hash mit
   `?tournament=` pinnte den Frame aufs alte Turnier (die Durchmischung).
2. **Links ohne Turnier-Parameter.** `nav.js`, `auth-modal.js` und die
   Speichern-Weiterleitungen in `team-builder.js` hängen `?tournament=`
   nur noch an, wenn wirklich ein **URL-Override** die Auflösung treibt
   (`APP.isUrlOverrideActive()`). Sonst lösen alle Dokumente ambient
   (localStorage/Domain) auf – identisch, ohne gepinnte Links.
3. **Die Shell besitzt den Turnier-Kontext.** shell.js entfernt
   `tournament`/`preview` aus **jeder** Route (Hash, Klicks, interne
   Frame-Navigationen) und reicht stattdessen die Parameter der eigenen
   app.html-URL an jeden Frame weiter – Leiste und Frames lösen damit
   garantiert aus denselben Eingaben auf, auch beim Admin-Deep-Link
   `/?tournament=…`.
4. **Wachhund.** Beim Frame-Load vergleicht shell.js `data-tournament`
   von Shell und Frame (beide Pre-Flights setzen es synchron im Head).
   Abweichung → Frame einmal bereinigt neu laden; hilft das nicht (z. B.
   Wechsel in einem zweiten Tab, die Leiste hier ist veraltet) → Neustart
   auf die Root; bringt auch das nichts (max. 2×/Sitzung,
   `dreamteam_shell_heal_restarts`) → Kaputt-Schalter + klassische
   Navigation, denn EIN Dokument kann nicht gemischt sein. Zähler im
   `?shelldebug=1`-Overlay: „Turnier-Heilungen", „Shell-Turnier" und
   das Turnier jedes Frames.

### Back/Forward-Cache (bfcache)

Rangliste, Spieleranalyse und Teams räumen ihre Listener bei `pagehide`
(nur bei echtem Verlassen, `persisted=false`) statt bei `beforeunload`
auf – damit nimmt auch Firefox die Seiten in den Back/Forward-Cache und
die Zurück-Navigation ist sofort da. Wandert eine Seite in den bfcache,
bleiben Meta-Listener bewusst aktiv: Firestore friert den Stream ein und
setzt ihn beim Restore fort, die `visibilitychange`/`focus`-Resume-Pfade
in `cache.js` holen dann frische Daten.
