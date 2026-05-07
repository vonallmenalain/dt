/* =============================================================================
 *  data.js – Shim für turnierspezifische Kaderdaten
 *
 *  Diese Datei lädt ZUR LADEZEIT synchron die zum aktiven Turnier passende
 *  Daten-Datei (z.B. data-em2024.js, data-wm2026.js). Dadurch bleibt der
 *  bisherige Einbindungspunkt `<script src="data.js"></script>` in allen
 *  HTML-Seiten unverändert, während die tatsächlichen Kaderdaten jetzt
 *  pro Turnier in eigenen Dateien liegen.
 *
 *  Voraussetzung: tournament-config.js muss VOR data.js eingebunden sein,
 *  damit window.APP_CONFIG.data.fileName() die richtige Datei zurückgibt.
 *
 *  Fallback: Falls APP_CONFIG nicht vorhanden ist, wird data-em2024.js
 *  geladen, damit nichts ohne globale playersData-Variable bleibt.
 * ============================================================================= */
(function () {
  var fileName = "data-em2024.js";
  try {
    if (window.APP_CONFIG && window.APP_CONFIG.data && typeof window.APP_CONFIG.data.fileName === "function") {
      var resolved = window.APP_CONFIG.data.fileName();
      if (typeof resolved === "string" && resolved.length > 0) {
        fileName = resolved;
      }
    }
  } catch (err) {
    // Wenn etwas schiefläuft, verwenden wir bewusst den EM-2024-Default,
    // damit die App nicht ohne playersData-Variable bricht.
    fileName = "data-em2024.js";
  }

  // Synchron via document.write – funktioniert auch statisch auf Netlify
  // und stellt sicher, dass nachfolgende Scripts auf playersData zugreifen können.
  document.write('<script src="' + fileName + '"><\/script>');
})();
