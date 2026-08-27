import Link from "next/link";
import { ArrowLeft, Baby, CalendarCheck, School, Users } from "lucide-react";
import { getLocale, getTranslations } from "next-intl/server";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { EmptyState } from "@/components/shared/empty-state";
import { createClient } from "@/lib/supabase/server";
import { requireStaff, signedMediaUrl } from "@/lib/tenant";
import { ageFromDob, childDisplayName, initials } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { AttendanceStatus, ChildStatus, KgClass } from "@/lib/types";
import { AssignChildrenDialog } from "@/components/modules/classes/assign-children-dialog";
import { ClassDialog } from "@/components/modules/classes/class-dialog";
import { ClassStaffCard } from "@/components/modules/classes/class-staff-card";
import { DeleteClassButton } from "@/components/modules/classes/delete-class-button";
import { UnassignChildButton } from "@/components/modules/classes/unassign-child-button";
import {
  algiersToday,
  yearsLabel,
  type AssignCandidate,
  type AssignedStaff,
  type StaffOption,
} from "@/components/modules/classes/class-types";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type ClassChildRow = {
  id: string;
  first_name: string;
  last_name: string;
  first_name_ar: string | null;
  last_name_ar: string | null;
  dob: string;
  status: ChildStatus;
  photo_path: string | null;
};

type StaffJoinRow = {
  is_main: boolean;
  kg_memberships: { id: string; user_id: string; role: string; job_title: string | null } | null;
};

type MembershipRow = { id: string; user_id: string; role: string; job_title: string | null };

type CandidateRow = {
  id: string;
  first_name: string;
  last_name: string;
  first_name_ar: string | null;
  last_name_ar: string | null;
  kg_classes: { name: string; name_ar: string | null } | null;
};

const ATTENDANCE_KEYS: AttendanceStatus[] = ["present", "late", "absent", "excused", "sick"];

/** Tinted tiles for today's attendance snapshot — token colours only. */
const ATTENDANCE_TONE: Record<
  AttendanceStatus,
  { tile: string; value: string; label: string }
> = {
  present: {
    tile: "border-success/30 bg-success/10",
    value: "text-success",
    label: "text-muted-foreground",
  },
  // Solid gold: the accent tile, and the only pairing that stays readable in
  // both themes (gold-on-gold-tint is far too low contrast in light mode).
  late: {
    tile: "border-gold bg-gold",
    value: "text-gold-foreground",
    label: "text-gold-foreground/75",
  },
  absent: {
    tile: "border-destructive/30 bg-destructive/10",
    value: "text-destructive",
    label: "text-muted-foreground",
  },
  sick: {
    tile: "border-chart-4/30 bg-chart-4/10",
    value: "text-chart-4",
    label: "text-muted-foreground",
  },
  excused: {
    tile: "border-border bg-muted/40",
    value: "text-muted-foreground",
    label: "text-muted-foreground",
  },
};

export default async function ClassDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const ctx = await requireStaff();
  const t = await getTranslations("classes");
  const locale = await getLocale();
  const supabase = await createClient();

  const backLink = (
    <Button asChild variant="ghost" size="sm" className="-ms-2 mb-2">
      <Link href="/classes">
        <ArrowLeft data-icon="inline-start" className="rtl:-scale-x-100" />
        {t("detail.back")}
      </Link>
    </Button>
  );

  const { data: klassRow } = UUID_RE.test(id)
    ? await supabase
        .from("kg_classes")
        .select("*")
        .eq("id", id)
        .eq("tenant_id", ctx.tenant.id)
        .maybeSingle()
    : { data: null };

  if (!klassRow) {
    return (
      <div>
        {backLink}
        <EmptyState
          icon={
            <span className="flex size-14 items-center justify-center rounded-2xl bg-muted text-muted-foreground [&>svg]:size-7">
              <School />
            </span>
          }
          title={t("detail.notFound")}
          description={t("detail.notFoundDescription")}
        />
      </div>
    );
  }
  const klass = klassRow as KgClass;

  const canManage = ctx.isAdmin;
  const canAssign = ctx.role !== "accountant";

  const [
    { data: childRows },
    { data: staffRows },
    { data: poolRows },
    { data: candidateRows },
  ] = await Promise.all([
    supabase
      .from("kg_children")
      .select("id, first_name, last_name, first_name_ar, last_name_ar, dob, status, photo_path")
      .eq("tenant_id", ctx.tenant.id)
      .eq("class_id", id)
      .order("first_name"),
    supabase
      .from("kg_class_staff")
      .select("is_main, kg_memberships(id, user_id, role, job_title)")
      .eq("class_id", id),
    supabase
      .from("kg_memberships")
      .select("id, user_id, role, job_title")
      .eq("tenant_id", ctx.tenant.id)
      .eq("status", "active")
      .neq("role", "parent"),
    supabase
      .from("kg_children")
      .select("id, first_name, last_name, first_name_ar, last_name_ar, kg_classes(name, name_ar)")
      .eq("tenant_id", ctx.tenant.id)
      .eq("status", "enrolled")
      .or(`class_id.is.null,class_id.neq.${id}`)
      .order("first_name"),
  ]);

  const children = (childRows ?? []) as ClassChildRow[];
  const childIds = children.map((c) => c.id);
  const assignedRows = ((staffRows ?? []) as unknown as StaffJoinRow[]).filter(
    (r) => r.kg_memberships
  );
  const pool = (poolRows ?? []) as MembershipRow[];
  const today = algiersToday();

  const [{ data: allergyRows }, { data: attendanceRows }, { data: profiles }] = await Promise.all([
    childIds.length
      ? supabase
          .from("kg_child_allergies")
          .select("child_id, allergen")
          .eq("tenant_id", ctx.tenant.id)
          .in("child_id", childIds)
      : Promise.resolve({ data: [] as { child_id: string; allergen: string }[] }),
    childIds.length
      ? supabase
          .from("kg_attendance")
          .select("child_id, status")
          .eq("tenant_id", ctx.tenant.id)
          .eq("date", today)
          .in("child_id", childIds)
      : Promise.resolve({ data: [] as { child_id: string; status: AttendanceStatus }[] }),
    pool.length
      ? supabase
          .from("kg_profiles")
          .select("id, full_name")
          .in("id", [...new Set(pool.map((m) => m.user_id))])
      : Promise.resolve({ data: [] as { id: string; full_name: string }[] }),
  ]);

  const nameByUser = new Map((profiles ?? []).map((p) => [p.id, p.full_name]));
  const allergensByChild = new Map<string, string[]>();
  for (const a of allergyRows ?? []) {
    const arr = allergensByChild.get(a.child_id) ?? [];
    arr.push(a.allergen);
    allergensByChild.set(a.child_id, arr);
  }

  const photoByChild = new Map<string, string | null>();
  await Promise.all(
    children.map(async (c) => {
      photoByChild.set(c.id, await signedMediaUrl(c.photo_path));
    })
  );

  // --- staff card data ---
  const assignedIds = new Set(assignedRows.map((r) => r.kg_memberships!.id));
  const toOption = (m: MembershipRow): StaffOption => ({
    membershipId: m.id,
    name: nameByUser.get(m.user_id) ?? "—",
    subtitle: m.job_title ?? t(`roles.${m.role}` as Parameters<typeof t>[0]),
  });
  const assigned: AssignedStaff[] = assignedRows
    .map((r) => ({ ...toOption(r.kg_memberships as MembershipRow), isMain: r.is_main }))
    .sort((a, b) => Number(b.isMain) - Number(a.isMain) || a.name.localeCompare(b.name));
  const available: StaffOption[] = pool.filter((m) => !assignedIds.has(m.id)).map(toOption);

  // --- assign dialog data ---
  const candidates: AssignCandidate[] = ((candidateRows ?? []) as unknown as CandidateRow[]).map(
    (c) => ({
      id: c.id,
      name: childDisplayName(c, locale),
      currentClass: c.kg_classes
        ? locale === "ar" && c.kg_classes.name_ar
          ? c.kg_classes.name_ar
          : c.kg_classes.name
        : null,
    })
  );

  // --- occupancy + today's attendance ---
  const enrolledChildren = children.filter((c) => c.status === "enrolled");
  const enrolledCount = enrolledChildren.length;
  const full = enrolledCount >= klass.capacity;
  const pct = klass.capacity > 0 ? Math.min((enrolledCount / klass.capacity) * 100, 100) : 0;
  // Emerald while there's room, gold once it's nearly full, red when full.
  const nearlyFull = !full && pct >= 80;

  const enrolledIds = new Set(enrolledChildren.map((c) => c.id));
  const attendanceCounts = new Map<AttendanceStatus, number>();
  let marked = 0;
  for (const row of (attendanceRows ?? []) as { child_id: string; status: AttendanceStatus }[]) {
    if (!enrolledIds.has(row.child_id)) continue;
    marked += 1;
    attendanceCounts.set(row.status, (attendanceCounts.get(row.status) ?? 0) + 1);
  }
  const notMarked = Math.max(enrolledCount - marked, 0);

  const displayName = locale === "ar" && klass.name_ar ? klass.name_ar : klass.name;
  const ageRange =
    klass.age_min_months != null && klass.age_max_months != null
      ? t("ageRange.between", {
          min: yearsLabel(klass.age_min_months, locale),
          max: yearsLabel(klass.age_max_months, locale),
        })
      : klass.age_min_months != null
        ? t("ageRange.from", { min: yearsLabel(klass.age_min_months, locale) })
        : klass.age_max_months != null
          ? t("ageRange.upTo", { max: yearsLabel(klass.age_max_months, locale) })
          : t("ageRange.none");

  const description = [ageRange, klass.room ? t("list.room", { room: klass.room }) : null]
    .filter(Boolean)
    .join(" · ");

  return (
    <div>
      {backLink}
      <div className="mb-6 flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-start gap-3.5">
          {/* Same tile treatment as the class list. A tint with an ink glyph,
              not a solid fill with a white one: a crèche is free to pick a pale
              yellow, and white-on-pale-yellow is unreadable. kg_classes.color is
              user data, hence inline styles. */}
          <span
            className="flex size-12 shrink-0 items-center justify-center rounded-2xl text-foreground shadow-sm"
            style={{
              backgroundColor: `color-mix(in oklch, ${klass.color} 20%, transparent)`,
              boxShadow: `inset 0 0 0 1px color-mix(in oklch, ${klass.color} 45%, transparent)`,
            }}
            aria-hidden
          >
            <School className="size-6" />
          </span>
          <div>
            <h2 className="text-2xl font-bold tracking-tight">{displayName}</h2>
            <p className="mt-1 text-sm text-muted-foreground">{description}</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {canAssign && <AssignChildrenDialog
            classId={klass.id}
            candidates={candidates}
            spotsLeft={klass.capacity - enrolledCount}
          />}
          {canManage && (
            <>
              <ClassDialog klass={klass} />
              <DeleteClassButton classId={klass.id} childCount={children.length} redirectTo="/classes" />
            </>
          )}
        </div>
      </div>

      <div className="grid items-start gap-4 lg:grid-cols-3">
        <Card className="shadow-sm lg:col-span-2">
          <CardHeader>
            <CardTitle className="flex items-center gap-2.5 text-base">
              <span className="flex size-8 items-center justify-center rounded-lg bg-primary/10 text-primary">
                <Baby className="size-4" />
              </span>
              {t("detail.children.title", { count: children.length })}
            </CardTitle>
          </CardHeader>
          <CardContent>
            {children.length === 0 ? (
              <EmptyState
                icon={
                  <span className="flex size-14 items-center justify-center rounded-2xl bg-primary/10 text-primary [&>svg]:size-7">
                    <Baby />
                  </span>
                }
                title={t("detail.children.empty")}
                description={t("detail.children.emptyDescription")}
              />
            ) : (
              <div className="grid gap-3 sm:grid-cols-2">
                {children.map((c) => {
                  const allergens = allergensByChild.get(c.id) ?? [];
                  return (
                    <div
                      key={c.id}
                      className="flex items-start gap-3 rounded-xl border border-border p-3 transition-colors hover:bg-primary/5"
                    >
                      <Avatar className="size-11 ring-1 ring-border">
                        {photoByChild.get(c.id) && (
                          <AvatarImage
                            src={photoByChild.get(c.id) ?? undefined}
                            alt={childDisplayName(c, locale)}
                          />
                        )}
                        <AvatarFallback className="bg-primary/10 font-semibold text-primary">
                          {initials(c.first_name, c.last_name)}
                        </AvatarFallback>
                      </Avatar>
                      <div className="min-w-0 flex-1">
                        <Link
                          href={`/children/${c.id}`}
                          className="block truncate text-sm font-semibold hover:underline"
                        >
                          {childDisplayName(c, locale)}
                        </Link>
                        <div className="text-xs text-muted-foreground">
                          {ageFromDob(c.dob, locale)}
                        </div>
                        {(allergens.length > 0 || c.status !== "enrolled") && (
                          <div className="mt-1.5 flex flex-wrap gap-1">
                            {c.status !== "enrolled" && (
                              <Badge variant="secondary">
                                {t(`childStatus.${c.status}` as Parameters<typeof t>[0])}
                              </Badge>
                            )}
                            {allergens.slice(0, 2).map((a) => (
                              <Badge key={a} variant="destructive">
                                {a}
                              </Badge>
                            ))}
                            {allergens.length > 2 && (
                              <Badge variant="destructive">+{allergens.length - 2}</Badge>
                            )}
                          </div>
                        )}
                      </div>
                      {canAssign && (
                        <UnassignChildButton
                          classId={klass.id}
                          childId={c.id}
                          childName={childDisplayName(c, locale)}
                        />
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </CardContent>
        </Card>

        <div className="space-y-4">
          <Card className="shadow-sm">
            <CardHeader>
              <CardTitle className="flex items-center gap-2.5 text-base">
                <span className="flex size-8 items-center justify-center rounded-lg bg-primary/10 text-primary">
                  <Users className="size-4" />
                </span>
                {t("detail.occupancy.title")}
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-2.5">
              <div className="flex items-baseline justify-between gap-2">
                <span
                  className={cn(
                    "text-3xl font-bold tabular-nums",
                    full ? "text-destructive" : "text-foreground"
                  )}
                >
                  {enrolledCount}
                  <span className="text-lg font-medium text-muted-foreground">
                    {" / "}
                    {klass.capacity}
                  </span>
                </span>
                {full && <Badge variant="destructive">{t("list.full")}</Badge>}
              </div>
              <Progress
                value={pct}
                className={cn(
                  "h-2",
                  full && "[&_[data-slot=progress-indicator]]:bg-destructive",
                  nearlyFull && "[&_[data-slot=progress-indicator]]:bg-gold"
                )}
              />
            </CardContent>
          </Card>

          <Card className="shadow-sm">
            <CardHeader>
              <CardTitle className="flex items-center gap-2.5 text-base">
                <span className="flex size-8 items-center justify-center rounded-lg bg-gold text-gold-foreground">
                  <CalendarCheck className="size-4" />
                </span>
                {t("detail.attendance.title")}
              </CardTitle>
            </CardHeader>
            <CardContent>
              {enrolledCount === 0 ? (
                <p className="text-sm text-muted-foreground">{t("detail.attendance.noChildren")}</p>
              ) : (
                <div className="grid grid-cols-3 gap-2">
                  {ATTENDANCE_KEYS.map((k) => (
                    <div
                      key={k}
                      className={cn("rounded-xl border p-2 text-center", ATTENDANCE_TONE[k].tile)}
                    >
                      <div
                        className={cn(
                          "text-xl font-bold tabular-nums",
                          ATTENDANCE_TONE[k].value
                        )}
                      >
                        {attendanceCounts.get(k) ?? 0}
                      </div>
                      <div
                        className={cn("truncate text-xs font-medium", ATTENDANCE_TONE[k].label)}
                      >
                        {t(`detail.attendance.${k}` as Parameters<typeof t>[0])}
                      </div>
                    </div>
                  ))}
                  <div className="rounded-xl border border-border bg-muted/40 p-2 text-center">
                    <div className="text-xl font-bold tabular-nums text-muted-foreground">
                      {notMarked}
                    </div>
                    <div className="truncate text-xs font-medium text-muted-foreground">
                      {t("detail.attendance.notMarked")}
                    </div>
                  </div>
                </div>
              )}
            </CardContent>
          </Card>

          <ClassStaffCard
            classId={klass.id}
            assigned={assigned}
            available={available}
            canManage={canManage}
          />
        </div>
      </div>
    </div>
  );
}
