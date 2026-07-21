/* =============================================================================
 *  transfer-utils.js
 *
 *  Reine Regel-Engine für das CL-Transfer-Feature (keine UI, kein
 *  Firestore). Kapselt die Frage „Darf dieser Transfer gemacht werden?"
 *  und das Anwenden eines Transfers auf ein Team.
 *
 *  Regeln kommen aus tournament-config.js (`tournament.transfers`,
 *  siehe CL_TRANSFERS): eine feste Zahl Transfer-Aktionen für das ganze
 *  Turnier, pro Aktion bis zu N Spieler tauschbar, vorerst jederzeit.
 *
 *  Ein „Transfer" ist eine Aktion, die K Spieler abgibt und dieselbe
 *  Anzahl K holt (Teamgrösse bleibt konstant), 1 ≤ K ≤ maxPlayersPerTransfer.
 *
 *  Läuft im Browser (window.TransferUtils) und in Node (module.exports),
 *  analog zu points-utils.js.
 * ============================================================================= */
(function (root) {
  'use strict';

  function toConfig(t) {
    if (!t || t.enabled === false) return null;
    return {
      enabled: true,
      totalTransfers: Number.isFinite(Number(t.totalTransfers)) ? Number(t.totalTransfers) : 0,
      maxPlayersPerTransfer: Number.isFinite(Number(t.maxPlayersPerTransfer)) ? Number(t.maxPlayersPerTransfer) : 0,
      anytime: t.anytime !== false
    };
  }

  // Transfer-Konfiguration des aktiven Turniers (oder null, wenn das
  // Turnier – z. B. die WM – kein Transfer-Feature hat).
  function getTransferConfig(appConfig) {
    var cfg = appConfig || (typeof window !== 'undefined' ? window.APP_CONFIG : null);
    if (!cfg) return null;
    var active = cfg.activeTournament
      || (cfg.tournaments && cfg.activeTournamentKey && cfg.tournaments[cfg.activeTournamentKey])
      || null;
    return toConfig(active && active.transfers);
  }

  function remainingTransfers(config, usedTransfers) {
    if (!config) return 0;
    var used = Number.isFinite(Number(usedTransfers)) ? Number(usedTransfers) : 0;
    return Math.max(0, config.totalTransfers - used);
  }

  function normalizeIds(list) {
    if (!Array.isArray(list)) return [];
    return list.map(function (x) { return String(x); }).filter(function (x) { return x.length > 0; });
  }

  function hasDuplicates(arr) {
    return new Set(arr).size !== arr.length;
  }

  /**
   * Prüft einen geplanten Transfer.
   *
   * params: {
   *   config?           Transfer-Config (sonst aus appConfig/aktivem Turnier)
   *   appConfig?        APP_CONFIG (Fallback zur Config-Ermittlung)
   *   usedTransfers     bereits verbrauchte Transfer-Aktionen
   *   currentTeamIds    aktuelle Team-Spieler-IDs
   *   outPlayers        abzugebende IDs
   *   inPlayers         zu holende IDs
   * }
   * → { ok: boolean, error: string|null }
   */
  function validateTransfer(params) {
    var p = params || {};
    var config = p.config || getTransferConfig(p.appConfig);
    if (!config || !config.enabled) {
      return { ok: false, error: 'Transfers sind für dieses Turnier nicht aktiv.' };
    }

    var used = Number.isFinite(Number(p.usedTransfers)) ? Number(p.usedTransfers) : 0;
    if (remainingTransfers(config, used) <= 0) {
      return { ok: false, error: 'Keine Transfers mehr übrig (max. ' + config.totalTransfers + ').' };
    }

    var out = normalizeIds(p.outPlayers);
    var inc = normalizeIds(p.inPlayers);

    if (out.length === 0 || inc.length === 0) {
      return { ok: false, error: 'Mindestens ein Spieler muss getauscht werden.' };
    }
    if (out.length !== inc.length) {
      return { ok: false, error: 'Anzahl abgegebener und geholter Spieler muss gleich sein.' };
    }
    if (out.length > config.maxPlayersPerTransfer) {
      return { ok: false, error: 'Pro Transfer sind maximal ' + config.maxPlayersPerTransfer + ' Spieler erlaubt.' };
    }
    if (hasDuplicates(out)) return { ok: false, error: 'Doppelte Spieler in der Abgabe.' };
    if (hasDuplicates(inc)) return { ok: false, error: 'Doppelte Spieler im Zugang.' };

    var team = {};
    normalizeIds(p.currentTeamIds).forEach(function (id) { team[id] = true; });
    var outSet = {};
    out.forEach(function (id) { outSet[id] = true; });

    for (var i = 0; i < out.length; i++) {
      if (!team[out[i]]) return { ok: false, error: 'Abgegebener Spieler ist nicht im Team.' };
    }
    for (var j = 0; j < inc.length; j++) {
      if (outSet[inc[j]]) {
        return { ok: false, error: 'Ein Spieler kann nicht zugleich abgegeben und geholt werden.' };
      }
      if (team[inc[j]]) {
        return { ok: false, error: 'Geholter Spieler ist bereits im Team.' };
      }
    }

    return { ok: true, error: null };
  }

  // Wendet einen Transfer an und liefert die neuen Team-IDs (ohne zu
  // validieren – vorher validateTransfer aufrufen).
  function applyTransfer(currentTeamIds, outPlayers, inPlayers) {
    var out = {};
    normalizeIds(outPlayers).forEach(function (id) { out[id] = true; });
    var kept = normalizeIds(currentTeamIds).filter(function (id) { return !out[id]; });
    return kept.concat(normalizeIds(inPlayers));
  }

  var api = {
    getTransferConfig: getTransferConfig,
    remainingTransfers: remainingTransfers,
    validateTransfer: validateTransfer,
    applyTransfer: applyTransfer
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }
  if (root) {
    root.TransferUtils = api;
  }
})(typeof window !== 'undefined' ? window : this);
