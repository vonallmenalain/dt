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

  /* ===========================================================================
   *  Zeitbasierte Punkte-Zuordnung (Transfer-Freeze).
   *
   *  Ein Team hat über die Saison eine Historie: das Start-15 gilt bis zum
   *  ersten Transfer, danach das getauschte 15 usw. Punkte fallen pro Spiel
   *  (mit Anpfiff-Zeitpunkt) an. Ein Spieler zählt für ein Spiel nur, wenn er
   *  zum ANPFIFF dieses Spiels im Team war (altes Team vor dem Transfer, neues
   *  Team ab dem Transfer). Das ist der „Freeze": vorher altes, nachher neues
   *  Team – exakt zum Transfer-Zeitpunkt (`transfer.at`, ms).
   *
   *  Ein Transfer-Eintrag: { at:<ms>, out:[ids], in:[ids], captain:<id|null> }
   *  wobei `captain` der Kapitän NACH diesem Transfer ist.
   * ========================================================================= */
  function normalizeTransfers(transfers) {
    if (!Array.isArray(transfers)) return [];
    return transfers
      .map(function (t) {
        if (!t || typeof t !== 'object') return null;
        var at = Number(t.at);
        return {
          at: Number.isFinite(at) ? at : 0,
          out: normalizeIds(t.out),
          in: normalizeIds(t.in),
          captain: (t.captain != null && String(t.captain)) ? String(t.captain) : null
        };
      })
      .filter(Boolean)
      .sort(function (a, b) { return a.at - b.at; });
  }

  // Rekonstruiert das Start-Team (vor allen Transfers) aus dem AKTUELLEN Team
  // und der Transfer-Liste (Transfers rückwärts rückgängig machen).
  function reconstructInitialTeamIds(currentTeamIds, transfers) {
    var ids = normalizeIds(currentTeamIds);
    var ts = normalizeTransfers(transfers);
    for (var i = ts.length - 1; i >= 0; i--) {
      var t = ts[i];
      var inSet = {};
      t.in.forEach(function (id) { inSet[id] = true; });
      ids = ids.filter(function (id) { return !inSet[id]; });
      t.out.forEach(function (id) { if (ids.indexOf(id) === -1) ids.push(id); });
    }
    return ids;
  }

  // Besitz-Fenster je Spieler: { [playerId]: [{from, to}] } in ms.
  // `from === null` = seit Beginn, `to === null` = offen (bis jetzt).
  // Halb-offenes Intervall [from, to): ein Spiel zum Zeitpunkt t gehört dem
  // NEUEN Team, wenn t === transfer.at (Transfer wirkt ab dem Zeitpunkt).
  function computeOwnershipWindows(currentTeamIds, transfers) {
    var ts = normalizeTransfers(transfers);
    var initial = reconstructInitialTeamIds(currentTeamIds, transfers);
    var open = {};
    var windows = {};
    function ensure(id) { if (!windows[id]) windows[id] = []; return windows[id]; }
    initial.forEach(function (id) { open[id] = null; });
    ts.forEach(function (t) {
      t.out.forEach(function (id) {
        if (Object.prototype.hasOwnProperty.call(open, id)) {
          ensure(id).push({ from: open[id], to: t.at });
          delete open[id];
        }
      });
      t.in.forEach(function (id) {
        if (!Object.prototype.hasOwnProperty.call(open, id)) open[id] = t.at;
      });
    });
    Object.keys(open).forEach(function (id) {
      ensure(id).push({ from: open[id], to: null });
    });
    return windows;
  }

  function inWindow(win, tMs) {
    var afterFrom = (win.from == null) || (tMs >= win.from);
    var beforeTo = (win.to == null) || (tMs < win.to);
    return afterFrom && beforeTo;
  }

  // War `playerId` zum Anpfiff (kickoffMs) im Team? Ohne bekannten Anpfiff
  // (kickoffMs null) Fallback auf „ist aktuell im Team" (currentTeamSet).
  function isOwnedAt(windows, playerId, kickoffMs, currentTeamSet) {
    var id = String(playerId);
    var wins = windows[id];
    if (!wins || !wins.length) return false;
    if (kickoffMs == null || !Number.isFinite(Number(kickoffMs))) {
      return !!(currentTeamSet && currentTeamSet[id]);
    }
    var t = Number(kickoffMs);
    for (var i = 0; i < wins.length; i++) {
      if (inWindow(wins[i], t)) return true;
    }
    return false;
  }

  // Liefert eine Funktion captainAt(tMs) → Kapitän-ID zum Zeitpunkt.
  // Segment 0 (vor dem ersten Transfer) = initialCaptain; ab transfer[i].at
  // gilt transfer[i].captain.
  function buildCaptainAt(initialCaptain, transfers) {
    var ts = normalizeTransfers(transfers);
    var init = (initialCaptain != null && String(initialCaptain)) ? String(initialCaptain) : null;
    return function captainAt(tMs) {
      var cap = init;
      var t = Number(tMs);
      var known = Number.isFinite(t);
      for (var i = 0; i < ts.length; i++) {
        if (!known) { cap = ts[i].captain || cap; continue; }
        if (t >= ts[i].at) cap = ts[i].captain || cap;
        else break;
      }
      return cap;
    };
  }

  /**
   * Zeitbasierte Manager-Gesamtpunkte für ein Team MIT Transfers.
   * (Für Teams ohne Transfers weiter die bestehende Skalar-Summe nutzen –
   * dieses Ergebnis ist dort identisch, aber teurer.)
   *
   * params: {
   *   currentTeamIds:    [id]                       aktuelle 15
   *   transfers:         [{at,out,in,captain}]
   *   initialCaptain:    id                          Kapitän von Segment 0
   *   playerMatchPoints: { [playerId]: { [matchId]: basePts } }  Basis-Punkte je Spiel
   *   getKickoffMs:      (matchId) => number|null    Anpfiff in ms
   *   captainMultiplier: number (default 2, wie bestehend hart ×2)
   * } → number
   */
  // Wie managerTotalOverTime, liefert aber zusätzlich die Aufschlüsselung je
  // Spieler (gefensterte Punkte) und die Liste aller je besessenen Spieler –
  // Basis für die Team-Detail-Ansicht (inkl. ausgetauschter Spieler).
  // → { total, perPlayer: { [id]: pts }, everOwned: [id], currentSet: {id:true} }
  function managerBreakdownOverTime(params) {
    var p = params || {};
    var currentIds = normalizeIds(p.currentTeamIds);
    var currentSet = {};
    currentIds.forEach(function (id) { currentSet[id] = true; });
    var windows = computeOwnershipWindows(currentIds, p.transfers);
    var captainAt = buildCaptainAt(p.initialCaptain, p.transfers);
    var mult = Number.isFinite(Number(p.captainMultiplier)) ? Number(p.captainMultiplier) : 2;
    var pmp = p.playerMatchPoints || {};
    var getKick = typeof p.getKickoffMs === 'function' ? p.getKickoffMs : function () { return null; };

    var total = 0;
    var perPlayer = {};
    var everOwned = Object.keys(windows);
    everOwned.forEach(function (playerId) {
      var matches = pmp[playerId];
      var sum = 0;
      if (matches && typeof matches === 'object') {
        Object.keys(matches).forEach(function (matchId) {
          var base = Number(matches[matchId]) || 0;
          if (!base) return;
          var kick = getKick(matchId);
          if (!isOwnedAt(windows, playerId, kick, currentSet)) return;
          var isCap = String(captainAt(kick)) === String(playerId);
          sum += isCap ? base * mult : base;
        });
      }
      perPlayer[playerId] = sum;
      total += sum;
    });
    return { total: total, perPlayer: perPlayer, everOwned: everOwned, currentSet: currentSet };
  }

  function managerTotalOverTime(params) {
    return managerBreakdownOverTime(params).total;
  }

  var api = {
    getTransferConfig: getTransferConfig,
    remainingTransfers: remainingTransfers,
    validateTransfer: validateTransfer,
    applyTransfer: applyTransfer,
    normalizeTransfers: normalizeTransfers,
    reconstructInitialTeamIds: reconstructInitialTeamIds,
    computeOwnershipWindows: computeOwnershipWindows,
    isOwnedAt: isOwnedAt,
    buildCaptainAt: buildCaptainAt,
    managerTotalOverTime: managerTotalOverTime,
    managerBreakdownOverTime: managerBreakdownOverTime
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }
  if (root) {
    root.TransferUtils = api;
  }
})(typeof window !== 'undefined' ? window : this);
