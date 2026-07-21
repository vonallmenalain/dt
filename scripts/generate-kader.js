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

// Anzeigename: API-Football liefert pro Spieler einen gebräuchlichen
// Kurznamen (`name`, z. B. "Lamine Yamal", "Vinícius Júnior", "Achraf
// Hakimi") UND den vollständigen bürgerlichen Namen (firstname+lastname,
// oft zu lang: "Lamine Yamal Nasraoui Ebana", "Vinícius José Paixão de
// Oliveira Júnior"). Für die Anzeige wird der kurze `name` bevorzugt;
// firstname+lastname dient nur als Fallback.
function firstToken(value) {
  const parts = String(value == null ? '' : value).trim().split(/\s+/).filter(Boolean);
  return parts.length ? parts[0] : '';
}

function playerDisplayName(p) {
  const firstName = String((p && p.firstname) || '').trim();
  const lastName = String((p && p.lastname) || '').trim();
  let common = String((p && p.name) || '').trim();

  // Führende Initiale ("A. Hakimi", "J. Bellingham") durch den echten
  // Vornamen ersetzen, falls vorhanden → "Achraf Hakimi", "Jude Bellingham".
  const initial = common.match(/^[A-Za-zÀ-ÖØ-öø-ÿ]\.\s+(.+)$/);
  if (initial && firstName) common = `${firstName} ${initial[1]}`.trim();

  // Kurzer, sauberer Common-Name (≤ 3 Tokens, keine Initiale) direkt nutzen:
  // deckt "Lamine Yamal", "Vinícius Júnior", "Kylian Mbappé", "Rodri" ab.
  const tokens = common ? common.split(/\s+/) : [];
  const looksAbbrev = /(^|\s)[A-Za-zÀ-ÖØ-öø-ÿ]\.(\s|$)/.test(common);
  if (common && !looksAbbrev && tokens.length >= 1 && tokens.length <= 3) {
    return common;
  }

  // Sonst "Vorname Nachname" aus erstem Vornamen- + erstem Nachnamen-Token
  // bauen (kürzt lange bürgerliche Namen wie "Lucas Rodrigues Carvalho
  // Anjos" → "Lucas Rodrigues"; spanische/arabische Mehrfachnamen wie
  // "Achraf Hakimi", "Lamine Yamal" bleiben korrekt).
  const built = [firstToken(firstName), firstToken(lastName)].filter(Boolean).join(' ').trim();
  if (built) return built;

  return common || `${firstName} ${lastName}`.trim();
}

const FLAG_BASE = 'https://media.api-sports.io/flags';

// Normalisierung für Ländernamen-Vergleiche: Diakritika entfernen, nur
// Kleinbuchstaben – so matchen "Türkiye"/"Turkiye", "Côte d'Ivoire"/
// "Cote dIvoire", "Bosnia and Herzegovina"/"Bosnia-and-Herzegovina" etc.
function normalizeCountryName(name) {
  return String(name || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z]/g, '');
}

// Bekannte Abweichungen zwischen der `nationality` aus /players und den
// Namen aus /countries – als direkte ISO2-Flag-Codes (Flag =
// flags/<code>.svg). Nur nötig, wenn der Name NICHT direkt in /countries
// gefunden wird. Schlüssel sind bereits normalisiert.
const NATION_FLAG_ALIASES = {
  turkiye: 'tr', turkey: 'tr',
  czechia: 'cz', czechrepublic: 'cz',
  korearepublic: 'kr', southkorea: 'kr', korea: 'kr',
  northkorea: 'kp', koreadpr: 'kp',
  cotedivoire: 'ci', ivorycoast: 'ci',
  usa: 'us', unitedstates: 'us', unitedstatesofamerica: 'us',
  unitedkingdom: 'gb', uk: 'gb',
  bosniaandherzegovina: 'ba', bosnia: 'ba',
  drcongo: 'cd', congodr: 'cd', democraticrepublicofthecongo: 'cd',
  capeverdeislands: 'cv', capeverde: 'cv',
  russia: 'ru',
  // Aus dem cl2526-Lauf als unauflösbar geloggt:
  mozambique: 'mz',
  centralafricanrepublic: 'cf',
  northmacedonia: 'mk', macedonia: 'mk',
  republicofireland: 'ie', ireland: 'ie',
  guineabissau: 'gw'
};

// Ländername (nationality) → Flaggen-URL. Reihenfolge: 1) direkter Treffer
// in der /countries-Map (autoritative Flag-URL des Anbieters), 2) kuratierter
// ISO2-Alias, 3) nicht auflösbar → in `unmatched` merken (wird am Ende
// geloggt, damit fehlende Aliasse für die 26/27-Saison ergänzt werden können).
function resolveNationFlag(nationality, flagMap, unmatched) {
  const norm = normalizeCountryName(nationality);
  if (!norm) return '';
  if (flagMap && flagMap.has(norm)) return flagMap.get(norm);
  if (NATION_FLAG_ALIASES[norm]) return `${FLAG_BASE}/${NATION_FLAG_ALIASES[norm]}.svg`;
  if (unmatched && nationality) unmatched.add(String(nationality));
  return '';
}

// Baut den (turnier-agnostischen, club-zentrierten) Spieler-Datensatz aus
// einem API-Football-Player + der gewählten Wettbewerbs-Statistik. Rein und
// nebenwirkungsfrei (bis auf das optionale `unmatched`-Set) → unit-testbar.
function buildRecord(p, stat, flagMap, unmatched) {
  const team = (stat && stat.team) || {};
  const position = mapPosition(stat && stat.games && stat.games.position);
  return {
    'player.id': p.id,
    'Spielername': playerDisplayName(p),
    'Spielerfoto': p.photo || '',
    'Position': position,
    // CLUB primär (bei der CL der Verein aus der Wettbewerbs-Statistik).
    'Club.name': team.name || '',
    'Club.logo': team.logo || '',
    // Nation sekundär: Name aus der Nationalität, Flagge aus /countries.
    'Nationalteam.name': p.nationality || '',
    'Nationalteam.logo': resolveNationFlag(p.nationality, flagMap, unmatched),
    'Geburtsdatum': (p.birth && p.birth.date) || '',
    'Groesse': numericOnly(p.height),
    'Gewicht': numericOnly(p.weight)
  };
}

// Ländername → Flaggen-URL aus dem /countries-Endpoint (autoritative Quelle
// des Anbieters). Bei Fehlern leere Map (Flaggen bleiben dann leer, statt
// den ganzen Lauf abzubrechen).
async function fetchCountryFlagMap(apiKey) {
  try {
    const json = await fetchJson(`https://${API_HOST}/countries`, apiKey);
    const resp = Array.isArray(json.response) ? json.response : [];
    const map = new Map();
    for (const c of resp) {
      if (!c || !c.name) continue;
      const flag = c.flag || (c.code ? `${FLAG_BASE}/${String(c.code).toLowerCase()}.svg` : '');
      if (flag) map.set(normalizeCountryName(c.name), flag);
    }
    return map;
  } catch (err) {
    logWarn(`/countries konnte nicht geladen werden (${err.message}) – Nationenflaggen bleiben leer.`);
    return new Map();
  }
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

  // Nationenflaggen (autoritative URLs aus /countries) einmalig laden.
  const flagMap = await fetchCountryFlagMap(apiKey);
  logInfo(`Nationenflaggen aus /countries: ${flagMap.size} Länder.`);
  const unmatchedNations = new Set();

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

      const record = buildRecord(p, stat, flagMap, unmatchedNations);

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
  const withFlag = players.filter((p) => p['Nationalteam.logo']).length;
  logInfo(`Fertig: ${players.length} Spieler aus ${clubs.size} Klubs.`);
  logInfo(`Nationenflaggen gesetzt: ${withFlag}/${players.length} Spieler.`);
  if (unmatchedNations.size) {
    logWarn(
      `Ohne Flagge (Nationalität nicht aufgelöst, ggf. Alias in ` +
      `NATION_FLAG_ALIASES ergänzen): ${Array.from(unmatchedNations).sort().join(', ')}`
    );
  }

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

if (require.main === module) {
  main().catch((err) => {
    console.error(`[generate-kader] ❌ ${err && err.stack ? err.stack : err}`);
    process.exit(1);
  });
}

// Pure Helfer für Unit-Tests (scripts/test-generate-kader.js). Der CLI-Lauf
// oben wird durch die require.main-Guard nicht ausgelöst, wenn diese Datei
// nur importiert wird.
module.exports = {
  buildRecord,
  playerDisplayName,
  resolveNationFlag,
  normalizeCountryName,
  fetchCountryFlagMap,
  mapPosition,
  NATION_FLAG_ALIASES,
  FLAG_BASE
};
