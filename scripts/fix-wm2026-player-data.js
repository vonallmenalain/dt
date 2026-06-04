const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const TARGET_FILE = path.join(ROOT, 'playersData-wm2026-league1-season2026.js');
const OLD_FILE = path.join(ROOT, 'data-wm2026.js');
const REPORT_DIR = path.join(ROOT, 'reports');
const REPORT_FILE = path.join(REPORT_DIR, 'wm2026-data-fix-report.md');
const MISSING_CSV_FILE = path.join(REPORT_DIR, 'wm2026-missing-club-logos.csv');
const DRY_RUN = process.argv.includes('--dry-run');

const API_TEAM_LOGO_RE = /^https:\/\/media\.api-sports\.io\/football\/teams\/\d+\.png$/;
const POSITION_VALUES = new Set(['GOALKEEPER', 'DEFENDER', 'MIDFIELDER', 'ATTACKER']);

const EXPECTED_FIELDS = [
  'player.id',
  'Spielername',
  'Spielerfoto',
  'Position',
  'Nationalteam.name',
  'Nationalteam.logo',
  'Club.name',
  'Club.logo',
  'Geburtsdatum',
  'Groesse',
  'Gewicht'
];

const SPECIAL_POSITIONS = [
  {
    id: 291964,
    names: ['Arda Guler', 'Arda Güler'],
    position: 'MIDFIELDER'
  },
  {
    id: 644,
    names: ['Leroy Sane', 'Leroy Sané'],
    position: 'ATTACKER'
  }
];

const ALIAS_GROUPS = [
  {
    label: 'Borussia Dortmund',
    aliases: ['Borussia Dortmund', 'BVB'],
    logo: 'https://media.api-sports.io/football/teams/165.png'
  },
  {
    label: 'Bayer Leverkusen',
    aliases: ['Bayer Leverkusen', 'Bayer 04 Leverkusen'],
    logo: 'https://media.api-sports.io/football/teams/168.png'
  },
  {
    label: 'Real Madrid',
    aliases: ['Real Madrid C. F.', 'Real Madrid CF', 'Real Madrid'],
    logo: 'https://media.api-sports.io/football/teams/541.png'
  },
  {
    label: 'Esperance Tunis',
    aliases: ['Esperance De Tunisie', 'Esperance Tunis', 'ES Tunis'],
    logo: 'https://media.api-sports.io/football/teams/980.png'
  },
  {
    label: 'Al Duhail SC',
    aliases: ['Al Duhail SC', 'Al-Duhail SC', 'Al Duhail'],
    logo: 'https://media.api-sports.io/football/teams/2904.png'
  },
  {
    label: 'Granada CF',
    aliases: ['Granada CF', 'Granada'],
    logo: 'https://media.api-sports.io/football/teams/715.png'
  }
];

function readPlayersFile(filePath) {
  const text = fs.readFileSync(filePath, 'utf8');
  const match = text.match(/const\s+playersData\s*=\s*(\[[\s\S]*\])\s*;\s*$/);
  if (!match) {
    throw new Error(`Could not find a const playersData array in ${path.basename(filePath)}`);
  }

  return {
    text,
    players: JSON.parse(match[1])
  };
}

function normalizeText(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[’‘`´]/g, "'")
    .replace(/&/g, ' and ')
    .replace(/[-‐-―]/g, ' ')
    .replace(/[.,']/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function normalizeClub(value) {
  return normalizeText(value);
}

function normalizeName(value) {
  return normalizeText(value);
}

const aliasByKey = new Map();
for (const group of ALIAS_GROUPS) {
  for (const alias of group.aliases) {
    aliasByKey.set(normalizeClub(alias), group);
  }
}

function findAliasGroup(clubName) {
  return aliasByKey.get(normalizeClub(clubName)) || null;
}

function isValidLogo(logo) {
  return typeof logo === 'string' && API_TEAM_LOGO_RE.test(logo);
}

function hasUsableLogo(player) {
  const logo = player['Club.logo'];
  return isValidLogo(logo);
}

function hasClubName(player) {
  return Boolean(String(player['Club.name'] || '').trim());
}

function isCapeVerde(player) {
  const team = normalizeText(player['Nationalteam.name']);
  return team === 'cape verde islands' || team === 'cabo verde';
}

function makeIdMap(players) {
  const map = new Map();
  for (const player of players) {
    const id = player['player.id'];
    if (!map.has(id)) map.set(id, []);
    map.get(id).push(player);
  }
  return map;
}

function buildClubLogoCandidates(sources) {
  const candidates = new Map();

  for (const source of sources) {
    for (const player of source.players) {
      const clubName = String(player['Club.name'] || '').trim();
      if (!clubName || !hasUsableLogo(player)) continue;

      const key = normalizeClub(clubName);
      if (!candidates.has(key)) {
        candidates.set(key, {
          clubNames: new Set(),
          logos: new Map()
        });
      }

      const bucket = candidates.get(key);
      bucket.clubNames.add(clubName);
      const logo = player['Club.logo'];
      if (!bucket.logos.has(logo)) {
        bucket.logos.set(logo, {
          count: 0,
          sources: new Set(),
          examples: []
        });
      }

      const logoBucket = bucket.logos.get(logo);
      logoBucket.count += 1;
      logoBucket.sources.add(source.name);
      if (logoBucket.examples.length < 5) {
        logoBucket.examples.push(`${player.Spielername} (${clubName})`);
      }
    }
  }

  return candidates;
}

function uniqueLogoForClubName(candidates, clubName) {
  const bucket = candidates.get(normalizeClub(clubName));
  if (!bucket || bucket.logos.size !== 1) return null;
  const [logo, meta] = bucket.logos.entries().next().value;
  return { logo, meta };
}

function ambiguousLogosForClubName(candidates, clubName) {
  const bucket = candidates.get(normalizeClub(clubName));
  if (!bucket || bucket.logos.size <= 1) return null;
  return bucket;
}

function clubsEquivalent(left, right) {
  if (!left || !right) return false;
  if (normalizeClub(left) === normalizeClub(right)) return true;

  const leftGroup = findAliasGroup(left);
  const rightGroup = findAliasGroup(right);
  return Boolean(leftGroup && rightGroup && leftGroup === rightGroup);
}

function findAliasLogoCandidate(candidates, clubName) {
  const group = findAliasGroup(clubName);
  if (!group) return null;

  const foundLogos = new Map();
  for (const alias of group.aliases) {
    const bucket = candidates.get(normalizeClub(alias));
    if (!bucket) continue;
    for (const [logo, meta] of bucket.logos.entries()) {
      if (!foundLogos.has(logo)) {
        foundLogos.set(logo, {
          aliases: new Set(),
          sources: new Set(),
          examples: []
        });
      }
      const found = foundLogos.get(logo);
      found.aliases.add(alias);
      for (const source of meta.sources) found.sources.add(source);
      found.examples.push(...meta.examples);
    }
  }

  if (foundLogos.size === 1) {
    const [logo, meta] = foundLogos.entries().next().value;
    return {
      logo,
      source: 'alias-map',
      confidence: 'high',
      detail: `${group.label}; repo aliases: ${Array.from(meta.aliases).join(', ')}`
    };
  }

  if (foundLogos.size > 1) {
    return {
      ambiguous: true,
      group,
      logos: Array.from(foundLogos.keys())
    };
  }

  return {
    logo: group.logo,
    source: 'manual-seed',
    confidence: 'high',
    detail: `${group.label}; verified API-Football seed from task`
  };
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function replaceFieldInPlayerBlock(text, playerId, fieldName, newValue) {
  const marker = `"player.id": ${playerId},`;
  const markerIndex = text.indexOf(marker);
  if (markerIndex === -1) {
    throw new Error(`Could not find player.id ${playerId} in target text`);
  }

  const blockStart = text.lastIndexOf('    {', markerIndex);
  const blockEndMarkerIndex = text.indexOf('\n    }', markerIndex);
  if (blockStart === -1 || blockEndMarkerIndex === -1) {
    throw new Error(`Could not isolate player object for player.id ${playerId}`);
  }

  const blockEnd = blockEndMarkerIndex + '\n    }'.length;
  const block = text.slice(blockStart, blockEnd);
  const fieldRe = new RegExp(`("${escapeRegExp(fieldName)}"\\s*:\\s*)"[^"]*"`);
  if (!fieldRe.test(block)) {
    throw new Error(`Could not find field ${fieldName} for player.id ${playerId}`);
  }

  const updatedBlock = block.replace(fieldRe, (_match, prefix) => `${prefix}${JSON.stringify(newValue)}`);
  return text.slice(0, blockStart) + updatedBlock + text.slice(blockEnd);
}

function updatePositionText(text, originalPlayers) {
  const forwardMatches = text.match(/"Position": "FORWARD"/g) || [];
  let updated = text.replace(/"Position": "FORWARD"/g, '"Position": "ATTACKER"');

  for (const special of SPECIAL_POSITIONS) {
    const player = originalPlayers.find((candidate) => {
      if (candidate['player.id'] === special.id) return true;
      const candidateName = normalizeName(candidate.Spielername);
      return special.names.some((name) => candidateName === normalizeName(name));
    });
    if (!player) {
      throw new Error(`Could not find special position player ${special.id}`);
    }
    updated = replaceFieldInPlayerBlock(updated, player['player.id'], 'Position', special.position);
  }

  return {
    text: updated,
    forwardNormalizations: forwardMatches.length
  };
}

function chooseLogoCandidate(player, oldById, clubLogoCandidates, warnings) {
  const clubName = String(player['Club.name'] || '').trim();
  if (!clubName) return null;

  const oldMatches = oldById.get(player['player.id']) || [];
  if (oldMatches.length === 1) {
    const oldPlayer = oldMatches[0];
    if (
      hasUsableLogo(oldPlayer) &&
      hasClubName(oldPlayer) &&
      clubsEquivalent(clubName, oldPlayer['Club.name'])
    ) {
      return {
        logo: oldPlayer['Club.logo'],
        source: 'same-player-old-file',
        confidence: 'high',
        detail: `old club: ${oldPlayer['Club.name']}`
      };
    }
  }

  const ambiguousExact = ambiguousLogosForClubName(clubLogoCandidates, clubName);
  if (ambiguousExact) {
    warnings.push({
      clubName,
      key: normalizeClub(clubName),
      logos: Array.from(ambiguousExact.logos.keys()),
      reason: 'exact normalized club name has multiple logos'
    });
    return null;
  }

  const exact = uniqueLogoForClubName(clubLogoCandidates, clubName);
  if (exact) {
    return {
      logo: exact.logo,
      source: 'club-name-map',
      confidence: 'high',
      detail: `normalized club: ${normalizeClub(clubName)}`
    };
  }

  const aliasCandidate = findAliasLogoCandidate(clubLogoCandidates, clubName);
  if (!aliasCandidate) return null;
  if (aliasCandidate.ambiguous) {
    warnings.push({
      clubName,
      key: normalizeClub(clubName),
      logos: aliasCandidate.logos,
      reason: `alias group ${aliasCandidate.group.label} has multiple repo logos`
    });
    return null;
  }

  return aliasCandidate;
}

function buildFinalPlayersFromText(text) {
  const match = text.match(/const\s+playersData\s*=\s*(\[[\s\S]*\])\s*;\s*$/);
  if (!match) throw new Error('Updated text no longer contains a playersData array');
  return JSON.parse(match[1]);
}

function countByTeam(players) {
  const counts = new Map();
  for (const player of players) {
    const team = player['Nationalteam.name'];
    counts.set(team, (counts.get(team) || 0) + 1);
  }
  return counts;
}

function findDuplicates(players) {
  const byId = makeIdMap(players);
  return Array.from(byId.entries())
    .filter(([, values]) => values.length > 1)
    .map(([id, values]) => ({
      id,
      players: values.map((player) => player.Spielername)
    }));
}

function fieldShapeIssues(players) {
  const expected = EXPECTED_FIELDS.join('\u0000');
  return players
    .map((player, index) => ({
      index,
      player,
      actual: Object.keys(player)
    }))
    .filter((entry) => entry.actual.join('\u0000') !== expected);
}

function playerLabel(player) {
  if (!player) return '-';
  return `${player.Spielername} | ${player['Nationalteam.name']} | ${player['Club.name']} | ${player.Position}`;
}

function recordsForIds(players, ids) {
  const byId = makeIdMap(players);
  return ids.flatMap((id) => (byId.get(id) || []).map((player) => ({ id, player })));
}

function recordsForNames(players, names) {
  const normalizedNames = names.map(normalizeName);
  return players
    .filter((player) => {
      const name = normalizeName(player.Spielername);
      return normalizedNames.some((needle) => name.includes(needle));
    })
    .map((player) => ({
      id: player['player.id'],
      player
    }));
}

function missingLogoReason(player, clubLogoCandidates) {
  const clubName = String(player['Club.name'] || '').trim();
  if (!clubName) {
    return isCapeVerde(player) ? 'cape-verde-empty-club' : 'empty-club-name';
  }

  const ambiguous = ambiguousLogosForClubName(clubLogoCandidates, clubName);
  if (ambiguous) return 'ambiguous-club-name';
  return isCapeVerde(player) ? 'cape-verde-no-safe-logo' : 'no-safe-logo-match';
}

function capeVerdeGaps(players) {
  const fields = ['Club.name', 'Club.logo', 'Geburtsdatum', 'Groesse', 'Gewicht'];
  const gaps = [];
  for (const player of players.filter(isCapeVerde)) {
    for (const field of fields) {
      if (String(player[field] || '') === '') {
        gaps.push({
          id: player['player.id'],
          name: player.Spielername,
          field
        });
      }
    }
  }
  return gaps;
}

function markdownCell(value) {
  return String(value ?? '')
    .replace(/\r?\n/g, ' ')
    .replace(/\|/g, '\\|');
}

function markdownTable(headers, rows) {
  if (!rows.length) return '_Keine._\n';
  const header = `| ${headers.map(markdownCell).join(' | ')} |`;
  const divider = `| ${headers.map(() => '---').join(' | ')} |`;
  const body = rows.map((row) => `| ${row.map(markdownCell).join(' | ')} |`);
  return [header, divider, ...body].join('\n') + '\n';
}

function csvValue(value) {
  const text = String(value ?? '');
  if (!/[",\r\n]/.test(text)) return text;
  return `"${text.replace(/"/g, '""')}"`;
}

function csvRows(headers, rows) {
  return [
    headers.map(csvValue).join(','),
    ...rows.map((row) => headers.map((header) => csvValue(row[header])).join(','))
  ].join('\n') + '\n';
}

function buildReport(data) {
  const {
    originalPlayers,
    finalPlayers,
    oldPlayers,
    filledLogos,
    ambiguousWarnings,
    forwardNormalizations,
    positionChanges,
    missingBeforeWithClub,
    missingAfterWithClub,
    missingAfterAll,
    capeGaps,
    specialStatus,
    duplicateIds,
    id753Report,
    chongKenjiReport,
    manualCheckpointCount
  } = data;

  const teamCounts = countByTeam(finalPlayers);
  const non26Teams = Array.from(teamCounts.entries()).filter(([, count]) => count !== 26);
  const invalidPositions = Array.from(new Set(finalPlayers.map((player) => player.Position))).filter(
    (position) => !POSITION_VALUES.has(position)
  );
  const shapeIssues = fieldShapeIssues(finalPlayers);

  const lines = [];
  lines.push('# WM 2026 Player Data Fix Report');
  lines.push('');
  lines.push(`Generated: ${new Date().toISOString()}`);
  lines.push('');
  lines.push('## Summary');
  lines.push('');
  lines.push(`- Target file: \`${path.basename(TARGET_FILE)}\``);
  lines.push(`- Reference file: \`${path.basename(OLD_FILE)}\``);
  lines.push(`- Player count: ${finalPlayers.length} (reference: ${oldPlayers.length})`);
  lines.push(`- Teams: ${teamCounts.size}`);
  lines.push(`- FORWARD before: ${forwardNormalizations}`);
  lines.push(`- FORWARD after: ${finalPlayers.filter((player) => player.Position === 'FORWARD').length}`);
  lines.push(`- Position fields changed: ${positionChanges.length}`);
  lines.push(`- Missing club logos before (with Club.name): ${missingBeforeWithClub.length}`);
  lines.push(`- Missing club logos after (with Club.name): ${missingAfterWithClub.length}`);
  lines.push(`- Missing club logos after (all): ${missingAfterAll.length}`);
  lines.push(`- Club logos filled: ${filledLogos.length}`);
  lines.push(`- Cape Verde gaps ignored: ${capeGaps.length}`);
  lines.push(`- Manual checkpoints still open: ${manualCheckpointCount}`);
  lines.push('');
  lines.push('## Validation Signals');
  lines.push('');
  lines.push(`- Duplicate player.id values in target: ${duplicateIds.length}`);
  lines.push(`- Unexpected field-shape entries: ${shapeIssues.length}`);
  lines.push(`- Invalid positions: ${invalidPositions.length ? invalidPositions.join(', ') : 'none'}`);
  lines.push(`- Teams not at 26 players: ${non26Teams.length ? non26Teams.map(([team, count]) => `${team}=${count}`).join(', ') : 'none'}`);
  lines.push(`- API-Football team-search was not used; no local team-search cache/client for teams was found beyond existing data files and checked scripts require RAPIDAPI_KEY for fixture workflows.`);
  lines.push('');
  lines.push('## Special Positions');
  lines.push('');
  lines.push(
    markdownTable(
      ['player.id', 'Name', 'Final Position', 'Expected', 'Status'],
      specialStatus.map((entry) => [
        entry.id,
        entry.player ? entry.player.Spielername : '-',
        entry.player ? entry.player.Position : '-',
        entry.expected,
        entry.ok ? 'ok' : 'needs review'
      ])
    )
  );
  lines.push('## Position Changes');
  lines.push('');
  lines.push(
    markdownTable(
      ['player.id', 'Name', 'Nationalteam', 'Before', 'After'],
      positionChanges.map((entry) => [
        entry.id,
        entry.name,
        entry.team,
        entry.before,
        entry.after
      ])
    )
  );
  lines.push('## Filled Club Logos');
  lines.push('');
  lines.push(
    markdownTable(
      ['Spielername', 'player.id', 'Nationalteam', 'Club.name', 'Club.logo', 'Source', 'Confidence', 'Detail'],
      filledLogos.map((entry) => [
        entry.playerName,
        entry.id,
        entry.team,
        entry.clubName,
        entry.logo,
        entry.source,
        entry.confidence,
        entry.detail
      ])
    )
  );
  lines.push('## Still Missing Club Logos');
  lines.push('');
  lines.push(
    markdownTable(
      ['Spielername', 'player.id', 'Nationalteam', 'Club.name', 'Reason'],
      missingAfterAll.map((player) => [
        player.Spielername,
        player['player.id'],
        player['Nationalteam.name'],
        player['Club.name'],
        missingLogoReason(player, data.clubLogoCandidates)
      ])
    )
  );
  lines.push('## Cape Verde Gaps Ignored');
  lines.push('');
  lines.push(
    markdownTable(
      ['player.id', 'Spielername', 'Field'],
      capeGaps.map((gap) => [gap.id, gap.name, gap.field])
    )
  );
  lines.push('## Ambiguous Club Names');
  lines.push('');
  lines.push(
    markdownTable(
      ['Club.name', 'Normalized key', 'Candidate logos', 'Reason'],
      ambiguousWarnings.map((warning) => [
        warning.clubName,
        warning.key,
        warning.logos.join('; '),
        warning.reason
      ])
    )
  );
  lines.push('## ID Special Case 753 / 37127');
  lines.push('');
  lines.push(
    markdownTable(
      ['File', 'player.id', 'Record'],
      id753Report.map((entry) => [entry.file, entry.id, playerLabel(entry.player)])
    )
  );
  lines.push('');
  lines.push(
    duplicateIds.length
      ? `Duplicate IDs in target: ${duplicateIds.map((entry) => `${entry.id} (${entry.players.join(', ')})`).join('; ')}`
      : 'No duplicate player.id values were found in the target file.'
  );
  lines.push('');
  lines.push('Recommendation: no automatic ID correction was applied. The target file is internally consistent for these IDs if the table above reflects the intended identities.');
  lines.push('');
  lines.push('## Tahith Chong / Kenji Gorre Check');
  lines.push('');
  lines.push(
    markdownTable(
      ['File', 'player.id', 'Record'],
      chongKenjiReport.map((entry) => [entry.file, entry.id, playerLabel(entry.player)])
    )
  );
  lines.push('');
  lines.push('Recommendation: no automatic identity correction was applied; the local old/new records are reported above for manual review.');
  lines.push('');
  lines.push('## Manual Seed Logos');
  lines.push('');
  lines.push(
    markdownTable(
      ['Club group', 'Aliases', 'Logo'],
      ALIAS_GROUPS.map((group) => [group.label, group.aliases.join('; '), group.logo])
    )
  );
  lines.push('');
  lines.push('## Notes');
  lines.push('');
  lines.push('- Club names were not changed.');
  lines.push('- Missing weights were not filled.');
  lines.push('- Empty Cape Verde values are listed above but are not treated as blockers.');
  lines.push('- Logo decisions were limited to same-player old-file matches, unique club-name mappings, alias mappings, or the task-provided manual seeds.');
  lines.push(`- Original player count used during this run: ${originalPlayers.length}.`);
  lines.push('');

  return lines.join('\n');
}

function main() {
  const target = readPlayersFile(TARGET_FILE);
  const old = readPlayersFile(OLD_FILE);
  const originalPlayers = target.players;
  const oldPlayers = old.players;
  const oldById = makeIdMap(oldPlayers);

  const clubLogoCandidates = buildClubLogoCandidates([
    { name: 'old-file', players: oldPlayers },
    { name: 'new-file', players: originalPlayers }
  ]);

  let updatedText = target.text;
  const positionUpdate = updatePositionText(updatedText, originalPlayers);
  updatedText = positionUpdate.text;

  const ambiguousWarnings = [];
  const filledLogos = [];
  const playersMissingLogoBefore = originalPlayers.filter((player) => player['Club.logo'] === '');
  const missingBeforeWithClub = playersMissingLogoBefore.filter(hasClubName);

  for (const player of missingBeforeWithClub) {
    const candidate = chooseLogoCandidate(player, oldById, clubLogoCandidates, ambiguousWarnings);
    if (!candidate) continue;

    updatedText = replaceFieldInPlayerBlock(updatedText, player['player.id'], 'Club.logo', candidate.logo);
    filledLogos.push({
      playerName: player.Spielername,
      id: player['player.id'],
      team: player['Nationalteam.name'],
      clubName: player['Club.name'],
      logo: candidate.logo,
      source: candidate.source,
      confidence: candidate.confidence,
      detail: candidate.detail
    });
  }

  const finalPlayers = buildFinalPlayersFromText(updatedText);
  const finalById = makeIdMap(finalPlayers);

  const positionChanges = originalPlayers
    .map((before) => {
      const after = (finalById.get(before['player.id']) || [])[0];
      if (!after || before.Position === after.Position) return null;
      return {
        id: before['player.id'],
        name: before.Spielername,
        team: before['Nationalteam.name'],
        before: before.Position,
        after: after.Position
      };
    })
    .filter(Boolean);

  const specialStatus = SPECIAL_POSITIONS.map((special) => {
    const player = (finalById.get(special.id) || []).find((candidate) => {
      const candidateName = normalizeName(candidate.Spielername);
      return special.names.some((name) => candidateName === normalizeName(name));
    }) || (finalById.get(special.id) || [])[0];
    return {
      id: special.id,
      player,
      expected: special.position,
      ok: Boolean(player && player.Position === special.position)
    };
  });

  const missingAfterAll = finalPlayers.filter((player) => player['Club.logo'] === '');
  const missingAfterWithClub = missingAfterAll.filter(hasClubName);
  const capeGaps = capeVerdeGaps(finalPlayers);
  const duplicateIds = findDuplicates(finalPlayers);

  const id753Report = [
    ...recordsForIds(oldPlayers, [753, 37127]).map((entry) => ({ file: 'old data-wm2026.js', ...entry })),
    ...recordsForIds(finalPlayers, [753, 37127]).map((entry) => ({ file: 'target playersData', ...entry }))
  ];

  const chongKenjiIds = [906, 41627];
  const chongKenjiNames = ['Tahith Chong', 'Kenji Gorre', 'Kenji Gorré'];
  const chongKenjiReport = [
    ...recordsForIds(oldPlayers, chongKenjiIds).map((entry) => ({ file: 'old data-wm2026.js', ...entry })),
    ...recordsForNames(oldPlayers, chongKenjiNames).map((entry) => ({ file: 'old data-wm2026.js', ...entry })),
    ...recordsForIds(finalPlayers, chongKenjiIds).map((entry) => ({ file: 'target playersData', ...entry })),
    ...recordsForNames(finalPlayers, chongKenjiNames).map((entry) => ({ file: 'target playersData', ...entry }))
  ].filter((entry, index, all) => {
    const key = `${entry.file}|${entry.id}|${entry.player.Spielername}`;
    return all.findIndex((candidate) => `${candidate.file}|${candidate.id}|${candidate.player.Spielername}` === key) === index;
  });

  const manualCheckpointCount = missingAfterWithClub.length + ambiguousWarnings.length + 2;

  const report = buildReport({
    originalPlayers,
    finalPlayers,
    oldPlayers,
    filledLogos,
    ambiguousWarnings,
    forwardNormalizations: positionUpdate.forwardNormalizations,
    positionChanges,
    missingBeforeWithClub,
    missingAfterWithClub,
    missingAfterAll,
    capeGaps,
    specialStatus,
    duplicateIds,
    id753Report,
    chongKenjiReport,
    manualCheckpointCount,
    clubLogoCandidates
  });

  const missingCsv = csvRows(
    ['player.id', 'Spielername', 'Nationalteam.name', 'Club.name', 'Reason'],
    missingAfterAll.map((player) => ({
      'player.id': player['player.id'],
      Spielername: player.Spielername,
      'Nationalteam.name': player['Nationalteam.name'],
      'Club.name': player['Club.name'],
      Reason: missingLogoReason(player, clubLogoCandidates)
    }))
  );

  if (!DRY_RUN) {
    fs.writeFileSync(TARGET_FILE, updatedText, 'utf8');
    fs.mkdirSync(REPORT_DIR, { recursive: true });
    fs.writeFileSync(REPORT_FILE, report, 'utf8');
    fs.writeFileSync(MISSING_CSV_FILE, missingCsv, 'utf8');
  }

  console.log(JSON.stringify({
    dryRun: DRY_RUN,
    players: finalPlayers.length,
    forwardBefore: positionUpdate.forwardNormalizations,
    forwardAfter: finalPlayers.filter((player) => player.Position === 'FORWARD').length,
    positionChanges: positionChanges.length,
    clubLogosFilled: filledLogos.length,
    missingClubLogosAfterAll: missingAfterAll.length,
    missingClubLogosAfterWithClub: missingAfterWithClub.length,
    capeVerdeGapsIgnored: capeGaps.length,
    manualCheckpoints: manualCheckpointCount
  }, null, 2));
}

main();
