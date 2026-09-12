import Link from "next/link";
import { AlertCircle, CalendarDays, MailPlus, Users } from "lucide-react";
import { getTranslations } from "next-intl/server";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/shared/empty-state";
import { PageHeader } from "@/components/shared/page-header";
import { createClient } from "@/lib/supabase/server";
import { requireStaff } from "@/lib/tenant";
import type { Membership, Timesheet } from "@/lib/types";
import { ClockButton } from "@/components/modules/staff/clock-button";
import { InviteDialog } from "@/components/modules/staff/invite-dialog";
import { algiersToday } from "@/components/modules/staff/dates";
import { memberName } from "@/lib/member-names";
import type { MemberStatus, ProfileLite, StaffRole } from "@/components/modules/staff/staff-types";
import { TeamRoster, type TeamRow } from "@/components/modules/staff/team-roster";
import type { Structure } from "@/components/modules/classes/class-types";

type TodayRow = Pick<Timesheet, "membership_id" | "clock_in_at" | "clock_out_at">;

/** kg_class_staff joined to the class it points at — see the query below. */
type ClassStaffRow = {
  membership_id: string;
  kg_classes: { structure_id: string | null } | null;
};

function todayState(rows: TodayRow[]): { kind: "present" | "left" | "none"; at: string | null } {
  const open = rows.find((r) => r.clock_in_at && !r.clock_out_at);
  if (open) return { kind: "present", at: open.clock_in_at };
  const closed = rows.filter((r) => r.clock_out_at).sort((a, b) => (a.clock_out_at! < b.clock_out_at! ? 1 : -1));
  if (closed.length > 0) return { kind: "left", at: closed[0].clock_out_at };
  return { kind: "none", at: null };
}

export default async function StaffPage({
  searchParams,
}: {
  searchParams: Promise<{ structure?: string }>;
}) {
  const sp = await searchParams;
  const ctx = await requireStaff();
  const supabase = await createClient();
  const t = await getTranslations("staff");
  const today = algiersToday();

  const [
    { data: members, error: membersError },
    { data: todayTs },
    { data: structureRows },
    { data: classStaffRows },
    { data: directRows },
  ] = await Promise.all([
    supabase
      .from("kg_memberships")
      .select("*")
      .eq("tenant_id", ctx.tenant.id)
      .neq("role", "parent")
      .order("created_at"),
    supabase
      .from("kg_timesheets")
      .select("membership_id, clock_in_at, clock_out_at")
      .eq("tenant_id", ctx.tenant.id)
      .eq("date", today),
    // The structures of the establishment (0125). One for most crèches, two for
    // a building that runs a crèche and a jardin d'enfants side by side.
    supabase
      .from("kg_structures")
      .select("id, name, name_ar, center_type, color, sort_order, active")
      .eq("tenant_id", ctx.tenant.id)
      .order("sort_order")
      .order("name"),
    // kg_class_staff has no tenant_id of its own — it is scoped through the
    // class it points at, which is also where the structure lives.
    supabase
      .from("kg_class_staff")
      .select("membership_id, kg_classes!inner(structure_id, tenant_id)")
      .eq("kg_classes.tenant_id", ctx.tenant.id),
    // Direct assignments (0141): the people with no class — the cook, the
    // secretary — belong somewhere too. Scoped through the membership.
    supabase
      .from("kg_membership_structures")
      .select("membership_id, structure_id, kg_memberships!inner(tenant_id)")
      .eq("kg_memberships.tenant_id", ctx.tenant.id),
  ]);

  const memberList = (members ?? []) as Membership[];
  // Local staff have no user_id; asking for their profile would return nothing.
  const userIds = memberList.map((m) => m.user_id).filter((id): id is string => !!id);
  const { data: profiles } = userIds.length
    ? await supabase.from("kg_profiles").select("id, full_name, phone, avatar_url").in("id", userIds)
    : { data: [] as ProfileLite[] };
  const profileById = new Map((profiles ?? []).map((p) => [p.id, p as ProfileLite]));

  const tsByMember = new Map<string, TodayRow[]>();
  for (const row of (todayTs ?? []) as TodayRow[]) {
    const arr = tsByMember.get(row.membership_id) ?? [];
    arr.push(row);
    tsByMember.set(row.membership_id, arr);
  }

  const structures = (structureRows ?? []) as Structure[];

  // A member's structures are the ones their CLASSES belong to. A class filed
  // under no structure adds nothing — it already belongs to the whole building.
  // The union of both links, same as kg_member_structures and the rail.
  const structureIdsByMember = new Map<string, Set<string>>();
  const addStructure = (membershipId: string, structureId: string | null | undefined) => {
    if (!structureId) return;
    const ids = structureIdsByMember.get(membershipId) ?? new Set<string>();
    ids.add(structureId);
    structureIdsByMember.set(membershipId, ids);
  };
  for (const row of (classStaffRows ?? []) as unknown as ClassStaffRow[]) {
    addStructure(row.membership_id, row.kg_classes?.structure_id);
  }
  for (const row of (directRows ?? []) as { membership_id: string; structure_id: string }[]) {
    addStructure(row.membership_id, row.structure_id);
  }
  // Read back through the building's list so a member's marks come out in the
  // order the director arranged their structures in, not the join's order.
  const memberStructureIds = (membershipId: string): string[] => {
    const ids = structureIdsByMember.get(membershipId);
    return ids ? structures.filter((s) => ids.has(s.id)).map((s) => s.id) : [];
  };

  // Falls back to the rail's switcher, so the page and the sidebar never
  // disagree about which structure is being read. And once the rail HAS
  // narrowed, the in-page filter is hidden below — one question, one control.
  const structureFilter =
    sp.structure && structures.some((s) => s.id === sp.structure)
      ? sp.structure
      : (ctx.structureId ?? "all");
  const visible =
    structureFilter === "all"
      ? memberList
      : memberList.filter((m) => {
          const ids = structureIdsByMember.get(m.id);
          // Narrowing to one structure KEEPS the people who teach in none. The
          // cook, the driver and the director belong to the building, so they
          // are as much this structure's team as the educator in its classroom;
          // dropping them would be reading "no chip" as "not here".
          return !ids || ids.has(structureFilter);
        });

  const myRows = tsByMember.get(ctx.membership.id) ?? [];
  const myDirection: "in" | "out" = myRows.some((r) => r.clock_in_at && !r.clock_out_at) ? "out" : "in";

  const rows: TeamRow[] = visible.map((m) => {
    const profile = m.user_id ? profileById.get(m.user_id) : undefined;
    return {
      id: m.id,
      name: memberName(m, profile?.full_name) ?? "—",
      jobTitle: m.job_title ?? null,
      code: m.staff_code ?? null,
      avatarUrl: profile?.avatar_url ?? null,
      role: m.role as StaffRole,
      status: (m.status === "disabled" ? "disabled" : m.status) as MemberStatus,
      hireDate: m.hire_date ?? null,
      structureIds: memberStructureIds(m.id),
      today: todayState(tsByMember.get(m.id) ?? []),
    };
  });

  return (
    <div>
      <PageHeader title={t("team.title")} description={t("team.description")}>
        <ClockButton direction={myDirection} />
        <Button asChild variant="outline">
          <Link href="/staff/leaves">
            <CalendarDays data-icon="inline-start" />
            {t("team.leavesLink")}
          </Link>
        </Button>
        {ctx.isAdmin && (
          <>
            <Button asChild variant="outline">
              <Link href="/staff/invites">
                <MailPlus data-icon="inline-start" />
                {t("team.invitesLink")}
              </Link>
            </Button>
            <InviteDialog structures={structures} />
          </>
        )}
      </PageHeader>

      {membersError ? (
        <Alert variant="destructive">
          <AlertCircle />
          <AlertTitle>{t("errors.generic")}</AlertTitle>
          <AlertDescription>{t("team.loadError")}</AlertDescription>
        </Alert>
      ) : memberList.length === 0 ? (
        <EmptyState icon={<Users />} title={t("team.empty")} description={t("team.emptyHint")} />
      ) : (
        <TeamRoster
          rows={rows}
          structures={structures}
          structureFilter={structureFilter}
          showStructureFilter={!ctx.structureId}
        />
      )}
    </div>
  );
}
