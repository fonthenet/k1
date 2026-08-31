import Link from "next/link";
import { ArrowLeft, Clock, Inbox, Sparkles, Users, Wallet } from "lucide-react";
import { getLocale, getTranslations } from "next-intl/server";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { EmptyState } from "@/components/shared/empty-state";
import { StatCard } from "@/components/shared/stat-card";
import { createClient } from "@/lib/supabase/server";
import { requireStaff } from "@/lib/tenant";
import { toOpeningHours } from "@/lib/week";
import { childDisplayName, formatDate, formatDZD } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { Activity } from "@/lib/types";
import { ActivityActiveToggle } from "@/components/modules/classes/activity-active-toggle";
import { ActivityDialog } from "@/components/modules/classes/activity-dialog";
import { AddEnrollmentDialog } from "@/components/modules/classes/add-enrollment-dialog";
import { CategoryIcon } from "@/components/modules/classes/category-icon";
import {
  EndEnrollmentButton,
  RequestActions,
} from "@/components/modules/classes/enrollment-actions";
import { ACTIVITY_CATEGORIES } from "@/components/modules/classes/class-types";
import {
  algiersToday,
  asScheduleSlots,
  sortSchedule,
  type ActivityFormValues,
  type EnrollCandidate,
} from "@/components/modules/classes/class-types";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type EnrollmentStatus = "requested" | "active" | "ended" | "cancelled";

type ChildJoin = {
  id: string;
  first_name: string;
  last_name: string;
  first_name_ar: string | null;
  last_name_ar: string | null;
  kg_classes: { name: string; name_ar: string | null } | null;
};

type EnrollmentRow = {
  id: string;
  child_id: string;
  status: EnrollmentStatus;
  start_date: string | null;
  created_at: string;
  kg_children: ChildJoin | null;
};

type CandidateRow = {
  id: string;
  first_name: string;
  last_name: string;
  first_name_ar: string | null;
  last_name_ar: string | null;
};

/** Row → the shape the edit dialog expects. */
function toFormValues(a: Activity): ActivityFormValues {
  return {
    id: a.id,
    name: a.name,
    name_ar: a.name_ar,
    description: a.description,
    category: a.category,
    fee_amount: Number(a.fee_amount),
    fee_period: a.fee_period,
    schedule: asScheduleSlots(a.schedule),
    capacity: a.capacity,
    active: a.active,
  };
}

const STATUS_VARIANT: Record<EnrollmentStatus, "default" | "secondary" | "destructive" | "outline"> =
  {
    requested: "secondary",
    active: "default",
    ended: "outline",
    cancelled: "destructive",
  };

export default async function ActivityDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const ctx = await requireStaff();
  const openingHours = toOpeningHours(
    (ctx.tenant as { opening_hours?: unknown }).opening_hours
  );
  const t = await getTranslations("activities");
  const locale = await getLocale();
  const supabase = await createClient();

  const backLink = (
    <Button asChild variant="ghost" size="sm" className="-ms-2 mb-2">
      <Link href="/activities">
        <ArrowLeft data-icon="inline-start" className="rtl:-scale-x-100" />
        {t("detail.back")}
      </Link>
    </Button>
  );

  const { data: activityRow } = UUID_RE.test(id)
    ? await supabase
        .from("kg_activities")
        .select("*")
        .eq("id", id)
        .eq("tenant_id", ctx.tenant.id)
        .maybeSingle()
    : { data: null };

  if (!activityRow) {
    return (
      <div>
        {backLink}
        <EmptyState
          icon={
            <span className="flex size-14 items-center justify-center rounded-2xl bg-muted text-muted-foreground [&>svg]:size-7">
              <Sparkles />
            </span>
          }
          title={t("detail.notFound")}
          description={t("detail.notFoundDescription")}
        />
      </div>
    );
  }
  const activity = activityRow as Activity;

  const canManage = ctx.isAdmin;
  const canEnroll = ctx.role !== "accountant";

  const [{ data: enrollmentRows }, { data: candidateRows }, { data: paidRows }] = await Promise.all([
    supabase
      .from("kg_activity_enrollments")
      .select(
        "id, child_id, status, start_date, created_at, kg_children(id, first_name, last_name, first_name_ar, last_name_ar, kg_classes(name, name_ar))"
      )
      .eq("tenant_id", ctx.tenant.id)
      .eq("activity_id", id)
      .order("created_at", { ascending: false }),
    supabase
      .from("kg_children")
      .select("id, first_name, last_name, first_name_ar, last_name_ar")
      .eq("tenant_id", ctx.tenant.id)
      .eq("status", "enrolled")
      .order("first_name"),
    // Whose invoice for this month has already been paid into. Enrolling one of
    // those children adds a fee that `trg_kg_activity_enrollment_billing` (0033)
    // can no longer take back off the invoice, so the dialog has to say so
    // before the write. Educators get nothing here — `inv_sel` (0003) is
    // finance-only — and the dialog then falls back to the plain hint.
    ctx.isFinance
      ? supabase
          .from("kg_invoices")
          .select("child_id")
          .eq("tenant_id", ctx.tenant.id)
          .eq("period_month", `${algiersToday().slice(0, 7)}-01`)
          .neq("status", "void")
          .gt("paid_amount", 0)
      : Promise.resolve({ data: [] }),
  ]);

  const enrollments = ((enrollmentRows ?? []) as unknown as EnrollmentRow[]).filter(
    (e) => e.kg_children
  );

  const requests = enrollments.filter((e) => e.status === "requested");
  // Enrolled table shows the roster + its history; requests live in their own section.
  const roster = enrollments.filter((e) => e.status !== "requested");
  const activeCount = enrollments.filter((e) => e.status === "active").length;

  // A child already active or awaiting approval can't be enrolled again.
  const takenIds = new Set(
    enrollments.filter((e) => e.status === "active" || e.status === "requested").map((e) => e.child_id)
  );
  const candidates: EnrollCandidate[] = ((candidateRows ?? []) as CandidateRow[])
    .filter((c) => !takenIds.has(c.id))
    .map((c) => ({ id: c.id, name: childDisplayName(c, locale) }));
  const lockedChildIds = [
    ...new Set(((paidRows ?? []) as { child_id: string }[]).map((r) => r.child_id)),
  ];

  const slots = sortSchedule(asScheduleSlots(activity.schedule));
  const fee = Number(activity.fee_amount);
  const displayName = locale === "ar" && activity.name_ar ? activity.name_ar : activity.name;
  const full = activity.capacity != null && activeCount >= activity.capacity;
  const revenue = activeCount * fee;

  const headerMeta = [
    t(`categories.${
      (ACTIVITY_CATEGORIES as readonly string[]).includes(activity.category)
        ? activity.category
        : "general"
    }` as Parameters<typeof t>[0]),
    fee > 0 ? `${formatDZD(fee, locale)} · ${t(`periods.${activity.fee_period}`)}` : t("list.free"),
  ].join(" · ");

  const className = (c: ChildJoin) =>
    c.kg_classes
      ? locale === "ar" && c.kg_classes.name_ar
        ? c.kg_classes.name_ar
        : c.kg_classes.name
      : null;

  return (
    <div>
      {backLink}

      <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-start gap-3.5">
          <CategoryIcon category={activity.category} className="size-12 [&>svg]:size-6" />
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="text-2xl font-bold tracking-tight">{displayName}</h2>
              {!activity.active && <Badge variant="outline">{t("list.inactive")}</Badge>}
            </div>
            <p className="mt-1 text-sm text-muted-foreground">{headerMeta}</p>
            {activity.description && (
              <p className="mt-1 max-w-prose text-sm text-muted-foreground">
                {activity.description}
              </p>
            )}
          </div>
        </div>
        <div className="flex items-center gap-2">
          {canEnroll && (
            <AddEnrollmentDialog
              activityId={activity.id}
              candidates={candidates}
              lockedChildIds={lockedChildIds}
            />
          )}
          {canManage && (
            <>
              <ActivityDialog activity={toFormValues(activity)} openingHours={openingHours} />
              <ActivityActiveToggle activityId={activity.id} active={activity.active} />
            </>
          )}
        </div>
      </div>

      <div className="mb-4 flex flex-wrap items-center gap-1.5 rounded-xl border border-border bg-card px-3.5 py-2.5 shadow-sm">
        {slots.length === 0 ? (
          <span className="inline-flex items-center gap-1.5 text-sm text-muted-foreground">
            <Clock className="size-4" />
            {t("detail.schedule.none")}
          </span>
        ) : (
          <>
            <span className="inline-flex items-center gap-1.5 text-sm text-muted-foreground">
              <Clock className="size-4" />
              {t("detail.schedule.title")}
            </span>
            {slots.map((s, i) => (
              <Badge key={`${s.day}-${s.time}-${i}`} variant="outline" className="bg-muted/50">
                <span className="font-semibold">{t(`daysFull.${s.day}`)}</span>
                <span className="tabular-nums text-muted-foreground">{s.time.slice(0, 5)}</span>
              </Badge>
            ))}
          </>
        )}
      </div>

      <div className="mb-4 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          label={t("detail.stats.enrolled")}
          value={activeCount}
          icon={<Users className="size-5" />}
          tone={full ? "warning" : "default"}
          hint={full ? t("detail.stats.full") : undefined}
        />
        <StatCard
          label={t("detail.stats.capacity")}
          value={activity.capacity ?? "—"}
          icon={<Users className="size-5" />}
          hint={activity.capacity == null ? t("list.noCapacity") : undefined}
        />
        <StatCard
          label={t("detail.stats.requests")}
          value={requests.length}
          icon={<Inbox className="size-5" />}
          tone={requests.length > 0 ? "warning" : "default"}
        />
        <StatCard
          label={t("detail.revenue.title")}
          value={fee > 0 ? formatDZD(revenue, locale) : "—"}
          icon={<Wallet className="size-5" />}
          tone={fee > 0 ? "success" : "default"}
          hint={
            fee > 0
              ? `${t("detail.revenue.line", {
                  count: activeCount,
                  fee: formatDZD(fee, locale),
                })} · ${t("detail.revenue.period", { period: t(`periods.${activity.fee_period}`) })}`
              : t("detail.revenue.free")
          }
        />
      </div>

      {requests.length > 0 && (
        <Card className="mb-4 shadow-sm ring-gold/40">
          <CardHeader>
            <CardTitle className="flex items-center gap-2.5 text-base">
              <span className="flex size-8 items-center justify-center rounded-lg bg-gold text-gold-foreground">
                <Inbox className="size-4" />
              </span>
              {t("detail.pending.title")}
            </CardTitle>
            <p className="text-sm text-muted-foreground">{t("detail.pending.description")}</p>
          </CardHeader>
          <CardContent className="space-y-2">
            {requests.map((e) => {
              const child = e.kg_children as ChildJoin;
              const cls = className(child);
              return (
                <div
                  key={e.id}
                  className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-gold/40 bg-gold/10 p-3.5"
                >
                  <div className="min-w-0">
                    <Link
                      href={`/children/${child.id}`}
                      className="block truncate text-sm font-semibold hover:underline"
                    >
                      {childDisplayName(child, locale)}
                    </Link>
                    <div className="text-xs text-muted-foreground">
                      {cls ?? t("detail.enrollments.noClass")}
                      {" · "}
                      {t("detail.pending.requestedOn")} {formatDate(e.created_at, locale)}
                    </div>
                  </div>
                  {canEnroll && <RequestActions activityId={activity.id} enrollmentId={e.id} />}
                </div>
              );
            })}
          </CardContent>
        </Card>
      )}

      {roster.length === 0 ? (
        <EmptyState
          icon={
            <span className="flex size-14 items-center justify-center rounded-2xl bg-primary/10 text-primary [&>svg]:size-7">
              <Users />
            </span>
          }
          title={t("detail.enrollments.empty")}
          description={t("detail.enrollments.emptyDescription")}
          action={
            canEnroll ? (
              <AddEnrollmentDialog
                activityId={activity.id}
                candidates={candidates}
                lockedChildIds={lockedChildIds}
              />
            ) : undefined
          }
        />
      ) : (
        <Card className="overflow-hidden py-0 shadow-sm">
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow className="[&>th]:font-semibold">
                  <TableHead>{t("detail.enrollments.child")}</TableHead>
                  <TableHead>{t("detail.enrollments.class")}</TableHead>
                  <TableHead>
                    {t("detail.enrollments.startDate")}
                  </TableHead>
                  <TableHead>{t("detail.enrollments.status")}</TableHead>
                  <TableHead className="text-end">
                    {t("detail.enrollments.actions")}
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {roster.map((e) => {
                  const child = e.kg_children as ChildJoin;
                  const cls = className(child);
                  const name = childDisplayName(child, locale);
                  return (
                    <TableRow
                      key={e.id}
                      className={cn(
                        "transition-colors hover:bg-primary/5",
                        e.status !== "active" && "opacity-65"
                      )}
                    >
                      <TableCell className="font-semibold">
                        <Link href={`/children/${child.id}`} className="hover:underline">
                          {name}
                        </Link>
                      </TableCell>
                      <TableCell className="text-muted-foreground">
                        {cls ?? t("detail.enrollments.noClass")}
                      </TableCell>
                      <TableCell className="tabular-nums text-muted-foreground">
                        {e.start_date ? formatDate(e.start_date, locale) : "—"}
                      </TableCell>
                      <TableCell>
                        <Badge variant={STATUS_VARIANT[e.status]}>{t(`status.${e.status}`)}</Badge>
                      </TableCell>
                      <TableCell className="text-end">
                        {canEnroll && e.status === "active" && (
                          <EndEnrollmentButton
                            activityId={activity.id}
                            enrollmentId={e.id}
                            childId={child.id}
                            childName={name}
                          />
                        )}
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
