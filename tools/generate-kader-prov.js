#!/usr/bin/env node
/* =============================================================================
 *  tools/generate-kader-prov.js
 *
 *  Headless / Background-Variante des provisorischen WM-2026-Kader-Generators.
 *  Macht exakt das, was `adm-generate-kader-prov.html` im Browser macht – ruft
 *  also dieselben API-Endpoints von api-football v3 ab und baut daraus den
 *  Spielerpool zusammen – und schreibt das Ergebnis direkt in
 *  `data-wm2026.js`. Der bisherige manuelle Copy/Paste-Schritt entfällt.
 *
 *  Nutzung (Background-tauglich):
 *    RAPIDAPI_KEY=xxxxx node tools/generate-kader-prov.js
 *    nohup env RAPIDAPI_KEY=xxxxx node tools/generate-kader-prov.js \
 *        > kader-prov.log 2>&1 &
 *
 *  Wichtige Flags (siehe --help für die volle Liste):
 *    --api-key <key>     RapidAPI-Key (überschreibt RAPIDAPI_KEY).
 *    --output <pfad>     Zieldatei (Default: data-wm2026.js neben dem Script).
 *    --strategy <name>   Auswahlstrategie:
 *                          "auto"  (Default) – alle realistischen
 *                                    WM-Teilnehmer (vgl. unten).
 *                          "safe-mid" – exakt der bisherige manuelle Filter
 *                                    (Sicher + mittlere Sicherheit).
 *                          "all"   – alle gefundenen Spieler inkl. tiefe
 *                                    Sicherheit.
 *    --merge             Statt zu ersetzen: bestehende Einträge in der Datei
 *                          behalten und durch neue Datensätze ergänzen /
 *                          aktualisieren (key = player.id).
 *    --no-backup         Backup `data-wm2026.js.bak` nicht anlegen.
 *    --dry-run           Nur Statistik ausgeben, Datei NICHT verändern.
 *    --verbose           Mehr Logs (auch HTTP-Fehler-Details).
 *
 *  Auswahlstrategie "auto":
 *    Ziel ist, möglichst alle Spieler zu behalten, die realistisch an der
 *    WM 2026 teilnehmen, ohne Karteileichen mitzunehmen.
 *
 *      • Quelle "wmPlayers" (= /players?league=1&season=2026): immer behalten.
 *      • Quelle "squad"     (= aktueller Nationalmannschaftskader):
 *                          immer behalten.
 *      • Nur "lineup"-Quelle: behalten wenn der Spieler in den letzten 12
 *                          Spielen mindestens einmal in der Startelf stand
 *                          oder mindestens zweimal auf der Bank sass.
 *      • Spieler ohne Nationalteam-Zuordnung werden grundsätzlich verworfen.
 *
 *    Diese Heuristik liefert minimal mehr Spieler als der bisherige Filter
 *    "Sicher + mittlere Sicherheit", weil auch Lineup-Stammspieler mit nur
 *    1–2 Einsätzen (z.B. Aufgebote der jüngsten Länderspielfenster) sicher
 *    drin sind, statt nur via Score-Schwelle reinzurutschen.
 * ============================================================================= */

"use strict";

const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const DEFAULT_OUTPUT = path.join(ROOT, "data-wm2026.js");

const API_BASE = "https://v3.football.api-sports.io";
const API_HOST = "v3.football.api-sports.io";
const COMPETITION_ID = 1;
const SEASON = "2026";
const RECENT_FIXTURES_LIMIT = 12;

const ARGS = parseArgs(process.argv.slice(2));

if (ARGS.help) {
  printHelp();
  process.exit(0);
}

const API_KEY = (ARGS["api-key"] || process.env.RAPIDAPI_KEY || "").trim();
const OUTPUT_FILE = path.resolve(ARGS.output || DEFAULT_OUTPUT);
const STRATEGY = (ARGS.strategy || "auto").toLowerCase();
const MERGE = !!ARGS.merge;
const NO_BACKUP = !!ARGS["no-backup"];
const DRY_RUN = !!ARGS["dry-run"];
const VERBOSE = !!ARGS.verbose;

if (!API_KEY) {
  console.error(
    "❌ Kein RapidAPI-Key gefunden. Setze RAPIDAPI_KEY oder nutze --api-key <key>."
  );
  process.exit(2);
}

if (!["auto", "safe-mid", "all"].includes(STRATEGY)) {
  console.error(
    `❌ Unbekannte Strategie "${STRATEGY}". Erlaubt: auto, safe-mid, all.`
  );
  process.exit(2);
}

main().catch((err) => {
  console.error("\n❌ Abbruch mit Fehler:", err && err.stack ? err.stack : err);
  process.exit(1);
});

/* ---------------------------------------------------------------------------
 *  Hauptablauf
 * ------------------------------------------------------------------------- */

async function main() {
  log(
    `▶ Start WM-2026-Kader-Generator (Strategie=${STRATEGY}, Merge=${MERGE}, DryRun=${DRY_RUN})`
  );
  log(`▶ Zieldatei: ${OUTPUT_FILE}`);

  log("→ Lade Teams …");
  const teams = await fetchTeams();
  if (!teams.length) {
    throw new Error("Keine Teams aus der API erhalten – Abbruch.");
  }
  log(`✔ ${teams.length} Teams geladen.`);

  const teamByName = new Map();
  for (const t of teams) {
    if (t && t.name) teamByName.set(String(t.name).trim().toLowerCase(), t);
  }

  const candidates = new Map();
  let teamIndex = 0;

  for (const team of teams) {
    teamIndex += 1;
    log(`\n[${teamIndex}/${teams.length}] ${team.name} (id=${team.id})`);

    let wmPlayers = [];
    let squad = [];
    let recentFixtures = [];

    try {
      wmPlayers = await fetchWMPlayers(team.id);
    } catch (err) {
      log(`  ⚠ wm-players fehlgeschlagen: ${err.message}`);
    }

    try {
      squad = await fetchSquad(team.id);
    } catch (err) {
      log(`  ⚠ squad fehlgeschlagen: ${err.message}`);
    }

    try {
      recentFixtures = await fetchRecentFixtureIds(team.id);
    } catch (err) {
      log(`  ⚠ fixtures fehlgeschlagen: ${err.message}`);
    }

    let lineupCount = 0;

    for (const item of wmPlayers) {
      const player = item.player || {};
      const stat = (item.statistics && item.statistics[0]) || {};
      addCandidate(candidates, {
        "player.id": player.id || 0,
        firstname: player.firstname || "",
        lastname: player.lastname || "",
        rawName: player.name || "",
        Spielername: buildShortPlayerName({
          name: player.name,
          firstname: player.firstname,
          lastname: player.lastname,
        }),
        Spielerfoto: player.photo || "",
        Position: normalizePosition((stat.games && stat.games.position) || ""),
        "Nationalteam.name": team.name || "",
        "Nationalteam.logo": team.logo || "",
        "Club.name":
          stat.team && Number(stat.team.id) !== Number(team.id)
            ? stat.team.name || ""
            : "",
        "Club.logo":
          stat.team && Number(stat.team.id) !== Number(team.id)
            ? stat.team.logo || ""
            : "",
        Geburtsdatum: (player.birth && player.birth.date) || "",
        Groesse: stripUnit(player.height),
        Gewicht: stripUnit(player.weight),
        sources: ["wmPlayers"],
        startsFound: 0,
        benchFound: 0,
        appearancesFound: 0,
      });
    }

    for (const p of squad) {
      addCandidate(candidates, {
        "player.id": p.id || 0,
        firstname: p.firstname || "",
        lastname: p.lastname || "",
        rawName: p.name || "",
        Spielername: buildShortPlayerName({
          name: p.name,
          firstname: p.firstname,
          lastname: p.lastname,
        }),
        Spielerfoto: p.photo || "",
        Position: normalizePosition(p.position || ""),
        "Nationalteam.name": team.name || "",
        "Nationalteam.logo": team.logo || "",
        "Club.name": "",
        "Club.logo": "",
        Geburtsdatum: "",
        Groesse: "",
        Gewicht: "",
        sources: ["squad"],
        startsFound: 0,
        benchFound: 0,
        appearancesFound: 0,
      });
    }

    for (const fixtureId of recentFixtures) {
      let lineups = [];
      try {
        lineups = await fetchFixtureLineups(fixtureId);
      } catch (err) {
        if (VERBOSE) log(`  ⚠ lineup ${fixtureId}: ${err.message}`);
        continue;
      }

      for (const lineup of lineups) {
        if (Number(lineup.team && lineup.team.id) !== Number(team.id)) continue;

        for (const sp of lineup.startXI || []) {
          lineupCount += 1;
          const p = sp.player || {};
          addCandidate(candidates, {
            "player.id": p.id || 0,
            firstname: "",
            lastname: "",
            rawName: p.name || "",
            Spielername: buildShortPlayerName({ name: p.name }),
            Spielerfoto: "",
            Position: normalizePosition(p.pos || ""),
            "Nationalteam.name": team.name || "",
            "Nationalteam.logo": team.logo || "",
            "Club.name": "",
            "Club.logo": "",
            Geburtsdatum: "",
            Groesse: "",
            Gewicht: "",
            sources: ["lineup"],
            startsFound: 1,
            benchFound: 0,
            appearancesFound: 1,
          });
        }

        for (const sb of lineup.substitutes || []) {
          const p = sb.player || {};
          addCandidate(candidates, {
            "player.id": p.id || 0,
            firstname: "",
            lastname: "",
            rawName: p.name || "",
            Spielername: buildShortPlayerName({ name: p.name }),
            Spielerfoto: "",
            Position: normalizePosition(p.pos || ""),
            "Nationalteam.name": team.name || "",
            "Nationalteam.logo": team.logo || "",
            "Club.name": "",
            "Club.logo": "",
            Geburtsdatum: "",
            Groesse: "",
            Gewicht: "",
            sources: ["lineup"],
            startsFound: 0,
            benchFound: 1,
            appearancesFound: 0,
          });
        }
      }
    }

    log(
      `  → wm:${wmPlayers.length} squad:${squad.length} lineup-rows:${lineupCount} (kandidaten gesamt:${candidates.size})`
    );
  }

  log(
    `\n→ Detail-Enrichment für ${candidates.size} Kandidaten (kann ein paar Minuten dauern) …`
  );
  const enrichedList = [];
  let i = 0;
  for (const candidate of candidates.values()) {
    i += 1;
    let enriched = candidate;
    try {
      enriched = await enrichPlayerDetails(candidate, teamByName);
    } catch (err) {
      if (VERBOSE) {
        log(
          `  ⚠ Enrichment-Fehler ${candidate["Spielername"]} (id ${candidate["player.id"]}): ${err.message}`
        );
      }
    }
    const sc = scoreCandidate(enriched);
    enriched.score = sc;
    enriched.confidenceLabel = labelFor(sc);
    enrichedList.push(enriched);

    if (i % 25 === 0 || i === candidates.size) {
      log(`  Detail-Enrichment: ${i} / ${candidates.size}`);
    }
  }

  const filtered = applyStrategy(enrichedList, STRATEGY);

  enrichedList.sort(comparePlayers);
  filtered.sort(comparePlayers);

  const stats = computeStats(enrichedList, filtered);
  log("");
  log("📊 Statistik:");
  log(`   Total gefunden        : ${stats.total}`);
  log(`   Sicher                : ${stats.safe}`);
  log(`   mittlere Sicherheit   : ${stats.mid}`);
  log(`   tiefere Sicherheit    : ${stats.low}`);
  log(`   Behalten (Strategie)  : ${stats.kept}`);
  log(`   Verworfen             : ${stats.dropped}`);
  log(`   ohne Club             : ${stats.noClub}`);
  log(`   Name unvollständig    : ${stats.shortName}`);
  log(`   ohne Geburtsdatum     : ${stats.noBirth}`);

  const exportRecords = filtered.map(toExportRecord);

  let finalRecords = exportRecords;
  if (MERGE) {
    finalRecords = mergeWithExisting(OUTPUT_FILE, exportRecords);
    log(
      `\n🔁 Merge mit bestehender Datei: ${exportRecords.length} neue/aktualisierte → ${finalRecords.length} total.`
    );
  }

  finalRecords.sort(compareExportRecords);

  if (DRY_RUN) {
    log(
      `\n💡 Dry-Run – ${finalRecords.length} Spieler würden geschrieben werden. Datei bleibt unverändert.`
    );
    return;
  }

  if (!NO_BACKUP && fs.existsSync(OUTPUT_FILE)) {
    const backupPath = `${OUTPUT_FILE}.bak`;
    fs.copyFileSync(OUTPUT_FILE, backupPath);
    log(`💾 Backup erstellt: ${backupPath}`);
  }

  writeDataFile(OUTPUT_FILE, finalRecords);
  log(
    `\n✅ Fertig. ${finalRecords.length} Spieler in ${OUTPUT_FILE} geschrieben.`
  );
}

/* ---------------------------------------------------------------------------
 *  API-Helfer
 * ------------------------------------------------------------------------- */

async function apiGet(pathPart, retry = true) {
  const url = `${API_BASE}/${pathPart}`;
  const opts = {
    method: "GET",
    headers: {
      "x-rapidapi-key": API_KEY,
      "x-rapidapi-host": API_HOST,
    },
  };

  try {
    const res = await fetch(url, opts);
    if (!res.ok) {
      throw new Error(`HTTP ${res.status} ${res.statusText} :: ${url}`);
    }
    const data = await res.json();
    if (data && data.errors && Object.keys(data.errors).length) {
      throw new Error(`API errors :: ${JSON.stringify(data.errors)}`);
    }
    return data;
  } catch (err) {
    if (retry) {
      await delay(800);
      return apiGet(pathPart, false);
    }
    throw err;
  }
}

async function fetchTeams() {
  const d = await apiGet(`teams?league=${COMPETITION_ID}&season=${SEASON}`);
  return (d.response || []).map((x) => x.team).filter(Boolean);
}

async function fetchWMPlayers(teamId) {
  let page = 1;
  let totalPages = 1;
  const out = [];
  let skipped = 0;
  while (page <= totalPages) {
    const d = await apiGet(
      `players?league=${COMPETITION_ID}&season=${SEASON}&team=${teamId}&page=${page}`
    );
    totalPages = (d.paging && d.paging.total) || 1;
    for (const item of d.response || []) {
      // Wie im Browser-Tool: gelegentlich liefert /players?team= Zeilen, deren
      // primäres Statistik-Team NICHT das angefragte Team ist (Spieler aus
      // gemeinsamen Fixtures). Diese würden falsche Nationalitäten verursachen
      // (Mbappé/Barcola etc.) und werden hier verworfen.
      const stTeamId = Number(
        (item &&
          item.statistics &&
          item.statistics[0] &&
          item.statistics[0].team &&
          item.statistics[0].team.id) ||
          0
      );
      if (!stTeamId || stTeamId === Number(teamId)) {
        out.push(item);
      } else {
        skipped += 1;
      }
    }
    page += 1;
    await delay(150);
  }
  if (skipped && VERBOSE) {
    log(`    (${skipped} fremd-Statistik-Zeilen verworfen)`);
  }
  return out;
}

async function fetchSquad(teamId) {
  const d = await apiGet(`players/squads?team=${teamId}`);
  return (d.response && d.response[0] && d.response[0].players) || [];
}

async function fetchRecentFixtureIds(teamId) {
  const d = await apiGet(`fixtures?team=${teamId}&last=${RECENT_FIXTURES_LIMIT}`);
  return (d.response || [])
    .map((f) => f.fixture && f.fixture.id)
    .filter(Boolean);
}

async function fetchFixtureLineups(fixtureId) {
  const d = await apiGet(`fixtures/lineups?fixture=${fixtureId}`);
  await delay(120);
  return d.response || [];
}

async function fetchPlayerSeasonDetails(playerId, season) {
  return apiGet(`players?id=${playerId}&season=${season}`);
}

/* ---------------------------------------------------------------------------
 *  Datenaufbereitung
 * ------------------------------------------------------------------------- */

function addCandidate(map, candidate) {
  const key = candidate["player.id"]
    ? `id:${candidate["player.id"]}`
    : `${(candidate["Spielername"] || "").toLowerCase()}|${
        candidate["Nationalteam.name"]
      }|${candidate["Geburtsdatum"] || ""}`;

  if (!map.has(key)) {
    map.set(key, candidate);
    return;
  }
  map.set(key, mergeCandidate(map.get(key), candidate));
}

function mergeCandidate(a, b) {
  const pick = (x, y) => x || y;
  const merged = { ...a, ...b };

  merged.firstname = pick(a.firstname, b.firstname) || "";
  merged.lastname = pick(a.lastname, b.lastname) || "";
  merged.rawName = pick(a.rawName, b.rawName) || "";
  merged["Spielername"] =
    buildShortPlayerName({
      name: merged.rawName || a["Spielername"] || b["Spielername"] || "",
      firstname: merged.firstname,
      lastname: merged.lastname,
    }) ||
    a["Spielername"] ||
    b["Spielername"] ||
    "";

  if (
    a["Nationalteam.name"] &&
    b["Nationalteam.name"] &&
    a["Nationalteam.name"] !== b["Nationalteam.name"]
  ) {
    if (VERBOSE) {
      log(
        `  ⚠ Nationalitäts-Konflikt für ${
          merged["Spielername"] || a["Spielername"] || b["Spielername"]
        } (id ${a["player.id"] || b["player.id"]}): ${
          a["Nationalteam.name"]
        } vs ${b["Nationalteam.name"]} – behalte ${a["Nationalteam.name"]}`
      );
    }
  }
  merged["Nationalteam.name"] =
    a["Nationalteam.name"] || b["Nationalteam.name"] || "";
  merged["Nationalteam.logo"] =
    a["Nationalteam.logo"] || b["Nationalteam.logo"] || "";

  merged["Club.name"] =
    a["Club.name"] && a["Club.name"] !== a["Nationalteam.name"]
      ? a["Club.name"]
      : pick(b["Club.name"], a["Club.name"]);
  merged["Club.logo"] = pick(a["Club.logo"], b["Club.logo"]);

  merged.sources = [
    ...new Set([...(a.sources || []), ...(b.sources || [])]),
  ];
  merged.startsFound = (a.startsFound || 0) + (b.startsFound || 0);
  merged.appearancesFound =
    (a.appearancesFound || 0) + (b.appearancesFound || 0);
  merged.benchFound = (a.benchFound || 0) + (b.benchFound || 0);

  return merged;
}

async function enrichPlayerDetails(candidate, teamByName) {
  if (!candidate || !candidate["player.id"]) return { ...candidate };
  const seasons = ["2026", "2025", "2024"];
  let mergedPlayer = null;
  let mergedPosition = "";
  const allStats = [];

  for (const season of seasons) {
    try {
      const d = await fetchPlayerSeasonDetails(candidate["player.id"], season);
      const response = (d && d.response) || [];
      if (!response.length) continue;
      const row = response[0] || {};
      const pl = row.player || {};
      mergedPlayer = mergedPlayer ? { ...pl, ...mergedPlayer } : { ...pl };
      mergedPosition =
        mergedPosition ||
        normalizePosition(
          (row.statistics && row.statistics[0] && row.statistics[0].games &&
            row.statistics[0].games.position) ||
            ""
        );
      if (Array.isArray(row.statistics)) allStats.push(...row.statistics);
    } catch (err) {
      if (VERBOSE) {
        log(
          `  ⚠ Detail-Fehler ${candidate["player.id"]} season ${season}: ${err.message}`
        );
      }
    }
    await delay(80);
  }

  let correctedNT = null;
  const apiNationality = String(
    (mergedPlayer && mergedPlayer.nationality) || ""
  ).trim();
  if (apiNationality && teamByName) {
    const found = teamByName.get(apiNationality.toLowerCase());
    if (found) {
      const cur = String(candidate["Nationalteam.name"] || "").trim().toLowerCase();
      if (cur && cur !== apiNationality.toLowerCase()) {
        correctedNT = found;
        if (VERBOSE) {
          log(
            `  ⚠ Korrigiere Nationalität für ${
              (mergedPlayer && mergedPlayer.name) || candidate["Spielername"]
            }: ${candidate["Nationalteam.name"]} → ${found.name}`
          );
        }
      }
    }
  }

  const finalNTName =
    (correctedNT && correctedNT.name) || candidate["Nationalteam.name"] || "";
  const finalNTLogo =
    (correctedNT && correctedNT.logo) || candidate["Nationalteam.logo"] || "";

  const ntForClub = {
    id: (correctedNT && correctedNT.id) || 0,
    name: finalNTName,
  };
  const clubFromStats = pickBestClubFromStatistics(allStats, ntForClub);

  let clubName = candidate["Club.name"] || "";
  let clubLogo = candidate["Club.logo"] || "";
  if (
    clubName &&
    finalNTName &&
    clubName.trim().toLowerCase() === finalNTName.trim().toLowerCase()
  ) {
    clubName = "";
    clubLogo = "";
  }
  if (!clubName && clubFromStats) {
    clubName = clubFromStats.name || "";
    clubLogo = clubLogo || clubFromStats.logo || "";
  }

  const fn =
    (mergedPlayer && mergedPlayer.firstname) || candidate.firstname || "";
  const ln =
    (mergedPlayer && mergedPlayer.lastname) || candidate.lastname || "";
  const rawName =
    (mergedPlayer && mergedPlayer.name) ||
    candidate.rawName ||
    candidate["Spielername"] ||
    "";
  const bestName = buildShortPlayerName({ name: rawName, firstname: fn, lastname: ln });

  return {
    ...candidate,
    firstname: fn,
    lastname: ln,
    rawName,
    Spielername: bestName || candidate["Spielername"] || "",
    Spielerfoto:
      candidate["Spielerfoto"] || (mergedPlayer && mergedPlayer.photo) || "",
    Position: candidate["Position"] || mergedPosition || "",
    "Nationalteam.name": finalNTName,
    "Nationalteam.logo": finalNTLogo,
    "Club.name": clubName || "",
    "Club.logo": clubLogo || "",
    Geburtsdatum:
      candidate["Geburtsdatum"] ||
      (mergedPlayer && mergedPlayer.birth && mergedPlayer.birth.date) ||
      "",
    Groesse: candidate["Groesse"] || stripUnit(mergedPlayer && mergedPlayer.height),
    Gewicht: candidate["Gewicht"] || stripUnit(mergedPlayer && mergedPlayer.weight),
  };
}

function pickBestClubFromStatistics(statistics, nationalTeam) {
  if (!Array.isArray(statistics) || !statistics.length) return null;
  const ranked = statistics
    .map((st) => {
      const team = (st && st.team) || {};
      const isNt =
        isNationalTeam(team, nationalTeam) || team.national === true;
      const filled = (team.name ? 1 : 0) + (team.logo ? 1 : 0);
      const apps = Number((st.games && st.games.appearences) || 0);
      return { team, isNt, filled, apps };
    })
    .filter((x) => !x.isNt && x.team && (x.team.name || x.team.logo))
    .sort((a, b) => b.filled - a.filled || b.apps - a.apps);
  return (ranked[0] && ranked[0].team) || null;
}

function isNationalTeam(statTeam, nationalTeam) {
  if (!statTeam) return false;
  const ntName = String((nationalTeam && nationalTeam.name) || "")
    .trim()
    .toLowerCase();
  const ntId = Number((nationalTeam && nationalTeam.id) || 0);
  const stName = String((statTeam && statTeam.name) || "").trim().toLowerCase();
  const stId = Number((statTeam && statTeam.id) || 0);
  return (
    (ntId && stId && ntId === stId) || (ntName && stName && ntName === stName)
  );
}

function scoreCandidate(c) {
  let s = 0;
  if (c.sources.includes("wmPlayers")) s += 95;
  if (c.sources.includes("squad")) s += 45;
  s += Math.min(60, (c.startsFound || 0) * 12);
  s += Math.min(35, (c.benchFound || 0) * 7);
  s += Math.min(30, (c.appearancesFound || 0) * 8);
  if (c["Geburtsdatum"] && c["Groesse"] && c["Gewicht"]) s += 5;
  if (isAbbreviatedName(c["Spielername"])) s -= 10;
  if (!c["Club.name"]) s -= 10;
  return s;
}

function labelFor(score) {
  if (score >= 70) return "Sicher";
  if (score >= 35) return "mittlere Sicherheit";
  return "tiefere Sicherheit";
}

function applyStrategy(list, strategy) {
  if (strategy === "all") {
    return list.filter((p) => p["Nationalteam.name"]);
  }

  if (strategy === "safe-mid") {
    return list.filter(
      (p) =>
        p["Nationalteam.name"] &&
        (p.confidenceLabel === "Sicher" ||
          p.confidenceLabel === "mittlere Sicherheit")
    );
  }

  // strategy === "auto"
  return list.filter((p) => {
    if (!p["Nationalteam.name"]) return false;
    const sources = p.sources || [];
    if (sources.includes("wmPlayers")) return true;
    if (sources.includes("squad")) return true;
    // nur "lineup" → realistischen Aktiv-Spielern eine Chance geben.
    if (sources.includes("lineup")) {
      if ((p.startsFound || 0) >= 1) return true;
      if ((p.benchFound || 0) >= 2) return true;
    }
    return false;
  });
}

function comparePlayers(a, b) {
  const aT = String(a["Nationalteam.name"] || "");
  const bT = String(b["Nationalteam.name"] || "");
  const t = aT.localeCompare(bT, "de");
  if (t !== 0) return t;
  return String(a["Spielername"] || "").localeCompare(
    String(b["Spielername"] || ""),
    "de"
  );
}

function compareExportRecords(a, b) {
  const aT = String(a["Nationalteam.name"] || "");
  const bT = String(b["Nationalteam.name"] || "");
  const t = aT.localeCompare(bT, "de");
  if (t !== 0) return t;
  return String(a["Spielername"] || "").localeCompare(
    String(b["Spielername"] || ""),
    "de"
  );
}

function toExportRecord(p) {
  return {
    "player.id": p["player.id"] || 0,
    Spielername: p["Spielername"] || "",
    Spielerfoto: p["Spielerfoto"] || "",
    Position: p["Position"] || "",
    "Nationalteam.name": p["Nationalteam.name"] || "",
    "Nationalteam.logo": p["Nationalteam.logo"] || "",
    "Club.name": p["Club.name"] || "",
    "Club.logo": p["Club.logo"] || "",
    Geburtsdatum: p["Geburtsdatum"] || "",
    Groesse: p["Groesse"] || "",
    Gewicht: p["Gewicht"] || "",
  };
}

function computeStats(all, kept) {
  const safe = all.filter((x) => x.confidenceLabel === "Sicher").length;
  const mid = all.filter((x) => x.confidenceLabel === "mittlere Sicherheit")
    .length;
  const low = all.filter((x) => x.confidenceLabel === "tiefere Sicherheit")
    .length;
  const noClub = all.filter((x) => !x["Club.name"]).length;
  const shortName = all.filter((x) => isAbbreviatedName(x["Spielername"])).length;
  const noBirth = all.filter((x) => !x["Geburtsdatum"]).length;
  return {
    total: all.length,
    safe,
    mid,
    low,
    kept: kept.length,
    dropped: all.length - kept.length,
    noClub,
    shortName,
    noBirth,
  };
}

/* ---------------------------------------------------------------------------
 *  File I/O
 * ------------------------------------------------------------------------- */

function mergeWithExisting(filePath, newRecords) {
  if (!fs.existsSync(filePath)) {
    log(`(merge) Datei ${filePath} existiert nicht – schreibe nur neue Daten.`);
    return [...newRecords];
  }
  let existing = [];
  try {
    existing = readPlayersDataFromFile(filePath);
  } catch (err) {
    log(
      `⚠ Konnte bestehende Datei nicht parsen, verwende reines Replace: ${err.message}`
    );
    return [...newRecords];
  }
  const map = new Map();
  for (const e of existing) {
    if (e && e["player.id"]) map.set(`id:${e["player.id"]}`, e);
    else if (e && e["Spielername"])
      map.set(`name:${(e["Spielername"] || "").toLowerCase()}|${e["Nationalteam.name"]}`, e);
  }
  for (const n of newRecords) {
    const key = n["player.id"]
      ? `id:${n["player.id"]}`
      : `name:${(n["Spielername"] || "").toLowerCase()}|${n["Nationalteam.name"]}`;
    map.set(key, { ...(map.get(key) || {}), ...n });
  }
  return [...map.values()];
}

function readPlayersDataFromFile(filePath) {
  const raw = fs.readFileSync(filePath, "utf8");
  // Kontextisolierte Auswertung – wir bauen einen Mini-VM-Kontext ohne globale
  // Browser-Objekte. Reicht für `const playersData = [...]; window.playersData = ...`.
  const sandbox = { window: {}, module: { exports: {} }, exports: {} };
  const wrapped = `(function(window, module, exports){${raw}; return (typeof playersData!=='undefined') ? playersData : window.playersData;})`;
  // eslint-disable-next-line no-new-func
  const fn = new Function(`return ${wrapped}`)();
  const result = fn(sandbox.window, sandbox.module, sandbox.exports);
  if (!Array.isArray(result)) {
    throw new Error("playersData ist nach dem Lesen kein Array.");
  }
  return result;
}

function writeDataFile(filePath, records) {
  const json = JSON.stringify(records, null, 2);
  const content = `const playersData = ${json};\n\nwindow.playersData = playersData;\n`;
  const tmp = `${filePath}.tmp-${process.pid}`;
  fs.writeFileSync(tmp, content, "utf8");
  fs.renameSync(tmp, filePath);
}

/* ---------------------------------------------------------------------------
 *  String/Format-Helfer (1:1 aus dem Browser-Tool portiert, damit sich
 *  Namens-/Positions-Logik nicht zwischen Headless und Browser unterscheidet)
 * ------------------------------------------------------------------------- */

function normalizePosition(p) {
  const v = String(p || "").toUpperCase();
  if (["GOALKEEPER", "GK", "G"].includes(v)) return "GOALKEEPER";
  if (["DEFENDER", "D", "DF"].includes(v)) return "DEFENDER";
  if (["MIDFIELDER", "M", "MF"].includes(v)) return "MIDFIELDER";
  if (["ATTACKER", "FORWARD", "F", "FW"].includes(v)) return "ATTACKER";
  return v || "";
}

function stripUnit(value) {
  return String(value || "").replace(/[^\d]/g, "");
}

function isAbbreviatedName(n) {
  if (!n) return false;
  return /\b[A-ZÀ-ÖØ-Ý]\./.test(n) || /^[A-ZÀ-ÖØ-Ý]\.?\s+/.test(n.trim());
}

function buildShortPlayerName(input) {
  const nm = String((input && input.name) || "").trim();
  const fn = String((input && input.firstname) || "").trim();
  const ln = String((input && input.lastname) || "").trim();
  if (nm && !nm.includes(".")) {
    const tokens = nm.split(/\s+/).filter(Boolean);
    if (tokens.length === 1) {
      const single = tokens[0];
      const lnTokens = ln
        .split(/\s+/)
        .filter(Boolean)
        .map((s) => s.toLowerCase());
      const fnFirst = fn.split(/\s+/).filter(Boolean)[0] || "";
      if (
        fnFirst &&
        lnTokens.includes(single.toLowerCase()) &&
        fnFirst.toLowerCase() !== single.toLowerCase()
      ) {
        return `${fnFirst} ${single}`;
      }
      return single;
    }
    if (tokens.length === 2) return tokens.join(" ");
  }
  const firstNamePart =
    fn.split(/\s+/).filter(Boolean)[0] ||
    nm.split(/\s+/).filter(Boolean)[0] ||
    "";
  let surnamePart = "";
  if (nm.includes(".")) {
    const afterDot = nm.split(".").pop().trim();
    if (afterDot) surnamePart = afterDot.split(/\s+/).filter(Boolean)[0] || "";
  }
  if (!surnamePart && ln) {
    surnamePart = ln.split(/\s+/).filter(Boolean)[0] || "";
  }
  if (!surnamePart && nm) {
    const tokens = nm.replace(/\./g, " ").split(/\s+/).filter(Boolean);
    surnamePart = tokens[tokens.length - 1] || "";
  }
  if (
    firstNamePart &&
    surnamePart &&
    firstNamePart.toLowerCase() !== surnamePart.toLowerCase()
  ) {
    return `${firstNamePart} ${surnamePart}`;
  }
  return surnamePart || firstNamePart || nm;
}

/* ---------------------------------------------------------------------------
 *  CLI / kleine Utilities
 * ------------------------------------------------------------------------- */

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (!a.startsWith("--")) continue;
    const eq = a.indexOf("=");
    if (eq !== -1) {
      out[a.slice(2, eq)] = a.slice(eq + 1);
      continue;
    }
    const key = a.slice(2);
    const next = argv[i + 1];
    if (next === undefined || next.startsWith("--")) {
      out[key] = true;
    } else {
      out[key] = next;
      i += 1;
    }
  }
  if (out.h || out.help) out.help = true;
  return out;
}

function printHelp() {
  const help = `
WM-2026 Kader-Generator (headless)

Befehl:
  RAPIDAPI_KEY=<key> node tools/generate-kader-prov.js [optionen]

Optionen:
  --api-key <key>     RapidAPI-Key (überschreibt RAPIDAPI_KEY)
  --output <pfad>     Zieldatei (Default: data-wm2026.js im Repo-Root)
  --strategy <name>   Auswahlstrategie (default: auto):
                        auto      → realistische WM-Teilnehmer
                        safe-mid  → bisheriger manueller Filter
                                     (Sicher + mittlere Sicherheit)
                        all       → alle gefundenen Spieler
  --merge             Bestehende Einträge in der Datei nicht löschen,
                      sondern via player.id aktualisieren/ergänzen.
  --no-backup         Kein .bak vor dem Überschreiben anlegen.
  --dry-run           Nur Statistik berechnen, Datei nicht ändern.
  --verbose           Mehr Logs (HTTP-/Konflikt-Details).
  --help              Diese Hilfe.

Background-Beispiel:
  nohup env RAPIDAPI_KEY=xxxxx \\
       node tools/generate-kader-prov.js \\
       > kader-prov.log 2>&1 &
`;
  process.stdout.write(`${help}\n`);
}

function delay(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function log(msg) {
  const ts = new Date().toISOString().replace("T", " ").slice(0, 19);
  process.stdout.write(`[${ts}] ${msg}\n`);
}
