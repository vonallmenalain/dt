#!/usr/bin/env node
/* =============================================================================
 *  scripts/enrich-fifa-2026-squad-base-players.mjs
 *
 *  Enriches `fifa_2026_squad_base_players.json`, which is treated as the
 *  official squad source, with API-Football data for DreamTeam:
 *
 *    - player.id
 *    - Spielerfoto
 *    - Nationalteam.name / Nationalteam.logo from API-Football where possible
 *    - Club.name / Club.logo from the newest available club statistics
 *    - Gewicht
 *    - App position vocabulary (FORWARD -> ATTACKER)
 *
 *  Important: The official JSON remains the source of truth for squad
 *  membership and positions. API-Football is used only as enrichment/matching.
 *
 *  Usage:
 *    RAPIDAPI_KEY=... node scripts/enrich-fifa-2026-squad-base-players.mjs
 *    RAPIDAPI_KEY=... node scripts/enrich-fifa-2026-squad-base-players.mjs --write-data
 *
 *  Useful options:
 *    --dry-run              Do not write output files.
 *    --write-data           Also write data-wm2026.js if every player matched.
 *    --force-data-file      Write data-wm2026.js even with unmatched players.
 *    --team Switzerland     Limit to one FIFA team name while testing.
 *    --limit 50             Limit number of official rows while testing.
 *    --offline-local-data   No API calls; use existing data-wm2026.js as
 *                           candidate source for local matching tests.
 * ============================================================================= */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { createApiClient } from "./lib/apiFootball.mjs";
import {
  buildFullName,
  cleanHeight,
  cleanWeight,
  normalizePosition,
  pickClubFromStats,
  repoRootFromScript,
} from "./lib/kaderHelpers.mjs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = repoRootFromScript(__dirname);

const LEAGUE_ID = 1;
const SEASON = 2026;
const DEFAULT_DETAIL_SEASONS = [2026, 2025, 2024, 2023, 2022, 2021];

const INPUT_JSON = path.join(REPO_ROOT, "fifa_2026_squad_base_players.json");
const OUTPUT_JSON = path.join(REPO_ROOT, "fifa_2026_squad_enriched_players.json");
const TARGET_DATA_FILE = path.join(REPO_ROOT, "data-wm2026.js");
const LOCAL_DATA_FILE = path.join(REPO_ROOT, "data-wm2026.js");
const REPORTS_DIR = path.join(REPO_ROOT, "reports");
const REPORT_JSON = path.join(REPORTS_DIR, "wm2026-squad-enrichment-report.json");
const REPORT_MD = path.join(REPORTS_DIR, "wm2026-squad-enrichment-report.md");
const CACHE_FILE = path.join(REPORTS_DIR, "wm2026-squad-enrichment-cache.json");

const PLAYER_PHOTO_BASE = "https://media.api-sports.io/football/players/";

const TEAM_ALIASES = {
  "bosnia and herzegovina": ["bosnia & herzegovina", "bosnia-herzegovina"],
  "cabo verde": ["cape verde islands", "cape verde"],
  "cote d ivoire": ["ivory coast", "cote d'ivoire", "cote d ivoire"],
  "czechia": ["czech republic", "czechia"],
  "ir iran": ["iran", "ir iran"],
  "korea republic": ["south korea", "korea republic", "republic of korea"],
  "turkiye": ["turkey", "turkiye", "tuerkiye"],
  "usa": ["usa", "united states", "united states of america"],
};

function log(msg) {
  console.log(`[enrich-wm2026] ${msg}`);
}

function ensureDir(dir) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

function usage() {
  return [
    "Usage: node scripts/enrich-fifa-2026-squad-base-players.mjs [options]",
    "",
    "Options:",
    "  --dry-run                 Do not write output files.",
    "  --write-data              Also write data-wm2026.js if all players matched.",
    "  --force-data-file         Write data-wm2026.js even with unmatched players.",
    "  --team <name>             Limit to one official team name while testing.",
    "  --limit <n>               Limit official rows while testing.",
    "  --input <file>            Base JSON path.",
    "  --output-json <file>      Enriched JSON path.",
    "  --data-file <file>        DreamTeam data file path.",
    "  --cache-file <file>       API cache path.",
    "  --refresh-cache           Ignore existing cache entries.",
    "  --no-search               Skip /players?search fallback.",
    "  --offline-local-data      No API calls; match against existing data-wm2026.js.",
    "  --help                    Show this help.",
  ].join("\n");
}

function parseArgs(argv) {
  const args = {
    dryRun: false,
    writeData: false,
    forceDataFile: false,
    input: INPUT_JSON,
    outputJson: OUTPUT_JSON,
    dataFile: TARGET_DATA_FILE,
    reportJson: REPORT_JSON,
    reportMd: REPORT_MD,
    cacheFile: CACHE_FILE,
    localDataFile: LOCAL_DATA_FILE,
    refreshCache: false,
    noSearch: false,
    offlineLocalData: false,
    team: "",
    limit: 0,
    detailSeasons: DEFAULT_DETAIL_SEASONS,
  };

  const list = argv.slice(2);
  for (let i = 0; i < list.length; i++) {
    const a = list[i];
    const next = () => {
      i += 1;
      if (i >= list.length) throw new Error(`Missing value after ${a}.`);
      return list[i];
    };

    if (a === "--dry-run") args.dryRun = true;
    else if (a === "--write-data") args.writeData = true;
    else if (a === "--force-data-file") args.forceDataFile = true;
    else if (a === "--refresh-cache") args.refreshCache = true;
    else if (a === "--no-search") args.noSearch = true;
    else if (a === "--offline-local-data") args.offlineLocalData = true;
    else if (a === "--team") args.team = next();
    else if (a === "--limit") args.limit = Math.max(0, Number(next()) || 0);
    else if (a === "--input") args.input = path.resolve(next());
    else if (a === "--output-json") args.outputJson = path.resolve(next());
    else if (a === "--data-file") args.dataFile = path.resolve(next());
    else if (a === "--cache-file") args.cacheFile = path.resolve(next());
    else if (a === "--local-data-file") args.localDataFile = path.resolve(next());
    else if (a === "--detail-seasons") {
      args.detailSeasons = next()
        .split(",")
        .map((s) => Number(String(s).trim()))
        .filter((n) => Number.isFinite(n) && n > 1900);
      if (!args.detailSeasons.length) args.detailSeasons = DEFAULT_DETAIL_SEASONS;
    } else if (a === "--help" || a === "-h") {
      args.help = true;
    } else {
      throw new Error(`Unknown option: ${a}`);
    }
  }

  return args;
}

function loadJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function loadPlayersDataJs(filePath) {
  const raw = fs.readFileSync(filePath, "utf8");
  const fn = new Function(`${raw}\nreturn playersData;`);
  const data = fn();
  if (!Array.isArray(data)) {
    throw new Error(`${filePath} does not define a playersData array.`);
  }
  return data;
}

function loadCache(filePath, refresh) {
  if (refresh || !fs.existsSync(filePath)) {
    return { version: 1, teams: null, squads: {}, details: {}, searches: {} };
  }
  try {
    const parsed = loadJson(filePath);
    return {
      version: 1,
      teams: parsed.teams || null,
      squads: parsed.squads || {},
      details: parsed.details || {},
      searches: parsed.searches || {},
    };
  } catch (err) {
    log(`Warnung: Cache konnte nicht gelesen werden (${err.message || err}); starte leer.`);
    return { version: 1, teams: null, squads: {}, details: {}, searches: {} };
  }
}

function saveCache(filePath, cache) {
  ensureDir(path.dirname(filePath));
  fs.writeFileSync(filePath, `${JSON.stringify(cache, null, 2)}\n`, "utf8");
}

function makeCacheSaver(filePath, cache) {
  let dirty = false;
  let writes = 0;
  return {
    markDirty() {
      dirty = true;
      writes += 1;
      if (writes % 25 === 0) saveCache(filePath, cache);
    },
    flush() {
      if (dirty) saveCache(filePath, cache);
      dirty = false;
    },
  };
}

function stripDiacritics(value) {
  return String(value == null ? "" : value)
    .replace(/ß/g, "ss")
    .replace(/ẞ/g, "SS")
    .replace(/[øØ]/g, "o")
    .replace(/[đĐðÐ]/g, "d")
    .replace(/[þÞ]/g, "th")
    .replace(/[łŁ]/g, "l")
    .replace(/[ıİ]/g, "i")
    .replace(/[œŒ]/g, "oe")
    .replace(/[æÆ]/g, "ae")
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "");
}

function normalizeLoose(value) {
  return stripDiacritics(value)
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/['`´’]/g, " ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

function compactLoose(value) {
  return normalizeLoose(value).replace(/\s+/g, "");
}

function tokens(value) {
  const n = normalizeLoose(value);
  return n ? n.split(" ").filter(Boolean) : [];
}

function uniq(list) {
  return Array.from(new Set(list.filter(Boolean)));
}

function teamKeys(name) {
  const key = normalizeLoose(name);
  const direct = [key];
  const aliasList = TEAM_ALIASES[key] || [];
  for (const [canonical, aliases] of Object.entries(TEAM_ALIASES)) {
    if (canonical === key || aliases.map(normalizeLoose).includes(key)) {
      direct.push(canonical, ...aliases.map(normalizeLoose));
    }
  }
  return uniq(direct);
}

function buildTeamLookup(apiTeams) {
  const byKey = new Map();
  for (const t of apiTeams) {
    const variants = teamKeys(t.name);
    for (const v of variants) {
      if (!byKey.has(v)) byKey.set(v, t);
    }
  }
  return byKey;
}

function resolveApiTeam(baseTeamName, teamLookup, apiTeams) {
  for (const key of teamKeys(baseTeamName)) {
    const exact = teamLookup.get(key);
    if (exact) {
      return { team: exact, method: "alias", score: 100 };
    }
  }

  const baseTokens = tokens(baseTeamName);
  let best = null;
  for (const team of apiTeams) {
    const teamTokens = tokens(team.name);
    const score = tokenOverlapScore(baseTokens, teamTokens);
    if (!best || score > best.score) {
      best = { team, method: "fuzzy", score };
    }
  }
  return best && best.score >= 70 ? best : { team: null, method: "unresolved", score: 0 };
}

function tokenOverlapScore(aTokens, bTokens) {
  if (!aTokens.length || !bTokens.length) return 0;
  const a = new Set(aTokens);
  const b = new Set(bTokens);
  let intersection = 0;
  for (const t of a) if (b.has(t)) intersection += 1;
  const union = new Set([...a, ...b]).size || 1;
  return Math.round((intersection / union) * 100);
}

function officialDisplayName(base) {
  const first = String(base.firstNames || "").trim();
  const last = String(base.lastNames || "").trim();
  const search = String(base.searchName || "").trim();
  return `${first} ${last}`.replace(/\s+/g, " ").trim() || search || String(base.pdfPlayerName || "").trim();
}

function baseNameData(base) {
  const first = String(base.firstNames || "").trim();
  const last = String(base.lastNames || "").trim();
  const search = String(base.searchName || "").trim();
  const pdf = String(base.pdfPlayerName || "").trim();
  const shirt = String(base.nameOnShirt || "").trim();
  const variants = uniq([
    search,
    `${first} ${last}`.trim(),
    `${last} ${first}`.trim(),
    pdf,
    shirt,
  ]);
  return {
    first,
    last,
    search,
    pdf,
    shirt,
    variants,
    firstTokens: tokens(first),
    lastTokens: tokens(last),
    allTokens: tokens(variants.join(" ")),
  };
}

function candidateName(candidate) {
  const p = candidate.detail?.player || candidate.player || {};
  const full = p.firstname || p.lastname ? buildFullName(p) : "";
  return String(full || candidate.name || p.name || "").trim();
}

function scoreName(base, candidate) {
  const b = baseNameData(base);
  const cand = candidateName(candidate);
  const candTokens = tokens(cand);
  const candNorm = normalizeLoose(cand);
  const candCompact = compactLoose(cand);

  let bestExact = 0;
  for (const v of b.variants) {
    const vNorm = normalizeLoose(v);
    if (!vNorm) continue;
    if (vNorm === candNorm) bestExact = Math.max(bestExact, 100);
    else if (compactLoose(vNorm) === candCompact) bestExact = Math.max(bestExact, 98);
    else if (vNorm.includes(candNorm) || candNorm.includes(vNorm)) {
      bestExact = Math.max(bestExact, Math.min(92, 62 + tokenOverlapScore(tokens(vNorm), candTokens) / 2));
    }
  }
  if (bestExact >= 95) return Math.round(bestExact);

  const candSet = new Set(candTokens);
  const firstTokens = b.firstTokens;
  const lastTokens = b.lastTokens;
  const firstMain = firstTokens[0] || "";
  const firstInitial = firstMain ? firstMain[0] : "";
  const lastCompact = compactLoose(lastTokens.join(" "));

  let score = bestExact;

  if (lastTokens.length) {
    const lastHits = lastTokens.filter((t) => candSet.has(t)).length;
    if (lastHits === lastTokens.length) {
      score += 45;
    } else if (lastCompact && candCompact.includes(lastCompact)) {
      score += 42;
    } else if (lastHits > 0) {
      score += Math.round((lastHits / lastTokens.length) * 35);
    }
  }

  if (firstMain) {
    if (candSet.has(firstMain)) {
      score += 34;
    } else if (firstInitial && candTokens.some((t) => t === firstInitial || t.startsWith(firstMain))) {
      score += 23;
    } else if (firstInitial && candTokens.some((t) => t.startsWith(firstInitial))) {
      score += 14;
    }
  }

  const overlap = tokenOverlapScore(uniq([...firstTokens, ...lastTokens]), candTokens);
  score += Math.round(overlap * 0.32);

  return Math.max(0, Math.min(100, Math.round(score)));
}

function getBirthDate(candidate) {
  const p = candidate.detail?.player || candidate.player || {};
  return String(p.birth?.date || candidate.birthDate || "").trim();
}

function getPlayerId(candidate) {
  const p = candidate.detail?.player || candidate.player || {};
  return p.id != null ? Number(p.id) : candidate.id != null ? Number(candidate.id) : null;
}

function getPlayerPhoto(candidate) {
  const p = candidate.detail?.player || candidate.player || {};
  const id = getPlayerId(candidate);
  return (
    String(p.photo || candidate.photo || "").trim() ||
    (id ? `${PLAYER_PHOTO_BASE}${encodeURIComponent(String(id))}.png` : "")
  );
}

function scoreClub(baseClub, apiClubName) {
  const base = tokens(baseClub);
  const api = tokens(apiClubName);
  if (!base.length || !api.length) return 0;
  const score = tokenOverlapScore(base, api);
  if (score >= 80) return 10;
  if (score >= 50) return 6;
  return 0;
}

function buildClub(candidate, nationalTeamId, seasonsTried) {
  if (candidate.appRecord) {
    return {
      name: candidate.appRecord["Club.name"] || "Vereinslos",
      logo: candidate.appRecord["Club.logo"] || "",
    };
  }
  return pickClubFromStats(
    candidate.detail?.statistics || [],
    nationalTeamId,
    LEAGUE_ID,
    seasonsTried || candidate.detail?.seasonsTried || DEFAULT_DETAIL_SEASONS,
  );
}

function scoreCandidate(base, candidate, teamMatch) {
  const nameScore = scoreName(base, candidate);
  const baseDob = String(base.DOB_from_pdf || "").trim();
  const apiDob = getBirthDate(candidate);
  const dobExact = Boolean(baseDob && apiDob && baseDob === apiDob);
  const dobMismatch = Boolean(baseDob && apiDob && baseDob !== apiDob);
  const club = buildClub(candidate, teamMatch?.team?.id, candidate.detail?.seasonsTried);
  const clubScore = scoreClub(base["Club.name_from_pdf"], club.name);

  let total = nameScore;
  const reasons = [`name=${nameScore}`];
  if (teamMatch?.team) {
    total += 12;
    reasons.push("team");
  }
  if (dobExact) {
    total += 75;
    reasons.push("dob");
  } else if (dobMismatch) {
    total -= 130;
    reasons.push(`dob-mismatch:${apiDob}`);
  }
  if (clubScore) {
    total += clubScore;
    reasons.push(`club=${clubScore}`);
  }

  return {
    candidate,
    playerId: getPlayerId(candidate),
    score: total,
    nameScore,
    dobExact,
    dobMismatch,
    apiDob,
    club,
    method: candidate.source || "candidate",
    reasons,
  };
}

function isAcceptableMatch(match) {
  if (!match || !match.playerId) return false;
  if (match.dobMismatch) return false;
  if (match.dobExact && match.nameScore >= 42) return true;
  if (match.nameScore >= 88 && match.score >= 100) return true;
  if (match.nameScore >= 78 && match.score >= 112) return true;
  return false;
}

function compareMatches(a, b) {
  if (b.score !== a.score) return b.score - a.score;
  if (b.nameScore !== a.nameScore) return b.nameScore - a.nameScore;
  return String(candidateName(a.candidate)).localeCompare(String(candidateName(b.candidate)), "de");
}

async function loadApiTeams(api, cache, cacheSaver) {
  if (cache.teams) {
    return cache.teams;
  }
  log(`Lade /teams?league=${LEAGUE_ID}&season=${SEASON} ...`);
  const data = await api.get("/teams", { league: LEAGUE_ID, season: SEASON });
  const teams = (Array.isArray(data.response) ? data.response : [])
    .map((entry) => ({
      id: entry?.team?.id != null ? Number(entry.team.id) : null,
      name: String(entry?.team?.name || "").trim(),
      logo: entry?.team?.logo || "",
      national: entry?.team?.national === true,
    }))
    .filter((t) => t.id != null && t.name);
  cache.teams = teams;
  cacheSaver.markDirty();
  return teams;
}

async function loadSquad(api, team, cache, cacheSaver) {
  const key = String(team.id);
  if (cache.squads[key]) return cache.squads[key];

  const data = await api.get("/players/squads", { team: team.id });
  const entry = Array.isArray(data.response) ? data.response[0] : null;
  const players = Array.isArray(entry?.players) ? entry.players : [];
  const mapped = players
    .map((p) => ({
      id: p?.id != null ? Number(p.id) : null,
      name: String(p?.name || "").trim(),
      photo: p?.photo || "",
      squadPosition: p?.position || "",
      source: "squad",
    }))
    .filter((p) => p.id != null);

  cache.squads[key] = mapped;
  cacheSaver.markDirty();
  return mapped;
}

async function loadPlayerDetail(api, playerId, seasons, cache, cacheSaver) {
  const key = String(playerId);
  if (cache.details[key]) return cache.details[key];

  const tried = [];
  let firstPlayer = null;
  const combinedStats = [];

  for (const season of seasons) {
    tried.push(season);
    try {
      const data = await api.get("/players", { id: playerId, season });
      const entry = Array.isArray(data.response) ? data.response[0] : null;
      if (entry?.player && !firstPlayer) firstPlayer = entry.player;
      if (Array.isArray(entry?.statistics)) {
        for (const stat of entry.statistics) {
          if (stat?.league && (stat.league.season == null || stat.league.season === "")) {
            stat.league.season = season;
          }
          combinedStats.push(stat);
        }
      }
    } catch (err) {
      log(`Detail-Fallback fuer player.id=${playerId}, season=${season}: ${err.message || err}`);
    }
  }

  if (!firstPlayer || combinedStats.length === 0) {
    try {
      const data = await api.get("/players", { id: playerId });
      const entry = Array.isArray(data.response) ? data.response[0] : null;
      if (entry?.player && !firstPlayer) firstPlayer = entry.player;
      if (Array.isArray(entry?.statistics)) combinedStats.push(...entry.statistics);
    } catch (err) {
      log(`Detail ohne Saison fehlgeschlagen fuer player.id=${playerId}: ${err.message || err}`);
    }
  }

  const detail = {
    player: firstPlayer || { id: playerId },
    statistics: combinedStats,
    seasonsTried: tried,
  };
  cache.details[key] = detail;
  cacheSaver.markDirty();
  return detail;
}

function searchQueriesFor(base) {
  const b = baseNameData(base);
  const raw = uniq([
    b.search,
    `${b.first} ${b.last}`.trim(),
    b.last,
    b.shirt,
    b.pdf,
  ]);
  return raw.filter((q) => compactLoose(q).length >= 4).slice(0, 5);
}

async function searchApiPlayers(api, base, teamMatch, cache, cacheSaver) {
  const queries = searchQueriesFor(base);
  const candidates = [];
  const seen = new Set();

  for (const q of queries) {
    const paramsList = [];
    if (teamMatch?.team?.id) {
      paramsList.push({ team: teamMatch.team.id, season: SEASON, search: q });
    }
    paramsList.push({ search: q });

    for (const params of paramsList) {
      const key = JSON.stringify(params);
      let items = cache.searches[key];
      if (!items) {
        try {
          const result = await api.getAllPages("/players", params, { maxPages: 5 });
          items = result.items;
          cache.searches[key] = items;
          cacheSaver.markDirty();
        } catch (err) {
          log(`Suche fehlgeschlagen (${key}): ${err.message || err}`);
          cache.searches[key] = [];
          cacheSaver.markDirty();
          items = [];
        }
      }

      for (const item of items) {
        const id = item?.player?.id != null ? Number(item.player.id) : null;
        if (!id || seen.has(id)) continue;
        seen.add(id);
        candidates.push({
          id,
          name: buildFullName(item.player || {}),
          photo: item?.player?.photo || "",
          player: item?.player || {},
          detail: {
            player: item?.player || { id },
            statistics: Array.isArray(item?.statistics) ? item.statistics : [],
            seasonsTried: params.season ? [params.season] : [],
          },
          source: params.team ? "search-team" : "search",
        });
      }
    }
  }

  return candidates;
}

async function hydrateTopCandidates(candidates, base, teamMatch, loadDetailFn, usedPlayerIds) {
  const rough = candidates
    .filter((c) => {
      const id = getPlayerId(c);
      return id && !usedPlayerIds.has(String(id));
    })
    .map((candidate) => ({
      candidate,
      roughScore: scoreName(base, candidate),
    }))
    .filter((x) => x.roughScore >= 34)
    .sort((a, b) => b.roughScore - a.roughScore)
    .slice(0, 10);

  const scored = [];
  for (const item of rough) {
    const candidate = item.candidate;
    if (!candidate.detail && typeof loadDetailFn === "function") {
      candidate.detail = await loadDetailFn(getPlayerId(candidate));
    }
    scored.push(scoreCandidate(base, candidate, teamMatch));
  }

  scored.sort(compareMatches);
  return scored;
}

async function findBestMatch(base, teamCandidates, teamMatch, helpers, usedPlayerIds) {
  const squadMatches = await hydrateTopCandidates(
    teamCandidates,
    base,
    teamMatch,
    helpers.loadDetail,
    usedPlayerIds,
  );
  const bestSquad = squadMatches[0];
  const secondSquad = squadMatches[1];
  if (
    isAcceptableMatch(bestSquad) &&
    (bestSquad.dobExact || !secondSquad || bestSquad.score - secondSquad.score >= 8)
  ) {
    return { ...bestSquad, method: bestSquad.method || "squad" };
  }

  if (helpers.search) {
    const searchCandidates = await helpers.search(base, teamMatch);
    const searchMatches = await hydrateTopCandidates(
      searchCandidates,
      base,
      teamMatch,
      helpers.loadDetail,
      usedPlayerIds,
    );
    const allMatches = [...squadMatches, ...searchMatches].sort(compareMatches);
    const best = allMatches[0];
    const second = allMatches[1];
    if (
      isAcceptableMatch(best) &&
      (best.dobExact || !second || best.score - second.score >= 8 || best.nameScore >= 92)
    ) {
      return { ...best, method: best.method || "search" };
    }
    return best ? { ...best, rejected: true } : null;
  }

  return bestSquad ? { ...bestSquad, rejected: true } : null;
}

function buildAppRecord(base, match, teamMatch) {
  const candidate = match?.candidate || null;
  const detailPlayer = candidate?.detail?.player || candidate?.player || {};
  const playerId = match?.playerId || null;
  const apiTeam = teamMatch?.team || null;
  const club = match?.club || { name: "", logo: "" };
  const apiName = detailPlayer && Object.keys(detailPlayer).length ? buildFullName(detailPlayer) : "";
  const fallbackClub = String(base["Club.name_from_pdf"] || "").trim();
  const photo = candidate ? getPlayerPhoto(candidate) : "";
  const weight = cleanWeight(detailPlayer.weight || candidate?.appRecord?.Gewicht || "");
  const height = cleanHeight(detailPlayer.height || candidate?.appRecord?.Groesse || base.Groesse_from_pdf || "");

  return {
    "player.id": playerId,
    "Spielername": apiName && apiName !== "Unbekannt" ? apiName : officialDisplayName(base),
    "Spielerfoto": photo,
    "Position": normalizePosition(base.Position),
    "Nationalteam.name": apiTeam?.name || base["Nationalteam.name"] || "",
    "Nationalteam.logo": apiTeam?.logo || candidate?.appRecord?.["Nationalteam.logo"] || "",
    "Club.name": club.name && club.name !== "Vereinslos" ? club.name : fallbackClub || "Vereinslos",
    "Club.logo": club.logo || candidate?.appRecord?.["Club.logo"] || "",
    "Geburtsdatum": String(detailPlayer.birth?.date || candidate?.appRecord?.Geburtsdatum || base.DOB_from_pdf || "-"),
    "Groesse": height,
    "Gewicht": weight,
  };
}

function buildEnrichedRecord(base, appRecord, match, teamMatch) {
  return {
    ...appRecord,
    "squadNumber": base.squadNumber,
    "Nationalteam.name_from_pdf": base["Nationalteam.name"] || "",
    "Nationalteam.code": base["Nationalteam.code"] || "",
    "pdfPlayerName": base.pdfPlayerName || "",
    "Club.name_from_pdf": base["Club.name_from_pdf"] || "",
    "Club.countryCode_from_pdf": base["Club.countryCode_from_pdf"] || "",
    "_match": {
      status: match && !match.rejected && match.playerId ? "matched" : "unmatched",
      method: match?.method || "",
      score: match?.score ?? null,
      nameScore: match?.nameScore ?? null,
      dobExact: Boolean(match?.dobExact),
      apiBirthDate: match?.apiDob || "",
      candidateName: match?.candidate ? candidateName(match.candidate) : "",
      playerId: match?.playerId || null,
      apiTeamId: teamMatch?.team?.id || null,
      apiTeamName: teamMatch?.team?.name || "",
      teamMatchMethod: teamMatch?.method || "",
      reasons: match?.reasons || [],
    },
  };
}

function buildHeader({ generatedAt, playersCount, matchedCount, unmatchedCount }) {
  return [
    "// WM 2026 Kader (OFFIZIELL, FIFA-Basisliste + API-Football-Enrichment)",
    "// Turnier: Weltmeisterschaft 2026",
    "// Quelle Basisliste: fifa_2026_squad_base_players.json",
    `// Quelle Enrichment: API-Football /teams, /players/squads, /players`,
    `// Generiert am: ${generatedAt}`,
    `// Spieler total: ${playersCount}`,
    `// API-Matches: ${matchedCount}`,
    `// Unmatched: ${unmatchedCount}`,
    "//",
    "// Hinweis: Die offizielle Basisliste bleibt fuer Kaderzugehoerigkeit und",
    "// Positionen fuehrend. API-Football liefert IDs, Fotos, Logos, Clubdaten",
    "// und Gewicht. FORWARD wird fuer die App als ATTACKER exportiert.",
  ].join("\n");
}

function buildReport({ generatedAt, officialRows, enriched, teamReports, unmatched, lowConfidence, dataFileWritten }) {
  const lines = [];
  lines.push("# WM 2026 Squad Enrichment");
  lines.push("");
  lines.push(`- Generated: ${generatedAt}`);
  lines.push(`- Official rows: ${officialRows}`);
  lines.push(`- Matched: ${enriched.filter((p) => p._match.status === "matched").length}`);
  lines.push(`- Unmatched: ${unmatched.length}`);
  lines.push(`- Low confidence (< 120 score): ${lowConfidence.length}`);
  lines.push(`- data-wm2026.js written: ${dataFileWritten ? "yes" : "no"}`);
  lines.push("");
  lines.push("## Teams");
  lines.push("");
  lines.push("| FIFA team | API team | Rows | Matched | Unmatched |");
  lines.push("| --- | --- | ---: | ---: | ---: |");
  for (const t of teamReports) {
    lines.push(`| ${t.fifaName} | ${t.apiName || "-"} | ${t.rows} | ${t.matched} | ${t.unmatched} |`);
  }
  lines.push("");

  if (unmatched.length) {
    lines.push("## Unmatched");
    lines.push("");
    for (const p of unmatched.slice(0, 250)) {
      lines.push(
        `- ${p["Nationalteam.name"]} #${p.squadNumber} ${p.pdfPlayerName || p.Spielername}` +
          ` (DOB ${p.Geburtsdatum || "-"}, club ${p["Club.name_from_pdf"] || "-"})`,
      );
    }
    if (unmatched.length > 250) lines.push(`- ... ${unmatched.length - 250} more`);
    lines.push("");
  }

  if (lowConfidence.length) {
    lines.push("## Low Confidence Matches");
    lines.push("");
    for (const p of lowConfidence.slice(0, 250)) {
      lines.push(
        `- ${p["Nationalteam.name"]} #${p.squadNumber} ${p.pdfPlayerName || p.Spielername}` +
          ` -> ${p.Spielername} (${p["player.id"]}, score ${p._match.score})`,
      );
    }
  }

  return lines.join("\n");
}

function summarizeTeams(enriched) {
  const map = new Map();
  for (const p of enriched) {
    const fifaName = p["Nationalteam.name_from_pdf"] || p["Nationalteam.name"];
    const key = p["Nationalteam.code"] || fifaName;
    if (!map.has(key)) {
      map.set(key, {
        fifaName,
        apiName: p._match.apiTeamName || "",
        rows: 0,
        matched: 0,
        unmatched: 0,
      });
    }
    const row = map.get(key);
    row.rows += 1;
    if (p._match.status === "matched") row.matched += 1;
    else row.unmatched += 1;
  }
  return Array.from(map.values()).sort((a, b) => a.fifaName.localeCompare(b.fifaName, "de"));
}

function localTeamsFromPlayers(players) {
  const byName = new Map();
  for (const p of players) {
    const name = String(p["Nationalteam.name"] || "").trim();
    if (!name || byName.has(name)) continue;
    byName.set(name, {
      id: `local:${name}`,
      name,
      logo: p["Nationalteam.logo"] || "",
      national: true,
    });
  }
  return Array.from(byName.values());
}

function localCandidatesByTeam(players) {
  const map = new Map();
  for (const p of players) {
    const name = String(p["Nationalteam.name"] || "").trim();
    if (!map.has(name)) map.set(name, []);
    const playerId = p["player.id"] != null ? Number(p["player.id"]) : null;
    map.get(name).push({
      id: playerId,
      name: p.Spielername || "",
      photo: p.Spielerfoto || "",
      birthDate: p.Geburtsdatum || "",
      appRecord: p,
      player: {
        id: playerId,
        name: p.Spielername || "",
        photo: p.Spielerfoto || "",
        birth: { date: p.Geburtsdatum || "" },
        height: p.Groesse || "",
        weight: p.Gewicht || "",
      },
      detail: {
        player: {
          id: playerId,
          name: p.Spielername || "",
          photo: p.Spielerfoto || "",
          birth: { date: p.Geburtsdatum || "" },
          height: p.Groesse || "",
          weight: p.Gewicht || "",
        },
        statistics: [],
        seasonsTried: [],
      },
      source: "local-data",
    });
  }
  return map;
}

async function main() {
  const args = parseArgs(process.argv);
  if (args.help) {
    console.log(usage());
    return;
  }

  ensureDir(REPORTS_DIR);

  let officialRows = loadJson(args.input);
  if (!Array.isArray(officialRows)) {
    throw new Error(`${args.input} must be a JSON array.`);
  }
  if (args.team) {
    const wanted = normalizeLoose(args.team);
    officialRows = officialRows.filter((p) => normalizeLoose(p["Nationalteam.name"]) === wanted);
  }
  if (args.limit > 0) officialRows = officialRows.slice(0, args.limit);

  log(`Offizielle Basisliste geladen: ${officialRows.length} Spieler.`);

  const cache = loadCache(args.cacheFile, args.refreshCache);
  const cacheSaver = makeCacheSaver(args.cacheFile, cache);

  let api = null;
  let apiTeams = [];
  let localCandidates = new Map();

  if (args.offlineLocalData) {
    const localPlayers = loadPlayersDataJs(args.localDataFile);
    apiTeams = localTeamsFromPlayers(localPlayers);
    localCandidates = localCandidatesByTeam(localPlayers);
    log(`Offline-Testmodus: ${localPlayers.length} lokale Kandidaten aus ${path.relative(REPO_ROOT, args.localDataFile)}.`);
  } else {
    const apiKey = String(process.env.RAPIDAPI_KEY || process.env.API_FOOTBALL_KEY || "").trim();
    if (!apiKey) {
      throw new Error("RAPIDAPI_KEY (or API_FOOTBALL_KEY) is not set. Use --offline-local-data for local matching tests.");
    }
    api = createApiClient({ apiKey, logger: log });
    apiTeams = await loadApiTeams(api, cache, cacheSaver);
  }

  const teamLookup = buildTeamLookup(apiTeams);
  const teamByFifaName = new Map();
  for (const fifaName of uniq(officialRows.map((p) => p["Nationalteam.name"]))) {
    teamByFifaName.set(fifaName, resolveApiTeam(fifaName, teamLookup, apiTeams));
  }

  const usedPlayerIds = new Set();
  const enriched = [];
  let processed = 0;

  for (const base of officialRows) {
    processed += 1;
    const fifaTeamName = String(base["Nationalteam.name"] || "").trim();
    const teamMatch = teamByFifaName.get(fifaTeamName) || { team: null, method: "unresolved", score: 0 };
    let candidates = [];

    if (args.offlineLocalData) {
      const localTeamName = teamMatch.team?.name || fifaTeamName;
      candidates = localCandidates.get(localTeamName) || [];
    } else if (teamMatch.team?.id) {
      candidates = await loadSquad(api, teamMatch.team, cache, cacheSaver);
    }

    const helpers = {
      loadDetail: args.offlineLocalData
        ? null
        : async (playerId) => loadPlayerDetail(api, playerId, args.detailSeasons, cache, cacheSaver),
      search:
        args.offlineLocalData || args.noSearch
          ? null
          : async (row, tm) => searchApiPlayers(api, row, tm, cache, cacheSaver),
    };

    const match = await findBestMatch(base, candidates, teamMatch, helpers, usedPlayerIds);
    const accepted = match && !match.rejected && isAcceptableMatch(match);
    if (accepted && match.playerId) {
      usedPlayerIds.add(String(match.playerId));
    }

    const finalMatch = accepted ? match : match ? { ...match, rejected: true } : null;
    const appRecord = buildAppRecord(base, accepted ? finalMatch : null, teamMatch);
    const enrichedRecord = buildEnrichedRecord(base, appRecord, accepted ? finalMatch : null, teamMatch);
    enriched.push(enrichedRecord);

    if (processed % 25 === 0 || processed === officialRows.length) {
      const matched = enriched.filter((p) => p._match.status === "matched").length;
      log(`[${processed}/${officialRows.length}] matched=${matched}, unmatched=${enriched.length - matched}`);
    }
  }

  cacheSaver.flush();

  enriched.sort((a, b) => {
    const nation = String(a["Nationalteam.name"] || "").localeCompare(String(b["Nationalteam.name"] || ""), "de");
    if (nation !== 0) return nation;
    return String(a.Spielername || "").localeCompare(String(b.Spielername || ""), "de");
  });

  const unmatched = enriched.filter((p) => p._match.status !== "matched");
  const lowConfidence = enriched.filter((p) => p._match.status === "matched" && Number(p._match.score) < 120);
  const appRecords = enriched.map((p) => ({
    "player.id": p["player.id"],
    "Spielername": p.Spielername,
    "Spielerfoto": p.Spielerfoto,
    "Position": p.Position,
    "Nationalteam.name": p["Nationalteam.name"],
    "Nationalteam.logo": p["Nationalteam.logo"],
    "Club.name": p["Club.name"],
    "Club.logo": p["Club.logo"],
    "Geburtsdatum": p.Geburtsdatum,
    "Groesse": p.Groesse,
    "Gewicht": p.Gewicht,
  }));

  const generatedAt = new Date().toISOString();
  let dataFileWritten = false;

  if (!args.dryRun) {
    fs.writeFileSync(args.outputJson, `${JSON.stringify(enriched, null, 2)}\n`, "utf8");
    log(`Enriched JSON geschrieben: ${path.relative(REPO_ROOT, args.outputJson)}`);

    if (args.writeData) {
      if (unmatched.length > 0 && !args.forceDataFile) {
        log(
          `data-wm2026.js nicht geschrieben: ${unmatched.length} Spieler unmatched. ` +
            `Nutze --force-data-file, falls du trotzdem schreiben willst.`,
        );
      } else {
        const header = buildHeader({
          generatedAt,
          playersCount: appRecords.length,
          matchedCount: appRecords.length - unmatched.length,
          unmatchedCount: unmatched.length,
        });
        const body = `const playersData = ${JSON.stringify(appRecords, null, 4)};\n`;
        fs.writeFileSync(args.dataFile, `${header}\n\n${body}`, "utf8");
        dataFileWritten = true;
        log(`DreamTeam-Datei geschrieben: ${path.relative(REPO_ROOT, args.dataFile)}`);
      }
    }
  } else {
    log("[--dry-run] Keine Output-Dateien geschrieben.");
  }

  const teamReports = summarizeTeams(enriched);
  const report = {
    generatedAt,
    input: path.relative(REPO_ROOT, args.input),
    officialRows: officialRows.length,
    matched: enriched.length - unmatched.length,
    unmatched: unmatched.length,
    lowConfidence: lowConfidence.length,
    dataFileWritten,
    teams: teamReports,
    unmatchedPlayers: unmatched.map((p) => ({
      team: p["Nationalteam.name"],
      squadNumber: p.squadNumber,
      pdfPlayerName: p.pdfPlayerName,
      searchName: p.Spielername,
      dob: p.Geburtsdatum,
      clubFromPdf: p["Club.name_from_pdf"],
      apiTeamName: p._match.apiTeamName,
    })),
    lowConfidencePlayers: lowConfidence.map((p) => ({
      team: p["Nationalteam.name"],
      squadNumber: p.squadNumber,
      playerId: p["player.id"],
      name: p.Spielername,
      score: p._match.score,
      method: p._match.method,
    })),
  };

  if (!args.dryRun) {
    fs.writeFileSync(args.reportJson, `${JSON.stringify(report, null, 2)}\n`, "utf8");
    fs.writeFileSync(
      args.reportMd,
      `${buildReport({
        generatedAt,
        officialRows: officialRows.length,
        enriched,
        teamReports,
        unmatched,
        lowConfidence,
        dataFileWritten,
      })}\n`,
      "utf8",
    );
    log(`Report geschrieben: ${path.relative(REPO_ROOT, args.reportMd)}`);
  }

  log(
    `Fertig: ${enriched.length - unmatched.length}/${enriched.length} gematcht, ` +
      `${unmatched.length} unmatched, ${lowConfidence.length} low-confidence.`,
  );
}

main().catch((err) => {
  console.error(`[enrich-wm2026] FEHLER: ${err && err.stack ? err.stack : err}`);
  process.exit(1);
});
