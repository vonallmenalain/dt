#!/usr/bin/env node
/* =============================================================================
 *  scripts/generate-wm2026-official-kader.mjs
 *
 *  Erzeugt aus den offiziellen API-Football-Daten zur WM 2026 eine neue
 *  `data-wm2026.js` im etablierten App-Format `const playersData = [...]`.
 *
 *  Quelle:
 *    GET /teams?league=1&season=2026          → 48 Teams
 *    GET /players?league=1&season=2026&page=… → alle Spieler des Turniers
 *
 *  Pipeline (portiert aus adm-generate-kader.html bzw.
 *  adm-generate-kader-wm2026.html, ohne Browser/DOM):
 *    1. Teams laden + Set der WM-Team-IDs bauen
 *    2. Spieler paginiert laden, dedupliziert via player.id
 *    3. Nur Spieler übernehmen, deren Statistik-Liste mindestens ein
 *       Statistik-Objekt mit team.id ∈ WM-Teams enthält → das ist das
 *       Nationalteam.
 *    4. Vollständigen Namen aus firstname + lastname bauen (Fallback name).
 *    5. Position normalisieren (GOALKEEPER/DEFENDER/MIDFIELDER/ATTACKER).
 *    6. Verein aus statistics bestimmen (kein Nationalteam, kein WM-League-
 *       Eintrag); fallback "Vereinslos".
 *    7. position-overrides.js einlesen und für `wm2026` anwenden.
 *    8. data-wm2026.js schreiben mit OFFIZIELL-Header.
 *    9. reports/wm2026-official-kader-generated.md schreiben.
 *
 *  Standardverhalten: wenn der Datenstand nicht ready ist
 *  (48 Teams, ≥ 23 Spieler je Team), wird die Datei NICHT überschrieben.
 *  Mit --force kann die Generierung trotzdem erzwungen werden.
 * ============================================================================= */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { createApiClient } from "./lib/apiFootball.mjs";
import {
  applyPositionOverrides,
  buildFullName,
  cleanHeight,
  cleanWeight,
  loadPositionOverrides,
  normalizePosition,
  pickClubFromStats,
  repoRootFromScript,
} from "./lib/kaderHelpers.mjs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = repoRootFromScript(__dirname);

const TOURNAMENT_NAME = "Weltmeisterschaft 2026";
const TOURNAMENT_KEY = "wm2026";
const LEAGUE_ID = 1;
const SEASON = 2026;
const EXPECTED_TEAMS = 48;
const MIN_PLAYERS_PER_TEAM = 23;

const TARGET_DATA_FILE = path.join(REPO_ROOT, "data-wm2026.js");
const POSITION_OVERRIDES_FILE = path.join(REPO_ROOT, "position-overrides.js");
const REPORTS_DIR = path.join(REPO_ROOT, "reports");
const REPORT_MD = path.join(REPORTS_DIR, "wm2026-official-kader-generated.md");

function log(msg) {
  console.log(`[generate-wm2026] ${msg}`);
}

function ensureDir(dir) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

function parseArgs(argv) {
  const args = { force: false };
  for (const a of argv.slice(2)) {
    if (a === "--force" || a === "-f") args.force = true;
    else if (a === "--help" || a === "-h") args.help = true;
  }
  return args;
}

function appendStepSummary(markdown) {
  const sum = process.env.GITHUB_STEP_SUMMARY;
  if (!sum) return;
  try {
    fs.appendFileSync(sum, `${markdown}\n`);
  } catch (_e) {}
}

function buildHeader({ generatedAt, teamsCount, playersCount, overrideStats }) {
  return [
    "// WM 2026 Kader (OFFIZIELL)",
    `// Turnier: ${TOURNAMENT_NAME}`,
    `// Quelle: API-Football /players?league=${LEAGUE_ID}&season=${SEASON}`,
    `// Generiert am: ${generatedAt}`,
    `// Teams: ${teamsCount}`,
    `// Spieler total: ${playersCount}`,
    `// Positions-Overrides angewendet: ${overrideStats.appliedCount}`,
    `// Positions-Overrides bereits identisch: ${overrideStats.identicalCount}`,
    `// Positions-Overrides ohne Treffer: ${overrideStats.missingCount}`,
    "//",
    "// Hinweis: Diakritika und Sonderzeichen in Spielernamen werden bewusst",
    "// beibehalten – die App-Suche ist diakritikatolerant.",
  ].join("\n");
}

function buildReportMarkdown({
  generatedAt,
  ready,
  forced,
  teams,
  players,
  perTeam,
  incomplete,
  overrideStats,
  overrideError,
}) {
  const lines = [];
  lines.push(`# WM 2026: Generierter offizieller Kader`);
  lines.push("");
  lines.push(`- **Generiert**: ${generatedAt}`);
  lines.push(`- **Quelle**: API-Football \`league=${LEAGUE_ID}&season=${SEASON}\``);
  lines.push(`- **Teams**: ${teams.length} / ${EXPECTED_TEAMS}`);
  lines.push(`- **Spieler total**: ${players}`);
  lines.push(`- **Status**: ${ready ? "✅ ready" : forced ? "⚠️ erzwungen (--force) trotz nicht-ready" : "❌ nicht ready"}`);
  lines.push("");

  lines.push("## Spieler pro Land");
  lines.push("");
  lines.push("| Team | Spieler |");
  lines.push("| --- | ---: |");
  const sortedTeams = [...teams].sort((a, b) => String(a.name).localeCompare(String(b.name), "de"));
  for (const t of sortedTeams) {
    const count = perTeam.get(Number(t.id)) || 0;
    lines.push(`| ${t.name} | ${count} |`);
  }
  lines.push("");

  if (incomplete.length) {
    lines.push(`## Teams mit weniger als ${MIN_PLAYERS_PER_TEAM} Spielern`);
    for (const t of incomplete) lines.push(`- ${t.name}: ${t.count} Spieler`);
    lines.push("");
  } else {
    lines.push(`## Teams mit weniger als ${MIN_PLAYERS_PER_TEAM} Spielern`);
    lines.push("Keine.");
    lines.push("");
  }

  lines.push("## Positions-Overrides");
  if (overrideError) {
    lines.push(`> ⚠️ Konnte position-overrides.js nicht laden: ${overrideError}`);
  }
  lines.push(`- Total definiert: ${overrideStats.totalOverrides}`);
  lines.push(`- Aktiv angewendet: ${overrideStats.appliedCount}`);
  lines.push(`- Bereits identisch (no-op): ${overrideStats.identicalCount}`);
  lines.push(`- Veraltet (Spieler nicht im offiziellen Kader): ${overrideStats.missingCount}`);
  lines.push("");

  if (overrideStats.appliedDetails.length) {
    lines.push("### Angewendete Overrides");
    for (const d of overrideStats.appliedDetails) {
      lines.push(`- \`${d.id}\` ${d.name}: ${d.from || "?"} → ${d.to}`);
    }
    lines.push("");
  }
  if (overrideStats.noopDetails.length) {
    lines.push("### No-op Overrides (bereits identisch)");
    for (const d of overrideStats.noopDetails) {
      lines.push(`- \`${d.id}\` ${d.name}: ${d.position}`);
    }
    lines.push("");
  }
  if (overrideStats.missingDetails.length) {
    lines.push("### Veraltete Overrides (Spieler nicht im offiziellen Kader)");
    for (const d of overrideStats.missingDetails) {
      lines.push(`- \`${d.id}\` → ${d.position}`);
    }
    lines.push("");
  }

  return lines.join("\n");
}

async function main() {
  ensureDir(REPORTS_DIR);
  const args = parseArgs(process.argv);
  if (args.help) {
    console.log(
      "Usage: node scripts/generate-wm2026-official-kader.mjs [--force]\n" +
        "  --force   data-wm2026.js auch dann überschreiben, wenn die offiziellen\n" +
        "            Kader noch nicht 48 Teams × 23 Spieler liefern.",
    );
    return;
  }

  const apiKey = String(
    process.env.RAPIDAPI_KEY || process.env.API_FOOTBALL_KEY || "",
  ).trim();
  if (!apiKey) {
    log("FEHLER: RAPIDAPI_KEY (bzw. API_FOOTBALL_KEY als Fallback) ist nicht gesetzt.");
    process.exit(1);
  }
  const api = createApiClient({ apiKey, logger: log });

  // ---------------- Phase 1: Teams ----------------
  log(`Lade /teams?league=${LEAGUE_ID}&season=${SEASON} …`);
  const teamsResponse = await api.get("/teams", { league: LEAGUE_ID, season: SEASON });
  const rawTeams = Array.isArray(teamsResponse?.response) ? teamsResponse.response : [];
  const teams = rawTeams
    .map((entry) => ({
      id: entry?.team?.id != null ? Number(entry.team.id) : null,
      name: String(entry?.team?.name || "").trim() || `Team ${entry?.team?.id ?? "?"}`,
      logo: entry?.team?.logo || "",
    }))
    .filter((t) => t.id != null);

  log(`Teams gefunden: ${teams.length}.`);
  const teamMap = new Map(teams.map((t) => [Number(t.id), t]));

  // ---------------- Phase 2: Spieler ----------------
  log(`Lade /players?league=${LEAGUE_ID}&season=${SEASON} (paginiert) …`);
  const { items: rawPlayers } = await api.getAllPages(
    "/players",
    { league: LEAGUE_ID, season: SEASON },
    {
      onPage: ({ page, total, results }) => log(`  Seite ${page}/${total} – ${results} Einträge`),
    },
  );
  log(`Spieler-Roh-Einträge: ${rawPlayers.length}.`);

  // ---------------- Phase 3: Mapping ----------------
  const seen = new Set();
  const playersData = [];
  const perTeamCount = new Map();

  for (const item of rawPlayers) {
    const player = item?.player;
    const stats = Array.isArray(item?.statistics) ? item.statistics : [];
    if (!player || player.id == null) continue;

    const pid = Number(player.id);
    if (seen.has(pid)) continue;

    let nationalTeam = null;
    for (const s of stats) {
      const tid = s?.team?.id != null ? Number(s.team.id) : null;
      if (tid != null && teamMap.has(tid)) {
        nationalTeam = teamMap.get(tid);
        break;
      }
    }
    if (!nationalTeam) {
      for (const s of stats) {
        if (s?.team?.national === true && s?.team?.id != null && teamMap.has(Number(s.team.id))) {
          nationalTeam = teamMap.get(Number(s.team.id));
          break;
        }
      }
    }
    if (!nationalTeam) continue;

    seen.add(pid);

    const fullName = buildFullName(player);
    const apiPosition = stats.find((s) => s?.games?.position)?.games?.position || "";
    const position = normalizePosition(apiPosition);
    const club = pickClubFromStats(stats, Number(nationalTeam.id), LEAGUE_ID, [SEASON]);
    const photo = String(player.photo || "").trim();

    playersData.push({
      "player.id": pid,
      "Spielername": fullName,
      "Spielerfoto": photo,
      "Position": position,
      "Nationalteam.name": nationalTeam.name || "",
      "Nationalteam.logo": nationalTeam.logo || "",
      "Club.name": club.name,
      "Club.logo": club.logo,
      "Geburtsdatum": (player.birth && player.birth.date) || "-",
      "Groesse": cleanHeight(player.height),
      "Gewicht": cleanWeight(player.weight),
    });

    perTeamCount.set(Number(nationalTeam.id), (perTeamCount.get(Number(nationalTeam.id)) || 0) + 1);
  }

  // ---------------- Phase 4: Sortierung ----------------
  playersData.sort((a, b) => {
    const nation = String(a["Nationalteam.name"] || "").localeCompare(
      String(b["Nationalteam.name"] || ""),
      "de",
    );
    if (nation !== 0) return nation;
    return String(a["Spielername"] || "").localeCompare(String(b["Spielername"] || ""), "de");
  });

  // ---------------- Phase 5: Position-Overrides anwenden ----------------
  const { overrides, error: overrideError } = loadPositionOverrides(POSITION_OVERRIDES_FILE, TOURNAMENT_KEY);
  if (overrideError) {
    log(`Warnung: position-overrides.js konnte nicht sauber geladen werden: ${overrideError}`);
  }
  const overrideStats = applyPositionOverrides(playersData, overrides);
  log(
    `Overrides: ${overrideStats.appliedCount} angewendet, ` +
      `${overrideStats.identicalCount} identisch, ` +
      `${overrideStats.missingCount} ohne Treffer.`,
  );

  // ---------------- Phase 6: Ready-Check ----------------
  const incomplete = teams
    .map((t) => ({ id: t.id, name: t.name, count: perTeamCount.get(Number(t.id)) || 0 }))
    .filter((t) => t.count < MIN_PLAYERS_PER_TEAM);

  const ready = teams.length === EXPECTED_TEAMS && incomplete.length === 0;
  const forced = !ready && args.force;

  if (!ready && !args.force) {
    log(
      `❌ Nicht ready: Teams=${teams.length}/${EXPECTED_TEAMS}, ` +
        `Teams < ${MIN_PLAYERS_PER_TEAM} Spieler=${incomplete.length}. ` +
        `data-wm2026.js wird NICHT überschrieben (kein --force).`,
    );

    const generatedAt = new Date().toISOString();
    const md = buildReportMarkdown({
      generatedAt,
      ready,
      forced: false,
      teams,
      players: playersData.length,
      perTeam: perTeamCount,
      incomplete,
      overrideStats,
      overrideError,
    });
    fs.writeFileSync(REPORT_MD, md, "utf8");
    appendStepSummary(md);
    log(`Report (ohne Datei-Update): ${path.relative(REPO_ROOT, REPORT_MD)}`);
    return;
  }

  // ---------------- Phase 7: Datei schreiben ----------------
  const generatedAt = new Date().toISOString();
  const header = buildHeader({
    generatedAt,
    teamsCount: teams.length,
    playersCount: playersData.length,
    overrideStats,
  });
  const body = `const playersData = ${JSON.stringify(playersData, null, 4)};\n`;
  const fileContent = `${header}\n\n${body}`;

  fs.writeFileSync(TARGET_DATA_FILE, fileContent, "utf8");
  log(`✅ data-wm2026.js geschrieben: ${path.relative(REPO_ROOT, TARGET_DATA_FILE)} (${playersData.length} Spieler).`);

  const md = buildReportMarkdown({
    generatedAt,
    ready,
    forced,
    teams,
    players: playersData.length,
    perTeam: perTeamCount,
    incomplete,
    overrideStats,
    overrideError,
  });
  fs.writeFileSync(REPORT_MD, md, "utf8");
  appendStepSummary(md);
  log(`Report: ${path.relative(REPO_ROOT, REPORT_MD)}`);
}

main().catch((err) => {
  log(`UNERWARTETER FEHLER: ${err && err.stack ? err.stack : err}`);
  process.exit(1);
});
