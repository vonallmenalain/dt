/* =============================================================================
 *  points-utils.js
 *
 *  Gemeinsame Normalisierung fuer Spieler-Punktedokumente.
 *
 *  Ein Punktedokument enthaelt Detailwerte pro Spiel (`Spiel_<id>`) und
 *  abgeleitete Summen (`START`, `DRAW`, `totalPoints`, ...). Damit in der
 *  App nie ein Spieler an einer Stelle 14 und an einer anderen 13 Punkte hat,
 *  werden die Summen immer aus den Spiel-Details abgeleitet, sobald solche
 *  Details vorhanden sind.
 * ============================================================================= */
(function (root) {
  'use strict';

  const FALLBACK_RULE_KEYS = [
    'START',
    'SUBBED_IN',
    'SUBBED_OUT',
    'GOAL_GK',
    'GOAL_DEF',
    'GOAL_MID',
    'GOAL_ATT',
    'OWN_GOAL',
    'ASSIST_GK_DEF',
    'ASSIST_MID',
    'ASSIST_ATT',
    'TEAM_GOAL',
    'DEF_BASE_PTS',
    'GEGENTOR_GK_DEF',
    'YELLOW_CARD',
    'RED_CARD',
    'PEN_SAVED',
    'PEN_MISSED',
    'PEN_COMMITED',
    'PEN_WON',
    'WIN',
    'DRAW',
    'LOSS'
  ];

  function getRuleKeys() {
    const cfg = root && root.APP_CONFIG;
    if (cfg && cfg.rules && typeof cfg.rules === 'object') {
      const keys = Object.keys(cfg.rules);
      if (keys.length > 0) return keys;
    }
    return FALLBACK_RULE_KEYS.slice();
  }

  function finiteNumber(value, fallback = 0) {
    return (typeof value === 'number' && Number.isFinite(value)) ? value : fallback;
  }

  function hasOwn(obj, key) {
    return Object.prototype.hasOwnProperty.call(obj, key);
  }

  function getFixtureLineup(fixturePoint) {
    const lineup = fixturePoint && fixturePoint.Aufstellung;
    return lineup && typeof lineup === 'object' && !Array.isArray(lineup) ? lineup : null;
  }

  function sumFixtureLineup(fixturePoint, ruleKeys = getRuleKeys()) {
    const lineup = getFixtureLineup(fixturePoint);
    if (!lineup) return { hasLineupValues: false, total: 0, ruleTotals: {} };

    const ruleTotals = {};
    let total = 0;
    let hasLineupValues = false;

    ruleKeys.forEach((key) => {
      const value = finiteNumber(lineup[key], 0);
      ruleTotals[key] = value;
      total += value;
      if (value !== 0 || hasOwn(lineup, key)) hasLineupValues = true;
    });

    return { hasLineupValues, total, ruleTotals };
  }

  function getFixtureTotal(fixturePoint, ruleKeys = getRuleKeys()) {
    if (!fixturePoint || typeof fixturePoint !== 'object') return 0;

    const lineupSum = sumFixtureLineup(fixturePoint, ruleKeys);
    if (lineupSum.hasLineupValues) return lineupSum.total;
    if (typeof fixturePoint.TotalPunkte === 'number' && Number.isFinite(fixturePoint.TotalPunkte)) {
      return fixturePoint.TotalPunkte;
    }
    if (typeof fixturePoint.Punkte === 'number' && Number.isFinite(fixturePoint.Punkte)) {
      return fixturePoint.Punkte;
    }
    return 0;
  }

  function getFixtureMatchId(fixtureKey, fixturePoint) {
    const rawId = fixturePoint && (
      fixturePoint.MatchID ??
      fixturePoint.matchId ??
      fixturePoint.fixtureId ??
      fixturePoint.id
    );
    if (rawId !== undefined && rawId !== null && rawId !== '') return String(rawId);
    return String(fixtureKey || '').replace(/^Spiel_/, '');
  }

  function buildMatchBucketFromFixture(fixturePoint, fixtureTotal, ruleKeys = getRuleKeys()) {
    const lineup = getFixtureLineup(fixturePoint);
    if (lineup) {
      const bucket = {};
      ruleKeys.forEach((ruleKey) => {
        const value = finiteNumber(lineup[ruleKey], 0);
        if (value !== 0) bucket[ruleKey] = value;
      });
      return bucket;
    }

    return { TotalPunkte: finiteNumber(fixtureTotal, 0) };
  }

  function getTopLevelRuleTotal(pointDoc, ruleKeys = getRuleKeys()) {
    if (!pointDoc || typeof pointDoc !== 'object') return 0;
    return ruleKeys.reduce((sum, key) => sum + finiteNumber(pointDoc[key], 0), 0);
  }

  function normalizePlayerPointDocument(pointDoc, options = {}) {
    if (!pointDoc || typeof pointDoc !== 'object' || Array.isArray(pointDoc)) return pointDoc;

    const ruleKeys = Array.isArray(options.ruleKeys) && options.ruleKeys.length
      ? options.ruleKeys
      : getRuleKeys();
    const normalized = { ...pointDoc };
    const aggregate = {};
    ruleKeys.forEach((key) => { aggregate[key] = 0; });

    let hasFixtures = false;
    let hasAnyLineupValues = false;
    let fixtureTotalSum = 0;
    const derivedMatches = {};

    Object.entries(pointDoc).forEach(([key, value]) => {
      if (!key.startsWith('Spiel_') || !value || typeof value !== 'object' || Array.isArray(value)) return;

      hasFixtures = true;
      const fixtureCopy = { ...value };
      const lineupSum = sumFixtureLineup(value, ruleKeys);
      let fixtureTotal = 0;

      if (lineupSum.hasLineupValues) {
        hasAnyLineupValues = true;
        fixtureTotal = lineupSum.total;
        fixtureCopy.TotalPunkte = fixtureTotal;
        ruleKeys.forEach((ruleKey) => {
          aggregate[ruleKey] += finiteNumber(lineupSum.ruleTotals[ruleKey], 0);
        });
      } else {
        fixtureTotal = getFixtureTotal(value, ruleKeys);
        fixtureCopy.TotalPunkte = fixtureTotal;
      }

      fixtureTotalSum += fixtureTotal;
      normalized[key] = fixtureCopy;

      const matchId = getFixtureMatchId(key, fixtureCopy);
      if (matchId) {
        derivedMatches[matchId] = buildMatchBucketFromFixture(fixtureCopy, fixtureTotal, ruleKeys);
      }
    });

    if (hasFixtures) {
      normalized.matches = derivedMatches;
      if (hasAnyLineupValues) {
        ruleKeys.forEach((key) => { normalized[key] = aggregate[key]; });
      }
      normalized.totalPoints = fixtureTotalSum;
    } else if (typeof normalized.totalPoints !== 'number' || !Number.isFinite(normalized.totalPoints)) {
      normalized.totalPoints = getTopLevelRuleTotal(normalized, ruleKeys);
    }

    return normalized;
  }

  function normalizePointsMap(points, options = {}) {
    if (!points || typeof points !== 'object' || Array.isArray(points)) return points;
    const ruleKeys = Array.isArray(options.ruleKeys) && options.ruleKeys.length
      ? options.ruleKeys
      : getRuleKeys();
    const normalized = {};
    Object.entries(points).forEach(([id, doc]) => {
      normalized[String(id)] = normalizePlayerPointDocument(doc, { ruleKeys });
    });
    return normalized;
  }

  function getPlayerTotal(pointDoc) {
    const normalized = normalizePlayerPointDocument(pointDoc);
    return finiteNumber(normalized && normalized.totalPoints, 0);
  }

  // Punkte je EINZELSPIEL für einen Spieler: { [matchId]: total }.
  // Basis für die zeitbasierte Transfer-Wertung (transfer-utils.js): dort wird
  // je Spiel entschieden, ob der Spieler zum Anpfiff im Team war. Liest die
  // rohen `Spiel_<id>`-Einträge (in roh- wie normalisierten Dokumenten vorhanden).
  function getPlayerMatchTotals(pointDoc, options = {}) {
    const out = {};
    if (!pointDoc || typeof pointDoc !== 'object' || Array.isArray(pointDoc)) return out;
    const ruleKeys = Array.isArray(options.ruleKeys) && options.ruleKeys.length
      ? options.ruleKeys
      : getRuleKeys();
    Object.entries(pointDoc).forEach(([key, value]) => {
      if (!key.startsWith('Spiel_') || !value || typeof value !== 'object' || Array.isArray(value)) return;
      const total = getFixtureTotal(value, ruleKeys);
      const matchId = getFixtureMatchId(key, value);
      if (matchId) out[matchId] = (out[matchId] || 0) + total;
    });
    return out;
  }

  const api = {
    getRuleKeys,
    getFixtureTotal,
    getFixtureMatchId,
    getPlayerTotal,
    getPlayerMatchTotals,
    normalizePlayerPointDocument,
    normalizePointsMap
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }

  if (root) {
    root.DreamTeamPoints = api;
  }
})(typeof window !== 'undefined' ? window : (typeof globalThis !== 'undefined' ? globalThis : this));
