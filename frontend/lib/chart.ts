import type { FinancialPeriod } from "./types";

export type FinancialChartDatum = {
  year: number;
  revenue: number;
  freeCashFlow: number;
  operatingIncome: number;
};

const BILLION = 1_000_000_000;

export function buildFinancialChartData(periods: FinancialPeriod[]): FinancialChartDatum[] {
  return periods.map((period) => ({
    year: period.fiscal_year,
    revenue: (period.values.revenue ?? 0) / BILLION,
    freeCashFlow: (period.values.free_cash_flow ?? 0) / BILLION,
    operatingIncome: (period.values.operating_income ?? 0) / BILLION,
  }));
}

export function formatBillions(value: number | string): string {
  const numericValue = Number(value);
  return Number.isFinite(numericValue) ? `$${numericValue.toFixed(1)}B` : "N/A";
}
