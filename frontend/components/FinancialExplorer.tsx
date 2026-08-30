"use client";

import { useEffect, useMemo, useState } from "react";
import {
  Bar,
  CartesianGrid,
  ComposedChart,
  Line,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import { compactMoney, percent } from "@/lib/format";
import {
  availableFinancialSeries,
  buildFinancialExplorerData,
  buildFinancialGrowthData,
  FINANCIAL_GROUPS,
  financialGrowthValue,
  financialMetricValue,
  financialPeriodLabel,
  formatScaledMoney,
  getFinancialScale,
  latestFinancialValue,
  type FinancialGrowthMode,
  type FinancialGroupKey,
  type FinancialMetricKey,
  type FinancialScaleUnit,
} from "@/lib/financials";
import type { FinancialPeriod } from "@/lib/types";

function formatChartValue(value: number | string, unit: "money" | "percent", scaleUnit: FinancialScaleUnit = "B") {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return "N/A";
  return unit === "percent" ? `${numeric.toFixed(1)}%` : formatScaledMoney(numeric, scaleUnit);
}

function formatRawValue(value: number | null, unit: "money" | "percent") {
  if (value == null) return "N/A";
  return unit === "percent" ? percent(value) : compactMoney(value);
}

function formatGrowthChartValue(value: number | string, unit: "money" | "percent") {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return "N/A";
  return unit === "percent" ? `${numeric.toFixed(1)} pts` : `${numeric.toFixed(1)}%`;
}

function changeBadge(current: number | null, previous: number | null, unit: "money" | "percent", label: "YoY" | "QoQ") {
  const value = financialGrowthValue(current, previous, unit);
  if (value == null) return { label, value: "N/M", tone: "unavailable" } as const;
  const formatted = unit === "percent"
    ? `${value > 0 ? "+" : ""}${value.toFixed(1)} pts`
    : `${value > 0 ? "+" : ""}${value.toFixed(1)}%`;
  return {
    label,
    value: formatted,
    tone: value > 0 ? "positive" : value < 0 ? "negative" : "neutral",
  } as const;
}

export function FinancialExplorer({
  annualPeriods,
  quarterlyPeriods,
}: {
  annualPeriods: FinancialPeriod[];
  quarterlyPeriods: FinancialPeriod[];
}) {
  const [groupKey, setGroupKey] = useState<FinancialGroupKey>("income");
  const [frequency, setFrequency] = useState<"annual" | "quarterly">("annual");
  const [chartMode, setChartMode] = useState<"values" | FinancialGrowthMode>("values");
  const [hiddenSeries, setHiddenSeries] = useState<FinancialMetricKey[]>([]);
  const periods = frequency === "quarterly" ? quarterlyPeriods : annualPeriods;
  const group = FINANCIAL_GROUPS.find((item) => item.key === groupKey) ?? FINANCIAL_GROUPS[0];
  const availableSeries = useMemo(() => availableFinancialSeries(periods, group), [periods, group]);
  const scale = useMemo(() => getFinancialScale(periods, group), [periods, group]);
  const data = useMemo(
    () => chartMode === "values"
      ? buildFinancialExplorerData(periods, group, scale.factor)
      : buildFinancialGrowthData(periods, group, chartMode),
    [periods, group, chartMode, scale.factor],
  );
  const visibleSeries = availableSeries.filter((series) => !hiddenSeries.includes(series.key));
  const chartIsGrowth = chartMode !== "values";
  const chartModeLabel = chartMode === "yoy" ? "year-over-year growth" : chartMode === "qoq" ? "quarter-over-quarter growth" : `reported values (${scale.label})`;

  useEffect(() => setHiddenSeries([]), [groupKey, frequency]);
  useEffect(() => {
    if (frequency === "annual") setChartMode("values");
  }, [frequency]);

  function toggleSeries(key: FinancialMetricKey) {
    const isHidden = hiddenSeries.includes(key);
    if (!isHidden && visibleSeries.length === 1) return;
    setHiddenSeries((current) =>
      current.includes(key) ? current.filter((item) => item !== key) : [...current, key],
    );
  }

  return (
    <div className="financial-explorer">
      <div className="financial-tabs" role="tablist" aria-label="Financial statement views">
        {FINANCIAL_GROUPS.map((item) => (
          <button
            key={item.key}
            type="button"
            role="tab"
            aria-selected={item.key === groupKey}
            className={item.key === groupKey ? "active" : ""}
            onClick={() => setGroupKey(item.key)}
          >
            {item.label}
          </button>
        ))}
      </div>

      <div className="explorer-header">
        <div>
          <h3>{group.label}</h3>
          <p>{group.description}</p>
        </div>
        <div className="frequency-control">
          <div role="tablist" aria-label="Financial reporting frequency">
            <button type="button" role="tab" aria-selected={frequency === "annual"} className={frequency === "annual" ? "active" : ""} onClick={() => setFrequency("annual")}>Annual</button>
            <button type="button" role="tab" aria-selected={frequency === "quarterly"} className={frequency === "quarterly" ? "active" : ""} disabled={!quarterlyPeriods.length} onClick={() => setFrequency("quarterly")}>Quarterly</button>
          </div>
          <span>{periods.length} {frequency} periods</span>
        </div>
      </div>

      {availableSeries.length ? (
        <>
          <div className="series-controls" aria-label={`${group.label} chart series`}>
            {availableSeries.map((series) => {
              const active = !hiddenSeries.includes(series.key);
              return (
                <button
                  key={series.key}
                  type="button"
                  aria-pressed={active}
                  className={active ? "active" : ""}
                  onClick={() => toggleSeries(series.key)}
                >
                  <span style={{ backgroundColor: series.color }} aria-hidden="true" />
                  {series.label}
                </button>
              );
            })}
          </div>

          {frequency === "quarterly" && (
            <div className="financial-chart-toolbar">
              <div>
                <strong>Chart view</strong>
                <span>{chartIsGrowth ? (group.unit === "percent" ? "Change in percentage points" : "Percentage change") : group.unit === "money" ? `Reported values (${scale.label})` : "Reported financial values"}</span>
              </div>
              <div className="chart-mode-control" role="tablist" aria-label="Financial chart view">
                {([
                  ["values", "Values"],
                  ["yoy", "YoY growth"],
                  ["qoq", "QoQ growth"],
                ] as const).map(([mode, label]) => (
                  <button
                    key={mode}
                    type="button"
                    role="tab"
                    aria-selected={chartMode === mode}
                    className={chartMode === mode ? "active" : ""}
                    onClick={() => setChartMode(mode)}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>
          )}

          <div
            className="explorer-chart"
            role="img"
            aria-label={`${group.label} ${chartModeLabel} from ${periods[0] ? financialPeriodLabel(periods[0]) : "the first available period"} through ${periods.at(-1) ? financialPeriodLabel(periods.at(-1)!) : "the latest period"}`}
          >
            <ResponsiveContainer width="100%" height={360}>
              <ComposedChart data={data} margin={{ top: 20, right: 18, bottom: 4, left: 2 }}>
                <CartesianGrid stroke="var(--aplex-grid)" vertical={false} />
                <XAxis
                  dataKey="label"
                  tickLine={false}
                  axisLine={{ stroke: "var(--aplex-line-strong)" }}
                  tick={{ fill: "var(--aplex-muted)" }}
                />
                <YAxis
                  tickFormatter={(value) => chartIsGrowth ? formatGrowthChartValue(value, group.unit) : formatChartValue(value, group.unit, scale.unit)}
                  tickLine={false}
                  axisLine={false}
                  tick={{ fill: "var(--aplex-muted)" }}
                  width={68}
                />
                <ReferenceLine y={0} stroke="var(--aplex-line-strong)" />
                <Tooltip
                  cursor={{ fill: "var(--aplex-hover)" }}
                  contentStyle={{
                    background: "var(--aplex-panel)",
                    border: "1px solid var(--aplex-line-strong)",
                    borderRadius: 10,
                    boxShadow: "var(--aplex-shadow)",
                    color: "var(--aplex-ink)",
                  }}
                  formatter={(value) => chartIsGrowth ? formatGrowthChartValue(value as number | string, group.unit) : formatChartValue(value as number | string, group.unit, scale.unit)}
                />
                {visibleSeries.map((series) =>
                  !chartIsGrowth && series.chart === "bar" ? (
                    <Bar
                      key={series.key}
                      dataKey={series.key}
                      name={series.label}
                      fill={series.color}
                      fillOpacity={0.2}
                      stroke={series.color}
                      strokeWidth={1}
                      radius={[5, 5, 0, 0]}
                      isAnimationActive={false}
                    />
                  ) : (
                    <Line
                      key={series.key}
                      type="monotone"
                      dataKey={series.key}
                      name={chartIsGrowth ? `${series.label} ${chartMode === "yoy" ? "YoY" : "QoQ"}` : series.label}
                      stroke={series.color}
                      strokeWidth={2.25}
                      dot={{ r: 3, fill: "var(--aplex-panel)", strokeWidth: 2 }}
                      activeDot={{ r: 5 }}
                      connectNulls={false}
                      isAnimationActive={false}
                    />
                  ),
                )}
              </ComposedChart>
            </ResponsiveContainer>
          </div>

          <div className="latest-series-grid">
            {availableSeries.map((series) => {
              const latest = latestFinancialValue(periods, series.key);
              return (
                <div key={series.key}>
                  <span>{series.label}</span>
                  <strong>{formatRawValue(latest?.value ?? null, group.unit)}</strong>
                  <small>{latest ? latest.label : "Not reported"}</small>
                </div>
              );
            })}
          </div>

          <span className="horizontal-scroll-hint">Swipe sideways to see all financial columns</span>
          <div className="financial-table-wrap">
            <table className="research-table financial-explorer-table">
              <thead>
                <tr>
                  <th>{frequency === "quarterly" ? "Fiscal quarter" : "Fiscal year"}</th>
                  {availableSeries.map((series) => <th key={series.key}>{series.label}</th>)}
                </tr>
              </thead>
              <tbody>
                {periods.map((period, index) => ({ period, index })).reverse().map(({ period, index }) => (
                  <tr key={`${period.fiscal_year}-${period.period_type}`}>
                    <th>{financialPeriodLabel(period)}</th>
                    {availableSeries.map((series) => {
                      const value = financialMetricValue(period, series.key);
                      const yoyPeriod = periods[index - 4];
                      const priorQuarter = periods[index - 1];
                      const yoy = frequency === "quarterly" ? changeBadge(value, yoyPeriod ? financialMetricValue(yoyPeriod, series.key) : null, group.unit, "YoY") : null;
                      const qoq = frequency === "quarterly" ? changeBadge(value, priorQuarter ? financialMetricValue(priorQuarter, series.key) : null, group.unit, "QoQ") : null;
                      return (
                        <td key={series.key}>
                          <span>{formatRawValue(value, group.unit)}</span>
                          {frequency === "quarterly" && (
                            <span className="financial-cell-growth">
                              {[yoy, qoq].filter((change) => change != null).map((change) => change && (
                                <span key={change.label} className={`financial-growth-badge ${change.tone}`}>
                                  <span>{change.label}</span>
                                  <strong>{change.value}</strong>
                                </span>
                              ))}
                            </span>
                          )}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      ) : (
        <div className="financial-empty">
          <h4>No standardized {group.shortLabel.toLowerCase()} facts found</h4>
          <p>This company did not publish these values under comparable SEC XBRL tags.</p>
        </div>
      )}
    </div>
  );
}
