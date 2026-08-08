import assert from "node:assert/strict";
import test from "node:test";

import { buildFinancialChartData, formatBillions } from "../../frontend/lib/chart.ts";
import { buildFinancialExplorerData, FINANCIAL_GROUPS } from "../../frontend/lib/financials.ts";
import { normalizeCompanyFacts } from "../lib/server/sec-normalizer.ts";

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
  assert.ok(payload.data.headline.buy_target < payload.data.headline.fair_value);
  assert.equal(payload.data.score.overall >= 0 && payload.data.score.overall <= 100, true);
});
