// Row shapes + token-only tones for the internal task board (kg_tasks).
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

/** A task flattened server-side with everything the card needs to render. */
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

/* ---------------------------------------------------------------------------
   Tones — tokens only (see THEME.md). Priority escalates by weight as well as
   hue (muted wash → teal tint → solid gold → solid red) so the board stays
   readable at a glance and for colour-blind users.
--------------------------------------------------------------------------- */

const PILL = "border-transparent font-medium";

export const PRIORITY_BADGE: Record<TaskPriority, string> = {
  urgent: "border-transparent bg-destructive-solid text-destructive-foreground font-semibold",
  high: `${PILL} bg-gold text-gold-foreground`,
  normal: `${PILL} bg-primary/10 text-primary`,
  low: `${PILL} bg-muted text-muted-foreground`,
};

/** Left rule on the card — a second, quieter read of the same priority. */
export const PRIORITY_RULE: Record<TaskPriority, string> = {
  urgent: "bg-destructive",
  high: "bg-gold",
  normal: "bg-primary/40",
  low: "bg-border",
};

export const LANE_DOT: Record<BoardStatus, string> = {
  todo: "bg-muted-foreground/50",
  in_progress: "bg-primary",
  done: "bg-success",
};

export type DueTone = "overdue" | "today" | "soon" | "later";

export const DUE_BADGE: Record<DueTone, string> = {
  overdue: `${PILL} bg-destructive/12 text-destructive`,
  today: `${PILL} bg-gold/20 text-gold-ink`,
  soon: `${PILL} bg-secondary text-secondary-foreground`,
  later: `${PILL} bg-muted text-muted-foreground`,
};

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
