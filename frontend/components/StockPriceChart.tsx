"use client";

import { useEffect, useMemo, useState } from "react";
import {
  Area,
  Bar,
  CartesianGrid,
  ComposedChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import { fetchStockPriceHistory } from "@/lib/api";
import { money, percent } from "@/lib/format";
import type { StockPriceHistory } from "@/lib/types";

type ChartRange = "1w" | "1m" | "3m" | "6m" | "1y" | "5y" | "max";
type SourceRange = "1y" | "5y" | "max";

const RANGE_DAYS: Partial<Record<ChartRange, number>> = { "1w": 7, "1m": 31, "3m": 93, "6m": 186, "1y": 366 };
const RANGE_LABELS: Array<{ key: ChartRange; label: string }> = [
  { key: "1w", label: "1W" },
  { key: "1m", label: "1M" },
  { key: "3m", label: "3M" },
  { key: "6m", label: "6M" },
  { key: "1y", label: "1Y" },
  { key: "5y", label: "5Y" },
  { key: "max", label: "Max" },
];

function readableDate(value: string): string {
  return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" })
    .format(new Date(`${value}T00:00:00Z`));
}

export function StockPriceChart({ ticker }: { ticker: string }) {
  const [history, setHistory] = useState<StockPriceHistory | null>(null);
  const [range, setRange] = useState<ChartRange>("1y");
  const [error, setError] = useState<string | null>(null);
  const sourceRange: SourceRange = range === "5y" || range === "max" ? range : "1y";

  useEffect(() => {
    const controller = new AbortController();
    setHistory(null);
    setError(null);
    fetchStockPriceHistory(ticker, sourceRange, controller.signal)
      .then(setHistory)
      .catch((reason) => {
        if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : "Price history failed.");
      });
    return () => controller.abort();
  }, [ticker, sourceRange]);

  const points = useMemo(() => {
    if (!history?.points.length) return [];
    const days = RANGE_DAYS[range];
    if (days == null) return history.points;
    const latest = new Date(`${history.points.at(-1)!.date}T00:00:00Z`);
    const cutoff = new Date(latest);
    cutoff.setUTCDate(cutoff.getUTCDate() - days);
    const cutoffIso = cutoff.toISOString().slice(0, 10);
    return history.points.filter((point) => point.date >= cutoffIso);
  }, [history, range]);

  const first = points[0];
  const latest = points.at(-1);
  const absoluteChange = first && latest ? latest.close - first.close : null;
  const percentageChange = first && latest && first.close ? absoluteChange! / first.close : null;
  const high = points.length ? Math.max(...points.map((point) => point.high)) : null;
  const low = points.length ? Math.min(...points.map((point) => point.low)) : null;
  const positive = (absoluteChange ?? 0) >= 0;
  const compactNumber = (value: number) => new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 1 }).format(value);
  const axisDate = (value: string) => range === "5y" || range === "max"
    ? new Date(`${value}T00:00:00Z`).getUTCFullYear().toString()
    : readableDate(value).replace(/, \d{4}/, "");

  return (
    <section className="market-chart-section">
      <div className="market-chart-heading">
        <div>
          <span>MARKET PERFORMANCE</span>
          <h3>{ticker} price history</h3>
          <p>{history ? `${history.provider}, through ${readableDate(history.as_of)}` : "Loading delayed daily prices"}</p>
        </div>
        <div className="range-selector" aria-label="Price chart range">
          {RANGE_LABELS.map((item) => (
            <button key={item.key} type="button" className={range === item.key ? "active" : ""} aria-pressed={range === item.key} onClick={() => setRange(item.key)}>{item.label}</button>
          ))}
        </div>
      </div>

      {error ? (
        <div className="market-chart-message"><strong>Price chart unavailable</strong><span>{error}</span></div>
      ) : !history ? (
        <div className="market-chart-loading"><span /><span /><span /></div>
      ) : (
        <>
          <div className="market-stat-row">
            <div><span>LAST CLOSE</span><strong>{money(latest?.close)}</strong></div>
            <div><span>PERIOD CHANGE</span><strong className={positive ? "positive" : "negative"}>{absoluteChange == null ? "N/A" : `${absoluteChange >= 0 ? "+" : ""}${money(absoluteChange)} (${percent(percentageChange)})`}</strong></div>
            <div><span>PERIOD HIGH</span><strong>{money(high)}</strong></div>
            <div><span>PERIOD LOW</span><strong>{money(low)}</strong></div>
          </div>
          <div className="market-chart-canvas" role="img" aria-label={`${ticker} closing price chart for the selected ${range} range`}>
            <ResponsiveContainer width="100%" height={340}>
              <ComposedChart data={points} margin={{ top: 18, right: 16, bottom: 2, left: 0 }}>
                <CartesianGrid stroke="var(--aplex-grid)" vertical={false} />
                <XAxis dataKey="date" minTickGap={56} tickLine={false} axisLine={{ stroke: "var(--aplex-line-strong)" }} tickFormatter={(value) => axisDate(String(value))} />
                <YAxis yAxisId="price" domain={["auto", "auto"]} tickLine={false} axisLine={false} width={70} tickFormatter={(value) => money(Number(value), 0)} />
                <YAxis yAxisId="volume" hide domain={[0, (dataMax: number) => dataMax * 5]} />
                <Tooltip
                  labelFormatter={(value) => readableDate(String(value))}
                  formatter={(value, name) => name === "Volume" ? [compactNumber(Number(value)), "Volume"] : [money(Number(value)), "Close"]}
                  contentStyle={{ borderRadius: 10, border: "1px solid var(--aplex-line-strong)", boxShadow: "var(--aplex-shadow)", background: "var(--aplex-panel)", color: "var(--aplex-ink)" }}
                />
                <Bar yAxisId="volume" dataKey="volume" name="Volume" fill="var(--aplex-muted)" opacity={0.16} isAnimationActive={false} />
                <Area yAxisId="price" type="monotone" dataKey="close" name="Close" stroke={positive ? "var(--aplex-positive)" : "var(--aplex-negative)"} fill={positive ? "var(--aplex-positive)" : "var(--aplex-negative)"} fillOpacity={0.09} strokeWidth={2.3} dot={false} activeDot={{ r: 4 }} isAnimationActive={false} />
              </ComposedChart>
            </ResponsiveContainer>
          </div>
          <div className="market-chart-foot">
            <span>Daily closing prices</span>
            <a href={history.source_url} target="_blank" rel="noreferrer">View Nasdaq source</a>
          </div>
        </>
      )}
    </section>
  );
}
