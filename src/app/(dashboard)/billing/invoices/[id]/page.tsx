import Link from "next/link";
import { getLocale, getTranslations } from "next-intl/server";
import { ArrowLeft, ArrowRight, FileQuestion, Phone, ReceiptText } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { ChildLink } from "@/components/shared/entity-link";
import { EmptyState } from "@/components/shared/empty-state";
import { PageHeader } from "@/components/shared/page-header";
import { createClient } from "@/lib/supabase/server";
import { requireFinance } from "@/lib/tenant";
import { childDisplayName, formatDZD, formatDate, formatPhone, telHref } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { InvoiceStatus, PaymentMethod, Relationship } from "@/lib/types";
import { RecordPaymentDialog } from "@/components/modules/billing/record-payment-dialog";
import { VoidInvoiceButton } from "@/components/modules/billing/void-invoice-button";
import { EmptyIcon } from "@/components/modules/billing/finance-ui";
import { algiersToday, monthLabel } from "@/components/modules/billing/dates";
import {
  displayInvoiceNumber,
  effectiveStatus,
  INVOICE_STATUS_BADGE,
  ITEM_KINDS,
} from "@/components/modules/billing/maps";

type InvoiceRow = {
  id: string;
  child_id: string;
  number: number;
  period_month: string | null;
  issue_date: string;
  due_date: string | null;
  status: InvoiceStatus;
  subtotal: number;
  discount: number;
  total: number;
  paid_amount: number;
  notes: string | null;
  kg_children: {
    id: string;
    first_name: string;
    last_name: string;
    first_name_ar: string | null;
    last_name_ar: string | null;
    kg_classes: { name: string; name_ar: string | null } | null;
  } | null;
};

type ItemRow = {
  id: string;
  kind: string;
  description: string;
  qty: number;
  unit_amount: number;
  amount: number;
};

type PaymentRow = {
  id: string;
  amount: number;
  method: PaymentMethod;
  reference: string | null;
  receipt_number: string | null;
  paid_at: string;
};

type GuardianLink = {
  is_primary: boolean;
  is_financial: boolean;
  kg_guardians: {
    first_name: string;
    last_name: string;
    first_name_ar: string | null;
    last_name_ar: string | null;
    relationship: Relationship;
    phone: string;
  } | null;
};

const KNOWN_KINDS: readonly string[] = ITEM_KINDS;

export default async function InvoiceDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const ctx = await requireFinance();
  const t = await getTranslations("billing");
  const locale = await getLocale();
  const supabase = await createClient();

  const { data: invRow, error } = await supabase
    .from("kg_invoices")
    .select(
      "id, child_id, number, period_month, issue_date, due_date, status, subtotal, discount, total, paid_amount, notes, kg_children(id, first_name, last_name, first_name_ar, last_name_ar, kg_classes(name, name_ar))"
    )
    .eq("id", id)
    .eq("tenant_id", ctx.tenant.id)
    .maybeSingle();
  if (error) throw new Error(error.message);

  const inv = invRow as unknown as InvoiceRow | null;
  if (!inv) {
    return (
      <div>
        <PageHeader title={t("invoice.notFound")} />
        <EmptyState
          icon={
            <EmptyIcon tone="muted">
              <FileQuestion />
            </EmptyIcon>
          }
          title={t("invoice.notFound")}
          description={t("invoice.notFoundHint")}
          action={
            <Button asChild>
              <Link href="/billing">{t("invoice.back")}</Link>
            </Button>
          }
        />
      </div>
    );
  }

  const [{ data: itemRows }, { data: payRows }, { data: guardianRows }] = await Promise.all([
    supabase
      .from("kg_invoice_items")
      .select("id, kind, description, qty, unit_amount, amount")
      .eq("invoice_id", inv.id)
      .eq("tenant_id", ctx.tenant.id),
    supabase
      .from("kg_payments")
      .select("id, amount, method, reference, receipt_number, paid_at")
      .eq("invoice_id", inv.id)
      .eq("tenant_id", ctx.tenant.id)
      .order("paid_at", { ascending: false }),
    supabase
      .from("kg_child_guardians")
      .select(
        "is_primary, is_financial, kg_guardians(first_name, last_name, first_name_ar, last_name_ar, relationship, phone)"
      )
      .eq("child_id", inv.child_id),
  ]);

  const items = (itemRows ?? []) as ItemRow[];
  const payments = (payRows ?? []) as PaymentRow[];
  const guardians = ((guardianRows ?? []) as unknown as GuardianLink[])
    .filter((g) => g.kg_guardians !== null)
    .sort(
      (a, b) =>
        Number(b.is_financial) - Number(a.is_financial) ||
        Number(b.is_primary) - Number(a.is_primary)
    );

  const today = algiersToday();
  const shown = effectiveStatus(inv, today);
  const numberLabel = displayInvoiceNumber(inv.issue_date, inv.number);
  const balance = Number(inv.total) - Number(inv.paid_amount);
  const childName = inv.kg_children ? childDisplayName(inv.kg_children, locale) : "—";
  const cls = inv.kg_children?.kg_classes;
  const payable = shown !== "paid" && shown !== "void" && balance > 0;
  const settled = balance <= 0;
  const BackIcon = locale === "ar" ? ArrowRight : ArrowLeft;

  return (
    <div>
      <PageHeader title={numberLabel} description={childName}>
        <Badge className={INVOICE_STATUS_BADGE[shown]}>{t(`status.${shown}`)}</Badge>
        <Button variant="ghost" asChild>
          <Link href="/billing">
            <BackIcon data-icon="inline-start" />
            {t("invoice.back")}
          </Link>
        </Button>
        {/* Always rendered — see the `payable` prop's note. */}
        <RecordPaymentDialog
          payable={payable}
          invoice={{ id: inv.id, numberLabel, childName, balance }}
        />
        {ctx.isAdmin && inv.status !== "void" && <VoidInvoiceButton invoiceId={inv.id} />}
      </PageHeader>

      <p className="mb-6 -mt-3 text-sm text-muted-foreground">
        {t("invoice.issuedOn", { date: formatDate(inv.issue_date, locale) })}
        {inv.due_date && <> · {t("invoice.dueOn", { date: formatDate(inv.due_date, locale) })}</>}
        {inv.period_month && (
          <> · {t("invoice.period", { month: monthLabel(inv.period_month.slice(0, 7), locale) })}</>
        )}
      </p>

      <div className="grid gap-5 lg:grid-cols-3">
        <div className="space-y-5 lg:col-span-2">
          <Card className="gap-0 overflow-hidden py-0 shadow-sm">
            <CardHeader className="border-b border-border pt-5 pb-4">
              <CardTitle className="text-base font-semibold">{t("invoice.itemsTitle")}</CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader className="bg-muted/40 [&_th]:text-xs [&_th]:font-semibold [&_th]:text-muted-foreground">
                    <TableRow>
                      <TableHead className="ps-4">{t("invoice.itemsColumns.kind")}</TableHead>
                      <TableHead>{t("invoice.itemsColumns.description")}</TableHead>
                      <TableHead className="text-end">{t("invoice.itemsColumns.qty")}</TableHead>
                      <TableHead className="text-end">{t("invoice.itemsColumns.unit")}</TableHead>
                      <TableHead className="pe-4 text-end">
                        {t("invoice.itemsColumns.amount")}
                      </TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {items.map((it) => (
                      <TableRow key={it.id} className="h-12">
                        <TableCell className="ps-4">
                          <Badge className="border-transparent bg-primary/10 text-primary">
                            {KNOWN_KINDS.includes(it.kind)
                              ? t(`kinds.${it.kind as (typeof ITEM_KINDS)[number]}`)
                              : it.kind}
                          </Badge>
                        </TableCell>
                        <TableCell className="font-medium">{it.description}</TableCell>
                        <TableCell className="text-end tabular-nums text-muted-foreground">
                          {Number(it.qty)}
                        </TableCell>
                        <TableCell className="text-end tabular-nums text-muted-foreground">
                          {formatDZD(it.unit_amount, locale)}
                        </TableCell>
                        <TableCell className="pe-4 text-end font-semibold tabular-nums">
                          {formatDZD(it.amount, locale)}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </CardContent>
          </Card>

          <Card className="gap-0 overflow-hidden py-0 shadow-sm">
            <CardHeader className="border-b border-border pt-5 pb-4">
              <CardTitle className="text-base font-semibold">
                {t("invoice.paymentsTitle")}
              </CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              {payments.length === 0 ? (
                <p className="px-5 py-6 text-sm text-muted-foreground">
                  {t("invoice.noPayments")}
                </p>
              ) : (
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader className="bg-muted/40 [&_th]:text-xs [&_th]:font-semibold [&_th]:text-muted-foreground">
                      <TableRow>
                        <TableHead className="ps-4">
                          {t("invoice.paymentsColumns.receipt")}
                        </TableHead>
                        <TableHead>{t("invoice.paymentsColumns.date")}</TableHead>
                        <TableHead className="text-end">
                          {t("invoice.paymentsColumns.amount")}
                        </TableHead>
                        <TableHead>{t("invoice.paymentsColumns.method")}</TableHead>
                        <TableHead className="pe-4">
                          {t("invoice.paymentsColumns.reference")}
                        </TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {payments.map((p) => (
                        <TableRow key={p.id} className="h-12">
                          <TableCell className="ps-4 font-medium">
                            <Link
                              href={`/billing/receipts/${p.id}`}
                              className="inline-flex items-center gap-2 hover:text-primary hover:underline"
                            >
                              <ReceiptText className="size-4 text-primary" />
                              {p.receipt_number ?? "—"}
                            </Link>
                          </TableCell>
                          <TableCell className="text-muted-foreground">
                            {formatDate(p.paid_at, locale)}
                          </TableCell>
                          <TableCell className="text-end font-semibold tabular-nums text-income">
                            {formatDZD(p.amount, locale)}
                          </TableCell>
                          <TableCell>{t(`methods.${p.method}`)}</TableCell>
                          <TableCell className="pe-4 text-muted-foreground">
                            {p.reference ?? "—"}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              )}
            </CardContent>
          </Card>
        </div>

        <div className="space-y-5">
          <Card className="gap-0 py-0 shadow-sm">
            <CardHeader className="border-b border-border pt-5 pb-4">
              <CardTitle className="text-base font-semibold">{t("invoice.totalsTitle")}</CardTitle>
            </CardHeader>
            <CardContent className="p-5 text-sm">
              <div className="space-y-2.5">
                <div className="flex justify-between">
                  <span className="text-muted-foreground">{t("invoice.totals.subtotal")}</span>
                  <span className="tabular-nums">{formatDZD(inv.subtotal, locale)}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">{t("invoice.totals.discount")}</span>
                  <span className="tabular-nums">− {formatDZD(inv.discount, locale)}</span>
                </div>
                <Separator />
                <div className="flex justify-between text-base font-semibold">
                  <span>{t("invoice.totals.total")}</span>
                  <span className="tabular-nums">{formatDZD(inv.total, locale)}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">{t("invoice.totals.paid")}</span>
                  <span className="font-medium tabular-nums text-income">
                    {formatDZD(inv.paid_amount, locale)}
                  </span>
                </div>
              </div>

              <div
                className={cn(
                  "mt-4 flex items-center justify-between gap-3 rounded-xl px-4 py-3",
                  settled ? "bg-success/10" : "bg-destructive/10"
                )}
              >
                <span className="font-medium">{t("invoice.totals.balance")}</span>
                <span
                  className={cn(
                    "text-xl font-bold tabular-nums",
                    settled ? "text-success" : "text-destructive"
                  )}
                >
                  {formatDZD(balance, locale)}
                </span>
              </div>
            </CardContent>
          </Card>

          <Card className="gap-0 py-0 shadow-sm">
            <CardHeader className="border-b border-border pt-5 pb-4">
              <CardTitle className="text-base font-semibold">{t("invoice.childCard")}</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4 p-5 text-sm">
              <div>
                <div className="font-semibold">
                  {inv.kg_children ? (
                    <ChildLink id={inv.child_id}>{childName}</ChildLink>
                  ) : (
                    childName
                  )}
                </div>
                {cls && (
                  <div className="text-muted-foreground">
                    {locale === "ar" && cls.name_ar ? cls.name_ar : cls.name}
                  </div>
                )}
              </div>
              <Separator />
              <div>
                <div className="mb-2 text-xs font-semibold text-muted-foreground">
                  {t("invoice.guardians")}
                </div>
                {guardians.length === 0 ? (
                  <p className="text-muted-foreground">{t("invoice.noGuardians")}</p>
                ) : (
                  <ul className="space-y-2">
                    {guardians.map((g, i) => {
                      const guardian = g.kg_guardians;
                      if (!guardian) return null;
                      return (
                        <li
                          key={i}
                          className="flex items-center justify-between gap-2 rounded-lg bg-muted/40 p-2 ps-3"
                        >
                          <div className="min-w-0">
                            <div className="truncate font-medium">
                              {childDisplayName(guardian, locale)}
                            </div>
                            <div className="text-xs text-muted-foreground">
                              {t(`invoice.relationships.${guardian.relationship}`)}
                            </div>
                          </div>
                          <Button variant="outline" size="sm" asChild>
                            <a href={telHref(guardian.phone)} dir="ltr">
                              <Phone data-icon="inline-start" />
                              {formatPhone(guardian.phone)}
                            </a>
                          </Button>
                        </li>
                      );
                    })}
                  </ul>
                )}
              </div>
              {inv.notes && (
                <>
                  <Separator />
                  <p className="rounded-lg bg-muted/40 p-3 text-muted-foreground">{inv.notes}</p>
                </>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
