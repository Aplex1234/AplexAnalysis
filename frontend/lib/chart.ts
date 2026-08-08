import type { FinancialPeriod } from "./types";

export type FinancialChartDatum = {
  year: number;
  revenue: number | null;
  freeCashFlow: number | null;
  operatingIncome: number | null;
};

const BILLION = 1_000_000_000;

export function buildFinancialChartData(periods: FinancialPeriod[]): FinancialChartDatum[] {
  return periods.map((period) => ({
    year: period.fiscal_year,
    revenue: period.values.revenue == null ? null : period.values.revenue / BILLION,
    freeCashFlow: period.values.free_cash_flow == null ? null : period.values.free_cash_flow / BILLION,
    operatingIncome: period.values.operating_income == null ? null : period.values.operating_income / BILLION,
  }));
}

export function formatBillions(value: number | string | null | undefined): string {
  if (value == null) return "N/A";
  const numericValue = Number(value);
  return Number.isFinite(numericValue) ? `$${numericValue.toFixed(1)}B` : "N/A";
}
