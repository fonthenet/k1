import Link from "next/link";
import { getLocale, getTranslations } from "next-intl/server";
import { AlarmClock, ChevronRight, CircleCheck, Coins, Eye, FileText, Receipt, TriangleAlert } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { EmptyState } from "@/components/shared/empty-state";
import { PageHeader } from "@/components/shared/page-header";
import { createClient } from "@/lib/supabase/server";
import { requireFinance } from "@/lib/tenant";
import { childDisplayName, formatDate, formatDZD } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { InvoiceStatus } from "@/lib/types";
import { GenerateInvoicesButton } from "@/components/modules/billing/generate-invoices-button";
import { NewInvoiceDialog } from "@/components/modules/billing/new-invoice-dialog";
import { RecordPaymentDialog } from "@/components/modules/billing/record-payment-dialog";
import { MonthFilter } from "@/components/modules/billing/month-filter";
import { StatusChips } from "@/components/modules/billing/status-chips";
import { StructureFilter } from "@/components/modules/billing/structure-filter";
import { EmptyIcon, MoneyStat } from "@/components/modules/billing/finance-ui";
import {
  addDays,
  algiersMonth,
  algiersToday,
  INVOICE_DUE_DAY,
  monthLabel,
  monthRange,
  recentMonths,
} from "@/components/modules/billing/dates";
import {
  displayInvoiceNumber,
  effectiveStatus,
  INVOICE_STATUS_BADGE,
} from "@/components/modules/billing/maps";
import { CompleteInvoicesButton } from "@/components/modules/billing/complete-invoices-button";
import { IssueInvoicesButton } from "@/components/modules/billing/issue-invoices-button";
import type { ChildOption, InvoiceGap } from "@/components/modules/billing/billing-types";
import { structureName, type Structure } from "@/components/modules/classes/class-types";

// "draft" is a real state of this list, not an implementation detail: the
// monthly run produces drafts and somebody has to issue them. Without the
// chip the 17 drafts the real client was sitting on had no count anywhere.
const FILTERS = ["all", "draft", "unpaid", "partial", "paid", "overdue", "void"] as const;
type Filter = (typeof FILTERS)[number];

type HubRow = {
  id: string;
  /** Null while a draft — a number is spent only at issue (0047). */
  number: number | null;
  period_month: string | null;
  issue_date: string;
  due_date: string | null;
  status: InvoiceStatus;
  total: number;
  paid_amount: number;
  kg_children: {
    first_name: string;
    last_name: string;
    first_name_ar: string | null;
    last_name_ar: string | null;
    /** kg_invoices has no structure of its own — the child carries it. */
    structure_id: string | null;
    kg_classes: { name: string; name_ar: string | null } | null;
  } | null;
};

/** A payment, with the child it settles for — the only route to its structure. */
type PayRow = {
  amount: number;
  kg_children: { structure_id: string | null } | null;
};

export default async function BillingPage({
  searchParams,
}: {
  searchParams: Promise<{ month?: string; status?: string; structure?: string }>;
}) {
  const sp = await searchParams;
  const ctx = await requireFinance();
  const t = await getTranslations("billing");
  const locale = await getLocale();
  const supabase = await createClient();

  const month = /^\d{4}-\d{2}$/.test(sp.month ?? "") ? (sp.month as string) : algiersMonth();
  const filter: Filter = (FILTERS as readonly string[]).includes(sp.status ?? "")
    ? (sp.status as Filter)
    : "all";
  const { start, end } = monthRange(month);
  const today = algiersToday();

  const [
    { data: invRows, error },
    { data: payRows },
    { data: childRows },
    { data: feeRows },
    { data: gapRows },
    { data: structureRows },
  ] = await Promise.all([
    supabase
      .from("kg_invoices")
      .select(
        "id, number, period_month, issue_date, due_date, status, total, paid_amount, kg_children(first_name, last_name, first_name_ar, last_name_ar, structure_id, kg_classes(name, name_ar))"
      )
      .eq("tenant_id", ctx.tenant.id)
      .or(
        `period_month.eq.${start},and(period_month.is.null,issue_date.gte.${start},issue_date.lt.${end})`
      )
      .order("number", { ascending: false }),
    // The child travels with the payment so "collected" can be read for one
    // structure. Without it the three figures would keep answering for the whole
    // building while the table below answers for the crèche.
    supabase
      .from("kg_payments")
      .select("amount, kg_children(structure_id)")
      .eq("tenant_id", ctx.tenant.id)
      .gte("paid_at", start)
      .lt("paid_at", end),
    supabase
      .from("kg_children")
      .select("id, first_name, last_name, first_name_ar, last_name_ar")
      .eq("tenant_id", ctx.tenant.id)
      .eq("status", "enrolled")
      .order("first_name"),
    // Enrolled children with a live MONTHLY fee. Anyone enrolled and NOT in
    // here is invisible to the monthly run: kg_generate_monthly_invoices joins
    // on period = 'monthly', so a child without one is skipped silently every
    // month and attends all year for free without anybody noticing.
    //
    // The period join is the point. Every approval also writes an ADMISSION
    // row (period 'once', start_date = end_date = the day of approval), and
    // counting that as "billed" hid two children here on the day they were
    // enrolled — the one day somebody is most likely to be looking.
    supabase
      .from("kg_child_fees")
      .select("child_id, end_date, kg_fee_plans!inner(period)")
      .eq("tenant_id", ctx.tenant.id)
      .eq("kg_fee_plans.period", "monthly"),
    // Invoices that exist for this month but are missing a charge that is owed.
    // Neither of the two mechanisms that keep a month right revisits these: the
    // monthly run skips a child who already has an invoice, and the enrolment
    // trigger fired long ago. Without this they stay short in silence.
    supabase.rpc("kg_month_invoice_gaps", {
      p_tenant: ctx.tenant.id,
      p_month: `${month}-01`,
    }),
    // The structures of the establishment (0125), so a month can be read one
    // activity at a time. A crèche with a single structure never sees the filter.
    supabase
      .from("kg_structures")
      .select("id, name, name_ar, center_type, color, sort_order, active")
      .eq("tenant_id", ctx.tenant.id)
      .order("sort_order")
      .order("name"),
  ]);
  if (error) throw new Error(error.message);

  const structures = (structureRows ?? []) as Structure[];
  // Falls back to the rail's switcher, so the page and the sidebar never
  // disagree about which structure is being read. And once the rail HAS
  // narrowed, the in-page filter is hidden below — one question, one control.
  const structureFilter =
    sp.structure && structures.some((str) => str.id === sp.structure)
      ? sp.structure
      : (ctx.structureId ?? "all");
  const monthInvoices = (invRows ?? []) as unknown as HubRow[];

  // A child belongs to ONE structure, so unlike a tariff there is no shared row
  // to keep in every view: narrowing to the jardin means the jardin's children,
  // and a child filed under no structure is not in either list — the same
  // reading as the roster's filter.
  const invoices =
    structureFilter === "all"
      ? monthInvoices
      : monthInvoices.filter((inv) => inv.kg_children?.structure_id === structureFilter);
  const childOptions: ChildOption[] = childRows ?? [];

  const billedChildIds = new Set(
    ((feeRows ?? []) as { child_id: string; end_date: string | null }[])
      // `> today`, not `>=`: a fee whose last day is today is finished, and a
      // child whose plan ends tonight needs a new one before the next run.
      .filter((f) => f.end_date === null || f.end_date > today)
      .map((f) => f.child_id)
  );
  const unbilled = childOptions.filter((c) => !billedChildIds.has(c.id));

  const gaps = (gapRows ?? []) as InvoiceGap[];
  const gapTotal = gaps.reduce((s, g) => s + Number(g.missing), 0);

  const withEffective = invoices.map((inv) => ({ inv, shown: effectiveStatus(inv, today) }));

  // Drafts waiting to be issued. Zero-total drafts are left out because
  // kg_issue_invoices skips them — a child with nothing to bill is not a bill.
  // The due date shown is the one the issue step will write (0105): the
  // month's usual day, or nine days from today when issuing runs late, so an
  // invoice issued on the 15th is not born overdue.
  //
  // Counted over the whole month even when one structure is on screen:
  // kg_issue_invoices issues the month, so a button offering to issue "3" while
  // it would spend twelve numbers would be lying about what it does.
  const drafts = monthInvoices.filter((inv) => inv.status === "draft" && Number(inv.total) > 0);
  const draftTotal = drafts.reduce((s, inv) => s + Number(inv.total), 0);
  const usualDue = `${month}-${String(INVOICE_DUE_DAY).padStart(2, "0")}`;
  const lateDue = addDays(today, INVOICE_DUE_DAY - 1);
  const issueDue = usualDue > lateDue ? usualDue : lateDue;
  const invoiced = invoices
    .filter((i) => i.status !== "void")
    .reduce((s, i) => s + Number(i.total), 0);
  const collected = ((payRows ?? []) as unknown as PayRow[])
    .filter((p) => structureFilter === "all" || p.kg_children?.structure_id === structureFilter)
    .reduce((s, p) => s + Number(p.amount), 0);
  const outstanding = withEffective
    .filter(({ shown }) => shown === "unpaid" || shown === "partial" || shown === "overdue")
    .reduce((s, { inv }) => s + (Number(inv.total) - Number(inv.paid_amount)), 0);

  const countFor = (f: Filter) =>
    f === "all" ? invoices.length : withEffective.filter(({ shown }) => shown === f).length;
  const chips = FILTERS.map((f) => ({ value: f, label: t(`filters.${f}`), count: countFor(f) }));
  const visible =
    filter === "all" ? withEffective : withEffective.filter(({ shown }) => shown === filter);

  const monthOptions = recentMonths(12).map((m) => ({ value: m, label: monthLabel(m, locale) }));
  const currentMonthLabel = monthLabel(month, locale);
  // The three figures are read for what the filters say, and say so — the same
  // reason the month is written under each of them.
  const shownStructure = structures.find((str) => str.id === structureFilter);
  const statHint = shownStructure
    ? `${currentMonthLabel} · ${structureName(shownStructure, locale)}`
    : currentMonthLabel;

  return (
    <div>
      <PageHeader title={t("hub.title")} description={t("hub.description")}>
        <Button variant="outline" asChild>
          <Link href="/billing/plans">{t("hub.plansLink")}</Link>
        </Button>
        <Button variant="outline" asChild>
          <Link href="/billing/arrears">
            <AlarmClock data-icon="inline-start" />
            {t("hub.arrearsLink")}
          </Link>
        </Button>
        <NewInvoiceDialog childOptions={childOptions} />
        <GenerateInvoicesButton month={month} monthLabel={currentMonthLabel} />
        {drafts.length > 0 && (
          <IssueInvoicesButton
            month={month}
            monthLabel={currentMonthLabel}
            count={drafts.length}
            amountLabel={formatDZD(draftTotal, locale)}
            dueDateLabel={formatDate(issueDue, locale)}
          />
        )}
      </PageHeader>

      {/* Drafts nobody has issued. Generating a month is not billing it: the
          drafts have no number and no family can see them, so a month can look
          "done" in this list while every parent is still waiting for a bill.
          One heading, the amount, one action — same quiet shape as the two
          blocks below, so the page does not stack three alarms. */}
      {drafts.length > 0 && (
        <div className="mb-6">
          <p className="text-sm font-semibold text-foreground">
            {t("hub.drafts.title", { count: drafts.length })}
          </p>
          <p className="mt-0.5 text-xs leading-relaxed text-muted-foreground">
            {t("hub.drafts.body", {
              amount: formatDZD(draftTotal, locale),
              dueDate: formatDate(issueDue, locale),
            })}
          </p>
          <div className="mt-2">
            <IssueInvoicesButton
              variant="outline"
              month={month}
              monthLabel={currentMonthLabel}
              count={drafts.length}
              amountLabel={formatDZD(draftTotal, locale)}
              dueDateLabel={formatDate(issueDue, locale)}
            />
          </div>
        </div>
      )}

      {/* Enrolled and unbillable. The monthly run reads kg_child_fees, so a child
          without a fee row is skipped every month in silence — no error, no run
          exception a human would read as a problem, just a family who never
          receives an invoice. Approval now sets the fee (0054); this catches the
          ones approved before it did, and anyone whose plan is later ended. */}
      {/* Enrolled and unbillable. The monthly run reads kg_child_fees, so a child
          without a live monthly fee is charged no tuition — no error, nothing a
          human would read as a problem, just a family who is never invoiced.
          Approval now forces the choice (0063) and the run reports them (0064);
          this is where they wait until somebody acts.

          Each child is their own link. There used to be one "Attribuer une
          formule" button here that navigated to whichever child happened to be
          first in the list — a label promising an action it did not perform,
          for a child it did not name. With two children waiting, that button
          silently ignored one of them. */}
      {unbilled.length > 0 && (
        <div className="mb-6">
          <p className="flex items-center gap-1.5 text-sm font-semibold text-gold-ink">
            <TriangleAlert className="size-4 shrink-0" aria-hidden />
            {t("hub.noFeePlan.title", { count: unbilled.length })}
          </p>
          <p className="mt-0.5 text-xs leading-relaxed text-muted-foreground">
            {t("hub.noFeePlan.body")}
          </p>
          <ul className="mt-2 flex flex-wrap gap-2">
            {unbilled.map((c) => (
              <li key={c.id}>
                <Button variant="outline" size="sm" asChild>
                  <Link href={`/children/${c.id}?tab=billing`}>
                    {childDisplayName(c, locale)}
                    <ChevronRight
                      data-icon="inline-end"
                      className="rtl:-scale-x-100"
                      aria-hidden
                    />
                  </Link>
                </Button>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Open invoices that are short. Distinct from the block above: those
          children have no tariff at all, these have one and were charged less
          than it. Same quiet treatment — one heading, the names, one action —
          because two loud panels stacked on a screen read as an outage. */}
      {gaps.length > 0 && (
        <div className="mb-6">
          <p className="text-sm font-semibold text-foreground">
            {t("hub.incomplete.title", { count: gaps.length })}
          </p>
          <p className="mt-0.5 text-xs leading-relaxed text-muted-foreground">
            {t("hub.incomplete.body", { amount: formatDZD(gapTotal, locale) })}
          </p>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            {gaps.map((g) => (
              <Button key={g.child_id} variant="outline" size="sm" asChild>
                <Link href={`/children/${g.child_id}?tab=billing`}>
                  {childDisplayName(g, locale)}
                  <span className="text-muted-foreground">
                    {" +"}
                    {formatDZD(Number(g.missing), locale)}
                  </span>
                </Link>
              </Button>
            ))}
            <CompleteInvoicesButton month={month} />
          </div>
        </div>
      )}

      <div className="mb-6 grid gap-4 sm:grid-cols-3">
        <MoneyStat
          label={t("hub.stats.invoiced")}
          value={formatDZD(invoiced, locale)}
          hint={statHint}
          icon={<Receipt />}
          tone="primary"
        />
        <MoneyStat
          label={t("hub.stats.collected")}
          value={formatDZD(collected, locale)}
          hint={statHint}
          icon={<Coins />}
          tone="income"
        />
        <MoneyStat
          label={t("hub.stats.outstanding")}
          value={formatDZD(outstanding, locale)}
          hint={statHint}
          icon={outstanding > 0 ? <TriangleAlert /> : <CircleCheck />}
          tone={outstanding > 0 ? "destructive" : "muted"}
          highlight={outstanding > 0}
        />
      </div>

      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <MonthFilter options={monthOptions} value={month} ariaLabel={t("hub.monthAria")} />
          {!ctx.structureId && (
            <StructureFilter structures={structures} value={structureFilter} />
          )}
        </div>
        <StatusChips chips={chips} value={filter} />
      </div>

      {visible.length === 0 ? (
        <EmptyState
          icon={
            <EmptyIcon>
              <FileText />
            </EmptyIcon>
          }
          title={t("hub.empty")}
          description={t("hub.emptyHint")}
          action={
            filter === "all" ? (
              <GenerateInvoicesButton month={month} monthLabel={currentMonthLabel} />
            ) : undefined
          }
        />
      ) : (
        <Card className="gap-0 overflow-hidden py-0 shadow-sm">
          <div className="overflow-x-auto">
            <Table>
              <TableHeader className="[&_th]:text-xs [&_th]:font-semibold [&_th]:text-muted-foreground">
                <TableRow>
                  <TableHead className="ps-4">{t("hub.columns.number")}</TableHead>
                  <TableHead>{t("hub.columns.child")}</TableHead>
                  <TableHead>{t("hub.columns.period")}</TableHead>
                  <TableHead className="text-end">{t("hub.columns.total")}</TableHead>
                  <TableHead className="text-end">{t("hub.columns.paid")}</TableHead>
                  <TableHead className="text-end">{t("hub.columns.balance")}</TableHead>
                  <TableHead>{t("hub.columns.dueDate")}</TableHead>
                  <TableHead>{t("hub.columns.status")}</TableHead>
                  <TableHead className="pe-4 text-end">{t("hub.columns.actions")}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {visible.map(({ inv, shown }) => {
                  const numberLabel = displayInvoiceNumber(
                    inv.issue_date,
                    inv.number,
                    t("status.draft")
                  );
                  const balance = Number(inv.total) - Number(inv.paid_amount);
                  const childName = inv.kg_children
                    ? childDisplayName(inv.kg_children, locale)
                    : "—";
                  const cls = inv.kg_children?.kg_classes;
                  const overdue = shown === "overdue";
                  // Not on a draft: cash against an unissued bill would settle
                  // it without a number ever being spent. Issue first.
                  const payable =
                    shown !== "paid" && shown !== "void" && shown !== "draft" && balance > 0;
                  return (
                    <TableRow key={inv.id} className={cn("h-14", overdue && "bg-destructive/5")}>
                      <TableCell className="ps-4 font-medium">
                        <Link
                          href={`/billing/invoices/${inv.id}`}
                          className="tabular-nums hover:text-primary hover:underline"
                        >
                          {numberLabel}
                        </Link>
                      </TableCell>
                      <TableCell>
                        <div className="font-medium">{childName}</div>
                        {cls && (
                          <div className="text-xs text-muted-foreground">
                            {locale === "ar" && cls.name_ar ? cls.name_ar : cls.name}
                          </div>
                        )}
                      </TableCell>
                      <TableCell className="text-muted-foreground">
                        {inv.period_month ? monthLabel(inv.period_month.slice(0, 7), locale) : "—"}
                      </TableCell>
                      <TableCell className="text-end tabular-nums">
                        {formatDZD(inv.total, locale)}
                      </TableCell>
                      <TableCell
                        className={cn(
                          "text-end tabular-nums",
                          Number(inv.paid_amount) > 0
                            ? "font-medium text-income"
                            : "text-muted-foreground"
                        )}
                      >
                        {formatDZD(inv.paid_amount, locale)}
                      </TableCell>
                      <TableCell
                        className={cn(
                          "text-end font-semibold tabular-nums",
                          balance <= 0 && "font-normal text-muted-foreground",
                          overdue && "text-destructive"
                        )}
                      >
                        {formatDZD(balance, locale)}
                      </TableCell>
                      <TableCell className={cn(overdue && "font-medium text-destructive")}>
                        {inv.due_date ? formatDate(inv.due_date, locale) : "—"}
                      </TableCell>
                      <TableCell>
                        <Badge className={INVOICE_STATUS_BADGE[shown]}>{t(`status.${shown}`)}</Badge>
                      </TableCell>
                      <TableCell className="pe-4">
                        <div className="flex items-center justify-end gap-1">
                          <Button variant="ghost" size="icon" asChild aria-label={t("hub.view")}>
                            <Link href={`/billing/invoices/${inv.id}`}>
                              <Eye />
                            </Link>
                          </Button>
                          {/* Always rendered, never `payable && …`: the action
                              revalidates this page, and unmounting the dialog
                              mid-confirmation takes the receipt link with it. */}
                          <RecordPaymentDialog
                            size="sm"
                            payable={payable}
                            invoice={{ id: inv.id, numberLabel, childName, balance }}
                          />
                        </div>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        </Card>
      )}
    </div>
  );
}
