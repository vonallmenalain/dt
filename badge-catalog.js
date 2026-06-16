(function (global) {
  'use strict';

  const BADGE_CATALOG = Object.freeze([
    Object.freeze({
      id: 'roster',
      label: 'Nicht aufgeboten',
      emoji: '⚠️',
      description: 'Mindestens ein Spieler deines Teams steht nicht mehr im aktuellen WM-Kader.',
      howToEarn: 'Dieser Badge erscheint, wenn gespeicherte Spieler im aktuellen Kader nicht gefunden werden.',
      category: 'Fail',
      tone: 'negative',
      style: 'negative'
    }),
    Object.freeze({
      id: 'club',
      label: 'Lieblingsclub',
      emoji: '🏢',
      description: 'Mehrere Spieler aus demselben Club prägen dein Team.',
      howToEarn: 'Wähle mindestens zwei Spieler desselben Clubs.',
      category: 'Konstanz',
      tone: 'neutral',
      style: 'neutral'
    }),
    Object.freeze({
      id: 'gk',
      label: 'Top-Torwart',
      emoji: '🧤',
      description: 'Dein Torwart-Paket führt die Wertung dieser Position an.',
      howToEarn: 'Sammle unter allen Teams die meisten Punkte mit deinen Torhütern.',
      category: 'Top',
      tone: 'positive',
      style: 'positive'
    }),
    Object.freeze({
      id: 'def',
      label: 'Top-Abwehr',
      emoji: '🛡️',
      description: 'Deine Defensive holt aktuell die meisten Punkte aller Teams.',
      howToEarn: 'Sammle die meisten Punkte mit Verteidigern.',
      category: 'Top',
      tone: 'positive',
      style: 'positive'
    }),
    Object.freeze({
      id: 'mid',
      label: 'Top-Mittelfeld',
      emoji: '🎯',
      description: 'Dein Mittelfeld ist aktuell das punktstärkste im Feld.',
      howToEarn: 'Sammle die meisten Punkte mit Mittelfeldspielern.',
      category: 'Top',
      tone: 'positive',
      style: 'positive'
    }),
    Object.freeze({
      id: 'att',
      label: 'Top-Sturm',
      emoji: '⚡',
      description: 'Dein Angriff liefert aktuell die meisten Punkte.',
      howToEarn: 'Sammle die meisten Punkte mit deinen Stürmern.',
      category: 'Top',
      tone: 'positive',
      style: 'positive'
    }),
    Object.freeze({
      id: 'captain',
      label: 'Top-Captain',
      emoji: '👑',
      description: 'Dein Captain hat aktuell die meisten Captain-Punkte aller Teams.',
      howToEarn: 'Wähle den Captain mit dem besten Punktewert.',
      category: 'Captain',
      tone: 'positive',
      style: 'positive'
    }),
    Object.freeze({
      id: 'bench',
      label: 'Beste Bank',
      emoji: '🪑',
      description: 'Deine Ersatzbank liefert aktuell am stärksten.',
      howToEarn: 'Sammle mit den Bank-Slots die meisten Punkte aller Teams.',
      category: 'Chaos',
      tone: 'funny',
      style: 'funny'
    }),
    Object.freeze({
      id: 'scouting',
      label: 'Scouting-Meister',
      emoji: '🔎',
      description: 'Du findest die meisten Spieler, die sonst niemand gewählt hat.',
      howToEarn: 'Setze auf Unique Picks, die nur in deinem Team stehen.',
      category: 'Top',
      tone: 'positive',
      style: 'positive'
    }),
    Object.freeze({
      id: 'perfect',
      label: 'PerfectTeam-Treffer',
      emoji: '🏆',
      description: 'Viele deiner Spieler stehen im aktuellen PerfectTeam.',
      howToEarn: 'Habe möglichst viele Spieler im Kader, die auch im PerfectTeam landen.',
      category: 'Top',
      tone: 'positive',
      style: 'positive'
    }),
    Object.freeze({
      id: 'instinct',
      label: 'Captain-Gespür',
      emoji: '🧠',
      description: 'Dein Captain trägt besonders viel zu deinen Teampunkten bei.',
      howToEarn: 'Wähle einen Captain, der einen hohen Anteil deiner Gesamtpunkte liefert.',
      category: 'Captain',
      tone: 'positive',
      style: 'positive'
    })
  ]);

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

  addAlias('roster', ['nicht aufgeboten', 'kader alarm', 'roster', 'orphan', 'orphan count']);
  addAlias('club', ['lieblings club', 'favorite club', 'club']);
  addAlias('gk', ['keeper', 'goalkeeper', 'torwart', 'top torhueter', 'top torwart paket']);
  addAlias('def', ['abwehr', 'verteidigung', 'defense', 'defender', 'top verteidigung']);
  addAlias('mid', ['mittelfeld', 'midfield', 'midfielder']);
  addAlias('att', ['sturm', 'angriff', 'attack', 'attacker', 'forward']);
  addAlias('captain', ['captain', 'top captain', 'top kapitän', 'top kapitaen']);
  addAlias('bench', ['bank', 'ersatzbank', 'beste ersatzbank']);
  addAlias('scouting', ['scouting meister', 'scout', 'hipster scout', 'unique picks']);
  addAlias('perfect', ['perfectteam', 'perfect team', 'perfectteam treffer']);
  addAlias('instinct', ['captain gespuer', 'captain gespür', 'captain instinkt']);

  function getBadgeId(value) {
    const key = normalizeBadgeKey(value);
    if (!key) return '';
    if (ALIASES[key]) return ALIASES[key];
    if (/\bnicht aufgeboten\b/.test(key)) return 'roster';
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

  global.BADGE_CATALOG = BADGE_CATALOG;
  global.DreamTeamBadges = Object.freeze({
    catalog: BADGE_CATALOG,
    normalizeBadgeKey,
    getBadgeId,
    resolveBadge,
    getCatalog() {
      return BADGE_CATALOG.slice();
    }
  });
})(window);
