const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const TARGET_FILE = path.join(ROOT, 'playersData-wm2026-league1-season2026.js');
const REFERENCE_FILE = path.join(ROOT, 'data-wm2026.js');

const API_TEAM_LOGO_RE = /^https:\/\/media\.api-sports\.io\/football\/teams\/\d+\.png$/;
const ALLOWED_POSITIONS = new Set(['GOALKEEPER', 'DEFENDER', 'MIDFIELDER', 'ATTACKER']);
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

function readPlayersFile(filePath) {
  const text = fs.readFileSync(filePath, 'utf8');
  const match = text.match(/const\s+playersData\s*=\s*(\[[\s\S]*\])\s*;\s*$/);
  if (!match) {
    throw new Error(`Could not find a const playersData array in ${path.basename(filePath)}`);
  }

  const players = JSON.parse(match[1]);
  if (!Array.isArray(players)) {
    throw new Error(`playersData is not an array in ${path.basename(filePath)}`);
  }

  return players;
}

function normalizeText(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

function countByTeam(players) {
  const counts = new Map();
  for (const player of players) {
    const team = player['Nationalteam.name'];
    counts.set(team, (counts.get(team) || 0) + 1);
  }
  return counts;
}

function findById(players, id) {
  return players.find((player) => player['player.id'] === id);
}

function isCapeVerde(player) {
  const team = normalizeText(player['Nationalteam.name']);
  return team === 'cape verde islands' || team === 'cabo verde';
}

function main() {
  const errors = [];
  const warnings = [];
  let targetPlayers;
  let referencePlayers;

  try {
    targetPlayers = readPlayersFile(TARGET_FILE);
    referencePlayers = readPlayersFile(REFERENCE_FILE);
  } catch (error) {
    console.error(error.message);
    process.exit(1);
  }

  if (targetPlayers.length !== referencePlayers.length) {
    errors.push(`Player count changed: target=${targetPlayers.length}, reference=${referencePlayers.length}`);
  }

  const expectedShape = EXPECTED_FIELDS.join('\u0000');
  for (const [index, player] of targetPlayers.entries()) {
    const actualShape = Object.keys(player).join('\u0000');
    if (actualShape !== expectedShape) {
      errors.push(`Unexpected fields at index ${index} (${player.Spielername || 'unknown'})`);
    }
  }

  const seenIds = new Map();
  for (const player of targetPlayers) {
    const id = player['player.id'];
    if (!seenIds.has(id)) seenIds.set(id, []);
    seenIds.get(id).push(player.Spielername);
  }
  for (const [id, names] of seenIds.entries()) {
    if (names.length > 1) {
      errors.push(`Duplicate player.id ${id}: ${names.join(', ')}`);
    }
  }

  for (const player of targetPlayers) {
    if (player.Position === 'FORWARD') {
      errors.push(`FORWARD still present: ${player['player.id']} ${player.Spielername}`);
    }
    if (!ALLOWED_POSITIONS.has(player.Position)) {
      errors.push(`Invalid position ${player.Position}: ${player['player.id']} ${player.Spielername}`);
    }
  }

  const arda = findById(targetPlayers, 291964);
  if (!arda || arda.Position !== 'MIDFIELDER') {
    errors.push(`Arda Guler/player.id 291964 expected MIDFIELDER, found ${arda ? arda.Position : 'missing'}`);
  }

  const leroy = findById(targetPlayers, 644);
  if (!leroy || leroy.Position !== 'ATTACKER') {
    errors.push(`Leroy Sane/player.id 644 expected ATTACKER, found ${leroy ? leroy.Position : 'missing'}`);
  }

  const targetTeamCounts = countByTeam(targetPlayers);
  const referenceTeamCounts = countByTeam(referencePlayers);
  if (targetTeamCounts.size !== referenceTeamCounts.size) {
    errors.push(`Team count changed: target=${targetTeamCounts.size}, reference=${referenceTeamCounts.size}`);
  }

  const missingReferenceTeamNames = [];
  for (const [team, referenceCount] of referenceTeamCounts.entries()) {
    const targetCount = targetTeamCounts.get(team);
    if (targetCount === undefined) {
      missingReferenceTeamNames.push(team);
      continue;
    }
    if (targetCount !== referenceCount) {
      errors.push(`Roster size changed for ${team}: target=${targetCount}, reference=${referenceCount}`);
    }
  }
  if (missingReferenceTeamNames.length) {
    warnings.push(`Reference team names not found verbatim in target, likely accepted naming variants: ${missingReferenceTeamNames.join(', ')}`);
  }

  if (targetTeamCounts.size !== 48) {
    warnings.push(`Expected 48 teams, found ${targetTeamCounts.size}`);
  }

  for (const [team, count] of targetTeamCounts.entries()) {
    if (count !== 26) {
      errors.push(`Team ${team} has ${count} players, expected 26`);
    }
  }

  for (const player of targetPlayers) {
    const logo = player['Club.logo'];
    if (logo && !API_TEAM_LOGO_RE.test(logo)) {
      errors.push(`Club.logo is not an API-Football team logo: ${player['player.id']} ${player.Spielername} -> ${logo}`);
    }
  }

  const missingWeights = targetPlayers.filter((player) => !String(player.Gewicht || '').trim()).length;
  const missingClubLogos = targetPlayers.filter((player) => player['Club.logo'] === '').length;
  const missingClubLogosWithClub = targetPlayers.filter((player) => player['Club.logo'] === '' && String(player['Club.name'] || '').trim()).length;
  const capeVerdeGaps = targetPlayers
    .filter(isCapeVerde)
    .flatMap((player) => ['Club.name', 'Club.logo', 'Geburtsdatum', 'Groesse', 'Gewicht']
      .filter((field) => String(player[field] || '') === '')
      .map((field) => ({ player, field })));

  if (missingWeights) {
    warnings.push(`Missing Gewicht values are non-blocking: ${missingWeights}`);
  }
  if (missingClubLogos) {
    warnings.push(`Missing Club.logo values are non-blocking: ${missingClubLogos} total, ${missingClubLogosWithClub} with Club.name`);
  }
  if (capeVerdeGaps.length) {
    warnings.push(`Cape Verde gaps ignored: ${capeVerdeGaps.length}`);
  }

  const result = {
    ok: errors.length === 0,
    players: targetPlayers.length,
    teams: targetTeamCounts.size,
    forwardCount: targetPlayers.filter((player) => player.Position === 'FORWARD').length,
    missingClubLogos,
    missingClubLogosWithClub,
    missingWeights,
    capeVerdeGapsIgnored: capeVerdeGaps.length,
    warnings,
    errors
  };

  console.log(JSON.stringify(result, null, 2));
  if (errors.length) process.exit(1);
}

main();
