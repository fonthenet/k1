import Link from "next/link";
import { AlertCircle, ArrowLeft, ArrowRight, CalendarCheck2, CalendarDays, Hourglass } from "lucide-react";
import { getLocale, getTranslations } from "next-intl/server";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card, CardContent, CardHeader, CardTitle,
} from "@/components/ui/card";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { EmptyState } from "@/components/shared/empty-state";
import { StaffLink } from "@/components/shared/entity-link";
import { PageHeader } from "@/components/shared/page-header";
import { createClient } from "@/lib/supabase/server";
import { requireStaff } from "@/lib/tenant";
import { formatDate } from "@/lib/format";
import type { Membership } from "@/lib/types";
import { LeaveCancelButton, LeaveDecisionButtons } from "@/components/modules/staff/leave-actions";
import { LeaveRequestDialog } from "@/components/modules/staff/leave-request-dialog";
import { algiersToday } from "@/components/modules/staff/dates";
import { LEAVE_STATUS_BADGE } from "@/components/modules/staff/maps";
import type { LeaveRequest, ProfileLite } from "@/components/modules/staff/staff-types";

function leaveDays(lr: LeaveRequest): number {
  const start = new Date(`${lr.start_date}T12:00:00`);
  const end = new Date(`${lr.end_date}T12:00:00`);
  return Math.max(1, Math.round((end.getTime() - start.getTime()) / 86400000) + 1);
}

export default async function StaffLeavesPage() {
  const ctx = await requireStaff();
  const supabase = await createClient();
  const t = await getTranslations("staff");
  const tc = await getTranslations("common");
  const locale = await getLocale();
  const BackIcon = locale === "ar" ? ArrowRight : ArrowLeft;
  const today = algiersToday();

  const [{ data: requests, error: requestsError }, { data: members }] = await Promise.all([
    supabase
      .from("kg_leave_requests")
      .select("*")
      .eq("tenant_id", ctx.tenant.id)
      .order("created_at", { ascending: false }),
    supabase
      .from("kg_memberships")
      .select("id, user_id")
      .eq("tenant_id", ctx.tenant.id)
      .neq("role", "parent"),
  ]);

  const memberList = (members ?? []) as Pick<Membership, "id" | "user_id">[];
  const userIds = memberList.map((m) => m.user_id);
  const { data: profiles } = userIds.length
    ? await supabase.from("kg_profiles").select("id, full_name, phone, avatar_url").in("id", userIds)
    : { data: [] as ProfileLite[] };
  const profileByUser = new Map((profiles ?? []).map((p) => [p.id, p as ProfileLite]));
  const nameByMembership = new Map(
    memberList.map((m) => [m.id, profileByUser.get(m.user_id)?.full_name || "—"])
  );

  const all = (requests ?? []) as LeaveRequest[];
  const pending = all.filter((r) => r.status === "pending");
  const upcoming = all
    .filter((r) => r.status === "approved" && r.end_date >= today)
    .sort((a, b) => a.start_date.localeCompare(b.start_date));

  const typeLabel = (lt: string) =>
    ["vacation", "sick", "personal"].includes(lt)
      ? t(`leaves.types.${lt as "vacation" | "sick" | "personal"}`)
      : lt;

  return (
    <div>
      <PageHeader title={t("leaves.title")} description={t("leaves.description")}>
        {/* Not in the sidebar, so without this the only way out is the browser. */}
        <Button variant="ghost" asChild>
          <Link href="/staff">
            <BackIcon data-icon="inline-start" />
            {tc("actions.back")}
          </Link>
        </Button>
        <LeaveRequestDialog defaultDate={today} />
      </PageHeader>

      {requestsError ? (
        <Alert variant="destructive">
          <AlertCircle />
          <AlertTitle>{t("errors.generic")}</AlertTitle>
          <AlertDescription>{t("leaves.empty")}</AlertDescription>
        </Alert>
      ) : (
        <div className="grid gap-6">
          {ctx.isAdmin && pending.length > 0 && (
            <Card className="border border-gold/40 shadow-sm ring-0">
              <CardHeader>
                <CardTitle className="flex items-center gap-3">
                  <span className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-gold text-gold-foreground">
                    <Hourglass className="size-4.5" />
                  </span>
                  <span className="flex items-center gap-2 text-base font-semibold">
                    {t("leaves.pendingTitle")}
                    <span className="rounded-full bg-gold/15 px-2 py-0.5 text-xs font-semibold tabular-nums text-foreground">
                      {pending.length}
                    </span>
                  </span>
                </CardTitle>
              </CardHeader>
              <CardContent className="grid gap-3">
                {pending.map((lr) => (
                  <div
                    key={lr.id}
                    className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border bg-muted/30 p-4 transition-colors hover:bg-muted/50"
                  >
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-semibold text-foreground">
                          <StaffLink id={lr.membership_id}>{nameByMembership.get(lr.membership_id) ?? "—"}</StaffLink>
                        </span>
                        <Badge className="border-transparent bg-primary/10 font-medium text-primary">
                          {typeLabel(lr.leave_type)}
                        </Badge>
                        <span className="text-sm text-muted-foreground">
                          {formatDate(lr.start_date, locale)} — {formatDate(lr.end_date, locale)} ·{" "}
                          {t("leaves.days", { count: leaveDays(lr) })}
                        </span>
                      </div>
                      {lr.reason && (
                        <p className="mt-1.5 text-sm leading-relaxed text-muted-foreground">
                          {lr.reason}
                        </p>
                      )}
                    </div>
                    <LeaveDecisionButtons id={lr.id} />
                  </div>
                ))}
              </CardContent>
            </Card>
          )}

          <Card className="border border-border shadow-sm ring-0">
            <CardHeader>
              <CardTitle className="flex items-center gap-3 text-base font-semibold">
                <span className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-success/10 text-success">
                  <CalendarCheck2 className="size-4.5" />
                </span>
                {t("leaves.upcomingTitle")}
              </CardTitle>
            </CardHeader>
            <CardContent>
              {upcoming.length === 0 ? (
                <p className="rounded-xl border border-dashed border-border bg-muted/30 px-4 py-6 text-center text-sm text-muted-foreground">
                  {t("leaves.upcomingEmpty")}
                </p>
              ) : (
                <ul className="grid gap-1">
                  {upcoming.map((lr) => (
                    <li
                      key={lr.id}
                      className="flex flex-wrap items-center gap-2 rounded-lg px-2 py-2 text-sm transition-colors hover:bg-muted/50"
                    >
                      <span aria-hidden className="h-6 w-1 shrink-0 rounded-full bg-success/60" />
                      <span className="font-semibold text-foreground">
                        <StaffLink id={lr.membership_id}>{nameByMembership.get(lr.membership_id) ?? "—"}</StaffLink>
                      </span>
                      <Badge className="border-transparent bg-primary/10 font-medium text-primary">
                        {typeLabel(lr.leave_type)}
                      </Badge>
                      <span className="text-muted-foreground">
                        {formatDate(lr.start_date, locale)} — {formatDate(lr.end_date, locale)} ·{" "}
                        {t("leaves.days", { count: leaveDays(lr) })}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>

          <Card className="overflow-hidden border border-border shadow-sm ring-0">
            <CardHeader>
              <CardTitle className="text-base font-semibold">
                {ctx.isAdmin ? t("leaves.allTitle") : t("leaves.myRequests")}
              </CardTitle>
            </CardHeader>
            <CardContent className="overflow-x-auto p-0">
              {all.length === 0 ? (
                <div className="px-4 pb-2">
                  <EmptyState icon={<CalendarDays />} title={t("leaves.empty")} />
                </div>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      {[
                        t("leaves.columns.member"),
                        t("leaves.columns.type"),
                        t("leaves.columns.period"),
                        t("leaves.columns.reason"),
                        t("leaves.columns.requestedOn"),
                        t("leaves.columns.status"),
                      ].map((label, i) => (
                        <TableHead
                          key={i}
                          className="text-xs font-semibold tracking-wide text-muted-foreground uppercase"
                        >
                          {label}
                        </TableHead>
                      ))}
                      <TableHead className="w-10" />
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {all.map((lr) => (
                      <TableRow key={lr.id} className="transition-colors hover:bg-muted/40">
                        <TableCell className="font-semibold text-foreground">
                          <StaffLink id={lr.membership_id}>{nameByMembership.get(lr.membership_id) ?? "—"}</StaffLink>
                        </TableCell>
                        <TableCell>{typeLabel(lr.leave_type)}</TableCell>
                        <TableCell>
                          {formatDate(lr.start_date, locale)} — {formatDate(lr.end_date, locale)}
                          <span className="ms-1 text-xs text-muted-foreground">
                            ({t("leaves.days", { count: leaveDays(lr) })})
                          </span>
                        </TableCell>
                        <TableCell className="max-w-48 truncate text-muted-foreground">
                          {lr.reason ?? "—"}
                        </TableCell>
                        <TableCell className="text-muted-foreground">
                          {formatDate(lr.created_at, locale)}
                        </TableCell>
                        <TableCell>
                          <Badge className={LEAVE_STATUS_BADGE[lr.status]}>{t(`leaves.status.${lr.status}`)}</Badge>
                        </TableCell>
                        <TableCell className="text-end">
                          {lr.status === "pending" && lr.membership_id === ctx.membership.id && (
                            <LeaveCancelButton id={lr.id} />
                          )}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  );
}
