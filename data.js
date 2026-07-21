/* =============================================================================
 *  data.js – Shim für turnierspezifische Kaderdaten + Positions-Overrides
 *
 *  Diese Datei lädt ZUR LADEZEIT synchron (in dieser Reihenfolge):
 *    1. Die zum aktiven Turnier passende Kader-Datei (aktuell ausschliesslich
 *       `data-wm2026.js`; weitere Turniere werden später ergänzt).
 *    2. position-overrides.js (turnierspezifische manuelle Positions-
 *       anpassungen).
 *    3. Einen kleinen Inline-Block, der die Overrides für das aktive
 *       Turnier auf `playersData` anwendet, BEVOR irgendeine andere
 *       App-Logik (cache.js, Team-Builder, Rangliste, …) auf
 *       playersData zugreift.
 *
 *  Damit greifen manuelle Positionsanpassungen aus position-overrides.js
 *  in der gesamten App sofort, ohne dass die per-Turnier-Datendatei
 *  (z.B. data-wm2026.js) neu generiert werden muss. Beim Re-Generieren
 *  der Kader-Datei werden dieselben Overrides zusätzlich fest in die
 *  Datei geschrieben (siehe adm-generate-kader-wm2026.html), sodass das
 *  System idempotent bleibt.
 *
 *  Wichtig:
 *  - tournament-config.js MUSS vor data.js eingebunden sein.
 *  - Die ursprüngliche API-Position jedes überschriebenen Spielers wird
 *    in `player.PositionOriginal` gesichert. Die Admin-Override-Seite
 *    benutzt diesen Wert als Basis, damit sie sich nicht selbst täuscht
 *    und weiterhin die "echte" Original-Position anzeigt.
 *
 *  Fallback: Falls APP_CONFIG nicht vorhanden ist (z.B. Script-Ladefehler
 *  bei tournament-config.js), wird hart auf das aktuelle Default-Turnier
 *  (`data-wm2026.js`) zurückgefallen.
 * ============================================================================= */
(function () {
  // Notfall-Defaults, falls APP_CONFIG (tournament-config.js) noch
  // nicht geladen ist oder einen unbrauchbaren Wert liefert. Müssen
  // mit dem FALLBACK_TOURNAMENT_KEY aus tournament-config.js
  // übereinstimmen.
  var fileName = "data-wm2026.js";
  var activeKey = "wm2026";

  try {
    if (window.APP_CONFIG && window.APP_CONFIG.data && typeof window.APP_CONFIG.data.fileName === "function") {
      var resolved = window.APP_CONFIG.data.fileName();
      if (typeof resolved === "string" && resolved.length > 0) {
        fileName = resolved;
      }
    }
    if (window.APP_CONFIG && typeof window.APP_CONFIG.activeTournamentKey === "string") {
      activeKey = window.APP_CONFIG.activeTournamentKey;
    } else if (window.APP_CONFIG && typeof window.APP_CONFIG.key === "string") {
      activeKey = window.APP_CONFIG.key;
    }

    // Defence-in-depth: Wenn das aktive Turnier nicht ladbar ist (nicht
    // verfügbar UND nicht als Admin-Vorschau aktiv), nicht auf eine
    // fehlende Datei zugreifen, sondern auf den Default zurückfallen.
    // isTournamentLoadable deckt zusätzlich den Preview-Kanal ab
    // (Admin betrachtet ein noch gesperrtes Turnier via ?preview=…);
    // fehlt die Funktion (ältere Version), gilt isTournamentAvailable.
    var loadable = null;
    if (window.APP_CONFIG && typeof window.APP_CONFIG.isTournamentLoadable === "function") {
      loadable = window.APP_CONFIG.isTournamentLoadable(activeKey);
    } else if (window.APP_CONFIG && typeof window.APP_CONFIG.isTournamentAvailable === "function") {
      loadable = window.APP_CONFIG.isTournamentAvailable(activeKey);
    }
    if (loadable === false) {
      fileName = "data-wm2026.js";
      activeKey = "wm2026";
    }
  } catch (err) {
    fileName = "data-wm2026.js";
    activeKey = "wm2026";
  }

  // 1) Per-Turnier Kaderdaten (synchron) – stellt globales `playersData` bereit.
  document.write('<script src="' + fileName + '"><\/script>');

  // 2) Manuelle Positions-Overrides (synchron) – stellt `window.POSITION_OVERRIDES` bereit.
  document.write('<script src="position-overrides.js"><\/script>');

  // 3) Overrides direkt anwenden, BEVOR weitere App-Skripte playersData lesen.
  //    Wir mutieren die Array-Einträge in place: `const playersData = [...]`
  //    in den per-Turnier-Daten verbietet zwar Reassignment der Variable,
  //    erlaubt aber Veränderungen an Array-Elementen.
  var serializedKey = JSON.stringify(activeKey);
  document.write(
    '<script>(function(activeKey){' +
      'try {' +
        'var data = (typeof playersData !== "undefined" && Array.isArray(playersData)) ? playersData : null;' +
        'if (!data) { window.__POSITION_OVERRIDES_APPLIED__ = { tournament: activeKey, count: 0, reason: "no playersData" }; return; }' +
        'var allOverrides = (window.POSITION_OVERRIDES && typeof window.POSITION_OVERRIDES === "object") ? window.POSITION_OVERRIDES : {};' +
        'var raw = (allOverrides[activeKey] && typeof allOverrides[activeKey] === "object") ? allOverrides[activeKey] : {};' +
        'var allowed = { GOALKEEPER:1, DEFENDER:1, MIDFIELDER:1, ATTACKER:1 };' +
        'function norm(v){' +
          'var s = String(v == null ? "" : v).trim().toUpperCase();' +
          'if (!s) return "";' +
          'if (s === "GK" || s === "TORWART" || s === "KEEPER") return "GOALKEEPER";' +
          'if (s === "DF" || s === "VERTEIDIGER" || s === "DEFENCE") return "DEFENDER";' +
          'if (s === "MF" || s === "MITTELFELD" || s === "MIDFIELD") return "MIDFIELDER";' +
          'if (s === "FW" || s === "FORWARD" || s === "STÜRMER" || s === "STUERMER" || s === "ATTACK") return "ATTACKER";' +
          'return allowed[s] ? s : "";' +
        '}' +
        'var lookup = {};' +
        'var ids = Object.keys(raw);' +
        'for (var k=0;k<ids.length;k++) {' +
          'var n = norm(raw[ids[k]]);' +
          'if (n) lookup[String(ids[k])] = n;' +
        '}' +
        'var applied = 0;' +
        'var noop = 0;' +
        'for (var i=0;i<data.length;i++) {' +
          'var p = data[i];' +
          'if (!p) continue;' +
          'var pid = (p["player.id"] != null) ? String(p["player.id"]) : "";' +
          'if (!pid) continue;' +
          'var target = lookup[pid];' +
          'if (!target) continue;' +
          'var current = norm(p.Position);' +
          'if (current === target) { noop++; continue; }' +
          'if (typeof p.PositionOriginal === "undefined") { p.PositionOriginal = p.Position; }' +
          'p.Position = target;' +
          'applied++;' +
        '}' +
        'window.__POSITION_OVERRIDES_APPLIED__ = { tournament: activeKey, count: applied, noop: noop, total: ids.length };' +
        'try { if (applied || ids.length) console.log("[data.js] Positions-Overrides für " + activeKey + ": " + applied + " angewendet, " + noop + " bereits identisch (von " + ids.length + " Einträgen)."); } catch(_) {}' +
      '} catch (err) {' +
        'try { console.warn("[data.js] Position-Overrides konnten nicht angewendet werden:", err); } catch(_) {}' +
        'window.__POSITION_OVERRIDES_APPLIED__ = { tournament: activeKey, count: 0, error: String(err && err.message || err) };' +
      '}' +
    '})(' + serializedKey + ');<\/script>'
  );
})();
