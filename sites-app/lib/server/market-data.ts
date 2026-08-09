import { normalizeTicker } from "./security-master";

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

export type PriceHistoryRange = "1y" | "5y" | "max";

const CACHE_TTL_MS = 15 * 60 * 1000;
const priceHistoryCache = new Map<string, { expiresAt: number; data: StockPriceHistory }>();

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
  priceHistoryCache.set(`${ticker}:${range}`, { expiresAt: Date.now() + CACHE_TTL_MS, data });
  return data;
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

async function getYahooHistory(ticker: string, range: "5y" | "max"): Promise<StockPriceHistory> {
  const interval = range === "5y" ? "1wk" : "1mo";
  const query = new URLSearchParams({ range, interval, events: "history", includeAdjustedClose: "true" });
  const response = await fetch(`https://query1.finance.yahoo.com/v8/finance/chart/${ticker}?${query}`, {
    headers: {
      "User-Agent": "Mozilla/5.0 (compatible; AplexAnalysis/0.1; financial research)",
      Accept: "application/json, text/plain, */*",
    },
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
        date: new Date(timestamp * 1000).toISOString().slice(0, 10),
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
    "Yahoo Finance historical prices",
    `https://finance.yahoo.com/quote/${encodeURIComponent(ticker)}/history/`,
  );
}

export async function getStockPriceHistory(rawTicker: string, requestedRange: PriceHistoryRange = "1y"): Promise<StockPriceHistory> {
  const ticker = normalizeTicker(rawTicker);
  const range: PriceHistoryRange = requestedRange === "5y" || requestedRange === "max" ? requestedRange : "1y";
  const cached = priceHistoryCache.get(`${ticker}:${range}`);
  if (cached && cached.expiresAt > Date.now()) return cached.data;
  return range === "1y" ? getNasdaqHistory(ticker) : getYahooHistory(ticker, range);
}
