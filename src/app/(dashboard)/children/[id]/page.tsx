import Link from "next/link";
import {
  ArrowLeft,
  CalendarDays,
  ChevronRight,
  IdCard,
  Receipt,
  UserX,
  Wallet,
} from "lucide-react";
import { getLocale, getTranslations } from "next-intl/server";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { ClassChip } from "@/components/shared/class-chip";
import { EmptyState } from "@/components/shared/empty-state";
import { InvoiceLink } from "@/components/shared/entity-link";
import { IdentityBand } from "@/components/shared/identity-band";
import { PageHeader } from "@/components/shared/page-header";
import { SectionCard } from "@/components/shared/section-card";
import { StatusPill, type StatusTone } from "@/components/shared/status-pill";
import { StructureTile } from "@/components/shared/structure-mark";
import { createClient } from "@/lib/supabase/server";
import { requireStaff, signedMediaUrl } from "@/lib/tenant";
import { loadDossier, signedDossierUrls } from "@/lib/dossier-server";
import type { DocumentRequirement } from "@/lib/dossier";
import { ageFromDob, childDisplayName, formatDZD, formatDate, formatTime, initials, intlLocale } from "@/lib/format";
import { cn } from "@/lib/utils";
import { rosterNoun } from "@/lib/vocabulary";
import type {
  Attendance, AttendanceStatus, Child, ChildStatus, FeePeriod, Gender, InvoiceStatus,
} from "@/lib/types";
import { ChildPhotoControl } from "@/components/modules/children/photo-controls";
import { ChildTabs } from "@/components/modules/children/child-tabs";
import { ConsentsSection } from "@/components/modules/children/consents-section";
import { DossierSection } from "@/components/modules/enroll/dossier-section";
import { EditChildDialog } from "@/components/modules/children/edit-child-dialog";
import { MoveChildButton } from "@/components/modules/children/move-child-dialog";
import { TransferHistory } from "@/components/modules/children/transfer-history";
import { structureName, type Structure } from "@/components/modules/classes/class-types";
import type { GuardianCredentialState } from "@/components/modules/children/guardian-credentials-control";
import { GuardiansSection } from "@/components/modules/children/guardians-section";
import { HealthSection } from "@/components/modules/children/health-section";
import { PickupsSection } from "@/components/modules/children/pickups-section";
import {
  ChildActivitiesSection,
  type ChildActivityOption,
  type ChildActivityRow,
} from "@/components/modules/children/activities-section";
import { activityChargeIsLocked } from "@/components/modules/classes/actions";
import { StatusActions } from "@/components/modules/children/status-actions";
import { CredentialCards } from "@/components/modules/credentials/credential-cards";
import { ScanCardSheet, type ScanSubject } from "@/components/modules/credentials/scan-card-sheet";
import type { CredentialRow } from "@/components/modules/credentials/types";
import { parseHealthList } from "@/components/modules/portal/health-edit-shared";
import { algiersToday } from "@/components/modules/billing/dates";
import { AssignFeeDialog } from "@/components/modules/billing/assign-fee-dialog";
import { isOpenInvoice, owedHref } from "@/components/modules/billing/owed-link";
import type { PlanOption } from "@/components/modules/billing/billing-types";
import { AllergyBadge } from "@/components/modules/children/allergy-badge";
import {
  CHILD_TABS,
  CONSENT_TYPES,
  type AllergyRow,
  type ChildTabKey,
  type ChildHealthRow,
  type ChildTransferRow,
  type ClassOption,
  type CurrentFeeRow,
  type MoveFeePlanOption,
  type ConsentState,
  type ConsentType,
  type GuardianLink,
  type GuardianOption,
} from "@/components/modules/children/types";


/**
 * Pills by MEANING, not by module. A child's expected state — enrolled —
 * has no pill at all; the absence is the signal. Present is done, absent
 * and late are the red of the day, sick waits on a note, excused is over.
 */
const CHILD_STATUS_TONE: Partial<Record<ChildStatus, StatusTone>> = {
  pending: "attention",
  waitlist: "attention",
  withdrawn: "muted",
  alumni: "muted",
};
const ATTENDANCE_TONE: Record<AttendanceStatus, StatusTone> = {
  present: "success",
  absent: "danger",
  late: "danger",
  sick: "attention",
  excused: "muted",
};
const INVOICE_TONE: Record<InvoiceStatus, StatusTone> = {
  draft: "muted",
  sent: "attention",
  unpaid: "attention",
  partial: "attention",
  paid: "success",
  overdue: "danger",
  void: "muted",
};

// ----- Sunday–Thursday Algeria calendar helpers (Africa/Algiers month math) -----

function algiersMonth(): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Africa/Algiers", year: "numeric", month: "2-digit", day: "2-digit",
  }).format(new Date()).slice(0, 7);
}

function shiftMonth(month: string, delta: number): string {
  const [y, m] = month.split("-").map(Number);
  const d = new Date(Date.UTC(y, m - 1 + delta, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

function monthRange(month: string): { start: string; end: string } {
  return { start: `${month}-01`, end: `${shiftMonth(month, 1)}-01` };
}

// ----- Row shapes returned by the joined queries -----

type ChildRow = Child & {
  kg_classes: { id: string; name: string; name_ar: string | null; color: string } | null;
};

type GuardianJoinRow = {
  guardian_id: string;
  is_primary: boolean;
  can_pickup: boolean;
  is_financial: boolean;
  kg_guardians: Omit<
    GuardianLink,
    "guardian_id" | "is_primary" | "can_pickup" | "is_financial" | "photoUrl" | "hasAccount"
  > & {
    id: string;
    /** Null until a parent redeems a claim code (0053) or an enrolment is approved. */
    user_id: string | null;
    // Door credentials. The PIN itself never leaves the server — only whether
    // one exists — so a screenshot of the profile can't leak it.
    pin_code: string | null;
    tag_code: string | null;
  };
};

type FeeJoinRow = {
  id: string;
  /** Needed to open the assign dialog on the plan this child is already on. */
  fee_plan_id: string;
  custom_amount: number | null;
  discount_pct: number;
  start_date: string;
  end_date: string | null;
  kg_fee_plans: {
    name: string;
    name_ar: string | null;
    amount: number;
    period: FeePeriod;
    /** The plan's structure; null = the whole building. Decides whether a
     *  move ends it (0140). */
    structure_id: string | null;
  } | null;
};

/** One kg_child_transfers row with its joins, before the names are resolved. */
type TransferJoinRow = {
  id: string;
  effective_date: string;
  reason: string | null;
  origin: "staff" | "parent_request";
  moved_by: string | null;
  created_at: string;
  from_structure: { name: string; name_ar: string | null; color: string } | null;
  to_structure: { name: string; name_ar: string | null; color: string } | null;
  from_class: { id: string; name: string; name_ar: string | null } | null;
  to_class: { id: string; name: string; name_ar: string | null } | null;
};

type InvoiceRow = {
  id: string; number: number; period_month: string | null; issue_date: string;
  due_date: string | null; status: InvoiceStatus; total: number; paid_amount: number;
};

export default async function ChildProfilePage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ tab?: string; month?: string }>;
}) {
  const [{ id }, sp] = await Promise.all([params, searchParams]);
  const ctx = await requireStaff();
  const t = await getTranslations("children");
  const tb = await getTranslations("billing");
  const tCred = await getTranslations("credentials");
  // The age is spelt from common.labels' ICU plurals so Arabic gets its dual
  // and plural forms ("سنتان", "3 سنوات") instead of "2 سنوات".
  const tc = await getTranslations("common.labels");
  const locale = await getLocale();
  const supabase = await createClient();

  const tab: ChildTabKey = (CHILD_TABS as readonly string[]).includes(sp.tab ?? "")
    ? (sp.tab as ChildTabKey)
    : "profile";
  const month = /^\d{4}-\d{2}$/.test(sp.month ?? "") ? (sp.month as string) : algiersMonth();
  const { start, end } = monthRange(month);

  const { data: childRow, error } = await supabase
    .from("kg_children")
    .select("*, kg_classes(id, name, name_ar, color)")
    .eq("id", id)
    .eq("tenant_id", ctx.tenant.id)
    .maybeSingle();
  if (error) throw new Error(error.message);

  const child = childRow as ChildRow | null;
  if (!child) {
    return (
      <div>
        <PageHeader title={t("roster.title")} />
        <EmptyState
          icon={
            <span className="flex size-14 items-center justify-center rounded-2xl bg-muted text-muted-foreground [&>svg]:size-7">
              <UserX />
            </span>
          }
          title={t("roster.noMatch")}
          description={t("roster.noMatchDescription")}
          action={
            <Button asChild variant="outline">
              <Link href="/children">{t("profile.back")}</Link>
            </Button>
          }
        />
      </div>
    );
  }

  const [
    { data: guardianRows },
    { data: allGuardians },
    { data: pickups },
    { data: healthRow },
    { data: allergyRows },
    { data: attendanceRows },
    { data: planRows },
    feesRes,
    invoicesRes,
    dossier,
    { data: consentRows },
    { data: activityEnrollmentRows },
    { data: activityRows },
    chargeLocked,
  ] = await Promise.all([
    supabase
      .from("kg_child_guardians")
      .select(
        "guardian_id, is_primary, can_pickup, is_financial, kg_guardians(id, user_id, first_name, last_name, first_name_ar, last_name_ar, relationship, phone, phone_alt, email, national_id, address, workplace, photo_path, pin_code, tag_code)"
      )
      .eq("child_id", id),
    supabase
      .from("kg_guardians")
      .select("id, first_name, last_name, first_name_ar, last_name_ar, phone")
      .eq("tenant_id", ctx.tenant.id)
      .order("last_name"),
    supabase
      .from("kg_authorized_pickups")
      .select("id, name, relationship, phone, national_id")
      .eq("child_id", id)
      .eq("tenant_id", ctx.tenant.id)
      .order("name"),
    supabase.from("kg_child_health").select("*").eq("child_id", id).maybeSingle(),
    supabase
      .from("kg_child_allergies")
      .select("id, allergen, severity, reaction, action_plan")
      .eq("child_id", id)
      .eq("tenant_id", ctx.tenant.id)
      .order("created_at"),
    supabase
      .from("kg_attendance")
      .select("id, date, status, check_in_at, check_out_at, picked_up_by")
      .eq("child_id", id)
      .eq("tenant_id", ctx.tenant.id)
      .gte("date", start)
      .lt("date", end)
      .order("date", { ascending: false }),
    // The tariffs this child could be put on. Fetched here so the plan can be
    // set on the child's own screen: the "Sans mensualité" badge points at
    // this tab, and until now the only thing here was a link to the billing
    // hub — the badge promised an action the page could not perform.
    ctx.isFinance
      ? supabase
          .from("kg_fee_plans")
          .select("id, name, name_ar, amount, period, active, structure_id")
          .eq("tenant_id", ctx.tenant.id)
          .eq("active", true)
          .eq("period", "monthly")
          .order("amount")
      : Promise.resolve({ data: [] }),
    ctx.isFinance
      ? supabase
          .from("kg_child_fees")
          .select(
            "id, fee_plan_id, custom_amount, discount_pct, start_date, end_date, kg_fee_plans(name, name_ar, amount, period, structure_id)"
          )
          .eq("child_id", id)
          .eq("tenant_id", ctx.tenant.id)
          .order("start_date", { ascending: false })
      : Promise.resolve({ data: [] }),
    ctx.isFinance
      ? supabase
          .from("kg_invoices")
          .select("id, number, period_month, issue_date, due_date, status, total, paid_amount")
          .eq("child_id", id)
          .eq("tenant_id", ctx.tenant.id)
          .order("issue_date", { ascending: false })
          .limit(36)
      : Promise.resolve({ data: [] }),
    // The enrolment file (0164), scored by kg_dossier_status for the child's
    // kind. Only the documents tab reads it, so only that tab pays for it.
    tab === "documents" ? loadDossier(supabase, { childId: id }) : Promise.resolve(null),
    supabase
      .from("kg_consents")
      .select("consent_type, granted, decided_at")
      .eq("child_id", id)
      .eq("tenant_id", ctx.tenant.id),
    // What this child is signed up for, and what they could be signed up for.
    // Asked here rather than only on the activities screen because that is the
    // question staff have in front of them at the gate.
    supabase
      .from("kg_activity_enrollments")
      .select("id, activity_id, status")
      .eq("child_id", id)
      .eq("tenant_id", ctx.tenant.id),
    supabase
      .from("kg_activities")
      .select("id, name, name_ar, category, fee_amount, fee_period")
      .eq("tenant_id", ctx.tenant.id)
      .eq("active", true)
      .order("name"),
    // Enrolling bills the family; once this month's invoice is part-paid the
    // charge can no longer be taken back off it. Asked before the dialog opens
    // so the warning is on screen when the decision is made.
    activityChargeIsLocked(id),
  ]);

  const photoUrl = await signedMediaUrl(child.photo_path);

  const guardianJoins = ((guardianRows ?? []) as unknown as GuardianJoinRow[]).filter(
    (r) => r.kg_guardians
  );

  // The guardian's face is the door check's second factor, so every row carries
  // its own signed URL — staff must be able to see (and fix) it from here.
  const guardianPhotoUrls = await Promise.all(
    guardianJoins.map((r) => signedMediaUrl(r.kg_guardians.photo_path))
  );

  // Outstanding portal invites, so the office can see one exists, read the code
  // back down the phone, and withdraw it — none of which was possible while the
  // code was printed once and never fetched again. Admin-only: the RLS policy on
  // kg_guardian_claims is kg_is_admin for every command, so a non-admin simply
  // gets nothing back rather than an error.
  const guardianIds = guardianJoins.map((r) => r.guardian_id);
  const { data: claimRows } = ctx.isAdmin && guardianIds.length > 0
    ? await supabase
        .from("kg_guardian_claims")
        .select("guardian_id, code, expires_at")
        .eq("tenant_id", ctx.tenant.id)
        .in("guardian_id", guardianIds)
        .is("claimed_at", null)
        .gt("expires_at", new Date().toISOString())
    : { data: [] };
  const claimByGuardian = new Map(
    ((claimRows ?? []) as { guardian_id: string; code: string; expires_at: string }[]).map(
      (c) => [c.guardian_id, { code: c.code, expiresAt: c.expires_at }]
    )
  );

  const links: GuardianLink[] = guardianJoins
    .map((r, i) => ({
      guardian_id: r.guardian_id,
      is_primary: r.is_primary,
      can_pickup: r.can_pickup,
      is_financial: r.is_financial,
      first_name: r.kg_guardians.first_name,
      last_name: r.kg_guardians.last_name,
      first_name_ar: r.kg_guardians.first_name_ar,
      last_name_ar: r.kg_guardians.last_name_ar,
      relationship: r.kg_guardians.relationship,
      phone: r.kg_guardians.phone,
      phone_alt: r.kg_guardians.phone_alt,
      email: r.kg_guardians.email,
      national_id: r.kg_guardians.national_id,
      address: r.kg_guardians.address,
      workplace: r.kg_guardians.workplace,
      photo_path: r.kg_guardians.photo_path,
      photoUrl: guardianPhotoUrls[i],
      hasAccount: r.kg_guardians.user_id !== null,
      claim: claimByGuardian.get(r.guardian_id) ?? null,
    }));

  // Only the *presence* of a PIN crosses to the client; the digits are shown
  // once, at issuance, straight from the RPC result.
  const guardianCredentials: Record<string, GuardianCredentialState> = ctx.isAdmin
    ? Object.fromEntries(
        guardianJoins.map((r) => [
          r.guardian_id,
          { tagCode: r.kg_guardians.tag_code, hasPin: r.kg_guardians.pin_code !== null },
        ])
      )
    : {};

  // Proximity cards for this child and for every adult linked to them. Admins
  // only — RLS refuses the rest, and non-admins never see the panel.
  const { data: cardRows } = ctx.isAdmin
    ? await supabase
        .from("kg_credentials")
        .select("id, kind, value, label, active, issued_at, last_used_at, subject_type, subject_id")
        .eq("tenant_id", ctx.tenant.id)
        .eq("kind", "rfid")
        .eq("active", true)
        .or(
          `and(subject_type.eq.child,subject_id.eq.${id}),` +
            `and(subject_type.eq.guardian,subject_id.in.(${
              guardianJoins.map((r) => r.guardian_id).join(",") || "00000000-0000-0000-0000-000000000000"
            }))`
        )
        .order("issued_at")
    : { data: [] as (CredentialRow & { subject_type: string; subject_id: string })[] };

  const allCards = (cardRows ?? []) as (CredentialRow & {
    subject_type: string;
    subject_id: string;
  })[];
  const childCards = allCards.filter((c) => c.subject_type === "child");
  const guardianCards: Record<string, CredentialRow[]> = {};
  for (const c of allCards.filter((c) => c.subject_type === "guardian")) {
    (guardianCards[c.subject_id] ??= []).push(c);
  }

  const linkedIds = new Set(links.map((l) => l.guardian_id));
  const available: GuardianOption[] = (allGuardians ?? [])
    .filter((g) => !linkedIds.has(g.id))
    .map((g) => ({
      id: g.id,
      label: childDisplayName(g, locale),
      phone: g.phone,
    }));

  // Activities. Only what the child is IN or WAITING ON is shown — an ended
  // enrolment is history, and the record already has enough history tabs. The
  // same rule builds the "enrol" list, so a child cannot be enrolled twice.
  type ActivityRow = {
    id: string;
    name: string;
    name_ar: string | null;
    category: string;
    fee_amount: number | string;
    fee_period: FeePeriod;
  };
  const activityById = new Map(
    ((activityRows ?? []) as ActivityRow[]).map((a) => [
      a.id,
      {
        id: a.id,
        name: locale === "ar" && a.name_ar ? a.name_ar : a.name,
        category: a.category,
        feeAmount: Number(a.fee_amount),
        feePeriod: a.fee_period,
      } satisfies ChildActivityOption,
    ])
  );
  const liveEnrollments = (
    (activityEnrollmentRows ?? []) as { id: string; activity_id: string; status: string }[]
  ).filter((e) => e.status === "active" || e.status === "requested");
  const childActivities: ChildActivityRow[] = liveEnrollments.flatMap((e) => {
    // An enrolment in an activity that has since been switched off is still
    // real — and still billed — so it must not vanish from the record.
    const a = activityById.get(e.activity_id);
    return a
      ? [{ ...a, enrollmentId: e.id, status: e.status as "active" | "requested" }]
      : [];
  });
  const joinedActivityIds = new Set(liveEnrollments.map((e) => e.activity_id));
  const activityOptions: ChildActivityOption[] = [...activityById.values()].filter(
    (a) => !joinedActivityIds.has(a.id)
  );

  const health: ChildHealthRow | null = healthRow
    ? {
        // jsonb lists, kept as editable lines that remember their original
        // JSON: an entry seeded from an application as `{ "name": "BCG", … }`
        // must survive a staff save that never touched it.
        medical_conditions: parseHealthList(healthRow.medical_conditions),
        medications: parseHealthList(healthRow.medications),
        vaccinations: parseHealthList(healthRow.vaccinations),
        dietary_restrictions: healthRow.dietary_restrictions,
        special_needs: healthRow.special_needs,
        doctor_name: healthRow.doctor_name,
        doctor_phone: healthRow.doctor_phone,
        emergency_notes: healthRow.emergency_notes,
      }
    : null;

  const allergies = (allergyRows ?? []) as AllergyRow[];

  const attendance = (attendanceRows ?? []) as Pick<
    Attendance, "id" | "date" | "status" | "check_in_at" | "check_out_at" | "picked_up_by"
  >[];
  const attendanceCounts = attendance.reduce<Record<string, number>>((acc, a) => {
    acc[a.status] = (acc[a.status] ?? 0) + 1;
    return acc;
  }, {});

  const fees = ((feesRes.data ?? []) as unknown as FeeJoinRow[]).filter((f) => f.kg_fee_plans);

  // No live MONTHLY plan means this child is charged no tuition — the monthly
  // run will invoice their activities, if any, and nothing else. The `period`
  // test is the whole point: every approval also writes a one-off admission
  // row, and treating that as "has a fee" is what let four children look
  // billed while they were not.
  const billingToday = algiersToday();
  // One clock for this render, handed to the client so invite expiry is a
  // function of props rather than an impure read during render.
  const renderedAt = new Date().toISOString();
  const planOptions = ((planRows ?? []) as PlanOption[]).map((p) => ({
    ...p,
    amount: Number(p.amount),
  }));
  // The same plans, tagged with their structure, for the move dialog to
  // offer only the target's own and the building's.
  const movePlans: MoveFeePlanOption[] = (
    (planRows ?? []) as (PlanOption & { structure_id: string | null })[]
  ).map((p) => ({
    id: p.id,
    name: p.name,
    name_ar: p.name_ar,
    amount: Number(p.amount),
    structure_id: p.structure_id ?? null,
  }));
  // The live monthly assignment, so the dialog opens on what this child is
  // actually on rather than empty.
  const currentFee = fees.find(
    (f) =>
      f.kg_fee_plans?.period === "monthly" &&
      (f.end_date === null || f.end_date > billingToday)
  );
  const hasMonthlyPlan = fees.some(
    (f) =>
      f.kg_fee_plans?.period === "monthly" &&
      (f.end_date === null || f.end_date > billingToday)
  );
  // Every live monthly tariff, with its plan's structure, so the move dialog
  // can say which of them the move will stop before the director confirms.
  const currentFees: CurrentFeeRow[] = fees
    .filter(
      (f) =>
        f.kg_fee_plans?.period === "monthly" &&
        (f.end_date === null || f.end_date > billingToday)
    )
    .map((f) => ({
      id: f.id,
      planId: f.fee_plan_id,
      planName: f.kg_fee_plans!.name,
      planNameAr: f.kg_fee_plans!.name_ar,
      amount: Number(f.custom_amount ?? f.kg_fee_plans!.amount),
      structureId: f.kg_fee_plans!.structure_id ?? null,
    }));
  // Newest due first: the invoice the office is chasing is the one at the
  // top, and a list ordered by issue number reads as a jumble of months.
  const invoices = ((invoicesRes.data ?? []) as InvoiceRow[])
    .slice()
    .sort((a, b) => (b.due_date ?? b.issue_date).localeCompare(a.due_date ?? a.issue_date));

  // What this child owes, right now. Computed from kg_child_balance rather than
  // the 36 invoices loaded above: a long-overdue invoice that has fallen off
  // the end of that list still has to count, because it is exactly the one
  // somebody needs to be told about. Finance roles only — an educator opening a
  // child's record must not be shown the family's money.
  const balance = ctx.isFinance
    ? Number(
        (await supabase.rpc("kg_child_balance", { p_child: id })).data ?? 0
      )
    : 0;

  // Which invoice that balance IS. `kg_child_balance` answers "how much" but
  // not "which", and the badge below needs the second answer to be worth
  // clicking. Oldest due first: with several open, the one the office chases is
  // the one that has been waiting longest.
  const openInvoices = invoices
    .filter(isOpenInvoice)
    .sort((a, b) => (a.due_date ?? a.issue_date).localeCompare(b.due_date ?? b.issue_date));
  const balanceHref = owedHref(id, openInvoices.map((i) => i.id));

  // What the upload dialog may file a paper under — the kind's live list,
  // which the RPC named — and one signed URL per file on the register.
  const [requirementsRes, dossierUrls] = dossier
    ? await Promise.all([
        supabase
          .from("kg_document_requirements")
          .select("*")
          .eq("tenant_id", ctx.tenant.id)
          .eq("kind", dossier.kind)
          .eq("active", true)
          .order("sort_order"),
        signedDossierUrls([
          ...dossier.lines.flatMap((line) =>
            line.document
              ? [{ path: line.document.file_path, file_name: line.document.file_name, mime_type: line.document.mime_type }]
              : []
          ),
          ...dossier.extra.map((extra) => ({ path: extra.file_path, file_name: extra.file_name })),
        ]),
      ])
    : [{ data: [] }, {}];
  const requirements = (requirementsRes.data ?? []) as DocumentRequirement[];

  const consents: ConsentState[] = (consentRows ?? [])
    .filter((c): c is { consent_type: ConsentType; granted: boolean | null; decided_at: string | null } =>
      (CONSENT_TYPES as readonly string[]).includes(c.consent_type)
    )
    .map((c) => ({
      consent_type: c.consent_type,
      granted: c.granted,
      decided_at: c.decided_at,
    }));

  const name = childDisplayName(child, locale);
  const secondaryName =
    locale === "ar"
      ? `${child.first_name} ${child.last_name}`
      : child.first_name_ar && child.last_name_ar
        ? `${child.first_name_ar} ${child.last_name_ar}`
        : null;
  const className =
    locale === "ar" && child.kg_classes?.name_ar
      ? child.kg_classes.name_ar
      : (child.kg_classes?.name ?? null);

  const monthFmt = new Intl.DateTimeFormat(intlLocale(locale), {
    month: "long", year: "numeric",
  });
  const prevMonth = shiftMonth(month, -1);
  const nextMonth = shiftMonth(month, 1);

  // The whole building's rooms and structures, on purpose unscoped: the
  // rail may be narrowed to the crèche, but the point of the move dialog is
  // the OTHER side, and the edit dialog's grouping is what tells the reader
  // which side a room is on. Age bands ride along so the move dialog can
  // propose a room. The transfers are this child's parcours (0140).
  const [{ data: allClasses }, { data: structureRows }, { data: transferRows }] =
    await Promise.all([
      supabase
        .from("kg_classes")
        .select("id, name, name_ar, color, structure_id, age_min_months, age_max_months")
        .eq("tenant_id", ctx.tenant.id)
        .order("name"),
      supabase
        .from("kg_structures")
        .select("id, name, name_ar, center_type, color, sort_order, active")
        .eq("tenant_id", ctx.tenant.id)
        .eq("active", true)
        .order("sort_order")
        .order("name"),
      supabase
        .from("kg_child_transfers")
        .select(
          "id, effective_date, reason, origin, moved_by, created_at, " +
            "from_structure:kg_structures!kg_child_transfers_from_structure_id_fkey(name, name_ar, color), " +
            "to_structure:kg_structures!kg_child_transfers_to_structure_id_fkey(name, name_ar, color), " +
            "from_class:kg_classes!kg_child_transfers_from_class_id_fkey(id, name, name_ar), " +
            "to_class:kg_classes!kg_child_transfers_to_class_id_fkey(id, name, name_ar)"
        )
        .eq("child_id", id)
        .eq("tenant_id", ctx.tenant.id)
        .order("effective_date", { ascending: false })
        .order("created_at", { ascending: false }),
    ]);
  const classOptions: ClassOption[] = (allClasses ?? []).map((c) => ({
    id: c.id,
    name: c.name,
    name_ar: c.name_ar,
    color: c.color,
    structure_id: c.structure_id ?? null,
    age_min_months: c.age_min_months ?? null,
    age_max_months: c.age_max_months ?? null,
  }));
  const structures = (structureRows ?? []) as Structure[];
  const multiStructure = structures.length > 1;
  const structure = structures.find((s) => s.id === child.structure_id) ?? null;

  // Who moved the child, by name. kg_profiles is readable across the tenant
  // (pr_sel), so one query resolves every row; an account since deleted
  // simply reads as nobody, which is the truth.
  const transferJoins = ((transferRows ?? []) as unknown as TransferJoinRow[]);
  const moverIds = [...new Set(transferJoins.map((r) => r.moved_by).filter((v): v is string => !!v))];
  const { data: moverRows } = moverIds.length > 0
    ? await supabase.from("kg_profiles").select("id, full_name").in("id", moverIds)
    : { data: [] as { id: string; full_name: string | null }[] };
  const moverName = new Map((moverRows ?? []).map((m) => [m.id, m.full_name]));
  const transfers: ChildTransferRow[] = transferJoins.map((r) => ({
    id: r.id,
    effective_date: r.effective_date,
    from_structure: r.from_structure,
    to_structure: r.to_structure,
    from_class: r.from_class,
    to_class: r.to_class,
    reason: r.reason,
    origin: r.origin === "parent_request" ? "parent_request" : "staff",
    movedBy: (r.moved_by && moverName.get(r.moved_by)) || null,
    created_at: r.created_at,
  }));

  const statusTone = CHILD_STATUS_TONE[child.status];

  // Who a card scanned from the top of this page may go to: the child first
  // (whose page it is, and the default), then every adult on the file. The
  // child's caption takes the structure's own noun, as the roster does.
  const scanSubjects: ScanSubject[] = ctx.isAdmin
    ? [
        {
          type: "child",
          id: child.id,
          name,
          photoUrl,
          initials: initials(child.first_name, child.last_name),
          caption:
            rosterNoun([structure?.center_type]) === "pupils"
              ? t("roster.pupils.column")
              : t("roster.columns.child"),
        },
        ...links.map((g) => ({
          type: "guardian" as const,
          id: g.guardian_id,
          name: childDisplayName(g, locale),
          photoUrl: g.photoUrl ?? null,
          initials: initials(g.first_name, g.last_name),
          caption: t(`guardians.relationships.${g.relationship}`),
        })),
      ]
    : [];

  return (
    <div>
      <Link
        href="/children"
        className="mb-3 inline-flex items-center gap-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground"
      >
        <ArrowLeft className="size-4 rtl:rotate-180" aria-hidden />
        {t("profile.back")}
      </Link>

      {/* One identity block. Every fact here appears once on the page: the
          age, the class, the structure, the code, and the two or three
          things that need a human — money owed, an allergy, a status that is
          not "enrolled". Everything else is a section below. */}
      <IdentityBand
        leading={
          <ChildPhotoControl
            tenantId={ctx.tenant.id}
            childId={child.id}
            name={name}
            firstName={child.first_name}
            lastName={child.last_name}
            photoPath={child.photo_path}
            photoUrl={photoUrl}
            avatarClassName="size-14 text-xl"
          />
        }
        title={name}
        subtitle={
          // The band's subtitle line resolves its direction from the
          // name's own script, which would push an Arabic name to the far
          // end under a French title. The block keeps the page's direction
          // and its start edge; only the name itself is isolated.
          secondaryName ? (
            <span className="block text-start" dir={locale === "ar" ? "rtl" : "ltr"}>
              <bdi dir="auto">{secondaryName}</bdi>
            </span>
          ) : undefined
        }
        facts={[
          <span key="age">{ageFromDob(child.dob, tc)}</span>,
          className ? (
            child.kg_classes ? (
              <Link key="class" href={`/classes/${child.kg_classes.id}`}>
                <ClassChip name={className} color={child.kg_classes.color} />
              </Link>
            ) : (
              <ClassChip key="class" name={className} />
            )
          ) : null,
          // Which side of the building, drawn as the switcher and /settings
          // draw it — the standalone tile. Only said when the building has
          // sides.
          multiStructure && structure ? (
            <StructureTile
              key="structure"
              structure={{
                name: structureName(structure, locale),
                color: structure.color,
                center_type: structure.center_type,
              }}
              className="text-foreground"
            />
          ) : null,
          // The code IS the badge card — the thing you go looking for when a
          // tag stops scanning at the door, or needs reprinting.
          child.tag_code ? (
            <Link
              key="code"
              href={`/children/${child.id}/card`}
              className="font-mono text-xs tracking-widest transition-colors hover:text-foreground"
              dir="ltr"
            >
              {child.tag_code}
            </Link>
          ) : null,
          statusTone ? (
            <StatusPill key="status" tone={statusTone}>
              {t(`status.${child.status}`)}
            </StatusPill>
          ) : null,
          // The answer to "where does it say unpaid" — the one money signal,
          // red, and a link to the invoice the office chases. Silence means
          // paid, as on the dashboard.
          balance > 0 ? (
            <Link key="owes" href={balanceHref}>
              <StatusPill tone="danger">
                {t("billing.owes", { amount: formatDZD(balance, locale) })}
              </StatusPill>
            </Link>
          ) : null,
          // Gold, not red: nobody is late — the establishment simply is not
          // charging them yet, and somebody has to decide. The pill IS the
          // fix: it opens the dialog that sets the plan.
          ctx.isFinance && child.status === "enrolled" && !hasMonthlyPlan ? (
            <AssignFeeDialog
              key="noPlan"
              childId={child.id}
              childName={name}
              plans={planOptions}
              trigger={
                <button type="button" title={t("billing.noPlanHint")} className="cursor-pointer">
                  <StatusPill tone="attention">{t("billing.noPlan")}</StatusPill>
                </button>
              }
            />
          ) : null,
          // Names a count, and answers "which ones?" on hover; still a link
          // for the tablet at the door.
          allergies.length > 0 ? (
            <AllergyBadge
              key="allergies"
              allergens={allergies}
              href={`/children/${child.id}?tab=health`}
            />
          ) : null,
        ]}
        actions={
          <>
            <EditChildDialog
              child={{
                id: child.id,
                first_name: child.first_name,
                last_name: child.last_name,
                first_name_ar: child.first_name_ar,
                last_name_ar: child.last_name_ar,
                dob: child.dob,
                gender: child.gender as Gender,
                class_id: child.class_id,
                structure_id: child.structure_id,
                tag_code: child.tag_code,
                blood_type: child.blood_type,
                notes: child.notes,
                enrollment_date: child.enrollment_date,
              }}
              classes={classOptions}
              structures={structures}
            />
            {/* A card for the child or for one of the adults, without
                scrolling to their row: admins only, like every card. */}
            {ctx.isAdmin && <ScanCardSheet subjects={scanSubjects} path={`/children/${child.id}`} />}
            {/* The verb for the crèche→école move (0140), the page's one
                primary. Admins only, and only where there is somewhere to
                move TO — a one-structure crèche changes class from the edit
                dialog as it always did. */}
            {ctx.isAdmin && multiStructure && (
              <MoveChildButton
                subjects={[{ id: child.id, name, structureId: child.structure_id ?? null }]}
                structures={structures}
                classes={classOptions}
                dob={child.dob}
                currentFees={currentFees}
                feePlans={movePlans}
              />
            )}
            <StatusActions childId={child.id} status={child.status} />
          </>
        }
      />

      {/* The sections of the record, as the settings tabs are drawn: a
          white card of icon + label links on ?tab=, so the back button and
          a shared URL land on the right section. Only the current section
          renders below. */}
      <ChildTabs ariaLabel={name} />

      <div>
        {/* ===== Profil ===== */}
        {tab === "profile" && (
        <div className="grid gap-4">
          {/* The family first: the phone number is the most-used fact on
              the page. Then who else may collect, what the child is signed
              up for, the record itself, and the parcours last — read at
              inspection, not daily. */}
          <GuardiansSection
            tenantId={ctx.tenant.id}
            childId={child.id}
            links={links}
            available={available}
            credentials={guardianCredentials}
            guardianCards={guardianCards}
            canManageCredentials={ctx.isAdmin}
            now={renderedAt}
          />
          <PickupsSection childId={child.id} pickups={pickups ?? []} />
          {/* On the record itself, as the phone has it — not behind a tab. The
              question "what is this child signed up for" is asked while the
              child is standing there. */}
          <ChildActivitiesSection
            childId={child.id}
            enrollments={childActivities}
            available={activityOptions}
            canManage={ctx.role !== "accountant"}
            chargeLocked={chargeLocked}
          />

          {/* Only what the identity band does not say, as a bill reads:
              label at the start, value at the end. */}
          <SectionCard icon={IdCard} tone={0} title={t("profile.info.title")} contentClassName="gap-0">
            <dl className="divide-y divide-border text-sm">
              {(
                [
                  ["dob", formatDate(child.dob, locale), false],
                  ["gender", t(`gender.${child.gender}`), false],
                  ["bloodType", child.blood_type, true],
                  [
                    "enrolledOn",
                    child.enrollment_date ? formatDate(child.enrollment_date, locale) : null,
                    false,
                  ],
                  [
                    "withdrawnOn",
                    child.withdrawal_date ? formatDate(child.withdrawal_date, locale) : null,
                    false,
                  ],
                ] as const
              ).map(([key, value, ltr]) =>
                key === "withdrawnOn" && !value ? null : (
                  <div key={key} className="flex items-baseline justify-between gap-4 py-2.5 first:pt-0 last:pb-0">
                    <dt className="text-muted-foreground">{t(`profile.info.${key}`)}</dt>
                    {/* "O+" must not read "+O" in Arabic: the sign stays after the letter. */}
                    <dd className="tabular-nums" dir={ltr ? "ltr" : undefined}>
                      {value ?? t("profile.info.none")}
                    </dd>
                  </div>
                )
              )}
              {child.notes && (
                <div className="grid gap-1 py-2.5 last:pb-0">
                  <dt className="text-muted-foreground">{t("profile.info.notes")}</dt>
                  <dd className="whitespace-pre-wrap text-start" dir="auto">
                    {child.notes}
                  </dd>
                </div>
              )}
              {/* A card issued to the CHILD (a wristband, a tag in the bag)
                  opens the door with no adult attached to it, which is why
                  the kiosk records those scans with nobody named. One line
                  of the record rather than a card of its own: until a card
                  exists the shared list's "nothing here" sentence is hidden
                  and only its add button shows, at the end of the row.
                  Admins only. */}
              {ctx.isAdmin && (
                <div
                  className={cn(
                    "py-2.5 last:pb-0",
                    childCards.length === 0
                      ? "flex items-center justify-between gap-4"
                      : "grid gap-2"
                  )}
                >
                  <dt className="text-muted-foreground">{tCred("title")}</dt>
                  <dd className={cn(childCards.length === 0 && "[&>div]:contents [&_p]:hidden")}>
                    <CredentialCards
                      subjectType="child"
                      subjectId={child.id}
                      cards={childCards}
                      path={`/children/${child.id}`}
                    />
                  </dd>
                </div>
              )}
            </dl>
          </SectionCard>

          {/* The parcours: every move between structures, as the register
              will read it. Shown wherever a move is possible or has happened. */}
          {(multiStructure || transfers.length > 0) && <TransferHistory rows={transfers} />}
        </div>
        )}

        {/* ===== Santé ===== */}
        {tab === "health" && (
          <HealthSection childId={child.id} health={health} allergies={allergies} />
        )}

        {/* ===== Présences ===== */}
        {tab === "attendance" && (
          <SectionCard
            icon={CalendarDays}
            tone={2}
            title={t("attendance.title")}
            hint={
              // The month's count, in one line the eye can scan.
              <span className="flex flex-wrap gap-x-3 gap-y-0.5">
                {(["present", "absent", "late", "sick"] as const).map((k) => (
                  <span key={k}>
                    <span className="font-semibold tabular-nums text-foreground">
                      {attendanceCounts[k] ?? 0}
                    </span>{" "}
                    {t(`attendance.summary.${k}`)}
                  </span>
                ))}
              </span>
            }
            action={
              <div className="flex items-center gap-1">
                <Button asChild variant="outline" size="icon" aria-label={t("attendance.prevMonth")}>
                  <Link href={`/children/${child.id}?tab=attendance&month=${prevMonth}`}>
                    <ArrowLeft className="rtl:rotate-180" />
                  </Link>
                </Button>
                <span className="min-w-32 text-center text-sm font-medium">
                  {monthFmt.format(new Date(`${month}-01T12:00:00`))}
                </span>
                <Button asChild variant="outline" size="icon" aria-label={t("attendance.nextMonth")}>
                  <Link href={`/children/${child.id}?tab=attendance&month=${nextMonth}`}>
                    <ArrowLeft className="rotate-180 rtl:rotate-0" />
                  </Link>
                </Button>
              </div>
            }
            contentClassName="p-0"
          >
            {attendance.length === 0 ? (
              <p className="px-4 pb-4 text-sm text-muted-foreground">{t("attendance.empty")}</p>
            ) : (
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow className="[&>th]:text-muted-foreground">
                      <TableHead className="ps-4">{t("attendance.columns.date")}</TableHead>
                      <TableHead>{t("attendance.columns.status")}</TableHead>
                      <TableHead>{t("attendance.columns.in")}</TableHead>
                      <TableHead>{t("attendance.columns.out")}</TableHead>
                      <TableHead className="pe-4">{t("attendance.columns.pickedUpBy")}</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {attendance.map((a) => (
                      <TableRow key={a.id}>
                        <TableCell className="ps-4 whitespace-nowrap">
                          {formatDate(a.date, locale, { weekday: "short" })}
                        </TableCell>
                        <TableCell>
                          <StatusPill tone={ATTENDANCE_TONE[a.status as AttendanceStatus]}>
                            {t(`attendance.statuses.${a.status}`)}
                          </StatusPill>
                        </TableCell>
                        <TableCell className="tabular-nums" dir="ltr">
                          {a.check_in_at ? formatTime(a.check_in_at, locale) : "—"}
                        </TableCell>
                        <TableCell className="tabular-nums" dir="ltr">
                          {a.check_out_at ? formatTime(a.check_out_at, locale) : "—"}
                        </TableCell>
                        <TableCell className="max-w-48 truncate pe-4 text-muted-foreground">
                          {a.picked_up_by ?? "—"}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
          </SectionCard>
        )}

        {/* ===== Facturation ===== */}
        {tab === "billing" && (
        <div className="grid gap-4">
          {!ctx.isFinance ? (
            <Card className="border border-border shadow-sm ring-0">
              <CardContent className="flex items-center gap-3">
                <Wallet className="size-5 text-muted-foreground" aria-hidden />
                <p className="text-sm text-muted-foreground">{t("billing.restricted")}</p>
              </CardContent>
            </Card>
          ) : (
            <>
              <SectionCard
                icon={Wallet}
                tone={1}
                title={t("billing.feesTitle")}
                hint={
                  // The card's one navigation link: text-primary with a
                  // chevron, beside the title, not a second button.
                  <Link
                    href="/billing"
                    className="inline-flex items-center gap-0.5 text-sm text-primary hover:text-primary/80"
                  >
                    {t("billing.goToBilling")}
                    <ChevronRight className="size-3.5 rtl:rotate-180" aria-hidden />
                  </Link>
                }
                action={
                  // Set it here, where the pill sends you.
                  planOptions.length > 0 ? (
                      <AssignFeeDialog
                        childId={child.id}
                        childName={name}
                        plans={planOptions}
                        current={
                          currentFee
                            ? {
                                planId: currentFee.fee_plan_id,
                                customAmount:
                                  currentFee.custom_amount !== null
                                    ? Number(currentFee.custom_amount)
                                    : null,
                                discountPct: Number(currentFee.discount_pct ?? 0),
                                discountNote: null,
                              }
                            : undefined
                        }
                      />
                  ) : undefined
                }
                contentClassName="p-0"
              >
                {fees.length === 0 ? (
                  <p className="px-4 pb-4 text-sm text-muted-foreground">{t("billing.feesEmpty")}</p>
                ) : (
                  <div className="overflow-x-auto">
                    <Table>
                      <TableHeader>
                        <TableRow className="[&>th]:text-muted-foreground">
                          <TableHead className="ps-4">{t("billing.columns.plan")}</TableHead>
                          <TableHead className="text-end">{t("billing.columns.amount")}</TableHead>
                          <TableHead>{t("billing.columns.period")}</TableHead>
                          <TableHead className="text-end">{t("billing.columns.discount")}</TableHead>
                          <TableHead>{t("billing.columns.start")}</TableHead>
                          <TableHead className="pe-4">{t("billing.columns.end")}</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {fees.map((f) => {
                          const plan = f.kg_fee_plans!;
                          const planName =
                            locale === "ar" && plan.name_ar ? plan.name_ar : plan.name;
                          return (
                            <TableRow key={f.id}>
                              <TableCell className="ps-4 font-medium">{planName}</TableCell>
                              <TableCell className="text-end tabular-nums">
                                {formatDZD(f.custom_amount ?? plan.amount, locale)}
                              </TableCell>
                              <TableCell className="text-muted-foreground">{tb(`periods.${plan.period}`)}</TableCell>
                              <TableCell className="text-end tabular-nums text-muted-foreground">
                                {f.discount_pct > 0 ? `−${f.discount_pct}%` : "—"}
                              </TableCell>
                              <TableCell className="text-muted-foreground">{formatDate(f.start_date, locale)}</TableCell>
                              <TableCell className="pe-4 text-muted-foreground">
                                {f.end_date ? formatDate(f.end_date, locale) : "—"}
                              </TableCell>
                            </TableRow>
                          );
                        })}
                      </TableBody>
                    </Table>
                  </div>
                )}
              </SectionCard>

              <SectionCard icon={Receipt} tone={0} title={t("billing.invoicesTitle")} contentClassName="p-0">
                {invoices.length === 0 ? (
                  <p className="px-4 pb-4 text-sm text-muted-foreground">{t("billing.invoicesEmpty")}</p>
                ) : (
                  <div className="overflow-x-auto">
                    <Table>
                      <TableHeader>
                        <TableRow className="[&>th]:text-muted-foreground">
                          <TableHead className="ps-4">{t("billing.columns.number")}</TableHead>
                          <TableHead>{t("billing.columns.month")}</TableHead>
                          <TableHead>{t("billing.columns.issued")}</TableHead>
                          <TableHead>{t("billing.columns.due")}</TableHead>
                          <TableHead>{t("billing.columns.status")}</TableHead>
                          <TableHead className="text-end">{t("billing.columns.total")}</TableHead>
                          <TableHead className="pe-4 text-end">{t("billing.columns.paid")}</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {invoices.map((inv) => (
                          <TableRow key={inv.id}>
                            <TableCell className="ps-4 font-mono" dir="ltr">
                              <InvoiceLink id={inv.id}>#{inv.number}</InvoiceLink>
                            </TableCell>
                            <TableCell>
                              {inv.period_month
                                ? monthFmt.format(new Date(`${inv.period_month.slice(0, 7)}-01T12:00:00`))
                                : "—"}
                            </TableCell>
                            <TableCell className="text-muted-foreground">{formatDate(inv.issue_date, locale)}</TableCell>
                            <TableCell className="text-muted-foreground">
                              {inv.due_date ? formatDate(inv.due_date, locale) : "—"}
                            </TableCell>
                            <TableCell>
                              <StatusPill tone={INVOICE_TONE[inv.status]}>
                                {tb(`status.${inv.status}`)}
                              </StatusPill>
                            </TableCell>
                            <TableCell className="text-end font-medium tabular-nums">
                              {formatDZD(inv.total, locale)}
                            </TableCell>
                            <TableCell
                              className={cn(
                                "pe-4 text-end tabular-nums",
                                inv.paid_amount > 0 ? "text-foreground" : "text-muted-foreground"
                              )}
                            >
                              {formatDZD(inv.paid_amount, locale)}
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                )}
              </SectionCard>
            </>
          )}
        </div>
        )}

        {/* ===== Dossier ===== */}
        {tab === "documents" && dossier && (
          <DossierSection
            subject={{ childId: child.id }}
            dossier={dossier}
            requirements={requirements}
            urls={dossierUrls}
            canDelete={ctx.isAdmin}
            // cd_ins and cd_upd are educator-gated: every staff role but the accountant.
            canReview={ctx.role !== "accountant"}
          />
        )}

        {/* ===== Consentements ===== */}
        {tab === "consents" && <ConsentsSection childId={child.id} consents={consents} />}
      </div>
    </div>
  );
}
