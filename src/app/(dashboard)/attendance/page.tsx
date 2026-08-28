import { getLocale, getTranslations } from "next-intl/server";
import { requireStaff, signedMediaUrl } from "@/lib/tenant";
import { createClient } from "@/lib/supabase/server";
import { isOpenDay, toOpeningHours } from "@/lib/week";
import type { AttendanceStatus } from "@/lib/types";
import { PageHeader } from "@/components/shared/page-header";
import {
  RegisterClient,
  type RegisterClassTab,
  type RegisterRow,
} from "@/components/modules/attendance/register-client";
import { isPresentish } from "@/components/modules/attendance/status-config";
import { allergenLabel } from "@/lib/allergens";
import {
  isValidDateStr,
  parseDateStr,
  toDateStr,
} from "@/components/modules/attendance/dates";

export const dynamic = "force-dynamic";

interface ClassRecord {
  id: string;
  name: string;
  name_ar: string | null;
}

interface ChildRecord {
  id: string;
  first_name: string;
  last_name: string;
  first_name_ar: string | null;
  last_name_ar: string | null;
  photo_path: string | null;
  class_id: string | null;
}

interface AttendanceRecord {
  child_id: string;
  status: AttendanceStatus;
  check_in_at: string | null;
  check_out_at: string | null;
  picked_up_by: string | null;
  absence_reason: string | null;
}

export default async function AttendancePage({
  searchParams,
}: {
  searchParams: Promise<{ date?: string; class?: string }>;
}) {
  const ctx = await requireStaff();
  const t = await getTranslations("attendance");
  const tc = await getTranslations("common");
  const locale = await getLocale();
  const sp = await searchParams;

  const date = isValidDateStr(sp.date) ? sp.date : toDateStr(new Date());
  const activeClass = sp.class && sp.class !== "all" ? sp.class : "all";

  const supabase = await createClient();

  let childrenQuery = supabase
    .from("kg_children")
    .select("id, first_name, last_name, first_name_ar, last_name_ar, photo_path, class_id")
    .eq("tenant_id", ctx.tenant.id)
    .eq("status", "enrolled")
    .order("first_name")
    .order("last_name");
  if (activeClass !== "all") childrenQuery = childrenQuery.eq("class_id", activeClass);

  const [classesRes, childrenRes, attendanceRes, allergiesRes, rosterRes] = await Promise.all([
    supabase
      .from("kg_classes")
      .select("id, name, name_ar")
      .eq("tenant_id", ctx.tenant.id)
      .order("name"),
    childrenQuery,
    supabase
      .from("kg_attendance")
      .select("child_id, status, check_in_at, check_out_at, picked_up_by, absence_reason")
      .eq("tenant_id", ctx.tenant.id)
      .eq("date", date),
    supabase
      .from("kg_child_allergies")
      .select("child_id, allergen")
      .eq("tenant_id", ctx.tenant.id),
    // The class tabs must show their counts no matter which class is filtered
    // into the table, so the roster is a separate, deliberately thin query:
    // ids and class assignment only — no photos to sign, no names to carry.
    supabase
      .from("kg_children")
      .select("id, class_id")
      .eq("tenant_id", ctx.tenant.id)
      .eq("status", "enrolled"),
  ]);

  const firstError =
    classesRes.error ??
    childrenRes.error ??
    attendanceRes.error ??
    allergiesRes.error ??
    rosterRes.error;
  if (firstError) throw new Error(firstError.message);

  const classes = (classesRes.data ?? []) as ClassRecord[];
  const roster = (rosterRes.data ?? []) as { id: string; class_id: string | null }[];
  const children = (childrenRes.data ?? []) as ChildRecord[];
  const attendance = (attendanceRes.data ?? []) as AttendanceRecord[];

  const attendanceByChild = new Map(attendance.map((a) => [a.child_id, a]));
  const allergiesByChild = new Map<string, string[]>();
  for (const a of allergiesRes.data ?? []) {
    const list = allergiesByChild.get(a.child_id) ?? [];
    list.push(allergenLabel(a.allergen, tc));
    allergiesByChild.set(a.child_id, list);
  }
  const classById = new Map(classes.map((c) => [c.id, c]));

  // Presence per class for the tabs. "Present" here means exactly what the
  // green tile means (present or late), so the number on a tab and the numbers
  // above it can never tell two different stories about the same room.
  const presentChildIds = new Set(
    attendance.filter((a) => isPresentish(a.status)).map((a) => a.child_id)
  );
  const presenceByClass = new Map<string, { present: number; total: number }>();
  let presentAll = 0;
  for (const r of roster) {
    if (presentChildIds.has(r.id)) presentAll++;
    // A child without a class still counts in "all classes", just not in a tab.
    if (!r.class_id) continue;
    const entry = presenceByClass.get(r.class_id) ?? { present: 0, total: 0 };
    entry.total++;
    if (presentChildIds.has(r.id)) entry.present++;
    presenceByClass.set(r.class_id, entry);
  }
  const classTabs: RegisterClassTab[] = classes.map((c) => ({
    ...c,
    present: presenceByClass.get(c.id)?.present ?? 0,
    total: presenceByClass.get(c.id)?.total ?? 0,
  }));

  const photoUrls = await Promise.all(
    children.map((c) => signedMediaUrl(c.photo_path))
  );

  const rows: RegisterRow[] = children.map((c, i) => {
    const klass = c.class_id ? classById.get(c.class_id) : undefined;
    const att = attendanceByChild.get(c.id);
    return {
      child: {
        id: c.id,
        first_name: c.first_name,
        last_name: c.last_name,
        first_name_ar: c.first_name_ar,
        last_name_ar: c.last_name_ar,
        photoUrl: photoUrls[i],
        className: klass?.name ?? null,
        classNameAr: klass?.name_ar ?? null,
      },
      allergies: allergiesByChild.get(c.id) ?? [],
      attendance: att
        ? {
            status: att.status,
            check_in_at: att.check_in_at,
            check_out_at: att.check_out_at,
            picked_up_by: att.picked_up_by,
            absence_reason: att.absence_reason,
          }
        : null,
    };
  });

  const dateObj = parseDateStr(date);
  const openingHours = toOpeningHours(
    (ctx.tenant as { opening_hours?: unknown }).opening_hours
  );
  const dateLabel = new Intl.DateTimeFormat(locale === "ar" ? "ar-DZ" : "fr-DZ", {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
  }).format(dateObj);

  return (
    <div>
      <PageHeader title={t("title")} description={`${t("description")} — ${dateLabel}`} />
      <RegisterClient
        date={date}
        isClosedDay={!isOpenDay(openingHours, dateObj)}
        dayLabel={new Intl.DateTimeFormat(locale === "ar" ? "ar-DZ" : "fr-DZ", {
          weekday: "long",
        }).format(dateObj)}
        classes={classTabs}
        totals={{ present: presentAll, total: roster.length }}
        activeClass={activeClass}
        rows={rows}
      />
    </div>
  );
}
