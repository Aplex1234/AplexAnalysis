"use client";

import { useEffect, useMemo, useState } from "react";
import { Button } from "@carbon/react";
import { Renew } from "@carbon/icons-react";
import {
  CartesianGrid,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import { compactMoney, compactShares, money, percent } from "@/lib/format";
import { financialPeriodLabel } from "@/lib/financials";
import {
  buildDefaultMultipleSettings,
  calculateCagr,
  periodGrowth,
  projectMultipleValuation,
  type MultipleValuationResult,
  type MultipleValuationSettings,
  type ScenarioKey,
  type ValuationBasis,
} from "../lib/multiple-valuation";
import type { Analysis, FinancialPeriod } from "@/lib/types";

type HistoryMetric = "net_income" | "eps" | "shares" | "revenue" | "margins";
type Frequency = "annual" | "quarterly";

const SCENARIOS: Array<{ key: ScenarioKey; label: string }> = [
  { key: "bear", label: "Bear" },
  { key: "base", label: "Base" },
  { key: "bull", label: "Bull" },
];

const HISTORY_METRICS: Array<{ key: HistoryMetric; label: string }> = [
  { key: "net_income", label: "Net income" },
  { key: "eps", label: "EPS" },
  { key: "shares", label: "Share count" },
  { key: "revenue", label: "Revenue" },
  { key: "margins", label: "Margins" },
];

const STORAGE_PREFIX = "aplex:multiple-valuation:v1";

function finite(value: number | null | undefined) {
  return value != null && Number.isFinite(value) ? value : null;
}

function periodValue(period: FinancialPeriod, key: "net_income" | "revenue" | "shares" | "eps") {
  if (key === "shares") return finite(period.values.diluted_shares ?? period.values.shares_outstanding);
  if (key === "eps") {
    const reported = finite(period.values.diluted_eps);
    if (reported != null) return reported;
    const income = finite(period.values.net_income);
    const shares = finite(period.values.diluted_shares ?? period.values.shares_outstanding);
    return income != null && shares != null && shares > 0 ? income / shares : null;
  }
  return finite(period.values[key]);
}

function marginValue(period: FinancialPeriod, kind: "gross" | "operating" | "net") {
  const revenue = finite(period.values.revenue);
  const numerator = kind === "gross"
    ? finite(period.values.gross_profit)
    : kind === "operating"
      ? finite(period.values.operating_income)
      : finite(period.values.net_income);
  return revenue != null && revenue !== 0 && numerator != null ? numerator / revenue : null;
}

function seriesCagr(periods: FinancialPeriod[], key: "net_income" | "revenue" | "shares" | "eps") {
  const available = periods
    .map((period) => ({ year: period.fiscal_year, value: periodValue(period, key) }))
    .filter((item): item is { year: number; value: number } => item.value != null && item.value > 0);
  const first = available[0];
  const last = available.at(-1);
  if (!first || !last || first === last) return null;
  return calculateCagr(first.value, last.value, Math.max(1, last.year - first.year));
}

function latestTrailingValues(annual: FinancialPeriod[], quarterly: FinancialPeriod[]) {
  const latestAnnual = annual.at(-1);
  const latestFour = quarterly.slice(-4);
  const hasFourQuarterIncome = latestFour.length === 4 && latestFour.every((period) => periodValue(period, "net_income") != null);
  const latestQuarter = quarterly.at(-1);
  const netIncome = hasFourQuarterIncome
    ? latestFour.reduce((sum, period) => sum + (periodValue(period, "net_income") ?? 0), 0)
    : latestAnnual ? periodValue(latestAnnual, "net_income") : null;
  const shares = latestQuarter
    ? periodValue(latestQuarter, "shares") ?? (latestAnnual ? periodValue(latestAnnual, "shares") : null)
    : latestAnnual ? periodValue(latestAnnual, "shares") : null;
  const eps = netIncome != null && shares != null && shares > 0 ? netIncome / shares : latestAnnual ? periodValue(latestAnnual, "eps") : null;
  return {
    netIncome,
    shares,
    eps,
    label: hasFourQuarterIncome ? "Trailing four quarters" : latestAnnual ? `FY ${latestAnnual.fiscal_year}` : "Latest available",
  };
}

function validSettings(value: unknown): value is MultipleValuationSettings {
  if (!value || typeof value !== "object") return false;
  const settings = value as Partial<MultipleValuationSettings>;
  if (settings.basis !== "net_income" && settings.basis !== "eps") return false;
  if (!Number.isFinite(settings.forecastYears) || !Number.isFinite(settings.annualShareChange)) return false;
  return SCENARIOS.every(({ key }) => {
    const scenario = settings.scenarios?.[key];
    return Boolean(scenario && Number.isFinite(scenario.growthRate) && Number.isFinite(scenario.exitPe));
  });
}

function metricFormat(value: number | null, metric: HistoryMetric) {
  if (value == null) return "N/A";
  if (metric === "eps") return money(value);
  if (metric === "shares") return compactShares(value);
  if (metric === "margins") return percent(value);
  return compactMoney(value);
}

function chartFormat(value: number | string, metric: HistoryMetric) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return "N/A";
  if (metric === "eps") return money(numeric);
  if (metric === "shares") return compactShares(numeric);
  if (metric === "margins") return `${numeric.toFixed(1)}%`;
  return compactMoney(numeric);
}

function valuationTone(label: MultipleValuationResult["valuationLabel"]) {
  if (label === "Undervalued") return "positive";
  if (label === "Overvalued") return "negative";
  return "neutral";
}

function growthText(value: number | null) {
  if (value == null) return "N/M";
  return `${value >= 0 ? "+" : ""}${percent(value)}`;
}

function GrowthCell({ primary, secondary }: { primary: number | null; secondary?: number | null }) {
  const tone = primary == null ? "neutral" : primary >= 0 ? "positive" : "negative";
  return (
    <span className={`valuation-growth ${tone}`}>
      {growthText(primary)}
      {secondary !== undefined && <small>{growthText(secondary)} QoQ</small>}
    </span>
  );
}

export function MultipleValuationView({ analysis }: { analysis: Analysis }) {
  const annual = analysis.financials;
  const quarterly = analysis.quarterly_financials;
  const current = useMemo(() => latestTrailingValues(annual, quarterly), [annual, quarterly]);
  const netIncomeCagr = useMemo(() => seriesCagr(annual, "net_income"), [annual]);
  const epsCagr = useMemo(() => seriesCagr(annual, "eps"), [annual]);
  const shareCagr = useMemo(() => seriesCagr(annual, "shares"), [annual]);
  const revenueCagr = useMemo(() => seriesCagr(annual, "revenue"), [annual]);
  const defaults = useMemo(() => buildDefaultMultipleSettings({
    basisCagr: netIncomeCagr,
    shareCagr,
    currentPe: finite(analysis.metrics.pe),
  }), [analysis.metrics.pe, netIncomeCagr, shareCagr]);
  const [settings, setSettings] = useState<MultipleValuationSettings>(defaults);
  const [frequency, setFrequency] = useState<Frequency>("annual");
  const [historyMetric, setHistoryMetric] = useState<HistoryMetric>("net_income");
  const [storageReady, setStorageReady] = useState(false);

  const storageKey = `${STORAGE_PREFIX}:${analysis.company.ticker}`;

  useEffect(() => {
    setStorageReady(false);
    try {
      const saved = JSON.parse(window.localStorage.getItem(storageKey) ?? "null");
      setSettings(validSettings(saved) ? saved : defaults);
    } catch {
      setSettings(defaults);
      window.localStorage.removeItem(storageKey);
    }
    setStorageReady(true);
  }, [defaults, storageKey]);

  useEffect(() => {
    if (!storageReady) return;
    window.localStorage.setItem(storageKey, JSON.stringify(settings));
  }, [settings, storageKey, storageReady]);

  const results = useMemo(() => Object.fromEntries(SCENARIOS.map(({ key }) => [
    key,
    projectMultipleValuation({
      basis: settings.basis,
      forecastYears: settings.forecastYears,
      currentNetIncome: current.netIncome,
      currentEps: current.eps,
      currentShares: current.shares,
      currentPrice: analysis.quote.price,
      currentMarketCap: finite(analysis.metrics.market_cap),
      annualShareChange: settings.annualShareChange,
      scenario: settings.scenarios[key],
    }),
  ])) as Record<ScenarioKey, MultipleValuationResult>, [analysis.metrics.market_cap, analysis.quote.price, current, settings]);

  const historyPeriods = frequency === "quarterly" ? quarterly : annual;
  const historyData = useMemo(() => historyPeriods.map((period) => {
    const label = financialPeriodLabel(period);
    const grossMargin = marginValue(period, "gross");
    const operatingMargin = marginValue(period, "operating");
    const netMargin = marginValue(period, "net");
    return historyMetric === "margins"
      ? {
          label,
          gross: grossMargin == null ? null : grossMargin * 100,
          operating: operatingMargin == null ? null : operatingMargin * 100,
          net: netMargin == null ? null : netMargin * 100,
        }
      : { label, value: periodValue(period, historyMetric) };
  }), [historyMetric, historyPeriods]);

  const projectionData = useMemo(() => {
    const start = settings.basis === "net_income" ? current.netIncome : current.eps;
    return Array.from({ length: settings.forecastYears + 1 }, (_, year) => ({
      year: year === 0 ? "Today" : `Y${year}`,
      bear: start == null ? null : start * (1 + settings.scenarios.bear.growthRate) ** year,
      base: start == null ? null : start * (1 + settings.scenarios.base.growthRate) ** year,
      bull: start == null ? null : start * (1 + settings.scenarios.bull.growthRate) ** year,
    }));
  }, [current.eps, current.netIncome, settings]);

  function updateScenario(key: ScenarioKey, field: "growthRate" | "exitPe", value: number) {
    setSettings((currentSettings) => ({
      ...currentSettings,
      scenarios: {
        ...currentSettings.scenarios,
        [key]: { ...currentSettings.scenarios[key], [field]: value },
      },
    }));
  }

  function switchBasis(basis: ValuationBasis) {
    setSettings((currentSettings) => ({ ...currentSettings, basis }));
    setHistoryMetric(basis === "net_income" ? "net_income" : "eps");
  }

  const basisCagr = settings.basis === "net_income" ? netIncomeCagr : epsCagr;
  const base = results.base;

  return (
    <div className="page-stack multiple-valuation-page">
      <section className="multiple-valuation-header">
        <div>
          <span className="model-kicker">MULTIPLE-BASED ANALYSIS</span>
          <h2>Build a five-year valuation</h2>
          <p>Project earnings, apply an exit P/E, and compare the result with today&apos;s market value.</p>
        </div>
        <div className="valuation-header-actions">
          <div className="segmented-control" role="tablist" aria-label="Valuation basis">
            <button type="button" role="tab" aria-selected={settings.basis === "net_income"} className={settings.basis === "net_income" ? "active" : ""} onClick={() => switchBasis("net_income")}>Net income</button>
            <button type="button" role="tab" aria-selected={settings.basis === "eps"} className={settings.basis === "eps" ? "active" : ""} onClick={() => switchBasis("eps")}>EPS</button>
          </div>
          <span className="device-save-status">Saved in this browser</span>
        </div>
      </section>

      <section className="valuation-current-strip">
        <div><span>Starting {settings.basis === "net_income" ? "net income" : "EPS"}</span><strong>{settings.basis === "net_income" ? compactMoney(current.netIncome) : money(current.eps)}</strong><small>{current.label}</small></div>
        <div><span>Historical CAGR</span><strong>{percent(basisCagr)}</strong><small>{annual.length} fiscal years available</small></div>
        <div><span>Diluted shares</span><strong>{compactShares(current.shares)}</strong><small>{percent(shareCagr)} historical CAGR</small></div>
        <div><span>Current market cap</span><strong>{compactMoney(analysis.metrics.market_cap)}</strong><small>{money(analysis.quote.price)} per share</small></div>
        <div className={`current-verdict ${valuationTone(base.valuationLabel)}`}><span>Base case</span><strong>{base.valuationLabel}</strong><small>{percent(base.annualizedReturn)} annual return</small></div>
      </section>

      <section className="valuation-model-grid">
        <div className="valuation-input-panel">
          <div className="valuation-section-heading">
            <div><h3>Model assumptions</h3><p>Set a growth rate and exit P/E for each case.</p></div>
            <Button kind="ghost" size="sm" renderIcon={Renew} onClick={() => setSettings(defaults)}>Reset</Button>
          </div>
          <div className="shared-model-inputs">
            <label>
              <span>Forecast years</span>
              <input type="number" min={1} max={10} step={1} value={settings.forecastYears} onChange={(event) => setSettings({ ...settings, forecastYears: Math.min(10, Math.max(1, Number(event.target.value) || 1)) })} />
              <small>Projection horizon</small>
            </label>
            <label>
              <span>Annual share change</span>
              <div className="input-suffix"><input type="number" min={-20} max={20} step={0.5} value={(settings.annualShareChange * 100).toFixed(1)} onChange={(event) => setSettings({ ...settings, annualShareChange: Number(event.target.value) / 100 })} /><b>%</b></div>
              <small>Negative means buybacks</small>
            </label>
          </div>
          <div className="scenario-input-list">
            {SCENARIOS.map(({ key, label }) => (
              <fieldset key={key} className={`scenario-input-row ${key}`}>
                <legend>{label}</legend>
                <label>
                  <span>{settings.basis === "net_income" ? "Income" : "EPS"} growth</span>
                  <div className="input-suffix"><input type="number" min={-50} max={100} step={0.5} value={(settings.scenarios[key].growthRate * 100).toFixed(1)} onChange={(event) => updateScenario(key, "growthRate", Number(event.target.value) / 100)} /><b>%</b></div>
                </label>
                <label>
                  <span>Exit P/E</span>
                  <div className="input-suffix"><input type="number" min={1} max={100} step={0.5} value={settings.scenarios[key].exitPe.toFixed(1)} onChange={(event) => updateScenario(key, "exitPe", Number(event.target.value))} /><b>x</b></div>
                </label>
                <div className="scenario-peg"><span>PEG</span><strong>{results[key].pegRatio == null ? "N/A" : results[key].pegRatio.toFixed(2)}</strong></div>
              </fieldset>
            ))}
          </div>
          <p className="model-formula-note">Projected earnings = current earnings × (1 + growth rate)<sup>years</sup>. Projected value = earnings × exit P/E. PEG = exit P/E ÷ growth percentage.</p>
        </div>

        <div className="valuation-projection-panel">
          <div className="valuation-section-heading"><div><h3>{settings.forecastYears}-year earnings path</h3><p>Bear, base, and bull outcomes from the same starting point.</p></div></div>
          <div className="valuation-projection-chart" role="img" aria-label={`${settings.forecastYears}-year ${settings.basis === "net_income" ? "net income" : "EPS"} projection`}>
            <ResponsiveContainer width="100%" height={318}>
              <LineChart data={projectionData} margin={{ top: 18, right: 16, bottom: 0, left: 6 }}>
                <CartesianGrid stroke="var(--aplex-grid)" vertical={false} />
                <XAxis dataKey="year" tickLine={false} axisLine={{ stroke: "var(--aplex-line-strong)" }} />
                <YAxis tickFormatter={(value) => settings.basis === "eps" ? `$${Number(value).toFixed(0)}` : compactMoney(Number(value))} tickLine={false} axisLine={false} width={72} />
                <Tooltip contentStyle={{ background: "var(--aplex-panel)", border: "1px solid var(--aplex-line-strong)", borderRadius: 10, color: "var(--aplex-ink)" }} formatter={(value) => settings.basis === "eps" ? money(Number(value)) : compactMoney(Number(value))} />
                <Line dataKey="bear" name="Bear" stroke="var(--aplex-negative)" strokeWidth={1.75} dot={false} isAnimationActive={false} />
                <Line dataKey="base" name="Base" stroke="var(--aplex-blue)" strokeWidth={2.5} dot={{ r: 2.5 }} isAnimationActive={false} />
                <Line dataKey="bull" name="Bull" stroke="var(--aplex-positive)" strokeWidth={1.75} dot={false} isAnimationActive={false} />
              </LineChart>
            </ResponsiveContainer>
          </div>
          <div className="projection-legend"><span className="bear">Bear</span><span className="base">Base</span><span className="bull">Bull</span></div>
        </div>
      </section>

      <section className="scenario-results-section">
        <div className="valuation-section-heading"><div><h3>Scenario outcomes</h3><p>Projected values are compared with the current price and market capitalization.</p></div></div>
        <div className="scenario-results-grid">
          {SCENARIOS.map(({ key, label }) => {
            const result = results[key];
            return (
              <article key={key} className={`scenario-result ${key}`}>
                <div className="scenario-result-heading"><span>{label}</span><strong className={valuationTone(result.valuationLabel)}>{result.valuationLabel}</strong></div>
                <div className="scenario-primary-value"><span>Projected share price</span><strong>{money(result.projectedSharePrice)}</strong><small>{result.unavailableReason ?? `${percent(result.totalUpside)} total upside`}</small></div>
                <dl>
                  <div><dt>Market cap</dt><dd>{compactMoney(result.projectedMarketCap)}</dd></div>
                  <div><dt>Net income</dt><dd>{compactMoney(result.projectedNetIncome)}</dd></div>
                  <div><dt>EPS</dt><dd>{money(result.projectedEps)}</dd></div>
                  <div><dt>Diluted shares</dt><dd>{compactShares(result.projectedShares)}</dd></div>
                  <div><dt>Annual return</dt><dd>{percent(result.annualizedReturn)}</dd></div>
                  <div><dt>PEG</dt><dd>{result.pegRatio == null ? "N/A" : result.pegRatio.toFixed(2)}</dd></div>
                </dl>
              </article>
            );
          })}
        </div>
        <p className="valuation-label-note">Valuation label: under 4% implied annual return is Overvalued, 4% to under 10% is Fairly valued, and 10% or more is Undervalued.</p>
      </section>

      <section className="valuation-history-section">
        <div className="history-toolbar">
          <div><h3>Financial history</h3><p>Review the earnings record before choosing a forward rate.</p></div>
          <div className="segmented-control" role="tablist" aria-label="History frequency">
            <button type="button" role="tab" aria-selected={frequency === "annual"} className={frequency === "annual" ? "active" : ""} onClick={() => setFrequency("annual")}>Annual</button>
            <button type="button" role="tab" aria-selected={frequency === "quarterly"} className={frequency === "quarterly" ? "active" : ""} disabled={!quarterly.length} onClick={() => setFrequency("quarterly")}>Quarterly</button>
          </div>
        </div>
        <div className="history-metric-tabs" role="tablist" aria-label="Historical metric">
          {HISTORY_METRICS.map((metric) => <button key={metric.key} type="button" role="tab" aria-selected={historyMetric === metric.key} className={historyMetric === metric.key ? "active" : ""} onClick={() => setHistoryMetric(metric.key)}>{metric.label}</button>)}
        </div>
        <div className="valuation-history-chart" role="img" aria-label={`${frequency} ${HISTORY_METRICS.find((item) => item.key === historyMetric)?.label} history`}>
          <ResponsiveContainer width="100%" height={340}>
            <LineChart data={historyData} margin={{ top: 20, right: 18, bottom: 4, left: 6 }}>
              <CartesianGrid stroke="var(--aplex-grid)" vertical={false} />
              <XAxis dataKey="label" tickLine={false} axisLine={{ stroke: "var(--aplex-line-strong)" }} minTickGap={22} />
              <YAxis tickFormatter={(value) => chartFormat(value, historyMetric)} tickLine={false} axisLine={false} width={76} />
              <ReferenceLine y={0} stroke="var(--aplex-line-strong)" />
              <Tooltip contentStyle={{ background: "var(--aplex-panel)", border: "1px solid var(--aplex-line-strong)", borderRadius: 10, color: "var(--aplex-ink)" }} formatter={(value) => chartFormat(value as number | string, historyMetric)} />
              {historyMetric === "margins" ? (
                <>
                  <Line dataKey="gross" name="Gross margin" stroke="var(--chart-2)" strokeWidth={2} dot={false} connectNulls={false} isAnimationActive={false} />
                  <Line dataKey="operating" name="Operating margin" stroke="var(--chart-3)" strokeWidth={2} dot={false} connectNulls={false} isAnimationActive={false} />
                  <Line dataKey="net" name="Net margin" stroke="var(--chart-4)" strokeWidth={2} dot={false} connectNulls={false} isAnimationActive={false} />
                </>
              ) : <Line dataKey="value" name={HISTORY_METRICS.find((item) => item.key === historyMetric)?.label} stroke="var(--aplex-blue)" strokeWidth={2.25} dot={{ r: 3, fill: "var(--aplex-panel)" }} connectNulls={false} isAnimationActive={false} />}
            </LineChart>
          </ResponsiveContainer>
        </div>
        <div className="history-cagr-strip">
          <div><span>Revenue CAGR</span><strong>{percent(revenueCagr)}</strong></div>
          <div><span>Net income CAGR</span><strong>{percent(netIncomeCagr)}</strong></div>
          <div><span>EPS CAGR</span><strong>{percent(epsCagr)}</strong></div>
          <div><span>Share count CAGR</span><strong>{percent(shareCagr)}</strong></div>
        </div>
        <div className="valuation-history-table-wrap">
          <table className="research-table valuation-history-table">
            <thead><tr><th>Period</th><th>Revenue</th><th>Growth</th><th>Net income</th><th>Growth</th><th>Net margin</th><th>Diluted shares</th><th>Growth</th><th>EPS</th><th>Growth</th></tr></thead>
            <tbody>{[...historyPeriods].reverse().map((period, reverseIndex) => {
              const index = historyPeriods.length - 1 - reverseIndex;
              const comparisonIndex = frequency === "quarterly" ? index - 4 : index - 1;
              const previous = comparisonIndex >= 0 ? historyPeriods[comparisonIndex] : null;
              const sequential = frequency === "quarterly" && index > 0 ? historyPeriods[index - 1] : null;
              const growth = (key: "net_income" | "revenue" | "shares" | "eps", prior: FinancialPeriod | null) => periodGrowth(periodValue(period, key), prior ? periodValue(prior, key) : null);
              return (
                <tr key={`${period.fiscal_year}-${period.period_type}`}>
                  <th>{financialPeriodLabel(period)}</th>
                  <td>{compactMoney(periodValue(period, "revenue"))}</td>
                  <td><GrowthCell primary={growth("revenue", previous)} secondary={sequential ? growth("revenue", sequential) : undefined} /></td>
                  <td>{compactMoney(periodValue(period, "net_income"))}</td>
                  <td><GrowthCell primary={growth("net_income", previous)} secondary={sequential ? growth("net_income", sequential) : undefined} /></td>
                  <td>{percent(marginValue(period, "net"))}</td>
                  <td>{compactShares(periodValue(period, "shares"))}</td>
                  <td><GrowthCell primary={growth("shares", previous)} secondary={sequential ? growth("shares", sequential) : undefined} /></td>
                  <td>{metricFormat(periodValue(period, "eps"), "eps")}</td>
                  <td><GrowthCell primary={growth("eps", previous)} secondary={sequential ? growth("eps", sequential) : undefined} /></td>
                </tr>
              );
            })}</tbody>
          </table>
        </div>
        <p className="valuation-history-note">Quarterly growth uses the same fiscal quarter from the prior year, with sequential QoQ growth shown underneath. N/M means the percentage is not meaningful.</p>
      </section>
    </div>
  );
}
