// Internal task register — staff only. One table grouped by status (to do /
// in progress / done) with a stat row, a mine/all switch and a status
// filter. Parents never see this surface: kg_tasks RLS is staff-scoped and
// the route sits behind requireStaff().

import { Fragment } from "react";
import { fetchProfileNames, memberNameIn } from "@/lib/member-names";
import Link from "next/link";
import { getLocale, getTranslations } from "next-intl/server";
import {
  AlarmClock,
  ChevronRight,
  CircleCheck,
  ListChecks,
  Plus,
  Timer,
  TriangleAlert,
} from "lucide-react";
import { requireStaff } from "@/lib/tenant";
import { createClient } from "@/lib/supabase/server";
import { childDisplayName, formatDate } from "@/lib/format";
import type { Membership } from "@/lib/types";
import { PageHeader } from "@/components/shared/page-header";
import { StatCard } from "@/components/shared/stat-card";
import { EmptyState } from "@/components/shared/empty-state";
import { ValueRange } from "@/components/shared/value-range";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { TaskRow } from "@/components/modules/tasks/task-row";
import { TaskDialog } from "@/components/modules/tasks/task-dialog";
import { TaskFilters } from "@/components/modules/tasks/task-filters";
import { algiersDate, algiersToday, weekStart } from "@/components/modules/tasks/dates";
import {
  BOARD_STATUSES,
  TASK_STATUSES,
  sortCompleted,
  sortTasks,
  type AssigneeOption,
  type ChildOption,
  type TaskCardData,
  type TaskRow as TaskRecord,
  type TaskStatus,
} from "@/components/modules/tasks/types";

/** The done group is a recent tail, not an archive — the rest sits behind the
 *  status filter. */
const DONE_LANE_LIMIT = 10;

/** Columns of the register; group rows span them all. */
const COLUMNS = 6;

interface ChildLite {
  id: string;
  first_name: string;
  last_name: string;
  first_name_ar: string | null;
  last_name_ar: string | null;
}

export default async function TasksPage({
  searchParams,
}: {
  searchParams: Promise<{ scope?: string; status?: string }>;
}) {
  const ctx = await requireStaff();
  const [t, locale, sp] = await Promise.all([
    getTranslations("tasks"),
    getLocale(),
    searchParams,
  ]);
  const supabase = await createClient();
  const tid = ctx.tenant.id;

  const scope: "mine" | "all" = sp.scope === "mine" ? "mine" : "all";
  const statusFilter = (TASK_STATUSES as readonly string[]).includes(sp.status ?? "")
    ? (sp.status as TaskStatus)
    : "all";

  const [tasksRes, membersRes, childrenRes] = await Promise.all([
    supabase
      .from("kg_tasks")
      .select("*")
      .eq("tenant_id", tid)
      .order("created_at", { ascending: false }),
    supabase
      .from("kg_memberships")
      .select("id, user_id, full_name, role, job_title")
      .eq("tenant_id", tid)
      .eq("status", "active")
      .neq("role", "parent"),
    supabase
      .from("kg_children")
      .select("id, first_name, last_name, first_name_ar, last_name_ar")
      .eq("tenant_id", tid)
      .eq("status", "enrolled")
      .order("first_name"),
  ]);

  const members = (membersRes.data ?? []) as Pick<
    Membership,
    "id" | "user_id" | "full_name" | "role" | "job_title"
  >[];
  const nameByUser = await fetchProfileNames(supabase, members.map((m) => m.user_id));

  const assignees: AssigneeOption[] = members
    .map((m) => ({
      id: m.id,
      // The job title was standing in for the name of everyone without an
      // account, so a task list read "Cuisine · Ménage · Aide" instead of
      // naming the three people it was assigned to.
      name: memberNameIn(m, nameByUser) || m.job_title || t("form.unnamedMember"),
      role: m.role,
    }))
    .sort((a, b) => a.name.localeCompare(b.name));
  const assigneeName = new Map(assignees.map((a) => [a.id, a.name]));

  const childOptions: ChildOption[] = ((childrenRes.data ?? []) as ChildLite[]).map((c) => ({
    id: c.id,
    label: childDisplayName(c, locale),
  }));
  const childLabel = new Map(childOptions.map((c) => [c.id, c.label]));

  const rawTasks = (tasksRes.data ?? []) as TaskRecord[];

  // Invoice numbers for the tasks that hang off a bill (chase-payment work).
  const invoiceIds = [...new Set(rawTasks.map((r) => r.invoice_id).filter(Boolean))] as string[];
  const { data: invoices } = invoiceIds.length
    ? await supabase
        .from("kg_invoices")
        .select("id, number")
        .eq("tenant_id", tid)
        .in("id", invoiceIds)
    : { data: [] as { id: string; number: number }[] };
  const invoiceNumber = new Map(
    ((invoices ?? []) as { id: string; number: number }[]).map((i) => [i.id, i.number])
  );

  const allTasks: TaskCardData[] = rawTasks.map((r) => ({
    ...r,
    assigneeName: r.assignee_id ? (assigneeName.get(r.assignee_id) ?? null) : null,
    childName: r.child_id ? (childLabel.get(r.child_id) ?? null) : null,
    invoiceNumber: r.invoice_id ? (invoiceNumber.get(r.invoice_id) ?? null) : null,
  }));

  const mineCount = allTasks.filter(
    (x) => x.assignee_id === ctx.membership.id && (x.status === "todo" || x.status === "in_progress")
  ).length;

  // Stats follow the mine/all switch but ignore the status filter — they are
  // the workload summary, not a description of what is on screen.
  const scoped =
    scope === "mine" ? allTasks.filter((x) => x.assignee_id === ctx.membership.id) : allTasks;

  const today = algiersToday();
  const weekOpensOn = weekStart(today);
  const open = scoped.filter((x) => x.status === "todo" || x.status === "in_progress");
  const dueToday = open.filter((x) => x.due_date === today).length;
  const overdue = open.filter((x) => x.due_date && x.due_date < today).length;
  const doneThisWeek = scoped.filter(
    (x) => x.status === "done" && x.completed_at && algiersDate(x.completed_at) >= weekOpensOn
  ).length;

  // The full table is the working view: cancelled work is only ever reached
  // through the status filter, and the done group keeps just the recent tail.
  const visible =
    statusFilter === "all"
      ? scoped.filter((x) => x.status !== "cancelled")
      : scoped.filter((x) => x.status === statusFilter);
  const canDelete = ctx.isAdmin;
  const doneHref = scope === "mine" ? "/tasks?scope=mine&status=done" : "/tasks?status=done";

  // The three workflow statuses always get their group row, count 0 included:
  // an empty "En cours" is a fact about the week, not a missing section. A
  // status filter narrows the table to that one group.
  const groups: TaskStatus[] = statusFilter === "all" ? [...BOARD_STATUSES] : [statusFilter];
  const rowsOf = (status: TaskStatus) => {
    const inGroup = visible.filter((x) => x.status === status);
    const closed = status === "done" || status === "cancelled";
    const sorted = closed ? sortCompleted(inGroup) : sortTasks(inGroup);
    // Only the unfiltered table trims the done tail; ?status=done is where
    // the rest is read.
    const shown =
      status === "done" && statusFilter === "all" ? sorted.slice(0, DONE_LANE_LIMIT) : sorted;
    return { total: inGroup.length, shown, hidden: inGroup.length - shown.length };
  };

  return (
    <div className="space-y-4">
      {/* One primary per page: the thing this page creates. */}
      <PageHeader title={t("title")} description={t("description")}>
        <TaskDialog
          assignees={assignees}
          childOptions={childOptions}
          defaultAssigneeId={ctx.membership.id}
          trigger={
            <Button>
              <Plus data-icon="inline-start" />
              {t("newTask")}
            </Button>
          }
        />
      </PageHeader>

      {tasksRes.error && (
        <Alert variant="destructive">
          <TriangleAlert />
          <AlertTitle>{t("error.title")}</AlertTitle>
          <AlertDescription>{t("error.load")}</AlertDescription>
        </Alert>
      )}

      {/* Three tiles, each with the scope it counts under it: the stats
          follow the mine/all switch but not the status filter. "Tâches
          ouvertes" is no longer a tile — the group rows say it. */}
      <div className="grid gap-4 sm:grid-cols-3">
        <StatCard
          label={t("stats.dueToday")}
          value={dueToday}
          hint={formatDate(today, locale)}
          icon={<AlarmClock />}
          tone="gold"
        />
        <StatCard
          label={t("stats.overdue")}
          value={overdue}
          hint={t(scope === "mine" ? "filters.mine" : "filters.all")}
          icon={<Timer />}
        />
        <StatCard
          label={t("stats.doneThisWeek")}
          value={doneThisWeek}
          hint={
            <ValueRange
              from={formatDate(weekOpensOn, locale)}
              to={formatDate(today, locale)}
              separator="–"
            />
          }
          icon={<CircleCheck />}
          tone="success"
        />
      </div>

      <TaskFilters
        scope={scope}
        status={statusFilter}
        mineCount={mineCount}
        count={visible.length}
      />

      {allTasks.length === 0 ? (
        <EmptyState
          icon={<ListChecks />}
          title={t("empty.title")}
          description={t("empty.description")}
        />
      ) : (
        <Card className="border border-border py-0 shadow-sm ring-0">
          <CardContent className="px-0">
            <Table className="[&_td]:px-3 [&_th]:px-3 [&_td:first-child]:ps-5 [&_th:first-child]:ps-5 [&_td:last-child]:pe-5 [&_th:last-child]:pe-5">
              <TableHeader>
                <TableRow className="[&>th]:font-semibold">
                  <TableHead>{t("columns.task")}</TableHead>
                  <TableHead>{t("form.priority")}</TableHead>
                  <TableHead>{t("form.dueDate")}</TableHead>
                  <TableHead>{t("columns.linkedTo")}</TableHead>
                  <TableHead>{t("form.assignee")}</TableHead>
                  <TableHead className="w-24">
                    <span className="sr-only">{t("card.more")}</span>
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {groups.map((status) => {
                  const { total, shown, hidden } = rowsOf(status);
                  return (
                    <Fragment key={status}>
                      {/* One group row per status inside the one table — the
                          status is said once, with its count, and never again
                          as a pill on the rows beneath it. */}
                      <TableRow className="bg-muted/30 hover:bg-muted/30">
                        <TableCell colSpan={COLUMNS} className="py-1.5 text-xs">
                          <span className="flex items-center gap-2">
                            <span className="font-semibold">{t(`status.${status}`)}</span>
                            <span className="text-muted-foreground tabular-nums">{total}</span>
                          </span>
                        </TableCell>
                      </TableRow>
                      {shown.map((task) => (
                        <TaskRow
                          key={task.id}
                          task={task}
                          today={today}
                          assignees={assignees}
                          childOptions={childOptions}
                          canDelete={canDelete}
                        />
                      ))}
                      {hidden > 0 && (
                        <TableRow className="hover:bg-transparent">
                          <TableCell colSpan={COLUMNS} className="py-2.5">
                            <Link
                              href={doneHref}
                              className="inline-flex items-center gap-1 text-sm text-primary"
                            >
                              {t("board.moreDone", { count: hidden })}
                              <ChevronRight className="size-4 rtl:rotate-180" />
                            </Link>
                          </TableCell>
                        </TableRow>
                      )}
                    </Fragment>
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
