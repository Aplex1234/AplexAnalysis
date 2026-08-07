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
          <CartesianGrid stroke="#e0e0e0" vertical={false} />
          <XAxis dataKey="year" tickLine={false} axisLine={{ stroke: "#8d8d8d" }} />
          <YAxis yAxisId="money" tickFormatter={formatBillions} tickLine={false} axisLine={false} width={64} />
          <Tooltip
            contentStyle={{ borderRadius: 0, border: "1px solid #8d8d8d", boxShadow: "none" }}
            formatter={(value) => formatBillions(value as number | string)}
          />
          <Legend iconType="square" />
          <Bar yAxisId="money" dataKey="revenue" name="Revenue" fill="#0f62fe" opacity={0.24} />
          <Line yAxisId="money" type="monotone" dataKey="freeCashFlow" name="Free cash flow" stroke="#0f62fe" strokeWidth={2} dot={{ r: 3 }} />
          <Line yAxisId="money" type="monotone" dataKey="operatingIncome" name="Operating income" stroke="#161616" strokeWidth={2} strokeDasharray="5 4" dot={false} />
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}
