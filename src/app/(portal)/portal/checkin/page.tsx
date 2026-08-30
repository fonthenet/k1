import { getLocale, getTranslations } from "next-intl/server";
import { createClient } from "@/lib/supabase/server";
import { getTenantContext, signedMediaUrl } from "@/lib/tenant";
import { childDisplayName, formatTime, initials } from "@/lib/format";
import type { AttendanceStatus } from "@/lib/types";
import {
  algiersToday,
  classLabel,
  getMyChildren,
  getMyGuardianBadge,
} from "@/components/modules/portal/data";
import {
  CheckinClient,
  type CheckinChildRow,
} from "@/components/modules/portal/checkin-client";
import { CheckinBadgeMissing } from "@/components/modules/portal/checkin-qr-card";
import { allergenLabel } from "@/lib/allergens";
import { isAway } from "@/components/modules/attendance/status-config";

type AttendanceRow = {
  child_id: string;
  status: AttendanceStatus;
  check_in_at: string | null;
  check_out_at: string | null;
  picked_up_by: string | null;
  absence_reason: string | null;
};

type AllergyRow = { child_id: string; allergen: string };

/**
 * The parent's side of the door loop: show a QR, nothing more.
 *
 * The kiosk resolves the guardian from the scanned `tag_code`, shows their photo
 * beside the child's for a staff member to compare, and only then writes
 * attendance. This page therefore performs no mutation at all — see
 * `checkin-client.tsx` for why that separation is the whole security model.
 */
export default async function PortalCheckinPage() {
  const ctx = await getTenantContext();
  const locale = await getLocale();
  const supabase = await createClient();

  const badge = await getMyGuardianBadge(supabase, ctx, locale);

  // No guardian record, or no tag issued yet: a QR built from an empty value
  // would scan as garbage at the door, so say plainly what is missing. Same
  // state the quick dialog shows, so a family never gets two stories.
  if (!badge.hasGuardian || !badge.tagCode) {
    return <CheckinBadgeMissing kind={badge.hasGuardian ? "noBadge" : "noGuardian"} />;
  }

  const today = algiersToday();
  const children = await getMyChildren(supabase, ctx);
  const childIds = children.map((c) => c.id);

  let attendance: AttendanceRow[] = [];
  let allergies: AllergyRow[] = [];
  let statusFailed = false;

  if (childIds.length > 0) {
    const [attRes, allergyRes] = await Promise.all([
      supabase
        .from("kg_attendance")
        .select("child_id, status, check_in_at, check_out_at, picked_up_by, absence_reason")
        .eq("tenant_id", ctx.tenant.id)
        .in("child_id", childIds)
        .eq("date", today),
      supabase
        .from("kg_child_allergies")
        .select("child_id, allergen")
        .eq("tenant_id", ctx.tenant.id)
        .in("child_id", childIds),
    ]);
    // Today's status is context, not the point of the page: if it fails the QR
    // must still render, so flag it and let the client say so.
    statusFailed = !!attRes.error;
    attendance = (attRes.data ?? []) as AttendanceRow[];
    allergies = (allergyRes.data ?? []) as AllergyRow[];
  }

  const tc = await getTranslations("common");
  const attendanceByChild = new Map(attendance.map((row) => [row.child_id, row]));
  const allergensByChild = new Map<string, string[]>();
  for (const row of allergies) {
    allergensByChild.set(row.child_id, [
      ...(allergensByChild.get(row.child_id) ?? []),
      allergenLabel(row.allergen, tc),
    ]);
  }

  const tHome = await getTranslations("portal.home");

  function statusOf(childId: string): CheckinChildRow["status"] {
    const row = attendanceByChild.get(childId);
    if (!row) return { kind: "notYet", time: null, reason: null };
    if (isAway(row.status)) {
      return {
        kind: "absent",
        time: null,
        reason:
          row.absence_reason ?? (row.status === "sick" ? tHome("status.sickReason") : null),
      };
    }
    // Times are formatted here so the server and the client never disagree on
    // the device time zone.
    if (row.check_out_at) {
      return {
        kind: "left",
        time: formatTime(row.check_out_at, locale),
        reason: null,
        collectedBy: row.picked_up_by,
      };
    }
    if (row.check_in_at) {
      return { kind: "arrived", time: formatTime(row.check_in_at, locale), reason: null };
    }
    return { kind: "notYet", time: null, reason: null };
  }

  const childRows: CheckinChildRow[] = await Promise.all(
    children.map(async (child) => ({
      id: child.id,
      name: childDisplayName(child, locale),
      secondaryName:
        locale === "ar"
          ? `${child.first_name} ${child.last_name}`
          : child.first_name_ar && child.last_name_ar
            ? `${child.first_name_ar} ${child.last_name_ar}`
            : null,
      initials: initials(child.first_name, child.last_name),
      photoUrl: await signedMediaUrl(child.photo_path),
      className: classLabel(child, locale),
      classColor: child.kg_classes?.color ?? null,
      allergies: allergensByChild.get(child.id) ?? [],
      status: statusOf(child.id),
    }))
  );

  return (
    <CheckinClient
      tagCode={badge.tagCode}
      guardianName={badge.name}
      childRows={childRows}
      statusFailed={statusFailed}
    />
  );
}
