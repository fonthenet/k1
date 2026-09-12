import Link from "next/link";
import { ArrowLeft, BookOpen, CalendarCheck, School, UserRound, Users } from "lucide-react";
import { getLocale, getTranslations } from "next-intl/server";
import { ClassLearningCard, loadClassLearning } from "@/components/modules/learning/class-link";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { EmptyState } from "@/components/shared/empty-state";
import { IdentityBand } from "@/components/shared/identity-band";
import { SectionCard } from "@/components/shared/section-card";
import { StatCard } from "@/components/shared/stat-card";
import { StatusPill } from "@/components/shared/status-pill";
import { StructureMark } from "@/components/shared/structure-mark";
import { ChildAvatar } from "@/components/modules/children/child-avatar";
import { AllergyBadge } from "@/components/modules/children/allergy-badge";
import type { AllergyItem } from "@/components/modules/children/types";
import { createClient } from "@/lib/supabase/server";
import { requireStaff, signedMediaUrl } from "@/lib/tenant";
import { readRoomChoices } from "@/components/modules/rooms/occupancy-data";
import { ageFromDob, ageMonths, childDisplayName } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { AllergySeverity, AttendanceStatus, ChildStatus, KgClass } from "@/lib/types";
import { AssignChildrenDialog } from "@/components/modules/classes/assign-children-dialog";
import { ClassDialog } from "@/components/modules/classes/class-dialog";
import { ClassStaffCard } from "@/components/modules/classes/class-staff-card";
import { DeleteClassButton } from "@/components/modules/classes/delete-class-button";
import { UnassignChildButton } from "@/components/modules/classes/unassign-child-button";
import { ClassGlyph } from "@/components/modules/classes/class-icons";
import type { AssignableStaff, StaffPlace } from "@/components/modules/classes/assign-staff-dialog";
import {
  algiersToday,
  ageRangeLabel,
  roomName,
  structureName,
  type AssignCandidate,
  type AssignedStaff,
  type Room,
  type StaffOption,
  type Structure,
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

type MembershipRow = {
  id: string;
  // NULLABLE, and usually null: a membership only gains a user_id once the
  // person accepts an invite and creates an account. The cook, the cleaner
  // and most educators never do — they are typed into the team list by the
  // director and paid in cash. This was declared `string`, which is what let
  // the profile-only name lookup below type-check.
  user_id: string | null;
  full_name: string | null;
  role: string;
  job_title: string | null;
};

/** Every assignment in the building, joined to the class it is on. */
type PlacementRow = {
  membership_id: string;
  is_main: boolean;
  kg_classes: {
    id: string;
    name: string;
    name_ar: string | null;
    color: string;
    structure_id: string | null;
  } | null;
};

type CandidateRow = {
  id: string;
  first_name: string;
  last_name: string;
  first_name_ar: string | null;
  last_name_ar: string | null;
  kg_classes: { name: string; name_ar: string | null } | null;
};

/** Today's attendance as a pill: present is the good news, the rest needs
 *  someone, and "not marked" is no pill at all — the absence is the signal. */
const TODAY_TONE: Record<AttendanceStatus, "success" | "attention" | "danger"> = {
  present: "success",
  late: "attention",
  excused: "attention",
  sick: "attention",
  absent: "danger",
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
    <Link
      href="/classes"
      className="mb-3 inline-flex items-center gap-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground"
    >
      <ArrowLeft className="size-4 rtl:rotate-180" aria-hidden />
      {t("detail.back")}
    </Link>
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
          icon={<School />}
          title={t("detail.notFound")}
          description={t("detail.notFoundDescription")}
        />
      </div>
    );
  }
  const klass = klassRow as KgClass;

  const canManage = ctx.isAdmin;
  const canAssign = ctx.role !== "accountant";
  const today = algiersToday();

  const [
    { data: childRows },
    { data: staffRows },
    { data: poolRows },
    { data: candidateRows },
    { data: placementRows },
    { data: structureRows },
    { data: roomRow },
    roomChoices,
    learning,
  ] = await Promise.all([
    supabase
      .from("kg_children")
      .select("id, first_name, last_name, first_name_ar, last_name_ar, dob, status, photo_path")
      .eq("tenant_id", ctx.tenant.id)
      .eq("class_id", id)
      .order("first_name"),
    supabase
      .from("kg_class_staff")
      .select("is_main, kg_memberships(id, user_id, full_name, role, job_title)")
      .eq("class_id", id),
    supabase
      .from("kg_memberships")
      .select("id, user_id, full_name, role, job_title")
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
    // Where everyone ALREADY is — the assign dialog shows it beside each
    // name, so the director sees that Leïla leads Petite Section before
    // giving her this class too. kg_class_staff has no tenant_id; it is
    // scoped through the class it points at.
    supabase
      .from("kg_class_staff")
      .select("membership_id, is_main, kg_classes!inner(id, name, name_ar, color, structure_id, tenant_id)")
      .eq("kg_classes.tenant_id", ctx.tenant.id),
    supabase
      .from("kg_structures")
      .select("id, name, name_ar, center_type, color, sort_order, active")
      .eq("tenant_id", ctx.tenant.id)
      .order("sort_order")
      .order("name"),
    // The room through room_id (0123), so its name prints once in the
    // reader's script; kg_classes.room is only the legacy free text.
    klass.room_id
      ? supabase
          .from("kg_rooms")
          .select("id, name, name_ar, capacity, floor, notes, active")
          .eq("id", klass.room_id)
          .maybeSingle()
      : Promise.resolve({ data: null as Room | null }),
    // Every room with the classes that live in it, for the Modifier dialog's
    // Salle select — the same picker as on the list, at last, instead of an
    // "Aucune salle définie" notice on a building with six rooms.
    readRoomChoices(supabase, ctx, locale),
    loadClassLearning(supabase, ctx.tenant.id, id, today),
  ]);

  const children = (childRows ?? []) as ClassChildRow[];
  const childIds = children.map((c) => c.id);
  const assignedRows = ((staffRows ?? []) as unknown as StaffJoinRow[]).filter(
    (r) => r.kg_memberships
  );
  const pool = (poolRows ?? []) as MembershipRow[];

  const poolUserIds = [...new Set(pool.map((m) => m.user_id).filter((v): v is string => !!v))];

  const [{ data: allergyRows }, { data: attendanceRows }, { data: profiles }] = await Promise.all([
    childIds.length
      ? supabase
          .from("kg_child_allergies")
          .select("child_id, allergen, severity")
          .eq("tenant_id", ctx.tenant.id)
          .in("child_id", childIds)
      : Promise.resolve({ data: [] as { child_id: string; allergen: string; severity: string }[] }),
    childIds.length
      ? supabase
          .from("kg_attendance")
          .select("child_id, status")
          .eq("tenant_id", ctx.tenant.id)
          .eq("date", today)
          .in("child_id", childIds)
      : Promise.resolve({ data: [] as { child_id: string; status: AttendanceStatus }[] }),
    // The nulls MUST come out before this goes over the wire. PostgREST renders
    // the array literally as id=in.(null,<uuid>,…) and Postgres rejects that as
    // an invalid uuid, so a single accountless member failed the whole request
    // and left nameByUser empty — every name on the card, including those of
    // staff who do have accounts, fell back to the dash.
    poolUserIds.length
      ? supabase
          .from("kg_profiles")
          .select("id, full_name")
          .in("id", poolUserIds)
      : Promise.resolve({ data: [] as { id: string; full_name: string }[] }),
  ]);

  const nameByUser = new Map((profiles ?? []).map((p) => [p.id, p.full_name]));
  // The allergen travels raw: the shared badge names it in its tooltip and
  // sets its colour from the worst severity, exactly as the roster does.
  const allergiesByChild = new Map<string, AllergyItem[]>();
  for (const a of allergyRows ?? []) {
    const list = allergiesByChild.get(a.child_id) ?? [];
    list.push({ allergen: a.allergen, severity: a.severity as AllergySeverity });
    allergiesByChild.set(a.child_id, list);
  }

  const photoByChild = new Map<string, string | null>();
  await Promise.all(
    children.map(async (c) => {
      photoByChild.set(c.id, await signedMediaUrl(c.photo_path));
    })
  );

  // --- team ---
  const toOption = (m: MembershipRow): StaffOption => ({
    membershipId: m.id,
    // Profile first (a person with an account may have corrected their own
    // name), then the name the director typed. The dash is for neither.
    name: (m.user_id ? nameByUser.get(m.user_id) : null) || (m.full_name ?? "").trim() || "—",
    subtitle: m.job_title ?? t(`roles.${m.role}` as Parameters<typeof t>[0]),
  });
  const assigned: AssignedStaff[] = assignedRows
    .map((r) => ({ ...toOption(r.kg_memberships as MembershipRow), isMain: r.is_main }))
    .sort((a, b) => Number(b.isMain) - Number(a.isMain) || a.name.localeCompare(b.name));
  const main = assigned.find((s) => s.isMain);
  // The building has to run more than one structure for the word to help;
  // under one it would be the same label on every line.
  const structures = (structureRows ?? []) as Structure[];
  const structureById = new Map(structures.map((s) => [s.id, s] as const));
  const manyStructures = structures.length > 1;
  const structure = klass.structure_id ? structureById.get(klass.structure_id) : undefined;
  const placesByMember = new Map<string, StaffPlace[]>();
  for (const row of (placementRows ?? []) as unknown as PlacementRow[]) {
    if (!row.kg_classes || row.kg_classes.id === id) continue;
    const str = row.kg_classes.structure_id
      ? structureById.get(row.kg_classes.structure_id)
      : undefined;
    const list = placesByMember.get(row.membership_id) ?? [];
    list.push({
      classId: row.kg_classes.id,
      className:
        locale === "ar" && row.kg_classes.name_ar ? row.kg_classes.name_ar : row.kg_classes.name,
      classColor: row.kg_classes.color,
      isMain: row.is_main,
      // A class with no structure belongs to the whole building — said so,
      // rather than shown as a class from nowhere.
      structure: !manyStructures
        ? null
        : str
          ? { name: structureName(str, locale), color: str.color }
          : { name: t("assignStaff.wholeBuilding"), color: null },
    });
    placesByMember.set(row.membership_id, list);
  }
  // Direct assignments (0141): where a person works when no class says so.
  const { data: directRows } = manyStructures
    ? await supabase
        .from("kg_membership_structures")
        .select("membership_id, structure_id, kg_memberships!inner(tenant_id)")
        .eq("kg_memberships.tenant_id", ctx.tenant.id)
    : { data: [] as { membership_id: string; structure_id: string }[] };
  const directByMember = new Map<string, { name: string; color: string }[]>();
  for (const r of (directRows ?? []) as { membership_id: string; structure_id: string }[]) {
    const str = structureById.get(r.structure_id);
    if (!str) continue;
    const list = directByMember.get(r.membership_id) ?? [];
    list.push({ name: structureName(str, locale), color: str.color });
    directByMember.set(r.membership_id, list);
  }
  // The dialog lists EVERYONE, the current team included — it edits the whole
  // team, not the pool of people who could be added — which is why it does
  // not take a filtered list.
  const staffForDialog: AssignableStaff[] = pool
    .map((m) => ({
      ...toOption(m),
      elsewhere: placesByMember.get(m.id) ?? [],
      structures: directByMember.get(m.id) ?? [],
    }))
    .sort((a, b) => a.name.localeCompare(b.name));

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
  const spotsLeft = Math.max(klass.capacity - enrolledCount, 0);

  const enrolledIds = new Set(enrolledChildren.map((c) => c.id));
  const todayByChild = new Map<string, AttendanceStatus>();
  for (const row of (attendanceRows ?? []) as { child_id: string; status: AttendanceStatus }[]) {
    todayByChild.set(row.child_id, row.status);
  }
  let present = 0;
  let marked = 0;
  for (const childId of enrolledIds) {
    const status = todayByChild.get(childId);
    if (!status) continue;
    marked += 1;
    if (status === "present") present += 1;
  }
  const notMarked = Math.max(enrolledCount - marked, 0);

  const displayName = locale === "ar" && klass.name_ar ? klass.name_ar : klass.name;
  // The name in the other script, under the title, as the child file does.
  const otherName = locale === "ar" ? klass.name : klass.name_ar;
  const ageRange = ageRangeLabel(klass.age_min_months, klass.age_max_months, t);
  const room = roomRow as Room | null;
  const roomLabel = room ? roomName(room, locale) : klass.room;
  const dialogRooms = roomChoices.rooms.map((r) => ({
    ...r,
    classes: roomChoices.homeClasses[r.id] ?? [],
  }));

  // A child outside the class's own age band: the age turns warning, once,
  // with the reason on hover — no badge, no second mark.
  const outOfBand = (dob: string) => {
    const months = ageMonths(dob, today);
    return (
      (klass.age_min_months != null && months < klass.age_min_months) ||
      (klass.age_max_months != null && months > klass.age_max_months)
    );
  };

  const roster = [...children].sort((a, b) =>
    childDisplayName(a, locale).localeCompare(childDisplayName(b, locale), locale)
  );
  // Enrolled is the expected state and carries no pill, so the column only
  // exists once a row has something to say in it.
  const showStatus = roster.some((c) => c.status !== "enrolled");

  return (
    <div>
      {backLink}
      <IdentityBand
        leading={
          // The class colour appears once on the page, on this tile — a tint
          // with an ink glyph, so a pale yellow class stays legible.
          // kg_classes.color is user data, hence the inline style.
          <span
            className="flex size-14 items-center justify-center rounded-2xl text-foreground"
            style={{
              backgroundColor: `color-mix(in oklch, ${klass.color} 20%, transparent)`,
              boxShadow: `inset 0 0 0 1px color-mix(in oklch, ${klass.color} 45%, transparent)`,
            }}
            aria-hidden
          >
            <ClassGlyph icon={klass.icon} className="size-7" />
          </span>
        }
        title={displayName}
        subtitle={
          otherName && otherName !== displayName ? (
            // The band's subtitle detects its direction from the text, which
            // would push an Arabic name to the far edge of a French page; a
            // wrapper in the page's own direction keeps it under the title.
            <span dir={locale === "ar" ? "rtl" : "ltr"} className="block text-start">
              <bdi>{otherName}</bdi>
            </span>
          ) : undefined
        }
        facts={[
          manyStructures && structure ? (
            <StructureMark
              key="structure"
              structure={{ name: structureName(structure, locale), color: structure.color }}
            />
          ) : null,
          roomLabel ? <bdi key="room">{roomLabel}</bdi> : null,
          <span key="ages">{ageRange}</span>,
        ]}
        actions={
          <>
            {canAssign && (
              <AssignChildrenDialog classId={klass.id} candidates={candidates} spotsLeft={spotsLeft} />
            )}
            {canManage && (
              <>
                <ClassDialog klass={klass} rooms={dialogRooms} structures={structures} />
                <DeleteClassButton classId={klass.id} childCount={children.length} redirectTo="/classes" variant="menu" />
              </>
            )}
          </>
        }
      />

      <div className="mb-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          label={t("detail.stats.team")}
          value={assigned.length}
          // The lead is named once on the page, in the Équipe section; the
          // tile only says whether there is one.
          hint={main ? t("detail.stats.hasMain") : t("detail.stats.noMain")}
          icon={<Users className="size-5" />}
        />
        <StatCard
          label={t("detail.stats.fill")}
          value={
            // One ltr island for the pair, so Arabic never reads "24 / 6".
            <span dir="ltr" className={cn(full && "text-destructive")}>
              {enrolledCount}
              <span className="text-sm font-medium text-muted-foreground"> / {klass.capacity}</span>
            </span>
          }
          hint={full ? t("list.full") : t("detail.stats.spotsLeft", { count: spotsLeft })}
          icon={<UserRound className="size-5" />}
          tone={full ? "danger" : "default"}
        />
        <StatCard
          label={t("detail.stats.today")}
          value={present}
          hint={
            enrolledCount === 0
              ? t("detail.attendance.noChildren")
              : t("detail.stats.todayHint", { count: notMarked })
          }
          icon={<CalendarCheck className="size-5" />}
          tone="success"
        />
        <StatCard
          label={t("detail.stats.program")}
          value={learning.thisWeek}
          hint={t("detail.stats.weekHint", { count: learning.thisWeek })}
          icon={<BookOpen className="size-5" />}
        />
      </div>

      <div className="grid items-start gap-6 xl:grid-cols-3">
        <div className="grid gap-6 xl:col-span-2">
          <SectionCard
            icon={UserRound}
            tone={2}
            title={t("detail.children.title")}
            hint={t("detail.children.hint", { count: enrolledCount })}
            contentClassName={roster.length > 0 ? "gap-0 px-0 -mb-(--card-spacing)" : undefined}
          >
            {roster.length === 0 ? (
              <p className="text-sm text-muted-foreground">{t("detail.children.empty")}</p>
            ) : (
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow className="hover:bg-transparent [&>th]:text-sm [&>th]:font-medium [&>th]:text-muted-foreground [&>th:first-child]:ps-4 [&>th:last-child]:pe-4">
                      <TableHead>{t("detail.children.columns.child")}</TableHead>
                      <TableHead>{t("detail.children.columns.age")}</TableHead>
                      <TableHead>{t("detail.children.columns.allergies")}</TableHead>
                      <TableHead>{t("detail.children.columns.today")}</TableHead>
                      {showStatus && <TableHead>{t("detail.children.columns.status")}</TableHead>}
                      {canAssign && <TableHead className="w-12" />}
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {roster.map((c) => {
                      const name = childDisplayName(c, locale);
                      const otherScript =
                        locale === "ar"
                          ? `${c.first_name} ${c.last_name}`
                          : c.first_name_ar && c.last_name_ar
                            ? `${c.first_name_ar} ${c.last_name_ar}`
                            : null;
                      const todayStatus = todayByChild.get(c.id);
                      const off = outOfBand(c.dob);
                      return (
                        <TableRow
                          key={c.id}
                          className="relative h-14 transition-colors hover:bg-primary/5 last:border-b-0 [&>td:first-child]:ps-4 [&>td:last-child]:pe-4"
                        >
                          <TableCell>
                            {/* The row is the link: the overlay reaches every
                                cell, and the one control (remove) is lifted
                                above it. */}
                            <Link
                              href={`/children/${c.id}`}
                              className="flex items-center gap-3 after:absolute after:inset-0"
                            >
                              <ChildAvatar
                                firstName={c.first_name}
                                lastName={c.last_name}
                                photoUrl={photoByChild.get(c.id) ?? null}
                                className="size-10"
                              />
                              <span className="min-w-0">
                                <span className="block truncate font-semibold">{name}</span>
                                {otherScript && (
                                  <bdi className="block truncate text-xs text-muted-foreground text-start">
                                    {otherScript}
                                  </bdi>
                                )}
                              </span>
                            </Link>
                          </TableCell>
                          <TableCell
                            className={cn("text-muted-foreground", off && "text-warning-ink")}
                            title={off ? t("detail.children.outOfBand") : undefined}
                          >
                            {ageFromDob(c.dob, locale)}
                          </TableCell>
                          <TableCell>
                            <AllergyBadge allergens={allergiesByChild.get(c.id) ?? []} />
                          </TableCell>
                          <TableCell>
                            {todayStatus ? (
                              <StatusPill tone={TODAY_TONE[todayStatus]}>
                                {t(`detail.attendance.${todayStatus}` as Parameters<typeof t>[0])}
                              </StatusPill>
                            ) : (
                              <span className="text-muted-foreground">—</span>
                            )}
                          </TableCell>
                          {showStatus && (
                            <TableCell>
                              {c.status !== "enrolled" && (
                                <StatusPill tone="muted">
                                  {t(`childStatus.${c.status}` as Parameters<typeof t>[0])}
                                </StatusPill>
                              )}
                            </TableCell>
                          )}
                          {canAssign && (
                            <TableCell className="text-end">
                              <span className="relative z-10 inline-flex">
                                <UnassignChildButton classId={klass.id} childId={c.id} childName={name} />
                              </span>
                            </TableCell>
                          )}
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </div>
            )}
          </SectionCard>
        </div>

        <div className="grid gap-6">
          <ClassStaffCard
            classId={klass.id}
            className={displayName}
            assigned={assigned}
            staff={staffForDialog}
            canManage={canManage}
          />
          <ClassLearningCard classId={klass.id} learning={learning} />
        </div>
      </div>
    </div>
  );
}
