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
     *  Hinweis zu den Pseudo-IDs >= 9_000_000:
     *  Diese werden vergeben, wenn ein Spieler in API-Football
     *  (noch) keine eindeutige ID hat oder die Squad-Listen ihn nicht
     *  führen. Pseudo-IDs dürfen mit echten API-Sports-IDs nicht
     *  kollidieren.
     *
     *  Stand: Ergänzungen aus PR #166 (7.5.2026):
     *  Diese 11 Spieler fehlen regelmäßig in /players/squads (häufig
     *  wegen Verletzungspause oder verzögertem Squad-Update).
     * ------------------------------------------------------------------ */

    var MANUAL_ADD_PLAYERS = [
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
     * ------------------------------------------------------------------ */

    var MANUAL_NAME_OVERRIDES = {
        // Christian Pulisic: API-Football liefert "Christian Pulišić"
        // (Slowenische Schreibweise seiner Vorfahren). Er selbst und die
        // U.S. Soccer Federation nutzen jedoch ausschließlich "Pulisic".
        17: "Christian Pulisic"
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
