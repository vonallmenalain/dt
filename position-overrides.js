// Positions-Overrides für DreamTeam
// Zuletzt aktualisiert: CL 2026/27 – Positions-Durchsicht nach dem
// Transferschluss (Pool-Stand 03.09.2026; Aussenverteidiger auf DEFENDER,
// Flügel/Angreifer auf ATTACKER; Herleitung im cl2627-Block).
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
    // Pools nach dem Transferschluss (Stand 03.09.2026). Drei Stufen, in
    // dieser Reihenfolge:
    //
    //   1. Kadermeldung. data-cl2627.js entsteht aus /players/squads – dem,
    //      was der Verein meldet. Das ist die Vorgabe und steht immer dann,
    //      wenn nichts dagegen spricht. Nach den Meldungen zum 01.09. ist
    //      sie deutlich besser als im August: Aussenverteidiger wie
    //      Abdulhamid, Bello oder Karavaev stehen jetzt von selbst auf
    //      DEFENDER, Bakayoko und Baena von selbst auf ATTACKER.
    //
    //   2. Einsatz-Beleg. api-football führt in den Saison-Statistiken pro
    //      Wettbewerb `games.position` – die tatsächlich gespielte Position.
    //      Der Generator hält sie gegen die Meldung und schreibt jede
    //      Abweichung nach scripts/cl-pool-cl2627-positions.json (118 von
    //      993 prüfbaren Spielern). Gefolgt wird dem Beleg nur in drei
    //      Richtungen und nur ab zwei Dritteln der Einsatzminuten:
    //
    //        MIDFIELDER → DEFENDER   (Mittelfeld gemeldet, hinten gespielt)
    //        MIDFIELDER → ATTACKER   (Mittelfeld gemeldet, vorne gespielt)
    //        DEFENDER   → ATTACKER   (Abwehr gemeldet, vorne gespielt)
    //
    //      Die Gegenrichtungen (ATTACKER → MIDFIELDER, DEFENDER →
    //      MIDFIELDER) bleiben bewusst aussen vor: das sind Flügelspieler
    //      und Aussenverteidiger, deren Einsätze im Mittelfeld verbucht
    //      sind – genau dort hat die Kadermeldung die bessere Antwort.
    //      Unter der Zwei-Drittel-Schwelle bleibt es ebenfalls bei der
    //      Meldung; betroffen sind u. a. Wesley (53 % hinten), Jobe
    //      Bellingham (57 % vorne) und Ole Didrik (64 % vorne).
    //
    //   3. Redaktionell. Für Flügelstürmer taugt auch der Beleg nichts –
    //      api-football kennt keinen eigenen Eimer für einen Linksaussen,
    //      Yamal, Olise, Gakpo und Luis Díaz stehen dort ebenfalls als
    //      Mittelfeld. Sieben solche Fälle sind von Hand ergänzt: Grealish,
    //      Lindstrøm, Zubkov, Kutesa, Mvuka, Barseghyan, Oğuz Aydın.
    //
    // Die Overrides hängen an der `player.id`, nicht am Klub – ein
    // Flügelspieler bleibt also auch nach einem Transfer ATTACKER. Einträge
    // für Spieler, die 26/27 nicht im Pool sind, sind stille No-ops. Neue
    // Fälle kommen über adm-position-overrides.html dazu oder direkt hier.
    cl2627: {
        "8543": "ATTACKER", // Aboubakary Koita
        "18767": "ATTACKER", // Ademola Lookman
        "182519": "ATTACKER", // Alberto Moleiro
        "30510": "ATTACKER", // Álex Berenguer
        "301528": "ATTACKER", // Andreas Schjelderup
        "138787": "ATTACKER", // Anthony Gordon
        "9971": "ATTACKER", // Antony
        "327897": "ATTACKER", // Arijon Ibrahimović
        "289661": "ATTACKER", // Artur Gajdoš
        "400948": "ATTACKER", // Assane Diao
        "630895": "ATTACKER", // Bara Ndiaye
        "63274": "ATTACKER", // Barış Alper Yılmaz
        "307835": "DEFENDER", // Beraldo
        "744": "ATTACKER", // Brahim Díaz
        "282126": "ATTACKER", // Carlos Forbs
        "24798": "ATTACKER", // Chris Führich
        "461130": "ATTACKER", // Christian Nwachukwu
        "247": "ATTACKER", // Cody Gakpo
        "1323": "ATTACKER", // Dani Olmo
        "1605": "ATTACKER", // Daniel Podence
        "66214": "DEFENDER", // David Douděra
        "26475": "ATTACKER", // Deniz Undav
        "48488": "ATTACKER", // Dereck Kutesa
        "19586": "ATTACKER", // Eberechi Eze
        "1358": "ATTACKER", // Eljif Elmas
        "19071": "ATTACKER", // Emiliano Buendía
        "135749": "ATTACKER", // Félix Correia
        "490759": "ATTACKER", // Flávio Gonçalves
        "643": "ATTACKER", // Gabriel Jesus
        "31624": "ATTACKER", // Gabriel Strefezza
        "118": "ATTACKER", // Gelson Martins
        "154839": "ATTACKER", // Geny Catamo
        "419582": "ATTACKER", // Geovany Quenda
        "323935": "ATTACKER", // Giuliano Simeone
        "406224": "ATTACKER", // Gleiker Mendoza
        "555416": "DEFENDER", // H. Kante
        "67889": "ATTACKER", // Hákon Haraldsson
        "39291": "ATTACKER", // Hugo Vetlesen
        "207": "ATTACKER", // Ivan Perišić
        "19187": "ATTACKER", // Jack Grealish
        "19163": "ATTACKER", // Jacob Murphy
        "39073": "ATTACKER", // Jens Hauge
        "1422": "ATTACKER", // Jérémy Doku
        "15884": "ATTACKER", // Jesper Lindstrøm
        "158551": "ATTACKER", // Joel Mvuka
        "406244": "ATTACKER", // Johan Manzambi
        "24868": "DEFENDER", // Josha Vagnoman
        "24845": "DEFENDER", // Julian Ryerson
        "7334": "ATTACKER", // Karim Adeyemi
        "127843": "ATTACKER", // Kelvin Ofori
        "142959": "ATTACKER", // Kerem Aktürkoğlu
        "386828": "ATTACKER", // Lamine Yamal
        "398194": "ATTACKER", // Lazar Jovanović
        "494131": "ATTACKER", // Lennart Karl
        "644": "ATTACKER", // Leroy Sané
        "162266": "ATTACKER", // Lucas da Cunha
        "2489": "ATTACKER", // Luis Díaz
        "10077": "ATTACKER", // Luis Henrique
        "14394": "ATTACKER", // Luka Ivanušec
        "66353": "ATTACKER", // Lukáš Provod
        "271609": "DEFENDER", // Lynnt Audoor
        "274300": "ATTACKER", // Maghnes Akliouche
        "386481": "ATTACKER", // Mamadou Diakhon
        "753": "DEFENDER", // Marcos Llorente
        "909": "ATTACKER", // Marcus Rashford
        "897": "ATTACKER", // Mason Greenwood
        "19220": "ATTACKER", // Mason Mount
        "219": "ATTACKER", // Matteo Politano
        "20525": "DEFENDER", // Matthieu Udol
        "410396": "ATTACKER", // Mattia Liberali
        "392506": "DEFENDER", // Mattia Mannini
        "158644": "ATTACKER", // Maximilian Beier
        "25342": "DEFENDER", // Maximilian Mittelstädt
        "51776": "ATTACKER", // Maximiliano Araújo
        "19617": "ATTACKER", // Michael Olise
        "18946": "ATTACKER", // Mohamed Elyounoussi
        "306": "ATTACKER", // Mohamed Salah
        "280074": "DEFENDER", // Nathaniel Brown
        "307123": "DEFENDER", // Nico O'Reilly
        "183799": "ATTACKER", // Nico Williams
        "350037": "ATTACKER", // Nicolás Paz
        "3246": "ATTACKER", // Nicolas Pépé
        "41194": "ATTACKER", // Nuno Santos
        "134590": "ATTACKER", // Oğuz Aydın
        "105320": "ATTACKER", // Oleksandr Zubkov
        "278133": "ATTACKER", // Oscar Bobb
        "1864": "ATTACKER", // Pedro Neto
        "631": "ATTACKER", // Philip Foden
        "18748": "ATTACKER", // Pote
        "1496": "ATTACKER", // Raphinha
        "156477": "ATTACKER", // Rayan Cherki
        "452685": "ATTACKER", // Rio Ngumoha
        "2598": "ATTACKER", // Ritsu Dōan
        "412084": "DEFENDER", // Rodrigo Fortes
        "10009": "ATTACKER", // Rodrygo
        "365018": "ATTACKER", // Ruben van Bommel
        "371025": "ATTACKER", // Sani Suleiman
        "409216": "ATTACKER", // Senny Mayulu
        "510": "ATTACKER", // Serge Gnabry
        "301771": "ATTACKER", // Simon Adingra
        "286075": "ATTACKER", // Suleiman Camara
        "51016": "ATTACKER", // Tajon Buchanan
        "12724": "ATTACKER", // Talisca
        "416250": "DEFENDER", // Theodore Carroll
        "2929": "ATTACKER", // Thorgan Hazard
        "56132": "ATTACKER", // Tigran Barseghyan
        "464563": "DEFENDER", // Tobias Moi
        "41112": "ATTACKER", // Trincão
        "338751": "ATTACKER", // Víctor Muñoz
        "762": "ATTACKER", // Vinícius Júnior
        "496738": "ATTACKER", // Wisdom Mike
        "308839": "ATTACKER", // Xander Severina
        "454": "ATTACKER", // Yunus Akgün
        "303684": "ATTACKER", // Yvan Dibango
        "39145": "ATTACKER" // Zlatko Tripić
    }
};
