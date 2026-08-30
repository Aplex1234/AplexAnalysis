import assert from "node:assert/strict";
import { readFile, readdir, stat } from "node:fs/promises";
import test from "node:test";

import { buildFinancialChartData, formatBillions } from "../../frontend/lib/chart.ts";
import { compactShares } from "../../frontend/lib/format.ts";
import { buildFinancialExplorerData, buildFinancialGrowthData, financialGrowthValue, FINANCIAL_GROUPS, formatScaledMoney, getFinancialScale } from "../../frontend/lib/financials.ts";
import { projectMultipleValuation } from "../../frontend/lib/multiple-valuation.ts";
import { analysisSectionPanelState, mergeAnalysisSection } from "../../frontend/lib/analysis-sections.ts";
import { normalizeCompanyFacts, normalizeQuarterlyCompanyFacts } from "../lib/server/sec-normalizer.ts";
import { calculatePegProjection } from "../lib/server/peg.ts";
import { extractRiskFactorHeadings, extractRiskFactorThemes } from "../lib/server/risk-factors.ts";
import { summarizeCompanyDescription } from "../lib/server/company-description.ts";
import { cacheIdentity, hasSameFinancialFingerprint, isAnalysisCacheCompatible, parseCachedAnalysisRow } from "../lib/server/analysis-cache.ts";
import { buildAnalysis, fetchCompanyRisks } from "../lib/server/analysis.ts";
import { buildOverviewSnapshot, buildSectionSnapshot } from "../lib/server/analysis-service.ts";
import { ANALYSIS_SCHEMA_VERSION, COMPONENT_SOURCE_VERSIONS, NORMALIZATION_VERSION, SCORE_MODEL_VERSION, VALUATION_MODEL_VERSION } from "../lib/server/model-versions.ts";
import { extractPeerBusinessContext, rankPeerCandidates } from "../lib/server/peer-selection.ts";
import { fetchCompanyNews } from "../lib/server/news.ts";
import { getInitialsBadgeStyle, getLogoCandidates, getTickerInitials, normalizeTicker } from "../../frontend/lib/logo.ts";
import { parseSecurityMaster, searchSecurityEntries } from "../lib/server/security-master.ts";

async function render() {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("test", `${process.pid}-${Date.now()}`);
  const { default: worker } = await import(workerUrl.href);

  return worker.fetch(
    new Request("http://localhost/", { headers: { accept: "text/html" } }),
    { ASSETS: { fetch: async () => new Response("Not found", { status: 404 }) } },
    { waitUntil() {}, passThroughOnException() {} },
  );
}

test("keeps the initial terminal and stylesheet within performance budgets", async () => {
  const chunkDirectory = new URL("../dist/client/_next/static/chunks/", import.meta.url);
  const cssDirectory = new URL("../dist/client/_next/static/css/", import.meta.url);
  const chunks = await readdir(chunkDirectory);
  const stylesheets = await readdir(cssDirectory);
  const terminalChunk = chunks.find((file) => file.startsWith("ResearchTerminal-") && file.endsWith(".js"));
  assert.ok(terminalChunk, "ResearchTerminal chunk was not emitted");
  const terminalSize = (await stat(new URL(terminalChunk, chunkDirectory))).size;
  const cssSizes = await Promise.all(stylesheets.filter((file) => file.endsWith(".css")).map(async (file) => (await stat(new URL(file, cssDirectory))).size));
  assert.ok(terminalSize < 100 * 1024, `ResearchTerminal exceeded 100 KB: ${terminalSize}`);
  assert.ok(Math.max(...cssSizes) < 400 * 1024, `Stylesheet exceeded 400 KB: ${Math.max(...cssSizes)}`);
});

test("keeps valuation outputs per-share when SEC share counts are unavailable", async () => {
  const makePeriod = (fiscalYear, values) => ({
    fiscal_year: fiscalYear,
    period_type: "FY",
    period_end: `${fiscalYear}-12-31`,
    filed_at: `${fiscalYear + 1}-02-28`,
    accession_number: `brk-${fiscalYear}`,
    form: "10-K",
    currency: "USD",
    values,
    provenance: {},
  });
  const price = 500;
  const marketCap = 1_000_000_000_000;
  const analysis = await buildAnalysis("BRK-B", undefined, {
    financials: {
      profile: {
        cik: "0001067983",
        name: "Berkshire Hathaway Inc.",
        sector: "Financials",
        industry: "Multi-Sector Holdings",
        exchange: "NYSE",
        description: "Berkshire owns a diversified group of operating businesses.",
        description_source: "Test fixture",
        description_source_url: "https://www.sec.gov/edgar/browse/?CIK=1067983&owner=exclude",
      },
      periods: [
        makePeriod(2024, {
          revenue: 360_000_000_000,
          gross_profit: 90_000_000_000,
          operating_income: 45_000_000_000,
          net_income: 60_000_000_000,
          operating_cash_flow: 48_000_000_000,
          capex: 8_000_000_000,
          free_cash_flow: 40_000_000_000,
          cash: 160_000_000_000,
          long_term_debt: 120_000_000_000,
          equity: 560_000_000_000,
        }),
        makePeriod(2025, {
          revenue: 380_000_000_000,
          gross_profit: 96_000_000_000,
          operating_income: 50_000_000_000,
          net_income: 67_000_000_000,
          operating_cash_flow: 53_000_000_000,
          capex: 9_000_000_000,
          free_cash_flow: 44_000_000_000,
          cash: 180_000_000_000,
          long_term_debt: 125_000_000_000,
          equity: 620_000_000_000,
        }),
      ],
      quarterlyPeriods: [],
      filings: [],
      filingRisks: [],
    },
    quote: {
      price,
      market_cap: marketCap,
      as_of: "2026-08-13T00:00:00.000Z",
      currency: "USD",
      provider: "Test quote",
      source_url: null,
      is_delayed: true,
    },
    peerSet: {
      companies: [],
      methodology: "Test fixture",
      source_provider: "Test fixture",
      source_url: "https://example.com/peers",
      source_as_of: "2026-08-13T00:00:00.000Z",
      candidates_considered: 0,
      selection_version: "test",
    },
    analystEstimates: {
      quarterly: [],
      annual: [],
      provider: "Test fixture",
      as_of: null,
      source_url: "https://example.com/estimates",
      disclosure: "Test fixture",
    },
  });

  assert.equal(analysis.financials.at(-1).values.diluted_shares, undefined);
  assert.equal(analysis.financials.at(-1).values.shares_outstanding, undefined);
  assert.ok(analysis.valuation.methods.dcf > 0);
  assert.ok(analysis.valuation.methods.dcf < 100_000, "DCF must be a per-share value, not total equity value");
  assert.ok(analysis.valuation.methods.comparable_companies > 0, "implied quote share count should support per-share multiples");
  assert.ok(analysis.headline.fair_value < 100_000, "headline fair value must remain in per-share units");
});

test("does not present negative earnings multiples or fair values for a loss-making company", async () => {
  const makePeriod = (fiscalYear, netIncome, freeCashFlow) => ({
    fiscal_year: fiscalYear,
    period_type: "FY",
    period_end: `${fiscalYear}-12-31`,
    filed_at: `${fiscalYear + 1}-02-28`,
    accession_number: `loss-${fiscalYear}`,
    form: "10-K",
    currency: "USD",
    values: {
      revenue: 5_000_000_000,
      operating_income: netIncome,
      net_income: netIncome,
      operating_cash_flow: freeCashFlow,
      capex: 0,
      free_cash_flow: freeCashFlow,
      cash: 3_000_000_000,
      total_debt: 1_000_000_000,
      equity: 4_000_000_000,
      diluted_shares: 1_000_000_000,
      shares_outstanding: 1_000_000_000,
    },
    provenance: {},
  });
  const analysis = await buildAnalysis("LOSS", undefined, {
    financials: {
      profile: {
        cik: "0000000002",
        name: "Loss Company",
        sector: "Industrials",
        industry: "Manufacturing",
        exchange: "NASDAQ",
        description: "Loss Company manufactures products.",
        description_source: "Test fixture",
        description_source_url: "https://www.sec.gov/",
      },
      periods: [makePeriod(2024, -1_000_000_000, -200_000_000), makePeriod(2025, -800_000_000, -100_000_000)],
      quarterlyPeriods: [],
      filings: [],
      filingRisks: [],
    },
    quote: {
      price: 10,
      market_cap: 10_000_000_000,
      as_of: "2026-08-13T00:00:00.000Z",
      currency: "USD",
      provider: "Test quote",
      source_url: null,
      is_delayed: true,
    },
    peerSet: {
      companies: [], methodology: "Test", source_provider: "Test", source_url: "https://example.com",
      source_as_of: "2026-08-13T00:00:00.000Z", candidates_considered: 0, selection_version: "test",
    },
    analystEstimates: {
      quarterly: [], annual: [], provider: "Test", as_of: null, source_url: "https://example.com", disclosure: "Test",
    },
  });

  assert.equal(analysis.valuation.methods.comparable_companies, null);
  assert.equal(analysis.valuation.methods.growth_adjusted, null);
  assert.equal(analysis.valuation.methods.normalized_multiple, null);
  assert.equal(analysis.metrics.fcf_conversion, null, "two negative values must not become a positive conversion ratio");
  assert.equal(analysis.metrics.net_debt_to_fcf, null, "leverage-to-FCF is not meaningful while FCF is negative");
  assert.ok(analysis.headline.fair_value >= 0);
  assert.ok(analysis.headline.bear_value >= 0);
  assert.ok(analysis.headline.bull_value >= 0);

  const multiple = projectMultipleValuation({
    basis: "net_income",
    forecastYears: 5,
    currentNetIncome: -800_000_000,
    currentEps: -0.8,
    currentShares: 1_000_000_000,
    currentPrice: 10,
    currentMarketCap: 10_000_000_000,
    annualShareChange: 0,
    scenario: { growthRate: 0.15, exitPe: 20 },
  });
  assert.equal(multiple.projectedMarketCap, null);
  assert.equal(multiple.projectedSharePrice, null);
  assert.equal(multiple.valuationLabel, "Unavailable");
});

test("formats share counts as shares rather than currency", () => {
  assert.equal(compactShares(14_700_000_000), "14.7B shares");
  assert.equal(compactShares(null), "N/A");
});

test("adjusts historical shares and EPS across stock splits", () => {
  const annual = (year, income, shares, filed) => ({
    start: `${year}-01-01`, end: `${year}-12-31`, val: income, accn: `${year}-annual`, fy: year, fp: "FY", form: "10-K", filed,
  });
  const share = (year, shares, filed) => ({
    start: `${year}-01-01`, end: `${year}-12-31`, val: shares, accn: `${year}-annual`, fy: year, fp: "FY", form: "10-K", filed,
  });
  const payload = {
    cik: 1,
    facts: { "us-gaap": {
      NetIncomeLoss: { units: { USD: [annual(2022, 100, 100, "2023-02-01"), annual(2023, 120, 120, "2024-02-01"), annual(2024, 132, 132, "2025-02-01")] } },
      WeightedAverageNumberOfDilutedSharesOutstanding: { units: { shares: [share(2022, 100, "2023-02-01"), share(2023, 120, "2024-02-01"), share(2024, 240, "2025-02-01")] } },
      StockholdersEquityNoteStockSplitConversionRatio1: { units: { pure: [{ end: "2024-06-01", val: 2, accn: "split", fy: 2024, fp: "Q2", form: "10-Q", filed: "2024-08-01" }] } },
    } },
  };

  const periods = normalizeCompanyFacts(payload);
  assert.deepEqual(periods.map((period) => period.values.diluted_shares), [200, 240, 240]);
  assert.deepEqual(periods.map((period) => period.values.diluted_eps), [0.5, 0.5, 0.55]);
  assert.match(periods[0].provenance.diluted_shares.formula, /split-adjusted/i);
});

test("labels AI Research as preview and separates filing date concepts", async () => {
  const component = await readFile(new URL("../../frontend/components/ResearchTerminal.tsx", import.meta.url), "utf8");
  assert.match(component, /AI Research · Preview/);
  assert.match(component, />Fiscal period</);
  assert.match(component, />Report period ending</);
  assert.match(component, />Filing form</);
  assert.match(component, />Filing date</);
});

test("server-renders the AplexAnalysis terminal", async () => {
  const response = await render();
  assert.equal(response.status, 200);
  assert.match(response.headers.get("cache-control") ?? "", /s-maxage=60/);
  assert.match(response.headers.get("content-type") ?? "", /^text\/html\b/i);

  const html = await response.text();
  assert.match(html, /<title>AplexAnalysis \| Equity Research Terminal<\/title>/i);
  assert.match(html, /AplexAnalysis/);
  assert.match(html, /Ticker or company/);
  assert.match(html, /Research software\. Not investment advice\./);
  assert.doesNotMatch(html, /codex-preview|Your site is taking shape/);
});

test("keeps the comps matrix readable and horizontally contained", async () => {
  const css = await readFile(new URL("../../frontend/app/premium.css", import.meta.url), "utf8");
  const component = await readFile(new URL("../../frontend/components/ResearchTerminal.tsx", import.meta.url), "utf8");
  const analysis = await readFile(new URL("../lib/server/analysis.ts", import.meta.url), "utf8");
  assert.match(css, /\.comps-matrix-scroll\s*\{[^}]*overflow-x:\s*auto/s);
  assert.match(css, /\.comps-matrix-table\s*\{[^}]*width:\s*100%[^}]*min-width:\s*1120px/s);
  assert.match(css, /\.comps-company-link\s*\{[^}]*text-align:\s*left/s);
  assert.match(component, /minimum peer-quality rule/);
  assert.match(analysis, /selection_score >= minimumDisplayScore/);
  assert.match(analysis, /leaves the set empty instead of showing companies with weak product, customer, or business-model overlap/);
});

test("makes comparable company profiles directly navigable", async () => {
  const component = await readFile(new URL("../../frontend/components/ResearchTerminal.tsx", import.meta.url), "utf8");
  assert.match(component, /onClick=\{\(\) => onSelectCompany\(peer\.ticker\)\}/);
  assert.match(component, /aria-label=\{`Open \$\{peer\.name\} profile`\}/);
});

test("keeps restored startup focus from opening the security search menu", async () => {
  const component = await readFile(new URL("../../frontend/components/ResearchTerminal.tsx", import.meta.url), "utf8");
  assert.doesNotMatch(component, /onFocus=\{\(\) => \{\s*setSearchOpen\(true\)/);
  assert.match(component, /onPointerDown=\{\(\) => \{\s*setSearchOpen\(true\)/);
  assert.match(component, /onChange=\{\(event\) => \{[\s\S]*?setSearchOpen\(true\)/);
  assert.match(component, /aria-activedescendant=\{searchOpen && highlightedResult >= 0/);
  assert.match(component, /event\.key === "Escape"[\s\S]*?setHighlightedResult\(-1\)/);
});

test("keeps the full research navigation reachable on short desktop screens", async () => {
  const css = await readFile(new URL("../../frontend/app/premium.css", import.meta.url), "utf8");
  assert.match(css, /\.sidebar nav\s*\{[^}]*min-height:\s*0[^}]*overflow-y:\s*auto/s);
});

test("routes a cold Overview through the lightweight shared-cache pipeline", async () => {
  const route = await readFile(new URL("../app/api/v1/companies/[ticker]/analysis/route.ts", import.meta.url), "utf8");
  const service = await readFile(new URL("../lib/server/analysis-service.ts", import.meta.url), "utf8");
  assert.match(route, /rebuildOverviewFromComponentCaches/);
  assert.match(route, /overviewOnly\s*\?\s*await rebuildOverviewFromComponentCaches\(normalizedTicker, forceRefresh\)/);
  const overviewBuilder = service.match(/export async function rebuildOverviewFromComponentCaches[\s\S]*?\n}\n/)?.[0] ?? "";
  assert.match(overviewBuilder, /loadFinancials/);
  assert.match(overviewBuilder, /loadQuote/);
  assert.match(overviewBuilder, /Promise\.all/);
  assert.doesNotMatch(overviewBuilder, /loadPeers|loadEstimates/);
});

test("loads expensive research sections independently after Overview", async () => {
  const route = await readFile(new URL("../app/api/v1/companies/[ticker]/analysis/route.ts", import.meta.url), "utf8");
  const component = await readFile(new URL("../../frontend/components/ResearchTerminal.tsx", import.meta.url), "utf8");
  const api = await readFile(new URL("../../frontend/lib/api.ts", import.meta.url), "utf8");
  assert.match(route, /rebuildAnalysisSectionFromComponentCaches/);
  assert.match(route, /buildSectionSnapshot/);
  assert.match(api, /AnalysisSection/);
  assert.match(component, /isAnalysisSectionLoaded\(analysis, activePage\)/);
  assert.match(component, /fetchAnalysis\(ticker, controller\.signal, requestedSection, forceRefresh\)/);
});

test("uses canonical tickers and current component caches for requested sections", async () => {
  const route = await readFile(new URL("../app/api/v1/companies/[ticker]/analysis/route.ts", import.meta.url), "utf8");
  assert.match(route, /normalizeTicker\(ticker\)/);
  assert.match(route, /forceRefresh \|\| requestedSection \? null : await readCachedAnalysis/);
  assert.match(route, /rebuildAnalysisSectionFromComponentCaches\(normalizedTicker, requestedSection, forceRefresh\)/);
});

test("provides a manual company refresh that bypasses the relevant component caches", async () => {
  const route = await readFile(new URL("../app/api/v1/companies/[ticker]/analysis/route.ts", import.meta.url), "utf8");
  const service = await readFile(new URL("../lib/server/analysis-service.ts", import.meta.url), "utf8");
  const component = await readFile(new URL("../../frontend/components/ResearchTerminal.tsx", import.meta.url), "utf8");
  const api = await readFile(new URL("../../frontend/lib/api.ts", import.meta.url), "utf8");
  assert.match(component, /aria-label=\{refreshing \? "Refreshing data" : "Refresh data"\}/);
  assert.doesNotMatch(component, />\{refreshing \? "Refreshing data" : "Refresh data"\}</);
  assert.match(component, /fetchAnalysis\(refreshTicker, undefined, refreshSection, true\)/);
  assert.match(api, /method: forceRefresh \? "POST" : "GET"/);
  assert.doesNotMatch(api, /params\.set\("refresh", "1"\)/);
  assert.match(route, /MANUAL_REFRESH_COOLDOWN_MS = 60_000/);
  assert.match(route, /status: 429/);
  assert.match(route, /"Retry-After": "60"/);
  assert.match(route, /rebuildOverviewFromComponentCaches\(normalizedTicker, forceRefresh\)/);
  assert.match(route, /forceRefresh \? "no-store"/);
  assert.match(service, /loadFinancials\(ticker, forceRefresh\)/);
  assert.match(service, /loadQuote\(ticker, financials\.data, forceRefresh\)/);
  assert.doesNotMatch(component, /Cached, refresh pending/);
  assert.match(component, /Refresh failed/);
  assert.match(route, /cached\.isFresh \? "cached" : "stale"/);
});

test("adds baseline response security headers without exposing cache diagnostics", async () => {
  const worker = await readFile(new URL("../worker/index.ts", import.meta.url), "utf8");
  const cacheStatus = await readFile(new URL("../app/api/v1/cache/status/route.ts", import.meta.url), "utf8");
  assert.match(worker, /Content-Security-Policy/);
  assert.match(worker, /X-Content-Type-Options/);
  assert.match(worker, /Referrer-Policy/);
  assert.match(worker, /Permissions-Policy/);
  assert.match(worker, /withSecurityHeaders\(response\)/);
  assert.match(cacheStatus, /status: 404/);
  assert.doesNotMatch(cacheStatus, /getCacheMonitoringSummary/);
});

test("bounds and validates state-changing valuation requests", async () => {
  const route = await readFile(new URL("../app/api/v1/companies/[ticker]/valuation/route.ts", import.meta.url), "utf8");
  assert.match(route, /MAX_BODY_BYTES = 8_192/);
  assert.match(route, /status: 413/);
  assert.match(route, /request\.body\.getReader\(\)/);
  assert.match(route, /totalBytes > MAX_BODY_BYTES/);
  assert.match(route, /Object\.keys\(input\).*allowed\.has/);
  assert.match(route, /Number\.isFinite/);
  assert.match(route, /normalizeTicker\(ticker\)/);
});

test("keeps server and browser freshness labels deterministic and the brand link usable", async () => {
  const component = await readFile(new URL("../../frontend/components/ResearchTerminal.tsx", import.meta.url), "utf8");
  const notFound = await readFile(new URL("../app/not-found.tsx", import.meta.url), "utf8");
  assert.match(component, /timeZone: "UTC"/);
  assert.match(component, /aria-label="Go to AplexAnalysis overview"/);
  assert.match(component, /onClick=\{\(\) => openCompanyProfile\("AAPL"\)\}/);
  assert.match(notFound, /404 \/ PAGE NOT FOUND/);
  assert.match(notFound, /href="\/"/);
});

test("keeps excluded Overview sections explicitly unavailable", () => {
  const overview = buildOverviewSnapshot({
    financials: [],
    quarterly_financials: [],
    analyst_estimates: { quarterly: [], annual: [], provider: "Nasdaq", as_of: null, source_url: "https://example.com", disclosure: "Test" },
    comps: [], filings: [], risks: [], news: { items: [], fetched_at: "2026-08-15T00:00:00.000Z", providers: [], industry_query: null, warnings: [] },
    freshness: {
      page_status: "cached",
      financials: { status: "cached", as_of: "2026-01-01", fresh_until: null, source: "SEC" },
      quote: { status: "cached", as_of: "2026-08-15", fresh_until: null, source: "Nasdaq" },
      analyst_estimates: { status: "cached", as_of: "2026-08-15", fresh_until: null, source: "Nasdaq" },
      comps: { status: "cached", as_of: "2026-08-15", fresh_until: null, source: "Peers" },
      news: { status: "cached", as_of: "2026-08-15", fresh_until: null, source: "Yahoo" },
      risks: { status: "cached", as_of: "2026-01-01", fresh_until: null, source: "SEC" },
      summary: { status: "cached", as_of: null, fresh_until: null, source: "Summary" },
    },
  });
  assert.equal(overview.freshness.news.status, "unavailable");
  assert.equal(overview.freshness.analyst_estimates.status, "unavailable");
  assert.equal(overview.freshness.financials.status, "cached");
  assert.equal(overview.freshness.quote.status, "cached");

  const financials = buildSectionSnapshot({
    ...overview,
    analyst_estimates: { quarterly: [{ period: "Q1" }], annual: [{ period: "FY" }], provider: "Nasdaq", as_of: "2026-08-15", source_url: "https://example.com", disclosure: "Test" },
    freshness: {
      ...overview.freshness,
      analyst_estimates: { status: "cached", as_of: "2026-08-15", fresh_until: null, source: "Nasdaq" },
    },
  }, "financials");
  assert.equal(financials.analyst_estimates.annual.length, 1);
  assert.equal(financials.freshness.analyst_estimates.status, "cached");
});

test("keeps quote attribution clickable and Buy Target navigation connected", async () => {
  const component = await readFile(new URL("../../frontend/components/ResearchTerminal.tsx", import.meta.url), "utf8");
  assert.match(component, /href=\{analysis\.quote\.source_url\}/);
  assert.match(component, /page === "buyTarget"\) return <BuyTargetView/);
  assert.match(component, /key: "buyTarget", label: "Buy Target"/);
  assert.match(component, /Timestamp not supplied/);
});

test("shows mobile horizontal-scroll hints and quarterly YoY and QoQ comparisons", async () => {
  const terminal = await readFile(new URL("../../frontend/components/ResearchTerminal.tsx", import.meta.url), "utf8");
  const explorer = await readFile(new URL("../../frontend/components/FinancialExplorer.tsx", import.meta.url), "utf8");
  const css = await readFile(new URL("../../frontend/app/premium.css", import.meta.url), "utf8");
  assert.match(terminal, /Swipe sideways for more sections/);
  assert.match(terminal, /Swipe sideways to compare every metric/);
  assert.match(explorer, /"YoY"/);
  assert.match(explorer, /"QoQ"/);
  assert.match(explorer, /N\/M/);
  assert.match(explorer, /YoY growth/);
  assert.match(explorer, /QoQ growth/);
  assert.match(explorer, /financial-growth-badge/);
  assert.match(css, /\.financial-growth-badge[\s\S]*?font:\s*11px/);
  assert.match(css, /@media \(max-width: 960px\)[\s\S]*?\.horizontal-scroll-hint\s*\{[\s\S]*?display:\s*block/);
});

test("plots quarterly YoY and QoQ growth on a separate percentage scale", () => {
  const periods = Array.from({ length: 6 }, (_, index) => ({
    fiscal_year: index < 4 ? 2025 : 2026,
    fiscal_quarter: (index % 4) + 1,
    period_type: `Q${(index % 4) + 1}`,
    period_end: null,
    filed_at: null,
    accession_number: null,
    form: "10-Q",
    currency: "USD",
    values: { revenue: [100, 110, 120, 130, 150, 165][index], net_income: [10, 11, 12, 13, 15, 16.5][index] },
    provenance: {},
  }));
  const incomeGroup = FINANCIAL_GROUPS.find((group) => group.key === "income");
  const yoy = buildFinancialGrowthData(periods, incomeGroup, "yoy");
  const qoq = buildFinancialGrowthData(periods, incomeGroup, "qoq");

  assert.equal(yoy[4].revenue, 50);
  assert.ok(Math.abs(qoq[5].revenue - 10) < 1e-9);
  assert.equal(financialGrowthValue(-10, -20, "money"), null);
  assert.ok(Math.abs(financialGrowthValue(0.3, 0.25, "percent") - 5) < 1e-9);
});

test("keeps deferred-section loading and errors scoped to the requested page", () => {
  const analysis = {
    data_scope: "partial",
    loaded_sections: ["overview", "comps"],
  };

  assert.equal(analysisSectionPanelState(analysis, "comps", "news", null), "content");
  assert.equal(analysisSectionPanelState(analysis, "news", "news", null), "loading");
  assert.equal(analysisSectionPanelState(analysis, "news", null, "News is unavailable"), "error");
});

test("merges a deferred section without erasing freshness from previously loaded pages", () => {
  const current = {
    data_scope: "partial",
    loaded_sections: ["overview", "comps"],
    financials: [{ fiscal_year: 2025 }],
    quarterly_financials: [],
    analyst_estimates: { annual: [] },
    comps: [{ ticker: "MSFT" }],
    peer_selection: { source_provider: "SEC" },
    filings: [],
    risks: [],
    news: { items: [] },
    freshness: {
      page_status: "cached",
      comps: { status: "cached", as_of: "2026-08-10T00:00:00.000Z", source: "Peer cache" },
      news: { status: "unavailable", as_of: null, source: "Loads with News" },
    },
    provenance: {
      comparables: "SEC peer selection",
      peer_snapshot_as_of: "2026-08-10T00:00:00.000Z",
      news: "Loads with News",
      warnings: ["Existing warning"],
    },
  };
  const next = {
    ...current,
    loaded_sections: ["overview", "news"],
    comps: [],
    peer_selection: { source_provider: "Unavailable" },
    news: { items: [{ id: "news-1" }] },
    freshness: {
      ...current.freshness,
      page_status: "live",
      comps: { status: "unavailable", as_of: null, source: "Loads with Comps" },
      news: { status: "live", as_of: "2026-08-12T00:00:00.000Z", source: "Yahoo Finance" },
    },
    provenance: {
      ...current.provenance,
      comparables: "Loads with Comps",
      peer_snapshot_as_of: "",
      news: "Yahoo Finance",
      warnings: ["New warning"],
    },
  };

  const merged = mergeAnalysisSection(current, next, "news");
  assert.deepEqual(merged.comps, current.comps);
  assert.equal(merged.freshness.comps.as_of, current.freshness.comps.as_of);
  assert.equal(merged.freshness.news.as_of, next.freshness.news.as_of);
  assert.equal(merged.provenance.comparables, current.provenance.comparables);
  assert.equal(merged.provenance.news, next.provenance.news);
  assert.deepEqual(merged.provenance.warnings, ["Existing warning", "New warning"]);
});

test("merges analyst estimates returned with the Financials section", () => {
  const current = {
    data_scope: "overview", loaded_sections: ["overview"], financials: [], quarterly_financials: [],
    analyst_estimates: { annual: [], quarterly: [] }, comps: [], filings: [], risks: [], news: { items: [] },
    freshness: { analyst_estimates: { status: "unavailable" } },
    provenance: { analyst_estimates: "Loads with Earnings", warnings: [] },
  };
  const next = {
    ...current, data_scope: "partial", loaded_sections: ["overview", "financials"],
    analyst_estimates: { annual: [{ period: "FY 2027" }], quarterly: [{ period: "Q1 2027" }] },
    freshness: { analyst_estimates: { status: "cached" } },
    provenance: { analyst_estimates: "Nasdaq analyst consensus", warnings: [] },
  };
  const merged = mergeAnalysisSection(current, next, "financials");
  assert.equal(merged.analyst_estimates.annual.length, 1);
  assert.equal(merged.freshness.analyst_estimates.status, "cached");
  assert.equal(merged.provenance.analyst_estimates, "Nasdaq analyst consensus");
});

test("coordinates shared refreshes and gradually warms popular companies", async () => {
  const cache = await readFile(new URL("../lib/server/analysis-cache.ts", import.meta.url), "utf8");
  const worker = await readFile(new URL("../worker/index.ts", import.meta.url), "utf8");
  const api = await readFile(new URL("../../frontend/lib/api.ts", import.meta.url), "utf8");
  assert.match(cache, /cache_refresh_leases/);
  assert.match(cache, /acquireCacheRefreshLease/);
  assert.match(worker, /warmPopularCompanies/);
  assert.match(api, /prefetchAnalysis/);
});

test("creates a concise, display-safe company summary", () => {
  const source = "Example Corp. designs software for business customers. It also provides cloud services and support. A third sentence should not appear in the overview.";
  assert.equal(
    summarizeCompanyDescription(source, "Example Corp."),
    "Example Corp. designs software for business customers. It also provides cloud services and support.",
  );
  assert.equal(summarizeCompanyDescription("A business &amp; services company — with a long dash."), "A business & services company - with a long dash.");
  assert.equal(summarizeCompanyDescription("   "), null);
});

test("prefers concrete products and uses over generic company-profile language", () => {
  const source = "Sandisk is a leading global semiconductor memory company with more than 30 years of innovation in NAND flash technology. We are a vertically integrated solutions provider with ownership of chip-level design and IP, front and back-end manufacturing, as well as systems engineering and design. With a differentiated innovation engine driving advancements in storage and semiconductor technologies, our broad and ever-expanding portfolio delivers powerful flash storage solutions for artificial intelligence workloads in datacenters, edge devices, and consumer applications. Our technologies enable everyone from students, gamers and home offices, to the largest enterprises and public clouds to produce, analyze, and store data. Our solutions include a broad range of solid state drives, embedded products, removable cards, universal serial bus drives, and wafers and components. Learn more about Sandisk at www.sandisk.com.";
  const summary = summarizeCompanyDescription(source, "Sandisk");

  assert.equal(
    summary,
    "Sandisk's solutions include solid-state drives, embedded products, removable cards, USB drives, and semiconductor wafers and components. Its flash storage products support AI workloads in data centers, edge devices, and consumer applications.",
  );
  assert.doesNotMatch(summary, /leading|innovation engine|more than 30 years/i);
});

test("does not prioritize promotional plans over the current business", () => {
  const source = "Example Motors makes electric vehicles. It sells batteries to homes and utilities. The company plans to begin selling aircraft and boats.";
  const summary = summarizeCompanyDescription(source, "Example Motors");

  assert.match(summary, /makes electric vehicles/i);
  assert.match(summary, /sells batteries/i);
  assert.doesNotMatch(summary, /plans to|aircraft|boats/i);
});

test("validates cached analysis and reports its freshness", () => {
  const row = {
    listing_id: "listing:xnas:msft",
    payload_json: JSON.stringify({ company: { ticker: "MSFT" }, financials: [] }),
    generated_at: "2026-08-08T12:00:00.000Z",
    fresh_until: "2026-08-08T12:15:00.000Z",
  };

  assert.equal(parseCachedAnalysisRow(row, Date.parse("2026-08-08T12:10:00.000Z"))?.isFresh, true);
  assert.equal(parseCachedAnalysisRow(row, Date.parse("2026-08-08T12:20:00.000Z"))?.isFresh, false);
  assert.equal(parseCachedAnalysisRow({ ...row, payload_json: "not-json" }), null);
});

test("invalidates only incompatible derived snapshots while retaining company-scoped financial identities", () => {
  const compatible = {
    schema_version: ANALYSIS_SCHEMA_VERSION,
    normalization_version: NORMALIZATION_VERSION,
    valuation_model_version: VALUATION_MODEL_VERSION,
    score_model_version: SCORE_MODEL_VERSION,
    component_source_versions_json: JSON.stringify(COMPONENT_SOURCE_VERSIONS),
  };
  assert.equal(isAnalysisCacheCompatible(compatible), true);
  assert.equal(isAnalysisCacheCompatible({ ...compatible, valuation_model_version: "valuation-next" }), false);
  assert.equal(isAnalysisCacheCompatible({ ...compatible, component_source_versions_json: JSON.stringify({ ...COMPONENT_SOURCE_VERSIONS, comps: "comps-next" }) }), false);

  const cached = { sourceFingerprint: "accession-a" };
  assert.equal(hasSameFinancialFingerprint(cached, { accessionNumber: "accession-a", filingDate: "2026-08-01", form: "10-Q" }), true);
  assert.equal(hasSameFinancialFingerprint(cached, { accessionNumber: "accession-b", filingDate: "2026-08-02", form: "10-Q" }), false);

  const companyA = cacheIdentity({ cik: "0000000001", ticker: "AAA", exchange: "NASDAQ" });
  const companyB = cacheIdentity({ cik: "0000000002", ticker: "BBB", exchange: "NYSE" });
  assert.notEqual(companyA.companyId, companyB.companyId);
  assert.notEqual(companyA.listingId, companyB.listingId);
});

test("ranks close operating peers ahead of broad same-sector companies", () => {
  const target = {
    ticker: "DELL",
    name: "Dell Technologies Inc.",
    sector: "Technology",
    industry: "Computer Manufacturing",
    marketCap: 100_000_000_000,
    description: "Dell sells PCs, workstations, servers, storage and data-center infrastructure to consumers and enterprise customers.",
  };
  const ranked = rankPeerCandidates(target, [
    {
      ticker: "HPQ", name: "HP Inc.", sector: "Technology", industry: "Computer Manufacturing", marketCap: 25_000_000_000,
      description: "HP sells personal computers, workstations and peripherals to consumer and commercial customers.",
    },
    {
      ticker: "HPE", name: "Hewlett Packard Enterprise", sector: "Technology", industry: "Retail: Computer Software & Peripheral Equipment", marketCap: 30_000_000_000,
      description: "HPE sells enterprise servers, storage, networking and data-center infrastructure.",
      reviewedReason: "Selected because HPE identifies Dell as a primary competitor in enterprise data-center infrastructure.",
      evidenceLabel: "HPE annual filing",
      evidenceUrl: "https://www.sec.gov/",
    },
    {
      ticker: "SMCI", name: "Super Micro Computer", sector: "Technology", industry: "Computer Manufacturing", marketCap: 20_000_000_000,
      description: "Supermicro sells servers and data-center infrastructure for enterprise and cloud customers.",
    },
    {
      ticker: "MSFT", name: "Microsoft", sector: "Technology", industry: "Computer Software: Prepackaged Software", marketCap: 3_000_000_000_000,
      description: "Microsoft develops enterprise software and cloud services.",
    },
  ]);

  assert.deepEqual(ranked.slice(0, 3).map((company) => company.ticker).sort(), ["HPE", "HPQ", "SMCI"]);
  assert.ok(ranked.find((company) => company.ticker === "HPE")?.selectionReason.includes("primary competitor"));
  assert.ok(ranked.find((company) => company.ticker === "HPQ")?.selectionReason.includes("Computer Manufacturing"));
  assert.ok((ranked.find((company) => company.ticker === "SMCI")?.selectionScore ?? 0) > (ranked.find((company) => company.ticker === "MSFT")?.selectionScore ?? 0));
});

test("uses products and business models to separate companies inside a broad software industry", () => {
  const target = {
    ticker: "ADBE",
    name: "Adobe Inc.",
    sector: "Technology",
    industry: "Computer Software: Prepackaged Software",
    marketCap: 140_000_000_000,
    description: "Adobe provides creativity, digital media, document and personalized customer experience software.",
    primaryDescription: "Adobe provides creativity, digital media, document and personalized customer experience software.",
  };
  const ranked = rankPeerCandidates(target, [
    {
      ticker: "ADSK", name: "Autodesk, Inc.", sector: "Technology", industry: "Computer Software: Prepackaged Software", marketCap: 65_000_000_000,
      description: "Autodesk provides design software for designers, engineers, architects and creators.",
    },
    {
      ticker: "CDNS", name: "Cadence Design Systems, Inc.", sector: "Technology", industry: "Computer Software: Prepackaged Software", marketCap: 80_000_000_000,
      description: "Cadence provides electronic design automation software used by engineers and product designers.",
    },
    {
      ticker: "CRM", name: "Salesforce, Inc.", sector: "Technology", industry: "Computer Software: Prepackaged Software", marketCap: 190_000_000_000,
      description: "Salesforce provides customer relationship management and customer experience applications.",
    },
    {
      ticker: "XYZ", name: "Block, Inc.", sector: "Technology", industry: "Computer Software: Prepackaged Software", marketCap: 45_000_000_000,
      description: "Block provides financial technology, merchant payments and commerce products.",
    },
    {
      ticker: "NET", name: "Cloudflare, Inc.", sector: "Technology", industry: "Computer Software: Prepackaged Software", marketCap: 70_000_000_000,
      description: "Cloudflare provides a connectivity cloud, network security and content delivery services.",
    },
  ]);

  assert.deepEqual(ranked.map((company) => company.ticker), ["CRM", "ADSK"]);
  assert.ok((ranked.find((company) => company.ticker === "ADSK")?.selectionScore ?? 0) > (ranked.find((company) => company.ticker === "XYZ")?.selectionScore ?? 0));
  assert.ok(ranked.find((company) => company.ticker === "ADSK")?.selectionReason.includes("creative, design and digital-content tools"));
});

test("requires product overlap and reasonable scale for automatic automotive peers", () => {
  const target = {
    ticker: "TSLA",
    name: "Tesla, Inc.",
    sector: "Consumer Discretionary",
    industry: "Auto Manufacturing",
    marketCap: 800_000_000_000,
    description: "Tesla designs and manufactures electric vehicles, automobiles, batteries and charging products.",
  };
  const ranked = rankPeerCandidates(target, [
    {
      ticker: "GM", name: "General Motors Company", sector: "Consumer Discretionary", industry: "Auto Manufacturing", marketCap: 55_000_000_000,
      description: "General Motors designs and manufactures automobiles and electric vehicles for consumers and fleets.",
    },
    {
      ticker: "F", name: "Ford Motor Company", sector: "Consumer Discretionary", industry: "Auto Manufacturing", marketCap: 45_000_000_000,
      description: "Ford manufactures automobiles, trucks and electric vehicles for retail and commercial customers.",
    },
    {
      ticker: "RIVN", name: "Rivian Automotive, Inc.", sector: "Consumer Discretionary", industry: "Auto Manufacturing", marketCap: 15_000_000_000,
      description: "Rivian designs and manufactures electric vehicles for consumer and commercial customers.",
    },
    {
      ticker: "WKHS", name: "Workhorse Group Inc.", sector: "Consumer Discretionary", industry: "Auto Manufacturing", marketCap: 120_000_000,
      description: "Workhorse manufactures electric commercial vehicles and delivery trucks.",
    },
    {
      ticker: "DXYZ", name: "Digital Currency X Technology Inc.", sector: "Consumer Discretionary", industry: "Auto Manufacturing", marketCap: 3_000_000_000,
      description: "Digital Currency X operates cryptocurrency infrastructure, enterprise servers and data-center systems.",
    },
  ]);

  assert.deepEqual(ranked.map((company) => company.ticker), ["GM", "F", "RIVN"]);
});

test("rejects tiny consumer-electronics matches without a comparable business model", () => {
  const target = {
    ticker: "AAPL",
    name: "Apple Inc.",
    sector: "Technology",
    industry: "Consumer Electronics",
    marketCap: 3_400_000_000_000,
    description: "Apple sells smartphones, personal computers, tablets, wearables and related consumer services.",
  };
  const ranked = rankPeerCandidates(target, [
    {
      ticker: "DELL", name: "Dell Technologies Inc.", sector: "Technology", industry: "Computer Manufacturing", marketCap: 90_000_000_000,
      description: "Dell sells personal computers and workstations to consumers and commercial customers.",
      reviewedReason: "Selected because Apple and Dell both sell personal computers to consumer and commercial customers.",
    },
    {
      ticker: "HPQ", name: "HP Inc.", sector: "Technology", industry: "Computer Manufacturing", marketCap: 30_000_000_000,
      description: "HP sells personal computers, workstations and peripherals to consumers and commercial customers.",
      reviewedReason: "Selected because Apple and HP both sell personal computers to consumer and commercial customers.",
    },
    {
      ticker: "OSS", name: "One Stop Systems, Inc.", sector: "Technology", industry: "Consumer Electronics", marketCap: 95_000_000,
      description: "One Stop Systems builds rugged edge-computing servers for defense and industrial customers.",
    },
    {
      ticker: "ZEPP", name: "Zepp Health Corporation", sector: "Technology", industry: "Consumer Electronics", marketCap: 190_000_000,
      description: "Zepp Health sells smart wearables and digital health products.",
    },
  ]);

  assert.deepEqual(ranked.map((company) => company.ticker).sort(), ["DELL", "HPQ"]);
});

test("keeps diversified Microsoft peers when a core software or cloud business overlaps", () => {
  const target = {
    ticker: "MSFT",
    name: "Microsoft Corporation",
    sector: "Technology",
    industry: "Computer Software: Prepackaged Software",
    marketCap: 3_800_000_000_000,
    description: "Microsoft sells enterprise software subscriptions, productivity applications and cloud-computing services.",
    primaryDescription: "Microsoft sells enterprise software subscriptions, productivity applications and cloud-computing services.",
  };
  const ranked = rankPeerCandidates(target, [
    {
      ticker: "ORCL", name: "Oracle Corporation", sector: "Technology", industry: "Computer Software: Prepackaged Software", marketCap: 900_000_000_000,
      description: "Oracle sells enterprise software subscriptions, database software and cloud-computing services.",
    },
    {
      ticker: "CRM", name: "Salesforce, Inc.", sector: "Technology", industry: "Computer Software: Prepackaged Software", marketCap: 250_000_000_000,
      description: "Salesforce sells enterprise applications and subscription software for customer relationship management.",
    },
    {
      ticker: "GOOGL", name: "Alphabet Inc.", sector: "Technology", industry: "Computer Software: Prepackaged Software", marketCap: 3_000_000_000_000,
      description: "Alphabet provides cloud-computing services, productivity software and a large digital advertising platform.",
    },
    {
      ticker: "GAME", name: "Small Game Publisher", sector: "Technology", industry: "Computer Software: Prepackaged Software", marketCap: 300_000_000,
      description: "The company publishes mobile games and interactive entertainment.",
    },
  ]);

  assert.deepEqual(ranked.map((company) => company.ticker).sort(), ["CRM", "GOOGL", "ORCL"]);
});

test("extracts product and customer context from a target annual filing", () => {
  const html = `<html><body><div>Table of Contents Item 1. Business Item 1A</div><h2>ITEM 1. BUSINESS</h2><p>We provide solutions for creators including imaging, video editing, web design platforms and document workflows. Marketing professionals use our digital experience products. Our customers subscribe to these products across desktop and mobile devices. This paragraph provides enough detail to distinguish the operating business from the filing table of contents.</p><h2>COMPETITION</h2><p>Unrelated competitive categories.</p><h2>ITEM 1A. RISK FACTORS</h2><p>Unrelated risks.</p></body></html>`;
  const context = extractPeerBusinessContext(html);
  assert.match(context, /video editing/);
  assert.match(context, /document workflows/);
  assert.doesNotMatch(context, /Unrelated competitive categories|Unrelated risks/);
});

test("rebuilds valuation and score from supplied normalized inputs with external access disabled", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => { throw new Error("External access disabled for cache rebuild test"); };
  const makePeriod = (year, revenue, income, cashFlow) => ({
    fiscal_year: year,
    period_type: "FY",
    period_end: `${year}-12-31`,
    filed_at: `${year + 1}-02-01`,
    accession_number: `${year}-cache-test`,
    form: "10-K",
    currency: "USD",
    values: {
      revenue,
      operating_income: income * 1.2,
      net_income: income,
      operating_cash_flow: cashFlow,
      capex: cashFlow * 0.2,
      free_cash_flow: cashFlow * 0.8,
      cash: 20_000_000_000,
      total_debt: 5_000_000_000,
      equity: 40_000_000_000,
      diluted_shares: 1_000_000_000,
      shares_outstanding: 1_000_000_000,
    },
    provenance: {},
  });
  const financials = {
    profile: {
      cik: "0000000001",
      name: "Cached Company",
      sector: "Technology",
      industry: "Software",
      exchange: "NASDAQ",
      description: "Cached Company develops business software.",
      description_source: "Cached normalized source",
      description_source_url: "https://www.sec.gov/",
    },
    periods: [
      makePeriod(2023, 100_000_000_000, 20_000_000_000, 25_000_000_000),
      makePeriod(2024, 110_000_000_000, 23_000_000_000, 28_000_000_000),
      makePeriod(2025, 121_000_000_000, 26_000_000_000, 31_000_000_000),
    ],
    quarterlyPeriods: [],
    filings: [],
    filingRisks: [],
  };

  try {
    const analysis = await buildAnalysis("CACH", undefined, {
      financials,
      financialSourceMode: "normalized-cache",
      quote: {
        price: 120,
        market_cap: 120_000_000_000,
        as_of: "2026-08-09T12:00:00.000Z",
        currency: "USD",
        provider: "Cached quote",
        source_url: null,
        is_delayed: true,
      },
      analystEstimates: {
        quarterly: [],
        annual: [],
        provider: "Cached estimates",
        as_of: "2026-08-09T00:00:00.000Z",
        source_url: "https://www.nasdaq.com/",
        disclosure: "Cached test data.",
      },
      peerSet: {
        companies: [],
        methodology: "Cached peer set",
        source_provider: "Cached source",
        source_url: "https://www.nasdaq.com/market-activity/stocks/screener",
        source_as_of: "2026-08-09T00:00:00.000Z",
        candidates_considered: 0,
        selection_version: "peer-selection-test",
      },
    });
    assert.equal(analysis.company.name, "Cached Company");
    assert.equal(analysis.provenance.financials, "normalized-cache");
    assert.equal(analysis.financials.length, 3);
    assert.ok(Number.isFinite(analysis.headline.fair_value));
    assert.ok(Number.isFinite(analysis.score.overall));
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("financial chart scales operating income to readable billions", () => {
  const [point] = buildFinancialChartData([{
    fiscal_year: 2025,
    period_type: "FY",
    period_end: null,
    filed_at: null,
    accession_number: null,
    form: "10-K",
    currency: "USD",
    values: {
      operating_income: 14_008_000_000,
      free_cash_flow: 11_600_000_000,
    },
    provenance: {},
  }]);

  assert.equal(point.operatingIncome, 14.008);
  assert.equal(formatBillions(point.operatingIncome), "$14.0B");
  assert.equal(formatBillions(point.freeCashFlow), "$11.6B");
});

test("financial chart and explorer dynamically scale to millions for smaller companies like POCI", () => {
  const pociPeriods = [
    {
      fiscal_year: 2024,
      period_type: "FY",
      period_end: "2024-12-31",
      filed_at: "2025-03-01",
      accession_number: "poci-2024",
      form: "10-K",
      currency: "USD",
      values: {
        revenue: 22_500_000,
        gross_profit: 10_200_000,
        operating_income: -2_800_000,
        net_income: -3_100_000,
      },
      provenance: {},
    },
    {
      fiscal_year: 2025,
      period_type: "FY",
      period_end: "2025-12-31",
      filed_at: "2026-03-01",
      accession_number: "poci-2025",
      form: "10-K",
      currency: "USD",
      values: {
        revenue: 24_800_000,
        gross_profit: 12_100_000,
        operating_income: -3_200_000,
        net_income: -3_500_000,
      },
      provenance: {},
    },
  ];

  const incomeGroup = FINANCIAL_GROUPS.find((g) => g.key === "income");
  assert.ok(incomeGroup);

  const scale = getFinancialScale(pociPeriods, incomeGroup);
  assert.equal(scale.factor, 1_000_000);
  assert.equal(scale.unit, "M");
  assert.equal(scale.label, "in millions");

  const explorerData = buildFinancialExplorerData(pociPeriods, incomeGroup, scale.factor);
  assert.equal(explorerData[1].revenue, 24.8);
  assert.equal(explorerData[1].gross_profit, 12.1);
  assert.equal(explorerData[1].operating_income, -3.2);
  assert.equal(explorerData[1].net_income, -3.5);

  // Formats correctly with M unit and no negative zero
  assert.equal(formatScaledMoney(explorerData[1].revenue, scale.unit), "$24.8M");
  assert.equal(formatScaledMoney(explorerData[1].gross_profit, scale.unit), "$12.1M");
  assert.equal(formatScaledMoney(explorerData[1].operating_income, scale.unit), "-$3.2M");
  assert.equal(formatScaledMoney(explorerData[1].net_income, scale.unit), "-$3.5M");
  assert.equal(formatScaledMoney(0, scale.unit), "$0.0M");
  assert.equal(formatScaledMoney(-0.000001, scale.unit), "$0.0M");

  // Overview chart scaling
  const chartData = buildFinancialChartData(pociPeriods, scale.factor);
  assert.equal(chartData[1].revenue, 24.8);
  assert.equal(chartData[1].operatingIncome, -3.2);
});

test("calculates the five-year PEG score using growth percentage points", () => {
  const periods = [{ fiscal_year: 2025, values: { revenue: 100_000_000_000, net_income: 20_000_000_000 } }];
  const attractive = calculatePegProjection(periods, 20, 0.2);
  assert.equal(attractive.projections.length, 5);
  assert.equal(attractive.average_annual_growth, 0.2);
  assert.equal(attractive.peg_ratio, 1);
  assert.equal(attractive.score, 100);
  assert.equal(attractive.projections.at(-1).fiscal_year, 2030);

  const target = calculatePegProjection(periods, 24, 0.2);
  assert.ok(Math.abs(target.peg_ratio - 1.2) < 1e-9);
  assert.equal(target.score, 100);

  const expensive = calculatePegProjection(periods, 36, 0.2);
  assert.ok(Math.abs(expensive.peg_ratio - 1.8) < 1e-9);
  assert.equal(expensive.score, 67);
});

test("extracts company-reported risks from an annual filing section", () => {
  const html = `
    <h2>Item 1A. Risk Factors</h2>
    <p>Cybersecurity incidents and failures of our systems could disrupt our operations and harm our business.</p>
    <p>Changes in laws and regulation may increase our compliance costs or limit the services that we offer.</p>
    <p>Intense competition could reduce our market share, revenue growth and operating results.</p>
    <p>We depend on third-party networks, and outages or service failures may adversely affect customers.</p>
    <h2>Item 1B. Unresolved Staff Comments</h2>
    <p>None.</p>
  `;
  const risks = extractRiskFactorHeadings(html, "10-K", 8);
  assert.equal(risks.length, 4);
  assert.match(risks[0], /Cybersecurity incidents/i);
  assert.ok(risks.every((risk) => !risk.includes("Unresolved Staff Comments")));
  const themes = extractRiskFactorThemes(html, "10-K", 8);
  assert.ok(themes.some((theme) => theme.summary.includes("the company depends on third-party networks")));
});

test("extracts Dell-style Item 1A headings that use long-dash separators", () => {
  const html = `
    <h2>ITEM 1A&#160;&#8212; RISK FACTORS</h2>
    <p>Competitive pressures may adversely affect our market position, revenue, and profitability.</p>
    <p>Cybersecurity incidents could disrupt our operations and expose confidential customer information.</p>
    <h2>ITEM 1B&#160;&#8212; UNRESOLVED STAFF COMMENTS</h2>
  `;
  const themes = extractRiskFactorThemes(html, "10-K", 8);
  assert.ok(themes.some((theme) => theme.key === "competition-innovation"));
  assert.ok(themes.some((theme) => theme.key === "cybersecurity-data-privacy"));
});

test("combines partial company, industry and SEC news without losing successful sources", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (request) => {
    const url = String(request);
    if (url.includes("query1.finance.yahoo.com")) {
      return new Response(JSON.stringify({ news: [{
        uuid: "apple-story",
        title: "Apple expands services for business customers",
        publisher: "Example Publisher",
        link: "https://publisher.example/apple-story?utm_source=test",
        providerPublishTime: 1_786_573_800,
        relatedTickers: ["AAPL"],
      }] }), { status: 200, headers: { "content-type": "application/json" } });
    }
    if (url.includes("api.nasdaq.com")) return new Response("Unavailable", { status: 503 });
    if (url.includes("news.google.com")) {
      return new Response(`<?xml version="1.0"?><rss><channel><item><title>Consumer electronics demand improves</title><link>https://news.google.com/articles/industry</link><pubDate>Wed, 12 Aug 2026 17:00:00 GMT</pubDate><source>Industry Wire</source></item></channel></rss>`, { status: 200, headers: { "content-type": "application/rss+xml" } });
    }
    throw new Error(`Unexpected URL: ${url}`);
  };

  try {
    const feed = await fetchCompanyNews(
      { ticker: "AAPL", name: "Apple Inc.", sector: "Technology", industry: "Consumer Electronics" },
      [{ form: "8-K", filing_date: "2026-08-11", report_date: "2026-08-11", accession_number: "0000320193-26-000099", source_url: "https://www.sec.gov/Archives/example.htm" }],
    );
    assert.equal(feed.items.length, 3);
    assert.ok(feed.items.some((item) => item.scope === "company" && item.matched_ticker));
    assert.ok(feed.items.some((item) => item.relevance === "direct"));
    assert.ok(feed.items.some((item) => item.scope === "industry"));
    assert.ok(feed.items.some((item) => item.scope === "filing" && item.source === "SEC EDGAR"));
    assert.ok(feed.providers.includes("Yahoo Finance"));
    assert.ok(feed.providers.includes("Google News"));
    assert.ok(!feed.providers.includes("Nasdaq"));
    assert.match(feed.warnings.join(" "), /Nasdaq/);
    assert.ok(feed.items.every((item, index, items) => index === 0 || Date.parse(items[index - 1].published_at) >= Date.parse(item.published_at)));
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("drops undated provider stories instead of presenting them as 1970 news", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (request) => {
    const url = String(request);
    if (url.includes("query1.finance.yahoo.com")) {
      return new Response(JSON.stringify({ news: [{
        uuid: "undated-story",
        title: "Apple announces a new service",
        publisher: "Example Publisher",
        link: "https://publisher.example/undated-story",
        relatedTickers: ["AAPL"],
      }] }), { status: 200, headers: { "content-type": "application/json" } });
    }
    if (url.includes("api.nasdaq.com")) return new Response("Unavailable", { status: 503 });
    throw new Error(`Unexpected URL: ${url}`);
  };

  try {
    const feed = await fetchCompanyNews(
      { ticker: "AAPL", name: "Apple Inc.", sector: null, industry: null },
      [],
    );
    assert.deepEqual(feed.items, []);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("rejects a total provider outage so stale news is not overwritten", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response("Unavailable", { status: 503 });
  try {
    await assert.rejects(
      fetchCompanyNews({ ticker: "AAPL", name: "Apple Inc.", sector: null, industry: null }, []),
      /Yahoo Finance|Nasdaq/,
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("rejects broad related-ticker headlines that do not mention the company", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (request) => {
    const url = String(request);
    if (url.includes("query1.finance.yahoo.com")) {
      return new Response(JSON.stringify({ news: [{
        uuid: "broad-etf-story",
        title: "Your Newborn Account Auto-Buys This S&P 500 ETF",
        publisher: "Example Publisher",
        link: "https://publisher.example/broad-etf-story",
        providerPublishTime: 1_786_573_800,
        relatedTickers: ["AAPL", "MSFT", "GOOG"],
      }] }), { status: 200 });
    }
    if (url.includes("api.nasdaq.com")) return new Response(JSON.stringify({ data: { rows: [] } }), { status: 200 });
    throw new Error(`Unexpected URL: ${url}`);
  };
  try {
    const feed = await fetchCompanyNews({ ticker: "AAPL", name: "Apple Inc.", sector: null, industry: null }, []);
    assert.deepEqual(feed.items, []);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("separates focused ticker mentions from direct company coverage", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (request) => {
    const url = String(request);
    if (url.includes("query1.finance.yahoo.com")) {
      return new Response(JSON.stringify({ news: [{
        uuid: "focused-ticker-story",
        title: "Large-cap technology earnings calendar for next week",
        publisher: "Example Publisher",
        link: "https://publisher.example/calendar",
        providerPublishTime: 1_786_573_800,
        relatedTickers: ["AAPL"],
      }] }), { status: 200 });
    }
    if (url.includes("api.nasdaq.com")) return new Response(JSON.stringify({ data: { rows: [] } }), { status: 200 });
    throw new Error(`Unexpected URL: ${url}`);
  };
  try {
    const feed = await fetchCompanyNews({ ticker: "AAPL", name: "Apple Inc.", sector: null, industry: null }, []);
    assert.equal(feed.items[0]?.scope, "company");
    assert.equal(feed.items[0]?.relevance, "ticker");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("preserves company, industry and filing coverage under the global news limit", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (request) => {
    const url = String(request);
    if (url.includes("query1.finance.yahoo.com")) {
      return new Response(JSON.stringify({ news: Array.from({ length: 12 }, (_, index) => ({
        uuid: `yahoo-${index}`,
        title: `Apple company update ${index}`,
        publisher: "Yahoo Publisher",
        link: `https://publisher.example/yahoo-${index}`,
        providerPublishTime: 1_786_573_800 - index,
        relatedTickers: ["AAPL"],
      })) }), { status: 200 });
    }
    if (url.includes("api.nasdaq.com")) {
      return new Response(JSON.stringify({ data: { rows: Array.from({ length: 12 }, (_, index) => ({
        title: `Apple market report ${index}`,
        description: "Apple business coverage",
        url: `/articles/apple-${index}`,
        publisher: "Nasdaq Publisher",
        created: new Date(Date.UTC(2026, 7, 12, 16, 0, 0) - index * 1000).toISOString(),
      })) } }), { status: 200 });
    }
    if (url.includes("news.google.com")) {
      const items = Array.from({ length: 8 }, (_, index) => `<item><title>Consumer electronics outlook ${index}</title><link>https://news.google.com/articles/industry-${index}</link><pubDate>Wed, 12 Aug 2026 14:0${index}:00 GMT</pubDate><source>Industry Wire</source></item>`).join("");
      return new Response(`<rss><channel>${items}</channel></rss>`, { status: 200 });
    }
    throw new Error(`Unexpected URL: ${url}`);
  };
  try {
    const filings = Array.from({ length: 4 }, (_, index) => ({
      form: "8-K",
      filing_date: `2026-08-0${index + 1}`,
      report_date: `2026-08-0${index + 1}`,
      accession_number: `filing-${index}`,
      source_url: `https://www.sec.gov/Archives/filing-${index}.htm`,
    }));
    const feed = await fetchCompanyNews(
      { ticker: "AAPL", name: "Apple Inc.", sector: "Technology", industry: "Consumer Electronics" },
      filings,
    );
    assert.equal(feed.items.length, 24);
    assert.deepEqual(new Set(feed.items.map((item) => item.scope)), new Set(["company", "industry", "filing"]));
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("groups filing risks into distinct evidence-backed themes without splitting inline text", () => {
  const html = `
    <nav>
      <p>Table of Contents</p>
      <p>Item 1A. Risk Factors</p>
      <p>Item 1B. Unresolved Staff Comments</p>
    </nav>
    <h2>Item <span>1A</span>. <span>Risk Factors</span></h2>
    <p>Cybersecurity incidents create material RIS</span><span>K because attacks could expose customer data and disrupt our information systems.</p>
    <p>Intense competition and rapid technological change could reduce our market share and make our products obsolete.</p>
    <p>Changes in laws and regulatory requirements may increase our compliance costs and limit the services we offer.</p>
    <p>Supplier concentration and component shortages could interrupt manufacturing and delay deliveries to customers.</p>
    <p>A recession, inflation and higher interest rates may reduce customer demand and adversely affect revenue.</p>
    <p>Trade restrictions, export controls and geopolitical conflict could limit our international operations.</p>
    <p>Our ability to recruit and retain key personnel may affect our execution of the growth strategy.</p>
    <p>Risks associated with adverse losses and failure of operations.</p>
    <h2>Item 1B. Unresolved Staff Comments</h2>
    <p>A cybersecurity sentence outside Item 1A could harm this test if the boundary fails.</p>
  `;

  const themes = extractRiskFactorThemes(html, "10-K", 8);
  assert.equal(themes.length, 7);
  assert.equal(new Set(themes.map((theme) => theme.key)).size, themes.length);
  assert.ok(themes.some((theme) => theme.key === "cybersecurity-data-privacy"));
  assert.ok(themes.some((theme) => theme.key === "supply-chain-operations"));
  assert.ok(themes.some((theme) => theme.key === "international-geopolitical"));
  assert.ok(themes.every((theme) => theme.summary.startsWith("The filing reports that ")));
  assert.ok(themes.every((theme) => theme.summary.endsWith(".")));
  assert.ok(themes.every((theme) => theme.evidence.length >= 1 && theme.evidence.length <= 2));
  assert.ok(themes.flatMap((theme) => theme.evidence).some((evidence) => evidence.includes("RISK because")));
  assert.ok(themes.flatMap((theme) => theme.evidence).every((evidence) => !evidence.includes("Risks associated with")));
  assert.ok(themes.flatMap((theme) => theme.evidence).every((evidence) => !evidence.includes("outside Item 1A")));
});

test("extracts Item 3.D risks from a 20-F and stops at Item 4", () => {
  const html = `
    <p>ITEM 3.D. RISK FACTORS</p>
    <p>Foreign exchange volatility and economic downturns may reduce demand and adversely affect our reported revenue.</p>
    <p>Government sanctions and export controls could limit our ability to serve customers in international markets.</p>
    <p>Cyber attacks could disrupt our information systems and expose confidential customer information.</p>
    <p>ITEM 4. INFORMATION ON THE COMPANY</p>
    <p>Competition in this unrelated company-information section could affect results.</p>
  `;

  const themes = extractRiskFactorThemes(html, "20-F", 8);
  assert.ok(themes.some((theme) => theme.key === "macroeconomic-demand"));
  assert.ok(themes.some((theme) => theme.key === "international-geopolitical"));
  assert.ok(themes.some((theme) => theme.key === "cybersecurity-data-privacy"));
  assert.ok(themes.flatMap((theme) => theme.evidence).every((evidence) => !evidence.includes("unrelated company-information")));
});

test("extracts principal risks from a 40-F and respects the next report section", () => {
  const html = `
    <h2>Principal Risks and Uncertainties</h2>
    <p>Wildfires and extreme weather could disrupt facilities and interrupt our operations.</p>
    <p>Debt obligations and reduced access to capital markets may limit our liquidity and financial flexibility.</p>
    <p>Failure to retain key employees could harm our ability to execute strategic initiatives.</p>
    <h2>Management's Discussion and Analysis</h2>
    <p>Regulatory changes discussed outside the risk section may affect future periods.</p>
  `;

  const themes = extractRiskFactorThemes(html, "40-F", 8);
  assert.ok(themes.some((theme) => theme.key === "climate-physical-events"));
  assert.ok(themes.some((theme) => theme.key === "financial-liquidity"));
  assert.ok(themes.some((theme) => theme.key === "people-execution"));
  assert.ok(themes.flatMap((theme) => theme.evidence).every((evidence) => !evidence.includes("outside the risk section")));
});

test("follows a 40-F Annual Information Form exhibit when the wrapper has no risk section", async () => {
  const originalFetch = globalThis.fetch;
  const wrapperUrl = "https://www.sec.gov/Archives/edgar/data/1/wrapper40f.htm";
  const exhibitUrl = "https://www.sec.gov/Archives/edgar/data/1/exhibit99-1.htm";
  globalThis.fetch = async (request) => {
    const url = String(request);
    if (url === wrapperUrl) {
      return new Response(`<html><body><p>The Annual Information Form is incorporated by reference.</p><a href="exhibit99-1.htm">Exhibit 99.1 Annual Information Form</a></body></html>`, { status: 200 });
    }
    if (url === exhibitUrl) {
      return new Response(`<html><body><h2>Risk Factors</h2><h3>Commodity price volatility could reduce profitability</h3><p>Changes in commodity prices may materially reduce revenue, cash flow and the economic value of operations.</p><h2>Material Contracts</h2></body></html>`, { status: 200 });
    }
    throw new Error(`Unexpected URL: ${url}`);
  };
  try {
    const risks = await fetchCompanyRisks({
      filings: [{ form: "40-F", filing_date: "2026-03-01", report_date: "2025-12-31", accession_number: "test-40f", source_url: wrapperUrl }],
    });
    assert.equal(risks.length, 1);
    assert.equal(risks[0].source_url, exhibitUrl);
    assert.match(`${risks[0].detail} ${risks[0].evidence.join(" ")}`, /commodity price/i);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("serves normalized delayed Nasdaq price history for the stock chart", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response(JSON.stringify({
    data: {
      tradesTable: {
        rows: [
          { date: "08/08/2026", close: "$105.25", open: "$104.00", high: "$106.10", low: "$103.90", volume: "1,200,000" },
          { date: "08/07/2026", close: "$103.75", open: "$102.50", high: "$104.20", low: "$101.80", volume: "950,000" },
        ],
      },
    },
  }), { headers: { "content-type": "application/json" } });

  try {
    const workerUrl = new URL("../dist/server/index.js", import.meta.url);
    workerUrl.searchParams.set("price-history-test", `${process.pid}-${Date.now()}`);
    const { default: worker } = await import(workerUrl.href);
    const response = await worker.fetch(
      new Request("http://localhost/api/v1/companies/TEST/price-history"),
      { ASSETS: { fetch: async () => new Response("Not found", { status: 404 }) } },
      { waitUntil() {}, passThroughOnException() {} },
    );
    assert.equal(response.status, 200);
    const payload = await response.json();
    const history = payload.data;
    assert.equal(history.provider, "Nasdaq delayed historical prices");
    assert.deepEqual(history.points.map((point) => point.date), ["2026-08-07", "2026-08-08"]);
    assert.equal(history.points.at(-1).close, 105.25);
    assert.equal(history.points.at(-1).volume, 1_200_000);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("serves one-day intraday prices with pre-market and after-hours enabled", async () => {
  const originalFetch = globalThis.fetch;
  let requestedUrl = "";
  globalThis.fetch = async (request) => {
    requestedUrl = String(request);
    return new Response(JSON.stringify({
      chart: {
        result: [{
          timestamp: [1786622400, 1786651200, 1786672800],
          indicators: {
            quote: [{
              open: [228.1, 230.0, 231.4],
              high: [228.6, 232.0, 231.9],
              low: [227.9, 229.7, 230.8],
              close: [228.4, 231.6, 231.1],
              volume: [120_000, 1_500_000, 210_000],
            }],
          },
        }],
        error: null,
      },
    }), { headers: { "content-type": "application/json" } });
  };

  try {
    const workerUrl = new URL("../dist/server/index.js", import.meta.url);
    workerUrl.searchParams.set("intraday-price-history-test", `${process.pid}-${Date.now()}`);
    const { default: worker } = await import(workerUrl.href);
    const response = await worker.fetch(
      new Request("http://localhost/api/v1/companies/AAPL/price-history?range=1d"),
      { ASSETS: { fetch: async () => new Response("Not found", { status: 404 }) } },
      { waitUntil() {}, passThroughOnException() {} },
    );
    assert.equal(response.status, 200);
    const payload = await response.json();
    assert.equal(payload.data.range, "1d");
    assert.equal(payload.data.provider, "Yahoo Finance intraday prices including extended hours");
    assert.match(requestedUrl, /range=1d/);
    assert.match(requestedUrl, /interval=5m/);
    assert.match(requestedUrl, /includePrePost=true/);
    assert.match(payload.data.points[0].date, /T/);
    assert.equal(payload.data.points.length, 3);

    const component = await readFile(new URL("../../frontend/components/StockPriceChart.tsx", import.meta.url), "utf8");
    assert.match(component, /key: "1d", label: "1D"/);
    assert.match(component, /Trading session colors/);
    assert.match(component, /dataKey="regularClose"/);
    assert.match(component, /dataKey="extendedClose"/);
    assert.match(component, />Regular session</);
    assert.match(component, />Pre-market \/ after-hours</);
    assert.match(component, /previousRegularSession !== regularSession/);
    assert.match(component, /regularClose: regularSession \|\| sessionChanged \? point\.close : null/);
    assert.match(component, /extendedClose: !regularSession \|\| sessionChanged \? point\.close : null/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("serves maximum available Yahoo Finance history for long chart ranges", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response(JSON.stringify({
    chart: {
      result: [{
        timestamp: [345479400, 1786132800],
        indicators: {
          quote: [{
            open: [0.13, 225.0],
            high: [0.14, 230.0],
            low: [0.12, 224.0],
            close: [0.13, 229.5],
            volume: [469_033_600, 54_000_000],
          }],
        },
      }],
      error: null,
    },
  }), { headers: { "content-type": "application/json" } });

  try {
    const workerUrl = new URL("../dist/server/index.js", import.meta.url);
    workerUrl.searchParams.set("max-price-history-test", `${process.pid}-${Date.now()}`);
    const { default: worker } = await import(workerUrl.href);
    const response = await worker.fetch(
      new Request("http://localhost/api/v1/companies/LONG/price-history?range=max"),
      { ASSETS: { fetch: async () => new Response("Not found", { status: 404 }) } },
      { waitUntil() {}, passThroughOnException() {} },
    );
    assert.equal(response.status, 200);
    const payload = await response.json();
    assert.equal(payload.data.range, "max");
    assert.equal(payload.data.provider, "Yahoo Finance historical prices");
    assert.equal(payload.data.points.length, 2);
    assert.equal(payload.data.points[0].close, 0.13);
    assert.equal(payload.data.points.at(-1).close, 229.5);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("normalizes Mastercard tag transitions and comparative annual facts", () => {
  const annual = (fy, start, end, val, filed = "2026-02-11") => ({
    form: "10-K",
    fp: "FY",
    fy,
    start,
    end,
    filed,
    val,
    accn: "0001141391-26-000013",
  });
  const instant = (fy, end, val) => ({
    form: "10-K",
    fp: "FY",
    fy,
    end,
    filed: "2026-02-11",
    val,
    accn: "0001141391-26-000013",
  });
  const payload = {
    cik: 1141391,
    facts: {
      "us-gaap": {
        RevenueFromContractWithCustomerExcludingAssessedTax: { units: { USD: [
          annual(2021, "2021-01-01", "2021-12-31", 29_845_000_000, "2022-02-11"),
        ] } },
        Revenues: { units: { USD: [
          annual(2023, "2022-01-01", "2022-12-31", 22_237_000_000, "2024-02-13"),
          annual(2025, "2023-01-01", "2023-12-31", 25_098_000_000),
          annual(2025, "2024-01-01", "2024-12-31", 28_167_000_000),
          annual(2025, "2025-01-01", "2025-12-31", 32_791_000_000),
        ] } },
        OperatingIncomeLoss: { units: { USD: [
          annual(2025, "2023-01-01", "2023-12-31", 14_008_000_000),
          annual(2025, "2024-01-01", "2024-12-31", 15_582_000_000),
          annual(2025, "2025-01-01", "2025-12-31", 18_897_000_000),
        ] } },
        NetIncomeLoss: { units: { USD: [
          annual(2025, "2023-01-01", "2023-12-31", 11_195_000_000),
          annual(2025, "2024-01-01", "2024-12-31", 12_874_000_000),
          annual(2025, "2025-01-01", "2025-12-31", 15_022_000_000),
        ] } },
        NetCashProvidedByUsedInOperatingActivities: { units: { USD: [
          annual(2025, "2023-01-01", "2023-12-31", 11_980_000_000),
          annual(2025, "2024-01-01", "2024-12-31", 14_780_000_000),
          annual(2025, "2025-01-01", "2025-12-31", 17_648_000_000),
        ] } },
        PaymentsToAcquirePropertyPlantAndEquipment: { units: { USD: [
          annual(2025, "2023-01-01", "2023-12-31", 371_000_000),
          annual(2025, "2024-01-01", "2024-12-31", 474_000_000),
          annual(2025, "2025-01-01", "2025-12-31", 489_000_000),
        ] } },
        CashAndCashEquivalentsAtCarryingValue: { units: { USD: [instant(2025, "2025-12-31", 10_566_000_000)] } },
        Assets: { units: { USD: [instant(2025, "2025-12-31", 54_157_000_000)] } },
        Liabilities: { units: { USD: [instant(2025, "2025-12-31", 46_411_000_000)] } },
        StockholdersEquity: { units: { USD: [instant(2025, "2025-12-31", 7_737_000_000)] } },
        LongTermDebtNoncurrent: { units: { USD: [instant(2025, "2025-12-31", 18_251_000_000)] } },
      },
    },
  };

  const periods = normalizeCompanyFacts(payload);
  assert.deepEqual(periods.map((period) => period.fiscal_year), [2021, 2022, 2023, 2024, 2025]);
  assert.equal(periods.at(-1).values.revenue, 32_791_000_000);
  assert.equal(periods.at(-1).values.operating_income, 18_897_000_000);
  assert.equal(periods.at(-1).values.cash_and_investments, 10_566_000_000);
  assert.equal(periods.at(-1).values.total_assets, 54_157_000_000);
  assert.equal(periods.at(-1).values.total_debt, 18_251_000_000);
  assert.equal(periods.at(-1).values.free_cash_flow, 17_159_000_000);

  const balanceGroup = FINANCIAL_GROUPS.find((group) => group.key === "balanceSheet");
  const chart = buildFinancialExplorerData(periods, balanceGroup);
  assert.equal(chart.at(-1).cash_and_investments, 10.566);
  assert.equal(chart.at(-1).total_assets, 54.157);
});

test("normalizes stand-alone SEC quarters and derives fourth-quarter cash flow", () => {
  const duration = (fy, fp, start, end, val, form = "10-Q") => ({
    form,
    fp,
    fy,
    start,
    end,
    filed: form === "10-K" ? "2026-02-15" : `${end.slice(0, 7)}-25`,
    val,
    accn: `quarter-${fy}-${fp}`,
  });
  const instant = (fy, fp, end, val, form = "10-Q") => ({
    form,
    fp,
    fy,
    end,
    filed: form === "10-K" ? "2026-02-15" : `${end.slice(0, 7)}-25`,
    val,
    accn: `instant-${fy}-${fp}`,
  });
  const payload = {
    cik: 123456,
    facts: { "us-gaap": {
      Revenues: { units: { USD: [
        duration(2025, "Q1", "2025-01-01", "2025-03-31", 100),
        duration(2025, "Q2", "2025-04-01", "2025-06-30", 120),
        duration(2025, "Q3", "2025-07-01", "2025-09-30", 140),
        duration(2025, "FY", "2025-01-01", "2025-12-31", 520, "10-K"),
      ] } },
      NetIncomeLoss: { units: { USD: [
        duration(2025, "Q1", "2025-01-01", "2025-03-31", 20),
        duration(2025, "Q2", "2025-04-01", "2025-06-30", 24),
        duration(2025, "Q3", "2025-07-01", "2025-09-30", 28),
        duration(2025, "FY", "2025-01-01", "2025-12-31", 100, "10-K"),
      ] } },
      NetCashProvidedByUsedInOperatingActivities: { units: { USD: [
        duration(2025, "Q1", "2025-01-01", "2025-03-31", 100),
        duration(2025, "Q2", "2025-01-01", "2025-06-30", 250),
        duration(2025, "Q3", "2025-01-01", "2025-09-30", 450),
        duration(2025, "FY", "2025-01-01", "2025-12-31", 700, "10-K"),
      ] } },
      PaymentsToAcquirePropertyPlantAndEquipment: { units: { USD: [
        duration(2025, "Q1", "2025-01-01", "2025-03-31", 10),
        duration(2025, "Q2", "2025-01-01", "2025-06-30", 25),
        duration(2025, "Q3", "2025-01-01", "2025-09-30", 45),
        duration(2025, "FY", "2025-01-01", "2025-12-31", 70, "10-K"),
      ] } },
      Assets: { units: { USD: [
        instant(2025, "Q1", "2025-03-31", 1_000),
        instant(2025, "Q2", "2025-06-30", 1_050),
        instant(2025, "Q3", "2025-09-30", 1_100),
        instant(2025, "FY", "2025-12-31", 1_200, "10-K"),
      ] } },
    } },
  };

  const quarters = normalizeQuarterlyCompanyFacts(payload);
  assert.deepEqual(quarters.map((period) => period.period_type), ["Q1", "Q2", "Q3", "Q4"]);
  assert.deepEqual(quarters.map((period) => period.values.revenue), [100, 120, 140, 160]);
  assert.deepEqual(quarters.map((period) => period.values.operating_cash_flow), [100, 150, 200, 250]);
  assert.deepEqual(quarters.map((period) => period.values.capex), [10, 15, 20, 25]);
  assert.deepEqual(quarters.map((period) => period.values.free_cash_flow), [90, 135, 180, 225]);
  assert.deepEqual(quarters.map((period) => period.values.total_assets), [1_000, 1_050, 1_100, 1_200]);
});

test("searches the SEC security universe with stable listing identities", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input, init) => {
    const url = input instanceof Request ? input.url : String(input);
    if (url === "https://www.sec.gov/files/company_tickers_exchange.json") {
      return new Response(JSON.stringify({
        fields: ["cik", "name", "ticker", "exchange"],
        data: [
          [320193, "Apple Inc.", "AAPL", "Nasdaq"],
          [1652044, "Alphabet Inc.", "GOOG", "Nasdaq"],
          [1652044, "Alphabet Inc.", "GOOGL", "Nasdaq"],
          [1067983, "Berkshire Hathaway Inc.", "BRK-B", "NYSE"],
        ],
      }), { headers: { "content-type": "application/json" } });
    }
    return originalFetch(input, init);
  };

  try {
    const workerUrl = new URL("../dist/server/index.js", import.meta.url);
    workerUrl.searchParams.set("search-test", `${process.pid}-${Date.now()}`);
    const { default: worker } = await import(workerUrl.href);
    const response = await worker.fetch(
      new Request("http://localhost/api/v1/search?q=BRK.B&limit=8"),
      { ASSETS: { fetch: async () => new Response("Not found", { status: 404 }) } },
      { waitUntil() {}, passThroughOnException() {} },
    );

    assert.equal(response.status, 200);
    const payload = await response.json();
    assert.equal(payload[0].ticker, "BRK-B");
    assert.equal(payload[0].issuer_id, "sec-cik:0001067983");
    assert.equal(payload[0].listing_id, "listing:xnys:brk-b");
    assert.equal(payload[0].mic, "XNYS");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("ranks an exact company brand ahead of longer lookalike names", () => {
  const entries = parseSecurityMaster({
    fields: ["cik", "name", "ticker", "exchange"],
    data: [
      [2010630, "Apple iSports Group, Inc.", "AAPI", "Nasdaq"],
      [320193, "Apple Inc.", "AAPL", "Nasdaq"],
    ],
  });

  const results = searchSecurityEntries(entries, "apple", 8);
  assert.equal(results[0]?.ticker, "AAPL");
  assert.equal(results[0]?.name, "Apple Inc.");
});

test("serves a complete AAPL analysis through the hosted API", async () => {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("api-test", `${process.pid}-${Date.now()}`);
  const { default: worker } = await import(workerUrl.href);
  const response = await worker.fetch(
    new Request("http://localhost/api/v1/companies/AAPL/analysis"),
    { ASSETS: { fetch: async () => new Response("Not found", { status: 404 }) } },
    { waitUntil() {}, passThroughOnException() {} },
  );

  assert.equal(response.status, 200);
  assert.match(response.headers.get("cache-control") ?? "", /s-maxage=300/);
  assert.match(response.headers.get("server-timing") ?? "", /app;dur=/);
  assert.ok(response.headers.get("etag"));
  const payload = await response.json();
  assert.equal(payload.data.company.ticker, "AAPL");
  assert.ok(payload.data.financials.length >= 5);
  assert.ok(Array.isArray(payload.data.quarterly_financials));
  assert.ok(Array.isArray(payload.data.analyst_estimates.quarterly));
  assert.ok(Number.isFinite(payload.data.headline.fair_value));
  assert.ok(Number.isFinite(payload.data.metrics.pe));
  assert.ok(Number.isFinite(payload.data.metrics.price_to_book));
  assert.ok(Number.isFinite(payload.data.metrics.revenue_growth_yoy));
  assert.ok(Number.isFinite(payload.data.metrics.net_income_growth_yoy));
  assert.ok(Number.isFinite(payload.data.valuation.growth_projection.peg_ratio));
  assert.ok(payload.data.headline.buy_target < payload.data.headline.fair_value);
  assert.equal(payload.data.score.overall >= 0 && payload.data.score.overall <= 100, true);

  const overviewResponse = await worker.fetch(
    new Request("http://localhost/api/v1/companies/AAPL/analysis?view=overview"),
    { ASSETS: { fetch: async () => new Response("Not found", { status: 404 }) } },
    { waitUntil() {}, passThroughOnException() {} },
  );
  assert.equal(overviewResponse.status, 200);
  const overviewPayload = await overviewResponse.json();
  assert.equal(overviewPayload.data.data_scope, "overview");
  assert.deepEqual(overviewPayload.data.quarterly_financials, []);
  assert.deepEqual(overviewPayload.data.comps, []);
  assert.deepEqual(overviewPayload.data.filings, []);
  assert.deepEqual(overviewPayload.data.risks, []);
  assert.ok(JSON.stringify(overviewPayload.data).length < JSON.stringify(payload.data).length * 0.5);

  const financialsResponse = await worker.fetch(
    new Request("http://localhost/api/v1/companies/AAPL/analysis?view=financials"),
    { ASSETS: { fetch: async () => new Response("Not found", { status: 404 }) } },
    { waitUntil() {}, passThroughOnException() {} },
  );
  assert.equal(financialsResponse.status, 200);
  const financialsPayload = await financialsResponse.json();
  assert.equal(financialsPayload.data.data_scope, "partial");
  assert.deepEqual(financialsPayload.data.loaded_sections, ["overview", "financials"]);
  assert.ok(financialsPayload.data.quarterly_financials.length > 0);
  assert.deepEqual(financialsPayload.data.comps, []);
  assert.ok(financialsPayload.data.analyst_estimates.annual.length > 0);
});

test("resolves logo candidates and robust fallback initials for required companies", () => {
  const testedCompanies = [
    { ticker: "AAPL", name: "Apple Inc.", expectedInitials: "AA", domainMatch: "apple.com" },
    { ticker: "MSFT", name: "Microsoft Corporation", expectedInitials: "MS", domainMatch: "microsoft.com" },
    { ticker: "TSLA", name: "Tesla, Inc.", expectedInitials: "TS", domainMatch: "tesla.com" },
    { ticker: "MA", name: "Mastercard Incorporated", expectedInitials: "MA", domainMatch: "mastercard.com" },
    { ticker: "DELL", name: "Dell Technologies Inc.", expectedInitials: "DE", domainMatch: "dell.com" },
    { ticker: "SNDK", name: "Sandisk Corporation", expectedInitials: "SN", domainMatch: "sandisk.com" },
    { ticker: "BRK.B", name: "Berkshire Hathaway Inc.", expectedInitials: "BRK", domainMatch: "berkshirehathaway.com" },
    { ticker: "BRK.A", name: "Berkshire Hathaway Inc.", expectedInitials: "BRK", domainMatch: "berkshirehathaway.com" },
    { ticker: "BRK-B", name: "Berkshire Hathaway Inc.", expectedInitials: "BRK", domainMatch: "berkshirehathaway.com" },
    { ticker: "W", name: "Wayfair Inc.", expectedInitials: "W", domainMatch: "wayfair.com" },
  ];

  for (const company of testedCompanies) {
    const candidates = getLogoCandidates(company.ticker);
    assert.ok(candidates.length >= 2, `Expected at least 2 logo candidates for ${company.ticker}, got ${candidates.length}`);
    assert.ok(candidates[0].includes("assets.parqet.com"), `Primary candidate for ${company.ticker} must be Parqet symbol PNG: ${candidates[0]}`);
    assert.ok(candidates.some((url) => url.includes("financialmodelingprep.com")), `Candidates for ${company.ticker} must include FMP: ${candidates}`);
    if (company.domainMatch) {
      assert.ok(candidates.some((url) => url.includes(company.domainMatch)), `Candidates for ${company.ticker} must include domain fallback: ${candidates}`);
    }

    const initials = getTickerInitials(company.ticker, company.name);
    assert.equal(initials, company.expectedInitials, `Initials for ${company.ticker} mismatch`);

    const badgeStyle = getInitialsBadgeStyle(company.ticker);
    assert.ok(badgeStyle.background.startsWith("hsl("));
    assert.ok(badgeStyle.color.startsWith("hsl("));
  }

  // Ticker normalization
  assert.equal(normalizeTicker("BRK.B"), "BRK-B");
  assert.equal(normalizeTicker("brk.a"), "BRK-A");
  assert.equal(normalizeTicker("w"), "W");

  // Initials fallback when no ticker is provided
  assert.equal(getTickerInitials("", "Tesla Motors"), "TM");
  assert.equal(getTickerInitials("", "Wayfair"), "WA");
});
