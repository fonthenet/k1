import Link from "next/link";
import { Fragment, type ReactNode } from "react";
import { getLocale, getTranslations } from "next-intl/server";
import {
  Baby,
  BookOpen,
  CalendarCheck,
  ChevronLeft,
  ChevronRight,
  Eye,
  FileCheck2,
  FileWarning,
  FolderOpen,
  HeartPulse,
  IdCard,
  Phone,
  Hourglass,
  Route,
  ShieldCheck,
  Sparkles,
  Stethoscope,
  TriangleAlert,
  Wallet,
  type LucideIcon,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { EmptyState } from "@/components/shared/empty-state";
import { ValueRange } from "@/components/shared/value-range";
import { createClient } from "@/lib/supabase/server";
import { getTenantContext, signedMediaUrl } from "@/lib/tenant";
import { loadDossier, signedDossierUrls } from "@/lib/dossier-server";
import type { DossierStatus, SignedUrlMap } from "@/lib/dossier";
import { ageFromDob, childDisplayName, formatDZD, formatDate, formatPhone, formatTime, telHref } from "@/lib/format";
import { cn } from "@/lib/utils";
import { normaliseSchedule } from "@/lib/activity-schedule";
import type { AllergySeverity, AttendanceStatus, CheckinMethod, FeePeriod } from "@/lib/types";
import { roomName } from "@/components/modules/classes/class-types";
import {
  algiersMonth,
  classLabel,
  getChildTransfers,
  getMyChildren,
  getMyGuardianBadge,
  getPendingTransfer,
  getPortalClasses,
  getStructures,
  monthRange,
  shiftMonth,
  toCheckinDialogChildren,
  type PortalChildRow,
} from "@/components/modules/portal/data";
import { StructureMark } from "@/components/shared/structure-mark";
import { FactsLine } from "@/components/modules/portal/facts-line";
import { StatusPill } from "@/components/shared/status-pill";
import { SectionCard } from "@/components/shared/section-card";
import { RequestTransferDialog } from "@/components/modules/portal/request-transfer-dialog";
import { structureName } from "@/components/modules/classes/class-types";
import { attendanceStatusClasses, KNOWN_MOODS, severityClasses } from "@/components/modules/portal/portal-types";
import { getChildDays, shiftDate } from "@/components/modules/portal/day-data";
import { blocksNounKey, toLearningProfile } from "@/lib/child-day";
import { learningProfile } from "@/components/modules/learning/domain";
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
import { FamilyDossierList } from "@/components/modules/portal/family-dossier-list";
import { attachMyChildDocument, type AttachDocumentInput, type AttachResult } from "@/components/modules/portal/actions";

const TABS = ["journal", "attendance", "health", "activities", "permissions"] as const;
type TabKey = (typeof TABS)[number];
const TAB_ICONS: Record<TabKey, LucideIcon> = {
  journal: BookOpen,
  attendance: CalendarCheck,
  health: Stethoscope,
  activities: Sparkles,
  // The tab keeps its key and its URL (notifications and bookmarks point at
  // `?tab=permissions`); its label became "Dossier" with 0164, because the
  // enrolment file now opens it and the two registers sit under the file.
  permissions: FolderOpen,
};

// Every status the register can hold. "excused" was left out of the counters,
// so an absence the office had filed as authorised counted nowhere and the
// four boxes summed to fewer days than the list beneath them.
const ATTENDANCE_SUMMARY = ["present", "absent", "late", "excused", "sick"] as const;
const FEE_PERIODS: FeePeriod[] = ["once", "monthly", "quarterly", "yearly", "per_session"];
const SEVERITIES: AllergySeverity[] = ["mild", "moderate", "severe"];
const MONTH_RE = /^\d{4}-\d{2}$/;

/**
 * Tone of the attendance counters at the top of the attendance tab. Only a
 * count that means trouble is coloured, and only when it is not zero: a red
 * "0 absent" spends the screen's one red on good news, and a green "present"
 * says what the absence of colour already says.
 */
const SUMMARY_TONE: Partial<Record<(typeof ATTENDANCE_SUMMARY)[number], string>> = {
  absent: "text-destructive",
  late: "text-gold-ink",
  sick: "text-destructive",
};

// ---------------------------------------------------------------- row shapes

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
  updated_at: string | null;
};

type ActivityRow = {
  id: string;
  name: string;
  name_ar: string | null;
  description: string | null;
  fee_amount: number;
  fee_period: FeePeriod;
  schedule: unknown;
  /** The room the activity meets in (0155) — a family walks the child there. */
  kg_rooms: { name: string; name_ar: string | null } | null;
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

/** Small tinted square that fronts a section heading. */
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
  searchParams: Promise<{ tab?: string; month?: string }>;
}) {
  const [{ id }, sp] = await Promise.all([params, searchParams]);
  const ctx = await getTenantContext();
  const t = await getTranslations("portal");
  const tCommon = await getTranslations("common");
  const locale = await getLocale();
  const supabase = await createClient();

  const tab: TabKey = (TABS as readonly string[]).includes(sp.tab ?? "")
    ? (sp.tab as TabKey)
    : "journal";

  // Which month the attendance tab shows. It was pinned to the current
  // calendar month with no way back, so on the 1st every parent opened four
  // zero counters, and August — the month on the invoice they were disputing
  // — was unreachable. Clamped to the present: a future month has no rows and
  // a link to one is a link to an empty page.
  const currentMonth = algiersMonth();
  const month =
    sp.month && MONTH_RE.test(sp.month) && sp.month <= currentMonth ? sp.month : currentMonth;

  // getMyChildren enforces the guardian link on top of kg_is_parent_of RLS.
  const children = await getMyChildren(supabase, ctx);
  const child: PortalChildRow | undefined = children.find((c) => c.id === id);

  const BackIcon = locale === "ar" ? ChevronRight : ChevronLeft;
  const ForwardIcon = locale === "ar" ? ChevronLeft : ChevronRight;

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

  const { start: monthStart, end: monthEnd } = monthRange(month);

  // The dossier list never learns which register it writes to: the page
  // binds the action to this child here, and the bound id travels to the
  // browser sealed — an inline action's closure is encrypted, not editable —
  // while the action itself re-checks the path against the child's folder.
  async function attachChildDocument(input: AttachDocumentInput): Promise<AttachResult> {
    "use server";
    return attachMyChildDocument({ childId: id, ...input });
  }

  // Allergies always load: the header carries the safety badge on every tab.
  // So does the door badge, which is per guardian and therefore fetched once
  // here — the header raises it for this child without another query.
  const [photoUrls, badge, { data: allergyRows }, structures, transfers, dossier] = await Promise.all([
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
    getStructures(supabase, ctx),
    // The child's moves between structures sit at the foot of the attendance
    // tab — history, next to the register it changed — so they are read only
    // when that tab is open.
    tab === "attendance" ? getChildTransfers(supabase, child.id) : Promise.resolve([]),
    // The enrolment file, on every tab: the band under the name says what is
    // still to hand in whichever tab is open, and the Dossier tab lists it.
    // One RPC under the family's own RLS (0164). A read that fails costs the
    // band line and the list, never the child's page — the same rule the
    // home applies to its calendar.
    loadDossier(supabase, { childId: child.id }).catch((e: unknown): DossierStatus | null => {
      console.error("[portal/child] dossier read failed:", e);
      return null;
    }),
  ]);
  const allergies = (allergyRows ?? []) as PortalAllergy[];

  // What the family still has to do about the file, as one line under the
  // name — rejected first, because a refused paper is the office waiting on
  // them, and a missing one is only the gate waiting. Counts look at active
  // required lines only, so a tenant that has not switched its list on (D14)
  // never puts this line on anyone.
  const dossierRejected = dossier?.todo.filter((item) => item.state === "rejected").length ?? 0;
  const dossierBand: { count: number; kind: "rejected" | "missing" } | null =
    dossierRejected > 0
      ? { count: dossierRejected, kind: "rejected" }
      : dossier && dossier.missing > 0
        ? { count: dossier.missing, kind: "missing" }
        : null;

  // The structure is a fact about this child only in a building that has
  // more than one; in the ordinary crèche the word never appears. Asking to
  // move needs the rooms of the other side and the state of any request
  // already filed — both fetched only when there is somewhere to move to.
  const multiStructure = structures.length > 1;
  const structureById = new Map(structures.map((s) => [s.id, s]));
  const childStructure = child.structure_id ? structureById.get(child.structure_id) ?? null : null;
  const canAskToMove = multiStructure && child.status === "enrolled";
  const [classOptions, pendingTransfer] = await Promise.all([
    canAskToMove ? getPortalClasses(supabase, ctx) : Promise.resolve([]),
    canAskToMove ? getPendingTransfer(supabase, child) : Promise.resolve(null),
  ]);
  const pendingTarget = pendingTransfer?.toStructureId
    ? structureById.get(pendingTransfer.toStructureId) ?? null
    : null;

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
    journalDays,
    attendanceRes,
    healthRes,
    enrollmentsRes,
    activitiesRes,
    pickupsRes,
    consentsRes,
    dossierUrls,
  ] = await Promise.all([
    // The last 30 days on which the child has a record — attendance, a
    // published journal, an incident, a published session — one lean row
    // each, from the same composer the day page and the evening send read
    // (kg_child_days, migration 0152). A day the class merely had a
    // timetable is not a day of the child.
    tab === "journal"
      ? getChildDays(supabase, child.id, shiftDate(algiersToday(), -30), algiersToday())
      : Promise.resolve([]),
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
            "medical_conditions, medications, vaccinations, dietary_restrictions, special_needs, doctor_name, doctor_phone, emergency_notes, updated_at"
          )
          .eq("child_id", child.id)
          .maybeSingle()
      : Promise.resolve({ data: null }),
    tab === "activities"
      ? supabase
          .from("kg_activity_enrollments")
          .select(
            "id, status, kg_activities(id, name, name_ar, description, fee_amount, fee_period, schedule, kg_rooms(name, name_ar))"
          )
          .eq("child_id", child.id)
          .eq("tenant_id", ctx.tenant.id)
      : Promise.resolve({ data: [] }),
    tab === "activities"
      ? supabase
          .from("kg_activities")
          .select("id, name, name_ar, description, fee_amount, fee_period, schedule, kg_rooms(name, name_ar)")
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
    // One signing call for every paper on the file and every blank form the
    // list links to (1 h). Only on the tab that shows them: a signed URL is a
    // bearer token, and the journal has no use for one.
    tab === "permissions" && dossier
      ? signedDossierUrls([
          ...dossier.lines
            .filter((line) => line.document)
            .map((line) => ({
              path: line.document!.file_path,
              file_name: line.document!.file_name,
              mime_type: line.document!.mime_type,
            })),
          ...dossier.lines
            .filter((line) => line.active && line.form_path)
            .map((line) => ({
              path: line.form_path!,
              file_name: line.form_name,
              mime_type: "application/pdf",
            })),
        ])
      : Promise.resolve<SignedUrlMap>({}),
  ]);

  const name = childDisplayName(child, locale);
  // The other script's name, muted under the title — the same pairing the
  // children list shows, so the family sees both forms of the name it gave.
  const secondaryName =
    locale === "ar"
      ? `${child.first_name} ${child.last_name}`
      : child.first_name_ar && child.last_name_ar
        ? `${child.first_name_ar} ${child.last_name_ar}`
        : null;
  const cls = classLabel(child, locale);
  // The family's children by name, for the prefilled "ask the office"
  // conversation on the health tab. Names only — serialisable across the
  // client boundary.
  const childrenOptions = children.map((c) => ({ id: c.id, name: childDisplayName(c, locale) }));

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

  // The noun for the class's timetable entries on the facts line — cours for
  // an école, atelier for a therapy centre, activité otherwise — from the
  // structure the child is on today (the tenant's type when the building has
  // one side). The summary rows carry counts only.
  const journalNoun = blocksNounKey(
    toLearningProfile(
      learningProfile(childStructure?.center_type ?? (ctx.tenant as { center_type?: string }).center_type ?? "")
    )
  );

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
      {method && <span>{t(`child.attendance.methods.${method}`)}</span>}
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
  // Without generated database types the room join is inferred as a list;
  // a single-column FK returns one object, as the enrolments' join above.
  const availableActivities = ((activitiesRes.data ?? []) as unknown as ActivityRow[]).filter(
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

  // "Jeudi 09:00 – 10:00 · Salle 2": when the activity meets, then where. A
  // parent bringing a child to Coran in a two-building school needs the room
  // as much as for a parents' meeting, so it is printed here as the same
  // tail the staff pages print (lesson rooms stay off the portal — a child
  // never walks to a cours alone). The schedule is read through the one
  // normaliser, so a row still stored as integer days prints its slots. On a
  // phone the line wraps between units only: a slot keeps its day with its
  // range and the room keeps its number, or "Salle 4" broke as "Salle / 4".
  function scheduleLine(activity: ActivityRow): ReactNode | null {
    const slots = normaliseSchedule(activity.schedule);
    const room = activity.kg_rooms ? roomName(activity.kg_rooms, locale) : null;
    if (slots.length === 0 && !room) return null;
    return (
      <>
        {slots.map((s, i) => (
          <Fragment key={`${s.day}-${s.start}-${i}`}>
            {i > 0 && " "}
            <span className="whitespace-nowrap">
              {t(`child.activities.days.${s.day}`)}{" "}
              <ValueRange from={s.start} to={s.end} separator="–" className="tabular-nums" />
              {(i < slots.length - 1 || room) && <span aria-hidden> ·</span>}
            </span>
          </Fragment>
        ))}
        {room && (
          <>
            {slots.length > 0 && " "}
            <bdi dir="auto" className="whitespace-nowrap">{room}</bdi>
          </>
        )}
      </>
    );
  }

  return (
    <div className="grid gap-4">
      {/* ===== Back line, then the identity band: face, name, one facts line ===== */}
      <div className="grid gap-3">
        <Link
          href="/portal/children"
          className="inline-flex w-fit items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
        >
          <BackIcon className="size-4" aria-hidden />
          {t("child.back")}
        </Link>
        <Card className="shadow-sm">
          <CardContent className="grid gap-4">
            <div className="flex items-center gap-3.5">
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
                {secondaryName && (
                  <p className="text-sm text-muted-foreground text-start" dir="auto">
                    {secondaryName}
                  </p>
                )}
                {/* One line of facts: age · class · structure. The class is
                    plain text and the structure is the one coloured mark —
                    where the child is, said once. */}
                <FactsLine
                  className="mt-1"
                  facts={[
                    <span key="age">{ageFromDob(child.dob, locale)}</span>,
                    /* Said only when it is not "enrolled" — the same rule as the
                       children list, and the reason the door badge is missing. */
                    child.status !== "enrolled" && (
                      <Badge
                        key="status"
                        variant={child.status === "withdrawn" ? "destructive" : "secondary"}
                        className="text-[0.6875rem]"
                      >
                        {t(`children.status.${child.status}`)}
                      </Badge>
                    ),
                    cls && <span key="class">{cls}</span>,
                    multiStructure && childStructure && (
                      <StructureMark
                        key="structure"
                        structure={{ name: structureName(childStructure, locale), color: childStructure.color }}
                        className="text-xs"
                      />
                    ),
                  ]}
                />

                {/* The one thing that needs the family's action, never two:
                    what is owed wins over a paper still to hand in, and the
                    paper wins over a missing photo, because that is the
                    order the office raises them in at the gate. The figure
                    is the same helper the children list and the home screen
                    use, so one child cannot read as settled on one screen
                    and owing on another; the dossier line wears the same
                    gold pill, and links to the tab that settles it. */}
                {due ? (
                  <div className="mt-1.5">
                    <span
                      className={cn(
                        "inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[0.6875rem] font-medium",
                        due.overdue ? "bg-destructive/10 text-destructive" : "bg-gold-muted text-gold-ink"
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
                ) : dossierBand ? (
                  <div className="mt-1.5">
                    <Link
                      href={`/portal/children/${child.id}?tab=permissions`}
                      scroll={false}
                      className="inline-flex items-center gap-1.5 rounded-full bg-gold-muted px-2 py-0.5 text-[0.6875rem] font-medium text-gold-ink"
                    >
                      <FileWarning className="size-3" aria-hidden />
                      {dossierBand.kind === "rejected"
                        ? t("dossier.rejectedLine", { count: dossierBand.count })
                        : t("dossier.missingLine", { count: dossierBand.count })}
                    </Link>
                  </div>
                ) : (
                  !child.photo_path && (
                    <p className="mt-1.5 text-xs leading-relaxed text-muted-foreground">
                      {t("child.photo.hint")}
                    </p>
                  )
                )}
              </div>
            </div>

            {/* ===== Actions: the door badge, and asking to move =====
                 Both outline, both 44px: a parent hits these while walking.
                 The badge only for a child who attends — the kiosk refuses a
                 withdrawn or waitlisted child's arrival anyway (0069), and a
                 badge that scans to a refusal is worse than no badge. The move
                 request is one control, or the state of the request already
                 sent — never both, because the RPC would refuse a second and a
                 family should not have to learn that from an error. */}
            {(child.status === "enrolled" || canAskToMove) && (
              <div className="flex flex-wrap items-center gap-2">
                {child.status === "enrolled" && (
                  <CheckinDialog
                    badge={badge}
                    child={checkinChildren.find((c) => c.id === child.id)}
                    trigger="inline"
                  />
                )}
                {canAskToMove &&
                  (pendingTransfer ? (
                    <StatusPill tone="attention" className="min-h-11 px-3">
                      <Hourglass className="size-3.5 shrink-0" aria-hidden />
                      {pendingTarget
                        ? t("transfer.pendingTo", { structure: structureName(pendingTarget, locale) })
                        : t("transfer.pending")}
                    </StatusPill>
                  ) : (
                    <RequestTransferDialog
                      childId={child.id}
                      childName={name}
                      dob={child.dob}
                      currentStructureId={child.structure_id}
                      structures={structures}
                      classes={classOptions}
                    />
                  ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* ===== Tabs (URL-driven so each tab loads only its own data) =====
          The settings bar — a white card, icon + label, the active one a
          primary tint — laid out as five equal columns with the icon above
          the label, which is how five sections fit a phone. */}
      <nav
        aria-label={t("child.tabsLabel")}
        className="grid grid-cols-5 gap-1 rounded-xl border border-border bg-card p-1.5 shadow-sm"
      >
        {TABS.map((key) => {
          const active = key === tab;
          const Icon = TAB_ICONS[key];
          return (
            <Link
              key={key}
              // The month travels only with the attendance tab — it means
              // nothing to the others, and a stale ?month= on the journal
              // would be carried back into attendance later as a surprise.
              href={
                key === "attendance" && month !== currentMonth
                  ? `/portal/children/${child.id}?tab=attendance&month=${month}`
                  : `/portal/children/${child.id}?tab=${key}`
              }
              // Without this the tab strip jumps to the top of the document on
              // every tap, which on a phone reads as a page reload.
              scroll={false}
              aria-current={active ? "page" : undefined}
              className={cn(
                "flex min-w-0 flex-col items-center gap-1 rounded-lg px-1 py-2 text-xs font-medium transition-colors",
                active
                  ? "bg-primary/10 text-primary"
                  : "text-muted-foreground hover:bg-muted hover:text-foreground"
              )}
            >
              <Icon className="size-4 shrink-0" aria-hidden />
              <span className="w-full truncate text-center">{t(`child.tabs.${key}`)}</span>
            </Link>
          );
        })}
      </nav>

      {/* ===== Journal — the child's dated days, one row each =====
           One section card holding a divided list: the date, one muted line
           of facts, and the one red the tab spends (an incident count) at the
           end. The row is the link to the day page, where the same composer
           lays the day out in full. A day the child was away shows the status
           word alone — nothing was lived there to summarise. */}
      {tab === "journal" &&
        (journalDays.length === 0 ? (
          <EmptyState
            icon={<BookOpen />}
            title={t("child.journal.emptyDays")}
            description={t("child.journal.emptyDaysDescription")}
          />
        ) : (
          <SectionCard
            icon={BookOpen}
            tone={0}
            title={t("child.journal.title")}
            hint={t("child.journal.hint")}
            contentClassName="px-0"
          >
            <ul className="divide-y divide-border">
              {journalDays.map((d) => {
                const away =
                  d.attendance !== null &&
                  (d.attendance.status === "absent" || d.attendance.status === "sick" || d.attendance.status === "excused");
                const statusKey = d.attendance?.status as
                  | (typeof ATTENDANCE_SUMMARY)[number]
                  | undefined;
                const facts: React.ReactNode[] = away
                  ? [
                      statusKey && (ATTENDANCE_SUMMARY as readonly string[]).includes(statusKey) && (
                        <span key="status">{t(`child.attendance.statuses.${statusKey}`)}</span>
                      ),
                    ]
                  : [
                      d.attendance?.checkIn && (
                        <span key="range" className="inline-flex items-baseline gap-1">
                          {t("home.today.arrival")}
                          {d.attendance.checkOut ? (
                            <ValueRange
                              from={formatTime(d.attendance.checkIn, locale)}
                              to={formatTime(d.attendance.checkOut, locale)}
                              separator="–"
                              className="tabular-nums"
                            />
                          ) : (
                            <span dir="ltr" className="tabular-nums">{formatTime(d.attendance.checkIn, locale)}</span>
                          )}
                        </span>
                      ),
                      d.lessons > 0 && (
                        <span key="lessons">
                          {t(`child.journal.facts.lessons.${journalNoun}`, { count: d.lessons })}
                        </span>
                      ),
                      d.mood && KNOWN_MOODS.includes(d.mood) && (
                        <span key="mood">{t(`day.moods.${d.mood as "happy"}`)}</span>
                      ),
                      d.sessions > 0 && (
                        <span key="sessions">{t("child.journal.facts.sessions", { count: d.sessions })}</span>
                      ),
                    ];
                return (
                  <li key={d.date}>
                    <Link
                      href={`/portal/children/${child.id}/day/${d.date}`}
                      className="flex min-h-14 items-center gap-3 px-5 py-3 transition-colors hover:bg-primary/5 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
                    >
                      {/* No year: the list is the last 30 days, and the
                          year would push the facts onto a second line on
                          a phone. */}
                      <span className="min-w-24 shrink-0 text-sm font-medium tabular-nums">
                        {formatDate(d.date, locale, { weekday: "short", day: "numeric", month: "short", year: undefined })}
                      </span>
                      {/* The facts keep their column even when there are
                          none (an incident on a day without a register),
                          so the pill and the chevron stay at the end. */}
                      <span className="min-w-0 flex-1">
                        <FactsLine className="text-sm" facts={facts} />
                      </span>
                      {d.incidents > 0 && (
                        <StatusPill tone="danger">
                          {t("child.journal.facts.incidents", { count: d.incidents })}
                        </StatusPill>
                      )}
                      <ForwardIcon className="size-4 shrink-0 text-muted-foreground" aria-hidden />
                    </Link>
                  </li>
                );
              })}
            </ul>
          </SectionCard>
        ))}

      {/* ===== Présences (one month, navigable) ===== */}
      {tab === "attendance" && (
        <Card className="shadow-sm">
          <CardHeader className="flex flex-row items-center gap-3">
            <IconTile tone="primary">
              <CalendarCheck />
            </IconTile>
            <CardTitle className="min-w-0 flex-1 text-base font-semibold">
              {t("child.attendance.month", { month: monthLabel(month, locale) })}
            </CardTitle>
            {/* Previous / next, mirroring the staff child file. Next is
                disabled — not hidden — at the current month, so the pair
                keeps its place and a thumb does not land on the wrong one. */}
            <div className="flex shrink-0 items-center gap-1">
              <Button asChild variant="outline" size="icon" aria-label={t("child.attendance.prevMonth")}>
                <Link
                  href={`/portal/children/${child.id}?tab=attendance&month=${shiftMonth(month, -1)}`}
                  scroll={false}
                >
                  <BackIcon />
                </Link>
              </Button>
              {month < currentMonth ? (
                <Button asChild variant="outline" size="icon" aria-label={t("child.attendance.nextMonth")}>
                  <Link
                    href={`/portal/children/${child.id}?tab=attendance&month=${shiftMonth(month, 1)}`}
                    scroll={false}
                  >
                    <BackIcon className="rotate-180" />
                  </Link>
                </Button>
              ) : (
                <Button variant="outline" size="icon" aria-label={t("child.attendance.nextMonth")} disabled>
                  <BackIcon className="rotate-180" />
                </Button>
              )}
            </div>
          </CardHeader>
          <CardContent className="grid gap-4 p-0">
            <div className="grid grid-cols-5 gap-2 px-4">
              {ATTENDANCE_SUMMARY.map((k) => (
                <div key={k} className="rounded-xl bg-muted/60 px-2 py-2.5 text-center">
                  <div
                    className={cn(
                      "text-xl font-bold tabular-nums",
                      (attendanceCounts[k] ?? 0) > 0 && SUMMARY_TONE[k]
                    )}
                  >
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
                {t("child.attendance.emptyMonth", { month: monthLabel(month, locale) })}
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
                  // One method line when in and out were recorded the same
                  // way — "Code au kiosque" twice is one fact said twice.
                  const sameMethod =
                    a.check_in_at && a.check_out_at && a.check_in_method === a.check_out_method
                      ? a.check_in_method
                      : null;
                  const inMethod = a.check_in_at && !sameMethod ? a.check_in_method : null;
                  const outMethod = a.check_out_at && !sameMethod ? a.check_out_method : null;
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
                          separator="–"
                          className="shrink-0 text-xs text-muted-foreground tabular-nums"
                        />
                        <Badge className={attendanceStatusClasses(a.status)}>
                          {t(`child.attendance.statuses.${a.status}`)}
                        </Badge>
                      </div>
                      {(showIn || showOut || sameMethod) && (
                        <div className="mt-1.5 grid gap-1 text-xs text-muted-foreground">
                          {showIn && attendanceLine(inAttribution, inMethod, "in")}
                          {showOut && attendanceLine(outAttribution, outMethod, "out")}
                          {sameMethod && <p>{t(`child.attendance.methods.${sameMethod}`)}</p>}
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

      {/* ===== Parcours — the moves the child has made, read-only =====
           Written only by kg_move_child, so this is the record the register
           prints, not a draft. A building with one structure never has rows
           here and shows nothing. */}
      {tab === "attendance" && transfers.length > 0 && (
        <SectionCard icon={Route} tone={0} title={t("transfer.historyTitle")} contentClassName="gap-0">
          <ol className="divide-y divide-border text-sm">
            {transfers.map((tr) => {
              const to = tr.to_structure_id ? structureById.get(tr.to_structure_id) ?? null : null;
              const from = tr.from_structure_id ? structureById.get(tr.from_structure_id) ?? null : null;
              return (
                <li key={tr.id} className="flex items-center gap-3 py-2.5 first:pt-0 last:pb-0">
                  <span className="w-24 shrink-0 text-xs text-muted-foreground tabular-nums">
                    {formatDate(tr.effective_date, locale)}
                  </span>
                  <span className="flex min-w-0 flex-1 flex-wrap items-center gap-x-2 gap-y-0.5">
                    {to ? (
                      <StructureMark
                        structure={{ name: structureName(to, locale), color: to.color }}
                        className="font-medium"
                      />
                    ) : (
                      <span className="font-medium">{t("transfer.historyUnknown")}</span>
                    )}
                    {from && (
                      <span className="text-xs text-muted-foreground">
                        {t("transfer.historyFrom", { structure: structureName(from, locale) })}
                      </span>
                    )}
                  </span>
                </li>
              );
            })}
          </ol>
        </SectionCard>
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
              <HealthEditRecord
                childId={child.id}
                health={healthRecord}
                updatedAt={healthRow?.updated_at ?? null}
                childrenOptions={childrenOptions}
              />
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
                  const schedule = scheduleLine(activity);
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
                  const schedule = scheduleLine(activity);
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

      {/* ===== Dossier — the enrolment file, then the two registers the family owns ===== */}
      {tab === "permissions" && (
        <div className="grid gap-3">
          {/* --- The papers of the file (0164) ---
               First, because it is what the tab is now named for. One card,
               one row per requirement of the child's kind, the family's next
               move at the end of each row. Not drawn at all while the
               establishment has no active requirement (D14): an empty file
               is the expected state and renders nothing. */}
          {dossier && dossier.lines.length > 0 && (
            <SectionCard
              icon={FileCheck2}
              tone={1}
              title={t("dossier.title")}
              hint={
                dossier.required > 0
                  ? tCommon("dossier.count", { ok: dossier.accepted, total: dossier.required })
                  : undefined
              }
            >
              <FamilyDossierList
                lines={dossier.lines}
                urls={dossierUrls}
                pathPrefix={`t/${ctx.tenant.id}/children/${child.id}/documents`}
                onAttach={attachChildDocument}
              />
            </SectionCard>
          )}

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
