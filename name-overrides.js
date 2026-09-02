// Namens-Overrides für DreamTeam (Anzeigename `Spielername`).
//
// Analog zu position-overrides.js: turnierspezifisch, je `player.id`.
// Wird in data.js NACH dem Laden der Kaderdatei und NACH der automatischen
// Namens-Kürzung (name-shortener.js) angewendet – BEVOR irgendeine
// App-Logik (cache.js, Team-Builder, Rangliste, …) auf playersData
// zugreift. So greifen Namens-Korrekturen sofort in der ganzen App, ohne
// die auto-generierte Kaderdatei (z.B. data-cl2526.js) von Hand zu
// editieren (die trägt bewusst „nicht von Hand editieren").
//
// Der ursprüngliche Name wird in `player.SpielernameOriginal` gesichert.
// Rein additiv: fehlt ein Turnier-Block, ist dies ein No-op (die WM ist
// nie betroffen).
//
// ─── Was hier NICHT hingehört ────────────────────────────────────────────
// Das Wegkürzen von Zweitvornamen und spanischen Mutternamen macht
// name-shortener.js generisch für die ganze Spielerliste:
// "Aurélien Djani Tchouaméni" → "Aurélien Tchouaméni", "Joshua Walter
// Kimmich" → "Joshua Kimmich", "Harry Edward Kane" → "Harry Kane". Auch
// Partikel-Nachnamen ("Virgil van Dijk", "Alexis Mac Allister") und
// Bindestrich-Namen ("Vanja Milinković-Savić") sind dort abgedeckt.
// Solche Fälle brauchen KEINEN Eintrag.
//
// Hier stehen nur die drei Sorten von Ausnahmen, die keine Regel kennen
// kann:
//   1. RUFNAME – der gebräuchliche Vorname ist nicht der erste
//      ("Damián Emiliano Martínez" → "Emiliano Martínez").
//   2. DOPPELNACHNAME – gebräuchlich ist der Vaters-, nicht der Mutter-
//      name; ohne die API-Felder firstname/lastname ist im Browser nicht
//      erkennbar, welches Wort welches ist ("Pau Cubarsí Paredes" →
//      "Pau Cubarsí").
//   3. DREI WÖRTER SIND RICHTIG – Doppelvorname oder zusammengesetzter
//      Nachname ohne Partikel ("Randal Kolo Muani", "Barış Alper Yılmaz").
// ─────────────────────────────────────────────────────────────────────────

// Beide Turniere teilen dieselbe Liste: die Overrides hängen an der
// `player.id`, nicht am Klub – ein Spieler behält seine Schreibweise also
// auch nach einem Transfer. Einträge für Spieler, die in einem Turnier
// nicht im Pool sind, sind stille No-ops.
var CL_NAME_OVERRIDES = {
    // ── 1) Rufname weicht vom ersten Vornamen ab ─────────────────────────
    19599:  "Emiliano Martínez",   // Damián Emiliano Martínez
    1149:   "Dayot Upamecano",     // Dayotchanculle Oswald Upamecano
    153:    "Ousmane Dembélé",     // Masour Ousmane Dembélé
    1807:   "Evan Ndicka",         // Obite Evan Ndicka
    22147:  "Manu Koné",           // Kouadio Emmanuel Koné
    136723: "Noni Madueke",        // Chukwunonso Tristan Madueke
    37:     "Nehuén Pérez",        // Patricio Nehuén Pérez
    945:    "Jordan Lotomba",      // Mvula Jordan Lotomba
    50057:  "Eren Elmalı",         // Evren Eren Elmalı
    156477: "Rayan Cherki",        // Mathis Rayan Cherki
    2935:   "Harry Maguire",       // Jacob Harry Maguire
    25917:  "Ridle Baku",          // Bote Ridle Baku
    380978: "Assan Ouédraogo",     // Forzan Assan Ouédraogo
    290549: "Johan Bakayoko",      // Saint-Cyr Johan Bakayoko
    409215: "Joane Gadou",         // Kouakou Joane Gadou
    162707: "Elye Wahi",           // Sepe Elye Wahi
    142959: "Kerem Aktürkoğlu",    // Muhammed Kerem Aktürkoğlu
    19145:  "Tosin Adarabioyo",    // Abdul-Nasir Oluwatosin Adarabioyo
    42012:  "Elias Achouri",       // Mohamed Elias Achouri
    465786: "Thierno Barry",       // Mamadou Thierno Barry
    19235:  "Djed Spence",         // Diop Tehuti Spence
    19030:  "Matt O'Riley",        // Matthew Sean O&apos;Riley (Kurzform)
    2194:   "Ramy Bensebaïni",     // Amir Selmane Rami Bensebaini
    15683:  "Gustaf Nilsson",      // Håkan Gustaf Nilsson
    67971:  "Marc Guéhi",          // Addji Keaninkin Marc-Israel Guéhi
    311773: "Santiago Mouriño",    // Álvaro Santiago Mouriño
    7334:   "Karim Adeyemi",       // Karim-David Adeyemi (Bindestrich-Vorname)

    // ── 2) Mehrteiliger Nachnamen-Teil: welches Wort zählt? ──────────────
    // Steht im Nachnamen-Teil mehr als ein Wort, ist ihm nicht anzusehen,
    // ob das zweite ein Muttername ist (dann zählt das erste) oder ein
    // Mittelname (dann das letzte). name-shortener.js entscheidet sich für
    // das erste Wort – wo das danebenliegt, steht der Name hier.
    396623: "Pau Cubarsí",         // Pau Cubarsí Paredes
    433395: "Álvaro Cortés",       // Álvaro Cortés Moyano
    386305: "Jacobo Ramón",        // Jacobo Ramón Naveros
    288112: "Willy Kambwala",      // Willy Kambwala Ndengushi
    371916: "Christian Mawissa",   // Christian Mawissa Elebi
    337933: "Alexei Rojas",        // Alexei Rojas Fedorushchenko
    151510: "Ole Blomberg",        // api-football: "O. Didrik Blomberg" – Didrik ist Zweitvorname
    18767:  "Ademola Lookman",     // Ademola Alade Lookman
    471107: "Quentin Ndjantou",    // Quentin Ndjantou Mbitcha

    // ── 3) Drei Wörter sind hier richtig ─────────────────────────────────
    21104:  "Randal Kolo Muani",           // Nachname "Kolo Muani"
    237129: "Pape Matar Sarr",             // Doppelvorname
    63274:  "Barış Alper Yılmaz",          // Doppelvorname
    345808: "Francesco Pio Esposito",      // Doppelvorname
    3406:   "André-Frank Zambo Anguissa",  // Nachname "Zambo Anguissa"
    39178:  "Julian Faye Lund",            // Nachname "Faye Lund"
    434623: "Joel van den Berg",           // Nachname "van den Berg"
    524875: "El Hadji Mbodji",             // Vorname "El Hadji"

    // ── 4) Schreibweise ──────────────────────────────────────────────────
    16367:  "William Pacho",       // api-football: "Willian Joel Pacho"

    // ── Altbestand: von der Kürzung inzwischen selbst erledigt ───────────
    // Bleiben als Dokumentation stehen und laufen als No-op mit.
    184:    "Harry Kane",          // war: Harry Edward Kane
    2489:   "Luis Díaz",           // war: Luis Fernando Díaz
    19617:  "Michael Olise",       // war: Michael Akpovie Olise
    756:    "Federico Valverde",   // war: Federico Santiago Valverde
    307123: "Nico O'Reilly"        // war: Nico O&apos;Reilly (HTML-Entität aus der API)
};

window.NAME_OVERRIDES = {
    cl2526: CL_NAME_OVERRIDES,
    cl2627: CL_NAME_OVERRIDES
};
