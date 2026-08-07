"use client";

import {
  Bar,
  CartesianGrid,
  ComposedChart,
  Legend,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { FinancialPeriod } from "@/lib/types";

export function FinancialChart({ periods }: { periods: FinancialPeriod[] }) {
  const data = periods.map((period) => ({
    year: period.fiscal_year,
    revenue: (period.values.revenue ?? 0) / 1_000_000_000,
    fcf: (period.values.free_cash_flow ?? 0) / 1_000_000_000,
    margin: ((period.values.operating_income ?? 0) / (period.values.revenue ?? 1)) * 100,
  }));

  return (
    <div className="chart-frame" role="img" aria-label="Revenue, free cash flow and operating margin history">
      <ResponsiveContainer width="100%" height={300}>
        <ComposedChart data={data} margin={{ top: 16, right: 8, bottom: 0, left: 0 }}>
          <CartesianGrid stroke="#e0e0e0" vertical={false} />
          <XAxis dataKey="year" tickLine={false} axisLine={{ stroke: "#8d8d8d" }} />
          <YAxis yAxisId="money" tickFormatter={(value) => `$${value}B`} tickLine={false} axisLine={false} width={64} />
          <YAxis yAxisId="percent" orientation="right" tickFormatter={(value) => `${value}%`} tickLine={false} axisLine={false} width={46} />
          <Tooltip
            contentStyle={{ borderRadius: 0, border: "1px solid #8d8d8d", boxShadow: "none" }}
            formatter={(value, name) => [name === "margin" ? `${Number(value).toFixed(1)}%` : `$${Number(value).toFixed(1)}B`, name]}
          />
          <Legend iconType="square" />
          <Bar yAxisId="money" dataKey="revenue" name="Revenue" fill="#0f62fe" opacity={0.24} />
          <Line yAxisId="money" type="monotone" dataKey="fcf" name="Free cash flow" stroke="#0f62fe" strokeWidth={2} dot={{ r: 3 }} />
          <Line yAxisId="percent" type="monotone" dataKey="margin" name="Operating margin" stroke="#161616" strokeWidth={2} strokeDasharray="5 4" dot={false} />
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}

