// Visual configuration for attendance statuses, shared by the register and the history grid.
// Every colour is a theme token (see THEME.md) so the segmented control, the history grid
// and dark mode all stay in sync:
//   present → success (green)   late → warning (amber)   absent → destructive (red)
//   sick    → destructive (red) excused → muted-foreground (neutral "filed / authorised")
//
// The tones are the parent portal's and the mobile app's, not a third opinion: a family
// reading "sick" in red while the educator who typed it sees amber is one fact wearing two
// colours. `late` was on --gold, the accent token; the semantic token is --warning, and the
// two resolve to the same amber today, so this rename costs nothing and stops the next
// palette edit from moving a status by accident.
//
// KNOWN, needs a lead call: sick and absent are now the same red, so the history grid and
// its legend cannot separate them at a glance (the cell `title` still names the status).
// That is not new — --chart-4 stopped being blue when the palette moved to
// teal → cyan → mint → amber → coral, and `sick` has been rendering identically to `late`
// ever since, which is the worse collision: it crossed the present/away line. A fifth
// distinguishable hue for this grid is a palette decision, not a module one.
import type { AttendanceStatus } from "@/lib/types";
import { Check, Clock, X, Thermometer, FileText, type LucideIcon } from "lucide-react";

export const ATTENDANCE_STATUSES: AttendanceStatus[] = [
  "present",
  "late",
  "absent",
  "sick",
  "excused",
];

export interface StatusStyle {
  icon: LucideIcon;
  /** Segmented-control button while this status is the selected one. */
  activeClass: string;
  /** Segmented-control button while it is not selected — hover previews its tone. */
  idleClass: string;
  /** Solid swatch: history-grid cell and legend key. */
  cellClass: string;
  /** Soft tint used for the "today" column highlight in the history grid. */
  tintClass: string;
}

export const STATUS_STYLES: Record<AttendanceStatus, StatusStyle> = {
  present: {
    icon: Check,
    activeClass: "bg-success text-success-foreground shadow-sm",
    idleClass: "text-muted-foreground hover:bg-success/15 hover:text-foreground",
    cellClass: "bg-success",
    tintClass: "bg-success/15",
  },
  late: {
    icon: Clock,
    activeClass: "bg-warning text-warning-foreground shadow-sm",
    idleClass: "text-muted-foreground hover:bg-warning/20 hover:text-foreground",
    cellClass: "bg-warning",
    tintClass: "bg-warning/20",
  },
  absent: {
    icon: X,
    activeClass: "bg-destructive-solid text-[var(--destructive-foreground)] shadow-sm",
    idleClass: "text-muted-foreground hover:bg-destructive/15 hover:text-foreground",
    cellClass: "bg-destructive",
    tintClass: "bg-destructive/15",
  },
  sick: {
    icon: Thermometer,
    activeClass: "bg-destructive-solid text-[var(--destructive-foreground)] shadow-sm",
    idleClass: "text-muted-foreground hover:bg-destructive/15 hover:text-foreground",
    cellClass: "bg-destructive",
    tintClass: "bg-destructive/15",
  },
  excused: {
    icon: FileText,
    activeClass: "bg-muted-foreground text-background shadow-sm",
    idleClass: "text-muted-foreground hover:bg-muted-foreground/20 hover:text-foreground",
    cellClass: "bg-muted-foreground",
    tintClass: "bg-muted-foreground/20",
  },
};

// ---------------------------------------------------------------------------
// What the five attendance words mean, in one place.
//
// The web grew four copies of the same idea and one of them disagreed: the
// register counted fourteen "present", the door screen counted twelve, because
// one asked "marked present or late" and the other asked "checked in and not
// yet gone home". Both are honest questions. Only one of them can be called
// "present" in a crèche where staff read both screens in the same minute.
//
// So: `isPresentish` is the answer to "present", everywhere. A screen that
// wants the other question calls `stillHere` and says so in its own label.
// Mirrors `lib/attendance-status.ts` in the mobile app — keep the two in step.
// ---------------------------------------------------------------------------

/** Statuses counted as "present" in the counters. */
export function isPresentish(s: AttendanceStatus | null | undefined): boolean {
  return s === "present" || s === "late";
}

/** The same two words, for `.in("status", …)` on the query side. */
export const PRESENTISH_STATUSES = ["present", "late"] as const;

/** Away, in the sense that somebody should know why. */
export const AWAY: ReadonlySet<AttendanceStatus> = new Set<AttendanceStatus>([
  "absent",
  "sick",
  "excused",
]);

/**
 * Marked away for the day. Status-driven on purpose: a child sent home sick at
 * eleven still has a check-in time, and asking about the timestamp instead of
 * the word loses them from every list.
 */
export function isAway(s: AttendanceStatus | null | undefined): boolean {
  return s != null && AWAY.has(s);
}

/**
 * In the building right now. A different question from `isPresentish`, and it
 * takes snake_case fields because web rows come straight off Postgres (the
 * mobile twin takes the camelCase shape its client hands it).
 */
export function stillHere(a: {
  check_in_at: string | null;
  check_out_at: string | null;
}): boolean {
  return Boolean(a.check_in_at) && !a.check_out_at;
}
