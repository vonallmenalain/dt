/* =============================================================================
 *  scripts/lib/apiFootball.mjs
 *
 *  Schmaler Node-/ESM-fähiger API-Football-Client für Server-Side-Scripts
 *  (GitHub Actions / lokale Dry-Runs). Bewusst ohne externe Dependencies –
 *  nutzt nur den globalen `fetch` von Node 18+.
 *
 *  Verwendung:
 *      import { createApiClient } from "./lib/apiFootball.mjs";
 *      const api = createApiClient({ apiKey: process.env.API_FOOTBALL_KEY });
 *      const teams = await api.get("/teams", { league: 1, season: 2026 });
 *
 *  Wichtig:
 *  - Die Implementierung loggt NIE den API-Key.
 *  - Bei `errors`-Objekten in der API-Antwort wird ein technischer Fehler
 *    geworfen, damit das aufrufende Script einen Exit-Code 1 setzen kann.
 *  - Inkludiert ein einfaches Retry mit exponentiellem Backoff für
 *    Netzwerk- und 5xx-Fehler.
 * ============================================================================= */

const DEFAULT_HOST = "v3.football.api-sports.io";
const DEFAULT_TIMEOUT_MS = 25_000;
const DEFAULT_DELAY_MS = 180;
const DEFAULT_RETRIES = 3;

const sleep = (ms) => new Promise((r) => setTimeout(r, Math.max(0, ms)));

function buildQuery(params) {
  if (!params || typeof params !== "object") return "";
  const entries = Object.entries(params)
    .filter(([, v]) => v !== undefined && v !== null && v !== "")
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`);
  return entries.length ? `?${entries.join("&")}` : "";
}

/**
 * Bestimmt, ob die API-Antwort ein „echter" Fehler ist.
 *
 * API-Football liefert `errors` manchmal als leeres Array `[]` (kein Fehler)
 * und manchmal als Objekt mit Schlüsseln (Fehler). Beides wird hier korrekt
 * abgefangen.
 */
function hasApiErrors(data) {
  if (!data || typeof data !== "object") return false;
  const errs = data.errors;
  if (!errs) return false;
  if (Array.isArray(errs)) return errs.length > 0;
  if (typeof errs === "object") return Object.keys(errs).length > 0;
  return false;
}

function describeApiErrors(data) {
  try {
    return JSON.stringify(data?.errors || data || {});
  } catch (_e) {
    return String(data?.errors || "Unbekannter API-Fehler");
  }
}

/**
 * Erstellt einen wiederverwendbaren API-Client.
 *
 * @param {object} opts
 * @param {string} opts.apiKey                        Pflicht.
 * @param {string} [opts.host]                        v3.football.api-sports.io
 * @param {number} [opts.delayMs]                     Pause zwischen Calls (Rate-Limit).
 * @param {number} [opts.retries]                     Retries bei Netz/5xx-Fehlern.
 * @param {number} [opts.timeoutMs]                   AbortController-Timeout.
 * @param {(msg:string)=>void} [opts.logger]          Logger; default console.log.
 * @param {typeof fetch} [opts.fetchImpl]             Override für Tests.
 */
export function createApiClient(opts = {}) {
  const apiKey = String(opts.apiKey || "").trim();
  const host = opts.host || DEFAULT_HOST;
  const delayMs = Number.isFinite(opts.delayMs) ? Math.max(0, opts.delayMs) : DEFAULT_DELAY_MS;
  const retries = Number.isFinite(opts.retries) ? Math.max(0, opts.retries) : DEFAULT_RETRIES;
  const timeoutMs = Number.isFinite(opts.timeoutMs) ? Math.max(1000, opts.timeoutMs) : DEFAULT_TIMEOUT_MS;
  const logger = typeof opts.logger === "function" ? opts.logger : (msg) => console.log(msg);
  const fetchImpl = typeof opts.fetchImpl === "function" ? opts.fetchImpl : globalThis.fetch;

  if (!apiKey) {
    throw new Error("API_FOOTBALL_KEY fehlt.");
  }
  if (typeof fetchImpl !== "function") {
    throw new Error("Global `fetch` ist nicht verfügbar. Node 18+ wird benötigt.");
  }

  const baseUrl = `https://${host}`;

  /**
   * Führt einen GET-Aufruf durch und liefert die geparste API-Antwort zurück.
   *
   * @param {string} path        z.B. "/teams"
   * @param {object} [params]    z.B. { league: 1, season: 2026 }
   */
  async function get(path, params) {
    const query = buildQuery(params);
    const url = path.startsWith("http") ? path : `${baseUrl}${path}${query}`;

    let lastError = null;
    for (let attempt = 0; attempt <= retries; attempt++) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      try {
        const res = await fetchImpl(url, {
          method: "GET",
          headers: {
            "x-rapidapi-key": apiKey,
            "x-rapidapi-host": host,
            "accept": "application/json",
          },
          signal: controller.signal,
        });

        clearTimeout(timer);

        if (res.status >= 500 || res.status === 429) {
          const body = await res.text().catch(() => "");
          throw new Error(`HTTP ${res.status} ${res.statusText} bei ${path}: ${body.slice(0, 300)}`);
        }

        let data;
        try {
          data = await res.json();
        } catch (_e) {
          throw new Error(`Ungültige JSON-Antwort von ${path} (status ${res.status}).`);
        }

        if (!res.ok) {
          throw new Error(`HTTP ${res.status} ${res.statusText} bei ${path}: ${describeApiErrors(data)}`);
        }

        if (hasApiErrors(data)) {
          throw new Error(`API-Fehler bei ${path}: ${describeApiErrors(data)}`);
        }

        return data;
      } catch (err) {
        clearTimeout(timer);
        lastError = err;
        const msg = String(err && err.message ? err.message : err);
        if (attempt < retries) {
          const backoff = Math.min(15_000, 2_000 * Math.pow(2, attempt));
          logger(`[apiFootball] Versuch ${attempt + 1}/${retries + 1} fehlgeschlagen für ${path}: ${msg}. Retry in ${backoff}ms.`);
          await sleep(backoff);
          continue;
        }
        throw err;
      } finally {
        await sleep(delayMs);
      }
    }
    throw lastError || new Error(`Unbekannter Fehler bei ${path}`);
  }

  /**
   * Lädt eine paginierte Ressource (bspw. /players) komplett.
   *
   * Stoppt automatisch bei `paging.total`. Defensive Limits verhindern
   * Endlosschleifen bei kaputten Antworten.
   *
   * @param {string} path
   * @param {object} params
   * @param {object} [pageOpts]
   * @param {number} [pageOpts.maxPages=200]
   * @param {(p:{page:number,total:number,results:number})=>void} [pageOpts.onPage]
   */
  async function getAllPages(path, params = {}, pageOpts = {}) {
    const maxPages = Number.isFinite(pageOpts.maxPages) ? Math.max(1, pageOpts.maxPages) : 200;
    const onPage = typeof pageOpts.onPage === "function" ? pageOpts.onPage : null;

    const all = [];
    let page = 1;
    let totalPages = 1;

    while (page <= totalPages && page <= maxPages) {
      const data = await get(path, { ...params, page });
      const response = Array.isArray(data?.response) ? data.response : [];
      all.push(...response);

      const paging = data?.paging || {};
      const reportedTotal = Number(paging.total) || 1;
      totalPages = Math.max(1, reportedTotal);

      if (onPage) {
        try {
          onPage({ page, total: totalPages, results: response.length });
        } catch (_e) {
          // Logger-Fehler dürfen den Sync nicht abbrechen.
        }
      }

      if (response.length === 0) break;
      page += 1;
    }

    return { items: all, pages: Math.min(page - 1, totalPages) };
  }

  return { get, getAllPages, host, baseUrl };
}

export const __testables = {
  buildQuery,
  hasApiErrors,
  describeApiErrors,
};
