import type { Analysis } from "@/lib/types";

const CACHE_SCHEMA_VERSION = 1;
const CACHE_TTL_MS = 15 * 60 * 1000;
const REFRESH_LEASE_MS = 2 * 60 * 1000;

type D1Result = {
  success?: boolean;
  meta?: { changes?: number };
};

type D1PreparedStatement = {
  bind(...values: unknown[]): D1PreparedStatement;
  first<T = Record<string, unknown>>(): Promise<T | null>;
  run(): Promise<D1Result>;
};

type D1Database = {
  prepare(query: string): D1PreparedStatement;
  batch(statements: D1PreparedStatement[]): Promise<D1Result[]>;
};

let schemaReady = false;

const CACHE_SCHEMA_SQL = [
  `CREATE TABLE IF NOT EXISTS companies (
    id TEXT PRIMARY KEY NOT NULL,
    cik TEXT NOT NULL,
    name TEXT NOT NULL,
    sector TEXT,
    industry TEXT,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at TEXT DEFAULT CURRENT_TIMESTAMP NOT NULL
  )`,
  `CREATE UNIQUE INDEX IF NOT EXISTS idx_companies_cik ON companies (cik)`,
  `CREATE TABLE IF NOT EXISTS listings (
    id TEXT PRIMARY KEY NOT NULL,
    company_id TEXT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
    ticker TEXT NOT NULL,
    exchange TEXT,
    is_primary INTEGER DEFAULT 1 NOT NULL,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at TEXT DEFAULT CURRENT_TIMESTAMP NOT NULL
  )`,
  `CREATE UNIQUE INDEX IF NOT EXISTS idx_listings_exchange_ticker ON listings (exchange, ticker)`,
  `CREATE INDEX IF NOT EXISTS idx_listings_ticker ON listings (ticker)`,
  `CREATE INDEX IF NOT EXISTS idx_listings_company_id ON listings (company_id)`,
  `CREATE TABLE IF NOT EXISTS normalized_financial_cache (
    company_id TEXT PRIMARY KEY NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
    annual_json TEXT NOT NULL,
    quarterly_json TEXT NOT NULL,
    filings_json TEXT NOT NULL,
    latest_json TEXT NOT NULL,
    provenance_json TEXT NOT NULL,
    normalization_version TEXT NOT NULL,
    normalized_at TEXT NOT NULL,
    updated_at TEXT DEFAULT CURRENT_TIMESTAMP NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS analysis_cache (
    listing_id TEXT PRIMARY KEY NOT NULL REFERENCES listings(id) ON DELETE CASCADE,
    payload_json TEXT NOT NULL,
    schema_version INTEGER DEFAULT 1 NOT NULL,
    generated_at TEXT NOT NULL,
    fresh_until TEXT NOT NULL,
    refresh_started_at TEXT,
    last_refresh_error TEXT,
    updated_at TEXT DEFAULT CURRENT_TIMESTAMP NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS idx_analysis_cache_fresh_until ON analysis_cache (fresh_until)`,
  `PRAGMA optimize`,
];

type CacheRow = {
  listing_id: string;
  payload_json: string;
  generated_at: string;
  fresh_until: string;
};

export type CachedAnalysis = {
  analysis: Analysis;
  listingId: string;
  generatedAt: string;
  freshUntil: string;
  isFresh: boolean;
};

async function workersRuntime() {
  try {
    return await import("cloudflare:workers") as unknown as {
      env?: { DB?: D1Database };
      waitUntil?: (promise: Promise<unknown>) => void;
    };
  } catch {
    return null;
  }
}

async function getDatabase() {
  const db = (await workersRuntime())?.env?.DB ?? null;
  if (db && !schemaReady) {
    await db.batch(CACHE_SCHEMA_SQL.map((statement) => db.prepare(statement)));
    schemaReady = true;
  }
  return db;
}

function identifierToken(value: string | null | undefined) {
  return (value ?? "unknown")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "") || "unknown";
}

function listingMarket(exchange: string | null) {
  const normalized = (exchange ?? "").trim().toUpperCase();
  const micByExchange: Record<string, string> = {
    NASDAQ: "xnas",
    NYSE: "xnys",
    "NYSE AMERICAN": "xase",
    "NYSE ARCA": "arcx",
    CBOE: "bats",
    OTC: "otcm",
  };
  return micByExchange[normalized] ?? identifierToken(exchange);
}

function cacheIdentity(analysis: Analysis) {
  const cik = analysis.company.cik.padStart(10, "0");
  const companyId = `sec-cik:${cik}`;
  const listingId = `listing:${listingMarket(analysis.company.exchange)}:${identifierToken(analysis.company.ticker)}`;
  return { cik, companyId, listingId };
}

export function parseCachedAnalysisRow(row: CacheRow, now = Date.now()): CachedAnalysis | null {
  try {
    const analysis = JSON.parse(row.payload_json) as Analysis;
    if (!analysis?.company?.ticker || !Array.isArray(analysis.financials)) return null;
    return {
      analysis,
      listingId: row.listing_id,
      generatedAt: row.generated_at,
      freshUntil: row.fresh_until,
      isFresh: Date.parse(row.fresh_until) > now,
    };
  } catch {
    return null;
  }
}

export async function readCachedAnalysis(ticker: string): Promise<CachedAnalysis | null> {
  const db = await getDatabase();
  if (!db) return null;
  const row = await db.prepare(`
    SELECT ac.listing_id, ac.payload_json, ac.generated_at, ac.fresh_until
    FROM analysis_cache ac
    INNER JOIN listings l ON l.id = ac.listing_id
    WHERE l.ticker = ? COLLATE NOCASE
    ORDER BY l.is_primary DESC, ac.updated_at DESC
    LIMIT 1
  `).bind(ticker.trim().toUpperCase()).first<CacheRow>();
  return row ? parseCachedAnalysisRow(row) : null;
}

export async function writeCachedAnalysis(analysis: Analysis, now = new Date()): Promise<boolean> {
  const db = await getDatabase();
  if (!db) return false;
  const { cik, companyId, listingId } = cacheIdentity(analysis);
  const generatedAt = analysis.provenance.generated_at || now.toISOString();
  const freshUntil = new Date(now.getTime() + CACHE_TTL_MS).toISOString();
  const updatedAt = now.toISOString();
  const financialProvenance = {
    financials: analysis.provenance.financials,
    quarterly_financials: analysis.provenance.quarterly_financials,
    methodology_version: analysis.provenance.methodology_version,
  };

  await db.batch([
    db.prepare(`
      INSERT INTO companies (id, cik, name, sector, industry, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        cik = excluded.cik,
        name = excluded.name,
        sector = excluded.sector,
        industry = excluded.industry,
        updated_at = excluded.updated_at
    `).bind(companyId, cik, analysis.company.name, analysis.company.sector, analysis.company.industry, updatedAt, updatedAt),
    db.prepare(`
      INSERT INTO listings (id, company_id, ticker, exchange, is_primary, created_at, updated_at)
      VALUES (?, ?, ?, ?, 1, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        company_id = excluded.company_id,
        ticker = excluded.ticker,
        exchange = excluded.exchange,
        is_primary = excluded.is_primary,
        updated_at = excluded.updated_at
    `).bind(listingId, companyId, analysis.company.ticker, analysis.company.exchange, updatedAt, updatedAt),
    db.prepare(`
      INSERT INTO normalized_financial_cache (
        company_id, annual_json, quarterly_json, filings_json, latest_json,
        provenance_json, normalization_version, normalized_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(company_id) DO UPDATE SET
        annual_json = excluded.annual_json,
        quarterly_json = excluded.quarterly_json,
        filings_json = excluded.filings_json,
        latest_json = excluded.latest_json,
        provenance_json = excluded.provenance_json,
        normalization_version = excluded.normalization_version,
        normalized_at = excluded.normalized_at,
        updated_at = excluded.updated_at
    `).bind(
      companyId,
      JSON.stringify(analysis.financials),
      JSON.stringify(analysis.quarterly_financials),
      JSON.stringify(analysis.filings),
      JSON.stringify(analysis.latest),
      JSON.stringify(financialProvenance),
      analysis.provenance.methodology_version,
      generatedAt,
      updatedAt,
    ),
    db.prepare(`
      INSERT INTO analysis_cache (
        listing_id, payload_json, schema_version, generated_at, fresh_until,
        refresh_started_at, last_refresh_error, updated_at
      ) VALUES (?, ?, ?, ?, ?, NULL, NULL, ?)
      ON CONFLICT(listing_id) DO UPDATE SET
        payload_json = excluded.payload_json,
        schema_version = excluded.schema_version,
        generated_at = excluded.generated_at,
        fresh_until = excluded.fresh_until,
        refresh_started_at = NULL,
        last_refresh_error = NULL,
        updated_at = excluded.updated_at
    `).bind(listingId, JSON.stringify(analysis), CACHE_SCHEMA_VERSION, generatedAt, freshUntil, updatedAt),
  ]);
  return true;
}

export async function acquireRefreshLease(listingId: string, now = new Date()) {
  const db = await getDatabase();
  if (!db) return false;
  const leaseExpiredBefore = new Date(now.getTime() - REFRESH_LEASE_MS).toISOString();
  const result = await db.prepare(`
    UPDATE analysis_cache
    SET refresh_started_at = ?, updated_at = ?
    WHERE listing_id = ?
      AND (refresh_started_at IS NULL OR refresh_started_at < ?)
  `).bind(now.toISOString(), now.toISOString(), listingId, leaseExpiredBefore).run();
  return (result.meta?.changes ?? 0) > 0;
}

export async function recordRefreshFailure(listingId: string, error: unknown) {
  const db = await getDatabase();
  if (!db) return;
  const message = (error instanceof Error ? error.message : "Background refresh failed").slice(0, 500);
  await db.prepare(`
    UPDATE analysis_cache
    SET refresh_started_at = NULL, last_refresh_error = ?, updated_at = ?
    WHERE listing_id = ?
  `).bind(message, new Date().toISOString(), listingId).run();
}

export async function scheduleBackgroundRefresh(task: Promise<unknown>) {
  const waitUntil = (await workersRuntime())?.waitUntil;
  if (!waitUntil) return false;
  waitUntil(task);
  return true;
}
