'use strict';

const PUBLIC_FIXTURE_CACHE_COLLECTION = 'public_cache';
const PUBLIC_FIXTURE_CACHE_DOC_ID = 'wm2026_fixtures';

function isObject(value) {
  return !!value && typeof value === 'object';
}

function cloneValueForBundle(value) {
  if (value === undefined) return null;
  if (value === null || typeof value !== 'object') return value;
  if (value instanceof Date) return value;
  if (typeof value.toDate === 'function' || typeof value.toMillis === 'function') return value;
  if (Array.isArray(value)) return value.map(cloneValueForBundle);

  const out = {};
  Object.keys(value).forEach(key => {
    const cloned = cloneValueForBundle(value[key]);
    if (cloned !== undefined) out[key] = cloned;
  });
  return out;
}

function cloneFixtureDataForBundle(data, cacheGenerationMs) {
  const cloned = cloneValueForBundle(data || {});
  if (isObject(cloned) && Object.prototype.hasOwnProperty.call(data || {}, 'updatedAt')) {
    cloned.updatedAt = new Date(cacheGenerationMs);
  }
  return cloned;
}

function buildFixturesMapFromDocuments(fixtureDocuments, cacheGenerationMs) {
  const fixtures = {};
  (fixtureDocuments || []).forEach(entry => {
    if (!entry || entry.id == null) return;
    fixtures[String(entry.id)] = cloneFixtureDataForBundle(entry.data, cacheGenerationMs);
  });
  return fixtures;
}

function buildFixturesMapFromPlanCache(fixturePlanCache, cacheGenerationMs) {
  const fixtures = {};
  const all = fixturePlanCache && Array.isArray(fixturePlanCache.all)
    ? fixturePlanCache.all
    : [];
  all.forEach(entry => {
    if (!entry) return;
    const id = entry.docId != null ? entry.docId : entry.id;
    if (id == null) return;
    fixtures[String(id)] = cloneFixtureDataForBundle(entry.data, cacheGenerationMs);
  });
  return fixtures;
}

function buildPublicFixtureBundle(tournament, fixtures, source, cacheGenerationMs) {
  return {
    kind: 'fixtures_bundle',
    tournamentKey: tournament.key,
    year: Number(tournament.year) || tournament.year,
    generatedAtMs: cacheGenerationMs,
    cacheGenerationMs,
    source,
    fixtures: fixtures || {}
  };
}

async function writePublicFixtureBundle(db, tournament, fixtures, source, opts = {}, cacheGenerationMs = Date.now()) {
  const bundle = buildPublicFixtureBundle(tournament, fixtures, source, cacheGenerationMs);
  const fixturesCount = Object.keys(bundle.fixtures || {}).length;

  if (opts.dryRun) {
    return { dryRun: true, cacheGenerationMs, fixturesCount };
  }

  await db
    .collection(PUBLIC_FIXTURE_CACHE_COLLECTION)
    .doc(PUBLIC_FIXTURE_CACHE_DOC_ID)
    .set(bundle);

  return { dryRun: false, cacheGenerationMs, fixturesCount };
}

module.exports = {
  PUBLIC_FIXTURE_CACHE_COLLECTION,
  PUBLIC_FIXTURE_CACHE_DOC_ID,
  buildFixturesMapFromDocuments,
  buildFixturesMapFromPlanCache,
  buildPublicFixtureBundle,
  writePublicFixtureBundle
};
