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
  FINANCIAL_GROUPS,
  financialMetricValue,
  latestFinancialValue,
  type FinancialGroupKey,
  type FinancialMetricKey,
} from "@/lib/financials";
import type { FinancialPeriod } from "@/lib/types";

function formatChartValue(value: number | string, unit: "money" | "percent") {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return "N/A";
  return unit === "percent" ? `${numeric.toFixed(1)}%` : `$${numeric.toFixed(1)}B`;
}

function formatRawValue(value: number | null, unit: "money" | "percent") {
  if (value == null) return "N/A";
  return unit === "percent" ? percent(value) : compactMoney(value);
}

export function FinancialExplorer({ periods }: { periods: FinancialPeriod[] }) {
  const [groupKey, setGroupKey] = useState<FinancialGroupKey>("income");
  const [hiddenSeries, setHiddenSeries] = useState<FinancialMetricKey[]>([]);
  const group = FINANCIAL_GROUPS.find((item) => item.key === groupKey) ?? FINANCIAL_GROUPS[0];
  const availableSeries = useMemo(() => availableFinancialSeries(periods, group), [periods, group]);
  const data = useMemo(() => buildFinancialExplorerData(periods, group), [periods, group]);
  const visibleSeries = availableSeries.filter((series) => !hiddenSeries.includes(series.key));

  useEffect(() => setHiddenSeries([]), [groupKey]);

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
        <span>{periods.length} annual periods</span>
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

          <div
            className="explorer-chart"
            role="img"
            aria-label={`${group.label} history for ${periods[0]?.fiscal_year ?? "available years"} through ${periods.at(-1)?.fiscal_year ?? "latest year"}`}
          >
            <ResponsiveContainer width="100%" height={360}>
              <ComposedChart data={data} margin={{ top: 20, right: 18, bottom: 4, left: 2 }}>
                <CartesianGrid stroke="var(--aplex-grid)" vertical={false} />
                <XAxis
                  dataKey="year"
                  tickLine={false}
                  axisLine={{ stroke: "var(--aplex-line-strong)" }}
                  tick={{ fill: "var(--aplex-muted)" }}
                />
                <YAxis
                  tickFormatter={(value) => formatChartValue(value, group.unit)}
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
                  formatter={(value) => formatChartValue(value as number | string, group.unit)}
                />
                {visibleSeries.map((series) =>
                  series.chart === "bar" ? (
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
                      name={series.label}
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
                  <small>{latest ? `FY ${latest.year}` : "Not reported"}</small>
                </div>
              );
            })}
          </div>

          <div className="financial-table-wrap">
            <table className="research-table financial-explorer-table">
              <thead>
                <tr>
                  <th>Fiscal year</th>
                  {availableSeries.map((series) => <th key={series.key}>{series.label}</th>)}
                </tr>
              </thead>
              <tbody>
                {[...periods].reverse().map((period) => (
                  <tr key={period.fiscal_year}>
                    <th>{period.fiscal_year}</th>
                    {availableSeries.map((series) => (
                      <td key={series.key}>
                        {formatRawValue(financialMetricValue(period, series.key), group.unit)}
                      </td>
                    ))}
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
