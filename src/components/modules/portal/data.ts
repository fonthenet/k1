// Server-side data helpers for the parent portal.
import "server-only";

import type { createClient } from "@/lib/supabase/server";
import type { TenantContext } from "@/lib/tenant";
import type { ChildStatus, Gender } from "@/lib/types";
import { childDisplayName, initials } from "@/lib/format";
import { loadDossierSummary } from "@/lib/dossier-server";
import type { DossierSummaryRow } from "@/lib/dossier";
import type { Structure } from "@/components/modules/classes/class-types";
import type {
  CheckinDialogChild,
  CheckinDialogChildStatus,
} from "./checkin-dialog";
import type { PortalClassOption, PortalGuardianBadge } from "./portal-types";

type Supabase = Awaited<ReturnType<typeof createClient>>;

// ----- Africa/Algiers calendar helpers (Sunday–Thursday week) -----

// algiersToday lives in src/lib/algiers.ts; imported and re-exported so both
// this module's own helpers and existing importers keep resolving.
import { algiersToday } from "@/lib/algiers";
export { algiersToday };

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
  /** Which structure of the building the child is on the register of (0134). */
  structure_id: string | null;
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
      "id, first_name, last_name, first_name_ar, last_name_ar, dob, gender, photo_path, class_id, structure_id, status, kg_classes(name, name_ar, color)"
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

// ----- The building's structures -----

/**
 * The active structures of the building, in the director's order.
 *
 * Read by the portal for one reason: a family whose crèche also runs an
 * école must be able to tell which side of the building each child is on,
 * and choose one when they enrol a sibling or ask for a move. RLS `str_sel`
 * lets any member read them. Callers show the structure at all only when
 * there is more than one — for the ordinary single-structure crèche the word
 * never appears, exactly as it never appears in the dashboard.
 */
export async function getStructures(supabase: Supabase, ctx: TenantContext): Promise<Structure[]> {
  const { data } = await supabase
    .from("kg_structures")
    .select("id, name, name_ar, center_type, color, sort_order, active")
    .eq("tenant_id", ctx.tenant.id)
    .eq("active", true)
    .order("sort_order")
    .order("name");
  return (data ?? []) as Structure[];
}

/**
 * Every class of the building, for the class preference on a sibling request
 * or a transfer request. Names and bands only: how full a room is stays the
 * office's business, as it does on the public form.
 */
export async function getPortalClasses(
  supabase: Supabase,
  ctx: TenantContext
): Promise<PortalClassOption[]> {
  const { data } = await supabase
    .from("kg_classes")
    .select("id, name, name_ar, structure_id, age_min_months, age_max_months")
    .eq("tenant_id", ctx.tenant.id)
    .order("age_min_months", { ascending: true, nullsFirst: false })
    .order("name");
  return (data ?? []) as PortalClassOption[];
}

// ----- A child's moves between structures (kg_child_transfers, 0140) -----

export interface PortalTransferRow {
  id: string;
  from_structure_id: string | null;
  to_structure_id: string | null;
  effective_date: string;
}

/**
 * The child's own history of moves, oldest first. Policy `ctr_sel` lets a
 * parent read their own child's rows; the table has no writer but
 * kg_move_child, so what comes back is a record, not a draft.
 */
export async function getChildTransfers(
  supabase: Supabase,
  childId: string
): Promise<PortalTransferRow[]> {
  const { data } = await supabase
    .from("kg_child_transfers")
    .select("id, from_structure_id, to_structure_id, effective_date")
    .eq("child_id", childId)
    .order("effective_date", { ascending: true })
    .order("created_at", { ascending: true });
  return (data ?? []) as PortalTransferRow[];
}

// ----- The dossier d'inscription: what is still to hand in (0164) -----

/**
 * The family's children whose enrolment file is not complete: the rows of
 * kg_dossier_summary with at least one active required paper missing,
 * refused or expired. RLS narrows the summary to the caller's own children
 * (and their own open applications, which the callers ignore by child_id).
 *
 * Empty for a tenant that has not activated its list (D14): every child then
 * has zero required papers, so no row carries a gap and nothing on the home
 * or the children list mentions a dossier at all.
 */
export async function getDossierGaps(
  supabase: Supabase,
  tenantId: string
): Promise<DossierSummaryRow[]> {
  const rows = await loadDossierSummary(supabase, tenantId);
  return rows.filter((row) => row.missing > 0);
}

// ----- Is a transfer already asked for? -----

export interface PendingTransfer {
  applicationId: string;
  /** The structure the family asked for, when the row is readable; see below. */
  toStructureId: string | null;
}

type MyApplicationRow = {
  id: string;
  closed: boolean;
  source: string | null;
  existing_child_id: string | null;
  structure_id: string | null;
};

/**
 * The transfer request still open for this child, if any.
 *
 * Read through kg_my_applications() (0058, extended in 0142): the row itself
 * is staff-only under RLS because a family must not see where their dossier
 * sits in the pipeline — but which child and which structure THEY asked for
 * are their own words, and the RPC hands those back. A closed (refused)
 * request is not pending; the family may ask again.
 */
export async function getPendingTransfer(
  supabase: Supabase,
  child: Pick<PortalChildRow, "id" | "first_name" | "last_name">
): Promise<PendingTransfer | null> {
  const { data } = await supabase.rpc("kg_my_applications");
  const open = ((data ?? []) as MyApplicationRow[]).find(
    (a) => !a.closed && a.existing_child_id === child.id
  );
  return open ? { applicationId: open.id, toStructureId: open.structure_id } : null;
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
