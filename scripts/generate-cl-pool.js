'use strict';

/* =============================================================================
 *  generate-cl-pool.js
 *
 *  VORSCHAU-Spielerpool für eine Champions-League-Saison, deren Ligaphasen-
 *  Auslosung noch NICHT stattgefunden hat (CL 2026/27: Auslosung Ende
 *  August 2026, Kadermeldungen erst Anfang September).
 *
 *  Warum ein eigener Generator?
 *  ---------------------------------------------------------------------------
 *  `generate-kader.js` liest `/players?league=<comp>&season=<saison>` – also
 *  Spieler, die im Wettbewerb bereits EINSÄTZE hatten. Für eine abgeschlossene
 *  Saison (cl2526) ist das ideal, für eine noch nicht gestartete Saison
 *  liefert es NICHTS. Dieses Script dreht die Richtung um:
 *
 *      qualifizierte Klubs  →  aktueller Kader je Klub  →  Spielerprofile
 *
 *  Quelle für „qualifiziert": die Abschlusstabellen der nationalen Ligen der
 *  VORSAISON. api-football hängt an jede Tabellenzeile eine `description`
 *  (z. B. „Promotion - Champions League (League Phase: )"). Daraus lässt sich
 *  ableiten, wer DIREKT in der Ligaphase steht und wer nur in die
 *  Qualifikation geht – letztere zählen (noch) nicht zum Pool. Dazu kommen
 *  die Titelverteidiger (CL- und Europa-League-Sieger der Vorsaison), die
 *  gesetzt sind.
 *
 *  Namenslogik: bewusst KEINE zweite Implementierung. `buildRecord`,
 *  `playerDisplayName`, `resolveNationFlag`, `mapPosition` und die
 *  Sortierreihenfolge werden 1:1 aus generate-kader.js importiert. Ein
 *  Spieler, der schon in data-cl2526.js steht, erscheint deshalb hier mit
 *  identischem `Spielername`, identischer Position und identischem Schema.
 *
 *  Aufruf (i. d. R. via GitHub-Actions-Workflow generate-cl-pool.yml):
 *    TOURNAMENT_KEY=cl2627 RAPIDAPI_KEY=… node generate-cl-pool.js
 *
 *  Env-Variablen:
 *    TOURNAMENT_KEY   Turnier-Key aus tournament-config.js (Default cl2627).
 *    RAPIDAPI_KEY     api-football Key (zwingend).
 *    SOURCE_SEASON    Saison der nationalen Ligatabellen, aus denen die
 *                     Qualifikation abgeleitet wird. Default: Turnier-Saison
 *                     minus 1 (cl2627 → 2025 = Spielzeit 2025/26).
 *    PROBE            `1`: nur Klub-Ermittlung + Logs, keine Kader-Calls,
 *                     keine Dateien. Für den ersten Blick auf die API.
 *    SQUAD_DELAY_MS   Pause zwischen Spieler-Calls (Default 180 ms).
 *    MAX_TEAMS        Debug-Limit auf die ersten N Klubs (0 = alle).
 *    SKIP_INCOMPLETE  `1`: Spieler ohne Stammdaten bei api-football (kein
 *                     Geburtsdatum, keine Nationalität – meist Nachwuchs)
 *                     verwerfen. Default aus, weil data-cl2526.js solche
 *                     Einträge ebenfalls enthält.
 *
 *  Ausgabe:
 *    ../data-<key>.js            Spielerpool im bestehenden Schema.
 *    ./cl-pool-<key>-clubs.json  Nachvollziehbare Herleitung je Klub.
 *
 *  Manuelle Korrektur (optional, wird eingelesen wenn vorhanden):
 *    ./cl-pool-<key>-clubs.manual.json
 *      { "add": [{ "id": 529, "name": "Barcelona", "note": "…" }],
 *        "remove": [ 123, 456 ] }
 *
 *  Idempotent: gleiche Eingangslage → gleiche Datei (stabile Sortierung).
 * ============================================================================= */

const fs = require('node:fs');
const path = require('node:path');

const APP_CONFIG = require('../tournament-config.js');
const {
  buildRecord,
  fetchCountryFlagMap,
  normalizeCountryName,
  fetchJson,
  delay,
  API_HOST,
  POSITION_ORDER
} = require('./generate-kader.js');

const DEFAULT_TOURNAMENT_KEY = 'cl2627';
const DEFAULT_SQUAD_DELAY_MS = 180;   // ≈ 330 Requests/Minute – unter dem Ultra-Limit
const LEAGUE_DELAY_MS = 120;

function logInfo(msg) { console.log(`[generate-cl-pool] ${msg}`); }
function logWarn(msg) { console.warn(`[generate-cl-pool] ⚠️ ${msg}`); }

function envFlag(name) {
  const v = String(process.env[name] || '').trim().toLowerCase();
  return v === '1' || v === 'true' || v === 'yes' || v === 'on';
}

function envInt(name, fallback) {
  const raw = String(process.env[name] || '').trim();
  if (!raw) return fallback;
  const n = Number.parseInt(raw, 10);
  return Number.isFinite(n) ? n : fallback;
}

/* ─────────────────────────────────────────────────────────────────────────────
 *  UEFA-Mitgliedsverbände
 *
 *  Nur Ligen aus diesen Ländern werden auf CL-Startplätze abgeklopft. Ohne
 *  diesen Filter würden auch AFC/CAF/CONCACAF-„Champions League"-Einträge
 *  aus anderen Konföderationen matchen. Der Vergleich läuft über
 *  `normalizeCountryName` (klein, ohne Diakritika/Sonderzeichen), damit
 *  Schreibweisen wie „Czech-Republic" oder „Türkiye" mit abgedeckt sind.
 * ───────────────────────────────────────────────────────────────────────────── */
const UEFA_ASSOCIATIONS = [
  'Albania', 'Andorra', 'Armenia', 'Austria', 'Azerbaijan', 'Belarus', 'Belgium',
  'Bosnia and Herzegovina', 'Bosnia', 'Bulgaria', 'Croatia', 'Cyprus',
  'Czech Republic', 'Czechia', 'Denmark', 'England', 'Estonia', 'Faroe Islands',
  'Finland', 'France', 'Georgia', 'Germany', 'Gibraltar', 'Greece', 'Hungary',
  'Iceland', 'Ireland', 'Republic of Ireland', 'Israel', 'Italy', 'Kazakhstan',
  'Kosovo', 'Latvia', 'Liechtenstein', 'Lithuania', 'Luxembourg', 'Malta',
  'Moldova', 'Monaco', 'Montenegro', 'Netherlands', 'North Macedonia',
  'Macedonia', 'Northern Ireland', 'Norway', 'Poland', 'Portugal', 'Romania',
  'Russia', 'San Marino', 'Scotland', 'Serbia', 'Slovakia', 'Slovenia', 'Spain',
  'Sweden', 'Switzerland', 'Turkey', 'Türkiye', 'Ukraine', 'Wales'
];

// Dieselbe Normalisierung wie bei den Nationenflaggen (generate-kader.js):
// klein, ohne Diakritika und Sonderzeichen. So matchen „Czech-Republic",
// „Türkiye" oder „Bosnia and Herzegovina" unabhängig von der Schreibweise.
const UEFA_SET = new Set(UEFA_ASSOCIATIONS.map(normalizeCountryName));

/* ─────────────────────────────────────────────────────────────────────────────
 *  Women's Champions League ausschliessen
 *
 *  Die Frauenligen laufen bei api-football unter demselben Ländernamen und
 *  tragen in den Tabellen ebenfalls „Champions League"-Beschreibungen. Ohne
 *  Filter landen Arsenal W, Bayern Munich W, Roma W & Co. im Pool.
 *
 *  Drei unabhängige Netze, weil kein einzelnes alles fängt:
 *    1. Ligaame  – „FA WSL", „Serie A Women", „Frauen Bundesliga", …
 *    2. Beschreibung – „Promotion - Champions League Women (League phase)".
 *    3. Teamname – api-football hängt an Frauenteams ein „ W" an
 *       („Brann W"). Das fängt Ligen ohne Marker im Namen (Toppserien,
 *       Kansallinen Liiga).
 *  Rein & nebenwirkungsfrei → unit-testbar.
 * ───────────────────────────────────────────────────────────────────────────── */
const WOMENS_MARKERS = /women|\bwsl\b|femen|femin|frauen|damen|kvinde|damallsvenskan/i;

function isWomensEntry(leagueName, description, teamName) {
  if (WOMENS_MARKERS.test(String(leagueName || ''))) return true;
  if (WOMENS_MARKERS.test(String(description || ''))) return true;
  const team = String(teamName || '').trim();
  if (WOMENS_MARKERS.test(team)) return true;
  return /\sW$/.test(team);
}

/* ─────────────────────────────────────────────────────────────────────────────
 *  Tabellen-Beschreibung klassifizieren
 *
 *  api-football hängt an Tabellenzeilen Texte wie
 *    „Promotion - Champions League (League Phase: )"
 *    „Promotion - Champions League (Qualification: )"
 *    „Promotion - UEFA Champions League (Group Stage: )"
 *  Wir brauchen die Unterscheidung DIREKT-in-die-Ligaphase vs. nur
 *  Qualifikationsrunde: nur Erstere sind heute schon fix qualifiziert.
 *
 *  Rückgabe: 'league-phase' | 'qualifying' | null (kein CL-Bezug).
 *  Rein & nebenwirkungsfrei → unit-testbar (test-generate-cl-pool.js).
 * ───────────────────────────────────────────────────────────────────────────── */
function classifyClDescription(description) {
  const text = String(description || '');
  if (!text) return null;
  if (!/champions\s*league/i.test(text)) return null;
  // Andere Konföderationen sicherheitshalber ausschliessen (falls doch mal
  // eine nicht-UEFA-Liga durch den Länderfilter rutscht).
  if (/\b(afc|caf|concacaf|conmebol|ofc|asian|african)\b/i.test(text)) return null;
  if (/qualif|preliminar|vorrunde/i.test(text)) return 'qualifying';
  // „Play-off(s)" ohne „League Phase" ist die Qualifikations-Playoffrunde.
  if (/play[\s-]*offs?/i.test(text) && !/league\s*phase|group\s*stage/i.test(text)) {
    return 'qualifying';
  }
  return 'league-phase';
}

/* ─────────────────────────────────────────────────────────────────────────────
 *  Turnier auflösen
 * ───────────────────────────────────────────────────────────────────────────── */
function resolveTournament(key) {
  const tournaments = APP_CONFIG.tournaments || {};
  const t = tournaments[key];
  if (!t) {
    throw new Error(`Unbekannter TOURNAMENT_KEY "${key}". Bekannt: ${Object.keys(tournaments).join(', ')}`);
  }
  const competitionId = t.api && t.api.competitionId;
  if (competitionId == null || competitionId === '') {
    throw new Error(`Für "${key}" ist keine api.competitionId gesetzt.`);
  }
  const season = String((t.api && t.api.season) || t.year || '');
  if (!/^\d{4}$/.test(season)) {
    throw new Error(`Für "${key}" ist keine vierstellige api.season gesetzt (gelesen: "${season}").`);
  }
  return {
    key,
    competitionId,
    season,
    teamCount: (t.leaguePhase && t.leaguePhase.teamCount) || null,
    dataFile: t.dataFile || `data-${key}.js`
  };
}

/* ─────────────────────────────────────────────────────────────────────────────
 *  Schritt 1: Kandidaten-Ligen (nationale Ligen der UEFA-Verbände)
 * ───────────────────────────────────────────────────────────────────────────── */
async function fetchUefaLeagues(sourceSeason, apiKey) {
  const url = `https://${API_HOST}/leagues?type=League&season=${sourceSeason}`;
  const json = await fetchJson(url, apiKey);
  const resp = Array.isArray(json.response) ? json.response : [];
  const leagues = [];
  for (const entry of resp) {
    const league = entry && entry.league;
    const country = entry && entry.country;
    if (!league || league.id == null || !country) continue;
    if (!UEFA_SET.has(normalizeCountryName(country.name))) continue;
    // Nur Ligen, für die der Anbieter Tabellen führt – sonst ist der
    // /standings-Call garantiert leer.
    const seasons = Array.isArray(entry.seasons) ? entry.seasons : [];
    const match = seasons.find((s) => String(s && s.year) === String(sourceSeason));
    if (match && match.coverage && match.coverage.standings === false) continue;
    leagues.push({ id: league.id, name: league.name, country: country.name });
  }
  leagues.sort((a, b) => a.id - b.id);
  return leagues;
}

/* ─────────────────────────────────────────────────────────────────────────────
 *  Schritt 2: Tabellen scannen → CL-Startplätze
 * ───────────────────────────────────────────────────────────────────────────── */
async function fetchClubsFromStandings(leagues, sourceSeason, apiKey) {
  const direct = new Map();      // teamId -> { id, name, logo, country, via }
  const qualifying = [];         // nur zur Info/Logging
  const womens = [];             // aussortierte Frauen-Wettbewerbe (Logging)
  let scanned = 0;

  for (const league of leagues) {
    scanned++;
    let json;
    try {
      json = await fetchJson(
        `https://${API_HOST}/standings?league=${league.id}&season=${sourceSeason}`,
        apiKey
      );
    } catch (err) {
      logWarn(`Tabelle für ${league.country} / ${league.name} (${league.id}) nicht ladbar: ${err.message}`);
      await delay(LEAGUE_DELAY_MS);
      continue;
    }

    const resp = Array.isArray(json.response) ? json.response : [];
    for (const leagueObj of resp) {
      const groups = (leagueObj && leagueObj.league && leagueObj.league.standings) || [];
      for (const group of groups) {
        for (const row of (group || [])) {
          if (!row || !row.team || row.team.id == null) continue;
          const kind = classifyClDescription(row.description);
          if (!kind) continue;
          const via =
            `${league.country} / ${league.name} – Rang ${row.rank} ` +
            `(${String(row.description || '').trim()})`;
          if (isWomensEntry(league.name, row.description, row.team.name)) {
            womens.push({ id: row.team.id, name: row.team.name, via });
            continue;
          }
          if (kind === 'qualifying') {
            qualifying.push({ id: row.team.id, name: row.team.name, via });
            continue;
          }
          if (!direct.has(row.team.id)) {
            direct.set(row.team.id, {
              id: row.team.id,
              name: row.team.name,
              logo: row.team.logo || '',
              country: league.country,
              via
            });
          }
        }
      }
    }
    await delay(LEAGUE_DELAY_MS);
    if (scanned % 25 === 0) {
      logInfo(`… ${scanned}/${leagues.length} Tabellen geprüft, bisher ${direct.size} Ligaphasen-Klubs`);
    }
  }

  return { direct, qualifying, womens };
}

/* ─────────────────────────────────────────────────────────────────────────────
 *  Schritt 3: Titelverteidiger (CL- und EL-Sieger der Vorsaison)
 *
 *  Beide sind für die Ligaphase gesetzt – unabhängig davon, wie sie national
 *  abgeschnitten haben. Ermittelt aus dem Endspiel der Vorsaison.
 * ───────────────────────────────────────────────────────────────────────────── */
function pickFinalWinner(fixtures) {
  const finals = (fixtures || []).filter((f) => {
    const round = String((f && f.league && f.league.round) || '');
    if (!/final/i.test(round)) return false;
    if (/semi|quarter|1\/8|1\/4|round of/i.test(round)) return false;
    const short = String((f.fixture && f.fixture.status && f.fixture.status.short) || '');
    return short === 'FT' || short === 'AET' || short === 'PEN';
  });
  if (!finals.length) return null;
  finals.sort((a, b) => {
    const ta = (a.fixture && a.fixture.timestamp) || 0;
    const tb = (b.fixture && b.fixture.timestamp) || 0;
    return tb - ta;
  });
  const final = finals[0];
  const home = final.teams && final.teams.home;
  const away = final.teams && final.teams.away;
  if (home && home.winner === true) return home;
  if (away && away.winner === true) return away;
  return null;
}

async function fetchTitleHolder(competitionId, label, sourceSeason, apiKey) {
  try {
    const json = await fetchJson(
      `https://${API_HOST}/fixtures?league=${competitionId}&season=${sourceSeason}`,
      apiKey
    );
    const winner = pickFinalWinner(Array.isArray(json.response) ? json.response : []);
    if (!winner) {
      logWarn(`${label}-Sieger ${sourceSeason} nicht ermittelbar (kein beendetes Endspiel gefunden).`);
      return null;
    }
    return {
      id: winner.id,
      name: winner.name,
      logo: winner.logo || '',
      country: '',
      via: `Titelverteidiger: Sieger ${label} ${sourceSeason}/${String(Number(sourceSeason) + 1).slice(-2)}`
    };
  } catch (err) {
    logWarn(`${label}-Sieger ${sourceSeason} nicht ermittelbar: ${err.message}`);
    return null;
  }
}

/* ─────────────────────────────────────────────────────────────────────────────
 *  Schritt 4: Manuelle Korrekturen
 * ───────────────────────────────────────────────────────────────────────────── */
function applyManualOverrides(clubs, manualPath) {
  if (!fs.existsSync(manualPath)) return clubs;
  let manual;
  try {
    manual = JSON.parse(fs.readFileSync(manualPath, 'utf8'));
  } catch (err) {
    logWarn(`${path.basename(manualPath)} ist kein gültiges JSON (${err.message}) – wird ignoriert.`);
    return clubs;
  }
  const removeIds = new Set((manual.remove || []).map(Number));
  const kept = clubs.filter((c) => !removeIds.has(Number(c.id)));
  const removed = clubs.length - kept.length;

  const known = new Set(kept.map((c) => Number(c.id)));
  let added = 0;
  for (const entry of (manual.add || [])) {
    if (!entry || entry.id == null || known.has(Number(entry.id))) continue;
    kept.push({
      id: Number(entry.id),
      name: entry.name || `Team ${entry.id}`,
      logo: entry.logo || '',
      country: entry.country || '',
      via: `manuell ergänzt${entry.note ? `: ${entry.note}` : ''}`
    });
    known.add(Number(entry.id));
    added++;
  }
  if (added || removed) {
    logInfo(`Manuelle Korrekturen aus ${path.basename(manualPath)}: +${added} / −${removed}.`);
  }
  return kept;
}

/* ─────────────────────────────────────────────────────────────────────────────
 *  Schritt 5: Kader + Spielerprofile
 * ───────────────────────────────────────────────────────────────────────────── */
async function fetchSquad(teamId, apiKey) {
  const json = await fetchJson(`https://${API_HOST}/players/squads?team=${teamId}`, apiKey);
  const resp = Array.isArray(json.response) ? json.response : [];
  const first = resp[0] || {};
  return {
    team: first.team || null,
    players: Array.isArray(first.players) ? first.players : []
  };
}

// `/players/profiles` liefert den vollständigen Spieler (firstname, lastname,
// name, birth, nationality, height, weight, photo) – exakt die Felder, aus
// denen playerDisplayName/buildRecord den Datensatz bauen. Fällt der Endpunkt
// aus (Plan/Abdeckung), wird einmalig auf `/players?id=…&season=…`
// umgeschaltet; beide liefern dasselbe Spieler-Objekt, die Namenslogik bleibt
// also identisch.
let profilesEndpointOk = true;

async function fetchPlayerProfile(playerId, sourceSeason, apiKey) {
  if (profilesEndpointOk) {
    try {
      const json = await fetchJson(`https://${API_HOST}/players/profiles?player=${playerId}`, apiKey);
      const resp = Array.isArray(json.response) ? json.response : [];
      const player = resp[0] && resp[0].player;
      if (player && player.id != null) return player;
      // Leere Antwort ist kein Endpunkt-Ausfall – nur dieser Spieler fehlt.
    } catch (err) {
      logWarn(`/players/profiles nicht nutzbar (${err.message}) – wechsle auf /players?id=…`);
      profilesEndpointOk = false;
    }
  }
  try {
    const json = await fetchJson(
      `https://${API_HOST}/players?id=${playerId}&season=${sourceSeason}`,
      apiKey
    );
    const resp = Array.isArray(json.response) ? json.response : [];
    const player = resp[0] && resp[0].player;
    if (player && player.id != null) return player;
  } catch (err) {
    logWarn(`Profil für Spieler ${playerId} nicht ladbar: ${err.message}`);
  }
  return null;
}

// Aus Kader-Eintrag + Klub den „statistics"-Ausschnitt bauen, den
// buildRecord erwartet. Dadurch kommt der Klub garantiert vom qualifizierten
// Verein (und nicht aus irgendeiner Wettbewerbs-Statistik des Spielers).
function statFromSquadEntry(team, entry) {
  return {
    team: { id: team.id, name: team.name || '', logo: team.logo || '' },
    games: { position: (entry && entry.position) || '' }
  };
}

// Degradierter Datensatz, falls kein Profil ladbar war: Kader-Eintrag hat
// name/photo/position, aber weder Geburtsdatum noch Nationalität.
function recordFromSquadEntryOnly(team, entry, flagMap, unmatched) {
  return buildRecord(
    {
      id: entry.id,
      name: entry.name || '',
      firstname: '',
      lastname: '',
      photo: entry.photo || '',
      nationality: '',
      birth: {},
      height: '',
      weight: ''
    },
    statFromSquadEntry(team, entry),
    flagMap,
    unmatched
  );
}

/* ─────────────────────────────────────────────────────────────────────────────
 *  Hauptlauf
 * ───────────────────────────────────────────────────────────────────────────── */
async function main() {
  const key = (process.env.TOURNAMENT_KEY || DEFAULT_TOURNAMENT_KEY).trim();
  const apiKey = process.env.RAPIDAPI_KEY;
  if (!apiKey) throw new Error('RAPIDAPI_KEY ist nicht gesetzt.');

  const t = resolveTournament(key);
  const sourceSeason = String(
    process.env.SOURCE_SEASON || (Number(t.season) - 1)
  ).trim();
  const probe = envFlag('PROBE');
  const skipIncomplete = envFlag('SKIP_INCOMPLETE');
  const squadDelay = envInt('SQUAD_DELAY_MS', DEFAULT_SQUAD_DELAY_MS);
  const maxTeams = envInt('MAX_TEAMS', 0);

  logInfo(`Turnier "${t.key}" (league=${t.competitionId}, Saison ${t.season}) → ${t.dataFile}`);
  logInfo(`Qualifikation abgeleitet aus den Ligatabellen der Saison ${sourceSeason}.`);
  if (probe) logInfo('PROBE-Modus: nur Klub-Ermittlung, keine Kader-Calls, keine Dateien.');

  /* ── Kandidaten-Ligen ───────────────────────────────────────────────── */
  const leagues = await fetchUefaLeagues(sourceSeason, apiKey);
  logInfo(`Nationale Ligen in UEFA-Verbänden (Saison ${sourceSeason}): ${leagues.length}`);

  /* ── Tabellen scannen ───────────────────────────────────────────────── */
  const { direct, qualifying, womens } = await fetchClubsFromStandings(leagues, sourceSeason, apiKey);
  logInfo(`Direkt für die Ligaphase qualifiziert (aus Tabellen): ${direct.size}`);
  for (const c of Array.from(direct.values()).sort((a, b) => a.via.localeCompare(b.via, 'de'))) {
    logInfo(`  ✓ ${c.name} (${c.id}) – ${c.via}`);
  }
  if (qualifying.length) {
    logInfo(`Nur Qualifikationsrunde (noch NICHT im Pool): ${qualifying.length}`);
    for (const c of qualifying.sort((a, b) => a.via.localeCompare(b.via, 'de'))) {
      logInfo(`  · ${c.name} (${c.id}) – ${c.via}`);
    }
  }
  if (womens.length) {
    logInfo(`Women's Champions League (nicht Teil dieses Turniers): ${womens.length} aussortiert`);
    for (const c of womens.sort((a, b) => a.via.localeCompare(b.via, 'de'))) {
      logInfo(`  ✗ ${c.name} (${c.id}) – ${c.via}`);
    }
  }

  /* ── Titelverteidiger ───────────────────────────────────────────────── */
  const holders = [];
  const cl = await fetchTitleHolder(t.competitionId, 'Champions League', sourceSeason, apiKey);
  if (cl) holders.push(cl);
  const el = await fetchTitleHolder(3, 'Europa League', sourceSeason, apiKey);
  if (el) holders.push(el);
  for (const h of holders) {
    if (direct.has(h.id)) {
      logInfo(`  ↺ ${h.name} (${h.id}) – ${h.via} (bereits über die Liga qualifiziert)`);
      continue;
    }
    direct.set(h.id, h);
    logInfo(`  ✓ ${h.name} (${h.id}) – ${h.via}`);
  }

  /* ── Manuelle Korrekturen ───────────────────────────────────────────── */
  const manualPath = path.join(__dirname, `cl-pool-${t.key}-clubs.manual.json`);
  let clubs = applyManualOverrides(Array.from(direct.values()), manualPath);
  clubs.sort((a, b) => (a.name || '').localeCompare(b.name || '', 'de'));

  logInfo(`Klubs im Vorschau-Pool: ${clubs.length}`);
  if (t.teamCount) {
    const open = t.teamCount - clubs.length;
    logInfo(
      open > 0
        ? `Noch offen (Qualifikationsrunden): ${open} von ${t.teamCount} Startplätzen.`
        : `Alle ${t.teamCount} Startplätze abgedeckt.`
    );
  }

  if (probe) {
    logInfo('PROBE beendet – keine Dateien geschrieben.');
    return;
  }

  /* ── Kader je Klub ──────────────────────────────────────────────────── */
  const flagMap = await fetchCountryFlagMap(apiKey);
  logInfo(`Nationenflaggen aus /countries: ${flagMap.size} Länder.`);
  const unmatchedNations = new Set();

  const targets = maxTeams > 0 ? clubs.slice(0, maxTeams) : clubs;
  if (maxTeams > 0) logWarn(`MAX_TEAMS=${maxTeams}: nur die ersten ${targets.length} Klubs werden geladen.`);

  const byId = new Map();
  const degraded = [];
  const incomplete = [];
  const emptySquads = [];

  for (let i = 0; i < targets.length; i++) {
    const club = targets[i];
    let squad;
    try {
      squad = await fetchSquad(club.id, apiKey);
    } catch (err) {
      logWarn(`Kader von ${club.name} (${club.id}) nicht ladbar: ${err.message}`);
      emptySquads.push(club.name);
      continue;
    }
    // Klubname/Logo aus dem Kader-Endpunkt bevorzugen (dieselbe Schreibweise
    // wie in data-cl2526.js, das die Teamdaten ebenfalls von api-football hat).
    const team = squad.team && squad.team.id != null
      ? { id: squad.team.id, name: squad.team.name || club.name, logo: squad.team.logo || club.logo }
      : { id: club.id, name: club.name, logo: club.logo };

    if (!squad.players.length) {
      logWarn(`Kader von ${team.name} (${team.id}) ist leer.`);
      emptySquads.push(team.name);
      continue;
    }

    let added = 0;
    for (const entry of squad.players) {
      if (!entry || entry.id == null) continue;
      if (byId.has(entry.id)) continue;      // Spieler bereits über einen anderen Klub erfasst
      await delay(squadDelay);
      const profile = await fetchPlayerProfile(entry.id, sourceSeason, apiKey);
      let record;
      if (profile) {
        record = buildRecord(profile, statFromSquadEntry(team, entry), flagMap, unmatchedNations);
        if (!record['Spielerfoto'] && entry.photo) record['Spielerfoto'] = entry.photo;
      } else {
        record = recordFromSquadEntryOnly(team, entry, flagMap, unmatchedNations);
        degraded.push(`${record['Spielername']} (${entry.id}, ${team.name})`);
      }
      // Nachwuchs-/Reservespieler, zu denen api-football keinerlei Stammdaten
      // führt: abgekürzter Name, keine Nationalität, kein Geburtsdatum.
      // data-cl2526.js enthält solche Einträge ebenfalls (70 von 1131), daher
      // bleiben sie per Default drin – SKIP_INCOMPLETE=1 wirft sie raus.
      if (!record['Geburtsdatum'] && !record['Nationalteam.name']) {
        incomplete.push(`${record['Spielername']} (${entry.id}, ${team.name})`);
        if (skipIncomplete) continue;
      }
      byId.set(entry.id, record);
      added++;
    }
    logInfo(`[${i + 1}/${targets.length}] ${team.name}: ${added} Spieler (gesamt ${byId.size}).`);
  }

  /* ── Sortieren & schreiben ──────────────────────────────────────────── */
  const players = Array.from(byId.values()).sort((a, b) => {
    const ca = (a['Club.name'] || '').localeCompare(b['Club.name'] || '', 'de');
    if (ca !== 0) return ca;
    const pa = POSITION_ORDER[a.Position] - POSITION_ORDER[b.Position];
    if (pa !== 0) return pa;
    return (a.Spielername || '').localeCompare(b.Spielername || '', 'de');
  });

  const clubNames = Array.from(new Set(players.map((p) => p['Club.name']).filter(Boolean))).sort(
    (a, b) => a.localeCompare(b, 'de')
  );
  const withFlag = players.filter((p) => p['Nationalteam.logo']).length;

  logInfo(`Fertig: ${players.length} Spieler aus ${clubNames.length} Klubs.`);
  logInfo(`Nationenflaggen gesetzt: ${withFlag}/${players.length} Spieler.`);
  if (degraded.length) {
    logWarn(`Ohne Spielerprofil (nur Kaderdaten): ${degraded.length} – ${degraded.slice(0, 20).join(', ')}${degraded.length > 20 ? ' …' : ''}`);
  }
  if (incomplete.length) {
    logWarn(
      `Ohne Stammdaten bei api-football (kein Geburtsdatum, keine Nationalität – ` +
      `meist Nachwuchsspieler): ${incomplete.length} ` +
      `${skipIncomplete ? 'verworfen (SKIP_INCOMPLETE=1)' : 'behalten (SKIP_INCOMPLETE=1 wirft sie raus)'}.`
    );
    logWarn(`  ${incomplete.join(', ')}`);
  }
  if (emptySquads.length) {
    logWarn(`Klubs ohne Kaderdaten: ${emptySquads.join(', ')}`);
  }
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
    ` *  AUTO-GENERIERT von scripts/generate-cl-pool.js – nicht von Hand editieren.\n` +
    ` *  Turnier: ${t.key} (league=${t.competitionId}, Saison ${t.season}).\n` +
    ` *\n` +
    ` *  VORSCHAU-STAND vor der Ligaphasen-Auslosung: enthält die aktuellen Kader\n` +
    ` *  der bereits fix qualifizierten Klubs (abgeleitet aus den Abschluss-\n` +
    ` *  tabellen der Saison ${sourceSeason} plus Titelverteidiger). Klubs aus den\n` +
    ` *  Qualifikationsrunden fehlen noch und kommen mit einem erneuten Lauf dazu.\n` +
    ` *\n` +
    ` *  Spieler: ${players.length} aus ${clubNames.length} Klubs.\n` +
    ` *  Klubs: ${clubNames.join(', ')}.\n` +
    ` *  Club-zentriert: Club.* = Vereinsdaten (primär), Nationalteam.* = Nation (sekundär).\n` +
    ` * ============================================================================= */\n`;
  fs.writeFileSync(outPath, `${banner}const playersData = ${JSON.stringify(players, null, 2)};\n`, 'utf8');
  logInfo(`Geschrieben: ${outPath}`);

  const clubsPath = path.join(__dirname, `cl-pool-${t.key}-clubs.json`);
  const clubsDoc = {
    tournament: t.key,
    season: t.season,
    sourceSeason,
    clubCount: clubs.length,
    playerCount: players.length,
    openSlots: t.teamCount ? Math.max(0, t.teamCount - clubs.length) : null,
    clubs: clubs.map((c) => ({ id: c.id, name: c.name, country: c.country, via: c.via }))
  };
  fs.writeFileSync(clubsPath, `${JSON.stringify(clubsDoc, null, 2)}\n`, 'utf8');
  logInfo(`Geschrieben: ${clubsPath}`);
}

if (require.main === module) {
  main().catch((err) => {
    console.error(`[generate-cl-pool] ❌ ${err && err.stack ? err.stack : err}`);
    process.exit(1);
  });
}

module.exports = {
  classifyClDescription,
  isWomensEntry,
  pickFinalWinner,
  applyManualOverrides,
  statFromSquadEntry,
  UEFA_ASSOCIATIONS
};
