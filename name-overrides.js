// Namens-Overrides für DreamTeam (Anzeigename `Spielername`).
//
// Analog zu position-overrides.js: turnierspezifisch, je `player.id`.
// Wird in data.js NACH dem Laden der Kaderdatei angewendet – BEVOR
// irgendeine App-Logik (cache.js, Team-Builder, Rangliste, …) auf
// playersData zugreift. So greifen Namens-Korrekturen sofort in der ganzen
// App, ohne die auto-generierte Kaderdatei (z.B. data-cl2526.js) von Hand
// zu editieren (die trägt bewusst „nicht von Hand editieren").
//
// Der ursprüngliche Name wird in `player.SpielernameOriginal` gesichert.
// Rein additiv: fehlt ein Turnier-Block, ist dies ein No-op (die WM ist
// nie betroffen).
window.NAME_OVERRIDES = {
    cl2526: {
        184:   "Harry Kane",        // war: Harry Edward Kane
        16367: "William Pacho",     // war: Willian Joel Pacho
        2489:  "Luis Díaz",         // war: Luis Fernando Díaz
        19617: "Michael Olise",     // war: Michael Akpovie Olise
        153:   "Ousmane Dembélé",   // war: Masour Ousmane Dembélé
        756:   "Federico Valverde", // war: Federico Santiago Valverde
        307123: "Nico O'Reilly",    // war: Nico O&apos;Reilly (HTML-Entität aus der API)
        19030:  "Matt O'Riley"      // war: Matthew Sean O&apos;Riley (HTML-Entität aus der API)
    },

    // CL 2026/27: dieselben Korrekturen wie 25/26. Die Overrides hängen an
    // der `player.id`, nicht am Klub – ein Spieler behält seine Schreibweise
    // also auch nach einem Transfer. Einträge für Spieler, die 26/27 nicht
    // im Pool sind, sind stille No-ops.
    cl2627: {
        184:   "Harry Kane",        // war: Harry Edward Kane
        16367: "William Pacho",     // war: Willian Joel Pacho
        2489:  "Luis Díaz",         // war: Luis Fernando Díaz
        19617: "Michael Olise",     // war: Michael Akpovie Olise
        153:   "Ousmane Dembélé",   // war: Masour Ousmane Dembélé
        756:   "Federico Valverde", // war: Federico Santiago Valverde
        307123: "Nico O'Reilly",    // war: Nico O&apos;Reilly (HTML-Entität aus der API)
        19030:  "Matt O'Riley"      // war: Matthew Sean O&apos;Riley (HTML-Entität aus der API)
    }
};
