export type ValuationBasis = "net_income" | "eps";
export type ScenarioKey = "bear" | "base" | "bull";

export type MultipleScenarioInput = {
  growthRate: number;
  exitPe: number;
};

export type MultipleValuationInput = {
  basis: ValuationBasis;
  forecastYears: number;
  currentNetIncome: number | null;
  currentEps: number | null;
  currentShares: number | null;
  currentPrice: number | null;
  currentMarketCap: number | null;
  annualShareChange: number;
  scenario: MultipleScenarioInput;
};

export type MultipleValuationResult = {
  projectedNetIncome: number | null;
  projectedEps: number | null;
  projectedShares: number | null;
  projectedMarketCap: number | null;
  projectedSharePrice: number | null;
  totalUpside: number | null;
  annualizedReturn: number | null;
  pegRatio: number | null;
  valuationLabel: "Undervalued" | "Fairly valued" | "Overvalued" | "Unavailable";
};

export type MultipleValuationSettings = {
  basis: ValuationBasis;
  forecastYears: number;
  annualShareChange: number;
  scenarios: Record<ScenarioKey, MultipleScenarioInput>;
};

const finiteOrNull = (value: number | null | undefined) =>
  value != null && Number.isFinite(value) ? value : null;

export function compoundValue(value: number | null, annualRate: number, years: number) {
  if (value == null || !Number.isFinite(value) || !Number.isFinite(annualRate) || years < 0) return null;
  const multiplier = (1 + annualRate) ** years;
  return Number.isFinite(multiplier) ? value * multiplier : null;
}

export function impliedValuationLabel(annualizedReturn: number | null): MultipleValuationResult["valuationLabel"] {
  if (annualizedReturn == null || !Number.isFinite(annualizedReturn)) return "Unavailable";
  if (annualizedReturn >= 0.10) return "Undervalued";
  if (annualizedReturn >= 0.04) return "Fairly valued";
  return "Overvalued";
}

export function projectMultipleValuation(input: MultipleValuationInput): MultipleValuationResult {
  const years = Math.max(1, Math.round(input.forecastYears));
  const shares = compoundValue(finiteOrNull(input.currentShares), input.annualShareChange, years);
  const projectedBasis = compoundValue(
    input.basis === "net_income" ? finiteOrNull(input.currentNetIncome) : finiteOrNull(input.currentEps),
    input.scenario.growthRate,
    years,
  );

  let projectedNetIncome: number | null = null;
  let projectedEps: number | null = null;
  let projectedMarketCap: number | null = null;
  let projectedSharePrice: number | null = null;

  if (input.basis === "net_income") {
    projectedNetIncome = projectedBasis;
    projectedMarketCap = projectedBasis == null ? null : projectedBasis * input.scenario.exitPe;
    projectedEps = projectedNetIncome != null && shares != null && shares > 0
      ? projectedNetIncome / shares
      : null;
    projectedSharePrice = projectedMarketCap != null && shares != null && shares > 0
      ? projectedMarketCap / shares
      : null;
  } else {
    projectedEps = projectedBasis;
    projectedSharePrice = projectedBasis == null ? null : projectedBasis * input.scenario.exitPe;
    projectedNetIncome = projectedEps != null && shares != null ? projectedEps * shares : null;
    projectedMarketCap = projectedSharePrice != null && shares != null
      ? projectedSharePrice * shares
      : null;
  }

  const marketCap = finiteOrNull(input.currentMarketCap);
  const price = finiteOrNull(input.currentPrice);
  const totalUpside = projectedMarketCap != null && marketCap != null && marketCap > 0
    ? projectedMarketCap / marketCap - 1
    : projectedSharePrice != null && price != null && price > 0
      ? projectedSharePrice / price - 1
      : null;
  const annualizedReturn = totalUpside != null && totalUpside > -1
    ? (1 + totalUpside) ** (1 / years) - 1
    : null;
  const pegRatio = input.scenario.growthRate > 0
    ? input.scenario.exitPe / (input.scenario.growthRate * 100)
    : null;

  return {
    projectedNetIncome,
    projectedEps,
    projectedShares: shares,
    projectedMarketCap,
    projectedSharePrice,
    totalUpside,
    annualizedReturn,
    pegRatio,
    valuationLabel: impliedValuationLabel(annualizedReturn),
  };
}

export function calculateCagr(start: number | null, end: number | null, periods: number) {
  if (start == null || end == null || start <= 0 || end <= 0 || periods <= 0) return null;
  const value = (end / start) ** (1 / periods) - 1;
  return Number.isFinite(value) ? value : null;
}

export function periodGrowth(current: number | null, previous: number | null) {
  if (current == null || previous == null || current < 0 || previous <= 0) return null;
  const value = current / previous - 1;
  return Number.isFinite(value) ? value : null;
}

export function buildDefaultMultipleSettings({
  basisCagr,
  shareCagr,
  currentPe,
}: {
  basisCagr: number | null;
  shareCagr: number | null;
  currentPe: number | null;
}): MultipleValuationSettings {
  const baseGrowth = Math.min(0.35, Math.max(-0.10, basisCagr ?? 0.10));
  const basePe = Math.min(60, Math.max(8, currentPe ?? 20));
  return {
    basis: "net_income",
    forecastYears: 5,
    annualShareChange: Math.min(0.10, Math.max(-0.15, shareCagr ?? 0)),
    scenarios: {
      bear: { growthRate: Math.max(-0.20, baseGrowth - 0.05), exitPe: Math.max(5, basePe - 5) },
      base: { growthRate: baseGrowth, exitPe: basePe },
      bull: { growthRate: Math.min(0.60, baseGrowth + 0.05), exitPe: Math.min(80, basePe + 5) },
    },
  };
}
