import Link from "next/link";
import { getLocale, getTranslations } from "next-intl/server";
import {
  Baby,
  BookOpen,
  CalendarCheck,
  ChevronLeft,
  ChevronRight,
  Eye,
  HeartPulse,
  IdCard,
  Moon,
  Phone,
  ShieldCheck,
  Sparkles,
  Stethoscope,
  TriangleAlert,
  UtensilsCrossed,
  Wallet,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { EmptyState } from "@/components/shared/empty-state";
import { ValueRange } from "@/components/shared/value-range";
import { createClient } from "@/lib/supabase/server";
import { getTenantContext, signedMediaUrl } from "@/lib/tenant";
import { ageFromDob, childDisplayName, formatDZD, formatDate, formatPhone, formatTime, telHref } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { AllergySeverity, AttendanceStatus, CheckinMethod, FeePeriod } from "@/lib/types";
import {
  algiersMonth,
  classLabel,
  getMyChildren,
  getMyGuardianBadge,
  monthRange,
  toCheckinDialogChildren,
  type PortalChildRow,
} from "@/components/modules/portal/data";
import {
  attendanceStatusClasses,
  MOOD_EMOJI,
  parseMeals,
  parseNap,
  severityClasses,
} from "@/components/modules/portal/portal-types";
import {
  parseHealthList,
  type PortalAllergy,
  type PortalHealthRecord,
} from "@/components/modules/portal/health-edit-shared";
import { CheckinDialog } from "@/components/modules/portal/checkin-dialog";
import { ChildPhoto } from "@/components/modules/portal/child-photo";
import { HealthEditAllergies } from "@/components/modules/portal/health-edit-allergies";
import { HealthEditRecord } from "@/components/modules/portal/health-edit-record";
import { RequestActivityButton } from "@/components/modules/portal/request-activity-button";
import { CancelActivityRequestButton } from "@/components/modules/portal/cancel-activity-request-button";
import {
  PickupDialog,
  type PortalPickup,
} from "@/components/modules/portal/pickup-dialog";
import { PickupDeleteButton } from "@/components/modules/portal/pickup-delete-button";
import {
  ConsentMatrix,
  type PortalConsent,
} from "@/components/modules/portal/consent-matrix";
import { CONSENT_TYPES } from "@/components/modules/children/types";
import { algiersToday, monthLabel } from "@/components/modules/billing/dates";
import { getDuesByChild } from "@/components/modules/portal/dues";

const TABS = ["journal", "attendance", "health", "activities", "permissions"] as const;
type TabKey = (typeof TABS)[number];

const ATTENDANCE_SUMMARY = ["present", "absent", "late", "sick"] as const;
const DAY_KEYS = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];
const FEE_PERIODS: FeePeriod[] = ["once", "monthly", "quarterly", "yearly", "per_session"];
const SEVERITIES: AllergySeverity[] = ["mild", "moderate", "severe"];

/** Tone of the four attendance counters at the top of the attendance tab. */
const SUMMARY_TONE: Record<(typeof ATTENDANCE_SUMMARY)[number], string> = {
  present: "text-success",
  absent: "text-destructive",
  late: "text-warning",
  sick: "text-destructive",
};

// ---------------------------------------------------------------- row shapes

type JournalRow = {
  id: string;
  date: string;
  mood: string | null;
  meals: unknown;
  nap: unknown;
  activities_text: string | null;
  notes: string | null;
};

/** Name columns of kg_guardians, embedded twice on each attendance row. */
type GuardianRef = {
  first_name: string;
  last_name: string;
  first_name_ar: string | null;
  last_name_ar: string | null;
};

type AttendanceRow = {
  id: string;
  date: string;
  status: AttendanceStatus;
  check_in_at: string | null;
  check_out_at: string | null;
  check_in_method: CheckinMethod | null;
  check_out_method: CheckinMethod | null;
  /** auth.users id of the STAFF MEMBER who operated the device — not the adult. */
  checked_in_by: string | null;
  checked_out_by: string | null;
  checked_in_guardian_id: string | null;
  checked_out_guardian_id: string | null;
  picked_up_by: string | null;
};

/**
 * What we may honestly tell a family about one crossing of the door.
 *
 * A child's own tag identifies the CHILD, not the adult carrying it, so
 * `adult` is only reached when the record actually names one — a resolved
 * guardian (PIN or guardian tag), or the free-text name staff typed at
 * pick-up. `staff` says nothing more than who operated the device, and no
 * attribution at all leaves the row showing just the time.
 */
type Attribution = { kind: "adult" | "staff"; name: string };

type HealthRow = {
  medical_conditions: unknown;
  medications: unknown;
  vaccinations: unknown;
  dietary_restrictions: string | null;
  special_needs: string | null;
  doctor_name: string | null;
  doctor_phone: string | null;
  emergency_notes: string | null;
};

type ActivityRow = {
  id: string;
  name: string;
  name_ar: string | null;
  description: string | null;
  fee_amount: number;
  fee_period: FeePeriod;
  schedule: unknown;
};

type EnrollmentRow = {
  id: string;
  status: string;
  kg_activities: ActivityRow | null;
};

/** `consent_type` is free text in the database — narrowed before it is rendered. */
type ConsentRow = {
  consent_type: string;
  granted: boolean | null;
  decided_at: string | null;
};

// ------------------------------------------------------------------- helpers

/** Nap values may be "13:00" or an ISO timestamp — render both sensibly. */
function napLabel(value: string | null, locale: string): string | null {
  if (!value) return null;
  if (/^\d{1,2}:\d{2}/.test(value)) return value.slice(0, 5);
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? value : formatTime(d, locale);
}

function parseSchedule(v: unknown): { day: string; time: string }[] {
  if (!Array.isArray(v)) return [];
  const out: { day: string; time: string }[] = [];
  for (const entry of v) {
    if (!entry || typeof entry !== "object") continue;
    const rec = entry as Record<string, unknown>;
    const day = typeof rec.day === "string" ? rec.day : "";
    const time = typeof rec.time === "string" ? rec.time : "";
    if (day || time) out.push({ day, time });
  }
  return out;
}

function activityName(activity: ActivityRow, locale: string): string {
  return locale === "ar" && activity.name_ar ? activity.name_ar : activity.name;
}

/** Worst severity across the child's allergies, for the header badge. */
function worstSeverity(rows: PortalAllergy[]): AllergySeverity {
  return rows.reduce<AllergySeverity>(
    (worst, a) => (SEVERITIES.indexOf(a.severity) > SEVERITIES.indexOf(worst) ? a.severity : worst),
    "mild"
  );
}

/** Small tinted square that fronts a journal line or a section title. */
function IconTile({ tone, children }: { tone: "primary" | "gold" | "danger"; children: React.ReactNode }) {
  return (
    <span
      aria-hidden
      className={cn(
        "flex size-9 shrink-0 items-center justify-center rounded-xl [&>svg]:size-4",
        tone === "primary" && "bg-primary/10 text-primary",
        tone === "gold" && "bg-gold text-gold-foreground",
        tone === "danger" && "bg-destructive/10 text-destructive"
      )}
    >
      {children}
    </span>
  );
}

// ---------------------------------------------------------------------- page

export default async function PortalChildDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ tab?: string }>;
}) {
  const [{ id }, sp] = await Promise.all([params, searchParams]);
  const ctx = await getTenantContext();
  const t = await getTranslations("portal");
  const locale = await getLocale();
  const supabase = await createClient();

  const tab: TabKey = (TABS as readonly string[]).includes(sp.tab ?? "")
    ? (sp.tab as TabKey)
    : "journal";

  // getMyChildren enforces the guardian link on top of kg_is_parent_of RLS.
  const children = await getMyChildren(supabase, ctx);
  const child: PortalChildRow | undefined = children.find((c) => c.id === id);

  const BackIcon = locale === "ar" ? ChevronRight : ChevronLeft;

  if (!child) {
    return (
      <div className="grid gap-4">
        <EmptyState
          icon={<Baby />}
          title={t("child.notFound")}
          description={t("child.notFoundDescription")}
          action={
            <Button asChild variant="outline">
              <Link href="/portal/children">
                <BackIcon data-icon="inline-start" />
                {t("child.back")}
              </Link>
            </Button>
          }
        />
      </div>
    );
  }

  const { start: monthStart, end: monthEnd } = monthRange(algiersMonth());

  // Allergies always load: the header carries the safety badge on every tab.
  // So does the door badge, which is per guardian and therefore fetched once
  // here — the header raises it for this child without another query.
  const [photoUrls, badge, { data: allergyRows }] = await Promise.all([
    // Every sibling's face, not only this child's: the corner badge opens on
    // the whole family, and a tab without a photo is one a parent has to read
    // instead of recognise. These are storage signatures over children this
    // page already fetched, issued in parallel — no extra database round trip.
    Promise.all(children.map((c) => signedMediaUrl(c.photo_path))),
    getMyGuardianBadge(supabase, ctx, locale),
    supabase
      .from("kg_child_allergies")
      .select("id, allergen, severity, reaction, action_plan")
      .eq("child_id", child.id)
      .eq("tenant_id", ctx.tenant.id)
      .order("created_at"),
  ]);
  const allergies = (allergyRows ?? []) as PortalAllergy[];

  const photoUrl = photoUrls[children.findIndex((c) => c.id === child.id)] ?? null;
  // Today's attendance is not loaded on this page (the attendance tab fetches a
  // whole month, and only when it is open), so the tabs carry faces and names
  // without a status line rather than paying for a query the badge does not
  // need.
  const checkinChildren = toCheckinDialogChildren(
    children,
    locale,
    new Map(children.map((c, i) => [c.id, photoUrls[i]]))
  );

  const [
    journalRes,
    attendanceRes,
    healthRes,
    enrollmentsRes,
    activitiesRes,
    pickupsRes,
    consentsRes,
  ] = await Promise.all([
    tab === "journal"
      ? supabase
          .from("kg_daily_reports")
          .select("id, date, mood, meals, nap, activities_text, notes")
          .eq("child_id", child.id)
          .eq("tenant_id", ctx.tenant.id)
          .eq("published", true)
          .order("date", { ascending: false })
          .limit(30)
      : Promise.resolve({ data: [] }),
    tab === "attendance"
      ? supabase
          .from("kg_attendance")
          // Guardian names are NOT embedded from kg_guardians: policy g_sel
          // exposes only the reader's own row, so a co-parent's drop-off came
          // back null. They are resolved below from kg_guardian_directory, an
          // identity-only view that deliberately carries no credentials.
          // kg_profiles likewise cannot be embedded: checked_in_by/out_by
          // reference auth.users, and no FK ties kg_attendance to kg_profiles.
          .select(
            "id, date, status, check_in_at, check_out_at, check_in_method, check_out_method, " +
              "checked_in_by, checked_out_by, picked_up_by, " +
              "checked_in_guardian_id, checked_out_guardian_id"
          )
          .eq("child_id", child.id)
          .eq("tenant_id", ctx.tenant.id)
          .gte("date", monthStart)
          .lt("date", monthEnd)
          .order("date", { ascending: false })
      : Promise.resolve({ data: [] }),
    tab === "health"
      ? supabase
          .from("kg_child_health")
          .select(
            "medical_conditions, medications, vaccinations, dietary_restrictions, special_needs, doctor_name, doctor_phone, emergency_notes"
          )
          .eq("child_id", child.id)
          .maybeSingle()
      : Promise.resolve({ data: null }),
    tab === "activities"
      ? supabase
          .from("kg_activity_enrollments")
          .select(
            "id, status, kg_activities(id, name, name_ar, description, fee_amount, fee_period, schedule)"
          )
          .eq("child_id", child.id)
          .eq("tenant_id", ctx.tenant.id)
      : Promise.resolve({ data: [] }),
    tab === "activities"
      ? supabase
          .from("kg_activities")
          .select("id, name, name_ar, description, fee_amount, fee_period, schedule")
          .eq("tenant_id", ctx.tenant.id)
          .eq("active", true)
          .order("name")
      : Promise.resolve({ data: [] }),
    tab === "permissions"
      ? supabase
          .from("kg_authorized_pickups")
          .select("id, name, relationship, phone, national_id")
          .eq("child_id", child.id)
          .eq("tenant_id", ctx.tenant.id)
          .order("created_at")
      : Promise.resolve({ data: [] }),
    tab === "permissions"
      ? supabase
          .from("kg_consents")
          .select("consent_type, granted, decided_at")
          .eq("child_id", child.id)
          .eq("tenant_id", ctx.tenant.id)
      : Promise.resolve({ data: [] }),
  ]);

  const name = childDisplayName(child, locale);
  const cls = classLabel(child, locale);

  // Same helper the children list and the home screen use, so one child cannot
  // read as settled on one screen and owing on another.
  const dues = await getDuesByChild(supabase, ctx.tenant.id, [child.id], algiersToday());
  const due = dues.get(child.id) ?? null;
  const dueWhat = !due
    ? null
    : due.hasRegistration
      ? t("children.due.admission")
      : due.months.length > 0
        ? monthLabel(due.months[0].slice(0, 7), locale)
        : null;

  const journal = (journalRes.data ?? []) as JournalRow[];

  const attendance = (attendanceRes.data ?? []) as unknown as AttendanceRow[];
  const attendanceCounts = attendance.reduce<Record<string, number>>((acc, a) => {
    acc[a.status] = (acc[a.status] ?? 0) + 1;
    return acc;
  }, {});

  // Staff names for the "recorded by" fallback. No FK joins kg_attendance to
  // kg_profiles, so they are resolved in one follow-up query and mapped in JS.
  // Empty on every other tab, so this costs nothing there.
  const staffIds = [
    ...new Set(
      attendance
        .flatMap((a) => [a.checked_in_by, a.checked_out_by])
        .filter((v): v is string => Boolean(v))
    ),
  ];
  const staffNames = new Map<string, string>();
  if (staffIds.length > 0) {
    const { data: staffRows } = await supabase
      .from("kg_profiles")
      .select("id, full_name")
      .in("id", staffIds);
    for (const p of (staffRows ?? []) as { id: string; full_name: string | null }[]) {
      const full = p.full_name?.trim();
      if (full) staffNames.set(p.id, full);
    }
  }

  // Co-guardians come from the identity-only view (migration 0022): a family
  // may read the other adults attached to its own child, and that view carries
  // no pin_code/tag_code, so nobody's door credentials travel with the name.
  const guardianIds = [
    ...new Set(
      attendance
        .flatMap((a) => [a.checked_in_guardian_id, a.checked_out_guardian_id])
        .filter((v): v is string => Boolean(v))
    ),
  ];
  const guardianRefs = new Map<string, GuardianRef>();
  if (guardianIds.length > 0) {
    const { data: guardianRows } = await supabase
      .from("kg_guardian_directory")
      .select("id, first_name, last_name, first_name_ar, last_name_ar")
      .in("id", guardianIds);
    for (const g of (guardianRows ?? []) as (GuardianRef & { id: string })[]) {
      guardianRefs.set(g.id, g);
    }
  }

  /**
   * The honesty ladder, in order of what the record actually knows:
   *   1. a resolved guardian  → we can name the adult;
   *   2. the free text staff typed at pick-up (check-out only);
   *   3. the staff member who operated the device — never presented as the
   *      adult who took the child;
   *   4. nothing — the row keeps only its time.
   * `picked_up_by` is auto-filled from the guardian's name by kg_checkin_by_tag,
   * so step 2 also covers a guardian whose row RLS keeps from this parent.
   */
  const attributionFor = (
    guardian: GuardianRef | null,
    typedName: string | null,
    staffId: string | null
  ): Attribution | null => {
    if (guardian) return { kind: "adult", name: childDisplayName(guardian, locale) };
    const typed = typedName?.trim();
    if (typed) return { kind: "adult", name: typed };
    const staff = staffId ? staffNames.get(staffId) : undefined;
    return staff ? { kind: "staff", name: staff } : null;
  };

  /** One muted line under an attendance row: who, plus how it was recorded. */
  const attendanceLine = (
    attribution: Attribution | null,
    method: CheckinMethod | null,
    direction: "in" | "out"
  ) => (
    <p className="flex flex-wrap items-center gap-x-1.5 gap-y-1">
      {attribution && (
        <span className="min-w-0">
          {attribution.kind === "adult"
            ? t(
                direction === "in"
                  ? "child.attendance.droppedOffBy"
                  : "child.attendance.collectedBy",
                { name: attribution.name }
              )
            : t(
                direction === "in"
                  ? "child.attendance.recordedInBy"
                  : "child.attendance.recordedOutBy",
                { name: attribution.name }
              )}
        </span>
      )}
      {method && (
        <span className="rounded-md bg-muted px-1.5 py-0.5 text-[11px] font-medium text-muted-foreground">
          {t(`child.attendance.methods.${method}`)}
        </span>
      )}
    </p>
  );

  const healthRow = (healthRes.data ?? null) as HealthRow | null;
  // The jsonb list columns are parsed here so the client editor receives plain
  // serializable lines (see health-edit-shared: object entries keep their JSON).
  const healthRecord: PortalHealthRecord | null = healthRow
    ? {
        medicalConditions: parseHealthList(healthRow.medical_conditions),
        medications: parseHealthList(healthRow.medications),
        vaccinations: parseHealthList(healthRow.vaccinations),
        dietaryRestrictions: healthRow.dietary_restrictions,
        specialNeeds: healthRow.special_needs,
        doctorName: healthRow.doctor_name,
        doctorPhone: healthRow.doctor_phone,
        emergencyNotes: healthRow.emergency_notes,
      }
    : null;

  const enrollments = ((enrollmentsRes.data ?? []) as unknown as EnrollmentRow[]).filter(
    (e) => e.kg_activities
  );
  const currentEnrollments = enrollments.filter(
    (e) => e.status === "active" || e.status === "requested"
  );
  const enrolledActivityIds = new Set(enrollments.map((e) => e.kg_activities!.id));
  const availableActivities = ((activitiesRes.data ?? []) as ActivityRow[]).filter(
    (a) => !enrolledActivityIds.has(a.id)
  );

  const pickups = (pickupsRes.data ?? []) as PortalPickup[];
  // Only the consent types this app actually asks about reach the matrix; a
  // legacy row left by an earlier vocabulary is ignored rather than rendered
  // with a missing label.
  const consents = ((consentsRes.data ?? []) as ConsentRow[]).filter(
    (c): c is PortalConsent => (CONSENT_TYPES as readonly string[]).includes(c.consent_type)
  );

  function feeLabel(activity: ActivityRow): string {
    const amount = Number(activity.fee_amount);
    if (!amount) return t("child.activities.free");
    const period = FEE_PERIODS.includes(activity.fee_period)
      ? t(`child.activities.periods.${activity.fee_period}`)
      : "";
    return period ? `${formatDZD(amount, locale)} · ${period}` : formatDZD(amount, locale);
  }

  function scheduleLabel(activity: ActivityRow): string | null {
    const slots = parseSchedule(activity.schedule);
    if (slots.length === 0) return null;
    return slots
      .map((s) => {
        const day = DAY_KEYS.includes(s.day) ? t(`child.activities.days.${s.day}`) : s.day;
        return [day, s.time].filter(Boolean).join(" ");
      })
      .join(" · ");
  }

  return (
    <div className="grid gap-4">
      {/* ===== Header ===== */}
      <div>
        <Button asChild variant="ghost" size="sm" className="-ms-2 mb-2 text-muted-foreground">
          <Link href="/portal/children">
            <BackIcon data-icon="inline-start" />
            {t("child.back")}
          </Link>
        </Button>
        <Card className="relative bg-gradient-to-br from-gold-muted/70 via-card to-card shadow-sm ring-gold/25">
          {/* Corner opposite the face — inline-end, so it is top-left in Arabic
              and top-right in fr/en without a physical-direction utility. The
              row below reserves `pe-12` for it so a long Arabic name or the
              allergy badge wraps rather than sliding underneath at 375px. */}
          <CheckinDialog
            badge={badge}
            child={checkinChildren.find((c) => c.id === child.id)}
            trigger="corner"
            className="absolute top-2 end-2 z-10"
          />
          <CardContent className="flex items-center gap-3.5 pe-12">
            {/* Tapping the face opens the camera: this photo is what staff
                hold up against the child at the door, so the family keeps it
                current rather than waiting on the office. */}
            <ChildPhoto
              tenantId={ctx.tenant.id}
              childId={child.id}
              name={name}
              firstName={child.first_name}
              lastName={child.last_name}
              photoPath={child.photo_path}
              photoUrl={photoUrl}
            />
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-lg font-bold tracking-tight">{name}</span>
                {allergies.length > 0 && (
                  <Badge className={severityClasses(worstSeverity(allergies))}>
                    <TriangleAlert data-icon="inline-start" className="size-3" />
                    {t("child.health.allergiesTitle")}
                  </Badge>
                )}
              </div>
              <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs text-muted-foreground">
                <span>{ageFromDob(child.dob, locale)}</span>
                {cls && (
                  <span className="inline-flex items-center gap-1.5">
                    <span
                      className="size-2 rounded-full"
                      style={{ backgroundColor: child.kg_classes?.color ?? "var(--gold)" }}
                      aria-hidden
                    />
                    {cls}
                  </span>
                )}
              </div>

              {/* What is outstanding for THIS child, on every tab of their
                  file — the same figure the children list and the home screen
                  show, from the same helper. */}
              {due && (
                <div className="mt-1.5">
                  <span
                    className={cn(
                      "inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[0.6875rem] font-medium",
                      due.overdue
                        ? "bg-destructive/10 text-destructive"
                        : "bg-card text-gold-ink ring-1 ring-gold/30"
                    )}
                  >
                    <Wallet className="size-3" aria-hidden />
                    {dueWhat
                      ? t("children.due.forWhat", {
                          amount: formatDZD(due.balance, locale),
                          what: dueWhat,
                        })
                      : t("children.due.amount", { amount: formatDZD(due.balance, locale) })}
                  </span>
                </div>
              )}

              {/* Said once, only while it is still missing: a face on file is
                  what makes the door check more than a scanned QR code. */}
              {!child.photo_path && (
                <p className="mt-1.5 text-xs leading-relaxed text-muted-foreground">
                  {t("child.photo.hint")}
                </p>
              )}
            </div>
          </CardContent>
        </Card>
      </div>

      {/* ===== Tabs (URL-driven so each tab loads only its own data) ===== */}
      <nav
        aria-label={t("child.tabsLabel")}
        className="flex gap-1 overflow-x-auto rounded-xl bg-muted p-1"
      >
        {TABS.map((key) => {
          const active = key === tab;
          return (
            <Link
              key={key}
              href={`/portal/children/${child.id}?tab=${key}`}
              // Without this the tab strip jumps to the top of the document on
              // every tap, which on a phone reads as a page reload.
              scroll={false}
              aria-current={active ? "page" : undefined}
              className={cn(
                "flex-1 whitespace-nowrap rounded-lg px-3 py-2 text-center text-sm font-medium transition-colors",
                active
                  ? "bg-card text-primary shadow-sm"
                  : "text-muted-foreground hover:text-foreground"
              )}
            >
              {t(`child.tabs.${key}`)}
            </Link>
          );
        })}
      </nav>

      {/* ===== Journal — the keepsake surface, so every card is gold-tinted ===== */}
      {tab === "journal" &&
        (journal.length === 0 ? (
          <EmptyState
            icon={<BookOpen />}
            title={t("child.journal.empty")}
            description={t("child.journal.emptyDescription")}
          />
        ) : (
          <div className="grid gap-3">
            {journal.map((report) => {
              const meals = parseMeals(report.meals);
              const nap = parseNap(report.nap);
              const napStart = napLabel(nap?.start ?? null, locale);
              const napEnd = napLabel(nap?.end ?? null, locale);
              const napText =
                napStart && napEnd
                  ? t("child.journal.napRange", { start: napStart, end: napEnd })
                  : napStart
                    ? t("child.journal.napFrom", { time: napStart })
                    : napEnd
                      ? t("child.journal.napUntil", { time: napEnd })
                      : null;
              return (
                <Card key={report.id} className="bg-gold-muted/40 shadow-sm ring-gold/25">
                  <CardHeader className="flex flex-row items-center gap-3">
                    <span
                      className="flex size-11 shrink-0 items-center justify-center rounded-full bg-card text-2xl ring-1 ring-gold/25"
                      aria-hidden
                    >
                      {MOOD_EMOJI[report.mood ?? ""] ?? "🙂"}
                    </span>
                    <CardTitle className="text-base font-semibold">
                      {formatDate(report.date, locale, { weekday: "long" })}
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="grid gap-3 text-sm">
                    {meals.length > 0 && (
                      <div className="flex gap-3 rounded-xl bg-card p-3">
                        <IconTile tone="gold">
                          <UtensilsCrossed />
                        </IconTile>
                        <div className="min-w-0">
                          <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                            {t("child.journal.meals")}
                          </div>
                          <ul className="mt-1 grid gap-0.5">
                            {meals.map((m, i) => (
                              <li key={i}>
                                {m.meal}
                                {m.eaten && (
                                  <span className="text-muted-foreground"> — {m.eaten}</span>
                                )}
                              </li>
                            ))}
                          </ul>
                        </div>
                      </div>
                    )}

                    {napText && (
                      <div className="flex gap-3 rounded-xl bg-card p-3">
                        <IconTile tone="primary">
                          <Moon />
                        </IconTile>
                        <div className="min-w-0">
                          <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                            {t("child.journal.nap")}
                          </div>
                          <div className="mt-1 tabular-nums">{napText}</div>
                        </div>
                      </div>
                    )}

                    {report.activities_text && (
                      <div className="flex gap-3 rounded-xl bg-card p-3">
                        <IconTile tone="gold">
                          <Sparkles />
                        </IconTile>
                        <div className="min-w-0">
                          <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                            {t("child.journal.activities")}
                          </div>
                          <p className="mt-1 whitespace-pre-wrap leading-relaxed text-start" dir="auto">
                            {report.activities_text}
                          </p>
                        </div>
                      </div>
                    )}

                    {report.notes && (
                      <div className="rounded-xl bg-card p-3">
                        <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                          {t("child.journal.notes")}
                        </div>
                        <p className="mt-1 whitespace-pre-wrap leading-relaxed text-start" dir="auto">{report.notes}</p>
                      </div>
                    )}
                  </CardContent>
                </Card>
              );
            })}
          </div>
        ))}

      {/* ===== Présences (this month) ===== */}
      {tab === "attendance" && (
        <Card className="shadow-sm">
          <CardHeader className="flex flex-row items-center gap-3">
            <IconTile tone="primary">
              <CalendarCheck />
            </IconTile>
            <CardTitle className="text-base font-semibold">{t("child.attendance.title")}</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-4 p-0">
            <div className="grid grid-cols-4 gap-2 px-4">
              {ATTENDANCE_SUMMARY.map((k) => (
                <div key={k} className="rounded-xl bg-muted/60 px-2 py-2.5 text-center">
                  <div className={cn("text-xl font-bold tabular-nums", SUMMARY_TONE[k])}>
                    {attendanceCounts[k] ?? 0}
                  </div>
                  <div className="mt-0.5 truncate text-[11px] font-medium text-muted-foreground">
                    {t(`child.attendance.statuses.${k}`)}
                  </div>
                </div>
              ))}
            </div>
            {attendance.length === 0 ? (
              <p className="px-4 pb-4 text-center text-sm text-muted-foreground">
                {t("child.attendance.empty")}
              </p>
            ) : (
              <ul className="divide-y border-t">
                {attendance.map((a) => {
                  // Only a real crossing of the door gets an attribution line —
                  // absent / sick / excused rows keep their badge and nothing more.
                  const inAttribution = a.check_in_at
                    ? attributionFor(guardianRefs.get(a.checked_in_guardian_id ?? "") ?? null, null, a.checked_in_by)
                    : null;
                  const outAttribution = a.check_out_at
                    ? attributionFor(guardianRefs.get(a.checked_out_guardian_id ?? "") ?? null, a.picked_up_by, a.checked_out_by)
                    : null;
                  const inMethod = a.check_in_at ? a.check_in_method : null;
                  const outMethod = a.check_out_at ? a.check_out_method : null;
                  const showIn = Boolean(inAttribution || inMethod);
                  const showOut = Boolean(outAttribution || outMethod);
                  return (
                    <li key={a.id} className="px-4 py-3 text-sm">
                      <div className="flex items-center gap-3">
                        <span className="min-w-0 flex-1 font-medium">
                          {formatDate(a.date, locale, { weekday: "short" })}
                        </span>
                        {/* In → out, never out → in: both clock values are
                            neutral runs, so an Arabic paragraph would flip the
                            pair and tell a parent their child left before they
                            arrived. ValueRange isolates it. */}
                        <ValueRange
                          from={a.check_in_at ? formatTime(a.check_in_at, locale) : null}
                          to={a.check_out_at ? formatTime(a.check_out_at, locale) : null}
                          className="shrink-0 text-xs text-muted-foreground tabular-nums"
                        />
                        <Badge className={attendanceStatusClasses(a.status)}>
                          {t(`child.attendance.statuses.${a.status}`)}
                        </Badge>
                      </div>
                      {(showIn || showOut) && (
                        <div className="mt-1.5 grid gap-1 text-xs text-muted-foreground">
                          {showIn && attendanceLine(inAttribution, inMethod, "in")}
                          {showOut && attendanceLine(outAttribution, outMethod, "out")}
                        </div>
                      )}
                    </li>
                  );
                })}
              </ul>
            )}
          </CardContent>
        </Card>
      )}

      {/* ===== Santé — the family maintains it; every edit reaches staff at once ===== */}
      {tab === "health" && (
        <div className="grid gap-3">
          {/* Owner decision (2026-08-27): parent edits apply immediately. The DB
              triggers from migration 0016 notify staff and write the audit row,
              so this promise is literally true. */}
          <div className="flex items-start gap-2.5 rounded-xl border border-primary/20 bg-primary/10 p-3 text-sm text-primary">
            <ShieldCheck className="mt-0.5 size-4 shrink-0" aria-hidden />
            <p className="leading-relaxed">{t("child.health.parentEditNotice")}</p>
          </div>

          <Card className="shadow-sm ring-destructive/20">
            <CardHeader className="flex flex-row items-center gap-3">
              <IconTile tone="danger">
                <HeartPulse />
              </IconTile>
              <CardTitle className="text-base font-semibold">
                {t("child.health.allergiesTitle")}
              </CardTitle>
            </CardHeader>
            <CardContent>
              <HealthEditAllergies childId={child.id} allergies={allergies} />
            </CardContent>
          </Card>

          <Card className="shadow-sm">
            <CardHeader className="flex flex-row items-center gap-3">
              <IconTile tone="primary">
                <Stethoscope />
              </IconTile>
              <CardTitle className="text-base font-semibold">
                {t("child.health.summaryTitle")}
              </CardTitle>
            </CardHeader>
            <CardContent>
              <HealthEditRecord childId={child.id} health={healthRecord} />
            </CardContent>
          </Card>
        </div>
      )}

      {/* ===== Activités ===== */}
      {tab === "activities" && (
        <div className="grid gap-3">
          <Card className="shadow-sm">
            <CardHeader className="flex flex-row items-center gap-3">
              <IconTile tone="gold">
                <Sparkles />
              </IconTile>
              <CardTitle className="text-base font-semibold">
                {t("child.activities.enrolledTitle")}
              </CardTitle>
            </CardHeader>
            <CardContent className="grid gap-3">
              {currentEnrollments.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  {t("child.activities.enrolledEmpty")}
                </p>
              ) : (
                currentEnrollments.map((enrollment) => {
                  const activity = enrollment.kg_activities!;
                  const schedule = scheduleLabel(activity);
                  const pending = enrollment.status === "requested";
                  return (
                    <div key={enrollment.id} className="grid gap-1.5 rounded-xl bg-muted/50 p-3.5">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-semibold">{activityName(activity, locale)}</span>
                        <Badge
                          className={
                            pending
                              ? "border border-warning/40 bg-warning/15 font-semibold text-foreground"
                              : "border border-success/25 bg-success/10 font-semibold text-success"
                          }
                        >
                          {pending ? t("child.activities.pending") : t("child.activities.active")}
                        </Badge>
                      </div>
                      <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs text-muted-foreground">
                        <span className="tabular-nums">
                          {t("child.activities.fee")} : {feeLabel(activity)}
                        </span>
                        {schedule && <span>{schedule}</span>}
                      </div>
                      {/* A request is the family's until the kindergarten approves it. */}
                      {pending && (
                        <div className="flex justify-end">
                          <CancelActivityRequestButton
                            childId={child.id}
                            activityId={activity.id}
                          />
                        </div>
                      )}
                    </div>
                  );
                })
              )}
            </CardContent>
          </Card>

          <Card className="shadow-sm">
            <CardHeader>
              <CardTitle className="text-base font-semibold">
                {t("child.activities.availableTitle")}
              </CardTitle>
            </CardHeader>
            <CardContent className="grid gap-3">
              {availableActivities.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  {t("child.activities.availableEmpty")}
                </p>
              ) : (
                availableActivities.map((activity) => {
                  const schedule = scheduleLabel(activity);
                  return (
                    <div
                      key={activity.id}
                      className="grid gap-2 rounded-xl border border-border p-3.5"
                    >
                      <div className="font-semibold">{activityName(activity, locale)}</div>
                      {activity.description && (
                        <p className="text-sm leading-relaxed text-muted-foreground text-start" dir="auto">
                          {activity.description}
                        </p>
                      )}
                      <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs text-muted-foreground">
                        <span className="font-semibold text-gold tabular-nums">
                          {t("child.activities.fee")} : {feeLabel(activity)}
                        </span>
                        {schedule && <span>{schedule}</span>}
                      </div>
                      <div className="pt-0.5">
                        <RequestActivityButton childId={child.id} activityId={activity.id} />
                      </div>
                    </div>
                  );
                })
              )}
            </CardContent>
          </Card>
        </div>
      )}

      {/* ===== Autorisations — the two registers the family owns ===== */}
      {tab === "permissions" && (
        <div className="grid gap-3">
          {/* --- Who may collect the child: the décret 19-253 register --- */}
          <Card className="shadow-sm ring-gold/25">
            <CardHeader className="flex flex-row items-center gap-3">
              <IconTile tone="gold">
                <IdCard />
              </IconTile>
              <CardTitle className="text-base font-semibold">
                {t("child.pickups.title")}
              </CardTitle>
            </CardHeader>
            <CardContent className="grid gap-3">
              <p className="text-sm leading-relaxed text-muted-foreground">
                {t("child.pickups.description", { name })}
              </p>

              {/* This list decides who walks out with the child, so the parent
                  is told plainly that it is a legal register and that the
                  office sees every change the moment it is made. */}
              <div className="flex gap-2.5 rounded-xl bg-gold-muted/60 p-3">
                <Eye className="mt-0.5 size-4 shrink-0 text-gold" aria-hidden />
                <div className="min-w-0 text-xs leading-relaxed">
                  <p>{t("child.pickups.legalNote")}</p>
                  <p className="mt-1 font-semibold">{t("child.pickups.officeNote")}</p>
                  <Link
                    href="/portal/messages"
                    className="mt-1.5 inline-flex font-semibold text-primary underline-offset-4 hover:underline"
                  >
                    {t("child.pickups.askOffice")}
                  </Link>
                </div>
              </div>

              {pickups.length === 0 ? (
                <div className="rounded-xl border border-dashed border-border bg-muted/40 px-4 py-8 text-center">
                  <span
                    className="mx-auto mb-3 flex size-12 items-center justify-center rounded-2xl bg-gold text-gold-foreground"
                    aria-hidden
                  >
                    <IdCard className="size-6" />
                  </span>
                  <p className="text-sm font-semibold">{t("child.pickups.empty")}</p>
                  <p className="mx-auto mt-1 max-w-sm text-sm leading-relaxed text-muted-foreground">
                    {t("child.pickups.emptyDescription")}
                  </p>
                </div>
              ) : (
                <ul className="grid gap-2">
                  {pickups.map((p) => (
                    <li
                      key={p.id}
                      className="flex items-start gap-2 rounded-xl border border-border p-3"
                    >
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="font-semibold">{p.name}</span>
                          {p.relationship && (
                            <span className="rounded-full bg-muted px-2 py-0.5 text-[11px] font-medium text-muted-foreground">
                              {p.relationship}
                            </span>
                          )}
                        </div>
                        <div className="mt-1 grid gap-1">
                          {p.phone && (
                            <a
                              href={telHref(p.phone)}
                              dir="ltr"
                              aria-label={t("child.pickups.callAria", { name: p.name })}
                              className="inline-flex w-fit items-center gap-1.5 text-sm font-medium text-primary tabular-nums hover:underline"
                            >
                              <Phone className="size-3.5" aria-hidden />
                              {formatPhone(p.phone)}
                            </a>
                          )}
                          {p.national_id && (
                            <span className="text-xs text-muted-foreground">
                              {t("child.pickups.nationalId")} :{" "}
                              <span dir="ltr" className="tabular-nums">
                                {p.national_id}
                              </span>
                            </span>
                          )}
                        </div>
                      </div>
                      <div className="flex shrink-0 items-center">
                        <PickupDialog childId={child.id} pickup={p} />
                        <PickupDeleteButton
                          childId={child.id}
                          pickupId={p.id}
                          name={p.name}
                        />
                      </div>
                    </li>
                  ))}
                </ul>
              )}

              <PickupDialog childId={child.id} />
            </CardContent>
          </Card>

          {/* --- Consents: three answers the office relies on --- */}
          <Card className="shadow-sm">
            <CardHeader className="flex flex-row items-center gap-3">
              <IconTile tone="primary">
                <ShieldCheck />
              </IconTile>
              <CardTitle className="text-base font-semibold">
                {t("child.consents.title")}
              </CardTitle>
            </CardHeader>
            <CardContent className="grid gap-3">
              <p className="text-sm leading-relaxed text-muted-foreground">
                {t("child.consents.description")}
              </p>
              <div className="flex gap-2.5 rounded-xl bg-primary/5 p-3">
                <Eye className="mt-0.5 size-4 shrink-0 text-primary" aria-hidden />
                <p className="min-w-0 text-xs leading-relaxed">
                  {t("child.consents.officeNote")}
                </p>
              </div>
              <ConsentMatrix childId={child.id} consents={consents} />
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  );
}
