import { normalizeTicker, resolveSecurity } from "./security-master";
import { extractRiskFactorHeadings } from "./risk-factors";
import { calculatePegProjection } from "./peg";
import { summarizeCompanyDescription } from "./company-description";
import {
  normalizeCompanyFacts,
  normalizeQuarterlyCompanyFacts,
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
  description_source: string;
  description_source_url: string;
};
type Filing = {
  form: string;
  filing_date: string | null;
  report_date: string | null;
  accession_number: string;
  source_url: string;
};
type CompanyRisk = {
  severity: "filed" | "high" | "medium" | "low";
  title: string;
  detail: string;
  source_url?: string;
  filing_date?: string | null;
  form?: string;
};
type FinancialSource = {
  profile: CompanyProfile;
  periods: Period[];
  quarterlyPeriods: Period[];
  filings: Filing[];
  filingRisks: CompanyRisk[];
};
type Quote = {
  price: number;
  market_cap: number | null;
  as_of: string;
  currency: string;
  provider: string;
  source_url: string | null;
  is_delayed: boolean;
};
type Period = NormalizedPeriod;
type ComparableCompany = {
  ticker: string;
  name: string;
  sector: string | null;
  industry: string | null;
  price: number;
  market_cap: number | null;
  revenue_growth: number | null;
  net_income_growth: number | null;
  operating_margin: number | null;
  fcf_margin: number | null;
  roic: number | null;
  pe: number | null;
  price_to_book: number | null;
  price_fcf: number | null;
  fcf_yield: number | null;
  fiscal_year: number;
  quote_as_of: string;
};
type NasdaqProfile = {
  name: string | null;
  sector: string | null;
  industry: string | null;
  description: string | null;
};
type AnalystEstimateRow = {
  period: string;
  consensus_eps: number | null;
  high_eps: number | null;
  low_eps: number | null;
  analyst_count: number | null;
  revisions_up: number | null;
  revisions_down: number | null;
};
type AnalystEstimates = {
  quarterly: AnalystEstimateRow[];
  annual: AnalystEstimateRow[];
  provider: string;
  as_of: string | null;
  source_url: string;
  disclosure: string;
};

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
const RISK_CACHE_TTL_MS = 6 * 60 * 60 * 1000;
const COMPS_CACHE_TTL_MS = 15 * 60 * 1000;
const riskCache = new Map<string, { expiresAt: number; risks: CompanyRisk[] }>();
const compsCache = new Map<string, { expiresAt: number; company: ComparableCompany }>();

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
      description_source: "Bundled company profile",
      description_source_url: "https://www.sec.gov/edgar/browse/?CIK=0000320193&owner=exclude",
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
      description_source: "Bundled company profile",
      description_source_url: "https://www.sec.gov/edgar/browse/?CIK=0001045810&owner=exclude",
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
      description_source: "Bundled company profile",
      description_source_url: "https://www.sec.gov/edgar/browse/?CIK=0000909832&owner=exclude",
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

const CURATED_PEER_TICKERS: Record<string, string[]> = {
  AAPL: ["MSFT", "DELL", "HPQ"],
  AMZN: ["WMT", "COST", "EBAY"],
  COST: ["WMT", "TGT", "BJ"],
  GOOGL: ["META", "MSFT", "AMZN"],
  JPM: ["BAC", "WFC", "C"],
  KO: ["PEP", "KDP", "MNST"],
  MA: ["V", "AXP", "PYPL"],
  MCD: ["YUM", "SBUX", "QSR"],
  META: ["GOOGL", "SNAP", "PINS"],
  MSFT: ["ORCL", "GOOGL", "CRM"],
  NFLX: ["DIS", "WBD", "PARA"],
  NVDA: ["AMD", "AVGO", "QCOM"],
  PEP: ["KO", "KDP", "MNST"],
  TSLA: ["GM", "F", "RIVN"],
  V: ["MA", "AXP", "PYPL"],
};

const clamp = (value: number, low: number, high: number) => Math.max(low, Math.min(high, value));
const divide = (a?: number, b?: number) => (a == null || !b ? null : a / b);
const yoyGrowth = (current?: number, previous?: number) =>
  current != null && previous != null && previous > 0 ? current / previous - 1 : null;
const median = (values: number[]) => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)] ?? 0;
const cagr = (start?: number, end?: number, years = 1) =>
  start && end && start > 0 && end > 0 ? (end / start) ** (1 / years) - 1 : null;

function calculateMetrics(periods: Period[], price: number, quotedMarketCap?: number | null) {
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
  const marketCap = quotedMarketCap && quotedMarketCap > 0 ? quotedMarketCap : shares ? shares * price : undefined;
  const debt = latest.total_debt ?? latest.long_term_debt ?? 0;
  const liquidAssets = latest.cash_and_investments ?? latest.cash ?? 0;
  const netDebt = latest.net_debt ?? debt - liquidAssets;
  const investedCapital = (latest.equity ?? 0) + debt - liquidAssets;
  const eps = divide(latest.net_income, latest.diluted_shares);
  const priorEps = divide(prior.net_income, prior.diluted_shares);
  return {
    revenue_growth_yoy: yoyGrowth(latest.revenue, prior.revenue),
    net_income_growth_yoy: yoyGrowth(latest.net_income, prior.net_income),
    eps_growth_yoy: yoyGrowth(eps ?? undefined, priorEps ?? undefined),
    fcf_growth_yoy: yoyGrowth(latest.free_cash_flow, prior.free_cash_flow),
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
    pe: latest.net_income != null && latest.net_income > 0
      ? divide(marketCap, latest.net_income) ?? divide(price, eps ?? undefined)
      : null,
    price_to_book: latest.equity != null && latest.equity > 0 ? divide(marketCap, latest.equity) : null,
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
  peers: ComparableCompany[],
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
  const peerMultiples = peers
    .map((peer) => peer.pe)
    .filter((value): value is number => value != null && Number.isFinite(value) && value > 0);
  const comparable = eps * (peerMultiples.length ? median(peerMultiples) : targetPe);
  const normalized = eps * clamp(targetPe * 0.92, 12, 38);
  const fairValue = pureDcf * 0.55 + comparable * 0.2 + growthValue * 0.15 + normalized * 0.1;
  const impliedGrowth = reverseDcf(periods, price, margin, assumptions);
  const growthProjection = calculatePegProjection(periods, metrics.pe, growth);
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
    growth_projection: growthProjection,
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
    valuation: valuation.growth_projection.score,
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
  return { overall, rating, categories, weights, formula: "Weighted arithmetic mean of eight category scores; valuation is the five-year forward PEG score" };
}

async function fetchFilingRisks(filing: Filing): Promise<CompanyRisk[]> {
  const cached = riskCache.get(filing.source_url);
  if (cached && cached.expiresAt > Date.now()) return cached.risks;

  try {
    const response = await fetch(filing.source_url, {
      headers: {
        "User-Agent": process.env.SEC_USER_AGENT ?? "AplexAnalysis/0.1 research@aplexanalysis.app",
        Accept: "text/html,application/xhtml+xml",
      },
    });
    if (!response.ok) return [];
    const titles = extractRiskFactorHeadings(await response.text(), filing.form, 8);
    const item = filing.form === "20-F" ? "Item 3.D" : filing.form === "10-K" ? "Item 1A" : "Risk Factors section";
    const risks: CompanyRisk[] = titles.map((title) => ({
      severity: "filed",
      title,
      detail: `Company-reported risk from ${item} of the ${filing.form} filed ${filing.filing_date ?? "most recently"}.`,
      source_url: filing.source_url,
      filing_date: filing.filing_date,
      form: filing.form,
    }));
    riskCache.set(filing.source_url, { expiresAt: Date.now() + RISK_CACHE_TTL_MS, risks });
    return risks;
  } catch {
    return [];
  }
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

async function fetchNasdaqProfile(ticker: string): Promise<NasdaqProfile> {
  const response = await fetch(`https://api.nasdaq.com/api/company/${ticker.replaceAll("-", ".")}/company-profile`, {
    headers: {
      "User-Agent": "Mozilla/5.0 (compatible; AplexAnalysis/0.1; financial research)",
      Accept: "application/json, text/plain, */*",
      Origin: "https://www.nasdaq.com",
      Referer: "https://www.nasdaq.com/",
    },
  });
  if (!response.ok) throw new Error(`Nasdaq profile request returned ${response.status}`);
  const payload = (await response.json()) as {
    data?: Record<string, { value?: string | null }>;
  };
  return {
    name: payload.data?.CompanyName?.value ?? null,
    sector: payload.data?.Sector?.value ?? null,
    industry: payload.data?.Industry?.value ?? null,
    description: payload.data?.CompanyDescription?.value ?? null,
  };
}

function nullableNumber(value: unknown) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}

async function fetchNasdaqAnalystEstimates(ticker: string): Promise<AnalystEstimates> {
  const response = await fetch(`https://api.nasdaq.com/api/analyst/${ticker.replaceAll("-", ".")}/earnings-forecast`, {
    headers: {
      "User-Agent": "Mozilla/5.0 (compatible; AplexAnalysis/0.1; financial research)",
      Accept: "application/json, text/plain, */*",
      Origin: "https://www.nasdaq.com",
      Referer: "https://www.nasdaq.com/",
    },
  });
  if (!response.ok) throw new Error(`Nasdaq analyst forecast request returned ${response.status}`);
  const payload = (await response.json()) as {
    data?: {
      quarterlyForecast?: { asOf?: string | null; rows?: Array<Record<string, unknown>> };
      yearlyForecast?: { asOf?: string | null; rows?: Array<Record<string, unknown>> };
    };
  };
  const normalizeRows = (rows: Array<Record<string, unknown>> | undefined): AnalystEstimateRow[] =>
    (rows ?? []).map((row) => ({
      period: String(row.fiscalEnd ?? ""),
      consensus_eps: nullableNumber(row.consensusEPSForecast),
      high_eps: nullableNumber(row.highEPSForecast),
      low_eps: nullableNumber(row.lowEPSForecast),
      analyst_count: nullableNumber(row.noOfEstimates),
      revisions_up: nullableNumber(row.up),
      revisions_down: nullableNumber(row.down),
    })).filter((row) => row.period);

  return {
    quarterly: normalizeRows(payload.data?.quarterlyForecast?.rows),
    annual: normalizeRows(payload.data?.yearlyForecast?.rows),
    provider: "Nasdaq analyst consensus",
    as_of: payload.data?.quarterlyForecast?.asOf ?? payload.data?.yearlyForecast?.asOf ?? null,
    source_url: `https://www.nasdaq.com/market-activity/stocks/${ticker.toLowerCase()}/earnings`,
    disclosure: "Analyst EPS estimates are consensus forecasts, not company guidance.",
  };
}

async function secData(ticker: string, includeRisks = true) {
  const headers = {
    "User-Agent": process.env.SEC_USER_AGENT ?? "AplexAnalysis/0.1 research@aplexanalysis.app",
    Accept: "application/json",
  };
  const identity = await resolveSecurity(ticker);
  const cik = identity.cik;
  const [factsResponse, submissionsResponse, nasdaqProfile] = await Promise.all([
    fetch(`https://data.sec.gov/api/xbrl/companyfacts/CIK${cik}.json`, { headers }),
    fetch(`https://data.sec.gov/submissions/CIK${cik}.json`, { headers }),
    fetchNasdaqProfile(ticker).catch(() => null),
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
  const quarterlyPeriods = normalizeQuarterlyCompanyFacts(facts);
  if (periods.length < 3) throw new Error("SEC facts did not contain enough normalized annual periods");
  const recent = submissions.filings?.recent ?? {};
  const relevantFilings = (recent.form ?? [])
    .map((form: string, index: number) => ({
      form,
      filing_date: recent.filingDate?.[index] ?? null,
      report_date: recent.reportDate?.[index] ?? null,
      accession_number: recent.accessionNumber?.[index] ?? "",
      source_url: `https://www.sec.gov/Archives/edgar/data/${Number(cik)}/${String(recent.accessionNumber?.[index] ?? "").replaceAll("-", "")}/${recent.primaryDocument?.[index] ?? ""}`,
    }))
    .filter((item: Filing) => ["10-K", "10-Q", "8-K", "20-F", "40-F", "6-K"].includes(item.form));
  const filings = relevantFilings.slice(0, 20);
  const latestAnnualFiling = relevantFilings.find((filing: Filing) => ["10-K", "20-F", "40-F"].includes(filing.form));
  const filingRisks = includeRisks && latestAnnualFiling ? await fetchFilingRisks(latestAnnualFiling) : [];
  const companyName = (nasdaqProfile?.name ?? submissions.name ?? identity.name).trim();
  const nasdaqDescription = summarizeCompanyDescription(nasdaqProfile?.description ?? "", companyName);
  const bundledDescription = summarizeCompanyDescription(FALLBACK[ticker]?.profile.description ?? "", companyName);
  const secDescription = summarizeCompanyDescription(
    submissions.sicDescription
      ? `${companyName} is a public company operating in ${submissions.sicDescription}. It files financial statements and company disclosures with the SEC.`
      : `${companyName} is a public company that files financial statements and company disclosures with the SEC.`,
    companyName,
  );
  const description = bundledDescription ?? nasdaqDescription ?? secDescription;
  const descriptionSource = bundledDescription
    ? FALLBACK[ticker].profile.description_source
    : nasdaqDescription
      ? "Nasdaq company profile"
      : "SEC company submissions";
  const descriptionSourceUrl = bundledDescription
    ? FALLBACK[ticker].profile.description_source_url
    : nasdaqDescription
      ? `https://www.nasdaq.com/market-activity/stocks/${ticker.toLowerCase()}/company-profile`
      : `https://www.sec.gov/edgar/browse/?CIK=${cik}&owner=exclude`;
  return {
    profile: {
      cik,
      name: companyName,
      sector: nasdaqProfile?.sector ?? FALLBACK[ticker]?.profile.sector ?? null,
      industry: nasdaqProfile?.industry ?? FALLBACK[ticker]?.profile.industry ?? submissions.sicDescription ?? null,
      exchange: submissions.exchanges?.[0] ?? null,
      description,
      description_source: descriptionSource,
      description_source_url: descriptionSourceUrl,
    },
    periods,
    quarterlyPeriods,
    filings,
    filingRisks,
  };
}

function cleanedCompanyName(name: string) {
  return name
    .replace(/\b(class [a-z]|common stock|ordinary shares?|american depositary shares?)\b/gi, "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

async function findSectorPeers(
  ticker: string,
  companyName: string,
  sector: string | null,
  marketCap: number | null,
) {
  if (!sector) return [];
  const params = new URLSearchParams({ tableonly: "true", limit: "1200", offset: "0", sector });
  const response = await fetch(`https://api.nasdaq.com/api/screener/stocks?${params}`, {
    headers: {
      "User-Agent": "Mozilla/5.0 (compatible; AplexAnalysis/0.1; financial research)",
      Accept: "application/json, text/plain, */*",
      Origin: "https://www.nasdaq.com",
      Referer: "https://www.nasdaq.com/",
    },
  });
  if (!response.ok) return [];
  const payload = (await response.json()) as {
    data?: { table?: { rows?: Array<{ symbol?: string; name?: string; marketCap?: string }> } };
  };
  const targetName = cleanedCompanyName(companyName);
  return (payload.data?.table?.rows ?? [])
    .map((row) => ({
      ticker: String(row.symbol ?? "").toUpperCase(),
      name: String(row.name ?? ""),
      marketCap: Number(String(row.marketCap ?? "").replaceAll(",", "")),
    }))
    .filter((row) =>
      row.ticker !== ticker
      && /^[A-Z][A-Z0-9.-]{0,9}$/.test(row.ticker)
      && Number.isFinite(row.marketCap)
      && row.marketCap > 0
      && cleanedCompanyName(row.name) !== targetName,
    )
    .sort((a, b) => {
      if (!marketCap || marketCap <= 0) return b.marketCap - a.marketCap;
      return Math.abs(Math.log(a.marketCap / marketCap)) - Math.abs(Math.log(b.marketCap / marketCap));
    })
    .slice(0, 8)
    .map((row) => row.ticker);
}

async function buildComparableCompany(ticker: string): Promise<ComparableCompany> {
  const cached = compsCache.get(ticker);
  if (cached && cached.expiresAt > Date.now()) return cached.company;

  const [financials, quote] = await Promise.all([secData(ticker, false), quoteData(ticker)]);
  const metrics = calculateMetrics(financials.periods, quote.price, quote.market_cap);
  const company: ComparableCompany = {
    ticker,
    name: financials.profile.name,
    sector: financials.profile.sector,
    industry: financials.profile.industry,
    price: quote.price,
    market_cap: metrics.market_cap,
    revenue_growth: metrics.revenue_growth_yoy,
    net_income_growth: metrics.net_income_growth_yoy,
    operating_margin: metrics.operating_margin,
    fcf_margin: metrics.fcf_margin,
    roic: metrics.roic,
    pe: metrics.pe,
    price_to_book: metrics.price_to_book,
    price_fcf: metrics.price_to_fcf,
    fcf_yield: metrics.fcf_yield,
    fiscal_year: financials.periods.at(-1)!.fiscal_year,
    quote_as_of: quote.as_of,
  };
  compsCache.set(ticker, { expiresAt: Date.now() + COMPS_CACHE_TTL_MS, company });
  return company;
}

async function buildComparableCompanies(
  ticker: string,
  companyName: string,
  sector: string | null,
  marketCap: number | null,
) {
  const curated = CURATED_PEER_TICKERS[ticker];
  const candidates = curated ?? await findSectorPeers(ticker, companyName, sector, marketCap);
  const results = await Promise.allSettled(candidates.slice(0, curated ? 3 : 5).map(buildComparableCompany));
  const companies = results
    .filter((result): result is PromiseFulfilledResult<ComparableCompany> => result.status === "fulfilled")
    .map((result) => result.value)
    .slice(0, 3);
  return {
    companies,
    methodology: curated
      ? "Selected operating peers with metrics recalculated from current SEC annual facts and delayed Nasdaq prices"
      : "Closest available Nasdaq sector peers by market capitalization, with metrics recalculated from SEC annual facts and delayed Nasdaq prices",
  };
}

async function quoteData(ticker: string) {
  const quoteTicker = ticker.replaceAll("-", ".");
  const headers = {
    "User-Agent": "Mozilla/5.0 (compatible; AplexAnalysis/0.1; financial research)",
    Accept: "application/json, text/plain, */*",
    Origin: "https://www.nasdaq.com",
    Referer: "https://www.nasdaq.com/",
  };
  const [response, summaryResponse] = await Promise.all([
    fetch(`https://api.nasdaq.com/api/quote/${quoteTicker}/info?assetclass=stocks`, { headers }),
    fetch(`https://api.nasdaq.com/api/quote/${quoteTicker}/summary?assetclass=stocks`, { headers }).catch(() => null),
  ]);
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
  let marketCap: number | null = null;
  if (summaryResponse?.ok) {
    const summary = (await summaryResponse.json()) as {
      data?: { summaryData?: { MarketCap?: { value?: string | null } } };
    };
    const parsed = Number(String(summary.data?.summaryData?.MarketCap?.value ?? "").replaceAll("$", "").replaceAll(",", ""));
    if (Number.isFinite(parsed) && parsed > 0) marketCap = parsed;
  }
  return {
    price,
    market_cap: marketCap,
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
    financials = { profile: fallback.profile, periods: fallback.periods, quarterlyPeriods: [], filings: [], filingRisks: [] };
  }
  let quote: Quote;
  try {
    quote = await quoteData(ticker);
  } catch (error) {
    if (!fallback) throw error;
    warnings.push(`Live delayed quote unavailable. Using dated fallback quote: ${error instanceof Error ? error.message : "Unknown error"}`);
    quote = {
      price: fallback.price,
      market_cap: null,
      as_of: fallback.priceAsOf,
      currency: "USD",
      provider: "Bundled historical fallback quote",
      source_url: null,
      is_delayed: true,
    };
  }
  const assumptions: Assumptions = { ...DEFAULT_ASSUMPTIONS, ...requested };
  const metrics = calculateMetrics(financials.periods, quote.price, quote.market_cap);
  const peerSet = await buildComparableCompanies(
    ticker,
    financials.profile.name,
    financials.profile.sector,
    metrics.market_cap,
  ).catch(() => ({
    companies: [] as ComparableCompany[],
    methodology: "Comparable-company retrieval was unavailable for this request",
  }));
  const peers = peerSet.companies;
  const valuation = calculateValuation(financials.periods, metrics, quote.price, assumptions, peers);
  const score = calculateScore(metrics, valuation);
  const buyTarget = calculateBuyTarget(metrics, valuation, score);
  const analystEstimates = await fetchNasdaqAnalystEstimates(ticker).catch((): AnalystEstimates => ({
    quarterly: [],
    annual: [],
    provider: "Nasdaq analyst consensus",
    as_of: null,
    source_url: `https://www.nasdaq.com/market-activity/stocks/${ticker.toLowerCase()}/earnings`,
    disclosure: "Analyst EPS estimates are consensus forecasts, not company guidance.",
  }));
  const latest = financials.periods.at(-1)!.values;
  const risks: CompanyRisk[] = [...financials.filingRisks];
  if (!risks.length && valuation.reverse_dcf.implied_revenue_growth > 0.15) risks.push({ severity: "high", title: "Demanding expectations", detail: "The current price embeds revenue growth above 15% in the reverse DCF." });
  if (!risks.length && (metrics.net_debt_to_fcf ?? 0) > 2) risks.push({ severity: "medium", title: "Leverage", detail: "Net debt exceeds two years of current free cash flow." });
  if (!risks.length && (metrics.operating_margin_volatility ?? 0) > 0.04) risks.push({ severity: "medium", title: "Margin variability", detail: "Operating margins have varied materially across the available history." });
  if (!risks.length) risks.push({ severity: "low", title: "Model uncertainty", detail: "The latest annual filing risk section was unavailable, so this fallback reflects valuation sensitivity." });
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
    quarterly_financials: financials.quarterlyPeriods,
    analyst_estimates: analystEstimates,
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
      quarterly_financials: financials.quarterlyPeriods.length
        ? "SEC 10-Q facts normalized to stand-alone fiscal quarters"
        : "Quarterly SEC facts unavailable",
      analyst_estimates: analystEstimates.quarterly.length || analystEstimates.annual.length
        ? analystEstimates.provider
        : "Analyst estimates unavailable",
      quote: quote.provider,
      risk_factors: financials.filingRisks.length ? "latest annual filing" : "quantitative fallback",
      comparables: peerSet.methodology,
      peer_snapshot_as_of: peers.length ? peers.map((peer) => peer.quote_as_of).join(" | ") : "Unavailable",
      methodology_version: "0.2.0-sites",
      generated_at: new Date().toISOString(),
      warnings,
    },
  };
}
