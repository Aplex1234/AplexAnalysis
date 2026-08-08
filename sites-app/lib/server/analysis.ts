import { normalizeTicker, resolveSecurity } from "./security-master";
import {
  normalizeCompanyFacts,
  type FinancialValues,
  type NormalizedPeriod,
  type SecCompanyFacts,
} from "./sec-normalizer";

type Values = FinancialValues;
type CompanyProfile = {
  cik: string;
  name: string;
  sector: string | null;
  industry: string | null;
  exchange: string | null;
  description: string | null;
};
type Filing = {
  form: string;
  filing_date: string | null;
  report_date: string | null;
  accession_number: string;
  source_url: string;
};
type FinancialSource = { profile: CompanyProfile; periods: Period[]; filings: Filing[] };
type Quote = {
  price: number;
  as_of: string;
  currency: string;
  provider: string;
  source_url: string | null;
  is_delayed: boolean;
};
type Period = NormalizedPeriod;

export type Assumptions = {
  forecast_years: number;
  revenue_growth: number | null;
  fcf_margin: number | null;
  wacc: number;
  terminal_growth: number;
};

const M = 1_000_000;
const DEFAULT_ASSUMPTIONS: Assumptions = {
  forecast_years: 5,
  revenue_growth: null,
  fcf_margin: null,
  wacc: 0.09,
  terminal_growth: 0.025,
};

function period(
  fiscalYear: number,
  revenue: number,
  grossProfit: number,
  operatingIncome: number,
  netIncome: number,
  operatingCashFlow: number,
  capex: number,
  cash: number,
  debt: number,
  equity: number,
  shares: number,
  repurchases: number,
): Period {
  const values: Values = {
    revenue: revenue * M,
    gross_profit: grossProfit * M,
    operating_income: operatingIncome * M,
    net_income: netIncome * M,
    operating_cash_flow: operatingCashFlow * M,
    capex: capex * M,
    free_cash_flow: (operatingCashFlow - capex) * M,
    cash: cash * M,
    long_term_debt: debt * M,
    equity: equity * M,
    diluted_shares: shares * M,
    shares_outstanding: shares * M,
    share_repurchases: repurchases * M,
    diluted_eps: netIncome / shares,
  };
  return {
    fiscal_year: fiscalYear,
    period_type: "FY",
    period_end: null,
    filed_at: null,
    accession_number: null,
    form: "10-K",
    currency: "USD",
    values,
    provenance: Object.fromEntries(
      Object.keys(values).map((key) => [
        key,
        {
          provider: "Bundled SEC-derived fallback snapshot",
          as_of: "2025-02-28",
          note: "Used only when live SEC retrieval is unavailable",
        },
      ]),
    ),
  };
}

const FALLBACK: Record<string, { profile: CompanyProfile; price: number; priceAsOf: string; periods: Period[] }> = {
  AAPL: {
    profile: {
      cik: "0000320193",
      name: "Apple Inc.",
      sector: "Technology",
      industry: "Consumer Electronics",
      exchange: "NASDAQ",
      description:
        "Apple designs, manufactures and markets smartphones, computers, tablets, wearables and related services.",
    },
    price: 243.85,
    priceAsOf: "2025-01-02",
    periods: [
      period(2020, 274515, 104956, 66288, 57411, 80674, 7309, 38016, 98667, 65339, 17528, 72358),
      period(2021, 365817, 152836, 108949, 94680, 104038, 11085, 34940, 109106, 63090, 16865, 85971),
      period(2022, 394328, 170782, 119437, 99803, 122151, 10708, 23646, 111109, 50672, 16216, 89402),
      period(2023, 383285, 169148, 114301, 96995, 110543, 10959, 29965, 106548, 62146, 15813, 77550),
      period(2024, 391035, 180683, 123216, 93736, 118254, 9447, 29943, 106629, 56950, 15242, 94949),
    ],
  },
  NVDA: {
    profile: {
      cik: "0001045810",
      name: "NVIDIA Corporation",
      sector: "Technology",
      industry: "Semiconductors",
      exchange: "NASDAQ",
      description:
        "NVIDIA develops accelerated computing platforms for data center, gaming, visualization and automotive markets.",
    },
    price: 138.31,
    priceAsOf: "2025-01-02",
    periods: [
      period(2021, 16675, 10396, 4532, 4332, 5822, 1128, 11561, 6963, 16893, 24800, 0),
      period(2022, 26914, 17475, 10041, 9752, 9108, 976, 21208, 10946, 26612, 25060, 0),
      period(2023, 26974, 15356, 4224, 4368, 5641, 1833, 13296, 10956, 22101, 24700, 10039),
      period(2024, 60922, 44301, 32972, 29760, 28090, 1069, 25984, 11056, 42978, 24670, 9533),
      period(2025, 130497, 97858, 81453, 72880, 64089, 3236, 43210, 8463, 79327, 24490, 3327),
    ],
  },
  COST: {
    profile: {
      cik: "0000909832",
      name: "Costco Wholesale Corporation",
      sector: "Consumer Defensive",
      industry: "Discount Stores",
      exchange: "NASDAQ",
      description: "Costco operates membership warehouses and e-commerce sites with limited-selection merchandise.",
    },
    price: 916,
    priceAsOf: "2025-01-02",
    periods: [
      period(2020, 166761, 21514, 5435, 4002, 8861, 2810, 12277, 7529, 18284, 443, 196),
      period(2021, 195929, 25745, 6708, 5007, 8958, 3588, 12175, 7571, 17767, 444, 496),
      period(2022, 226954, 29084, 7793, 5844, 7386, 3891, 10203, 7494, 20642, 444, 439),
      period(2023, 242290, 29515, 8114, 6292, 11869, 4323, 13700, 6593, 25058, 444, 676),
      period(2024, 254453, 32242, 9285, 7367, 11286, 4710, 9906, 5756, 28742, 444, 700),
    ],
  },
};

const PEERS: Record<string, Array<Record<string, number | string>>> = {
  AAPL: [
    { ticker: "MSFT", revenue_growth: 0.16, ebitda_margin: 0.53, fcf_margin: 0.34, roic: 0.27, pe: 35, ev_revenue: 12, ev_ebitda: 23, price_fcf: 37 },
    { ticker: "GOOGL", revenue_growth: 0.14, ebitda_margin: 0.36, fcf_margin: 0.25, roic: 0.24, pe: 24, ev_revenue: 6.5, ev_ebitda: 18, price_fcf: 26 },
    { ticker: "DELL", revenue_growth: 0.09, ebitda_margin: 0.1, fcf_margin: 0.05, roic: 0.31, pe: 20, ev_revenue: 1, ev_ebitda: 10, price_fcf: 22 },
  ],
  NVDA: [
    { ticker: "AMD", revenue_growth: 0.24, ebitda_margin: 0.25, fcf_margin: 0.14, roic: 0.08, pe: 47, ev_revenue: 10, ev_ebitda: 39, price_fcf: 58 },
    { ticker: "AVGO", revenue_growth: 0.44, ebitda_margin: 0.59, fcf_margin: 0.41, roic: 0.18, pe: 36, ev_revenue: 19, ev_ebitda: 31, price_fcf: 39 },
    { ticker: "QCOM", revenue_growth: 0.11, ebitda_margin: 0.35, fcf_margin: 0.29, roic: 0.22, pe: 18, ev_revenue: 5, ev_ebitda: 14, price_fcf: 20 },
  ],
  COST: [
    { ticker: "WMT", revenue_growth: 0.06, ebitda_margin: 0.07, fcf_margin: 0.02, roic: 0.14, pe: 35, ev_revenue: 1.2, ev_ebitda: 17, price_fcf: 41 },
    { ticker: "TGT", revenue_growth: -0.01, ebitda_margin: 0.08, fcf_margin: 0.04, roic: 0.17, pe: 14, ev_revenue: 0.8, ev_ebitda: 9, price_fcf: 15 },
    { ticker: "KR", revenue_growth: 0.01, ebitda_margin: 0.05, fcf_margin: 0.02, roic: 0.13, pe: 14, ev_revenue: 0.4, ev_ebitda: 7, price_fcf: 13 },
  ],
};

const clamp = (value: number, low: number, high: number) => Math.max(low, Math.min(high, value));
const divide = (a?: number, b?: number) => (a == null || !b ? null : a / b);
const median = (values: number[]) => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)] ?? 0;
const cagr = (start?: number, end?: number, years = 1) =>
  start && end && start > 0 && end > 0 ? (end / start) ** (1 / years) - 1 : null;

function calculateMetrics(periods: Period[], price: number) {
  const latest = periods.at(-1)!.values;
  const prior = periods.at(-2)?.values ?? {};
  const series = (key: string) => periods.map((item) => item.values[key]).filter((value): value is number => value != null);
  const revenue = series("revenue");
  const income = series("net_income");
  const fcf = series("free_cash_flow");
  const margins = periods
    .map((item) => divide(item.values.operating_income, item.values.revenue))
    .filter((value): value is number => value != null);
  const averageMargin = margins.reduce((sum, value) => sum + value, 0) / Math.max(margins.length, 1);
  const marginVolatility = Math.sqrt(
    margins.reduce((sum, value) => sum + (value - averageMargin) ** 2, 0) / Math.max(margins.length, 1),
  );
  const shares = latest.shares_outstanding ?? latest.diluted_shares;
  const marketCap = shares ? shares * price : undefined;
  const debt = latest.total_debt ?? latest.long_term_debt ?? 0;
  const liquidAssets = latest.cash_and_investments ?? latest.cash ?? 0;
  const netDebt = latest.net_debt ?? debt - liquidAssets;
  const investedCapital = (latest.equity ?? 0) + debt - liquidAssets;
  const eps = divide(latest.net_income, latest.diluted_shares);
  const priorEps = divide(prior.net_income, prior.diluted_shares);
  return {
    revenue_growth_yoy: (divide(latest.revenue, prior.revenue) ?? 1) - 1,
    eps_growth_yoy: (divide(eps ?? undefined, priorEps ?? undefined) ?? 1) - 1,
    fcf_growth_yoy: (divide(latest.free_cash_flow, prior.free_cash_flow) ?? 1) - 1,
    revenue_cagr: cagr(revenue[0], revenue.at(-1), Math.max(revenue.length - 1, 1)),
    net_income_cagr: cagr(income[0], income.at(-1), Math.max(income.length - 1, 1)),
    fcf_cagr: cagr(fcf[0], fcf.at(-1), Math.max(fcf.length - 1, 1)),
    gross_margin: divide(latest.gross_profit, latest.revenue),
    operating_margin: divide(latest.operating_income, latest.revenue),
    fcf_margin: divide(latest.free_cash_flow, latest.revenue),
    roic: divide((latest.operating_income ?? 0) * 0.79, investedCapital),
    roe: divide(latest.net_income, latest.equity),
    net_debt: netDebt,
    net_debt_to_fcf: divide(netDebt, latest.free_cash_flow),
    fcf_conversion: divide(latest.free_cash_flow, latest.net_income),
    share_change: (divide(latest.diluted_shares, prior.diluted_shares) ?? 1) - 1,
    buyback_yield: divide(latest.share_repurchases, marketCap),
    market_cap: marketCap ?? null,
    pe: divide(price, eps ?? undefined),
    price_to_fcf: divide(marketCap, latest.free_cash_flow),
    fcf_yield: divide(latest.free_cash_flow, marketCap),
    operating_margin_volatility: marginVolatility,
    earnings_positive_years: income.filter((value) => value > 0).length,
    history_years: periods.length,
  };
}

function dcfValue(periods: Period[], growth: number, margin: number, wacc: number, terminalGrowth: number, years: number) {
  const latest = periods.at(-1)!.values;
  let revenue = latest.revenue ?? 0;
  let presentValue = 0;
  let projectedFcf = 0;
  for (let year = 1; year <= years; year += 1) {
    revenue *= 1 + growth;
    projectedFcf = revenue * margin;
    presentValue += projectedFcf / (1 + wacc) ** year;
  }
  const terminal = (projectedFcf * (1 + terminalGrowth)) / (wacc - terminalGrowth);
  const debt = latest.total_debt ?? latest.long_term_debt ?? 0;
  const liquidAssets = latest.cash_and_investments ?? latest.cash ?? 0;
  const netDebt = latest.net_debt ?? debt - liquidAssets;
  const shares = latest.shares_outstanding ?? latest.diluted_shares ?? 1;
  return Math.max((presentValue + terminal / (1 + wacc) ** years - netDebt) / shares, 0);
}

function reverseDcf(periods: Period[], price: number, margin: number, assumptions: Assumptions) {
  let low = -0.2;
  let high = 0.6;
  for (let index = 0; index < 70; index += 1) {
    const midpoint = (low + high) / 2;
    const value = dcfValue(
      periods,
      midpoint,
      margin,
      assumptions.wacc,
      assumptions.terminal_growth,
      assumptions.forecast_years,
    );
    if (value < price) low = midpoint;
    else high = midpoint;
  }
  return (low + high) / 2;
}

function calculateValuation(
  periods: Period[],
  metrics: ReturnType<typeof calculateMetrics>,
  price: number,
  assumptions: Assumptions,
  peers: Array<Record<string, number | string>>,
) {
  const latest = periods.at(-1)!.values;
  const growth = assumptions.revenue_growth ?? clamp(metrics.revenue_cagr ?? 0.05, 0.02, 0.25);
  const margin = assumptions.fcf_margin ?? clamp(metrics.fcf_margin ?? 0.08, 0.02, 0.45);
  const pureDcf = dcfValue(periods, growth, margin, assumptions.wacc, assumptions.terminal_growth, assumptions.forecast_years);
  const bear = dcfValue(periods, clamp(growth - 0.04, -0.1, 0.4), clamp(margin * 0.86, 0.01, 0.55), assumptions.wacc + 0.015, Math.max(assumptions.terminal_growth - 0.005, 0), assumptions.forecast_years);
  const bull = dcfValue(periods, clamp(growth + 0.04, -0.05, 0.45), clamp(margin * 1.1, 0.01, 0.58), Math.max(assumptions.wacc - 0.01, 0.05), Math.min(assumptions.terminal_growth + 0.005, 0.05), assumptions.forecast_years);
  const eps = divide(latest.net_income, latest.diluted_shares) ?? 0;
  const targetPe = clamp(18 + growth * 55 + (metrics.roic ?? 0) * 18, 12, 42);
  const growthValue = eps * targetPe;
  const comparable = eps * (peers.length ? median(peers.map((peer) => Number(peer.pe))) : targetPe);
  const normalized = eps * clamp(targetPe * 0.92, 12, 38);
  const fairValue = pureDcf * 0.55 + comparable * 0.2 + growthValue * 0.15 + normalized * 0.1;
  const impliedGrowth = reverseDcf(periods, price, margin, assumptions);
  return {
    current_price: price,
    bear_value: bear,
    base_value: fairValue,
    bull_value: Math.max(bull, fairValue),
    upside_to_fair_value: fairValue / price - 1,
    methods: { dcf: pureDcf, comparable_companies: comparable, growth_adjusted: growthValue, normalized_multiple: normalized },
    assumptions: { ...assumptions, revenue_growth: growth, fcf_margin: margin },
    reverse_dcf: {
      implied_revenue_growth: impliedGrowth,
      interpretation: `The market price implies approximately ${(impliedGrowth * 100).toFixed(1)}% annual revenue growth over the explicit forecast period.`,
    },
    methodology: "55% DCF, 20% peer P/E, 15% growth-adjusted P/E, 10% normalized P/E",
  };
}

const scaled = (value: number | null, poor: number, excellent: number, fallback = 50) =>
  value == null ? fallback : clamp(((value - poor) / (excellent - poor)) * 100, 0, 100);

function calculateScore(
  metrics: ReturnType<typeof calculateMetrics>,
  valuation: ReturnType<typeof calculateValuation>,
) {
  const debtRatio = metrics.net_debt_to_fcf;
  const debtScore = debtRatio != null && debtRatio < 0 ? 90 : scaled(debtRatio, 4, 0);
  const positiveRatio = metrics.earnings_positive_years / Math.max(metrics.history_years, 1);
  const categories = {
    valuation: Math.round(0.65 * scaled(valuation.upside_to_fair_value, -0.35, 0.5) + 0.35 * scaled(metrics.fcf_yield, 0.015, 0.08)),
    quality: Math.round(0.45 * scaled(metrics.roic, 0.05, 0.3) + 0.3 * scaled(metrics.operating_margin, 0.05, 0.35) + 0.25 * scaled(metrics.fcf_conversion, 0.55, 1.1)),
    growth: Math.round(0.45 * scaled(metrics.revenue_cagr, 0, 0.2) + 0.3 * scaled(metrics.net_income_cagr, -0.03, 0.25) + 0.25 * scaled(metrics.fcf_cagr, -0.03, 0.25)),
    financial_strength: Math.round(0.65 * debtScore + 0.35 * scaled(metrics.fcf_conversion, 0.5, 1.1)),
    capital_allocation: Math.round(0.55 * scaled(-(metrics.share_change ?? 0), -0.03, 0.04) + 0.45 * scaled(metrics.buyback_yield, 0, 0.05)),
    earnings_quality: Math.round(0.55 * positiveRatio * 100 + 0.45 * scaled(metrics.operating_margin_volatility, 0.08, 0)),
    momentum: Math.round(0.5 * scaled(metrics.revenue_growth_yoy, -0.1, 0.25) + 0.5 * scaled(metrics.fcf_growth_yoy, -0.25, 0.35)),
    risk: Math.round(0.5 * scaled(metrics.operating_margin_volatility, 0.1, 0) + 0.35 * debtScore + 0.15 * positiveRatio * 100),
  };
  const weights: Record<string, number> = { valuation: 0.3, quality: 0.2, growth: 0.15, financial_strength: 0.1, capital_allocation: 0.1, earnings_quality: 0.05, momentum: 0.05, risk: 0.05 };
  const overall = Math.round(Object.entries(categories).reduce((sum, [key, value]) => sum + value * weights[key], 0));
  const rating = overall >= 85 ? "Highly Attractive" : overall >= 70 ? "Attractive" : overall >= 50 ? "Neutral" : "Unattractive";
  return { overall, rating, categories, weights, formula: "Weighted arithmetic mean of eight metric-derived category scores" };
}

function calculateBuyTarget(
  metrics: ReturnType<typeof calculateMetrics>,
  valuation: ReturnType<typeof calculateValuation>,
  score: ReturnType<typeof calculateScore>,
) {
  const components = {
    base: 0.1,
    earnings_and_margin_volatility: clamp((metrics.operating_margin_volatility ?? 0) * 0.8, 0, 0.08),
    balance_sheet_risk: clamp(Math.max(metrics.net_debt_to_fcf ?? 0, 0) * 0.015, 0, 0.07),
    growth_uncertainty: clamp(Math.abs((metrics.revenue_growth_yoy ?? 0) - (metrics.revenue_cagr ?? 0)) * 0.2, 0, 0.05),
    low_risk_credit: -clamp((score.categories.risk - 70) / 1000, 0, 0.03),
  };
  const marginOfSafety = clamp(Object.values(components).reduce((sum, value) => sum + value, 0), 0.08, 0.35);
  return {
    fair_value: valuation.base_value,
    margin_of_safety: marginOfSafety,
    buy_target: valuation.base_value * (1 - marginOfSafety),
    current_price_gap: (valuation.base_value * (1 - marginOfSafety)) / valuation.current_price - 1,
    components,
    methodology: "Dynamic 8% to 35% margin of safety based on stability, debt, uncertainty and risk score",
  };
}

async function secData(ticker: string) {
  const headers = {
    "User-Agent": process.env.SEC_USER_AGENT ?? "AplexAnalysis/0.1 research@aplexanalysis.app",
    Accept: "application/json",
  };
  const identity = await resolveSecurity(ticker);
  const cik = identity.cik;
  const [factsResponse, submissionsResponse] = await Promise.all([
    fetch(`https://data.sec.gov/api/xbrl/companyfacts/CIK${cik}.json`, { headers }),
    fetch(`https://data.sec.gov/submissions/CIK${cik}.json`, { headers }),
  ]);
  if (!factsResponse.ok || !submissionsResponse.ok) throw new Error("SEC company data was unavailable");
  const facts = (await factsResponse.json()) as SecCompanyFacts;
  const submissions = (await submissionsResponse.json()) as {
    name?: string;
    sicDescription?: string;
    exchanges?: string[];
    filings?: { recent?: Record<string, string[]> };
  };
  const periods = normalizeCompanyFacts(facts);
  if (periods.length < 3) throw new Error("SEC facts did not contain enough normalized annual periods");
  const recent = submissions.filings?.recent ?? {};
  const filings = (recent.form ?? [])
    .map((form: string, index: number) => ({
      form,
      filing_date: recent.filingDate?.[index] ?? null,
      report_date: recent.reportDate?.[index] ?? null,
      accession_number: recent.accessionNumber?.[index] ?? "",
      source_url: `https://www.sec.gov/Archives/edgar/data/${Number(cik)}/${String(recent.accessionNumber?.[index] ?? "").replaceAll("-", "")}/${recent.primaryDocument?.[index] ?? ""}`,
    }))
    .filter((item: Filing) => ["10-K", "10-Q", "8-K", "20-F", "40-F", "6-K"].includes(item.form))
    .slice(0, 20);
  return {
    profile: {
      cik,
      name: submissions.name ?? identity.name,
      sector: FALLBACK[ticker]?.profile.sector ?? null,
      industry: FALLBACK[ticker]?.profile.industry ?? submissions.sicDescription ?? null,
      exchange: submissions.exchanges?.[0] ?? null,
      description: FALLBACK[ticker]?.profile.description ?? null,
    },
    periods,
    filings,
  };
}

async function quoteData(ticker: string) {
  const quoteTicker = ticker.replaceAll("-", ".");
  const response = await fetch(`https://api.nasdaq.com/api/quote/${quoteTicker}/info?assetclass=stocks`, {
    headers: {
      "User-Agent": "Mozilla/5.0 (compatible; AplexAnalysis/0.1; financial research)",
      Accept: "application/json, text/plain, */*",
      Origin: "https://www.nasdaq.com",
      Referer: "https://www.nasdaq.com/",
    },
  });
  if (!response.ok) throw new Error(`Nasdaq quote request returned ${response.status}`);
  const payload = (await response.json()) as {
    data?: {
      primaryData?: { lastSalePrice?: string; lastTradeTimestamp?: string; isRealTime?: boolean };
      secondaryData?: { lastSalePrice?: string; lastTradeTimestamp?: string; isRealTime?: boolean };
    };
  };
  const primary = payload.data?.primaryData ?? payload.data?.secondaryData;
  if (!primary) throw new Error("Nasdaq did not return quote data");
  const price = Number(String(primary?.lastSalePrice ?? "").replaceAll("$", "").replaceAll(",", ""));
  if (!Number.isFinite(price) || price <= 0) throw new Error("Nasdaq did not return a usable delayed price");
  const date = String(primary.lastTradeTimestamp ?? "").match(/[A-Z][a-z]{2} \d{1,2}, \d{4}/)?.[0] ?? String(primary.lastTradeTimestamp);
  return {
    price,
    as_of: date,
    currency: "USD",
    provider: "Nasdaq delayed quote",
    source_url: `https://www.nasdaq.com/market-activity/stocks/${ticker.toLowerCase()}`,
    is_delayed: !primary.isRealTime,
  };
}

export async function buildAnalysis(rawTicker: string, requested?: Partial<Assumptions>) {
  const ticker = normalizeTicker(rawTicker);
  const fallback = FALLBACK[ticker];
  const warnings: string[] = [];
  let financials: FinancialSource;
  let sourceMode = "live-sec";
  try {
    financials = await secData(ticker);
  } catch (error) {
    if (!fallback) throw error;
    sourceMode = "fallback-snapshot";
    warnings.push(`Live SEC retrieval unavailable. Using bundled SEC-derived snapshot: ${error instanceof Error ? error.message : "Unknown error"}`);
    financials = { profile: fallback.profile, periods: fallback.periods, filings: [] };
  }
  let quote: Quote;
  try {
    quote = await quoteData(ticker);
  } catch (error) {
    if (!fallback) throw error;
    warnings.push(`Live delayed quote unavailable. Using dated fallback quote: ${error instanceof Error ? error.message : "Unknown error"}`);
    quote = {
      price: fallback.price,
      as_of: fallback.priceAsOf,
      currency: "USD",
      provider: "Bundled historical fallback quote",
      source_url: null,
      is_delayed: true,
    };
  }
  const assumptions: Assumptions = { ...DEFAULT_ASSUMPTIONS, ...requested };
  const metrics = calculateMetrics(financials.periods, quote.price);
  const peers = PEERS[ticker] ?? [];
  const valuation = calculateValuation(financials.periods, metrics, quote.price, assumptions, peers);
  const score = calculateScore(metrics, valuation);
  const buyTarget = calculateBuyTarget(metrics, valuation, score);
  const latest = financials.periods.at(-1)!.values;
  const risks: Array<Record<string, string>> = [];
  if (valuation.reverse_dcf.implied_revenue_growth > 0.15) risks.push({ severity: "high", title: "Demanding expectations", detail: "The current price embeds revenue growth above 15% in the reverse DCF." });
  if ((metrics.net_debt_to_fcf ?? 0) > 2) risks.push({ severity: "medium", title: "Leverage", detail: "Net debt exceeds two years of current free cash flow." });
  if ((metrics.operating_margin_volatility ?? 0) > 0.04) risks.push({ severity: "medium", title: "Margin variability", detail: "Operating margins have varied materially across the available history." });
  if (!risks.length) risks.push({ severity: "low", title: "Model uncertainty", detail: "The largest quantified risk is sensitivity to discount rate and terminal assumptions." });
  return {
    company: { ticker, ...financials.profile },
    quote,
    headline: {
      score: score.overall,
      rating: score.rating,
      current_price: quote.price,
      fair_value: valuation.base_value,
      buy_target: buyTarget.buy_target,
      bear_value: valuation.bear_value,
      base_value: valuation.base_value,
      bull_value: valuation.bull_value,
      upside: valuation.upside_to_fair_value,
    },
    financials: financials.periods,
    latest,
    metrics,
    valuation,
    buy_target: buyTarget,
    score,
    comps: peers,
    filings: financials.filings,
    risks,
    provenance: {
      financials: sourceMode,
      quote: quote.provider,
      peer_snapshot_as_of: "2025-02-28",
      methodology_version: "0.1.0-sites",
      generated_at: new Date().toISOString(),
      warnings,
    },
  };
}
