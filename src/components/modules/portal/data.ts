// Server-side data helpers for the parent portal.
import "server-only";

import type { createClient } from "@/lib/supabase/server";
import { signedMediaUrl, type TenantContext } from "@/lib/tenant";
import type { ChildStatus, Gender } from "@/lib/types";
import { childDisplayName, initials } from "@/lib/format";
import { loadDossierSummary } from "@/lib/dossier-server";
import type { DossierSummaryRow } from "@/lib/dossier";
import type { Structure } from "@/components/modules/classes/class-types";
import type {
  CheckinBadge,
  CheckinDialogChild,
  CheckinDialogChildStatus,
} from "./checkin-dialog";
import type { CheckinBadgeChild } from "./checkin-qr-card";
import type { PortalClassOption } from "./portal-types";
import { PAIR_RE, pairValue } from "@/lib/door-code";

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

// ----- The parent's door badge (kg_guardians.tag_code) and its children -----

type GuardianBadgeRow = {
  id: string;
  first_name: string;
  last_name: string;
  first_name_ar: string | null;
  last_name_ar: string | null;
  tag_code: string | null;
};

type BadgeChildRow = {
  id: string;
  first_name: string;
  last_name: string;
  first_name_ar: string | null;
  last_name_ar: string | null;
  photo_path: string | null;
  tag_code: string;
};

type BadgeAttendanceRow = {
  child_id: string;
  check_in_at: string | null;
  check_out_at: string | null;
};

/**
 * The signed-in user's door badge for this tenant, and the children it may
 * act for.
 *
 * Call this ONCE per page and pass the result down: the badge belongs to the
 * guardian, not to a child, so a page listing four children still asks for it
 * a single time. RLS policy `g_sel` lets a parent read their own guardian row
 * (user_id = auth.uid()), so no elevated access is needed to reach `tag_code`.
 *
 * Since 0169 the badge is a pager — one card per child, the family last —
 * and a child's card encodes the adult AND the child (`<GUARDIAN>+<CHILD>`,
 * see pairValue). So the badge carries its children: the ENROLLED children
 * linked (kg_child_guardians) to the guardian row whose tag the QR carries,
 * each with their own tag and today's register row for the state line. The
 * links are read for that one row, not for every guardian row of the
 * account, because kg_kiosk_pair verifies the pair against exactly that
 * guardian — a card for a child linked only to some other row of the same
 * account would scan to `not_linked`, and a card that cannot work is worse
 * than no card. (Two guardian rows for one account in one tenant is an
 * office duplicate anyway; every real family has one.) A child with no tag
 * yet cannot have a card and is left to the family one — and so is a child
 * whose tag the kiosk could not read as half of a pair: the office may type
 * a tag by hand (`A 001`, `A_001` are legal in kg_children), and
 * kg_kiosk_pair accepts only `[A-Z0-9-]` either side of the plus, so a card
 * drawn from such a tag would answer "carte illisible" at every scan with
 * nothing to tell the parent the card is the problem. The pair is tested
 * here against the kiosk's own PAIR_RE, on the exact value the QR would
 * carry; a guardian tag that fails it fails every pair, and the pager gives
 * way to the family card alone. Faces are signed through the same cache as
 * the rest of the page, so the child cards cost no new signature where the
 * page already drew the child.
 */
export async function getMyGuardianBadge(
  supabase: Supabase,
  ctx: TenantContext,
  locale: string
): Promise<CheckinBadge> {
  const { data } = await supabase
    .from("kg_guardians")
    .select("id, first_name, last_name, first_name_ar, last_name_ar, tag_code")
    .eq("tenant_id", ctx.tenant.id)
    .eq("user_id", ctx.user.id)
    .order("created_at");

  const guardians = (data ?? []) as GuardianBadgeRow[];
  // A user can in theory hold more than one guardian row in a tenant; prefer
  // the one that actually carries a badge.
  const guardian = guardians.find((g) => g.tag_code) ?? guardians[0] ?? null;
  if (!guardian) return { hasGuardian: false, tagCode: null, name: "", children: [] };

  const badge: CheckinBadge = {
    hasGuardian: true,
    tagCode: guardian.tag_code,
    // `childDisplayName` is structural (first/last + Arabic pair), so it works
    // for a guardian exactly as it does for a child.
    name: childDisplayName(guardian, locale),
    children: [],
  };
  // No tag, no pair: the dialog shows the "not issued yet" state and the
  // children are not worth three reads.
  if (!guardian.tag_code) return badge;

  const { data: links } = await supabase
    .from("kg_child_guardians")
    .select("child_id")
    .eq("guardian_id", guardian.id);
  const childIds = [...new Set((links ?? []).map((l) => l.child_id as string))];
  if (childIds.length === 0) return badge;

  const [{ data: childRows }, { data: todayRows }] = await Promise.all([
    supabase
      .from("kg_children")
      .select("id, first_name, last_name, first_name_ar, last_name_ar, photo_path, tag_code")
      .in("id", childIds)
      .eq("tenant_id", ctx.tenant.id)
      .eq("status", "enrolled")
      .not("tag_code", "is", null)
      .order("first_name")
      .order("last_name"),
    // Today in Algiers, as the register keeps it (kg_today), so the state
    // line agrees with the kiosk and with the chips on the home.
    supabase
      .from("kg_attendance")
      .select("child_id, check_in_at, check_out_at")
      .in("child_id", childIds)
      .eq("date", algiersToday()),
  ]);

  const todayByChild = new Map<string, BadgeAttendanceRow>();
  for (const row of (todayRows ?? []) as BadgeAttendanceRow[]) todayByChild.set(row.child_id, row);

  // Only the children whose card the kiosk can read (see above); the
  // guardian's tag is hoisted so the narrowing holds inside the filter.
  const guardianTag = guardian.tag_code;
  const children = ((childRows ?? []) as BadgeChildRow[]).filter((child) =>
    PAIR_RE.test(pairValue(guardianTag, child.tag_code))
  );
  badge.children = await Promise.all(
    children.map(async (child): Promise<CheckinBadgeChild> => {
      const today = todayByChild.get(child.id);
      return {
        id: child.id,
        name: childDisplayName(child, locale),
        // Given name alone on a tab: it is what a parent scans for, and what
        // still fits next to three siblings at 375px.
        givenName: locale === "ar" && child.first_name_ar ? child.first_name_ar : child.first_name,
        initials: initials(child.first_name, child.last_name),
        photoUrl: await signedMediaUrl(child.photo_path),
        tagCode: child.tag_code,
        today: { checkInAt: today?.check_in_at ?? null, checkOutAt: today?.check_out_at ?? null },
      };
    })
  );
  return badge;
}
