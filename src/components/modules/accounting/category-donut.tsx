"use client";

import { Cell, Pie, PieChart, ResponsiveContainer, Tooltip } from "recharts";
import { formatDZD, groupWithSpace, intlLocale } from "@/lib/format";

export interface DonutSlice {
  name: string;
  value: number;
  color: string;
}

/** Expense breakdown by category — colors come from kg_txn_categories.color. */
export function CategoryDonut({
  data,
  locale,
}: {
  data: DonutSlice[];
  locale: string;
}) {
  const total = data.reduce((s, d) => s + d.value, 0);
  const dateLocale = intlLocale(locale);
  const pctFmt = new Intl.NumberFormat(dateLocale, {
    style: "percent",
    maximumFractionDigits: 0,
  });
  // The centre says the month's total the way the cards above say theirs:
  // the full figure, grouped, with the dinar under it. Compact notation gave
  // "198,1 ألف" here, a form nobody writes on a ledger and one that reads
  // backwards next to a French legend. The currency is a second, muted line
  // rather than a suffix: "198 050 دج" on one line outgrows the ring's hole
  // at six digits, and the owner read the bare figure as "198 050 what?".
  const currency = locale === "ar" ? "دج" : "DA";

  return (
    // Side by side only when the CARD is wide enough for a legend row to
    // keep its names: in the two-column overview at 1360 the card is 480px,
    // and a 220px legend beside the ring cut "Alimentation" to "Alime…".
    // The container query asks the card, not the viewport.
    <div className="@container">
      <div className="flex flex-col items-center gap-5 @lg:flex-row">
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
          <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center leading-tight">
            <span
              className="text-lg font-bold tabular-nums text-foreground"
              dir="ltr"
            >
              {groupWithSpace(total)}
            </span>
            <span className="text-xs font-medium text-muted-foreground">{currency}</span>
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
              {/* Category names are the director's own words, French or Arabic
                in either interface: bdi keeps a French name reading forwards
                on an Arabic row and ellipsises it at its own end. */}
              <bdi
                dir="auto"
                className="block min-w-0 flex-1 truncate text-start"
              >
                {slice.name}
              </bdi>
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
    </div>
  );
}
