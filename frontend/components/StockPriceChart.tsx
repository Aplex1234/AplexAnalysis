"use client";

import { useEffect, useMemo, useState } from "react";
import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import { fetchStockPriceHistory } from "@/lib/api";
import { money, percent } from "@/lib/format";
import type { StockPriceHistory } from "@/lib/types";

type ChartRange = "1m" | "3m" | "6m" | "1y";

const RANGE_DAYS: Record<ChartRange, number> = { "1m": 31, "3m": 93, "6m": 186, "1y": 366 };
const RANGE_LABELS: Array<{ key: ChartRange; label: string }> = [
  { key: "1m", label: "1M" },
  { key: "3m", label: "3M" },
  { key: "6m", label: "6M" },
  { key: "1y", label: "1Y" },
];

function readableDate(value: string): string {
  return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" })
    .format(new Date(`${value}T00:00:00Z`));
}

export function StockPriceChart({ ticker }: { ticker: string }) {
  const [history, setHistory] = useState<StockPriceHistory | null>(null);
  const [range, setRange] = useState<ChartRange>("1y");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    setHistory(null);
    setError(null);
    fetchStockPriceHistory(ticker, controller.signal)
      .then(setHistory)
      .catch((reason) => {
        if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : "Price history failed.");
      });
    return () => controller.abort();
  }, [ticker]);

  const points = useMemo(() => {
    if (!history?.points.length) return [];
    const latest = new Date(`${history.points.at(-1)!.date}T00:00:00Z`);
    const cutoff = new Date(latest);
    cutoff.setUTCDate(cutoff.getUTCDate() - RANGE_DAYS[range]);
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
              <AreaChart data={points} margin={{ top: 18, right: 16, bottom: 2, left: 0 }}>
                <CartesianGrid stroke="var(--aplex-grid)" vertical={false} />
                <XAxis dataKey="date" minTickGap={56} tickLine={false} axisLine={{ stroke: "var(--aplex-line-strong)" }} tickFormatter={(value) => readableDate(String(value)).replace(/, \d{4}/, "")} />
                <YAxis domain={["auto", "auto"]} tickLine={false} axisLine={false} width={70} tickFormatter={(value) => money(Number(value), 0)} />
                <Tooltip
                  labelFormatter={(value) => readableDate(String(value))}
                  formatter={(value) => [money(Number(value)), "Close"]}
                  contentStyle={{ borderRadius: 10, border: "1px solid var(--aplex-line-strong)", boxShadow: "var(--aplex-shadow)", background: "var(--aplex-panel)", color: "var(--aplex-ink)" }}
                />
                <Area type="monotone" dataKey="close" name="Close" stroke={positive ? "var(--aplex-positive)" : "var(--aplex-negative)"} fill={positive ? "var(--aplex-positive)" : "var(--aplex-negative)"} fillOpacity={0.1} strokeWidth={2.5} dot={false} activeDot={{ r: 4 }} isAnimationActive={false} />
              </AreaChart>
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
