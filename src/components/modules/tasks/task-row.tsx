"use client";

// One task as a row of the register. The row was a card with a coloured
// rule, a priority pill, a due pill, two outline chips and a face — four
// marks for four facts, each in its own colour. Here every fact is a column,
// said once: the priority is one pill (normal says nothing), the date is red
// only when it is overdue, the child is a link, the person is a face and a
// name.
//
// A client component on purpose: the title is the dialog's trigger, slotted
// by Radix, and an element built in an async server component reaches the
// slot as a lazy reference during streaming SSR — the slot then throws and
// the page falls to its error boundary. Built here, the trigger is a plain
// element and the row costs nothing more: every prop is already serialised.

import Link from "next/link";
import { useLocale, useTranslations } from "next-intl";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { TableCell, TableRow } from "@/components/ui/table";
import { ChildLink } from "@/components/shared/entity-link";
import { StatusPill, type StatusTone } from "@/components/shared/status-pill";
import { formatDate, initialsFromName } from "@/lib/format";
import { cn } from "@/lib/utils";
import { TaskDialog } from "./task-dialog";
import { TaskQuickActions } from "./task-quick-actions";
import { dueTone } from "./dates";
import type { AssigneeOption, ChildOption, TaskCardData, TaskPriority } from "./types";

/** The one priority mark. The expected priority is no mark at all. */
const PRIORITY_TONE: Record<TaskPriority, StatusTone | null> = {
  urgent: "danger",
  high: "attention",
  normal: null,
  low: "muted",
};

export function TaskRow({
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
  const t = useTranslations("tasks");
  const tc = useTranslations("common");
  const locale = useLocale();

  const isOpen = task.status === "todo" || task.status === "in_progress";
  const tone = isOpen && task.due_date ? dueTone(task.due_date, today) : null;
  const priorityTone = PRIORITY_TONE[task.priority];

  // A done task is dated by when it was finished — that is the date the
  // Terminées group is sorted on, so the column reads in the row's order.
  // An open task is dated by when it is due, red once it has passed and a
  // gold word on the day itself; a cancelled one keeps its date, plain.
  const dateCell =
    task.status === "done" ? (
      <span className="text-muted-foreground">
        {task.completed_at ? formatDate(task.completed_at, locale) : "—"}
      </span>
    ) : !task.due_date ? (
      <span className="text-muted-foreground">—</span>
    ) : tone === "overdue" ? (
      <span className="font-medium text-destructive">{formatDate(task.due_date, locale)}</span>
    ) : tone === "today" ? (
      <span className="font-medium text-gold-ink">{tc("labels.today")}</span>
    ) : (
      <span className="text-muted-foreground">{formatDate(task.due_date, locale)}</span>
    );

  const hasChild = Boolean(task.child_id && task.childName);
  const hasInvoice = Boolean(task.invoice_id && task.invoiceNumber !== null);

  return (
    <TableRow className="relative transition-colors hover:bg-primary/5">
      <TableCell className="min-w-64 whitespace-normal">
        {/* The title is the row's door: it opens the edit dialog, and its
            overlay reaches every cell. The controls at the end are lifted
            above it. The cell may wrap and both lines are capped in width:
            table cells do not wrap by default, so an auto-layout table sized
            this column to its longest description and pushed the controls
            off the card. The title wraps only when squeezed; the description
            is one truncated line. */}
        <TaskDialog
          task={task}
          assignees={assignees}
          childOptions={childOptions}
          trigger={
            <button
              type="button"
              className={cn(
                "block max-w-md rounded text-start font-semibold after:absolute after:inset-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50",
                task.status === "cancelled" && "text-muted-foreground line-through"
              )}
            >
              <bdi dir="auto">{task.title}</bdi>
            </button>
          }
        />
        {task.description && (
          <p className="mt-0.5 line-clamp-1 max-w-md text-xs text-muted-foreground">
            <bdi dir="auto">{task.description}</bdi>
          </p>
        )}
      </TableCell>
      <TableCell>
        {priorityTone && (
          <StatusPill tone={priorityTone}>{t(`priority.${task.priority}`)}</StatusPill>
        )}
      </TableCell>
      <TableCell className="whitespace-nowrap tabular-nums">{dateCell}</TableCell>
      <TableCell>
        {hasChild || hasInvoice ? (
          <span className="relative z-10 inline-flex items-center gap-1.5">
            {hasChild && (
              <ChildLink id={task.child_id!}>
                <bdi dir="auto">{task.childName}</bdi>
              </ChildLink>
            )}
            {hasChild && hasInvoice && (
              <span aria-hidden className="text-muted-foreground">
                ·
              </span>
            )}
            {hasInvoice && (
              <Link
                href={`/billing/invoices/${task.invoice_id}`}
                dir="ltr"
                className="rounded font-mono text-muted-foreground tabular-nums hover:underline hover:underline-offset-4 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
              >
                #{task.invoiceNumber}
              </Link>
            )}
          </span>
        ) : (
          <span className="text-muted-foreground">—</span>
        )}
      </TableCell>
      <TableCell>
        {task.assigneeName ? (
          <span className="flex items-center gap-2">
            <Avatar className="size-7">
              <AvatarFallback className="bg-primary/10 text-[11px] font-semibold text-primary">
                {initialsFromName(task.assigneeName) || "?"}
              </AvatarFallback>
            </Avatar>
            <bdi dir="auto" className="truncate text-sm">
              {task.assigneeName}
            </bdi>
          </span>
        ) : (
          <span className="text-sm text-muted-foreground">{t("form.unassigned")}</span>
        )}
      </TableCell>
      <TableCell className="w-24">
        <span className="relative z-10 flex items-center justify-end gap-0.5">
          <TaskQuickActions
            taskId={task.id}
            title={task.title}
            status={task.status}
            canDelete={canDelete}
          />
        </span>
      </TableCell>
    </TableRow>
  );
}
