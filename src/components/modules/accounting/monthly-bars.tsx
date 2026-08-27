"use client";

import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { formatDZD } from "@/lib/format";

export interface MonthPoint {
  month: string;
  income: number;
  expense: number;
}

/** Grouped income vs expense bars for the last months. */
export function MonthlyBars({
  data,
  incomeLabel,
  expenseLabel,
  locale,
}: {
  data: MonthPoint[];
  incomeLabel: string;
  expenseLabel: string;
  locale: string;
}) {
  const compact = new Intl.NumberFormat(locale === "ar" ? "ar-DZ" : "fr-DZ", {
    notation: "compact",
    maximumFractionDigits: 1,
  });

  return (
    <div dir="ltr" className="h-64 w-full">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 0 }} barGap={4}>
          <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="var(--border)" />
          <XAxis
            dataKey="month"
            tickLine={false}
            axisLine={false}
            tick={{ fontSize: 12, fill: "var(--muted-foreground)" }}
          />
          <YAxis
            width={48}
            tickLine={false}
            axisLine={false}
            tickFormatter={(v: number) => compact.format(v)}
            tick={{ fontSize: 11, fill: "var(--muted-foreground)" }}
          />
          <Tooltip
            cursor={{ fill: "var(--muted)", fillOpacity: 0.6 }}
            formatter={(value) => formatDZD(Number(value), locale)}
            contentStyle={{
              background: "var(--popover)",
              border: "1px solid var(--border)",
              borderRadius: 10,
              color: "var(--popover-foreground)",
              fontSize: 12,
            }}
          />
          <Legend
            wrapperStyle={{ fontSize: 12, color: "var(--muted-foreground)" }}
            iconType="circle"
            iconSize={8}
          />
          <Bar
            dataKey="income"
            name={incomeLabel}
            fill="var(--income)"
            radius={[6, 6, 0, 0]}
            maxBarSize={28}
          />
          <Bar
            dataKey="expense"
            name={expenseLabel}
            fill="var(--expense)"
            radius={[6, 6, 0, 0]}
            maxBarSize={28}
          />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
