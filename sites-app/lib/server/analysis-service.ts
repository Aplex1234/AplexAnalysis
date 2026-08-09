import type { Analysis, AnalysisSection, DcfAssumptions } from "@/lib/types";
import {
  buildAnalysis,
  fetchAnalystEstimates,
  fetchCompanyRisks,
  fetchComparableCompanies,
  fetchFinancialFingerprint,
  fetchFinancialSource,
  fetchPopularUniverseTickers,
  fetchQuote,
  type AnalystEstimates,
  type CompanyRisk,
  type FinancialSource,
  type PeerSet,
  type Quote,
} from "./analysis.ts";
import {
  acquireCacheRefreshLease,
  CACHE_TTLS,
  extendFinancialFreshness,
  hasSameFinancialFingerprint,
  listDueRefreshTickers,
  listUncachedTickers,
  markScheduledRefresh,
  readComponentCache,
  readFinancialSourceCache,
  recordCompanyViewInBackground,
  recordProviderFailure,
  releaseCacheRefreshLease,
  scheduleBackgroundRefresh,
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

export const ALL_ANALYSIS_SECTIONS: AnalysisSection[] = [
  "overview", "financials", "valuation", "buyTarget", "comps", "earnings", "filings", "risks", "research",
];

function freshness(status: SourceStatus, asOf: string | null, freshUntil: string | null, source: string): FreshnessItem {
  return { status, as_of: asOf, fresh_until: freshUntil, source };
}

async function scheduleSharedRefresh(cacheKey: string, task: () => Promise<unknown>) {
  if (!await acquireCacheRefreshLease(cacheKey)) return false;
  const guarded = task().finally(() => releaseCacheRefreshLease(cacheKey));
  if (!await scheduleBackgroundRefresh(guarded)) void guarded.catch(() => undefined);
  return true;
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
    const source = await fetchFinancialSource(ticker, false);
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
  if (cached) {
    await scheduleSharedRefresh(`quote:${ticker}`, async () => {
      try {
        const quote = await fetchQuote(ticker);
        if (financials) await writeComponentCache(ticker, financials.profile, "quote", quote, COMPONENT_SOURCE_VERSIONS.quote, CACHE_TTLS.quote, quote.provider, Date.now());
      } catch (error) {
        await recordProviderFailure(ticker, "quote", error, cached.listingId);
      }
    });
    return { data: cached.data, cached, freshness: freshness("stale", cached.data.as_of, cached.freshUntil, cached.provider ?? "Last successful quote; refreshing") };
  }
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
  if (cached) {
    await scheduleSharedRefresh(`analyst-estimates:${ticker}`, async () => {
      try {
        const estimates = await fetchAnalystEstimates(ticker);
        if (financials) await writeComponentCache(ticker, financials.profile, "analyst_estimates", estimates, COMPONENT_SOURCE_VERSIONS.analyst_estimates, CACHE_TTLS.analyst_estimates, estimates.provider, Date.now());
      } catch (error) {
        await recordProviderFailure(ticker, "analyst_estimates", error, cached.listingId);
      }
    });
    return { data: cached.data, cached, freshness: freshness("stale", cached.data.as_of, cached.freshUntil, cached.provider ?? "Last successful estimates; refreshing") };
  }
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

function annualRiskVersion(financials: FinancialSource) {
  const annual = financials.filings.find((filing) => ["10-K", "20-F", "40-F"].includes(filing.form));
  return {
    annual,
    sourceVersion: `${COMPONENT_SOURCE_VERSIONS.risks}:${annual?.accession_number || "none"}`,
  };
}

async function loadRisks(ticker: string, financials: FinancialSource | null): Promise<Loaded<CompanyRisk[]>> {
  if (!financials) return { data: null, freshness: freshness("unavailable", null, null, "Annual filing risks unavailable") };
  const { annual, sourceVersion } = annualRiskVersion(financials);
  if (!annual) return { data: [], freshness: freshness("unavailable", null, null, "No annual filing available") };
  const cached = await readComponentCache<CompanyRisk[]>(ticker, "risks", sourceVersion);
  if (cached?.isFresh) return { data: cached.data, cached, freshness: freshness("cached", annual.filing_date, cached.freshUntil, cached.provider ?? "Cached annual filing risks") };
  if (cached) {
    await scheduleSharedRefresh(`risks:${ticker}:${annual.accession_number}`, async () => {
      try {
        const risks = await fetchCompanyRisks(financials);
        await writeComponentCache(ticker, financials.profile, "risks", risks, sourceVersion, CACHE_TTLS.risks, "SEC annual filing", Date.now());
      } catch (error) {
        await recordProviderFailure(ticker, "risks", error, cached.listingId);
      }
    });
    return { data: cached.data, cached, freshness: freshness("stale", annual.filing_date, cached.freshUntil, cached.provider ?? "Last successful annual filing risks; refreshing") };
  }
  const refreshStartedAt = Date.now();
  try {
    const risks = financials.filingRisks.length ? financials.filingRisks : await fetchCompanyRisks(financials);
    const stored = await writeComponentCache(ticker, financials.profile, "risks", risks, sourceVersion, CACHE_TTLS.risks, "SEC annual filing", refreshStartedAt);
    return { data: risks, freshness: freshness("live", annual.filing_date, stored?.freshUntil ?? null, "SEC annual filing") };
  } catch (error) {
    await recordProviderFailure(ticker, "risks", error, cached?.listingId);
    if (cached) return { data: cached.data, cached, freshness: freshness("stale", annual.filing_date, cached.freshUntil, cached.provider ?? "Last successful annual filing risks") };
    return { data: [], freshness: freshness("unavailable", annual.filing_date, null, "Annual filing risks unavailable") };
  }
}

async function fetchAndStorePeers(
  ticker: string,
  financials: FinancialSource,
  quote: Quote | null,
): Promise<Loaded<PeerSet>> {
  const refreshStartedAt = Date.now();
  const peerSet = await fetchComparableCompanies(
    ticker,
    financials.profile,
    quote?.market_cap ?? null,
    financials.filings,
    async (peerTicker) => {
      const peerFinancials = await loadFinancials(peerTicker);
      if (!peerFinancials.data) throw new Error(`Financial data unavailable for ${peerTicker}`);
      const peerQuote = await loadQuote(peerTicker, peerFinancials.data);
      if (!peerQuote.data) throw new Error(`Quote unavailable for ${peerTicker}`);
      return { financials: peerFinancials.data, quote: peerQuote.data };
    },
  );
  const stored = await writeComponentCache(ticker, financials.profile, "comps", peerSet, COMPONENT_SOURCE_VERSIONS.comps, CACHE_TTLS.comps, "AplexAnalysis comps engine", refreshStartedAt);
  await writePeerSelectionAudit(ticker, financials.profile, peerSet);
  return { data: peerSet, freshness: freshness("live", stored?.fetchedAt ?? new Date().toISOString(), stored?.freshUntil ?? null, peerSet.methodology) };
}

async function loadPeers(
  ticker: string,
  financials: FinancialSource | null,
  quote: Quote | null,
): Promise<Loaded<PeerSet>> {
  const cached = await readComponentCache<PeerSet>(ticker, "comps", COMPONENT_SOURCE_VERSIONS.comps);
  if (cached?.isFresh) return { data: cached.data, cached, freshness: freshness("cached", cached.fetchedAt, cached.freshUntil, cached.data.methodology) };
  if (!financials) return { data: cached?.data ?? null, cached, freshness: cached ? freshness("stale", cached.fetchedAt, cached.freshUntil, cached.data.methodology) : freshness("unavailable", null, null, "Comparable companies unavailable") };
  if (cached) {
    await scheduleSharedRefresh(`comps:${ticker}`, async () => {
      try {
        await fetchAndStorePeers(ticker, financials, quote);
      } catch (error) {
        await recordProviderFailure(ticker, "comps", error, cached.listingId);
      }
    });
    return { data: cached.data, cached, freshness: freshness("stale", cached.fetchedAt, cached.freshUntil, `${cached.data.methodology}; refreshing`) };
  }
  try {
    return await fetchAndStorePeers(ticker, financials, quote);
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

export function buildOverviewSnapshot(analysis: Analysis): Analysis {
  return {
    ...analysis,
    data_scope: "overview",
    loaded_sections: ["overview"],
    financials: analysis.financials.map((period) => ({
      ...period,
      values: {
        revenue: period.values.revenue,
        operating_income: period.values.operating_income,
        free_cash_flow: period.values.free_cash_flow,
      },
      provenance: {},
    })),
    quarterly_financials: [],
    analyst_estimates: {
      quarterly: [],
      annual: [],
      provider: analysis.analyst_estimates.provider,
      as_of: analysis.analyst_estimates.as_of,
      source_url: analysis.analyst_estimates.source_url,
      disclosure: analysis.analyst_estimates.disclosure,
    },
    comps: [],
    filings: [],
    risks: [],
  };
}

export function buildSectionSnapshot(analysis: Analysis, section: AnalysisSection): Analysis {
  if (section === "overview") return buildOverviewSnapshot(analysis);
  const overview = buildOverviewSnapshot(analysis);
  const needsDetailedFinancials = ["financials", "valuation", "buyTarget"].includes(section);
  return {
    ...overview,
    data_scope: "partial",
    loaded_sections: ["overview", section],
    financials: needsDetailedFinancials ? analysis.financials : overview.financials,
    quarterly_financials: needsDetailedFinancials ? analysis.quarterly_financials : [],
    analyst_estimates: section === "earnings" ? analysis.analyst_estimates : overview.analyst_estimates,
    comps: section === "comps" ? analysis.comps : [],
    filings: section === "filings" ? analysis.filings : [],
    risks: section === "risks" ? analysis.risks : [],
  };
}

function emptyEstimates(ticker: string): AnalystEstimates {
  return {
    quarterly: [],
    annual: [],
    provider: "Not loaded for Overview",
    as_of: null,
    source_url: `https://www.nasdaq.com/market-activity/stocks/${ticker.toLowerCase()}/earnings`,
    disclosure: "Analyst estimates load when the Earnings section is opened.",
  };
}

function emptyPeerSet(): PeerSet {
  return {
    companies: [],
    methodology: "Comparable companies load separately from Overview",
    source_provider: "Not loaded for Overview",
    source_url: "https://www.nasdaq.com/market-activity/stocks/screener",
    source_as_of: new Date().toISOString(),
    candidates_considered: 0,
    selection_version: COMPONENT_SOURCE_VERSIONS.comps,
  };
}

export async function rebuildOverviewFromComponentCaches(rawTicker: string) {
  const ticker = normalizeTicker(rawTicker);
  const financials = await loadFinancials(ticker);
  const quote = await loadQuote(ticker, financials.data);
  const analysis = await buildAnalysis(ticker, undefined, {
    financials: financials.data ?? undefined,
    financialSourceMode: financials.data ? (financials.freshness.status === "live" ? "live-sec" : "normalized-cache") : undefined,
    quote: quote.data ?? undefined,
    analystEstimates: emptyEstimates(ticker),
    peerSet: emptyPeerSet(),
    warnings: financials.warnings,
  });
  const enriched = attachFreshness(analysis, [financials.freshness, quote.freshness].some((item) => item.status === "stale") ? "stale" : "live", {
    financials: financials.freshness,
    quote: quote.freshness,
    analystEstimates: freshness("unavailable", null, null, "Loads with Earnings"),
    comps: freshness("unavailable", null, null, "Loads with Comps"),
  });
  if (financials.cache?.listingId) await recordCompanyViewInBackground(ticker, financials.cache.listingId);
  return buildOverviewSnapshot(enriched);
}

export async function rebuildAnalysisSectionFromComponentCaches(rawTicker: string, section: AnalysisSection) {
  if (section === "overview") return rebuildOverviewFromComponentCaches(rawTicker);
  const ticker = normalizeTicker(rawTicker);
  const financials = await loadFinancials(ticker);
  const quote = await loadQuote(ticker, financials.data);
  const estimates = section === "earnings"
    ? await loadEstimates(ticker, financials.data)
    : { data: emptyEstimates(ticker), freshness: freshness("unavailable", null, null, "Loads with Earnings") };
  const peers = section === "comps"
    ? await loadPeers(ticker, financials.data, quote.data)
    : { data: emptyPeerSet(), freshness: freshness("unavailable", null, null, "Loads with Comps") };
  const risks = section === "risks"
    ? await loadRisks(ticker, financials.data)
    : { data: [] as CompanyRisk[], freshness: freshness("unavailable", null, null, "Loads with Risks") };
  const financialsForSection = financials.data
    ? { ...financials.data, filingRisks: risks.data ?? [] }
    : undefined;
  const analysis = await buildAnalysis(ticker, undefined, {
    financials: financialsForSection,
    financialSourceMode: financials.data ? (financials.freshness.status === "live" ? "live-sec" : "normalized-cache") : undefined,
    quote: quote.data ?? undefined,
    analystEstimates: estimates.data ?? emptyEstimates(ticker),
    peerSet: peers.data ?? emptyPeerSet(),
    warnings: financials.warnings,
  });
  const pageStatus = [financials.freshness, quote.freshness, estimates.freshness, peers.freshness, risks.freshness]
    .some((item) => item.status === "stale") ? "stale" : "live";
  const enriched = attachFreshness(analysis, pageStatus, {
    financials: financials.freshness,
    quote: quote.freshness,
    analystEstimates: estimates.freshness,
    comps: peers.freshness,
  });
  return buildSectionSnapshot(enriched, section);
}

export async function rebuildAnalysisFromComponentCaches(
  rawTicker: string,
  requested?: Partial<DcfAssumptions>,
  persistSnapshot = requested == null,
) {
  const ticker = normalizeTicker(rawTicker);
  const financials = await loadFinancials(ticker);
  const [quote, estimates, risks] = await Promise.all([
    loadQuote(ticker, financials.data),
    loadEstimates(ticker, financials.data),
    loadRisks(ticker, financials.data),
  ]);
  const peers = await loadPeers(ticker, financials.data, quote.data);
  const financialsWithRisks = financials.data
    ? { ...financials.data, filingRisks: risks.data ?? [] }
    : undefined;
  const analysis = await buildAnalysis(ticker, requested, {
    financials: financialsWithRisks,
    financialSourceMode: financials.data ? (financials.freshness.status === "live" ? "live-sec" : "normalized-cache") : undefined,
    quote: quote.data ?? undefined,
    analystEstimates: estimates.data ?? undefined,
    peerSet: peers.data ?? undefined,
    warnings: financials.warnings,
  });
  const pageStatus = [financials.freshness, quote.freshness, estimates.freshness, peers.freshness, risks.freshness]
    .some((item) => item.status === "stale") ? "stale" : "live";
  const enriched = attachFreshness(analysis, pageStatus, {
    financials: financials.freshness,
    quote: quote.freshness,
    analystEstimates: estimates.freshness,
    comps: peers.freshness,
  });
  const complete = { ...enriched, data_scope: "full" as const, loaded_sections: ALL_ANALYSIS_SECTIONS };
  if (persistSnapshot) {
    const stored = await writeAnalysisSnapshot(complete);
    if (stored) await recordCompanyViewInBackground(ticker, stored.listingId);
  }
  return complete;
}

export async function refreshDueCompanies(limit = 3, excludeTicker?: string) {
  const due = await listDueRefreshTickers(limit, excludeTicker);
  for (const item of due) {
    try {
      await rebuildOverviewFromComponentCaches(item.ticker);
      await markScheduledRefresh(item.listing_id, true);
    } catch {
      await markScheduledRefresh(item.listing_id, false);
    }
  }
  return due.length;
}

export async function warmPopularCompanies(seedSize = 100, batchSize = 2) {
  const popularTickers = await fetchPopularUniverseTickers(seedSize);
  const uncached = await listUncachedTickers(popularTickers, batchSize);
  let warmed = 0;
  for (const ticker of uncached) {
    const leaseKey = `overview:${ticker}`;
    if (!await acquireCacheRefreshLease(leaseKey, 60_000)) continue;
    try {
      await rebuildOverviewFromComponentCaches(ticker);
      warmed += 1;
    } catch {
      // Another scheduled pass can retry without blocking the rest of the batch.
    } finally {
      await releaseCacheRefreshLease(leaseKey);
    }
  }
  return warmed;
}
