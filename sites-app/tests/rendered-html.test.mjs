import assert from "node:assert/strict";
import { readFile, readdir, stat } from "node:fs/promises";
import test from "node:test";

import { buildFinancialChartData, formatBillions } from "../../frontend/lib/chart.ts";
import { buildFinancialExplorerData, FINANCIAL_GROUPS } from "../../frontend/lib/financials.ts";
import { normalizeCompanyFacts, normalizeQuarterlyCompanyFacts } from "../lib/server/sec-normalizer.ts";
import { calculatePegProjection } from "../lib/server/peg.ts";
import { extractRiskFactorHeadings } from "../lib/server/risk-factors.ts";
import { summarizeCompanyDescription } from "../lib/server/company-description.ts";
import { cacheIdentity, hasSameFinancialFingerprint, isAnalysisCacheCompatible, parseCachedAnalysisRow } from "../lib/server/analysis-cache.ts";
import { buildAnalysis } from "../lib/server/analysis.ts";
import { ANALYSIS_SCHEMA_VERSION, COMPONENT_SOURCE_VERSIONS, NORMALIZATION_VERSION, SCORE_MODEL_VERSION, VALUATION_MODEL_VERSION } from "../lib/server/model-versions.ts";
import { extractPeerBusinessContext, rankPeerCandidates } from "../lib/server/peer-selection.ts";

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
  assert.match(css, /\.comps-matrix-scroll\s*\{[^}]*overflow-x:\s*auto/s);
  assert.match(css, /\.comps-matrix-table\s*\{[^}]*width:\s*100%[^}]*min-width:\s*1120px/s);
  assert.match(css, /\.comps-company-link\s*\{[^}]*text-align:\s*left/s);
});

test("makes comparable company profiles directly navigable", async () => {
  const component = await readFile(new URL("../../frontend/components/ResearchTerminal.tsx", import.meta.url), "utf8");
  assert.match(component, /onClick=\{\(\) => onSelectCompany\(peer\.ticker\)\}/);
  assert.match(component, /aria-label=\{`Open \$\{peer\.name\} profile`\}/);
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
});
