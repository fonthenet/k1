import Link from "next/link";
import { AlertCircle, CalendarDays, MailPlus, Users } from "lucide-react";
import { getLocale, getTranslations } from "next-intl/server";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { EmptyState } from "@/components/shared/empty-state";
import { PageHeader } from "@/components/shared/page-header";
import { createClient } from "@/lib/supabase/server";
import { requireStaff } from "@/lib/tenant";
import { formatDate, formatTime, initials } from "@/lib/format";
import type { Membership, Timesheet } from "@/lib/types";
import { ClockButton } from "@/components/modules/staff/clock-button";
import { EditMemberDialog } from "@/components/modules/staff/edit-member-dialog";
import { InviteDialog } from "@/components/modules/staff/invite-dialog";
import { algiersToday } from "@/components/modules/staff/dates";
import { memberName } from "@/lib/member-names";
import { MEMBER_STATUS_BADGE, ROLE_BADGE, STAFF_ROLES } from "@/components/modules/staff/maps";
import type { MemberStatus, ProfileLite, StaffRole } from "@/components/modules/staff/staff-types";
import { StructureChips } from "@/components/modules/staff/structure-chips";
import { StructureFilter } from "@/components/modules/staff/structure-filter";
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
  const locale = await getLocale();
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

  const roleRank = new Map(STAFF_ROLES.map((r, i) => [r, i]));
  const sorted = [...memberList].sort((a, b) => {
    const ra = roleRank.get(a.role as StaffRole) ?? 99;
    const rb = roleRank.get(b.role as StaffRole) ?? 99;
    if (ra !== rb) return ra - rb;
    const na = memberName(a, a.user_id ? profileById.get(a.user_id)?.full_name : null) ?? "—";
    const nb = memberName(b, b.user_id ? profileById.get(b.user_id)?.full_name : null) ?? "—";
    return na.localeCompare(nb);
  });

  const structures = (structureRows ?? []) as Structure[];
  // Under two structures the word means nothing: every row would carry the same
  // chip and the filter would offer a choice of one.
  const manyStructures = structures.length > 1;

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
  // Read back through the sorted list so a member's chips come out in the order
  // the director arranged their structures in, not the order the join returned.
  const memberStructures = (membershipId: string): Structure[] => {
    const ids = structureIdsByMember.get(membershipId);
    return ids ? structures.filter((s) => ids.has(s.id)) : [];
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
      ? sorted
      : sorted.filter((m) => {
          const ids = structureIdsByMember.get(m.id);
          // Narrowing to one structure KEEPS the people who teach in none. The
          // cook, the driver and the director belong to the building, so they
          // are as much this structure's team as the educator in its classroom;
          // dropping them would be reading "no chip" as "not here".
          return !ids || ids.has(structureFilter);
        });

  const myRows = tsByMember.get(ctx.membership.id) ?? [];
  const myDirection: "in" | "out" = myRows.some((r) => r.clock_in_at && !r.clock_out_at) ? "out" : "in";

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
      ) : sorted.length === 0 ? (
        <EmptyState icon={<Users />} title={t("team.empty")} description={t("team.emptyHint")} />
      ) : (
        <>
          {/* Only once the building runs more than one structure — a crèche with
              a single one should not be asked to choose between one thing. */}
          {manyStructures && (
            <div className="mb-4 flex flex-wrap items-center gap-2">
              {!ctx.structureId && (
                <StructureFilter value={structureFilter} structures={structures} />
              )}
            </div>
          )}
          {visible.length === 0 ? (
            <EmptyState icon={<Users />} title={t("team.noMatch")} description={t("team.noMatchHint")} />
          ) : (
            <Card className="overflow-hidden border border-border py-0 shadow-sm ring-0">
              <CardContent className="overflow-x-auto p-0">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">
                        {t("team.columns.member")}
                      </TableHead>
                      <TableHead className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">
                        {t("team.columns.role")}
                      </TableHead>
                      {manyStructures && (
                        <TableHead className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">
                          {t("team.columns.structure")}
                        </TableHead>
                      )}
                      <TableHead className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">
                        {t("team.columns.code")}
                      </TableHead>
                      <TableHead className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">
                        {t("team.columns.phone")}
                      </TableHead>
                      <TableHead className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">
                        {t("team.columns.hireDate")}
                      </TableHead>
                      <TableHead className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">
                        {t("team.columns.status")}
                      </TableHead>
                      <TableHead className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">
                        {t("team.columns.today")}
                      </TableHead>
                      {ctx.isAdmin && <TableHead className="w-10" />}
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {visible.map((m) => {
                      const profile = m.user_id ? profileById.get(m.user_id) : undefined;
                      const name = memberName(m, profile?.full_name) ?? "—";
                      const parts = name.split(" ");
                      const state = todayState(tsByMember.get(m.id) ?? []);
                      const role = m.role as StaffRole;
                      const status = (m.status === "disabled" ? "disabled" : m.status) as MemberStatus;
                      return (
                        <TableRow key={m.id} className="transition-colors hover:bg-muted/40">
                          <TableCell className="py-3">
                            <Link
                              href={`/staff/${m.id}`}
                              className="group/member flex items-center gap-3"
                            >
                              <Avatar className="size-9 ring-1 ring-border">
                                <AvatarImage src={profile?.avatar_url ?? undefined} alt="" />
                                <AvatarFallback className="bg-primary/10 text-xs font-semibold text-primary">
                                  {initials(parts[0] ?? "", parts[1] ?? "")}
                                </AvatarFallback>
                              </Avatar>
                              <span className="flex min-w-0 flex-col">
                                <span className="truncate font-semibold text-foreground group-hover/member:text-primary">
                                  {name}
                                </span>
                                {m.job_title && (
                                  <span className="truncate text-xs text-muted-foreground">
                                    {m.job_title}
                                  </span>
                                )}
                              </span>
                            </Link>
                          </TableCell>
                          <TableCell>
                            <Badge className={ROLE_BADGE[role]}>{t(`roles.${role}`)}</Badge>
                          </TableCell>
                          {manyStructures && (
                            <TableCell>
                              <StructureChips structures={memberStructures(m.id)} locale={locale} />
                            </TableCell>
                          )}
                          <TableCell dir="ltr">
                            {m.staff_code ? (
                              <span className="rounded-md bg-muted px-1.5 py-0.5 font-mono text-xs text-muted-foreground">
                                {m.staff_code}
                              </span>
                            ) : (
                              <span className="text-muted-foreground">—</span>
                            )}
                          </TableCell>
                          <TableCell dir="ltr" className="text-start tabular-nums">
                            {profile?.phone ?? <span className="text-muted-foreground">—</span>}
                          </TableCell>
                          <TableCell className="text-muted-foreground">
                            {m.hire_date ? formatDate(m.hire_date, locale) : "—"}
                          </TableCell>
                          <TableCell>
                            <Badge className={MEMBER_STATUS_BADGE[status]}>{t(`memberStatus.${status}`)}</Badge>
                          </TableCell>
                          <TableCell>
                            {state.kind === "present" ? (
                              <Badge className="gap-1.5 border-transparent bg-success/10 font-medium text-success">
                                <span aria-hidden className="size-1.5 rounded-full bg-success" />
                                {t("clock.presentSince", { time: formatTime(state.at!, locale) })}
                              </Badge>
                            ) : state.kind === "left" ? (
                              <Badge className="border-transparent bg-muted font-medium text-muted-foreground">
                                {t("clock.leftAt", { time: formatTime(state.at!, locale) })}
                              </Badge>
                            ) : (
                              <span className="text-xs text-muted-foreground">{t("clock.notIn")}</span>
                            )}
                          </TableCell>
                          {ctx.isAdmin && (
                            <TableCell className="text-end">
                              <EditMemberDialog member={m} name={name} />
                            </TableCell>
                          )}
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          )}
        </>
      )}
    </div>
  );
}
