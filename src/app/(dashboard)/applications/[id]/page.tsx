// One application, for one question: can this child come in, and what
// happens if they do. Identity band, then sections — each only when it has
// something to say.

import Link from "next/link";
import { getLocale, getTranslations } from "next-intl/server";
import {
  ArrowLeft,
  Baby,
  Ban,
  ChevronRight,
  FileQuestion,
  HeartPulse,
  Palette,
  Users,
} from "lucide-react";
import { requireStaff, signedMediaUrl } from "@/lib/tenant";
import { createClient } from "@/lib/supabase/server";
import { loadDossier, signedDossierUrls } from "@/lib/dossier-server";
import { PRINTABLE_KEYS, type DocumentRequirement } from "@/lib/dossier";
import {
  ageFromDob,
  childDisplayName,
  formatDZD,
  formatDate,
  formatPhone,
  formatTime,
  initials,
  telHref,
} from "@/lib/format";
import type { Activity, Guardian, KgClass } from "@/lib/types";
import { CategoryIcon } from "@/components/modules/classes/category-icon";
import { normalizeAlgerianPhone } from "@/lib/auth-identifier";
import { EmptyState } from "@/components/shared/empty-state";
import { ActivityLink } from "@/components/shared/entity-link";
import { IdentityBand } from "@/components/shared/identity-band";
import { SectionCard } from "@/components/shared/section-card";
import { ClassChip } from "@/components/shared/class-chip";
import { StatusPill } from "@/components/shared/status-pill";
import { StructureMark } from "@/components/shared/structure-mark";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import {
  ReviewActions,
  type AdmissionFee,
  type ClassOption,
  type FeePlanOption,
} from "@/components/modules/enroll/review-actions";
import {
  ApplicationStructureContext,
  SIBLING_SOURCE,
  loadTransferSummary,
  structureRefName,
} from "@/components/modules/enroll/application-card";
import {
  STATUS_TONE,
  isTransferApplication,
  type ReviewApplication,
} from "@/components/modules/enroll/review-types";
import { DossierSection } from "@/components/modules/enroll/dossier-section";
import { allergenLabel } from "@/lib/allergens";

/** Label at the start, value at the end — the bill anatomy, two weights, no icon. */
function FactRow({
  label,
  value,
  ltr,
}: {
  label: string;
  value: React.ReactNode;
  ltr?: boolean;
}) {
  if (!value) return null;
  return (
    <div className="flex items-baseline justify-between gap-4 py-2 text-sm">
      <span className="text-muted-foreground">{label}</span>
      <span className="min-w-0 text-end font-medium" dir={ltr ? "ltr" : undefined}>
        {value}
      </span>
    </div>
  );
}

/** A child already enrolled under the applicant's guardian record. */
interface FamilyChild {
  id: string;
  first_name: string;
  last_name: string;
  first_name_ar: string | null;
  last_name_ar: string | null;
  class_id: string | null;
}

/** What the reviewer needs to judge a sibling application: the family it says
 *  it belongs to. `guardian: null` is the meaningful case — approving would
 *  then create a NEW family instead of extending one. */
interface FamilyContext {
  guardian: Guardian | null;
  children: FamilyChild[];
  failed: boolean;
}

export default async function ApplicationDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const ctx = await requireStaff();
  const t = await getTranslations("enroll");
  const tc = await getTranslations("common");
  const tAge = await getTranslations("common.labels");
  const locale = await getLocale();
  const supabase = await createClient();

  // The requested structure, class and tariff travel with the row so the
  // band can name them and the approve dialog can open on the right group.
  const { data } = await supabase
    .from("kg_applications")
    .select(
      "*, kg_structures(id, name, name_ar, color, center_type), kg_classes(id, name, name_ar, structure_id, color), kg_fee_plans(name, name_ar, amount)"
    )
    .eq("id", id)
    .eq("tenant_id", ctx.tenant.id)
    .maybeSingle();

  if (!data) {
    return (
      <EmptyState
        icon={<FileQuestion />}
        title={t("detail.notFound")}
        description={t("detail.notFoundDesc")}
        action={
          <Button asChild variant="outline">
            <Link href="/applications">{t("admin.title")}</Link>
          </Button>
        }
      />
    );
  }

  const app = data as unknown as ReviewApplication;
  const isSibling = app.source === SIBLING_SOURCE;
  const isTransfer = isTransferApplication(app);
  const child = app.child;
  const guardians = Array.isArray(app.guardians) ? app.guardians : [];
  const health = app.health ?? {};
  const allergies = Array.isArray(health.allergies) ? health.allergies : [];
  const conditions = Array.isArray(health.medical_conditions) ? health.medical_conditions : [];
  const medications = Array.isArray(health.medications) ? health.medications : [];
  const activityIds = Array.isArray(app.activity_ids) ? app.activity_ids : [];

  // Parallel: photo signed URL (may fail RLS for staff on u/ paths → fallback avatar),
  // classes with enrolled counts, requested activities, the enrolment file.
  const [photoUrl, classesRes, childrenRes, feePlansRes, admissionRes, activitiesRes, dossier] =
    await Promise.all([
      signedMediaUrl(child.photo_path),
      supabase.from("kg_classes").select("*").eq("tenant_id", ctx.tenant.id).order("name"),
      supabase
        .from("kg_children")
        .select("class_id")
        .eq("tenant_id", ctx.tenant.id)
        .eq("status", "enrolled"),
      // Fee plans, so approval can start billing in the same transaction. Only a
      // finance role may read kg_fee_plans, and only they should be choosing a
      // tariff — an educator reviewing an application gets an empty list and the
      // billing block simply does not render.
      ctx.isFinance
        ? supabase
            .from("kg_fee_plans")
            .select("id, name, name_ar, amount, structure_id")
            .eq("tenant_id", ctx.tenant.id)
            .eq("active", true)
            .eq("period", "monthly")
            .order("amount")
        : Promise.resolve({ data: [] }),
      // Admission fees (period 'once') are applied automatically; fetched only to
      // show the reviewer what the family will be charged.
      ctx.isFinance
        ? supabase.rpc("kg_admission_fees", { p_tenant: ctx.tenant.id })
        : Promise.resolve({ data: [] }),
      activityIds.length > 0
        ? supabase
            .from("kg_activities")
            .select("*")
            .eq("tenant_id", ctx.tenant.id)
            .in("id", activityIds)
        : Promise.resolve({ data: [] as Activity[] }),
      // The papers, as kg_dossier_status scores them for the file's kind
      // (0164). Staff-only for an application — the family reads its own
      // through kg_my_application.
      loadDossier(supabase, { applicationId: id }),
    ]);

  // What the upload dialog may file the paper under — the kind's live list,
  // which the RPC named — and one signed URL per file and blank form.
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
  // The printable sheets stand in for two seeded papers; a link appears only
  // while the kind's live list asks for that paper.
  const printable = {
    fiche: dossier?.lines.some((line) => line.active && line.key === PRINTABLE_KEYS.fiche) ?? false,
    demande: dossier?.lines.some((line) => line.active && line.key === PRINTABLE_KEYS.demande) ?? false,
  };

  const enrolledByClass = new Map<string, number>();
  for (const row of (childrenRes.data ?? []) as { class_id: string | null }[]) {
    if (row.class_id) {
      enrolledByClass.set(row.class_id, (enrolledByClass.get(row.class_id) ?? 0) + 1);
    }
  }
  const classes: ClassOption[] = ((classesRes.data ?? []) as KgClass[]).map((c) => ({
    id: c.id,
    name: c.name,
    name_ar: c.name_ar,
    structure_id: c.structure_id,
    capacity: c.capacity,
    enrolled: enrolledByClass.get(c.id) ?? 0,
    // The bands travel with the option: the dialog proposes the room from the
    // child's age, and a class the director adds next term joins that
    // calculation on its next render with nothing to backfill.
    age_min_months: c.age_min_months,
    age_max_months: c.age_max_months,
  }));

  const classById = new Map(classes.map((c) => [c.id, c] as const));

  // A sibling application comes from a family that is already here. Pull the
  // applicant's own guardian record and the children enrolled under it, so the
  // reviewer sees the family this child would join without hunting for it.
  let family: FamilyContext | null = null;
  if (isSibling) {
    family = { guardian: null, children: [], failed: false };

    if (app.applicant_user_id) {
      const { data: guardianRow, error: guardianError } = await supabase
        .from("kg_guardians")
        .select("*")
        .eq("tenant_id", ctx.tenant.id)
        .eq("user_id", app.applicant_user_id)
        .limit(1)
        .maybeSingle();
      family.failed = Boolean(guardianError);
      family.guardian = (guardianRow as Guardian | null) ?? null;
    }

    if (family.guardian) {
      const { data: links, error: linksError } = await supabase
        .from("kg_child_guardians")
        .select("child_id")
        .eq("guardian_id", family.guardian.id);
      family.failed ||= Boolean(linksError);

      // Once approved, the new sibling is one of these rows — leave it out.
      const childIds = [...new Set((links ?? []).map((l) => l.child_id as string))].filter(
        (childId) => childId !== app.created_child_id
      );

      if (childIds.length > 0) {
        const { data: siblings, error: siblingsError } = await supabase
          .from("kg_children")
          .select("id, first_name, last_name, first_name_ar, last_name_ar, class_id")
          .eq("tenant_id", ctx.tenant.id)
          .eq("status", "enrolled")
          .in("id", childIds)
          .order("first_name");
        family.failed ||= Boolean(siblingsError);
        family.children = (siblings ?? []) as unknown as FamilyChild[];
      }
    }
  }

  const familyName = family?.guardian ? childDisplayName(family.guardian, locale) : null;
  const transfer = await loadTransferSummary(app);

  // Which of these guardians the crèche ALREADY holds a record for.
  //
  // `guardians` above is the application's jsonb — on a pending file these
  // people do not exist as rows yet, so their names are not links to anything.
  // But a family enrolling a second child is already here, and the phone is
  // what identifies them: the same rule kg_approve_application uses to adopt
  // an existing guardian (0017). Matched names become links to the child whose
  // record that guardian lives on; unmatched names stay plain text, because
  // inventing a link that 404s is worse than no link.
  // TWO keys per number, and a match on either counts.
  //
  // normalizeAlgerianPhone is the right primary key: a parent typing
  // "+213 661 98 76 54" and a record holding "0661 98 76 54" are the same
  // person, and a bare digit strip leaves 213661987654 vs 0661987654 — a
  // silent miss. But it validates as well as normalises, so it returns null
  // for a malformed number, and a crèche's older records are full of those.
  // Falling back to raw digits keeps those matching instead of quietly
  // dropping every family whose phone was typed badly years ago.
  const phoneKeys = (v: unknown): string[] => {
    if (typeof v !== "string") return [];
    const raw = v.replace(/\D/g, "");
    const normal = normalizeAlgerianPhone(v);
    return [...new Set([normal, raw.length >= 6 ? raw : null].filter(Boolean) as string[])];
  };
  const appPhoneKeys = new Set(guardians.flatMap((g) => phoneKeys(g.phone)));

  const guardianLinkByPhone = new Map<string, { childId: string; guardianId: string }>();
  if (appPhoneKeys.size > 0) {
    const { data: known } = await supabase
      .from("kg_guardians")
      .select("id, phone, kg_child_guardians(child_id)")
      .eq("tenant_id", ctx.tenant.id);

    for (const row of (known ?? []) as {
      id: string;
      phone: string | null;
      kg_child_guardians: { child_id: string }[] | null;
    }[]) {
      const keys = phoneKeys(row.phone);
      if (!keys.some((k) => appPhoneKeys.has(k))) continue;
      // Prefer a child OTHER than the one this application created — for a
      // sibling enrolment that is the genuinely new information, "here is the
      // family you already have". But fall back to the created child rather
      // than rendering the name as dead text: on an approved file the guardian
      // is a real record now, and their record lives on that child's page.
      const linked = (row.kg_child_guardians ?? []).map((l) => l.child_id);
      const childId =
        linked.find((id) => id !== app.created_child_id) ?? linked[0] ?? null;
      if (childId) {
        for (const k of keys) guardianLinkByPhone.set(k, { childId, guardianId: row.id });
      }
    }
  }

  const activities = (activitiesRes.data ?? []) as Activity[];
  const displayName = childDisplayName(
    {
      first_name: child.first_name ?? "",
      last_name: child.last_name ?? "",
      first_name_ar: child.first_name_ar,
      last_name_ar: child.last_name_ar,
    },
    locale
  );
  // The name in the other script, only when it is a different string.
  const otherName = (
    locale === "ar"
      ? `${child.first_name ?? ""} ${child.last_name ?? ""}`
      : `${child.first_name_ar ?? ""} ${child.last_name_ar ?? ""}`
  ).trim();
  const subtitle = otherName && otherName !== displayName ? otherName : undefined;

  // Where the file came from, as one muted word. The public link is the
  // default channel; a sibling or a transfer changes what approval does.
  const sourceLabel = isTransfer
    ? t("admin.sourceTransfer")
    : isSibling
      ? t("admin.sourceSibling")
      : !app.source || app.source === "link" || app.source === "online"
        ? t("admin.sourceLink")
        : t.has(`source.${app.source}`)
          ? t(`source.${app.source}`)
          : app.source;

  const requestedStructure = ctx.isMultiStructure ? (app.kg_structures ?? null) : null;
  const requestedClass = app.kg_classes ?? null;
  const plan = app.kg_fee_plans ?? null;

  const hasHealthInfo =
    allergies.length > 0 ||
    conditions.length > 0 ||
    medications.length > 0 ||
    !!health.dietary_restrictions ||
    !!health.doctor_name;
  const hasBilling = !!plan || activities.length > 0;

  const facts: React.ReactNode[] = [
    child.dob ? ageFromDob(child.dob, tAge) : null,
    requestedStructure ? (
      <StructureMark
        key="structure"
        structure={{
          name: structureRefName(requestedStructure, locale),
          color: requestedStructure.color,
        }}
        className="text-foreground"
      />
    ) : null,
    requestedClass ? (
      <ClassChip
        key="class"
        name={structureRefName(requestedClass, locale)}
        color={requestedClass.color}
      />
    ) : null,
    t("detail.submittedOn", { date: formatDate(app.created_at, locale) }),
    sourceLabel,
    app.interview_at
      ? t("pipeline.interviewOn", {
          date: formatDate(app.interview_at, locale),
          time: formatTime(app.interview_at, locale),
        })
      : null,
  ];

  return (
    <>
      <Link
        href="/applications"
        className="mb-3 inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="size-4 rtl:rotate-180" />
        {t("admin.title")}
      </Link>

      <IdentityBand
        leading={
          <Avatar className="size-14 ring-1 ring-border">
            {photoUrl && <AvatarImage src={photoUrl} alt={displayName} className="object-cover" />}
            <AvatarFallback className="bg-primary/10 text-lg font-semibold text-primary">
              {initials(child.first_name ?? "", child.last_name ?? "")}
            </AvatarFallback>
          </Avatar>
        }
        // Isolated: a name in the other script keeps its own direction
        // without dragging the whole title line to the far edge.
        title={<bdi dir="auto">{displayName}</bdi>}
        subtitle={subtitle ? <bdi dir="auto">{subtitle}</bdi> : undefined}
        facts={facts}
        actions={
          <>
            <StatusPill tone={STATUS_TONE[app.status]}>{t(`status.${app.status}`)}</StatusPill>
            {ctx.isAdmin && (
              <ReviewActions
                appId={app.id}
                status={app.status}
                interviewAt={app.interview_at}
                childName={displayName}
                childAge={child.dob ? ageFromDob(child.dob, tAge) : null}
                classes={classes}
                feePlans={(feePlansRes.data ?? []) as FeePlanOption[]}
                admissionFees={(admissionRes.data ?? []) as AdmissionFee[]}
                requestedFeePlanId={(app as { fee_plan_id?: string | null }).fee_plan_id ?? null}
                requestedClassId={app.class_id ?? null}
                childDob={child.dob}
                createdChildId={app.created_child_id}
                isSibling={isSibling}
                familyName={familyName}
                structures={ctx.structures}
                requestedStructureId={app.structure_id}
                transfer={transfer}
              />
            )}
          </>
        }
      />

      {/* What was decided, in one muted line — the note in the family's own
          words on its own line, so its direction is its own. */}
      {(app.reviewed_at || app.review_note) && (
        <div className="mb-4 text-sm text-muted-foreground">
          {app.reviewed_at && <p>{t("detail.reviewedOn", { date: formatDate(app.reviewed_at, locale) })}</p>}
          {app.review_note && (
            <p>
              {t("detail.reviewNote")} :{" "}
              <bdi dir="auto" className="text-foreground">
                {app.review_note}
              </bdi>
            </p>
          )}
        </div>
      )}

      <ApplicationStructureContext app={app} />

      {/* The file's papers, full width: what the family sent, what the
          office accepted, what is still to bring. Under it, the two sheets
          the office prints for a family at the desk — tertiary links, as the
          family's own page shows them. */}
      {dossier && (
        <div className="mb-4 grid gap-2">
          <DossierSection
            subject={{ applicationId: app.id }}
            dossier={dossier}
            requirements={requirements}
            urls={dossierUrls}
            canDelete={ctx.isAdmin}
            // cd_ins and cd_upd are educator-gated: every staff role but the accountant.
            canReview={ctx.role !== "accountant"}
          />
          {(printable.fiche || printable.demande) && (
            <p className="flex flex-wrap items-center gap-x-1 text-sm text-muted-foreground">
              {printable.fiche && (
                <Link
                  href={`/applications/${app.id}/print?sheet=fiche`}
                  className="inline-flex items-center gap-0.5 text-primary hover:text-primary/80"
                >
                  {t("dossier.printFiche")}
                  <ChevronRight className="size-3.5 rtl:rotate-180" aria-hidden />
                </Link>
              )}
              {printable.fiche && printable.demande && <span aria-hidden>·</span>}
              {printable.demande && (
                <Link
                  href={`/applications/${app.id}/print?sheet=demande`}
                  className="inline-flex items-center gap-0.5 text-primary hover:text-primary/80"
                >
                  {t("dossier.printDemande")}
                  <ChevronRight className="size-3.5 rtl:rotate-180" aria-hidden />
                </Link>
              )}
            </p>
          )}
        </div>
      )}

      {isSibling && family && (
        <SectionCard
          icon={Users}
          tone={1}
          title={t("sibling.section")}
          hint={t("sibling.intro")}
          className="mb-4"
          contentClassName="gap-2"
        >
          {family.failed && <p className="text-sm text-destructive">{t("sibling.error")}</p>}
          {!family.failed && !family.guardian && (
            <p className="text-sm text-gold-ink">{t("sibling.noGuardianDesc")}</p>
          )}
          {family.guardian && (
            <ul className="divide-y divide-border">
              <li className="flex items-center gap-3 py-2.5">
                <Avatar className="size-9">
                  <AvatarFallback className="bg-primary/10 text-xs font-semibold text-primary">
                    {initials(family.guardian.first_name, family.guardian.last_name)}
                  </AvatarFallback>
                </Avatar>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium">{familyName}</span>
                  <span className="block text-xs text-muted-foreground">
                    {t(`guardians.relationships.${family.guardian.relationship}`)}
                    {family.guardian.phone && (
                      <>
                        {" · "}
                        <a href={telHref(family.guardian.phone)} dir="ltr" className="hover:underline">
                          {formatPhone(family.guardian.phone)}
                        </a>
                      </>
                    )}
                  </span>
                </span>
              </li>
              {family.children.length === 0 ? (
                <li className="py-2.5 text-sm text-muted-foreground">{t("sibling.noChildren")}</li>
              ) : (
                family.children.map((c) => {
                  const cls = c.class_id ? classById.get(c.class_id) : null;
                  return (
                    <li key={c.id}>
                      <Link
                        href={`/children/${c.id}`}
                        className="flex min-h-12 items-center gap-3 py-2 transition-colors hover:bg-muted/40"
                      >
                        <Avatar className="size-9">
                          <AvatarFallback className="bg-primary/10 text-xs font-semibold text-primary">
                            {initials(c.first_name, c.last_name)}
                          </AvatarFallback>
                        </Avatar>
                        <span className="min-w-0 flex-1 truncate text-sm font-medium">
                          {childDisplayName(c, locale)}
                        </span>
                        {cls ? (
                          <ClassChip name={structureRefName(cls, locale)} />
                        ) : (
                          <span className="text-xs text-muted-foreground">{t("sibling.noClass")}</span>
                        )}
                        <ChevronRight className="size-4 shrink-0 text-muted-foreground rtl:rotate-180" />
                      </Link>
                    </li>
                  );
                })
              )}
            </ul>
          )}
        </SectionCard>
      )}

      <div className="grid gap-4 lg:grid-cols-2">
        <SectionCard
          icon={Baby}
          tone={0}
          title={t("detail.childSection")}
          hint={t("admin.childHint")}
          contentClassName="gap-0 divide-y divide-border"
        >
          <FactRow label={t("detail.dob")} value={child.dob ? formatDate(child.dob, locale) : null} />
          <FactRow label={t("detail.gender")} value={child.gender ? t(`child.${child.gender}`) : null} />
          <FactRow label={t("detail.bloodType")} value={child.blood_type} ltr />
          {child.notes && (
            <div className="py-2 text-sm">
              <span className="text-muted-foreground">{t("guardians.pickupNote")}</span>
              <bdi dir="auto" className="block text-start">
                {child.notes}
              </bdi>
            </div>
          )}
          {!photoUrl && child.photo_path && (
            <p className="py-2 text-sm text-muted-foreground">{t("detail.photoUnavailable")}</p>
          )}
        </SectionCard>

        <SectionCard
          icon={Users}
          tone={1}
          title={t("detail.guardiansSection")}
          hint={t("admin.guardiansHint")}
          contentClassName="gap-0 divide-y divide-border"
        >
          {guardians.length === 0 && (
            <p className="py-2 text-sm text-muted-foreground">{t("admin.noGuardians")}</p>
          )}
          {guardians.map((g, i) => {
            const hit = phoneKeys(g.phone)
              .map((k) => guardianLinkByPhone.get(k))
              .find(Boolean);
            const name = `${g.first_name ?? ""} ${g.last_name ?? ""}`.trim();
            // The first guardian is the applicant and the primary contact by
            // default — said nowhere. A second guardian who filed the form
            // or who pays is the exception worth a word.
            const marks = [
              i > 0 && g.is_applicant ? t("admin.marks.applicant") : null,
              i > 0 && g.is_financial ? t("admin.marks.financial") : null,
            ].filter(Boolean);
            const details = [
              g.workplace,
              g.address,
              g.national_id ? (
                <span key="nid" dir="ltr">
                  {g.national_id}
                </span>
              ) : null,
            ].filter(Boolean);
            return (
              <div key={i} className="flex items-start gap-3 py-3">
                <Avatar className="size-9">
                  <AvatarFallback className="bg-primary/10 text-xs font-semibold text-primary">
                    {initials(g.first_name ?? "", g.last_name ?? "")}
                  </AvatarFallback>
                </Avatar>
                <div className="min-w-0 flex-1 text-sm">
                  <div className="flex flex-wrap items-baseline gap-x-2">
                    {hit ? (
                      <Link
                        href={`/children/${hit.childId}`}
                        className="font-medium text-primary hover:underline"
                        title={t("detail.knownFamily")}
                      >
                        {name}
                      </Link>
                    ) : (
                      <span className="font-medium">{name}</span>
                    )}
                    <span className="text-xs text-muted-foreground">
                      {[t(`guardians.relationships.${g.relationship}`), ...marks].join(" · ")}
                    </span>
                  </div>
                  <div className="flex flex-wrap items-center gap-x-2 text-muted-foreground">
                    {g.phone && (
                      <a href={telHref(g.phone)} dir="ltr" className="hover:underline">
                        {formatPhone(g.phone)}
                      </a>
                    )}
                    {g.phone_alt && (
                      <a href={telHref(g.phone_alt)} dir="ltr" className="hover:underline">
                        {formatPhone(g.phone_alt)}
                      </a>
                    )}
                    {g.email && (
                      <a href={`mailto:${g.email}`} dir="ltr" className="hover:underline">
                        {g.email}
                      </a>
                    )}
                  </div>
                  {details.length > 0 && (
                    <div className="text-xs text-muted-foreground">
                      {details.map((d, j) => (
                        <span key={j}>
                          {j > 0 && " · "}
                          {d}
                        </span>
                      ))}
                    </div>
                  )}
                  {!g.can_pickup && (
                    <p className="mt-0.5 inline-flex items-center gap-1 text-xs text-muted-foreground">
                      <Ban className="size-3.5" aria-hidden />
                      {t("admin.marks.noPickup")}
                    </p>
                  )}
                </div>
              </div>
            );
          })}
        </SectionCard>

        {hasHealthInfo && (
          <SectionCard
            icon={HeartPulse}
            tone={3}
            title={t("detail.healthSection")}
            hint={t("admin.healthHint")}
            contentClassName="gap-0 divide-y divide-border"
          >
            {allergies.map((a, i) => (
              // The allergy is the page's one red — on the severity, not on a
              // heading above it.
              <div key={i} className="py-2 text-sm">
                <div className="flex items-center justify-between gap-3">
                  <span className="font-medium">{allergenLabel(a.allergen, tc)}</span>
                  <StatusPill tone="danger">
                    {t(`health.severities.${a.severity ?? "mild"}`)}
                  </StatusPill>
                </div>
                {(a.reaction || a.action_plan) && (
                  <p className="text-muted-foreground">
                    {[a.reaction, a.action_plan].filter(Boolean).join(" · ")}
                  </p>
                )}
              </div>
            ))}
            <FactRow label={t("detail.conditions")} value={conditions.length ? conditions.join("، ") : null} />
            <FactRow label={t("detail.medications")} value={medications.length ? medications.join("، ") : null} />
            <FactRow
              label={t("detail.doctor")}
              value={
                health.doctor_name || health.doctor_phone ? (
                  <>
                    {health.doctor_name}
                    {health.doctor_name && health.doctor_phone && " · "}
                    {health.doctor_phone && <span dir="ltr">{formatPhone(health.doctor_phone)}</span>}
                  </>
                ) : null
              }
            />
            <FactRow label={t("detail.dietary")} value={health.dietary_restrictions} />
          </SectionCard>
        )}

        {hasBilling && (
          <SectionCard
            icon={Palette}
            tone={2}
            title={t("admin.billingSection")}
            hint={t("admin.billingHint")}
            contentClassName="gap-0 divide-y divide-border"
          >
            {/* A bill: label at the start, amount at the end. The monthly
                plan first because it is the first thing approval confirms. */}
            {plan && (
              <div className="flex items-center justify-between gap-3 py-2 text-sm">
                <span className="font-medium">
                  {locale === "ar" && plan.name_ar ? plan.name_ar : plan.name}
                  <span className="ms-2 text-xs font-normal text-muted-foreground">
                    {t("admin.monthlyPlan")}
                  </span>
                </span>
                <span className="tabular-nums" dir="ltr">
                  {formatDZD(plan.amount, locale)}
                </span>
              </div>
            )}
            {activities.map((a) => (
              <div key={a.id} className="flex items-center justify-between gap-3 py-2 text-sm">
                {/* The category's own icon, not a generic sparkle on every
                    row: CategoryIcon already renders exactly that on the
                    activities page, so the two screens agree. */}
                <span className="flex min-w-0 items-center gap-2.5 font-medium">
                  <CategoryIcon category={a.category} className="size-8 [&>svg]:size-4" />
                  <span className="min-w-0 truncate">
                    <ActivityLink id={a.id}>
                      {locale === "ar" && a.name_ar ? a.name_ar : a.name}
                    </ActivityLink>
                  </span>
                </span>
                <span className="shrink-0 text-end tabular-nums">
                  <span dir="ltr">{formatDZD(a.fee_amount, locale)}</span>
                  <span className="text-muted-foreground"> · {t(`activities.period.${a.fee_period}`)}</span>
                </span>
              </div>
            ))}
          </SectionCard>
        )}
      </div>
    </>
  );
}
