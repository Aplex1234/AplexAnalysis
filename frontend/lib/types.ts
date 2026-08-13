export type FinancialValues = {
  revenue?: number;
  gross_profit?: number;
  operating_income?: number;
  net_income?: number;
  operating_cash_flow?: number;
  capex?: number;
  free_cash_flow?: number;
  dividends_paid?: number;
  cash?: number;
  short_term_investments?: number;
  cash_and_investments?: number;
  total_assets?: number;
  current_assets?: number;
  total_liabilities?: number;
  current_liabilities?: number;
  long_term_debt?: number;
  current_debt?: number;
  total_debt?: number;
  net_debt?: number;
  equity?: number;
  working_capital?: number;
  inventory?: number;
  accounts_receivable?: number;
  diluted_shares?: number;
  shares_outstanding?: number;
  share_repurchases?: number;
  diluted_eps?: number;
};

export type SecuritySearchResult = {
  issuer_id: string;
  security_id: string;
  listing_id: string;
  ticker: string;
  name: string;
  cik: string;
  exchange: string;
  mic: string;
  security_type: string;
  coverage: string;
};

export type FinancialPeriod = {
  fiscal_year: number;
  fiscal_quarter?: 1 | 2 | 3 | 4;
  period_type: string;
  period_end: string | null;
  filed_at: string | null;
  accession_number: string | null;
  form: string;
  currency: string;
  values: FinancialValues;
  provenance: Record<string, Record<string, string>>;
};

export type StockPricePoint = {
  date: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
};

export type StockPriceHistory = {
  ticker: string;
  range: "1y" | "5y" | "max";
  points: StockPricePoint[];
  provider: string;
  as_of: string;
  source_url: string;
  is_delayed: boolean;
};

export type ComparableCompany = {
  ticker: string;
  name: string;
  sector: string | null;
  industry: string | null;
  price: number;
  market_cap: number | null;
  revenue_growth: number | null;
  net_income_growth: number | null;
  gross_margin: number | null;
  operating_margin: number | null;
  fcf_margin: number | null;
  roic: number | null;
  pe: number | null;
  price_to_book: number | null;
  price_fcf: number | null;
  fcf_yield: number | null;
  fiscal_year: number;
  quote_as_of: string;
  selection_reason: string;
  selection_score: number;
  selection_factors: string[];
  selection_source: string;
  selection_source_url: string;
};

export type AnalysisSection = "overview" | "financials" | "valuation" | "buyTarget" | "comps" | "earnings" | "news" | "filings" | "risks" | "research";

export type NewsItem = {
  id: string;
  title: string;
  summary: string | null;
  url: string;
  source: string;
  published_at: string;
  scope: "company" | "industry" | "filing";
  tickers: string[];
  matched_ticker: boolean;
  image_url: string | null;
};

export type NewsFeed = {
  items: NewsItem[];
  fetched_at: string;
  providers: string[];
  industry_query: string | null;
  warnings: string[];
};

export type Analysis = {
  data_scope?: "overview" | "partial" | "full";
  loaded_sections?: AnalysisSection[];
  company: {
    ticker: string;
    name: string;
    cik: string;
    sector: string | null;
    industry: string | null;
    exchange: string | null;
    description: string | null;
    description_source: string;
    description_source_url: string;
  };
  quote: {
    price: number;
    as_of: string;
    currency: string;
    provider: string;
    source_url: string | null;
    is_delayed: boolean;
  };
  headline: {
    score: number;
    rating: string;
    current_price: number;
    fair_value: number;
    buy_target: number;
    bear_value: number;
    base_value: number;
    bull_value: number;
    upside: number;
  };
  financials: FinancialPeriod[];
  quarterly_financials: FinancialPeriod[];
  analyst_estimates: {
    quarterly: AnalystEstimate[];
    annual: AnalystEstimate[];
    provider: string;
    as_of: string | null;
    source_url: string;
    disclosure: string;
  };
  latest: FinancialValues;
  metrics: Record<string, number | null>;
  valuation: {
    methods: Record<string, number>;
    assumptions: DcfAssumptions;
    reverse_dcf: { implied_revenue_growth: number; interpretation: string };
    growth_projection: {
      basis: "revenue";
      forecast_years: 5;
      projections: Array<{
        fiscal_year: number;
        revenue: number;
        net_income: number | null;
        growth_rate: number;
      }>;
      average_annual_growth: number;
      current_pe: number | null;
      peg_ratio: number | null;
      target_peg: 1.2;
      score: number;
      interpretation: string;
    };
    methodology: string;
  } & Record<string, unknown>;
  buy_target: {
    fair_value: number;
    margin_of_safety: number;
    buy_target: number;
    current_price_gap: number;
    components: Record<string, number>;
    methodology: string;
  };
  score: {
    overall: number;
    rating: string;
    categories: Record<string, number>;
    weights: Record<string, number>;
    formula: string;
  };
  comps: ComparableCompany[];
  peer_selection: {
    methodology: string;
    source_provider: string;
    source_url: string;
    source_as_of: string;
    candidates_considered: number;
    selection_version: string;
  };
  filings: Array<{
    form: string;
    filing_date: string | null;
    report_date: string | null;
    accession_number: string;
    source_url: string;
  }>;
  risks: Array<{
    severity: string;
    title: string;
    detail: string;
    kind?: "filing_theme" | "quantitative_indicator";
    theme?: string;
    evidence?: string[];
    item?: string;
    source_url?: string;
    filing_date?: string | null;
    report_date?: string | null;
    accession_number?: string;
    form?: string;
  }>;
  news: NewsFeed;
  freshness?: {
    page_status: "live" | "cached" | "refreshing" | "stale";
    financials: DataFreshness;
    quote: DataFreshness;
    analyst_estimates: DataFreshness;
    comps: DataFreshness;
    news: DataFreshness;
    risks: DataFreshness;
    summary: DataFreshness;
  };
  provenance: {
    financials: string;
    quarterly_financials: string;
    analyst_estimates: string;
    quote: string;
    risk_factors: string;
    news: string;
    comparables: string;
    peer_snapshot_as_of: string;
    methodology_version: string;
    normalization_version: string;
    valuation_model_version: string;
    score_model_version: string;
    generated_at: string;
    warnings: string[];
  };
};

export type DataFreshness = {
  status: "live" | "cached" | "stale" | "unavailable";
  as_of: string | null;
  fresh_until: string | null;
  source: string;
};

export type AnalystEstimate = {
  period: string;
  consensus_eps: number | null;
  high_eps: number | null;
  low_eps: number | null;
  analyst_count: number | null;
  revisions_up: number | null;
  revisions_down: number | null;
};

export type DcfAssumptions = {
  forecast_years: number;
  revenue_growth: number | null;
  fcf_margin: number | null;
  wacc: number;
  terminal_growth: number;
};
