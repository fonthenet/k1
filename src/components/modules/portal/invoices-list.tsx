"use client";

import { Fragment, useState } from "react";
import Link from "next/link";
import { useLocale, useTranslations } from "next-intl";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { initialsFromName, intlLocale } from "@/lib/format";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Card, CardContent } from "@/components/ui/card";
import { PortalChildLink } from "@/components/shared/entity-link";
import { StatusPill, type StatusTone } from "@/components/shared/status-pill";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { formatDate, formatDZD } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { PortalChildInvoices, PortalInvoice } from "./portal-types";

function monthLabel(periodMonth: string | null, locale: string): string | null {
  if (!periodMonth) return null;
  return new Intl.DateTimeFormat(intlLocale(locale), {
    month: "long",
    year: "numeric",
  }).format(new Date(`${periodMonth.slice(0, 7)}-01T12:00:00`));
}

/**
 * The one mark on an invoice row, by what it means to the family. Late is
 * judged against the calendar as well as the status column, because the
 * column only flips when the nightly job runs and a parent reads "late" the
 * morning after the date, not the morning after the cron. Paid renders
 * nothing: the expected state carries no pill.
 */
function invoicePill(
  inv: PortalInvoice,
  today: string
): { tone: StatusTone; key: "overdue" | "unpaid" | "partial" | "void" } | null {
  if (inv.status === "void") return { tone: "muted", key: "void" };
  if (inv.balance <= 0) return null;
  if (inv.status === "overdue" || (inv.due_date != null && inv.due_date < today)) {
    return { tone: "danger", key: "overdue" };
  }
  if (inv.status === "partial" || inv.paid_amount > 0) return { tone: "attention", key: "partial" };
  if (inv.status === "unpaid" || inv.status === "sent") return { tone: "attention", key: "unpaid" };
  return null;
}

export function InvoicesList({
  groups,
  today,
}: {
  groups: PortalChildInvoices[];
  /** Algiers "today" from the server — the client clock is never consulted. */
  today: string;
}) {
  const t = useTranslations("portal.payments");
  const locale = useLocale();
  const [selected, setSelected] = useState<{ invoice: PortalInvoice; childName: string } | null>(null);
  const Chevron = locale === "ar" ? ChevronLeft : ChevronRight;

  return (
    <>
      {/* One register for the family, the children as group rows inside it —
          never a card per child. A card per child stacked two headers, two
          "up to date" pills and two chevron columns over what is one list of
          bills, and the figure a parent came for was printed four times. */}
      <Card className="border border-border py-0 shadow-sm ring-0">
        <CardContent className="px-0">
          <ul className="divide-y divide-border">
            {groups.map((group) => {
              // The subtotal only when it is genuinely one: with a single open
              // invoice the row underneath already states this exact figure.
              const openCount = group.invoices.filter((i) => i.balance > 0).length;
              return (
                <Fragment key={group.childId}>
                  <li className="bg-muted/30 px-5 py-1.5 text-xs">
                    <span className="flex items-center gap-2">
                      <Avatar className="size-6 shrink-0">
                        {group.photoUrl && <AvatarImage src={group.photoUrl} alt="" />}
                        <AvatarFallback className="bg-primary/10 text-[10px] font-semibold text-primary">
                          {initialsFromName(group.childName) || "?"}
                        </AvatarFallback>
                      </Avatar>
                      <PortalChildLink id={group.childId} className="min-w-0 truncate font-semibold">
                        <bdi dir="auto">{group.childName}</bdi>
                      </PortalChildLink>
                      {openCount > 1 && (
                        <span className="ms-auto shrink-0 font-semibold tabular-nums text-foreground">
                          {formatDZD(group.balance, locale)}
                        </span>
                      )}
                    </span>
                  </li>
                  {group.invoices.length === 0 ? (
                    <li className="px-5 py-4 text-sm text-muted-foreground">{t("emptyChild")}</li>
                  ) : (
                    group.invoices.map((inv) => {
                      const pill = invoicePill(inv, today);
                      const partlyPaid = inv.paid_amount > 0 && inv.balance > 0;
                      return (
                        <li key={inv.id}>
                          <button
                            type="button"
                            onClick={() => setSelected({ invoice: inv, childName: group.childName })}
                            className="flex min-h-14 w-full items-center gap-3 px-5 py-3 text-start transition-colors hover:bg-primary/5"
                          >
                            <span className="min-w-0 flex-1">
                              <span className="flex items-baseline gap-2">
                                <span className="min-w-0 flex-1 truncate text-sm font-medium">
                                  {monthLabel(inv.period_month, locale) ?? t("invoice")}
                                </span>
                                <span className="shrink-0 text-sm font-medium tabular-nums">
                                  {formatDZD(inv.total, locale)}
                                </span>
                              </span>
                              <span className="flex items-center gap-2 text-xs text-muted-foreground">
                                <span className="min-w-0 flex-1 truncate">
                                  <span className="font-mono" dir="ltr">#{inv.number}</span>
                                  <span aria-hidden> · </span>
                                  <span className="tabular-nums">{formatDate(inv.issue_date, locale)}</span>
                                </span>
                                {/* Nothing paid yet means the balance IS the
                                    total — saying it again adds nothing. */}
                                {partlyPaid && (
                                  <span className="shrink-0 tabular-nums">
                                    {t("balanceShort")} {formatDZD(inv.balance, locale)}
                                  </span>
                                )}
                                {pill && (
                                  <StatusPill tone={pill.tone} className="shrink-0">
                                    {t(`statuses.${pill.key}`)}
                                  </StatusPill>
                                )}
                              </span>
                            </span>
                            <Chevron className="size-4 shrink-0 text-muted-foreground" aria-hidden />
                          </button>
                        </li>
                      );
                    })
                  )}
                </Fragment>
              );
            })}
          </ul>
        </CardContent>
      </Card>
      {/* The invoice itself, as the bill it is: a divide-y list of lines with
          the total as its bold last row, the payments as a second list of
          the same shape. Same mark as the row that opened it — the pill from
          invoicePill — so the sheet can never say "unpaid" over a row that
          said "late". Money is red only when it is late, once, on the
          balance; a paid amount is a plain number, not a green one. */}
      <Sheet open={selected !== null} onOpenChange={(open) => !open && setSelected(null)}>
        <SheetContent side="bottom" className="mx-auto max-h-[85dvh] w-full max-w-lg overflow-y-auto rounded-t-2xl">
          {selected && (() => {
            const inv = selected.invoice;
            const pill = invoicePill(inv, today);
            const period = monthLabel(inv.period_month, locale);
            return (
              <>
                <SheetHeader>
                  <SheetTitle className="flex flex-wrap items-center gap-2">
                    <span>
                      {t("invoice")} <span className="font-mono" dir="ltr">#{inv.number}</span>
                    </span>
                    {pill && <StatusPill tone={pill.tone}>{t(`statuses.${pill.key}`)}</StatusPill>}
                  </SheetTitle>
                  <SheetDescription>
                    <bdi dir="auto">{selected.childName}</bdi>
                    {period ? ` — ${period}` : ""}
                  </SheetDescription>
                </SheetHeader>

                <div className="grid gap-5 px-4 pb-6">
                  <section>
                    <h4 className="mb-1 text-sm text-muted-foreground">{t("detail.items")}</h4>
                    <ul className="divide-y divide-border text-sm">
                      {inv.items.length === 0 ? (
                        <li className="py-2 text-muted-foreground">—</li>
                      ) : (
                        inv.items.map((item) => (
                          <li key={item.id} className="flex items-baseline gap-3 py-2">
                            <span className="min-w-0 flex-1">
                              <bdi dir="auto">{item.description}</bdi>
                              {item.qty !== 1 && (
                                <span className="text-muted-foreground tabular-nums" dir="ltr">
                                  {" "}× {item.qty}
                                </span>
                              )}
                            </span>
                            <span className="shrink-0 text-end tabular-nums">
                              {formatDZD(item.amount, locale)}
                            </span>
                          </li>
                        ))
                      )}
                      <li className="flex items-baseline gap-3 py-2 font-semibold">
                        <span className="flex-1">{t("total")}</span>
                        <span className="shrink-0 text-end tabular-nums">{formatDZD(inv.total, locale)}</span>
                      </li>
                      {/* Nothing paid yet means the balance IS the total, and
                          two more rows would only say it again. */}
                      {inv.paid_amount > 0 && (
                        <>
                          <li className="flex items-baseline gap-3 py-2 text-muted-foreground">
                            <span className="flex-1">{t("paid")}</span>
                            <span className="shrink-0 text-end tabular-nums">
                              {formatDZD(inv.paid_amount, locale)}
                            </span>
                          </li>
                          {inv.balance > 0 && (
                            <li
                              className={cn(
                                "flex items-baseline gap-3 py-2 font-semibold",
                                pill?.key === "overdue" && "text-destructive"
                              )}
                            >
                              <span className="flex-1">{t("balance")}</span>
                              <span className="shrink-0 text-end tabular-nums">
                                {formatDZD(inv.balance, locale)}
                              </span>
                            </li>
                          )}
                        </>
                      )}
                    </ul>
                  </section>

                  <section>
                    <h4 className="mb-1 text-sm text-muted-foreground">{t("detail.payments")}</h4>
                    {inv.payments.length === 0 ? (
                      <p className="py-2 text-sm text-muted-foreground">{t("detail.noPayments")}</p>
                    ) : (
                      <ul className="divide-y divide-border text-sm">
                        {inv.payments.map((p) => (
                          <li key={p.id} className="flex items-center gap-3 py-2">
                            <span className="min-w-0 flex-1">
                              <span className="block tabular-nums">{formatDate(p.paid_at, locale)}</span>
                              <span className="block text-xs text-muted-foreground">
                                {t(`detail.methods.${p.method}`)}
                                {p.receipt_number && (
                                  <>
                                    <span aria-hidden> · </span>
                                    {/* The number opens the family's copy of
                                        the receipt — the sheet the office
                                        printed, lines and balance included. */}
                                    <Link
                                      href={`/portal/payments/receipts/${p.id}`}
                                      className="font-mono text-primary underline-offset-2 hover:underline"
                                      dir="ltr"
                                    >
                                      {p.receipt_number}
                                    </Link>
                                  </>
                                )}
                              </span>
                            </span>
                            <span className="shrink-0 text-end tabular-nums">
                              {formatDZD(p.amount, locale)}
                            </span>
                          </li>
                        ))}
                      </ul>
                    )}
                  </section>
                </div>
              </>
            );
          })()}
        </SheetContent>
      </Sheet>
    </>
  );
}
