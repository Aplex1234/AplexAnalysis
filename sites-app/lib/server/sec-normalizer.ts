export type FinancialValues = Record<string, number | undefined>;

export type SecPoint = {
  form?: string;
  fy?: number | string;
  fp?: string;
  filed?: string;
  val?: number | string;
  accn?: string;
  start?: string;
  end?: string;
  frame?: string;
};

export type SecFact = {
  units?: Record<string, SecPoint[] | undefined>;
};

export type SecCompanyFacts = {
  cik: number | string;
  facts?: { "us-gaap"?: Record<string, SecFact> };
};

export type NormalizedPeriod = {
  fiscal_year: number;
  period_type: "FY";
  period_end: string | null;
  filed_at: string | null;
  accession_number: string | null;
  form: string;
  currency: "USD";
  values: FinancialValues;
  provenance: Record<string, Record<string, string>>;
};

type MetricDefinition = {
  period: "duration" | "instant";
  unit: "USD" | "shares";
  tags: string[];
};

const ANNUAL_FORMS = new Set(["10-K", "20-F", "40-F"]);

const METRICS: Record<string, MetricDefinition> = {
  revenue: {
    period: "duration",
    unit: "USD",
    tags: [
      "RevenueFromContractWithCustomerExcludingAssessedTax",
      "Revenues",
      "SalesRevenueNet",
      "SalesRevenueGoodsNet",
      "SalesRevenueServicesNet",
      "RegulatedAndUnregulatedOperatingRevenue",
      "HealthCareOrganizationRevenue",
    ],
  },
  gross_profit: {
    period: "duration",
    unit: "USD",
    tags: ["GrossProfit"],
  },
  operating_income: {
    period: "duration",
    unit: "USD",
    tags: ["OperatingIncomeLoss"],
  },
  net_income: {
    period: "duration",
    unit: "USD",
    tags: ["NetIncomeLoss", "ProfitLoss", "NetIncomeLossAvailableToCommonStockholdersBasic"],
  },
  operating_cash_flow: {
    period: "duration",
    unit: "USD",
    tags: [
      "NetCashProvidedByUsedInOperatingActivities",
      "NetCashProvidedByUsedInOperatingActivitiesContinuingOperations",
    ],
  },
  capex: {
    period: "duration",
    unit: "USD",
    tags: [
      "PaymentsToAcquirePropertyPlantAndEquipment",
      "PaymentsForAdditionsToPropertyPlantAndEquipment",
      "PaymentsToAcquireProductiveAssets",
      "PaymentsToAcquirePropertyPlantAndEquipmentAndIntangibleAssets",
    ],
  },
  dividends_paid: {
    period: "duration",
    unit: "USD",
    tags: ["PaymentsOfDividends", "PaymentsOfDividendsCommonStock", "PaymentsOfOrdinaryDividends"],
  },
  share_repurchases: {
    period: "duration",
    unit: "USD",
    tags: ["PaymentsForRepurchaseOfCommonStock"],
  },
  cash: {
    period: "instant",
    unit: "USD",
    tags: [
      "CashAndCashEquivalentsAtCarryingValue",
      "CashCashEquivalentsRestrictedCashAndRestrictedCashEquivalents",
    ],
  },
  short_term_investments: {
    period: "instant",
    unit: "USD",
    tags: ["ShortTermInvestments", "MarketableSecuritiesCurrent", "AvailableForSaleSecuritiesCurrent"],
  },
  total_assets: {
    period: "instant",
    unit: "USD",
    tags: ["Assets"],
  },
  current_assets: {
    period: "instant",
    unit: "USD",
    tags: ["AssetsCurrent"],
  },
  total_liabilities: {
    period: "instant",
    unit: "USD",
    tags: ["Liabilities"],
  },
  current_liabilities: {
    period: "instant",
    unit: "USD",
    tags: ["LiabilitiesCurrent"],
  },
  equity: {
    period: "instant",
    unit: "USD",
    tags: ["StockholdersEquity", "StockholdersEquityIncludingPortionAttributableToNoncontrollingInterest"],
  },
  long_term_debt: {
    period: "instant",
    unit: "USD",
    tags: [
      "LongTermDebtAndFinanceLeaseObligationsNoncurrent",
      "LongTermDebtNoncurrent",
      "LongTermDebtAndCapitalLeaseObligationsNoncurrent",
    ],
  },
  current_debt: {
    period: "instant",
    unit: "USD",
    tags: [
      "LongTermDebtAndFinanceLeaseObligationsCurrent",
      "LongTermDebtCurrent",
      "ShortTermBorrowings",
      "ShortTermDebtCurrent",
    ],
  },
  inventory: {
    period: "instant",
    unit: "USD",
    tags: ["InventoryNet"],
  },
  accounts_receivable: {
    period: "instant",
    unit: "USD",
    tags: ["AccountsReceivableNetCurrent", "AccountsNotesAndLoansReceivableNetCurrent"],
  },
  diluted_shares: {
    period: "duration",
    unit: "shares",
    tags: ["WeightedAverageNumberOfDilutedSharesOutstanding"],
  },
  shares_outstanding: {
    period: "instant",
    unit: "shares",
    tags: ["CommonStockSharesOutstanding", "EntityCommonStockSharesOutstanding"],
  },
};

function parseDate(value: string | undefined): number | null {
  if (!value) return null;
  const timestamp = Date.parse(`${value}T00:00:00Z`);
  return Number.isFinite(timestamp) ? timestamp : null;
}

function durationDays(point: SecPoint): number | null {
  const start = parseDate(point.start);
  const end = parseDate(point.end);
  if (start == null || end == null) return null;
  return Math.round((end - start) / 86_400_000);
}

function isUsableAnnualPoint(point: SecPoint, period: MetricDefinition["period"]): boolean {
  if (!ANNUAL_FORMS.has(String(point.form)) || point.fp !== "FY" || !point.end) return false;
  const numericValue = Number(point.val);
  if (!Number.isFinite(numericValue)) return false;
  if (period === "instant") return !point.start;
  const days = durationDays(point);
  return days != null && days >= 300 && days <= 400;
}

function pointYear(point: SecPoint): number | null {
  const endYear = Number(String(point.end ?? "").slice(0, 4));
  if (Number.isInteger(endYear) && endYear >= 1900 && endYear <= 2200) return endYear;
  const fiscalYear = Number(point.fy);
  return Number.isInteger(fiscalYear) ? fiscalYear : null;
}

function isBetterPoint(candidate: SecPoint, current: SecPoint): boolean {
  const candidateFiled = String(candidate.filed ?? "");
  const currentFiled = String(current.filed ?? "");
  if (candidateFiled !== currentFiled) return candidateFiled > currentFiled;

  const candidateFrame = String(candidate.frame ?? "");
  const currentFrame = String(current.frame ?? "");
  if (Boolean(candidateFrame) !== Boolean(currentFrame)) return Boolean(candidateFrame);

  return String(candidate.accn ?? "") > String(current.accn ?? "");
}

function annualPoints(fact: SecFact | undefined, definition: MetricDefinition): SecPoint[] {
  const rows = fact?.units?.[definition.unit] ?? [];
  const byPeriodEnd = new Map<string, SecPoint>();

  for (const point of rows) {
    if (!isUsableAnnualPoint(point, definition.period)) continue;
    const key = String(point.end);
    const current = byPeriodEnd.get(key);
    if (!current || isBetterPoint(point, current)) byPeriodEnd.set(key, point);
  }

  const byYear = new Map<number, SecPoint>();
  for (const point of byPeriodEnd.values()) {
    const year = pointYear(point);
    if (year == null) continue;
    const current = byYear.get(year);
    if (!current || String(point.end) > String(current.end)) byYear.set(year, point);
  }

  return [...byYear.values()].sort((left, right) => (pointYear(left) ?? 0) - (pointYear(right) ?? 0));
}

function setDerivedValue(
  values: FinancialValues,
  provenance: NormalizedPeriod["provenance"],
  key: string,
  value: number | undefined,
  formula: string,
) {
  if (value == null || !Number.isFinite(value)) return;
  values[key] = value;
  provenance[key] = { formula };
}

export function normalizeCompanyFacts(payload: SecCompanyFacts): NormalizedPeriod[] {
  const facts = payload?.facts?.["us-gaap"] ?? {};
  const years = new Map<
    number,
    { values: FinancialValues; provenance: NormalizedPeriod["provenance"]; meta: SecPoint }
  >();

  for (const [metric, definition] of Object.entries(METRICS)) {
    const pointsByYear = new Map<number, { point: SecPoint; tag: string }>();

    for (const tag of definition.tags) {
      for (const point of annualPoints(facts[tag], definition)) {
        const year = pointYear(point);
        if (year == null || pointsByYear.has(year)) continue;
        pointsByYear.set(year, { point, tag });
      }
    }

    for (const [year, { point, tag }] of pointsByYear) {
      const bucket = years.get(year) ?? { values: {}, provenance: {}, meta: point };
      bucket.values[metric] = Number(point.val);
      bucket.provenance[metric] = {
        provider: "SEC EDGAR Company Facts",
        taxonomy: `us-gaap:${tag}`,
        accession_number: point.accn ?? "",
        filed: point.filed ?? "",
        source_url: `https://www.sec.gov/Archives/edgar/data/${Number(payload.cik)}/${String(point.accn ?? "").replaceAll("-", "")}`,
      };
      if (String(point.end) > String(bucket.meta.end)) bucket.meta = point;
      years.set(year, bucket);
    }
  }

  return [...years.entries()]
    .sort(([left], [right]) => left - right)
    .map(([fiscalYear, bucket]) => {
      const values = bucket.values;
      const provenance = bucket.provenance;

      if (values.operating_cash_flow != null && values.capex != null) {
        setDerivedValue(
          values,
          provenance,
          "free_cash_flow",
          values.operating_cash_flow - Math.abs(values.capex),
          "operating_cash_flow - abs(capex)",
        );
      }
      if (values.net_income != null && values.diluted_shares) {
        setDerivedValue(
          values,
          provenance,
          "diluted_eps",
          values.net_income / values.diluted_shares,
          "net_income / diluted_shares",
        );
      }

      const cashAndInvestments =
        values.cash == null
          ? values.short_term_investments
          : values.cash + (values.short_term_investments ?? 0);
      setDerivedValue(
        values,
        provenance,
        "cash_and_investments",
        cashAndInvestments,
        "cash + short_term_investments",
      );

      const totalDebt =
        values.long_term_debt == null
          ? values.current_debt
          : values.long_term_debt + (values.current_debt ?? 0);
      setDerivedValue(
        values,
        provenance,
        "total_debt",
        totalDebt,
        "long_term_debt + current_debt",
      );

      if (totalDebt != null && cashAndInvestments != null) {
        setDerivedValue(
          values,
          provenance,
          "net_debt",
          totalDebt - cashAndInvestments,
          "total_debt - cash_and_investments",
        );
      }
      if (values.current_assets != null && values.current_liabilities != null) {
        setDerivedValue(
          values,
          provenance,
          "working_capital",
          values.current_assets - values.current_liabilities,
          "current_assets - current_liabilities",
        );
      }

      return {
        fiscal_year: fiscalYear,
        period_type: "FY" as const,
        period_end: bucket.meta.end ?? null,
        filed_at: bucket.meta.filed ?? null,
        accession_number: bucket.meta.accn ?? null,
        form: bucket.meta.form ?? "10-K",
        currency: "USD" as const,
        values,
        provenance,
      };
    })
    .filter((period) =>
      [
        period.values.revenue,
        period.values.operating_income,
        period.values.net_income,
        period.values.operating_cash_flow,
      ].some((value) => value != null),
    )
    .slice(-10);
}
