import Link from "next/link";
import { Fragment } from "react";
import { AlertCircle, ArrowLeft, CalendarDays } from "lucide-react";
import { getLocale, getTranslations } from "next-intl/server";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Card, CardContent } from "@/components/ui/card";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { EmptyState } from "@/components/shared/empty-state";
import { StaffLink } from "@/components/shared/entity-link";
import { PageHeader } from "@/components/shared/page-header";
import { StatusPill, type StatusTone } from "@/components/shared/status-pill";
import { ValueRange } from "@/components/shared/value-range";
import { createClient } from "@/lib/supabase/server";
import { requireStaff } from "@/lib/tenant";
import { formatDate, initialsFromName } from "@/lib/format";
import { memberNameIn } from "@/lib/member-names";
import type { LeaveStatus, Membership } from "@/lib/types";
import { LeaveCancelButton, LeaveDecisionButtons } from "@/components/modules/staff/leave-actions";
import { LeaveRequestDialog } from "@/components/modules/staff/leave-request-dialog";
import { algiersToday } from "@/components/modules/staff/dates";
import type { LeaveRequest, ProfileLite } from "@/components/modules/staff/staff-types";

/**
 * The one mark a leave row carries. The group row already says "pending" or
 * "approved", so those two states render nothing; only a refusal and a
 * withdrawal are worth a word of their own.
 */
const ROW_TONE: Partial<Record<LeaveStatus, StatusTone>> = {
  rejected: "danger",
  cancelled: "muted",
};

/** The register's columns, so the group rows know how far to span. */
const COLUMNS = 7;

function leaveDays(lr: LeaveRequest): number {
  const start = new Date(`${lr.start_date}T12:00:00`);
  const end = new Date(`${lr.end_date}T12:00:00`);
  return Math.max(1, Math.round((end.getTime() - start.getTime()) / 86400000) + 1);
}

export default async function StaffLeavesPage() {
  const ctx = await requireStaff();
  const supabase = await createClient();
  const t = await getTranslations("staff");
  const locale = await getLocale();
  const today = algiersToday();

  const [{ data: requests, error: requestsError }, { data: members }] = await Promise.all([
    supabase
      .from("kg_leave_requests")
      .select("*")
      .eq("tenant_id", ctx.tenant.id)
      .order("created_at", { ascending: false }),
    supabase
      .from("kg_memberships")
      .select("id, user_id, full_name")
      .eq("tenant_id", ctx.tenant.id)
      .neq("role", "parent"),
  ]);

  const memberList = (members ?? []) as Pick<Membership, "id" | "user_id" | "full_name">[];
  // Nulls out before the .in(): PostgREST sends the array verbatim, and
  // id=in.(null,…) is rejected as an invalid uuid — one accountless member
  // would blank the phone and avatar of everyone else too. This one keeps its
  // own query rather than using fetchProfileNames because it needs the two
  // extra columns.
  const userIds = [...new Set(memberList.map((m) => m.user_id).filter((v): v is string => !!v))];
  const { data: profiles } = userIds.length
    ? await supabase.from("kg_profiles").select("id, full_name, phone, avatar_url").in("id", userIds)
    : { data: [] as ProfileLite[] };
  const profileByUser = new Map((profiles ?? []).map((p) => [p.id, p as ProfileLite]));
  const nameByUser = new Map(
    [...profileByUser].flatMap(([id, p]) => (p.full_name ? [[id, p.full_name] as const] : []))
  );
  const memberById = new Map(memberList.map((m) => [m.id, m] as const));
  const personOf = (membershipId: string) => {
    const m = memberById.get(membershipId);
    const profile = m?.user_id ? profileByUser.get(m.user_id) : undefined;
    return {
      name: m ? (memberNameIn(m, nameByUser) ?? "—") : "—",
      avatarUrl: profile?.avatar_url ?? null,
    };
  };

  // The director reads the whole team's requests; everyone else reads their
  // own, under the same columns — the page does not change shape with the
  // role, only its rows do.
  const all = ((requests ?? []) as LeaveRequest[]).filter(
    (r) => ctx.isAdmin || r.membership_id === ctx.membership.id
  );
  const pending = all.filter((r) => r.status === "pending");
  // What each pending person is scheduled to give over the days asked for,
  // read under the director's own RLS (kg_leave_conflicts is an invoker
  // function): the approve dialog states the counts as a warning. Only the
  // director decides, so only the director pays for the read; a failed read
  // leaves the sentence out rather than blocking the decision.
  const conflictsById = new Map<string, { lessons: number; sessions: number }>();
  if (ctx.isAdmin && pending.length > 0) {
    const reads = await Promise.all(
      pending.map((r) =>
        supabase.rpc("kg_leave_conflicts", {
          p_tenant: ctx.tenant.id,
          p_membership: r.membership_id,
          p_from: r.start_date,
          p_to: r.end_date,
        }),
      ),
    );
    pending.forEach((r, i) => {
      const body = reads[i].error ? null : (reads[i].data as { lessons?: unknown[]; sessions?: unknown[] } | null);
      if (!body) return;
      conflictsById.set(r.id, {
        lessons: Array.isArray(body.lessons) ? body.lessons.length : 0,
        sessions: Array.isArray(body.sessions) ? body.sessions.length : 0,
      });
    });
  }
  const upcoming = all
    .filter((r) => r.status === "approved" && r.end_date >= today)
    .sort((a, b) => a.start_date.localeCompare(b.start_date));
  // History: what was approved and has passed, plus every refusal and
  // withdrawal. Already newest first from the query.
  const past = all.filter(
    (r) => (r.status === "approved" && r.end_date < today) || r.status === "rejected" || r.status === "cancelled"
  );
  // Three groups inside the one table, empty ones dropped: the three cards
  // that stood here (a gold-framed inbox, a list with an accent bar, and the
  // full table underneath) said each request twice.
  const groups = [
    { key: "pending", label: t("leaves.pendingTitle"), rows: pending },
    { key: "upcoming", label: t("leaves.upcomingTitle"), rows: upcoming },
    { key: "past", label: t("leaves.pastTitle"), rows: past },
  ].filter((g) => g.rows.length > 0);

  const typeLabel = (lt: string) =>
    ["vacation", "sick", "personal"].includes(lt)
      ? t(`leaves.types.${lt as "vacation" | "sick" | "personal"}`)
      : lt;

  const leaveRow = (lr: LeaveRequest) => {
    const person = personOf(lr.membership_id);
    const tone = ROW_TONE[lr.status];
    const start = formatDate(lr.start_date, locale);
    const end = formatDate(lr.end_date, locale);
    // A one-day leave prints its day once; a span reads as a range, never as
    // an arrow, with the day count as the quiet aside. Each half holds
    // together, so on a narrow table the count drops to a second line rather
    // than the range breaking in the middle. The decision dialog repeats the
    // same period, so it is built once here.
    const period = (
      <>
        <span className="whitespace-nowrap">
          {lr.start_date === lr.end_date ? start : <ValueRange from={start} to={end} separator="–" />}
        </span>{" "}
        <span className="whitespace-nowrap text-muted-foreground tabular-nums">
          · {t("leaves.days", { count: leaveDays(lr) })}
        </span>
      </>
    );
    return (
      <TableRow key={lr.id} className="transition-colors hover:bg-primary/5">
        <TableCell>
          {/* A leave has no page of its own, so the row has no door: the
              person's name is the only link, and it goes to their file. */}
          <span className="flex items-center gap-3">
            <Avatar className="size-8">
              <AvatarImage src={person.avatarUrl ?? undefined} alt="" />
              <AvatarFallback className="bg-primary/10 text-[11px] font-semibold text-primary">
                {initialsFromName(person.name) || "?"}
              </AvatarFallback>
            </Avatar>
            <StaffLink id={lr.membership_id} className="min-w-0 truncate font-semibold">
              <bdi dir="auto">{person.name}</bdi>
            </StaffLink>
          </span>
        </TableCell>
        <TableCell>{typeLabel(lr.leave_type)}</TableCell>
        <TableCell className="whitespace-normal">{period}</TableCell>
        {/* The reason wraps in full — the decision rests on it — with a floor so a
            phone scrolls the table sideways rather than squeezing it to a word
            per line. */}
        <TableCell className="max-w-md min-w-28 text-sm whitespace-normal text-muted-foreground">
          {lr.reason ? <bdi dir="auto">{lr.reason}</bdi> : "—"}
        </TableCell>
        <TableCell className="whitespace-nowrap text-muted-foreground tabular-nums">
          {formatDate(lr.created_at, locale)}
        </TableCell>
        <TableCell>
          {tone && <StatusPill tone={tone}>{t(`leaves.status.${lr.status}`)}</StatusPill>}
        </TableCell>
        {/* Two labelled verbs, as on the advances page; the cell keeps them on
            one line and the reason column gives way instead. */}
        <TableCell className="w-0 whitespace-nowrap">
          {lr.status === "pending" &&
            (ctx.isAdmin ? (
              <LeaveDecisionButtons
                id={lr.id}
                memberName={person.name}
                period={period}
                conflicts={conflictsById.get(lr.id)}
              />
            ) : (
              lr.membership_id === ctx.membership.id && (
                <span className="flex justify-end">
                  <LeaveCancelButton id={lr.id} />
                </span>
              )
            ))}
        </TableCell>
      </TableRow>
    );
  };

  return (
    <div>
      {/* Not in the sidebar, so without this the only way out is the browser. */}
      <Link
        href="/staff"
        className="mb-3 inline-flex items-center gap-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground"
      >
        <ArrowLeft className="size-4 rtl:rotate-180" aria-hidden />
        {t("detail.backToTeam")}
      </Link>

      <PageHeader
        title={t("leaves.title")}
        description={ctx.isAdmin ? t("leaves.description") : t("leaves.myRequests")}
      >
        <LeaveRequestDialog defaultDate={today} />
      </PageHeader>

      {requestsError ? (
        <Alert variant="destructive">
          <AlertCircle />
          <AlertTitle>{t("errors.generic")}</AlertTitle>
          <AlertDescription>{t("leaves.empty")}</AlertDescription>
        </Alert>
      ) : all.length === 0 ? (
        <EmptyState icon={<CalendarDays />} title={t("leaves.empty")} />
      ) : (
        <Card className="border border-border py-0 shadow-sm ring-0">
          <CardContent className="px-0">
            <Table className="[&_td]:px-3 [&_th]:px-3 [&_td:first-child]:ps-5 [&_th:first-child]:ps-5 [&_td:last-child]:pe-5 [&_th:last-child]:pe-5">
              <TableHeader>
                <TableRow className="[&>th]:font-semibold">
                  <TableHead>{t("leaves.columns.member")}</TableHead>
                  <TableHead>{t("leaves.columns.type")}</TableHead>
                  <TableHead>{t("leaves.columns.period")}</TableHead>
                  <TableHead>{t("leaves.columns.reason")}</TableHead>
                  <TableHead>{t("leaves.columns.requestedOn")}</TableHead>
                  <TableHead>{t("leaves.columns.status")}</TableHead>
                  <TableHead className="w-0">
                    <span className="sr-only">{t("leaves.columns.actions")}</span>
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {groups.map((g) => (
                  <Fragment key={g.key}>
                    {/* The group row says the status once, for every row
                        under it; a pending or approved row carries no pill. */}
                    <TableRow className="bg-muted/30 hover:bg-muted/30">
                      <TableCell colSpan={COLUMNS} className="py-1.5 text-xs">
                        <span className="flex items-center gap-2">
                          <span className="font-semibold">{g.label}</span>
                          <span className="text-muted-foreground tabular-nums">{g.rows.length}</span>
                        </span>
                      </TableCell>
                    </TableRow>
                    {g.rows.map(leaveRow)}
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
