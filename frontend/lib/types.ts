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

export type Analysis = {
  company: {
    ticker: string;
    name: string;
    cik: string;
    sector: string | null;
    industry: string | null;
    exchange: string | null;
    description: string | null;
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
  comps: Array<Record<string, number | string>>;
  filings: Array<{
    form: string;
    filing_date: string;
    report_date: string | null;
    accession_number: string;
    source_url: string;
  }>;
  risks: Array<{
    severity: string;
    title: string;
    detail: string;
    source_url?: string;
    filing_date?: string | null;
    form?: string;
  }>;
  provenance: {
    financials: string;
    quote: string;
    risk_factors: string;
    peer_snapshot_as_of: string;
    methodology_version: string;
    generated_at: string;
    warnings: string[];
  };
};

export type DcfAssumptions = {
  forecast_years: number;
  revenue_growth: number | null;
  fcf_margin: number | null;
  wacc: number;
  terminal_growth: number;
};
