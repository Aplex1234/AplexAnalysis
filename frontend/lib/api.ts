import type { Analysis, DcfAssumptions } from "./types";

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "/api/v1";

async function parseResponse(response: Response): Promise<Analysis> {
  const payload = await response.json();
  if (!response.ok) {
    const detail = typeof payload.detail === "string" ? payload.detail : payload.detail?.message;
    throw new Error(detail || "The research service could not complete this request.");
  }
  return payload.data as Analysis;
}

export async function fetchAnalysis(ticker: string, signal?: AbortSignal): Promise<Analysis> {
  const response = await fetch(`${API_URL}/companies/${encodeURIComponent(ticker)}/analysis`, {
    signal,
    cache: "no-store",
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
