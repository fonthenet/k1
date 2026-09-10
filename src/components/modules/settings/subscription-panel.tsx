"use client";

import { useLocale, useTranslations } from "next-intl";
import Link from "next/link";
import {
  AlertTriangleIcon,
  CheckCircle2Icon,
  ClockIcon,
  PrinterIcon,
  ReceiptTextIcon,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { formatDZD, formatDate } from "@/lib/format";
import { algiersToday } from "@/lib/algiers";
import { cn } from "@/lib/utils";

export type SubscriptionStatus =
  | "trialing" | "active" | "past_due" | "suspended" | "cancelled";

export interface SubscriptionView {
  status: SubscriptionStatus;
  planName: string | null;
  planNameAr: string | null;
  priceMonthly: number | null;
  trialEndsAt: string | null;
  currentPeriodEnd: string | null;
  /** Active structures by name — each is a structure and each is billed (0136). */
  structures: { id: string; name: string }[];
}

export interface PlatformInvoiceView {
  id: string;
  number: number | null;
  /** Wings billed for that month, frozen at issue. */
  quantity: number;
  periodStart: string;
  periodEnd: string;
  amount: number;
  status: "unpaid" | "paid" | "void";
  dueDate: string;
  paidAt: string | null;
}

/**
 * What this crèche owes Rawdatik.
 *
 * Deliberately the same shape as the billing page the crèche shows its own
 * families: an amount, a date it is due, and how to pay. There is no card
 * button because there is no Stripe in Algeria — subscriptions are settled by
 * virement or CCP and confirmed by the platform, exactly as the crèche settles
 * its own parents' fees in cash and hands back a numbered receipt.
 */
export function SubscriptionPanel({
  subscription,
  invoices,
  payTo,
}: {
  subscription: SubscriptionView | null;
  invoices: PlatformInvoiceView[];
  /** Where to send the money — the platform's own bank / CCP details. */
  payTo: string | null;
}) {
  const t = useTranslations("settings");
  const locale = useLocale();

  if (!subscription) {
    return (
      <Alert>
        <AlertTriangleIcon />
        <AlertTitle>{t("subscription.none")}</AlertTitle>
        <AlertDescription>{t("subscription.noneHint")}</AlertDescription>
      </Alert>
    );
  }

  const planName =
    locale === "ar" && subscription.planNameAr
      ? subscription.planNameAr
      : (subscription.planName ?? "—");

  const TONE: Record<SubscriptionStatus, string> = {
    trialing: "bg-primary/10 text-primary",
    active: "bg-success/15 text-success",
    past_due: "bg-gold/20 text-gold-ink",
    suspended: "bg-destructive/15 text-destructive",
    cancelled: "bg-muted text-muted-foreground",
  };

  // What they will actually be charged, not the unit price. A building
  // running a crèche and a jardin is two structures on a price list that says
  // "flat per structure", and quoting 9 900 to someone who owes 19 800 is the
  // kind of surprise that ends a subscription.
  const unit = subscription.priceMonthly ?? 0;
  const structures = Math.max(1, subscription.structures.length);
  const monthlyTotal = unit * structures;

  /**
   * Whether what they will pay next has drifted from what they were last
   * billed. Adding or retiring a structure changes the subscription immediately and
   * the ISSUED invoice not at all — correctly, since an invoice is a statement
   * about a month that already happened. Without saying so, the two numbers
   * on this page contradict each other and the honest one looks like the bug.
   */
  const lastIssued = invoices[0] ?? null;
  const changed = lastIssued != null && lastIssued.quantity !== structures;

  const outstanding = invoices.filter((i) => i.status === "unpaid");
  const owed = outstanding.reduce((n, i) => n + i.amount, 0);

  /**
   * Days left, counted on the Algiers calendar.
   *
   * A date on its own ("10 oct.") makes the reader do the arithmetic, and a
   * trial is the one number they actually want: nobody plans around a date,
   * they plan around "I have nine days". Counted from trial_ends_at rather
   * than from a hard-coded length, so changing the offer changes this by
   * itself.
   */
  const daysLeft =
    subscription.status === "trialing" && subscription.trialEndsAt
      ? Math.max(
          0,
          Math.round(
            (new Date(`${subscription.trialEndsAt}T00:00:00`).getTime() -
              new Date(`${algiersToday()}T00:00:00`).getTime()) /
              86_400_000
          )
        )
      : null;
  /** Under a week is when a director needs to be doing something about it. */
  const trialUrgent = daysLeft !== null && daysLeft <= 7;

  return (
    <div className="space-y-6">
      {/* The one sentence that matters, before any table. */}
      {subscription.status === "suspended" && (
        <Alert variant="destructive" className="border-destructive/25 bg-destructive/5">
          <AlertTriangleIcon />
          <AlertTitle>{t("subscription.suspendedTitle")}</AlertTitle>
          <AlertDescription>{t("subscription.suspendedBody")}</AlertDescription>
        </Alert>
      )}
      {/* The trial, as a countdown rather than a date on a definition list.
          It is the single fact a director on a trial is looking for. */}
      {daysLeft !== null && (
        <Alert
          className={cn(
            trialUrgent ? "border-gold/30 bg-gold-muted/50" : "border-primary/25 bg-primary/5"
          )}
        >
          <ClockIcon />
          <AlertTitle>
            {daysLeft === 0
              ? t("subscription.trialEndsToday")
              : t("subscription.trialCountdown", { count: daysLeft })}
          </AlertTitle>
          <AlertDescription>
            {t("subscription.trialBody", { amount: formatDZD(monthlyTotal, locale) })}
          </AlertDescription>
        </Alert>
      )}
      {subscription.status === "past_due" && (
        <Alert className="border-gold/30 bg-gold-muted/50">
          <ClockIcon />
          <AlertTitle>{t("subscription.pastDueTitle")}</AlertTitle>
          <AlertDescription>{t("subscription.pastDueBody")}</AlertDescription>
        </Alert>
      )}

      <Card className="border border-border shadow-sm ring-0">
        <CardHeader>
          <CardTitle className="text-base font-semibold">{t("subscription.planTitle")}</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-4">
          <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
            <span className="text-xl font-bold tracking-tight">{planName}</span>
            {subscription.priceMonthly != null && (
              <span className="text-sm text-muted-foreground">
                <span className="font-semibold text-foreground tabular-nums">
                  {formatDZD(monthlyTotal, locale)}
                </span>{" "}
                {t("subscription.perMonth")}
              </span>
            )}
            <Badge className={cn("border-transparent font-medium", TONE[subscription.status])}>
              {t(`subscription.status.${subscription.status}`)}
            </Badge>
          </div>

          {/* The bill, itemised. A director who added a structure this morning
              should be able to see the line it created rather than work back
              from a total. */}
          {structures > 1 && (
            <div className="rounded-xl border border-border">
              <ul className="divide-y divide-border">
                {subscription.structures.map((w) => (
                  <li key={w.id} className="flex items-center gap-3 px-3 py-2 text-sm">
                    <span className="flex-1 truncate">{w.name}</span>
                    <span className="text-muted-foreground tabular-nums">
                      {formatDZD(unit, locale)}
                    </span>
                  </li>
                ))}
              </ul>
              <div className="flex items-center gap-3 border-t border-border px-3 py-2">
                <span className="flex-1 text-sm font-medium">
                  {t("subscription.structuresBilled", { count: structures })}
                </span>
                <span className="font-semibold tabular-nums">
                  {formatDZD(monthlyTotal, locale)}
                </span>
              </div>
            </div>
          )}

          {/* Says WHEN a change lands, so the two figures on this page stop
              looking like a contradiction. */}
          {changed && subscription.currentPeriodEnd && (
            <p className="rounded-lg bg-primary/5 px-3 py-2 text-xs text-muted-foreground">
              {t("subscription.changesFrom", {
                was: lastIssued!.quantity,
                now: structures,
                date: formatDate(subscription.currentPeriodEnd, locale),
                total: formatDZD(monthlyTotal, locale),
              })}
            </p>
          )}

          <dl className="grid gap-3 sm:grid-cols-2">
            {subscription.status === "trialing" && subscription.trialEndsAt && (
              <div>
                <dt className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
                  {t("subscription.trialEnds")}
                </dt>
                <dd className="mt-0.5 tabular-nums">
                  {formatDate(subscription.trialEndsAt, locale)}
                </dd>
              </div>
            )}
            {subscription.currentPeriodEnd && (
              <div>
                <dt className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
                  {t("subscription.nextInvoice")}
                </dt>
                <dd className="mt-0.5 tabular-nums">
                  {formatDate(subscription.currentPeriodEnd, locale)}
                </dd>
              </div>
            )}
          </dl>

          {owed > 0 && (
            <div className="rounded-xl bg-gold-muted/50 p-3 ring-1 ring-gold/25">
              <p className="text-sm text-gold-ink">
                {t("subscription.owed", {
                  amount: formatDZD(owed, locale),
                  count: outstanding.length,
                })}
              </p>
            </div>
          )}

          {/* How to actually pay. Without this the amount is a riddle. */}
          <div className="rounded-xl border border-dashed border-border p-3">
            <p className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
              {t("subscription.howToPay")}
            </p>
            <p className="mt-1.5 text-sm whitespace-pre-line">
              {payTo?.trim() || t("subscription.howToPayFallback")}
            </p>
          </div>
        </CardContent>
      </Card>

      <Card className="border border-border shadow-sm ring-0">
        <CardHeader>
          <CardTitle className="text-base font-semibold">
            {t("subscription.invoicesTitle")}
          </CardTitle>
        </CardHeader>
        <CardContent>
          {invoices.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t("subscription.noInvoices")}</p>
          ) : (
            <ul className="divide-y divide-border">
              {invoices.map((i) => (
                <li key={i.id} className="flex flex-wrap items-center gap-x-4 gap-y-1 py-2.5">
                  <span className="font-mono text-xs text-muted-foreground" dir="ltr">
                    {i.number != null ? `#${i.number}` : "—"}
                  </span>
                  <span className="flex-1 text-sm tabular-nums">
                    {formatDate(i.periodStart, locale)} — {formatDate(i.periodEnd, locale)}
                    {i.quantity > 1 && (
                      <span className="ms-2 text-xs text-muted-foreground">
                        {t("subscription.structuresBilled", { count: i.quantity })}
                      </span>
                    )}
                  </span>
                  <span className="text-sm font-semibold tabular-nums">
                    {formatDZD(i.amount, locale)}
                  </span>
                  <Button asChild variant="ghost" size="sm">
                    <Link href={`/settings/subscription/invoice/${i.id}`}>
                      <PrinterIcon data-icon="inline-start" />
                      {t("subscription.viewInvoice")}
                    </Link>
                  </Button>
                  {i.status === "paid" ? (
                    <Badge className="border-transparent bg-success/15 font-medium text-success">
                      <CheckCircle2Icon data-icon="inline-start" />
                      {t("subscription.invoiceStatus.paid")}
                    </Badge>
                  ) : i.status === "void" ? (
                    <Badge className="border-transparent bg-muted font-medium text-muted-foreground">
                      {t("subscription.invoiceStatus.void")}
                    </Badge>
                  ) : (
                    <Badge className="border-transparent bg-gold/20 font-medium text-gold-ink">
                      <ReceiptTextIcon data-icon="inline-start" />
                      {t("subscription.invoiceStatus.dueOn", {
                        date: formatDate(i.dueDate, locale),
                      })}
                    </Badge>
                  )}
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
