import Link from "next/link";
import { Fragment } from "react";
import { School, Users } from "lucide-react";
import { getLocale, getTranslations } from "next-intl/server";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Card, CardContent } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { EmptyState } from "@/components/shared/empty-state";
import { PageHeader } from "@/components/shared/page-header";
import { StructureGroupRow } from "@/components/shared/structure-group-row";
import { StaffLink } from "@/components/shared/entity-link";
import { buildWeekDays, readClosures, type ClosureRow } from "@/lib/closures";
import { createClient } from "@/lib/supabase/server";
import { requireStaff, scoped } from "@/lib/tenant";
import { initialsFromName } from "@/lib/format";
import { fetchProfileNames, memberNameIn } from "@/lib/member-names";
import { groupClassesByStructure } from "@/lib/structure-groups";
import { cn } from "@/lib/utils";
import { toOpeningHours } from "@/lib/week";
import type { KgClass } from "@/lib/types";
import { readRoomChoices, readRoomOccupancy } from "@/components/modules/rooms/occupancy-data";
import type { BusySlot, HomeClass } from "@/components/modules/rooms/room-state";
import { addDays, date as dateSchema, weekStart } from "@/components/modules/learning/domain";
import {
  AssignStaffDialog,
  type AssignableStaff,
  type StaffPlace,
} from "@/components/modules/classes/assign-staff-dialog";
import { ClassDialog } from "@/components/modules/classes/class-dialog";
import { ClassesTabs } from "@/components/modules/classes/classes-tabs";
import { FillBar } from "@/components/modules/classes/fill-bar";
import {
  ageRangeLabel,
  algiersToday,
  roomName,
  structureName,
  type AssignedStaff,
  type Room,
  type RoomChoice,
  type Structure,
} from "@/components/modules/classes/class-types";
import { RoomsPanel, type RoomWithUsage } from "@/components/modules/classes/rooms-panel";
import { RoomDialog } from "@/components/modules/classes/room-dialog";

/** One kg_class_staff row with the person on it — every class, every member. */
type ClassStaffRow = {
  class_id: string;
  is_main: boolean;
  kg_classes: {
    id: string;
    name: string;
    name_ar: string | null;
    color: string;
    structure_id: string | null;
  } | null;
  kg_memberships: {
    id: string;
    user_id: string | null;
    full_name: string | null;
    role: string;
    job_title: string | null;
    status: string;
  } | null;
};

type MemberRow = {
  id: string;
  user_id: string | null;
  full_name: string | null;
  role: string;
  job_title: string | null;
};

/** One row of kg_room_usage (0155): what still uses a room, in four counts. */
type UsageRow = {
  room_id: string;
  class_count: number;
  activity_count: number;
  upcoming_count: number;
  history_count: number;
};

/** How many faces a card shows before it says "+N". */
const AVATARS_SHOWN = 3;

export default async function ClassesPage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string; day?: string }>;
}) {
  const ctx = await requireStaff();
  const t = await getTranslations("classes");
  const tc = await getTranslations("common");
  const locale = await getLocale();
  const supabase = await createClient();
  const { tab, day: dayParam } = await searchParams;
  const showRooms = tab === "rooms";

  // The occupancy sheet reads the WEEK around ?day (D7) so its chevrons step
  // through the week without a round trip; the day itself is resolved
  // below, once the week's open days are known. The window is the building's
  // — the ledger is establishment-wide (D13), whatever the switcher shows.
  const today = algiersToday();
  const wantedDay = dateSchema.safeParse(dayParam).success ? (dayParam as string) : today;
  const week = weekStart(wantedDay);
  const weekEnd = addDays(week, 6);
  const weekFrom = `${week}T00:00:00+01:00`;
  const weekTo = `${addDays(week, 7)}T00:00:00+01:00`;

  const [
    { data: classRows, error },
    { data: enrolledRows },
    { data: staffRows },
    { data: roomRows },
    { data: structureRows },
    { data: memberRows },
    occupancy,
    { data: usageRows },
    { data: activityRows },
    closures,
  ] =
    await Promise.all([
      scoped(
        supabase.from("kg_classes").select("*").eq("tenant_id", ctx.tenant.id).order("name"),
        ctx
      ),
      supabase
        .from("kg_children")
        .select("class_id")
        .eq("tenant_id", ctx.tenant.id)
        .eq("status", "enrolled")
        .not("class_id", "is", null),
      // The whole team of every class, not just the main educator: the card
      // shows every face, and the assign dialog needs to say where each
      // person already is. Deliberately NOT scoped by the structure switcher:
      // the switcher narrows which classes are listed, but "Leïla already
      // leads Préscolaire" is true whichever side of the building is on
      // screen, so the class name travels with the row. kg_class_staff has no
      // tenant_id; the class join scopes it (RLS does the same on its side).
      supabase
        .from("kg_class_staff")
        .select(
          "class_id, is_main, kg_classes!inner(id, name, name_ar, color, structure_id, tenant_id), kg_memberships!inner(id, user_id, full_name, role, job_title, status)"
        )
        .eq("kg_classes.tenant_id", ctx.tenant.id),
      // Rooms (0123). Read by any member; only an admin sees the write
      // controls, which RLS enforces independently of this flag.
      supabase
        .from("kg_rooms")
        .select("id, name, name_ar, capacity, floor, notes, active")
        .eq("tenant_id", ctx.tenant.id)
        .order("name"),
      // The structures of the establishment (0125). One for most crèches, two for a
      // building that runs a crèche and a small school side by side.
      supabase
        .from("kg_structures")
        .select("id, name, name_ar, center_type, color, sort_order, active")
        .eq("tenant_id", ctx.tenant.id)
        .order("sort_order")
        .order("name"),
      // Everyone who could be put on a class. Read for every viewer, used
      // only when the viewer is an admin — the dialog does not render for
      // anyone else.
      ctx.isAdmin
        ? supabase
            .from("kg_memberships")
            .select("id, user_id, full_name, role, job_title")
            .eq("tenant_id", ctx.tenant.id)
            .eq("status", "active")
            .neq("role", "parent")
        : Promise.resolve({ data: [] as MemberRow[] }),
      // Every room with the classes that live in it — the class dialog's
      // tails — and, on the rooms tab, the week's bookings for the sheet.
      // Unscoped on purpose: "Aussi salle de 1re année" is true whichever
      // structure the switcher shows, and a room is booked by the whole
      // building. Always the signed-in member's client (kg_bookings is
      // authenticated-only).
      showRooms
        ? readRoomOccupancy(supabase, ctx, locale, weekFrom, weekTo)
        : readRoomChoices(supabase, ctx, locale).then((choices) => ({
            ...choices,
            busy: [] as BusySlot[],
          })),
      // The four counts per room (0155): the table's "Utilisée par" tail,
      // the delete sentence, the retire line. Rooms tab only.
      showRooms
        ? supabase.rpc("kg_room_usage", { p_tenant: ctx.tenant.id })
        : Promise.resolve({ data: [] as UsageRow[] }),
      // Active activities that meet in a room, by name, for the same cell.
      showRooms
        ? supabase
            .from("kg_activities")
            .select("id, name, name_ar, room_id")
            .eq("tenant_id", ctx.tenant.id)
            .eq("active", true)
            .not("room_id", "is", null)
            .order("name")
        : Promise.resolve({ data: [] as { id: string; name: string; name_ar: string | null; room_id: string }[] }),
      // Every closure row touching the week; buildWeekDays applies the one
      // rule (0157): a CONFIRMED closure of the whole building — or of the
      // scoped structure, when the switcher narrows the page — shuts the
      // sheet's day, a tentative one only names it in gold, and another
      // structure's own closure shuts nothing, since the rest of the
      // building still books the same rooms.
      showRooms
        ? readClosures(supabase, ctx.tenant.id, week, weekEnd)
        : Promise.resolve([] as ClosureRow[]),
    ]);

  if (error) throw new Error(error.message);
  const classes = (classRows ?? []) as KgClass[];
  const rooms = (roomRows ?? []) as Room[];
  const structures = (structureRows ?? []) as Structure[];
  const roomById = new Map(rooms.map((r) => [r.id, r] as const));
  const { homeClasses } = occupancy;

  // The rooms as the class dialog offers them: every room, with the classes
  // that already live in it, so the option tail can say "· 1re année".
  const roomChoices: (RoomChoice & { classes: HomeClass[] })[] = occupancy.rooms.map((r) => ({
    ...r,
    classes: homeClasses[r.id] ?? [],
  }));

  // Which classes sit in which room, which activities meet there, and the
  // four counts the database refuses a delete on — the table names them,
  // because "can I delete this room?" is answered by that cell.
  const usageByRoom = new Map(((usageRows ?? []) as UsageRow[]).map((u) => [u.room_id, u] as const));
  const activitiesByRoom = new Map<string, string[]>();
  for (const a of (activityRows ?? []) as { name: string; name_ar: string | null; room_id: string }[]) {
    const list = activitiesByRoom.get(a.room_id) ?? [];
    list.push(locale === "ar" && a.name_ar ? a.name_ar : a.name);
    activitiesByRoom.set(a.room_id, list);
  }
  const roomsWithUsage: RoomWithUsage[] = rooms.map((r) => {
    const inRoom = homeClasses[r.id] ?? [];
    const u = usageByRoom.get(r.id);
    return {
      ...r,
      classes: inRoom,
      activities: activitiesByRoom.get(r.id) ?? [],
      usage: {
        classCount: u?.class_count ?? inRoom.length,
        activityCount: u?.activity_count ?? (activitiesByRoom.get(r.id)?.length ?? 0),
        upcomingCount: u?.upcoming_count ?? 0,
        historyCount: u?.history_count ?? 0,
      },
    };
  });

  // ---- the sheet's week -------------------------------------------------
  // The building's own hours, the days it opens this week, and any day a
  // booking already falls on: a room booked on a Saturday is on the sheet
  // even when the doors are officially shut. A building shut every day still
  // gets Sunday–Thursday, greyed, rather than an empty card. The columns are
  // the shared buildWeekDays (lib/closures), so the sheet and the timetable
  // cannot disagree about which day is shut.
  const hours = toOpeningHours((ctx.tenant as { opening_hours?: unknown }).opening_hours);
  const sheetBusy = occupancy.busy.filter((b) => b.roomId !== null);
  const busyDays = new Set(sheetBusy.map((b) => b.date));
  const days = buildWeekDays({
    week,
    hours,
    closures,
    structures: [],
    structureId: ctx.structureId,
    busyDays,
    locale,
    today,
    todayLabel: tc("labels.today"),
  });
  // The sheet's clickable minutes: none on a shut day.
  const hoursByDate: Record<string, { open: string; close: string } | null> = {};
  for (const d of days) hoursByDate[d.date] = d.closed ? null : (d.hours ?? null);
  // The day on the sheet: the one asked for when it is a sheet day, else the
  // last sheet day before it (a Saturday asked for lands on Thursday — how
  // "previous day" from a Sunday works), else the week's first.
  const day =
    days.find((d) => d.date === wantedDay)?.date ??
    [...days].reverse().find((d) => d.date < wantedDay)?.date ??
    days[0].date;

  const enrolledByClass = new Map<string, number>();
  for (const row of enrolledRows ?? []) {
    if (row.class_id)
      enrolledByClass.set(row.class_id, (enrolledByClass.get(row.class_id) ?? 0) + 1);
  }

  const structureById = new Map(structures.map((str) => [str.id, str] as const));
  /** Only worth grouping by structure once there is more than one. */
  const manyStructures = structures.length > 1;

  const staffLinks = ((staffRows ?? []) as unknown as ClassStaffRow[]).filter(
    (r) => r.kg_memberships && r.kg_classes
  );
  const members = (memberRows ?? []) as MemberRow[];
  // Local staff have no login, so their name comes off the membership; the
  // profile lookup only covers the ones who do (and drops the nulls first —
  // see lib/member-names for why that matters).
  const profileNames = await fetchProfileNames(supabase, [
    ...staffLinks.map((r) => r.kg_memberships!.user_id),
    ...members.map((m) => m.user_id),
  ]);
  const memberLabel = (m: MemberRow) => ({
    membershipId: m.id,
    name: memberNameIn(m, profileNames) ?? "—",
    subtitle: m.job_title ?? t(`roles.${m.role}` as Parameters<typeof t>[0]),
  });

  // Main first, then alphabetical — the order the avatars are drawn in.
  const teamByClass = new Map<string, AssignedStaff[]>();
  for (const r of staffLinks) {
    const list = teamByClass.get(r.class_id) ?? [];
    list.push({ ...memberLabel(r.kg_memberships!), isMain: r.is_main });
    teamByClass.set(r.class_id, list);
  }
  for (const list of teamByClass.values()) {
    list.sort((a, b) => Number(b.isMain) - Number(a.isMain) || a.name.localeCompare(b.name));
  }

  // Where each person already is, for the dialog's "already on" line. Built
  // once for the building; each card drops its own class from the list.
  const placesByMember = new Map<string, StaffPlace[]>();
  for (const r of staffLinks) {
    const klass = r.kg_classes!;
    const str = klass.structure_id ? structureById.get(klass.structure_id) : undefined;
    const list = placesByMember.get(r.kg_memberships!.id) ?? [];
    list.push({
      classId: klass.id,
      className: locale === "ar" && klass.name_ar ? klass.name_ar : klass.name,
      classColor: klass.color,
      isMain: r.is_main,
      // A class with no structure belongs to the whole building — said so.
      structure: !manyStructures
        ? null
        : str
          ? { name: structureName(str, locale), color: str.color }
          : { name: t("assignStaff.wholeBuilding"), color: null },
    });
    placesByMember.set(r.kg_memberships!.id, list);
  }
  // Direct assignments (0141), so the cook shows up as "works in La crèche"
  // even though she teaches nowhere.
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
  const staffForDialog = (classId: string): AssignableStaff[] =>
    members
      .map((m) => ({
        ...memberLabel(m),
        elsewhere: (placesByMember.get(m.id) ?? []).filter((p) => p.classId !== classId),
        structures: directByMember.get(m.id) ?? [],
      }))
      .sort((a, b) => a.name.localeCompare(b.name));

  // The classes under their structure, in the building's own order, with a
  // trailing group for the ones that belong to the whole building. A
  // one-structure crèche gets a single group and no heading.
  const { groups, single } = groupClassesByStructure(classes, structures);

  // One row per class, the way the roster draws children: the class is the
  // link, the facts are columns, the team is a row of faces. Cards were a
  // 3-column grid per structure, which left four classes as three-and-one
  // and a single-class structure as a card alone on a line — a layout that
  // changes shape with every count. A table reads the same at seven and
  // at seventeen.
  const classRow = (c: KgClass) => {
    const enrolled = enrolledByClass.get(c.id) ?? 0;
    const team = teamByClass.get(c.id) ?? [];
    const main = team.find((s) => s.isMain);
    const displayName = locale === "ar" && c.name_ar ? c.name_ar : c.name;
    const room = c.room_id ? roomById.get(c.room_id) : undefined;
    // The room's stored name, once, in the reader's script — never behind a
    // translated "Salle" that the name already contains.
    const roomLabel = room ? roomName(room, locale) : c.room;
    const ages = ageRangeLabel(c.age_min_months, c.age_max_months, t);

    return (
      <TableRow key={c.id} className="relative transition-colors hover:bg-primary/5">
        <TableCell>
          {/* The whole row is the link: the name's overlay reaches every
              cell, and the few controls (assign, pencil) are lifted above
              it. The class colour appears once, as the dot before the name
              — the same dot the roster's class chip carries. */}
          <Link
            href={`/classes/${c.id}`}
            className="flex items-center gap-2.5 font-semibold after:absolute after:inset-0"
          >
            <span
              className="size-2.5 shrink-0 rounded-full ring-1 ring-inset ring-foreground/10"
              style={{ backgroundColor: c.color }}
              aria-hidden
            />
            <bdi dir="auto" className="truncate">{displayName}</bdi>
          </Link>
        </TableCell>
        <TableCell className="text-muted-foreground">
          {roomLabel ? <bdi dir="auto">{roomLabel}</bdi> : "—"}
        </TableCell>
        <TableCell className="whitespace-nowrap text-muted-foreground">{ages || "—"}</TableCell>
        <TableCell className="w-40">
          <FillBar enrolled={enrolled} capacity={c.capacity} className="min-w-28" />
        </TableCell>
        <TableCell>
          <div className="flex items-center gap-2.5">
            {team.length > 0 ? (
              <>
                {/* Faces, main educator first and drawn on top, so the gold
                    ring — the one signal for "leads this class" — is never
                    covered by the next face. */}
                <span className="flex shrink-0 items-center -space-x-2 rtl:space-x-reverse">
                  {team.slice(0, AVATARS_SHOWN).map((s, i) => (
                    <Avatar
                      key={s.membershipId}
                      className={cn("size-8 ring-2", s.isMain ? "ring-gold" : "ring-card")}
                      style={{ zIndex: s.isMain ? 10 : AVATARS_SHOWN - i }}
                      title={s.name}
                    >
                      <AvatarFallback className="bg-secondary text-[11px] font-semibold text-primary">
                        {initialsFromName(s.name) || "?"}
                      </AvatarFallback>
                    </Avatar>
                  ))}
                  {team.length > AVATARS_SHOWN && (
                    <span
                      dir="ltr"
                      className="flex size-8 items-center justify-center rounded-full bg-muted text-[11px] font-semibold text-muted-foreground ring-2 ring-card tabular-nums"
                    >
                      +{team.length - AVATARS_SHOWN}
                    </span>
                  )}
                </span>
                {/* The name that matters is the main educator's — the ring
                    already says why. A team with no main says so rather than
                    promoting someone. */}
                <span className="relative z-10 min-w-0 truncate text-sm">
                  {main ? (
                    <StaffLink id={main.membershipId} className="font-medium">
                      <bdi dir="auto">{main.name}</bdi>
                    </StaffLink>
                  ) : (
                    <span className="text-muted-foreground">
                      {t("list.staffCount", { count: team.length })}
                    </span>
                  )}
                </span>
              </>
            ) : (
              <>
                <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-muted text-muted-foreground">
                  <Users className="size-3.5" />
                </span>
                <span className="text-sm text-muted-foreground">{t("list.noTeacher")}</span>
              </>
            )}
          </div>
        </TableCell>
        {ctx.isAdmin && (
          <TableCell className="w-20">
            <span className="relative z-10 flex items-center justify-end gap-0.5">
              <AssignStaffDialog
                classId={c.id}
                className={displayName}
                staff={staffForDialog(c.id)}
                assigned={team}
                trigger="icon"
              />
              <ClassDialog klass={c} rooms={roomChoices} structures={structures} />
            </span>
          </TableCell>
        )}
      </TableRow>
    );
  };

  return (
    <div>
      {/* One primary per page: the thing this tab creates. */}
      <PageHeader title={t("list.title")} description={t("list.description")}>
        {ctx.isAdmin &&
          (showRooms ? <RoomDialog /> : <ClassDialog rooms={roomChoices} structures={structures} />)}
      </PageHeader>

      {/* Rooms live beside the classes, not in Settings: a room only means
          anything in relation to a class, and the person creating classes on
          their first day is the person who has to create the rooms. */}
      <ClassesTabs classCount={classes.length} roomCount={rooms.length} />

      {showRooms ? (
        <RoomsPanel
          rooms={roomsWithUsage}
          isAdmin={ctx.isAdmin}
          sheet={{ day, today, days, hoursByDate, busy: sheetBusy, locale }}
        />
      ) : classes.length === 0 ? (
        <EmptyState
          icon={<School />}
          title={t("list.empty")}
          description={t("list.emptyDescription")}
        />
      ) : (
        <Card className="border border-border py-0 shadow-sm ring-0">
          <CardContent className="px-0">
            <Table className="[&_td]:px-3 [&_th]:px-3 [&_td:first-child]:ps-5 [&_th:first-child]:ps-5 [&_td:last-child]:pe-5 [&_th:last-child]:pe-5">
              <TableHeader>
                <TableRow className="[&>th]:font-semibold">
                  <TableHead>{t("list.columns.class")}</TableHead>
                  <TableHead>{t("list.columns.room")}</TableHead>
                  <TableHead>{t("list.columns.ages")}</TableHead>
                  <TableHead>{t("list.occupancy")}</TableHead>
                  <TableHead>{t("list.columns.team")}</TableHead>
                  {ctx.isAdmin && <TableHead className="w-20"><span className="sr-only">{t("list.columns.actions")}</span></TableHead>}
                </TableRow>
              </TableHeader>
              <TableBody>
                {groups.map((g) => (
                  <Fragment key={g.structure?.id ?? "building"}>
                    {/* Group rows inside the one table, never a card per
                        structure: the structure is said once, as its mark,
                        and the count beside it. A one-structure crèche gets
                        no group row at all. */}
                    {!single && (
                      <StructureGroupRow
                        structure={
                          g.structure
                            ? { name: structureName(g.structure, locale), color: g.structure.color ?? "#19819a" }
                            : null
                        }
                        label={t("assignStaff.wholeBuilding")}
                        count={t("structures.classCount", { count: g.classes.length })}
                        colSpan={ctx.isAdmin ? 6 : 5}
                      />
                    )}
                    {g.classes.map(classRow)}
                  </Fragment>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
