import Link from "next/link";
import { getLocale, getTranslations } from "next-intl/server";
import {
  ArrowLeft,
  ArrowRight,
  CircleCheck,
  Hourglass,
  MessageCircle,
  Phone,
  TriangleAlert,
  Users,
} from "lucide-react";
import { Alert, AlertTitle } from "@/components/ui/alert";
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
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { EmptyState } from "@/components/shared/empty-state";
import { PageHeader } from "@/components/shared/page-header";
import { createClient } from "@/lib/supabase/server";
import { requireFinance } from "@/lib/tenant";
import { childDisplayName, formatDZD, formatDate, formatPhone, telHref } from "@/lib/format";
import { cn } from "@/lib/utils";
import { algiersToday, daysSince } from "@/components/modules/billing/dates";
import { waPhone } from "@/components/modules/billing/maps";
import { EmptyIcon, MoneyStat } from "@/components/modules/billing/finance-ui";
import { fetchArrears, type ArrearsFamily } from "@/components/modules/dashboard/arrears-data";
import { ArrearsRefresh } from "@/components/modules/dashboard/arrears-refresh";

type ArrearRow = {
  id: string;
  child_id: string;
  due_date: string | null;
  issue_date: string;
  total: number;
  paid_amount: number;
  kg_children: {
    id: string;
    first_name: string;
    last_name: string;
    first_name_ar: string | null;
    last_name_ar: string | null;
    kg_classes: { name: string; name_ar: string | null } | null;
  } | null;
};

interface ChildArrears {
  childId: string;
  name: string;
  className: string | null;
  buckets: [number, number, number, number]; // current, 30d, 60d, 90d+
  total: number;
}

/** Aging escalates: current is quiet, 60 days turns gold, 90+ turns red. */
const BUCKET_TEXT = [
  "text-muted-foreground",
  "text-foreground",
  "font-medium text-warning",
  "font-semibold text-destructive",
] as const;

const BUCKET_CELL = ["", "", "bg-warning/5", "bg-destructive/5"] as const;

/** Lateness badge: a week is a reminder, a month is a problem. */
function daysBadge(days: number): { variant: "destructive" | "outline"; className?: string } {
  if (days > 30) return { variant: "destructive" };
  if (days > 7) return { variant: "outline", className: "border-warning/40 bg-warning/15 text-foreground" };
  return { variant: "outline", className: "text-muted-foreground" };
}

export default async function ArrearsPage() {
  const ctx = await requireFinance();
  const t = await getTranslations("billing");
  const locale = await getLocale();
  const supabase = await createClient();
  const today = algiersToday();

  // Two reads of the same debt: `kg_arrears_summary` collapses it per family
  // (who to call), the invoice rows keep the aging breakdown (how old it is).
  const [arrears, { data: invRows, error }] = await Promise.all([
    fetchArrears(ctx.tenant.id),
    supabase
      .from("kg_invoices")
      .select(
        "id, child_id, due_date, issue_date, total, paid_amount, kg_children(id, first_name, last_name, first_name_ar, last_name_ar, kg_classes(name, name_ar))"
      )
      .eq("tenant_id", ctx.tenant.id)
      .in("status", ["sent", "unpaid", "partial", "overdue"])
      .order("due_date", { ascending: true }),
  ]);
  if (error) throw new Error(error.message);

  const rows = ((invRows ?? []) as unknown as ArrearRow[]).filter(
    (r) => Number(r.total) - Number(r.paid_amount) > 0
  );

  // Arabic names live on the child record, not in the summary RPC — so an
  // Arabic reader still sees the name the family actually uses.
  const arNameByChild = new Map<string, string>();
  for (const r of rows) {
    if (r.kg_children && !arNameByChild.has(r.child_id)) {
      arNameByChild.set(r.child_id, childDisplayName(r.kg_children, locale));
    }
  }
  const familyName = (f: ArrearsFamily) => arNameByChild.get(f.childId) ?? (f.childName || "—");

  const byChild = new Map<string, ChildArrears>();
  for (const r of rows) {
    const balance = Number(r.total) - Number(r.paid_amount);
    const overdueDays = daysSince(r.due_date ?? r.issue_date, today);
    const bucket = overdueDays < 30 ? 0 : overdueDays < 60 ? 1 : overdueDays < 90 ? 2 : 3;
    let agg = byChild.get(r.child_id);
    if (!agg) {
      const cls = r.kg_children?.kg_classes;
      agg = {
        childId: r.child_id,
        name: r.kg_children ? childDisplayName(r.kg_children, locale) : "—",
        className: cls ? (locale === "ar" && cls.name_ar ? cls.name_ar : cls.name) : null,
        buckets: [0, 0, 0, 0],
        total: 0,
      };
      byChild.set(r.child_id, agg);
    }
    agg.buckets[bucket] += balance;
    agg.total += balance;
  }
  const aging = [...byChild.values()].sort((a, b) => b.total - a.total);

  // The summary RPC already picks the guardian to call (financial contact
  // first, then primary) — the aging table reuses that same pick.
  const phoneByChild = new Map<string, string>();
  for (const f of arrears.rows) {
    if (f.guardianPhone) phoneByChild.set(f.childId, f.guardianPhone);
  }

  const grandTotal = aging.reduce((s, a) => s + a.total, 0);
  const bucketTotals = [0, 1, 2, 3].map((i) => aging.reduce((s, a) => s + a.buckets[i], 0));
  const BackIcon = locale === "ar" ? ArrowRight : ArrowLeft;
  const bucketLabels = [
    t("arrears.columns.current"),
    t("arrears.columns.d30"),
    t("arrears.columns.d60"),
    t("arrears.columns.d90"),
  ];
  const nothingOwed = aging.length === 0 && arrears.rows.length === 0;

  /** The reminder the office sends. Latin digits on purpose: it leaves the app
   *  for WhatsApp, where a Western-Arabic amount is read by everyone. */
  const reminderLink = (f: ArrearsFamily, phone: string) =>
    `https://wa.me/${waPhone(phone)}?text=${encodeURIComponent(
      t("arrears.waMessage", {
        kindergarten: ctx.tenant.name,
        child: familyName(f),
        amount: formatDZD(f.outstanding, "fr"),
      })
    )}`;

  return (
    <div>
      {/* Statuses age on their own; opening this page is what sweeps them. */}
      <ArrearsRefresh tenantId={ctx.tenant.id} day={today} />

      <PageHeader title={t("arrears.title")} description={t("arrears.description")}>
        <Button variant="ghost" asChild>
          <Link href="/billing">
            <BackIcon data-icon="inline-start" />
            {t("invoice.back")}
          </Link>
        </Button>
      </PageHeader>

      <div className="mb-6 grid gap-4 sm:grid-cols-3">
        <MoneyStat
          label={t("arrears.stats.total")}
          value={formatDZD(grandTotal, locale)}
          icon={grandTotal > 0 ? <TriangleAlert /> : <CircleCheck />}
          tone={grandTotal > 0 ? "destructive" : "success"}
          highlight={grandTotal > 0}
        />
        <MoneyStat
          label={t("arrears.stats.children")}
          value={aging.length}
          icon={<Users />}
          tone="primary"
        />
        <MoneyStat
          label={t("arrears.stats.oldest")}
          value={formatDZD(bucketTotals[3], locale)}
          icon={<Hourglass />}
          tone={bucketTotals[3] > 0 ? "gold" : "muted"}
          highlight={bucketTotals[3] > 0}
        />
      </div>

      {arrears.error && (
        <Alert variant="destructive" className="mb-4">
          <TriangleAlert />
          <AlertTitle>{t("arrears.loadError")}</AlertTitle>
        </Alert>
      )}

      {nothingOwed ? (
        <EmptyState
          icon={
            <EmptyIcon tone="success">
              <CircleCheck />
            </EmptyIcon>
          }
          title={t("arrears.empty")}
          description={t("arrears.emptyHint")}
        />
      ) : (
        <Tabs defaultValue={arrears.rows.length > 0 ? "families" : "aging"}>
          <div className="overflow-x-auto pb-1">
            <TabsList>
              <TabsTrigger value="families">
                {t("arrears.tabs.families")}
                <span className="ms-1.5 rounded-4xl bg-muted px-1.5 text-xs tabular-nums text-muted-foreground">
                  {arrears.rows.length}
                </span>
              </TabsTrigger>
              <TabsTrigger value="aging">{t("arrears.tabs.aging")}</TabsTrigger>
            </TabsList>
          </div>

          {/* ----- Who to call, oldest debt first ----- */}
          <TabsContent value="families" className="mt-4">
            {arrears.rows.length === 0 ? (
              <EmptyState
                icon={
                  <EmptyIcon tone="success">
                    <CircleCheck />
                  </EmptyIcon>
                }
                title={t("arrears.empty")}
                description={t("arrears.emptyHint")}
              />
            ) : (
              <Card className="gap-0 overflow-hidden py-0 shadow-sm">
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader className="bg-muted/40 [&_th]:text-xs [&_th]:font-semibold">
                      <TableRow>
                        <TableHead className="ps-4 text-muted-foreground">
                          {t("arrears.columns.child")}
                        </TableHead>
                        <TableHead className="text-muted-foreground">
                          {t("arrears.columns.class")}
                        </TableHead>
                        <TableHead className="text-end text-muted-foreground">
                          {t("arrears.columns.months")}
                        </TableHead>
                        <TableHead className="text-end text-foreground">
                          {t("arrears.columns.total")}
                        </TableHead>
                        <TableHead className="text-muted-foreground">
                          {t("arrears.columns.days")}
                        </TableHead>
                        <TableHead className="text-muted-foreground">
                          {t("arrears.columns.guardian")}
                        </TableHead>
                        <TableHead className="pe-4 text-end text-muted-foreground">
                          {t("arrears.columns.actions")}
                        </TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {arrears.rows.map((f) => {
                        const badge = daysBadge(f.daysOverdue);
                        const phone = f.guardianPhone;
                        return (
                          <TableRow key={f.childId} className="h-14">
                            <TableCell className="ps-4 font-medium">{familyName(f)}</TableCell>
                            <TableCell className="text-muted-foreground">
                              {f.className ?? "—"}
                            </TableCell>
                            <TableCell className="text-end tabular-nums">
                              {t("arrears.monthsOwed", { count: f.invoiceCount })}
                            </TableCell>
                            <TableCell
                              className={cn(
                                "text-end font-bold tabular-nums",
                                f.daysOverdue > 30 && "text-destructive"
                              )}
                            >
                              {formatDZD(f.outstanding, locale)}
                            </TableCell>
                            <TableCell>
                              <Badge variant={badge.variant} className={badge.className}>
                                {t("arrears.daysBadge", { count: f.daysOverdue })}
                              </Badge>
                              {f.oldestDue && (
                                <div className="mt-0.5 text-xs text-muted-foreground">
                                  {t("arrears.dueSince", { date: formatDate(f.oldestDue, locale) })}
                                </div>
                              )}
                            </TableCell>
                            <TableCell>
                              {phone ? (
                                <>
                                  {f.guardianName && (
                                    <div className="truncate font-medium">{f.guardianName}</div>
                                  )}
                                  <a
                                    href={telHref(phone)}
                                    className="text-xs tabular-nums text-muted-foreground hover:text-primary hover:underline"
                                    dir="ltr"
                                  >
                                    {formatPhone(phone)}
                                  </a>
                                </>
                              ) : (
                                <span className="text-xs text-muted-foreground">
                                  {f.guardianName ?? t("arrears.noGuardian")}
                                </span>
                              )}
                            </TableCell>
                            <TableCell className="pe-4">
                              <div className="flex items-center justify-end gap-1">
                                {phone && (
                                  <>
                                    <Button
                                      variant="ghost"
                                      size="icon"
                                      asChild
                                      aria-label={t("arrears.call")}
                                    >
                                      <a href={telHref(phone)}>
                                        <Phone />
                                      </a>
                                    </Button>
                                    <Button
                                      variant="ghost"
                                      size="icon"
                                      asChild
                                      aria-label={t("arrears.whatsapp")}
                                      className="text-success hover:bg-success/10 hover:text-success"
                                    >
                                      <a
                                        href={reminderLink(f, phone)}
                                        target="_blank"
                                        rel="noopener noreferrer"
                                      >
                                        <MessageCircle />
                                      </a>
                                    </Button>
                                  </>
                                )}
                              </div>
                            </TableCell>
                          </TableRow>
                        );
                      })}
                      <TableRow className="bg-muted/50 hover:bg-muted/50">
                        <TableCell colSpan={3} className="ps-4 font-semibold">
                          {t("arrears.totalRow")}
                        </TableCell>
                        <TableCell className="text-end text-base font-bold tabular-nums">
                          {formatDZD(
                            arrears.rows.reduce((s, f) => s + f.outstanding, 0),
                            locale
                          )}
                        </TableCell>
                        <TableCell colSpan={3} className="pe-4" />
                      </TableRow>
                    </TableBody>
                  </Table>
                </div>
              </Card>
            )}
          </TabsContent>

          {/* ----- The same debt, aged into buckets ----- */}
          <TabsContent value="aging" className="mt-4">
            <Card className="gap-0 overflow-hidden py-0 shadow-sm">
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader className="bg-muted/40 [&_th]:text-xs [&_th]:font-semibold">
                    <TableRow>
                      <TableHead className="ps-4 text-muted-foreground">
                        {t("arrears.columns.child")}
                      </TableHead>
                      <TableHead className="text-muted-foreground">
                        {t("arrears.columns.phone")}
                      </TableHead>
                      {bucketLabels.map((label, i) => (
                        <TableHead key={i} className={cn("text-end", BUCKET_TEXT[i])}>
                          {label}
                        </TableHead>
                      ))}
                      <TableHead className="pe-4 text-end text-foreground">
                        {t("arrears.columns.total")}
                      </TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {aging.map((a) => {
                      const phone = phoneByChild.get(a.childId);
                      return (
                        <TableRow key={a.childId} className="h-14">
                          <TableCell className="ps-4">
                            <div className="font-medium">{a.name}</div>
                            {a.className && (
                              <div className="text-xs text-muted-foreground">{a.className}</div>
                            )}
                          </TableCell>
                          <TableCell>
                            {phone ? (
                              <a
                                href={telHref(phone)}
                                className="tabular-nums hover:text-primary hover:underline"
                                dir="ltr"
                              >
                                {formatPhone(phone)}
                              </a>
                            ) : (
                              <span className="text-muted-foreground">—</span>
                            )}
                          </TableCell>
                          {a.buckets.map((amount, i) => (
                            <TableCell
                              key={i}
                              className={cn(
                                "text-end tabular-nums",
                                amount === 0 ? "text-muted-foreground" : BUCKET_TEXT[i],
                                amount > 0 && BUCKET_CELL[i]
                              )}
                            >
                              {amount > 0 ? formatDZD(amount, locale) : "—"}
                            </TableCell>
                          ))}
                          <TableCell className="pe-4 text-end font-bold tabular-nums">
                            {formatDZD(a.total, locale)}
                          </TableCell>
                        </TableRow>
                      );
                    })}
                    <TableRow className="bg-muted/50 hover:bg-muted/50">
                      <TableCell colSpan={2} className="ps-4 font-semibold">
                        {t("arrears.totalRow")}
                      </TableCell>
                      {bucketTotals.map((amount, i) => (
                        <TableCell
                          key={i}
                          className={cn(
                            "text-end font-medium tabular-nums",
                            amount === 0 ? "text-muted-foreground" : BUCKET_TEXT[i]
                          )}
                        >
                          {amount > 0 ? formatDZD(amount, locale) : "—"}
                        </TableCell>
                      ))}
                      <TableCell className="pe-4 text-end text-base font-bold tabular-nums">
                        {formatDZD(grandTotal, locale)}
                      </TableCell>
                    </TableRow>
                  </TableBody>
                </Table>
              </div>
            </Card>
          </TabsContent>
        </Tabs>
      )}
    </div>
  );
}
