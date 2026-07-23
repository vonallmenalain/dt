/* index.js – Haupt-Seitenskript, aus index.html extrahiert (Performance Phase 2).
   Wird als klassisches Skript an unveraenderter Position am Body-Ende geladen –
   die Ausfuehrungs-Reihenfolge relativ zu den uebrigen Skripten ist identisch. */

(function () {
    'use strict';

    /* =========================================================
       PRE/POST SPIELSTART – MODUS-STEUERUNG
       =========================================================
       DREAMTEAM_START ist in tournament-config.js definiert.
       localStorage-Key: dreamteamIndexViewMode
       Werte: "auto" | "pre" | "post"
       ========================================================= */

    // Startzeitpunkt aus APP_CONFIG lesen (turnierspezifisch in tournament-config.js).
    // Fallback (sollte praktisch nie greifen, da tournament-config.js vor index.html geladen wird):
    // wir geben das aktuelle Datum zurück, damit kein Turnier hart kodiert ist.
    function getDreamteamStart() {
        return (window.APP_CONFIG && window.APP_CONFIG.DREAMTEAM_START)
            ? window.APP_CONFIG.DREAMTEAM_START
            : new Date();
    }

    // Zentral aus APP_CONFIG.storage.globalKeys – siehe Erläuterung
    // dort, warum dieser Key bewusst NICHT turnier-namespaced ist.
    const DEV_TOGGLE_KEY = (window.APP_CONFIG
        && window.APP_CONFIG.storage
        && window.APP_CONFIG.storage.globalKeys
        && window.APP_CONFIG.storage.globalKeys.indexViewMode)
        || "dreamteamIndexViewMode";
    const DEV_MODES = ["auto", "pre", "post"];
    const DEV_LABELS = { auto: "DEV: Auto", pre: "DEV: Vor Start", post: "DEV: Nach Start" };

    function readStoredDevViewOverride() {
        try {
            const value = localStorage.getItem(DEV_TOGGLE_KEY);
            if (value === "pre" || value === "post") return value;
        } catch (_) { /* localStorage unavailable */ }
        return null;
    }

    function isAdminAuthResolved() {
        const Admin = window.DreamTeamAdmin;
        if (Admin && typeof Admin.isAuthResolved === "function") {
            return Admin.isAuthResolved();
        }
        if (Admin && typeof Admin.isAuthReady === "function") {
            return Admin.isAuthReady();
        }
        return false;
    }

    /**
     * Gibt den effektiven Anzeigemodus zurück:
     * "pre"  → Vor-Spielstart-Ansicht anzeigen
     * "post" → Nach-Spielstart-/Live-Ansicht anzeigen
     *
     * SICHERHEITSHINWEIS:
     * Der Dev-Override (`dreamteamIndexViewMode`) gilt nur dann, wenn
     * gerade ein Admin-Account angemeldet ist (siehe admin.js /
     * DreamTeamAdmin.getDevViewOverride). Für alle anderen Nutzer fällt
     * die Funktion automatisch auf den echten DREAMTEAM_START-Zeitpunkt
     * zurück, selbst wenn jemand den localStorage-Wert per DevTools
     * gesetzt hat. Damit ist der Wechsel zwischen Vor-/Nach-Spielstart-
     * Ansicht im Frontend ein reines Admin-Werkzeug.
     */
    function getEffectiveIndexViewMode() {
        const Admin = window.DreamTeamAdmin;
        const override = (Admin && typeof Admin.getDevViewOverride === 'function')
            ? Admin.getDevViewOverride()
            : null;
        if (override === "pre") return "pre";
        if (override === "post") return "post";

        // Firebase Auth liefert den persistierten User asynchron. Solange
        // noch unklar ist, ob der aktuelle Browser-User Admin ist, behalten
        // wir denselben Best-Guess wie das Head-Script bei. Sonst springt
        // die Seite bei gespeichertem "Nach Start" kurz auf "Vor Start",
        // bevor der Admin-Status ankommt.
        const pendingOverride = readStoredDevViewOverride();
        if (pendingOverride && Admin && !isAdminAuthResolved()) {
            return pendingOverride;
        }

        return new Date() >= getDreamteamStart() ? "post" : "pre";
    }

    /**
     * Aktualisiert die Beschriftung und das data-mode-Attribut des Dev-Umschalters.
     */
    function updateDevToggleLabel() {
        const btn = document.getElementById("dev-index-toggle");
        if (!btn) return;
        const storedMode = localStorage.getItem(DEV_TOGGLE_KEY) || "auto";
        btn.textContent = DEV_LABELS[storedMode] || DEV_LABELS.auto;
        btn.dataset.mode = storedMode;
    }

    /**
     * Zeigt die Pre-Start- oder Post-Start-Sektion an
     * und versteckt die jeweils andere.
     */
    function applyIndexViewMode() {
        const mode = getEffectiveIndexViewMode();
        const pre = document.getElementById("indexHomePreStart");
        const post = document.getElementById("indexHomePostStart");
        if (!pre || !post) return;

        // `data-view` auf <html> ist die führende Quelle für die CSS-
        // Sichtbarkeitsregeln (siehe <style>-Block oben). Das frühe
        // Head-Script setzt es synchron, hier korrigieren wir es nach
        // dem JS-Boot – falls Override/URL-Param/Auto-Flip einen anderen
        // Modus ergeben.
        try {
            document.documentElement.dataset.view = mode;
        } catch (_) {}

        // Letzten gerenderten Modus für den nächsten Page-Load merken,
        // damit das Head-Script bereits die korrekte Sektion einblendet
        // (kein Flicker selbst beim allerersten Reload nach Spielstart).
        try {
            sessionStorage.setItem("dreamteamLastView", mode);
        } catch (_) {}

        // Inline-Styles als Belt-and-Suspenders: greifen auch dann, wenn
        // das CSS-Override mal nicht durchschlägt (Edge-Case bei sehr
        // alten Browsern oder bewusst aufgehobenem `[data-view]`).
        if (mode === "post") {
            pre.style.display = "none";
            post.style.display = "";
        } else {
            pre.style.display = "";
            post.style.display = "none";
        }
    }

    /**
     * Live-Umschaltung von Pre- auf Post-Start exakt zum DREAMTEAM_START.
     *
     * Stellt sicher, dass eine bereits geöffnete index.html im Auto-Modus
     * pünktlich zum konfigurierten Spielstart (z. B. WM 2026:
     * 2026-06-11T21:00:00 +02:00, also 21:00 Uhr Schweizer Zeit) automatisch
     * von der Vor-Start- in die Nach-Start-Ansicht wechselt – ohne dass der
     * Nutzer die Seite neu laden muss.
     *
     * - Greift NUR im Auto-Modus (Override "pre"/"post" bleibt unverändert).
     * - setTimeout wird auf wenige Tage beschränkt, weil Browser bei sehr
     *   grossen Delays (Wochen/Monate) unzuverlässig werden. Ist der
     *   Spielstart noch weiter weg, planen wir einen Zwischen-Tick und
     *   schauen später erneut nach.
     * - Wird der Tab in der Zwischenzeit reaktiviert (visibilitychange),
     *   wenden wir den Modus sofort neu an, falls die Zielzeit zwischenzeitlich
     *   erreicht wurde (z. B. nach Sleep des Geräts).
     */
    /**
     * Liefert den derzeit *wirksamen* Dev-Override – also nur dann, wenn
     * ein Admin angemeldet ist (siehe admin.js). Für alle anderen Nutzer
     * gibt es per Definition keinen Override, deshalb läuft für sie der
     * Auto-Flip ganz normal.
     */
    function getActiveDevOverride() {
        const Admin = window.DreamTeamAdmin;
        return (Admin && typeof Admin.getDevViewOverride === 'function')
            ? Admin.getDevViewOverride()
            : null;
    }

    let _autoFlipTimerId = null;
    function scheduleAutoModeFlip() {
        if (_autoFlipTimerId) {
            clearTimeout(_autoFlipTimerId);
            _autoFlipTimerId = null;
        }

        // Wenn ein Admin den Override aktiv gesetzt hat, ist Auto-Modus
        // bewusst ausser Kraft – kein Live-Flip nötig.
        if (getActiveDevOverride() !== null) return;

        const start = getDreamteamStart();
        if (!(start instanceof Date) || isNaN(start.getTime())) return;

        const msUntilStart = start.getTime() - Date.now();
        if (msUntilStart <= 0) return; // bereits umgeschaltet

        // Browser drosseln sehr lange Timer (>= ~24 Tage) oder verlieren
        // sie beim Tab-Suspend. Wir teilen den Wartezeitraum daher in
        // Etappen von max. 6 Stunden.
        const SIX_HOURS_MS = 6 * 60 * 60 * 1000;
        const delay = Math.min(msUntilStart, SIX_HOURS_MS);

        _autoFlipTimerId = setTimeout(() => {
            _autoFlipTimerId = null;
            // Erneut prüfen – wenn ein Admin zwischenzeitlich den Override
            // gesetzt hat, ist Auto deaktiviert und wir machen nichts mehr.
            if (getActiveDevOverride() !== null) return;

            if (Date.now() >= start.getTime()) {
                // Spielstart erreicht: Ansicht und Render aktualisieren.
                if (_lastRenderedData) {
                    render(_lastRenderedData);
                } else {
                    applyIndexViewMode();
                }
                updateDevToggleLabel();
            } else {
                // Etappe abgelaufen, aber Ziel noch nicht erreicht – neu planen.
                scheduleAutoModeFlip();
            }
        }, delay);
    }

    /**
     * Wenn der Tab nach Inaktivität (Sleep, Hintergrund) wieder aktiv wird,
     * kann ein zwischenzeitlich abgelaufener setTimeout verloren gegangen
     * sein. Wir wenden den Auto-Modus dann sofort erneut an und planen
     * den nächsten Tick nach.
     */
    function handleAutoModeVisibilityChange() {
        if (document.visibilityState !== "visible") return;
        // Im Admin-Override-Modus stoppt der Auto-Flip ganz bewusst.
        // Für alle anderen Nutzer (Override greift nicht) führen wir die
        // normale Auto-Logik aus.
        if (getActiveDevOverride() !== null) return;
        applyIndexViewMode();
        updateDevToggleLabel();
        scheduleAutoModeFlip();
    }

    /**
     * Dev-Umschalter: Klick wechselt zyklisch durch auto → pre → post → auto …
     * Speichert den Modus in localStorage und wendet ihn sofort an.
     *
     * Sichtbarkeit ist Admin-gegated (siehe admin.js / DreamTeamAdmin):
     * Der Button bleibt für normale Nutzer komplett versteckt (display:none
     * via CSS) und wird hier nur eingeblendet, wenn ein Admin eingeloggt ist.
     */
    function initDevToggle() {
        const btn = document.getElementById("dev-index-toggle");
        if (!btn) return;

        updateDevToggleLabel();

        btn.addEventListener("click", () => {
            const current = localStorage.getItem(DEV_TOGGLE_KEY) || "auto";
            const nextIdx = (DEV_MODES.indexOf(current) + 1) % DEV_MODES.length;
            const next = DEV_MODES[nextIdx];
            localStorage.setItem(DEV_TOGGLE_KEY, next);
            updateDevToggleLabel();
            if (_lastRenderedData) {
                render(_lastRenderedData);
            } else {
                applyIndexViewMode();
            }
            // Wenn der Modus wieder auf Auto gestellt wird, planen wir den
            // nächsten Live-Flip neu; bei "pre"/"post" wird ein evtl.
            // anstehender Auto-Timer in scheduleAutoModeFlip() abgebrochen.
            scheduleAutoModeFlip();
        });

        function applyAdminVisibility(isAdmin) {
            // CSS rendert den Knopf standardmässig mit `visibility: hidden`,
            // damit ein einfaches Zurücksetzen auf den CSS-Default keinen
            // versehentlichen `display: none`-Fallthrough auslöst (alter
            // Bug: `style.display = ''` liess den Knopf für Admins
            // weiterhin verborgen, weil der CSS-Default selbst `none` war).
            btn.classList.toggle("is-admin-visible", !!isAdmin);
        }

        function hookAdmin() {
            if (!window.DreamTeamAdmin || typeof window.DreamTeamAdmin.onAdminChange !== "function") {
                return false;
            }
            window.DreamTeamAdmin.onAdminChange(({ isAdmin }) => {
                applyAdminVisibility(!!isAdmin);
                // Admin-Status wirkt sich auf die Override-Auswertung aus
                // (siehe getEffectiveIndexViewMode): Bei einem Wechsel
                // muss die Ansicht neu evaluiert und der Auto-Flip-Timer
                // ggf. neu geplant werden, damit ein frischer Logout
                // sofort auf "Auto"-Verhalten zurückfällt.
                if (_lastRenderedData) {
                    render(_lastRenderedData);
                } else {
                    applyIndexViewMode();
                }
                updateDevToggleLabel();
                scheduleAutoModeFlip();
            });
            return true;
        }

        if (!hookAdmin()) {
            // admin.js wird ggf. erst nach dieser Funktion geladen — wir warten
            // kurz auf das globale DreamTeamAdmin und hängen uns dann ein.
            let attempts = 0;
            const maxAttempts = 50; // ~5s
            const interval = setInterval(() => {
                attempts += 1;
                if (hookAdmin() || attempts >= maxAttempts) {
                    clearInterval(interval);
                }
            }, 100);
        }
    }

    /* =========================================================
       UTILITIES
       ========================================================= */
    const escapeHtml = (v) => String(v ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');

    const $ = (id) => document.getElementById(id);
    const isDesktopHover = () => window.matchMedia('(hover: hover) and (pointer: fine)').matches;
    const prefersReducedMotion = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    let nationFlagLookup = null;

    function normalizeNationFlagKey(value) {
        if (typeof normalizeCountryKey === 'function') return normalizeCountryKey(value);
        if (value === null || value === undefined) return '';
        return String(value)
            .normalize('NFD')
            .replace(/[\u0300-\u036f]/g, '')
            .replace(/['`´’]/g, '')
            .replace(/&/g, ' and ')
            .replace(/[^a-zA-Z0-9]+/g, ' ')
            .trim()
            .replace(/\s+/g, ' ')
            .toLowerCase();
    }

    function getNationFlagAliasNames(nationName) {
        const names = [nationName];
        if (typeof getCountryAliases === 'function') {
            names.push(...getCountryAliases(nationName));
        }
        return names.filter(Boolean);
    }

    function buildNationFlagLookup() {
        const lookup = new Map();
        const add = (name, logo) => {
            const key = normalizeNationFlagKey(name);
            if (key && logo && !lookup.has(key)) lookup.set(key, logo);
        };

        playersData.forEach(player => {
            const nation = player && player['Nationalteam.name'];
            const logo = player && player['Nationalteam.logo'];
            if (!nation || !logo) return;
            getNationFlagAliasNames(nation).forEach(name => add(name, logo));
        });

        return lookup;
    }

    function getNationFlag(nationName) {
        if (!nationName) return '';
        if (!nationFlagLookup) nationFlagLookup = buildNationFlagLookup();

        for (const name of getNationFlagAliasNames(nationName)) {
            const flag = nationFlagLookup.get(normalizeNationFlagKey(name));
            if (flag) return flag;
        }

        return '';
    }

    function handleFlagImageError(img) {
        if (!img) return;
        const fallback = img.dataset ? img.dataset.fallbackSrc : '';
        if (fallback && img.src !== fallback) {
            img.dataset.fallbackSrc = '';
            img.src = fallback;
            return;
        }
        const placeholder = document.createElement('span');
        placeholder.className = img.className || '';
        placeholder.setAttribute('aria-hidden', 'true');
        placeholder.textContent = '🏳️';
        img.replaceWith(placeholder);
    }
    window.handleFlagImageError = handleFlagImageError;

    function renderFlagImageHtml(className, primaryUrl, fallbackUrl, altText, placeholderStyle = 'font-size:1.1rem;flex-shrink:0;') {
        const src = primaryUrl || fallbackUrl || '';
        if (!src) return `<span style="${escapeHtml(placeholderStyle)}" aria-hidden="true">🏳️</span>`;
        const fallbackAttr = primaryUrl && fallbackUrl && primaryUrl !== fallbackUrl
            ? ` data-fallback-src="${escapeHtml(fallbackUrl)}"`
            : '';
        return `<img class="${escapeHtml(className)}" src="${escapeHtml(src)}" alt="${escapeHtml(altText || '')}" loading="lazy"${fallbackAttr} onerror="handleFlagImageError(this)">`;
    }

    function animateCounter(el, target, duration = 800) {
        if (!el) return;

        const numericTarget = Number(target);
        const targetText = String(target);
        if (!Number.isFinite(numericTarget) || prefersReducedMotion()) {
            el.textContent = targetText;
            el.dataset.counterTarget = targetText;
            el.dataset.counterAnimating = "0";
            return;
        }

        if (el.dataset.counterTarget === targetText) {
            if (el.dataset.counterAnimating === "1") return;
            if (el.textContent.trim() === targetText) return;
        }

        if (el.dataset.counterRafId) {
            cancelAnimationFrame(Number(el.dataset.counterRafId));
        }

        const current = Number(String(el.textContent || "").replace(/[^\d.-]/g, ""));
        const start = Number.isFinite(current) ? current : 0;
        const startTime = performance.now();
        el.dataset.counterTarget = targetText;
        el.dataset.counterAnimating = "1";

        const step = (now) => {
            const t = Math.min((now - startTime) / duration, 1);
            const eased = 1 - Math.pow(1 - t, 3);
            el.textContent = Math.round(start + (numericTarget - start) * eased);
            if (t < 1) {
                el.dataset.counterRafId = String(requestAnimationFrame(step));
            } else {
                el.textContent = targetText;
                el.dataset.counterAnimating = "0";
                delete el.dataset.counterRafId;
            }
        };
        el.dataset.counterRafId = String(requestAnimationFrame(step));
    }

    /* =========================================================
       PLAYER LOOKUP
       ========================================================= */
    // Performance: O(1)-Lookups statt linearer Scans über den gesamten
    // Spielerpool (~1200 Einträge). `playersData` wird zur Ladezeit einmal
    // befüllt und danach weder in Länge noch Reihenfolge verändert (data.js
    // mutiert ausschliesslich Position-Felder in place), deshalb darf der
    // Index lazy einmal aufgebaut und wiederverwendet werden. Die Map-
    // Befüllung "erster Treffer gewinnt" spiegelt exakt die bisherige
    // Array.find-Semantik wider (inkl. undefined-Rückgabe bei keinem Treffer).
    let __dtPlayerIndexById = null;
    let __dtPlayerIndexByName = null;
    function __dtEnsurePlayerIndexes() {
        if (__dtPlayerIndexById) return;
        __dtPlayerIndexById = new Map();
        __dtPlayerIndexByName = new Map();
        if (typeof playersData === 'undefined' || !Array.isArray(playersData)) return;
        for (let i = 0; i < playersData.length; i++) {
            const pd = playersData[i];
            if (!pd) continue;
            const rawId = pd['player.id'];
            if (rawId !== undefined && rawId !== null) {
                const key = String(rawId);
                if (!__dtPlayerIndexById.has(key)) __dtPlayerIndexById.set(key, pd);
            }
            const name = pd.Spielername;
            if (name) {
                const list = __dtPlayerIndexByName.get(name);
                if (list) list.push(pd);
                else __dtPlayerIndexByName.set(name, [pd]);
            }
        }
    }

    function getPlayerById(playerId) {
        if (playerId === undefined || playerId === null) return undefined;
        __dtEnsurePlayerIndexes();
        return __dtPlayerIndexById.get(String(playerId));
    }

    function getPlayerByName(name) {
        if (!name) return undefined;
        __dtEnsurePlayerIndexes();
        const list = __dtPlayerIndexByName.get(name);
        return list ? list[0] : undefined;
    }

    function getPlayerByStoredSnapshot(tp) {
        if (!tp || !tp.name) return null;
        __dtEnsurePlayerIndexes();
        const list = __dtPlayerIndexByName.get(tp.name);
        if (!list) return null;
        for (let i = 0; i < list.length; i++) {
            const p = list[i];
            if (!tp.nation || (p['Nationalteam.name'] || '') === tp.nation) return p;
        }
        return null;
    }

    function resolvePlayer(tp) {
        const byId = getPlayerById(tp.playerId);
        if (byId && (!tp.name || byId.Spielername === tp.name)) return byId;
        return getPlayerByStoredSnapshot(tp) || byId || (tp.name ? getPlayerByName(tp.name) : null);
    }

    /* =========================================================
       POINTS / RANKING COMPUTATION
       ========================================================= */
    function computeTotalPoints(points) {
        const result = {};
        Object.entries(points || {}).forEach(([id, doc]) => {
            result[id] = window.DreamTeamPoints && typeof window.DreamTeamPoints.getPlayerTotal === 'function'
                ? window.DreamTeamPoints.getPlayerTotal(doc)
                : ((typeof doc?.totalPoints === 'number') ? doc.totalPoints : 0);
        });
        return result;
    }

    /* ── Zeitbasierte Transfer-Wertung (Freeze) ──────────────────────────
       Für Teams MIT Transfers zählen Spieler nur, solange sie im Team waren
       (altes 15 bis zum Transfer, neues 15 danach). Der Kontext (Punkte je
       Spiel + Anpfiff je Spiel) wird pro Render einmalig gebaut; getTeamTotal
       und champEnrichTeams nutzen ihn, ohne dass jede Aufrufstelle ihn
       durchreichen muss. Teams OHNE Transfers → bisherige Skalar-Summe. */
    let transferScoreCtx = null;

    function tsFixtureKickoffMs(fixture) {
        if (!fixture || typeof fixture !== 'object') return null;
        const ts = Number(fixture.kickoffTimestamp);
        if (Number.isFinite(ts) && ts > 0) return ts > 10000000000 ? ts : ts * 1000;
        const raw = fixture.kickoffIso || fixture.date || fixture.datetime || fixture.kickoff || '';
        if (raw) { const p = Date.parse(raw); if (Number.isFinite(p)) return p; }
        return null;
    }

    function tsFindFixture(fixtures, matchId) {
        const map = fixtures || {};
        const direct = map[matchId] || map[String(matchId)];
        if (direct && typeof direct === 'object') return direct;
        const target = String(matchId);
        for (const fx of Object.values(map)) {
            if (fx && typeof fx === 'object' && String(fx.fixtureId) === target) return fx;
        }
        return null;
    }

    function buildTransferScoreCtx(data) {
        const rawPoints = (data && data.points) || {};
        const fixtures = (data && data.fixtures) || {};
        const pmp = {};
        const DP = window.DreamTeamPoints;
        if (DP && typeof DP.getPlayerMatchTotals === 'function') {
            Object.keys(rawPoints).forEach(id => { pmp[String(id)] = DP.getPlayerMatchTotals(rawPoints[id]); });
        }
        const cache = Object.create(null);
        const getKickoffMs = (matchId) => {
            const key = String(matchId);
            if (key in cache) return cache[key];
            const ms = tsFixtureKickoffMs(tsFindFixture(fixtures, matchId));
            cache[key] = ms;
            return ms;
        };
        return { playerMatchPoints: pmp, getKickoffMs };
    }

    function teamResolvedIds(team) {
        return (team.players || []).map(tp => {
            const full = resolvePlayer(tp);
            return full ? String(full['player.id']) : String(tp.playerId || '');
        });
    }

    function teamCurrentCaptainId(team) {
        const capTp = (team.players || []).find(tp => tp && tp.isCaptain);
        if (!capTp) return null;
        const full = resolvePlayer(capTp);
        return full ? String(full['player.id']) : String(capTp.playerId || '');
    }

    function teamHasTransfers(team) {
        return !!(window.TransferUtils
            && typeof window.TransferUtils.managerTotalOverTime === 'function'
            && team && Array.isArray(team.transfers) && team.transfers.length);
    }

    function teamTotalOverTime(team) {
        return window.TransferUtils.managerTotalOverTime({
            currentTeamIds: teamResolvedIds(team),
            transfers: team.transfers,
            initialCaptain: team.initialCaptain || teamCurrentCaptainId(team),
            playerMatchPoints: transferScoreCtx.playerMatchPoints,
            getKickoffMs: transferScoreCtx.getKickoffMs,
            // CL hat keinen Captain → kein ×2 (WM behält ×2).
            captainMultiplier: (window.APP_CONFIG && window.APP_CONFIG.captainEnabled === false) ? 1 : 2
        });
    }

    function getTeamTotal(team, ptMap) {
        if (teamHasTransfers(team) && transferScoreCtx) {
            return teamTotalOverTime(team);
        }
        return (team.players || []).reduce((sum, tp) => {
            const full = resolvePlayer(tp);
            const id = full ? String(full['player.id']) : String(tp.playerId || '');
            const base = ptMap[id] || 0;
            return sum + (tp.isCaptain ? base * 2 : base);
        }, 0);
    }

    function timestampToMillis(value) {
        if (!value) return 0;
        if (typeof value.toMillis === 'function') {
            const ms = Number(value.toMillis());
            if (Number.isFinite(ms)) return ms;
        }
        if (typeof value.toDate === 'function') {
            const date = value.toDate();
            const ms = date instanceof Date ? date.getTime() : NaN;
            if (Number.isFinite(ms)) return ms;
        }
        if (value instanceof Date) {
            const ms = value.getTime();
            return Number.isFinite(ms) ? ms : 0;
        }
        if (typeof value === 'number') return Number.isFinite(value) ? value : 0;
        if (typeof value === 'string') {
            const parsed = Date.parse(value);
            return Number.isFinite(parsed) ? parsed : 0;
        }
        if (typeof value === 'object') {
            const seconds = Number(value.seconds ?? value._seconds);
            if (Number.isFinite(seconds)) {
                const nanos = Number(value.nanoseconds ?? value._nanoseconds ?? 0);
                return seconds * 1000 + (Number.isFinite(nanos) ? Math.floor(nanos / 1000000) : 0);
            }
        }
        return 0;
    }

    function getTeamSubmissionMillis(team) {
        const candidates = [
            team && team.timestamp,
            team && team.submittedAt,
            team && team.createdAt,
            team && team.createdAtMs
        ];
        for (const candidate of candidates) {
            const ms = timestampToMillis(candidate);
            if (ms > 0) return ms;
        }
        return 0;
    }

    function compareTeamsBySubmissionAsc(a, b) {
        const aMs = getTeamSubmissionMillis(a);
        const bMs = getTeamSubmissionMillis(b);
        if (aMs !== bMs) {
            if (aMs <= 0) return 1;
            if (bMs <= 0) return -1;
            return aMs - bMs;
        }
        return compareTeamsByManagerName(a, b);
    }

    function compareTeamsByManagerName(a, b) {
        return String(a && a.manager || '').localeCompare(String(b && b.manager || ''), 'de');
    }

    function compareByTotalThenSubmission(a, b, totalProp) {
        const prop = totalProp || 'total';
        const diff = (Number(b && b[prop]) || 0) - (Number(a && a[prop]) || 0);
        if (diff !== 0) return diff;
        return compareTeamsBySubmissionAsc(a, b);
    }

    function getRankScore(value) {
        const score = Number(value);
        return Number.isFinite(score) ? score : 0;
    }

    function assignSharedRanks(sortedItems, getScore, setRank) {
        let currentRank = null;
        let previousScore = null;

        sortedItems.forEach((item, index) => {
            const score = getRankScore(getScore(item));
            if (index === 0 || score !== previousScore) {
                currentRank = index + 1;
            }
            setRank(item, currentRank);
            previousScore = score;
        });
    }

    function getDisplayedManagerRank(item, fallbackRank) {
        const rank = Number(item && (item.currentRank ?? item.rank));
        return Number.isFinite(rank) && rank > 0 ? rank : fallbackRank;
    }

    function getRankingHistoryFixtureId(fixture, fallbackId) {
        if (fixture && fixture.fixtureId !== undefined && fixture.fixtureId !== null) return String(fixture.fixtureId);
        if (fixture && fixture.apiFixtureId !== undefined && fixture.apiFixtureId !== null) return String(fixture.apiFixtureId);
        if (fixture && fixture.id !== undefined && fixture.id !== null) return String(fixture.id);
        if (fixture && fixture.fixture && fixture.fixture.id !== undefined && fixture.fixture.id !== null) {
            return String(fixture.fixture.id);
        }
        return String(fallbackId);
    }

    function findRankingHistoryFixtureByMatchId(fixtures, matchId) {
        const target = String(matchId);
        const map = fixtures || {};

        for (const [id, fixture] of Object.entries(map)) {
            if (String(id) === target) return fixture;
            if (getRankingHistoryFixtureId(fixture, id) === target) return fixture;
        }

        return null;
    }

    function getRankingHistoryMatchChronology(matchId, fixtures) {
        const fixture = findRankingHistoryFixtureByMatchId(fixtures, matchId);
        const kickoffMs = getMatchKickoffMs(fixture);
        if (kickoffMs) {
            return {
                hasFixtureTime: true,
                value: kickoffMs
            };
        }

        const numericId = Number(matchId);
        return {
            hasFixtureTime: false,
            value: Number.isFinite(numericId) ? numericId : Number.MAX_SAFE_INTEGER
        };
    }

    function sortRankingHistoryMatchIds(matchIds, fixtures) {
        return Array.from(matchIds || []).sort((a, b) => {
            const aInfo = getRankingHistoryMatchChronology(a, fixtures);
            const bInfo = getRankingHistoryMatchChronology(b, fixtures);

            if (aInfo.hasFixtureTime !== bInfo.hasFixtureTime) {
                return aInfo.hasFixtureTime ? -1 : 1;
            }
            if (aInfo.value !== bInfo.value) return aInfo.value - bInfo.value;

            return String(a).localeCompare(String(b), 'de', { numeric: true });
        });
    }

    /*
     * Compute ranking history from match-level points.
     * Returns { teams: [...], matchIds: [...] }
     * Each team: { manager, currentRank, total, history: [{rank, score}, ...] }
     */
    function computeRankingHistory(data) {
        const pointsData = data.points || {};
        const teams = Array.isArray(data.teams) ? data.teams : [];

        const matchIds = new Set();
        const playerMatchPoints = {};

        Object.entries(pointsData).forEach(([playerId, doc]) => {
            const matches = doc?.matches || {};
            const perMatch = {};
            Object.entries(matches).forEach(([matchId, lineup]) => {
                const id = Number(matchId);
                if (!Number.isFinite(id)) return;
                matchIds.add(id);
                let sum = 0;
                Object.values(lineup || {}).forEach((v) => { if (typeof v === 'number') sum += v; });
                perMatch[id] = sum;
            });
            playerMatchPoints[String(playerId)] = perMatch;
        });

        const orderedMatchIds = sortRankingHistoryMatchIds(matchIds, data.fixtures || {});

        const enriched = teams.map((team) => {
            const mergedPlayers = (team.players || []).map((tp) => {
                const full = resolvePlayer(tp);
                const id = full ? String(full['player.id']) : String(tp.playerId || '');
                return { id, isCaptain: !!tp.isCaptain };
            });
            return {
                manager: team.manager || 'Unbekannt',
                timestamp: team.timestamp,
                submittedAt: team.submittedAt,
                createdAt: team.createdAt,
                createdAtMs: team.createdAtMs,
                mergedPlayers,
                total: 0,
                history: []
            };
        });

        for (let i = 0; i < orderedMatchIds.length; i++) {
            const matchId = orderedMatchIds[i];
            enriched.forEach((team) => {
                const roundPts = team.mergedPlayers.reduce((sum, p) => {
                    const base = playerMatchPoints[p.id]?.[matchId] || 0;
                    return sum + (p.isCaptain ? base * 2 : base);
                }, 0);
                team.total += roundPts;
            });

            const sorted = [...enriched].sort((a, b) => compareByTotalThenSubmission(a, b, 'total'));
            assignSharedRanks(sorted, team => team.total, (team, rank) => {
                team.history[i] = { rank, score: team.total, matchId };
            });
        }

        const finalSorted = [...enriched].sort((a, b) => compareByTotalThenSubmission(a, b, 'total'));
        assignSharedRanks(finalSorted, team => team.total, (team, rank) => { team.currentRank = rank; });

        return { teams: finalSorted, matchIds: orderedMatchIds };
    }

    /* =========================================================
       RANK JUMPS
       ========================================================= */
    let rankingHistoryCache = null;
    // Track active period per section: { pre: number|null, post: number|null }
    const activePeriods = { pre: null, post: null };

    function buildPeriodOptions(matchIds) {
        const n = matchIds.length;
        const candidates = [1, 3, 5, 10, n].filter((v, i, a) => v <= n && a.indexOf(v) === i);
        return candidates.map((v) => ({
            label: v === n ? 'Gesamt' : `letzte ${v}`,
            value: v
        }));
    }

    function computeJumpsForPeriod(teams, matchIds, period) {
        const n = matchIds.length;
        if (n === 0) return [];

        return teams.map((team) => {
            const currentRank = team.currentRank;
            let prevRank = currentRank;

            if (n >= 2 && period > 0) {
                const snapshotIdx = Math.max(0, n - 1 - period);
                const snap = team.history[snapshotIdx];
                if (snap) prevRank = snap.rank;
            }

            return {
                manager: team.manager,
                currentRank,
                delta: prevRank - currentRank,
                prevRank
            };
        }).sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta) || a.currentRank - b.currentRank);
    }

    function renderJumps(period, prefix) {
        // prefix: '' → Pre, 'post-' → Post
        const sectionKey = (prefix === 'post-') ? 'post' : 'pre';
        activePeriods[sectionKey] = period;

        const container = $('tile-' + (prefix || '') + 'rank-jumps');
        if (!container || !rankingHistoryCache) return;

        // Update button states only within the relevant period-btn group
        const btnGroupId = (prefix === 'post-') ? 'period-post-btns' : 'period-btns';
        const btnGroup = $(btnGroupId);
        if (btnGroup) {
            btnGroup.querySelectorAll('.rp-btn').forEach((btn) => {
                btn.classList.toggle('active', Number(btn.dataset.period) === period);
            });
        }

        const jumps = computeJumpsForPeriod(rankingHistoryCache.teams, rankingHistoryCache.matchIds, period);
        const top5 = jumps.slice(0, 5);

        if (!top5.length) {
            container.innerHTML = '<div class="empty-state"><div class="empty-state-icon">📈</div>Noch keine Daten</div>';
            return;
        }

        container.innerHTML = top5.map((j) => {
            const url = `teams.html?manager=${encodeURIComponent(j.manager)}`;
            const sign = j.delta > 0 ? '+' : (j.delta < 0 ? '' : '±');
            const cls = j.delta > 0 ? 'up' : (j.delta < 0 ? 'down' : 'flat');
            const arrow = j.delta > 0 ? '↑' : (j.delta < 0 ? '↓' : '–');
            return `
                <a class="jump-item" href="${url}" aria-label="${escapeHtml(j.manager)}: Rang ${j.currentRank}, ${sign}${j.delta}">
                    <div class="ji-name">${escapeHtml(j.manager)}</div>
                    <div class="ji-rank">Rang ${j.currentRank}</div>
                    <div class="ji-delta ${cls}">
                        <span class="ji-arrow">${arrow}</span>
                        <span>${sign}${Math.abs(j.delta)}</span>
                    </div>
                </a>
            `;
        }).join('');
    }

    /* =========================================================
       PERIOD BUTTONS
       ========================================================= */
    function renderPeriodButtons(matchIds, prefix) {
        // prefix: '' → Pre, 'post-' → Post
        const btnGroupId = (prefix === 'post-') ? 'period-post-btns' : 'period-btns';
        const container = $(btnGroupId);
        if (!container) return;

        const options = buildPeriodOptions(matchIds);
        if (options.length === 0) { container.innerHTML = ''; return; }

        container.innerHTML = options.map((o) => `
            <button class="rp-btn" data-period="${o.value}" aria-label="Zeitraum: ${o.label}">${o.label}</button>
        `).join('');

        container.querySelectorAll('.rp-btn').forEach((btn) => {
            btn.addEventListener('click', () => renderJumps(Number(btn.dataset.period), prefix));
        });

        // default: last match
        const defaultPeriod = matchIds.length > 0 ? 1 : 0;
        renderJumps(defaultPeriod, prefix);
    }

    /* =========================================================
       HERO MINI-CARDS
       ========================================================= */
    function renderHeroCards(topPlayers, ptMap, heroPfx) {
        // heroPfx: '' → Pre-Start IDs (hcs-0 ... hcs-4)
        //          'hcs-post-' → Post-Start IDs (hcs-post-0 ...)
        const isPost = heroPfx === 'hcs-post-';
        const slots = [];
        for (let i = 0; i < 8; i += 1) {
            const slot = $(`${heroPfx}hcs-${i}`);
            if (!slot) break;
            slots.push(slot);
        }
        topPlayers.slice(0, slots.length).forEach((p, i) => {
            const slot = slots[i];
            if (!slot) return;
            const pts = ptMap[String(p['player.id'])] || 0;
            const sign = pts > 0 ? '+' : '';
            const url = `spieleranalyse.html?playerId=${encodeURIComponent(p['player.id'])}`;
            if (slot.tagName === 'A') slot.href = url;
            slot.innerHTML = `
                ${isPost && pts !== 0 ? `<div class="hcs-pts">${sign}${pts}</div>` : ''}
                <img class="hcs-photo" src="${escapeHtml(p.Spielerfoto)}" alt="${escapeHtml(p.Spielername)}" loading="lazy">
                <div class="hcs-name">${escapeHtml(p.Spielername)}</div>
                ${p['Nationalteam.logo'] ? `<img class="hcs-flag" src="${escapeHtml(p['Nationalteam.logo'])}" alt="${escapeHtml(p['Nationalteam.name'] || '')}" loading="lazy">` : ''}
                ${!isPost && p['Club.logo'] ? `<img class="hcs-club" src="${escapeHtml(p['Club.logo'])}" alt="${escapeHtml(p['Club.name'] || '')}" loading="lazy">` : ''}
            `;
        });
    }
    /* =========================================================
       TOP PLAYERS TILE
       ========================================================= */
    function renderTopPlayers(topPlayers, ptMap, prefix) {
        // prefix: '' → tile-top-players (Pre), 'post-' → tile-post-top-players (Post)
        const container = $('tile-' + (prefix || '') + 'top-players');
        if (!container) return;

        if (!topPlayers.length) {
            container.innerHTML = '<li><div class="empty-state"><div class="empty-state-icon">⭐</div>Noch keine Punkte</div></li>';
            return;
        }

        container.innerHTML = topPlayers.slice(0, 5).map((p, i) => {
            const pts = ptMap[String(p['player.id'])] || 0;
            const url = `spieleranalyse.html?playerId=${encodeURIComponent(p['player.id'])}`;
            const ptsClass = pts > 0 ? 'pos' : (pts < 0 ? 'neg' : 'zero');
            const sign = pts > 0 ? '+' : '';
            const rankCls = i === 0 ? 'pi-rank-1' : (i === 1 ? 'pi-rank-2' : (i === 2 ? 'pi-rank-3' : ''));
            return `
                <li>
                    <a class="player-item" href="${url}" aria-label="${escapeHtml(p.Spielername)}, ${sign}${pts} Punkte">
                        <div class="pi-rank ${rankCls}">${i + 1}</div>
                        <div class="pi-avatar-wrap">
                            <img class="pi-avatar" src="${escapeHtml(p.Spielerfoto)}" alt="${escapeHtml(p.Spielername)}" loading="lazy">
                            ${p['Nationalteam.logo'] ? `<img class="pi-flag" src="${escapeHtml(p['Nationalteam.logo'])}" alt="${escapeHtml(p['Nationalteam.name'] || '')}" loading="lazy">` : ''}
                        </div>
                        <div class="pi-info">
                            <div class="pi-name">${escapeHtml(p.Spielername)}</div>
                            <div class="pi-sub">${escapeHtml(p['Nationalteam.name'] || '')} · ${escapeHtml(p['Club.name'] || '')}</div>
                        </div>
                        <div class="pi-pts ${ptsClass}">${sign}${pts}</div>
                    </a>
                </li>
            `;
        }).join('');
    }

    /* =========================================================
       TOP NATIONS TILE
       ========================================================= */
    function renderTopNations(nations, prefix) {
        // prefix: '' → tile-top-nations (Pre), 'post-' → tile-post-top-nations (Post)
        const container = $('tile-' + (prefix || '') + 'top-nations');
        if (!container) return;

        if (!nations.length) {
            container.innerHTML = '<div class="empty-state"><div class="empty-state-icon">🌍</div>Noch keine Punkte</div>';
            return;
        }

        const maxPts = nations[0]?.[1] || 1;

        container.innerHTML = nations.slice(0, 5).map(([nation, pts], i) => {
            const url = `spieleranalyse.html?view=countries&gameNation=${encodeURIComponent(nation)}`;
            const flagUrl = getNationFlag(nation);
            const barPct = maxPts > 0 ? Math.round((pts / maxPts) * 100) : 0;
            const rankCls = i === 0 ? 'ni-rank-1' : '';
            return `
                <a class="nation-item" href="${url}" aria-label="${escapeHtml(nation)}, ${pts} Punkte, Rang ${i+1}">
                    <div class="ni-rank ${rankCls}" style="${i===0?'color:var(--gold)':''}${i===1?'color:#c0c0c0':''}${i===2?'color:#cd7f32':''}">${i + 1}</div>
                    ${flagUrl ? `<img class="ni-flag" src="${escapeHtml(flagUrl)}" alt="${escapeHtml(nation)}" loading="lazy">` : `<div style="width:28px;text-align:center;">🏳️</div>`}
                    <div class="ni-info"><div class="ni-name">${escapeHtml(nation)}</div></div>
                    <div class="ni-bar-wrap"><div class="ni-bar-fill" style="width:${barPct}%"></div></div>
                    <div class="ni-pts">${pts > 0 ? '+' : ''}${pts}</div>
                </a>
            `;
        }).join('');
    }

    /* =========================================================
       TOP MANAGERS TILE
       ========================================================= */
    function renderTopManagers(teamTotals, ptMap, teams, prefix) {
        // prefix: '' → tile-top-managers (Pre), 'post-' → tile-post-top-managers (Post)
        const container = $('tile-' + (prefix || '') + 'top-managers');
        if (!container) return;

        if (!teamTotals.length) {
            container.innerHTML = '<div class="empty-state"><div class="empty-state-icon">🏅</div>Noch keine Teams</div>';
            return;
        }

        container.innerHTML = teamTotals.slice(0, 5).map((t, i) => {
            const url = `teams.html?manager=${encodeURIComponent(t.manager)}`;
            const rank = getDisplayedManagerRank(t, i + 1);
            const rankCls = rank === 1 ? 'mir-rank-1' : (rank === 2 ? 'mir-rank-2' : (rank === 3 ? 'mir-rank-3' : ''));
            const sign = t.total > 0 ? '+' : '';

            // Build top 3 player avatars for this manager
            const teamObj = teams.find((t2) => t2.manager === t.manager);
            let avatarHtml = '';
            if (teamObj) {
                const topPlayers = (teamObj.players || [])
                    .map((tp) => {
                        const full = resolvePlayer(tp);
                        if (!full) return null;
                        const base = ptMap[String(full['player.id'])] || 0;
                        return { pts: tp.isCaptain ? base * 2 : base, photo: full.Spielerfoto, name: full.Spielername };
                    })
                    .filter(Boolean)
                    .sort((a, b) => b.pts - a.pts)
                    .slice(0, 3);

                avatarHtml = `<div class="mir-players">` +
                    topPlayers.map((p) =>
                        `<img class="mir-player-avatar" src="${escapeHtml(p.photo)}" alt="${escapeHtml(p.name)}" loading="lazy" title="${escapeHtml(p.name)}">`
                    ).join('') +
                    `</div>`;
            }

            return `
                <a class="manager-item-row" href="${url}" aria-label="${escapeHtml(t.manager)}, Rang ${rank}, ${sign}${t.total} Punkte">
                    <div class="mir-rank ${rankCls}">${rank}</div>
                    <div class="mir-name">${escapeHtml(t.manager)}</div>
                    ${avatarHtml}
                    <div class="mir-pts">${sign}${t.total}</div>
                </a>
            `;
        }).join('');
    }

    /* =========================================================
       CAPTAIN WATCH
       ========================================================= */
    function renderCaptainWatch(captainCounts, ptMap, prefix) {
        // prefix: '' → tile-captain-watch (Pre), 'post-' → tile-post-captain-watch (Post)
        const container = $('tile-' + (prefix || '') + 'captain-watch');
        if (!container) return;

        const ranked = Object.entries(captainCounts)
            .map(([id, cnt]) => ({ player: getPlayerById(id), cnt }))
            .filter((x) => x.player)
            .sort((a, b) => b.cnt - a.cnt)
            .slice(0, 5);

        if (!ranked.length) {
            container.innerHTML = '<div class="empty-state"><div class="empty-state-icon">👑</div>Noch keine Captains</div>';
            return;
        }

        container.innerHTML = ranked.map(({ player, cnt }) => {
            const url = `spieleranalyse.html?playerId=${encodeURIComponent(player['player.id'])}`;
            const pts = ptMap[String(player['player.id'])] || 0;
            const sign = pts > 0 ? '+' : '';
            return `
                <a class="cap-item" href="${url}" aria-label="${escapeHtml(player.Spielername)}, ${cnt}x Captain, ${sign}${pts} Punkte">
                    <div class="ci-avatar-wrap">
                        <img class="ci-avatar" src="${escapeHtml(player.Spielerfoto)}" alt="${escapeHtml(player.Spielername)}" loading="lazy">
                        <div class="ci-cap-badge" aria-label="Captain">C</div>
                    </div>
                    <div class="ci-info">
                        <div class="ci-name">${escapeHtml(player.Spielername)}</div>
                        <div class="ci-sub">${escapeHtml(player['Nationalteam.name'] || '')} · ${sign}${pts} Pkt.</div>
                    </div>
                    <div class="ci-count">${cnt}×</div>
                </a>
            `;
        }).join('');
    }

    /* =========================================================
       NEXT MATCHES
       Find match data in existing structures. Looks for:
       - data.matches / data.matchCatalog / data.games
       - matchId keys in points data
       ========================================================= */
    function extractMatchInfo(data) {
        // Prefer structured fixtures from Firestore (keyed object)
        const fixturesObj = data.fixtures;
        if (fixturesObj && typeof fixturesObj === 'object' && !Array.isArray(fixturesObj) && Object.keys(fixturesObj).length > 0) {
            return Object.values(fixturesObj)
                // Qualifikationsspiele (CL) ausblenden – nur echte Champions
                // League ab der Ligarunde. WM bleibt unberührt.
                .filter(f => !(window.APP_CONFIG && typeof window.APP_CONFIG.isQualificationFixture === 'function' && window.APP_CONFIG.isQualificationFixture(f)))
                .sort((a, b) => (getMatchKickoffMs(a) || 0) - (getMatchKickoffMs(b) || 0))
                .map(f => {
                    const fixtureId = f.fixtureId ?? f.apiFixtureId ?? f.id ?? f.fixture?.id;
                    const kickoffMs = getMatchKickoffMs(f);
                    return {
                        id: fixtureId,
                        fixtureId,
                        gameNumber: fixtureId,
                        matchId: fixtureId,
                        teamA: f.homeTeam?.name || '',
                        teamB: f.awayTeam?.name || '',
                        teamAId: f.homeTeam?.id ?? null,
                        teamBId: f.awayTeam?.id ?? null,
                        homeTeam: f.homeTeam?.name || '',
                        awayTeam: f.awayTeam?.name || '',
                        homeTeamId: f.homeTeam?.id ?? null,
                        awayTeamId: f.awayTeam?.id ?? null,
                        homeLogo: f.homeTeam?.logo || '',
                        awayLogo: f.awayTeam?.logo || '',
                        date: f.kickoffIso || f.fixture?.date || '',
                        kickoff: f.kickoffIso || f.fixture?.date || '',
                        kickoffMs,
                        kickoffTimestamp: f.kickoffTimestamp || null,
                        venue: f.venue?.name || '',
                        venueCity: f.venue?.city || '',
                        venueImage: f.venue?.image || '',
                        statusShort: f.status?.short || f.statusShort || '',
                        statusLong: f.status?.long || f.statusLong || '',
                        statusElapsed: f.status?.elapsed ?? f.statusElapsed ?? null,
                        goals: f.goals || null,
                        goalEvents: Array.isArray(f.goalEvents) ? f.goalEvents : (Array.isArray(f.events) ? f.events : []),
                        homeWinner: f.homeTeam?.winner ?? null,
                        awayWinner: f.awayTeam?.winner ?? null,
                        round: f.league?.round || ''
                    };
                });
        }

        // Fallback: legacy explicit match arrays
        const candidates = [data.matches, data.matchCatalog, data.games];
        for (const arr of candidates) {
            if (Array.isArray(arr) && arr.length > 0) return arr;
        }

        // Extract from points structure
        const matchIds = new Set();
        Object.values(data.points || {}).forEach((doc) => {
            Object.keys(doc?.matches || {}).forEach((id) => {
                const n = Number(id);
                if (Number.isFinite(n)) matchIds.add(n);
            });
        });

        if (matchIds.size > 0) {
            return Array.from(matchIds).sort((a, b) => a - b).map((id) => ({ gameNumber: id, matchId: id }));
        }

        return [];
    }

    function getNationFromMatchGame(matchId, data) {
        const nations = new Set();
        Object.entries(data.points || {}).forEach(([playerId, doc]) => {
            const matchKey = String(matchId);
            if (doc?.matches && (doc.matches[matchKey] !== undefined || doc.matches[Number(matchId)] !== undefined)) {
                const p = getPlayerById(playerId);
                if (p && p['Nationalteam.name']) nations.add(p['Nationalteam.name']);
            }
        });
        return Array.from(nations).filter(Boolean);
    }

    /* =========================================================
       HERO STATS
       ========================================================= */
    function renderHeroStats(teams, ptMap, heroPfx) {
        // heroPfx: '' → Pre-Start IDs (hs-teams, hs-drafted, hs-leader)
        //          'hcs-post-' → Post-Start IDs (hs-post-teams, hs-post-drafted, hs-post-leader)
        const isPost = heroPfx === 'hcs-post-';
        const teamCountEl = isPost ? $('hs-post-teams') : $('hs-teams');
        const draftedEl = isPost ? $('hs-post-drafted') : $('hs-drafted');
        const leaderEl = isPost ? $('hs-post-leader') : $('hs-leader');

        // Count unique drafted player IDs
        const draftedIds = new Set();
        teams.forEach((t) => {
            (t.players || []).forEach((tp) => {
                const full = resolvePlayer(tp);
                if (full) draftedIds.add(String(full['player.id']));
            });
        });

        if (teamCountEl) animateCounter(teamCountEl, teams.length);
        if (draftedEl) animateCounter(draftedEl, draftedIds.size);

        if (leaderEl) {
            const sorted = [...teams].sort((a, b) => {
                const diff = getTeamTotal(b, ptMap) - getTeamTotal(a, ptMap);
                if (diff !== 0) return diff;
                return compareTeamsBySubmissionAsc(a, b);
            });
            const topManager = sorted.length > 0 ? sorted[0].manager : null;
            leaderEl.textContent = topManager ? escapeHtml(topManager) : '–';
            if (topManager && leaderEl.tagName === 'A') {
                leaderEl.href = `teams.html?manager=${encodeURIComponent(topManager)}`;
            }
        }
    }

    /* =========================================================
       TEAM COUNT TILE
       ========================================================= */
    function renderTeamCount(count, prefix) {
        // prefix: '' → tile-team-count (Pre), 'post-' → tile-post-team-count (Post)
        const el = $('tile-' + (prefix || '') + 'team-count');
        const sub = $('tile-' + (prefix || '') + 'team-sub');
        if (el) animateCounter(el, count);
        if (sub) sub.textContent = count === 1 ? 'Team nimmt teil' : 'Teams nehmen teil';
    }

    /* =========================================================
       MANAGER LIST TILE (Pre-Tournament)
       ========================================================= */
    function renderManagerList(teams, prefix) {
        const container = $('tile-' + (prefix || '') + 'manager-list');
        if (!container) return;
        if (!teams.length) {
            container.innerHTML = '<div class="empty-state"><div class="empty-state-icon">👥</div>Noch keine Teams</div>';
            return;
        }
        const sortedTeams = [...teams].sort(compareTeamsByManagerName);

        container.innerHTML = sortedTeams.slice(0, 10).map((t, i) => {
            const url = `teams.html?manager=${encodeURIComponent(t.manager)}`;
            return `
                <a class="mgr-chip" href="${url}" aria-label="${escapeHtml(t.manager)}">
                    <span class="mgr-chip-num">${i + 1}</span>
                    <span class="mgr-chip-name">${escapeHtml(t.manager)}</span>
                </a>
            `;
        }).join('');
    }

    /* =========================================================
       TOP CLUBS TILE (Pre-Tournament)
       ========================================================= */
    function renderTopClubs(teams, prefix) {
        const container = $('tile-' + (prefix || '') + 'top-clubs');
        if (!container) return;

        // CL (club-zentriert): der Remap in data.js legt die Nationalität ins
        // sekundäre Feld (Club.name) – diese Kachel zeigt dort also Länder,
        // nicht Vereine. Titel/Icon/aria entsprechend beschriften.
        const secPlural = (window.APP_CONFIG && window.APP_CONFIG.primaryEntity === 'club') ? 'Länder' : 'Vereine';
        container.setAttribute('aria-label', `Meistgewählte ${secPlural}`);
        const gtile = container.closest('.gtile');
        const titleEl = gtile && gtile.querySelector('.gtile-title');
        if (titleEl) {
            const icon = titleEl.querySelector('.gtile-title-icon');
            if (icon) icon.textContent = (secPlural === 'Länder') ? '🌍' : '🏢';
            titleEl.childNodes.forEach((node) => {
                if (node.nodeType === 3 && /Beliebteste/.test(node.nodeValue || '')) {
                    node.nodeValue = ` Beliebteste ${secPlural}`;
                }
            });
        }

        const clubCounts = {};
        teams.forEach((t) => {
            (t.players || []).forEach((tp) => {
                const full = resolvePlayer(tp);
                if (full && full['Club.name'] && full['Club.name'] !== 'Vereinslos') {
                    clubCounts[full['Club.name']] = (clubCounts[full['Club.name']] || 0) + 1;
                }
            });
        });

        const topClubs = Object.entries(clubCounts)
            .map(([name, count]) => {
                const p = playersData.find((pl) => pl['Club.name'] === name);
                return { name, logo: p ? p['Club.logo'] : '', count };
            })
            .sort((a, b) => b.count - a.count)
            .slice(0, 5);

        if (!topClubs.length) {
            container.innerHTML = '<div class="empty-state"><div class="empty-state-icon">🏢</div>Noch keine Daten</div>';
            return;
        }

        container.innerHTML = topClubs.map((c, i) => {
            const url = `spieleranalyse.html?club=${encodeURIComponent(c.name)}`;
            return `
                <a class="club-row" href="${url}" aria-label="${escapeHtml(c.name)}, ${c.count}x gewählt">
                    <span style="font-size:0.72rem;font-weight:700;color:var(--text-muted);min-width:16px;">${i + 1}</span>
                    <div class="club-logo-wrap">
                        ${c.logo ? `<img src="${escapeHtml(c.logo)}" alt="${escapeHtml(c.name)}" loading="lazy">` : '<span style="font-size:1.1rem;">⚽</span>'}
                    </div>
                    <span class="club-name-text">${escapeHtml(c.name)}</span>
                    <span class="club-count-badge">${c.count}×</span>
                </a>
            `;
        }).join('');
    }

    /* =========================================================
       SCOUTING BAROMETER TILE (Pre-Tournament)
       ========================================================= */
    function renderScoutingBarometer(teams, prefix) {
        const container = $('tile-' + (prefix || '') + 'scouting-barometer');
        if (!container) return;
        if (!teams.length) {
            container.innerHTML = '<div class="empty-state"><div class="empty-state-icon">🔬</div>Noch keine Teams</div>';
            return;
        }

        const totalManagers = teams.length;
        const pickCounts = {};
        teams.forEach((t) => {
            (t.players || []).forEach((tp) => {
                const full = resolvePlayer(tp);
                if (!full) return;
                const id = String(full['player.id']);
                pickCounts[id] = (pickCounts[id] || 0) + 1;
            });
        });

        const teamStats = teams.map((t) => {
            let totalPickRate = 0;
            (t.players || []).forEach((tp) => {
                const full = resolvePlayer(tp);
                if (!full) return;
                const id = String(full['player.id']);
                const rate = totalManagers > 0 ? (pickCounts[id] || 1) / totalManagers : 0;
                totalPickRate += rate;
            });
            const avgRate = totalPickRate / 15;
            const hipsterScore = Math.round(100 - avgRate * 100);
            return { manager: t.manager, hipsterScore };
        });

        const sorted = [...teamStats].sort((a, b) => b.hipsterScore - a.hipsterScore);
        const top5Hipster = sorted.slice(0, 5);
        const top5Mainstream = sorted.slice(-5).reverse();

        let html = `<div class="dark-sub-label green">🏆 Einzigartig</div>`;
        html += top5Hipster.map((t) => {
            const url = `teams.html?manager=${encodeURIComponent(t.manager)}`;
            return `
                <div class="dark-bar-row">
                    <div class="dark-bar-label"><a href="${url}">${escapeHtml(t.manager)}</a></div>
                    <div class="dark-bar-track"><div class="dark-bar-fill" style="width:${t.hipsterScore}%;background:linear-gradient(90deg,var(--green-main),var(--green-light));"></div></div>
                    <div class="dark-bar-val">${t.hipsterScore}%</div>
                </div>
            `;
        }).join('');

        html += `<div class="dark-sub-label red" style="margin-top:10px;">🐑 Mainstream</div>`;
        html += top5Mainstream.map((t) => {
            const url = `teams.html?manager=${encodeURIComponent(t.manager)}`;
            return `
                <div class="dark-bar-row">
                    <div class="dark-bar-label"><a href="${url}">${escapeHtml(t.manager)}</a></div>
                    <div class="dark-bar-track"><div class="dark-bar-fill" style="width:${t.hipsterScore}%;background:linear-gradient(90deg,#f87171,#ef4444);"></div></div>
                    <div class="dark-bar-val">${t.hipsterScore}%</div>
                </div>
            `;
        }).join('');

        container.innerHTML = html;
    }

    /* =========================================================
       TEAM AGE STRUCTURE TILE (Pre-Tournament)
       ========================================================= */
    function getAge(dateStr) {
        if (!dateStr || dateStr === '-') return null;
        const today = new Date();
        const birth = new Date(dateStr);
        let age = today.getFullYear() - birth.getFullYear();
        const m = today.getMonth() - birth.getMonth();
        if (m < 0 || (m === 0 && today.getDate() < birth.getDate())) age--;
        return age;
    }

    function renderAgeStructure(teams, prefix) {
        const container = $('tile-' + (prefix || '') + 'age-structure');
        if (!container) return;
        if (!teams.length) {
            container.innerHTML = '<div class="empty-state"><div class="empty-state-icon">🎂</div>Noch keine Teams</div>';
            return;
        }

        const teamAges = teams.map((t) => {
            let totalAge = 0;
            let count = 0;
            (t.players || []).forEach((tp) => {
                const full = resolvePlayer(tp);
                if (!full) return;
                const age = getAge(full.Geburtsdatum);
                if (age) { totalAge += age; count++; }
            });
            const avgAge = count > 0 ? (totalAge / count) : 0;
            return { manager: t.manager, avgAge: parseFloat(avgAge.toFixed(1)) };
        });

        const sorted = [...teamAges].sort((a, b) => b.avgAge - a.avgAge);
        const top5Old = sorted.slice(0, 5);
        const top5Young = sorted.slice(-5).reverse();

        let html = `<div class="dark-sub-label muted">👨‍🦳 Erfahrenste Teams</div>`;
        html += top5Old.map((t) => {
            const url = `teams.html?manager=${encodeURIComponent(t.manager)}`;
            return `
                <div class="dark-bar-row">
                    <div class="dark-bar-label"><a href="${url}">${escapeHtml(t.manager)}</a></div>
                    <div style="flex:1;"></div>
                    <span class="age-badge old">👨‍🦳 ${t.avgAge} J.</span>
                </div>
            `;
        }).join('');

        html += `<div class="dark-sub-label green" style="margin-top:10px;">👶 Jüngste Teams</div>`;
        html += top5Young.map((t) => {
            const url = `teams.html?manager=${encodeURIComponent(t.manager)}`;
            return `
                <div class="dark-bar-row">
                    <div class="dark-bar-label"><a href="${url}">${escapeHtml(t.manager)}</a></div>
                    <div style="flex:1;"></div>
                    <span class="age-badge young">👶 ${t.avgAge} J.</span>
                </div>
            `;
        }).join('');

        container.innerHTML = html;
    }

    /* =========================================================
       TOP & FLOP MANAGER PICKS TILE (Live Dashboard)
       ========================================================= */
    function renderManagerPicks(teams, ptMap, prefix) {
        const topContainer = $('tile-' + (prefix || '') + 'top-picks');
        const flopContainer = $('tile-' + (prefix || '') + 'flop-picks');
        if (!topContainer && !flopContainer) return;

        // Build list of drafted players with their points
        const draftedIds = new Set();
        teams.forEach((t) => {
            (t.players || []).forEach((tp) => {
                const full = resolvePlayer(tp);
                if (full) draftedIds.add(String(full['player.id']));
            });
        });

        const draftedPlayers = playersData
            .filter((p) => draftedIds.has(String(p['player.id'])))
            .map((p) => ({ ...p, pts: ptMap[String(p['player.id'])] || 0 }))
            .sort((a, b) => b.pts - a.pts);

        function buildPickedBySummary(managers) {
            const names = (managers || [])
                .map((name) => String(name || '').trim())
                .filter(Boolean);
            if (!names.length) {
                return {
                    html: '<span class="pick-meta-names">-</span>',
                    title: '',
                    aria: 'Von keinem Manager gewählt'
                };
            }

            const visible = names.slice(0, 2);
            const extraCount = Math.max(names.length - visible.length, 0);
            const visibleHtml = `<span class="pick-meta-names">${escapeHtml(visible.join(', '))}</span>`;
            const extraHtml = extraCount > 0 ? `<span class="pick-meta-more">+${extraCount}</span>` : '';
            const countLabel = names.length === 1 ? '1 Manager' : `${names.length} Managern`;

            return {
                html: visibleHtml + extraHtml,
                title: names.join(', '),
                aria: `Gewählt von ${countLabel}: ${names.join(', ')}`
            };
        }

        function buildPicksHTML(list) {
            if (!list.length) return '<li><div class="empty-state"><div class="empty-state-icon">📊</div>Noch keine Daten</div></li>';
            return list.map((p, i) => {
                const url = `spieleranalyse.html?playerId=${encodeURIComponent(p['player.id'])}`;
                const ptsClass = p.pts > 0 ? 'pos' : (p.pts < 0 ? 'neg' : 'zero');
                const sign = p.pts > 0 ? '+' : '';
                const rankCls = i === 0 ? 'gold' : (i === 1 ? 'silver' : (i === 2 ? 'bronze' : ''));
                const pickedByManagers = teams
                    .filter((t) => (t.players || []).some((tp) => {
                        const full = resolvePlayer(tp);
                        return full && String(full['player.id']) === String(p['player.id']);
                    }))
                    .map((t) => t.manager);
                const pickedBy = buildPickedBySummary(pickedByManagers);
                const itemLabel = `${p.Spielername}, ${sign}${p.pts} Punkte. ${pickedBy.aria}`;
                return `
                    <li>
                        <a class="pick-item" href="${url}" aria-label="${escapeHtml(itemLabel)}">
                            <span class="pick-rank ${rankCls}">${i + 1}</span>
                            <div class="pick-avatar-wrap">
                                <img class="pick-avatar" src="${escapeHtml(p.Spielerfoto)}" alt="${escapeHtml(p.Spielername)}" loading="lazy">
                                ${p['Nationalteam.logo'] ? `<img class="pick-flag" src="${escapeHtml(p['Nationalteam.logo'])}" alt="" loading="lazy">` : ''}
                            </div>
                            <div class="pick-info">
                                <div class="pick-name">${escapeHtml(p.Spielername)}</div>
                                <div class="pick-meta" title="${escapeHtml(pickedBy.title)}">${pickedBy.html}</div>
                            </div>
                            <div class="pick-pts ${ptsClass}">${sign}${p.pts}</div>
                        </a>
                    </li>
                `;
            }).join('');
        }

        if (topContainer) topContainer.innerHTML = buildPicksHTML(draftedPlayers.slice(0, 5));
        if (flopContainer) flopContainer.innerHTML = buildPicksHTML([...draftedPlayers].slice(-5).reverse());
    }

    /* =========================================================
       COMPACT PERFECT TEAM TILE (Live Dashboard)
       ========================================================= */
    function renderCompactPerfectTeam(ptMap, prefix) {
        const container = $('tile-' + (prefix || '') + 'perfect-team');
        const metaContainer = $('tile-' + (prefix || '') + 'perfect-meta');
        if (!container) return;

        const posMap = { GOALKEEPER: 'GK', DEFENDER: 'DEF', MIDFIELDER: 'MID', ATTACKER: 'ATT', FORWARD: 'ATT' };
        const posLabels = { GK: 'TOR', DEF: 'ABW', MID: 'MIT', ATT: 'STU' };
        const maxSlots = { GK: 2, DEF: 4, MID: 5, ATT: 4 };
        const startSlots = { GK: 1, DEF: 3, MID: 4, ATT: 3 };

        const teamSlots = { GK: [], DEF: [], MID: [], ATT: [] };
        const selectedNations = new Set();

        const sorted = [...playersData]
            .map((p) => ({ ...p, pts: ptMap[String(p['player.id'])] || 0 }))
            .sort((a, b) => b.pts - a.pts);

        for (const p of sorted) {
            const rawPos = String(p.Position || '').toUpperCase();
            const key = posMap[rawPos];
            if (!key) continue;
            if (teamSlots[key].length >= maxSlots[key]) continue;
            if (selectedNations.has(p['Nationalteam.name'])) continue;
            teamSlots[key].push(p);
            selectedNations.add(p['Nationalteam.name']);
        }

        const starters = [
            ...teamSlots.GK.slice(0, startSlots.GK),
            ...teamSlots.DEF.slice(0, startSlots.DEF),
            ...teamSlots.MID.slice(0, startSlots.MID),
            ...teamSlots.ATT.slice(0, startSlots.ATT)
        ];
        const benchers = [
            ...teamSlots.GK.slice(startSlots.GK),
            ...teamSlots.DEF.slice(startSlots.DEF),
            ...teamSlots.MID.slice(startSlots.MID),
            ...teamSlots.ATT.slice(startSlots.ATT)
        ];

        // Captain = highest scoring player across all 15 (matches manager scoring rules,
        // where bench points also count towards the team total).
        // In der CL gibt es kein Captain-Feature → kein Captain im Perfect Team
        // und keine Punkte-Verdopplung (WM bleibt unverändert).
        const allPicked = [...starters, ...benchers];
        const captainEnabledHere = !(window.APP_CONFIG && window.APP_CONFIG.captainEnabled === false);
        const captain = captainEnabledHere
            ? allPicked.reduce((best, p) => (!best || p.pts > best.pts) ? p : best, null)
            : null;
        const captainId = captain ? String(captain['player.id']) : null;
        const maxPts = allPicked.reduce((sum, p) => sum + (String(p['player.id']) === captainId ? p.pts * 2 : p.pts), 0);

        // Meta header
        if (metaContainer) {
            const captainHtml = captain ? `
                <a class="compact-captain-pill" href="spieleranalyse.html?playerId=${encodeURIComponent(captain['player.id'])}" aria-label="${escapeHtml(captain.Spielername)} analysieren">
                    <img class="compact-captain-avatar" src="${escapeHtml(captain.Spielerfoto)}" alt="${escapeHtml(captain.Spielername)}" loading="lazy">
                    <span class="compact-captain-name">C: ${escapeHtml(captain.Spielername)}</span>
                </a>
            ` : '';
            metaContainer.innerHTML = `
                <div class="compact-pt-stat">
                    <div class="compact-pt-stat-val">${maxPts}</div>
                    <div class="compact-pt-stat-label">Max. Punkte</div>
                </div>
                ${captainHtml}
            `;
        }

        function chipHTML(p, isBench) {
            if (!p) return '';
            const isCaptain = String(p['player.id']) === captainId;
            const pts = isCaptain ? p.pts * 2 : p.pts;
            const ptsClass = pts > 0 ? (isCaptain ? 'gold' : 'pos') : (pts < 0 ? 'neg' : 'zero');
            const sign = pts > 0 ? '+' : '';
            const url = `spieleranalyse.html?playerId=${encodeURIComponent(p['player.id'])}`;
            const shortName = p.Spielername.split(' ').pop();
            return `
                <a class="compact-player-chip${isCaptain ? ' is-captain' : ''}" href="${url}" aria-label="${escapeHtml(p.Spielername)}, ${sign}${pts}">
                    <img class="compact-chip-avatar" src="${escapeHtml(p.Spielerfoto)}" alt="${escapeHtml(p.Spielername)}" loading="lazy">
                    <span class="compact-chip-name">${escapeHtml(shortName)}${isCaptain ? ' ©' : ''}</span>
                    <span class="compact-chip-pts ${ptsClass}">${sign}${pts}</span>
                </a>
            `;
        }

        let html = '<div class="compact-pitch">';

        for (const key of ['GK', 'DEF', 'MID', 'ATT']) {
            const players = teamSlots[key].slice(0, startSlots[key]);
            if (!players.length) continue;
            html += `
                <div class="compact-pitch-row">
                    <span class="compact-pos-badge">${posLabels[key]}</span>
                    <div class="compact-players">${players.map((p) => chipHTML(p, false)).join('')}</div>
                </div>
            `;
        }

        if (benchers.length) {
            html += `<div class="compact-bench-sep">Bank</div>`;
            html += `
                <div class="compact-pitch-row">
                    <span class="compact-pos-badge">BNK</span>
                    <div class="compact-players">${benchers.map((p) => chipHTML(p, true)).join('')}</div>
                </div>
            `;
        }

        html += '</div>';
        container.innerHTML = html;
    }

    /* =========================================================
       MATCHES RENDERER
       ========================================================= */
    function renderMatchesIntoContainer(container, data, teams) {
        const matchInfos = extractMatchInfo(data);
        if (!matchInfos.length) {
            container.innerHTML = `
                <div class="match-empty">
                    <div style="font-size:1.5rem;opacity:0.4;margin-bottom:8px;">📅</div>
                    Spielplandaten werden hier angezeigt, sobald sie verfügbar sind.
                </div>
            `;
            return;
        }

        const matchPlayerMap = {};
        Object.entries(data.points || {}).forEach(([playerId, doc]) => {
            Object.keys(doc?.matches || {}).forEach((mId) => {
                const n = Number(mId);
                if (!matchPlayerMap[n]) matchPlayerMap[n] = [];
                const p = getPlayerById(playerId);
                if (p) matchPlayerMap[n].push(p);
            });
        });

        const draftedIds = new Set();
        (teams || []).forEach((t) => {
            (t.players || []).forEach((tp) => {
                const full = resolvePlayer(tp);
                if (full) draftedIds.add(String(full['player.id']));
            });
        });

        const shown = matchInfos.slice(-5).reverse();
        container.innerHTML = shown.map((match) => {
            const id = match.gameNumber || match.matchId || match.id;
            const url = `spieleranalyse.html?view=games&openGame=${encodeURIComponent(id)}`;
            let teamA = match.teamA || match.home || match.homeTeam || '';
            let teamB = match.teamB || match.away || match.awayTeam || '';
            let teamAFlag = match.teamAFlag || match.homeLogo || '';
            let teamBFlag = match.teamBFlag || match.awayLogo || '';
            let dateStr = match.date || match.datetime || '';

            if (!teamA || !teamB) {
                const nations = getNationFromMatchGame(id, data);
                teamA = nations[0] || '?';
                teamB = nations[1] || '?';
            }

            const teamAFlagFallback = getNationFlag(teamA);
            const teamBFlagFallback = getNationFlag(teamB);

            const playersInMatch = (matchPlayerMap[id] || [])
                .filter((p) => draftedIds.has(String(p['player.id'])))
                .slice(0, 5);

            const avatarHtml = playersInMatch.length
                ? `<div class="match-players-row" title="${playersInMatch.map((p) => escapeHtml(p.Spielername)).join(', ')}">` +
                  playersInMatch.map((p) =>
                      `<img class="match-player-avatar" src="${escapeHtml(p.Spielerfoto)}" alt="${escapeHtml(p.Spielername)}" loading="lazy">`
                  ).join('') + `</div>`
                : '';

            const dateLabel = dateStr ? new Date(dateStr).toLocaleDateString('de-CH', { day: '2-digit', month: '2-digit' }) : `Spiel ${id}`;

            return `
                <a class="match-item" href="${url}" aria-label="${escapeHtml(teamA)} vs ${escapeHtml(teamB)}, Spiel ${id}">
                    <div class="match-team">
                        ${renderFlagImageHtml('match-team-flag', teamAFlag, teamAFlagFallback, teamA, 'font-size:1.4rem;')}
                        <div class="match-team-name">${escapeHtml(teamA)}</div>
                    </div>
                    <div class="match-vs">
                        <div class="match-vs-text">VS</div>
                        <div class="match-vs-date">${escapeHtml(dateLabel)}</div>
                    </div>
                    <div class="match-team">
                        ${renderFlagImageHtml('match-team-flag', teamBFlag, teamBFlagFallback, teamB, 'font-size:1.4rem;')}
                        <div class="match-team-name">${escapeHtml(teamB)}</div>
                    </div>
                    ${avatarHtml}
                </a>
            `;
        }).join('');
    }

    /* =========================================================
       MAIN DATA LOADER & RENDER
       ========================================================= */
    const APP = window.APP_CONFIG;
    if (!APP) { console.error('APP_CONFIG fehlt'); return; }

    // Set title and hero label for both sections
    const shortLabel = APP.shortLabel || 'Turnier';
    const pageTitlePrefix = APP.pageTitlePrefix || APP.brandName || 'DreamTeam';

    function setHeroTeamCta(hasTeam) {
        const label = hasTeam ? 'Team bearbeiten' : 'Team erstellen';
        const icon = hasTeam ? '\u270F\uFE0F' : '\u26BD';
        const ariaLabel = `${label} f\u00fcr ${shortLabel}`;

        [$('hero-cta-btn'), $('hero-post-cta-btn')].forEach((btn) => {
            if (!btn) return;
            btn.textContent = `${icon} ${label}`;
            btn.setAttribute('aria-label', ariaLabel);
            btn.dataset.hasSubmittedTeam = hasTeam ? '1' : '0';
        });
    }

    window.addEventListener('dreamteam:user-team-status', (event) => {
        const detail = event && event.detail ? event.detail : {};
        setHeroTeamCta(!!detail.hasTeam);
    });

    document.title = `${pageTitlePrefix} - Startseite`;

    // Pre-Start hero labels
    const titleLabelEl = $('hero-title-label');
    if (titleLabelEl) titleLabelEl.textContent = shortLabel;

    setHeroTeamCta(false);

    // Post-Start hero labels
    const titleLabelPostEl = $('hero-post-title-label');
    if (titleLabelPostEl) titleLabelPostEl.textContent = shortLabel;

    // Optionaler Saison-Zusatz („Saison 2025/2026") klein unter dem Titel –
    // nur für Turniere, die APP.seasonLabel setzen (aktuell die CL).
    const seasonLabel = (APP.seasonLabel || '').trim();
    [$('hero-season-label'), $('hero-post-season-label')].forEach((el) => {
        if (!el) return;
        if (seasonLabel) {
            el.textContent = `Saison ${seasonLabel}`;
            el.hidden = false;
        } else {
            el.textContent = '';
            el.hidden = true;
        }
    });

    // Hero-Claim: ohne Captain-Feature (CL) den „1 Captain"-Teil weglassen.
    const claimLine1El = $('hero-claim-line1');
    if (claimLine1El) {
        const captainOn = !(APP && APP.captainEnabled === false);
        claimLine1El.textContent = captainOn ? '15 Spieler. 1 Captain.' : '15 Spieler.';
    }

    // Ohne Captain-Feature (CL) die „Captain Watch"-Kacheln (Vor- & Nach-Start)
    // ganz entfernen; die verbleibende Kachel der Reihe (Beliebteste Vereine)
    // wird dann volle Breite.
    if (APP && APP.captainEnabled === false) {
        ['tile-captain-watch', 'tile-post-captain-watch'].forEach((id) => {
            const inner = $(id);
            const gtile = inner && inner.closest('.gtile');
            const row = gtile && gtile.parentElement;
            if (gtile) gtile.remove();
            if (row && row.children.length === 1) {
                row.style.gridTemplateColumns = '1fr';
            }
        });
    }

    // CL-Version: Dashboard abspecken – „Beliebteste Länder" (tile-top-clubs),
    // „Scouting Barometer", „Team-Altersstruktur" sowie im Post-Start
    // zusätzlich „Manager-Picks: Top & Flop" entfallen komplett. Betrifft
    // Vor- UND Nach-Start (die Post-Kacheln sind Duplikate der Vor-Start-Reihen).
    // Läuft nach der Captain-Watch-Entfernung, damit leer gewordene Reihen
    // (und zuletzt die leeren Container) mit aufgeräumt werden. Die WM-Ansicht
    // (type ≠ CL) bleibt unberührt.
    if (APP && String(APP.type || '').toUpperCase() === 'CL') {
        [
            // Vor-Start
            'tile-top-clubs', 'tile-scouting-barometer', 'tile-age-structure',
            // Nach-Start (Duplikate)
            'tile-post-top-clubs', 'tile-post-scouting-barometer', 'tile-post-age-structure'
        ].forEach((id) => {
            const inner = $(id);
            const gtile = inner && inner.closest('.gtile');
            const row = gtile && gtile.parentElement;
            if (gtile) gtile.remove();
            if (row && row.children.length === 0) {
                row.remove();
            } else if (row && row.children.length === 1) {
                row.style.gridTemplateColumns = '1fr';
            }
        });

        // „Manager-Picks: Top & Flop" (nur Nach-Start) – ganze .glass-Karte weg.
        const picksInner = $('tile-post-top-picks');
        const picksCard = picksInner && picksInner.closest('.glass.post-full');
        if (picksCard) picksCard.remove();

        // Leergeräumte Container aufräumen.
        const preDashboard = $('dashboard-area');
        if (preDashboard && preDashboard.children.length === 0) preDashboard.remove();
        const postBottom = document.querySelector('#indexHomePostStart .post-bottom');
        if (postBottom && postBottom.children.length === 0) postBottom.remove();

        // Top-Manager-Bereich: In der CL ersetzt die kompakte Top-10-Liste
        // (#clTopManagers, siehe renderClTopManagers) die Champ-Stage samt
        // Podest-Animation. Die Champ-Stage fliegt hier komplett raus
        // (theme-cl.css blendet sie zusätzlich schon vor dem JS-Boot aus);
        // das WM-Podest selbst bleibt im Code unangetastet.
        const champStage = document.querySelector('#indexHomePostStart .champ-stage');
        if (champStage) champStage.remove();
        const clTopSection = $('clTopManagers');
        if (clTopSection) clTopSection.hidden = false;

        // Ansichts-Toggle „Top | Alle" binden und die Fläche der Top-Ansicht
        // schon vor dem Daten-Render unsichtbar reservieren (kein Skeleton-
        // Raster, kein Layout-Shift). Funktionsdeklarationen sind gehoisted.
        const viewToggle = document.querySelector('#clTopManagers .cltm-view-toggle');
        if (viewToggle) {
            viewToggle.addEventListener('click', (ev) => {
                const btn = ev.target.closest('[data-view]');
                if (btn) cltmSetView(btn.dataset.view);
            });
        }
        cltmReserveListHeight();
        window.addEventListener('resize', () => {
            if (cltmListResizeTimer) clearTimeout(cltmListResizeTimer);
            cltmListResizeTimer = setTimeout(() => {
                cltmListResizeTimer = null;
                const listEl = document.getElementById('clTopManagersList');
                if (listEl && listEl.querySelector('.cltm-tile')) cltmLayoutTiles(false);
                else cltmReserveListHeight();
            }, 120);
        });
    } else {
        // WM (bzw. Nicht-CL): die CL-Top-10-Sektion wird nie benutzt → weg.
        const clTopSection = $('clTopManagers');
        if (clTopSection) clTopSection.remove();
    }

    /* =========================================================
       PRE START HERO CARDS – MANUELL KONFIGURIERTE SPIELER
       ========================================================= */
    const PRESTART_HERO_PLAYER_NAMES = [
        'Lamine Yamal',
        'Kylian Mbappé',
        'Jude Bellingham',
        'Jamal Musiala',
        'Vitinha'
    ];

    /* =========================================================
       PRE START HOME – Render-Funktion
       ========================================================= */
    function renderPreStartHome(data) {
        const teams = Array.isArray(data.teams) ? data.teams : [];
        transferScoreCtx = buildTransferScoreCtx(data);
        const ptMap = computeTotalPoints(data.points);

        // Hero stats
        renderHeroStats(teams, ptMap, '');

        // Compute pick and captain counts
        const pickCounts = {};
        const captainCounts = {};
        teams.forEach((t) => {
            (t.players || []).forEach((tp) => {
                const full = resolvePlayer(tp);
                if (!full) return;
                const id = String(full['player.id']);
                pickCounts[id] = (pickCounts[id] || 0) + 1;
                if (tp.isCaptain) captainCounts[id] = (captainCounts[id] || 0) + 1;
            });
        });

        // Hero cards for pre-start: manually configured players (fallback: top picks)
        const topByPicks = Object.entries(pickCounts)
            .map(([id, cnt]) => ({ player: getPlayerById(id), cnt }))
            .filter((x) => x.player)
            .sort((a, b) => b.cnt - a.cnt)
            .map((x) => x.player);

        const preferredPrestartPlayers = PRESTART_HERO_PLAYER_NAMES
            .map((name) => getPlayerByName(name))
            .filter(Boolean);

        renderHeroCards(
            preferredPrestartPlayers.length ? preferredPrestartPlayers : topByPicks,
            ptMap,
            ''
        );

        // Captain watch
        renderCaptainWatch(captainCounts, ptMap, '');


        // Beliebteste Vereine
        renderTopClubs(teams, '');

        // Scouting Barometer
        renderScoutingBarometer(teams, '');

        // Team-Altersstruktur
        renderAgeStructure(teams, '');

        // Spielplan ist in der Pre-Start-Ansicht bewusst deaktiviert.

    }

    /* =========================================================
       RANKING PREVIEW TILE (Post-Start)
       ========================================================= */
    function renderRankingPreview(teamTotals, ptMap, teams) {
        const container = $('tile-post-ranking-preview-list');
        if (!container) return;

        if (!teamTotals.length) {
            container.innerHTML = `<div class="empty-state"><div class="empty-state-icon">🏆</div>Noch keine Ranglistendaten verfügbar.</div>`;
            return;
        }

        // Helper: build initials from manager name
        function managerInitials(name) {
            const parts = String(name || '').trim().split(/\s+/);
            if (parts.length >= 2) return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
            return String(name || '?').slice(0, 2).toUpperCase();
        }

        // Helper: get top avatars for a manager
        function getAvatars(manager) {
            const teamObj = teams.find(t2 => t2.manager === manager);
            if (!teamObj) return [];
            return (teamObj.players || [])
                .map(tp => {
                    const full = resolvePlayer(tp);
                    if (!full) return null;
                    const base = ptMap[String(full['player.id'])] || 0;
                    return { pts: tp.isCaptain ? base * 2 : base, photo: full.Spielerfoto, name: full.Spielername };
                })
                .filter(Boolean)
                .sort((a, b) => b.pts - a.pts)
                .slice(0, 3);
        }

        const top3 = teamTotals.slice(0, 3);
        const rest = teamTotals.slice(3, 7);

        // Podium (top 3)
        const crownIcons = ['👑', '🥈', '🥉'];
        const slotClasses = ['podium-slot-1', 'podium-slot-2', 'podium-slot-3'];

        const podiumHtml = `
            <div class="podium-stage">
                ${top3.map((t, i) => {
                    const rank = getDisplayedManagerRank(t, i + 1);
                    const sign = t.total > 0 ? '+' : '';
                    const url = `teams.html?manager=${encodeURIComponent(t.manager)}`;
                    const avatars = getAvatars(t.manager);
                    const avatarHtml = avatars.length
                        ? `<div class="rp-avatars" style="justify-content:center;margin-bottom:4px;">` +
                          avatars.map(a => `<img class="rp-avatar" src="${escapeHtml(a.photo)}" alt="${escapeHtml(a.name)}" loading="lazy" onerror="this.style.display='none'">`).join('') +
                          `</div>`
                        : '';
                    return `
                        <a class="podium-slot ${slotClasses[i]}" href="${url}" aria-label="${escapeHtml(t.manager)}, Rang ${rank}, ${sign}${t.total} Punkte">
                            <div class="podium-crown">${crownIcons[i]}</div>
                            <div class="podium-avatar-ring">
                                <div class="podium-initials">${escapeHtml(managerInitials(t.manager))}</div>
                            </div>
                            <div class="podium-info">
                                ${avatarHtml}
                                <div class="podium-name">${escapeHtml(t.manager)}</div>
                                <div class="podium-pts">${sign}${t.total}</div>
                                <div class="podium-rank-tag">#${rank}</div>
                            </div>
                            <div class="podium-pedestal">
                                <span class="podium-pedestal-num">${rank}</span>
                            </div>
                        </a>
                    `;
                }).join('')}
            </div>
        `;

        // Ranks 4-7 as compact list
        const restHtml = rest.length ? `
            <div class="podium-rest">
                ${rest.map((t, i) => {
                    const rank = getDisplayedManagerRank(t, i + 4);
                    const sign = t.total > 0 ? '+' : '';
                    const url = `teams.html?manager=${encodeURIComponent(t.manager)}`;
                    return `
                        <a class="podium-rest-entry" href="${url}" aria-label="${escapeHtml(t.manager)}, Rang ${rank}">
                            <span class="podium-rest-rank">${rank}</span>
                            <span class="podium-rest-name">${escapeHtml(t.manager)}</span>
                            <span class="podium-rest-pts">${sign}${t.total}</span>
                        </a>
                    `;
                }).join('')}
            </div>
        ` : '';

        container.innerHTML = podiumHtml + restHtml;
    }

    /* =========================================================
       UNIFIED 3-D CAROUSEL ENGINE
       ---------------------------------------------------------
       Used by both the player and the manager carousels.

       Architecture:
         • overflow-x: auto on the viewport → browser owns all
           touch physics (momentum, rubber-band, multi-swipe).
         • scroll-snap-type: x proximity → snap without fighting.
         • 3-D coverflow effect applied via a single passive
           rAF loop reading scrollLeft. Never touches layout.
         • Optional infinite mode: cards rendered 3× (left | real
           | right). Silent recenter after scroll stops, so the
           user always remains in the middle copy → seamless loop.
         • One controller per carousel; tear-down via AbortController
           on re-render so listeners never accumulate.
       ========================================================= */

    // Slide dimensions – kept in sync with CSS
    const CAROUSEL_SLIDE_GAP    = 10;                    // px
    const PLAYER_SLIDE_W        = 160;                   // px – player card
    const MGR_SLIDE_W           = 200;                   // px – manager card
    const PLAYER_SLIDE_UNIT     = PLAYER_SLIDE_W + CAROUSEL_SLIDE_GAP;
    const MGR_SLIDE_UNIT        = MGR_SLIDE_W + CAROUSEL_SLIDE_GAP;

    // Active controllers (one per carousel id) – allows tear-down on re-render
    const _carouselControllers = new Map();

    // Helper: wrap any signed index into [0, total)
    function _wrapIdx(i, total) { return ((i % total) + total) % total; }

    /**
     * Setup or rebuild a 3-D carousel.
     *
     * opts:
     *   trackId, viewportId, dotsId, prevId, nextId  – DOM ids
     *   cards         – array of card HTML strings (one per real slide)
     *   slideWidth    – px width of a single .carousel-slide
     *   infinite      – bool; render cards × 3 and seamlessly loop
     *   slideClass    – optional fn(realIdx) → string (extra class for slide)
     *   dotLabel      – optional fn(realIdx) → aria label
     *
     * Returns a controller with .scrollToReal(idx, behavior) and .destroy().
     */
    function setupCarousel(opts) {
        const track    = document.getElementById(opts.trackId);
        const viewport = document.getElementById(opts.viewportId);
        if (!track || !viewport) return null;

        const dotsEl   = opts.dotsId ? document.getElementById(opts.dotsId) : null;
        const prevBtn  = opts.prevId ? document.getElementById(opts.prevId) : null;
        const nextBtn  = opts.nextId ? document.getElementById(opts.nextId) : null;

        const cards         = opts.cards || [];
        const real          = cards.length;
        const slideWidth    = opts.slideWidth;
        const fallbackUnit  = slideWidth + CAROUSEL_SLIDE_GAP;
        const isInfinite    = !!opts.infinite && real > 1;
        const copies        = isInfinite ? 3 : 1;
        const offset        = isInfinite ? real : 0;     // start of middle copy
        const totalSlides   = real * copies;

        // Tear down any previous controller bound to this viewport
        const oldCtrl = _carouselControllers.get(opts.viewportId);
        if (oldCtrl) oldCtrl.destroy();
        viewport.classList.remove('is-scrolling');

        const abort  = new AbortController();
        const signal = abort.signal;

        // ── Render slides + dots ────────────────────────────────
        if (real === 0) {
            track.innerHTML = opts.emptyHtml || '';
            if (dotsEl) dotsEl.innerHTML = '';
            return null;
        }

        // Inject extra slide class (e.g. mgr-carousel-rank-1) into the wrapper
        const wrappedCards = cards.map((html, i) => {
            const extraCls = opts.slideClass ? opts.slideClass(i) : '';
            if (!extraCls) return html;
            // Inject into the first <div class="carousel-slide ..."> opener
            return html.replace(
                /class="carousel-slide([^"]*)"/,
                `class="carousel-slide $1 ${extraCls}"`
            );
        });

        let slidesHtml = '';
        for (let c = 0; c < copies; c++) slidesHtml += wrappedCards.join('');
        track.innerHTML = slidesHtml;

        if (dotsEl) {
            dotsEl.innerHTML = cards.map((_, i) => {
                const label = opts.dotLabel ? opts.dotLabel(i) : `Slide ${i + 1}`;
                return `<div class="carousel-dot${i === 0 ? ' active' : ''}" data-dot="${i}" role="tab" aria-label="${label}" aria-selected="${i === 0 ? 'true' : 'false'}" tabindex="0"></div>`;
            }).join('');
        }

        // Cache slide nodes ONCE – querying on every scroll frame is wasteful
        let slides = Array.from(track.querySelectorAll('.carousel-slide'));

        // ── Track padding ──────────────────────────────────────
        // Pure CSS padding-left + an explicit right spacer element.
        // (Some browsers exclude padding-right from scrollable area,
        // making the last slide unreachable.)
        function setPadding() {
            const vpW = viewport.offsetWidth;
            const P   = Math.max(0, (vpW - slideWidth) / 2);
            track.style.paddingLeft  = P + 'px';
            track.style.paddingRight = '0';
            const existing = track.querySelector('.carousel-track-spacer');
            if (existing) existing.remove();
            const spacer = document.createElement('div');
            spacer.className = 'carousel-track-spacer';
            spacer.style.cssText = `flex-shrink:0;width:${P}px;min-width:${P}px;pointer-events:none;`;
            track.appendChild(spacer);
            return P;
        }

        function getUnit() {
            if (slides.length < 2) return fallbackUnit;
            return slides[1].offsetLeft - slides[0].offsetLeft || fallbackUnit;
        }

        function getCenterFloat() {
            if (slides.length === 0) return 0;
            const first = slides[0].offsetLeft;
            const unit  = getUnit();
            return (viewport.scrollLeft - first) / unit;
        }

        function scrollToSlideIdx(slideIdx, behavior) {
            if (!slides.length) return;
            const first = slides[0].offsetLeft;
            const unit  = getUnit();
            const left  = first + slideIdx * unit;
            if (behavior === 'auto' || behavior === 'instant') {
                viewport.scrollLeft = left;
            } else {
                viewport.scrollTo({ left, behavior: 'smooth' });
            }
        }

        function scrollToReal(realIdx, behavior) {
            scrollToSlideIdx(offset + _wrapIdx(realIdx, real), behavior);
        }

        // ── 3-D coverflow effect ───────────────────────────────
        function apply3D() {
            const cf       = getCenterFloat();
            const nearest  = Math.max(0, Math.min(totalSlides - 1, Math.round(cf)));
            for (let i = 0; i < totalSlides; i++) {
                const slide = slides[i];
                if (!slide) continue;
                const dist  = i - cf;
                const a     = Math.abs(dist);
                const scale = Math.max(0.70, 1.10 - a * 0.19);
                const ry    = Math.max(-22, Math.min(22, -dist * 16));
                const op    = Math.max(0.30, 1 - a * 0.30);
                const isC   = i === nearest;
                if (isC !== slide.classList.contains('is-center')) {
                    slide.classList.toggle('is-center', isC);
                }
                slide.style.transform = `perspective(900px) rotateY(${ry.toFixed(2)}deg) scale(${scale.toFixed(3)})`;
                slide.style.opacity   = op.toFixed(3);
                slide.style.zIndex    = String(Math.round(10 - a * 2));
            }
        }

        function updateDots() {
            if (!dotsEl) return;
            const nearest = Math.round(getCenterFloat());
            const realIdx = isInfinite
                ? _wrapIdx(nearest - offset, real)
                : Math.max(0, Math.min(real - 1, nearest));
            const dots = dotsEl.querySelectorAll('.carousel-dot');
            dots.forEach((dot, i) => {
                const active = i === realIdx;
                dot.classList.toggle('active', active);
                dot.setAttribute('aria-selected', active ? 'true' : 'false');
            });
        }

        // ── Infinite-loop recentering after scroll stops ────────
        function recenterIfNeeded() {
            if (!isInfinite) return;
            const cf   = getCenterFloat();
            const unit = getUnit();
            const jump = real * unit;
            if (cf >= offset + real)      viewport.scrollLeft -= jump;
            else if (cf < offset)         viewport.scrollLeft += jump;
        }

        // ── Scroll lifecycle (single passive listener + rAF) ────
        let _rafPending  = false;
        let _scrollTimer = null;
        let _isScrolling = false;
        const _supportsScrollEnd = 'onscrollend' in window;

        function onScrollFrame() {
            _rafPending = false;
            apply3D();
            updateDots();
        }

        function onScrollEnd() {
            _isScrolling = false;
            viewport.classList.remove('is-scrolling');
            recenterIfNeeded();

            // Nudge to exact slide boundary when CSS-snap rests slightly off
            const nearest = Math.round(getCenterFloat());
            const first   = slides.length ? slides[0].offsetLeft : 0;
            const unit    = getUnit();
            const target  = first + nearest * unit;
            if (Math.abs(viewport.scrollLeft - target) > 4) {
                viewport.scrollTo({ left: target, behavior: 'smooth' });
            }
            // Final pass after either the snap or the recenter
            requestAnimationFrame(() => { apply3D(); updateDots(); });
        }

        viewport.addEventListener('scroll', () => {
            if (!_isScrolling) {
                _isScrolling = true;
                viewport.classList.add('is-scrolling');
            }
            if (!_rafPending) {
                _rafPending = true;
                requestAnimationFrame(onScrollFrame);
            }
            if (!_supportsScrollEnd) {
                clearTimeout(_scrollTimer);
                _scrollTimer = setTimeout(onScrollEnd, 110);
            }
        }, { passive: true, signal });

        if (_supportsScrollEnd) {
            viewport.addEventListener('scrollend', onScrollEnd, { passive: true, signal });
        }

        // ── Arrow & keyboard nav ───────────────────────────────
        function step(dir) {
            const nearest = Math.round(getCenterFloat());
            const targetSlideIdx = isInfinite
                ? nearest + dir
                : Math.max(0, Math.min(totalSlides - 1, nearest + dir));
            scrollToSlideIdx(targetSlideIdx, 'smooth');
        }

        if (prevBtn) prevBtn.addEventListener('click', () => step(-1), { signal });
        if (nextBtn) nextBtn.addEventListener('click', () => step(+1), { signal });

        viewport.setAttribute('tabindex', '0');
        viewport.addEventListener('keydown', (e) => {
            if (e.key === 'ArrowLeft')  { e.preventDefault(); step(-1); }
            else if (e.key === 'ArrowRight') { e.preventDefault(); step(+1); }
        }, { signal });

        // Mouse wheel → horizontal navigation on desktop
        viewport.addEventListener('wheel', (e) => {
            if (Math.abs(e.deltaX) > Math.abs(e.deltaY)) return; // already horizontal
            e.preventDefault();
            step(e.deltaY > 0 ? 1 : -1);
        }, { passive: false, signal });

        // ── Dot taps ───────────────────────────────────────────
        if (dotsEl) {
            dotsEl.querySelectorAll('.carousel-dot').forEach((dot) => {
                const idx = Number(dot.dataset.dot);
                dot.addEventListener('click', () => scrollToReal(idx, 'smooth'), { signal });
                dot.addEventListener('keydown', (e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault();
                        scrollToReal(idx, 'smooth');
                    }
                }, { signal });
            });
        }

        // ── Suppress accidental link click on swipe ─────────────
        let _moved = false, _sx = 0, _sy = 0;
        viewport.addEventListener('pointerdown', (e) => {
            _moved = false; _sx = e.clientX; _sy = e.clientY;
        }, { passive: true, signal });
        viewport.addEventListener('pointermove', (e) => {
            if (_moved) return;
            if (Math.abs(e.clientX - _sx) > 8 || Math.abs(e.clientY - _sy) > 8) _moved = true;
        }, { passive: true, signal });
        viewport.addEventListener('click', (e) => {
            if (_moved) { e.preventDefault(); e.stopPropagation(); }
        }, { capture: true, signal });

        // ── Initial layout & resize ────────────────────────────
        function layout(scrollBehavior) {
            setPadding();
            slides = Array.from(track.querySelectorAll('.carousel-slide'));
            scrollToSlideIdx(offset, scrollBehavior || 'auto');
            apply3D();
            updateDots();
        }

        let _resizeT = null;
        window.addEventListener('resize', () => {
            clearTimeout(_resizeT);
            _resizeT = setTimeout(() => {
                const nearest = Math.round(getCenterFloat());
                setPadding();
                slides = Array.from(track.querySelectorAll('.carousel-slide'));
                scrollToSlideIdx(nearest, 'auto');
                apply3D();
                updateDots();
            }, 150);
        }, { passive: true, signal });

        // First layout in next frame so widths are correct
        requestAnimationFrame(() => layout('auto'));

        const controller = {
            scrollToReal,
            destroy: () => abort.abort()
        };
        _carouselControllers.set(opts.viewportId, controller);
        return controller;
    }

    /* =========================================================
       PLAYER CAROUSEL – build cards & feed them to the engine
       ========================================================= */

    function buildPlayerCarouselCard(player, pts, rank) {
        const sign     = pts > 0 ? '+' : '';
        const url      = `spieleranalyse.html?playerId=${encodeURIComponent(player['player.id'])}`;
        const rankCls  = rank === 1 ? 'rank-1' : (rank === 2 ? 'rank-2' : (rank === 3 ? 'rank-3' : ''));
        const clubLogo = player['Club.logo'] || '';
        const clubName = player['Club.name'] || '';

        return `
            <div class="carousel-slide" role="listitem" aria-label="${escapeHtml(player.Spielername)}, ${sign}${pts} Punkte">
                <a class="carousel-card" href="${url}" draggable="false">
                    <div class="cc-rank-badge ${rankCls}">#${rank}</div>
                    <div class="cc-pts-badge">${sign}${pts}</div>
                    <img class="cc-photo" src="${escapeHtml(player.Spielerfoto)}" alt="${escapeHtml(player.Spielername)}" width="62" height="78" loading="eager" onerror="this.src='data:image/svg+xml,%3Csvg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 1 1%22/%3E'">
                    <div class="cc-name">${escapeHtml(player.Spielername)}</div>
                    ${player['Nationalteam.logo'] ? `
                    <div class="cc-meta">
                        <img class="cc-flag" src="${escapeHtml(player['Nationalteam.logo'])}" alt="${escapeHtml(player['Nationalteam.name'] || '')}" width="18" height="13" loading="eager">
                        <span class="cc-nation">${escapeHtml(player['Nationalteam.name'] || '')}</span>
                    </div>` : ''}
                    ${clubLogo ? `
                    <div class="cc-meta">
                        <img class="cc-club-logo" src="${escapeHtml(clubLogo)}" alt="${escapeHtml(clubName)}" width="18" height="18" loading="eager">
                        <span class="cc-nation">${escapeHtml(clubName)}</span>
                    </div>` : ''}
                </a>
            </div>
        `;
    }

    function renderPlayerCarousel(topPlayers, ptMap) {
        const track = $('post-carousel-track');
        if (!track) return;

        // Pick up to 15 players (one per nation)
        const MAX_PLAYERS = 15;
        const seenNations = new Set();
        const top = [];
        for (const p of topPlayers) {
            const nation = p['Nationalteam.name'];
            if (nation && seenNations.has(nation)) continue;
            if (nation) seenNations.add(nation);
            top.push(p);
            if (top.length >= MAX_PLAYERS) break;
        }

        if (!top.length) {
            track.innerHTML = `<div class="carousel-slide is-center"><div class="carousel-card"><div class="empty-state"><div class="empty-state-icon">⭐</div>Noch keine Punkte verfügbar.</div></div></div>`;
            return;
        }

        // Preload images to avoid layout shift on first paint
        top.forEach((p) => {
            if (p.Spielerfoto)          { const img = new Image(); img.src = p.Spielerfoto; }
            if (p['Club.logo'])         { const img = new Image(); img.src = p['Club.logo']; }
            if (p['Nationalteam.logo']) { const img = new Image(); img.src = p['Nationalteam.logo']; }
        });

        const cards = top.map((p, i) => buildPlayerCarouselCard(p, ptMap[String(p['player.id'])] || 0, i + 1));

        setupCarousel({
            trackId:    'post-carousel-track',
            viewportId: 'post-carousel-viewport',
            dotsId:     'post-carousel-dots',
            prevId:     'post-carousel-prev',
            nextId:     'post-carousel-next',
            cards,
            slideWidth: PLAYER_SLIDE_W,
            infinite:   true,
            dotLabel:   (i) => `Spieler ${i + 1}`
        });
    }

    /* =========================================================
       MANAGER CAROUSEL – ranking with mini history graph
       ---------------------------------------------------------
       • Infinite loop (after rank 1 you can scroll left to land
         on the lowest-ranked manager).
       • Center card is clickable to teams.html.
       • Mini sparkline under the manager name links directly to
         rangliste.html?view=history&manager=… so the user lands
         on that manager's chart.
       ========================================================= */

    function buildManagerRankTrendSvg(history, totalManagers) {
        const totalRanks = Math.max(totalManagers, 1);
        const values     = Array.isArray(history) ? history.map(h => h.rank).filter(v => Number.isFinite(v)) : [];
        if (!values.length) return '';

        const W = 150, H = 28, padX = 4, padY = 4;
        const step = values.length > 1 ? (W - padX * 2) / (values.length - 1) : 0;
        const innerH = H - padY * 2;

        const pts = values.map((r, i) => {
            const ratio = totalRanks <= 1 ? 0.5 : (r - 1) / (totalRanks - 1);
            const x = padX + i * step;
            const y = padY + ratio * innerH;
            return { x, y };
        });
        const polyline = pts.map(p => `${p.x.toFixed(2)},${p.y.toFixed(2)}`).join(' ');
        const last = pts[pts.length - 1];

        return `
            <svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" aria-hidden="true">
                <polyline points="${polyline}" fill="none" stroke="rgba(74,222,128,0.22)" stroke-width="5.5" stroke-linecap="round" stroke-linejoin="round"></polyline>
                <polyline points="${polyline}" fill="none" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" style="stroke:var(--green-light)"></polyline>
                <circle cx="${last.x.toFixed(2)}" cy="${last.y.toFixed(2)}" r="3.1" style="fill:var(--green-light)"></circle>
            </svg>
        `;
    }

    function buildManagerCarouselCard(manager, rank, total, avatars, history, totalManagers) {
        const sign    = total > 0 ? '+' : '';
        const rankCls = rank === 1 ? 'rank-1' : (rank === 2 ? 'rank-2' : (rank === 3 ? 'rank-3' : ''));
        const trendSvg = buildManagerRankTrendSvg(history, totalManagers);
        const trendHref = `rangliste.html?view=history&manager=${encodeURIComponent(manager)}`;

        // Avatar group (sorted by pts desc): 2nd left, 1st center, 3rd right
        let avatarHtml = '';
        if (avatars.length) {
            const wrap = (a, cls) => {
                const cap = a.isCaptain ? 'is-captain' : '';
                const href = a.id
                    ? `spieleranalyse.html?playerId=${encodeURIComponent(a.id)}`
                    : `spieleranalyse.html?player=${encodeURIComponent(a.name)}`;
                return `<a href="${href}" class="mc-avatar-wrap ${cls} ${cap}" aria-label="${escapeHtml(a.name)} analysieren">
                    <img src="${escapeHtml(a.photo)}" alt="${escapeHtml(a.name)}" loading="lazy" onerror="this.style.display='none'">
                </a>`;
            };
            if (avatars.length === 1)      avatarHtml = wrap(avatars[0], 'mc-center');
            else if (avatars.length === 2) avatarHtml = wrap(avatars[1], 'mc-side') + wrap(avatars[0], 'mc-center');
            else                           avatarHtml = wrap(avatars[1], 'mc-side') + wrap(avatars[0], 'mc-center') + wrap(avatars[2], 'mc-side2');
        } else {
            avatarHtml = `<div class="mc-avatar-placeholder">👤</div>`;
        }

        return `
            <div class="carousel-slide" role="listitem" aria-label="${escapeHtml(manager)}, Rang ${rank}, ${sign}${total} Punkte">
                <div class="carousel-card">
                    <a href="rangliste.html" class="mc-meta-link" aria-label="Zur Rangliste">
                        <div class="mc-rank-badge ${rankCls}">#${rank}</div>
                    </a>
                    <a href="rangliste.html" class="mc-meta-link" aria-label="Zur Rangliste">
                        <div class="mc-pts-badge">${sign}${total}</div>
                    </a>
                    <div class="mc-avatars">${avatarHtml}</div>
                    <a href="teams.html?manager=${encodeURIComponent(manager)}" class="mc-name-link" aria-label="Team von ${escapeHtml(manager)}">
                        <div class="mc-name">${escapeHtml(manager)}</div>
                    </a>
                    ${trendSvg ? `
                    <a href="${trendHref}" class="mc-rank-trend" aria-label="Historie von ${escapeHtml(manager)} öffnen">
                        ${trendSvg}
                    </a>` : `<div class="mc-rank-trend"></div>`}
                </div>
            </div>
        `;
    }

    function renderManagerCarousel(teamTotals, ptMap, teams) {
        const track = $('mgr-carousel-track');
        if (!track) return;

        if (!teamTotals.length) {
            track.innerHTML = `<div class="carousel-slide is-center"><div class="carousel-card"><div class="empty-state"><div class="empty-state-icon">🏆</div>Noch keine Ranglistendaten verfügbar.</div></div></div>`;
            return;
        }

        // Top-3 player avatars per manager (by points incl. captain bonus)
        function getMgrAvatars(manager) {
            const teamObj = teams.find(t => t.manager === manager);
            if (!teamObj) return [];
            return (teamObj.players || [])
                .map(tp => {
                    const full = resolvePlayer(tp);
                    if (!full) return null;
                    const base = ptMap[String(full['player.id'])] || 0;
                    return {
                        id: String(full['player.id']),
                        pts: tp.isCaptain ? base * 2 : base,
                        photo: full.Spielerfoto,
                        name:  full.Spielername,
                        isCaptain: !!tp.isCaptain
                    };
                })
                .filter(Boolean)
                .sort((a, b) => b.pts - a.pts)
                .slice(0, 3);
        }

        const cards = teamTotals.map((t, i) => {
            const rank = getDisplayedManagerRank(t, i + 1);
            return buildManagerCarouselCard(t.manager, rank, t.total, getMgrAvatars(t.manager), t.history, teamTotals.length);
        });

        // Infinite loop only when ≥ 2 managers (otherwise the
        // “endless” effect would be just one card duplicated).
        const infinite = teamTotals.length > 1;

        setupCarousel({
            trackId:    'mgr-carousel-track',
            viewportId: 'mgr-carousel-viewport',
            dotsId:     'mgr-carousel-dots',
            prevId:     'mgr-carousel-prev',
            nextId:     'mgr-carousel-next',
            cards,
            slideWidth: MGR_SLIDE_W,
            infinite,
            slideClass: (i) => i === 0 ? 'mgr-carousel-rank-1' : '',
            dotLabel:   (i) => `Manager ${i + 1}`
        });
    }

    /* =========================================================
       COUNTRY NORMALIZATION HELPERS
       (used for matching player nationality with fixture teams)
       ========================================================= */

    /**
     * Normalize a country name/code to a canonical lower-case key.
     * This handles API variations like "Spain" / "Spanien" / "ESP" etc.
     */
    function normalizeCountry(value) {
        if (!value) return '';
        if (typeof getCanonicalCountryKey === 'function') {
            return getCanonicalCountryKey(value);
        }
        const s = String(value)
            .normalize('NFD')
            .replace(/[\u0300-\u036f]/g, '')
            .trim()
            .toLowerCase();

        // Direct alias map for common Nationalmannschafts-Bezeichnungen
        // (turnierübergreifend; wird bei Bedarf für neue Turniere erweitert)
        const aliases = {
            // Albanian
            'albania': 'albania', 'albanien': 'albania', 'alb': 'albania',
            // Austrian
            'austria': 'austria', 'österreich': 'austria', 'aut': 'austria',
            // Belgian
            'belgium': 'belgium', 'belgien': 'belgium', 'bel': 'belgium',
            // Croatian
            'croatia': 'croatia', 'kroatien': 'croatia', 'cro': 'croatia', 'hrv': 'croatia',
            // Czech
            'czech republic': 'czech republic', 'tschechien': 'czech republic', 'czechia': 'czech republic', 'cze': 'czech republic',
            // Danish
            'denmark': 'denmark', 'dänemark': 'denmark', 'den': 'denmark',
            // English
            'england': 'england', 'eng': 'england',
            // French
            'france': 'france', 'frankreich': 'france', 'fra': 'france',
            // Georgian
            'georgia': 'georgia', 'georgien': 'georgia', 'geo': 'georgia',
            // German
            'germany': 'germany', 'deutschland': 'germany', 'ger': 'germany', 'deu': 'germany',
            // Hungarian
            'hungary': 'hungary', 'ungarn': 'hungary', 'hun': 'hungary',
            // Italian
            'italy': 'italy', 'italien': 'italy', 'ita': 'italy',
            // Dutch
            'netherlands': 'netherlands', 'niederlande': 'netherlands', 'holland': 'netherlands', 'ned': 'netherlands', 'nld': 'netherlands',
            // Polish
            'poland': 'poland', 'polen': 'poland', 'pol': 'poland',
            // Portuguese
            'portugal': 'portugal', 'por': 'portugal',
            // Romanian
            'romania': 'romania', 'rumänien': 'romania', 'rou': 'romania',
            // Scottish
            'scotland': 'scotland', 'schottland': 'scotland', 'sco': 'scotland',
            // Serbian
            'serbia': 'serbia', 'serbien': 'serbia', 'srb': 'serbia',
            // Slovak
            'slovakia': 'slovakia', 'slowakei': 'slovakia', 'svk': 'slovakia',
            // Slovenian
            'slovenia': 'slovenia', 'slowenien': 'slovenia', 'svn': 'slovenia',
            // Spanish
            'spain': 'spain', 'spanien': 'spain', 'esp': 'spain',
            // Swiss
            'switzerland': 'switzerland', 'schweiz': 'switzerland', 'sui': 'switzerland', 'che': 'switzerland',
            // Turkish
            'türkiye': 'türkiye', 'turkey': 'türkiye', 'turkiye': 'türkiye', 'türkei': 'türkiye', 'tur': 'türkiye',
            // Ukrainian
            'ukraine': 'ukraine', 'ukr': 'ukraine',
        };

        return aliases[s] || s;
    }

    /**
     * Return all normalized country keys for a player object.
     */
    function getPlayerCountryKeys(player) {
        const keys = new Set();
        const fields = [
            player['Nationalteam.name'],
            player.nationality,
            player.nation,
            player.country,
            player.countryCode,
            player.countryName
        ];
        fields.forEach(v => {
            const k = normalizeCountry(v);
            if (k) keys.add(k);
        });
        return keys;
    }

    /**
     * Return all normalized team keys for a fixture.
     */
    function getFixtureTeamKeys(fixture) {
        const keys = new Set();
        const fields = [
            fixture.teamA, fixture.homeTeam, fixture.home,
            fixture.teamB, fixture.awayTeam, fixture.away,
            fixture.homeCountry, fixture.awayCountry
        ];
        fields.forEach(v => {
            const k = normalizeCountry(v);
            if (k) keys.add(k);
        });
        return keys;
    }

    /**
     * Returns true if the player's nationality matches either team in the fixture.
     */
    function isPlayerInFixture(player, fixture) {
        const playerKeys = getPlayerCountryKeys(player);
        if (!playerKeys.size) return false;

        const homeKey = normalizeCountry(fixture.teamA || fixture.homeTeam || fixture.home || '');
        const awayKey = normalizeCountry(fixture.teamB || fixture.awayTeam || fixture.away || '');

        for (const pk of playerKeys) {
            if (pk && (pk === homeKey || pk === awayKey)) return true;
        }
        return false;
    }

    /* =========================================================
       NEXT MATCHES (Post-Start) with drafted players
       ========================================================= */

    // Fallback-Spiele werden zentral pro Turnier in tournament-config.js
    // gepflegt (APP_CONFIG.fallbackFixtures). Nur verwendet, wenn keine
    // echten Spiele aus Firestore/Cache verfügbar sind.
    function getTournamentFallbackFixtures() {
        const list = (window.APP_CONFIG && window.APP_CONFIG.fallbackFixtures) || [];
        return Array.isArray(list) ? list : [];
    }

    const FINISHED_MATCH_STATUSES = ['FT', 'AET', 'PEN'];
    const LIVE_MATCH_STATUSES = ['1H', '2H', 'HT', 'ET', 'BT', 'P', 'SUSP', 'INT', 'LIVE'];
    const OPTIMISTIC_LIVE_WINDOW_MIN = 150;
    const PREMATCH_COUNTDOWN_WINDOW_MIN = 30;
    const MAX_NEXT_MATCH_CARDS = 6;
    const MAX_FUTURE_MATCH_CARDS = 4;

    function isMatchFinishedStatus(statusShort) {
        return FINISHED_MATCH_STATUSES.includes(String(statusShort || '').toUpperCase());
    }

    function isMatchLiveStatus(statusShort) {
        return LIVE_MATCH_STATUSES.includes(String(statusShort || '').toUpperCase());
    }

    function normalizeFixtureEpochMs(value) {
        if (value === undefined || value === null || value === '') return null;
        if (typeof value.toMillis === 'function') {
            const ms = Number(value.toMillis());
            return Number.isFinite(ms) && ms > 0 ? ms : null;
        }
        if (typeof value.toDate === 'function') {
            const date = value.toDate();
            const ms = date instanceof Date ? date.getTime() : NaN;
            return Number.isFinite(ms) && ms > 0 ? ms : null;
        }
        if (value instanceof Date) {
            const ms = value.getTime();
            return Number.isFinite(ms) && ms > 0 ? ms : null;
        }
        if (typeof value === 'number') {
            if (!Number.isFinite(value) || value <= 0) return null;
            return value >= 100000000000 ? value : value * 1000;
        }
        if (typeof value === 'string') {
            const raw = value.trim();
            if (!raw) return null;
            const numeric = Number(raw);
            if (Number.isFinite(numeric)) return normalizeFixtureEpochMs(numeric);
            const parsed = Date.parse(raw);
            return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
        }
        if (typeof value === 'object') {
            const seconds = Number(value.seconds ?? value._seconds);
            if (Number.isFinite(seconds) && seconds > 0) {
                const nanos = Number(value.nanoseconds ?? value._nanoseconds ?? 0);
                return seconds * 1000 + (Number.isFinite(nanos) ? Math.floor(nanos / 1000000) : 0);
            }
        }
        return null;
    }

    function firstFixtureEpochMs(values) {
        for (const value of values) {
            const ms = normalizeFixtureEpochMs(value);
            if (ms) return ms;
        }
        return null;
    }

    function getMatchKickoffMs(match) {
        return firstFixtureEpochMs([
            match?.kickoffMs,
            match?.kickoffTimestamp,
            match?.kickoffIso,
            match?.fixture?.timestamp,
            match?.fixture?.date,
            match?.date,
            match?.datetime,
            match?.kickoff
        ]);
    }

    function getMatchTimingState(match, referenceMs = Date.now()) {
        const statusShort = match?.statusShort || match?.status?.short || '';
        const kickoffMs = getMatchKickoffMs(match);
        const isFinished = isMatchFinishedStatus(statusShort);
        const explicitLive = isMatchLiveStatus(statusShort);
        const elapsedMs = kickoffMs ? referenceMs - kickoffMs : null;
        const optimisticLive = !isFinished && !explicitLive && elapsedMs !== null && elapsedMs >= 0 && elapsedMs <= OPTIMISTIC_LIVE_WINDOW_MIN * 60000;
        const updateOpen = !isFinished && !explicitLive && elapsedMs !== null && elapsedMs > OPTIMISTIC_LIVE_WINDOW_MIN * 60000;
        return {
            kickoffMs,
            isFinished,
            isLive: explicitLive || optimisticLive,
            isUpdateOpen: updateOpen
        };
    }

    function getFinishedMatchReferenceMs(match, timingState) {
        return firstFixtureEpochMs([
            match?.finishedAtMs,
            match?.finishedAt,
            match?.fulltimeAt,
            match?.endedAt,
            timingState?.kickoffMs
        ]);
    }

    function compareMatchEntriesByKickoff(a, b) {
        const da = getMatchOrderingMs(a.match);
        const db = getMatchOrderingMs(b.match);
        if (da !== db) return da - db;
        return String(a.match?.id || a.match?.gameNumber || a.match?.matchId || '')
            .localeCompare(String(b.match?.id || b.match?.gameNumber || b.match?.matchId || ''), 'de');
    }

    function compareFinishedMatchEntriesByRecency(a, b) {
        const da = getFinishedMatchReferenceMs(a.match, a.timingState) || 0;
        const db = getFinishedMatchReferenceMs(b.match, b.timingState) || 0;
        if (da !== db) return db - da;
        return String(b.match?.id || b.match?.gameNumber || b.match?.matchId || '')
            .localeCompare(String(a.match?.id || a.match?.gameNumber || a.match?.matchId || ''), 'de');
    }

    function formatMatchLiveMinute(match) {
        const statusShort = String(match?.statusShort || match?.status?.short || '').toUpperCase();
        const elapsedRaw = match?.statusElapsed ?? match?.status?.elapsed;
        const elapsed = elapsedRaw !== undefined && elapsedRaw !== null ? Number(elapsedRaw) : null;
        if (Number.isFinite(elapsed) && elapsed > 0) return `Live ${elapsed}. Min`;
        if (statusShort === 'HT') return 'Halbzeit';
        if (statusShort === 'BT') return 'Pause';
        if (statusShort === 'SUSP' || statusShort === 'INT') return 'Unterbrochen';
        if (statusShort === 'ET') return 'Verlaengerung';
        if (statusShort === 'P') return 'Elfmeterschiessen';
        return 'Live';
    }

    function formatPrematchCountdown(diffMin) {
        const minutes = Math.max(1, Math.ceil(Number(diffMin) || 0));
        return minutes === 1 ? 'Live in 1 Minute' : `Live in ${minutes} Minuten`;
    }

    function getMatchScoreParts(match) {
        const goals = match?.goals || {};
        const score = match?.score || {};
        const fulltime = score.fulltime || score.fullTime || score.ft || {};
        const regular = score.regular || score.regularTime || {};
        const home = goals.home ?? goals.homeGoals ?? goals.homeTeam ?? score.home ?? score.homeGoals ?? fulltime.home ?? fulltime.homeGoals ?? regular.home ?? match?.goalsHome ?? match?.homeGoals ?? match?.scoreHome ?? match?.homeScore ?? null;
        const away = goals.away ?? goals.awayGoals ?? goals.awayTeam ?? score.away ?? score.awayGoals ?? fulltime.away ?? fulltime.awayGoals ?? regular.away ?? match?.goalsAway ?? match?.awayGoals ?? match?.scoreAway ?? match?.awayScore ?? null;
        if (home === null && away === null) return null;
        return { home: home ?? 0, away: away ?? 0 };
    }

    function getGoalEventName(...values) {
        for (const value of values) {
            if (value === undefined || value === null) continue;
            if (typeof value === 'object') {
                const nested = getGoalEventName(
                    value.name,
                    value.fullName,
                    value.playerName,
                    value.teamName,
                    value.displayName,
                    value.value,
                    value.stringValue
                );
                if (nested) return nested;
                continue;
            }
            const text = String(value).replace(/\s+/g, ' ').trim();
            if (text) return text;
        }
        return '';
    }

    function getGoalEventNumber(...values) {
        for (const value of values) {
            if (value === undefined || value === null || value === '') continue;
            if (typeof value === 'object') {
                const nested = getGoalEventNumber(
                    value.value,
                    value.integerValue,
                    value.doubleValue,
                    value.seconds
                );
                if (nested !== null) return nested;
                continue;
            }
            const n = Number(value);
            if (Number.isFinite(n)) return n;
        }
        return null;
    }

    function getGoalEventArray(value) {
        if (Array.isArray(value)) return value;
        if (value && typeof value === 'object') return Object.values(value).filter(Boolean);
        return [];
    }

    function shortenGoalEventPersonDisplayName(value) {
        const cleanName = getGoalEventName(value).replace(/\s*\([^)]*\)\s*/g, ' ').replace(/\s+/g, ' ').trim();
        const parts = cleanName.split(/\s+/).filter(Boolean);
        if (parts.length < 2) return cleanName;
        const first = parts[0].replace(/\./g, '');
        if (!first) return cleanName;
        return `${first.charAt(0).toUpperCase()}. ${parts.slice(1).join(' ')}`;
    }

    function formatGoalEventPersonName(value) {
        return shortenGoalEventPersonDisplayName(value);
    }

    function normalizeGoalPersonLookupName(value) {
        return String(value || '')
            .normalize('NFD')
            .replace(/[\u0300-\u036f]/g, '')
            .replace(/\./g, '')
            .replace(/\s+/g, ' ')
            .trim()
            .toLowerCase();
    }

    function getPlayerShortName(player) {
        const fullName = player && player.Spielername ? String(player.Spielername).trim() : '';
        const parts = fullName.split(/\s+/).filter(Boolean);
        if (parts.length < 2) return fullName;
        return `${parts[0].charAt(0)} ${parts.slice(1).join(' ')}`;
    }

    function findGoalEventPlayer(playerId, displayName, teamName) {
        if (playerId !== undefined && playerId !== null && playerId !== '') {
            const byId = getPlayerById(playerId);
            if (byId) return byId;
        }

        const cleanName = formatGoalEventPersonName(displayName);
        if (!cleanName) return null;

        const targetName = normalizeGoalPersonLookupName(cleanName);
        const teamKey = normalizeCountry(teamName);
        const matchesName = (player) => {
            if (!player) return false;
            const full = normalizeGoalPersonLookupName(player.Spielername);
            const short = normalizeGoalPersonLookupName(getPlayerShortName(player));
            const last = normalizeGoalPersonLookupName(String(player.Spielername || '').split(/\s+/).filter(Boolean).slice(-1)[0] || '');
            return targetName === full || targetName === short || (!!last && targetName === last);
        };
        const candidates = playersData.filter((player) => {
            if (!player) return false;
            if (teamKey && normalizeCountry(player['Nationalteam.name']) !== teamKey) return false;
            return matchesName(player);
        });
        if (candidates.length === 1) return candidates[0];
        if (teamKey) {
            const globalCandidates = playersData.filter(matchesName);
            if (globalCandidates.length === 1) return globalCandidates[0];
        }
        return null;
    }

    function renderGoalEventPerson(name, playerId, teamName, className) {
        const displayName = formatGoalEventPersonName(name) || getGoalEventName(name);
        if (!displayName) return '';
        const player = findGoalEventPlayer(playerId, displayName, teamName);
        const href = player
            ? `spieleranalyse.html?playerId=${encodeURIComponent(player['player.id'])}`
            : `spieleranalyse.html?player=${encodeURIComponent(displayName)}`;
        return `<a class="${className}" href="${escapeHtml(href)}" title="${escapeHtml(displayName)} analysieren" aria-label="${escapeHtml(displayName)} analysieren">${escapeHtml(displayName)}</a>`;
    }

    function normalizeGoalEvent(raw) {
        const time = raw?.time || {};
        const team = raw?.team || {};
        const player = raw?.player || {};
        const assist = raw?.assist || {};
        return {
            elapsed: getGoalEventNumber(raw?.elapsed, raw?.minute, time.elapsed, time.minute),
            extra: getGoalEventNumber(raw?.extra, time.extra),
            teamId: getGoalEventName(raw?.teamId, team.id),
            teamName: getGoalEventName(raw?.teamName, team.name, team),
            playerId: getGoalEventName(raw?.playerId, player.id),
            playerName: getGoalEventName(raw?.playerName, player.name, player),
            assistId: getGoalEventName(raw?.assistId, assist.id),
            assistName: getGoalEventName(raw?.assistName, assist.name, assist),
            detail: getGoalEventName(raw?.detail),
            type: getGoalEventName(raw?.type)
        };
    }

    function getMatchGoalEvents(match) {
        const storedGoalEvents = getGoalEventArray(match?.goalEvents);
        const source = storedGoalEvents.length
            ? storedGoalEvents
            : getGoalEventArray(match?.events).filter((event) => {
                const type = String(event?.type || '').toLowerCase();
                const detail = String(event?.detail || '').toLowerCase();
                return type === 'goal' && !detail.includes('missed');
            });

        return source
            .map(normalizeGoalEvent)
            .filter((event) => event.playerName && !String(event.detail || '').toLowerCase().includes('missed'))
            .sort((a, b) => {
                const elapsedA = a.elapsed ?? 999;
                const elapsedB = b.elapsed ?? 999;
                if (elapsedA !== elapsedB) return elapsedA - elapsedB;
                const extraA = a.extra ?? 0;
                const extraB = b.extra ?? 0;
                if (extraA !== extraB) return extraA - extraB;
                return a.playerName.localeCompare(b.playerName, 'de');
            });
    }

    function formatGoalMinute(event) {
        if (!Number.isFinite(event.elapsed)) return '';
        return `${event.elapsed}${Number.isFinite(event.extra) && event.extra > 0 ? '+' + event.extra : ''}'`;
    }

    function isOwnGoalEvent(event) {
        return String(event?.detail || '').toLowerCase().includes('own goal');
    }

    function isPenaltyGoalEvent(event) {
        const detail = String(event?.detail || '').toLowerCase();
        const type = String(event?.type || '').toLowerCase();
        return detail.includes('penalty') || type.includes('penalty');
    }

    function getMatchTeamIdsForName(match, teamName) {
        const teamKey = normalizeCountry(teamName);
        const ids = [];
        const homeName = match?.teamA || match?.homeTeam || match?.home || '';
        const awayName = match?.teamB || match?.awayTeam || match?.away || '';
        if (teamKey && normalizeCountry(homeName) === teamKey) {
            ids.push(match?.teamAId, match?.homeTeamId, match?.homeId);
        }
        if (teamKey && normalizeCountry(awayName) === teamKey) {
            ids.push(match?.teamBId, match?.awayTeamId, match?.awayId);
        }
        return new Set(ids.filter(value => value !== undefined && value !== null && value !== '').map(value => String(value)));
    }

    function renderGoalEventList(match, teamName, classPrefix = 'nm') {
        const teamKey = normalizeCountry(teamName);
        const teamIds = getMatchTeamIdsForName(match, teamName);
        const events = getMatchGoalEvents(match).filter((event) => {
            if (event.teamId && teamIds.has(String(event.teamId))) return true;
            const eventTeamKey = normalizeCountry(event.teamName);
            return eventTeamKey && eventTeamKey === teamKey;
        });
        if (!events.length) return '';

        const rows = events.map((event) => {
            const minute = formatGoalMinute(event);
            const scorer = formatGoalEventPersonName(event.playerName) || event.playerName;
            const assist = formatGoalEventPersonName(event.assistName);
            const scorerHtml = renderGoalEventPerson(scorer, event.playerId, event.teamName || teamName, `${classPrefix}-goal-player`);
            const penaltyHtml = isPenaltyGoalEvent(event)
                ? ` <span class="${classPrefix}-goal-penalty">(P)</span>`
                : '';
            const assistPlayerHtml = assist
                ? renderGoalEventPerson(assist, event.assistId, event.teamName || teamName, `${classPrefix}-goal-assist-player`)
                : '';
            const assistHtml = assist
                ? ` <span class="${classPrefix}-goal-assist">(${assistPlayerHtml || escapeHtml(assist)})</span>`
                : (isOwnGoalEvent(event) ? ` <span class="${classPrefix}-goal-own">(Eigentor)</span>` : '');
            return `<div class="${classPrefix}-goal-row">${minute ? `<span class="${classPrefix}-goal-minute">${escapeHtml(minute)}</span>` : ''}<span class="${classPrefix}-goal-text"><span class="${classPrefix}-goal-line">${scorerHtml || escapeHtml(scorer)}${penaltyHtml}${assistHtml}</span></span></div>`;
        }).join('');

        return `<div class="${classPrefix}-goals-list" aria-label="Torschuetzen ${escapeHtml(teamName)}">${rows}</div>`;
    }

    function refreshGoalLineOverflow(root = document) {
        const scope = root && typeof root.querySelectorAll === 'function' ? root : document;
        const apply = () => {
            scope.querySelectorAll('.nm-goal-text').forEach((textEl) => {
                const lineEl = textEl.querySelector('.nm-goal-line');
                const isVisible = textEl.getClientRects().length > 0 && textEl.clientWidth > 0;
                const isOverflowing = isVisible && lineEl && lineEl.scrollWidth > textEl.clientWidth + 1;
                textEl.classList.toggle('has-scroll', !!isOverflowing);
            });
        };
        apply();
        requestAnimationFrame(apply);
    }

    function sumPointBucket(value) {
        if (typeof value === 'number' && Number.isFinite(value)) return value;
        if (!value || typeof value !== 'object') return 0;

        const explicitTotal = value.TotalPunkte ?? value.Punkte;
        if (typeof explicitTotal === 'number' && Number.isFinite(explicitTotal)) return explicitTotal;

        const lineup = value.Aufstellung;
        if (lineup && typeof lineup === 'object' && !Array.isArray(lineup)) {
            return sumPointBucket(lineup);
        }

        const metaKeys = new Set(['MatchID', 'matchId', 'fixtureId', 'id']);
        return Object.entries(value).reduce((sum, [key, item]) => {
            if (metaKeys.has(key)) return sum;
            return sum + (typeof item === 'number' && Number.isFinite(item) ? item : 0);
        }, 0);
    }

    function getPlayerFixturePoint(doc, matchId) {
        const numericId = Number(matchId);

        for (const [key, val] of Object.entries(doc || {})) {
            if (!key.startsWith('Spiel_') || !val || typeof val !== 'object') continue;

            const keyId = key.replace(/^Spiel_/, '');
            const rawId = val.MatchID ?? val.matchId ?? val.fixtureId ?? val.id ?? keyId;
            const sameStringId = rawId !== undefined && String(rawId) === String(matchId);
            const sameNumericId = Number.isFinite(numericId) && Number(rawId) === numericId;
            if (sameStringId || sameNumericId) return val;
        }

        return null;
    }

    function getPlayerMatchPoints(data, playerId, matchId) {
        if (!data || playerId === undefined || playerId === null || matchId === undefined || matchId === null) return null;
        const doc = data.points?.[String(playerId)];
        if (!doc || typeof doc !== 'object') return null;

        const fixturePoint = getPlayerFixturePoint(doc, matchId);
        if (fixturePoint) return sumPointBucket(fixturePoint);

        const matchKeys = [String(matchId)];
        const numericId = Number(matchId);
        if (Number.isFinite(numericId)) matchKeys.push(String(numericId));

        const matches = doc.matches || {};
        for (const key of matchKeys) {
            if (Object.prototype.hasOwnProperty.call(matches, key)) {
                return sumPointBucket(matches[key]);
            }
        }

        return null;
    }

    function formatSignedPoints(points) {
        const value = Number(points) || 0;
        return `${value > 0 ? '+' : ''}${value}`;
    }

    function getPointsClass(points) {
        const value = Number(points) || 0;
        if (value > 0) return 'pos';
        if (value < 0) return 'neg';
        return 'zero';
    }

    const SWISS_TIME_ZONE = 'Europe/Zurich';
    const swissDatePartsFormatter = new Intl.DateTimeFormat('en-CA', {
        timeZone: SWISS_TIME_ZONE,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit'
    });

    function getSwissDateParts(date) {
        if (!(date instanceof Date) || Number.isNaN(date.getTime())) return null;
        const parts = {};
        swissDatePartsFormatter.formatToParts(date).forEach((part) => {
            if (part.type !== 'literal') parts[part.type] = part.value;
        });
        const year = Number(parts.year);
        const month = Number(parts.month);
        const day = Number(parts.day);
        if (!Number.isFinite(year) || !Number.isFinite(month) || !Number.isFinite(day)) return null;
        return { year, month, day };
    }

    function getSwissDayNumber(date) {
        const parts = getSwissDateParts(date);
        if (!parts) return null;
        return Math.floor(Date.UTC(parts.year, parts.month - 1, parts.day) / 86400000);
    }

    function getSwissCalendarDayDiff(matchDate, referenceMs) {
        const matchDay = getSwissDayNumber(matchDate);
        const referenceDay = getSwissDayNumber(new Date(referenceMs));
        if (matchDay === null || referenceDay === null) return null;
        return matchDay - referenceDay;
    }

    function formatSwissMatchTime(date) {
        return date.toLocaleTimeString('de-CH', {
            timeZone: SWISS_TIME_ZONE,
            hour: '2-digit',
            minute: '2-digit'
        });
    }

    function formatSwissMatchDate(date) {
        return date.toLocaleDateString('de-CH', {
            timeZone: SWISS_TIME_ZONE,
            weekday: 'short',
            day: '2-digit',
            month: '2-digit'
        });
    }

    function getDraftedPointsSummary(players, data, matchId) {
        return (players || []).reduce((acc, item) => {
            const player = item?.player || item;
            if (!player) return acc;
            const pts = getPlayerMatchPoints(data, player['player.id'], matchId);
            if (pts === null) return acc;
            acc.total += Number(pts) || 0;
            acc.count += 1;
            return acc;
        }, { total: 0, count: 0 });
    }

    function getMatchOrderingMs(match) {
        return getMatchKickoffMs(match) || Number.MAX_SAFE_INTEGER;
    }

    function getMatchIdentityKeys(match) {
        if (!match) return [];
        const keys = [];
        ['fixtureId', 'id', 'gameNumber', 'matchId'].forEach((field) => {
            if (match[field] !== undefined && match[field] !== null && match[field] !== '') {
                keys.push(`${field}:${match[field]}`);
            }
        });
        const date = match.date || match.datetime || match.kickoff || '';
        const home = match.teamA || match.home || match.homeTeam || '';
        const away = match.teamB || match.away || match.awayTeam || '';
        if (date || home || away) keys.push(`pair:${date}|${home}|${away}`);
        return Array.from(new Set(keys));
    }

    function buildMatchNumberLookup(matches) {
        const lookup = new Map();
        const ordered = [...(matches || [])].sort((a, b) => {
            const da = getMatchOrderingMs(a);
            const db = getMatchOrderingMs(b);
            if (da !== db) return da - db;
            return String(a.id || a.gameNumber || a.matchId || '').localeCompare(String(b.id || b.gameNumber || b.matchId || ''), 'de');
        });
        ordered.forEach((match, idx) => {
            getMatchIdentityKeys(match).forEach((key) => lookup.set(key, idx + 1));
        });
        return lookup;
    }

    function getMatchDisplayNumber(match, lookup) {
        for (const key of getMatchIdentityKeys(match)) {
            const n = lookup.get(key);
            if (n) return n;
        }
        return null;
    }

    const expandedNextMatchKeys = new Set();

    function getNextMatchKey(match, index = 0) {
        return getMatchIdentityKeys(match)[0] || `index:${index}`;
    }

    function getManagerDisplayName(name) {
        const trimmed = String(name || '').trim();
        return trimmed || 'Manager';
    }

    window.toggleNextMatchDetails = function(btn) {
        if (!btn) return;
        const row = btn.closest('.nm-match-row');
        if (!row) return;
        const key = row.dataset.matchKey || '';
        const label = row.dataset.matchLabel || '';
        const details = row.querySelector('.nm-match-details');
        const expanded = !row.classList.contains('is-expanded');

        row.classList.toggle('is-expanded', expanded);
        btn.setAttribute('aria-expanded', expanded ? 'true' : 'false');
        if (label) {
            btn.setAttribute('aria-label', `${label} - ${expanded ? 'Details ausblenden' : 'Details anzeigen'}`);
        }
        if (details) {
            if (expanded) details.removeAttribute('hidden');
            else details.setAttribute('hidden', '');
        }

        if (expanded) refreshGoalLineOverflow(row);

        if (key) {
            if (expanded) expandedNextMatchKeys.add(key);
            else expandedNextMatchKeys.delete(key);
        }
    };

    function renderNextMatchesTile(data, teams) {
        const container = $('tile-post-next-matches');
        if (!container) return;

        // Build drafted player lookup: playerId → { player, managers[] }
        const draftedPlayerManagers = {};
        (teams || []).forEach((t) => {
            const managerName = t.manager || 'Unbekannt';
            (t.players || []).forEach((tp) => {
                const full = resolvePlayer(tp);
                if (!full) return;
                const id = String(full['player.id']);
                if (!draftedPlayerManagers[id]) draftedPlayerManagers[id] = { player: full, managers: [] };
                if (!draftedPlayerManagers[id].managers.some((m) => m.manager === managerName)) {
                    draftedPlayerManagers[id].managers.push({ manager: managerName, isCaptain: !!tp.isCaptain });
                }
            });
        });
        Object.values(draftedPlayerManagers).forEach(({ managers }) => {
            managers.sort((a, b) => {
                if (a.isCaptain !== b.isCaptain) return a.isCaptain ? -1 : 1;
                return String(a.manager).localeCompare(String(b.manager), 'de');
            });
        });

        const matchInfos = extractMatchInfo(data);

        const now = Date.now();
        const enrichedMatches = matchInfos.map((match) => {
            const timingState = getMatchTimingState(match, now);
            return {
                match,
                timingState
            };
        });

        const liveMatches = enrichedMatches
            .filter(({ timingState }) => timingState.isLive)
            .sort(compareMatchEntriesByKickoff);
        const updateOpenMatches = enrichedMatches
            .filter(({ timingState }) => timingState.isUpdateOpen)
            .sort(compareMatchEntriesByKickoff);
        const upcomingFuture = enrichedMatches
            .filter(({ timingState }) => {
                return !timingState.isFinished && !timingState.isLive && !timingState.isUpdateOpen;
            })
            .sort(compareMatchEntriesByKickoff);
        const hasRunningMatch = liveMatches.length > 0 || updateOpenMatches.length > 0;
        const latestFinishedMatches = hasRunningMatch
            ? []
            : enrichedMatches
                .filter(({ timingState }) => timingState.isFinished)
                .sort(compareFinishedMatchEntriesByRecency)
                .slice(0, 2);
        const displayedFinishedMatches = new Set(latestFinishedMatches.map(({ match }) => match));
        const priorityMatches = [
            ...liveMatches,
            ...updateOpenMatches,
            ...latestFinishedMatches
        ];
        const futureSlots = Math.min(MAX_FUTURE_MATCH_CARDS, Math.max(0, MAX_NEXT_MATCH_CARDS - priorityMatches.length));

        let upcoming = [
            ...priorityMatches,
            ...upcomingFuture.slice(0, futureSlots)
        ].map(({ match }) => match);

        // If no real upcoming data available, use turnier-spezifische Fallbacks
        if (!upcoming.length) {
            upcoming = getTournamentFallbackFixtures();
        }

        if (!upcoming.length) {
            container.innerHTML = `<div class="empty-state"><div class="empty-state-icon">📅</div>Keine aktuellen Spiele gefunden.</div>`;
            return;
        }

        const scheduleContext = matchInfos.length ? matchInfos : upcoming;
        const html = upcoming.map((match, index) => {
            const matchId = match.gameNumber || match.matchId || match.id;
            let teamA = match.teamA || match.home || match.homeTeam || '';
            let teamB = match.teamB || match.away || match.awayTeam || '';
            let flagA = match.homeLogo || match.teamAFlag || '';
            let flagB = match.awayLogo || match.teamBFlag || '';
            const dateStr = match.date || match.datetime || match.kickoff || '';
            const statusShort = match.statusShort || match.status?.short || '';

            if (!teamA || !teamB) {
                const nations = getNationFromMatchGame(matchId, data);
                teamA = nations[0] || '?';
                teamB = nations[1] || '?';
            }

            const flagAFallback = getNationFlag(teamA);
            const flagBFallback = getNationFlag(teamB);

            const timingState = getMatchTimingState(match, now);
            let isLive = timingState.isLive;
            const isFinished = timingState.isFinished;
            const isDisplayedFinished = isFinished && displayedFinishedMatches.has(match);
            const isUpdateOpen = timingState.isUpdateOpen;
            const scoreParts = getMatchScoreParts(match);

            // Time display (upcoming/live)
            let timeBadgeText = '';
            let timeBadgeCls = '';
            let timeSubText = '';

            if (isFinished) {
                timeBadgeText = 'Abgeschlossen';
                timeBadgeCls = 'finished';
                if (timingState.kickoffMs) {
                    const kickoffDate = new Date(timingState.kickoffMs);
                    const swissDayDiff = getSwissCalendarDayDiff(kickoffDate, now);
                    const datePrefix = swissDayDiff === 0 ? '' : `${formatSwissMatchDate(kickoffDate)} `;
                    timeSubText = `${datePrefix}${formatSwissMatchTime(kickoffDate)}`;
                }
            } else if (isLive) {
                timeBadgeText = formatMatchLiveMinute(match);
                timeBadgeCls = 'live';
            } else if (isUpdateOpen) {
                timeBadgeText = 'Update offen';
                timeBadgeCls = 'pending';
                if (timingState.kickoffMs) timeSubText = formatSwissMatchTime(new Date(timingState.kickoffMs));
            } else if (dateStr || timingState.kickoffMs) {
                const matchMs = timingState.kickoffMs || new Date(dateStr).getTime();
                const matchDate = new Date(matchMs);
                if (!Number.isFinite(matchMs)) {
                    timeBadgeText = '-';
                } else {
                    const diffMin = (matchMs - now) / 60000;
                    const swissDayDiff = getSwissCalendarDayDiff(matchDate, now);
                    if (diffMin < 0 && diffMin >= -OPTIMISTIC_LIVE_WINDOW_MIN) {
                        isLive = true;
                        timeBadgeText = formatMatchLiveMinute(match);
                        timeBadgeCls = 'live';
                    } else if (diffMin >= 0 && diffMin <= PREMATCH_COUNTDOWN_WINDOW_MIN && swissDayDiff === 0) {
                        timeBadgeText = formatPrematchCountdown(diffMin);
                        timeBadgeCls = 'countdown';
                        timeSubText = formatSwissMatchTime(matchDate);
                    } else if (diffMin >= 0 && swissDayDiff === 0) {
                        timeBadgeText = 'Heute';
                        timeBadgeCls = 'today';
                        timeSubText = formatSwissMatchTime(matchDate);
                    } else if (diffMin >= 0 && swissDayDiff === 1) {
                        timeBadgeText = 'Morgen';
                        timeSubText = formatSwissMatchTime(matchDate);
                    } else {
                        timeBadgeText = formatSwissMatchDate(matchDate);
                        timeSubText = formatSwissMatchTime(matchDate);
                    }
                }
            } else {
                timeBadgeText = '–';
            }

            // Venue line
            const venueText = match.venue && match.venue !== 'Spielort folgt'
                ? `${match.venue}${match.venueCity ? ' · ' + match.venueCity : ''}`
                : '';

            // Separate drafted players by team side
            const homeKey = normalizeCountry(teamA);
            const awayKey = normalizeCountry(teamB);
            const draftedHome = Object.values(draftedPlayerManagers)
                .filter(({ player }) => {
                    const keys = getPlayerCountryKeys(player);
                    return Array.from(keys).some(k => k === homeKey);
                })
                .sort((a, b) => a.player.Spielername.localeCompare(b.player.Spielername, 'de'));

            const draftedAway = Object.values(draftedPlayerManagers)
                .filter(({ player }) => {
                    const keys = getPlayerCountryKeys(player);
                    return Array.from(keys).some(k => k === awayKey);
                })
                .sort((a, b) => a.player.Spielername.localeCompare(b.player.Spielername, 'de'));

            function buildPlayerCaptainBadge(managers) {
                const captains = (managers || []).filter((m) => m && m.isCaptain);
                if (!captains.length) return '';
                const names = captains.map((m) => getManagerDisplayName(m.manager)).filter(Boolean);
                const label = captains.length === 1
                    ? `Captain von ${names[0]}`
                    : `Captain von ${captains.length} Managern: ${names.join(', ')}`;
                return `<span class="nm-player-captain-badge" title="${escapeHtml(label)}" aria-hidden="true">C</span>`;
            }

            function buildChips(players) {
                return players.map(({ player, managers = [] }) => {
                    const url = `spieleranalyse.html?playerId=${encodeURIComponent(player['player.id'])}`;
                    const pts = getPlayerMatchPoints(data, player['player.id'], matchId);
                    const ptsHtml = pts !== null
                        ? `<span class="nm-player-points ${getPointsClass(pts)}">${escapeHtml(formatSignedPoints(pts))}</span>`
                        : '';
                    const ptsLabel = pts !== null ? `, ${formatSignedPoints(pts)} Punkte in diesem Spiel` : '';
                    const managerLabel = managers.length
                        ? ` - ${managers.map((m) => `${getManagerDisplayName(m.manager)}${m.isCaptain ? ' (C)' : ''}`).join(', ')}`
                        : '';
                    const captainBadge = buildPlayerCaptainBadge(managers);
                    return `<a class="nm-player-chip${pts !== null ? ' has-points' : ''}" href="${url}" draggable="false" title="${escapeHtml(player.Spielername + managerLabel)}" aria-label="${escapeHtml(player.Spielername)} analysieren${escapeHtml(ptsLabel)}"><img class="nm-player-photo" src="${escapeHtml(player.Spielerfoto)}" alt="${escapeHtml(player.Spielername)}" loading="lazy" width="44" height="44" onerror="this.style.display='none'">${captainBadge}${ptsHtml}</a>`;
                }).join('');
            }

            function buildManagerChips(managers) {
                return (managers || []).map((m) => {
                    const manager = getManagerDisplayName(m.manager);
                    const href = `teams.html?manager=${encodeURIComponent(manager)}`;
                    const captainHtml = m.isCaptain ? '<span class="nm-manager-cap" title="Captain">C</span>' : '';
                    const label = m.isCaptain
                        ? `${manager} (Captain) - Team oeffnen`
                        : `${manager} - Team oeffnen`;
                    return `<a class="nm-manager-chip${m.isCaptain ? ' is-captain' : ''}" href="${href}" title="${escapeHtml(label)}" aria-label="${escapeHtml(label)}">${captainHtml}<span class="nm-manager-name">${escapeHtml(manager)}</span></a>`;
                }).join('');
            }

            function buildDetailPlayerCards(players) {
                if (!players.length) {
                    return `<div class="nm-detail-empty">Keine gew&auml;hlten Spieler</div>`;
                }

                return players.map(({ player, managers = [] }) => {
                    const url = `spieleranalyse.html?playerId=${encodeURIComponent(player['player.id'])}`;
                    const pts = getPlayerMatchPoints(data, player['player.id'], matchId);
                    const ptsHtml = pts !== null
                        ? `<span class="nm-detail-player-points ${getPointsClass(pts)}">${escapeHtml(formatSignedPoints(pts))}</span>`
                        : '';
                    const position = player.Position || player.position || '';
                    const managerCount = managers.length === 1
                        ? 'Gew&auml;hlt von 1 Manager'
                        : `Gew&auml;hlt von ${managers.length} Managern`;
                    const captainBadge = buildPlayerCaptainBadge(managers);
                    return `<div class="nm-detail-player-card">
                        <a class="nm-detail-player-main" href="${url}" title="${escapeHtml(player.Spielername)} analysieren" aria-label="${escapeHtml(player.Spielername)} analysieren">
                            <span class="nm-detail-player-photo-wrap"><img class="nm-detail-player-photo" src="${escapeHtml(player.Spielerfoto)}" alt="${escapeHtml(player.Spielername)}" loading="lazy" onerror="this.style.display='none'">${captainBadge}</span>
                            <span class="nm-detail-player-copy">
                                <span class="nm-detail-player-name">${escapeHtml(player.Spielername)}</span>
                                ${position ? `<span class="nm-detail-player-meta">${escapeHtml(position)}</span>` : ''}
                            </span>
                            ${ptsHtml}
                        </a>
                        <div class="nm-detail-managers">
                            <div class="nm-detail-manager-head">${managerCount}</div>
                            <div class="nm-detail-manager-list">${buildManagerChips(managers)}</div>
                        </div>
                    </div>`;
                }).join('');
            }

            const homeGoalsHtml = renderGoalEventList(match, teamA, 'nm');
            const awayGoalsHtml = renderGoalEventList(match, teamB, 'nm');
            const homeChipsHtml = buildChips(draftedHome);
            const awayChipsHtml = buildChips(draftedAway);
            const hasPlayersOrGoals = !!(homeGoalsHtml || awayGoalsHtml || homeChipsHtml || awayChipsHtml);
            const playersRowClasses = [
                'nm-players-row',
                (homeGoalsHtml || awayGoalsHtml) ? 'has-goals' : '',
                (homeChipsHtml || awayChipsHtml) ? 'has-chips' : ''
            ].filter(Boolean).join(' ');
            const goalsRowHtml = (homeGoalsHtml || awayGoalsHtml) ? `
                    <div class="nm-players-side nm-goals-side left">
                        ${homeGoalsHtml}
                    </div>
                    <div class="nm-players-side nm-goals-side right">
                        ${awayGoalsHtml}
                    </div>` : '';
            const chipsRowHtml = (homeChipsHtml || awayChipsHtml) ? `
                    <div class="nm-players-side nm-chips-side left">
                        ${homeChipsHtml ? `<div class="nm-player-chips">${homeChipsHtml}</div>` : ''}
                    </div>
                    <div class="nm-players-side nm-chips-side right">
                        ${awayChipsHtml ? `<div class="nm-player-chips">${awayChipsHtml}</div>` : ''}
                    </div>` : '';
            const playersRowHtml = hasPlayersOrGoals ? `
                <div class="${playersRowClasses}">
                    <div class="nm-players-divider"></div>
                    ${goalsRowHtml}
                    ${chipsRowHtml}
                </div>` : '';

            const stageMatch = { ...match, teamA, teamB, round: match.round || '' };
            const stageLabel = APP && typeof APP.groupStageLabelForMatch === 'function'
                ? APP.groupStageLabelForMatch(stageMatch, { matches: scheduleContext })
                : '';
            const matchKey = getNextMatchKey(stageMatch, index);
            const detailId = `nm-detail-${index}-${String(matchKey).replace(/[^a-zA-Z0-9_-]/g, '-')}`;
            const isExpanded = expandedNextMatchKeys.has(matchKey);
            const matchLabel = `${teamA} gegen ${teamB}`;
            const detailAriaLabel = `${matchLabel} - ${isExpanded ? 'Details ausblenden' : 'Details anzeigen'}`;

            function buildDetailTeam(players, teamName, flagUrl, fallbackFlagUrl, alignRight = false) {
                const teamCls = alignRight ? 'nm-detail-team right' : 'nm-detail-team';
                return `<div class="${teamCls}">
                    <div class="nm-detail-team-head">
                        ${renderFlagImageHtml('nm-detail-team-flag', flagUrl, fallbackFlagUrl, teamName)}
                        <span class="nm-detail-team-name">${escapeHtml(teamName)}</span>
                    </div>
                    ${renderGoalEventList(match, teamName, 'nm')}
                    <div class="nm-detail-player-list">${buildDetailPlayerCards(players)}</div>
                </div>`;
            }

            const detailsHtml = `<div class="nm-match-details" id="${escapeHtml(detailId)}"${isExpanded ? '' : ' hidden'}>
                <div class="nm-detail-grid">
                    ${buildDetailTeam(draftedHome, teamA, flagA, flagAFallback, false)}
                    ${buildDetailTeam(draftedAway, teamB, flagB, flagBFallback, true)}
                </div>
            </div>`;

            const scoreHtml = (isLive || isFinished) && scoreParts ? `
                <div class="nm-score-display ${isLive ? 'live' : 'finished'}">${escapeHtml(String(scoreParts.home))}<span class="nm-score-sep">:</span>${escapeHtml(String(scoreParts.away))}</div>
            ` : '';

            return `
                <div class="nm-match-row${isLive ? ' live' : ''}${isDisplayedFinished ? ' finished' : ''}${isUpdateOpen ? ' pending' : ''}${isExpanded ? ' is-expanded' : ''}" data-match-key="${escapeHtml(matchKey)}" data-match-label="${escapeHtml(matchLabel)}">
                    <button type="button" class="nm-match-toggle-btn" onclick="toggleNextMatchDetails(this)" aria-expanded="${isExpanded ? 'true' : 'false'}" aria-controls="${escapeHtml(detailId)}" aria-label="${escapeHtml(detailAriaLabel)}">
                        <div class="nm-match-main">
                            <div class="nm-team-side">
                                ${renderFlagImageHtml('nm-team-flag', flagA, flagAFallback, teamA)}
                                <span class="nm-team-name">${escapeHtml(teamA)}</span>
                            </div>
                            <div class="nm-center-col">
                                <div class="nm-time-badge ${timeBadgeCls}">${escapeHtml(timeBadgeText)}</div>
                                ${scoreHtml}
                                ${stageLabel ? `<div class="nm-stage-label">${escapeHtml(stageLabel)}</div>` : ''}
                                ${timeSubText ? `<div class="nm-time-sub">${escapeHtml(timeSubText)}</div>` : ''}
                                ${venueText ? `<div class="nm-time-sub nm-venue-inline">${escapeHtml(venueText)}</div>` : ''}
                            </div>
                            <div class="nm-team-side right">
                                ${renderFlagImageHtml('nm-team-flag', flagB, flagBFallback, teamB)}
                                <span class="nm-team-name">${escapeHtml(teamB)}</span>
                            </div>
                        </div>
                        <span class="nm-detail-toggle" aria-hidden="true">&#9662;</span>
                    </button>
                    ${playersRowHtml}
                    ${detailsHtml}
                </div>
            `;
        }).join('');

        container.innerHTML = html;
        refreshGoalLineOverflow(container);
    }

    /* =========================================================
       POST START – Hero KPIs (4 numbers in glass tiles)
       ========================================================= */
    function renderPostHeroKpis(teams, ptMap, teamTotals, topPlayers) {
        const leaderEl = $('hs-post-leader');
        const leaderPtsEl = $('hs-post-leader-pts');
        const topPlayerPtsEl = $('hs-post-top-player-pts');
        const teamCountEl = $('hs-post-teams');

        if (leaderEl) {
            const top = teamTotals[0];
            leaderEl.textContent = top ? top.manager : '–';
            const link = leaderEl.closest('a');
            if (link && top) link.href = `teams.html?manager=${encodeURIComponent(top.manager)}`;
        }

        if (leaderPtsEl) {
            const top = teamTotals[0];
            const pts = top ? top.total : 0;
            const sign = pts > 0 ? '+' : '';
            leaderPtsEl.textContent = top ? `${sign}${pts}` : '–';
        }

        if (topPlayerPtsEl) {
            const tp = topPlayers[0];
            const pts = tp ? tp._pts : 0;
            const sign = pts > 0 ? '+' : '';
            topPlayerPtsEl.textContent = tp ? `${sign}${pts}` : '–';
            const link = topPlayerPtsEl.closest('a');
            if (link && tp) link.href = `spieleranalyse.html?playerId=${encodeURIComponent(tp['player.id'])}`;
        }

        if (teamCountEl) animateCounter(teamCountEl, teams.length);
    }

    /* =========================================================
       POST START – Top Manager (with best-pick callout)
       ========================================================= */
    function renderPostTopManagers(teamTotals, ptMap, teams) {
        const container = $('tile-post-top-managers');
        if (!container) return;

        if (!teamTotals.length) {
            container.innerHTML = '<div class="empty-state"><div class="empty-state-icon">🏅</div>Noch keine Teams</div>';
            return;
        }

        const reasonLabels = ['🥇 Top Pick:', '⭐ Top Pick:', '✨ Top Pick:', '✦ Top Pick:', '✦ Top Pick:'];

        container.innerHTML = teamTotals.slice(0, 5).map((t, i) => {
            const url = `teams.html?manager=${encodeURIComponent(t.manager)}`;
            const rank = getDisplayedManagerRank(t, i + 1);
            const rankCls = rank === 1 ? 'rank-1' : (rank === 2 ? 'rank-2' : (rank === 3 ? 'rank-3' : ''));
            const sign = t.total > 0 ? '+' : '';

            const teamObj = teams.find((t2) => t2.manager === t.manager);
            let bestPick = null;
            let avatarSrc = '';

            if (teamObj) {
                const ranked = (teamObj.players || [])
                    .map((tp) => {
                        const full = resolvePlayer(tp);
                        if (!full) return null;
                        const base = ptMap[String(full['player.id'])] || 0;
                        return {
                            pts: tp.isCaptain ? base * 2 : base,
                            isCaptain: !!tp.isCaptain,
                            photo: full.Spielerfoto,
                            name: full.Spielername
                        };
                    })
                    .filter(Boolean)
                    .sort((a, b) => b.pts - a.pts);

                bestPick = ranked[0] || null;
                avatarSrc = bestPick ? bestPick.photo : '';
            }

            const initials = (() => {
                const parts = String(t.manager || '').trim().split(/\s+/);
                if (parts.length >= 2) return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
                return String(t.manager || '?').slice(0, 2).toUpperCase();
            })();

            const initialsBlock = `<div class="tm-avatar" style="display:flex;align-items:center;justify-content:center;font-weight:900;font-size:0.85rem;color:rgba(255,255,255,0.7);">${escapeHtml(initials)}</div>`;

            const avatarHtml = avatarSrc
                ? `<img class="tm-avatar" src="${escapeHtml(avatarSrc)}" alt="${escapeHtml(bestPick.name)}" loading="lazy" onerror="this.onerror=null;this.replaceWith(Object.assign(document.createElement('div'),{className:'tm-avatar',style:'display:flex;align-items:center;justify-content:center;font-weight:900;font-size:0.85rem;color:rgba(255,255,255,0.7);',textContent:'${escapeHtml(initials)}'}));">`
                : initialsBlock;

            const bestSign = bestPick && bestPick.pts > 0 ? '+' : '';
            const bestHtml = bestPick ? `
                <div class="tm-best">
                    <span class="tm-best-label">${reasonLabels[i] || '⭐ Top Pick:'}</span>
                    <span class="tm-best-name">${escapeHtml(bestPick.name)}${bestPick.isCaptain ? ' ©' : ''}</span>
                    <span class="tm-best-pts">${bestSign}${bestPick.pts}</span>
                </div>
            ` : `<div class="tm-best"><span class="tm-best-label">Noch keine Punkte</span></div>`;

            return `
                <a class="tm-row ${rankCls}" href="${url}" aria-label="${escapeHtml(t.manager)}, Rang ${rank}, ${sign}${t.total} Punkte">
                    <div class="tm-rank">${rank}</div>
                    ${avatarHtml}
                    <div class="tm-name">${escapeHtml(t.manager)}</div>
                    <div class="tm-pts">${sign}${t.total}</div>
                    ${bestHtml}
                </a>
            `;
        }).join('');
    }

    /* =========================================================
       POST START – Top Players Grid (5er)
       ========================================================= */
    function renderPostTopPlayersGrid(topPlayers, ptMap) {
        const container = $('tile-post-top-players-grid');
        if (!container) return;

        const top5 = topPlayers.slice(0, 5);
        if (!top5.length || top5.every(p => p._pts === 0)) {
            container.innerHTML = '<div class="empty-state" style="grid-column:1/-1;"><div class="empty-state-icon">⭐</div>Noch keine Punkte</div>';
            return;
        }

        container.innerHTML = top5.map((p, i) => {
            const pts = ptMap[String(p['player.id'])] || 0;
            const url = `spieleranalyse.html?playerId=${encodeURIComponent(p['player.id'])}`;
            const sign = pts > 0 ? '+' : '';
            const rankCls = i === 0 ? 'rank-1' : (i === 1 ? 'rank-2' : (i === 2 ? 'rank-3' : ''));
            return `
                <a class="tp-card ${rankCls}" href="${url}" aria-label="${escapeHtml(p.Spielername)}, ${sign}${pts} Punkte">
                    <div class="tp-rank-badge">${i + 1}</div>
                    <div class="tp-photo-wrap">
                        <img class="tp-photo" src="${escapeHtml(p.Spielerfoto)}" alt="${escapeHtml(p.Spielername)}" loading="lazy">
                        ${p['Nationalteam.logo'] ? `<img class="tp-flag" src="${escapeHtml(p['Nationalteam.logo'])}" alt="${escapeHtml(p['Nationalteam.name'] || '')}" loading="lazy">` : ''}
                    </div>
                    <span class="tp-name">${escapeHtml(p.Spielername)}</span>
                    <span class="tp-pts">${sign}${pts}</span>
                </a>
            `;
        }).join('');
    }

    /* =========================================================
       POST START – Top/Perfect Toggle wiring
       ========================================================= */
    function initPostPlayersToggle() {
        const toggleEl = $('post-players-toggle');
        if (!toggleEl || toggleEl.dataset.bound === '1') return;
        toggleEl.dataset.bound = '1';

        const titleEl = $('post-players-title');
        const topView = $('post-players-top-view');
        const perfectView = $('post-players-perfect-view');

        toggleEl.querySelectorAll('.pt-toggle-btn').forEach((btn) => {
            btn.addEventListener('click', () => {
                const mode = btn.dataset.mode;
                toggleEl.querySelectorAll('.pt-toggle-btn').forEach((b) => {
                    const active = b === btn;
                    b.classList.toggle('active', active);
                    b.setAttribute('aria-selected', active ? 'true' : 'false');
                });
                if (mode === 'perfect') {
                    if (titleEl) titleEl.textContent = 'Perfect Team';
                    if (topView) topView.style.display = 'none';
                    if (perfectView) perfectView.style.display = '';
                } else {
                    if (titleEl) titleEl.textContent = 'Top Spieler';
                    if (topView) topView.style.display = '';
                    if (perfectView) perfectView.style.display = 'none';
                }
            });
        });
    }

    /* =========================================================
       SCROLL REVEAL – simple IntersectionObserver
       ========================================================= */
    let _revealObserver = null;
    function initScrollReveal() {
        const els = document.querySelectorAll('#indexHomePostStart [data-reveal]:not(.is-visible)');
        if (!els.length) return;

        if (prefersReducedMotion()) {
            els.forEach((el) => el.classList.add('is-visible'));
            return;
        }

        if (!_revealObserver && 'IntersectionObserver' in window) {
            _revealObserver = new IntersectionObserver((entries) => {
                entries.forEach((entry) => {
                    if (entry.isIntersecting) {
                        entry.target.classList.add('is-visible');
                        _revealObserver.unobserve(entry.target);
                    }
                });
            }, { rootMargin: '0px 0px -10% 0px', threshold: 0.08 });
        }

        if (_revealObserver) {
            els.forEach((el) => _revealObserver.observe(el));
        } else {
            els.forEach((el) => el.classList.add('is-visible'));
        }
    }

    /* =========================================================
       CHAMP-STAGE – Top Manager Hero (1:1 portiert aus test.html)
       Eigene Berechnungs- und Render-Logik im `champ-`/`manager-`
       Namespace, damit die Reihenfolge und Punkte exakt identisch
       zur rangliste.html / teams.html sind und das Markup nicht mit
       anderen Index-Selektoren kollidiert.
       ========================================================= */
    const champEscapeHtml = (value) => String(value ?? '').replace(/[&<>"']/g, (ch) => ({
        '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    }[ch]));

    const champInitials = (name) => String(name || '?')
        .split(/\s+/)
        .filter(Boolean)
        .slice(0, 2)
        .map((part) => part[0]?.toUpperCase() || '')
        .join('') || '?';

    const champFirstNameOf = (fullName) => {
        const trimmed = String(fullName || '').trim();
        if (!trimmed) return 'Manager';
        return trimmed.split(/\s+/)[0];
    };

    function champFirstNameKey(fullName) {
        return champFirstNameOf(fullName).toLocaleLowerCase('de-CH');
    }

    function champDuplicateFirstNameKeys(managers) {
        const counts = new Map();
        (managers || []).forEach((manager) => {
            const key = champFirstNameKey(manager && manager.manager);
            if (!key) return;
            counts.set(key, (counts.get(key) || 0) + 1);
        });
        return new Set(Array.from(counts.entries()).filter(([, count]) => count > 1).map(([key]) => key));
    }

    function champShortManagerName(fullName, duplicateFirstNames) {
        const trimmed = String(fullName || '').trim();
        if (!trimmed) return 'Manager';
        const parts = trimmed.split(/\s+/).filter(Boolean);
        const firstName = parts[0] || 'Manager';
        if (!duplicateFirstNames || !duplicateFirstNames.has(firstName.toLocaleLowerCase('de-CH'))) {
            return firstName;
        }
        const lastName = parts.length > 1 ? parts[parts.length - 1] : '';
        const initial = lastName && lastName[0] ? lastName[0].toLocaleUpperCase('de-CH') : '';
        return initial ? `${firstName} ${initial}.` : firstName;
    }

    function champPlayerAvatarHtml(p) {
        const fallback = champEscapeHtml(champInitials(p.name));
        if (p.photo && /^https?:/i.test(p.photo)) {
            return `<img src="${champEscapeHtml(p.photo)}" alt="" loading="lazy" width="44" height="44" referrerpolicy="no-referrer" data-fallback="${fallback}">`;
        }
        return `<span class="manager-player-orb-fallback" aria-hidden="true">${fallback}</span>`;
    }

    const CHAMP_LAYOUTS = {
        1: [
            { x: 50, y: 48, size: 56, cls: 'manager-main-player', z: 5 },
            { x: 18, y: 30, size: 30, cls: 'size-md', z: 4 },
            { x: 82, y: 30, size: 30, cls: 'size-md', z: 4 },
            { x: 12, y: 72, size: 24, cls: 'size-sm', z: 3 },
            { x: 88, y: 72, size: 24, cls: 'size-sm', z: 3 },
            { x: 32, y: 88, size: 22, cls: 'size-sm', z: 3 },
            { x: 68, y: 88, size: 22, cls: 'size-sm', z: 3 },
            { x: 50, y: 14, size: 20, cls: 'size-sm', z: 2 }
        ],
        2: [
            { x: 50, y: 48, size: 60, cls: 'manager-main-player', z: 5 },
            { x: 20, y: 28, size: 32, cls: 'size-md', z: 4 },
            { x: 82, y: 32, size: 32, cls: 'size-md', z: 4 },
            { x: 16, y: 78, size: 24, cls: 'size-sm', z: 3 },
            { x: 84, y: 78, size: 24, cls: 'size-sm', z: 3 },
            { x: 50, y: 90, size: 22, cls: 'size-sm', z: 2 }
        ],
        3: [
            { x: 50, y: 48, size: 60, cls: 'manager-main-player', z: 5 },
            { x: 20, y: 28, size: 32, cls: 'size-md', z: 4 },
            { x: 82, y: 32, size: 32, cls: 'size-md', z: 4 },
            { x: 16, y: 78, size: 24, cls: 'size-sm', z: 3 },
            { x: 84, y: 78, size: 24, cls: 'size-sm', z: 3 },
            { x: 50, y: 90, size: 22, cls: 'size-sm', z: 2 }
        ]
    };

    function champBuildConstellation(manager, rank, baseDelay = 0) {
        const layout = CHAMP_LAYOUTS[rank] || CHAMP_LAYOUTS[2];
        const all = (manager.mergedPlayers || []).filter((p) => Number.isFinite(p.pts));
        if (all.length === 0) {
            return `
                <div class="manager-player-constellation" aria-hidden="true">
                    <button type="button" class="manager-player-orb manager-main-player" tabindex="-1"
                            style="left:50%;top:50%;width:60%;aspect-ratio:1/1;z-index:5;">
                        <span class="manager-player-orb-inner">
                            <span class="manager-player-orb-fallback">${champEscapeHtml(champInitials(manager.manager))}</span>
                        </span>
                    </button>
                </div>
            `;
        }

        const players = all.slice(0, Math.min(layout.length, 8));
        const orbs = players.map((p, idx) => {
            const slot = layout[idx];
            const cap = p.isCaptain ? '<span class="orb-cap" title="Kapitän (×2)">C</span>' : '';
            const ptsText = Math.round(p.pts).toLocaleString('de-DE') + ' P';
            const showPts = idx === 0;
            const safeName = champEscapeHtml(p.name || 'Unbekannt');
            const dataPid = p.id ? `data-player-id="${champEscapeHtml(p.id)}"` : '';
            const orbDelay = (baseDelay + 0.55 + 0.15 * idx).toFixed(2) + 's';
            const orbFloatDelay = (idx * 0.4).toFixed(2) + 's';
            return `
                <button type="button"
                        class="manager-player-orb ${slot.cls} ${showPts ? 'has-pts' : ''}"
                        style="left:${slot.x}%; top:${slot.y}%; width:${slot.size}%; aspect-ratio:1/1; z-index:${slot.z}; --orb-delay: ${orbDelay}; --orb-float-delay: ${orbFloatDelay};"
                        data-player-name="${safeName}"
                        ${dataPid}
                        data-action="player"
                        aria-label="Spieler ${safeName}, ${ptsText}. Spieleranalyse öffnen.">
                    <span class="manager-player-orb-inner">
                        ${champPlayerAvatarHtml(p)}
                    </span>
                    ${cap}
                    ${showPts ? `<span class="orb-pts">${ptsText}</span>` : ''}
                </button>
            `;
        }).join('');

        return `<div class="manager-player-constellation">${orbs}</div>`;
    }

    function champOpenManagerTeam(manager) {
        const name = manager && manager.manager ? manager.manager : '';
        if (!name) return;
        window.location.href = `teams.html?manager=${encodeURIComponent(name)}`;
    }

    function champOpenPlayerAnalysis(player) {
        if (!player) return;
        const id = player.id != null ? String(player.id) : '';
        if (id) {
            window.location.href = `spieleranalyse.html?playerId=${encodeURIComponent(id)}`;
            return;
        }
        const name = player.name || '';
        if (!name) return;
        window.location.href = `spieleranalyse.html?player=${encodeURIComponent(name)}`;
    }

    function champOpenRanking() {
        window.location.href = 'rangliste.html';
    }

    /* Ranking-Berechnung (identisch zu rangliste.html / test.html). */
    function champBuildPlayerPointsMap(rawPoints) {
        const map = {};
        Object.entries(rawPoints || {}).forEach(([id, docData]) => {
            map[String(id)] = window.DreamTeamPoints && typeof window.DreamTeamPoints.getPlayerTotal === 'function'
                ? window.DreamTeamPoints.getPlayerTotal(docData)
                : (docData && typeof docData.totalPoints === 'number' ? docData.totalPoints : 0);
        });
        return map;
    }

    function champExtractMatchData(rawPoints) {
        const playerMatchPoints = {};
        const nationStatus = {};
        let maxNationGames = 0;
        const matchIdsSet = new Set();

        Object.entries(rawPoints || {}).forEach(([playerId, docData]) => {
            const fullP = getPlayerById(playerId);
            const nation = fullP ? fullP['Nationalteam.name'] : null;
            const perMatch = {};

            Object.entries(docData || {}).forEach(([key, val]) => {
                if (!key.startsWith('Spiel_') || !val || typeof val !== 'object') return;
                const matchId = Number(val.MatchID);
                if (!Number.isFinite(matchId)) return;
                matchIdsSet.add(matchId);
                perMatch[matchId] = typeof val.TotalPunkte === 'number' ? val.TotalPunkte : 0;

                if (nation) {
                    if (!nationStatus[nation]) {
                        nationStatus[nation] = { latestMatchId: -Infinity, outcome: 'draw', matchIds: new Set() };
                    }
                    nationStatus[nation].matchIds.add(matchId);
                    if (matchId >= nationStatus[nation].latestMatchId) {
                        let outcome = 'draw';
                        const lineup = val.Aufstellung || {};
                        if (typeof lineup.WIN === 'number' && lineup.WIN !== 0) outcome = 'win';
                        else if (typeof lineup.LOSS === 'number' && lineup.LOSS !== 0) outcome = 'loss';
                        else if (typeof lineup.DRAW === 'number' && lineup.DRAW !== 0) outcome = 'draw';
                        nationStatus[nation].latestMatchId = matchId;
                        nationStatus[nation].outcome = outcome;
                    }
                }
            });

            playerMatchPoints[String(playerId)] = perMatch;
        });

        Object.values(nationStatus).forEach((info) => {
            info.totalGames = info.matchIds.size;
            if (info.totalGames > maxNationGames) maxNationGames = info.totalGames;
        });

        return { playerMatchPoints, nationStatus, maxNationGames };
    }

    // Positions-Normalisierung wie in teams.js (FORWARD → ATTACKER); wird
    // für das Mini-Fussballfeld der CL-Top-10-Detailkarte gebraucht.
    function champNormalizePos(pos) {
        const upper = String(pos || '').toUpperCase();
        if (upper === 'FORWARD') return 'ATTACKER';
        return upper || 'UNKNOWN';
    }

    function champEnrichTeams(rawTeams, playerPointsMap, playerMatchPoints) {
        return (Array.isArray(rawTeams) ? rawTeams : []).map((team) => {
            const mergedPlayers = (team.players || []).map((p, idx) => {
                const fullP = resolvePlayer(p);
                const playerId = fullP ? String(fullP['player.id']) : `fallback-${idx}`;
                const basePts = fullP ? (playerPointsMap[playerId] || 0) : 0;
                const finalPts = p.isCaptain ? basePts * 2 : basePts;
                const matchesMap = fullP ? (playerMatchPoints[playerId] || {}) : {};
                return {
                    id: playerId,
                    name: fullP ? fullP.Spielername : (p.name || 'Unbekannt'),
                    pts: finalPts,
                    basePts,
                    isCaptain: !!p.isCaptain,
                    photo: fullP ? (fullP.Spielerfoto || '') : '',
                    nation: fullP ? (fullP['Nationalteam.name'] || '?') : '?',
                    // Live-Position aus playersData bevorzugen (wie teams.js),
                    // damit Positions-Overrides auch hier greifen; Slot-Nummer
                    // (0–14) für die Feld-Aufstellung der CL-Detailkarte.
                    pos: champNormalizePos((fullP && fullP.Position) || p.pos),
                    slotNum: p.slot ? parseInt(String(p.slot).replace('slot-', ''), 10) : -1,
                    // WICHTIG: `Nationalteam.*` sind die PRIMÄREN Anzeigefelder
                    // (siehe data.js Club-Remap): in der CL steckt dort der
                    // KLUB (Name+Logo), bei der WM die Nation. `Club.logo`
                    // wäre in der CL die Flagge – genau der Fehler, den schon
                    // das Karussell hatte.
                    club: fullP ? (fullP['Nationalteam.name'] || '') : (p.club || ''),
                    clubLogo: fullP ? (fullP['Nationalteam.logo'] || '') : (p.clubLogo || ''),
                    matchPoints: matchesMap,
                    matchCount: Object.keys(matchesMap).length
                };
            });

            // Zeitbasierte Transfer-Wertung (wie teams.js): für Teams MIT
            // Transfers zählen Spieler nur, solange sie im Team waren. Die
            // aktuellen Spieler bekommen ihre gefensterten Punkte, die
            // ausgetauschten werden separat ausgewiesen (transferredOut, für
            // den Transfers-Block der CL-Detailkarte). bd.total entspricht
            // exakt dem bisherigen teamTotalOverTime() – Ranking unverändert.
            // WM-Teams haben keine Transfers → kompletter Block ist dort ein
            // No-op und das Podest rechnet wie bisher.
            let totalScore;
            let transferredOut = [];
            const TU = window.TransferUtils;
            const hasFreeze = teamHasTransfers(team) && transferScoreCtx
                && TU && typeof TU.managerBreakdownOverTime === 'function';
            if (hasFreeze) {
                const currentIds = mergedPlayers.map((p) => String(p.id));
                const currentSet = new Set(currentIds);
                const currentCaptain = (mergedPlayers.find((p) => p.isCaptain) || {}).id || null;
                const bd = TU.managerBreakdownOverTime({
                    currentTeamIds: currentIds,
                    transfers: team.transfers,
                    initialCaptain: team.initialCaptain || currentCaptain,
                    playerMatchPoints: transferScoreCtx.playerMatchPoints,
                    getKickoffMs: transferScoreCtx.getKickoffMs,
                    // CL hat keinen Captain → kein ×2 (WM behält ×2).
                    captainMultiplier: (window.APP_CONFIG && window.APP_CONFIG.captainEnabled === false) ? 1 : 2
                });
                mergedPlayers.forEach((p) => { p.pts = bd.perPlayer[String(p.id)] || 0; });
                const initialIdsArr = (typeof TU.reconstructInitialTeamIds === 'function')
                    ? TU.reconstructInitialTeamIds(currentIds, team.transfers).map(String)
                    : currentIds.slice();
                transferredOut = initialIdsArr
                    .filter((id) => !currentSet.has(id))
                    .map((id) => {
                        const fp = getPlayerById(id);
                        return {
                            id,
                            name: fp ? fp.Spielername : String(id),
                            pts: bd.perPlayer[id] || 0,
                            isCaptain: false,
                            photo: fp ? (fp.Spielerfoto || '') : '',
                            nation: fp ? (fp['Nationalteam.name'] || '?') : '?',
                            pos: fp ? champNormalizePos(fp.Position) : 'UNKNOWN',
                            slotNum: -1,
                            // Primäre Anzeigefelder (CL → Klub), s. Kommentar oben.
                            club: fp ? (fp['Nationalteam.name'] || '') : '',
                            clubLogo: fp ? (fp['Nationalteam.logo'] || '') : ''
                        };
                    })
                    .sort((a, b) => b.pts - a.pts);
                totalScore = bd.total;
            } else {
                totalScore = mergedPlayers.reduce((sum, p) => sum + p.pts, 0);
            }

            mergedPlayers.sort((a, b) => b.pts - a.pts);

            return { ...team, manager: team.manager || 'Unbekannt', mergedPlayers, totalScore, transferredOut };
        });
    }

    function champComputeRanking(teams) {
        return [...teams].sort((a, b) => {
            const diff = b.totalScore - a.totalScore;
            if (diff !== 0) return diff;
            return compareTeamsBySubmissionAsc(a, b);
        });
    }

    function buildChampRanking(data) {
        const rawPoints = data.points || {};
        const playerPointsMap = champBuildPlayerPointsMap(rawPoints);
        const { playerMatchPoints } = champExtractMatchData(rawPoints);
        const enriched = champEnrichTeams(data.teams || [], playerPointsMap, playerMatchPoints);
        const ranked = champComputeRanking(enriched);
        assignSharedRanks(ranked, team => team.totalScore, (team, rank) => {
            team.rank = rank;
            team.currentRank = rank;
        });
        return ranked;
    }

    const CHAMP_CROWN_SVG = `<svg class="champ-crown" viewBox="0 0 64 48" aria-hidden="true">
        <defs>
            <linearGradient id="champCrownGrad" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%"  stop-color="#fff5b8"/>
                <stop offset="55%" stop-color="#ffd700"/>
                <stop offset="100%" stop-color="#b8860b"/>
            </linearGradient>
        </defs>
        <path d="M4 14 L16 30 L32 6 L48 30 L60 14 L56 42 L8 42 Z"
              fill="url(#champCrownGrad)"
              stroke="rgba(0,0,0,0.35)" stroke-width="1.2" stroke-linejoin="round"/>
        <circle cx="4"  cy="14" r="3.2" fill="#ff5d8f" stroke="rgba(0,0,0,0.35)" stroke-width="0.8"/>
        <circle cx="32" cy="6"  r="3.6" fill="#7dd3fc" stroke="rgba(0,0,0,0.35)" stroke-width="0.8"/>
        <circle cx="60" cy="14" r="3.2" fill="#86efac" stroke="rgba(0,0,0,0.35)" stroke-width="0.8"/>
        <rect x="8" y="38" width="48" height="4" rx="1.5"
              fill="#a16207" stroke="rgba(0,0,0,0.3)" stroke-width="0.6"/>
    </svg>`;

    function champAnimateCount(el, target, duration, delay) {
        const start = performance.now() + delay;
        const easeOut = (t) => 1 - Math.pow(1 - t, 3);
        const step = (now) => {
            if (now < start) { requestAnimationFrame(step); return; }
            const t = Math.min(1, (now - start) / duration);
            const v = Math.round(target * easeOut(t));
            el.textContent = v.toLocaleString('de-DE');
            if (t < 1) requestAnimationFrame(step);
        };
        requestAnimationFrame(step);
    }

    let champReadyTimer = null;
    let champStageSignature = null;
    let champStageRendered = false;

    function getChampStageSignature(rankedManagers) {
        const managers = Array.isArray(rankedManagers) ? rankedManagers : [];
        const duplicateFirstNames = Array.from(champDuplicateFirstNameKeys(managers)).sort();

        return JSON.stringify({
            duplicateFirstNames,
            stage: managers.slice(0, 7).map((m, idx) => {
                const visualRank = idx + 1;
                const rank = getDisplayedManagerRank(m, visualRank);
                const layout = CHAMP_LAYOUTS[visualRank] || CHAMP_LAYOUTS[2];
                const playerLimit = visualRank <= 3 ? Math.min(layout.length, 8) : 0;
                const displayedPlayers = playerLimit
                    ? (m.mergedPlayers || [])
                        .filter((p) => Number.isFinite(p.pts))
                        .slice(0, playerLimit)
                        .map((p) => ({
                            id: String(p.id ?? ''),
                            name: p.name || '',
                            pts: Number(p.pts) || 0,
                            isCaptain: !!p.isCaptain,
                            photo: p.photo || ''
                        }))
                    : [];

                return {
                    rank,
                    manager: m.manager || 'Unbekannt',
                    totalScore: Number(m.totalScore) || 0,
                    displayedPlayers
                };
            })
        });
    }

    function renderChampStage(rankedManagers) {
        const podium  = document.getElementById('champPodium');
        const chasers = document.getElementById('champChasers');
        if (!podium || !chasers) return;

        const signature = getChampStageSignature(rankedManagers);
        if (champStageRendered && signature === champStageSignature) return;
        champStageSignature = signature;
        champStageRendered = true;

        if (champReadyTimer !== null) {
            clearTimeout(champReadyTimer);
            champReadyTimer = null;
        }

        podium.innerHTML = '';
        chasers.innerHTML = '';

        const top3 = rankedManagers.slice(0, 3);
        const rest = rankedManagers.slice(3, 7);
        const duplicateFirstNames = champDuplicateFirstNameKeys(rankedManagers);

        top3.forEach((m, i) => {
            const visualRank = i + 1;
            const rank = getDisplayedManagerRank(m, visualRank);
            const card = document.createElement('div');
            card.className = 'champ-card manager-hero-card is-running';
            card.dataset.rank = String(visualRank);
            card.dataset.points = String(m.totalScore);
            card.setAttribute('aria-label', `Platz ${rank}: ${m.manager}, ${m.totalScore} Punkte.`);

            const baseDelay = visualRank === 1 ? 1.6 : visualRank === 2 ? 0.85 : 0.25;
            const firstnameDelay = (baseDelay + 0.4).toFixed(2) + 's';
            const pointsDelay    = (baseDelay + 1.6).toFixed(2) + 's';
            card.style.setProperty('--firstname-delay', firstnameDelay);
            card.style.setProperty('--points-delay', pointsDelay);

            const firstName = champEscapeHtml(champShortManagerName(m.manager, duplicateFirstNames));
            card.innerHTML = `
                ${visualRank === 1 ? CHAMP_CROWN_SVG : ''}
                <span class="champ-rank-badge">#${rank}</span>
                <button type="button" class="manager-firstname"
                        data-action="manager"
                        aria-label="Team von ${champEscapeHtml(m.manager)} anzeigen">${firstName}</button>
                ${champBuildConstellation(m, visualRank, baseDelay)}
                <button type="button" class="manager-points-link"
                        data-action="points"
                        aria-label="Gesamte Rangliste anzeigen">
                    <span class="champ-points-value" data-target="${m.totalScore}">0</span>
                    <small>Pkt</small>
                </button>
            `;

            card.addEventListener('click', (ev) => {
                const target = ev.target.closest('[data-action]');
                if (!target || !card.contains(target)) return;
                ev.preventDefault();
                ev.stopPropagation();
                const action = target.dataset.action;
                if (action === 'manager') {
                    champOpenManagerTeam(m);
                } else if (action === 'points') {
                    champOpenRanking();
                } else if (action === 'player') {
                    const playerId = target.dataset.playerId || '';
                    const playerName = target.dataset.playerName || '';
                    let player = null;
                    if (playerId) {
                        player = (m.mergedPlayers || []).find((p) => String(p.id) === String(playerId));
                    }
                    if (!player && playerName) {
                        player = (m.mergedPlayers || []).find((p) => p.name === playerName);
                    }
                    if (player) champOpenPlayerAnalysis(player);
                    else if (playerId || playerName) champOpenPlayerAnalysis({ id: playerId, name: playerName });
                }
            });

            podium.appendChild(card);
        });

        rest.forEach((m, i) => {
            const visualRank = i + 4;
            const rank = getDisplayedManagerRank(m, visualRank);
            const row = document.createElement('div');
            row.className = 'champ-chaser';
            row.dataset.rank = String(visualRank);
            row.style.setProperty('--chaser-delay', (3.7 + i * 0.18).toFixed(2) + 's');
            const chaserDisplayName = visualRank <= 7 ? champShortManagerName(m.manager, duplicateFirstNames) : m.manager;
            row.innerHTML = `
                <button type="button" class="champ-chaser-team"
                        aria-label="Platz ${rank}: ${champEscapeHtml(m.manager)}. Zum Team.">
                    <span class="champ-rank-mini">#${rank}</span>
                    <span class="champ-chaser-info">
                        <span class="champ-chaser-name">${champEscapeHtml(chaserDisplayName)}</span>
                    </span>
                </button>
                <button type="button" class="champ-chaser-points"
                        aria-label="${m.totalScore} Punkte. Gesamte Rangliste anzeigen.">
                    <span class="champ-points-value" data-target="${m.totalScore}">0</span>
                    <small>Pkt</small>
                </button>
            `;
            row.querySelector('.champ-chaser-team').addEventListener('click', () => champOpenManagerTeam(m));
            row.querySelector('.champ-chaser-points').addEventListener('click', () => champOpenRanking());
            chasers.appendChild(row);
        });

        podium.querySelectorAll('.manager-player-orb-inner img').forEach((img) => {
            img.addEventListener('error', () => {
                const fallback = document.createElement('span');
                fallback.className = 'manager-player-orb-fallback';
                fallback.setAttribute('aria-hidden', 'true');
                fallback.textContent = img.dataset.fallback || '?';
                img.replaceWith(fallback);
            }, { once: true });
        });

        const counterDelays = { '3': 2300, '2': 2700, '1': 3500 };
        document.querySelectorAll('#indexHomePostStart .champ-points-value').forEach((el) => {
            const card = el.closest('[data-rank]');
            const rankStr = card ? card.dataset.rank : '0';
            const rankNum = Number(rankStr);
            let delay;
            if (counterDelays[rankStr] !== undefined) {
                delay = counterDelays[rankStr];
            } else if (rankNum >= 4) {
                delay = 3900 + (rankNum - 4) * 180;
            } else {
                delay = 2500;
            }
            champAnimateCount(el, Number(el.dataset.target) || 0, 1500, delay);
        });

        champReadyTimer = setTimeout(() => {
            champReadyTimer = null;
            document.querySelectorAll('#indexHomePostStart .champ-card').forEach((c) => {
                c.classList.remove('is-running');
                c.classList.add('is-ready');
            });
        }, 4600);
    }

    /* =========================================================
       CL: TOP-10-MANAGER – Kachel-Grid + Expand-Detailkarte
       Ersetzt in der CL die Champ-Stage (Podest). Nutzt exakt
       dieselbe Ranking-Pipeline (buildChampRanking) wie das
       WM-Podest bzw. rangliste.html, damit Reihenfolge und
       Punkte überall übereinstimmen. Eigener Namespace `cltm-`.

       Aufbau:
       • Top-10 als quadratische Kacheln (Rang + Name, Punkte,
         3 punktbeste Spieler).
       • Klick expandiert die Kachel per FLIP-Animation zur
         zentrierten Detailkarte (gleiche Breite wie die übrigen
         Dashboard-Bereiche). Darin alle 15 Spieler als Chips
         (Foto, Name, Punkte, Klublogo), per Toggle „Position |
         Punkte" umsortierbar – die Chips sind absolut positioniert
         und wandern rein über transform-Transitions (Compositor,
         kein Layout-Thrash) zwischen beiden Ansichten.
       • Positions-Ansicht: Reihen Tor/Abwehr/Mittelfeld/Sturm;
         der jeweilige Bank-Spieler (Slots 11–14) sitzt auf der
         gleichen Höhe in einer eigenen Spalte rechts (auf schmalen
         Screens rutscht die Bank als eigene Reihe nach unten).
       • Transfers (ausgetauschte Spieler) als eigener Block unten.
       ========================================================= */
    // Slot-Schema des Team-Builders: 0 Tor, 1–3 Abwehr, 4–7 Mittelfeld,
    // 8–10 Sturm; Bank: 11 Tor, 12 Abwehr, 13 Mittelfeld, 14 Sturm.
    const CLTM_ROWS = [
        { key: 'GOALKEEPER', label: 'TOR', firstSlot: 0, lastSlot: 0,  benchSlot: 11 },
        { key: 'DEFENDER',   label: 'ABW', firstSlot: 1, lastSlot: 3,  benchSlot: 12 },
        { key: 'MIDFIELDER', label: 'MF',  firstSlot: 4, lastSlot: 7,  benchSlot: 13 },
        { key: 'ATTACKER',   label: 'ST',  firstSlot: 8, lastSlot: 10, benchSlot: 14 }
    ];

    function cltmFormatPts(value) {
        return Math.round(Number(value) || 0).toLocaleString('de-DE');
    }

    // Kurzform für die schmalen Chips: „Erling Braut Haaland" → „E. Haaland".
    function cltmShortPlayerName(fullName) {
        const parts = String(fullName || '').trim().split(/\s+/).filter(Boolean);
        if (!parts.length) return 'Unbekannt';
        if (parts.length === 1) return parts[0];
        const initial = parts[0][0] ? `${parts[0][0]}. ` : '';
        return `${initial}${parts[parts.length - 1]}`;
    }

    function cltmAvatarHtml(p) {
        const fallback = champEscapeHtml(champInitials(p.name));
        if (p.photo && /^https?:/i.test(p.photo)) {
            return `<img src="${champEscapeHtml(p.photo)}" alt="" loading="lazy" decoding="async" referrerpolicy="no-referrer" data-fallback="${fallback}">`;
        }
        return `<span class="cltm-avatar-fallback" aria-hidden="true">${fallback}</span>`;
    }

    function cltmBindImgFallbacks(rootEl) {
        rootEl.querySelectorAll('img[data-fallback]').forEach((img) => {
            img.addEventListener('error', () => {
                const span = document.createElement('span');
                span.className = 'cltm-avatar-fallback';
                span.setAttribute('aria-hidden', 'true');
                span.textContent = img.dataset.fallback || '?';
                img.replaceWith(span);
            }, { once: true });
        });
        // Klublogos: bei Ladefehler das ganze Badge entfernen statt eines
        // kaputten Bild-Platzhalters.
        rootEl.querySelectorAll('.cltm-chip-club img').forEach((img) => {
            img.addEventListener('error', () => {
                const badge = img.closest('.cltm-chip-club');
                if (badge) badge.remove();
            }, { once: true });
        });
    }

    // Reihen (Tor/Abwehr/Mittelfeld/Sturm) mit Startern + zugehörigem
    // Bank-Spieler. Spieler ohne gültigen Slot (Alt-Daten) werden über
    // ihre Position als Starter einsortiert.
    function cltmGroupPlayers(manager) {
        const rows = CLTM_ROWS.map((row) => ({ key: row.key, label: row.label, starters: [], bench: null }));
        const noSlot = [];

        (manager.mergedPlayers || []).forEach((p) => {
            const n = Number(p.slotNum);
            if (!Number.isFinite(n) || n < 0 || n > 14) { noSlot.push(p); return; }
            const rowIdx = CLTM_ROWS.findIndex((row) => (n >= row.firstSlot && n <= row.lastSlot) || n === row.benchSlot);
            const row = rows[rowIdx >= 0 ? rowIdx : 2];
            if (n >= 11 && !row.bench) row.bench = p;
            else row.starters.push({ p, n });
        });

        noSlot.forEach((p) => {
            const row = rows.find((r) => r.key === p.pos) || rows[2];
            row.starters.push({ p, n: 99 });
        });

        rows.forEach((row) => {
            row.starters.sort((a, b) => a.n - b.n);
            row.starters = row.starters.map((x) => x.p);
        });

        return { rows };
    }

    function cltmChipHtml(p, extraCls) {
        const safeName = champEscapeHtml(p.name || 'Unbekannt');
        const ptsText = cltmFormatPts(p.pts);
        const clubBadge = (p.clubLogo && /^https?:/i.test(p.clubLogo))
            ? `<span class="cltm-chip-club"><img src="${champEscapeHtml(p.clubLogo)}" alt="" loading="lazy" decoding="async"></span>`
            : '';
        return `
            <button type="button" class="cltm-chip${extraCls ? ' ' + extraCls : ''}" data-action="player"
                    data-pid="${champEscapeHtml(p.id != null ? String(p.id) : '')}"
                    data-player-name="${safeName}"
                    aria-label="Spieler ${safeName}, ${ptsText} Punkte. Spieleranalyse öffnen.">
                <span class="cltm-chip-avatar" aria-hidden="true">
                    ${cltmAvatarHtml(p)}
                    ${clubBadge}
                </span>
                <span class="cltm-chip-name">${champEscapeHtml(cltmShortPlayerName(p.name))}</span>
                <span class="cltm-chip-pts">${ptsText}</span>
            </button>`;
    }

    function cltmModalHtml(manager, rank, rankCls) {
        const { rows } = cltmGroupPlayers(manager);
        const chipsHtml = rows.map((row) =>
            row.starters.map((p) => cltmChipHtml(p)).join('')
            + (row.bench ? cltmChipHtml(row.bench, 'cltm-chip-bench') : '')
        ).join('');

        const labelsHtml = rows.map((row, i) =>
            `<span class="cltm-row-label" data-row="${i}" aria-hidden="true">${row.label}</span>`
        ).join('');

        const outs = Array.isArray(manager.transferredOut) ? manager.transferredOut : [];
        const transfersHtml = outs.length ? `
            <div class="cltm-transfers">
                <span class="cltm-transfers-label">Transfers</span>
                <div class="cltm-transfers-row">${outs.map((p) => cltmChipHtml(p, 'cltm-chip-out')).join('')}</div>
            </div>` : '';

        return `
            <div class="cltm-modal-head">
                <span class="cltm-rank ${rankCls}">${rank || '–'}</span>
                <div class="cltm-modal-title">
                    <span class="cltm-modal-name">${champEscapeHtml(manager.manager || 'Unbekannt')}</span>
                    <span class="cltm-modal-pts">${cltmFormatPts(manager.totalScore)} <small>Pkt</small></span>
                </div>
                <span class="cltm-head-break" aria-hidden="true"></span>
                <div class="pt-toggle cltm-mode-toggle" role="tablist" aria-label="Spieler-Sortierung">
                    <button type="button" class="pt-toggle-btn active" data-mode="position" role="tab" aria-selected="true">Position</button>
                    <button type="button" class="pt-toggle-btn" data-mode="points" role="tab" aria-selected="false">Punkte</button>
                </div>
                <button type="button" class="cltm-close" data-cltm-close aria-label="Detailkarte schliessen">✕</button>
            </div>
            <div class="cltm-modal-body">
                <div class="cltm-players">
                    ${chipsHtml}
                    ${labelsHtml}
                    <span class="cltm-bench-caption" aria-hidden="true">Bank</span>
                    <span class="cltm-bench-divider" aria-hidden="true"></span>
                </div>
                ${transfersHtml}
                <div class="cltm-modal-actions">
                    <a class="btn-pill" href="teams.html?manager=${encodeURIComponent(manager.manager || '')}">🛡️ Team ansehen</a>
                    <a class="btn-pill" href="rangliste.html">🏆 Zur Rangliste</a>
                </div>
            </div>
        `;
    }

    /* ── Chip-Layout-Engine (Positions-/Punkte-Ansicht) ─────────────────
       Alle 15 Chips sind absolut positioniert und werden hier rein über
       transform: translate3d(...) platziert. Ein Moduswechsel ändert nur
       die Transforms – die CSS-Transition animiert die Chips flüssig auf
       ihre neuen Plätze (FLIP ohne Layout-Arbeit pro Frame). */
    let cltmModalManager = null;    // Manager-Objekt der offenen Detailkarte
    let cltmMode = 'position';

    function cltmChipElements() {
        return cltmModal ? Array.from(cltmModal.querySelectorAll('.cltm-players > .cltm-chip')) : [];
    }

    function cltmLayoutPlayers(animate) {
        if (!cltmModal || !cltmModalManager) return;
        const wrap = cltmModal.querySelector('.cltm-players');
        if (!wrap) return;
        const chips = cltmChipElements();
        if (!chips.length) { wrap.style.height = '0px'; return; }

        const W = wrap.clientWidth;
        if (!W) return;
        const inRow = W >= 620;                       // Bank rechts in der Reihe?
        const gap = inRow ? Math.min(18, Math.max(10, Math.floor(W * 0.014))) : 8;
        const gutter = inRow ? 44 : 0;                // Platz für TOR/ABW/MF/ST
        const benchSep = inRow ? 30 : 0;              // Abstand Feld ↔ Bank-Spalte
        const chipW = inRow
            ? Math.min(118, Math.floor((W - gutter - benchSep - 5 * gap) / 5))
            : Math.min(96, Math.floor((W - 3 * gap) / 4));

        if (!animate) wrap.classList.add('cltm-no-anim');

        const byId = new Map();
        chips.forEach((c) => { c.style.width = chipW + 'px'; byId.set(c.dataset.pid, c); });
        const chipH = chips[0].offsetHeight;

        const caption = wrap.querySelector('.cltm-bench-caption');
        const divider = wrap.querySelector('.cltm-bench-divider');
        const labelEl = (i) => wrap.querySelector(`.cltm-row-label[data-row="${i}"]`);
        const place = (el, x, y) => {
            if (el) el.style.transform = `translate3d(${Math.round(x)}px, ${Math.round(y)}px, 0)`;
        };

        const rowGap = inRow ? 16 : 12;
        // Desktop: konstante Bereichshöhe über BEIDE Ansichten (Position ist
        // mit 4 Reihen + Bank-Beschriftung immer die höhere). So ändert der
        // Position/Punkte-Toggle die Popup-Grösse nicht und es taucht keine
        // Scrollbar auf; die Punkte-Reihen werden vertikal zentriert.
        const fixedH = inRow ? (26 + 4 * chipH + 3 * rowGap + 6) : 0;
        let height = 0;

        if (cltmMode === 'points') {
            // mergedPlayers ist bereits nach Punkten absteigend sortiert.
            const cols = inRow ? 5 : 4;
            const sorted = cltmModalManager.mergedPlayers || [];
            const rowsCount = Math.max(1, Math.ceil(sorted.length / cols));
            const contentH = 4 + rowsCount * chipH + (rowsCount - 1) * rowGap + 6;
            const yPad = inRow ? Math.max(4, Math.floor((fixedH - contentH) / 2) + 4) : 4;
            sorted.forEach((p, i) => {
                const chip = byId.get(String(p.id));
                if (!chip) return;
                const r = Math.floor(i / cols);
                const inThisRow = Math.min(cols, sorted.length - r * cols);
                const rowW = inThisRow * chipW + (inThisRow - 1) * gap;
                place(chip, (W - rowW) / 2 + (i % cols) * (chipW + gap), yPad + r * (chipH + rowGap));
            });
            height = inRow ? fixedH : contentH;
        } else {
            const { rows } = cltmGroupPlayers(cltmModalManager);
            if (inRow) {
                const topPad = 26;                    // Platz für „Bank"-Beschriftung
                const benchX = W - chipW;
                const areaW = benchX - benchSep - gutter;
                rows.forEach((row, r) => {
                    const y = topPad + r * (chipH + rowGap);
                    const n = row.starters.length;
                    const rowW = n * chipW + Math.max(0, n - 1) * gap;
                    row.starters.forEach((p, i) => {
                        place(byId.get(String(p.id)), gutter + (areaW - rowW) / 2 + i * (chipW + gap), y);
                    });
                    if (row.bench) place(byId.get(String(row.bench.id)), benchX, y);
                    place(labelEl(r), 0, y + chipH / 2 - 9);
                });
                height = topPad + rows.length * chipH + (rows.length - 1) * rowGap + 6;
                if (caption) {
                    caption.style.width = chipW + 'px';
                    place(caption, benchX, 2);
                }
                if (divider) {
                    divider.style.height = Math.max(0, height - 12) + 'px';
                    place(divider, benchX - Math.round(benchSep / 2), 4);
                }
            } else {
                // Schmale Screens: Bank als eigene Reihe unterhalb des Feldes.
                const benchList = rows.map((row) => row.bench).filter(Boolean);
                rows.forEach((row, r) => {
                    const y = 4 + r * (chipH + rowGap);
                    const n = row.starters.length;
                    const rowW = n * chipW + Math.max(0, n - 1) * gap;
                    row.starters.forEach((p, i) => {
                        place(byId.get(String(p.id)), (W - rowW) / 2 + i * (chipW + gap), y);
                    });
                    place(labelEl(r), 0, y + chipH / 2 - 9);
                });
                const benchLabelY = 4 + rows.length * (chipH + rowGap);
                const benchY = benchLabelY + 20;
                const n = benchList.length;
                const rowW = n * chipW + Math.max(0, n - 1) * gap;
                benchList.forEach((p, i) => {
                    place(byId.get(String(p.id)), (W - rowW) / 2 + i * (chipW + gap), benchY);
                });
                if (caption) {
                    caption.style.width = W + 'px';
                    place(caption, 0, benchLabelY - 2);
                }
                height = n ? benchY + chipH + 6 : benchLabelY + 2;
            }
        }

        wrap.style.height = Math.ceil(height) + 'px';
        wrap.classList.toggle('mode-points', cltmMode === 'points');
        wrap.classList.toggle('cltm-inrow', inRow);

        if (!animate) {
            void wrap.offsetWidth;                    // Layout ohne Transition anwenden
            wrap.classList.remove('cltm-no-anim');
        }
    }

    function cltmSetMode(mode) {
        if (!cltmModal || mode === cltmMode) return;
        cltmMode = mode;

        // Sanfter Stagger: Chips starten minimal versetzt, wirkt organischer.
        const chips = cltmChipElements();
        chips.forEach((c, i) => { c.style.transitionDelay = Math.min(i * 14, 180) + 'ms'; });
        cltmLayoutPlayers(true);
        setTimeout(() => { chips.forEach((c) => { c.style.transitionDelay = ''; }); }, 950);

        cltmModal.querySelectorAll('.cltm-mode-toggle .pt-toggle-btn').forEach((btn) => {
            const active = btn.dataset.mode === mode;
            btn.classList.toggle('active', active);
            btn.setAttribute('aria-selected', active ? 'true' : 'false');
        });
    }

    /* ── Expand-Detailkarte (Overlay + FLIP-Animation) ──────────────── */
    let cltmOverlay = null;
    let cltmModal = null;
    let cltmOpenKey = null;      // Manager-Name der offenen Detailkarte
    let cltmLastTrigger = null;  // Kachel, die den Dialog geöffnet hat (Fokus-Rückgabe)
    let cltmClosing = false;
    let cltmSettleTimer = null;
    let cltmSettleHandler = null;
    let cltmResizeTimer = null;

    function cltmPrefersReducedMotion() {
        try { return window.matchMedia('(prefers-reduced-motion: reduce)').matches; } catch (_) { return false; }
    }

    // Harter Body-Scroll-Lock (auch iOS Safari): Body wird per
    // `position: fixed` eingefroren; `top: -scrollY` hält die Seite optisch
    // an Ort, beim Entsperren wird die Scroll-Position wiederhergestellt.
    // Die FLIP-Messungen (getBoundingClientRect) bleiben dadurch korrekt,
    // weil sich die Viewport-Positionen nicht verändern.
    let cltmLockScrollY = 0;

    function cltmLockBody() {
        if (document.body.classList.contains('cltm-lock')) return;
        cltmLockScrollY = window.scrollY || document.documentElement.scrollTop || 0;
        document.body.style.top = `-${cltmLockScrollY}px`;
        document.body.classList.add('cltm-lock');
    }

    function cltmUnlockBody() {
        if (!document.body.classList.contains('cltm-lock')) return;
        document.body.classList.remove('cltm-lock');
        document.body.style.top = '';
        window.scrollTo(0, cltmLockScrollY);
    }

    function cltmEnsureOverlay() {
        if (cltmOverlay) return;
        cltmOverlay = document.createElement('div');
        cltmOverlay.className = 'cltm-overlay';
        cltmOverlay.hidden = true;
        cltmOverlay.innerHTML = `
            <div class="cltm-backdrop" data-cltm-close></div>
            <div class="cltm-blur" aria-hidden="true"></div>
            <div class="cltm-modal" role="dialog" aria-modal="true" tabindex="-1"></div>
        `;
        document.body.appendChild(cltmOverlay);
        cltmModal = cltmOverlay.querySelector('.cltm-modal');

        cltmOverlay.addEventListener('click', (ev) => {
            if (ev.target.closest('[data-cltm-close]')) { cltmClose(); return; }
            const modeBtn = ev.target.closest('.cltm-mode-toggle [data-mode]');
            if (modeBtn) { cltmSetMode(modeBtn.dataset.mode); return; }
            const chip = ev.target.closest('[data-action="player"]');
            if (chip) {
                champOpenPlayerAnalysis({ id: chip.dataset.pid || '', name: chip.dataset.playerName || '' });
            }
        });

        // Minimaler Fokus-Zyklus innerhalb des Dialogs (Tab bleibt drin).
        cltmOverlay.addEventListener('keydown', (ev) => {
            if (ev.key !== 'Tab') return;
            const focusables = cltmModal.querySelectorAll('button, [href]');
            if (!focusables.length) return;
            const first = focusables[0];
            const last = focusables[focusables.length - 1];
            if (ev.shiftKey && document.activeElement === first) { ev.preventDefault(); last.focus(); }
            else if (!ev.shiftKey && document.activeElement === last) { ev.preventDefault(); first.focus(); }
        });

        document.addEventListener('keydown', (ev) => {
            if (ev.key === 'Escape' && cltmOpenKey !== null) cltmClose();
        });

        // Chips bei Fenster-Resize ohne Animation neu platzieren.
        window.addEventListener('resize', () => {
            if (!cltmOverlay || cltmOverlay.hidden) return;
            if (cltmResizeTimer) clearTimeout(cltmResizeTimer);
            cltmResizeTimer = setTimeout(() => {
                cltmResizeTimer = null;
                cltmLayoutPlayers(false);
            }, 120);
        });
    }

    // Karussell-Rezeptur (siehe tcc-Carousel: MOVE_DUR/MOVE_EASE): 0.6 s mit
    // weich auslaufender Kurve cubic-bezier(0.22, 1, 0.36, 1). Open/Close des
    // Popups nutzen exakt dieselbe Bewegung wie der Kartenwechsel im
    // Karussell; die Dauer muss mit den cltm-CSS-Transitions übereinstimmen.
    const CLTM_MOVE_MS = 600;

    /* Ghost-Morph: Statt das volle Modal (15 Chips, Fotos, Schatten) zu
       skalieren, trägt ein leichter optischer KLON der Kachel die Morph-
       Animation zwischen Kachel und Karte – das Modal blendet währenddessen
       nur ein/aus (Crossfade). Genau diese Arbeitsteilung macht auch den
       Karussell-Wechsel so flüssig: bewegt werden nur kleine, fertige
       Karten, nie schwerer Inhalt. */
    let cltmGhost = null;

    function cltmMakeGhost(tileEl, rect) {
        cltmRemoveGhost();
        const ghost = tileEl.cloneNode(true);
        ghost.classList.remove('cltm-src-hidden');
        ghost.classList.add('cltm-ghost');
        ghost.removeAttribute('aria-label');
        ghost.setAttribute('aria-hidden', 'true');
        ghost.setAttribute('tabindex', '-1');
        ghost.style.left = rect.left + 'px';
        ghost.style.top = rect.top + 'px';
        ghost.style.width = rect.width + 'px';
        ghost.style.height = rect.height + 'px';
        // Der Klon erbt inline transform (Kachel-Position aus der Layout-
        // Engine), Einblend-Opacity und Stagger-Delay – alles neutralisieren,
        // der Ghost wird über left/top + eigene Transforms gesteuert.
        ghost.style.transform = 'none';
        ghost.style.opacity = '';
        ghost.style.transitionDelay = '';
        cltmOverlay.appendChild(ghost);
        cltmGhost = ghost;
        return ghost;
    }

    function cltmRemoveGhost() {
        if (cltmGhost && cltmGhost.parentNode) cltmGhost.parentNode.removeChild(cltmGhost);
        cltmGhost = null;
    }

    function cltmOpen(manager, tileEl) {
        cltmEnsureOverlay();
        if (cltmClosing) return;
        cltmOpenKey = manager.manager || '';
        cltmModalManager = manager;
        cltmMode = 'position';
        cltmLastTrigger = tileEl || null;

        const rank = getDisplayedManagerRank(manager, 0);
        const rankCls = rank === 1 ? 'r1' : rank === 2 ? 'r2' : rank === 3 ? 'r3' : '';
        cltmModal.setAttribute('aria-label', `Platz ${rank || '–'}: ${manager.manager || 'Unbekannt'}, ${cltmFormatPts(manager.totalScore)} Punkte`);
        cltmModal.innerHTML = cltmModalHtml(manager, rank, rankCls);
        cltmBindImgFallbacks(cltmModal);

        cltmLockBody();
        cltmOverlay.hidden = false;
        if (tileEl) tileEl.classList.add('cltm-src-hidden');

        // Chips sofort (ohne Transition) in der Positions-Ansicht platzieren.
        cltmLayoutPlayers(false);

        // Morph (FLIP + Ghost): Das Modal startet transparent an der Kachel-
        // Geometrie; der Kachel-Klon wächst mit der Karussell-Kurve zur Karte
        // und blendet dabei ins mitwachsende Modal über. Der schwere Inhalt
        // wird so nie sichtbar verzerrt skaliert.
        const reduced = cltmPrefersReducedMotion();
        let ghostTarget = '';
        if (!reduced && tileEl) {
            const from = tileEl.getBoundingClientRect();
            const to = cltmModal.getBoundingClientRect();
            cltmModal.style.transformOrigin = 'top left';
            cltmModal.style.transform = `translate3d(${from.left - to.left}px, ${from.top - to.top}px, 0) `
                + `scale(${from.width / Math.max(to.width, 1)}, ${from.height / Math.max(to.height, 1)})`;
            cltmMakeGhost(tileEl, from);
            ghostTarget = `translate3d(${to.left - from.left}px, ${to.top - from.top}px, 0) `
                + `scale(${to.width / Math.max(from.width, 1)}, ${to.height / Math.max(from.height, 1)})`;
        } else {
            cltmModal.style.transform = '';
        }

        // Nach der Morph-Animation: Ghost aufräumen und Blur-Ebene weich
        // einblenden (`is-settled`). Präzise über transitionend der
        // transform-Transition MIT elapsedTime-Guard: der Guard filtert die
        // spuriosen 0ms-transform-Events, die Chrome gelegentlich kurz nach
        // dem Start feuert. Der Timer ist nur noch grosszügiger Fallback –
        // CSS-Transitions starten erst mit dem nächsten Frame-Commit, unter
        // Last also spürbar nach dem JS-Aufruf; ein knapper fester Timer hat
        // deshalb das Ende der Animation abgeschnitten.
        let settled = false;
        const settle = (ev) => {
            if (settled) return;
            if (ev && (ev.target !== cltmModal || ev.propertyName !== 'transform' || ev.elapsedTime < 0.55)) return;
            settled = true;
            cltmModal.removeEventListener('transitionend', settle);
            cltmSettleHandler = null;
            if (cltmSettleTimer) { clearTimeout(cltmSettleTimer); cltmSettleTimer = null; }
            cltmRemoveGhost();
            if (!cltmOverlay.hidden && cltmOpenKey !== null) cltmOverlay.classList.add('is-settled');
        };
        cltmModal.addEventListener('transitionend', settle);
        cltmSettleHandler = settle;

        // Doppel-rAF: der Browser rendert garantiert einen Frame im
        // Startzustand, bevor die Transition beginnt – ohne diesen Schritt
        // wird der erste Frame gern übersprungen und der Start wirkt ruckig.
        requestAnimationFrame(() => {
            requestAnimationFrame(() => {
                cltmOverlay.classList.add('is-open');
                cltmModal.style.transform = '';
                if (cltmGhost && ghostTarget) {
                    cltmGhost.style.transform = ghostTarget;
                    cltmGhost.classList.add('is-out');
                }
                cltmSettleTimer = setTimeout(() => settle(null), CLTM_MOVE_MS + 300);
            });
        });

        const closeBtn = cltmModal.querySelector('.cltm-close');
        if (closeBtn) setTimeout(() => { try { closeBtn.focus({ preventScroll: true }); } catch (_) {} }, 80);
    }

    function cltmClose() {
        if (!cltmOverlay || cltmOverlay.hidden || cltmClosing) return;
        const key = cltmOpenKey;
        cltmOpenKey = null;
        cltmClosing = true;
        if (cltmSettleTimer) { clearTimeout(cltmSettleTimer); cltmSettleTimer = null; }
        // Falls der Open-Settle noch nicht gefeuert hat (schnelles
        // Schliessen): Listener abhängen, sonst würde er während des
        // Schliessens den CLOSE-Ghost entfernen.
        if (cltmSettleHandler) {
            cltmModal.removeEventListener('transitionend', cltmSettleHandler);
            cltmSettleHandler = null;
        }

        const finish = () => {
            cltmClosing = false;
            cltmModalManager = null;
            cltmOverlay.hidden = true;
            cltmOverlay.classList.remove('is-open', 'is-closing', 'is-settled');
            cltmModal.style.transform = '';
            cltmUnlockBody();
            // Ghost entfernen und Kachel im selben Frame wieder einblenden –
            // der Klon landet exakt auf der Kachel, der Tausch ist unsichtbar.
            cltmRemoveGhost();
            document.querySelectorAll('.cltm-tile.cltm-src-hidden').forEach((el) => el.classList.remove('cltm-src-hidden'));
            if (cltmLastTrigger && document.contains(cltmLastTrigger)) {
                try { cltmLastTrigger.focus({ preventScroll: true }); } catch (_) {}
            }
            cltmLastTrigger = null;
        };

        // Die Ursprungs-Kachel kann durch ein Daten-Re-Render ersetzt worden
        // sein → frisch über den Manager-Namen suchen (Fallback: nur Fade).
        let tileEl = null;
        if (key) {
            try {
                const esc = (window.CSS && typeof CSS.escape === 'function') ? CSS.escape(key) : key.replace(/"/g, '\\"');
                tileEl = document.querySelector(`.cltm-tile[data-manager="${esc}"]`);
            } catch (_) { tileEl = null; }
        }

        // Blur sofort weg (billig), dann rein Compositor-Animation zurück.
        cltmOverlay.classList.remove('is-settled');
        cltmOverlay.classList.add('is-closing');
        cltmOverlay.classList.remove('is-open');

        if (!cltmPrefersReducedMotion() && tileEl) {
            const to = tileEl.getBoundingClientRect();
            const from = cltmModal.getBoundingClientRect();
            cltmModal.style.transformOrigin = 'top left';
            cltmModal.style.transform = `translate3d(${to.left - from.left}px, ${to.top - from.top}px, 0) `
                + `scale(${to.width / Math.max(from.width, 1)}, ${to.height / Math.max(from.height, 1)})`;

            // Ghost-Rückweg: startet als aufgeblasene Kachel auf dem Modal
            // und schrumpft mit der Karussell-Kurve exakt auf den Platz der
            // Kachel zurück, während das Modal ausblendet (Crossfade).
            const ghost = cltmMakeGhost(tileEl, to);
            ghost.classList.add('is-in');
            ghost.style.transform = `translate3d(${from.left - to.left}px, ${from.top - to.top}px, 0) `
                + `scale(${from.width / Math.max(to.width, 1)}, ${from.height / Math.max(to.height, 1)})`;
            void ghost.offsetWidth; // Startzustand rendern lassen
            ghost.style.transform = '';
            ghost.classList.remove('is-in');
        }

        // Abschluss EXAKT beim Landen des Ghosts: transitionend seiner
        // transform-Transition (elapsedTime-Guard filtert die spuriosen
        // 0ms-Events). Ein knapper fester Timer hat das Ende der Rück-
        // Animation unter Last abgeschnitten – CSS-Transitions starten erst
        // mit dem nächsten Frame-Commit, die Kachel „blitzte" dann die
        // letzten Pixel an ihren Platz. Der Timer bleibt nur als
        // grosszügiger Fallback (z. B. reduced motion: kein Ghost).
        let done = false;
        const onEnd = (ev) => {
            if (done) return;
            if (ev && (ev.propertyName !== 'transform' || ev.elapsedTime < 0.55)) return;
            done = true;
            finish();
        };
        if (cltmGhost) cltmGhost.addEventListener('transitionend', onEnd);
        requestAnimationFrame(() => {
            requestAnimationFrame(() => {
                setTimeout(() => onEnd(null), CLTM_MOVE_MS + 300);
            });
        });
    }

    /* ── Kachel-Bühne: „Top" (Podest + Reihe) / „Alle" ──────────────────
       Gleiche Technik wie die Chips im Popup: Alle Kacheln sind absolut
       positioniert und werden rein über transform platziert; ein Ansicht-
       Wechsel ändert nur Transforms (FLIP mit Scale-Korrektur für die
       Grössenänderung) – die CSS-Transition (Karussell-Kurve) animiert
       die Kacheln flüssig auf ihre neuen Plätze.

       „Top":  Podest oben (Rang 1 Mitte am grössten, Rang 2 links etwas
               kleiner, Rang 3 rechts nochmals kleiner, unten bündig) +
               eine Reihe ab Rang 4. Übrige Manager sind ausgeblendet.
       „Alle": alle Manager als gleich grosse, kleinere Kacheln, der
               Reihe nach ab Rang 1 oben links.
       Die Kachel-Innengrössen skalieren über Container-Queries (cqw)
       mit der Kachelbreite. */
    let cltmSignature = null;
    let cltmView = 'top';                 // 'top' | 'alle'
    let cltmTileManagers = [];            // aktuell gerenderte Manager (Rang-Reihenfolge)
    let cltmTileLayout = new Map();       // manager → { x, y, w } (zuletzt angewandtes Layout)
    let cltmListResizeTimer = null;

    function cltmListEl() {
        return document.getElementById('clTopManagersList');
    }

    // Geometrie je Container-Breite. Podest-Einheit p so gedeckelt, dass
    // die drei Podest-Kacheln (1.3p / 1.1p / 1.0p) immer nebeneinander
    // passen; die Reihen-Kacheln sind nie grösser als Rang 3.
    function cltmSectionGeometry(W) {
        const wide = W >= 900;
        const mid = W >= 560 && W < 900;
        const gap = wide ? 16 : (mid ? 14 : 10);
        const rowCols = wide ? 5 : (mid ? 4 : 3);
        const p = Math.min((W - (rowCols - 1) * gap) / rowCols, (W - 2 * gap) / 3.4);
        const r = Math.min((W - (rowCols - 1) * gap) / rowCols, p);
        const allCols = Math.max(rowCols, Math.floor((W + gap) / (160 + gap)));
        const a = (W - (allCols - 1) * gap) / allCols;
        return { gap, rowCols, r, p, allCols, a, topCount: 3 + rowCols };
    }

    // Layout für eine Ansicht: Position/Grösse je Rang-Index + Gesamthöhe.
    function cltmComputeTileLayout(W, view, count) {
        const g = cltmSectionGeometry(W);
        const pos = [];
        let height;

        if (view === 'top') {
            // Ganzzahlige Kachelbreiten + additiv aufgebaute Positionen:
            // so sind alle Abstände exakt g.gap (keine ±1px-Rundungsfehler).
            const s1 = Math.round(g.p * 1.3);
            const s2 = Math.round(g.p * 1.1);
            const s3 = Math.round(g.p);
            const podW = s2 + s1 + s3 + 2 * g.gap;
            const podX = (W - podW) / 2;
            const podH = s1;
            // Rang 2 links, Rang 1 Mitte (grösste), Rang 3 rechts – unten bündig.
            if (count > 1) pos[1] = { x: podX, y: podH - s2, w: s2 };
            pos[0] = { x: podX + s2 + g.gap, y: 0, w: s1 };
            if (count > 2) pos[2] = { x: podX + s2 + g.gap + s1 + g.gap, y: podH - s3, w: s3 };

            const n = Math.min(g.rowCols, Math.max(0, count - 3));
            const rI = Math.floor(g.r);
            const rowY = podH + g.gap * 1.4;
            const rowW = n * rI + Math.max(0, n - 1) * g.gap;
            const rowX = (W - rowW) / 2;
            for (let i = 0; i < n; i++) {
                pos[3 + i] = { x: rowX + i * (rI + g.gap), y: rowY, w: rI };
            }
            // Ausgeblendete Ränge (hinter der Reihe) parken unsichtbar
            // zentriert in der Reihe – so haben ALLE Kacheln stets eine
            // Geometrie und bleiben innerhalb der Bühnen-Höhe (kein
            // unsichtbares Aufblähen der Seiten-Scrollhöhe).
            for (let i = 3 + n; i < count; i++) {
                pos[i] = { x: (W - rI) / 2, y: n > 0 ? rowY : 0, w: rI };
            }
            height = (n > 0 ? rowY + g.r : podH) + 4;
            return { pos, height, topCount: g.topCount };
        }

        const aI = Math.floor(g.a);
        const gridW = g.allCols * aI + (g.allCols - 1) * g.gap;
        const startX = (W - gridW) / 2;
        for (let i = 0; i < count; i++) {
            pos[i] = {
                x: startX + (i % g.allCols) * (aI + g.gap),
                y: Math.floor(i / g.allCols) * (aI + g.gap),
                w: aI
            };
        }
        const rows = Math.max(1, Math.ceil(count / g.allCols));
        height = rows * aI + (rows - 1) * g.gap + 4;
        return { pos, height, topCount: g.topCount };
    }

    // Platz der Top-Ansicht schon VOR dem Daten-Render reservieren –
    // unsichtbar (kein Skeleton-Raster), aber mit fester Höhe, damit beim
    // Eintreffen der Daten nichts nach unten rutscht.
    function cltmReserveListHeight() {
        const list = cltmListEl();
        if (!list || list.querySelector('.cltm-tile')) return;
        const W = list.clientWidth;
        if (!W) return;
        const { height } = cltmComputeTileLayout(W, 'top', 8);
        list.style.minHeight = Math.ceil(height) + 'px';
    }

    function cltmLayoutTiles(animate) {
        const list = cltmListEl();
        if (!list) return;
        const tiles = Array.from(list.querySelectorAll('.cltm-tile'));
        if (!tiles.length) return;
        const W = list.clientWidth;
        if (!W) return;

        const { pos, height, topCount } = cltmComputeTileLayout(W, cltmView, tiles.length);
        const place = (tile, x, y, scale) => {
            tile.style.transform = `translate3d(${x.toFixed(2)}px, ${y.toFixed(2)}px, 0)`
                + (scale && scale !== 1 ? ` scale(${scale})` : '');
        };
        // Breite/Höhe + --tw setzen: über --tw skalieren ALLE Innengrössen
        // der Kachel (Fonts, Badges, Avatare) mit der Kachelbreite mit.
        const size = (tile, w) => {
            tile.style.width = w + 'px';
            tile.style.height = w + 'px';
            tile.style.setProperty('--tw', w + 'px');
        };

        // Pass 1 (nur animiert): Startzustände setzen – bereits sichtbare
        // Kacheln an alter Position/Grösse (Scale-Korrektur für die neue
        // Breite), neu erscheinende leicht verkleinert am Zielort.
        if (animate) {
            list.classList.add('cltm-no-anim');
            tiles.forEach((tile, i) => {
                const target = pos[i];
                if (!target) return;
                const key = tile.dataset.manager || String(i);
                const prev = cltmTileLayout.get(key);
                const wasHidden = tile.classList.contains('is-hidden');
                size(tile, target.w);
                if (prev && !wasHidden) {
                    place(tile, prev.x, prev.y, prev.w / target.w);
                } else {
                    place(tile, target.x, target.y, 0.9);
                }
            });
            void list.offsetWidth;
            list.classList.remove('cltm-no-anim');
        } else {
            list.classList.add('cltm-no-anim');
        }

        // Pass 2: Zielzustände (bei animate laufen jetzt die Transitions).
        const nextLayout = new Map();
        tiles.forEach((tile, i) => {
            const target = pos[i];
            const key = tile.dataset.manager || String(i);
            const hidden = cltmView === 'top' && i >= topCount;
            if (!target) { tile.classList.add('is-hidden'); return; }
            size(tile, target.w);
            tile.classList.toggle('is-hidden', hidden);
            place(tile, target.x, target.y, hidden ? 0.9 : 1);
            nextLayout.set(key, target);
        });
        cltmTileLayout = nextLayout;

        list.style.height = Math.ceil(height) + 'px';
        list.style.minHeight = '';

        if (!animate) {
            void list.offsetWidth;
            list.classList.remove('cltm-no-anim');
        }
    }

    function cltmSetView(view) {
        if (view !== 'top' && view !== 'alle') return;
        if (view === cltmView) return;
        cltmView = view;

        const list = cltmListEl();
        if (list && list.querySelector('.cltm-tile')) {
            // Sanfter Stagger wie beim Position/Punkte-Toggle im Popup.
            const tiles = Array.from(list.querySelectorAll('.cltm-tile'));
            tiles.forEach((t, i) => { t.style.transitionDelay = Math.min(i * 14, 200) + 'ms'; });
            cltmLayoutTiles(true);
            setTimeout(() => { tiles.forEach((t) => { t.style.transitionDelay = ''; }); }, 1000);
        }

        document.querySelectorAll('.cltm-view-toggle .pt-toggle-btn').forEach((btn) => {
            const active = btn.dataset.view === view;
            btn.classList.toggle('active', active);
            btn.setAttribute('aria-selected', active ? 'true' : 'false');
        });
    }

    function cltmSignatureOf(rankedManagers) {
        const managers = Array.isArray(rankedManagers) ? rankedManagers : [];
        const duplicateFirstNames = Array.from(champDuplicateFirstNameKeys(managers)).sort();
        return JSON.stringify({
            duplicateFirstNames,
            list: managers.map((m, idx) => ({
                rank: getDisplayedManagerRank(m, idx + 1),
                manager: m.manager || 'Unbekannt',
                totalScore: Number(m.totalScore) || 0,
                outs: (m.transferredOut || []).map((p) => String(p.id ?? '')),
                players: (m.mergedPlayers || []).map((p) => [
                    String(p.id ?? ''),
                    Number(p.pts) || 0,
                    Number.isFinite(Number(p.slotNum)) ? Number(p.slotNum) : -1
                ])
            }))
        });
    }

    function renderClTopManagers(rankedManagers) {
        const list = cltmListEl();
        if (!list) return;

        const signature = cltmSignatureOf(rankedManagers);
        if (signature === cltmSignature) return;
        cltmSignature = signature;

        const managers = Array.isArray(rankedManagers) ? rankedManagers : [];
        const duplicateFirstNames = champDuplicateFirstNameKeys(rankedManagers);

        cltmTileManagers = managers;
        cltmTileLayout = new Map();
        list.innerHTML = '';

        if (!managers.length) {
            list.style.height = '';
            list.style.minHeight = '';
            list.innerHTML = '<div class="cltm-empty">Noch keine Teams vorhanden.</div>';
            return;
        }

        const created = [];
        managers.forEach((m, idx) => {
            const rank = getDisplayedManagerRank(m, idx + 1);
            const rankCls = rank === 1 ? 'r1' : rank === 2 ? 'r2' : rank === 3 ? 'r3' : '';
            const top3 = (m.mergedPlayers || []).filter((p) => Number.isFinite(p.pts)).slice(0, 3);
            const shortName = champShortManagerName(m.manager, duplicateFirstNames);

            const tile = document.createElement('button');
            tile.type = 'button';
            tile.className = 'cltm-tile';
            tile.dataset.manager = m.manager || '';
            tile.style.opacity = '0';   // Erst-Einblendung unten (nur Opacity)
            tile.setAttribute('aria-haspopup', 'dialog');
            tile.setAttribute('aria-label', `Platz ${rank}: ${m.manager || 'Unbekannt'}, ${cltmFormatPts(m.totalScore)} Punkte. Detailkarte öffnen.`);
            tile.innerHTML = `
                <span class="cltm-tile-head">
                    <span class="cltm-rank ${rankCls}">${rank}</span>
                    <span class="cltm-name">${champEscapeHtml(shortName)}</span>
                </span>
                <span class="cltm-tile-pts">${cltmFormatPts(m.totalScore)}<small>Pkt</small></span>
                <span class="cltm-top3" aria-hidden="true">
                    ${top3.map((p) => `
                        <span class="cltm-top3-player" title="${champEscapeHtml(p.name || '')}">
                            <span class="cltm-top3-avatar">${cltmAvatarHtml(p)}</span>
                            <span class="cltm-top3-pts">${cltmFormatPts(p.pts)}</span>
                        </span>`).join('')}
                </span>
            `;
            tile.addEventListener('click', () => cltmOpen(m, tile));
            list.appendChild(tile);
            created.push(tile);
        });

        cltmBindImgFallbacks(list);
        cltmLayoutTiles(false);

        // Erst-Einblendung: Positionen stehen bereits fest, die Kacheln
        // faden nur gestaffelt ein (kein Layout-Shift, kein Raster-Pop).
        requestAnimationFrame(() => {
            requestAnimationFrame(() => {
                created.forEach((t, i) => {
                    t.style.transitionDelay = Math.min(i * 40, 500) + 'ms';
                    t.style.opacity = '';
                });
                setTimeout(() => { created.forEach((t) => { t.style.transitionDelay = ''; }); }, 1400);
            });
        });

        // Kommt während offener Detailkarte ein Re-Render, bleibt die
        // Ursprungs-Kachel des offenen Managers unsichtbar (Expand-Illusion).
        if (cltmOpenKey !== null) {
            const openTile = created.find((el) => el.dataset && el.dataset.manager === cltmOpenKey);
            if (openTile) openTile.classList.add('cltm-src-hidden');
        }
    }

    /* =========================================================
       POST START HOME – Render-Funktion (Live Dashboard)
       ========================================================= */
    function renderPostStartHome(data) {
        const teams = Array.isArray(data.teams) ? data.teams : [];
        transferScoreCtx = buildTransferScoreCtx(data);
        const ptMap = computeTotalPoints(data.points);

        const topPlayers = [...playersData]
            .map((p) => ({ ...p, _pts: ptMap[String(p['player.id'])] || 0 }))
            .sort((a, b) => b._pts - a._pts || a.Spielername.localeCompare(b.Spielername, 'de'));

        rankingHistoryCache = computeRankingHistory(data);
        const historyByManager = new Map(
            (rankingHistoryCache.teams || []).map(t => [t.manager, t.history])
        );

        const teamTotals = teams.map((t) => ({
            manager: t.manager || 'Unbekannt',
            timestamp: t.timestamp,
            submittedAt: t.submittedAt,
            createdAt: t.createdAt,
            createdAtMs: t.createdAtMs,
            total: getTeamTotal(t, ptMap),
            history: historyByManager.get(t.manager || 'Unbekannt') || []
        })).sort((a, b) => compareByTotalThenSubmission(a, b, 'total'));
        assignSharedRanks(teamTotals, team => team.total, (team, rank) => { team.currentRank = rank; });

        // Top-Manager-Bereich: CL → kompakte Top-10-Liste mit Expand-Karte,
        // WM → unverändert die Champ-Stage (Podest mit Animation).
        const champRanking = buildChampRanking(data);
        if (APP && String(APP.type || '').toUpperCase() === 'CL') {
            renderClTopManagers(champRanking);
        } else {
            renderChampStage(champRanking);
        }

        renderNextMatchesTile(data, teams);

        renderPostTopPlayersGrid(topPlayers, ptMap);
        renderCompactPerfectTeam(ptMap, 'post-');
        initPostPlayersToggle();

        const pickCounts = {};
        teams.forEach((t) => {
            (t.players || []).forEach((tp) => {
                const full = resolvePlayer(tp);
                if (!full) return;
                const id = String(full['player.id']);
                pickCounts[id] = (pickCounts[id] || 0) + 1;
            });
        });

        renderPeriodButtons(rankingHistoryCache.matchIds, 'post-');

        const nationMap = new Map();
        playersData.forEach((p) => {
            const nation = p['Nationalteam.name'];
            if (!nation) return;
            const pts = ptMap[String(p['player.id'])] || 0;
            nationMap.set(nation, (nationMap.get(nation) || 0) + pts);
        });
        const topNations = Array.from(nationMap.entries())
            .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], 'de'));
        renderTopNations(topNations, 'post-');

        renderManagerPicks(teams, ptMap, 'post-');

        // Duplizierte Pre-Start-Kacheln auch im Post-Start anzeigen
        const captainCountsPost = {};
        teams.forEach((t) => {
            (t.players || []).forEach((tp) => {
                if (!tp || !tp.isCaptain) return;
                const full = resolvePlayer(tp);
                if (!full) return;
                const id = String(full['player.id']);
                captainCountsPost[id] = (captainCountsPost[id] || 0) + 1;
            });
        });
        renderCaptainWatch(captainCountsPost, ptMap, 'post-');
        renderTopClubs(teams, 'post-');
        renderScoutingBarometer(teams, 'post-');
        renderAgeStructure(teams, 'post-');

        initScrollReveal();

    }

    /**
     * Haupteinstiegspunkt: Bestimmt den aktiven Modus,
     * blendet die richtige Sektion ein und rendert deren Daten.
     * Wird bei jedem Daten-Update aufgerufen.
     */

    /* ===================================================================
       TCC-CAROUSEL – 1:1 Port der Karussell-Logik aus test.html.
       Wichtig: alle CSS-Klassen tragen den `tcc-`-Namespace, damit globale
       index.html-Selektoren (.player-card, .player-name, .meta-row …)
       keinerlei Eigenschaften (z. B. Transitions auf transform) überlagern,
       die die Animation auf der Startseite zuvor hängen ließen.
       =================================================================== */
    (() => {
        const root = document.getElementById('test-carousel-copy');
        if (!root) return;
        const track    = root.querySelector('#indexTestCarouselTrack');
        const carousel = root.querySelector('#indexTestCarousel');
        const titleEl  = root.querySelector('#indexTestCarouselTitle');
        if (!track || !carousel) return;

        const DEFAULT_CAROUSEL_TITLE = 'Stars der WM 2026';
        const VARIANT_STORAGE_KEY = 'tcc_carousel_last_variant';
        // Merkt sich, welche Karte beim letzten Laden im Zentrum stand, damit
        // die zufällige Zentrums-Wahl (nur CL) nicht zweimal hintereinander
        // denselben Spieler zeigt („jedes Mal ein ANDERER Spieler").
        const CENTER_STORAGE_KEY = 'tcc_carousel_last_center';

        const escapeHtml = (value) => String(value ?? '').replace(/[&<>"']/g, (ch) => ({
            '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
        }[ch]));

        const normalizeName = (s) => String(s ?? '')
            .normalize('NFD')
            .replace(/[\u0300-\u036f]/g, '')
            .toLowerCase()
            .trim();

        // WICHTIG – Anzeige-Konvention der App (siehe data.js, Schritt 4
        // „Club-zentrierter Remap"): `Nationalteam.*` sind die PRIMÄREN
        // Anzeigefelder. Bei der WM (primaryEntity "nation") stecken dort
        // Nation + Flagge. Bei CL-Turnieren (primaryEntity "club") schiebt
        // data.js zur Ladezeit den KLUB in diese Felder (und die Nation in
        // `Club.*`). Wer hier `Club.logo` liest, bekommt in der CL also die
        // FLAGGE – genau dieser Fehler hat im Karussell Flaggen statt
        // Klublogos angezeigt. Deshalb liest das Karussell ausschliesslich
        // die primären Felder: WM → Flagge+Nation, CL → Klublogo+Klubname.
        function normalizePlayer(raw) {
            return {
                id: String(raw['player.id']),
                name: raw.Spielername,
                badgeLabel: raw['Nationalteam.name'] || '',
                badgeLogo: raw['Nationalteam.logo'] || '',
                img: raw.Spielerfoto || ''
            };
        }

        function readTeamsFromKey(key) {
            try {
                const raw = localStorage.getItem(key);
                if (!raw) return null;
                const parsed = JSON.parse(raw);
                const teams = Array.isArray(parsed)
                    ? parsed
                    : (Array.isArray(parsed?.data) ? parsed.data : null);
                return Array.isArray(teams) ? teams : null;
            } catch (_) {
                return null;
            }
        }

        // Liefert die Teams des AKTUELLEN Turniers aus dem LocalStorage.
        // Wichtig: wir lesen ausschließlich den exakten Cache-Key
        // (`<prefix>_teams`) des aktiven Turniers. Frühere Versionen haben
        // alle Keys gescannt, die auf `_teams` enden, und davon den
        // Datensatz mit den MEISTEN Einträgen gewählt. Das führte dazu,
        // dass nach dem Löschen von Managern entweder das ältere
        // `_last_good_teams`-Backup oder die Teams eines anderen Turniers
        // gewonnen haben – das Karussell zeigte dann veraltete bzw.
        // turnierfremde Daten statt der echten Auswahl der verbliebenen
        // Manager.
        function parseTeamsFromStorage() {
            const app = window.APP_CONFIG;
            if (app && app.storage && typeof app.storage.key === 'function') {
                const primary = readTeamsFromKey(app.storage.key('teams'));
                if (Array.isArray(primary)) return primary;
                // Wenn der Live-Key noch nie geschrieben wurde (frischer
                // Browser), greifen wir auf das `last_good`-Backup desselben
                // Turniers zurück, damit das Karussell nicht leer bleibt.
                const backup = readTeamsFromKey(app.storage.key('last_good_teams'));
                if (Array.isArray(backup)) return backup;
                return [];
            }

            // Fallback: APP_CONFIG ist (noch) nicht geladen – wir lesen
            // ausschließlich Keys vom Typ `<prefix>_teams` (NICHT
            // `_last_good_teams`) und nehmen den ersten Treffer mit Daten.
            for (let i = 0; i < localStorage.length; i++) {
                const key = localStorage.key(i);
                if (!key || !key.endsWith('_teams') || key.endsWith('_last_good_teams')) continue;
                const teams = readTeamsFromKey(key);
                if (Array.isArray(teams) && teams.length) return teams;
            }
            return [];
        }

        const wm2026StarRotation = [
            {
                id: "wm_stars_set_1",
                title: "Stars der WM 2026",
                players: [
                    { name: "Kylian Mbappé", nation: "Frankreich", position: "ANG" },
                    { name: "Lionel Messi", nation: "Argentinien", position: "ANG" },
                    { name: "Jude Bellingham", nation: "England", position: "MIT" },
                    { name: "Vinícius Júnior", nation: "Brasilien", position: "ANG" },
                    { name: "Erling Haaland", nation: "Norwegen", position: "ANG" },
                    { name: "Cristiano Ronaldo", nation: "Portugal", position: "ANG" },
                    { name: "Lamine Yamal", nation: "Spanien", position: "ANG" },
                    { name: "Christian Pulisic", nation: "USA", position: "ANG" },
                    { name: "Federico Valverde", nation: "Uruguay", position: "MIT" },
                    { playerId: 186, name: "Heungmin Son", nation: "South Korea", position: "ANG" },
                    { name: "Harry Kane", nation: "England", position: "ANG" },
                    { name: "Florian Wirtz", nation: "Deutschland", position: "MIT" },
                    { name: "Virgil van Dijk", nation: "Niederlande", position: "DEF" },
                    { name: "Thibaut Courtois", nation: "Belgien", position: "TOR" },
                    { name: "Alexander Isak", nation: "Schweden", position: "ANG" }
                ]
            },
            {
                id: "wm_stars_set_2",
                title: "Stars der WM 2026",
                players: [
                    { name: "Luka Modrić", nation: "Kroatien", position: "MIT" },
                    { name: "Luis Díaz", nation: "Kolumbien", position: "ANG" },
                    { name: "Achraf Hakimi", nation: "Marokko", position: "DEF" },
                    { name: "Mohamed Salah", nation: "Ägypten", position: "ANG" },
                    { name: "Hakan Çalhanoğlu", nation: "Türkei", position: "MIT" },
                    { name: "Takefusa Kubo", nation: "Japan", position: "MIT/ANG" },
                    { name: "Moisés Caicedo", nation: "Ecuador", position: "MIT" },
                    { name: "Sadio Mané", nation: "Senegal", position: "ANG" },
                    { name: "Riyad Mahrez", nation: "Algerien", position: "ANG" },
                    { name: "Edin Džeko", nation: "Bosnien & Herzegowina", position: "ANG" },
                    { name: "Akram Afif", nation: "Katar", position: "ANG" },
                    { name: "Granit Xhaka", nation: "Schweiz", position: "MIT" },
                    { name: "Patrik Schick", nation: "Tschechien", position: "ANG" },
                    { name: "Abdukodir Khusanov", nation: "Usbekistan", position: "DEF" },
                    { name: "Alphonso Davies", nation: "Kanada", position: "DEF" }
                ]
            },
            {
                id: "most_picked_players",
                title: "Meistgewählte Spieler",
                type: "dynamic",
                source: "mostPickedPlayers"
            }
        ];

        // Champions-League-Stars (Saison 2025/26): genau diese 14 Topspieler,
        // alle über ihre player.id im CL-Datensatz vorhanden – Foto, Klub und
        // Klubname kommen also direkt aus data-cl2526.js. Titel bewusst leer
        // (kein „Stars der …" über dem Karussell in der CL).
        //
        // REIHENFOLGE: bewusst so gewählt, dass NIE zwei direkt benachbarte
        // Spieler demselben Klub angehören – auch über den Ring-Umlauf hinweg
        // (das Karussell ist zirkulär, letzte Karte grenzt an erste). Die
        // Klub-Cluster (Real Madrid ×3, PSG ×4, Barça ×2, Arsenal ×2) sind
        // deshalb gleichmässig verteilt. Welcher Spieler beim Laden im Zentrum
        // steht, wird zufällig gewählt (siehe pickInitialActive) – die
        // Ring-Reihenfolge bleibt dabei gültig, egal wo das Zentrum liegt.
        const cl2526StarRotation = [
            {
                id: "cl_stars_set_1",
                title: "",
                players: [
                    { playerId: 128384, name: "Vitinha",               nation: "Portugal",     position: "MIT" }, // PSG
                    { playerId: 278,    name: "Kylian Mbappé",         nation: "Frankreich",   position: "ANG" }, // Real Madrid
                    { playerId: 483,    name: "Khvicha Kvaratskhelia", nation: "Georgien",     position: "ANG" }, // PSG
                    { playerId: 129718, name: "Jude Bellingham",       nation: "England",      position: "MIT" }, // Real Madrid
                    { playerId: 335051, name: "João Neves",            nation: "Portugal",     position: "MIT" }, // PSG
                    { playerId: 762,    name: "Vinícius Júnior",       nation: "Brasilien",    position: "ANG" }, // Real Madrid
                    { playerId: 343027, name: "Désiré Doué",           nation: "Frankreich",   position: "ANG" }, // PSG
                    { playerId: 386828, name: "Lamine Yamal",          nation: "Spanien",      position: "ANG" }, // Barcelona
                    { playerId: 1100,   name: "Erling Haaland",        nation: "Norwegen",     position: "ANG" }, // Man City
                    { playerId: 133609, name: "Pedri",                 nation: "Spanien",      position: "MIT" }, // Barcelona
                    { playerId: 2937,   name: "Declan Rice",           nation: "England",      position: "MIT" }, // Arsenal
                    { playerId: 19617,  name: "Michael Olise",         nation: "Frankreich",   position: "MIT" }, // Bayern München
                    { playerId: 1460,   name: "Bukayo Saka",           nation: "England",      position: "ANG" }, // Arsenal
                    { playerId: 6009,   name: "Julián Álvarez",        nation: "Argentinien",  position: "ANG" }  // Atlético Madrid
                ]
            }
        ];

        // Turnierabhängige Auswahl: CL-Turniere nutzen die CL-Stars, alle
        // anderen (WM) die bisherige WM-Rotation.
        const IS_CL = !!(window.APP_CONFIG && String(window.APP_CONFIG.key || "").toLowerCase().indexOf("cl") === 0);
        const starRotation = IS_CL ? cl2526StarRotation : wm2026StarRotation;

        const STAR_NAME_ALIASES = {
            "abdukodir khusanov": ["abduqodir khusanov"]
        };

        function getPlayersDataset() {
            const fromWindow = Array.isArray(window.playersData) ? window.playersData : null;
            if (fromWindow && fromWindow.length) return fromWindow;
            // `playersData` wird in data.js mit `const` deklariert und ist
            // dadurch nicht zwingend auf `window` verfügbar. Wir versuchen
            // deshalb auch den globalen Bezeichner direkt zu lesen.
            try {
                if (typeof playersData !== 'undefined' && Array.isArray(playersData)) {
                    return playersData;
                }
            } catch (_) {}
            return [];
        }

        function getPlayerLookup() {
            const dataset = getPlayersDataset();
            const byNormName = new Map();
            const byId = new Map();
            dataset.forEach((p) => {
                const key = normalizeName(p.Spielername);
                if (key && !byNormName.has(key)) byNormName.set(key, p);
                const id = String(p['player.id'] ?? '');
                if (id && !byId.has(id)) byId.set(id, p);
            });
            return { byNormName, byId };
        }

        function resolveDatasetPlayerByName(name, byNormName) {
            const norm = normalizeName(name);
            if (byNormName.has(norm)) return byNormName.get(norm);
            const aliases = STAR_NAME_ALIASES[norm];
            if (aliases) {
                for (const alt of aliases) {
                    const found = byNormName.get(normalizeName(alt));
                    if (found) return found;
                }
            }
            return null;
        }

        function resolveDatasetPlayer(star, lookup) {
            if (star?.playerId != null) {
                const foundById = lookup.byId.get(String(star.playerId));
                if (foundById) return foundById;
            }
            return resolveDatasetPlayerByName(star?.name, lookup.byNormName);
        }

        function buildStaticPlayerId(name) {
            const slug = normalizeName(name)
                .replace(/[^a-z0-9]+/g, '-')
                .replace(/^-+|-+$/g, '');
            return `static:${slug || 'player'}`;
        }

        function buildStaticPlayerItem(star, lookup) {
            const raw = resolveDatasetPlayer(star, lookup);
            if (raw) {
                return {
                    ...normalizePlayer(raw),
                    name: star.name,
                    nation: star.nation || '',
                    position: star.position || ''
                };
            }
            // Fallback ohne Datensatztreffer: kein Logo verfügbar – als Label
            // dient die Nation aus der Star-Liste (das Badge-Bild entfällt,
            // renderPlayerCard rendert das <img> nur bei vorhandenem Logo).
            return {
                id: buildStaticPlayerId(star.name),
                name: star.name,
                badgeLabel: star.nation || '',
                badgeLogo: '',
                img: '',
                nation: star.nation || '',
                position: star.position || ''
            };
        }

        function buildStaticStarItems(group, limit = 15) {
            const lookup = getPlayerLookup();
            return (group.players || [])
                .map((star) => buildStaticPlayerItem(star, lookup))
                .slice(0, limit);
        }

        function buildTopDraftedPlayers(limit = 15) {
            const dataset = getPlayersDataset();
            const playersById = new Map(dataset.map((p) => [String(p['player.id']), p]));
            const pickCounts = new Map();
            const teams = parseTeamsFromStorage();

            teams.forEach((team) => {
                (team?.players || []).forEach((player) => {
                    const id = String(player?.playerId || '');
                    if (!id || !playersById.has(id)) return;
                    pickCounts.set(id, (pickCounts.get(id) || 0) + 1);
                });
            });

            return Array.from(pickCounts.entries())
                .map(([id, drafts]) => ({ ...normalizePlayer(playersById.get(id)), drafts }))
                .sort((a, b) => b.drafts - a.drafts)
                .slice(0, limit);
        }

        function getRotationEntry(id) {
            return starRotation.find((entry) => entry.id === id) || null;
        }

        function getNextRotationEntry(lastVariant) {
            const lastIndex = starRotation.findIndex((entry) => entry.id === lastVariant);
            const nextIndex = lastIndex >= 0 ? (lastIndex + 1) % starRotation.length : 0;
            return starRotation[nextIndex];
        }

        function buildRotationItems(entry, limit = 15) {
            if (entry?.type === 'dynamic' && entry.source === 'mostPickedPlayers') {
                return buildTopDraftedPlayers(limit);
            }
            return buildStaticStarItems(entry, limit);
        }

        function pickVariantAndItems(limit = 15, forceVariant = null) {
            let lastVariant = null;
            try { lastVariant = localStorage.getItem(VARIANT_STORAGE_KEY); } catch (_) {}
            let entry = forceVariant ? getRotationEntry(forceVariant) : getNextRotationEntry(lastVariant);
            if (!entry) entry = starRotation[0];

            let items = buildRotationItems(entry, limit);
            if (!items.length) {
                for (const fallbackEntry of starRotation) {
                    if (fallbackEntry.id === entry.id) continue;
                    const fallbackItems = buildRotationItems(fallbackEntry, limit);
                    if (fallbackItems.length) {
                        entry = fallbackEntry;
                        items = fallbackItems;
                        break;
                    }
                }
            }

            try { localStorage.setItem(VARIANT_STORAGE_KEY, entry.id); } catch (_) {}
            return { variant: entry.id, items };
        }

        function setCarouselTitle(variant) {
            if (!titleEl) return;
            const entry = getRotationEntry(variant);
            titleEl.textContent = entry?.title || DEFAULT_CAROUSEL_TITLE;
        }

        let players = [];
        let cards = [];

        // ────────────────────────────────────────────────────────────────
        //  COVERFLOW-KONSTANTEN
        //  Portiert aus der Framer-Vorlage „Smooth 3D Slideshow": die aktive
        //  Karte steht aufrecht im Fokus, die Nachbarn kippen in der
        //  Perspektive nach hinten. Klick/Tap holt eine Seitenkarte in die
        //  Mitte, Klick auf die aktive Karte öffnet die Spieleranalyse.
        //  Der sichtbare Fächer umfasst 5 Karten (aktive + 2 je Seite);
        //  weiter entfernte Karten blenden aus und werden durchgeblättert.
        // ────────────────────────────────────────────────────────────────
        // Anzahl Karten im Karussell (Pool zum Durchblättern). CL zeigt genau
        // die 14 kuratierten Stars; die WM bleibt unveraendert bei 9.
        const CARD_COUNT     = IS_CL ? 14 : 9;
        const AUTOPLAY       = false;  // Autoplay deaktiviert – nur manuelle Navigation
        const MAX_VISIBLE    = 2;      // aktive Karte + 2 je Seite = 5 sichtbar
        const SCALE_STEP     = 0.16;   // Verkleinerung je Schritt
        const SPREAD_FACTOR  = 0.62;   // horizontaler Abstand relativ zur Kartenbreite
        const DEPTH_FACTOR   = 0.6;    // Tiefe (translateZ) relativ zur Kartenbreite
        const TILT           = 12;     // rotateY je Schritt (Grad)
        const SIDE_TILT      = 8;      // rotateZ je Schritt (Grad)
        const INACTIVE_DIM   = 0.4;    // Abdunklung inaktiver Karten (opacity 60 → dim 0.4)
        const MOVE_DUR       = 0.6;    // Übergangsdauer (Sekunden)
        const MOVE_EASE      = 'cubic-bezier(0.22, 1, 0.36, 1)';
        const TRANSITION_CSS = `transform ${MOVE_DUR}s ${MOVE_EASE}, opacity ${MOVE_DUR}s ${MOVE_EASE}`;
        const AUTOPLAY_DELAY = 2500;   // ms Haltezeit je Karte
        const SWIPE_THRESHOLD = 40;    // px, ab denen eine Wischgeste zählt (statt Tap)

        const prefersReducedMotion = !!(window.matchMedia
            && window.matchMedia('(prefers-reduced-motion: reduce)').matches);

        function renderPlayerCard(p) {
            const el = document.createElement('article');
            el.className = 'tcc-player-card';
            el.dataset.playerName = p.name;
            el.dataset.playerId = p.id;
            el.innerHTML = `
                <div class="tcc-player-photo-wrap">
                    <img class="tcc-player-photo" loading="lazy" src="${escapeHtml(p.img)}" alt="Spielerfoto von ${escapeHtml(p.name)}">
                </div>
                <div class="tcc-player-info">
                    <h3 class="tcc-player-name">${escapeHtml(p.name)}</h3>
                    ${p.badgeLogo ? `<div class="tcc-badge-wrap">
                        <img class="tcc-badge-img" loading="lazy" src="${escapeHtml(p.badgeLogo)}" alt="${escapeHtml(p.badgeLabel)}">
                    </div>` : ''}
                    <div class="tcc-badge-label">${escapeHtml(p.badgeLabel)}</div>
                </div>
                <div class="tcc-card-dim" aria-hidden="true"></div>
            `;
            el.style.transition = TRANSITION_CSS;
            return el;
        }

        // Signatur der aktuell gerenderten Karten (Spieler-IDs in Reihenfolge).
        // Dient dazu, ein unnoetiges Neu-Rendern beim Daten-Update zu vermeiden.
        let lastRenderedSignature = null;
        function itemsSignature(items) {
            return (items || []).map((it) => it && it.id).join('|');
        }

        // Zentrums-Karte beim (Neu-)Aufbau bestimmen. WM: unveraendert die
        // erste Karte (Index 0). CL: ein zufaelliger Spieler, damit bei jedem
        // Seiten-Neuladen ein ANDERER Spieler im Zentrum steht. Rein lokale
        // Berechnung (Math.random + ein localStorage-Zugriff) → kein Netzwerk,
        // keine Ladeverzoegerung. Die Ring-Reihenfolge bleibt unveraendert, das
        // „nie zwei gleiche Klubs nebeneinander" gilt also fuer jedes Zentrum.
        function pickInitialActive(n) {
            if (!IS_CL || n <= 1) return 0;
            let last = -1;
            try { last = parseInt(localStorage.getItem(CENTER_STORAGE_KEY), 10); } catch (_) {}
            let idx = Math.floor(Math.random() * n);
            // Direkte Wiederholung vermeiden (nur wenn ueberhaupt Auswahl bleibt).
            if (idx === last && n > 1) idx = (idx + 1) % n;
            try { localStorage.setItem(CENTER_STORAGE_KEY, String(idx)); } catch (_) {}
            return idx;
        }

        function renderCarouselItems(items) {
            track.innerHTML = '';
            players = items;
            cards = [];
            lastRenderedSignature = itemsSignature(items);
            if (!items.length) {
                // Sollte dank Fallback nie eintreten – wir rendern bewusst keine
                // sichtbare Fehlermeldung mehr, sondern lassen das Karussell leer
                // (statt "Noch keine Draft-Daten gefunden" anzuzeigen).
                return;
            }
            cards = items.map((it) => renderPlayerCard(it));
            cards.forEach((c) => track.appendChild(c));
            active = pickInitialActive(cards.length);
            fitPlayerNames();
            measure();
            render();
            startAutoplay();
        }

        let currentVariant = null;

        function initCarousel() {
            const { variant, items } = pickVariantAndItems(CARD_COUNT);
            currentVariant = variant;
            setCarouselTitle(variant);
            renderCarouselItems(items);
        }

        // Wird von außen (renderIndexHome → window.__tccCarouselRefresh)
        // aufgerufen, sobald frische Team-Daten in den Cache geschrieben
        // wurden. Hält die aktuell gezeigte Variante (kein Flip), damit
        // der Übergang nahtlos wirkt – nur die Spieler werden neu gewählt
        // und die Karten neu gerendert.
        function refreshCarousel() {
            const { variant, items } = pickVariantAndItems(CARD_COUNT, currentVariant || null);
            // Wenn sich weder die Variante noch die Karten-Reihenfolge geaendert
            // haben, NICHT neu aufbauen. Sonst wird das Karussell beim ersten
            // Daten-Update (Teams/Spieler zaehlen hoch) komplett neu gerendert
            // und springt sichtbar zurueck auf die erste Karte – es sah aus, als
            // wuerde die Animation ein zweites Mal „nachladen".
            if (variant === currentVariant && itemsSignature(items) === lastRenderedSignature) {
                return;
            }
            if (variant !== currentVariant) {
                currentVariant = variant;
                setCarouselTitle(variant);
            }
            renderCarouselItems(items);
        }

        window.__tccCarouselRefresh = refreshCarousel;

        function fitPlayerNames() {
            root.querySelectorAll('.tcc-player-name').forEach((nameEl) => {
                nameEl.style.fontSize = '';
                nameEl.style.transform = '';
                nameEl.style.transformOrigin = 'center center';
                nameEl.style.whiteSpace = 'nowrap';
                nameEl.style.display = 'block';

                const computed = window.getComputedStyle(nameEl);
                let size = parseFloat(computed.fontSize);
                const minSize = 8.5;

                while (nameEl.scrollWidth > nameEl.clientWidth && size > minSize) {
                    size -= 0.5;
                    nameEl.style.fontSize = `${size}px`;
                }

                if (nameEl.scrollWidth > nameEl.clientWidth && nameEl.scrollWidth > 0) {
                    const scale = nameEl.clientWidth / nameEl.scrollWidth;
                    nameEl.style.transform = `scaleX(${scale})`;
                    nameEl.style.transformOrigin = 'center center';
                }
            });
        }

        // ── Coverflow-Zustand ──
        let active = 0;      // Index der Karte in der Mitte
        let cardW = 200;     // aktuelle Kartenbreite (px), responsiv gemessen
        let locked = false;  // sperrt Eingaben, solange eine Bewegung läuft

        // Kartenbreite live aus dem Layout lesen, damit Abstand und Tiefe
        // responsiv mitskalieren.
        function measure() {
            const first = cards[0];
            if (first) {
                const w = first.getBoundingClientRect().width;
                if (w > 0) cardW = w;
            }
        }

        // Positioniert alle Karten relativ zur aktiven Karte: die Mitte steht
        // aufrecht und ganz vorne, die Nachbarn kippen (rotateY/rotateZ) nach
        // hinten weg und werden abgedunkelt. Über den halben Ring (loop) wird
        // die kürzeste Richtung gewählt, damit der Übergang nie „durchläuft".
        function render() {
            const n = cards.length;
            if (!n) return;
            for (let i = 0; i < n; i++) {
                let rel = i - active;
                if (rel > n / 2) rel -= n;
                if (rel < -n / 2) rel += n;

                const ax = Math.abs(rel);
                const visible = ax <= MAX_VISIBLE;
                const isActive = rel === 0;
                const sc = Math.max(0.4, 1 - ax * SCALE_STEP);
                const tx = rel * cardW * SPREAD_FACTOR;
                const tz = -ax * cardW * DEPTH_FACTOR;
                const ry = -rel * TILT;
                const rz = rel * SIDE_TILT;

                const card = cards[i];
                card.style.transform =
                    `translate(-50%, -50%) translateX(${tx}px) translateZ(${tz}px) rotateY(${ry}deg) rotateZ(${rz}deg) scale(${sc})`;
                card.style.opacity = visible ? '1' : '0';
                card.style.zIndex = String(100 - ax);
                card.style.pointerEvents = visible ? 'auto' : 'none';
                card.classList.toggle('is-active', isActive);

                const dim = card.querySelector('.tcc-card-dim');
                if (dim) dim.style.opacity = isActive ? '0' : String(INACTIVE_DIM);
            }
        }

        // Kurzzeitige Eingabesperre, damit schnelle Klicks/Tasten nicht
        // stapeln (Bewegung darf erst auslaufen).
        function lock() {
            locked = true;
            window.setTimeout(() => { locked = false; }, Math.max(50, MOVE_DUR * 1000));
        }

        function goTo(i) {
            const n = cards.length;
            if (!n) return;
            active = ((i % n) + n) % n;
            render();
        }

        function step(dir) {
            if (locked) return;
            lock();
            goTo(active + dir);
        }

        // ── Autoplay: lässt das Karussell ruhig weiterlaufen ──
        let autoplayId = null;
        function startAutoplay() {
            stopAutoplay();
            if (!AUTOPLAY || prefersReducedMotion || cards.length < 2) return;
            autoplayId = window.setInterval(() => {
                if (!locked) goTo(active + 1);
            }, AUTOPLAY_DELAY);
        }
        function stopAutoplay() {
            if (autoplayId !== null) { window.clearInterval(autoplayId); autoplayId = null; }
        }
        // Nach manueller Interaktion den Timer neu anstoßen, damit nicht
        // sofort weitergesprungen wird.
        function bumpAutoplay() {
            if (autoplayId !== null) startAutoplay();
        }

        // Klick/Tap auf eine Karte: Seitenkarte → in die Mitte holen,
        // aktive Karte → Spieleranalyse öffnen.
        function handleCardClick(i) {
            if (locked) return;
            if (i !== active) {
                lock();
                goTo(i);
                bumpAutoplay();
                return;
            }
            const card = cards[i];
            const playerId = card?.dataset.playerId || '';
            const playerName = card?.dataset.playerName || '';
            if (playerId && !playerId.startsWith('static:')) {
                window.location.href = `spieleranalyse.html?playerId=${encodeURIComponent(playerId)}`;
            } else if (playerName) {
                window.location.href = `spieleranalyse.html?player=${encodeURIComponent(playerName)}`;
            }
        }

        // Zeiger-Handling: unterscheidet Tap (Klick) von horizontaler
        // Wischgeste. Kein Drag-Impuls mehr – die Bewegung folgt der
        // Coverflow-Transition.
        let pDown = null;
        carousel.addEventListener('pointerdown', (e) => {
            pDown = {
                x: e.clientX,
                y: e.clientY,
                card: e.target?.closest?.('.tcc-player-card') || null
            };
        });
        carousel.addEventListener('pointerup', (e) => {
            if (!pDown) return;
            const dx = e.clientX - pDown.x;
            const dy = e.clientY - pDown.y;
            const card = pDown.card;
            pDown = null;

            if (Math.abs(dx) > SWIPE_THRESHOLD && Math.abs(dx) > Math.abs(dy)) {
                step(dx < 0 ? 1 : -1);
                bumpAutoplay();
                return;
            }
            // Nur als Tap werten, wenn sich der Zeiger kaum bewegt hat –
            // ein vertikales Scrollen über dem Karussell darf keine Karte
            // öffnen.
            if (card && Math.abs(dx) < 10 && Math.abs(dy) < 10) {
                const i = cards.indexOf(card);
                if (i >= 0) handleCardClick(i);
            }
        });
        carousel.addEventListener('pointercancel', () => { pDown = null; });

        // Mausrad / horizontales Scrollen → ein Schritt (leicht entprellt).
        let wheelCooldown = false;
        carousel.addEventListener('wheel', (e) => {
            e.preventDefault();
            const d = Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : e.deltaY;
            if (Math.abs(d) < 8 || wheelCooldown) return;
            wheelCooldown = true;
            window.setTimeout(() => { wheelCooldown = false; }, 220);
            step(d > 0 ? 1 : -1);
            bumpAutoplay();
        }, { passive: false });

        // Tastatur: Pfeil links/rechts.
        carousel.tabIndex = 0;
        carousel.setAttribute('role', 'group');
        carousel.setAttribute('aria-roledescription', 'carousel');
        carousel.addEventListener('keydown', (e) => {
            if (e.key === 'ArrowRight') { e.preventDefault(); step(1); bumpAutoplay(); }
            else if (e.key === 'ArrowLeft') { e.preventDefault(); step(-1); bumpAutoplay(); }
        });

        // Autoplay bei Maus-Hover/Fokus pausieren (nur feine Zeiger, damit ein
        // Tap auf Touch das Autoplay nicht dauerhaft stoppt).
        carousel.addEventListener('pointerenter', (e) => { if (e.pointerType === 'mouse') stopAutoplay(); });
        carousel.addEventListener('pointerleave', (e) => { if (e.pointerType === 'mouse') startAutoplay(); });
        carousel.addEventListener('focusin', stopAutoplay);
        carousel.addEventListener('focusout', startAutoplay);

        window.addEventListener('resize', () => {
            fitPlayerNames();
            measure();
            render();
        }, { passive: true });

        initCarousel();
    })();

    function renderIndexHome(data) {
        applyIndexViewMode();
        updateDevToggleLabel();

        const mode = getEffectiveIndexViewMode();
        if (mode === 'post') {
            renderPostStartHome(data);
        } else {
            renderPreStartHome(data);
        }
    }

    let _lastRenderedData = null;
    let _lastRenderSignature = null;

    function getRenderSignature(data) {
        const meta = data && data.meta ? data.meta : null;
        if (!meta) return null;

        const hasVersion =
            meta.teamsVersion !== undefined ||
            meta.pointsVersion !== undefined ||
            meta.fixturesVersion !== undefined;
        if (!hasVersion) return null;

        const teamsCount = Array.isArray(data.teams) ? data.teams.length : 0;
        const pointsCount = data.points ? Object.keys(data.points).length : 0;
        const fixturesCount = data.fixtures ? Object.keys(data.fixtures).length : 0;

        return [
            getEffectiveIndexViewMode(),
            meta.tournamentKey || "",
            meta.teamsVersion ?? "",
            meta.pointsVersion ?? "",
            meta.fixturesVersion ?? "",
            teamsCount,
            pointsCount,
            fixturesCount
        ].join("|");
    }

    function render(data, options = {}) {
        // CL hat kein Captain-Feature: gespeicherte Captain-Flags (z. B. aus
        // Alt-Teams) hier zentral entfernen, damit weder ×2 noch „C" greifen.
        if (window.APP_CONFIG && window.APP_CONFIG.captainEnabled === false && data && Array.isArray(data.teams)) {
            data.teams.forEach(t => { if (t && Array.isArray(t.players)) t.players.forEach(p => { if (p) p.isCaptain = false; }); });
        }
        _lastRenderedData = data;
        const signature = getRenderSignature(data);
        if (!options.force && signature && signature === _lastRenderSignature) {
            applyIndexViewMode();
            updateDevToggleLabel();
            return;
        }
        _lastRenderSignature = signature;

        renderIndexHome(data);
        // Frische Team-Daten landen über DreamTeamCache.bootstrap im
        // LocalStorage. Das Karussell der "Meistgewählten Spieler" liest
        // diese Daten beim Initialrender, kennt aber das nachträgliche
        // Update sonst nicht. Deshalb stoßen wir hier explizit einen
        // Refresh an, sobald neue Daten gerendert wurden.
        if (typeof window.__tccCarouselRefresh === 'function') {
            try { window.__tccCarouselRefresh(); } catch (_) {}
        }
    }

    function isServerVerifiedCacheInfo(info) {
        return !!(info && info.verifiedFromServer === true && info.stale !== true);
    }

    /* =========================================================
       CACHED-FIRST RENDERING
       Der letzte lokale Cache-Stand wird sofort angezeigt, die
       Server-Bestaetigung laeuft im Hintergrund (dezenter Pill
       unten). Zur sichtbaren Warnung eskalieren wir erst, wenn
       nach FRESHNESS_TIMEOUT_MS keine serververifizierten Daten
       angekommen sind – oder ein Refresh wirklich fehlschlaegt.
       ========================================================= */
    const FRESHNESS_TIMEOUT_MS = 5000;
    let freshnessTimerId = null;
    let hasVerifiedData = false;

    function showSyncIndicator(message) {
        let el = document.getElementById('dt-sync-indicator');
        if (!el) {
            el = document.createElement('div');
            el.id = 'dt-sync-indicator';
            el.setAttribute('role', 'status');
            document.body.appendChild(el);
        }
        el.style.cssText = 'position:fixed;left:50%;bottom:18px;transform:translateX(-50%);'
            + 'z-index:1200;padding:6px 14px;border-radius:999px;font-size:0.78rem;'
            + 'letter-spacing:0.02em;color:var(--text-muted,#cbd5e1);'
            + 'background:rgba(10,14,26,0.85);border:1px solid rgba(255,255,255,0.14);'
            + 'pointer-events:none;opacity:1;transition:opacity .25s ease;';
        el.textContent = message || 'Daten werden aktualisiert …';
        return el;
    }

    /* Nicht-destruktive Variante fuer "Offline/veraltet"-Hinweise, wenn
       bereits Inhalt sichtbar ist (die harten Fehlerpfade der Seite wuerden
       den gerenderten Stand ersetzen). */
    function showStaleNotice(message) {
        const el = showSyncIndicator(message);
        el.style.color = '#fca5a5';
        el.style.borderColor = 'rgba(248,113,113,0.45)';
    }

    function hideSyncIndicator() {
        const el = document.getElementById('dt-sync-indicator');
        if (el) el.style.opacity = '0';
    }

    function startFreshnessEscalation(onTimeout) {
        if (hasVerifiedData || freshnessTimerId) return;
        freshnessTimerId = setTimeout(() => {
            freshnessTimerId = null;
            if (!hasVerifiedData) onTimeout();
        }, FRESHNESS_TIMEOUT_MS);
    }

    function markServerVerified() {
        hasVerifiedData = true;
        if (freshnessTimerId) {
            clearTimeout(freshnessTimerId);
            freshnessTimerId = null;
        }
        hideSyncIndicator();
    }

    function cachedBundleHasContent(data) {
        if (!data) return false;
        if (Array.isArray(data.teams) && data.teams.length) return true;
        return !!(data.points && Object.keys(data.points).length);
    }

    function showFreshnessWarning(message, tone) {
        let el = document.getElementById('index-freshness-warning');
        if (!el) {
            el = document.createElement('div');
            el.id = 'index-freshness-warning';
            el.className = 'empty-state';
            el.style.maxWidth = '920px';
            el.style.margin = '24px auto';
            const root = document.getElementById('indexHomePostStart') || document.body;
            root.insertBefore(el, root.firstChild);
        }
        // 'info' = ruhiger, neutraler Hinweis (z. B. Admin-Vorschau ohne
        // Live-Daten); Default = roter Fehlerton (unveraendertes Verhalten).
        if (tone === 'info') {
            el.style.border = '1px solid rgba(255,255,255,0.18)';
            el.style.color = 'var(--text-muted)';
        } else {
            el.style.border = '1px solid rgba(248,113,113,0.35)';
            el.style.color = 'var(--red-soft)';
        }
        el.textContent = message;
        el.style.display = 'block';
    }

    /* Fehlermeldung fuer fehlgeschlagenen Datenload. In einer bewusst
       aktivierten Admin-Vorschau (z. B. CL-Test cl2526) liegen fuer ein noch
       nicht gestartetes Turnier oft schlicht noch keine Live-Daten vor – das
       ist KEIN Server-/App-Fehler. Dann einen ruhigen Hinweis zeigen statt
       der alarmierenden roten Meldung. Die Produktivseite (WM, keine
       Vorschau aktiv) bleibt beim bisherigen Fehlerton. */
    function reportDataLoadFailure() {
        const previewActive = !!(APP && typeof APP.isPreviewActive === 'function'
            && APP.isPreviewActive());
        if (previewActive) {
            showFreshnessWarning(
                'Vorschau: Fuer dieses Turnier liegen noch keine Live-Daten vor.',
                'info'
            );
        } else {
            showFreshnessWarning('Aktuelle Daten konnten nicht vom Server geladen werden.');
        }
    }

    function clearFreshnessWarning() {
        const el = document.getElementById('index-freshness-warning');
        if (el) el.style.display = 'none';
    }

    /* =========================================================
       INIT
       ========================================================= */
    async function init() {
        // Dev-Umschalter initialisieren und sofort korrekte Sektion einblenden
        initDevToggle();
        applyIndexViewMode();
        updateDevToggleLabel();
        scheduleAutoModeFlip();
        document.addEventListener("visibilitychange", handleAutoModeVisibilityChange);

        try {
            const CACHE_OPTS = {
                db: APP.getDb(),
                year: APP.year,
                // Vor Turnierstart liegen noch keine Spieler-Punkte vor
                // (z. B. WM 2026 vor dem Eröffnungsspiel). Die Kacheln
                // arbeiten in diesem Fall mit 0 Punkten und Default-States,
                // statt dass die ganze Seite mit einem Fehler abbricht.
                allowEmptyPoints: true,
                allowEmptyFixtures: true,
                log: false
            };

            // bootstrap() vereint sofortiges Cache-Rendern, optimistischen
            // Refresh aus dem Session-Meta und den Live-Listener auf das
            // Meta-Dokument in einem einzigen Aufruf. Damit fällt der
            // separate Meta-Read aus dem alten loadBundle-Aufruf weg
            // (1 Read pro Seitenaufruf gespart).
            await DreamTeamCache.bootstrap({
                ...CACHE_OPTS,
                // Cached-first: letzter lokaler Stand sofort rendern, waehrend
                // die Server-Bestaetigung im Hintergrund laeuft (siehe
                // Helper-Block oben). Punkte ticken ohnehin nur alle 30 s bis
                // 5 min – ein kurz sichtbarer letzter Stand ist besser als
                // sekundenlange Skeletons.
                renderCached: true,
                onCachedReady: (data, info) => {
                    if (isServerVerifiedCacheInfo(info)) {
                        markServerVerified();
                        clearFreshnessWarning();
                        render(data);
                        return;
                    }
                    if (cachedBundleHasContent(data)) {
                        try {
                            render(data);
                            showSyncIndicator();
                        } catch (err) {
                            console.warn('[index] Cached-Render fehlgeschlagen:', err);
                        }
                    }
                    startFreshnessEscalation(() => {
                        if (_lastRenderedData) {
                            showStaleNotice('Warte auf Serverbestaetigung …');
                        } else {
                            hideSyncIndicator();
                            showFreshnessWarning('Daten konnten noch nicht frisch vom Server bestaetigt werden.');
                        }
                    });
                },
                onUpdate: (data, info) => {
                    if (!isServerVerifiedCacheInfo(info)) {
                        // Refresh wirklich fehlgeschlagen (offline/Fallback):
                        // bereits gerenderten Stand stehen lassen, Hinweis
                        // nicht-destruktiv anzeigen.
                        if (_lastRenderedData) {
                            showStaleNotice('Offline – angezeigt wird der letzte lokale Stand.');
                        } else {
                            hideSyncIndicator();
                            showFreshnessWarning('Offline oder Server nicht erreichbar. Es liegen noch keine lokalen Daten vor.');
                        }
                        return;
                    }
                    markServerVerified();
                    clearFreshnessWarning();
                    render(data);
                },
                onError: (err) => {
                    console.error('[index] Cache-Fehler:', err);
                    // Selbstheilung: Steckt der Browser in einer aus einer
                    // früheren Session hängenden, nicht mehr ladbaren Admin-
                    // Vorschau, NICHT als "Seite kaputt" anzeigen, sondern
                    // automatisch auf das Standard-Turnier (WM) zurückfallen.
                    // Für die WM ist keine Vorschau aktiv → No-op.
                    if (APP && typeof APP.recoverFromBrokenPreview === 'function'
                        && APP.recoverFromBrokenPreview()) {
                        return; // Reload läuft bereits – keine Fehlermeldung.
                    }
                    if (_lastRenderedData && !hasVerifiedData) {
                        // Cache-Stand ist sichtbar → nicht-destruktiver Hinweis
                        // statt grossem Fehlerblock ueber dem Inhalt.
                        showStaleNotice('Aktualisierung fehlgeschlagen – letzter lokaler Stand.');
                        return;
                    }
                    hideSyncIndicator();
                    reportDataLoadFailure();
                }
            });

        } catch (err) {
            console.error('[index] Daten konnten nicht geladen werden:', err);
            if (APP && typeof APP.recoverFromBrokenPreview === 'function'
                && APP.recoverFromBrokenPreview()) {
                return; // Hängende Vorschau → Rückfall auf WM läuft.
            }
            reportDataLoadFailure();
            // Show graceful empty states – already baked in per-tile
        }
    }

    document.addEventListener('DOMContentLoaded', init);

    // Re-init tilt on page show (back/forward cache)
})();
