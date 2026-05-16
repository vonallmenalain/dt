/* =============================================================================
 *  scripts/lib/kaderHelpers.mjs
 *
 *  Geteilte Helfer für die WM-2026-Kader-Skripte (Check + Generator).
 *  Portiert die Kernlogik aus adm-generate-kader-wm2026.html bzw. aus dem
 *  früheren allgemeinen adm-generate-kader.html in eine reine Node-/ESM-
 *  Variante – ohne Browser, DOM oder sessionStorage.
 *
 *  Enthalten:
 *  - Position-Normalisierung (GOALKEEPER, DEFENDER, MIDFIELDER, ATTACKER)
 *  - Anwenden der position-overrides.js für `wm2026`
 *  - Vollständigen Spielernamen aus firstname + lastname (mit Diakritika)
 *  - Vereins-Detection aus `statistics`
 *  - cleanHeight / cleanWeight (entfernt " cm" / " kg")
 *  - Lader für position-overrides.js (parst die window-Property heraus)
 * ============================================================================= */

import fs from "node:fs";
import path from "node:path";

/* ---------- Position-Normalisierung ---------------------------------- */

const POSITION_ALLOWED = new Set(["GOALKEEPER", "DEFENDER", "MIDFIELDER", "ATTACKER"]);

export function normalizePosition(pos) {
  const value = String(pos == null ? "" : pos).trim().toUpperCase();
  if (!value) return "";
  if (value === "GOALKEEPER" || value === "GK" || value === "TORWART" || value === "KEEPER") return "GOALKEEPER";
  if (value === "DEFENDER" || value === "DF" || value === "VERTEIDIGER" || value === "DEFENCE") return "DEFENDER";
  if (value === "MIDFIELDER" || value === "MF" || value === "MITTELFELD" || value === "MIDFIELD") return "MIDFIELDER";
  if (
    value === "FORWARD" ||
    value === "ATTACKER" ||
    value === "FW" ||
    value === "STÜRMER" ||
    value === "STUERMER" ||
    value === "ATTACK"
  ) {
    return "ATTACKER";
  }
  return POSITION_ALLOWED.has(value) ? value : "";
}

/* ---------- Höhe / Gewicht ------------------------------------------- */

export function cleanHeight(value) {
  if (value === undefined || value === null) return "-";
  const s = String(value).trim();
  if (!s) return "-";
  return s.replace(/\s*cm\s*$/i, "").trim() || "-";
}

export function cleanWeight(value) {
  if (value === undefined || value === null) return "-";
  const s = String(value).trim();
  if (!s) return "-";
  return s.replace(/\s*kg\s*$/i, "").trim() || "-";
}

/* ---------- Voller Spielername (Diakritika beibehalten) -------------- */

/**
 * HTML-Entitäten und gängige Mojibake-Reste aus API-Football-Namen
 * entfernen. Beispiele aus produktiven Daten:
 *   - "Nico O&apos;Reilly"   → "Nico O’Reilly"
 *   - "Aiden O&apos;Neill"   → "Aiden O’Neill"
 *   - "Oston O&apos;runov"   → "Oston O’runov"
 * Wir mappen den HTML-Apostroph auf "’" (typografischer Apostroph), weil
 * das in den Verbandsschreibweisen der korrektere Glyph ist. Sonderfälle
 * wie das usbekische "Oʻ" werden zusätzlich über MANUAL_NAME_OVERRIDES
 * gepflegt.
 */
export function decodeNameEntities(value) {
  const s = String(value == null ? "" : value);
  if (!s) return s;
  return s
    .replace(/&apos;|&#0?39;|&#x27;/g, "’")
    .replace(/&quot;|&#0?34;|&#x22;/g, '"')
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&nbsp;/g, " ");
}

/**
 * Vollständiger Name: bevorzugt `firstname + " " + lastname`, mit Fallback auf
 * `player.name`. Sonderzeichen/Diakritika werden NICHT entfernt – die App-Suche
 * ist diakritikatolerant. HTML-Entitäten in den API-Feldern werden vor dem
 * Zusammensetzen dekodiert.
 */
export function buildFullName(player) {
  const firstname = decodeNameEntities(player?.firstname).trim();
  const lastname = decodeNameEntities(player?.lastname).trim();
  const apiName = decodeNameEntities(player?.name).trim();

  const combined = `${firstname} ${lastname}`.replace(/\s+/g, " ").trim();
  if (combined) return combined;
  if (apiName) return apiName;
  return "Unbekannt";
}

/* ---------- Verein aus statistics -------------------------------------
 *
 * Portiert aus pickClubFromStats() in adm-generate-kader-wm2026.html.
 *
 * Regeln:
 *   - Nationalteam-Einträge werden ignoriert (über national-Flag UND
 *     ID-Vergleich, da api-football das `national`-Flag nicht konsistent
 *     setzt).
 *   - Die WM-League selbst (league.id === competitionId) wird ignoriert.
 *   - Wenn nichts gefunden wird, "Vereinslos".
 */
export function pickClubFromStats(allStats, nationalTeamId, competitionId, seasonsTried = []) {
  if (!Array.isArray(allStats) || allStats.length === 0) {
    return { name: "Vereinslos", logo: "" };
  }

  const isClubEntry = (s) =>
    s &&
    s.team &&
    s.team.id !== nationalTeamId &&
    s.team.national !== true &&
    s.league &&
    Number(s.league.id) !== Number(competitionId);

  for (const season of seasonsTried || []) {
    const match = allStats.find((s) => isClubEntry(s) && String(s.league?.season) === String(season));
    if (match && match.team?.name) {
      return { name: match.team.name, logo: match.team.logo || "" };
    }
  }

  const firstReal = allStats.find(isClubEntry);
  if (firstReal && firstReal.team?.name) {
    return { name: firstReal.team.name, logo: firstReal.team.logo || "" };
  }

  const fallback = allStats.find(
    (s) => s && s.team && s.team.id !== nationalTeamId && s.team.national !== true,
  );
  if (fallback && fallback.team?.name) {
    return { name: fallback.team.name, logo: fallback.team.logo || "" };
  }

  return { name: "Vereinslos", logo: "" };
}

/* ---------- position-overrides.js laden ------------------------------- */

/**
 * Lädt das `position-overrides.js`-Modul aus dem Repository und liefert eine
 * Map `playerId -> normalisierte Position` für den gegebenen Turnier-Key
 * (z.B. "wm2026"). Schlägt das Parsen fehl, wird ein leeres Objekt
 * zurückgegeben (defensive Fehlerbehandlung).
 *
 * Die Datei ist als `window.POSITION_OVERRIDES = { ... };` formuliert; daher
 * wird sie hier in einer minimalen Sandbox via `new Function` ausgeführt.
 */
export function loadPositionOverrides(filePath, tournamentKey = "wm2026") {
  try {
    if (!fs.existsSync(filePath)) {
      return { overrides: {}, source: filePath, error: "not-found" };
    }
    const raw = fs.readFileSync(filePath, "utf8");
    const sandboxWindow = {};
    const fn = new Function("window", `${raw}\nreturn window;`);
    fn(sandboxWindow);
    const all = sandboxWindow.POSITION_OVERRIDES || {};
    const block = (all && typeof all === "object" && all[tournamentKey]) || {};

    const normalized = {};
    for (const [pid, pos] of Object.entries(block)) {
      const n = normalizePosition(pos);
      if (n) normalized[String(pid)] = n;
    }
    return { overrides: normalized, source: filePath, error: null };
  } catch (err) {
    return {
      overrides: {},
      source: filePath,
      error: String(err && err.message ? err.message : err),
    };
  }
}

/* ---------- Overrides anwenden + Report ------------------------------- */

/**
 * Wendet eine `playerId -> position`-Map auf eine Liste von Spieler-Datensätzen
 * an (mutiert die Einträge in place) und liefert eine Statistik:
 *   - applied:     Spieler, deren Position aktiv geändert wurde
 *   - identical:   Spieler, deren Position bereits korrekt war (no-op)
 *   - missingIds:  Override-IDs ohne passenden Spieler im aktuellen Kader
 *   - appliedDetails / noopDetails / missingDetails für Markdown-Reports
 */
export function applyPositionOverrides(playersData, overrides) {
  const overrideIds = Object.keys(overrides || {});
  const lookup = new Map(overrideIds.map((id) => [String(id), overrides[id]]));

  let applied = 0;
  let identical = 0;
  const appliedDetails = [];
  const noopDetails = [];
  const playerIdSet = new Set();

  for (const p of playersData) {
    if (!p) continue;
    const pid = p["player.id"] != null ? String(p["player.id"]) : "";
    if (!pid) continue;
    playerIdSet.add(pid);
    const target = lookup.get(pid);
    if (!target) continue;

    const current = normalizePosition(p.Position);
    if (current === target) {
      identical += 1;
      noopDetails.push({ id: pid, name: p.Spielername || "", position: target });
      continue;
    }
    const before = current || p.Position || "";
    p.Position = target;
    applied += 1;
    appliedDetails.push({ id: pid, name: p.Spielername || "", from: before, to: target });
  }

  const missingDetails = [];
  for (const id of overrideIds) {
    if (!playerIdSet.has(String(id))) {
      missingDetails.push({ id: String(id), position: overrides[id] });
    }
  }

  return {
    appliedCount: applied,
    identicalCount: identical,
    missingCount: missingDetails.length,
    totalOverrides: overrideIds.length,
    appliedDetails,
    noopDetails,
    missingDetails,
  };
}

/* ---------- Pfade ----------------------------------------------------- */

/**
 * Bestimmt das Repository-Root-Verzeichnis ausgehend von einem Script-Pfad.
 *
 * Beide WM-2026-Skripte liegen in `scripts/`, das Root liegt eine Ebene drüber.
 */
export function repoRootFromScript(scriptDir) {
  return path.resolve(scriptDir, "..");
}
