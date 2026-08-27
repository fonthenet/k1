// Badge tone classes + option lists for the staff module.
// Every tone is a theme token (see THEME.md) — never a raw Tailwind palette
// colour — so light/dark come for free. Each role gets its own tint so the
// team table is scannable at a glance.
import type { LeaveStatus } from "@/lib/types";
import type { MemberStatus, StaffRole } from "./staff-types";

export const STAFF_ROLES: StaffRole[] = ["owner", "admin", "educator", "staff", "accountant"];
export const LEAVE_TYPES = ["vacation", "sick", "personal"] as const;

const PILL = "border-transparent font-medium";

export const ROLE_BADGE: Record<StaffRole, string> = {
  owner: `${PILL} bg-gold text-gold-foreground`,
  admin: `${PILL} bg-primary/10 text-primary`,
  educator: `${PILL} bg-success/10 text-success`,
  staff: `${PILL} bg-muted text-muted-foreground`,
  accountant: `${PILL} bg-chart-4/15 text-chart-4`,
};

export const MEMBER_STATUS_BADGE: Record<MemberStatus, string> = {
  active: `${PILL} bg-success/10 text-success`,
  invited: "border-warning/40 bg-warning/15 text-foreground font-medium",
  disabled: `${PILL} bg-destructive/10 text-destructive`,
};

export const LEAVE_STATUS_BADGE: Record<LeaveStatus, string> = {
  pending: "border-warning/40 bg-warning/15 text-foreground font-medium",
  approved: `${PILL} bg-success/10 text-success`,
  rejected: `${PILL} bg-destructive/10 text-destructive`,
  cancelled: `${PILL} bg-muted text-muted-foreground`,
};
