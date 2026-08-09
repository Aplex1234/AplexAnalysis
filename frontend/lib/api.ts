import type { Analysis, DcfAssumptions, SecuritySearchResult, StockPriceHistory } from "./types";

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "/api/v1";

async function parseResponse(response: Response): Promise<Analysis> {
  const payload = await response.json();
  if (!response.ok) {
    const detail = typeof payload.detail === "string" ? payload.detail : payload.detail?.message;
    throw new Error(detail || "The research service could not complete this request.");
  }
  return payload.data as Analysis;
}

export async function fetchAnalysis(ticker: string, signal?: AbortSignal, scope: "overview" | "full" = "full"): Promise<Analysis> {
  const query = scope === "overview" ? "?view=overview" : "";
  const response = await fetch(`${API_URL}/companies/${encodeURIComponent(ticker)}/analysis${query}`, {
    signal,
  });
  return parseResponse(response);
}

export async function runValuation(ticker: string, assumptions: DcfAssumptions): Promise<Analysis> {
  const response = await fetch(`${API_URL}/companies/${encodeURIComponent(ticker)}/valuation`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ assumptions }),
  });
  return parseResponse(response);
}

export async function searchSecurities(query: string, signal?: AbortSignal): Promise<SecuritySearchResult[]> {
  const response = await fetch(`${API_URL}/search?q=${encodeURIComponent(query)}&limit=8`, {
    signal,
    cache: "no-store",
  });
  const payload = await response.json();
  if (!response.ok) {
    throw new Error(typeof payload.detail === "string" ? payload.detail : "Security search failed.");
  }
  return payload as SecuritySearchResult[];
}

export async function fetchStockPriceHistory(ticker: string, range: "1y" | "5y" | "max" = "1y", signal?: AbortSignal): Promise<StockPriceHistory> {
  const response = await fetch(`${API_URL}/companies/${encodeURIComponent(ticker)}/price-history?range=${range}`, {
    signal,
  });
  const payload = await response.json();
  if (!response.ok) {
    throw new Error(typeof payload.detail === "string" ? payload.detail : "Price history failed.");
  }
  return payload.data as StockPriceHistory;
}
