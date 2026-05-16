// =====================================================================
//  Manuelle WM-2026-Kader-Overrides
// =====================================================================
//
//  Diese Datei "entkoppelt" handgepflegte Eingriffe vom automatisch
//  generierten Kader in `data-wm2026.js`, sodass
//  `adm-generate-kader-wm2026.html` jederzeit neu ausgeführt werden kann,
//  ohne dass die manuellen Korrekturen verloren gehen.
//
//  Drei Mechanismen:
//
//    1. MANUAL_ADD_PLAYERS
//       Spieler, die der API-Football-Squad (`/players/squads`)
//       *nicht* enthält, die aber zwingend ins WM-2026-Aufgebot
//       gehören (z.B. Stars in Verletzungspause, verspätete
//       Squad-Updates, Kapitäne). Diese werden nach dem regulären
//       API-Lauf eingefügt; bei `player.id`-Konflikt gewinnt der
//       manuelle Eintrag.
//
//    2. MANUAL_REMOVE_IDS
//       `player.id`-Werte, die nach dem API-Lauf entfernt werden
//       sollen (z.B. weil ein API-Squad noch jemanden mitführt,
//       der gar nicht mehr für die Nationalmannschaft spielt, oder
//       weil eine `player.id` mit einem anderen Spieler kollidiert).
//
//    3. MANUAL_NAME_OVERRIDES
//       Map `player.id` → korrigierter `Spielername`. Greift
//       *nach* der API-Namensauflösung (`buildCleanName`). Damit
//       können einzelne Schreibweisen geradegezogen werden, ohne
//       dass der gesamte Datensatz nachbearbeitet werden muss.
//
//  WICHTIG zu Sonderzeichen / Diakritika:
//    Diese Datei nimmt KEINE pauschale Normalisierung der Namen
//    (Dembélé → Dembele etc.) vor. Originalnamen mit Akzenten,
//    Tilden, Háčeks usw. werden absichtlich beibehalten — die
//    Suche im Frontend ist seit der Verbesserung in #...
//    diakritikatolerant.
//
//  Diese Datei wird gelesen von:
//    - adm-generate-kader-wm2026.html (zur Generier-Zeit)
//    - scripts/apply-manual-overlay-wm2026.mjs
//      (CLI-Anwendung des Overlays auf bestehende data-wm2026.js)
//
//  Hinweis zu den Pseudo-IDs >= 9_000_000:
//    Diese werden vergeben, wenn ein Spieler in API-Football
//    (noch) keine eindeutige ID hat oder die Squad-Listen ihn
//    nicht führen. Pseudo-IDs dürfen mit echten API-Sports-IDs
//    nicht kollidieren. Sobald die API für einen Spieler eine
//    echte ID liefert, sollte die manuelle Pseudo-ID gegen die
//    echte ausgetauscht werden, damit beim nächsten Generator-
//    Lauf nicht zwei Einträge desselben Spielers entstehen.
//
// =====================================================================

(function (root) {
    'use strict';

    /* ------------------------------------------------------------------
     *  1) MANUEL HINZUGEFÜGTE SPIELER
     * ------------------------------------------------------------------
     *
     *  Format: identisch zu den Einträgen in data-wm2026.js
     *  (Spielername, Spielerfoto, Position, Nationalteam.name/logo,
     *  Club.name/logo, Geburtsdatum, Groesse, Gewicht).
     *
     *  Reihenfolge in dieser Liste ist egal — der Generator sortiert
     *  am Ende nach (Nationalteam, Spielername).
     * ------------------------------------------------------------------ */

    var MANUAL_ADD_PLAYERS = [
        /* ---------- Ergänzungen aus PR #166 (7.5.2026) ----------------
         * Diese 11 Spieler fehlen regelmäßig in /players/squads
         * (häufig wegen Verletzungspause oder verzögertem Squad-Update). */
        {
            "player.id": 9000003,
            "Spielername": "Alejandro Garnacho",
            "Spielerfoto": "https://upload.wikimedia.org/wikipedia/commons/a/ab/Alejandro_Garnacho_7_August_2022_%28cropped%29.jpg",
            "Position": "ATTACKER",
            "Nationalteam.name": "Argentina",
            "Nationalteam.logo": "https://media.api-sports.io/football/teams/26.png",
            "Club.name": "Chelsea",
            "Club.logo": "https://media.api-sports.io/football/teams/49.png",
            "Geburtsdatum": "2004-07-01",
            "Groesse": "180",
            "Gewicht": "70"
        },
        {
            "player.id": 907,
            "Spielername": "Romelu Lukaku",
            "Spielerfoto": "https://media.api-sports.io/football/players/907.png",
            "Position": "ATTACKER",
            "Nationalteam.name": "Belgium",
            "Nationalteam.logo": "https://media.api-sports.io/football/teams/1.png",
            "Club.name": "Napoli",
            "Club.logo": "https://media.api-sports.io/football/teams/492.png",
            "Geburtsdatum": "1993-05-13",
            "Groesse": "191",
            "Gewicht": "93"
        },
        {
            "player.id": 280,
            "Spielername": "Alisson Becker",
            "Spielerfoto": "https://media.api-sports.io/football/players/280.png",
            "Position": "GOALKEEPER",
            "Nationalteam.name": "Brazil",
            "Nationalteam.logo": "https://media.api-sports.io/football/teams/6.png",
            "Club.name": "Liverpool",
            "Club.logo": "https://media.api-sports.io/football/teams/40.png",
            "Geburtsdatum": "1992-10-02",
            "Groesse": "193",
            "Gewicht": "91"
        },
        {
            "player.id": 283,
            "Spielername": "Trent Alexander-Arnold",
            "Spielerfoto": "https://media.api-sports.io/football/players/283.png",
            "Position": "DEFENDER",
            "Nationalteam.name": "England",
            "Nationalteam.logo": "https://media.api-sports.io/football/teams/10.png",
            "Club.name": "Real Madrid",
            "Club.logo": "https://media.api-sports.io/football/teams/541.png",
            "Geburtsdatum": "1998-10-07",
            "Groesse": "175",
            "Gewicht": "67"
        },
        {
            "player.id": 181812,
            "Spielername": "Jamal Musiala",
            "Spielerfoto": "https://media.api-sports.io/football/players/181812.png",
            "Position": "MIDFIELDER",
            "Nationalteam.name": "Germany",
            "Nationalteam.logo": "https://media.api-sports.io/football/teams/25.png",
            "Club.name": "Bayern München",
            "Club.logo": "https://media.api-sports.io/football/teams/157.png",
            "Geburtsdatum": "2003-02-26",
            "Groesse": "184",
            "Gewicht": "72"
        },
        {
            "player.id": 25391,
            "Spielername": "Niclas Füllkrug",
            "Spielerfoto": "https://media.api-sports.io/football/players/25391.png",
            "Position": "ATTACKER",
            "Nationalteam.name": "Germany",
            "Nationalteam.logo": "https://media.api-sports.io/football/teams/25.png",
            "Club.name": "West Ham",
            "Club.logo": "https://media.api-sports.io/football/teams/48.png",
            "Geburtsdatum": "1993-02-09",
            "Groesse": "189",
            "Gewicht": "83"
        },
        {
            "player.id": 753,
            "Spielername": "Martin Ødegaard",
            "Spielerfoto": "https://media.api-sports.io/football/players/753.png",
            "Position": "MIDFIELDER",
            "Nationalteam.name": "Norway",
            "Nationalteam.logo": "https://media.api-sports.io/football/teams/1090.png",
            "Club.name": "Arsenal",
            "Club.logo": "https://media.api-sports.io/football/teams/42.png",
            "Geburtsdatum": "1998-12-17",
            "Groesse": "178",
            "Gewicht": "68"
        },
        {
            "player.id": 733,
            "Spielername": "Dani Carvajal",
            "Spielerfoto": "https://media.api-sports.io/football/players/733.png",
            "Position": "DEFENDER",
            "Nationalteam.name": "Spain",
            "Nationalteam.logo": "https://media.api-sports.io/football/teams/9.png",
            "Club.name": "Real Madrid",
            "Club.logo": "https://media.api-sports.io/football/teams/541.png",
            "Geburtsdatum": "1992-01-11",
            "Groesse": "173",
            "Gewicht": "73"
        },
        {
            "player.id": 9000001,
            "Spielername": "Gavi",
            "Spielerfoto": "https://upload.wikimedia.org/wikipedia/commons/2/2d/Gavi_%28footballer%29.jpg",
            "Position": "MIDFIELDER",
            "Nationalteam.name": "Spain",
            "Nationalteam.logo": "https://media.api-sports.io/football/teams/9.png",
            "Club.name": "Barcelona",
            "Club.logo": "https://media.api-sports.io/football/teams/529.png",
            "Geburtsdatum": "2004-08-05",
            "Groesse": "173",
            "Gewicht": "70"
        },
        {
            "player.id": 183799,
            "Spielername": "Nico Williams",
            "Spielerfoto": "https://media.api-sports.io/football/players/183799.png",
            "Position": "ATTACKER",
            "Nationalteam.name": "Spain",
            "Nationalteam.logo": "https://media.api-sports.io/football/teams/9.png",
            "Club.name": "Athletic Club",
            "Club.logo": "https://media.api-sports.io/football/teams/531.png",
            "Geburtsdatum": "2002-07-12",
            "Groesse": "181",
            "Gewicht": "67"
        },
        {
            "player.id": 9000002,
            "Spielername": "Tyler Adams",
            "Spielerfoto": "https://upload.wikimedia.org/wikipedia/commons/8/81/Tyler_Adams_WC2022.jpg",
            "Position": "MIDFIELDER",
            "Nationalteam.name": "USA",
            "Nationalteam.logo": "https://media.api-sports.io/football/teams/2384.png",
            "Club.name": "Bournemouth",
            "Club.logo": "https://media.api-sports.io/football/teams/35.png",
            "Geburtsdatum": "1999-02-14",
            "Groesse": "175",
            "Gewicht": "70"
        },

        /* ---------- Ergänzungen 16.5.2026: WM-Star-Lücken --------------
         * Spieler, die /players/squads aktuell nicht zurückliefert, die
         * aber als DreamTeam-relevante Stars zwingend ins Aufgebot
         * gehören. Pseudo-IDs ab 9_000_004 vergeben.
         * Quellen Spielerfoto: bevorzugt das offizielle API-Sports-
         * Profilfoto (media.api-sports.io/football/players/<echte-id>.png)
         * — sofern für den Spieler eine echte API-Sports-ID existiert,
         * obwohl /players/squads ihn aktuell nicht ausspielt. Andernfalls
         * Wikimedia Commons via Special:FilePath. */
        {
            "player.id": 9000004,
            "Spielername": "Alphonso Davies",
            "Spielerfoto": "https://media.api-sports.io/football/players/19063.png",
            "Position": "DEFENDER",
            "Nationalteam.name": "Canada",
            "Nationalteam.logo": "https://media.api-sports.io/football/teams/5529.png",
            "Club.name": "Bayern München",
            "Club.logo": "https://media.api-sports.io/football/teams/157.png",
            "Geburtsdatum": "2000-11-02",
            "Groesse": "183",
            "Gewicht": "75"
        },
        {
            "player.id": 9000005,
            "Spielername": "Dejan Kulusevski",
            "Spielerfoto": "https://commons.wikimedia.org/wiki/Special:FilePath/Dejan%20Kulusevski%202022.jpg",
            "Position": "MIDFIELDER",
            "Nationalteam.name": "Sweden",
            "Nationalteam.logo": "https://media.api-sports.io/football/teams/5.png",
            "Club.name": "Tottenham",
            "Club.logo": "https://media.api-sports.io/football/teams/47.png",
            "Geburtsdatum": "2000-04-25",
            "Groesse": "186",
            "Gewicht": "75"
        },
        {
            "player.id": 9000006,
            "Spielername": "Santiago Giménez",
            "Spielerfoto": "https://commons.wikimedia.org/wiki/Special:FilePath/Santiago%20Gim%C3%A9nez%20-%202023.jpg",
            "Position": "ATTACKER",
            "Nationalteam.name": "Mexico",
            "Nationalteam.logo": "https://media.api-sports.io/football/teams/16.png",
            "Club.name": "AC Milan",
            "Club.logo": "https://media.api-sports.io/football/teams/489.png",
            "Geburtsdatum": "2001-04-18",
            "Groesse": "183",
            "Gewicht": "78"
        },
        {
            "player.id": 9000007,
            "Spielername": "Chris Wood",
            "Spielerfoto": "https://commons.wikimedia.org/wiki/Special:FilePath/Chris%20Wood%2C%20Nottingham%20Forest%2C%202025.jpg",
            "Position": "ATTACKER",
            "Nationalteam.name": "New Zealand",
            "Nationalteam.logo": "https://media.api-sports.io/football/teams/4673.png",
            "Club.name": "Nottingham Forest",
            "Club.logo": "https://media.api-sports.io/football/teams/65.png",
            "Geburtsdatum": "1991-12-07",
            "Groesse": "191",
            "Gewicht": "82"
        },
        {
            "player.id": 9000008,
            "Spielername": "Sardar Azmoun",
            "Spielerfoto": "https://commons.wikimedia.org/wiki/Special:FilePath/Sardar%20Azmoun%202021.jpg",
            "Position": "ATTACKER",
            "Nationalteam.name": "Iran",
            "Nationalteam.logo": "https://media.api-sports.io/football/teams/22.png",
            "Club.name": "Shabab Al Ahli Dubai",
            "Club.logo": "https://media.api-sports.io/football/teams/2870.png",
            "Geburtsdatum": "1995-01-01",
            "Groesse": "186",
            "Gewicht": "78"
        },
        {
            "player.id": 9000009,
            "Spielername": "Neymar",
            "Spielerfoto": "https://media.api-sports.io/football/players/276.png",
            "Position": "ATTACKER",
            "Nationalteam.name": "Brazil",
            "Nationalteam.logo": "https://media.api-sports.io/football/teams/6.png",
            "Club.name": "Santos",
            "Club.logo": "https://media.api-sports.io/football/teams/128.png",
            "Geburtsdatum": "1992-02-05",
            "Groesse": "175",
            "Gewicht": "68"
        },
        {
            "player.id": 9000010,
            "Spielername": "Sávio",
            "Spielerfoto": "https://commons.wikimedia.org/wiki/Special:FilePath/Palermo%20FC%20v%20Manchester%20City%20FC%2C%209%20August%202025%20-%2041%20%28Savinho%29.jpg",
            "Position": "ATTACKER",
            "Nationalteam.name": "Brazil",
            "Nationalteam.logo": "https://media.api-sports.io/football/teams/6.png",
            "Club.name": "Manchester City",
            "Club.logo": "https://media.api-sports.io/football/teams/50.png",
            "Geburtsdatum": "2004-04-10",
            "Groesse": "176",
            "Gewicht": "66"
        },
        {
            "player.id": 9000011,
            "Spielername": "Ayyoub Bouaddi",
            "Spielerfoto": "https://commons.wikimedia.org/wiki/Special:FilePath/Ayyoub%20Bouaddi.jpg",
            "Position": "MIDFIELDER",
            "Nationalteam.name": "Morocco",
            "Nationalteam.logo": "https://media.api-sports.io/football/teams/31.png",
            "Club.name": "Lille",
            "Club.logo": "https://media.api-sports.io/football/teams/79.png",
            "Geburtsdatum": "2007-10-02",
            "Groesse": "180",
            "Gewicht": "-"
        },
        {
            "player.id": 9000012,
            "Spielername": "Simon Adingra",
            "Spielerfoto": "https://commons.wikimedia.org/wiki/Special:FilePath/Simon%20Adingra%20USG%202023%20cropped.jpg",
            "Position": "ATTACKER",
            "Nationalteam.name": "Ivory Coast",
            "Nationalteam.logo": "https://media.api-sports.io/football/teams/1501.png",
            "Club.name": "Sunderland",
            "Club.logo": "https://media.api-sports.io/football/teams/746.png",
            "Geburtsdatum": "2002-01-08",
            "Groesse": "178",
            "Gewicht": "70"
        },
        {
            "player.id": 9000013,
            "Spielername": "Wilfried Singo",
            "Spielerfoto": "https://commons.wikimedia.org/wiki/Special:FilePath/Singo%20asse%20asm%202425.png",
            "Position": "DEFENDER",
            "Nationalteam.name": "Ivory Coast",
            "Nationalteam.logo": "https://media.api-sports.io/football/teams/1501.png",
            "Club.name": "Galatasaray",
            "Club.logo": "https://media.api-sports.io/football/teams/645.png",
            "Geburtsdatum": "2000-12-25",
            "Groesse": "190",
            "Gewicht": "85"
        },
        {
            "player.id": 9000014,
            "Spielername": "Jhon Durán",
            "Spielerfoto": "https://commons.wikimedia.org/wiki/Special:FilePath/Jhon%20Dur%C3%A1n%2C%20Esteghlal%20FC%20vs%20Al-Nassr%20FC%20%28ACLElite%29%3B%203%20Mar%202025.png",
            "Position": "ATTACKER",
            "Nationalteam.name": "Colombia",
            "Nationalteam.logo": "https://media.api-sports.io/football/teams/8.png",
            "Club.name": "Fenerbahçe",
            "Club.logo": "https://media.api-sports.io/football/teams/611.png",
            "Geburtsdatum": "2003-12-13",
            "Groesse": "185",
            "Gewicht": "82"
        },
        {
            "player.id": 9000015,
            "Spielername": "Takehiro Tomiyasu",
            "Spielerfoto": "https://commons.wikimedia.org/wiki/Special:FilePath/Takehiro%20Tomiyasu.jpg",
            "Position": "DEFENDER",
            "Nationalteam.name": "Japan",
            "Nationalteam.logo": "https://media.api-sports.io/football/teams/12.png",
            "Club.name": "Arsenal",
            "Club.logo": "https://media.api-sports.io/football/teams/42.png",
            "Geburtsdatum": "1998-11-05",
            "Groesse": "188",
            "Gewicht": "70"
        }
    ];

    /* ------------------------------------------------------------------
     *  2) MANUEL ENTFERNTE PLAYER-IDs
     * ------------------------------------------------------------------
     *
     *  Aktuell leer.
     *
     *  Hintergrund: Marcos Llorente wurde in PR #170 entfernt, weil er
     *  in der manuell gepflegten Ursprungsdatei die falsche `player.id`
     *  753 trug (was Martin Ødegaards API-Sports-ID ist). Diese Kollision
     *  kann durch eine Neu-Generierung gar nicht entstehen, weil
     *  /players/squads ihn nicht zurückgibt und seine echte API-ID nicht
     *  in MANUAL_ADD_PLAYERS auftaucht. Deshalb ist hier nichts zu tun.
     *
     *  Format-Beispiel:
     *      var MANUAL_REMOVE_IDS = [12345, 67890];
     * ------------------------------------------------------------------ */

    var MANUAL_REMOVE_IDS = [];

    /* ------------------------------------------------------------------
     *  3) MANUELLE NAMENS-OVERRIDES
     * ------------------------------------------------------------------
     *
     *  Map `player.id` (Number) → korrigierter `Spielername` (String).
     *  Wird *nach* `buildCleanName(...)` angewendet, gewinnt also.
     *
     *  Pflege-Hinweise:
     *    - NICHT für pauschale Diakritika-Säuberung verwenden!
     *      Originalnamen wie "Ousmane Dembélé", "Vinícius Júnior",
     *      "Martin Ødegaard" oder "Bruno Guimarães" sollen erhalten
     *      bleiben, weil die App-Suche diakritikatolerant ist.
     *    - Nur für *echte* Schreibfehler oder offiziell abweichende
     *      Künstler-/Verbandsnamen, die die API nicht liefert.
     *    - HTML-Entitäten (`&apos;`, `&#039;`) und Mojibake-Artefakte
     *      (`Ã¯`, `Ã©` …) gehören hier nur dann hinein, wenn der
     *      Generator-Code (`buildCleanName`) sie nicht selbst sauber
     *      auflöst. Idealerweise wird der Generator zuerst gefixt.
     * ------------------------------------------------------------------ */

    var MANUAL_NAME_OVERRIDES = {
        // Christian Pulisic: API-Football liefert "Christian Pulišić"
        // (Slowenische Schreibweise seiner Vorfahren). Er selbst und die
        // U.S. Soccer Federation nutzen jedoch ausschließlich "Pulisic".
        17: "Christian Pulisic",

        // -------------- Frankreich --------------
        // API-Football liefert für Ousmane Dembélé teilweise einen
        // verstümmelten Vornamen ("Masour" o.ä.); offizieller Verbandsname
        // ist "Ousmane Dembélé".
        153: "Ousmane Dembélé",
        // Dayotchanculle Upamecano wird offiziell als "Dayot Upamecano"
        // geführt (FFF / UEFA / FIFA).
        1149: "Dayot Upamecano",

        // -------------- Mexiko --------------
        // "Francisco" ist sein Zweitname; bekannt und offiziell registriert
        // ist er als "Guillermo Ochoa".
        2098: "Guillermo Ochoa",

        // -------------- Algerien --------------
        // API liefert "Amir Bensebaïni"; FAF & UEFA führen ihn als
        // "Ramy Bensebaini".
        2194: "Ramy Bensebaini",

        // -------------- Iran --------------
        // API-Vorname "Sayed" stammt aus seinem Ehrentitel; offiziell ist
        // er als "Saman Ghoddos" registriert.
        2699: "Saman Ghoddos",
        // API liefert "Mohammad Kanani"; offiziell und in iranischen
        // Verbandsdokumenten "Hossein Kanaanizadegan".
        2687: "Hossein Kanaanizadegan",

        // -------------- Elfenbeinküste --------------
        // Encoding-Artefakt ("OulaÃ¯" = UTF-8 als Latin-1 fehlinterpretiert);
        // korrekt ist "Christ Inao Oulaï".
        474591: "Christ Inao Oulaï",

        // -------------- England --------------
        // HTML-Entität (&apos;) in API-Antwort; korrekt mit typografischem
        // Apostroph "Nico O’Reilly".
        307123: "Nico O’Reilly",

        // -------------- Usbekistan --------------
        // HTML-Entität (&apos;) in API-Antwort; offiziell laut FFU
        // mit usbekischem Schrägstrich-Apostroph "Oston Oʻrunov".
        72127: "Oston Oʻrunov",
        // HTML-Entität (&apos;) in API-Antwort; typografischer Apostroph
        // "Abduvohid Ne’matov" als Fallback (Usbekisch wäre "Neʼmatov",
        // hier bewusst dezent).
        73507: "Abduvohid Ne’matov",

        // -------------- Australien --------------
        // HTML-Entität in API-Antwort.
        7050: "Aiden O’Neill",

        // -------------- Jordanien --------------
        // HTML-Entität in API-Antwort; Spieler heißt offiziell
        // "Baha’ Faisal" (oder "Bahaa Faisal").
        53913: "Baha’ Faisal",

        // -------------- Ecuador --------------
        // API-Vorname "Ray" ist eine Verkürzung; offiziell führt der
        // Verband und der Spieler selbst "Kendry Páez".
        406303: "Kendry Páez"
    };

    var api = {
        addPlayers: MANUAL_ADD_PLAYERS,
        removeIds: MANUAL_REMOVE_IDS,
        nameOverrides: MANUAL_NAME_OVERRIDES
    };

    if (root && typeof root === 'object') {
        root.MANUAL_KADER_WM2026 = api;
    }
    if (typeof module !== 'undefined' && module.exports) {
        module.exports = api;
    }
})(typeof window !== 'undefined' ? window : (typeof globalThis !== 'undefined' ? globalThis : this));
