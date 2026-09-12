import Link from "next/link";
import { ArrowLeft, Clock, DoorOpen, Inbox, Sparkles, Users, Wallet } from "lucide-react";
import { getLocale, getTranslations } from "next-intl/server";
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
import { SectionCard } from "@/components/shared/section-card";
import { StatCard } from "@/components/shared/stat-card";
import { StatusPill, type StatusTone } from "@/components/shared/status-pill";
import { ValueRange } from "@/components/shared/value-range";
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
  roomName,
  structureName,
  type ActivityFormValues,
  type EnrollCandidate,
  type Structure,
} from "@/components/modules/classes/class-types";
import { readRoomChoices } from "@/components/modules/rooms/occupancy-data";

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

/** The row as the table has it — `Activity` is shared and does not carry the column yet. */
type ActivityRow = Activity & { structure_id: string | null };

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
    room_id: a.room_id ?? null,
  };
}

// By meaning, not by module: an active enrolment is the expected state and
// carries no pill — six solid "Inscrit" badges said nothing — a request waits
// on a person (gold), an ended one is history (muted), a cancelled one was
// refused (red).
const STATUS_TONE: Record<EnrollmentStatus, StatusTone | null> = {
  requested: "attention",
  active: null,
  ended: "muted",
  cancelled: "danger",
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
  const tc = await getTranslations("common");
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
  const activity = activityRow as ActivityRow;

  const canManage = ctx.isAdmin;
  const canEnroll = ctx.role !== "accountant";

  // Whom the add-a-child picker may offer. An activity that belongs to a
  // structure offers that structure's children and nobody else's: an educator
  // was being shown every child in the building, crèche babies among
  // five-year-olds, and the wrong name bills that family the same day (0033).
  // An activity open to the whole building (null) still offers everyone.
  let candidateQuery = supabase
    .from("kg_children")
    .select("id, first_name, last_name, first_name_ar, last_name_ar")
    .eq("tenant_id", ctx.tenant.id)
    .eq("status", "enrolled")
    .order("first_name");
  if (activity.structure_id) {
    candidateQuery = candidateQuery.eq("structure_id", activity.structure_id);
  }

  const [
    { data: enrollmentRows },
    { data: candidateRows },
    { data: paidRows },
    { data: structureRows },
    { rooms, homeClasses },
  ] = await Promise.all([
    supabase
      .from("kg_activity_enrollments")
      .select(
        "id, child_id, status, start_date, created_at, kg_children(id, first_name, last_name, first_name_ar, last_name_ar, kg_classes(name, name_ar))"
      )
      .eq("tenant_id", ctx.tenant.id)
      .eq("activity_id", id)
      .order("created_at", { ascending: false }),
    candidateQuery,
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
    // The structures of the establishment (0125) — for the edit dialog's
    // picker, and to name this activity's own structure in the header.
    supabase
      .from("kg_structures")
      .select("id, name, name_ar, center_type, color, sort_order, active")
      .eq("tenant_id", ctx.tenant.id)
      .order("sort_order")
      .order("name"),
    // The building's rooms, to name this activity's own and to fill the
    // edit dialog's picker; the dialog reads the occupancy itself on open.
    readRoomChoices(supabase, ctx, locale),
  ]);

  const structures = (structureRows ?? []) as Structure[];
  const room = activity.room_id ? rooms.find((r) => r.id === activity.room_id) ?? null : null;
  const structure = activity.structure_id
    ? structures.find((s) => s.id === activity.structure_id) ?? null
    : null;

  const enrollments = ((enrollmentRows ?? []) as unknown as EnrollmentRow[]).filter(
    (e) => e.kg_children
  );

  const requests = enrollments.filter((e) => e.status === "requested");
  // Enrolled table shows the roster + its history; requests live in their own card.
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

  // Sorted by the normaliser; both stored spellings read whole before 0156.
  const slots = asScheduleSlots(activity.schedule);
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
    // Under two structures this would be the same word on every activity —
    // and it is here to explain why the add-a-child list is as short as it is.
    ...(structures.length > 1
      ? [structure ? structureName(structure, locale) : t("structures.wholeBuilding")]
      : []),
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
              {!activity.active && <StatusPill tone="muted">{t("list.inactive")}</StatusPill>}
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
              <ActivityDialog
                activity={toFormValues(activity)}
                openingHours={openingHours}
                structures={structures}
                structureId={activity.structure_id}
                rooms={rooms}
                homeClasses={homeClasses}
                enrolled={activeCount}
              />
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
              <Badge key={`${s.day}-${s.start}-${i}`} variant="outline" className="bg-muted/50">
                <span className="font-semibold">{t(`daysFull.${s.day}`)}</span>
                <ValueRange
                  from={s.start}
                  to={s.end}
                  separator="–"
                  className="tabular-nums text-muted-foreground"
                />
              </Badge>
            ))}
          </>
        )}
        {/* The room is one fact for the whole activity, said once beside the
            slots. The stored name already says "Salle 2", so the visible
            label is the door icon alone — "Salle Salle 2" is the one thing
            this line must never read — and the fact's name stays for a
            screen reader. */}
        {room && (
          <>
            <span aria-hidden className="text-muted-foreground">
              ·
            </span>
            <span className="inline-flex items-center gap-1.5 text-sm">
              <DoorOpen className="size-4 text-muted-foreground" aria-hidden />
              <span className="sr-only">{tc("rooms.room")}</span>
              <bdi dir="auto" className="font-medium">
                {roomName(room, locale)}
              </bdi>
            </span>
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

      {/* The one section card, gold tile because it waits on a person; the
          requests are a divided list inside it, not a tinted frame each —
          the stat tile above already said "1" in gold, and a card in a
          gold ring around gold boxes said the same fact three more times. */}
      {requests.length > 0 && (
        <SectionCard
          icon={Inbox}
          tone={1}
          title={t("detail.pending.title")}
          hint={t("detail.pending.description")}
          className="mb-4"
          contentClassName="gap-0 divide-y divide-border"
        >
          {requests.map((e) => {
            const child = e.kg_children as ChildJoin;
            const cls = className(child);
            return (
              <div key={e.id} className="flex min-h-14 flex-wrap items-center justify-between gap-3 py-2">
                <div className="min-w-0">
                  <Link href={`/children/${child.id}`} className="block truncate text-sm font-semibold">
                    <bdi dir="auto">{childDisplayName(child, locale)}</bdi>
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
        </SectionCard>
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
                  const tone = STATUS_TONE[e.status];
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
                        {tone && <StatusPill tone={tone}>{t(`status.${e.status}`)}</StatusPill>}
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
