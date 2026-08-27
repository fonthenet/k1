// Visual configuration for attendance statuses, shared by the register and the history grid.
// Every colour is a theme token (see THEME.md) so the segmented control, the history grid
// and dark mode all stay in sync. Five states need five instantly distinguishable hues:
//   present → success (green)   late → gold (amber)      absent  → destructive (red)
//   sick    → chart-4 (blue)    excused → muted-foreground (neutral "filed / authorised")
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
    activeClass: "bg-gold text-gold-foreground shadow-sm",
    idleClass: "text-muted-foreground hover:bg-gold/20 hover:text-foreground",
    cellClass: "bg-gold",
    tintClass: "bg-gold/20",
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
    activeClass: "bg-chart-4 text-background shadow-sm",
    idleClass: "text-muted-foreground hover:bg-chart-4/20 hover:text-foreground",
    cellClass: "bg-chart-4",
    tintClass: "bg-chart-4/20",
  },
  excused: {
    icon: FileText,
    activeClass: "bg-muted-foreground text-background shadow-sm",
    idleClass: "text-muted-foreground hover:bg-muted-foreground/20 hover:text-foreground",
    cellClass: "bg-muted-foreground",
    tintClass: "bg-muted-foreground/20",
  },
};

/** Statuses counted as "present" in the counters. */
export function isPresentish(s: AttendanceStatus): boolean {
  return s === "present" || s === "late";
}
