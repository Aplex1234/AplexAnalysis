type ProjectionPeriod = {
  fiscal_year: number;
  values: {
    revenue?: number;
    net_income?: number;
  };
};

export type PegProjection = {
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

const clamp = (value: number, low: number, high: number) => Math.max(low, Math.min(high, value));

export function calculatePegProjection(
  periods: ProjectionPeriod[],
  pe: number | null,
  annualGrowth: number,
): PegProjection {
  const latest = periods.at(-1);
  const targetPeg = 1.2 as const;
  const forecastYears = 5 as const;
  const growth = Number.isFinite(annualGrowth) ? annualGrowth : 0;
  let revenue = latest?.values.revenue ?? 0;
  let netIncome = latest?.values.net_income ?? null;

  const projections = Array.from({ length: forecastYears }, (_, index) => {
    revenue *= 1 + growth;
    if (netIncome != null) netIncome *= 1 + growth;
    return {
      fiscal_year: (latest?.fiscal_year ?? new Date().getUTCFullYear()) + index + 1,
      revenue,
      net_income: netIncome,
      growth_rate: growth,
    };
  });
  const averageAnnualGrowth = projections.reduce((sum, row) => sum + row.growth_rate, 0) / forecastYears;
  const usablePe = pe != null && Number.isFinite(pe) && pe > 0 ? pe : null;
  const pegRatio = usablePe != null && averageAnnualGrowth > 0
    ? usablePe / (averageAnnualGrowth * 100)
    : null;
  const score = pegRatio == null
    ? 0
    : pegRatio <= targetPeg
      ? 100
      : Math.round(clamp((targetPeg / pegRatio) * 100, 0, 100));
  const interpretation = pegRatio == null
    ? "PEG cannot be calculated because positive projected growth and a positive current P/E are both required."
    : `Current P/E of ${usablePe!.toFixed(1)} divided by ${(averageAnnualGrowth * 100).toFixed(1)}% average projected growth produces a PEG of ${pegRatio.toFixed(2)}. A PEG of ${targetPeg.toFixed(1)} or lower receives the full valuation score; higher PEG values score proportionally as target PEG divided by actual PEG.`;

  return {
    basis: "revenue",
    forecast_years: forecastYears,
    projections,
    average_annual_growth: averageAnnualGrowth,
    current_pe: usablePe,
    peg_ratio: pegRatio,
    target_peg: targetPeg,
    score,
    interpretation,
  };
}
