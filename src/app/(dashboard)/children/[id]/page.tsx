import Link from "next/link";
import {
  ArrowLeft,
  ArrowRight,
  BanknoteX,
  CalendarDays,
  CheckCircle2,
  IdCard,
  Receipt,
  TriangleAlert,
  UserX,
  Wallet,
} from "lucide-react";
import { getLocale, getTranslations } from "next-intl/server";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { EmptyState } from "@/components/shared/empty-state";
import { ClassLink, InvoiceLink } from "@/components/shared/entity-link";
import { PageHeader } from "@/components/shared/page-header";
import { createClient } from "@/lib/supabase/server";
import { requireStaff, signedMediaUrl } from "@/lib/tenant";
import { ageFromDob, childDisplayName, formatDZD, formatDate, formatTime, intlLocale } from "@/lib/format";
import { cn } from "@/lib/utils";
import type {
  AllergySeverity, Attendance, AttendanceStatus, Child, FeePeriod, Gender, InvoiceStatus,
} from "@/lib/types";
import { ChildPhotoControl } from "@/components/modules/children/photo-controls";
import { ConsentsSection } from "@/components/modules/children/consents-section";
import { DocumentsSection } from "@/components/modules/children/documents-section";
import { EditChildDialog } from "@/components/modules/children/edit-child-dialog";
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
import type { CredentialRow } from "@/components/modules/credentials/types";
import { parseHealthList } from "@/components/modules/portal/health-edit-shared";
import { algiersToday } from "@/components/modules/billing/dates";
import { AssignFeeDialog } from "@/components/modules/billing/assign-fee-dialog";
import { isOpenInvoice, owedHref } from "@/components/modules/billing/owed-link";
import type { PlanOption } from "@/components/modules/billing/billing-types";
import {
  attendanceStatusClasses,
  childStatusClasses,
  CONSENT_TYPES,
  invoiceStatusClasses,
  severityClasses,
  type AllergyRow,
  type ChildDocumentRow,
  type ChildHealthRow,
  type ConsentState,
  type ConsentType,
  type GuardianLink,
  type GuardianOption,
} from "@/components/modules/children/types";

const TABS = ["profile", "health", "attendance", "billing", "documents", "consents"] as const;
type TabKey = (typeof TABS)[number];

/** Tinted tiles for the monthly attendance summary — token colours only. */
const SUMMARY_TONE: Record<
  "present" | "absent" | "late" | "sick",
  { tile: string; value: string; label: string }
> = {
  present: {
    tile: "border-success/30 bg-success/10",
    value: "text-success",
    label: "text-muted-foreground",
  },
  absent: {
    tile: "border-destructive/30 bg-destructive/10",
    value: "text-destructive",
    label: "text-muted-foreground",
  },
  // Solid gold reads in both themes; gold text on a gold tint does not.
  late: {
    tile: "border-gold bg-gold",
    value: "text-gold-foreground",
    label: "text-gold-foreground/75",
  },
  sick: {
    tile: "border-chart-4/30 bg-chart-4/10",
    value: "text-chart-4",
    label: "text-muted-foreground",
  },
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
  kg_fee_plans: { name: string; name_ar: string | null; amount: number; period: FeePeriod } | null;
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
  const locale = await getLocale();
  const supabase = await createClient();

  const tab: TabKey = (TABS as readonly string[]).includes(sp.tab ?? "")
    ? (sp.tab as TabKey)
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
    { data: documentRows },
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
          .select("id, name, name_ar, amount, period, active")
          .eq("tenant_id", ctx.tenant.id)
          .eq("active", true)
          .eq("period", "monthly")
          .order("amount")
      : Promise.resolve({ data: [] }),
    ctx.isFinance
      ? supabase
          .from("kg_child_fees")
          .select(
            "id, fee_plan_id, custom_amount, discount_pct, start_date, end_date, kg_fee_plans(name, name_ar, amount, period)"
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
    supabase
      .from("kg_child_documents")
      .select("id, doc_type, title, file_path, created_at")
      .eq("child_id", id)
      .eq("tenant_id", ctx.tenant.id)
      .order("created_at", { ascending: false }),
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
  const invoices = (invoicesRes.data ?? []) as InvoiceRow[];

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

  const documents: ChildDocumentRow[] = await Promise.all(
    (documentRows ?? []).map(async (d) => ({
      id: d.id,
      doc_type: d.doc_type,
      title: d.title,
      created_at: d.created_at,
      url: await signedMediaUrl(d.file_path),
    }))
  );

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

  const BackIcon = locale === "ar" ? ArrowRight : ArrowLeft;
  const monthFmt = new Intl.DateTimeFormat(intlLocale(locale), {
    month: "long", year: "numeric",
  });
  const prevMonth = shiftMonth(month, -1);
  const nextMonth = shiftMonth(month, 1);

  const classes = child.kg_classes
    ? [{ id: child.kg_classes.id, name: child.kg_classes.name, name_ar: child.kg_classes.name_ar, color: child.kg_classes.color }]
    : [];
  // EditChildDialog needs the full class list to reassign classes.
  const { data: allClasses } = await supabase
    .from("kg_classes")
    .select("id, name, name_ar, color")
    .eq("tenant_id", ctx.tenant.id)
    .order("name");
  const classOptions = allClasses ?? classes;

  return (
    <div>
      <PageHeader title={name} description={ageFromDob(child.dob, locale)}>
        <Button asChild variant="ghost">
          <Link href="/children">
            <BackIcon data-icon="inline-start" />
            {t("profile.back")}
          </Link>
        </Button>
        <Button asChild variant="outline">
          <Link href={`/children/${child.id}/card`}>
            <IdCard data-icon="inline-start" />
            {t("profile.badgeCard")}
          </Link>
        </Button>
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
            tag_code: child.tag_code,
            blood_type: child.blood_type,
            notes: child.notes,
            enrollment_date: child.enrollment_date,
          }}
          classes={classOptions}
        />
        <StatusActions childId={child.id} status={child.status} />
      </PageHeader>

      <Card className="mb-6 bg-gradient-to-br from-primary/5 via-card to-gold/5 shadow-sm">
        <CardContent className="flex flex-wrap items-center gap-5">
          <ChildPhotoControl
            tenantId={ctx.tenant.id}
            childId={child.id}
            name={name}
            firstName={child.first_name}
            lastName={child.last_name}
            photoPath={child.photo_path}
            photoUrl={photoUrl}
            avatarClassName="size-20 text-2xl ring-2 ring-primary/20"
          />
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-xl font-bold tracking-tight">{name}</span>
              {secondaryName && (
                <span className="text-base text-muted-foreground" dir="auto">
                  {secondaryName}
                </span>
              )}
              <Badge className={childStatusClasses(child.status)}>
                {t(`status.${child.status}`)}
              </Badge>
              {/* The answer to "where does it say unpaid". This record showed
                  nothing about money at all, so an approved child with an
                  outstanding invoice looked identical to one paid up. */}
              {balance > 0 && (
                <Badge asChild variant="destructive">
                  <Link href={balanceHref}>
                    <BanknoteX className="size-3.5" aria-hidden />
                    {t("billing.owes", { amount: formatDZD(balance, locale) })}
                  </Link>
                </Badge>
              )}
              {/* Says it where the child is actually looked at, not only on
                  the billing screen. Gold, not red: nobody is late — the
                  crèche simply is not charging them yet, and somebody has to
                  decide. */}
              {ctx.isFinance && child.status === "enrolled" && !hasMonthlyPlan && (
                // The badge IS the fix. It used to link to the billing tab and
                // leave somebody to find the button there; the moment a person
                // notices the problem is the moment to let them solve it.
                <AssignFeeDialog
                  childId={child.id}
                  childName={name}
                  plans={planOptions}
                  trigger={
                    <Badge
                      asChild
                      className="cursor-pointer border-gold/40 bg-gold-muted text-gold-ink hover:bg-gold-muted/70"
                    >
                      <button type="button" title={t("billing.noPlanHint")}>
                        <TriangleAlert className="size-3.5" aria-hidden />
                        {t("billing.noPlan")}
                      </button>
                    </Badge>
                  }
                />
              )}
              {ctx.isFinance && balance === 0 && invoices.length > 0 && (
                <Badge variant="secondary" className="gap-1.5">
                  <CheckCircle2 className="size-3.5 text-success" aria-hidden />
                  {t("billing.settled")}
                </Badge>
              )}
              {/* The badge names a count; the answer to "which three?" is one tab
                  away, and reading it was the reason anybody looked. */}
              {allergies.length > 0 && (
                <Badge
                  asChild
                  variant="tinted"
                  className={severityClasses(
                    allergies.reduce<AllergySeverity>(
                      (worst, a) =>
                        ["mild", "moderate", "severe"].indexOf(a.severity) >
                        ["mild", "moderate", "severe"].indexOf(worst)
                          ? a.severity
                          : worst,
                      "mild"
                    )
                  )}
                >
                  <Link href={`/children/${child.id}?tab=health`}>
                    {t("allergyBadge", { count: allergies.length })}
                  </Link>
                </Badge>
              )}
            </div>
            <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1.5 text-sm text-muted-foreground">
              <span>{t(`gender.${child.gender}`)}</span>
              <span className="tabular-nums">{formatDate(child.dob, locale)}</span>
              {className && (
                <span className="inline-flex items-center gap-1.5 rounded-full bg-card/70 px-2.5 py-0.5 ring-1 ring-inset ring-border">
                  {/* per-class colour comes from kg_classes.color (user data) */}
                  <span
                    className="size-2 rounded-full ring-1 ring-inset ring-foreground/10"
                    style={{ backgroundColor: child.kg_classes?.color ?? "var(--primary)" }}
                    aria-hidden
                  />
                  {child.kg_classes ? (
                    <ClassLink id={child.kg_classes.id}>{className}</ClassLink>
                  ) : (
                    className
                  )}
                </span>
              )}
              {/* The code IS the badge card — the thing you go looking for when
                  a tag stops scanning at the door, or needs reprinting. */}
              {child.tag_code && (
                <Link
                  href={`/children/${child.id}/card`}
                  className="rounded-md bg-muted px-2 py-0.5 font-mono text-xs tracking-widest transition-colors hover:bg-muted/70 hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none"
                  dir="ltr"
                >
                  {child.tag_code}
                </Link>
              )}
            </div>
          </div>
        </CardContent>
      </Card>

      <Tabs defaultValue={tab}>
        <TabsList className="max-w-full flex-wrap sm:flex-nowrap sm:overflow-x-auto no-scrollbar">
          {TABS.map((key) => (
            <TabsTrigger key={key} value={key}>
              {t(`profile.tabs.${key}`)}
            </TabsTrigger>
          ))}
        </TabsList>

        {/* ===== Profil ===== */}
        <TabsContent value="profile" className="mt-4 grid gap-4">
          <Card className="shadow-sm">
            <CardHeader>
              <CardTitle className="flex items-center gap-2.5 text-base">
                <span className="flex size-8 items-center justify-center rounded-lg bg-primary/10 text-primary">
                  <IdCard className="size-4" />
                </span>
                {t("profile.info.title")}
              </CardTitle>
            </CardHeader>
            <CardContent>
              <dl className="grid gap-x-6 gap-y-3 sm:grid-cols-2 lg:grid-cols-3">
                {(
                  [
                    ["dob", formatDate(child.dob, locale)],
                    ["age", ageFromDob(child.dob, locale)],
                    ["gender", t(`gender.${child.gender}`)],
                    ["bloodType", child.blood_type],
                    [
                      "enrolledOn",
                      child.enrollment_date ? formatDate(child.enrollment_date, locale) : null,
                    ],
                    [
                      "withdrawnOn",
                      child.withdrawal_date ? formatDate(child.withdrawal_date, locale) : null,
                    ],
                    ["tagCode", child.tag_code],
                  ] as const
                ).map(([key, value]) =>
                  key === "withdrawnOn" && !value ? null : (
                    <div key={key} className="rounded-lg bg-muted/40 px-3 py-2">
                      <dt className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                        {t(`profile.info.${key}`)}
                      </dt>
                      <dd
                        className={
                          key === "tagCode"
                            ? "mt-0.5 font-mono text-sm font-semibold tracking-wider"
                            : "mt-0.5 text-sm font-medium"
                        }
                      >
                        {value ?? t("profile.info.none")}
                      </dd>
                    </div>
                  )
                )}
                {child.notes && (
                  <div className="rounded-lg bg-muted/40 px-3 py-2 sm:col-span-2 lg:col-span-3">
                    <dt className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                      {t("profile.info.notes")}
                    </dt>
                    <dd className="mt-0.5 whitespace-pre-wrap text-sm">{child.notes}</dd>
                  </div>
                )}
              </dl>
            </CardContent>
          </Card>

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

          {/* A card issued to the CHILD (a wristband, a tag in the bag) opens
              the door with no adult attached to it, which is why the kiosk
              records those scans with nobody named. Admins only. */}
          {ctx.isAdmin && (
            <Card className="mt-4 border border-border shadow-sm ring-0">
              <CardHeader>
                <CardTitle className="text-base font-semibold">{tCred("title")}</CardTitle>
              </CardHeader>
              <CardContent>
                <CredentialCards
                  subjectType="child"
                  subjectId={child.id}
                  cards={childCards}
                  path={`/children/${child.id}`}
                />
              </CardContent>
            </Card>
          )}
        </TabsContent>

        {/* ===== Santé ===== */}
        <TabsContent value="health" className="mt-4">
          <HealthSection childId={child.id} health={health} allergies={allergies} />
        </TabsContent>

        {/* ===== Présences ===== */}
        <TabsContent value="attendance" className="mt-4">
          <Card className="shadow-sm">
            <CardHeader className="flex flex-wrap items-center justify-between gap-2">
              <CardTitle className="flex items-center gap-2.5 text-base">
                <span className="flex size-8 items-center justify-center rounded-lg bg-primary/10 text-primary">
                  <CalendarDays className="size-4" />
                </span>
                {t("attendance.title")}
              </CardTitle>
              <div className="flex items-center gap-1">
                <Button asChild variant="outline" size="icon" aria-label={t("attendance.prevMonth")}>
                  <Link href={`/children/${child.id}?tab=attendance&month=${prevMonth}`}>
                    <BackIcon />
                  </Link>
                </Button>
                <span className="min-w-32 text-center text-sm font-medium">
                  {monthFmt.format(new Date(`${month}-01T12:00:00`))}
                </span>
                <Button asChild variant="outline" size="icon" aria-label={t("attendance.nextMonth")}>
                  <Link href={`/children/${child.id}?tab=attendance&month=${nextMonth}`}>
                    <BackIcon className="rotate-180" />
                  </Link>
                </Button>
              </div>
            </CardHeader>
            <CardContent className="p-0">
              <div className="grid grid-cols-2 gap-2 px-6 pb-4 sm:grid-cols-4">
                {(["present", "absent", "late", "sick"] as const).map((k) => (
                  <div key={k} className={cn("rounded-xl border px-3 py-2", SUMMARY_TONE[k].tile)}>
                    <div
                      className={cn("text-2xl font-bold tabular-nums", SUMMARY_TONE[k].value)}
                    >
                      {attendanceCounts[k] ?? 0}
                    </div>
                    <div className={cn("truncate text-xs font-medium", SUMMARY_TONE[k].label)}>
                      {t(`attendance.summary.${k}`)}
                    </div>
                  </div>
                ))}
              </div>
              {attendance.length === 0 ? (
                <p className="px-6 pb-6 text-center text-sm text-muted-foreground">
                  {t("attendance.empty")}
                </p>
              ) : (
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow className="[&>th]:font-semibold">
                        <TableHead>{t("attendance.columns.date")}</TableHead>
                        <TableHead>{t("attendance.columns.status")}</TableHead>
                        <TableHead>{t("attendance.columns.in")}</TableHead>
                        <TableHead>{t("attendance.columns.out")}</TableHead>
                        <TableHead>{t("attendance.columns.pickedUpBy")}</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {attendance.map((a) => (
                        <TableRow key={a.id}>
                          <TableCell className="whitespace-nowrap">
                            {formatDate(a.date, locale, { weekday: "short" })}
                          </TableCell>
                          <TableCell>
                            <Badge className={attendanceStatusClasses(a.status as AttendanceStatus)}>
                              {t(`attendance.statuses.${a.status}`)}
                            </Badge>
                          </TableCell>
                          <TableCell className="tabular-nums">
                            {a.check_in_at ? formatTime(a.check_in_at, locale) : "—"}
                          </TableCell>
                          <TableCell className="tabular-nums">
                            {a.check_out_at ? formatTime(a.check_out_at, locale) : "—"}
                          </TableCell>
                          <TableCell className="max-w-48 truncate text-muted-foreground">
                            {a.picked_up_by ?? "—"}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* ===== Facturation ===== */}
        <TabsContent value="billing" className="mt-4 grid gap-4">
          {!ctx.isFinance ? (
            <Card className="shadow-sm">
              <CardContent className="flex flex-col items-center gap-3 py-10 text-center">
                <span className="flex size-12 items-center justify-center rounded-2xl bg-muted text-muted-foreground">
                  <Wallet className="size-6" />
                </span>
                <p className="text-sm text-muted-foreground">{t("billing.restricted")}</p>
              </CardContent>
            </Card>
          ) : (
            <>
              <Card className="shadow-sm">
                <CardHeader className="flex flex-wrap items-center justify-between gap-2">
                  <CardTitle className="flex items-center gap-2.5 text-base">
                    <span className="flex size-8 items-center justify-center rounded-lg bg-gold text-gold-foreground">
                      <Wallet className="size-4" />
                    </span>
                    {t("billing.feesTitle")}
                  </CardTitle>
                  <div className="flex flex-wrap items-center gap-2">
                    {/* Set it here, where the badge sends you. */}
                    {planOptions.length > 0 && (
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
                    )}
                    <Button asChild variant="outline" size="sm">
                      <Link href="/billing">{t("billing.goToBilling")}</Link>
                    </Button>
                  </div>
                </CardHeader>
                <CardContent className="p-0">
                  {fees.length === 0 ? (
                    <p className="px-6 pb-6 text-center text-sm text-muted-foreground">
                      {t("billing.feesEmpty")}
                    </p>
                  ) : (
                    <div className="overflow-x-auto">
                      <Table>
                        <TableHeader>
                          <TableRow className="[&>th]:font-semibold">
                            <TableHead>{t("billing.columns.plan")}</TableHead>
                            <TableHead className="text-end">{t("billing.columns.amount")}</TableHead>
                            <TableHead>{t("billing.columns.period")}</TableHead>
                            <TableHead className="text-end">
                              {t("billing.columns.discount")}
                            </TableHead>
                            <TableHead>{t("billing.columns.start")}</TableHead>
                            <TableHead>{t("billing.columns.end")}</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {fees.map((f) => {
                            const plan = f.kg_fee_plans!;
                            const planName =
                              locale === "ar" && plan.name_ar ? plan.name_ar : plan.name;
                            return (
                              <TableRow key={f.id}>
                                <TableCell className="font-medium">{planName}</TableCell>
                                <TableCell className="text-end font-semibold tabular-nums">
                                  {formatDZD(f.custom_amount ?? plan.amount, locale)}
                                </TableCell>
                                <TableCell>{tb(`periods.${plan.period}`)}</TableCell>
                                <TableCell className="text-end tabular-nums">
                                  {f.discount_pct > 0 ? (
                                    <span className="rounded-full bg-success/15 px-2 py-0.5 text-xs font-medium text-success">
                                      −{f.discount_pct}%
                                    </span>
                                  ) : (
                                    <span className="text-muted-foreground">—</span>
                                  )}
                                </TableCell>
                                <TableCell>{formatDate(f.start_date, locale)}</TableCell>
                                <TableCell>
                                  {f.end_date ? formatDate(f.end_date, locale) : "—"}
                                </TableCell>
                              </TableRow>
                            );
                          })}
                        </TableBody>
                      </Table>
                    </div>
                  )}
                </CardContent>
              </Card>

              <Card className="shadow-sm">
                <CardHeader>
                  <CardTitle className="flex items-center gap-2.5 text-base">
                    <span className="flex size-8 items-center justify-center rounded-lg bg-primary/10 text-primary">
                      <Receipt className="size-4" />
                    </span>
                    {t("billing.invoicesTitle")}
                  </CardTitle>
                </CardHeader>
                <CardContent className="p-0">
                  {invoices.length === 0 ? (
                    <p className="px-6 pb-6 text-center text-sm text-muted-foreground">
                      {t("billing.invoicesEmpty")}
                    </p>
                  ) : (
                    <div className="overflow-x-auto">
                      <Table>
                        <TableHeader>
                          <TableRow className="[&>th]:font-semibold">
                            <TableHead>{t("billing.columns.number")}</TableHead>
                            <TableHead>{t("billing.columns.month")}</TableHead>
                            <TableHead>{t("billing.columns.issued")}</TableHead>
                            <TableHead>{t("billing.columns.due")}</TableHead>
                            <TableHead>{t("billing.columns.status")}</TableHead>
                            <TableHead className="text-end">{t("billing.columns.total")}</TableHead>
                            <TableHead className="text-end">{t("billing.columns.paid")}</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {invoices.map((inv) => (
                            <TableRow key={inv.id}>
                              <TableCell className="font-mono" dir="ltr">
                                <InvoiceLink id={inv.id}>#{inv.number}</InvoiceLink>
                              </TableCell>
                              <TableCell>
                                {inv.period_month
                                  ? monthFmt.format(new Date(`${inv.period_month.slice(0, 7)}-01T12:00:00`))
                                  : "—"}
                              </TableCell>
                              <TableCell>{formatDate(inv.issue_date, locale)}</TableCell>
                              <TableCell>
                                {inv.due_date ? formatDate(inv.due_date, locale) : "—"}
                              </TableCell>
                              <TableCell>
                                <Badge className={invoiceStatusClasses(inv.status)}>
                                  {tb(`status.${inv.status}`)}
                                </Badge>
                              </TableCell>
                              <TableCell className="text-end font-semibold tabular-nums">
                                {formatDZD(inv.total, locale)}
                              </TableCell>
                              <TableCell
                                className={cn(
                                  "text-end tabular-nums",
                                  inv.paid_amount > 0 ? "font-medium text-income" : "text-muted-foreground"
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
                </CardContent>
              </Card>
            </>
          )}
        </TabsContent>

        {/* ===== Documents ===== */}
        <TabsContent value="documents" className="mt-4">
          <DocumentsSection childId={child.id} documents={documents} />
        </TabsContent>

        {/* ===== Consentements ===== */}
        <TabsContent value="consents" className="mt-4">
          <ConsentsSection childId={child.id} consents={consents} />
        </TabsContent>
      </Tabs>
    </div>
  );
}
