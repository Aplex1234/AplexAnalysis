import type { Analysis } from "@/lib/types";
import type {
  AnalystEstimates,
  FinancialFingerprint,
  FinancialSource,
  PeerSet,
  Quote,
} from "./analysis.ts";
import {
  ANALYSIS_SCHEMA_VERSION,
  COMPONENT_SOURCE_VERSIONS,
  NORMALIZATION_VERSION,
  SCORE_MODEL_VERSION,
  VALUATION_MODEL_VERSION,
} from "./model-versions.ts";

export const CACHE_TTLS = {
  analysis: 5 * 60 * 1000,
  quote: 10 * 60 * 1000,
  analyst_estimates: 12 * 60 * 60 * 1000,
  comps: 2 * 60 * 60 * 1000,
  financial_check: 12 * 60 * 60 * 1000,
  popular_refresh: 30 * 60 * 1000,
} as const;

const REFRESH_LEASE_MS = 2 * 60 * 1000;

type D1Result = { success?: boolean; meta?: { changes?: number } };
type D1PreparedStatement = {
  bind(...values: unknown[]): D1PreparedStatement;
  first<T = Record<string, unknown>>(): Promise<T | null>;
  all<T = Record<string, unknown>>(): Promise<{ results?: T[] }>;
  run(): Promise<D1Result>;
};
export type D1Database = {
  prepare(query: string): D1PreparedStatement;
  batch(statements: D1PreparedStatement[]): Promise<D1Result[]>;
};

let schemaReady = false;

const CACHE_SCHEMA_SQL = [
  `CREATE TABLE IF NOT EXISTS companies (
    id TEXT PRIMARY KEY NOT NULL, cik TEXT NOT NULL, name TEXT NOT NULL,
    sector TEXT, industry TEXT, created_at TEXT DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at TEXT DEFAULT CURRENT_TIMESTAMP NOT NULL
  )`,
  `CREATE UNIQUE INDEX IF NOT EXISTS idx_companies_cik ON companies (cik)`,
  `CREATE TABLE IF NOT EXISTS listings (
    id TEXT PRIMARY KEY NOT NULL, company_id TEXT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
    ticker TEXT NOT NULL, exchange TEXT, is_primary INTEGER DEFAULT 1 NOT NULL,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP NOT NULL, updated_at TEXT DEFAULT CURRENT_TIMESTAMP NOT NULL
  )`,
  `CREATE UNIQUE INDEX IF NOT EXISTS idx_listings_exchange_ticker ON listings (exchange, ticker)`,
  `CREATE INDEX IF NOT EXISTS idx_listings_ticker ON listings (ticker)`,
  `CREATE INDEX IF NOT EXISTS idx_listings_company_id ON listings (company_id)`,
  `CREATE TABLE IF NOT EXISTS normalized_financial_cache (
    company_id TEXT PRIMARY KEY NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
    profile_json TEXT DEFAULT '{}' NOT NULL, annual_json TEXT NOT NULL,
    quarterly_json TEXT NOT NULL, filings_json TEXT NOT NULL, risks_json TEXT DEFAULT '[]' NOT NULL,
    latest_json TEXT NOT NULL, provenance_json TEXT NOT NULL, normalization_version TEXT NOT NULL,
    source_fingerprint TEXT, source_filing_at TEXT, normalized_at TEXT NOT NULL,
    fresh_until TEXT DEFAULT '1970-01-01T00:00:00.000Z' NOT NULL,
    updated_at TEXT DEFAULT CURRENT_TIMESTAMP NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS analysis_cache (
    listing_id TEXT PRIMARY KEY NOT NULL REFERENCES listings(id) ON DELETE CASCADE,
    payload_json TEXT NOT NULL, schema_version INTEGER DEFAULT 2 NOT NULL,
    normalization_version TEXT DEFAULT 'legacy' NOT NULL,
    valuation_model_version TEXT DEFAULT 'legacy' NOT NULL,
    score_model_version TEXT DEFAULT 'legacy' NOT NULL,
    component_source_versions_json TEXT DEFAULT '{}' NOT NULL,
    generated_at TEXT NOT NULL, fresh_until TEXT NOT NULL, refresh_started_at TEXT,
    last_refresh_error TEXT, last_successful_refresh TEXT, json_bytes INTEGER DEFAULT 0 NOT NULL,
    updated_at TEXT DEFAULT CURRENT_TIMESTAMP NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS idx_analysis_cache_fresh_until ON analysis_cache (fresh_until)`,
  `CREATE TABLE IF NOT EXISTS component_cache (
    listing_id TEXT NOT NULL REFERENCES listings(id) ON DELETE CASCADE,
    component TEXT NOT NULL, payload_json TEXT NOT NULL, provider TEXT,
    source_version TEXT NOT NULL, fetched_at TEXT NOT NULL, fresh_until TEXT NOT NULL,
    last_successful_refresh TEXT NOT NULL, last_refresh_error TEXT,
    json_bytes INTEGER DEFAULT 0 NOT NULL, updated_at TEXT DEFAULT CURRENT_TIMESTAMP NOT NULL,
    PRIMARY KEY (listing_id, component)
  )`,
  `CREATE INDEX IF NOT EXISTS idx_component_cache_component_fresh_until ON component_cache (component, fresh_until)`,
  `CREATE TABLE IF NOT EXISTS price_history_cache (
    ticker TEXT NOT NULL, range TEXT NOT NULL, payload_json TEXT NOT NULL,
    provider TEXT NOT NULL, source_version TEXT NOT NULL, fetched_at TEXT NOT NULL,
    fresh_until TEXT NOT NULL, updated_at TEXT DEFAULT CURRENT_TIMESTAMP NOT NULL,
    PRIMARY KEY (ticker, range)
  )`,
  `CREATE INDEX IF NOT EXISTS idx_price_history_cache_fresh_until ON price_history_cache (fresh_until)`,
  `CREATE TABLE IF NOT EXISTS reference_data_cache (
    cache_key TEXT PRIMARY KEY NOT NULL, payload_json TEXT NOT NULL,
    provider TEXT NOT NULL, source_version TEXT NOT NULL, fetched_at TEXT NOT NULL,
    fresh_until TEXT NOT NULL, updated_at TEXT DEFAULT CURRENT_TIMESTAMP NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS idx_reference_data_cache_fresh_until ON reference_data_cache (fresh_until)`,
  `CREATE TABLE IF NOT EXISTS cache_events (
    id INTEGER PRIMARY KEY AUTOINCREMENT, listing_id TEXT, ticker TEXT NOT NULL,
    component TEXT NOT NULL, outcome TEXT NOT NULL, duration_ms INTEGER,
    json_bytes INTEGER, provider TEXT, error TEXT,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS idx_cache_events_component_created_at ON cache_events (component, created_at)`,
  `CREATE INDEX IF NOT EXISTS idx_cache_events_listing_created_at ON cache_events (listing_id, created_at)`,
  `CREATE TABLE IF NOT EXISTS cache_refresh_schedule (
    listing_id TEXT PRIMARY KEY NOT NULL REFERENCES listings(id) ON DELETE CASCADE,
    ticker TEXT NOT NULL, view_count INTEGER DEFAULT 1 NOT NULL, priority INTEGER DEFAULT 0 NOT NULL,
    last_viewed_at TEXT NOT NULL, next_refresh_at TEXT NOT NULL, last_scheduled_refresh TEXT,
    updated_at TEXT DEFAULT CURRENT_TIMESTAMP NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS idx_cache_refresh_schedule_due ON cache_refresh_schedule (next_refresh_at, priority, view_count)`,
  `CREATE TABLE IF NOT EXISTS peer_selection_runs (
    id TEXT PRIMARY KEY NOT NULL,
    target_listing_id TEXT NOT NULL REFERENCES listings(id) ON DELETE CASCADE,
    source_provider TEXT NOT NULL, source_url TEXT NOT NULL, source_as_of TEXT NOT NULL,
    selection_version TEXT NOT NULL, target_sector TEXT, target_industry TEXT,
    candidate_count INTEGER NOT NULL, selected_count INTEGER NOT NULL,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS idx_peer_selection_runs_target_created_at ON peer_selection_runs (target_listing_id, created_at)`,
  `CREATE TABLE IF NOT EXISTS peer_selections (
    run_id TEXT NOT NULL REFERENCES peer_selection_runs(id) ON DELETE CASCADE,
    peer_ticker TEXT NOT NULL, peer_name TEXT NOT NULL, rank INTEGER NOT NULL,
    score_basis_points INTEGER NOT NULL, reason TEXT NOT NULL, factors_json TEXT NOT NULL,
    source_label TEXT NOT NULL, source_url TEXT NOT NULL, market_cap INTEGER,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP NOT NULL,
    PRIMARY KEY (run_id, peer_ticker)
  )`,
  `CREATE INDEX IF NOT EXISTS idx_peer_selections_peer_ticker ON peer_selections (peer_ticker)`,
  `PRAGMA optimize`,
];

const LEGACY_COLUMNS: Array<[string, string, string]> = [
  ["normalized_financial_cache", "profile_json", "TEXT NOT NULL DEFAULT '{}'"],
  ["normalized_financial_cache", "risks_json", "TEXT NOT NULL DEFAULT '[]'"],
  ["normalized_financial_cache", "source_fingerprint", "TEXT"],
  ["normalized_financial_cache", "source_filing_at", "TEXT"],
  ["normalized_financial_cache", "fresh_until", "TEXT NOT NULL DEFAULT '1970-01-01T00:00:00.000Z'"],
  ["analysis_cache", "normalization_version", "TEXT NOT NULL DEFAULT 'legacy'"],
  ["analysis_cache", "valuation_model_version", "TEXT NOT NULL DEFAULT 'legacy'"],
  ["analysis_cache", "score_model_version", "TEXT NOT NULL DEFAULT 'legacy'"],
  ["analysis_cache", "component_source_versions_json", "TEXT NOT NULL DEFAULT '{}'"],
  ["analysis_cache", "last_successful_refresh", "TEXT"],
  ["analysis_cache", "json_bytes", "INTEGER NOT NULL DEFAULT 0"],
];

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

async function ensureLegacyColumns(db: D1Database) {
  for (const [table, column, definition] of LEGACY_COLUMNS) {
    const existing = await db.prepare(`SELECT name FROM pragma_table_info('${table}') WHERE name = ?`).bind(column).first();
    if (!existing) await db.prepare(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`).run();
  }
}

export async function getCacheDatabase() {
  const db = (await workersRuntime())?.env?.DB ?? null;
  if (db && !schemaReady) {
    if (process.env.NODE_ENV !== "production") {
      await db.batch(CACHE_SCHEMA_SQL.map((statement) => db.prepare(statement)));
      await ensureLegacyColumns(db);
    }
    schemaReady = true;
  }
  return db;
}

function byteLength(value: string) {
  return new TextEncoder().encode(value).byteLength;
}

function identifierToken(value: string | null | undefined) {
  return (value ?? "unknown").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "unknown";
}

function listingMarket(exchange: string | null) {
  const micByExchange: Record<string, string> = {
    NASDAQ: "xnas", NYSE: "xnys", "NYSE AMERICAN": "xase", "NYSE ARCA": "arcx", CBOE: "bats", OTC: "otcm",
  };
  return micByExchange[(exchange ?? "").trim().toUpperCase()] ?? identifierToken(exchange);
}

export function cacheIdentity(company: Analysis["company"] | FinancialSource["profile"], ticker?: string) {
  const symbol = ticker ?? ("ticker" in company ? company.ticker : "unknown");
  const cik = company.cik.padStart(10, "0");
  return {
    cik,
    companyId: `sec-cik:${cik}`,
    listingId: `listing:${listingMarket(company.exchange)}:${identifierToken(symbol)}`,
    ticker: symbol.toUpperCase(),
  };
}

async function ensureIdentity(
  db: D1Database,
  ticker: string,
  profile: FinancialSource["profile"] | Analysis["company"],
  now: string,
) {
  const identity = cacheIdentity(profile, ticker);
  await db.prepare(`
    INSERT INTO companies (id, cik, name, sector, industry, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET cik=excluded.cik, name=excluded.name,
      sector=excluded.sector, industry=excluded.industry, updated_at=excluded.updated_at
  `).bind(identity.companyId, identity.cik, profile.name, profile.sector, profile.industry, now, now).run();
  const existing = await db.prepare(`
    SELECT id FROM listings WHERE ticker=? COLLATE NOCASE
      AND (exchange=? COLLATE NOCASE OR exchange IS NULL OR ? IS NULL)
    ORDER BY is_primary DESC LIMIT 1
  `).bind(identity.ticker, profile.exchange, profile.exchange).first<{ id: string }>();
  const listingId = existing?.id ?? identity.listingId;
  await db.prepare(`
    INSERT INTO listings (id, company_id, ticker, exchange, is_primary, created_at, updated_at)
    VALUES (?, ?, ?, ?, 1, ?, ?)
    ON CONFLICT(id) DO UPDATE SET company_id=excluded.company_id, ticker=excluded.ticker,
      exchange=excluded.exchange, is_primary=1, updated_at=excluded.updated_at
  `).bind(listingId, identity.companyId, identity.ticker, profile.exchange, now, now).run();
  return { ...identity, listingId };
}

async function recordEvent(
  db: D1Database,
  event: {
    listingId?: string | null;
    ticker: string;
    component: string;
    outcome: string;
    durationMs?: number | null;
    jsonBytes?: number | null;
    provider?: string | null;
    error?: string | null;
  },
) {
  const task = db.prepare(`
    INSERT INTO cache_events (listing_id, ticker, component, outcome, duration_ms, json_bytes, provider, error)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).bind(
    event.listingId ?? null,
    event.ticker,
    event.component,
    event.outcome,
    event.durationMs ?? null,
    event.jsonBytes ?? null,
    event.provider ?? null,
    event.error?.slice(0, 500) ?? null,
  ).run();
  if (!await scheduleBackgroundRefresh(task)) await task;
}

type CacheRow = {
  listing_id: string;
  payload_json: string;
  schema_version?: number;
  normalization_version?: string;
  valuation_model_version?: string;
  score_model_version?: string;
  component_source_versions_json?: string;
  generated_at: string;
  fresh_until: string;
  json_bytes?: number;
};

export type CachedAnalysis = {
  analysis: Analysis;
  listingId: string;
  generatedAt: string;
  freshUntil: string;
  isFresh: boolean;
};

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

export function isAnalysisCacheCompatible(row: Pick<CacheRow, "schema_version" | "normalization_version" | "valuation_model_version" | "score_model_version" | "component_source_versions_json">) {
  let componentVersions: Record<string, unknown> = {};
  try {
    componentVersions = JSON.parse(row.component_source_versions_json ?? "{}");
  } catch {
    return false;
  }
  return row.schema_version === ANALYSIS_SCHEMA_VERSION
    && row.normalization_version === NORMALIZATION_VERSION
    && row.valuation_model_version === VALUATION_MODEL_VERSION
    && row.score_model_version === SCORE_MODEL_VERSION
    && Object.entries(COMPONENT_SOURCE_VERSIONS).every(([component, version]) => componentVersions[component] === version);
}

export async function readCachedAnalysis(ticker: string): Promise<CachedAnalysis | null> {
  const startedAt = Date.now();
  const db = await getCacheDatabase();
  if (!db) return null;
  const normalizedTicker = ticker.trim().toUpperCase();
  const row = await db.prepare(`
    SELECT ac.listing_id, ac.payload_json, ac.schema_version, ac.normalization_version,
      ac.valuation_model_version, ac.score_model_version, ac.component_source_versions_json, ac.generated_at,
      ac.fresh_until, ac.json_bytes
    FROM analysis_cache ac INNER JOIN listings l ON l.id = ac.listing_id
    WHERE l.ticker = ? COLLATE NOCASE
    ORDER BY l.is_primary DESC, ac.updated_at DESC LIMIT 1
  `).bind(normalizedTicker).first<CacheRow>();
  if (!row) {
    await recordEvent(db, { ticker: normalizedTicker, component: "analysis", outcome: "miss", durationMs: Date.now() - startedAt });
    return null;
  }
  if (!isAnalysisCacheCompatible(row)) {
    await recordEvent(db, { listingId: row.listing_id, ticker: normalizedTicker, component: "analysis", outcome: "version_miss", durationMs: Date.now() - startedAt });
    return null;
  }
  const cached = parseCachedAnalysisRow(row);
  await recordEvent(db, {
    listingId: row.listing_id,
    ticker: normalizedTicker,
    component: "analysis",
    outcome: cached?.isFresh ? "hit" : "stale",
    durationMs: Date.now() - startedAt,
    jsonBytes: row.json_bytes ?? byteLength(row.payload_json),
  });
  return cached;
}

export async function writeAnalysisSnapshot(analysis: Analysis, now = new Date()) {
  const startedAt = Date.now();
  const db = await getCacheDatabase();
  if (!db) return false;
  const timestamp = now.toISOString();
  const identity = await ensureIdentity(db, analysis.company.ticker, analysis.company, timestamp);
  const payloadJson = JSON.stringify(analysis);
  const generatedAt = analysis.provenance.generated_at || timestamp;
  const freshUntil = new Date(now.getTime() + CACHE_TTLS.analysis).toISOString();
  const jsonBytes = byteLength(payloadJson);
  await db.prepare(`
    INSERT INTO analysis_cache (
      listing_id, payload_json, schema_version, normalization_version,
      valuation_model_version, score_model_version, component_source_versions_json, generated_at, fresh_until,
      refresh_started_at, last_refresh_error, last_successful_refresh, json_bytes, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL, ?, ?, ?)
    ON CONFLICT(listing_id) DO UPDATE SET payload_json=excluded.payload_json,
      schema_version=excluded.schema_version, normalization_version=excluded.normalization_version,
      valuation_model_version=excluded.valuation_model_version, score_model_version=excluded.score_model_version,
      component_source_versions_json=excluded.component_source_versions_json,
      generated_at=excluded.generated_at, fresh_until=excluded.fresh_until,
      refresh_started_at=NULL, last_refresh_error=NULL,
      last_successful_refresh=excluded.last_successful_refresh,
      json_bytes=excluded.json_bytes, updated_at=excluded.updated_at
  `).bind(
    identity.listingId, payloadJson, ANALYSIS_SCHEMA_VERSION, NORMALIZATION_VERSION,
    VALUATION_MODEL_VERSION, SCORE_MODEL_VERSION, JSON.stringify(COMPONENT_SOURCE_VERSIONS), generatedAt, freshUntil,
    timestamp, jsonBytes, timestamp,
  ).run();
  await recordEvent(db, { listingId: identity.listingId, ticker: identity.ticker, component: "analysis", outcome: "refresh_success", durationMs: Date.now() - startedAt, jsonBytes });
  return identity;
}

export const writeCachedAnalysis = writeAnalysisSnapshot;

type FinancialRow = {
  company_id: string;
  listing_id: string;
  profile_json: string;
  annual_json: string;
  quarterly_json: string;
  filings_json: string;
  risks_json: string;
  normalization_version: string;
  source_fingerprint: string | null;
  source_filing_at: string | null;
  normalized_at: string;
  fresh_until: string;
};

export type CachedFinancialSource = {
  source: FinancialSource;
  companyId: string;
  listingId: string;
  normalizationVersion: string;
  sourceFingerprint: string | null;
  sourceFilingAt: string | null;
  normalizedAt: string;
  freshUntil: string;
  isFresh: boolean;
};

export function hasSameFinancialFingerprint(cached: Pick<CachedFinancialSource, "sourceFingerprint">, fingerprint: FinancialFingerprint) {
  return Boolean(cached.sourceFingerprint && cached.sourceFingerprint === fingerprint.accessionNumber);
}

export async function readFinancialSourceCache(ticker: string): Promise<CachedFinancialSource | null> {
  const startedAt = Date.now();
  const db = await getCacheDatabase();
  if (!db) return null;
  const normalizedTicker = ticker.trim().toUpperCase();
  const row = await db.prepare(`
    SELECT nf.company_id, l.id AS listing_id, nf.profile_json, nf.annual_json,
      nf.quarterly_json, nf.filings_json, nf.risks_json, nf.normalization_version,
      nf.source_fingerprint, nf.source_filing_at, nf.normalized_at, nf.fresh_until
    FROM normalized_financial_cache nf
    INNER JOIN listings l ON l.company_id = nf.company_id
    WHERE l.ticker = ? COLLATE NOCASE
    ORDER BY l.is_primary DESC LIMIT 1
  `).bind(normalizedTicker).first<FinancialRow>();
  if (!row || row.normalization_version !== NORMALIZATION_VERSION) {
    await recordEvent(db, { listingId: row?.listing_id, ticker: normalizedTicker, component: "financials", outcome: row ? "version_miss" : "miss", durationMs: Date.now() - startedAt });
    return null;
  }
  try {
    const source: FinancialSource = {
      profile: JSON.parse(row.profile_json),
      periods: JSON.parse(row.annual_json),
      quarterlyPeriods: JSON.parse(row.quarterly_json),
      filings: JSON.parse(row.filings_json),
      filingRisks: JSON.parse(row.risks_json),
    };
    if (!source.profile?.cik || source.periods.length < 3) throw new Error("Cached normalized financials are incomplete");
    const isFresh = Date.parse(row.fresh_until) > Date.now();
    await recordEvent(db, { listingId: row.listing_id, ticker: normalizedTicker, component: "financials", outcome: isFresh ? "hit" : "stale", durationMs: Date.now() - startedAt, jsonBytes: byteLength(row.annual_json) + byteLength(row.quarterly_json) });
    return {
      source,
      companyId: row.company_id,
      listingId: row.listing_id,
      normalizationVersion: row.normalization_version,
      sourceFingerprint: row.source_fingerprint,
      sourceFilingAt: row.source_filing_at,
      normalizedAt: row.normalized_at,
      freshUntil: row.fresh_until,
      isFresh,
    };
  } catch (error) {
    await recordEvent(db, { listingId: row.listing_id, ticker: normalizedTicker, component: "financials", outcome: "corrupt", error: error instanceof Error ? error.message : "Invalid financial cache" });
    return null;
  }
}

function fingerprintFromSource(source: FinancialSource): FinancialFingerprint {
  const filing = source.filings.find((item) => ["10-K", "10-Q", "20-F", "40-F"].includes(item.form));
  return { accessionNumber: filing?.accession_number ?? "none", filingDate: filing?.filing_date ?? null, form: filing?.form ?? null };
}

export async function writeFinancialSourceCache(ticker: string, source: FinancialSource, now = new Date()) {
  const startedAt = Date.now();
  const db = await getCacheDatabase();
  if (!db) return null;
  const timestamp = now.toISOString();
  const identity = await ensureIdentity(db, ticker, source.profile, timestamp);
  const fingerprint = fingerprintFromSource(source);
  const annualJson = JSON.stringify(source.periods);
  const quarterlyJson = JSON.stringify(source.quarterlyPeriods);
  const filingsJson = JSON.stringify(source.filings);
  const risksJson = JSON.stringify(source.filingRisks);
  const profileJson = JSON.stringify(source.profile);
  const latestJson = JSON.stringify(source.periods.at(-1)?.values ?? {});
  const provenanceJson = JSON.stringify({
    annual: source.periods.at(-1)?.provenance ?? {},
    quarterly: source.quarterlyPeriods.at(-1)?.provenance ?? {},
  });
  const freshUntil = new Date(now.getTime() + CACHE_TTLS.financial_check).toISOString();
  const jsonBytes = [profileJson, annualJson, quarterlyJson, filingsJson, risksJson, latestJson, provenanceJson]
    .reduce((sum, value) => sum + byteLength(value), 0);
  await db.prepare(`
    INSERT INTO normalized_financial_cache (
      company_id, profile_json, annual_json, quarterly_json, filings_json, risks_json,
      latest_json, provenance_json, normalization_version, source_fingerprint,
      source_filing_at, normalized_at, fresh_until, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(company_id) DO UPDATE SET profile_json=excluded.profile_json,
      annual_json=excluded.annual_json, quarterly_json=excluded.quarterly_json,
      filings_json=excluded.filings_json, risks_json=excluded.risks_json,
      latest_json=excluded.latest_json, provenance_json=excluded.provenance_json,
      normalization_version=excluded.normalization_version,
      source_fingerprint=excluded.source_fingerprint, source_filing_at=excluded.source_filing_at,
      normalized_at=excluded.normalized_at, fresh_until=excluded.fresh_until,
      updated_at=excluded.updated_at
  `).bind(
    identity.companyId, profileJson, annualJson, quarterlyJson, filingsJson, risksJson,
    latestJson, provenanceJson, NORMALIZATION_VERSION, fingerprint.accessionNumber,
    fingerprint.filingDate, timestamp, freshUntil, timestamp,
  ).run();
  await recordEvent(db, { listingId: identity.listingId, ticker: identity.ticker, component: "financials", outcome: "refresh_success", durationMs: Date.now() - startedAt, jsonBytes, provider: "SEC EDGAR" });
  return { ...identity, fingerprint, normalizedAt: timestamp, freshUntil };
}

export async function extendFinancialFreshness(ticker: string, cached: CachedFinancialSource, fingerprint: FinancialFingerprint, now = new Date()) {
  const db = await getCacheDatabase();
  if (!db) return cached;
  const freshUntil = new Date(now.getTime() + CACHE_TTLS.financial_check).toISOString();
  await db.prepare(`
    UPDATE normalized_financial_cache SET source_fingerprint=?, source_filing_at=?,
      fresh_until=?, updated_at=? WHERE company_id=?
  `).bind(fingerprint.accessionNumber, fingerprint.filingDate, freshUntil, now.toISOString(), cached.companyId).run();
  await recordEvent(db, { listingId: cached.listingId, ticker: ticker.trim().toUpperCase(), component: "financials", outcome: "filing_unchanged" });
  return { ...cached, sourceFingerprint: fingerprint.accessionNumber, sourceFilingAt: fingerprint.filingDate, freshUntil, isFresh: true };
}

export type ComponentName = "quote" | "analyst_estimates" | "comps";
export type CachedComponent<T> = {
  data: T;
  listingId: string;
  provider: string | null;
  fetchedAt: string;
  freshUntil: string;
  lastSuccessfulRefresh: string;
  isFresh: boolean;
};

export async function readComponentCache<T>(ticker: string, component: ComponentName, sourceVersion: string): Promise<CachedComponent<T> | null> {
  const startedAt = Date.now();
  const db = await getCacheDatabase();
  if (!db) return null;
  const normalizedTicker = ticker.trim().toUpperCase();
  const row = await db.prepare(`
    SELECT cc.listing_id, cc.payload_json, cc.provider, cc.source_version,
      cc.fetched_at, cc.fresh_until, cc.last_successful_refresh, cc.json_bytes
    FROM component_cache cc INNER JOIN listings l ON l.id=cc.listing_id
    WHERE l.ticker=? COLLATE NOCASE AND cc.component=?
    ORDER BY l.is_primary DESC LIMIT 1
  `).bind(normalizedTicker, component).first<{
    listing_id: string; payload_json: string; provider: string | null; source_version: string;
    fetched_at: string; fresh_until: string; last_successful_refresh: string; json_bytes: number;
  }>();
  if (!row || row.source_version !== sourceVersion) {
    await recordEvent(db, { listingId: row?.listing_id, ticker: normalizedTicker, component, outcome: row ? "version_miss" : "miss", durationMs: Date.now() - startedAt });
    return null;
  }
  try {
    const data = JSON.parse(row.payload_json) as T;
    const isFresh = Date.parse(row.fresh_until) > Date.now();
    await recordEvent(db, { listingId: row.listing_id, ticker: normalizedTicker, component, outcome: isFresh ? "hit" : "stale", durationMs: Date.now() - startedAt, jsonBytes: row.json_bytes, provider: row.provider });
    return { data, listingId: row.listing_id, provider: row.provider, fetchedAt: row.fetched_at, freshUntil: row.fresh_until, lastSuccessfulRefresh: row.last_successful_refresh, isFresh };
  } catch (error) {
    await recordEvent(db, { listingId: row.listing_id, ticker: normalizedTicker, component, outcome: "corrupt", error: error instanceof Error ? error.message : "Invalid component cache" });
    return null;
  }
}

export async function writeComponentCache<T>(
  ticker: string,
  profile: FinancialSource["profile"],
  component: ComponentName,
  data: T,
  sourceVersion: string,
  ttlMs: number,
  provider: string | null,
  refreshStartedAt = Date.now(),
  now = new Date(),
) {
  const db = await getCacheDatabase();
  if (!db) return null;
  const timestamp = now.toISOString();
  const identity = await ensureIdentity(db, ticker, profile, timestamp);
  const payloadJson = JSON.stringify(data);
  const freshUntil = new Date(now.getTime() + ttlMs).toISOString();
  const jsonBytes = byteLength(payloadJson);
  await db.prepare(`
    INSERT INTO component_cache (
      listing_id, component, payload_json, provider, source_version, fetched_at,
      fresh_until, last_successful_refresh, last_refresh_error, json_bytes, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?)
    ON CONFLICT(listing_id, component) DO UPDATE SET payload_json=excluded.payload_json,
      provider=excluded.provider, source_version=excluded.source_version,
      fetched_at=excluded.fetched_at, fresh_until=excluded.fresh_until,
      last_successful_refresh=excluded.last_successful_refresh,
      last_refresh_error=NULL, json_bytes=excluded.json_bytes, updated_at=excluded.updated_at
  `).bind(identity.listingId, component, payloadJson, provider, sourceVersion, timestamp, freshUntil, timestamp, jsonBytes, timestamp).run();
  await recordEvent(db, { listingId: identity.listingId, ticker: identity.ticker, component, outcome: "refresh_success", durationMs: Date.now() - refreshStartedAt, jsonBytes, provider });
  return { ...identity, fetchedAt: timestamp, freshUntil, jsonBytes };
}

export async function writePeerSelectionAudit(
  ticker: string,
  profile: FinancialSource["profile"],
  peerSet: PeerSet,
  now = new Date(),
) {
  const db = await getCacheDatabase();
  if (!db) return false;
  const timestamp = now.toISOString();
  const identity = await ensureIdentity(db, ticker, profile, timestamp);
  const runId = `peer-run:${identity.listingId}:${now.getTime()}:${crypto.randomUUID().slice(0, 8)}`;
  await db.prepare(`
    INSERT INTO peer_selection_runs (
      id, target_listing_id, source_provider, source_url, source_as_of,
      selection_version, target_sector, target_industry, candidate_count,
      selected_count, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).bind(
    runId,
    identity.listingId,
    peerSet.source_provider,
    peerSet.source_url,
    peerSet.source_as_of,
    peerSet.selection_version,
    profile.sector,
    profile.industry,
    peerSet.candidates_considered,
    peerSet.companies.length,
    timestamp,
  ).run();
  if (peerSet.companies.length) {
    await db.batch(peerSet.companies.map((company, index) => db.prepare(`
      INSERT INTO peer_selections (
        run_id, peer_ticker, peer_name, rank, score_basis_points, reason,
        factors_json, source_label, source_url, market_cap, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).bind(
      runId,
      company.ticker,
      company.name,
      index + 1,
      Math.round(company.selection_score * 100),
      company.selection_reason,
      JSON.stringify(company.selection_factors),
      company.selection_source,
      company.selection_source_url,
      company.market_cap,
      timestamp,
    )));
  }
  const jsonBytes = byteLength(JSON.stringify(peerSet));
  await recordEvent(db, {
    listingId: identity.listingId,
    ticker: identity.ticker,
    component: "comps_audit",
    outcome: "stored",
    jsonBytes,
    provider: peerSet.source_provider,
  });
  return true;
}

export async function recordProviderFailure(ticker: string, component: string, error: unknown, listingId?: string | null) {
  const db = await getCacheDatabase();
  if (!db) return;
  const message = error instanceof Error ? error.message : "Provider refresh failed";
  if (listingId && ["quote", "analyst_estimates", "comps"].includes(component)) {
    await db.prepare(`UPDATE component_cache SET last_refresh_error=?, updated_at=? WHERE listing_id=? AND component=?`)
      .bind(message.slice(0, 500), new Date().toISOString(), listingId, component).run();
  }
  await recordEvent(db, { listingId, ticker: ticker.toUpperCase(), component, outcome: "provider_failure", error: message });
}

export async function acquireRefreshLease(listingId: string, now = new Date()) {
  const db = await getCacheDatabase();
  if (!db) return false;
  const leaseExpiredBefore = new Date(now.getTime() - REFRESH_LEASE_MS).toISOString();
  const result = await db.prepare(`
    UPDATE analysis_cache SET refresh_started_at=?, updated_at=? WHERE listing_id=?
      AND (refresh_started_at IS NULL OR refresh_started_at < ?)
  `).bind(now.toISOString(), now.toISOString(), listingId, leaseExpiredBefore).run();
  return (result.meta?.changes ?? 0) > 0;
}

export async function recordRefreshFailure(listingId: string, error: unknown) {
  const db = await getCacheDatabase();
  if (!db) return;
  const message = (error instanceof Error ? error.message : String(error)).slice(0, 500);
  await db.prepare(`UPDATE analysis_cache SET refresh_started_at=NULL, last_refresh_error=?, updated_at=? WHERE listing_id=?`)
    .bind(message, new Date().toISOString(), listingId).run();
  await recordEvent(db, { listingId, ticker: "UNKNOWN", component: "analysis", outcome: "refresh_failure", error: message });
}

export async function scheduleBackgroundRefresh(task: Promise<unknown>) {
  const waitUntil = (await workersRuntime())?.waitUntil;
  if (!waitUntil) return false;
  waitUntil(task);
  return true;
}

export async function recordCompanyView(ticker: string, listingId: string, now = new Date()) {
  const db = await getCacheDatabase();
  if (!db) return;
  const timestamp = now.toISOString();
  const nextRefreshAt = new Date(now.getTime() + CACHE_TTLS.popular_refresh).toISOString();
  await db.prepare(`
    INSERT INTO cache_refresh_schedule (listing_id, ticker, view_count, priority, last_viewed_at, next_refresh_at, updated_at)
    VALUES (?, ?, 1, 0, ?, ?, ?)
    ON CONFLICT(listing_id) DO UPDATE SET view_count=view_count+1,
      ticker=excluded.ticker, last_viewed_at=excluded.last_viewed_at,
      next_refresh_at=CASE WHEN next_refresh_at < excluded.next_refresh_at THEN next_refresh_at ELSE excluded.next_refresh_at END,
      updated_at=excluded.updated_at
  `).bind(listingId, ticker.toUpperCase(), timestamp, nextRefreshAt, timestamp).run();
}

export async function recordCompanyViewInBackground(ticker: string, listingId: string, now = new Date()) {
  const task = recordCompanyView(ticker, listingId, now);
  if (!await scheduleBackgroundRefresh(task)) await task;
}

export async function pruneCacheEvents(retentionDays = 30, now = new Date()) {
  const db = await getCacheDatabase();
  if (!db) return;
  const cutoff = new Date(now.getTime() - Math.max(1, retentionDays) * 24 * 60 * 60 * 1000).toISOString();
  await db.prepare(`DELETE FROM cache_events WHERE created_at < ?`).bind(cutoff).run();
}

export async function listDueRefreshTickers(limit = 5, excludeTicker?: string) {
  const db = await getCacheDatabase();
  if (!db) return [];
  const rows = await db.prepare(`
    SELECT listing_id, ticker FROM cache_refresh_schedule
    WHERE next_refresh_at <= ? AND view_count >= 2 AND ticker <> ?
    ORDER BY priority DESC, view_count DESC, last_viewed_at DESC LIMIT ?
  `).bind(new Date().toISOString(), (excludeTicker ?? "").toUpperCase(), limit).all<{ listing_id: string; ticker: string }>();
  return rows.results ?? [];
}

export async function markScheduledRefresh(listingId: string, success: boolean, now = new Date()) {
  const db = await getCacheDatabase();
  if (!db) return;
  const next = new Date(now.getTime() + (success ? CACHE_TTLS.popular_refresh : 5 * 60 * 1000)).toISOString();
  await db.prepare(`
    UPDATE cache_refresh_schedule SET last_scheduled_refresh=?, next_refresh_at=?, updated_at=? WHERE listing_id=?
  `).bind(now.toISOString(), next, now.toISOString(), listingId).run();
}

export async function getCacheMonitoringSummary() {
  const db = await getCacheDatabase();
  if (!db) return { available: false, events: [], cachedCompanies: 0, lastSuccessfulRefresh: null };
  const events = await db.prepare(`
    SELECT component, outcome, COUNT(*) AS count,
      ROUND(AVG(duration_ms), 1) AS avg_duration_ms,
      MAX(json_bytes) AS max_json_bytes, MAX(created_at) AS last_event_at
    FROM cache_events
    WHERE created_at >= datetime('now', '-24 hours') GROUP BY component, outcome
    ORDER BY component, outcome
  `).all<{ component: string; outcome: string; count: number; avg_duration_ms: number | null; max_json_bytes: number | null; last_event_at: string }>();
  const cachedCompanies = await db.prepare(`SELECT COUNT(*) AS count FROM normalized_financial_cache`).first<{ count: number }>();
  const lastRefresh = await db.prepare(`
    SELECT MAX(value) AS value FROM (
      SELECT last_successful_refresh AS value FROM analysis_cache
      UNION ALL SELECT last_successful_refresh AS value FROM component_cache
      UNION ALL SELECT normalized_at AS value FROM normalized_financial_cache
    )
  `).first<{ value: string | null }>();
  return { available: true, events: events.results ?? [], cachedCompanies: cachedCompanies?.count ?? 0, lastSuccessfulRefresh: lastRefresh?.value ?? null };
}

export type CachedQuote = CachedComponent<Quote>;
export type CachedEstimates = CachedComponent<AnalystEstimates>;
export type CachedPeers = CachedComponent<PeerSet>;
