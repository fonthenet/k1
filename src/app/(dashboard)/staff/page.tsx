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
import { algiersToday, memberName } from "@/components/modules/staff/dates";
import { MEMBER_STATUS_BADGE, ROLE_BADGE, STAFF_ROLES } from "@/components/modules/staff/maps";
import type { MemberStatus, ProfileLite, StaffRole } from "@/components/modules/staff/staff-types";

type TodayRow = Pick<Timesheet, "membership_id" | "clock_in_at" | "clock_out_at">;

function todayState(rows: TodayRow[]): { kind: "present" | "left" | "none"; at: string | null } {
  const open = rows.find((r) => r.clock_in_at && !r.clock_out_at);
  if (open) return { kind: "present", at: open.clock_in_at };
  const closed = rows.filter((r) => r.clock_out_at).sort((a, b) => (a.clock_out_at! < b.clock_out_at! ? 1 : -1));
  if (closed.length > 0) return { kind: "left", at: closed[0].clock_out_at };
  return { kind: "none", at: null };
}

export default async function StaffPage() {
  const ctx = await requireStaff();
  const supabase = await createClient();
  const t = await getTranslations("staff");
  const locale = await getLocale();
  const today = algiersToday();

  const [{ data: members, error: membersError }, { data: todayTs }] = await Promise.all([
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
    const na = memberName(a, a.user_id ? profileById.get(a.user_id)?.full_name : null);
    const nb = memberName(b, b.user_id ? profileById.get(b.user_id)?.full_name : null);
    return na.localeCompare(nb);
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
            <InviteDialog />
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
        <Card className="overflow-hidden border border-border py-0 shadow-sm ring-0">
          <CardContent className="overflow-x-auto p-0">
            <Table>
              <TableHeader className="bg-muted/50">
                <TableRow className="hover:bg-transparent">
                  <TableHead className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">
                    {t("team.columns.member")}
                  </TableHead>
                  <TableHead className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">
                    {t("team.columns.role")}
                  </TableHead>
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
                {sorted.map((m) => {
                  const profile = m.user_id ? profileById.get(m.user_id) : undefined;
                  const name = memberName(m, profile?.full_name);
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
    </div>
  );
}
