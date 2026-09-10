import Link from "next/link";
import { DoorOpen, School, Users } from "lucide-react";
import { getLocale, getTranslations } from "next-intl/server";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { EmptyState } from "@/components/shared/empty-state";
import { PageHeader } from "@/components/shared/page-header";
import { StaffLink } from "@/components/shared/entity-link";
import { createClient } from "@/lib/supabase/server";
import { requireStaff, scoped } from "@/lib/tenant";
import { initialsFromName } from "@/lib/format";
import { fetchProfileNames, memberNameIn } from "@/lib/member-names";
import { cn } from "@/lib/utils";
import type { KgClass } from "@/lib/types";
import {
  AssignStaffDialog,
  type AssignableStaff,
  type StaffPlace,
} from "@/components/modules/classes/assign-staff-dialog";
import { ClassDialog } from "@/components/modules/classes/class-dialog";
import { DeleteClassButton } from "@/components/modules/classes/delete-class-button";
import {
  ageRangeLabel,
  structureName,
  type AssignedStaff,
  type Room,
  type Structure,
} from "@/components/modules/classes/class-types";
import { RoomsPanel, type RoomWithUsage } from "@/components/modules/classes/rooms-panel";
import { RoomDialog } from "@/components/modules/classes/room-dialog";
import { ClassGlyph } from "@/components/modules/classes/class-icons";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

/** One kg_class_staff row with the person on it — every class, every member. */
type ClassStaffRow = {
  class_id: string;
  is_main: boolean;
  kg_classes: { id: string; name: string; name_ar: string | null; structure_id: string | null } | null;
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

/** How many faces a card shows before it says "+N". */
const AVATARS_SHOWN = 3;

export default async function ClassesPage() {
  const ctx = await requireStaff();
  const t = await getTranslations("classes");
  const locale = await getLocale();
  const supabase = await createClient();

  const [
    { data: classRows, error },
    { data: enrolledRows },
    { data: staffRows },
    { data: roomRows },
    { data: structureRows },
    { data: memberRows },
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
          "class_id, is_main, kg_classes!inner(id, name, name_ar, structure_id, tenant_id), kg_memberships!inner(id, user_id, full_name, role, job_title, status)"
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
    ]);

  if (error) throw new Error(error.message);
  const classes = (classRows ?? []) as KgClass[];
  const rooms = (roomRows ?? []) as Room[];
  const structures = (structureRows ?? []) as Structure[];


  // Which classes sit in which room — the card names them, because "can I
  // delete this room?" is answered by that list and nothing else.
  const roomsWithUsage: RoomWithUsage[] = rooms.map((r) => {
    const inRoom = classes.filter((c) => c.room_id === r.id);
    return {
      ...r,
      classCount: inRoom.length,
      classNames: inRoom.map((c) => (locale === "ar" && c.name_ar ? c.name_ar : c.name)),
    };
  });


  const enrolledByClass = new Map<string, number>();
  for (const row of enrolledRows ?? []) {
    if (row.class_id)
      enrolledByClass.set(row.class_id, (enrolledByClass.get(row.class_id) ?? 0) + 1);
  }

  const structureById = new Map(structures.map((str) => [str.id, str] as const));
  /** Only worth showing a structure on a class card once there is more than one. */
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

  const ageRange = (c: KgClass) =>
    ageRangeLabel(c.age_min_months, c.age_max_months, t);

  return (
    <div>
      <PageHeader title={t("list.title")} description={t("list.description")} />

      {/* Rooms live beside the classes, not in Settings: a room only means
          anything in relation to a class, and the person creating classes on
          their first day is the person who has to create the rooms. */}
      <Tabs defaultValue="classes" className="gap-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <TabsList>
            <TabsTrigger value="classes">
              <School data-icon="inline-start" />
              {t("list.tabClasses")}
              <span className="ms-1 tabular-nums opacity-60">{classes.length}</span>
            </TabsTrigger>
            <TabsTrigger value="rooms">
              <DoorOpen data-icon="inline-start" />
              {t("list.tabRooms")}
              <span className="ms-1 tabular-nums opacity-60">{rooms.length}</span>
            </TabsTrigger>
          </TabsList>
        </div>

        <TabsContent value="rooms">
          <div className="mb-4 flex justify-end">{ctx.isAdmin && <RoomDialog />}</div>
          <RoomsPanel rooms={roomsWithUsage} isAdmin={ctx.isAdmin} />
        </TabsContent>

        <TabsContent value="classes">
      <div className="mb-4 flex justify-end">
        {ctx.isAdmin && <ClassDialog rooms={rooms} structures={structures} />}
      </div>

      {classes.length === 0 ? (
        <EmptyState
          icon={
            <span className="flex size-14 items-center justify-center rounded-2xl bg-primary/10 text-primary [&>svg]:size-7">
              <School />
            </span>
          }
          title={t("list.empty")}
          description={t("list.emptyDescription")}
          action={ctx.isAdmin ? <ClassDialog /> : undefined}
        />
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {classes.map((c) => {
            const enrolled = enrolledByClass.get(c.id) ?? 0;
            const full = enrolled >= c.capacity;
            const pct = c.capacity > 0 ? Math.min((enrolled / c.capacity) * 100, 100) : 0;
            // Emerald while there's room, gold once it's nearly full, red when full.
            const nearlyFull = !full && pct >= 80;
            const team = teamByClass.get(c.id) ?? [];
            const main = team.find((s) => s.isMain);
            const displayName = locale === "ar" && c.name_ar ? c.name_ar : c.name;

            return (
              <Card
                key={c.id}
                className="shadow-sm transition-shadow duration-200 hover:shadow-md"
              >
                <CardContent className="flex flex-1 flex-col gap-4">
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex min-w-0 items-start gap-3">
                      {/* The class colour lives on the tile that stands for the
                          class, not on a band across the top of the card. It
                          identifies rather than decorates, and a tint with an
                          ink glyph stays legible whatever colour a crèche
                          picks — a solid fill would not.
                          kg_classes.color is user data, hence inline styles. */}
                      <span
                        className="mt-0.5 flex size-10 shrink-0 items-center justify-center rounded-xl text-foreground"
                        style={{
                          backgroundColor: `color-mix(in oklch, ${c.color} 20%, transparent)`,
                          boxShadow: `inset 0 0 0 1px color-mix(in oklch, ${c.color} 45%, transparent)`,
                        }}
                        aria-hidden
                      >
                        <ClassGlyph icon={c.icon} className="size-5" />
                      </span>
                      <div className="min-w-0">
                        <Link
                          href={`/classes/${c.id}`}
                          className="block truncate text-base font-semibold hover:underline"
                        >
                          {displayName}
                        </Link>
                        <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-sm text-muted-foreground">
                          <span>{ageRange(c)}</span>
                          {c.room && (
                            <>
                              <span aria-hidden>·</span>
                              <span>{t("list.room", { room: c.room })}</span>
                            </>
                          )}
                          {/* Which structure — only once the building has more than
                              one, otherwise it is the same word on every card. */}
                          {manyStructures && c.structure_id && structureById.has(c.structure_id) && (
                            <>
                              <span aria-hidden>·</span>
                              <span>
                                {structureName(structureById.get(c.structure_id)!, locale)}
                              </span>
                            </>
                          )}
                        </div>
                      </div>
                    </div>
                    {ctx.isAdmin && (
                      <div className="flex shrink-0 items-center">
                        <ClassDialog klass={c} rooms={rooms} structures={structures} />
                        <DeleteClassButton classId={c.id} childCount={enrolled} />
                      </div>
                    )}
                  </div>

                  <div className="space-y-2">
                    <div className="flex items-center justify-between gap-2 text-sm">
                      <span className="text-muted-foreground">{t("list.occupancy")}</span>
                      <span className="flex items-center gap-2">
                        {full && <Badge variant="destructive">{t("list.full")}</Badge>}
                        <span
                          className={cn(
                            "text-base font-bold tabular-nums",
                            full ? "text-destructive" : "text-foreground"
                          )}
                        >
                          {enrolled}
                          <span className="text-sm font-medium text-muted-foreground">
                            {" / "}
                            {c.capacity}
                          </span>
                        </span>
                      </span>
                    </div>
                    <Progress
                      value={pct}
                      className={cn(
                        "h-2",
                        full && "[&_[data-slot=progress-indicator]]:bg-destructive",
                        nearlyFull && "[&_[data-slot=progress-indicator]]:bg-gold"
                      )}
                    />
                  </div>

                  <div className="mt-auto flex items-center gap-2.5 border-t border-border pt-3 text-sm">
                    {team.length > 0 ? (
                      <>
                        {/* Faces, main educator first. The gold ring is the
                            one signal for "leads this class" — no star, no
                            badge repeating it. */}
                        <span className="flex shrink-0 items-center -space-x-2 rtl:space-x-reverse">
                          {team.slice(0, AVATARS_SHOWN).map((s) => (
                            <Avatar
                              key={s.membershipId}
                              className={cn(
                                "size-8 ring-2 ring-card",
                                s.isMain && "ring-gold"
                              )}
                              title={s.name}
                            >
                              <AvatarFallback className="bg-primary/10 text-[11px] font-semibold text-primary">
                                {initialsFromName(s.name) || "?"}
                              </AvatarFallback>
                            </Avatar>
                          ))}
                          {team.length > AVATARS_SHOWN && (
                            <span className="flex size-8 items-center justify-center rounded-full bg-muted text-[11px] font-semibold text-muted-foreground ring-2 ring-card tabular-nums">
                              +{team.length - AVATARS_SHOWN}
                            </span>
                          )}
                        </span>
                        {/* The name that matters is the main educator's; the
                            rest are the faces. A class with a team but no
                            main says so rather than promoting someone. */}
                        <span className="min-w-0 flex-1 text-pretty">
                          {main ? (
                            <>
                              <span className="text-muted-foreground">{t("list.mainTeacher")}</span>{" "}
                              <span className="font-semibold">
                                <StaffLink id={main.membershipId}>{main.name}</StaffLink>
                              </span>
                            </>
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
                        <span className="min-w-0 flex-1 text-muted-foreground">{t("list.noTeacher")}</span>
                      </>
                    )}
                    {ctx.isAdmin && (
                      <AssignStaffDialog
                        classId={c.id}
                        className={displayName}
                        staff={staffForDialog(c.id)}
                        assigned={team}
                        trigger="icon"
                      />
                    )}
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}
        </TabsContent>
      </Tabs>
    </div>
  );
}
