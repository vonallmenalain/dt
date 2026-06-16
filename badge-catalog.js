(function (global) {
  'use strict';

  const FINISHED_FIXTURE_STATUSES = new Set(['FT', 'AET', 'PEN']);
  const LIVE_FIXTURE_STATUSES = new Set(['1H', '2H', 'HT', 'ET', 'BT', 'P', 'SUSP', 'INT', 'LIVE']);

  const ROUND_PHASES = Object.freeze([
    Object.freeze({ key: 'groupMatchday1', roundKey: 'GROUP_1', label: '1. Gruppenspiel' }),
    Object.freeze({ key: 'groupMatchday2', roundKey: 'GROUP_2', label: '2. Gruppenspiel' }),
    Object.freeze({ key: 'groupMatchday3', roundKey: 'GROUP_3', label: '3. Gruppenspiel' }),
    Object.freeze({ key: 'roundOf32', roundKey: 'ROUND_32', label: 'Sechzehntelfinale' }),
    Object.freeze({ key: 'roundOf16', roundKey: 'ROUND_16', label: 'Achtelfinale' }),
    Object.freeze({ key: 'quarterFinal', roundKey: 'QF', label: 'Viertelfinale' }),
    Object.freeze({ key: 'semiFinal', roundKey: 'SF', label: 'Halbfinale' }),
    Object.freeze({ key: 'thirdPlace', roundKey: 'THIRD_PLACE', label: 'Spiel um Platz 3' }),
    Object.freeze({ key: 'final', roundKey: 'FINAL', label: 'Finale' })
  ]);

  const ROUND_MEDALS = Object.freeze([
    Object.freeze({ key: 'gold', rank: 1, label: 'Gold', emoji: '🥇' }),
    Object.freeze({ key: 'silver', rank: 2, label: 'Silber', emoji: '🥈' }),
    Object.freeze({ key: 'bronze', rank: 3, label: 'Bronze', emoji: '🥉' })
  ]);

  function createRoundRankBadges() {
    const badges = [];
    ROUND_PHASES.forEach((phase) => {
      ROUND_MEDALS.forEach((medal) => {
        badges.push(Object.freeze({
          id: `roundRank_${phase.key}_${medal.key}`,
          label: `${medal.label} - ${phase.label}`,
          emoji: medal.emoji,
          description: `Du hast nach ${phase.label} Rang ${medal.rank} erreicht.`,
          howToEarn: `Sammle in dieser isolierten Runde genug Punkte für Rang ${medal.rank}. Frühere oder spätere Spiele zählen hier nicht mit.`,
          category: 'Rundenranking',
          tone: 'positive',
          style: 'positive',
          isHistorical: true,
          phaseKey: phase.key,
          rank: medal.rank
        }));
      });
    });
    return badges;
  }

  const BASE_BADGES = [
    {
      id: 'currentRankGold',
      label: 'Rang 1',
      emoji: '🥇',
      description: 'Du stehst aktuell auf Rang 1 der Live-Rangliste.',
      howToEarn: 'Stehe in der aktuellen Rangliste auf Rang 1.',
      category: 'Aktuelle Rangliste',
      tone: 'positive',
      style: 'positive'
    },
    {
      id: 'currentRankSilver',
      label: 'Rang 2',
      emoji: '🥈',
      description: 'Du stehst aktuell auf Rang 2 der Live-Rangliste.',
      howToEarn: 'Stehe in der aktuellen Rangliste auf Rang 2.',
      category: 'Aktuelle Rangliste',
      tone: 'positive',
      style: 'positive'
    },
    {
      id: 'currentRankBronze',
      label: 'Rang 3',
      emoji: '🥉',
      description: 'Du stehst aktuell auf Rang 3 der Live-Rangliste.',
      howToEarn: 'Stehe in der aktuellen Rangliste auf Rang 3.',
      category: 'Aktuelle Rangliste',
      tone: 'positive',
      style: 'positive'
    },
    {
      id: 'currentTop5',
      label: 'Top 5',
      emoji: '⭐',
      description: 'Du stehst aktuell in den Top 5 der Live-Rangliste.',
      howToEarn: 'Stehe in der aktuellen Rangliste auf Rang 4 oder 5.',
      category: 'Aktuelle Rangliste',
      tone: 'positive',
      style: 'positive'
    },
    {
      id: 'currentTop10',
      label: 'Top 10',
      emoji: '🔟',
      description: 'Du stehst aktuell in den Top 10 der Live-Rangliste.',
      howToEarn: 'Stehe in der aktuellen Rangliste auf Rang 6 bis 10.',
      category: 'Aktuelle Rangliste',
      tone: 'positive',
      style: 'positive'
    },
    {
      id: 'topCaptain',
      label: 'TopCaptain',
      emoji: '👑',
      description: 'Dein Captain hat aktuell die beste Captain-Punkteausbeute.',
      howToEarn: 'Habe den Captain mit der besten Punkteausbeute.',
      category: 'Captain',
      tone: 'positive',
      style: 'positive'
    },
    {
      id: 'flopCaptain',
      label: 'FlopCaptain',
      emoji: '🫠',
      description: 'Dein Captain hat aktuell die schwächste Captain-Punkteausbeute.',
      howToEarn: 'Habe den Captain mit der schwächsten Punkteausbeute.',
      category: 'Captain',
      tone: 'negative-funny',
      style: 'negative'
    },
    {
      id: 'instinct',
      label: 'Captain-Gespür',
      emoji: '🧠',
      description: 'Dein Captain liefert aktuell einen besonders grossen Anteil deiner Teampunkte.',
      howToEarn: 'Wähle einen Captain, der einen hohen Anteil deiner Gesamtpunkte liefert.',
      category: 'Captain',
      tone: 'positive',
      style: 'positive'
    },
    {
      id: 'club',
      label: 'Lieblingsclub',
      emoji: '🏢',
      description: 'Du hast aktuell mehrere Spieler aus demselben Club im Team.',
      howToEarn: 'Wähle mindestens zwei Spieler desselben Clubs.',
      category: 'Konstanz',
      tone: 'neutral',
      style: 'neutral'
    },
    {
      id: 'gk',
      label: 'Top-Torwart',
      emoji: '🧤',
      description: 'Deine Torhüter holen aktuell die meisten Punkte aller Teams.',
      howToEarn: 'Sammle unter allen Teams die meisten Punkte mit deinen Torhütern.',
      category: 'Top',
      tone: 'positive',
      style: 'positive'
    },
    {
      id: 'def',
      label: 'Top-Abwehr',
      emoji: '🛡️',
      description: 'Deine Verteidiger holen aktuell die meisten Punkte aller Teams.',
      howToEarn: 'Sammle die meisten Punkte mit Verteidigern.',
      category: 'Top',
      tone: 'positive',
      style: 'positive'
    },
    {
      id: 'mid',
      label: 'Top-Mittelfeld',
      emoji: '🎯',
      description: 'Deine Mittelfeldspieler holen aktuell die meisten Punkte aller Teams.',
      howToEarn: 'Sammle die meisten Punkte mit Mittelfeldspielern.',
      category: 'Top',
      tone: 'positive',
      style: 'positive'
    },
    {
      id: 'att',
      label: 'Top-Sturm',
      emoji: '⚡',
      description: 'Deine Stürmer holen aktuell die meisten Punkte aller Teams.',
      howToEarn: 'Sammle die meisten Punkte mit deinen Stürmern.',
      category: 'Top',
      tone: 'positive',
      style: 'positive'
    },
    {
      id: 'scouting',
      label: 'Scouting-Meister',
      emoji: '🔎',
      description: 'Du hast aktuell die meisten Unique Picks im Team.',
      howToEarn: 'Setze auf Unique Picks, die nur in deinem Team stehen.',
      category: 'Top',
      tone: 'positive',
      style: 'positive'
    },
    {
      id: 'perfect',
      label: 'PerfectTeam-Treffer',
      emoji: '🏆',
      description: 'Du hast aktuell besonders viele Spieler aus dem PerfectTeam im Kader.',
      howToEarn: 'Habe möglichst viele Spieler im Kader, die auch im PerfectTeam landen.',
      category: 'Top',
      tone: 'positive',
      style: 'positive'
    },
    {
      id: 'noAppearance',
      label: 'Keinen Einsatz',
      emoji: '🪑',
      description: 'Mindestens einer deiner Spieler wartet trotz Spiel seiner Nation noch auf seinen Einsatz.',
      howToEarn: 'Habe einen Spieler im Team, dessen Nation schon gespielt hat, der Spieler selbst aber noch nicht eingesetzt wurde.',
      category: 'Fail',
      tone: 'negative-funny',
      style: 'negative'
    },
    {
      id: 'mostGoalsConceded',
      label: 'Am meisten Gegentore',
      emoji: '🕳️',
      description: 'Dein Team kassiert aktuell am meisten Gegentore.',
      howToEarn: 'Sammle mit deinen defensiven Spielern die meisten Gegentore.',
      category: 'Fail',
      tone: 'negative-funny',
      style: 'negative'
    },
    {
      id: 'fewestGoalsScored',
      label: 'Am wenigsten erzielte Tore',
      emoji: '🥶',
      description: 'Deine Spieler haben aktuell die wenigsten Tore erzielt.',
      howToEarn: 'Habe unter allen Managern die wenigsten erzielten Spielertore.',
      category: 'Fail',
      tone: 'negative-funny',
      style: 'negative'
    },
    {
      id: 'bench',
      label: 'Beste Bank',
      emoji: '🪑',
      description: 'Deine Ersatzbank holt aktuell die meisten Punkte aller Teams.',
      howToEarn: 'Sammle mit den Bank-Slots die meisten Punkte aller Teams.',
      category: 'Chaos',
      tone: 'funny',
      style: 'funny'
    },
    {
      id: 'cardCollector',
      label: 'Kartensammler',
      emoji: '🟨',
      description: 'Dein Team hat aktuell die meisten Karten gesammelt.',
      howToEarn: 'Habe unter allen Managern die meisten gelben und roten Karten.',
      category: 'Chaos',
      tone: 'negative-funny',
      style: 'negative'
    }
  ];

  const BADGE_CATALOG = Object.freeze(
    BASE_BADGES
      .map((badge) => Object.freeze({ ...badge }))
      .concat(createRoundRankBadges())
  );

  const CATALOG_BY_ID = BADGE_CATALOG.reduce((acc, badge) => {
    acc[badge.id] = badge;
    return acc;
  }, Object.create(null));

  const ALIASES = Object.create(null);

  function normalizeBadgeKey(value) {
    const raw = String(value || '')
      .toLowerCase()
      .replace(/ß/g, 'ss');
    const normalized = typeof raw.normalize === 'function'
      ? raw.normalize('NFD').replace(/[\u0300-\u036f]/g, '')
      : raw;
    return normalized
      .replace(/&amp;/g, ' und ')
      .replace(/[^a-z0-9]+/g, ' ')
      .trim()
      .replace(/\s+/g, ' ');
  }

  function addAlias(id, values) {
    values.forEach((value) => {
      const key = normalizeBadgeKey(value);
      if (key) ALIASES[key] = id;
    });
  }

  BADGE_CATALOG.forEach((badge) => {
    addAlias(badge.id, [badge.id, badge.label]);
  });

  addAlias('noAppearance', ['keinen einsatz', 'kein einsatz', 'nicht eingesetzt', 'nicht aufgeboten', 'kader alarm', 'roster', 'orphan', 'orphan count']);
  addAlias('club', ['lieblings club', 'favorite club', 'club']);
  addAlias('gk', ['keeper', 'goalkeeper', 'torwart', 'top torhueter', 'top torwart paket']);
  addAlias('def', ['abwehr', 'verteidigung', 'defense', 'defender', 'top verteidigung']);
  addAlias('mid', ['mittelfeld', 'midfield', 'midfielder']);
  addAlias('att', ['sturm', 'angriff', 'attack', 'attacker', 'forward']);
  addAlias('topCaptain', ['captain', 'top captain', 'top captain', 'top kapitän', 'top kapitaen', 'top captain badge']);
  addAlias('flopCaptain', ['flop captain', 'flopkapitän', 'flop kapitaen']);
  addAlias('bench', ['bank', 'ersatzbank', 'beste ersatzbank']);
  addAlias('scouting', ['scouting meister', 'scout', 'hipster scout', 'unique picks']);
  addAlias('perfect', ['perfectteam', 'perfect team', 'perfectteam treffer']);
  addAlias('instinct', ['captain gespuer', 'captain gespür', 'captain instinkt']);
  addAlias('mostGoalsConceded', ['am meisten gegentore', 'meiste gegentore', 'goals conceded']);
  addAlias('fewestGoalsScored', ['am wenigsten erzielte tore', 'wenigste tore', 'fewest goals']);
  addAlias('cardCollector', ['kartensammler', 'karten sammler', 'cards', 'karten']);

  function getBadgeId(value) {
    const key = normalizeBadgeKey(value);
    if (!key) return '';
    if (ALIASES[key]) return ALIASES[key];
    if (/\bnicht aufgeboten\b/.test(key)) return 'noAppearance';
    return '';
  }

  function createFallbackBadge(value) {
    const label = typeof value === 'object' && value
      ? (value.label || value.id || 'Badge')
      : (String(value || '').trim() || 'Badge');
    const key = normalizeBadgeKey(label).replace(/\s+/g, '-') || 'badge';
    return {
      id: `unknown-${key}`,
      label,
      emoji: '🏷️',
      description: 'Eine besondere Auszeichnung für dieses Team.',
      howToEarn: 'Bleib im Turnier aktiv; die genaue Bedingung ergibt sich aus der laufenden Wertung.',
      category: 'Weitere',
      tone: 'neutral',
      style: 'neutral',
      isFallback: true
    };
  }

  function resolveBadge(value) {
    if (value && typeof value === 'object') {
      const fromId = value.id && CATALOG_BY_ID[value.id];
      if (fromId) return fromId;
      const mappedId = getBadgeId(value.id) || getBadgeId(value.type) || getBadgeId(value.label);
      return mappedId && CATALOG_BY_ID[mappedId] ? CATALOG_BY_ID[mappedId] : createFallbackBadge(value);
    }

    const direct = CATALOG_BY_ID[String(value || '')];
    if (direct) return direct;
    const mappedId = getBadgeId(value);
    return mappedId && CATALOG_BY_ID[mappedId] ? CATALOG_BY_ID[mappedId] : createFallbackBadge(value);
  }

  function finiteNumber(value, fallback = 0) {
    const n = Number(value);
    return Number.isFinite(n) ? n : fallback;
  }

  function getRules(context) {
    if (context && context.rules && typeof context.rules === 'object') return context.rules;
    if (global.APP_CONFIG && global.APP_CONFIG.rules && typeof global.APP_CONFIG.rules === 'object') return global.APP_CONFIG.rules;
    return {};
  }

  function getRulePoints(rules, key) {
    const value = finiteNumber(rules && rules[key], 0);
    return value === 0 ? null : value;
  }

  function getPointDoc(pointsData, playerId) {
    if (!pointsData || typeof pointsData !== 'object') return null;
    return pointsData[String(playerId)] || pointsData[playerId] || null;
  }

  function getFixtureLineup(fixturePoint) {
    const lineup = fixturePoint && fixturePoint.Aufstellung;
    return lineup && typeof lineup === 'object' && !Array.isArray(lineup) ? lineup : null;
  }

  function getFixtureEntriesFromPointDoc(pointDoc) {
    if (!pointDoc || typeof pointDoc !== 'object') return [];
    return Object.entries(pointDoc).filter(([key, value]) => (
      key.startsWith('Spiel_') && value && typeof value === 'object' && !Array.isArray(value)
    ));
  }

  function countEventsFromPointValue(value, rulePoints) {
    if (!rulePoints) return 0;
    const n = finiteNumber(value, 0);
    if (n === 0) return 0;
    return Math.max(0, Math.round(n / rulePoints));
  }

  function countRuleEvents(pointDoc, ruleKey, rules) {
    if (!pointDoc || typeof pointDoc !== 'object') return 0;
    const rulePoints = getRulePoints(rules, ruleKey);
    if (!rulePoints) return 0;

    let total = 0;
    let sawFixtureLineups = false;
    getFixtureEntriesFromPointDoc(pointDoc).forEach(([, fixturePoint]) => {
      const lineup = getFixtureLineup(fixturePoint);
      if (!lineup || !Object.prototype.hasOwnProperty.call(lineup, ruleKey)) return;
      sawFixtureLineups = true;
      total += countEventsFromPointValue(lineup[ruleKey], rulePoints);
    });

    if (sawFixtureLineups) return total;
    return countEventsFromPointValue(pointDoc[ruleKey], rulePoints);
  }

  function hasAppearance(pointDoc, rules) {
    if (!pointDoc || typeof pointDoc !== 'object') return false;

    const startPoints = getRulePoints(rules, 'START');
    const subPoints = getRulePoints(rules, 'SUBBED_IN');
    let sawFixtureLineups = false;
    let appeared = false;

    getFixtureEntriesFromPointDoc(pointDoc).forEach(([, fixturePoint]) => {
      const lineup = getFixtureLineup(fixturePoint);
      if (!lineup) return;
      sawFixtureLineups = true;
      if (countEventsFromPointValue(lineup.START, startPoints) > 0 || countEventsFromPointValue(lineup.SUBBED_IN, subPoints) > 0) {
        appeared = true;
      }
    });

    if (sawFixtureLineups) return appeared;
    return countEventsFromPointValue(pointDoc.START, startPoints) > 0 || countEventsFromPointValue(pointDoc.SUBBED_IN, subPoints) > 0;
  }

  function normalizeTextKey(value) {
    return normalizeBadgeKey(value);
  }

  function getFixtureEntries(fixtures) {
    if (!fixtures || typeof fixtures !== 'object' || Array.isArray(fixtures)) return [];
    return Object.entries(fixtures)
      .map(([docId, fixture]) => ({ id: String(getFixtureId(fixture, docId)), fixture }))
      .filter(entry => entry.id && entry.fixture && typeof entry.fixture === 'object');
  }

  function getFixtureId(fixture, fallbackId) {
    return fixture && (
      fixture.fixtureId
      || fixture.id
      || (fixture.fixture && fixture.fixture.id)
      || fallbackId
    );
  }

  function getFixtureStatusShort(fixture) {
    return String(
      (fixture && fixture.status && fixture.status.short)
      || (fixture && fixture.statusShort)
      || (fixture && fixture.fixture && fixture.fixture.status && fixture.fixture.status.short)
      || ''
    ).trim().toUpperCase();
  }

  function isFixtureFinished(fixture) {
    return FINISHED_FIXTURE_STATUSES.has(getFixtureStatusShort(fixture));
  }

  function hasFixtureStarted(fixture) {
    const status = getFixtureStatusShort(fixture);
    if (FINISHED_FIXTURE_STATUSES.has(status) || LIVE_FIXTURE_STATUSES.has(status)) return true;
    const elapsed = fixture && fixture.status ? fixture.status.elapsed : fixture && fixture.statusElapsed;
    if (elapsed !== undefined && elapsed !== null && finiteNumber(elapsed, 0) > 0) return true;
    const goals = fixture && fixture.goals;
    if (goals && (finiteNumber(goals.home, 0) > 0 || finiteNumber(goals.away, 0) > 0)) return true;
    return false;
  }

  function getFixtureTeamName(fixture, side) {
    const team = side === 'home'
      ? (fixture.homeTeam || fixture.home || (fixture.teams && fixture.teams.home) || {})
      : (fixture.awayTeam || fixture.away || (fixture.teams && fixture.teams.away) || {});
    return String(
      team.name
      || (side === 'home' ? fixture.homeTeamName || fixture.homeName || fixture.teamA : fixture.awayTeamName || fixture.awayName || fixture.teamB)
      || ''
    ).trim();
  }

  function buildPlayedNationSet(fixtures, pointsData, players) {
    const played = new Set();

    getFixtureEntries(fixtures).forEach(({ fixture }) => {
      if (!hasFixtureStarted(fixture)) return;
      const home = normalizeTextKey(getFixtureTeamName(fixture, 'home'));
      const away = normalizeTextKey(getFixtureTeamName(fixture, 'away'));
      if (home) played.add(home);
      if (away) played.add(away);
    });

    if (played.size > 0) return played;

    const playersById = new Map((players || []).map(player => [String(player && player['player.id']), player]));
    Object.entries(pointsData || {}).forEach(([playerId, pointDoc]) => {
      if (!getFixtureEntriesFromPointDoc(pointDoc).length) return;
      const player = playersById.get(String(playerId));
      const nation = normalizeTextKey(player && player['Nationalteam.name']);
      if (nation) played.add(nation);
    });

    return played;
  }

  function buildTeamStat(team, pointsData, rules, playedNations) {
    const stat = {
      goalsScored: 0,
      goalsConceded: 0,
      cards: 0,
      noAppearanceCount: 0,
      noAppearancePlayers: []
    };

    (team && team.mergedPlayers || []).forEach((player) => {
      const pointDoc = getPointDoc(pointsData, player.id);
      stat.goalsScored += countRuleEvents(pointDoc, 'GOAL_GK', rules);
      stat.goalsScored += countRuleEvents(pointDoc, 'GOAL_DEF', rules);
      stat.goalsScored += countRuleEvents(pointDoc, 'GOAL_MID', rules);
      stat.goalsScored += countRuleEvents(pointDoc, 'GOAL_ATT', rules);
      stat.goalsConceded += countRuleEvents(pointDoc, 'GEGENTOR_GK_DEF', rules);
      stat.cards += countRuleEvents(pointDoc, 'YELLOW_CARD', rules);
      stat.cards += countRuleEvents(pointDoc, 'RED_CARD', rules);

      const nationKey = normalizeTextKey(player && player.nation);
      if (nationKey && playedNations && playedNations.has(nationKey) && !hasAppearance(pointDoc, rules)) {
        stat.noAppearanceCount += 1;
        stat.noAppearancePlayers.push({
          id: getPlayerId(player),
          name: getPlayerName(player)
        });
      }
    });

    return stat;
  }

  function getPlayerId(player) {
    if (!player) return '';
    const value = player.id ?? player.playerId ?? player['player.id'];
    return value === null || value === undefined ? '' : String(value);
  }

  function getPlayerName(player) {
    const name = player && (player.name || player.Spielername || player.playerName);
    return String(name || 'Unbekannt').trim();
  }

  function getTeamPlayers(team) {
    return (team && Array.isArray(team.mergedPlayers)) ? team.mergedPlayers : [];
  }

  function buildPickCounts(teams) {
    const counts = {};
    (teams || []).forEach((team) => {
      getTeamPlayers(team).forEach((player) => {
        const id = getPlayerId(player);
        if (!id) return;
        counts[id] = (counts[id] || 0) + 1;
      });
    });
    return counts;
  }

  function getPickCounts(teams, context) {
    const source = context && context.pickCounts;
    if (source && typeof source === 'object' && !Array.isArray(source)) return source;
    return buildPickCounts(teams);
  }

  function getPerfectTeamIdSet(context) {
    const source = context && context.perfectTeamIds;
    if (source instanceof Set) return source;
    if (source && typeof source.has === 'function' && typeof source.forEach === 'function') {
      const ids = new Set();
      source.forEach(value => ids.add(String(value)));
      return ids;
    }
    if (Array.isArray(source)) return new Set(source.map(value => String(value)));
    if (source && typeof source === 'object') {
      return new Set(Object.keys(source).filter(key => source[key]).map(key => String(key)));
    }
    return new Set();
  }

  function getUniquePickPlayers(team, pickCounts) {
    return getTeamPlayers(team).filter((player) => {
      const id = getPlayerId(player);
      return id && finiteNumber(pickCounts && pickCounts[id], 0) === 1;
    });
  }

  function getPerfectHitPlayers(team, perfectTeamIds) {
    if (!perfectTeamIds || perfectTeamIds.size === 0) return [];
    return getTeamPlayers(team).filter((player) => perfectTeamIds.has(getPlayerId(player)));
  }

  function getScoutingCount(team, pickCounts) {
    const explicit = finiteNumber(team && team.scoutingCount, NaN);
    if (Number.isFinite(explicit) && explicit > 0) return explicit;
    return getUniquePickPlayers(team, pickCounts).length;
  }

  function getPerfectHitsCount(team, perfectTeamIds) {
    const explicit = finiteNumber(team && team.perfectHits, NaN);
    if (Number.isFinite(explicit) && explicit > 0) return explicit;
    return getPerfectHitPlayers(team, perfectTeamIds).length;
  }

  function playerNames(players) {
    return (players || []).map(getPlayerName).filter(Boolean);
  }

  function makeDetail(label, value) {
    const text = Array.isArray(value) ? value.filter(Boolean).join(', ') : String(value ?? '').trim();
    return text ? { label, value: text } : null;
  }

  function getTeamStats(allTeams, pointsData, fixturesData, context) {
    const rules = getRules(context);
    const players = (context && Array.isArray(context.playersData)) ? context.playersData : (global.playersData || []);
    const playedNations = buildPlayedNationSet(fixturesData, pointsData, players);
    const stats = new Map();
    (allTeams || []).forEach((team) => {
      stats.set(team, buildTeamStat(team, pointsData, rules, playedNations));
    });
    return { stats, rules };
  }

  function buildLeaderData(teams, valueGetter, mode = 'max') {
    let targetValue = mode === 'min' ? Infinity : -Infinity;
    let winners = [];

    (teams || []).forEach((team) => {
      const value = finiteNumber(valueGetter(team), NaN);
      if (!Number.isFinite(value)) return;
      if ((mode === 'min' && value < targetValue) || (mode !== 'min' && value > targetValue)) {
        targetValue = value;
        winners = [team];
      } else if (value === targetValue) {
        winners.push(team);
      }
    });

    return winners.length ? { value: targetValue, winners } : { value: null, winners: [] };
  }

  function teamMatches(team, candidate) {
    if (!team || !candidate) return false;
    if (team === candidate) return true;
    if (team.manager && candidate.manager && team.manager === candidate.manager) return true;
    if (team.id && candidate.id && String(team.id) === String(candidate.id)) return true;
    if (team.teamId && candidate.teamId && String(team.teamId) === String(candidate.teamId)) return true;
    return false;
  }

  function hasLeaderAward(leader, team, minValue) {
    return !!(
      leader &&
      typeof leader.value === 'number' &&
      leader.value >= minValue &&
      Array.isArray(leader.winners) &&
      leader.winners.some(winner => teamMatches(team, winner))
    );
  }

  function hasMinLeaderAward(leader, team, maxRequiredValue) {
    return !!(
      leader &&
      typeof leader.value === 'number' &&
      leader.value <= maxRequiredValue &&
      Array.isArray(leader.winners) &&
      leader.winners.some(winner => teamMatches(team, winner))
    );
  }

  function makeAward(id, title, overrides = {}) {
    const badge = resolveBadge(id);
    const details = Array.isArray(overrides.details)
      ? overrides.details.filter(item => item && item.label && item.value)
      : [];
    return {
      type: id,
      id,
      label: overrides.label || badge.label,
      title: title || overrides.title || badge.description,
      emoji: overrides.emoji || badge.emoji,
      logo: overrides.logo || '',
      value: overrides.value,
      details,
      players: Array.isArray(overrides.players) ? overrides.players : [],
      badge
    };
  }

  function addAward(awards, id, title, overrides) {
    if (awards.some(award => award.id === id || award.type === id)) return;
    awards.push(makeAward(id, title, overrides));
  }

  function getCurrentRankBadgeId(rank) {
    const n = finiteNumber(rank, 0);
    if (n === 1) return 'currentRankGold';
    if (n === 2) return 'currentRankSilver';
    if (n === 3) return 'currentRankBronze';
    if (n >= 4 && n <= 5) return 'currentTop5';
    if (n >= 6 && n <= 10) return 'currentTop10';
    return '';
  }

  function compareTeamsBySubmissionAsc(a, b) {
    const aMs = getTeamSubmissionMillis(a);
    const bMs = getTeamSubmissionMillis(b);
    if (aMs !== bMs) {
      if (aMs <= 0) return 1;
      if (bMs <= 0) return -1;
      return aMs - bMs;
    }
    return String(a && a.manager || '').localeCompare(String(b && b.manager || ''), 'de');
  }

  function timestampToMillis(value) {
    if (!value) return 0;
    if (typeof value.toMillis === 'function') {
      const ms = Number(value.toMillis());
      if (Number.isFinite(ms)) return ms;
    }
    if (typeof value.toDate === 'function') {
      const date = value.toDate();
      const ms = date instanceof Date ? date.getTime() : NaN;
      if (Number.isFinite(ms)) return ms;
    }
    if (value instanceof Date) {
      const ms = value.getTime();
      return Number.isFinite(ms) ? ms : 0;
    }
    if (typeof value === 'number') return Number.isFinite(value) ? value : 0;
    if (typeof value === 'string') {
      const parsed = Date.parse(value);
      return Number.isFinite(parsed) ? parsed : 0;
    }
    if (typeof value === 'object') {
      const seconds = Number(value.seconds ?? value._seconds);
      if (Number.isFinite(seconds)) {
        const nanos = Number(value.nanoseconds ?? value._nanoseconds ?? 0);
        return seconds * 1000 + (Number.isFinite(nanos) ? Math.floor(nanos / 1000000) : 0);
      }
    }
    return 0;
  }

  function getTeamSubmissionMillis(team) {
    const candidates = [
      team && team.timestamp,
      team && team.submittedAt,
      team && team.createdAt,
      team && team.createdAtMs
    ];
    for (const candidate of candidates) {
      const ms = timestampToMillis(candidate);
      if (ms > 0) return ms;
    }
    return 0;
  }

  function classifyRoundText(roundText) {
    if (roundText === null || roundText === undefined) return null;
    const r = String(roundText).toLowerCase().trim();
    if (!r) return null;

    if (/3rd\s*[- ]?\s*place/.test(r) || /third\s*[- ]?\s*place/.test(r) || /spiel\s*um\s*platz\s*3/.test(r)) return 'THIRD_PLACE';
    if (/round\s*of\s*32/.test(r) || /sechzehntel[- ]?finale?/.test(r) || /1\s*\/\s*16[- ]?\s*final/.test(r) || /\br\s*32\b/.test(r) || /\b1\/16\b/.test(r)) return 'ROUND_32';
    if (/round\s*of\s*16/.test(r) || /achtelfinale/.test(r) || /1\s*\/\s*8[- ]?\s*final/.test(r) || /\br\s*16\b/.test(r) || /\b1\/8\b/.test(r)) return 'ROUND_16';
    if (/quarter[- ]?final/.test(r) || /viertelfinale/.test(r) || /1\s*\/\s*4[- ]?\s*final/.test(r) || /\bqf\b/.test(r) || /\b1\/4\b/.test(r)) return 'QF';
    if (/semi[- ]?final/.test(r) || /halbfinale/.test(r) || /1\s*\/\s*2[- ]?\s*final/.test(r) || /\bsf\b/.test(r) || /\b1\/2\b/.test(r)) return 'SF';
    if (/^final\b/.test(r) || /\bfinale?\b/.test(r)) return 'FINAL';

    const isGroup = /group/.test(r) || /spieltag/.test(r) || /matchday/.test(r) || /vorrunde/.test(r) || /^round\b/.test(r) || /\brunde\b/.test(r) || /round\s*\d/.test(r);
    const numberMatch = r.match(/(\d+)/);
    if (isGroup && numberMatch) {
      const n = Number(numberMatch[1]);
      if (n === 1) return 'GROUP_1';
      if (n === 2) return 'GROUP_2';
      if (n === 3) return 'GROUP_3';
    }

    if (/\b1(st)?\b/.test(r) && /round|spieltag|matchday|runde|group/.test(r)) return 'GROUP_1';
    if (/\b2(nd)?\b/.test(r) && /round|spieltag|matchday|runde|group/.test(r)) return 'GROUP_2';
    if (/\b3(rd)?\b/.test(r) && /round|spieltag|matchday|runde|group/.test(r)) return 'GROUP_3';

    return null;
  }

  function buildPhaseFixtures(fixtures) {
    const map = new Map(ROUND_PHASES.map(phase => [phase.key, []]));
    getFixtureEntries(fixtures).forEach((entry) => {
      const roundText = (entry.fixture.league && entry.fixture.league.round) || entry.fixture.round || '';
      const roundKey = classifyRoundText(roundText);
      const phase = ROUND_PHASES.find(item => item.roundKey === roundKey);
      if (!phase) return;
      map.get(phase.key).push(entry);
    });
    return map;
  }

  function getMatchPoint(pointDoc, matchId, rules) {
    if (!pointDoc || typeof pointDoc !== 'object') return 0;
    const direct = pointDoc[`Spiel_${matchId}`];
    if (direct && typeof direct === 'object') {
      if (global.DreamTeamPoints && typeof global.DreamTeamPoints.getFixtureTotal === 'function') {
        return finiteNumber(global.DreamTeamPoints.getFixtureTotal(direct), 0);
      }
      return finiteNumber(direct.TotalPunkte, finiteNumber(direct.Punkte, 0));
    }

    for (const [, fixturePoint] of getFixtureEntriesFromPointDoc(pointDoc)) {
      if (String(fixturePoint.MatchID) !== String(matchId)) continue;
      if (global.DreamTeamPoints && typeof global.DreamTeamPoints.getFixtureTotal === 'function') {
        return finiteNumber(global.DreamTeamPoints.getFixtureTotal(fixturePoint), 0);
      }
      const lineup = getFixtureLineup(fixturePoint);
      if (lineup) {
        return Object.keys(rules || {}).reduce((sum, key) => sum + finiteNumber(lineup[key], 0), 0);
      }
      return finiteNumber(fixturePoint.TotalPunkte, finiteNumber(fixturePoint.Punkte, 0));
    }

    return 0;
  }

  function getTeamScoreForMatches(team, matchIds, pointsData, rules) {
    const ids = Array.from(matchIds || []);
    return (team && team.mergedPlayers || []).reduce((sum, player) => {
      const pointDoc = getPointDoc(pointsData, player.id);
      const base = ids.reduce((matchSum, matchId) => matchSum + getMatchPoint(pointDoc, matchId, rules), 0);
      return sum + (player.isCaptain ? base * 2 : base);
    }, 0);
  }

  function rankTeamsByScore(teams, scoreGetter) {
    const rows = (teams || []).map(team => ({ team, score: finiteNumber(scoreGetter(team), 0), rank: null }));
    rows.sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      return compareTeamsBySubmissionAsc(a.team, b.team);
    });

    let currentRank = null;
    let previousScore = null;
    rows.forEach((row, index) => {
      if (index === 0 || row.score !== previousScore) currentRank = index + 1;
      row.rank = currentRank;
      previousScore = row.score;
    });

    return rows;
  }

  function getSnapshotPhase(snapshotData, phaseKey) {
    if (!snapshotData || typeof snapshotData !== 'object') return null;
    return snapshotData[phaseKey] || null;
  }

  function rowMatchesTeam(row, team) {
    if (!row || !team) return false;
    if (row.teamId && team.teamId && String(row.teamId) === String(team.teamId)) return true;
    if (row.id && team.id && String(row.id) === String(team.id)) return true;
    if (row.managerName && team.manager && row.managerName === team.manager) return true;
    if (row.manager && team.manager && row.manager === team.manager) return true;
    return false;
  }

  function getHistoricalAwardsFromSnapshots(team, badgeSnapshots) {
    const awards = [];
    ROUND_PHASES.forEach((phase) => {
      const phaseSnapshot = getSnapshotPhase(badgeSnapshots, phase.key);
      if (!phaseSnapshot || phaseSnapshot.completed !== true || !Array.isArray(phaseSnapshot.top3)) return;
      const hit = phaseSnapshot.top3.find(row => rowMatchesTeam(row, team));
      const rank = finiteNumber(hit && hit.rank, 0);
      const medal = ROUND_MEDALS.find(item => item.rank === rank);
      if (!medal) return;
      const id = `roundRank_${phase.key}_${medal.key}`;
      addAward(awards, id, `${medal.label} in ${phase.label}`, {
        value: rank,
        details: [makeDetail('Rang', String(rank))]
      });
    });
    return awards;
  }

  function getHistoricalAwardsFromPoints(team, allTeams, pointsData, fixturesData, rules) {
    const awards = [];
    const phaseFixtures = buildPhaseFixtures(fixturesData);

    ROUND_PHASES.forEach((phase) => {
      const entries = phaseFixtures.get(phase.key) || [];
      if (!entries.length) return;
      if (!entries.every(entry => isFixtureFinished(entry.fixture))) return;

      const phaseMatchIds = new Set(entries.map(entry => String(entry.id)));
      const rankedRows = rankTeamsByScore(allTeams || [], rankedTeam => getTeamScoreForMatches(rankedTeam, phaseMatchIds, pointsData, rules));
      const row = rankedRows.find(item => teamMatches(team, item.team));
      const medal = ROUND_MEDALS.find(item => item.rank === finiteNumber(row && row.rank, 0));
      if (!medal) return;
      const id = `roundRank_${phase.key}_${medal.key}`;
      const score = finiteNumber(row && row.score, 0);
      addAward(awards, id, `${medal.label} in ${phase.label} (${score} Pkt.)`, {
        value: score,
        details: [makeDetail('Rundenpunkte', `${score} Pkt.`)]
      });
    });

    return awards;
  }

  function getHistoricalRoundRankAwards(team, allTeams, pointsData, fixturesData, badgeSnapshots, rules) {
    const pointAwards = getHistoricalAwardsFromPoints(team, allTeams, pointsData, fixturesData, rules);
    if (pointAwards.length) return pointAwards;
    return getHistoricalAwardsFromSnapshots(team, badgeSnapshots);
  }

  function getBadgesForTeam(team, allTeams, pointsData, fixturesData, badgeSnapshots, context = {}) {
    if (!team) return [];

    const teams = Array.isArray(allTeams) && allTeams.length ? allTeams : [team];
    const awards = [];
    const { stats, rules } = getTeamStats(teams, pointsData || {}, fixturesData || {}, context);
    const currentStats = stats.get(team) || buildTeamStat(team, pointsData || {}, rules, new Set());
    const pickCounts = getPickCounts(teams, context);
    const perfectTeamIds = getPerfectTeamIdSet(context);
    const uniquePickPlayers = getUniquePickPlayers(team, pickCounts);
    const uniquePickNames = playerNames(uniquePickPlayers);
    const perfectHitPlayers = getPerfectHitPlayers(team, perfectTeamIds);
    const perfectHitNames = playerNames(perfectHitPlayers);

    const rankBadgeId = getCurrentRankBadgeId(team.currentRank);
    if (rankBadgeId) {
      addAward(awards, rankBadgeId, `Aktueller Rang ${team.currentRank}`);
    }

    if (currentStats.noAppearanceCount > 0) {
      const label = 'Keinen Einsatz';
      addAward(
        awards,
        'noAppearance',
        `${currentStats.noAppearanceCount} Spieler ohne Einsatz, obwohl die Nation bereits gespielt hat`,
        {
          label,
          value: currentStats.noAppearanceCount,
          players: currentStats.noAppearancePlayers,
          details: [
            makeDetail('Spieler ohne Einsatz', currentStats.noAppearancePlayers.map(player => player.name))
          ]
        }
      );
    }

    if (team.favoriteClub && team.favoriteClub.count >= 2) {
      addAward(
        awards,
        'club',
        `${team.favoriteClub.name} (${team.favoriteClub.count} Spieler, ${team.favoriteClub.points} Pkt.)`,
        { logo: team.favoriteClub.logo || '' }
      );
    }

    const positionTotals = team.positionTotals || {};
    const leaders = {
      gk: buildLeaderData(teams, t => (t.positionTotals || {}).GOALKEEPER),
      def: buildLeaderData(teams, t => (t.positionTotals || {}).DEFENDER),
      mid: buildLeaderData(teams, t => (t.positionTotals || {}).MIDFIELDER),
      att: buildLeaderData(teams, t => (t.positionTotals || {}).ATTACKER),
      bench: buildLeaderData(teams, t => (t.positionTotals || {}).BENCH),
      scouting: buildLeaderData(teams, t => getScoutingCount(t, pickCounts)),
      perfect: buildLeaderData(teams, t => getPerfectHitsCount(t, perfectTeamIds)),
      instinct: buildLeaderData(teams, t => t.captainShare),
      goalsConceded: buildLeaderData(teams, t => (stats.get(t) || {}).goalsConceded),
      goalsScoredMin: buildLeaderData(teams, t => (stats.get(t) || {}).goalsScored, 'min'),
      cards: buildLeaderData(teams, t => (stats.get(t) || {}).cards)
    };

    if (hasLeaderAward(leaders.gk, team, 1)) addAward(awards, 'gk', `Bestes Torwart-Paket aller Teams (${positionTotals.GOALKEEPER || 0} Pkt.)`);
    if (hasLeaderAward(leaders.def, team, 1)) addAward(awards, 'def', `Beste Verteidigung aller Teams (${positionTotals.DEFENDER || 0} Pkt.)`);
    if (hasLeaderAward(leaders.mid, team, 1)) addAward(awards, 'mid', `Bestes Mittelfeld aller Teams (${positionTotals.MIDFIELDER || 0} Pkt.)`);
    if (hasLeaderAward(leaders.att, team, 1)) addAward(awards, 'att', `Bester Sturm aller Teams (${positionTotals.ATTACKER || 0} Pkt.)`);
    if (hasLeaderAward(leaders.bench, team, 1)) addAward(awards, 'bench', `Stärkste Ersatzbank aller Teams (${positionTotals.BENCH || 0} Pkt.)`);
    if (hasLeaderAward(leaders.scouting, team, 1)) {
      const scoutingCount = getScoutingCount(team, pickCounts);
      addAward(awards, 'scouting', `${scoutingCount} Unique Picks im Team`, {
        value: scoutingCount,
        players: uniquePickPlayers,
        details: [makeDetail('Unique Picks', uniquePickNames.length ? uniquePickNames : `${scoutingCount} Spieler`)]
      });
    }
    if (hasLeaderAward(leaders.perfect, team, 1)) {
      const perfectHits = getPerfectHitsCount(team, perfectTeamIds);
      addAward(awards, 'perfect', `${perfectHits} Spieler aus dem aktuellen PerfectTeam`, {
        value: perfectHits,
        players: perfectHitPlayers,
        details: [makeDetail('PerfectTeam-Treffer', perfectHitNames.length ? perfectHitNames : `${perfectHits} Spieler`)]
      });
    }

    const captainValues = teams
      .map(candidate => ({ team: candidate, value: finiteNumber(candidate && candidate.captainPoints, 0) }))
      .filter(row => Number.isFinite(row.value));
    const captainMax = Math.max(...captainValues.map(row => row.value));
    const captainMin = Math.min(...captainValues.map(row => row.value));
    const hasMeaningfulCaptainSpread = captainValues.length > 1 && captainMax !== captainMin && captainValues.some(row => row.value !== 0);

    if (hasMeaningfulCaptainSpread && captainValues.some(row => teamMatches(team, row.team) && row.value === captainMax)) {
      addAward(awards, 'topCaptain', `Captain mit der besten Punkteausbeute (${team.captainPoints || 0} Pkt.)`);
    }
    if (hasMeaningfulCaptainSpread && captainValues.some(row => teamMatches(team, row.team) && row.value === captainMin)) {
      addAward(awards, 'flopCaptain', `Captain mit der schwächsten Punkteausbeute (${team.captainPoints || 0} Pkt.)`);
    }
    if (hasLeaderAward(leaders.instinct, team, 0.18) && team.captainPoints > 0 && team.totalScore > 0) {
      addAward(awards, 'instinct', `Captain liefert ${Math.round(team.captainShare * 100)}% der Team-Punkte (${team.captainPoints} Pkt.)`);
    }

    if (hasLeaderAward(leaders.goalsConceded, team, 1)) {
      addAward(awards, 'mostGoalsConceded', `${currentStats.goalsConceded} Gegentore über defensive Spieler`, {
        value: currentStats.goalsConceded,
        details: [makeDetail('Gegentore', String(currentStats.goalsConceded))]
      });
    }

    const maxGoalsScored = Math.max(...teams.map(t => finiteNumber((stats.get(t) || {}).goalsScored, 0)));
    if (maxGoalsScored > 0 && hasMinLeaderAward(leaders.goalsScoredMin, team, maxGoalsScored)) {
      addAward(awards, 'fewestGoalsScored', `${currentStats.goalsScored} erzielte Spielertore`, {
        value: currentStats.goalsScored,
        details: [makeDetail('Erzielte Tore', String(currentStats.goalsScored))]
      });
    }

    if (hasLeaderAward(leaders.cards, team, 1)) {
      addAward(awards, 'cardCollector', `${currentStats.cards} Karten im Team`, {
        value: currentStats.cards,
        details: [makeDetail('Karten', String(currentStats.cards))]
      });
    }

    getHistoricalRoundRankAwards(team, teams, pointsData || {}, fixturesData || {}, badgeSnapshots, rules)
      .forEach(award => addAward(awards, award.id, award.title, award));

    return awards;
  }

  global.BADGE_CATALOG = BADGE_CATALOG;
  global.DreamTeamBadges = Object.freeze({
    catalog: BADGE_CATALOG,
    phases: ROUND_PHASES,
    createRoundRankBadges,
    normalizeBadgeKey,
    getBadgeId,
    resolveBadge,
    classifyRoundText,
    getBadgesForTeam,
    getCatalog() {
      return BADGE_CATALOG.slice();
    }
  });
})(window);
