// Internal task board — staff only. Three lanes (to do / in progress / done)
// with a stat row, a mine/all switch and a status filter. Parents never see
// this surface: kg_tasks RLS is staff-scoped and the route sits behind
// requireStaff().

import Link from "next/link";
import { getLocale, getTranslations } from "next-intl/server";
import { AlarmClock, CircleCheck, ListChecks, Plus, Timer, TriangleAlert } from "lucide-react";
import { requireStaff } from "@/lib/tenant";
import { createClient } from "@/lib/supabase/server";
import { childDisplayName } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { Membership } from "@/lib/types";
import { PageHeader } from "@/components/shared/page-header";
import { StatCard } from "@/components/shared/stat-card";
import { EmptyState } from "@/components/shared/empty-state";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { TaskCard } from "@/components/modules/tasks/task-card";
import { TaskDialog } from "@/components/modules/tasks/task-dialog";
import { TaskFilters } from "@/components/modules/tasks/task-filters";
import { algiersDate, algiersToday, weekStart } from "@/components/modules/tasks/dates";
import {
  BOARD_STATUSES,
  LANE_DOT,
  TASK_STATUSES,
  sortCompleted,
  sortTasks,
  type AssigneeOption,
  type ChildOption,
  type TaskCardData,
  type TaskRow,
  type TaskStatus,
} from "@/components/modules/tasks/types";

/** The done lane is a recent tail, not an archive — the rest sits behind the
 *  status filter. */
const DONE_LANE_LIMIT = 10;

interface ProfileLite {
  id: string;
  full_name: string | null;
}

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
      .select("id, user_id, role, job_title")
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
    "id" | "user_id" | "role" | "job_title"
  >[];
  const userIds = members.map((m) => m.user_id);
  const { data: profiles } = userIds.length
    ? await supabase.from("kg_profiles").select("id, full_name").in("id", userIds)
    : { data: [] as ProfileLite[] };
  const nameByUser = new Map(
    ((profiles ?? []) as ProfileLite[]).map((p) => [p.id, p.full_name ?? ""])
  );

  const assignees: AssigneeOption[] = members
    .map((m) => ({
      id: m.id,
      name: nameByUser.get(m.user_id) || m.job_title || t("form.unnamedMember"),
      role: m.role,
    }))
    .sort((a, b) => a.name.localeCompare(b.name));
  const assigneeName = new Map(assignees.map((a) => [a.id, a.name]));

  const childOptions: ChildOption[] = ((childrenRes.data ?? []) as ChildLite[]).map((c) => ({
    id: c.id,
    label: childDisplayName(c, locale),
  }));
  const childLabel = new Map(childOptions.map((c) => [c.id, c.label]));

  const rawTasks = (tasksRes.data ?? []) as TaskRow[];

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

  // The board itself is the working view: cancelled work is only ever reached
  // through the status filter, and the done lane keeps just the recent tail.
  const visible =
    statusFilter === "all"
      ? scoped.filter((x) => x.status !== "cancelled")
      : scoped.filter((x) => x.status === statusFilter);
  const canDelete = ctx.isAdmin;
  const doneHref = scope === "mine" ? "/tasks?scope=mine&status=done" : "/tasks?status=done";

  const newTaskButton = (
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
  );

  return (
    <div className="space-y-6">
      <PageHeader title={t("title")} description={t("description")}>
        {newTaskButton}
      </PageHeader>

      {tasksRes.error && (
        <Alert variant="destructive">
          <TriangleAlert />
          <AlertTitle>{t("error.title")}</AlertTitle>
          <AlertDescription>{t("error.load")}</AlertDescription>
        </Alert>
      )}

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label={t("stats.open")} value={open.length} icon={<ListChecks />} />
        <StatCard
          label={t("stats.dueToday")}
          value={dueToday}
          icon={<AlarmClock />}
          tone="gold"
        />
        <StatCard
          label={t("stats.overdue")}
          value={overdue}
          icon={<Timer />}
          tone={overdue > 0 ? "danger" : "default"}
        />
        <StatCard
          label={t("stats.doneThisWeek")}
          value={doneThisWeek}
          icon={<CircleCheck />}
          tone="success"
        />
      </div>

      <TaskFilters scope={scope} status={statusFilter} mineCount={mineCount} />

      {visible.length === 0 ? (
        <EmptyState
          icon={<ListChecks />}
          title={t(scoped.length === 0 ? "empty.title" : "empty.filteredTitle")}
          description={t(scoped.length === 0 ? "empty.description" : "empty.filteredDescription")}
          action={scoped.length === 0 ? newTaskButton : undefined}
        />
      ) : statusFilter === "all" ? (
        <div className="grid gap-4 lg:grid-cols-3">
          {BOARD_STATUSES.map((lane) => {
            const inLane = visible.filter((x) => x.status === lane);
            const laneTasks =
              lane === "done"
                ? sortCompleted(inLane).slice(0, DONE_LANE_LIMIT)
                : sortTasks(inLane);
            const hiddenDone = lane === "done" ? inLane.length - laneTasks.length : 0;
            return (
              <section
                key={lane}
                className="rounded-2xl border border-border/70 bg-muted/40 p-3"
                aria-label={t(`status.${lane}`)}
              >
                <header className="mb-3 flex items-center gap-2 px-1">
                  <span className={cn("size-2 shrink-0 rounded-full", LANE_DOT[lane])} aria-hidden />
                  <h3 className="text-sm font-semibold text-foreground">{t(`status.${lane}`)}</h3>
                  <span className="rounded-full bg-card px-2 py-0.5 text-xs font-semibold tabular-nums text-muted-foreground">
                    {inLane.length}
                  </span>
                </header>
                {laneTasks.length === 0 ? (
                  <p className="rounded-xl border border-dashed border-border px-3 py-6 text-center text-xs text-muted-foreground">
                    {t(`laneEmpty.${lane}`)}
                  </p>
                ) : (
                  <div className="space-y-2.5">
                    {laneTasks.map((task) => (
                      <TaskCard
                        key={task.id}
                        task={task}
                        today={today}
                        assignees={assignees}
                        childOptions={childOptions}
                        canDelete={canDelete}
                      />
                    ))}
                    {hiddenDone > 0 && (
                      <Link
                        href={doneHref}
                        className="block rounded-xl border border-dashed border-border px-3 py-2.5 text-center text-xs font-medium text-muted-foreground transition-colors hover:border-primary/40 hover:text-primary"
                      >
                        {t("board.moreDone", { count: hiddenDone })}
                      </Link>
                    )}
                  </div>
                )}
              </section>
            );
          })}
        </div>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {(statusFilter === "done" ? sortCompleted(visible) : sortTasks(visible)).map((task) => (
            <TaskCard
              key={task.id}
              task={task}
              today={today}
              assignees={assignees}
              childOptions={childOptions}
              canDelete={canDelete}
            />
          ))}
        </div>
      )}
    </div>
  );
}
