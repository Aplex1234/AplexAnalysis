export type SecuritySearchResult = {
  issuer_id: string;
  security_id: string;
  listing_id: string;
  ticker: string;
  name: string;
  cik: string;
  exchange: string;
  mic: string;
  security_type: "Equity";
  coverage: "SEC filer" | "Bundled fallback";
};

type ExchangePayload = { fields?: unknown; data?: unknown };

const SEC_SECURITY_MASTER_URL = "https://www.sec.gov/files/company_tickers_exchange.json";
const CACHE_TTL_MS = 6 * 60 * 60 * 1000;

const EXCHANGE_MIC: Record<string, string> = {
  NASDAQ: "XNAS",
  NYSE: "XNYS",
  "NYSE AMERICAN": "XASE",
  "NYSE ARCA": "ARCX",
  CBOE: "BATS",
  OTC: "OTCM",
};

const FALLBACK_ROWS: Array<[number, string, string, string]> = [
  [320193, "Apple Inc.", "AAPL", "Nasdaq"],
  [1045810, "NVIDIA Corporation", "NVDA", "Nasdaq"],
  [909832, "Costco Wholesale Corporation", "COST", "Nasdaq"],
  [1141391, "Mastercard Incorporated", "MA", "NYSE"],
];

const COMPANY_LEGAL_SUFFIXES = new Set([
  "AG", "CO", "COMPANY", "CORP", "CORPORATION", "INC", "INCORPORATED",
  "LIMITED", "LLC", "LLP", "LP", "LTD", "NV", "PBC", "PLC", "SA", "SE",
]);

let cachedMaster: { expiresAt: number; entries: SecuritySearchResult[] } | null = null;

export function normalizeTicker(value: string): string {
  return value.trim().toUpperCase().replace(/[./\s]+/g, "-");
}

function identifierToken(value: string): string {
  return value.toUpperCase().replace(/[^A-Z0-9]+/g, "-").replace(/^-|-$/g, "").toLowerCase();
}

function baseCompanyName(value: string): string {
  const tokens = value.toUpperCase().match(/[A-Z0-9]+/g) ?? [];
  while (tokens.length > 1 && COMPANY_LEGAL_SUFFIXES.has(tokens[tokens.length - 1])) tokens.pop();
  return tokens.join(" ");
}

function securityIdentity(
  cik: number | string,
  name: string,
  ticker: string,
  exchange: string,
  coverage: SecuritySearchResult["coverage"] = "SEC filer",
): SecuritySearchResult {
  const normalizedCik = String(cik).padStart(10, "0");
  const normalizedTicker = normalizeTicker(ticker);
  const normalizedExchange = exchange.trim() || "Unknown";
  const mic = EXCHANGE_MIC[normalizedExchange.toUpperCase()] ?? (identifierToken(normalizedExchange) || "unknown");
  const tickerToken = identifierToken(normalizedTicker);
  return {
    issuer_id: `sec-cik:${normalizedCik}`,
    security_id: `sec-cik:${normalizedCik}:equity:${tickerToken}`,
    listing_id: `listing:${mic.toLowerCase()}:${tickerToken}`,
    ticker: normalizedTicker,
    name: name.trim(),
    cik: normalizedCik,
    exchange: normalizedExchange,
    mic,
    security_type: "Equity",
    coverage,
  };
}

export function parseSecurityMaster(payload: ExchangePayload): SecuritySearchResult[] {
  if (!Array.isArray(payload.fields) || !Array.isArray(payload.data)) return [];
  const fields = payload.fields.map(String);
  const indexes = Object.fromEntries(fields.map((field, index) => [field, index]));
  if (["cik", "name", "ticker", "exchange"].some((field) => indexes[field] == null)) return [];

  return payload.data.flatMap((rawRow) => {
    if (!Array.isArray(rawRow) || rawRow.length < fields.length) return [];
    return [
      securityIdentity(
        String(rawRow[indexes.cik]),
        String(rawRow[indexes.name]),
        String(rawRow[indexes.ticker]),
        String(rawRow[indexes.exchange] ?? "Unknown"),
      ),
    ];
  });
}

export function searchSecurityEntries(
  entries: SecuritySearchResult[],
  query: string,
  limit = 8,
): SecuritySearchResult[] {
  const needle = query.trim().toUpperCase();
  const tickerNeedle = normalizeTicker(query);
  const compactNeedle = identifierToken(query);
  const baseNameNeedle = baseCompanyName(query);

  return entries
    .flatMap((entry) => {
      const compactTicker = identifierToken(entry.ticker);
      const upperName = entry.name.toUpperCase();
      const baseName = baseCompanyName(entry.name);
      let rank: number;
      if (entry.ticker === tickerNeedle || compactTicker === compactNeedle) rank = 0;
      else if (entry.ticker.startsWith(tickerNeedle) || compactTicker.startsWith(compactNeedle)) rank = 1;
      else if (upperName === needle || baseName === baseNameNeedle) rank = 2;
      else if (upperName.startsWith(needle)) rank = 3;
      else if (upperName.includes(needle)) rank = 4;
      else return [];
      return [{ entry, rank }];
    })
    .sort((left, right) => left.rank - right.rank || left.entry.ticker.length - right.entry.ticker.length || left.entry.ticker.localeCompare(right.entry.ticker))
    .slice(0, Math.max(1, Math.min(limit, 20)))
    .map(({ entry }) => entry);
}

async function loadSecurityMaster(): Promise<SecuritySearchResult[]> {
  if (cachedMaster && cachedMaster.expiresAt > Date.now()) return cachedMaster.entries;

  try {
    const response = await fetch(SEC_SECURITY_MASTER_URL, {
      headers: {
        "User-Agent": process.env.SEC_USER_AGENT ?? "AplexAnalysis/0.1 research@aplexanalysis.app",
        Accept: "application/json",
      },
      signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok) throw new Error(`SEC security master returned ${response.status}`);
    const entries = parseSecurityMaster((await response.json()) as ExchangePayload);
    if (!entries.length) throw new Error("SEC security master was empty");
    cachedMaster = { entries, expiresAt: Date.now() + CACHE_TTL_MS };
    return entries;
  } catch {
    const entries = FALLBACK_ROWS.map(([cik, name, ticker, exchange]) =>
      securityIdentity(cik, name, ticker, exchange, "Bundled fallback"),
    );
    cachedMaster = { entries, expiresAt: Date.now() + 5 * 60 * 1000 };
    return entries;
  }
}

export async function searchSecurities(query: string, limit = 8): Promise<SecuritySearchResult[]> {
  if (!query.trim()) return [];
  return searchSecurityEntries(await loadSecurityMaster(), query, limit);
}

export async function resolveSecurity(ticker: string): Promise<SecuritySearchResult> {
  const normalized = normalizeTicker(ticker);
  const match = (await loadSecurityMaster()).find((entry) => entry.ticker === normalized);
  if (!match) throw new Error(`Ticker ${normalized} was not found in the SEC company list`);
  return match;
}
