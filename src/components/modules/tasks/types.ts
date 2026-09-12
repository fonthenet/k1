// Row shapes and sort orders for the internal task board (kg_tasks).
// Staff-only surface: RLS keeps parents out, and nothing here is ever rendered
// in the parent portal.

export const TASK_STATUSES = ["todo", "in_progress", "done", "cancelled"] as const;
export type TaskStatus = (typeof TASK_STATUSES)[number];

/** The three lanes of the board. `cancelled` lives behind the status filter. */
export const BOARD_STATUSES = ["todo", "in_progress", "done"] as const;
export type BoardStatus = (typeof BOARD_STATUSES)[number];

export const TASK_PRIORITIES = ["urgent", "high", "normal", "low"] as const;
export type TaskPriority = (typeof TASK_PRIORITIES)[number];

/** Raw kg_tasks row (the columns this module reads). */
export interface TaskRow {
  id: string;
  title: string;
  description: string | null;
  assignee_id: string | null;
  child_id: string | null;
  invoice_id: string | null;
  due_date: string | null;
  status: TaskStatus;
  priority: TaskPriority;
  completed_at: string | null;
  created_at: string;
}

/** A task flattened server-side with everything the row needs to render. */
export interface TaskCardData extends TaskRow {
  assigneeName: string | null;
  childName: string | null;
  invoiceNumber: number | null;
}

export interface AssigneeOption {
  id: string;
  name: string;
  role: string;
}

export interface ChildOption {
  id: string;
  label: string;
}

/**
 * How a due date reads against today. The row paints it once: overdue is the
 * page's one red, today its one gold word, soon and later are plain muted
 * dates. `dates.ts` computes it; the table cell switches on it.
 */
export type DueTone = "overdue" | "today" | "soon" | "later";

/** Board order inside a lane: urgent first, then soonest due, then oldest. */
const PRIORITY_RANK: Record<TaskPriority, number> = {
  urgent: 0,
  high: 1,
  normal: 2,
  low: 3,
};

export function sortTasks(tasks: TaskCardData[]): TaskCardData[] {
  return [...tasks].sort((a, b) => {
    const pr = PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority];
    if (pr !== 0) return pr;
    if (a.due_date !== b.due_date) {
      if (!a.due_date) return 1;
      if (!b.due_date) return -1;
      return a.due_date < b.due_date ? -1 : 1;
    }
    return a.created_at < b.created_at ? -1 : 1;
  });
}

/** Done lane reads newest-completed first — it is a log, not a queue. */
export function sortCompleted(tasks: TaskCardData[]): TaskCardData[] {
  return [...tasks].sort((a, b) => {
    const av = a.completed_at ?? a.created_at;
    const bv = b.completed_at ?? b.created_at;
    return av < bv ? 1 : -1;
  });
}
