import { getCacheDatabase } from "./analysis-cache.ts";

type ReferenceCacheRow = {
  payload_json: string;
  provider: string;
  source_version: string;
  fetched_at: string;
  fresh_until: string;
};

export type CachedReference<T> = {
  data: T;
  provider: string;
  fetchedAt: string;
  freshUntil: string;
  isFresh: boolean;
};

export async function readReferenceCache<T>(cacheKey: string, sourceVersion: string): Promise<CachedReference<T> | null> {
  const db = await getCacheDatabase();
  if (!db) return null;
  const row = await db.prepare(`
    SELECT payload_json, provider, source_version, fetched_at, fresh_until
    FROM reference_data_cache WHERE cache_key = ? LIMIT 1
  `).bind(cacheKey).first<ReferenceCacheRow>();
  if (!row || row.source_version !== sourceVersion) return null;
  try {
    return {
      data: JSON.parse(row.payload_json) as T,
      provider: row.provider,
      fetchedAt: row.fetched_at,
      freshUntil: row.fresh_until,
      isFresh: Date.parse(row.fresh_until) > Date.now(),
    };
  } catch {
    return null;
  }
}

export async function writeReferenceCache<T>(
  cacheKey: string,
  data: T,
  sourceVersion: string,
  provider: string,
  ttlMs: number,
) {
  const db = await getCacheDatabase();
  if (!db) return;
  const now = new Date();
  const freshUntil = new Date(now.getTime() + ttlMs).toISOString();
  await db.prepare(`
    INSERT INTO reference_data_cache (
      cache_key, payload_json, provider, source_version, fetched_at, fresh_until, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(cache_key) DO UPDATE SET
      payload_json=excluded.payload_json, provider=excluded.provider,
      source_version=excluded.source_version, fetched_at=excluded.fetched_at,
      fresh_until=excluded.fresh_until, updated_at=excluded.updated_at
  `).bind(
    cacheKey,
    JSON.stringify(data),
    provider,
    sourceVersion,
    now.toISOString(),
    freshUntil,
    now.toISOString(),
  ).run();
}
