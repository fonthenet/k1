"use client";

import { Cell, Pie, PieChart, ResponsiveContainer, Tooltip } from "recharts";
import { formatDZD } from "@/lib/format";

export interface DonutSlice {
  name: string;
  value: number;
  color: string;
}

/** Expense breakdown by category — colors come from kg_txn_categories.color. */
export function CategoryDonut({ data, locale }: { data: DonutSlice[]; locale: string }) {
  const total = data.reduce((s, d) => s + d.value, 0);
  const intlLocale = locale === "ar" ? "ar-DZ" : "fr-DZ";
  const pctFmt = new Intl.NumberFormat(intlLocale, {
    style: "percent",
    maximumFractionDigits: 0,
  });
  const compactFmt = new Intl.NumberFormat(intlLocale, {
    notation: "compact",
    maximumFractionDigits: 1,
  });

  return (
    <div className="flex flex-col items-center gap-5 sm:flex-row">
      <div dir="ltr" className="relative h-52 w-52 shrink-0">
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Tooltip
              formatter={(value) => formatDZD(Number(value), locale)}
              contentStyle={{
                background: "var(--popover)",
                border: "1px solid var(--border)",
                borderRadius: 10,
                color: "var(--popover-foreground)",
                fontSize: 12,
              }}
            />
            <Pie
              data={data}
              dataKey="value"
              nameKey="name"
              innerRadius={58}
              outerRadius={85}
              paddingAngle={2}
              stroke="var(--card)"
              strokeWidth={2}
            >
              {data.map((slice, i) => (
                <Cell key={i} fill={slice.color} />
              ))}
            </Pie>
          </PieChart>
        </ResponsiveContainer>
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
          <span className="text-lg font-bold tabular-nums text-foreground">
            {compactFmt.format(total)}
          </span>
        </div>
      </div>
      <ul className="w-full min-w-0 flex-1 space-y-0.5">
        {data.map((slice, i) => (
          <li
            key={i}
            className="flex items-center gap-2.5 rounded-lg px-2 py-1.5 text-sm transition-colors hover:bg-muted/60"
          >
            <span
              className="size-2.5 shrink-0 rounded-full"
              style={{ backgroundColor: slice.color }}
            />
            <span className="min-w-0 flex-1 truncate">{slice.name}</span>
            <span className="tabular-nums text-muted-foreground">
              {total > 0 ? pctFmt.format(slice.value / total) : "—"}
            </span>
            <span className="w-24 text-end font-semibold tabular-nums">
              {formatDZD(slice.value, locale)}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
