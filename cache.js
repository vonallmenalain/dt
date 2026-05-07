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
        fallbackMaxAgeMs: 10 * 60 * 1000,
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

    function buildKeys(identifier, prefix) {
        const base = `${prefix}_${identifier}`;
        return {
            teams: `${base}_teams`,
            points: `${base}_points`,
            fixtures: `${base}_fixtures`,
            meta: `${base}_meta`,
            lastGoodTeams: `${base}_last_good_teams`,
            lastGoodPoints: `${base}_last_good_points`,
            lastGoodFixtures: `${base}_last_good_fixtures`
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

    function isValidPointsData(points, allowEmptyPoints) {
        if (!points || typeof points !== 'object' || Array.isArray(points)) return false;
        const count = Object.keys(points).length;
        return allowEmptyPoints ? count >= 0 : count > 0;
    }

    function isValidFixturesData(fixtures, allowEmptyFixtures) {
        if (!fixtures || typeof fixtures !== 'object' || Array.isArray(fixtures)) return false;
        const count = Object.keys(fixtures).length;
        return allowEmptyFixtures ? count >= 0 : count > 0;
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

        cfg.keys = buildKeys(cfg.tournamentKey, cfg.prefix);

        return cfg;
    }

    function readDatasetState(kind, cfg) {
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
            validator = (data) => isValidFixturesData(data, cfg.allowEmptyFixtures);
        } else {
            validator = (data) => isValidPointsData(data, cfg.allowEmptyPoints);
        }

        const currentValid = current ? validator(current.data) : false;
        const backupValid = backup ? validator(backup.data) : false;

        return {
            current,
            backup,
            valid: currentValid || backupValid,
            usedBackup: !currentValid && backupValid,
            data: currentValid ? current.data : backupValid ? backup.data : null,
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

    function saveTeams(teams, cfg) {
        if (!isValidTeamsData(teams, cfg.allowEmptyTeams)) return false;
        const payload = createEnvelope(teams);
        writeStorage(cfg.keys.teams, payload);
        writeStorage(cfg.keys.lastGoodTeams, payload);
        return true;
    }

    function savePoints(points, cfg) {
        if (!isValidPointsData(points, cfg.allowEmptyPoints)) return false;
        const payload = createEnvelope(points);
        writeStorage(cfg.keys.points, payload);
        writeStorage(cfg.keys.lastGoodPoints, payload);
        return true;
    }

    function saveFixtures(fixtures, cfg) {
        if (!isValidFixturesData(fixtures, cfg.allowEmptyFixtures)) return false;
        const payload = createEnvelope(fixtures);
        writeStorage(cfg.keys.fixtures, payload);
        writeStorage(cfg.keys.lastGoodFixtures, payload);
        return true;
    }

    function saveMeta(meta, cfg) {
        const normalized = normalizeMeta(meta, cfg.year, cfg.tournamentKey);
        writeStorage(cfg.keys.meta, createEnvelope(normalized));
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

    async function fetchMeta(cfg) {
        try {
            const snap = await cfg.db.collection(cfg.metaCollection).doc(cfg.metaDocId).get();

            if (!snap.exists) {
                log(cfg, 'Kein Meta-Dokument gefunden:', cfg.metaCollection, cfg.metaDocId);
                return null;
            }

            return normalizeMeta(snap.data(), cfg.year, cfg.tournamentKey);
        } catch (err) {
            log(cfg, 'Meta-Fetch fehlgeschlagen:', err);
            return null;
        }
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
        return points;
    }

    async function fetchFixtures(cfg) {
        if (!cfg.fixturesCollection) return {};
        try {
            const snap = await cfg.db.collection(cfg.fixturesCollection).get();
            const fixtures = {};
            snap.forEach((doc) => {
                fixtures[doc.id] = doc.data();
            });
            return fixtures;
        } catch (err) {
            log(cfg, 'Fixtures-Fetch fehlgeschlagen:', err);
            return {};
        }
    }

    function getCachedBundle(options) {
        const cfg = resolveConfig(options);
        const teamsState = readDatasetState('teams', cfg);
        const pointsState = readDatasetState('points', cfg);
        const fixturesState = readDatasetState('fixtures', cfg);
        const metaState = readMetaState(cfg);

        return {
            ok: teamsState.valid && pointsState.valid,
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
        const teamsState = readDatasetState('teams', cfg);
        const pointsState = readDatasetState('points', cfg);
        const fixturesState = readDatasetState('fixtures', cfg);
        const localMetaState = readMetaState(cfg);

        let teams = teamsState.data;
        let points = pointsState.data;
        let fixtures = fixturesState.data;
        let needTeams = !teamsState.valid;
        let needPoints = !pointsState.valid;
        let needFixtures = !fixturesState.valid && !!cfg.fixturesCollection;

        const remoteMeta = options && options.remoteMetaOverride
            ? normalizeMeta(options.remoteMetaOverride, cfg.year, cfg.tournamentKey)
            : await fetchMeta(cfg);

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

                if (isValidPointsData(freshPoints, cfg.allowEmptyPoints)) {
                    points = freshPoints;
                    savePoints(freshPoints, cfg);
                    refreshedPoints = true;
                    usedBackupPoints = false;
                } else {
                    log(cfg, 'Punkte-Fetch war ungültig, nutze last good cache.');
                    const backup = pointsState.backup && isValidPointsData(pointsState.backup.data, cfg.allowEmptyPoints)
                        ? pointsState.backup.data
                        : null;

                    if (backup) {
                        points = backup;
                        usedBackupPoints = true;
                    }
                }
            } catch (err) {
                log(cfg, 'Punkte-Fetch fehlgeschlagen:', err);
                const backup = pointsState.backup && isValidPointsData(pointsState.backup.data, cfg.allowEmptyPoints)
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
                const freshFixtures = await fetchFixtures(cfg);

                if (isValidFixturesData(freshFixtures, cfg.allowEmptyFixtures)) {
                    fixtures = freshFixtures;
                    saveFixtures(freshFixtures, cfg);
                    refreshedFixtures = true;
                    usedBackupFixtures = false;
                } else {
                    log(cfg, 'Fixtures-Fetch war ungültig, nutze last good cache.');
                    const backup = fixturesState.backup && isValidFixturesData(fixturesState.backup.data, cfg.allowEmptyFixtures)
                        ? fixturesState.backup.data
                        : null;

                    if (backup) {
                        fixtures = backup;
                        usedBackupFixtures = true;
                    }
                }
            } catch (err) {
                log(cfg, 'Fixtures-Fetch fehlgeschlagen:', err);
                const backup = fixturesState.backup && isValidFixturesData(fixturesState.backup.data, cfg.allowEmptyFixtures)
                    ? fixturesState.backup.data
                    : null;

                if (backup) {
                    fixtures = backup;
                    usedBackupFixtures = true;
                }
            }
        }

        const finalMeta = remoteMeta || localMetaState.data;

        if (remoteMeta) {
            saveMeta(remoteMeta, cfg);
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

        if (!isValidPointsData(points, cfg.allowEmptyPoints)) {
            if (cfg.allowEmptyPoints) {
                points = {};
            } else {
                throw new Error('DreamTeamCache: Keine gültigen Punktedaten verfügbar.');
            }
        }

        if (Object.keys(points || {}).length === 0 && !cfg.allowEmptyPoints) {
            console.warn('Punkte-Daten leer geladen – Collection/Cache/Firestore prüfen');
        }

        console.info('[DreamTeamDebug]', {
            origin: window.location.origin,
            tournamentKey: cfg.tournamentKey,
            teamsCollection: cfg.teamsCollection,
            pointsCollection: cfg.pointsCollection,
            teamsCount: Array.isArray(teams) ? teams.length : 0,
            pointsCount: Object.keys(points || {}).length,
            serviceWorkerCacheVersion: 'dreamteam-pwa-v2026-05-07-wm2026-default'
        });

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
                const localMeta = readMetaState(cfg).data;

                const teamsChanged = hasChanged(remoteMeta, localMeta, 'teams');
                const pointsChanged = hasChanged(remoteMeta, localMeta, 'points');

                if (teamsChanged || pointsChanged) {
                    options.onChange({
                        remoteMeta,
                        teamsChanged,
                        pointsChanged
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

        if (!options.teams && !options.points) {
            throw new Error('DreamTeamCache: teams oder points muss true sein.');
        }

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
    }

    window.DreamTeamCache = {
        getCachedBundle,
        loadBundle,
        subscribeToMeta,
        bumpMetaVersion,
        clearCache,
        isValidTeamsData,
        isValidPointsData,
        isValidFixturesData
    };
})(window);