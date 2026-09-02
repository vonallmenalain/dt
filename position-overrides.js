// Positions-Overrides für DreamTeam
// Zuletzt aktualisiert: CL 2026/27 – Positions-Durchsicht des Vorschau-Pools
// (Aussenverteidiger auf DEFENDER, Flügel/Angreifer auf ATTACKER; siehe
// cl2627-Block).
//
// Struktur: pro Turnier ein Top-Level-Key (wm2026, cl2526, …) mit
// `player.id -> Position`. `data.js` wählt anhand von
// `APP_CONFIG.activeTournamentKey` automatisch den passenden Block und wendet
// ihn zur Ladezeit an (die WM-Ansichten bleiben unberührt). Die Admin-Seite
// adm-position-overrides.html erzeugt/erhält diese Blöcke turnierübergreifend.

window.POSITION_OVERRIDES = {
    wm2026: {
        644: "ATTACKER",
        291964: "MIDFIELDER"
    },

    // CL 2025/26: klassische Flügelspieler/Angreifer, die von API-Football als
    // MIDFIELDER geliefert werden, für das Spiel als Stürmer (ATTACKER) führen.
    cl2526: {
        "30510": "ATTACKER", // Álex Berenguer
        "301528": "ATTACKER", // Andreas Schjelderup
        "247": "ATTACKER", // Cody Mathès Gakpo
        "1323": "ATTACKER", // Dani Olmo
        "1605": "ATTACKER", // Daniel Podence
        "643": "ATTACKER", // Gabriel Jesus
        "31624": "ATTACKER", // Gabriel Strefezza
        "118": "ATTACKER", // Gelson Martins
        "419582": "ATTACKER", // Geovany Tcherno Quenda
        "323935": "ATTACKER", // Giuliano Simeone
        "207": "ATTACKER", // Ivan Perišić
        "19163": "ATTACKER", // Jacob Kai Murphy
        "1422": "ATTACKER", // Jérémy Baffour Doku
        "386828": "ATTACKER", // Lamine Yamal
        "644": "ATTACKER", // Leroy Aziz Sané
        "2489": "ATTACKER", // Luis Díaz
        "909": "ATTACKER", // Marcus Rashford
        "897": "ATTACKER", // Mason Greenwood
        "219": "ATTACKER", // Matteo Politano
        "19617": "ATTACKER", // Michael Olise
        "18946": "ATTACKER", // Mohamed Amine Elyounoussi
        "306": "ATTACKER", // Mohamed Salah
        "183799": "ATTACKER", // Nico Williams
        "3246": "ATTACKER", // Nicolas Pépé
        "278133": "ATTACKER", // Oscar Bobb
        "1864": "ATTACKER", // Pedro Neto
        "1496": "ATTACKER", // Raphinha
        "2598": "ATTACKER", // Ritsu Dōan
        "10009": "ATTACKER", // Rodrygo
        "510": "ATTACKER", // Serge David Gnabry
        "301771": "ATTACKER", // Simon Adingra
        "41112": "ATTACKER", // Trincão
        "454": "ATTACKER" // Yunus Akgün
    },

    // CL 2026/27: Basis ist der cl2526-Block; dazu die Durchsicht des
    // Vorschau-Pools (Stand 27.08.2026). Zwei Quellen:
    //
    //   * Einsatz-Beleg. data-cl2526.js entsteht aus den tatsächlich
    //     gespielten CL-Einsätzen (games.position), data-cl2627.js dagegen
    //     aus der Kader-Meldung des Vereins (/players/squads). Wo beide
    //     auseinandergehen, gilt der Einsatz – so kommen die fünf
    //     DEFENDER-Einträge (Llorente, Ryerson, Douděra, Brown, O'Reilly)
    //     und u. a. Vinícius Júnior als ATTACKER zustande.
    //   * Redaktionell. Für Flügelstürmer taugt auch der Einsatz-Beleg
    //     nichts – Yamal, Olise, Gakpo und Luis Díaz stehen dort ebenfalls
    //     als Mittelfeld. Flügelspieler und offensive Grenzfälle werden
    //     deshalb bewusst als ATTACKER geführt.
    //
    // Schienenspieler einer Dreierkette (Dimarco, Svensson, Wesley, Udol,
    // Catamo) bleiben absichtlich MIDFIELDER und stehen daher NICHT hier.
    //
    // Die Overrides hängen an der `player.id`, nicht am Klub – ein
    // Flügelspieler bleibt also auch nach einem Transfer ATTACKER. Einträge
    // für Spieler, die 26/27 nicht im Pool sind, sind stille No-ops. Neue
    // Fälle aus dem 26/27-Kader kommen über adm-position-overrides.html dazu.
    cl2627: {
        "8543": "ATTACKER", // Aboubakary Koita
        "182519": "ATTACKER", // Alberto Moleiro
        "30510": "ATTACKER", // Álex Berenguer
        "301528": "ATTACKER", // Andreas Schjelderup
        "9971": "ATTACKER", // Antony
        "327897": "ATTACKER", // Arijon Ibrahimović
        "63274": "ATTACKER", // Barış Alper Yılmaz
        "744": "ATTACKER", // Brahim Díaz
        "282126": "ATTACKER", // Carlos Forbs
        "24798": "ATTACKER", // Chris Führich
        "247": "ATTACKER", // Cody Gakpo
        "1323": "ATTACKER", // Dani Olmo
        "1605": "ATTACKER", // Daniel Podence
        "66214": "DEFENDER", // David Douděra
        "26475": "ATTACKER", // Deniz Undav
        "19586": "ATTACKER", // Eberechi Eze
        "1358": "ATTACKER", // Eljif Elmas
        "19071": "ATTACKER", // Emiliano Buendía
        "490759": "ATTACKER", // Flávio Gonçalves
        "643": "ATTACKER", // Gabriel Jesus
        "31624": "ATTACKER", // Gabriel Strefezza
        "118": "ATTACKER", // Gelson Martins
        "419582": "ATTACKER", // Geovany Tcherno Quenda
        "323935": "ATTACKER", // Giuliano Simeone
        "67889": "ATTACKER", // Hákon Haraldsson
        "39291": "ATTACKER", // Hugo Vetlesen
        "207": "ATTACKER", // Ivan Perišić
        "19163": "ATTACKER", // Jacob Kai Murphy
        "1422": "ATTACKER", // Jérémy Doku
        "406244": "ATTACKER", // Johan Manzambi
        "24845": "DEFENDER", // Julian Ryerson
        "7334": "ATTACKER", // Karim-David Adeyemi
        "142959": "ATTACKER", // Kerem Aktürkoğlu
        "386828": "ATTACKER", // Lamine Yamal
        "494131": "ATTACKER", // Lennart Karl
        "644": "ATTACKER", // Leroy Sané
        "162266": "ATTACKER", // Lucas da Cunha
        "2489": "ATTACKER", // Luis Díaz
        "274300": "ATTACKER", // Maghnes Akliouche
        "386481": "ATTACKER", // Mamadou Diakhon
        "753": "DEFENDER", // Marcos Llorente
        "909": "ATTACKER", // Marcus Rashford
        "897": "ATTACKER", // Mason Greenwood
        "219": "ATTACKER", // Matteo Politano
        "19617": "ATTACKER", // Michael Olise
        "18946": "ATTACKER", // Mohamed Amine Elyounoussi
        "306": "ATTACKER", // Mohamed Salah
        "280074": "DEFENDER", // Nathaniel Brown
        "307123": "DEFENDER", // Nico O'Reilly
        "183799": "ATTACKER", // Nico Williams
        "350037": "ATTACKER", // Nicolás Paz
        "3246": "ATTACKER", // Nicolas Pépé
        "278133": "ATTACKER", // Oscar Bobb
        "1864": "ATTACKER", // Pedro Neto
        "631": "ATTACKER", // Philip Foden
        "18748": "ATTACKER", // Pote
        "1496": "ATTACKER", // Raphinha
        "156477": "ATTACKER", // Rayan Cherki
        "452685": "ATTACKER", // Rio Ngumoha
        "2598": "ATTACKER", // Ritsu Dōan
        "10009": "ATTACKER", // Rodrygo
        "409216": "ATTACKER", // Senny Mayulu
        "510": "ATTACKER", // Serge Gnabry
        "301771": "ATTACKER", // Simon Adingra
        "12724": "ATTACKER", // Talisca
        "2929": "ATTACKER", // Thorgan Hazard
        "41112": "ATTACKER", // Trincão
        "762": "ATTACKER", // Vinícius Júnior
        "496738": "ATTACKER", // Wisdom Mike
        "454": "ATTACKER" // Yunus Akgün
    }
};
