import Link from "next/link";
import { getLocale, getTranslations } from "next-intl/server";
import { ChevronRight, ClipboardList, Coins, FileText, Receipt, TriangleAlert, UserRound } from "lucide-react";
import { EmptyState } from "@/components/shared/empty-state";
import { PageHeader } from "@/components/shared/page-header";
import { SectionCard } from "@/components/shared/section-card";
import { StatCard } from "@/components/shared/stat-card";
import { createClient } from "@/lib/supabase/server";
import { requireFinance } from "@/lib/tenant";
import { childDisplayName, formatDate, formatDZD } from "@/lib/format";
import type { InvoiceStatus } from "@/lib/types";
import { BillingTabs } from "@/components/modules/billing/billing-tabs";
import { GenerateInvoicesButton } from "@/components/modules/billing/generate-invoices-button";
import { NewInvoiceDialog } from "@/components/modules/billing/new-invoice-dialog";
import {
  InvoicesRegister,
  type RegisterRow,
  type RegisterStructure,
} from "@/components/modules/billing/invoices-register";
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
  INVOICE_FILTERS,
  type InvoiceFilter,
} from "@/components/modules/billing/maps";
import { CompleteInvoicesButton } from "@/components/modules/billing/complete-invoices-button";
import { IssueInvoicesButton } from "@/components/modules/billing/issue-invoices-button";
import type { ChildOption, InvoiceGap } from "@/components/modules/billing/billing-types";
import { structureName, type Structure } from "@/components/modules/classes/class-types";

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

/** An enrolled child with the class the À-traiter row names. */
type UnbilledChild = ChildOption & {
  kg_classes: { name: string; name_ar: string | null } | null;
};

/** A payment, with the child it settles for — the only route to its structure. */
type PayRow = {
  amount: number;
  kg_children: { structure_id: string | null } | null;
};

export default async function BillingPage({
  searchParams,
}: {
  searchParams: Promise<{ month?: string; status?: string; structure?: string; todo?: string }>;
}) {
  const sp = await searchParams;
  const ctx = await requireFinance();
  const t = await getTranslations("billing");
  // The À-traiter title is the dashboard's, so the two lists read as one idea.
  const td = await getTranslations("dashboard");
  const locale = await getLocale();
  const supabase = await createClient();

  const month = /^\d{4}-\d{2}$/.test(sp.month ?? "") ? (sp.month as string) : algiersMonth();
  const filter: InvoiceFilter = (INVOICE_FILTERS as readonly string[]).includes(sp.status ?? "")
    ? (sp.status as InvoiceFilter)
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
    { count: invoiceCount },
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
    // The class travels with the child so the "no fee plan" row can say which
    // room they sit in — the one fact that tells two Adams apart.
    supabase
      .from("kg_children")
      .select("id, first_name, last_name, first_name_ar, last_name_ar, kg_classes(name, name_ar)")
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
    // Whether the establishment has ever billed anything. The whole-page
    // empty state is for that one case; an empty MONTH keeps its filter card,
    // because the month is precisely what the reader needs to change.
    supabase
      .from("kg_invoices")
      .select("id", { count: "exact", head: true })
      .eq("tenant_id", ctx.tenant.id),
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
  const children = (childRows ?? []) as unknown as UnbilledChild[];
  const childOptions: ChildOption[] = children;

  const billedChildIds = new Set(
    ((feeRows ?? []) as { child_id: string; end_date: string | null }[])
      // `> today`, not `>=`: a fee whose last day is today is finished, and a
      // child whose plan ends tonight needs a new one before the next run.
      .filter((f) => f.end_date === null || f.end_date > today)
      .map((f) => f.child_id)
  );
  const unbilled = children.filter((c) => !billedChildIds.has(c.id));

  const gaps = (gapRows ?? []) as InvoiceGap[];

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

  const visible =
    filter === "all" ? withEffective : withEffective.filter(({ shown }) => shown === filter);

  // Resolved here, not in the register: the name, the class and the effective
  // status all depend on the locale or on today, and the client component's
  // only job is to search, group and draw rows it can already read.
  const registerRows: RegisterRow[] = visible.map(({ inv, shown }) => {
    const balance = Number(inv.total) - Number(inv.paid_amount);
    const cls = inv.kg_children?.kg_classes;
    return {
      id: inv.id,
      numberLabel: displayInvoiceNumber(inv.issue_date, inv.number, t("status.draft")),
      isDraft: inv.number === null,
      childName: inv.kg_children ? childDisplayName(inv.kg_children, locale) : "—",
      className: cls ? (locale === "ar" && cls.name_ar ? cls.name_ar : cls.name) : null,
      structureId: inv.kg_children?.structure_id ?? null,
      total: Number(inv.total),
      paid: Number(inv.paid_amount),
      balance,
      dueDate: inv.due_date,
      shown,
      // Not on a draft: cash against an unissued bill would settle it without
      // a number ever being spent. Issue first.
      payable: shown !== "paid" && shown !== "void" && shown !== "draft" && balance > 0,
    };
  });
  // Group rows by structure only while the whole building is on screen. A
  // month narrowed to one structure is one list, and so is a one-structure
  // crèche. The trailing group collects children filed under no structure.
  const registerGroups: RegisterStructure[] | null =
    structures.length > 1 && structureFilter === "all"
      ? [
          ...structures.map((str) => ({
            id: str.id,
            name: structureName(str, locale),
            color: str.color,
          })),
          { id: null, name: t("structures.whole"), color: null },
        ]
      : null;

  const monthOptions = recentMonths(12).map((m) => ({ value: m, label: monthLabel(m, locale) }));
  const currentMonthLabel = monthLabel(month, locale);
  // The three figures are read for what the filters say, and say so — the same
  // reason the month is written under each of them.
  const shownStructure = structures.find((str) => str.id === structureFilter);
  const statHint = shownStructure
    ? `${currentMonthLabel} · ${structureName(shownStructure, locale)}`
    : currentMonthLabel;

  const todoCount = (drafts.length > 0 ? 1 : 0) + unbilled.length + gaps.length;

  // Each group shows a handful and offers the rest. Twelve children without
  // a tariff is a real backlog, but drawn in full it pushed the month's
  // register below the first screen — the list this page exists for. The
  // link keeps every other filter and adds `todo=all`, so expanding is one
  // more state of the URL, like the month and the status.
  const TODO_ROWS = 5;
  const showAllTodo = sp.todo === "all";
  const expandHref = (() => {
    const params = new URLSearchParams();
    params.set("month", month);
    if (filter !== "all") params.set("status", filter);
    if (sp.structure) params.set("structure", sp.structure);
    params.set("todo", "all");
    return `/billing?${params.toString()}`;
  })();
  const shownUnbilled = showAllTodo ? unbilled : unbilled.slice(0, TODO_ROWS);
  const shownGaps = showAllTodo ? gaps : gaps.slice(0, TODO_ROWS);
  /** The tertiary "see all" row under a capped group. */
  const seeAllRow = (count: number) => (
    <li className="px-5 py-3">
      <Link
        href={expandHref}
        className="inline-flex items-center gap-1 text-sm text-primary"
      >
        {t("hub.seeAll", { count })}
        <ChevronRight className="size-4 rtl:rotate-180" aria-hidden />
      </Link>
    </li>
  );

  return (
    <div>
      {/* One primary per page: the thing this page creates. */}
      <PageHeader title={t("hub.title")} description={t("hub.description")}>
        <NewInvoiceDialog childOptions={childOptions} />
        <GenerateInvoicesButton month={month} monthLabel={currentMonthLabel} />
      </PageHeader>

      <BillingTabs />

      <div className="mb-6 grid gap-4 sm:grid-cols-3">
        <StatCard
          label={t("hub.stats.invoiced")}
          value={formatDZD(invoiced, locale)}
          hint={statHint}
          icon={<Receipt />}
        />
        <StatCard
          label={t("hub.stats.collected")}
          value={formatDZD(collected, locale)}
          hint={statHint}
          icon={<Coins />}
          tone="success"
        />
        <StatCard
          label={t("hub.stats.outstanding")}
          value={formatDZD(outstanding, locale)}
          hint={statHint}
          icon={<TriangleAlert />}
          tone="danger"
        />
      </div>

      {/* What the month still needs a human for, in one list rather than
          three loose panels: drafts nobody has issued (generating a month is
          not billing it — the drafts have no number and no family can see
          them), children enrolled without a monthly fee (the run skips them in
          silence, and a family is never invoiced), and open invoices that are
          short of a charge the child owes (neither the run nor the enrolment
          trigger revisits them). The card is not drawn at all when there is
          nothing to do — a permanent "nothing to do" box is noise. */}
      {todoCount > 0 && (
        <SectionCard
          icon={ClipboardList}
          tone={1}
          title={td("todo.title")}
          hint={t("hub.todoHint", { count: todoCount })}
          action={gaps.length > 0 ? <CompleteInvoicesButton month={month} /> : undefined}
          className="mb-6"
          contentClassName="px-0"
        >
          <ul className="divide-y divide-border">
            {drafts.length > 0 && (
              <li className="flex min-h-14 items-center gap-3 px-5 py-3">
                <span className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-tile-1 text-primary">
                  <FileText className="size-4" aria-hidden />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block text-sm font-medium">
                    {t("hub.drafts.title", { count: drafts.length })}
                  </span>
                  <span className="block text-xs text-muted-foreground">
                    {t("hub.drafts.body", {
                      amount: formatDZD(draftTotal, locale),
                      dueDate: formatDate(issueDue, locale),
                    })}
                  </span>
                </span>
                <IssueInvoicesButton
                  variant="outline"
                  month={month}
                  monthLabel={currentMonthLabel}
                  count={drafts.length}
                  amountLabel={formatDZD(draftTotal, locale)}
                  dueDateLabel={formatDate(issueDue, locale)}
                />
              </li>
            )}
            {unbilled.length > 0 && (
              <>
                <li className="bg-muted/30 px-5 py-1.5 text-xs">
                  <span className="flex items-center gap-2">
                    <span className="font-semibold">{t("hub.noFeePlan.group")}</span>
                    <span className="text-muted-foreground tabular-nums">{unbilled.length}</span>
                  </span>
                </li>
                {/* Each child is their own door, to the billing tab where the
                    fee is set. There used to be one "Attribuer une formule"
                    button here that navigated to whichever child happened to
                    be first in the list — a label promising an action it did
                    not perform, for a child it did not name. */}
                {shownUnbilled.map((c) => {
                  const cls = c.kg_classes;
                  return (
                    <li key={c.id} className="relative flex min-h-14 items-center gap-3 px-5 py-3 transition-colors hover:bg-primary/5">
                      <span className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-muted text-muted-foreground">
                        <UserRound className="size-4" aria-hidden />
                      </span>
                      <span className="min-w-0 flex-1">
                        <Link
                          href={`/children/${c.id}?tab=billing`}
                          className="block text-sm font-medium after:absolute after:inset-0"
                        >
                          <span className="block truncate"><bdi dir="auto">{childDisplayName(c, locale)}</bdi></span>
                        </Link>
                        <span className="block truncate text-xs text-muted-foreground">
                          {cls ? (
                            <bdi dir="auto">{locale === "ar" && cls.name_ar ? cls.name_ar : cls.name}</bdi>
                          ) : (
                            t("hub.noFeePlan.body")
                          )}
                        </span>
                      </span>
                      <ChevronRight className="size-4 shrink-0 text-muted-foreground rtl:rotate-180" aria-hidden />
                    </li>
                  );
                })}
                {shownUnbilled.length < unbilled.length && seeAllRow(unbilled.length)}
              </>
            )}
            {gaps.length > 0 && (
              <>
                <li className="bg-muted/30 px-5 py-1.5 text-xs">
                  <span className="flex items-center gap-2">
                    <span className="font-semibold">{t("hub.incomplete.group")}</span>
                    <span className="text-muted-foreground tabular-nums">{gaps.length}</span>
                  </span>
                </li>
                {/* Distinct from the group above: those children have no
                    tariff at all, these have one and were charged less than
                    it. The amount is what is missing, and the header action
                    adds it to every one of them at once. */}
                {/* The name is the door here too, to the billing tab where
                    the short invoice can be read against the tariff. The
                    amount is not interactive, so nothing needs lifting. */}
                {shownGaps.map((g) => (
                  <li key={g.child_id} className="relative flex min-h-14 items-center gap-3 px-5 py-3 transition-colors hover:bg-primary/5">
                    <span className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-muted text-muted-foreground">
                      <Receipt className="size-4" aria-hidden />
                    </span>
                    <span className="min-w-0 flex-1">
                      <Link
                        href={`/children/${g.child_id}?tab=billing`}
                        className="block text-sm font-medium after:absolute after:inset-0"
                      >
                        <span className="block truncate"><bdi dir="auto">{childDisplayName(g, locale)}</bdi></span>
                      </Link>
                      <span className="block truncate text-xs text-muted-foreground">
                        {t("hub.incomplete.rowHint")}
                      </span>
                    </span>
                    <span dir="ltr" className="text-sm tabular-nums">
                      +{formatDZD(Number(g.missing), locale)}
                    </span>
                  </li>
                ))}
                {shownGaps.length < gaps.length && seeAllRow(gaps.length)}
              </>
            )}
          </ul>
        </SectionCard>
      )}

      {/* The page-wide empty state is for an establishment that has never
          billed. An empty month keeps the filter card — the month and
          structure selects are the way out of it. */}
      {(invoiceCount ?? 0) === 0 ? (
        <EmptyState icon={<FileText />} title={t("hub.empty")} description={t("hub.emptyHint")} />
      ) : (
        <InvoicesRegister
          rows={registerRows}
          monthOptions={monthOptions}
          month={month}
          structures={structures}
          structureFilter={structureFilter}
          showStructureFilter={!ctx.structureId}
          status={filter}
          groups={registerGroups}
          monthIsEmpty={monthInvoices.length === 0}
        />
      )}
    </div>
  );
}
