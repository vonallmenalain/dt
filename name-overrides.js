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
        756:   "Federico Valverde"  // war: Federico Santiago Valverde
    }
};
