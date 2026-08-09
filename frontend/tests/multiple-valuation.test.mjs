import assert from "node:assert/strict";
import test from "node:test";

import {
  calculateCagr,
  impliedValuationLabel,
  periodGrowth,
  projectMultipleValuation,
} from "../lib/multiple-valuation.ts";

test("projects the user's net-income multiple example", () => {
  const result = projectMultipleValuation({
    basis: "net_income",
    forecastYears: 5,
    currentNetIncome: 100_000_000,
    currentEps: 1,
    currentShares: 100_000_000,
    currentPrice: 40,
    currentMarketCap: 4_000_000_000,
    annualShareChange: 0,
    scenario: { growthRate: 0.18, exitPe: 30 },
  });

  assert.ok(Math.abs(result.projectedNetIncome - 228_775_775.68) < 1);
  assert.ok(Math.abs(result.projectedMarketCap - 6_863_273_270.4) < 1);
  assert.ok(Math.abs(result.pegRatio - 1.6666667) < 0.0001);
  assert.equal(result.valuationLabel, "Undervalued");
});

test("EPS valuation includes projected share count in market capitalization", () => {
  const result = projectMultipleValuation({
    basis: "eps",
    forecastYears: 5,
    currentNetIncome: 500_000_000,
    currentEps: 5,
    currentShares: 100_000_000,
    currentPrice: 100,
    currentMarketCap: 10_000_000_000,
    annualShareChange: -0.02,
    scenario: { growthRate: 0.10, exitPe: 20 },
  });

  assert.ok(Math.abs(result.projectedEps - 8.05255) < 0.0001);
  assert.ok(Math.abs(result.projectedShares - 90_392_079.68) < 1);
  assert.ok(Math.abs(result.projectedSharePrice - 161.051) < 0.001);
  assert.ok(result.projectedMarketCap > 14_000_000_000);
});

test("valuation labels follow implied annual return thresholds", () => {
  assert.equal(impliedValuationLabel(0.20), "Undervalued");
  assert.equal(impliedValuationLabel(0.07), "Fairly valued");
  assert.equal(impliedValuationLabel(0.01), "Overvalued");
  assert.equal(impliedValuationLabel(null), "Unavailable");
});

test("growth helpers avoid misleading percentages across losses", () => {
  assert.ok(Math.abs(calculateCagr(100, 121, 2) - 0.10) < 0.000001);
  assert.ok(Math.abs(periodGrowth(120, 100) - 0.20) < 0.000001);
  assert.equal(periodGrowth(10, -5), null);
  assert.equal(periodGrowth(-10, 5), null);
});
