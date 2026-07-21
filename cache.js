/* =============================================================================
 *  cache.js – DreamTeamCache
 *
 *  Zentrale Cache-Schicht für Teams, Punkte und Spiele (Fixtures).
 *
 *  Designziele
 *  -----------
 *  Die App liest pro Turnier drei Datasets aus Firestore:
 *    1. Teams           (eine pro Manager, mit gewähltem Kader)
 *    2. Punkte Spieler  (Punkte je Spieler, pro Spielrunde)
 *    3. Spiele          (Fixtures, optional)
 *
 *  Reads sind in Firestore kostenpflichtig und limitiert. Die Lese-
 *  Strategie ist deshalb auf das Minimum optimiert, ohne die
 *  Live-Aktualität zu verlieren:
 *
 *    • Teams werden vor dem Turnier eingereicht und ändern sich danach
 *      nicht mehr. Sobald sie einmal im LocalStorage liegen, werden sie
 *      NUR dann erneut gelesen, wenn die `teamsVersion` im Meta-Dokument
 *      ansteigt (passiert beim Submit eines neuen Teams in
 *      team-builder.html via {@link bumpMetaVersion}).
 *
 *    • Punkte werden nach jedem Spiel aktualisiert. Sie werden geladen,
 *      wenn die `pointsVersion` im Meta-Dokument ansteigt. Der Live-
 *      Listener ({@link subscribeToMeta} / {@link bootstrap}) erkennt
 *      neue Punkteversionen sofort.
 *
 *    • Fixtures werden nur dann nachgeladen, wenn `fixturesVersion`
 *      hochzählt oder kein gültiger Cache vorliegt. Beim Nachladen
 *      wird zuerst ein öffentliches Bundle-Dokument gelesen; nur wenn
 *      es fehlt, ungültig oder veraltet ist, wird die ganze Fixture-
 *      Collection gelesen.
 *
 *  Das Meta-Dokument (`app_meta/turnier_<key>`) ist die einzige Quelle
 *  der Wahrheit für "müssen wir neu lesen?". Pro Seitenaufruf wird es
 *  in der Idealwelt nur EINMAL gelesen:
 *
 *    1. {@link getCachedBundle}  – synchron, 0 Reads.
 *    2. {@link bootstrap}        – hängt Meta-Listener an. Initial-
 *       Snapshot zählt als 1 Read und triggert den Datasets-Refresh.
 *
 *  Für schnelle Navigation zwischen mehreren Seiten innerhalb derselben
 *  Browser-Session nutzen wir zusätzlich einen kurzlebigen Session-
 *  Cache des Meta-Dokuments (sessionStorage, Standard 30 s). Dadurch
 *  fällt die Meta-Abfrage in {@link loadBundle} weg, wenn eine
 *  benachbarte Seite das Meta gerade gelesen hat – der Listener bringt
 *  dann ohnehin frische Daten nach.
 *
 *  Public API
 *  ----------
 *    • DreamTeamCache.getCachedBundle(opts)
 *    • DreamTeamCache.loadBundle(opts)
 *    • DreamTeamCache.bootstrap(opts)
 *    • DreamTeamCache.subscribeToMeta(opts)
 *    • DreamTeamCache.bumpMetaVersion(opts)
 *    • DreamTeamCache.clearCache(opts)
 *    • DreamTeamCache.isValidTeamsData / isValidPointsData / isValidFixturesData
 * ============================================================================= */
(function (window) {
    'use strict';

    const DEFAULTS = {
        prefix: 'dreamteam',
        metaCollection: 'app_meta',
        metaDocId: null,
        tournamentKey: null,
        teamsCollection: null,
        pointsCollection: null,
        fixturesCollection: null,
        includeFixtures: true,
        fixturesBundleCollection: 'public_cache',
        fixturesBundleDocId: 'wm2026_fixtures',
        pointsCacheCollection: 'public_cache',
        pointsShardDocPrefix: 'wm2026_points_shard_',
        freshnessFirst: true,
        renderCached: null,
        fallbackMaxAgeMs: 10 * 60 * 1000,
        // Wie lange das zuletzt gelesene Meta-Dokument für andere Seiten
        // derselben Browser-Session als "frisch genug" gilt. In dieser
        // Zeit wird der Meta-Read in loadBundle übersprungen – der
        // Live-Listener liefert ohnehin Updates, sobald sich die
        // pointsVersion oder teamsVersion erhöht.
        sessionMetaTtlMs: 30 * 1000,
        resumeRefreshMinIntervalMs: 30 * 1000,
        postStartEmptyGraceMs: 4 * 60 * 60 * 1000,
        minFixtureCount: null,
        allowEmptyTeams: true,
        allowEmptyPoints: false,
        allowEmptyFixtures: true,
        log: false
    };

    const CACHE_SCHEMA_VERSION = 2;
    const CACHE_SCHEMA_MARKER_KEY = 'dreamteam_cache_schema_v2_applied';
    const REFRESH_STATE_BY_BASE = new Map();

    function log(cfg, ...args) {
        if (cfg.log) {
            console.log('[DreamTeamCache]', ...args);
        }
    }

    function warn(...args) {
        console.warn('[DreamTeamCache]', ...args);
    }

    function now() {
        return Date.now();
    }

    function isSnapshotFromCache(snap) {
        return !!(snap && snap.metadata && snap.metadata.fromCache);
    }

    function getDocFromServer(ref) {
        return ref.get({ source: 'server' });
    }

    function getCollectionFromServer(ref) {
        return ref.get({ source: 'server' });
    }

    function toNumberOrNull(value) {
        return typeof value === 'number' && Number.isFinite(value) ? value : null;
    }

    const ACTIVE_FIXTURE_STATUSES = new Set(['1H', '2H', 'HT', 'ET', 'BT', 'P', 'SUSP', 'INT', 'LIVE']);

    function getFixtureStatusShort(fixture) {
        return String(
            fixture?.status?.short
            || fixture?.statusShort
            || fixture?.fixture?.status?.short
            || ''
        ).trim().toUpperCase();
    }

    function fixturesContainActiveStatus(fixtures) {
        if (!fixtures || typeof fixtures !== 'object' || Array.isArray(fixtures)) return false;
        return Object.values(fixtures).some((fixture) => ACTIVE_FIXTURE_STATUSES.has(getFixtureStatusShort(fixture)));
    }

    function getAppConfig() {
        return window.APP_CONFIG || null;
    }

    function objectKeyCount(value) {
        return value && typeof value === 'object' && !Array.isArray(value)
            ? Object.keys(value).length
            : 0;
    }

    function toPositiveInteger(value) {
        const n = Number(value);
        return Number.isFinite(n) && n > 0 ? Math.floor(n) : 0;
    }

    function isPlainObject(value) {
        return !!value && typeof value === 'object' && !Array.isArray(value);
    }

    function getPublicPointsShardDocId(index, cfg) {
        const prefix = (cfg && cfg.pointsShardDocPrefix) || DEFAULTS.pointsShardDocPrefix;
        return `${prefix}${String(index).padStart(2, '0')}`;
    }

    function resolveFixtureCountConfig(cfg) {
        const app = getAppConfig();
        const raw = (cfg && cfg.fixtureCount) || (app && app.fixtureCount) || null;
        const source = raw && typeof raw === 'object' ? raw : {};
        return {
            minPublished: toPositiveInteger(source.minPublished || source.min || (cfg && cfg.minFixtureCount)),
            expectedFinal: toPositiveInteger(source.expectedFinal || source.final || (cfg && cfg.expectedFixtureCount))
        };
    }

    function resolveMinFixtureCount(cfg) {
        const explicit = toPositiveInteger(cfg && cfg.minFixtureCount);
        if (explicit > 0) return explicit;
        return resolveFixtureCountConfig(cfg).minPublished;
    }

    function getDreamteamStartMs(cfg) {
        const app = getAppConfig();
        const raw = (cfg && cfg.dreamteamStart) || (app && app.DREAMTEAM_START) || null;
        if (!raw) return null;
        const date = raw instanceof Date ? raw : new Date(raw);
        const ms = date instanceof Date ? date.getTime() : NaN;
        return Number.isFinite(ms) ? ms : null;
    }

    function isPostStartDataRequired(cfg) {
        // Test-/Staging-Turniere ohne scharfe Datenpipeline (dataReady:false,
        // z. B. die CL-Vorschau cl2526) dürfen nach Turnierstart legitim leere
        // Datensätze haben (nie Punkte hochgeladen). Für sie wird die
        // "nach Start nicht leer"-Regel deaktiviert (siehe resolveConfig).
        if (cfg && cfg.requirePostStartData === false) return false;
        const startMs = getDreamteamStartMs(cfg);
        if (startMs === null) return false;
        const graceMs = Number.isFinite(Number(cfg && cfg.postStartEmptyGraceMs))
            ? Math.max(0, Number(cfg.postStartEmptyGraceMs))
            : DEFAULTS.postStartEmptyGraceMs;
        return now() >= startMs + graceMs;
    }

    function hasDatasetMetaSignal(meta, kind) {
        if (!meta || typeof meta !== 'object') return false;
        const versionKey = kind === 'fixtures' ? 'fixturesVersion' : kind === 'teams' ? 'teamsVersion' : 'pointsVersion';
        const updatedAtKey = kind === 'fixtures' ? 'fixturesUpdatedAt' : kind === 'teams' ? 'teamsUpdatedAt' : 'pointsUpdatedAt';
        return toPositiveInteger(meta[versionKey]) > 0 || toPositiveInteger(meta[updatedAtKey]) > 0;
    }

    function shouldRequireNonEmptyDataset(cfg, meta, kind) {
        return isPostStartDataRequired(cfg) || hasDatasetMetaSignal(meta, kind);
    }

    function textValue(...values) {
        for (const value of values) {
            if (value === undefined || value === null) continue;
            const text = String(value).trim();
            if (text) return text;
        }
        return '';
    }

    function isKnownTeamName(value) {
        const text = textValue(value).toUpperCase();
        return !!text && text !== 'TBD' && text !== 'TBA' && text !== '-' && text !== '?';
    }

    function countKnownFixtureTeamSlots(fixtures) {
        const result = { names: 0, logos: 0 };
        if (!fixtures || typeof fixtures !== 'object' || Array.isArray(fixtures)) return result;

        Object.values(fixtures).forEach((fixture) => {
            if (!fixture || typeof fixture !== 'object') return;
            const home = fixture.homeTeam || fixture.home || (fixture.teams && fixture.teams.home) || {};
            const away = fixture.awayTeam || fixture.away || (fixture.teams && fixture.teams.away) || {};

            const homeName = textValue(home.name, fixture.teamA, fixture.homeTeamName, fixture.homeName);
            const awayName = textValue(away.name, fixture.teamB, fixture.awayTeamName, fixture.awayName);
            const homeLogo = textValue(home.logo, fixture.homeLogo, fixture.teamAFlag, fixture.homeFlag);
            const awayLogo = textValue(away.logo, fixture.awayLogo, fixture.teamBFlag, fixture.awayFlag);

            if (isKnownTeamName(homeName)) result.names++;
            if (isKnownTeamName(awayName)) result.names++;
            if (homeLogo) result.logos++;
            if (awayLogo) result.logos++;
        });

        return result;
    }

    function safeParse(json) {
        try {
            return JSON.parse(json);
        } catch (err) {
            return null;
        }
    }

    function readStorage(key) {
        try {
            return window.localStorage.getItem(key);
        } catch (err) {
            warn('LocalStorage read failed for key:', key, err);
            return null;
        }
    }

    function writeStorage(key, value) {
        try {
            window.localStorage.setItem(key, JSON.stringify(value));
            return true;
        } catch (err) {
            warn('LocalStorage write failed for key:', key, err);
            return false;
        }
    }

    function removeStorage(key) {
        try {
            window.localStorage.removeItem(key);
            return true;
        } catch (err) {
            warn('LocalStorage remove failed for key:', key, err);
            return false;
        }
    }

    function readSession(key) {
        try {
            return window.sessionStorage.getItem(key);
        } catch (err) {
            warn('SessionStorage read failed for key:', key, err);
            return null;
        }
    }

    function writeSession(key, value) {
        try {
            window.sessionStorage.setItem(key, JSON.stringify(value));
            return true;
        } catch (err) {
            warn('SessionStorage write failed for key:', key, err);
            return false;
        }
    }

    function removeSession(key) {
        try {
            window.sessionStorage.removeItem(key);
            return true;
        } catch (err) {
            warn('SessionStorage remove failed for key:', key, err);
            return false;
        }
    }

    /**
     * Liefert den gemeinsamen Storage-Basis-Prefix.
     *
     * Wenn `APP_CONFIG.storage.appPrefix()` verfügbar ist, wird er
     * benutzt – damit ist sichergestellt, dass alle Cache-Keys
     * exakt unter demselben Prefix laufen wie die normalen
     * `APP.storage.key(...)`-Keys. Sonst fällt der Cache auf seinen
     * eigenen `prefix`+`tournamentKey`-Aufbau zurück, was die
     * Stand-alone-Tests / Konsolen-Aufrufe weiterhin lauffähig hält.
     */
    function resolveStorageBase(cfg) {
        const app = window.APP_CONFIG;
        if (app && app.storage && typeof app.storage.appPrefix === 'function') {
            try {
                const appPrefix = app.storage.appPrefix();
                if (appPrefix) return appPrefix;
            } catch (err) { /* fall through */ }
        }
        return `${cfg.prefix}_${cfg.tournamentKey}`;
    }

    function buildKeys(cfg) {
        const base = resolveStorageBase(cfg);
        return {
            base,
            teams: `${base}_teams`,
            points: `${base}_points`,
            fixtures: `${base}_fixtures`,
            meta: `${base}_meta`,
            lastGoodTeams: `${base}_last_good_teams`,
            lastGoodPoints: `${base}_last_good_points`,
            lastGoodFixtures: `${base}_last_good_fixtures`,
            sessionMeta: `${base}_session_meta`
        };
    }

    function purgeDatasetStorage(cfg, reason) {
        if (reason) warn(reason);
        [
            cfg.keys.teams,
            cfg.keys.points,
            cfg.keys.fixtures,
            cfg.keys.meta,
            cfg.keys.lastGoodTeams,
            cfg.keys.lastGoodPoints,
            cfg.keys.lastGoodFixtures
        ].forEach((key) => removeStorage(key));
        removeSession(cfg.keys.sessionMeta);
    }

    function applySchemaMigration(cfg) {
        if (cfg.freshnessFirst === false) return;
        if (readStorage(CACHE_SCHEMA_MARKER_KEY)) return;
        purgeDatasetStorage(cfg, 'Applying cache schema v2 migration; clearing old dataset caches.');
        writeStorage(CACHE_SCHEMA_MARKER_KEY, {
            schemaVersion: CACHE_SCHEMA_VERSION,
            appliedAt: now()
        });
    }

    function createEnvelopeMeta(meta) {
        const source = meta && typeof meta === 'object' ? meta : {};
        return {
            teamsVersion: toNumberOrNull(source.teamsVersion),
            pointsVersion: toNumberOrNull(source.pointsVersion),
            fixturesVersion: toNumberOrNull(source.fixturesVersion),
            teamsUpdatedAt: toNumberOrNull(source.teamsUpdatedAt),
            pointsUpdatedAt: toNumberOrNull(source.pointsUpdatedAt),
            fixturesUpdatedAt: toNumberOrNull(source.fixturesUpdatedAt),
            fixturesCacheGeneratedAt: toNumberOrNull(source.fixturesCacheGeneratedAt),
            pointsCacheGeneratedAt: toNumberOrNull(source.pointsCacheGeneratedAt),
            pointsShardCount: toNumberOrNull(source.pointsShardCount)
        };
    }

    function createEnvelope(data, meta) {
        return {
            schemaVersion: CACHE_SCHEMA_VERSION,
            savedAt: now(),
            data,
            meta: createEnvelopeMeta(meta || {})
        };
    }

    function readEnvelope(key) {
        const raw = readStorage(key);
        if (!raw) return null;

        const parsed = safeParse(raw);
        if (!parsed || typeof parsed !== 'object') return null;

        return {
            schemaVersion: parsed.schemaVersion === CACHE_SCHEMA_VERSION ? CACHE_SCHEMA_VERSION : 1,
            savedAt: typeof parsed.savedAt === 'number' ? parsed.savedAt : 0,
            data: parsed.data,
            meta: isPlainObject(parsed.meta) ? parsed.meta : null
        };
    }

    function readSessionEnvelope(key) {
        const raw = readSession(key);
        if (!raw) return null;

        const parsed = safeParse(raw);
        if (!parsed || typeof parsed !== 'object') return null;

        return {
            schemaVersion: parsed.schemaVersion === CACHE_SCHEMA_VERSION ? CACHE_SCHEMA_VERSION : 1,
            savedAt: typeof parsed.savedAt === 'number' ? parsed.savedAt : 0,
            data: parsed.data,
            meta: isPlainObject(parsed.meta) ? parsed.meta : null
        };
    }

    function numberOrNull(value) {
        return typeof value === 'number' && Number.isFinite(value) ? value : null;
    }

    function metaValueMatches(envelopeMeta, currentMeta, versionKey, updatedAtKey) {
        const currentVersion = numberOrNull(currentMeta && currentMeta[versionKey]);
        const envelopeVersion = numberOrNull(envelopeMeta && envelopeMeta[versionKey]);
        if (currentVersion !== null) {
            return envelopeVersion === currentVersion;
        }

        const currentUpdatedAt = numberOrNull(currentMeta && currentMeta[updatedAtKey]);
        const envelopeUpdatedAt = numberOrNull(envelopeMeta && envelopeMeta[updatedAtKey]);
        if (currentUpdatedAt !== null) {
            return envelopeUpdatedAt === currentUpdatedAt;
        }

        return envelopeVersion === null && envelopeUpdatedAt === null;
    }

    function datasetEnvelopeMatchesMeta(kind, envelope, currentMeta) {
        if (!envelope || envelope.schemaVersion !== CACHE_SCHEMA_VERSION || !isPlainObject(envelope.meta) || !currentMeta) {
            return false;
        }

        const meta = envelope.meta;
        if (kind === 'teams') {
            return metaValueMatches(meta, currentMeta, 'teamsVersion', 'teamsUpdatedAt');
        }

        if (kind === 'points') {
            if (!metaValueMatches(meta, currentMeta, 'pointsVersion', 'pointsUpdatedAt')) return false;

            const currentGeneration = numberOrNull(currentMeta.pointsCacheGeneratedAt);
            if (currentGeneration !== null && numberOrNull(meta.pointsCacheGeneratedAt) !== currentGeneration) {
                return false;
            }

            const currentShardCount = numberOrNull(currentMeta.pointsShardCount);
            if (currentShardCount !== null && numberOrNull(meta.pointsShardCount) !== currentShardCount) {
                return false;
            }

            return true;
        }

        if (!metaValueMatches(meta, currentMeta, 'fixturesVersion', 'fixturesUpdatedAt')) return false;

        const currentGeneration = numberOrNull(currentMeta.fixturesCacheGeneratedAt);
        if (currentGeneration !== null && numberOrNull(meta.fixturesCacheGeneratedAt) !== currentGeneration) {
            return false;
        }

        return true;
    }

    function normalizeMeta(meta, year, tournamentKey) {
        const source = meta && typeof meta === 'object' ? meta : {};
        return {
            year: String(year),
            tournamentKey: source.tournamentKey || tournamentKey || null,
            tournamentType: source.tournamentType || null,
            tournamentYear: source.tournamentYear || String(year),
            tournamentLabel: source.tournamentLabel || null,
            teamsVersion: toNumberOrNull(source.teamsVersion),
            pointsVersion: toNumberOrNull(source.pointsVersion),
            fixturesVersion: toNumberOrNull(source.fixturesVersion),
            teamsUpdatedAt: toNumberOrNull(source.teamsUpdatedAt),
            pointsUpdatedAt: toNumberOrNull(source.pointsUpdatedAt),
            fixturesUpdatedAt: toNumberOrNull(source.fixturesUpdatedAt),
            fixturesCacheGeneratedAt: toNumberOrNull(source.fixturesCacheGeneratedAt),
            pointsCacheGeneratedAt: toNumberOrNull(source.pointsCacheGeneratedAt),
            pointsShardCount: toNumberOrNull(source.pointsShardCount),
            pointsDeltaDocId: typeof source.pointsDeltaDocId === 'string' && source.pointsDeltaDocId
                ? source.pointsDeltaDocId
                : null,
            pointsDeltaBaseVersion: toNumberOrNull(source.pointsDeltaBaseVersion),
            pointsDeltaNextVersion: toNumberOrNull(source.pointsDeltaNextVersion),
            fetchedAt: now()
        };
    }

    function isValidTeamEntry(team) {
        return !!(
            team &&
            typeof team === 'object' &&
            typeof team.manager === 'string' &&
            team.manager.trim() !== '' &&
            Array.isArray(team.players)
        );
    }

    function isValidTeamsData(teams, allowEmptyTeams) {
        if (!Array.isArray(teams)) return false;
        if (teams.length === 0) return !!allowEmptyTeams;
        return teams.every(isValidTeamEntry);
    }

    function isValidPointsData(points, allowEmptyPoints, cfg, meta) {
        if (!points || typeof points !== 'object' || Array.isArray(points)) return false;
        const count = objectKeyCount(points);
        if (count === 0) {
            return !!allowEmptyPoints && !shouldRequireNonEmptyDataset(cfg, meta, 'points');
        }
        return Object.values(points).every((doc) => doc && typeof doc === 'object' && !Array.isArray(doc));
    }

    function normalizePointsData(points) {
        const helper = window.DreamTeamPoints;
        if (helper && typeof helper.normalizePointsMap === 'function') {
            // Punktedokumente enthalten ein gespeichertes totalPoints-Aggregat
            // und die pro Spiel abgeleiteten Details. Der Cache darf bei
            // Konflikten nie das Aggregat gewinnen lassen, weil gerade PWA-
            // Container alte localStorage/Firestore-Staende laenger behalten.
            return helper.normalizePointsMap(points);
        }
        return points;
    }

    function isValidFixturesData(fixtures, allowEmptyFixtures, cfg, meta) {
        if (!fixtures || typeof fixtures !== 'object' || Array.isArray(fixtures)) return false;
        const count = objectKeyCount(fixtures);
        const enforcePublishedPlan = shouldRequireNonEmptyDataset(cfg, meta, 'fixtures');
        if (count === 0) {
            return !!allowEmptyFixtures && !enforcePublishedPlan;
        }

        const minFixtureCount = resolveMinFixtureCount(cfg);
        if (enforcePublishedPlan && minFixtureCount > 0) {
            if (count < minFixtureCount) return false;

            const requiredKnownSlots = minFixtureCount * 2;
            const knownSlots = countKnownFixtureTeamSlots(fixtures);
            if (knownSlots.names < requiredKnownSlots || knownSlots.logos < requiredKnownSlots) {
                return false;
            }
        }

        return true;
    }

    function resolveConfig(options) {
        const cfg = { ...DEFAULTS, ...(options || {}) };
        const app = window.APP_CONFIG || null;

        if (!cfg.db) {
            throw new Error('DreamTeamCache: db ist erforderlich.');
        }

        const resolvedYear = cfg.year || (app && app.year);
        if (!resolvedYear) {
            throw new Error('DreamTeamCache: year ist erforderlich.');
        }

        cfg.year = String(resolvedYear);
        cfg.tournamentKey = cfg.tournamentKey || (app && app.key) || cfg.year;

        // Post-Start-Enforcement (leere Datensätze nach Turnierstart als
        // Fehler werten, siehe isPostStartDataRequired/isValidPointsData) gilt
        // nur für Turniere mit scharfer Datenpipeline. Ein als dataReady:false
        // markiertes aktives Turnier (Test/Staging wie cl2526) hat legitim
        // (noch) keine Punkte – dort würde die Regel den Load mit
        // "Punkte-Fetch war ungültig" hart abbrechen. Default bleibt true
        // (WM-Verhalten unverändert); nur ein explizit nicht-dataReady
        // aktives Turnier lockert die Regel. Aufrufer können via Option
        // requirePostStartData den Wert weiterhin explizit erzwingen.
        if (typeof cfg.requirePostStartData !== 'boolean') {
            const activeT = app && app.activeTournament;
            const matchesActive = activeT && String(activeT.key) === String(cfg.tournamentKey);
            cfg.requirePostStartData = !(matchesActive && activeT.dataReady === false);
        }
        cfg.metaCollection = cfg.metaCollection || (app && app.firestore && app.firestore.metaCollection) || DEFAULTS.metaCollection;
        cfg.metaDocId = cfg.metaDocId
            || (app && app.firestore && typeof app.firestore.metaDocId === 'function' ? app.firestore.metaDocId() : null)
            || `turnier_${cfg.tournamentKey}`;

        cfg.teamsCollection = cfg.teamsCollection
            || (app && app.firestore && typeof app.firestore.teamsCollection === 'function' ? app.firestore.teamsCollection() : null)
            || `Teams WM ${cfg.year}`;

        cfg.pointsCollection = cfg.pointsCollection
            || (app && app.firestore && typeof app.firestore.pointsCollection === 'function' ? app.firestore.pointsCollection() : null)
            || `Punkte Spieler WM ${cfg.year}`;

        if (cfg.includeFixtures === false) {
            cfg.fixturesCollection = null;
        } else {
            cfg.fixturesCollection = cfg.fixturesCollection
                || (app && app.firestore && typeof app.firestore.fixturesCollection === 'function' ? app.firestore.fixturesCollection() : null)
                || null;
        }

        cfg.fixturesBundleCollection = cfg.fixturesBundleCollection || DEFAULTS.fixturesBundleCollection;
        // Turnier-spezifische Cache-Doc-IDs, damit z. B. die CL nicht das
        // WM-Public-Cache-Dokument liest (oder umgekehrt). Für die WM
        // (tournamentKey "wm2026") ergeben sich exakt die bisherigen Namen
        // (`wm2026_fixtures` / `wm2026_points_shard_`) – also unverändert.
        cfg.fixturesBundleDocId = cfg.fixturesBundleDocId || `${cfg.tournamentKey}_fixtures`;
        cfg.pointsCacheCollection = cfg.pointsCacheCollection || DEFAULTS.pointsCacheCollection;
        cfg.pointsShardDocPrefix = cfg.pointsShardDocPrefix || `${cfg.tournamentKey}_points_shard_`;
        cfg.fixtureCount = cfg.fixtureCount || (app && app.fixtureCount) || null;

        cfg.keys = buildKeys(cfg);
        applySchemaMigration(cfg);

        return cfg;
    }

    function readDatasetState(kind, cfg, meta, options) {
        const opts = options || {};
        const requireMetaMatch = Object.prototype.hasOwnProperty.call(opts, 'requireMetaMatch')
            ? !!opts.requireMetaMatch
            : cfg.freshnessFirst !== false;
        const allowBackupAsCurrent = Object.prototype.hasOwnProperty.call(opts, 'allowBackupAsCurrent')
            ? !!opts.allowBackupAsCurrent
            : !(cfg.freshnessFirst !== false && (kind === 'points' || kind === 'fixtures'));
        let currentKey, backupKey;
        if (kind === 'teams') {
            currentKey = cfg.keys.teams;
            backupKey = cfg.keys.lastGoodTeams;
        } else if (kind === 'fixtures') {
            currentKey = cfg.keys.fixtures;
            backupKey = cfg.keys.lastGoodFixtures;
        } else {
            currentKey = cfg.keys.points;
            backupKey = cfg.keys.lastGoodPoints;
        }

        const current = readEnvelope(currentKey);
        const backup = readEnvelope(backupKey);

        let validator;
        if (kind === 'teams') {
            validator = (data) => isValidTeamsData(data, cfg.allowEmptyTeams);
        } else if (kind === 'fixtures') {
            validator = (data) => isValidFixturesData(data, cfg.allowEmptyFixtures, cfg, meta);
        } else {
            validator = (data) => isValidPointsData(data, cfg.allowEmptyPoints, cfg, meta);
        }

        const currentMetaOk = !requireMetaMatch || datasetEnvelopeMatchesMeta(kind, current, meta);
        const backupMetaOk = !requireMetaMatch || datasetEnvelopeMatchesMeta(kind, backup, meta);
        const currentValid = current ? currentMetaOk && validator(current.data) : false;
        const backupValid = allowBackupAsCurrent && backup ? backupMetaOk && validator(backup.data) : false;

        let data = currentValid ? current.data : backupValid ? backup.data : null;
        if (kind === 'points' && data) {
            data = normalizePointsData(data);
        }

        return {
            current,
            backup,
            valid: currentValid || backupValid,
            usedBackup: !currentValid && backupValid,
            currentMetaOk,
            backupMetaOk,
            data,
            savedAt: currentValid
                ? current.savedAt
                : backupValid
                    ? backup.savedAt
                    : 0
        };
    }

    function skippedDatasetState(data) {
        return {
            current: null,
            backup: null,
            valid: true,
            usedBackup: false,
            data,
            savedAt: 0
        };
    }

    function readMetaState(cfg) {
        const envelope = readEnvelope(cfg.keys.meta);

        if (!envelope || !envelope.data) {
            return {
                valid: false,
                data: normalizeMeta({}, cfg.year, cfg.tournamentKey),
                savedAt: 0
            };
        }

        return {
            valid: true,
            data: normalizeMeta(envelope.data, cfg.year, cfg.tournamentKey),
            savedAt: envelope.savedAt
        };
    }

    function readSessionMeta(cfg) {
        const envelope = readSessionEnvelope(cfg.keys.sessionMeta);
        if (!envelope || !envelope.data) return null;
        return envelope;
    }

    function writeSessionMeta(cfg, meta) {
        if (!meta) return false;
        return writeSession(cfg.keys.sessionMeta, createEnvelope(meta, meta));
    }

    function saveTeams(teams, cfg, meta) {
        if (!isValidTeamsData(teams, cfg.allowEmptyTeams)) return false;
        const payload = createEnvelope(teams, meta);
        const currentOk = writeStorage(cfg.keys.teams, payload);
        const backupOk = writeStorage(cfg.keys.lastGoodTeams, payload);
        return currentOk && backupOk;
    }

    function savePoints(points, cfg, meta) {
        const normalizedPoints = normalizePointsData(points);
        if (!isValidPointsData(normalizedPoints, cfg.allowEmptyPoints, cfg, meta)) return false;
        const payload = createEnvelope(normalizedPoints, meta);
        const currentOk = writeStorage(cfg.keys.points, payload);
        const backupOk = writeStorage(cfg.keys.lastGoodPoints, payload);
        return currentOk && backupOk;
    }

    function saveFixtures(fixtures, cfg, meta) {
        if (!isValidFixturesData(fixtures, cfg.allowEmptyFixtures, cfg, meta)) return false;
        const payload = createEnvelope(fixtures, meta);
        const currentOk = writeStorage(cfg.keys.fixtures, payload);
        const backupOk = writeStorage(cfg.keys.lastGoodFixtures, payload);
        return currentOk && backupOk;
    }

    function metaVersionNumber(meta, key) {
        const value = meta && meta[key];
        return typeof value === 'number' && Number.isFinite(value) ? value : null;
    }

    function isMetaBehind(candidate, current) {
        if (!candidate || !current) return false;
        return [
            'teamsVersion',
            'pointsVersion',
            'fixturesVersion',
            'pointsCacheGeneratedAt',
            'fixturesCacheGeneratedAt'
        ].some((key) => {
            const nextValue = metaVersionNumber(candidate, key);
            const currentValue = metaVersionNumber(current, key);
            return nextValue !== null && currentValue !== null && nextValue < currentValue;
        });
    }

    function sameMetaGeneration(a, b) {
        if (!a || !b) return false;
        return [
            'teamsVersion',
            'pointsVersion',
            'fixturesVersion',
            'teamsUpdatedAt',
            'pointsUpdatedAt',
            'fixturesUpdatedAt',
            'pointsCacheGeneratedAt',
            'fixturesCacheGeneratedAt',
            'pointsShardCount'
        ].every((key) => numberOrNull(a[key]) === numberOrNull(b[key]));
    }

    function rememberFreshestMeta(cfg, meta) {
        if (!meta) return false;
        const current = REFRESH_STATE_BY_BASE.get(cfg.keys.base);
        if (current && isMetaBehind(meta, current)) {
            return false;
        }
        if (!current || isMetaBehind(current, meta) || !sameMetaGeneration(current, meta)) {
            REFRESH_STATE_BY_BASE.set(cfg.keys.base, meta);
        }
        return true;
    }

    function isBehindFreshestMeta(cfg, meta) {
        const current = REFRESH_STATE_BY_BASE.get(cfg.keys.base);
        return !!current && isMetaBehind(meta, current);
    }

    function saveMeta(meta, cfg) {
        const normalized = normalizeMeta(meta, cfg.year, cfg.tournamentKey);
        const localMeta = readMetaState(cfg).data;
        if (localMeta && isMetaBehind(normalized, localMeta)) {
            warn('Refusing to save older meta over newer local meta.', { next: normalized, current: localMeta });
            return false;
        }
        const localOk = writeStorage(cfg.keys.meta, createEnvelope(normalized, normalized));
        // Spiegelkopie für die aktuelle Browser-Session – damit andere
        // Seiten innerhalb der nächsten Sekunden den Meta-Read sparen
        // können.
        const sessionOk = writeSessionMeta(cfg, normalized);
        if (!localOk || !sessionOk) {
            warn('Meta storage failed; local meta will not be trusted as current.');
            return false;
        }
        return normalized;
    }

    function isStale(savedAt, maxAgeMs) {
        if (!savedAt) return true;
        return now() - savedAt > maxAgeMs;
    }

    function hasChanged(remoteMeta, localMeta, kind) {
        let versionKey, updatedAtKey;
        if (kind === 'teams') {
            versionKey = 'teamsVersion';
            updatedAtKey = 'teamsUpdatedAt';
        } else if (kind === 'fixtures') {
            versionKey = 'fixturesVersion';
            updatedAtKey = 'fixturesUpdatedAt';
        } else {
            versionKey = 'pointsVersion';
            updatedAtKey = 'pointsUpdatedAt';
        }

        const remoteVersion = remoteMeta ? remoteMeta[versionKey] : null;
        const localVersion = localMeta ? localMeta[versionKey] : null;

        if (remoteVersion !== null) {
            return remoteVersion !== localVersion;
        }

        const remoteUpdatedAt = remoteMeta ? remoteMeta[updatedAtKey] : null;
        const localUpdatedAt = localMeta ? localMeta[updatedAtKey] : null;

        if (remoteUpdatedAt !== null) {
            return remoteUpdatedAt !== localUpdatedAt;
        }

        return false;
    }

    function preserveMetaKind(nextMeta, localMeta, kind) {
        if (!nextMeta || !localMeta) return;
        const keys = kind === 'fixtures'
            ? ['fixturesVersion', 'fixturesUpdatedAt', 'fixturesCacheGeneratedAt']
            : kind === 'teams'
                ? ['teamsVersion', 'teamsUpdatedAt']
                : [
                    'pointsVersion',
                    'pointsUpdatedAt',
                    'pointsCacheGeneratedAt',
                    'pointsShardCount',
                    'pointsDeltaDocId',
                    'pointsDeltaBaseVersion',
                    'pointsDeltaNextVersion'
                ];
        keys.forEach((key) => {
            nextMeta[key] = localMeta[key];
        });
    }

    function buildRefreshAwareMeta(remoteMeta, localMeta, cfg, refreshStatus) {
        const nextMeta = { ...(remoteMeta || {}) };
        if (!refreshStatus.teamsOk) preserveMetaKind(nextMeta, localMeta, 'teams');
        if (!refreshStatus.pointsOk) preserveMetaKind(nextMeta, localMeta, 'points');
        if (!refreshStatus.fixturesOk) preserveMetaKind(nextMeta, localMeta, 'fixtures');
        return normalizeMeta(nextMeta, cfg.year, cfg.tournamentKey);
    }

    async function fetchMeta(cfg) {
        try {
            const snap = await getDocFromServer(cfg.db.collection(cfg.metaCollection).doc(cfg.metaDocId));

            if (!snap.exists) {
                log(cfg, 'Kein Meta-Dokument gefunden:', cfg.metaCollection, cfg.metaDocId);
                return null;
            }

            const normalized = normalizeMeta(snap.data(), cfg.year, cfg.tournamentKey);
            writeSessionMeta(cfg, normalized);
            return normalized;
        } catch (err) {
            warn('Meta fetch from server failed:', err);
            return null;
        }
    }

    /**
     * Liefert das Meta entweder aus einem expliziten Override, aus dem
     * Session-Cache (falls noch frisch) oder über einen Firestore-Read.
     * Spart in praktisch jedem Mehrseiten-Workflow mindestens einen
     * Meta-Read pro Seitenwechsel.
     */
    async function resolveRemoteMeta(cfg, options) {
        if (options && Object.prototype.hasOwnProperty.call(options, 'remoteMetaOverride')) {
            const override = options.remoteMetaOverride;
            if (override === null || typeof override === 'undefined') return null;
            const normalized = normalizeMeta(override, cfg.year, cfg.tournamentKey);
            writeSessionMeta(cfg, normalized);
            return normalized;
        }

        if (cfg.freshnessFirst !== false) {
            return fetchMeta(cfg);
        }

        if (options && options.bypassSessionMeta === true) {
            return fetchMeta(cfg);
        }

        const session = readSessionMeta(cfg);
        const ttl = typeof cfg.sessionMetaTtlMs === 'number' && cfg.sessionMetaTtlMs >= 0
            ? cfg.sessionMetaTtlMs
            : DEFAULTS.sessionMetaTtlMs;

        if (session && session.data && (now() - session.savedAt) < ttl) {
            log(cfg, 'Meta aus Session-Cache übernommen, Alter (ms):', now() - session.savedAt);
            return normalizeMeta(session.data, cfg.year, cfg.tournamentKey);
        }

        return fetchMeta(cfg);
    }

    async function fetchTeams(cfg) {
        const snap = await getCollectionFromServer(cfg.db.collection(cfg.teamsCollection));
        const teams = [];
        snap.forEach((doc) => {
            teams.push(doc.data());
        });
        return teams;
    }

    function metaMatchesCacheDocument(doc, cfg) {
        if (!doc || typeof doc !== 'object') return false;
        return doc.tournamentKey === cfg.tournamentKey && String(doc.year) === String(cfg.year);
    }

    function isValidPointsDeltaDocument(delta, cfg, remoteMeta) {
        if (!metaMatchesCacheDocument(delta, cfg)) return false;
        if (delta.kind !== 'points_delta') return false;
        if (delta.baseVersion !== remoteMeta.pointsDeltaBaseVersion) return false;
        if (delta.nextVersion !== remoteMeta.pointsDeltaNextVersion) return false;
        if (delta.pointsVersion !== remoteMeta.pointsVersion) return false;
        if (delta.set != null && !isPlainObject(delta.set)) return false;
        if (delta.delete != null && !Array.isArray(delta.delete)) return false;

        const setMap = delta.set || {};
        const deleteList = delta.delete || [];
        if (!Object.values(setMap).every(isPlainObject)) return false;
        if (!deleteList.every((id) => typeof id === 'string' && id)) return false;
        return true;
    }

    async function fetchPointsDelta(cfg, remoteMeta, pointsState, localMeta) {
        if (!remoteMeta || !remoteMeta.pointsDeltaDocId) return null;
        if (!pointsState || !pointsState.valid || !isPlainObject(pointsState.data)) return null;
        if (!localMeta || localMeta.pointsVersion !== remoteMeta.pointsDeltaBaseVersion) return null;
        if (remoteMeta.pointsDeltaNextVersion !== remoteMeta.pointsVersion) return null;
        if (remoteMeta.pointsVersion === null || remoteMeta.pointsDeltaBaseVersion === null) return null;

        try {
            const snap = await getDocFromServer(cfg.db.collection(cfg.pointsCacheCollection).doc(remoteMeta.pointsDeltaDocId));
            if (!snap.exists) {
                log(cfg, 'Points-Delta fehlt, versuche Shards/Collection.');
                return null;
            }

            const delta = snap.data() || {};
            if (!isValidPointsDeltaDocument(delta, cfg, remoteMeta)) {
                log(cfg, 'Points-Delta ungueltig, versuche Shards/Collection.');
                return null;
            }

            const nextPoints = { ...(pointsState.data || {}) };
            Object.entries(delta.set || {}).forEach(([playerId, pointDoc]) => {
                nextPoints[String(playerId)] = pointDoc;
            });
            (delta.delete || []).forEach((playerId) => {
                delete nextPoints[String(playerId)];
            });

            const normalized = normalizePointsData(nextPoints);
            if (!isValidPointsData(normalized, cfg.allowEmptyPoints, cfg, remoteMeta)) {
                log(cfg, 'Points-Delta Ergebnis ungueltig, versuche Shards/Collection.');
                return null;
            }

            return normalized;
        } catch (err) {
            warn('Points delta fetch failed:', err);
            return null;
        }
    }

    function getRemotePointsShardCount(remoteMeta) {
        if (!remoteMeta || !Number.isInteger(remoteMeta.pointsShardCount) || remoteMeta.pointsShardCount <= 0) {
            return 0;
        }
        return remoteMeta.pointsShardCount;
    }

    async function fetchPointsShards(cfg, remoteMeta) {
        const shardCount = getRemotePointsShardCount(remoteMeta);
        if (!remoteMeta || typeof remoteMeta.pointsCacheGeneratedAt !== 'number') return null;
        if (!shardCount || typeof remoteMeta.pointsVersion !== 'number') return null;

        try {
            const snaps = await Promise.all(
                Array.from({ length: shardCount }, (_, index) => (
                    getDocFromServer(
                        cfg.db
                            .collection(cfg.pointsCacheCollection)
                            .doc(getPublicPointsShardDocId(index, cfg))
                    )
                ))
            );

            const points = {};
            for (let index = 0; index < snaps.length; index++) {
                const snap = snaps[index];
                if (!snap.exists) {
                    log(cfg, `Points-Shard ${index} fehlt, nutze Collection-Fallback.`);
                    return null;
                }

                const shard = snap.data() || {};
                if (
                    !metaMatchesCacheDocument(shard, cfg) ||
                    shard.kind !== 'points_shard' ||
                    shard.cacheGenerationMs !== remoteMeta.pointsCacheGeneratedAt ||
                    shard.pointsVersion !== remoteMeta.pointsVersion ||
                    shard.shardIndex !== index ||
                    shard.shardCount !== shardCount ||
                    !isPlainObject(shard.points)
                ) {
                    log(cfg, `Points-Shard ${index} ungueltig/veraltet, nutze Collection-Fallback.`);
                    return null;
                }

                Object.assign(points, shard.points);
            }

            const normalized = normalizePointsData(points);
            if (!isValidPointsData(normalized, cfg.allowEmptyPoints, cfg, remoteMeta)) {
                log(cfg, 'Points-Shards Ergebnis ungueltig, nutze Collection-Fallback.');
                return null;
            }

            return normalized;
        } catch (err) {
            warn('Points shards fetch failed:', err);
            return null;
        }
    }

    async function fetchPoints(cfg, remoteMeta, pointsState, localMeta) {
        // Delta documents were a read-optimization only. Freshness-first uses
        // strictly versioned public shards, then falls back to the collection.
        const shardedPoints = await fetchPointsShards(cfg, remoteMeta);
        if (shardedPoints) return shardedPoints;

        const snap = await getCollectionFromServer(cfg.db.collection(cfg.pointsCollection));
        const points = {};
        snap.forEach((doc) => {
            points[doc.id] = doc.data();
        });
        return normalizePointsData(points);
    }

    async function fetchFixtureBundle(cfg, remoteMeta) {
        if (!cfg.fixturesBundleCollection || !cfg.fixturesBundleDocId) return null;

        try {
            const snap = await getDocFromServer(cfg.db.collection(cfg.fixturesBundleCollection).doc(cfg.fixturesBundleDocId));
            if (!snap.exists) {
                log(cfg, 'Fixture-Bundle fehlt, nutze Collection-Fallback.');
                return null;
            }

            const bundle = snap.data() || {};
            const fixtures = bundle.fixtures;
            if (
                bundle.kind !== 'fixtures_bundle' ||
                !metaMatchesCacheDocument(bundle, cfg) ||
                !fixtures ||
                typeof fixtures !== 'object' ||
                Array.isArray(fixtures)
            ) {
                log(cfg, 'Fixture-Bundle ungueltig, nutze Collection-Fallback.');
                return null;
            }

            const requiredGeneration = remoteMeta && typeof remoteMeta.fixturesCacheGeneratedAt === 'number'
                ? remoteMeta.fixturesCacheGeneratedAt
                : null;
            if (remoteMeta && toPositiveInteger(remoteMeta.fixturesVersion) > 0 && requiredGeneration === null) {
                warn('Fixture bundle rejected: remote meta has fixturesVersion but no fixturesCacheGeneratedAt.');
                return null;
            }
            if (
                requiredGeneration === null ||
                bundle.cacheGenerationMs !== requiredGeneration
            ) {
                log(cfg, 'Fixture-Bundle veraltet, nutze Collection-Fallback.');
                return null;
            }

            return fixtures;
        } catch (err) {
            warn('Fixture bundle fetch failed:', err);
            return null;
        }
    }

    async function fetchFixtures(cfg, remoteMeta) {
        if (!cfg.fixturesCollection) return null;
        const bundledFixtures = await fetchFixtureBundle(cfg, remoteMeta);
        if (isValidFixturesData(bundledFixtures, cfg.allowEmptyFixtures, cfg, remoteMeta)) {
            return bundledFixtures;
        }

        try {
            const snap = await getCollectionFromServer(cfg.db.collection(cfg.fixturesCollection));
            const fixtures = {};
            snap.forEach((doc) => {
                fixtures[doc.id] = doc.data();
            });
            return fixtures;
        } catch (err) {
            warn('Fixtures collection fetch failed:', err);
            return null;
        }
    }

    function buildOfflineFallbackBundle(cfg, localMeta) {
        const meta = localMeta || normalizeMeta({}, cfg.year, cfg.tournamentKey);
        const teamsState = readDatasetState('teams', cfg, meta, {
            requireMetaMatch: false,
            allowBackupAsCurrent: true
        });
        const pointsState = readDatasetState('points', cfg, meta, {
            requireMetaMatch: false,
            allowBackupAsCurrent: true
        });
        const fixturesState = cfg.includeFixtures === false
            ? skippedDatasetState({})
            : readDatasetState('fixtures', cfg, meta, {
                requireMetaMatch: false,
                allowBackupAsCurrent: true
            });
        const fixturesOk = !cfg.fixturesCollection || fixturesState.valid;

        if (!teamsState.valid || !pointsState.valid || !fixturesOk) {
            return null;
        }

        return {
            data: {
                teams: teamsState.data || [],
                points: pointsState.data || {},
                fixtures: fixturesState.data || {},
                meta
            },
            info: {
                refreshedTeams: false,
                refreshedPoints: false,
                refreshedFixtures: false,
                usedBackupTeams: teamsState.usedBackup,
                usedBackupPoints: pointsState.usedBackup,
                usedBackupFixtures: fixturesState.usedBackup,
                fromCacheOnly: true,
                stale: true,
                offlineFallback: true,
                verifiedFromServer: false
            }
        };
    }

    function getCachedBundle(options) {
        const cfg = resolveConfig(options);
        const metaState = readMetaState(cfg);
        const freshnessFirst = cfg.freshnessFirst !== false;
        const teamsState = readDatasetState('teams', cfg, metaState.data, {
            requireMetaMatch: freshnessFirst
        });
        const pointsState = readDatasetState('points', cfg, metaState.data, {
            requireMetaMatch: freshnessFirst
        });
        const fixturesState = cfg.includeFixtures === false
            ? skippedDatasetState({})
            : readDatasetState('fixtures', cfg, metaState.data, {
                requireMetaMatch: freshnessFirst
            });
        const fixturesOk = !cfg.fixturesCollection || fixturesState.valid;
        const locallyComplete = teamsState.valid && pointsState.valid && fixturesOk;

        return {
            ok: !freshnessFirst && locallyComplete,
            data: {
                teams: teamsState.data || [],
                points: pointsState.data || {},
                fixtures: fixturesState.data || {},
                meta: metaState.data
            },
            info: {
                teamsFromBackup: teamsState.usedBackup,
                pointsFromBackup: pointsState.usedBackup,
                fixturesFromBackup: fixturesState.usedBackup,
                teamsSavedAt: teamsState.savedAt,
                pointsSavedAt: pointsState.savedAt,
                fixturesSavedAt: fixturesState.savedAt,
                metaSavedAt: metaState.savedAt,
                stale: freshnessFirst,
                offlineFallback: false,
                verifiedFromServer: false
            }
        };
    }

    async function loadBundleFreshnessFirst(options, cfg) {
        const localMetaState = readMetaState(cfg);
        const remoteMeta = await resolveRemoteMeta(cfg, options || {});

        if (!remoteMeta) {
            const fallback = buildOfflineFallbackBundle(cfg, localMetaState.data);
            if (fallback) return fallback;
            throw new Error('DreamTeamCache: Server-Meta nicht verfuegbar; keine serververifizierten Daten.');
        }

        if (isBehindFreshestMeta(cfg, remoteMeta)) {
            warn('Ignoring older refresh meta.', remoteMeta);
            return {
                data: { teams: [], points: {}, fixtures: {}, meta: remoteMeta },
                info: {
                    ignoredOlderRefresh: true,
                    stale: true,
                    offlineFallback: false,
                    verifiedFromServer: false
                }
            };
        }

        rememberFreshestMeta(cfg, remoteMeta);

        const teamsState = readDatasetState('teams', cfg, remoteMeta, { requireMetaMatch: true });
        const pointsState = readDatasetState('points', cfg, remoteMeta, { requireMetaMatch: true });
        const fixturesState = cfg.includeFixtures === false
            ? skippedDatasetState({})
            : readDatasetState('fixtures', cfg, remoteMeta, { requireMetaMatch: true });

        let teams = teamsState.data;
        let points = pointsState.data;
        let fixtures = fixturesState.data;
        const needTeams = !teamsState.valid;
        const needPoints = !pointsState.valid;
        const needFixtures = !fixturesState.valid && !!cfg.fixturesCollection;

        let refreshedTeams = false;
        let refreshedPoints = false;
        let refreshedFixtures = false;
        let storageOk = true;
        let storagePurged = false;

        function noteStorageResult(ok, kind) {
            if (ok) return;
            storageOk = false;
            warn(`${kind} cache write failed; clearing dataset caches so the next load must read the server.`);
            if (!storagePurged) {
                purgeDatasetStorage(cfg, null);
                storagePurged = true;
            }
        }

        if (needTeams) {
            const freshTeams = await fetchTeams(cfg);
            if (!isValidTeamsData(freshTeams, cfg.allowEmptyTeams)) {
                throw new Error('DreamTeamCache: Teams-Fetch war ungueltig.');
            }
            teams = freshTeams;
            if (storageOk && !isBehindFreshestMeta(cfg, remoteMeta)) {
                noteStorageResult(saveTeams(freshTeams, cfg, remoteMeta), 'Teams');
            }
            refreshedTeams = true;
        }

        if (needPoints) {
            const freshPoints = await fetchPoints(cfg, remoteMeta, pointsState, localMetaState.data);
            if (!isValidPointsData(freshPoints, cfg.allowEmptyPoints, cfg, remoteMeta)) {
                throw new Error('DreamTeamCache: Punkte-Fetch war ungueltig.');
            }
            points = freshPoints;
            if (storageOk && !isBehindFreshestMeta(cfg, remoteMeta)) {
                noteStorageResult(savePoints(freshPoints, cfg, remoteMeta), 'Points');
            }
            refreshedPoints = true;
        }

        if (needFixtures && cfg.fixturesCollection) {
            const freshFixtures = await fetchFixtures(cfg, remoteMeta);
            if (!isValidFixturesData(freshFixtures, cfg.allowEmptyFixtures, cfg, remoteMeta)) {
                throw new Error('DreamTeamCache: Fixtures-Fetch war ungueltig.');
            }
            fixtures = freshFixtures;
            if (storageOk && !isBehindFreshestMeta(cfg, remoteMeta)) {
                noteStorageResult(saveFixtures(freshFixtures, cfg, remoteMeta), 'Fixtures');
            }
            refreshedFixtures = true;
        }

        if (isBehindFreshestMeta(cfg, remoteMeta)) {
            warn('Skipping older refresh result after a newer meta was processed.', remoteMeta);
            return {
                data: { teams, points, fixtures: fixtures || {}, meta: remoteMeta },
                info: {
                    ignoredOlderRefresh: true,
                    stale: true,
                    offlineFallback: false,
                    verifiedFromServer: false
                }
            };
        }

        const finalMeta = normalizeMeta(remoteMeta, cfg.year, cfg.tournamentKey);

        if (storageOk) {
            const savedMeta = saveMeta(finalMeta, cfg);
            if (!savedMeta) storageOk = false;
        } else {
            warn('Skipping local meta save because one or more dataset cache writes failed.');
        }

        if (!isValidTeamsData(teams, cfg.allowEmptyTeams)) {
            if (cfg.allowEmptyTeams) {
                teams = [];
            } else {
                throw new Error('DreamTeamCache: Keine gueltigen Teamdaten verfuegbar.');
            }
        }

        if (!isValidPointsData(points, cfg.allowEmptyPoints, cfg, finalMeta)) {
            if (cfg.allowEmptyPoints && !shouldRequireNonEmptyDataset(cfg, finalMeta, 'points')) {
                points = {};
            } else {
                throw new Error('DreamTeamCache: Keine gueltigen Punktedaten verfuegbar.');
            }
        }

        if (cfg.fixturesCollection && !isValidFixturesData(fixtures, cfg.allowEmptyFixtures, cfg, finalMeta)) {
            if (cfg.allowEmptyFixtures && !shouldRequireNonEmptyDataset(cfg, finalMeta, 'fixtures')) {
                fixtures = {};
            } else {
                throw new Error('DreamTeamCache: Keine gueltigen Spielplandaten verfuegbar.');
            }
        }

        return {
            data: {
                teams,
                points,
                fixtures: fixtures || {},
                meta: finalMeta
            },
            info: {
                refreshedTeams,
                refreshedPoints,
                refreshedFixtures,
                usedBackupTeams: false,
                usedBackupPoints: false,
                usedBackupFixtures: false,
                fromCacheOnly: !refreshedTeams && !refreshedPoints && !refreshedFixtures,
                stale: false,
                offlineFallback: false,
                verifiedFromServer: true,
                storageOk
            }
        };
    }

    async function loadBundle(options) {
        const cfg = resolveConfig(options);
        if (cfg.freshnessFirst !== false) {
            return loadBundleFreshnessFirst(options || {}, cfg);
        }
        const localMetaState = readMetaState(cfg);
        const teamsState = readDatasetState('teams', cfg, localMetaState.data);
        const pointsState = readDatasetState('points', cfg, localMetaState.data);
        const fixturesState = cfg.includeFixtures === false
            ? skippedDatasetState({})
            : readDatasetState('fixtures', cfg, localMetaState.data);

        let teams = teamsState.data;
        let points = pointsState.data;
        let fixtures = fixturesState.data;
        let needTeams = !teamsState.valid;
        let needPoints = !pointsState.valid;
        let needFixtures = !fixturesState.valid && !!cfg.fixturesCollection;

        const remoteMeta = await resolveRemoteMeta(cfg, options);

        if (remoteMeta) {
            if (hasChanged(remoteMeta, localMetaState.data, 'teams') || !teamsState.valid) {
                needTeams = true;
            }
            if (hasChanged(remoteMeta, localMetaState.data, 'points') || !pointsState.valid) {
                needPoints = true;
            }
            if (cfg.fixturesCollection && (hasChanged(remoteMeta, localMetaState.data, 'fixtures') || !fixturesState.valid)) {
                needFixtures = true;
            }
        } else {
            if (isStale(teamsState.savedAt, cfg.fallbackMaxAgeMs)) {
                needTeams = true;
            }
            if (isStale(pointsState.savedAt, cfg.fallbackMaxAgeMs)) {
                needPoints = true;
            }
            if (cfg.fixturesCollection && isStale(fixturesState.savedAt, cfg.fallbackMaxAgeMs)) {
                needFixtures = true;
            }
        }

        let refreshedTeams = false;
        let refreshedPoints = false;
        let refreshedFixtures = false;
        let usedBackupTeams = teamsState.usedBackup;
        let usedBackupPoints = pointsState.usedBackup;
        let usedBackupFixtures = fixturesState.usedBackup;

        if (needTeams) {
            try {
                const freshTeams = await fetchTeams(cfg);

                if (isValidTeamsData(freshTeams, cfg.allowEmptyTeams)) {
                    teams = freshTeams;
                    saveTeams(freshTeams, cfg);
                    refreshedTeams = true;
                    usedBackupTeams = false;
                } else {
                    log(cfg, 'Teams-Fetch war ungültig, nutze last good cache.');
                    const backup = teamsState.backup && isValidTeamsData(teamsState.backup.data, cfg.allowEmptyTeams)
                        ? teamsState.backup.data
                        : null;

                    if (backup) {
                        teams = backup;
                        usedBackupTeams = true;
                    }
                }
            } catch (err) {
                log(cfg, 'Teams-Fetch fehlgeschlagen:', err);
                const backup = teamsState.backup && isValidTeamsData(teamsState.backup.data, cfg.allowEmptyTeams)
                    ? teamsState.backup.data
                    : null;

                if (backup) {
                    teams = backup;
                    usedBackupTeams = true;
                }
            }
        }

        if (needPoints) {
            try {
                const freshPoints = await fetchPoints(cfg, remoteMeta, pointsState, localMetaState.data);

                if (isValidPointsData(freshPoints, cfg.allowEmptyPoints, cfg, remoteMeta)) {
                    points = freshPoints;
                    savePoints(freshPoints, cfg, remoteMeta);
                    refreshedPoints = true;
                    usedBackupPoints = false;
                } else {
                    log(cfg, 'Punkte-Fetch war ungültig, nutze last good cache.');
                    const backup = pointsState.backup && isValidPointsData(pointsState.backup.data, cfg.allowEmptyPoints, cfg, localMetaState.data)
                        ? pointsState.backup.data
                        : null;

                    if (backup) {
                        points = backup;
                        usedBackupPoints = true;
                    }
                }
            } catch (err) {
                log(cfg, 'Punkte-Fetch fehlgeschlagen:', err);
                const backup = pointsState.backup && isValidPointsData(pointsState.backup.data, cfg.allowEmptyPoints, cfg, localMetaState.data)
                    ? pointsState.backup.data
                    : null;

                if (backup) {
                    points = backup;
                    usedBackupPoints = true;
                }
            }
        }

        if (needFixtures && cfg.fixturesCollection) {
            try {
                const freshFixtures = await fetchFixtures(cfg, remoteMeta);

                if (isValidFixturesData(freshFixtures, cfg.allowEmptyFixtures, cfg, remoteMeta)) {
                    fixtures = freshFixtures;
                    saveFixtures(freshFixtures, cfg, remoteMeta);
                    refreshedFixtures = true;
                    usedBackupFixtures = false;
                } else {
                    log(cfg, 'Fixtures-Fetch war ungültig, nutze last good cache.');
                    const backup = fixturesState.backup && isValidFixturesData(fixturesState.backup.data, cfg.allowEmptyFixtures, cfg, localMetaState.data)
                        ? fixturesState.backup.data
                        : null;

                    if (backup) {
                        fixtures = backup;
                        usedBackupFixtures = true;
                    }
                }
            } catch (err) {
                log(cfg, 'Fixtures-Fetch fehlgeschlagen:', err);
                const backup = fixturesState.backup && isValidFixturesData(fixturesState.backup.data, cfg.allowEmptyFixtures, cfg, localMetaState.data)
                    ? fixturesState.backup.data
                    : null;

                if (backup) {
                    fixtures = backup;
                    usedBackupFixtures = true;
                }
            }
        }

        const refreshStatus = {
            teamsOk: !needTeams || refreshedTeams,
            pointsOk: !needPoints || refreshedPoints,
            fixturesOk: !needFixtures || refreshedFixtures
        };
        const finalMeta = remoteMeta
            ? buildRefreshAwareMeta(remoteMeta, localMetaState.data, cfg, refreshStatus)
            : localMetaState.data;

        if (remoteMeta) {
            saveMeta(finalMeta, cfg);
        }

        // Vor Turnierstart können Teams- und Punkte-Collections noch komplett
        // leer sein (z. B. WM 2026 vor dem ersten Spiel). Wenn der Aufrufer
        // leere Datensätze ausdrücklich erlaubt, liefern wir in diesen
        // Fällen leere Defaults zurück, statt mit einem Fehler abzubrechen.
        if (!isValidTeamsData(teams, cfg.allowEmptyTeams)) {
            if (cfg.allowEmptyTeams) {
                teams = [];
            } else {
                throw new Error('DreamTeamCache: Keine gültigen Teamdaten verfügbar.');
            }
        }

        if (!isValidPointsData(points, cfg.allowEmptyPoints, cfg, finalMeta)) {
            if (cfg.allowEmptyPoints && !shouldRequireNonEmptyDataset(cfg, finalMeta, 'points')) {
                points = {};
            } else {
                throw new Error('DreamTeamCache: Keine gültigen Punktedaten verfügbar.');
            }
        }

        if (Object.keys(points || {}).length === 0 && !cfg.allowEmptyPoints) {
            console.warn('Punkte-Daten leer geladen – Collection/Cache/Firestore prüfen');
        }

        if (cfg.fixturesCollection && !isValidFixturesData(fixtures, cfg.allowEmptyFixtures, cfg, finalMeta)) {
            if (cfg.allowEmptyFixtures && !shouldRequireNonEmptyDataset(cfg, finalMeta, 'fixtures')) {
                fixtures = {};
            } else {
                throw new Error('DreamTeamCache: Keine gültigen Spielplandaten verfügbar.');
            }
        }

        if (cfg.log) {
            console.info('[DreamTeamDebug]', {
                origin: window.location.origin,
                hostname: window.location.hostname,
                tournamentKey: cfg.tournamentKey,
                domainDefaultKey: window.APP_CONFIG && window.APP_CONFIG.domainDefaultKey,
                devOverrideActive: !!(window.APP_CONFIG && typeof window.APP_CONFIG.isDevOverrideActive === 'function' && window.APP_CONFIG.isDevOverrideActive()),
                teamsCollection: cfg.teamsCollection,
                pointsCollection: cfg.pointsCollection,
                teamsCount: Array.isArray(teams) ? teams.length : 0,
                pointsCount: Object.keys(points || {}).length,
                refreshedTeams,
                refreshedPoints,
                refreshedFixtures
            });
        }

        return {
            data: {
                teams,
                points,
                fixtures: fixtures || {},
                meta: finalMeta
            },
            info: {
                refreshedTeams,
                refreshedPoints,
                refreshedFixtures,
                usedBackupTeams,
                usedBackupPoints,
                usedBackupFixtures,
                fromCacheOnly: !refreshedTeams && !refreshedPoints && !refreshedFixtures
            }
        };
    }

    function subscribeToMeta(options) {
        const cfg = resolveConfig(options);

        if (!options || typeof options.onChange !== 'function') {
            throw new Error('DreamTeamCache: onChange Callback ist erforderlich.');
        }

        return cfg.db.collection(cfg.metaCollection).doc(cfg.metaDocId).onSnapshot(
            { includeMetadataChanges: true },
            (snap) => {
                if (!snap.exists) return;

                const remoteMeta = normalizeMeta(snap.data(), cfg.year, cfg.tournamentKey);
                const fromCache = isSnapshotFromCache(snap);
                if (!fromCache) {
                    writeSessionMeta(cfg, remoteMeta);
                }

                const localMeta = readMetaState(cfg).data;

                const teamsChanged = hasChanged(remoteMeta, localMeta, 'teams');
                const pointsChanged = hasChanged(remoteMeta, localMeta, 'points');
                const fixturesChanged = !!cfg.fixturesCollection && hasChanged(remoteMeta, localMeta, 'fixtures');

                if (!fromCache && (teamsChanged || pointsChanged || fixturesChanged)) {
                    options.onChange({
                        remoteMeta,
                        teamsChanged,
                        pointsChanged,
                        fixturesChanged
                    });
                }
            },
            (err) => {
                if (typeof options.onError === 'function') {
                    options.onError(err);
                } else {
                    log(cfg, 'Meta-Listener Fehler:', err);
                }
            }
        );
    }

    /**
     * Komfort-Wrapper für Konsumenten-Seiten.
     *
     * Übernimmt das gesamte Cache-Lifecycle einer Seite in einem einzigen
     * Aufruf:
     *
     *   1. Sofort aus dem LocalStorage-Cache rendern (0 Reads).
     *   2. Optional: einen optimistischen Refresh über das Session-Meta
     *      anstossen, falls eine andere Seite gerade frisches Meta gelesen
     *      hat (auch 0 Reads, wenn die Versionen unverändert sind).
     *   3. Live-Listener auf das Meta-Dokument anhängen. Der Initial-
     *      Snapshot kostet einen Read, aber er ersetzt den separaten
     *      `fetchMeta()`-Aufruf der alten Sequenz `loadBundle + subscribeToMeta`
     *      und spart dadurch einen Read pro Seitenaufruf.
     *
     * Erwartete Callbacks:
     *   - onCachedReady(data, info) – synchron, sobald Cache valide ist.
     *   - onUpdate(data, info)       – nach jedem erfolgreichen Refresh.
     *   - onError(err)               – bei Fehlern.
     *
     * Rückgabewert: eine Funktion zum Beenden der Subscription.
     */
    async function bootstrapFreshnessFirst(options, cfg) {
        const opts = options || {};
        const onCachedReady = typeof opts.onCachedReady === 'function' ? opts.onCachedReady : null;
        const onUpdate = typeof opts.onUpdate === 'function' ? opts.onUpdate : null;
        const onError = typeof opts.onError === 'function' ? opts.onError : null;
        const renderCached = Object.prototype.hasOwnProperty.call(opts, 'renderCached')
            ? !!opts.renderCached
            : cfg.renderCached === true;

        if (renderCached && onCachedReady) {
            try {
                const cached = getCachedBundle(opts);
                onCachedReady(cached.data, {
                    ...cached.info,
                    stale: true,
                    offlineFallback: false,
                    verifiedFromServer: false
                });
            } catch (err) {
                if (onError) onError(err);
            }
        }

        let latestDeliveredMeta = null;
        let refreshChain = Promise.resolve();

        function shouldDeliver(bundle) {
            if (!bundle || (bundle.info && bundle.info.ignoredOlderRefresh)) return false;
            if (!bundle.info || bundle.info.verifiedFromServer !== true) return true;

            const meta = bundle.data && bundle.data.meta;
            if (!meta) return true;
            if (latestDeliveredMeta && isMetaBehind(meta, latestDeliveredMeta)) {
                warn('Skipping DOM update from older meta.', { next: meta, current: latestDeliveredMeta });
                return false;
            }
            if (latestDeliveredMeta && sameMetaGeneration(meta, latestDeliveredMeta)) {
                return false;
            }
            latestDeliveredMeta = meta;
            return true;
        }

        function deliver(bundle, reason) {
            if (!onUpdate || !shouldDeliver(bundle)) return;
            onUpdate(bundle.data, { ...bundle.info, refreshReason: reason });
        }

        function enqueueRefresh(loadOptions, reason) {
            refreshChain = refreshChain
                .catch(() => null)
                .then(async () => {
                    try {
                        const fresh = await loadBundle({ ...opts, ...(loadOptions || {}) });
                        deliver(fresh, reason);
                    } catch (err) {
                        if (onError) onError(err);
                    }
                });
            return refreshChain;
        }

        await enqueueRefresh({ bypassSessionMeta: true }, 'initial');

        const unsubscribe = cfg.db.collection(cfg.metaCollection).doc(cfg.metaDocId).onSnapshot(
            { includeMetadataChanges: true },
            (snap) => {
                if (!snap.exists) return;
                if (isSnapshotFromCache(snap)) {
                    log(cfg, 'Meta-Snapshot aus Firestore-Cache ignoriert.');
                    return;
                }

                const remoteMeta = normalizeMeta(snap.data(), cfg.year, cfg.tournamentKey);
                writeSessionMeta(cfg, remoteMeta);
                if (latestDeliveredMeta && sameMetaGeneration(remoteMeta, latestDeliveredMeta)) {
                    return;
                }
                enqueueRefresh({ remoteMetaOverride: remoteMeta }, 'meta');
            },
            (err) => {
                if (onError) onError(err);
            }
        );

        let lastResumeRefreshAt = now();
        const resumeRefreshMinIntervalMs = typeof cfg.resumeRefreshMinIntervalMs === 'number' && cfg.resumeRefreshMinIntervalMs >= 0
            ? cfg.resumeRefreshMinIntervalMs
            : DEFAULTS.resumeRefreshMinIntervalMs;

        const refreshFromServer = (reason) => {
            const ageMs = now() - lastResumeRefreshAt;
            if (ageMs < resumeRefreshMinIntervalMs) return;
            lastResumeRefreshAt = now();
            enqueueRefresh({ bypassSessionMeta: true }, reason);
        };

        const handleVisible = () => {
            if (!document.hidden) refreshFromServer('visible');
        };
        const handleOnline = () => refreshFromServer('online');
        const handleFocus = () => refreshFromServer('focus');

        document.addEventListener('visibilitychange', handleVisible);
        window.addEventListener('online', handleOnline);
        window.addEventListener('focus', handleFocus);

        return () => {
            unsubscribe();
            document.removeEventListener('visibilitychange', handleVisible);
            window.removeEventListener('online', handleOnline);
            window.removeEventListener('focus', handleFocus);
        };
    }

    async function bootstrap(options) {
        const cfg = resolveConfig(options);
        if (cfg.freshnessFirst !== false) {
            return bootstrapFreshnessFirst(options || {}, cfg);
        }

        const onCachedReady = typeof options.onCachedReady === 'function' ? options.onCachedReady : null;
        const onUpdate = typeof options.onUpdate === 'function' ? options.onUpdate : null;
        const onError = typeof options.onError === 'function' ? options.onError : null;

        // 1) Sofort aus dem Cache rendern.
        let cachedDelivered = false;
        try {
            const cached = getCachedBundle(options);
            if (cached.ok && onCachedReady) {
                onCachedReady(cached.data, cached.info);
                cachedDelivered = true;
            }
        } catch (err) {
            if (onError) onError(err);
        }

        // 2) Wenn das Session-Meta noch frisch ist, können wir bereits
        //    jetzt – ohne Meta-Read – einen Refresh anstossen. Bei
        //    unveränderten Versionen kostet das 0 Reads.
        let optimisticVersionKey = null;
        const session = readSessionMeta(cfg);
        const ttl = typeof cfg.sessionMetaTtlMs === 'number' && cfg.sessionMetaTtlMs >= 0
            ? cfg.sessionMetaTtlMs
            : DEFAULTS.sessionMetaTtlMs;

        if (session && session.data && (now() - session.savedAt) < ttl) {
            try {
                const fresh = await loadBundle({ ...options, remoteMetaOverride: session.data });
                if (onUpdate) onUpdate(fresh.data, fresh.info);
                const m = fresh.data && fresh.data.meta ? fresh.data.meta : null;
                optimisticVersionKey = m
                    ? `${m.teamsVersion}_${m.pointsVersion}_${m.fixturesVersion}`
                    : null;
            } catch (err) {
                if (onError) onError(err);
            }
        }

        // 3) Live-Listener auf das Meta-Dokument. Der erste Snapshot
        //    übernimmt die Rolle des bisherigen separaten `fetchMeta()`.
        let listenerInitialFired = false;
        const unsubscribe = cfg.db.collection(cfg.metaCollection).doc(cfg.metaDocId).onSnapshot(
            { includeMetadataChanges: true },
            async (snap) => {
                if (!snap.exists) {
                    // Kein Meta-Dokument vorhanden. Wenn wir noch keinen
                    // Refresh hatten und auch keine Cache-Daten geliefert
                    // wurden, nutzen wir den TTL-Fallback im loadBundle.
                    if (!listenerInitialFired && !optimisticVersionKey && !cachedDelivered) {
                        try {
                            const fresh = await loadBundle({ ...options, remoteMetaOverride: null });
                            if (onUpdate) onUpdate(fresh.data, fresh.info);
                        } catch (err) {
                            if (onError) onError(err);
                        }
                    }
                    listenerInitialFired = true;
                    return;
                }

                if (isSnapshotFromCache(snap)) {
                    log(cfg, 'Meta-Snapshot aus Firestore-Cache ignoriert.');
                    return;
                }

                const remoteMeta = normalizeMeta(snap.data(), cfg.year, cfg.tournamentKey);
                writeSessionMeta(cfg, remoteMeta);

                const versionKey = `${remoteMeta.teamsVersion}_${remoteMeta.pointsVersion}_${remoteMeta.fixturesVersion}`;

                // Wenn wir den Initial-Snapshot bekommen und schon
                // optimistisch dieselben Versionen ausgeliefert haben,
                // sparen wir uns den zweiten Render.
                if (!listenerInitialFired && optimisticVersionKey && versionKey === optimisticVersionKey) {
                    listenerInitialFired = true;
                    return;
                }

                listenerInitialFired = true;

                try {
                    const fresh = await loadBundle({ ...options, remoteMetaOverride: remoteMeta });
                    if (onUpdate) onUpdate(fresh.data, fresh.info);
                } catch (err) {
                    if (onError) onError(err);
                }
            },
            (err) => {
                if (onError) onError(err);
            }
        );

        let resumeRefreshInFlight = false;
        let lastResumeRefreshAt = now();
        const resumeRefreshMinIntervalMs = typeof cfg.resumeRefreshMinIntervalMs === 'number' && cfg.resumeRefreshMinIntervalMs >= 0
            ? cfg.resumeRefreshMinIntervalMs
            : DEFAULTS.resumeRefreshMinIntervalMs;

        const refreshFromServer = async (reason) => {
            if (resumeRefreshInFlight) return;
            const ageMs = now() - lastResumeRefreshAt;
            if (ageMs < resumeRefreshMinIntervalMs) return;

            resumeRefreshInFlight = true;
            lastResumeRefreshAt = now();

            try {
                const fresh = await loadBundle({ ...options, bypassSessionMeta: true });
                if (onUpdate) {
                    onUpdate(fresh.data, { ...fresh.info, refreshReason: reason });
                }
            } catch (err) {
                if (onError) onError(err);
            } finally {
                resumeRefreshInFlight = false;
            }
        };

        const handleVisible = () => {
            if (!document.hidden) refreshFromServer('visible');
        };
        const handleOnline = () => refreshFromServer('online');
        const handleFocus = () => refreshFromServer('focus');

        document.addEventListener('visibilitychange', handleVisible);
        window.addEventListener('online', handleOnline);
        window.addEventListener('focus', handleFocus);

        return () => {
            unsubscribe();
            document.removeEventListener('visibilitychange', handleVisible);
            window.removeEventListener('online', handleOnline);
            window.removeEventListener('focus', handleFocus);
        };
    }

    async function bumpMetaVersion(options) {
        const cfg = resolveConfig(options);

        if (!window.firebase || !window.firebase.firestore || !window.firebase.firestore.FieldValue) {
            throw new Error('DreamTeamCache: firebase.firestore.FieldValue ist nicht verfügbar.');
        }

        const FieldValue = window.firebase.firestore.FieldValue;
        const payload = {
            year: cfg.year,
            tournamentKey: cfg.tournamentKey
        };

        if (options.teams) {
            payload.teamsVersion = FieldValue.increment(1);
            payload.teamsUpdatedAt = now();
        }

        if (options.points) {
            payload.pointsVersion = FieldValue.increment(1);
            payload.pointsUpdatedAt = now();
        }

        if (options.fixtures) {
            payload.fixturesVersion = FieldValue.increment(1);
            payload.fixturesUpdatedAt = now();
        }

        if (!options.teams && !options.points && !options.fixtures) {
            throw new Error('DreamTeamCache: teams, points oder fixtures muss true sein.');
        }

        // Session-Meta invalidieren – die Version stimmt jetzt nicht mehr.
        removeSession(cfg.keys.sessionMeta);

        return cfg.db.collection(cfg.metaCollection).doc(cfg.metaDocId).set(payload, { merge: true });
    }

    function clearCache(options) {
        const cfg = resolveConfig(options);
        removeStorage(cfg.keys.teams);
        removeStorage(cfg.keys.points);
        removeStorage(cfg.keys.fixtures);
        removeStorage(cfg.keys.meta);
        removeStorage(cfg.keys.lastGoodTeams);
        removeStorage(cfg.keys.lastGoodPoints);
        removeStorage(cfg.keys.lastGoodFixtures);
        removeSession(cfg.keys.sessionMeta);
    }

    window.DreamTeamCache = {
        getCachedBundle,
        loadBundle,
        bootstrap,
        subscribeToMeta,
        bumpMetaVersion,
        clearCache,
        isValidTeamsData,
        isValidPointsData,
        isValidFixturesData
    };
})(window);
