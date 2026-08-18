import assert from "node:assert/strict";
import test from "node:test";

import {
  getInitialsBadgeStyle,
  getLogoCandidates,
  getTickerInitials,
  normalizeTicker,
} from "../lib/logo.ts";

test("normalizes tickers for logo resolution", () => {
  assert.equal(normalizeTicker("AAPL"), "AAPL");
  assert.equal(normalizeTicker("MSFT"), "MSFT");
  assert.equal(normalizeTicker("TSLA"), "TSLA");
  assert.equal(normalizeTicker("MA"), "MA");
  assert.equal(normalizeTicker("DELL"), "DELL");
  assert.equal(normalizeTicker("SNDK"), "SNDK");
  assert.equal(normalizeTicker("BRK.A"), "BRK-A");
  assert.equal(normalizeTicker("BRK.B"), "BRK-B");
  assert.equal(normalizeTicker("brk/b"), "BRK-B");
  assert.equal(normalizeTicker(""), "");
});

test("extracts clean initials for all tested companies", () => {
  assert.equal(getTickerInitials("AAPL"), "AA");
  assert.equal(getTickerInitials("MSFT"), "MS");
  assert.equal(getTickerInitials("TSLA"), "TS");
  assert.equal(getTickerInitials("MA"), "MA");
  assert.equal(getTickerInitials("DELL"), "DE");
  assert.equal(getTickerInitials("SNDK"), "SN");
  assert.equal(getTickerInitials("BRK.A"), "BRK");
  assert.equal(getTickerInitials("BRK.B"), "BRK");
  assert.equal(getTickerInitials("BRK-B"), "BRK");
  assert.equal(getTickerInitials("", "Apple Inc."), "AI");
});

test("generates prioritized candidate URLs for each target company", () => {
  const targetTickers = ["AAPL", "MSFT", "TSLA", "MA", "DELL", "SNDK", "BRK.A", "BRK.B"];

  for (const ticker of targetTickers) {
    const candidates = getLogoCandidates(ticker);
    assert.ok(candidates.length >= 2, `Expected multiple candidates for ${ticker}`);
    assert.ok(
      candidates[0].includes("assets.parqet.com/logos/symbol/"),
      `Primary candidate should be parqet symbol for ${ticker}`,
    );
    assert.ok(
      candidates[1].includes("financialmodelingprep.com/image-stock/"),
      `Secondary candidate should be FMP for ${ticker}`,
    );
  }
});

test("generates deterministic badge colors for initials avatar", () => {
  const c1 = getInitialsBadgeStyle("AAPL");
  const c2 = getInitialsBadgeStyle("AAPL");
  const c3 = getInitialsBadgeStyle("MSFT");

  assert.equal(c1.background, c2.background);
  assert.equal(c1.color, c2.color);
  assert.notEqual(c1.background, c3.background);
});
