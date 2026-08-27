// Server-side data helpers for the parent portal.
import "server-only";

import type { createClient } from "@/lib/supabase/server";
import type { TenantContext } from "@/lib/tenant";
import type { ChildStatus, Gender } from "@/lib/types";
import { childDisplayName, initials } from "@/lib/format";
import type {
  CheckinDialogChild,
  CheckinDialogChildStatus,
} from "./checkin-dialog";
import type { PortalGuardianBadge } from "./portal-types";

type Supabase = Awaited<ReturnType<typeof createClient>>;

// ----- Africa/Algiers calendar helpers (Sunday–Thursday week) -----

/** Today's date in Africa/Algiers as YYYY-MM-DD. */
export function algiersToday(): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Africa/Algiers",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

/** Current month in Africa/Algiers as YYYY-MM. */
export function algiersMonth(): string {
  return algiersToday().slice(0, 7);
}

export function shiftMonth(month: string, delta: number): string {
  const [y, m] = month.split("-").map(Number);
  const d = new Date(Date.UTC(y, m - 1 + delta, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

/** [start, end) date bounds of a YYYY-MM month. */
export function monthRange(month: string): { start: string; end: string } {
  return { start: `${month}-01`, end: `${shiftMonth(month, 1)}-01` };
}

// ----- My children (via guardian links of the signed-in user) -----

export interface PortalChildRow {
  id: string;
  first_name: string;
  last_name: string;
  first_name_ar: string | null;
  last_name_ar: string | null;
  dob: string;
  gender: Gender;
  photo_path: string | null;
  class_id: string | null;
  status: ChildStatus;
  kg_classes: { name: string; name_ar: string | null; color: string } | null;
}

/**
 * Children linked to the signed-in user through kg_guardians → kg_child_guardians.
 * Staff visiting /portal simply get an empty list unless they are also a guardian.
 */
export async function getMyChildren(supabase: Supabase, ctx: TenantContext): Promise<PortalChildRow[]> {
  const { data: guardians } = await supabase
    .from("kg_guardians")
    .select("id")
    .eq("tenant_id", ctx.tenant.id)
    .eq("user_id", ctx.user.id);
  const guardianIds = (guardians ?? []).map((g) => g.id as string);
  if (guardianIds.length === 0) return [];

  const { data: links } = await supabase
    .from("kg_child_guardians")
    .select("child_id")
    .in("guardian_id", guardianIds);
  const childIds = [...new Set((links ?? []).map((l) => l.child_id as string))];
  if (childIds.length === 0) return [];

  const { data: children } = await supabase
    .from("kg_children")
    .select(
      "id, first_name, last_name, first_name_ar, last_name_ar, dob, gender, photo_path, class_id, status, kg_classes(name, name_ar, color)"
    )
    .in("id", childIds)
    .eq("tenant_id", ctx.tenant.id)
    .order("first_name");

  return (children ?? []) as unknown as PortalChildRow[];
}

export function classLabel(child: PortalChildRow, locale: string): string | null {
  if (!child.kg_classes) return null;
  return locale === "ar" && child.kg_classes.name_ar ? child.kg_classes.name_ar : child.kg_classes.name;
}

/**
 * The children a page hands to its check-in triggers.
 *
 * Built ONCE per page from the rows `getMyChildren` already returned, then
 * shared by every trigger on it: the door badge belongs to the guardian, so a
 * page listing four children still asks the database nothing extra to let a
 * parent switch between them inside the dialog.
 *
 * `statuses` is optional on purpose. Only a page that already loaded today's
 * attendance passes it; the dialog never fetches it, and without it the tabs
 * simply carry a face and a name.
 */
export function toCheckinDialogChildren(
  children: PortalChildRow[],
  locale: string,
  photoUrls: Map<string, string | null>,
  statuses?: Map<string, CheckinDialogChildStatus>
): CheckinDialogChild[] {
  return children.map((child) => ({
    id: child.id,
    name: childDisplayName(child, locale),
    // Given name alone on a tab: it is what a parent scans for, and it is what
    // still fits next to a face at 375px with four siblings in the row.
    givenName: locale === "ar" && child.first_name_ar ? child.first_name_ar : child.first_name,
    initials: initials(child.first_name, child.last_name),
    photoUrl: photoUrls.get(child.id) ?? null,
    status: statuses?.get(child.id),
  }));
}

// ----- The parent's door badge (kg_guardians.tag_code) -----

type GuardianBadgeRow = {
  first_name: string;
  last_name: string;
  first_name_ar: string | null;
  last_name_ar: string | null;
  tag_code: string | null;
};

/**
 * The signed-in user's door badge for this tenant.
 *
 * Call this ONCE per page and pass the result down: the badge belongs to the
 * guardian, not to a child, so a page listing four children still asks for it
 * a single time. RLS policy `g_sel` lets a parent read their own guardian row
 * (user_id = auth.uid()), so no elevated access is needed to reach `tag_code`.
 */
export async function getMyGuardianBadge(
  supabase: Supabase,
  ctx: TenantContext,
  locale: string
): Promise<PortalGuardianBadge> {
  const { data } = await supabase
    .from("kg_guardians")
    .select("first_name, last_name, first_name_ar, last_name_ar, tag_code")
    .eq("tenant_id", ctx.tenant.id)
    .eq("user_id", ctx.user.id)
    .order("created_at");

  const guardians = (data ?? []) as GuardianBadgeRow[];
  // A user can in theory hold more than one guardian row in a tenant; prefer
  // the one that actually carries a badge.
  const guardian = guardians.find((g) => g.tag_code) ?? guardians[0] ?? null;
  if (!guardian) return { hasGuardian: false, tagCode: null, name: "" };

  return {
    hasGuardian: true,
    tagCode: guardian.tag_code,
    // `childDisplayName` is structural (first/last + Arabic pair), so it works
    // for a guardian exactly as it does for a child.
    name: childDisplayName(guardian, locale),
  };
}
