// Positions-Overrides für DreamTeam (turnierspezifisch).
//
// Die Keys (em2024, wm2026, ...) entsprechen den Tournament-Keys
// aus tournament-config.js. Ein Override greift nur, wenn das aktive
// Turnier diesem Key entspricht.
//
// Anwendung an zwei Stellen (idempotent):
//   1. Zur Laufzeit in der App: data.js lädt diese Datei und überschreibt
//      direkt nach dem Laden der per-Turnier-Daten (z.B. data-wm2026.js)
//      die Position der hier eingetragenen Spieler in `playersData`.
//      Dadurch greifen manuelle Anpassungen sofort in Dashboard,
//      Team-Builder, Teams, Spieleranalyse und Rangliste.
//   2. Bei der Neu-Generierung der per-Turnier-Datendatei
//      (adm-generate-kader.html / adm-generate-kader-wm2026.html):
//      Dort werden die Overrides ebenfalls angewendet, sodass die
//      Korrekturen langfristig auch fest in data-<turnier>.js landen.
//
// Format pro Eintrag:
//   "<player.id>": "GOALKEEPER" | "DEFENDER" | "MIDFIELDER" | "ATTACKER"
//
// Die UI zum Bearbeiten dieser Datei: adm-position-overrides.html
//
// Generiert am: 14.4.2026, 19:59:27

window.POSITION_OVERRIDES = {
    wm2022: {},

    em2024: {
        "1422": "ATTACKER", // Jérémy Doku
        "502": "MIDFIELDER" // Joshua Kimmich
    },

    wm2026: {},

    em2028: {},

    wm2030: {}
};
