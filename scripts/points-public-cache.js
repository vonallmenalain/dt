'use strict';

const PUBLIC_POINTS_CACHE_COLLECTION = 'public_cache';
// Turnier-spezifische Public-Cache-Doc-IDs, damit z. B. die CL nicht das
// WM-Punkte-Cache-Dokument ueberschreibt (oder umgekehrt). Fuer die WM
// (tournamentKey "wm2026") ergeben sich exakt die bisherigen Namen
// (`wm2026_points_shard_XX` / `wm2026_points_delta_current`) → unveraendert.
const PUBLIC_POINTS_SHARD_DOC_PREFIX = 'wm2026_points_shard_';
const PUBLIC_POINTS_DELTA_DOC_ID = 'wm2026_points_delta_current';
const DEFAULT_PUBLIC_POINTS_SHARD_COUNT = 16;

function tournamentKeyOf(tournament) {
  return tournament && tournament.key ? String(tournament.key) : 'wm2026';
}

function getPublicPointsDeltaDocId(tournament) {
  return `${tournamentKeyOf(tournament)}_points_delta_current`;
}
const DEFAULT_PUBLIC_POINTS_DELTA_MAX_BYTES = 880 * 1024;

function isObject(value) {
  return !!value && typeof value === 'object';
}

function isPlainObject(value) {
  if (!isObject(value) || Array.isArray(value)) return false;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

function isTimestampLike(value) {
  return isObject(value) &&
    (typeof value.toDate === 'function' || typeof value.toMillis === 'function');
}

function normalizeShardCount(value) {
  const n = Number(value);
  return Number.isInteger(n) && n > 0 ? n : DEFAULT_PUBLIC_POINTS_SHARD_COUNT;
}

function getPublicPointsShardDocId(index, tournament) {
  const prefix = `${tournamentKeyOf(tournament)}_points_shard_`;
  return `${prefix}${String(index).padStart(2, '0')}`;
}

function hashPlayerId(playerId) {
  const text = String(playerId || '');
  let hash = 0;
  for (let i = 0; i < text.length; i++) {
    hash = ((hash * 31) + text.charCodeAt(i)) >>> 0;
  }
  return hash;
}

function cloneValueForCache(value, cacheGenerationMs, key = '') {
  if (value === undefined) return null;
  if (value === null || typeof value !== 'object') return value;
  if (value instanceof Date || isTimestampLike(value)) return value;
  if (Array.isArray(value)) return value.map(item => cloneValueForCache(item, cacheGenerationMs));

  if (!isPlainObject(value)) {
    return key === 'lastUpdated' ? new Date(cacheGenerationMs) : null;
  }

  const out = {};
  Object.keys(value).forEach(childKey => {
    const cloned = cloneValueForCache(value[childKey], cacheGenerationMs, childKey);
    if (cloned !== undefined) out[childKey] = cloned;
  });
  return out;
}

function clonePointDocForCache(pointDoc, cacheGenerationMs) {
  return cloneValueForCache(pointDoc || {}, cacheGenerationMs);
}

function buildPublicPointsShards(tournament, pointsMap, opts = {}) {
  const shardCount = normalizeShardCount(opts.shardCount);
  const pointsVersion = Number(opts.pointsVersion);
  const cacheGenerationMs = Number.isFinite(opts.cacheGenerationMs)
    ? opts.cacheGenerationMs
    : Date.now();
  const includePoint = typeof opts.includePoint === 'function' ? opts.includePoint : () => true;

  if (!Number.isFinite(pointsVersion)) {
    throw new Error('pointsVersion ist fuer Public-Points-Shards erforderlich.');
  }

  const shards = Array.from({ length: shardCount }, (_, index) => ({
    docId: getPublicPointsShardDocId(index, tournament),
    data: {
      kind: 'points_shard',
      tournamentKey: tournament.key,
      year: Number(tournament.year) || tournament.year,
      generatedAtMs: cacheGenerationMs,
      cacheGenerationMs,
      pointsVersion,
      shardIndex: index,
      shardCount,
      points: {}
    }
  }));

  Object.keys(pointsMap || {}).sort().forEach(playerId => {
    const pointDoc = pointsMap[playerId];
    if (!isPlainObject(pointDoc) || !includePoint(pointDoc, playerId)) return;
    const shardIndex = hashPlayerId(playerId) % shardCount;
    shards[shardIndex].data.points[String(playerId)] = clonePointDocForCache(pointDoc, cacheGenerationMs);
  });

  return shards;
}

function buildPublicPointsDelta(tournament, opts = {}) {
  const cacheGenerationMs = Number.isFinite(opts.cacheGenerationMs)
    ? opts.cacheGenerationMs
    : Date.now();
  const baseVersion = Number(opts.baseVersion);
  const nextVersion = Number(opts.nextVersion);
  const pointsVersion = Number(opts.pointsVersion);

  if (!Number.isFinite(baseVersion) || !Number.isFinite(nextVersion) || !Number.isFinite(pointsVersion)) {
    throw new Error('baseVersion, nextVersion und pointsVersion sind fuer Public-Points-Delta erforderlich.');
  }

  const set = {};
  Object.entries(opts.deltaSet || {}).forEach(([playerId, pointDoc]) => {
    if (isPlainObject(pointDoc)) {
      set[String(playerId)] = clonePointDocForCache(pointDoc, cacheGenerationMs);
    }
  });

  const deleteList = Array.from(opts.deltaDelete || [])
    .map(id => String(id))
    .filter(Boolean);

  return {
    kind: 'points_delta',
    tournamentKey: tournament.key,
    year: Number(tournament.year) || tournament.year,
    generatedAtMs: cacheGenerationMs,
    cacheGenerationMs,
    baseVersion,
    nextVersion,
    pointsVersion,
    set,
    delete: deleteList
  };
}

function getJsonByteLength(value) {
  return Buffer.byteLength(JSON.stringify(value), 'utf8');
}

async function writePublicPointsCache(db, tournament, pointsMap, opts = {}) {
  const shardCount = normalizeShardCount(opts.shardCount);
  const cacheGenerationMs = Number.isFinite(opts.cacheGenerationMs)
    ? opts.cacheGenerationMs
    : Date.now();
  const pointsVersion = Number(opts.pointsVersion);
  const maxDeltaBytes = Number.isFinite(opts.maxDeltaBytes)
    ? opts.maxDeltaBytes
    : DEFAULT_PUBLIC_POINTS_DELTA_MAX_BYTES;
  const shards = buildPublicPointsShards(tournament, pointsMap, {
    ...opts,
    shardCount,
    cacheGenerationMs,
    pointsVersion
  });

  let delta = null;
  let deltaBytes = 0;
  let deltaWritten = false;
  let deltaTooLarge = false;
  if (opts.deltaSet || opts.deltaDelete) {
    delta = buildPublicPointsDelta(tournament, {
      ...opts,
      cacheGenerationMs,
      pointsVersion
    });
    deltaBytes = getJsonByteLength(delta);
    if (deltaBytes > maxDeltaBytes) {
      deltaTooLarge = true;
      delta = null;
    } else {
      deltaWritten = true;
    }
  }

  const pointsCount = shards.reduce((sum, shard) => sum + Object.keys(shard.data.points || {}).length, 0);

  if (opts.dryRun) {
    return {
      dryRun: true,
      cacheGenerationMs,
      shardCount,
      pointsCount,
      deltaWritten,
      deltaTooLarge,
      deltaBytes,
      deltaDocId: deltaWritten ? getPublicPointsDeltaDocId(tournament) : null
    };
  }

  // Shards + Delta groessenbasiert in mehreren Commits schreiben. Bei vielen
  // Spielern (z. B. CL, 1131) ueberschreitet die Summe aller 16 Shards in
  // EINEM Batch die 10-MiB-Transaktionsgrenze ("Transaction too big").
  // Konservativ bei 8 MiB flushen; ein einzelner Shard (~1-2 MiB) bleibt
  // immer unter dem Limit.
  const MAX_CACHE_BATCH_BYTES = 8 * 1024 * 1024;
  const writes = shards.map(shard => ({
    ref: db.collection(PUBLIC_POINTS_CACHE_COLLECTION).doc(shard.docId),
    data: shard.data,
    bytes: getJsonByteLength(shard.data)
  }));
  if (delta) {
    writes.push({
      ref: db.collection(PUBLIC_POINTS_CACHE_COLLECTION).doc(getPublicPointsDeltaDocId(tournament)),
      data: delta,
      bytes: getJsonByteLength(delta)
    });
  }

  let batch = db.batch();
  let opsInBatch = 0;
  let bytesInBatch = 0;
  for (const w of writes) {
    if (opsInBatch > 0 && bytesInBatch + w.bytes > MAX_CACHE_BATCH_BYTES) {
      await batch.commit();
      batch = db.batch();
      opsInBatch = 0;
      bytesInBatch = 0;
    }
    batch.set(w.ref, w.data);
    opsInBatch++;
    bytesInBatch += w.bytes;
  }
  if (opsInBatch > 0) {
    await batch.commit();
  }

  return {
    dryRun: false,
    cacheGenerationMs,
    shardCount,
    pointsCount,
    deltaWritten,
    deltaTooLarge,
    deltaBytes,
    deltaDocId: deltaWritten ? getPublicPointsDeltaDocId(tournament) : null
  };
}

function isMetaCompatible(meta) {
  return meta &&
    Number.isFinite(meta.pointsCacheGeneratedAt) &&
    Number.isInteger(meta.pointsShardCount) &&
    meta.pointsShardCount > 0 &&
    Number.isFinite(meta.pointsVersion);
}

function validateShardData(shard, tournament, meta, index) {
  if (!isPlainObject(shard)) return false;
  if (shard.kind !== 'points_shard') return false;
  if (shard.tournamentKey !== tournament.key) return false;
  if (String(shard.year) !== String(tournament.year)) return false;
  if (shard.cacheGenerationMs !== meta.pointsCacheGeneratedAt) return false;
  if (shard.pointsVersion !== meta.pointsVersion) return false;
  if (shard.shardIndex !== index) return false;
  if (shard.shardCount !== meta.pointsShardCount) return false;
  if (!isPlainObject(shard.points)) return false;
  return true;
}

async function readPublicPointsShards(db, tournament, meta) {
  if (!isMetaCompatible(meta)) {
    return { ok: false, reason: 'meta_incompatible', points: null };
  }

  const snaps = await Promise.all(
    Array.from({ length: meta.pointsShardCount }, (_, index) => (
      db
        .collection(PUBLIC_POINTS_CACHE_COLLECTION)
        .doc(getPublicPointsShardDocId(index, tournament))
        .get()
    ))
  );

  const points = {};
  for (let index = 0; index < snaps.length; index++) {
    const snap = snaps[index];
    if (!snap.exists) {
      return { ok: false, reason: `missing_shard_${index}`, points: null };
    }
    const shard = snap.data() || {};
    if (!validateShardData(shard, tournament, meta, index)) {
      return { ok: false, reason: `invalid_shard_${index}`, points: null };
    }
    Object.assign(points, shard.points || {});
  }

  return {
    ok: true,
    reason: null,
    points,
    shardCount: meta.pointsShardCount,
    cacheGenerationMs: meta.pointsCacheGeneratedAt,
    pointsVersion: meta.pointsVersion
  };
}

module.exports = {
  DEFAULT_PUBLIC_POINTS_SHARD_COUNT,
  PUBLIC_POINTS_CACHE_COLLECTION,
  getPublicPointsShardDocId,
  getPublicPointsDeltaDocId,
  PUBLIC_POINTS_DELTA_DOC_ID,
  buildPublicPointsShards,
  writePublicPointsCache,
  readPublicPointsShards
};
