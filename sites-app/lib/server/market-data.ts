import { normalizeTicker } from "./security-master";
import { getCacheDatabase, scheduleBackgroundRefresh } from "./analysis-cache.ts";

export type StockPricePoint = {
  date: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
};

export type StockPriceHistory = {
  ticker: string;
  range: PriceHistoryRange;
  points: StockPricePoint[];
  provider: string;
  as_of: string;
  source_url: string;
  is_delayed: true;
};

export type PriceHistoryRange = "1d" | "1y" | "5y" | "max";

const PRICE_HISTORY_SOURCE_VERSION = "price-history-v3";
const MEMORY_CACHE_TTLS: Record<PriceHistoryRange, number> = {
  "1d": 60 * 1000,
  "1y": 15 * 60 * 1000,
  "5y": 15 * 60 * 1000,
  max: 15 * 60 * 1000,
};
const PERSISTENT_CACHE_TTLS: Record<PriceHistoryRange, number> = {
  "1d": 60 * 1000,
  "1y": 60 * 60 * 1000,
  "5y": 6 * 60 * 60 * 1000,
  max: 12 * 60 * 60 * 1000,
};
const priceHistoryCache = new Map<string, { expiresAt: number; data: StockPriceHistory }>();
const priceHistoryRefreshes = new Map<string, Promise<StockPriceHistory>>();

type PriceHistoryCacheRow = {
  payload_json: string;
  source_version: string;
  fresh_until: string;
};

function isoDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function parseNumber(value: unknown): number {
  const parsed = Number(String(value ?? "").replace(/[$,]/g, ""));
  return Number.isFinite(parsed) ? parsed : Number.NaN;
}

function parseNasdaqDate(value: string): string | null {
  const match = value.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  return match ? `${match[3]}-${match[1]}-${match[2]}` : null;
}

function buildHistory(
  ticker: string,
  range: PriceHistoryRange,
  points: StockPricePoint[],
  provider: string,
  sourceUrl: string,
): StockPriceHistory {
  if (points.length < 2) throw new Error(`${provider} did not return enough historical prices for this stock`);
  const data: StockPriceHistory = {
    ticker,
    range,
    points,
    provider,
    as_of: points.at(-1)!.date,
    source_url: sourceUrl,
    is_delayed: true,
  };
  return data;
}

async function readPersistentHistory(ticker: string, range: PriceHistoryRange) {
  const db = await getCacheDatabase();
  if (!db) return null;
  const row = await db.prepare(`
    SELECT payload_json, source_version, fresh_until FROM price_history_cache
    WHERE ticker = ? COLLATE NOCASE AND range = ? LIMIT 1
  `).bind(ticker, range).first<PriceHistoryCacheRow>();
  if (!row || row.source_version !== PRICE_HISTORY_SOURCE_VERSION) return null;
  try {
    return {
      data: JSON.parse(row.payload_json) as StockPriceHistory,
      isFresh: Date.parse(row.fresh_until) > Date.now(),
    };
  } catch {
    return null;
  }
}

async function writePersistentHistory(data: StockPriceHistory) {
  const db = await getCacheDatabase();
  if (!db) return;
  const now = new Date();
  const freshUntil = new Date(now.getTime() + PERSISTENT_CACHE_TTLS[data.range]).toISOString();
  await db.prepare(`
    INSERT INTO price_history_cache (
      ticker, range, payload_json, provider, source_version, fetched_at, fresh_until, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(ticker, range) DO UPDATE SET
      payload_json=excluded.payload_json, provider=excluded.provider,
      source_version=excluded.source_version, fetched_at=excluded.fetched_at,
      fresh_until=excluded.fresh_until, updated_at=excluded.updated_at
  `).bind(
    data.ticker,
    data.range,
    JSON.stringify(data),
    data.provider,
    PRICE_HISTORY_SOURCE_VERSION,
    now.toISOString(),
    freshUntil,
    now.toISOString(),
  ).run();
}

function rememberHistory(data: StockPriceHistory) {
  priceHistoryCache.set(`${data.ticker}:${data.range}`, {
    expiresAt: Date.now() + MEMORY_CACHE_TTLS[data.range],
    data,
  });
}

function refreshHistory(ticker: string, range: PriceHistoryRange) {
  const key = `${ticker}:${range}`;
  const current = priceHistoryRefreshes.get(key);
  if (current) return current;
  const refresh = (range === "1y" ? getNasdaqHistory(ticker) : getYahooHistory(ticker, range))
    .then(async (data) => {
      rememberHistory(data);
      await writePersistentHistory(data);
      return data;
    })
    .finally(() => priceHistoryRefreshes.delete(key));
  priceHistoryRefreshes.set(key, refresh);
  return refresh;
}

async function getNasdaqHistory(ticker: string): Promise<StockPriceHistory> {
  const range: PriceHistoryRange = "1y";
  const toDate = new Date();
  const fromDate = new Date(toDate);
  fromDate.setUTCDate(fromDate.getUTCDate() - 366);
  const quoteTicker = ticker.replaceAll("-", ".");
  const query = new URLSearchParams({
    assetclass: "stocks",
    fromdate: isoDate(fromDate),
    todate: isoDate(toDate),
    limit: "5000",
  });
  const response = await fetch(`https://api.nasdaq.com/api/quote/${quoteTicker}/historical?${query}`, {
    headers: {
      "User-Agent": "Mozilla/5.0 (compatible; AplexAnalysis/0.1; financial research)",
      Accept: "application/json, text/plain, */*",
      Origin: "https://www.nasdaq.com",
      Referer: "https://www.nasdaq.com/",
    },
    signal: AbortSignal.timeout(10_000),
  });
  if (!response.ok) throw new Error(`Nasdaq price-history request returned ${response.status}`);

  const payload = (await response.json()) as {
    data?: {
      tradesTable?: {
        rows?: Array<Record<string, string>>;
      };
    };
  };
  const points = (payload.data?.tradesTable?.rows ?? [])
    .map((row): StockPricePoint | null => {
      const date = parseNasdaqDate(row.date ?? "");
      const point = {
        date: date ?? "",
        open: parseNumber(row.open),
        high: parseNumber(row.high),
        low: parseNumber(row.low),
        close: parseNumber(row.close),
        volume: parseNumber(row.volume),
      };
      return date && Object.values(point).every((value) => typeof value === "string" || Number.isFinite(value)) ? point : null;
    })
    .filter((point): point is StockPricePoint => point != null)
    .sort((a, b) => a.date.localeCompare(b.date));
  return buildHistory(
    ticker,
    range,
    points,
    "Nasdaq delayed historical prices",
    `https://www.nasdaq.com/market-activity/stocks/${ticker.toLowerCase()}/historical`,
  );
}

async function getYahooHistory(ticker: string, range: "1d" | "5y" | "max"): Promise<StockPriceHistory> {
  const interval = range === "1d" ? "5m" : range === "5y" ? "1wk" : "1mo";
  const query = new URLSearchParams({
    range,
    interval,
    events: "history",
    includeAdjustedClose: "true",
    ...(range === "1d" ? { includePrePost: "true" } : {}),
  });
  const response = await fetch(`https://query1.finance.yahoo.com/v8/finance/chart/${ticker}?${query}`, {
    headers: {
      "User-Agent": "Mozilla/5.0 (compatible; AplexAnalysis/0.1; financial research)",
      Accept: "application/json, text/plain, */*",
    },
    signal: AbortSignal.timeout(10_000),
  });
  if (!response.ok) throw new Error(`Yahoo Finance price-history request returned ${response.status}`);
  const payload = (await response.json()) as {
    chart?: {
      result?: Array<{
        timestamp?: number[];
        indicators?: {
          quote?: Array<{
            open?: Array<number | null>;
            high?: Array<number | null>;
            low?: Array<number | null>;
            close?: Array<number | null>;
            volume?: Array<number | null>;
          }>;
        };
      }>;
      error?: { description?: string } | null;
    };
  };
  if (payload.chart?.error) throw new Error(payload.chart.error.description ?? "Yahoo Finance price history failed");
  const result = payload.chart?.result?.[0];
  const quote = result?.indicators?.quote?.[0];
  const points = (result?.timestamp ?? [])
    .map((timestamp, index): StockPricePoint | null => {
      const close = quote?.close?.[index];
      if (close == null || !Number.isFinite(close)) return null;
      const fallback = close;
      return {
        date: range === "1d"
          ? new Date(timestamp * 1000).toISOString()
          : new Date(timestamp * 1000).toISOString().slice(0, 10),
        open: quote?.open?.[index] ?? fallback,
        high: quote?.high?.[index] ?? fallback,
        low: quote?.low?.[index] ?? fallback,
        close,
        volume: quote?.volume?.[index] ?? 0,
      };
    })
    .filter((point): point is StockPricePoint => point != null)
    .sort((a, b) => a.date.localeCompare(b.date));
  return buildHistory(
    ticker,
    range,
    points,
    range === "1d"
      ? "Yahoo Finance intraday prices including extended hours"
      : "Yahoo Finance historical prices",
    `https://finance.yahoo.com/quote/${encodeURIComponent(ticker)}/history/`,
  );
}

export async function getStockPriceHistory(rawTicker: string, requestedRange: PriceHistoryRange = "1y"): Promise<StockPriceHistory> {
  const ticker = normalizeTicker(rawTicker);
  const range: PriceHistoryRange = requestedRange === "1d" || requestedRange === "5y" || requestedRange === "max" ? requestedRange : "1y";
  const cached = priceHistoryCache.get(`${ticker}:${range}`);
  if (cached && cached.expiresAt > Date.now()) return cached.data;
  const persisted = await readPersistentHistory(ticker, range);
  if (persisted) {
    rememberHistory(persisted.data);
    if (!persisted.isFresh) {
      const task = refreshHistory(ticker, range);
      if (!await scheduleBackgroundRefresh(task)) task.catch(() => undefined);
    }
    return persisted.data;
  }
  return refreshHistory(ticker, range);
}
