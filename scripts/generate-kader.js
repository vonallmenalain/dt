'use strict';

/* =============================================================================
 *  generate-kader.js
 *
 *  Turnier-agnostischer Kader-Generator. Erzeugt die statische
 *  `data-<key>.js` (globales `playersData`) aus der API-Football, passend
 *  zum aktiven Turnier laut tournament-config.js.
 *
 *  Aufruf (i. d. R. via GitHub-Actions-Workflow generate-kader.yml):
 *    TOURNAMENT_KEY=cl2526 RAPIDAPI_KEY=… node generate-kader.js
 *
 *  Datenquelle: `/players?league={competitionId}&season={season}` (alle
 *  Spieler, die im Wettbewerb Einsätze hatten – ideal für abgeschlossene
 *  Saisons wie die CL 2025/26). Paginiert über `paging.total`.
 *
 *  Mapping ins bestehende Schema (identisch zu data-wm2026.js), aber
 *  CLUB-ZENTRIERT: `Club.name`/`Club.logo` stammen aus dem Team der
 *  Wettbewerbs-Statistik (bei der CL also der Klub); `Nationalteam.name`
 *  kommt aus der Nationalität des Spielers (sekundär). So können die
 *  CL-Views den Klub in den Vordergrund stellen und die Nation sekundär
 *  zeigen – ohne ein zweites Datenschema.
 *
 *  Idempotent: schreibt eine sortierte, deterministische Datei, sodass
 *  wiederholte Läufe stabile Diffs erzeugen.
 * ============================================================================= */

const fs = require('node:fs');
const path = require('node:path');

const APP_CONFIG = require('../tournament-config.js');

const API_HOST = 'v3.football.api-sports.io';
const PAGE_DELAY_MS = 200;      // freundlich zwischen den Seiten
const MAX_RETRIES = 4;

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function logInfo(msg) { console.log(`[generate-kader] ${msg}`); }
function logWarn(msg) { console.warn(`[generate-kader] ⚠️ ${msg}`); }

function resolveTournament(key) {
  const tournaments = APP_CONFIG.tournaments || {};
  const t = tournaments[key];
  if (!t) {
    const known = Object.keys(tournaments).join(', ');
    throw new Error(`Unbekannter TOURNAMENT_KEY "${key}". Bekannt: ${known}`);
  }
  const competitionId = t.api && t.api.competitionId;
  const season = (t.api && t.api.season) || t.year;
  const competitionParam = (t.api && t.api.competitionParam) || 'league';
  if (competitionId === null || competitionId === undefined || competitionId === '') {
    throw new Error(`Für "${key}" ist keine api.competitionId gesetzt.`);
  }
  return {
    key,
    competitionParam,
    competitionId,
    season,
    dataFile: t.dataFile || `data-${key}.js`
  };
}

function buildHeaders(apiKey) {
  return { 'x-rapidapi-key': apiKey, 'x-rapidapi-host': API_HOST };
}

async function fetchJson(url, apiKey) {
  let lastErr = null;
  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      const res = await fetch(url, { headers: buildHeaders(apiKey) });
      if (res.status === 429) {
        const wait = 2000 * attempt;
        logWarn(`HTTP 429 (Rate-Limit) bei ${url} – warte ${wait}ms und versuche erneut.`);
        await delay(wait);
        continue;
      }
      if (!res.ok) throw new Error(`HTTP ${res.status} bei ${url}`);
      const json = await res.json();
      // API-Football liefert Fehler teils mit HTTP 200 im `errors`-Feld.
      const errs = json && json.errors;
      const hasErrs = errs && (Array.isArray(errs) ? errs.length : Object.keys(errs).length);
      if (hasErrs) {
        const text = JSON.stringify(errs);
        if (/rate|limit/i.test(text)) {
          const wait = 2000 * attempt;
          logWarn(`API-Rate-Limit (${text}) – warte ${wait}ms.`);
          await delay(wait);
          continue;
        }
        throw new Error(`API-Fehler bei ${url}: ${text}`);
      }
      return json;
    } catch (err) {
      lastErr = err;
      if (attempt < MAX_RETRIES) {
        const wait = 1500 * attempt;
        logWarn(`Fehler "${err.message}" – Retry in ${wait}ms (${attempt}/${MAX_RETRIES}).`);
        await delay(wait);
      }
    }
  }
  throw lastErr || new Error(`Fetch fehlgeschlagen: ${url}`);
}

function playersUrl(competitionParam, competitionId, season, page) {
  return `https://${API_HOST}/players?${competitionParam}=${competitionId}&season=${season}&page=${page}`;
}

function mapPosition(pos) {
  const p = String(pos || '').trim().toLowerCase();
  if (p.startsWith('goal')) return 'GOALKEEPER';
  if (p.startsWith('def')) return 'DEFENDER';
  if (p.startsWith('mid')) return 'MIDFIELDER';
  if (p.startsWith('att') || p.startsWith('for')) return 'ATTACKER';
  return '';
}

function numericOnly(value) {
  const s = String(value == null ? '' : value).replace(/[^0-9]/g, '');
  return s;
}

// Statistik-Eintrag des Ziel-Wettbewerbs wählen (dort steht der CL-Klub),
// sonst der erste mit gültigem Team.
function pickCompetitionStat(statistics, competitionId) {
  if (!Array.isArray(statistics) || !statistics.length) return null;
  const byLeague = statistics.find(
    (s) => s && s.league && Number(s.league.id) === Number(competitionId) && s.team && s.team.id
  );
  if (byLeague) return byLeague;
  return statistics.find((s) => s && s.team && s.team.id) || statistics[0] || null;
}

// Team-IDs der Ligaphase aus den Standings holen. Damit filtern wir die
// vielen Qualifikations-Klubs heraus, die `/players?league=…` ebenfalls
// liefert – wir wollen nur die (bei der CL) 36 Ligaphasen-Klubs.
async function fetchLeaguePhaseTeamIds(competitionId, season, apiKey) {
  try {
    const url = `https://${API_HOST}/standings?league=${competitionId}&season=${season}`;
    const json = await fetchJson(url, apiKey);
    const ids = new Set();
    const resp = Array.isArray(json.response) ? json.response : [];
    for (const leagueObj of resp) {
      const league = leagueObj && leagueObj.league;
      const groups = (league && league.standings) || [];
      for (const group of groups) {
        for (const row of (group || [])) {
          if (row && row.team && row.team.id != null) ids.add(row.team.id);
        }
      }
    }
    return ids;
  } catch (err) {
    logWarn(`Standings konnten nicht geladen werden (${err.message}) – kein Klub-Filter.`);
    return new Set();
  }
}

const POSITION_ORDER = { GOALKEEPER: 0, DEFENDER: 1, MIDFIELDER: 2, ATTACKER: 3, '': 4 };

async function main() {
  const key = (process.env.TOURNAMENT_KEY || '').trim();
  if (!key) throw new Error('TOURNAMENT_KEY ist nicht gesetzt (z. B. cl2526).');
  const apiKey = process.env.RAPIDAPI_KEY;
  if (!apiKey) throw new Error('RAPIDAPI_KEY ist nicht gesetzt.');

  const t = resolveTournament(key);
  logInfo(`Turnier "${t.key}": ${t.competitionParam}=${t.competitionId}, Saison ${t.season} → ${t.dataFile}`);

  // Ligaphasen-Klubs bestimmen (Filter gegen Qualifikations-Klubs).
  const allow = await fetchLeaguePhaseTeamIds(t.competitionId, t.season, apiKey);
  if (allow.size > 0) logInfo(`Ligaphasen-Klubs (aus Standings): ${allow.size}`);
  else logInfo('Kein Standings-Filter aktiv – alle Klubs werden aufgenommen.');

  // Seite 1 holen, um paging.total zu bestimmen.
  const firstUrl = playersUrl(t.competitionParam, t.competitionId, t.season, 1);
  const first = await fetchJson(firstUrl, apiKey);
  const totalPages = (first.paging && Number(first.paging.total)) || 1;
  logInfo(`Seiten gesamt: ${totalPages}`);

  const byId = new Map();

  function ingest(json) {
    const list = Array.isArray(json.response) ? json.response : [];
    for (const entry of list) {
      const p = entry && entry.player;
      if (!p || p.id == null) continue;
      const stat = pickCompetitionStat(entry.statistics, t.competitionId);
      const team = (stat && stat.team) || {};
      // Nur Klubs der Ligaphase (sofern Filter verfügbar).
      if (allow.size > 0 && team.id != null && !allow.has(team.id)) continue;
      const position = mapPosition(stat && stat.games && stat.games.position);

      const record = {
        'player.id': p.id,
        'Spielername': [p.firstname, p.lastname].filter(Boolean).join(' ').trim() || p.name || '',
        'Spielerfoto': p.photo || '',
        'Position': position,
        // CLUB primär (bei der CL der Verein aus der Wettbewerbs-Statistik).
        'Club.name': team.name || '',
        'Club.logo': team.logo || '',
        // Nation sekundär (Nationalität des Spielers).
        'Nationalteam.name': p.nationality || '',
        'Nationalteam.logo': '',
        'Geburtsdatum': (p.birth && p.birth.date) || '',
        'Groesse': numericOnly(p.height),
        'Gewicht': numericOnly(p.weight)
      };

      // Dedupe: bereits vorhandenen Eintrag nur ersetzen, wenn der neue
      // eine erkannte Position hat und der alte nicht.
      const existing = byId.get(p.id);
      if (!existing || (!existing.Position && record.Position)) {
        byId.set(p.id, record);
      }
    }
  }

  ingest(first);
  for (let page = 2; page <= totalPages; page++) {
    await delay(PAGE_DELAY_MS);
    const json = await fetchJson(playersUrl(t.competitionParam, t.competitionId, t.season, page), apiKey);
    ingest(json);
    if (page % 10 === 0) logInfo(`… Seite ${page}/${totalPages}, bisher ${byId.size} Spieler`);
  }

  const players = Array.from(byId.values()).sort((a, b) => {
    const ca = (a['Club.name'] || '').localeCompare(b['Club.name'] || '', 'de');
    if (ca !== 0) return ca;
    const pa = POSITION_ORDER[a.Position] - POSITION_ORDER[b.Position];
    if (pa !== 0) return pa;
    return (a.Spielername || '').localeCompare(b.Spielername || '', 'de');
  });

  const clubs = new Set(players.map((p) => p['Club.name']).filter(Boolean));
  logInfo(`Fertig: ${players.length} Spieler aus ${clubs.size} Klubs.`);

  const outPath = path.join(__dirname, '..', t.dataFile);
  const banner =
    `/* =============================================================================\n` +
    ` *  ${t.dataFile}\n` +
    ` *\n` +
    ` *  AUTO-GENERIERT von scripts/generate-kader.js – nicht von Hand editieren.\n` +
    ` *  Turnier: ${t.key} (${t.competitionParam}=${t.competitionId}, Saison ${t.season}).\n` +
    ` *  Spieler: ${players.length} aus ${clubs.size} Klubs.\n` +
    ` *  Club-zentriert: Club.* = Vereinsdaten (primär), Nationalteam.* = Nation (sekundär).\n` +
    ` * ============================================================================= */\n`;
  const body = `const playersData = ${JSON.stringify(players, null, 2)};\n`;

  fs.writeFileSync(outPath, banner + body, 'utf8');
  logInfo(`Geschrieben: ${outPath}`);
}

main().catch((err) => {
  console.error(`[generate-kader] ❌ ${err && err.stack ? err.stack : err}`);
  process.exit(1);
});
