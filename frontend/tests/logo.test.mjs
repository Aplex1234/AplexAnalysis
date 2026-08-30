import assert from "node:assert/strict";
import test from "node:test";

import {
  getInitialsBadgeStyle,
  getLogoCandidates,
  getTickerInitials,
  normalizeTicker,
} from "../lib/logo.ts";

test("normalizes tickers for logo lookup", () => {
  assert.equal(normalizeTicker("BRK.B"), "BRK-B");
  assert.equal(normalizeTicker("BRK.A"), "BRK-A");
  assert.equal(normalizeTicker("BRK/B"), "BRK-B");
  assert.equal(normalizeTicker("aapl"), "AAPL");
  assert.equal(normalizeTicker("w"), "W");
});

test("extracts clean ticker initials for fallback badges", () => {
  assert.equal(getTickerInitials("AAPL", "Apple Inc."), "AA");
  assert.equal(getTickerInitials("MSFT", "Microsoft Corporation"), "MS");
  assert.equal(getTickerInitials("TSLA", "Tesla, Inc."), "TS");
  assert.equal(getTickerInitials("MA", "Mastercard Incorporated"), "MA");
  assert.equal(getTickerInitials("DELL", "Dell Technologies Inc."), "DE");
  assert.equal(getTickerInitials("SNDK", "Sandisk Corporation"), "SN");
  assert.equal(getTickerInitials("BRK.B", "Berkshire Hathaway Inc."), "BRK");
  assert.equal(getTickerInitials("BRK-A", "Berkshire Hathaway Inc."), "BRK");
  assert.equal(getTickerInitials("W", "Wayfair Inc."), "W");
  assert.equal(getTickerInitials("", "Tesla Motors"), "TM");
  assert.equal(getTickerInitials("", "Wayfair"), "WA");
  assert.equal(getTickerInitials("", ""), "CO");
});

test("generates prioritized candidates for all required test companies", () => {
  const companies = [
    { ticker: "AAPL", domain: "apple.com" },
    { ticker: "MSFT", domain: "microsoft.com" },
    { ticker: "TSLA", domain: "tesla.com" },
    { ticker: "MA", domain: "mastercard.com" },
    { ticker: "DELL", domain: "dell.com" },
    { ticker: "SNDK", domain: "sandisk.com" },
    { ticker: "BRK.B", domain: "berkshirehathaway.com" },
    { ticker: "BRK.A", domain: "berkshirehathaway.com" },
    { ticker: "W", domain: "wayfair.com" },
  ];

  for (const item of companies) {
    const candidates = getLogoCandidates(item.ticker);
    assert.ok(candidates.length >= 2, "Expected at least 2 candidates for " + item.ticker);
    assert.ok(candidates[0].includes("assets.parqet.com"), "Primary must be Parqet CDN for " + item.ticker);
    assert.ok(candidates.some((u) => u.includes("financialmodelingprep.com")), "Must include FMP candidate for " + item.ticker);
    assert.ok(candidates.some((u) => u.includes(item.domain)), "Must include domain fallback candidate for " + item.ticker);
  }
});

test("generates deterministic badge hues for dark background initials", () => {
  const style1 = getInitialsBadgeStyle("AAPL");
  const style2 = getInitialsBadgeStyle("AAPL");
  const styleTsla = getInitialsBadgeStyle("TSLA");

  assert.deepEqual(style1, style2);
  assert.ok(style1.background.startsWith("hsl("));
  assert.ok(style1.color.startsWith("hsl("));
  assert.notDeepEqual(style1, styleTsla);
});
