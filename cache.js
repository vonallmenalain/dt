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
        fixturesBundleCollection: 'public_cache',
        fixturesBundleDocId: 'wm2026_fixtures',
        fallbackMaxAgeMs: 10 * 60 * 1000,
        // Wie lange das zuletzt gelesene Meta-Dokument für andere Seiten
        // derselben Browser-Session als "frisch genug" gilt. In dieser
        // Zeit wird der Meta-Read in loadBundle übersprungen – der
        // Live-Listener liefert ohnehin Updates, sobald sich die
        // pointsVersion oder teamsVersion erhöht.
        sessionMetaTtlMs: 30 * 1000,
        postStartEmptyGraceMs: 4 * 60 * 60 * 1000,
        minFixtureCount: null,
        allowEmptyTeams: true,
        allowEmptyPoints: false,
        allowEmptyFixtures: true,
        log: false
    };

    function log(cfg, ...args) {
        if (cfg.log) {
            console.log('[DreamTeamCache]', ...args);
        }
    }

    function now() {
        return Date.now();
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
            return null;
        }
    }

    function writeStorage(key, value) {
        try {
            window.localStorage.setItem(key, JSON.stringify(value));
            return true;
        } catch (err) {
            return false;
        }
    }

    function removeStorage(key) {
        try {
            window.localStorage.removeItem(key);
            return true;
        } catch (err) {
            return false;
        }
    }

    function readSession(key) {
        try {
            return window.sessionStorage.getItem(key);
        } catch (err) {
            return null;
        }
    }

    function writeSession(key, value) {
        try {
            window.sessionStorage.setItem(key, JSON.stringify(value));
            return true;
        } catch (err) {
            return false;
        }
    }

    function removeSession(key) {
        try {
            window.sessionStorage.removeItem(key);
            return true;
        } catch (err) {
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

    function createEnvelope(data) {
        return {
            savedAt: now(),
            data
        };
    }

    function readEnvelope(key) {
        const raw = readStorage(key);
        if (!raw) return null;

        const parsed = safeParse(raw);
        if (!parsed || typeof parsed !== 'object') return null;

        return {
            savedAt: typeof parsed.savedAt === 'number' ? parsed.savedAt : 0,
            data: parsed.data
        };
    }

    function readSessionEnvelope(key) {
        const raw = readSession(key);
        if (!raw) return null;

        const parsed = safeParse(raw);
        if (!parsed || typeof parsed !== 'object') return null;

        return {
            savedAt: typeof parsed.savedAt === 'number' ? parsed.savedAt : 0,
            data: parsed.data
        };
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
        return true;
    }

    function normalizePointsData(points) {
        const helper = window.DreamTeamPoints;
        if (helper && typeof helper.normalizePointsMap === 'function') {
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

        cfg.fixturesCollection = cfg.fixturesCollection
            || (app && app.firestore && typeof app.firestore.fixturesCollection === 'function' ? app.firestore.fixturesCollection() : null)
            || null;

        cfg.fixturesBundleCollection = cfg.fixturesBundleCollection || DEFAULTS.fixturesBundleCollection;
        cfg.fixturesBundleDocId = cfg.fixturesBundleDocId || DEFAULTS.fixturesBundleDocId;
        cfg.fixtureCount = cfg.fixtureCount || (app && app.fixtureCount) || null;

        cfg.keys = buildKeys(cfg);

        return cfg;
    }

    function readDatasetState(kind, cfg, meta) {
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
            validator = (data) => isValidFixturesData(data, cfg.allowEmptyFixtures, cfg, meta) && !fixturesContainActiveStatus(data);
        } else {
            validator = (data) => isValidPointsData(data, cfg.allowEmptyPoints, cfg, meta);
        }

        const currentValid = current ? validator(current.data) : false;
        const backupValid = backup ? validator(backup.data) : false;

        let data = currentValid ? current.data : backupValid ? backup.data : null;
        if (kind === 'points' && data) {
            data = normalizePointsData(data);
        }

        return {
            current,
            backup,
            valid: currentValid || backupValid,
            usedBackup: !currentValid && backupValid,
            data,
            savedAt: currentValid
                ? current.savedAt
                : backupValid
                    ? backup.savedAt
                    : 0
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
        if (!meta) return;
        writeSession(cfg.keys.sessionMeta, createEnvelope(meta));
    }

    function saveTeams(teams, cfg) {
        if (!isValidTeamsData(teams, cfg.allowEmptyTeams)) return false;
        const payload = createEnvelope(teams);
        writeStorage(cfg.keys.teams, payload);
        writeStorage(cfg.keys.lastGoodTeams, payload);
        return true;
    }

    function savePoints(points, cfg, meta) {
        const normalizedPoints = normalizePointsData(points);
        if (!isValidPointsData(normalizedPoints, cfg.allowEmptyPoints, cfg, meta)) return false;
        const payload = createEnvelope(normalizedPoints);
        writeStorage(cfg.keys.points, payload);
        writeStorage(cfg.keys.lastGoodPoints, payload);
        return true;
    }

    function saveFixtures(fixtures, cfg, meta) {
        if (!isValidFixturesData(fixtures, cfg.allowEmptyFixtures, cfg, meta)) return false;
        const payload = createEnvelope(fixtures);
        writeStorage(cfg.keys.fixtures, payload);
        writeStorage(cfg.keys.lastGoodFixtures, payload);
        return true;
    }

    function saveMeta(meta, cfg) {
        const normalized = normalizeMeta(meta, cfg.year, cfg.tournamentKey);
        writeStorage(cfg.keys.meta, createEnvelope(normalized));
        // Spiegelkopie für die aktuelle Browser-Session – damit andere
        // Seiten innerhalb der nächsten Sekunden den Meta-Read sparen
        // können.
        writeSessionMeta(cfg, normalized);
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
                : ['pointsVersion', 'pointsUpdatedAt'];
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
            const snap = await cfg.db.collection(cfg.metaCollection).doc(cfg.metaDocId).get();

            if (!snap.exists) {
                log(cfg, 'Kein Meta-Dokument gefunden:', cfg.metaCollection, cfg.metaDocId);
                return null;
            }

            const normalized = normalizeMeta(snap.data(), cfg.year, cfg.tournamentKey);
            writeSessionMeta(cfg, normalized);
            return normalized;
        } catch (err) {
            log(cfg, 'Meta-Fetch fehlgeschlagen:', err);
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
        const snap = await cfg.db.collection(cfg.teamsCollection).get();
        const teams = [];
        snap.forEach((doc) => {
            teams.push(doc.data());
        });
        return teams;
    }

    async function fetchPoints(cfg) {
        const snap = await cfg.db.collection(cfg.pointsCollection).get();
        const points = {};
        snap.forEach((doc) => {
            points[doc.id] = doc.data();
        });
        return normalizePointsData(points);
    }

    async function fetchFixtureBundle(cfg, remoteMeta) {
        if (!cfg.fixturesBundleCollection || !cfg.fixturesBundleDocId) return null;

        try {
            const snap = await cfg.db.collection(cfg.fixturesBundleCollection).doc(cfg.fixturesBundleDocId).get();
            if (!snap.exists) {
                log(cfg, 'Fixture-Bundle fehlt, nutze Collection-Fallback.');
                return null;
            }

            const bundle = snap.data() || {};
            const fixtures = bundle.fixtures;
            if (!fixtures || typeof fixtures !== 'object' || Array.isArray(fixtures)) {
                log(cfg, 'Fixture-Bundle ungueltig, nutze Collection-Fallback.');
                return null;
            }

            const requiredGeneration = remoteMeta && typeof remoteMeta.fixturesCacheGeneratedAt === 'number'
                ? remoteMeta.fixturesCacheGeneratedAt
                : null;
            if (
                requiredGeneration !== null &&
                bundle.cacheGenerationMs !== requiredGeneration
            ) {
                log(cfg, 'Fixture-Bundle veraltet, nutze Collection-Fallback.');
                return null;
            }

            if (fixturesContainActiveStatus(fixtures)) {
                log(cfg, 'Fixture-Bundle enthaelt Live-Daten, nutze Collection-Fallback fuer frische Spielereignisse.');
                return null;
            }

            return fixtures;
        } catch (err) {
            log(cfg, 'Fixture-Bundle-Fetch fehlgeschlagen:', err);
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
            const snap = await cfg.db.collection(cfg.fixturesCollection).get();
            const fixtures = {};
            snap.forEach((doc) => {
                fixtures[doc.id] = doc.data();
            });
            return fixtures;
        } catch (err) {
            log(cfg, 'Fixtures-Fetch fehlgeschlagen:', err);
            return null;
        }
    }

    function getCachedBundle(options) {
        const cfg = resolveConfig(options);
        const metaState = readMetaState(cfg);
        const teamsState = readDatasetState('teams', cfg, metaState.data);
        const pointsState = readDatasetState('points', cfg, metaState.data);
        const fixturesState = readDatasetState('fixtures', cfg, metaState.data);
        const fixturesOk = !cfg.fixturesCollection || fixturesState.valid;

        return {
            ok: teamsState.valid && pointsState.valid && fixturesOk,
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
                metaSavedAt: metaState.savedAt
            }
        };
    }

    async function loadBundle(options) {
        const cfg = resolveConfig(options);
        const localMetaState = readMetaState(cfg);
        const teamsState = readDatasetState('teams', cfg, localMetaState.data);
        const pointsState = readDatasetState('points', cfg, localMetaState.data);
        const fixturesState = readDatasetState('fixtures', cfg, localMetaState.data);

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
                const freshPoints = await fetchPoints(cfg);

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
            (snap) => {
                if (!snap.exists) return;

                const remoteMeta = normalizeMeta(snap.data(), cfg.year, cfg.tournamentKey);
                writeSessionMeta(cfg, remoteMeta);

                const localMeta = readMetaState(cfg).data;

                const teamsChanged = hasChanged(remoteMeta, localMeta, 'teams');
                const pointsChanged = hasChanged(remoteMeta, localMeta, 'points');
                const fixturesChanged = !!cfg.fixturesCollection && hasChanged(remoteMeta, localMeta, 'fixtures');

                if (teamsChanged || pointsChanged || fixturesChanged) {
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
    async function bootstrap(options) {
        const cfg = resolveConfig(options);

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

        return unsubscribe;
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
