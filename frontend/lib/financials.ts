import type { FinancialPeriod, FinancialValues } from "./types";

export type FinancialGroupKey = "income" | "margins" | "cashFlow" | "balanceSheet";
export type FinancialUnit = "money" | "percent";
export type FinancialGrowthMode = "yoy" | "qoq";
export type FinancialMetricKey =
  | keyof FinancialValues
  | "gross_margin"
  | "operating_margin"
  | "net_margin"
  | "fcf_margin";

export type FinancialSeriesDefinition = {
  key: FinancialMetricKey;
  label: string;
  color: string;
  chart: "bar" | "line";
};

export type FinancialGroupDefinition = {
  key: FinancialGroupKey;
  label: string;
  shortLabel: string;
  description: string;
  unit: FinancialUnit;
  series: FinancialSeriesDefinition[];
};

export const FINANCIAL_GROUPS: FinancialGroupDefinition[] = [
  {
    key: "income",
    label: "Income statement",
    shortLabel: "Income",
    description: "Revenue and earnings from standardized SEC filings",
    unit: "money",
    series: [
      { key: "revenue", label: "Revenue", color: "var(--chart-1)", chart: "bar" },
      { key: "gross_profit", label: "Gross profit", color: "var(--chart-2)", chart: "line" },
      { key: "operating_income", label: "Operating income", color: "var(--chart-3)", chart: "line" },
      { key: "net_income", label: "Net income", color: "var(--chart-4)", chart: "line" },
    ],
  },
  {
    key: "margins",
    label: "Margins",
    shortLabel: "Margins",
    description: "Profitability as a percentage of reported revenue",
    unit: "percent",
    series: [
      { key: "gross_margin", label: "Gross margin", color: "var(--chart-2)", chart: "line" },
      { key: "operating_margin", label: "Operating margin", color: "var(--chart-3)", chart: "line" },
      { key: "net_margin", label: "Net margin", color: "var(--chart-4)", chart: "line" },
      { key: "fcf_margin", label: "FCF margin", color: "var(--chart-1)", chart: "line" },
    ],
  },
  {
    key: "cashFlow",
    label: "Cash flow",
    shortLabel: "Cash flow",
    description: "Operating cash generation, reinvestment and owner returns",
    unit: "money",
    series: [
      { key: "operating_cash_flow", label: "Operating cash flow", color: "var(--chart-1)", chart: "bar" },
      { key: "free_cash_flow", label: "Free cash flow", color: "var(--chart-2)", chart: "line" },
      { key: "capex", label: "Capital expenditure", color: "var(--chart-4)", chart: "line" },
      { key: "dividends_paid", label: "Dividends paid", color: "var(--chart-3)", chart: "line" },
    ],
  },
  {
    key: "balanceSheet",
    label: "Balance sheet",
    shortLabel: "Balance sheet",
    description: "Cash, assets, obligations and shareholder capital at each period-end",
    unit: "money",
    series: [
      { key: "total_assets", label: "Total assets", color: "var(--chart-1)", chart: "bar" },
      { key: "cash_and_investments", label: "Cash and investments", color: "var(--chart-2)", chart: "line" },
      { key: "total_liabilities", label: "Total liabilities", color: "var(--chart-4)", chart: "line" },
      { key: "total_debt", label: "Total debt", color: "var(--chart-3)", chart: "line" },
      { key: "equity", label: "Shareholders' equity", color: "var(--chart-5)", chart: "line" },
    ],
  },
];

const MARGIN_KEYS = new Set<FinancialMetricKey>([
  "gross_margin",
  "operating_margin",
  "net_margin",
  "fcf_margin",
]);

export function financialMetricValue(period: FinancialPeriod, key: FinancialMetricKey): number | null {
  const values = period.values;
  if (key === "gross_margin") return values.revenue && values.gross_profit != null ? values.gross_profit / values.revenue : null;
  if (key === "operating_margin") return values.revenue && values.operating_income != null ? values.operating_income / values.revenue : null;
  if (key === "net_margin") return values.revenue && values.net_income != null ? values.net_income / values.revenue : null;
  if (key === "fcf_margin") return values.revenue && values.free_cash_flow != null ? values.free_cash_flow / values.revenue : null;

  const value = values[key as keyof FinancialValues];
  if (value == null || !Number.isFinite(value)) return null;
  if (key === "capex" || key === "dividends_paid") return -Math.abs(value);
  return value;
}

export function financialPeriodLabel(period: FinancialPeriod) {
  return period.fiscal_quarter
    ? `Q${period.fiscal_quarter} FY${period.fiscal_year}`
    : `FY ${period.fiscal_year}`;
}

export type FinancialScaleUnit = "B" | "M" | "K" | "";

export type FinancialScale = {
  factor: number;
  unit: FinancialScaleUnit;
  label: string;
};

export function getFinancialScale(
  periods: FinancialPeriod[],
  group?: FinancialGroupDefinition,
): FinancialScale {
  let maxAbs = 0;
  for (const period of periods) {
    if (group) {
      for (const series of group.series) {
        if (!MARGIN_KEYS.has(series.key)) {
          const val = financialMetricValue(period, series.key);
          if (val != null && Number.isFinite(val)) {
            maxAbs = Math.max(maxAbs, Math.abs(val));
          }
        }
      }
    } else {
      for (const val of Object.values(period.values)) {
        if (val != null && Number.isFinite(val)) {
          maxAbs = Math.max(maxAbs, Math.abs(val));
        }
      }
    }
  }

  if (maxAbs >= 1_000_000_000) {
    return { factor: 1_000_000_000, unit: "B", label: "in billions" };
  }
  if (maxAbs >= 1_000_000) {
    return { factor: 1_000_000, unit: "M", label: "in millions" };
  }
  if (maxAbs >= 1_000) {
    return { factor: 1_000, unit: "K", label: "in thousands" };
  }
  return { factor: 1, unit: "", label: "in dollars" };
}

export function formatScaledMoney(
  value: number | string | null | undefined,
  unit: FinancialScaleUnit = "B",
): string {
  if (value == null) return "N/A";
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return "N/A";
  const absFormatted = Math.abs(numeric).toFixed(1);
  const isZero = absFormatted === "0.0" || Number(absFormatted) === 0;
  const isNegative = !isZero && numeric < 0;
  return `${isNegative ? "-" : ""}$${absFormatted}${unit}`;
}

export function buildFinancialExplorerData(
  periods: FinancialPeriod[],
  group: FinancialGroupDefinition,
  scaleFactor?: number,
) {
  const factor = scaleFactor ?? (group.unit === "money" ? getFinancialScale(periods, group).factor : 1);
  return periods.map((period) => {
    const point: Record<string, number | string | null> & { year: number; label: string } = {
      year: period.fiscal_year,
      label: financialPeriodLabel(period),
    };
    for (const series of group.series) {
      const rawValue = financialMetricValue(period, series.key);
      point[series.key] = rawValue == null
        ? null
        : MARGIN_KEYS.has(series.key)
          ? rawValue * 100
          : rawValue / factor;
    }
    return point;
  });
}

export function financialGrowthValue(
  current: number | null,
  previous: number | null,
  unit: FinancialUnit,
): number | null {
  if (current == null || previous == null) return null;
  if (unit === "percent") return (current - previous) * 100;
  if (previous <= 0 || current < 0) return null;
  return (current / previous - 1) * 100;
}

export function buildFinancialGrowthData(
  periods: FinancialPeriod[],
  group: FinancialGroupDefinition,
  mode: FinancialGrowthMode,
) {
  const lag = mode === "yoy" ? 4 : 1;
  return periods.map((period, index) => {
    const point: Record<string, number | string | null> & { year: number; label: string } = {
      year: period.fiscal_year,
      label: financialPeriodLabel(period),
    };
    for (const series of group.series) {
      const previousPeriod = periods[index - lag];
      const current = financialMetricValue(period, series.key);
      const previous = previousPeriod ? financialMetricValue(previousPeriod, series.key) : null;
      point[series.key] = financialGrowthValue(current, previous, group.unit);
    }
    return point;
  });
}

export function availableFinancialSeries(periods: FinancialPeriod[], group: FinancialGroupDefinition) {
  return group.series.filter((series) =>
    periods.some((period) => financialMetricValue(period, series.key) != null),
  );
}

export function latestFinancialValue(periods: FinancialPeriod[], key: FinancialMetricKey) {
  for (let index = periods.length - 1; index >= 0; index -= 1) {
    const value = financialMetricValue(periods[index], key);
    if (value != null) return { year: periods[index].fiscal_year, label: financialPeriodLabel(periods[index]), value };
  }
  return null;
}
