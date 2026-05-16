#!/usr/bin/env node
/* =============================================================================
 *  scripts/check-wm2026-official-kader.mjs
 *
 *  Prüft, ob API-Football bereits offizielle Kaderdaten für die WM 2026
 *  liefert. Dieser Check läuft typischerweise täglich als GitHub-Action
 *  (siehe .github/workflows/wm2026-official-kader.yml) und meldet, sobald
 *  alle 48 Teams mit jeweils mindestens 23 Spielern in /players auftauchen.
 *
 *  Quelle:
 *    GET /teams?league=1&season=2026          → Teams (Soll: 48)
 *    GET /players?league=1&season=2026&page=… → alle Spieler des Turniers
 *
 *  Ausgaben:
 *    reports/wm2026-official-kader-status.json   (maschinenlesbar)
 *    reports/wm2026-official-kader-status.md     (Markdown-Zusammenfassung)
 *    GITHUB_OUTPUT  (ready/teamsFound/incompleteTeams)
 *    GITHUB_STEP_SUMMARY (falls gesetzt)
 *
 *  Kriterien für ready=true:
 *    - genau 48 Teams in /teams
 *    - jedes Team hat mindestens 23 Spieler in /players
 *
 *  Exit-Codes:
 *    0  technischer Erfolg (auch wenn ready=false)
 *    1  echter technischer Fehler (Key fehlt, API nicht erreichbar, …)
 * ============================================================================= */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { createApiClient } from "./lib/apiFootball.mjs";
import { normalizePosition, repoRootFromScript } from "./lib/kaderHelpers.mjs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = repoRootFromScript(__dirname);

const TOURNAMENT_NAME = "WM 2026";
const LEAGUE_ID = 1;
const SEASON = 2026;
const EXPECTED_TEAMS = 48;
const MIN_PLAYERS_PER_TEAM = 23;

const REPORTS_DIR = path.join(REPO_ROOT, "reports");
const STATUS_JSON = path.join(REPORTS_DIR, "wm2026-official-kader-status.json");
const STATUS_MD = path.join(REPORTS_DIR, "wm2026-official-kader-status.md");

function log(msg) {
  console.log(`[check-wm2026] ${msg}`);
}

function ensureDir(dir) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

function writeGithubOutput(pairs) {
  const out = process.env.GITHUB_OUTPUT;
  if (!out) return;
  try {
    const lines = Object.entries(pairs)
      .map(([k, v]) => `${k}=${String(v)}`)
      .join("\n");
    fs.appendFileSync(out, `${lines}\n`);
  } catch (err) {
    log(`Warnung: konnte GITHUB_OUTPUT nicht schreiben: ${err.message || err}`);
  }
}

function appendStepSummary(markdown) {
  const sum = process.env.GITHUB_STEP_SUMMARY;
  if (!sum) return;
  try {
    fs.appendFileSync(sum, `${markdown}\n`);
  } catch (err) {
    log(`Warnung: konnte GITHUB_STEP_SUMMARY nicht schreiben: ${err.message || err}`);
  }
}

function buildMarkdown(report) {
  const lines = [];
  lines.push(`# ${TOURNAMENT_NAME}: Offizielle Kader-Verfügbarkeit`);
  lines.push("");
  lines.push(`- **Generiert**: ${report.generatedAt}`);
  lines.push(`- **API**: \`league=${LEAGUE_ID}&season=${SEASON}\``);
  lines.push(`- **Teams gefunden**: ${report.teamsFound} / ${EXPECTED_TEAMS}`);
  lines.push(`- **Spieler total**: ${report.playersTotal}`);
  lines.push(`- **Mindest-Spieler pro Team**: ${MIN_PLAYERS_PER_TEAM}`);
  lines.push(`- **Bereit für offiziellen Import?** ${report.ready ? "✅ ja" : "❌ noch nicht"}`);
  lines.push("");

  if (report.warnings && report.warnings.length) {
    lines.push("## Hinweise");
    for (const w of report.warnings) lines.push(`- ${w}`);
    lines.push("");
  }

  lines.push("## Teams");
  lines.push("");
  lines.push("| Team | Spieler | Torhüter | Status |");
  lines.push("| --- | ---: | ---: | --- |");
  const sorted = [...report.teams].sort((a, b) => {
    if (a.complete !== b.complete) return a.complete ? 1 : -1;
    return String(a.name).localeCompare(String(b.name), "de");
  });
  for (const t of sorted) {
    const status = t.complete ? "✅" : `⏳ < ${MIN_PLAYERS_PER_TEAM}`;
    lines.push(`| ${t.name} | ${t.playerCount} | ${t.goalkeepers} | ${status} |`);
  }
  lines.push("");

  if (report.incompleteTeams.length) {
    lines.push("## Teams mit weniger als " + MIN_PLAYERS_PER_TEAM + " Spielern");
    for (const t of report.incompleteTeams) {
      lines.push(`- ${t.name} (${t.playerCount} Spieler)`);
    }
    lines.push("");
  }

  if (report.dataQuality) {
    lines.push("## Datenqualität (Stichprobe)");
    lines.push(`- Spieler ohne \`player.id\`: ${report.dataQuality.missingIds}`);
    lines.push(`- Spieler ohne Name: ${report.dataQuality.missingNames}`);
    lines.push(`- Spieler ohne Foto: ${report.dataQuality.missingPhotos}`);
    lines.push("");
  }

  return lines.join("\n");
}

async function main() {
  ensureDir(REPORTS_DIR);

  const apiKey = String(
    process.env.RAPIDAPI_KEY || process.env.API_FOOTBALL_KEY || "",
  ).trim();
  if (!apiKey) {
    log("FEHLER: RAPIDAPI_KEY (bzw. API_FOOTBALL_KEY als Fallback) ist nicht gesetzt.");
    writeGithubOutput({ ready: "false", teamsFound: "0", incompleteTeams: "0" });
    process.exit(1);
  }

  const api = createApiClient({ apiKey, logger: log });

  // ---------------- Phase 1: Teams ----------------
  log(`Lade /teams?league=${LEAGUE_ID}&season=${SEASON} …`);
  let teamsResponse;
  try {
    teamsResponse = await api.get("/teams", { league: LEAGUE_ID, season: SEASON });
  } catch (err) {
    log(`FEHLER beim Laden der Teams: ${err.message || err}`);
    writeGithubOutput({ ready: "false", teamsFound: "0", incompleteTeams: "0" });
    process.exit(1);
  }

  const rawTeams = Array.isArray(teamsResponse?.response) ? teamsResponse.response : [];
  const teams = rawTeams
    .map((entry) => ({
      id: entry?.team?.id,
      name: String(entry?.team?.name || "").trim() || `Team ${entry?.team?.id ?? "?"}`,
      logo: entry?.team?.logo || "",
    }))
    .filter((t) => t.id != null);

  const teamsFound = teams.length;
  log(`Teams gefunden: ${teamsFound} (erwartet: ${EXPECTED_TEAMS}).`);

  const teamMap = new Map(teams.map((t) => [Number(t.id), t]));

  // ---------------- Phase 2: Players (paginiert) ----------------
  log(`Lade /players?league=${LEAGUE_ID}&season=${SEASON} (paginiert) …`);
  let playersItems = [];
  let pagesFetched = 0;
  try {
    const result = await api.getAllPages(
      "/players",
      { league: LEAGUE_ID, season: SEASON },
      {
        onPage: ({ page, total, results }) => {
          pagesFetched = page;
          log(`  Seite ${page}/${total} – ${results} Einträge`);
        },
      },
    );
    playersItems = result.items;
  } catch (err) {
    log(`FEHLER beim Laden der Spieler: ${err.message || err}`);
    writeGithubOutput({ ready: "false", teamsFound: String(teamsFound), incompleteTeams: "0" });
    process.exit(1);
  }

  // ---------------- Phase 3: Spieler nach Nationalteam gruppieren ----------------
  const teamStats = new Map(); // nationalTeamId -> {playerCount, goalkeepers, missingIds, missingNames, missingPhotos}
  for (const t of teams) {
    teamStats.set(Number(t.id), {
      id: Number(t.id),
      name: t.name,
      playerCount: 0,
      goalkeepers: 0,
      missingIds: 0,
      missingNames: 0,
      missingPhotos: 0,
    });
  }

  let dqMissingIds = 0;
  let dqMissingNames = 0;
  let dqMissingPhotos = 0;
  let totalAssignedPlayers = 0;

  for (const item of playersItems) {
    const player = item?.player || {};
    const stats = Array.isArray(item?.statistics) ? item.statistics : [];

    // Bestimme Nationalteam: wir nutzen das league=1/season=2026-Statistik-Objekt,
    // dessen team.id zu unseren WM-Teams passt.
    let nationalTeamId = null;
    for (const s of stats) {
      const tid = s?.team?.id;
      if (tid != null && teamMap.has(Number(tid))) {
        nationalTeamId = Number(tid);
        break;
      }
    }
    if (nationalTeamId == null) {
      // Fallback: irgendein Statistik-Eintrag mit national=true
      for (const s of stats) {
        if (s?.team?.national === true && teamMap.has(Number(s?.team?.id))) {
          nationalTeamId = Number(s.team.id);
          break;
        }
      }
    }
    if (nationalTeamId == null) continue;

    const bucket = teamStats.get(nationalTeamId);
    if (!bucket) continue;

    bucket.playerCount += 1;
    totalAssignedPlayers += 1;

    if (player.id == null) {
      bucket.missingIds += 1;
      dqMissingIds += 1;
    }
    const name = String(player.name || `${player.firstname || ""} ${player.lastname || ""}`).trim();
    if (!name) {
      bucket.missingNames += 1;
      dqMissingNames += 1;
    }
    if (!player.photo) {
      bucket.missingPhotos += 1;
      dqMissingPhotos += 1;
    }

    // Position aus Statistik extrahieren
    const apiPosition = stats.find((s) => s?.games?.position)?.games?.position || "";
    if (normalizePosition(apiPosition) === "GOALKEEPER") {
      bucket.goalkeepers += 1;
    }
  }

  const teamsArr = Array.from(teamStats.values()).map((t) => ({
    ...t,
    complete: t.playerCount >= MIN_PLAYERS_PER_TEAM,
  }));
  const incompleteTeams = teamsArr.filter((t) => !t.complete);

  const ready = teamsFound === EXPECTED_TEAMS && incompleteTeams.length === 0;

  const warnings = [];
  if (teamsFound !== EXPECTED_TEAMS) {
    warnings.push(`Erwartet wurden ${EXPECTED_TEAMS} Teams, gefunden ${teamsFound}.`);
  }
  if (playersItems.length > 0 && totalAssignedPlayers === 0) {
    warnings.push(
      "Keine Spieler konnten einem WM-Team zugeordnet werden – evtl. liefert /players noch keine WM-2026-Daten.",
    );
  }
  if (dqMissingIds > 0) warnings.push(`${dqMissingIds} Spieler ohne player.id.`);
  if (dqMissingNames > 0) warnings.push(`${dqMissingNames} Spieler ohne Namen.`);
  if (dqMissingPhotos > 0) warnings.push(`${dqMissingPhotos} Spieler ohne Foto.`);

  const report = {
    tournament: TOURNAMENT_NAME,
    api: { league: LEAGUE_ID, season: SEASON },
    generatedAt: new Date().toISOString(),
    expectedTeams: EXPECTED_TEAMS,
    minPlayersPerTeam: MIN_PLAYERS_PER_TEAM,
    teamsFound,
    playersTotal: playersItems.length,
    playersAssigned: totalAssignedPlayers,
    pagesFetched,
    ready,
    warnings,
    dataQuality: {
      missingIds: dqMissingIds,
      missingNames: dqMissingNames,
      missingPhotos: dqMissingPhotos,
    },
    teams: teamsArr,
    incompleteTeams: incompleteTeams.map((t) => ({
      id: t.id,
      name: t.name,
      playerCount: t.playerCount,
      goalkeepers: t.goalkeepers,
    })),
  };

  fs.writeFileSync(STATUS_JSON, JSON.stringify(report, null, 2) + "\n", "utf8");
  const md = buildMarkdown(report);
  fs.writeFileSync(STATUS_MD, md, "utf8");

  appendStepSummary(md);
  writeGithubOutput({
    ready: ready ? "true" : "false",
    teamsFound: String(teamsFound),
    incompleteTeams: String(incompleteTeams.length),
    playersTotal: String(playersItems.length),
  });

  log(
    `Ergebnis: ready=${ready}, teamsFound=${teamsFound}/${EXPECTED_TEAMS}, ` +
      `incompleteTeams=${incompleteTeams.length}, playersTotal=${playersItems.length}.`,
  );
  log(`Report: ${path.relative(REPO_ROOT, STATUS_JSON)}`);
  log(`Report: ${path.relative(REPO_ROOT, STATUS_MD)}`);
}

main().catch((err) => {
  log(`UNERWARTETER FEHLER: ${err && err.stack ? err.stack : err}`);
  writeGithubOutput({ ready: "false", teamsFound: "0", incompleteTeams: "0" });
  process.exit(1);
});
