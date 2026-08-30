import assert from "node:assert/strict";
import test from "node:test";

import {
  buildFinancialExplorerData,
  FINANCIAL_GROUPS,
  formatScaledMoney,
  getFinancialScale,
} from "../lib/financials.ts";
import { buildFinancialChartData } from "../lib/chart.ts";

test("getFinancialScale detects millions for small caps like POCI", () => {
  const pociPeriods = [
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

  const [data] = buildFinancialExplorerData(pociPeriods, incomeGroup, scale.factor);
  assert.equal(data.revenue, 24.8);
  assert.equal(data.gross_profit, 12.1);
  assert.equal(data.operating_income, -3.2);
  assert.equal(data.net_income, -3.5);

  assert.equal(formatScaledMoney(data.revenue, scale.unit), "$24.8M");
  assert.equal(formatScaledMoney(data.operating_income, scale.unit), "-$3.2M");
  assert.equal(formatScaledMoney(0, scale.unit), "$0.0M");
  assert.equal(formatScaledMoney(-0.0001, scale.unit), "$0.0M");
});

test("getFinancialScale detects billions for large caps like Apple", () => {
  const aaplPeriods = [
    {
      fiscal_year: 2025,
      period_type: "FY",
      period_end: "2025-09-30",
      filed_at: "2025-10-31",
      accession_number: "aapl-2025",
      form: "10-K",
      currency: "USD",
      values: {
        revenue: 391_000_000_000,
        gross_profit: 180_000_000_000,
        operating_income: 123_000_000_000,
        net_income: 93_000_000_000,
      },
      provenance: {},
    },
  ];

  const incomeGroup = FINANCIAL_GROUPS.find((g) => g.key === "income");
  const scale = getFinancialScale(aaplPeriods, incomeGroup);
  assert.equal(scale.factor, 1_000_000_000);
  assert.equal(scale.unit, "B");
  assert.equal(scale.label, "in billions");

  const [data] = buildFinancialExplorerData(aaplPeriods, incomeGroup, scale.factor);
  assert.equal(data.revenue, 391);
  assert.equal(formatScaledMoney(data.revenue, scale.unit), "$391.0B");
});
