import type { Analysis, AnalysisSection, DcfAssumptions, SecuritySearchResult, StockPriceHistory } from "./types";

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "/api/v1";
const overviewRequests = new Map<string, Promise<Analysis>>();

async function parseResponse(response: Response): Promise<Analysis> {
  const payload = await response.json();
  if (!response.ok) {
    const detail = typeof payload.detail === "string" ? payload.detail : payload.detail?.message;
    throw new Error(detail || "The research service could not complete this request.");
  }
  return payload.data as Analysis;
}

async function requestAnalysis(ticker: string, signal: AbortSignal | undefined, scope: AnalysisSection | "full", forceRefresh = false) {
  const params = new URLSearchParams();
  if (scope !== "full") params.set("view", scope);
  const query = params.size ? `?${params}` : "";
  const response = await fetch(`${API_URL}/companies/${encodeURIComponent(ticker)}/analysis${query}`, {
    method: forceRefresh ? "POST" : "GET",
    signal,
    cache: forceRefresh ? "no-store" : undefined,
  });
  return parseResponse(response);
}

export function fetchAnalysis(ticker: string, signal?: AbortSignal, scope: AnalysisSection | "full" = "full", forceRefresh = false): Promise<Analysis> {
  if (scope !== "overview" || forceRefresh) return requestAnalysis(ticker, signal, scope, forceRefresh);
  const key = ticker.trim().toUpperCase();
  const existing = overviewRequests.get(key);
  if (existing) return existing;
  const request = requestAnalysis(key, signal, scope);
  overviewRequests.set(key, request);
  void request.finally(() => {
    if (overviewRequests.get(key) === request) overviewRequests.delete(key);
  }).catch(() => undefined);
  return request;
}

export function prefetchAnalysis(ticker: string) {
  void fetchAnalysis(ticker, undefined, "overview").catch(() => undefined);
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

export async function fetchStockPriceHistory(ticker: string, range: "1d" | "1y" | "5y" | "max" = "1y", signal?: AbortSignal): Promise<StockPriceHistory> {
  const response = await fetch(`${API_URL}/companies/${encodeURIComponent(ticker)}/price-history?range=${range}`, {
    signal,
  });
  const payload = await response.json();
  if (!response.ok) {
    throw new Error(typeof payload.detail === "string" ? payload.detail : "Price history failed.");
  }
  return payload.data as StockPriceHistory;
}
