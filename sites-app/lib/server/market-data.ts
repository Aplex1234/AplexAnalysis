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
  range: "1y";
  points: StockPricePoint[];
  provider: string;
  as_of: string;
  source_url: string;
  is_delayed: true;
};

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

export async function getStockPriceHistory(rawTicker: string): Promise<StockPriceHistory> {
  const ticker = normalizeTicker(rawTicker);
  const cached = priceHistoryCache.get(ticker);
  if (cached && cached.expiresAt > Date.now()) return cached.data;

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
  if (points.length < 2) throw new Error("Nasdaq did not return enough historical prices for this stock");

  const data: StockPriceHistory = {
    ticker,
    range: "1y",
    points,
    provider: "Nasdaq delayed historical prices",
    as_of: points.at(-1)!.date,
    source_url: `https://www.nasdaq.com/market-activity/stocks/${ticker.toLowerCase()}/historical`,
    is_delayed: true,
  };
  priceHistoryCache.set(ticker, { expiresAt: Date.now() + CACHE_TTL_MS, data });
  return data;
}
