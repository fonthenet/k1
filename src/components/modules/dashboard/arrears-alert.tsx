// The unpaid-fees alert that opens the dashboard for finance roles.
//
// Deliberately finance-only (the caller gates on `ctx.isFinance`): an educator
// has no business knowing which families are behind, because that is how a child
// ends up treated differently at the door. It renders nothing at all when no
// family is late — an empty "0 DA owed" card would just train people to skip it.

import Link from "next/link";
import { getLocale, getTranslations } from "next-intl/server";
import { BanknoteX, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { formatDZD } from "@/lib/format";
import { lateFamilies, type ArrearsFamily } from "./arrears-data";

export async function ArrearsAlert({ rows }: { rows: ArrearsFamily[] }) {
  const late = lateFamilies(rows);
  if (late.length === 0) return null;

  const [t, locale] = await Promise.all([getTranslations("dashboard"), getLocale()]);

  const total = late.reduce((sum, r) => sum + r.outstanding, 0);
  const oldestDays = late.reduce((max, r) => Math.max(max, r.daysOverdue), 0);
  // The RPC orders by oldest due date, so the worst case is the first row.
  const oldestFamily = late.find((r) => r.daysOverdue === oldestDays) ?? late[0];

  return (
    /* A plain card. The alert used to be a pink field inside a red ring with
       a red icon tile and a red button — five reds for one number, which
       makes the number itself no louder than its frame. The amount owed is
       the only thing here that is actually red. */
    <Card className="@container/arrears py-3 shadow-sm">
      {/* One line on a wide screen. The two figures sit beside the headline
          rather than under it — this is a glance-at-it alert, and a paragraph
          of advice is read once and then costs vertical space every day after. */}
      <CardContent className="flex flex-col gap-3 px-4 @2xl/arrears:flex-row @2xl/arrears:items-center @2xl/arrears:gap-5">
        <BanknoteX className="size-5 shrink-0 text-destructive" aria-hidden />

        <div className="flex min-w-0 flex-1 flex-wrap items-baseline gap-x-5 gap-y-1">
          <h2 className="text-sm font-semibold text-foreground">
            {t("arrears.title", { count: late.length })}
          </h2>
          <p className="flex flex-wrap items-baseline gap-x-1.5 text-sm">
            <span className="font-bold tabular-nums text-destructive">
              {formatDZD(total, locale)}
            </span>
            <span className="text-muted-foreground">{t("arrears.outstanding").toLowerCase()}</span>
          </p>
          <p className="flex flex-wrap items-baseline gap-x-1.5 text-sm">
            <span className="font-bold tabular-nums text-foreground">
              {t("arrears.days", { count: oldestDays })}
            </span>
            <span className="text-muted-foreground">
              {oldestFamily.childName
                ? t("arrears.oldestFamily", { name: oldestFamily.childName })
                : t("arrears.oldest").toLowerCase()}
            </span>
          </p>
        </div>

        <Button asChild variant="outline" size="sm" className="w-full @2xl/arrears:w-auto">
          <Link href="/billing/arrears">
            {t("arrears.cta")}
            <ChevronRight data-icon="inline-end" className="rtl:-scale-x-100" />
          </Link>
        </Button>
      </CardContent>
    </Card>
  );
}
