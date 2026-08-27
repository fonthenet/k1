// One task on the board. Server-rendered; only the controls are client-side.

import Link from "next/link";
import { getLocale, getTranslations } from "next-intl/server";
import { Baby, CalendarDays, Check, Pencil, Receipt, UserRound } from "lucide-react";
import { formatDate } from "@/lib/format";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { TaskDialog } from "./task-dialog";
import { TaskQuickActions } from "./task-quick-actions";
import { dueTone } from "./dates";
import {
  DUE_BADGE,
  PRIORITY_BADGE,
  PRIORITY_RULE,
  type AssigneeOption,
  type ChildOption,
  type TaskCardData,
} from "./types";

/** Two-letter monogram from a display name (works for Arabic and Latin). */
function monogram(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  const first = [...parts[0]][0] ?? "";
  const second = parts.length > 1 ? ([...parts[parts.length - 1]][0] ?? "") : "";
  return (first + second).toUpperCase();
}

export async function TaskCard({
  task,
  today,
  assignees,
  childOptions,
  canDelete,
}: {
  task: TaskCardData;
  today: string;
  assignees: AssigneeOption[];
  childOptions: ChildOption[];
  canDelete: boolean;
}) {
  const t = await getTranslations("tasks");
  const tc = await getTranslations("common");
  const locale = await getLocale();

  const tone = task.due_date ? dueTone(task.due_date, today) : null;
  const isClosed = task.status === "done" || task.status === "cancelled";

  return (
    <article
      className={cn(
        "relative overflow-hidden rounded-xl border border-border bg-card shadow-xs transition-shadow hover:shadow-md",
        task.status === "cancelled" && "opacity-70"
      )}
    >
      <span
        aria-hidden
        className={cn("absolute inset-y-0 start-0 w-1", PRIORITY_RULE[task.priority])}
      />

      <div className="space-y-2.5 p-3 ps-4">
        <div className="flex items-start gap-1.5">
          <h4
            className={cn(
              "min-w-0 flex-1 text-sm leading-snug font-semibold text-balance text-foreground",
              task.status === "cancelled" && "line-through"
            )}
          >
            {task.title}
          </h4>
          <TaskDialog
            task={task}
            assignees={assignees}
            childOptions={childOptions}
            trigger={
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label={tc("actions.edit")}
                title={tc("actions.edit")}
                className="shrink-0 rounded-full text-muted-foreground"
              >
                <Pencil />
              </Button>
            }
          />
          <TaskQuickActions
            taskId={task.id}
            title={task.title}
            status={task.status}
            canDelete={canDelete}
          />
        </div>

        {task.description && (
          <p className="line-clamp-2 text-xs leading-relaxed text-muted-foreground">
            {task.description}
          </p>
        )}

        <div className="flex flex-wrap items-center gap-1.5">
          <Badge className={PRIORITY_BADGE[task.priority]}>{t(`priority.${task.priority}`)}</Badge>

          {task.due_date && !isClosed && tone && (
            <Badge className={DUE_BADGE[tone]}>
              <CalendarDays data-icon="inline-start" />
              {tone === "today"
                ? tc("labels.today")
                : tone === "overdue"
                  ? t("card.overdueOn", { date: formatDate(task.due_date, locale) })
                  : formatDate(task.due_date, locale)}
            </Badge>
          )}

          {task.status === "done" && task.completed_at && (
            <Badge className="border-transparent bg-success/12 font-medium text-success">
              <Check data-icon="inline-start" />
              {formatDate(task.completed_at, locale)}
            </Badge>
          )}

          {task.child_id && task.childName && (
            <Badge asChild variant="outline">
              <Link href={`/children/${task.child_id}`}>
                <Baby data-icon="inline-start" />
                {task.childName}
              </Link>
            </Badge>
          )}

          {task.invoice_id && task.invoiceNumber !== null && (
            <Badge asChild variant="outline">
              <Link href={`/billing/invoices/${task.invoice_id}`}>
                <Receipt data-icon="inline-start" />
                <span className="tabular-nums" dir="ltr">
                  #{task.invoiceNumber}
                </span>
              </Link>
            </Badge>
          )}

          <span className="ms-auto flex items-center">
            {task.assigneeName ? (
              <span
                title={task.assigneeName}
                className="grid size-6 shrink-0 place-items-center rounded-full bg-primary/10 text-[10px] font-bold text-primary"
              >
                {monogram(task.assigneeName)}
                <span className="sr-only">{task.assigneeName}</span>
              </span>
            ) : (
              <span
                title={t("form.unassigned")}
                className="grid size-6 shrink-0 place-items-center rounded-full border border-dashed border-border text-muted-foreground"
              >
                <UserRound className="size-3" />
                <span className="sr-only">{t("form.unassigned")}</span>
              </span>
            )}
          </span>
        </div>
      </div>
    </article>
  );
}
