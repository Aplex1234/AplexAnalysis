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
  fiscal_quarter?: 1 | 2 | 3 | 4;
  period_type: "FY" | "Q1" | "Q2" | "Q3" | "Q4";
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
const QUARTERLY_FORMS = new Set(["10-Q"]);

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

function pointFiscalYear(point: SecPoint): number | null {
  const fiscalYear = Number(point.fy);
  if (Number.isInteger(fiscalYear) && fiscalYear >= 1900 && fiscalYear <= 2200) return fiscalYear;
  return pointYear(point);
}

function pointQuarter(point: SecPoint): 1 | 2 | 3 | null {
  if (point.fp === "Q1") return 1;
  if (point.fp === "Q2") return 2;
  if (point.fp === "Q3") return 3;
  return null;
}

function isBetterPoint(candidate: SecPoint, current: SecPoint): boolean {
  const candidateFiled = String(candidate.filed ?? "");
  const currentFiled = String(current.filed ?? "");
  if (candidateFiled !== currentFiled) return candidateFiled > currentFiled;

  const candidateEnd = String(candidate.end ?? "");
  const currentEnd = String(current.end ?? "");
  if (candidateEnd !== currentEnd) return candidateEnd > currentEnd;

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

function quarterlyPoints(
  fact: SecFact | undefined,
  definition: MetricDefinition,
  mode: "direct" | "cumulative",
) {
  const rows = fact?.units?.[definition.unit] ?? [];
  const byQuarter = new Map<string, SecPoint>();

  for (const point of rows) {
    if (!QUARTERLY_FORMS.has(String(point.form)) || !point.end) continue;
    if (!Number.isFinite(Number(point.val))) continue;
    const fiscalYear = pointFiscalYear(point);
    const quarter = pointQuarter(point);
    if (fiscalYear == null || quarter == null) continue;

    if (definition.period === "instant") {
      if (point.start) continue;
    } else {
      const days = durationDays(point);
      if (days == null) continue;
      const direct = days >= 60 && days <= 120;
      const expectedMinimum = quarter === 1 ? 60 : quarter === 2 ? 140 : 220;
      const expectedMaximum = quarter === 1 ? 120 : quarter === 2 ? 220 : 320;
      const cumulative = days >= expectedMinimum && days <= expectedMaximum;
      if (mode === "direct" ? !direct : !cumulative) continue;
    }

    const key = `${fiscalYear}-Q${quarter}`;
    const current = byQuarter.get(key);
    if (!current || isBetterPoint(point, current)) byQuarter.set(key, point);
  }

  return byQuarter;
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

function deriveFinancialValues(values: FinancialValues, provenance: NormalizedPeriod["provenance"]) {
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

      deriveFinancialValues(values, provenance);

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

export function normalizeQuarterlyCompanyFacts(payload: SecCompanyFacts): NormalizedPeriod[] {
  const facts = payload?.facts?.["us-gaap"] ?? {};
  const quarters = new Map<
    string,
    { fiscalYear: number; quarter: 1 | 2 | 3 | 4; values: FinancialValues; provenance: NormalizedPeriod["provenance"]; meta: SecPoint }
  >();

  const writeMetric = (
    metric: string,
    fiscalYear: number,
    quarter: 1 | 2 | 3 | 4,
    value: number,
    point: SecPoint,
    tag: string,
    formula?: string,
  ) => {
    if (!Number.isFinite(value)) return;
    const key = `${fiscalYear}-Q${quarter}`;
    const bucket = quarters.get(key) ?? { fiscalYear, quarter, values: {}, provenance: {}, meta: point };
    if (bucket.values[metric] != null) return;
    bucket.values[metric] = value;
    bucket.provenance[metric] = {
      provider: "SEC EDGAR Company Facts",
      taxonomy: `us-gaap:${tag}`,
      accession_number: point.accn ?? "",
      filed: point.filed ?? "",
      source_url: `https://www.sec.gov/Archives/edgar/data/${Number(payload.cik)}/${String(point.accn ?? "").replaceAll("-", "")}`,
      ...(formula ? { formula } : {}),
    };
    if (String(point.end) > String(bucket.meta.end)) bucket.meta = point;
    quarters.set(key, bucket);
  };

  for (const [metric, definition] of Object.entries(METRICS)) {
    const direct = new Map<string, { point: SecPoint; tag: string }>();
    const cumulative = new Map<string, { point: SecPoint; tag: string }>();
    const annual = new Map<number, { point: SecPoint; tag: string }>();

    for (const tag of definition.tags) {
      for (const [key, point] of quarterlyPoints(facts[tag], definition, "direct")) {
        if (!direct.has(key)) direct.set(key, { point, tag });
      }
      if (definition.period === "duration") {
        for (const [key, point] of quarterlyPoints(facts[tag], definition, "cumulative")) {
          if (!cumulative.has(key)) cumulative.set(key, { point, tag });
        }
      }
      for (const point of annualPoints(facts[tag], definition)) {
        const fiscalYear = pointYear(point);
        if (fiscalYear != null && !annual.has(fiscalYear)) annual.set(fiscalYear, { point, tag });
      }
    }

    const fiscalYears = new Set<number>();
    for (const key of [...direct.keys(), ...cumulative.keys()]) fiscalYears.add(Number(key.split("-Q")[0]));
    for (const fiscalYear of annual.keys()) fiscalYears.add(fiscalYear);

    for (const fiscalYear of fiscalYears) {
      const quarterValues = new Map<1 | 2 | 3, number>();
      for (const quarter of [1, 2, 3] as const) {
        const key = `${fiscalYear}-Q${quarter}`;
        const directValue = direct.get(key);
        if (directValue) {
          const value = Number(directValue.point.val);
          quarterValues.set(quarter, value);
          writeMetric(metric, fiscalYear, quarter, value, directValue.point, directValue.tag);
          continue;
        }

        const cumulativeValue = cumulative.get(key);
        if (!cumulativeValue) continue;
        const current = Number(cumulativeValue.point.val);
        const prior = quarter === 1 ? 0 : Number(cumulative.get(`${fiscalYear}-Q${quarter - 1}`)?.point.val);
        if (quarter > 1 && !Number.isFinite(prior)) continue;
        const value = current - prior;
        quarterValues.set(quarter, value);
        writeMetric(
          metric,
          fiscalYear,
          quarter,
          value,
          cumulativeValue.point,
          cumulativeValue.tag,
          quarter === 1 ? "reported first-quarter value" : `year-to-date Q${quarter} minus year-to-date Q${quarter - 1}`,
        );
      }

      const annualValue = annual.get(fiscalYear);
      if (!annualValue) continue;
      if (definition.period === "instant") {
        writeMetric(metric, fiscalYear, 4, Number(annualValue.point.val), annualValue.point, annualValue.tag);
        continue;
      }
      if (![1, 2, 3].every((quarter) => quarterValues.has(quarter as 1 | 2 | 3))) continue;
      const firstNineMonths = [...quarterValues.values()].reduce((sum, value) => sum + value, 0);
      writeMetric(
        metric,
        fiscalYear,
        4,
        Number(annualValue.point.val) - firstNineMonths,
        annualValue.point,
        annualValue.tag,
        "fiscal-year value minus Q1, Q2 and Q3",
      );
    }
  }

  return [...quarters.values()]
    .sort((left, right) => left.fiscalYear - right.fiscalYear || left.quarter - right.quarter)
    .map((bucket) => {
      deriveFinancialValues(bucket.values, bucket.provenance);
      return {
        fiscal_year: bucket.fiscalYear,
        fiscal_quarter: bucket.quarter,
        period_type: `Q${bucket.quarter}` as "Q1" | "Q2" | "Q3" | "Q4",
        period_end: bucket.meta.end ?? null,
        filed_at: bucket.meta.filed ?? null,
        accession_number: bucket.meta.accn ?? null,
        form: bucket.quarter === 4 ? "10-K" : bucket.meta.form ?? "10-Q",
        currency: "USD" as const,
        values: bucket.values,
        provenance: bucket.provenance,
      };
    })
    .filter((period) =>
      [period.values.revenue, period.values.operating_income, period.values.net_income, period.values.operating_cash_flow]
        .some((value) => value != null),
    )
    .slice(-24);
}
