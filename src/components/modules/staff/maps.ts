// Option lists and pill tones for the staff module.
// Every tone is a theme token (see THEME.md) — never a raw Tailwind palette
// colour — so light/dark come for free.
import type { LeaveStatus } from "@/lib/types";
import type { StatusTone } from "@/components/shared/status-pill";
import type { MemberStatus, StaffRole } from "./staff-types";

export const STAFF_ROLES: StaffRole[] = ["owner", "admin", "educator", "staff", "accountant"];
export const LEAVE_TYPES = ["vacation", "sick", "personal"] as const;

const PILL = "border-transparent font-medium";

/**
 * One quiet pill for every role, gold for the owner alone.
 *
 * A tint per role made the team table a colour chart — five tints in one
 * column, with green meaning "educator" next to a green meaning "active".
 * The reader tells roles apart by the word; the only role worth an accent
 * is the one person who owns the establishment.
 */
export const ROLE_BADGE: Record<StaffRole, string> = {
  owner: `${PILL} bg-gold-muted text-gold-ink`,
  admin: `${PILL} bg-muted text-foreground`,
  educator: `${PILL} bg-muted text-foreground`,
  staff: `${PILL} bg-muted text-foreground`,
  accountant: `${PILL} bg-muted text-foreground`,
};

/**
 * The tone of a member's status pill — or null for "active", which is the
 * expected state and renders no pill at all. An invitation still waits on a
 * human; a disabled account is an archived one.
 */
export const MEMBER_STATUS_TONE: Record<MemberStatus, StatusTone | null> = {
  active: null,
  invited: "attention",
  disabled: "muted",
};

/**
 * The tone of a leave request's pill. A pending request is waiting on the
 * director; a cancelled one is history and gets the muted outline.
 */
export const LEAVE_STATUS_TONE: Record<LeaveStatus, StatusTone> = {
  pending: "attention",
  approved: "success",
  rejected: "danger",
  cancelled: "muted",
};
