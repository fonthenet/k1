// Full application review: child, guardians, health, requested activities + action bar.

import Link from "next/link";
import { getLocale, getTranslations } from "next-intl/server";
import {
  ArrowLeft,
  Briefcase,
  CalendarClock,
  ChevronRight,
  FileQuestion,
  HeartPulse,
  IdCard,
  MapPin,
  Phone,
  ShieldAlert,
  Sparkles,
  Stethoscope,
  TriangleAlert,
  Users,
} from "lucide-react";
import { requireStaff, signedMediaUrl } from "@/lib/tenant";
import { createClient } from "@/lib/supabase/server";
import { ageFromDob, childDisplayName, formatDZD, formatDate, formatPhone, formatTime, initials, telHref } from "@/lib/format";
import type { Activity, Guardian, KgClass } from "@/lib/types";
import { PageHeader } from "@/components/shared/page-header";
import { EmptyState } from "@/components/shared/empty-state";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { ReviewActions, type ClassOption } from "@/components/modules/enroll/review-actions";
import { SIBLING_SOURCE, SiblingBadge } from "@/components/modules/enroll/application-card";
import {
  APPLICATION_STATUS_BADGE,
  type ApplicationRecord,
} from "@/components/modules/enroll/types";
import { severityClasses } from "@/components/modules/children/types";

function InfoRow({
  icon,
  label,
  value,
  ltr,
}: {
  icon?: React.ReactNode;
  label: string;
  value: React.ReactNode;
  ltr?: boolean;
}) {
  if (!value) return null;
  return (
    <div className="flex items-start gap-2 text-sm">
      {icon && <span className="mt-0.5 text-muted-foreground [&>svg]:size-4">{icon}</span>}
      <span className="text-muted-foreground">{label}</span>
      <span className="ms-auto text-end font-medium" dir={ltr ? "ltr" : undefined}>
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
  const locale = await getLocale();
  const supabase = await createClient();

  const { data } = await supabase
    .from("kg_applications")
    .select("*")
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
            <Link href="/applications">{t("detail.back")}</Link>
          </Button>
        }
      />
    );
  }

  const app = data as ApplicationRecord;
  const isSibling = app.source === SIBLING_SOURCE;
  const child = app.child;
  const guardians = Array.isArray(app.guardians) ? app.guardians : [];
  const health = app.health ?? {};
  const allergies = Array.isArray(health.allergies) ? health.allergies : [];
  const conditions = Array.isArray(health.medical_conditions) ? health.medical_conditions : [];
  const medications = Array.isArray(health.medications) ? health.medications : [];
  const activityIds = Array.isArray(app.activity_ids) ? app.activity_ids : [];

  // Parallel: photo signed URL (may fail RLS for staff on u/ paths → fallback avatar),
  // classes with enrolled counts, requested activities.
  const [photoUrl, classesRes, childrenRes, activitiesRes] = await Promise.all([
    signedMediaUrl(child.photo_path),
    supabase.from("kg_classes").select("*").eq("tenant_id", ctx.tenant.id).order("name"),
    supabase
      .from("kg_children")
      .select("class_id")
      .eq("tenant_id", ctx.tenant.id)
      .eq("status", "enrolled"),
    activityIds.length > 0
      ? supabase
          .from("kg_activities")
          .select("*")
          .eq("tenant_id", ctx.tenant.id)
          .in("id", activityIds)
      : Promise.resolve({ data: [] as Activity[] }),
  ]);

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
    capacity: c.capacity,
    enrolled: enrolledByClass.get(c.id) ?? 0,
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

  const sourceKey = app.source ? `source.${app.source}` : null;
  const sourceLabel = sourceKey ? (t.has(sourceKey) ? t(sourceKey) : app.source) : null;

  const hasHealthInfo =
    allergies.length > 0 ||
    conditions.length > 0 ||
    medications.length > 0 ||
    health.dietary_restrictions ||
    health.doctor_name;

  return (
    <>
      <Link
        href="/applications"
        className="mb-3 inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="size-4 rtl:rotate-180" />
        {t("detail.back")}
      </Link>

      <PageHeader
        title={displayName}
        description={t("detail.submittedOn", { date: formatDate(app.created_at, locale) })}
      >
        <div className="flex flex-wrap items-center gap-2">
          <Badge className={APPLICATION_STATUS_BADGE[app.status]}>
            {t(`status.${app.status}`)}
          </Badge>
          {ctx.isAdmin && (
            <ReviewActions
              appId={app.id}
              status={app.status}
              interviewAt={app.interview_at}
              classes={classes}
              createdChildId={app.created_child_id}
              isSibling={isSibling}
              familyName={familyName}
            />
          )}
        </div>
      </PageHeader>

      {(app.interview_at || isSibling || sourceLabel) && (
        <div className="mb-4 flex flex-wrap items-center gap-2">
          {isSibling && <SiblingBadge />}
          {app.interview_at && (
            <Badge className="border-transparent bg-secondary font-medium text-secondary-foreground">
              <CalendarClock data-icon="inline-start" />
              {t("pipeline.interviewOn", {
                date: formatDate(app.interview_at, locale),
                time: formatTime(app.interview_at, locale),
              })}
            </Badge>
          )}
          {!isSibling && sourceLabel && (
            <Badge variant="outline">
              {t("pipeline.sourceLabel")} : {sourceLabel}
            </Badge>
          )}
        </div>
      )}

      {(app.reviewed_at || app.review_note) && (
        <Card className="mb-4 border-dashed">
          <CardContent className="p-4 text-sm">
            {app.reviewed_at && (
              <p className="text-muted-foreground">
                {t("detail.reviewedOn", { date: formatDate(app.reviewed_at, locale) })}
              </p>
            )}
            {app.review_note && (
              <p className="mt-1">
                <span className="font-medium">{t("detail.reviewNote")} :</span> {app.review_note}
              </p>
            )}
            {app.status === "approved" && app.created_child_id && (
              <p className="mt-2">
                <Link
                  href={`/children/${app.created_child_id}`}
                  className="font-medium text-primary underline-offset-4 hover:underline"
                >
                  {t("detail.childCreated")} — {t("detail.viewChild")}
                </Link>
              </p>
            )}
          </CardContent>
        </Card>
      )}

      {isSibling && family && (
        <Card className="mb-4 bg-gold-muted/40 ring-gold/25">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Users className="size-4 shrink-0 text-gold-ink" />
              {t("sibling.section")}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <p className="text-sm text-muted-foreground">{t("sibling.intro")}</p>

            {family.failed && (
              <div className="flex items-start gap-2.5 rounded-xl bg-destructive/10 p-3 text-sm text-destructive ring-1 ring-destructive/20">
                <TriangleAlert className="mt-0.5 size-4 shrink-0" />
                <p>{t("sibling.error")}</p>
              </div>
            )}

            {!family.failed && !family.guardian && (
              <div className="flex items-start gap-2.5 rounded-xl bg-warning/10 p-3 text-sm ring-1 ring-warning/25">
                <TriangleAlert className="mt-0.5 size-4 shrink-0 text-warning-ink" />
                <div className="space-y-1">
                  <p className="font-medium text-warning-ink">{t("sibling.noGuardianTitle")}</p>
                  <p className="text-muted-foreground">{t("sibling.noGuardianDesc")}</p>
                </div>
              </div>
            )}

            {family.guardian && (
              <>
                <div className="rounded-xl bg-card p-3 ring-1 ring-gold/25">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="font-semibold">{familyName}</p>
                    <Badge variant="outline">
                      {t(`guardians.relationships.${family.guardian.relationship}`)}
                    </Badge>
                    <Badge variant="secondary">{t("detail.badges.applicant")}</Badge>
                  </div>
                  {family.guardian.phone && (
                    <a
                      href={telHref(family.guardian.phone)}
                      className="mt-1 inline-flex min-h-11 items-center gap-1.5 text-sm font-medium text-primary hover:underline"
                    >
                      <Phone className="size-4 shrink-0" />
                      <span dir="ltr">{formatPhone(family.guardian.phone)}</span>
                    </a>
                  )}
                </div>

                <div>
                  <p className="mb-2 text-sm font-medium">{t("sibling.enrolledChildren")}</p>
                  {family.children.length === 0 ? (
                    <p className="text-sm text-muted-foreground">{t("sibling.noChildren")}</p>
                  ) : (
                    <ul className="space-y-2">
                      {family.children.map((c) => {
                        const cls = c.class_id ? classById.get(c.class_id) : null;
                        return (
                          <li key={c.id}>
                            <Link
                              href={`/children/${c.id}`}
                              className="flex min-h-11 items-center gap-3 rounded-xl bg-card px-3 py-2 ring-1 ring-foreground/10 transition-colors hover:ring-gold/40"
                            >
                              <Avatar className="size-8 shrink-0">
                                <AvatarFallback className="bg-primary/10 text-xs font-semibold text-primary">
                                  {initials(c.first_name, c.last_name)}
                                </AvatarFallback>
                              </Avatar>
                              <span className="min-w-0 flex-1 truncate text-sm font-medium">
                                {childDisplayName(c, locale)}
                              </span>
                              <span className="shrink-0 text-xs text-muted-foreground">
                                {cls
                                  ? locale === "ar" && cls.name_ar
                                    ? cls.name_ar
                                    : cls.name
                                  : t("sibling.noClass")}
                              </span>
                              <ChevronRight className="size-4 shrink-0 text-muted-foreground rtl:rotate-180" />
                            </Link>
                          </li>
                        );
                      })}
                    </ul>
                  )}
                </div>
              </>
            )}
          </CardContent>
        </Card>
      )}

      <div className="grid gap-4 lg:grid-cols-2">
        {/* Child */}
        <Card>
          <CardHeader>
            <CardTitle>🧒 {t("detail.childSection")}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex items-center gap-4">
              <Avatar className="size-20 rounded-2xl">
                {photoUrl && <AvatarImage src={photoUrl} alt={displayName} className="object-cover" />}
                <AvatarFallback className="rounded-2xl bg-primary/10 text-xl font-semibold text-primary">
                  {initials(child.first_name ?? "", child.last_name ?? "")}
                </AvatarFallback>
              </Avatar>
              <div>
                <p className="text-lg font-semibold">
                  {child.first_name} {child.last_name}
                </p>
                {(child.first_name_ar || child.last_name_ar) && (
                  <p className="font-[family-name:var(--font-cairo)] text-muted-foreground" dir="rtl">
                    {child.first_name_ar} {child.last_name_ar}
                  </p>
                )}
                {!photoUrl && child.photo_path && (
                  <p className="mt-1 text-xs text-muted-foreground">{t("detail.photoUnavailable")}</p>
                )}
              </div>
            </div>
            <Separator />
            <div className="space-y-2">
              <InfoRow
                label={t("detail.dob")}
                value={
                  child.dob
                    ? `${formatDate(child.dob, locale)} · ${ageFromDob(child.dob, locale)}`
                    : null
                }
              />
              <InfoRow
                label={t("detail.gender")}
                value={child.gender ? t(`child.${child.gender}`) : null}
              />
              <InfoRow label={t("detail.bloodType")} value={child.blood_type} ltr />
              {child.notes && (
                <p className="rounded-lg bg-muted/50 p-2.5 text-sm">
                  <span className="font-medium">{t("guardians.pickupNote")} :</span> {child.notes}
                </p>
              )}
            </div>
          </CardContent>
        </Card>

        {/* Guardians */}
        <Card>
          <CardHeader>
            <CardTitle>👨‍👩‍👧 {t("detail.guardiansSection")}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {guardians.map((g, i) => (
              <div key={i} className="rounded-xl border p-3">
                <div className="mb-2 flex flex-wrap items-center gap-2">
                  <p className="font-semibold">
                    {g.first_name} {g.last_name}
                  </p>
                  <Badge variant="outline">{t(`guardians.relationships.${g.relationship}`)}</Badge>
                  {g.is_applicant && <Badge variant="secondary">{t("detail.badges.applicant")}</Badge>}
                  {g.is_primary && <Badge variant="secondary">{t("detail.badges.primary")}</Badge>}
                  {g.is_financial && (
                    <Badge variant="secondary">{t("detail.badges.financial")}</Badge>
                  )}
                  <Badge variant={g.can_pickup ? "outline" : "destructive"}>
                    {g.can_pickup ? t("detail.badges.pickup") : t("detail.badges.noPickup")}
                  </Badge>
                </div>
                <div className="space-y-1.5">
                  <InfoRow
                    icon={<Phone />}
                    label={t("guardians.phone")}
                    value={
                      g.phone ? (
                        <a href={telHref(g.phone)} className="hover:underline">
                          {formatPhone(g.phone)}
                        </a>
                      ) : null
                    }
                    ltr
                  />
                  <InfoRow icon={<Briefcase />} label={t("guardians.workplace")} value={g.workplace} />
                  <InfoRow icon={<IdCard />} label={t("guardians.nationalId")} value={g.national_id} ltr />
                  <InfoRow icon={<MapPin />} label={t("guardians.address")} value={g.address} />
                </div>
              </div>
            ))}
          </CardContent>
        </Card>

        {/* Health */}
        <Card>
          <CardHeader>
            <CardTitle>🩺 {t("detail.healthSection")}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div>
              <p className="mb-2 flex items-center gap-1.5 text-sm font-medium">
                <ShieldAlert className="size-4 text-destructive" />
                {t("detail.allergies")}
              </p>
              {allergies.length === 0 ? (
                <p className="text-sm text-muted-foreground">{t("detail.noAllergies")}</p>
              ) : (
                <div className="space-y-2">
                  {allergies.map((a, i) => (
                    <div key={i} className="rounded-lg border p-2.5 text-sm">
                      <div className="flex items-center justify-between gap-2">
                        <span className="font-medium">{a.allergen}</span>
                        <Badge className={severityClasses(a.severity ?? "mild")}>
                          {t(`health.severities.${a.severity ?? "mild"}`)}
                        </Badge>
                      </div>
                      {a.reaction && (
                        <p className="mt-1 text-muted-foreground">
                          {t("health.reaction")} : {a.reaction}
                        </p>
                      )}
                      {a.action_plan && (
                        <p className="text-muted-foreground">
                          {t("health.actionPlan")} : {a.action_plan}
                        </p>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
            {!hasHealthInfo && (
              <p className="text-sm text-muted-foreground">{t("detail.noHealth")}</p>
            )}
            {conditions.length > 0 && (
              <InfoRow
                icon={<HeartPulse />}
                label={t("detail.conditions")}
                value={conditions.join("، ")}
              />
            )}
            {medications.length > 0 && (
              <InfoRow label={t("detail.medications")} value={medications.join("، ")} />
            )}
            {(health.doctor_name || health.doctor_phone) && (
              <InfoRow
                icon={<Stethoscope />}
                label={t("detail.doctor")}
                value={[health.doctor_name, health.doctor_phone].filter(Boolean).join(" · ")}
              />
            )}
            {health.dietary_restrictions && (
              <InfoRow label={t("detail.dietary")} value={health.dietary_restrictions} />
            )}
          </CardContent>
        </Card>

        {/* Requested activities */}
        <Card>
          <CardHeader>
            <CardTitle>🎨 {t("detail.activitiesSection")}</CardTitle>
          </CardHeader>
          <CardContent>
            {activities.length === 0 ? (
              <p className="text-sm text-muted-foreground">{t("detail.noActivities")}</p>
            ) : (
              <div className="space-y-2">
                {activities.map((a) => (
                  <div
                    key={a.id}
                    className="flex items-center justify-between gap-3 rounded-lg border p-2.5 text-sm"
                  >
                    <span className="flex items-center gap-1.5 font-medium">
                      <Sparkles className="size-4 text-primary" />
                      {locale === "ar" && a.name_ar ? a.name_ar : a.name}
                    </span>
                    <span className="text-end tabular-nums">
                      {formatDZD(a.fee_amount, locale)}
                      <span className="text-muted-foreground">
                        {" "}
                        · {t(`activities.period.${a.fee_period}`)}
                      </span>
                    </span>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </>
  );
}
