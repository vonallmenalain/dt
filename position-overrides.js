// Positions-Overrides für DreamTeam
// Zuletzt aktualisiert: CL 2025/26 – Flügel/Angreifer, die von der API als
// Mittelfeld geführt werden, auf ATTACKER gesetzt (siehe cl2526-Block).
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
    }
};
