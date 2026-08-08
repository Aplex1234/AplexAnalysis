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
import { buildFinancialChartData, formatBillions } from "@/lib/chart";

export function FinancialChart({ periods }: { periods: FinancialPeriod[] }) {
  const data = buildFinancialChartData(periods);

  return (
    <div className="chart-frame" role="img" aria-label="Revenue, free cash flow and operating income history">
      <ResponsiveContainer width="100%" height={300}>
        <ComposedChart data={data} margin={{ top: 16, right: 8, bottom: 0, left: 0 }}>
          <CartesianGrid stroke="var(--aplex-grid)" vertical={false} />
          <XAxis dataKey="year" tickLine={false} axisLine={{ stroke: "var(--aplex-line-strong)" }} tick={{ fill: "var(--aplex-muted)" }} />
          <YAxis yAxisId="money" tickFormatter={formatBillions} tickLine={false} axisLine={false} width={64} />
          <Tooltip
            contentStyle={{ borderRadius: 10, border: "1px solid var(--aplex-line-strong)", boxShadow: "var(--aplex-shadow)", background: "var(--aplex-panel)", color: "var(--aplex-ink)" }}
            formatter={(value) => formatBillions(value as number | string)}
          />
          <Legend iconType="square" />
          <Bar yAxisId="money" dataKey="revenue" name="Revenue" fill="var(--chart-1)" opacity={0.2} isAnimationActive={false} />
          <Line yAxisId="money" type="monotone" dataKey="freeCashFlow" name="Free cash flow" stroke="var(--chart-1)" strokeWidth={2} dot={{ r: 3 }} connectNulls={false} isAnimationActive={false} />
          <Line yAxisId="money" type="monotone" dataKey="operatingIncome" name="Operating income" stroke="var(--chart-3)" strokeWidth={2} strokeDasharray="5 4" dot={false} connectNulls={false} isAnimationActive={false} />
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}
