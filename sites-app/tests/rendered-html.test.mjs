import assert from "node:assert/strict";
import test from "node:test";

import { buildFinancialChartData, formatBillions } from "../../frontend/lib/chart.ts";
import { buildFinancialExplorerData, FINANCIAL_GROUPS } from "../../frontend/lib/financials.ts";
import { normalizeCompanyFacts } from "../lib/server/sec-normalizer.ts";
import { calculatePegProjection } from "../lib/server/peg.ts";
import { extractRiskFactorHeadings } from "../lib/server/risk-factors.ts";

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

test("server-renders the AplexAnalysis terminal", async () => {
  const response = await render();
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type") ?? "", /^text\/html\b/i);

  const html = await response.text();
  assert.match(html, /<title>AplexAnalysis \| Equity Research Terminal<\/title>/i);
  assert.match(html, /AplexAnalysis/);
  assert.match(html, /Ticker or company/);
  assert.match(html, /Research software\. Not investment advice\./);
  assert.doesNotMatch(html, /codex-preview|Your site is taking shape/);
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
  const payload = await response.json();
  assert.equal(payload.data.company.ticker, "AAPL");
  assert.ok(payload.data.financials.length >= 5);
  assert.ok(Number.isFinite(payload.data.headline.fair_value));
  assert.ok(Number.isFinite(payload.data.metrics.pe));
  assert.ok(Number.isFinite(payload.data.metrics.price_to_book));
  assert.ok(Number.isFinite(payload.data.metrics.revenue_growth_yoy));
  assert.ok(Number.isFinite(payload.data.metrics.net_income_growth_yoy));
  assert.ok(Number.isFinite(payload.data.valuation.growth_projection.peg_ratio));
  assert.ok(payload.data.headline.buy_target < payload.data.headline.fair_value);
  assert.equal(payload.data.score.overall >= 0 && payload.data.score.overall <= 100, true);
});
