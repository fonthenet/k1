import { getLocale, getTranslations } from "next-intl/server";
import { BadgeCheck, HandCoins, TriangleAlert, Wallet } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { requireFinance } from "@/lib/tenant";
import { formatDate, formatDZD } from "@/lib/format";
import { cn } from "@/lib/utils";
import { PageHeader } from "@/components/shared/page-header";
import { EmptyState } from "@/components/shared/empty-state";
import { Alert, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { AccountingNav } from "@/components/modules/accounting/nav-tabs";
import { AdvanceDialog } from "@/components/modules/accounting/advance-dialog";
import { AdvanceRepaidButton } from "@/components/modules/accounting/advance-repaid-button";
import {
  EmptyIcon,
  MoneyStat,
  TONE_PILL,
  type FinanceTone,
} from "@/components/modules/billing/finance-ui";
import { StaffLink } from "@/components/shared/entity-link";
import type { MemberOption } from "@/components/modules/accounting/types";

interface RawMember {
  id: string;
  user_id: string | null;
  full_name: string | null;
  job_title: string | null;
  status: string;
}

interface RawAdvance {
  id: string;
  membership_id: string;
  amount: number | string;
  date: string;
  note: string | null;
  repaid: boolean;
  payroll_item_id: string | null;
}

interface AdvanceRow {
  id: string;
  membershipId: string;
  memberName: string;
  jobTitle: string | null;
  amount: number;
  date: string;
  note: string | null;
  repaid: boolean;
  viaPayroll: boolean;
}

export default async function AdvancesPage() {
  const ctx = await requireFinance();
  const supabase = await createClient();
  const [t, locale] = await Promise.all([getTranslations("accounting"), getLocale()]);
  const tid = ctx.tenant.id;
  const collator = new Intl.Collator(locale === "ar" ? "ar-DZ" : "fr-DZ");

  const [memberRes, advanceRes] = await Promise.all([
    // Every staff membership, not just the active ones: a member who has left can still
    // owe an advance, and that row must keep showing their name.
    supabase
      .from("kg_memberships")
      .select("id, user_id, full_name, job_title, status")
      .eq("tenant_id", tid)
      .neq("role", "parent"),
    supabase
      .from("kg_salary_advances")
      .select("id, membership_id, amount, date, note, repaid, payroll_item_id")
      .eq("tenant_id", tid)
      .order("date", { ascending: false })
      .order("created_at", { ascending: false }),
  ]);

  const rawMembers = (memberRes.data ?? []) as RawMember[];

  // kg_memberships has no FK to kg_profiles (user_id points at auth.users), so names
  // are resolved in a second round-trip — same shape as the payroll run page.
  const userIds = [...new Set(rawMembers.map((m) => m.user_id).filter((id): id is string => !!id))];
  const profileRes =
    userIds.length > 0
      ? await supabase.from("kg_profiles").select("id, full_name").in("id", userIds)
      : { data: [] as { id: string; full_name: string }[], error: null };
  const nameByUser = new Map((profileRes.data ?? []).map((p) => [p.id, p.full_name]));

  const hasError = Boolean(memberRes.error || advanceRes.error || profileRes.error);

  const allMembers: MemberOption[] = rawMembers
    .map((m) => ({
      id: m.id,
      name:
        (m.user_id ? nameByUser.get(m.user_id) : null) || (m.full_name ?? "").trim() || "—",
      jobTitle: m.job_title,
    }))
    .sort((a, b) => collator.compare(a.name, b.name));
  const memberById = new Map(allMembers.map((m) => [m.id, m]));

  // Only active staff can be granted a new advance (the server action enforces this too).
  const activeIds = new Set(rawMembers.filter((m) => m.status === "active").map((m) => m.id));
  const members = allMembers.filter((m) => activeIds.has(m.id));

  const rows: AdvanceRow[] = ((advanceRes.data ?? []) as RawAdvance[]).map((a) => {
    const member = memberById.get(a.membership_id);
    return {
      id: a.id,
      membershipId: a.membership_id,
      memberName: member?.name ?? "—",
      jobTitle: member?.jobTitle ?? null,
      amount: Number(a.amount),
      date: a.date,
      note: a.note,
      repaid: a.repaid,
      viaPayroll: Boolean(a.payroll_item_id),
    };
  });

  const outstanding = rows.filter((r) => !r.repaid);
  const repaid = rows.filter((r) => r.repaid);
  const totalOutstanding = outstanding.reduce((s, r) => s + r.amount, 0);
  const totalRepaid = repaid.reduce((s, r) => s + r.amount, 0);

  const labels = {
    member: t("advances.member"),
    amount: t("advances.amount"),
    date: t("advances.date"),
    note: t("advances.note"),
    count: (count: number) => t("advances.count", { count }),
    queued: t("advances.queuedInPayroll"),
    viaPayroll: t("advances.viaPayroll"),
    repaid: t("advances.repaid"),
  };

  return (
    <div className="space-y-6">
      <PageHeader title={t("advances.title")} description={t("advances.subtitle")}>
        {members.length > 0 && <AdvanceDialog members={members} />}
      </PageHeader>

      <AccountingNav />

      {hasError && (
        <Alert variant="destructive">
          <TriangleAlert />
          <AlertTitle>{t("loadError")}</AlertTitle>
        </Alert>
      )}

      <div className="grid gap-4 sm:grid-cols-2">
        <MoneyStat
          label={t("advances.totalOutstanding")}
          value={formatDZD(totalOutstanding, locale)}
          hint={t("advances.count", { count: outstanding.length })}
          icon={<HandCoins />}
          tone={totalOutstanding > 0 ? "gold" : "muted"}
          highlight={totalOutstanding > 0}
        />
        <MoneyStat
          label={t("advances.repaid")}
          value={formatDZD(totalRepaid, locale)}
          hint={t("advances.count", { count: repaid.length })}
          icon={<BadgeCheck />}
          tone="income"
        />
      </div>

      <Tabs defaultValue="outstanding">
        <div className="overflow-x-auto pb-1">
          <TabsList>
            <TabsTrigger value="outstanding">
              {t("advances.outstanding")}
              <span className="ms-1.5 rounded-4xl bg-muted px-1.5 text-xs tabular-nums text-muted-foreground">
                {outstanding.length}
              </span>
            </TabsTrigger>
            <TabsTrigger value="repaid">
              {t("advances.repaid")}
              <span className="ms-1.5 rounded-4xl bg-muted px-1.5 text-xs tabular-nums text-muted-foreground">
                {repaid.length}
              </span>
            </TabsTrigger>
          </TabsList>
        </div>

        <TabsContent value="outstanding" className="mt-4">
          <AdvancesTable
            rows={outstanding}
            locale={locale}
            emptyTitle={t("advances.emptyOutstanding")}
            emptyHint={members.length === 0 ? t("errors.noStaff") : t("advances.addDesc")}
            totalLabel={t("advances.totalOutstanding")}
            totalTone="gold"
            labels={labels}
          />
        </TabsContent>

        <TabsContent value="repaid" className="mt-4">
          <AdvancesTable
            rows={repaid}
            locale={locale}
            emptyTitle={t("advances.emptyRepaid")}
            totalLabel={t("advances.repaid")}
            totalTone="income"
            labels={labels}
          />
        </TabsContent>
      </Tabs>
    </div>
  );
}

interface TableLabels {
  member: string;
  amount: string;
  date: string;
  note: string;
  count: (count: number) => string;
  queued: string;
  viaPayroll: string;
  repaid: string;
}

/** Shared table body for the outstanding / repaid tabs. */
function AdvancesTable({
  rows,
  locale,
  emptyTitle,
  emptyHint,
  totalLabel,
  totalTone,
  labels,
}: {
  rows: AdvanceRow[];
  locale: string;
  emptyTitle: string;
  emptyHint?: string;
  totalLabel: string;
  totalTone: FinanceTone;
  labels: TableLabels;
}) {
  const total = rows.reduce((s, r) => s + r.amount, 0);

  return (
    <Card className="gap-0 overflow-hidden py-0 shadow-sm">
      <CardContent className="p-0">
        {rows.length === 0 ? (
          <div className="p-6">
            <EmptyState
              icon={
                <EmptyIcon tone="muted">
                  <Wallet />
                </EmptyIcon>
              }
              title={emptyTitle}
              description={emptyHint}
            />
          </div>
        ) : (
          <>
            <div className="overflow-x-auto">
              <Table>
                <TableHeader className="[&_th]:text-xs [&_th]:font-semibold [&_th]:text-muted-foreground">
                  <TableRow>
                    <TableHead className="ps-4">{labels.member}</TableHead>
                    <TableHead>{labels.date}</TableHead>
                    <TableHead>{labels.note}</TableHead>
                    <TableHead className="text-end">{labels.amount}</TableHead>
                    <TableHead className="w-44 pe-4" />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.map((row) => (
                    <TableRow key={row.id} className="h-14">
                      <TableCell className="ps-4">
                        <div className="font-medium">
                          <StaffLink id={row.membershipId}>{row.memberName}</StaffLink>
                        </div>
                        {row.jobTitle && (
                          <div className="text-xs text-muted-foreground">{row.jobTitle}</div>
                        )}
                      </TableCell>
                      <TableCell className="whitespace-nowrap tabular-nums text-muted-foreground">
                        {formatDate(row.date, locale)}
                      </TableCell>
                      <TableCell className="max-w-72">
                        {row.note ? (
                          <span className="line-clamp-2 text-sm text-muted-foreground">
                            {row.note}
                          </span>
                        ) : (
                          <span className="text-sm text-muted-foreground">—</span>
                        )}
                      </TableCell>
                      <TableCell className="text-end font-semibold tabular-nums">
                        {formatDZD(row.amount, locale)}
                      </TableCell>
                      <TableCell className="pe-4 text-end">
                        {row.repaid ? (
                          <Badge className={TONE_PILL.success}>
                            <BadgeCheck />
                            {row.viaPayroll ? labels.viaPayroll : labels.repaid}
                          </Badge>
                        ) : (
                          <div className="flex flex-wrap items-center justify-end gap-1.5">
                            {row.viaPayroll && (
                              <Badge className={TONE_PILL.gold}>{labels.queued}</Badge>
                            )}
                            <AdvanceRepaidButton
                              advanceId={row.id}
                              memberName={row.memberName}
                              amountLabel={formatDZD(row.amount, locale)}
                            />
                          </div>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>

            <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border bg-muted/40 px-4 py-3 text-sm">
              <span className="text-muted-foreground">{labels.count(rows.length)}</span>
              <span className="flex items-center gap-2 tabular-nums">
                <span className="text-muted-foreground">{totalLabel} :</span>
                <span
                  className={cn(
                    "rounded-4xl px-2.5 py-0.5 font-bold",
                    totalTone === "gold"
                      ? "bg-gold-muted text-gold-ink"
                      : "bg-success/15 text-success"
                  )}
                >
                  {formatDZD(total, locale)}
                </span>
              </span>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}
