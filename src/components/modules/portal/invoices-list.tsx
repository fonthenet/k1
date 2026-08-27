"use client";

import { useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { ChevronLeft, ChevronRight, Receipt } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { PortalChildLink } from "@/components/shared/entity-link";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { formatDate, formatDZD } from "@/lib/format";
import { invoiceStatusClasses, type PortalChildInvoices, type PortalInvoice } from "./portal-types";

function monthLabel(periodMonth: string | null, locale: string): string | null {
  if (!periodMonth) return null;
  return new Intl.DateTimeFormat(locale === "ar" ? "ar-DZ" : "fr-DZ", {
    month: "long",
    year: "numeric",
  }).format(new Date(`${periodMonth.slice(0, 7)}-01T12:00:00`));
}

export function InvoicesList({ groups }: { groups: PortalChildInvoices[] }) {
  const t = useTranslations("portal.payments");
  const locale = useLocale();
  const [selected, setSelected] = useState<{ invoice: PortalInvoice; childName: string } | null>(null);
  const Chevron = locale === "ar" ? ChevronLeft : ChevronRight;

  return (
    <>
      {groups.map((group) => (
        <Card key={group.childId} className="shadow-sm">
          <CardHeader className="flex flex-row items-center justify-between gap-2">
            <CardTitle className="text-base font-semibold">
              <PortalChildLink id={group.childId}>{group.childName}</PortalChildLink>
            </CardTitle>
            {group.balance > 0 ? (
              <span className="text-end text-sm font-bold text-destructive tabular-nums">
                {t("due")} : {formatDZD(group.balance, locale)}
              </span>
            ) : (
              <Badge className="border border-success/25 bg-success/10 font-semibold text-success">
                {t("upToDate")}
              </Badge>
            )}
          </CardHeader>
          <CardContent className="p-0">
            {group.invoices.length === 0 ? (
              <p className="px-4 pb-4 text-sm text-muted-foreground">{t("emptyChild")}</p>
            ) : (
              <ul className="divide-y">
                {group.invoices.map((inv) => (
                  <li key={inv.id}>
                    <button
                      type="button"
                      onClick={() => setSelected({ invoice: inv, childName: group.childName })}
                      className="flex w-full items-center gap-3 px-4 py-3.5 text-start transition-colors hover:bg-muted/50"
                    >
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="font-mono text-sm font-semibold" dir="ltr">#{inv.number}</span>
                          <Badge className={invoiceStatusClasses(inv.status)}>
                            {t(`statuses.${inv.status}`)}
                          </Badge>
                        </div>
                        <div className="mt-1 text-xs text-muted-foreground">
                          {monthLabel(inv.period_month, locale) ?? formatDate(inv.issue_date, locale)}
                        </div>
                      </div>
                      <div className="text-end">
                        <div className="text-sm font-semibold tabular-nums">
                          {formatDZD(inv.total, locale)}
                        </div>
                        {inv.balance > 0 && (
                          <div className="mt-0.5 text-xs font-medium text-destructive tabular-nums">
                            {t("balanceShort")} {formatDZD(inv.balance, locale)}
                          </div>
                        )}
                      </div>
                      <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-muted text-muted-foreground">
                        <Chevron className="size-4" />
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      ))}

      <Sheet open={selected !== null} onOpenChange={(open) => !open && setSelected(null)}>
        <SheetContent side="bottom" className="mx-auto max-h-[85dvh] w-full max-w-lg overflow-y-auto rounded-t-2xl">
          {selected && (
            <>
              <SheetHeader>
                <SheetTitle className="flex flex-wrap items-center gap-2">
                  <span>
                    {t("invoice")} <span className="font-mono" dir="ltr">#{selected.invoice.number}</span>
                  </span>
                  <Badge className={invoiceStatusClasses(selected.invoice.status)}>
                    {t(`statuses.${selected.invoice.status}`)}
                  </Badge>
                </SheetTitle>
                <SheetDescription>
                  {selected.childName}
                  {monthLabel(selected.invoice.period_month, locale)
                    ? ` — ${monthLabel(selected.invoice.period_month, locale)}`
                    : ""}
                </SheetDescription>
              </SheetHeader>

              <div className="grid gap-4 px-4 pb-6">
                <div>
                  <h4 className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                    {t("detail.items")}
                  </h4>
                  {selected.invoice.items.length === 0 ? (
                    <p className="text-sm text-muted-foreground">—</p>
                  ) : (
                    <ul className="grid gap-1.5">
                      {selected.invoice.items.map((item) => (
                        <li key={item.id} className="flex items-baseline justify-between gap-3 text-sm">
                          <span className="min-w-0">
                            {item.description}
                            {item.qty !== 1 && (
                              <span className="text-muted-foreground tabular-nums"> × {item.qty}</span>
                            )}
                          </span>
                          <span className="shrink-0 text-end font-medium tabular-nums">
                            {formatDZD(item.amount, locale)}
                          </span>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>

                <Separator />

                <div className="grid gap-1.5 rounded-xl bg-muted/50 p-3.5 text-sm">
                  <div className="flex items-baseline justify-between gap-3">
                    <span className="text-muted-foreground">{t("total")}</span>
                    <span className="text-end font-semibold tabular-nums">
                      {formatDZD(selected.invoice.total, locale)}
                    </span>
                  </div>
                  <div className="flex items-baseline justify-between gap-3">
                    <span className="text-muted-foreground">{t("paid")}</span>
                    <span className="text-end font-medium text-income tabular-nums">
                      {formatDZD(selected.invoice.paid_amount, locale)}
                    </span>
                  </div>
                  <Separator className="my-0.5" />
                  <div className="flex items-baseline justify-between gap-3">
                    <span className="font-medium text-foreground">{t("balance")}</span>
                    <span
                      className={
                        selected.invoice.balance > 0
                          ? "text-end text-base font-bold text-destructive tabular-nums"
                          : "text-end text-base font-bold text-success tabular-nums"
                      }
                    >
                      {formatDZD(selected.invoice.balance, locale)}
                    </span>
                  </div>
                </div>

                <Separator />

                <div>
                  <h4 className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                    {t("detail.payments")}
                  </h4>
                  {selected.invoice.payments.length === 0 ? (
                    <p className="text-sm text-muted-foreground">{t("detail.noPayments")}</p>
                  ) : (
                    <ul className="grid gap-2">
                      {selected.invoice.payments.map((p) => (
                        <li key={p.id} className="flex items-center gap-2.5 text-sm">
                          <span
                            aria-hidden
                            className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-success/10 text-success"
                          >
                            <Receipt className="size-4" />
                          </span>
                          <div className="min-w-0 flex-1">
                            <div>{formatDate(p.paid_at, locale)}</div>
                            <div className="text-xs text-muted-foreground">
                              {t(`detail.methods.${p.method}`)}
                              {p.receipt_number && (
                                <span className="font-mono" dir="ltr"> · {p.receipt_number}</span>
                              )}
                            </div>
                          </div>
                          <span className="shrink-0 text-end font-medium text-income tabular-nums">
                            {formatDZD(p.amount, locale)}
                          </span>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              </div>
            </>
          )}
        </SheetContent>
      </Sheet>
    </>
  );
}
