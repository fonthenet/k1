import { BellRing, ClipboardList, Inbox, ListChecks, MessageSquareText, Sparkles } from "lucide-react";
import { getLocale, getTranslations } from "next-intl/server";
import { PageHeader } from "@/components/shared/page-header";
import { PushToggle } from "@/components/shared/push-toggle";
import { SectionCard } from "@/components/shared/section-card";
import { structureName, type Structure } from "@/components/modules/classes/class-types";
import { hasPushDevice } from "@/components/modules/settings/actions";
import {
  journalStatusLine, latestCloseHour, latestCloseOn,
} from "@/components/modules/settings/daily-journal";
import {
  DailyJournalCard, type JournalPreviewChild,
} from "@/components/modules/settings/daily-journal-card";
import { algiersClock, algiersToday } from "@/lib/algiers";
import { dailyJournalSettings, defaultSendAt } from "@/lib/child-day";
import { readJournalLedger, readLastSent } from "@/lib/journal-ledger";
import { createClient } from "@/lib/supabase/server";
import { requireStaff, type TenantContext } from "@/lib/tenant";
import type { Tenant } from "@/lib/types";
import { rosterNoun } from "@/lib/vocabulary";
import { toOpeningHours } from "@/lib/week";

export const dynamic = "force-dynamic";

/**
 * The events whose DB triggers fan out to staff rather than to families
 * (see supabase/migrations/0012_kg_notifications.sql). Listed in the order the
 * office actually cares about them: someone waiting outside first, chores last.
 */
const STAFF_EVENTS = [
  { key: "application", Icon: Inbox },
  { key: "message", Icon: MessageSquareText },
  { key: "activity_request", Icon: Sparkles },
  { key: "task", Icon: ClipboardList },
] as const;

type StructureRow = Structure & { opening_hours: unknown };
type ChildRow = {
  id: string; first_name: string; last_name: string; first_name_ar: string | null; last_name_ar: string | null;
  class_id: string | null; structure_id: string | null;
};
type ClassRow = { id: string; name: string; name_ar: string | null; structure_id: string | null };

/**
 * Everything the Journal du jour card needs, read only for an admin: the
 * building's weeks (the picker's floor and the footer's "closed today"),
 * today's ledger tenant-wide, the last evening that sent, the enrolled
 * children for the preview picker and who is checked in today (the
 * picker's default), and whether this member has a device to preview on.
 */
async function loadJournalCard(ctx: TenantContext, locale: string) {
  const supabase = await createClient();
  const today = algiersToday();
  const [structuresRes, ledger, lastSent, closuresRes, childrenRes, classesRes, attendanceRes, hasDevice] =
    await Promise.all([
      supabase
        .from("kg_structures")
        .select("id, name, name_ar, center_type, color, sort_order, active, opening_hours")
        .eq("tenant_id", ctx.tenant.id)
        .eq("active", true)
        .order("sort_order")
        .order("name"),
      readJournalLedger(supabase, { tenantId: ctx.tenant.id, structureId: null, day: today }),
      readLastSent(supabase, ctx.tenant.id),
      // Confirmed closures only: a tentative Aïd closes nothing (0068, 0103),
      // here as in the sender.
      supabase
        .from("kg_holidays")
        .select("structure_id")
        .eq("tenant_id", ctx.tenant.id)
        .eq("closure", true)
        .eq("tentative", false)
        .lte("date", today)
        .or(`end_date.gte.${today},and(end_date.is.null,date.eq.${today})`),
      supabase
        .from("kg_children")
        .select("id, first_name, last_name, first_name_ar, last_name_ar, class_id, structure_id")
        .eq("tenant_id", ctx.tenant.id)
        .eq("status", "enrolled")
        .order("first_name")
        .order("last_name"),
      supabase
        .from("kg_classes")
        .select("id, name, name_ar, structure_id")
        .eq("tenant_id", ctx.tenant.id),
      supabase
        .from("kg_attendance")
        .select("child_id")
        .eq("tenant_id", ctx.tenant.id)
        .eq("date", today)
        .not("check_in_at", "is", null),
      hasPushDevice(),
    ]);
  const firstError =
    structuresRes.error ?? closuresRes.error ?? childrenRes.error ?? classesRes.error ?? attendanceRes.error;
  if (firstError) throw new Error(firstError.message);

  const structures = (structuresRes.data ?? []) as StructureRow[];
  const tenantHours = (ctx.tenant as Tenant & { opening_hours?: unknown }).opening_hours;
  const closures = (closuresRes.data ?? []) as { structure_id: string | null }[];
  const weeks = structures.length > 0
    ? structures.map((s) => toOpeningHours(s.opening_hours ?? tenantHours))
    : [toOpeningHours(tenantHours)];

  // A tenant that never touched the switch is shown ON (the default since
  // 0163) with the derived evening, not the sender's 17:00 fallback, so the
  // first edit proposes the building's own closing time.
  const proposed = defaultSendAt(weeks);
  const stored = dailyJournalSettings(ctx.tenant.settings);
  const hasStored = typeof ctx.tenant.settings?.daily_journal === "object" && ctx.tenant.settings.daily_journal !== null;
  const settings = hasStored ? stored : { enabled: true, sendAt: proposed };

  const latestCloseToday = latestCloseOn(structures, tenantHours, closures, today);
  const status = journalStatusLine({
    settings,
    today,
    now: algiersClock(new Date()),
    openToday: latestCloseToday !== null,
    latestCloseToday,
    ledger,
    lastSent,
  });

  // The picker lists every enrolled child of the building — never narrowed
  // by the rail, which scopes what is read, not what is done — in the order
  // structure → class → name, so the dialog's groups fall out of the order.
  const structureOrder = new Map(structures.map((s, i) => [s.id, i]));
  const classById = new Map(((classesRes.data ?? []) as ClassRow[]).map((c) => [c.id, c]));
  const checkedIn = new Set(((attendanceRes.data ?? []) as { child_id: string }[]).map((a) => a.child_id));
  const rows = (childrenRes.data ?? []) as ChildRow[];
  const nameOf = (c: ChildRow) => (locale === "ar" && c.first_name_ar ? c.first_name_ar : c.first_name);
  const classNameOf = (cls: ClassRow) => (locale === "ar" && cls.name_ar ? cls.name_ar : cls.name);
  const sorted = rows
    .map((c) => ({ row: c, cls: c.class_id ? classById.get(c.class_id) ?? null : null }))
    .sort((a, b) =>
      (structureOrder.get(a.row.structure_id ?? "") ?? structures.length)
        - (structureOrder.get(b.row.structure_id ?? "") ?? structures.length)
      // A child without a class closes its structure's group.
      || Number(a.cls === null) - Number(b.cls === null)
      || (a.cls && b.cls ? classNameOf(a.cls).localeCompare(classNameOf(b.cls), locale) : 0)
      || nameOf(a.row).localeCompare(nameOf(b.row), locale));
  const children: JournalPreviewChild[] = sorted.map(({ row: c, cls }) => {
    const structure = structures.find((s) => s.id === c.structure_id) ?? null;
    return {
      id: c.id,
      name: `${c.first_name} ${c.last_name}`,
      nameAr: c.first_name_ar && c.last_name_ar ? `${c.first_name_ar} ${c.last_name_ar}` : null,
      classId: cls?.id ?? null,
      className: cls?.name ?? null,
      classNameAr: cls?.name_ar ?? null,
      structureName: structures.length > 1 && structure ? structureName(structure, locale) : null,
      checkedInToday: checkedIn.has(c.id),
    };
  });

  // The first child checked in today within the rail's scope, else the first
  // enrolled: the director opening the preview at 11:00 wants a day that
  // already has something in it.
  const defaultChildId =
    sorted.find(({ row }) =>
      checkedIn.has(row.id) && (ctx.structureId === null || row.structure_id === ctx.structureId))?.row.id
    ?? children[0]?.id
    ?? null;

  return {
    settings,
    defaultSendAt: proposed,
    latestCloseHour: latestCloseHour(structures, tenantHours),
    status,
    noun: rosterNoun(structures.map((s) => s.center_type)),
    children,
    defaultChildId,
    hasDevice,
    today,
  };
}

/**
 * Any staff member may manage their own alerts — the device and event cards
 * are per-person settings, so the page is not admin-gated. The Journal du
 * jour card is the establishment's and renders for admins only.
 */
export default async function NotificationSettingsPage() {
  const ctx = await requireStaff();
  const [t, locale] = await Promise.all([getTranslations("settings"), getLocale()]);
  const journal = ctx.isAdmin ? await loadJournalCard(ctx, locale) : null;

  return (
    <div>
      <PageHeader
        title={t("notifications.title")}
        description={t(ctx.isAdmin ? "notifications.descriptionAdmin" : "notifications.description")}
      />

      <div className="space-y-6">
        {journal && (
          <DailyJournalCard
            settings={journal.settings}
            defaultSendAt={journal.defaultSendAt}
            latestCloseHour={journal.latestCloseHour}
            status={journal.status}
            noun={journal.noun}
            defaultChildId={journal.defaultChildId}
            hasDevice={journal.hasDevice}
            today={journal.today}
            tenantId={ctx.tenant.id}
            userId={ctx.user.id}
          >
            {journal.children}
          </DailyJournalCard>
        )}

        <SectionCard
          icon={BellRing}
          tone={1}
          title={t("notifications.deviceTitle")}
          hint={t("notifications.deviceDescription")}
          contentClassName="gap-3"
        >
          <PushToggle variant="staff" />
          <p className="text-xs text-muted-foreground">{t("notifications.deviceHint")}</p>
        </SectionCard>

        <SectionCard
          icon={ListChecks}
          tone={2}
          title={t("notifications.eventsTitle")}
          hint={t("notifications.eventsDescription")}
        >
          <ul className="divide-y divide-border">
            {STAFF_EVENTS.map(({ key, Icon }) => (
              <li key={key} className="flex items-start gap-3 py-3 first:pt-0 last:pb-0">
                <span
                  className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground"
                  aria-hidden
                >
                  <Icon className="size-4" />
                </span>
                <div className="min-w-0">
                  <p className="text-sm font-medium text-foreground">
                    {t(`notifications.events.${key}.title`)}
                  </p>
                  <p className="mt-0.5 text-sm leading-relaxed text-muted-foreground">
                    {t(`notifications.events.${key}.description`)}
                  </p>
                </div>
              </li>
            ))}
          </ul>
        </SectionCard>
      </div>
    </div>
  );
}
