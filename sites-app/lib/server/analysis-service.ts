import type { Analysis, DcfAssumptions } from "@/lib/types";
import {
  buildAnalysis,
  fetchAnalystEstimates,
  fetchComparableCompanies,
  fetchFinancialFingerprint,
  fetchFinancialSource,
  fetchQuote,
  type AnalystEstimates,
  type FinancialSource,
  type PeerSet,
  type Quote,
} from "./analysis.ts";
import {
  CACHE_TTLS,
  extendFinancialFreshness,
  hasSameFinancialFingerprint,
  listDueRefreshTickers,
  markScheduledRefresh,
  readComponentCache,
  readFinancialSourceCache,
  recordCompanyView,
  recordProviderFailure,
  writeAnalysisSnapshot,
  writeComponentCache,
  writeFinancialSourceCache,
  writePeerSelectionAudit,
  type CachedComponent,
  type CachedFinancialSource,
} from "./analysis-cache.ts";
import { COMPONENT_SOURCE_VERSIONS } from "./model-versions.ts";
import { normalizeTicker } from "./security-master.ts";

type SourceStatus = "live" | "cached" | "stale" | "unavailable";
type FreshnessItem = {
  status: SourceStatus;
  as_of: string | null;
  fresh_until: string | null;
  source: string;
};

type Loaded<T> = {
  data: T | null;
  freshness: FreshnessItem;
  cached?: CachedComponent<T> | null;
};

function freshness(status: SourceStatus, asOf: string | null, freshUntil: string | null, source: string): FreshnessItem {
  return { status, as_of: asOf, fresh_until: freshUntil, source };
}

async function loadFinancials(ticker: string): Promise<{
  data: FinancialSource | null;
  cache: CachedFinancialSource | null;
  freshness: FreshnessItem;
  warnings: string[];
}> {
  const cached = await readFinancialSourceCache(ticker);
  if (cached?.isFresh) {
    return {
      data: cached.source,
      cache: cached,
      freshness: freshness("cached", cached.sourceFilingAt ?? cached.normalizedAt, cached.freshUntil, "Normalized SEC cache"),
      warnings: [],
    };
  }

  if (cached) {
    try {
      const fingerprint = await fetchFinancialFingerprint(ticker);
      if (hasSameFinancialFingerprint(cached, fingerprint)) {
        const extended = await extendFinancialFreshness(ticker, cached, fingerprint);
        return {
          data: extended.source,
          cache: extended,
          freshness: freshness("cached", extended.sourceFilingAt ?? extended.normalizedAt, extended.freshUntil, "Normalized SEC cache; filing unchanged"),
          warnings: [],
        };
      }
    } catch (error) {
      await recordProviderFailure(ticker, "financials", error, cached.listingId);
      return {
        data: cached.source,
        cache: cached,
        freshness: freshness("stale", cached.sourceFilingAt ?? cached.normalizedAt, cached.freshUntil, "Last successful normalized SEC cache"),
        warnings: ["The SEC freshness check was unavailable. Showing the last successfully normalized filing data."],
      };
    }
  }

  try {
    const source = await fetchFinancialSource(ticker);
    const stored = await writeFinancialSourceCache(ticker, source);
    return {
      data: source,
      cache: null,
      freshness: freshness("live", stored?.fingerprint.filingDate ?? source.periods.at(-1)?.filed_at ?? null, stored?.freshUntil ?? null, "SEC EDGAR normalized now"),
      warnings: [],
    };
  } catch (error) {
    if (cached) {
      await recordProviderFailure(ticker, "financials", error, cached.listingId);
      return {
        data: cached.source,
        cache: cached,
        freshness: freshness("stale", cached.sourceFilingAt ?? cached.normalizedAt, cached.freshUntil, "Last successful normalized SEC cache"),
        warnings: ["A newer SEC filing may exist, but refresh failed. Showing the last successful normalized data."],
      };
    }
    await recordProviderFailure(ticker, "financials", error);
    return {
      data: null,
      cache: null,
      freshness: freshness("unavailable", null, null, "SEC financials unavailable"),
      warnings: [],
    };
  }
}

async function loadQuote(ticker: string, financials: FinancialSource | null): Promise<Loaded<Quote>> {
  const cached = await readComponentCache<Quote>(ticker, "quote", COMPONENT_SOURCE_VERSIONS.quote);
  if (cached?.isFresh) return { data: cached.data, cached, freshness: freshness("cached", cached.data.as_of, cached.freshUntil, cached.provider ?? "Cached quote") };
  const refreshStartedAt = Date.now();
  try {
    const quote = await fetchQuote(ticker);
    const stored = financials
      ? await writeComponentCache(ticker, financials.profile, "quote", quote, COMPONENT_SOURCE_VERSIONS.quote, CACHE_TTLS.quote, quote.provider, refreshStartedAt)
      : null;
    return { data: quote, freshness: freshness("live", quote.as_of, stored?.freshUntil ?? null, quote.provider) };
  } catch (error) {
    await recordProviderFailure(ticker, "quote", error, cached?.listingId);
    if (cached) return { data: cached.data, cached, freshness: freshness("stale", cached.data.as_of, cached.freshUntil, cached.provider ?? "Last successful quote") };
    return { data: null, freshness: freshness("unavailable", null, null, "Quote unavailable") };
  }
}

async function loadEstimates(ticker: string, financials: FinancialSource | null): Promise<Loaded<AnalystEstimates>> {
  const cached = await readComponentCache<AnalystEstimates>(ticker, "analyst_estimates", COMPONENT_SOURCE_VERSIONS.analyst_estimates);
  if (cached?.isFresh) return { data: cached.data, cached, freshness: freshness("cached", cached.data.as_of, cached.freshUntil, cached.provider ?? "Cached analyst estimates") };
  const refreshStartedAt = Date.now();
  try {
    const estimates = await fetchAnalystEstimates(ticker);
    const stored = financials
      ? await writeComponentCache(ticker, financials.profile, "analyst_estimates", estimates, COMPONENT_SOURCE_VERSIONS.analyst_estimates, CACHE_TTLS.analyst_estimates, estimates.provider, refreshStartedAt)
      : null;
    return { data: estimates, freshness: freshness("live", estimates.as_of, stored?.freshUntil ?? null, estimates.provider) };
  } catch (error) {
    await recordProviderFailure(ticker, "analyst_estimates", error, cached?.listingId);
    if (cached) return { data: cached.data, cached, freshness: freshness("stale", cached.data.as_of, cached.freshUntil, cached.provider ?? "Last successful estimates") };
    return { data: null, freshness: freshness("unavailable", null, null, "Analyst estimates unavailable") };
  }
}

async function loadPeers(
  ticker: string,
  financials: FinancialSource | null,
  quote: Quote | null,
): Promise<Loaded<PeerSet>> {
  const cached = await readComponentCache<PeerSet>(ticker, "comps", COMPONENT_SOURCE_VERSIONS.comps);
  if (cached?.isFresh) return { data: cached.data, cached, freshness: freshness("cached", cached.fetchedAt, cached.freshUntil, cached.data.methodology) };
  if (!financials) return { data: cached?.data ?? null, cached, freshness: cached ? freshness("stale", cached.fetchedAt, cached.freshUntil, cached.data.methodology) : freshness("unavailable", null, null, "Comparable companies unavailable") };
  const refreshStartedAt = Date.now();
  try {
    const peerSet = await fetchComparableCompanies(
      ticker,
      financials.profile,
      quote?.market_cap ?? null,
      financials.filings,
    );
    const stored = await writeComponentCache(ticker, financials.profile, "comps", peerSet, COMPONENT_SOURCE_VERSIONS.comps, CACHE_TTLS.comps, "AplexAnalysis comps engine", refreshStartedAt);
    await writePeerSelectionAudit(ticker, financials.profile, peerSet);
    return { data: peerSet, freshness: freshness("live", stored?.fetchedAt ?? new Date().toISOString(), stored?.freshUntil ?? null, peerSet.methodology) };
  } catch (error) {
    await recordProviderFailure(ticker, "comps", error, cached?.listingId);
    if (cached) return { data: cached.data, cached, freshness: freshness("stale", cached.fetchedAt, cached.freshUntil, cached.data.methodology) };
    return {
      data: {
        companies: [],
        methodology: "Comparable-company retrieval was unavailable",
        source_provider: "Unavailable",
        source_url: "https://www.nasdaq.com/market-activity/stocks/screener",
        source_as_of: new Date().toISOString(),
        candidates_considered: 0,
        selection_version: COMPONENT_SOURCE_VERSIONS.comps,
      },
      freshness: freshness("unavailable", null, null, "Comparable-company retrieval unavailable"),
    };
  }
}

function attachFreshness(
  analysis: Analysis,
  pageStatus: "live" | "cached" | "refreshing" | "stale",
  items: {
    financials: FreshnessItem;
    quote: FreshnessItem;
    analystEstimates: FreshnessItem;
    comps: FreshnessItem;
  },
) {
  return {
    ...analysis,
    freshness: {
      page_status: pageStatus,
      financials: items.financials,
      quote: items.quote,
      analyst_estimates: items.analystEstimates,
      comps: items.comps,
      summary: freshness(
        analysis.company.description_source === "AplexAnalysis summary" ? "cached" : "live",
        null,
        null,
        analysis.company.description_source,
      ),
    },
  } satisfies Analysis;
}

export function markSnapshotFreshness(analysis: Analysis, status: "cached" | "refreshing" | "stale") {
  if (!analysis.freshness) return analysis;
  const markCachedSource = (item: FreshnessItem): FreshnessItem => ({
    ...item,
    status: item.status === "unavailable"
      ? "unavailable"
      : item.fresh_until && Date.parse(item.fresh_until) <= Date.now()
        ? "stale"
        : "cached",
  });
  return {
    ...analysis,
    freshness: {
      page_status: status,
      financials: markCachedSource(analysis.freshness.financials),
      quote: markCachedSource(analysis.freshness.quote),
      analyst_estimates: markCachedSource(analysis.freshness.analyst_estimates),
      comps: markCachedSource(analysis.freshness.comps),
      summary: markCachedSource(analysis.freshness.summary),
    },
  };
}

export async function rebuildAnalysisFromComponentCaches(
  rawTicker: string,
  requested?: Partial<DcfAssumptions>,
  persistSnapshot = requested == null,
) {
  const ticker = normalizeTicker(rawTicker);
  const financials = await loadFinancials(ticker);
  const [quote, estimates] = await Promise.all([
    loadQuote(ticker, financials.data),
    loadEstimates(ticker, financials.data),
  ]);
  const peers = await loadPeers(ticker, financials.data, quote.data);
  const analysis = await buildAnalysis(ticker, requested, {
    financials: financials.data ?? undefined,
    financialSourceMode: financials.data ? (financials.freshness.status === "live" ? "live-sec" : "normalized-cache") : undefined,
    quote: quote.data ?? undefined,
    analystEstimates: estimates.data ?? undefined,
    peerSet: peers.data ?? undefined,
    warnings: financials.warnings,
  });
  const pageStatus = [financials.freshness, quote.freshness, estimates.freshness, peers.freshness]
    .some((item) => item.status === "stale") ? "stale" : "live";
  const enriched = attachFreshness(analysis, pageStatus, {
    financials: financials.freshness,
    quote: quote.freshness,
    analystEstimates: estimates.freshness,
    comps: peers.freshness,
  });
  if (persistSnapshot) {
    const stored = await writeAnalysisSnapshot(enriched);
    if (stored) await recordCompanyView(ticker, stored.listingId);
  }
  return enriched;
}

export async function refreshDueCompanies(limit = 3, excludeTicker?: string) {
  const due = await listDueRefreshTickers(limit, excludeTicker);
  for (const item of due) {
    try {
      await rebuildAnalysisFromComponentCaches(item.ticker);
      await markScheduledRefresh(item.listing_id, true);
    } catch {
      await markScheduledRefresh(item.listing_id, false);
    }
  }
  return due.length;
}
