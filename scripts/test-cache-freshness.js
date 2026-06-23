const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const CACHE_SOURCE = fs.readFileSync(path.join(__dirname, '..', 'cache.js'), 'utf8');
const BASE = 'dreamteam_wm2026';
const MARKER = 'dreamteam_cache_schema_v2_applied';

function clone(value) {
  return value == null ? value : JSON.parse(JSON.stringify(value));
}

function createStorage(options = {}) {
  const map = new Map(Object.entries(options.initial || {}));
  const throwOnSet = options.throwOnSet || (() => false);
  return {
    getItem(key) {
      return map.has(key) ? map.get(key) : null;
    },
    setItem(key, value) {
      if (throwOnSet(key, value)) {
        const err = new Error('QuotaExceededError');
        err.name = 'QuotaExceededError';
        throw err;
      }
      map.set(key, String(value));
    },
    removeItem(key) {
      map.delete(key);
    },
    key(index) {
      return Array.from(map.keys())[index] || null;
    },
    get length() {
      return map.size;
    },
    dump() {
      return Object.fromEntries(map.entries());
    }
  };
}

function envelope(data, meta) {
  return JSON.stringify({
    schemaVersion: 2,
    savedAt: Date.now(),
    data,
    meta
  });
}

function v1Envelope(data) {
  return JSON.stringify({
    savedAt: Date.now(),
    data
  });
}

function metaEnvelope(meta) {
  return envelope(meta, meta);
}

function makeWindow(localStorage) {
  const windowObj = {
    localStorage,
    sessionStorage: createStorage(),
    console,
    Date,
    Promise,
    setTimeout,
    clearTimeout,
    location: { origin: 'https://example.test', hostname: 'example.test' },
    APP_CONFIG: {
      year: '2026',
      key: 'wm2026',
      fixtureCount: { minPublished: 0, expectedFinal: 0 },
      storage: {
        appPrefix() {
          return BASE;
        }
      },
      firestore: {
        metaCollection: 'app_meta',
        metaDocId() {
          return 'turnier_wm2026';
        },
        teamsCollection() {
          return 'Teams WM 2026';
        },
        pointsCollection() {
          return 'Punkte Spieler WM 2026';
        },
        fixturesCollection() {
          return 'Spiele WM 2026';
        }
      }
    }
  };
  const context = {
    window: windowObj,
    console,
    Date,
    Promise,
    setTimeout,
    clearTimeout
  };
  vm.runInNewContext(CACHE_SOURCE, context, { filename: 'cache.js' });
  return windowObj;
}

function docSnap(data) {
  return {
    exists: data !== undefined && data !== null,
    data: () => clone(data),
    metadata: { fromCache: false }
  };
}

function collectionSnap(map) {
  const docs = Object.entries(map || {});
  return {
    forEach(callback) {
      docs.forEach(([id, data]) => callback({ id, data: () => clone(data) }));
    }
  };
}

function delay(ms) {
  return ms > 0 ? new Promise((resolve) => setTimeout(resolve, ms)) : Promise.resolve();
}

function makeDb(state = {}) {
  const reads = { docs: {}, collections: {} };
  const collections = state.collections || {};
  const docs = state.docs || {};
  const failures = state.failures || {};
  const delays = state.delays || {};

  function docKey(collection, id) {
    return `${collection}/${id}`;
  }

  return {
    reads,
    collection(name) {
      return {
        doc(id) {
          return {
            async get() {
              const key = docKey(name, id);
              reads.docs[key] = (reads.docs[key] || 0) + 1;
              if (failures.docs && failures.docs[key]) throw failures.docs[key];
              await delay(delays.docs && delays.docs[key]);
              return docSnap(docs[key]);
            }
          };
        },
        async get() {
          reads.collections[name] = (reads.collections[name] || 0) + 1;
          if (failures.collections && failures.collections[name]) throw failures.collections[name];
          await delay(delays.collections && delays.collections[name]);
          return collectionSnap(collections[name]);
        }
      };
    }
  };
}

const meta10 = {
  year: '2026',
  tournamentKey: 'wm2026',
  teamsVersion: 1,
  pointsVersion: 10,
  fixturesVersion: 10,
  teamsUpdatedAt: 1,
  pointsUpdatedAt: 10,
  fixturesUpdatedAt: 10,
  pointsCacheGeneratedAt: 100,
  pointsShardCount: null,
  fixturesCacheGeneratedAt: 200
};

const validTeams = [{ manager: 'Ada', players: [] }];
const points9 = { p1: { totalPoints: 9 } };
const points10 = { p1: { totalPoints: 10 } };
const fixtures9 = { f1: { id: 'f1', statusShort: 'FT', source: 'old' } };
const fixtures10 = { f1: { id: 'f1', statusShort: 'FT', source: 'collection' } };

function baseOptions(windowObj, db, extra = {}) {
  return {
    db,
    year: '2026',
    allowEmptyPoints: false,
    allowEmptyFixtures: true,
    ...extra
  };
}

function storageWithMarker(initial = {}, options = {}) {
  return createStorage({
    ...options,
    initial: {
      [MARKER]: JSON.stringify({ schemaVersion: 2 }),
      ...initial
    }
  });
}

async function testFixtureEnvelopeMismatchRefreshesServer() {
  const localStorage = storageWithMarker({
    [`${BASE}_meta`]: metaEnvelope(meta10),
    [`${BASE}_teams`]: envelope(validTeams, meta10),
    [`${BASE}_points`]: envelope(points10, meta10),
    [`${BASE}_fixtures`]: envelope(fixtures9, { ...meta10, fixturesVersion: 9, fixturesCacheGeneratedAt: 199 })
  });
  const windowObj = makeWindow(localStorage);
  const db = makeDb({
    docs: { 'app_meta/turnier_wm2026': meta10 },
    collections: { 'Spiele WM 2026': fixtures10 }
  });

  const result = await windowObj.DreamTeamCache.loadBundle(baseOptions(windowObj, db));
  assert.equal(result.data.fixtures.f1.source, 'collection');
  assert.equal(db.reads.collections['Spiele WM 2026'], 1);
}

async function testFixtureWriteQuotaDoesNotSaveMeta() {
  const localStorage = storageWithMarker({}, {
    throwOnSet: (key) => key === `${BASE}_fixtures`
  });
  const windowObj = makeWindow(localStorage);
  const db = makeDb({
    docs: { 'app_meta/turnier_wm2026': meta10 },
    collections: {
      'Teams WM 2026': { t1: validTeams[0] },
      'Punkte Spieler WM 2026': points10,
      'Spiele WM 2026': fixtures10
    }
  });

  const result = await windowObj.DreamTeamCache.loadBundle(baseOptions(windowObj, db));
  assert.equal(result.info.storageOk, false);
  assert.equal(result.data.fixtures.f1.source, 'collection');
  assert.equal(localStorage.getItem(`${BASE}_meta`), null);
}

async function testEqualMetaWithMissingEnvelopeStillRefreshes() {
  const localStorage = storageWithMarker({
    [`${BASE}_meta`]: metaEnvelope(meta10),
    [`${BASE}_teams`]: envelope(validTeams, meta10),
    [`${BASE}_points`]: v1Envelope(points9),
    [`${BASE}_fixtures`]: envelope(fixtures10, meta10)
  });
  const windowObj = makeWindow(localStorage);
  const db = makeDb({
    docs: { 'app_meta/turnier_wm2026': meta10 },
    collections: { 'Punkte Spieler WM 2026': points10 }
  });

  const result = await windowObj.DreamTeamCache.loadBundle(baseOptions(windowObj, db));
  assert.equal(result.data.points.p1.totalPoints, 10);
  assert.equal(db.reads.collections['Punkte Spieler WM 2026'], 1);
}

async function testBadFixtureBundleFallsBackToCollection() {
  const localStorage = storageWithMarker({
    [`${BASE}_teams`]: envelope(validTeams, meta10),
    [`${BASE}_points`]: envelope(points10, meta10)
  });
  const windowObj = makeWindow(localStorage);
  const db = makeDb({
    docs: {
      'app_meta/turnier_wm2026': meta10,
      'public_cache/wm2026_fixtures': {
        kind: 'fixtures_bundle',
        tournamentKey: 'wm2026',
        year: '2026',
        cacheGenerationMs: 199,
        fixtures: { f1: { id: 'f1', source: 'bad-bundle' } }
      }
    },
    collections: { 'Spiele WM 2026': fixtures10 }
  });

  const result = await windowObj.DreamTeamCache.loadBundle(baseOptions(windowObj, db));
  assert.equal(result.data.fixtures.f1.source, 'collection');
  assert.equal(db.reads.collections['Spiele WM 2026'], 1);
}

async function testOlderParallelRefreshDoesNotOverwriteNewer() {
  const localStorage = storageWithMarker({});
  const windowObj = makeWindow(localStorage);
  const meta12 = { ...meta10, pointsVersion: 12, pointsUpdatedAt: 12, pointsCacheGeneratedAt: 120 };
  const meta13 = { ...meta10, pointsVersion: 13, pointsUpdatedAt: 13, pointsCacheGeneratedAt: 130 };
  const db12 = makeDb({
    delays: { collections: { 'Punkte Spieler WM 2026': 25, 'Teams WM 2026': 25, 'Spiele WM 2026': 25 } },
    collections: {
      'Teams WM 2026': { t1: validTeams[0] },
      'Punkte Spieler WM 2026': { p1: { totalPoints: 12 } },
      'Spiele WM 2026': fixtures10
    }
  });
  const db13 = makeDb({
    collections: {
      'Teams WM 2026': { t1: validTeams[0] },
      'Punkte Spieler WM 2026': { p1: { totalPoints: 13 } },
      'Spiele WM 2026': fixtures10
    }
  });

  const older = windowObj.DreamTeamCache.loadBundle(baseOptions(windowObj, db12, { remoteMetaOverride: meta12 }));
  const newer = windowObj.DreamTeamCache.loadBundle(baseOptions(windowObj, db13, { remoteMetaOverride: meta13 }));
  const [olderResult, newerResult] = await Promise.all([older, newer]);
  assert.equal(newerResult.data.points.p1.totalPoints, 13);
  assert.equal(olderResult.info.ignoredOlderRefresh, true);

  const storedPoints = JSON.parse(localStorage.getItem(`${BASE}_points`));
  assert.equal(storedPoints.meta.pointsVersion, 13);
  assert.equal(storedPoints.data.p1.totalPoints, 13);
}

async function testOfflineOldCacheIsStaleOnly() {
  const localStorage = storageWithMarker({
    [`${BASE}_meta`]: metaEnvelope(meta10),
    [`${BASE}_teams`]: v1Envelope(validTeams),
    [`${BASE}_points`]: v1Envelope(points9),
    [`${BASE}_fixtures`]: v1Envelope(fixtures9)
  });
  const windowObj = makeWindow(localStorage);
  const db = makeDb({
    failures: { docs: { 'app_meta/turnier_wm2026': new Error('offline') } }
  });

  const result = await windowObj.DreamTeamCache.loadBundle(baseOptions(windowObj, db));
  assert.equal(result.info.stale, true);
  assert.equal(result.info.offlineFallback, true);
  assert.equal(result.info.verifiedFromServer, false);
  assert.equal(result.data.points.p1.totalPoints, 9);
}

const tests = [
  ['fixture envelope mismatch refreshes server', testFixtureEnvelopeMismatchRefreshesServer],
  ['fixture quota failure does not save meta', testFixtureWriteQuotaDoesNotSaveMeta],
  ['equal meta with missing envelope still refreshes', testEqualMetaWithMissingEnvelopeStillRefreshes],
  ['bad fixture bundle falls back to collection', testBadFixtureBundleFallsBackToCollection],
  ['older parallel refresh does not overwrite newer', testOlderParallelRefreshDoesNotOverwriteNewer],
  ['offline old cache is stale only', testOfflineOldCacheIsStaleOnly]
];

(async () => {
  for (const [name, fn] of tests) {
    await fn();
    console.log(`ok - ${name}`);
  }
})().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
