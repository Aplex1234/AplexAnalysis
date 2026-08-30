/**
 * Company logo resolution utilities.
 * Handles ticker normalization, prioritized free CDN logo URLs,
 * and ticker-initials fallbacks.
 */

// Common ticker-to-domain mapping for high-fidelity fallback resolution
const KNOWN_DOMAINS: Record<string, string> = {
  AAPL: "apple.com",
  MSFT: "microsoft.com",
  TSLA: "tesla.com",
  MA: "mastercard.com",
  DELL: "dell.com",
  SNDK: "sandisk.com",
  WDC: "westerndigital.com",
  W: "wayfair.com",
  "BRK.A": "berkshirehathaway.com",
  "BRK.B": "berkshirehathaway.com",
  "BRK-A": "berkshirehathaway.com",
  "BRK-B": "berkshirehathaway.com",
  BRKA: "berkshirehathaway.com",
  BRKB: "berkshirehathaway.com",
  NVDA: "nvidia.com",
  COST: "costco.com",
  GOOGL: "google.com",
  GOOG: "google.com",
  AMZN: "amazon.com",
  META: "meta.com",
  INTC: "intel.com",
  AMD: "amd.com",
  IBM: "ibm.com",
  ORCL: "oracle.com",
  CRM: "salesforce.com",
  ADBE: "adobe.com",
  NFLX: "netflix.com",
  DIS: "thewaltdisneycompany.com",
  V: "visa.com",
  JPM: "jpmorganchase.com",
  BAC: "bankofamerica.com",
  WMT: "walmart.com",
  KO: "coca-colacompany.com",
  PEP: "pepsico.com",
};

/**
 * Normalizes ticker symbols for URL lookup and symbol matching.
 * e.g., "BRK.A" -> "BRK-A", "BRK/B" -> "BRK-B"
 */
export function normalizeTicker(ticker: string): string {
  if (!ticker) return "";
  return ticker.trim().toUpperCase().replace(/[./]/g, "-");
}

/**
 * Returns clean 1 to 3 letter initials for a company ticker/name fallback.
 */
export function getTickerInitials(ticker: string, name?: string): string {
  const cleanTicker = (ticker || "").trim().toUpperCase();
  if (!cleanTicker) {
    if (name) {
      const words = name.split(/\s+/).filter(Boolean);
      if (words.length >= 2) {
        return (words[0][0] + words[1][0]).toUpperCase();
      }
      return name.slice(0, 2).toUpperCase();
    }
    return "CO";
  }

  // Dual-class share special handling (e.g. BRK.A / BRK-B / BRKB -> BRK)
  if (cleanTicker.startsWith("BRK")) {
    return "BRK";
  }

  if (cleanTicker.length <= 2) {
    return cleanTicker;
  }

  // Tickers with hyphen/dot (e.g. BF.B -> BF)
  const baseSymbol = cleanTicker.split(/[-.]/)[0];
  if (baseSymbol.length <= 3) {
    return baseSymbol;
  }

  return cleanTicker.slice(0, 2);
}

/**
 * Returns prioritized array of free logo candidate image URLs.
 * Keeps loading client-side and completely separate from financial data.
 */
export function getLogoCandidates(ticker: string): string[] {
  const normalized = normalizeTicker(ticker);
  if (!normalized) return [];

  const rawTicker = ticker.trim().toUpperCase();
  const domain = KNOWN_DOMAINS[rawTicker] || KNOWN_DOMAINS[normalized];

  const candidates: string[] = [
    // Primary: High-fidelity symbol PNG from Parqet CDN
    `https://assets.parqet.com/logos/symbol/${encodeURIComponent(normalized)}?format=png`,
    // Secondary: Financial Modeling Prep stock image CDN
    `https://financialmodelingprep.com/image-stock/${encodeURIComponent(normalized)}.png`,
  ];

  // If ticker has alternative normalization (e.g. BRK.B vs BRK-B vs BRKB)
  if (rawTicker.includes(".") || rawTicker.includes("-")) {
    const solidTicker = rawTicker.replace(/[-.]/g, "");
    const dashedTicker = rawTicker.replace(/\./g, "-");
    const dottedTicker = rawTicker.replace(/-/g, ".");
    for (const alt of [dashedTicker, dottedTicker, solidTicker]) {
      if (alt !== normalized) {
        candidates.push(`https://assets.parqet.com/logos/symbol/${encodeURIComponent(alt)}?format=png`);
        candidates.push(`https://financialmodelingprep.com/image-stock/${encodeURIComponent(alt)}.png`);
      }
    }
  }

  // Domain-based fallbacks when domain is known
  if (domain) {
    candidates.push(
      `https://t1.gstatic.com/faviconV2?client=SOCIAL&type=FAVICON&fallback_opts=TYPE,SIZE,URL&url=https://${domain}&size=128`,
    );
    candidates.push(`https://icons.duckduckgo.com/ip3/${domain}.ico`);
  }

  return [...new Set(candidates)];
}

/**
 * Generates a deterministic subtle hue/background for the initials badge.
 */
export function getInitialsBadgeStyle(ticker: string): { background: string; color: string } {
  const symbol = (ticker || "AA").toUpperCase();
  let hash = 0;
  for (let i = 0; i < symbol.length; i++) {
    hash = (hash << 5) - hash + symbol.charCodeAt(i);
    hash |= 0;
  }

  const hue = Math.abs(hash) % 360;
  return {
    background: `hsl(${hue} 28% 22%)`,
    color: `hsl(${hue} 70% 88%)`,
  };
}
