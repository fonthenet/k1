import { fetchProfileNames, memberNameIn } from "@/lib/member-names";
import Link from "next/link";
import { getLocale, getTranslations } from "next-intl/server";
import {
  ArrowLeft,
  ArrowRight,
  CalendarClock,
  Eye,
  EyeOff,
  FileQuestion,
  Receipt,
  Target,
} from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { requireStaff } from "@/lib/tenant";
import { childDisplayName, formatDZD } from "@/lib/format";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { EmptyState } from "@/components/shared/empty-state";
import { PageHeader } from "@/components/shared/page-header";
import { StaffLink } from "@/components/shared/entity-link";
import { SessionOutcomeForm } from "@/components/modules/sessions/session-outcome-form";
import {
  MeterRow,
  Monogram,
  ProgramStatusPill,
  StatusPill,
  TypeChip,
} from "@/components/modules/sessions/session-ui";
import {
  algiersDate,
  algiersEndTime,
  algiersTime,
  longDateLabel,
} from "@/components/modules/sessions/dates";
import type {
  ChildLite,
  ProgramGoalRecord,
  ProgramStatus,
  SessionStatus,
  SessionType,
} from "@/components/modules/sessions/session-types";

export const dynamic = "force-dynamic";

interface SessionDetail {
  id: string;
  child_id: string;
  program_id: string | null;
  session_type: SessionType;
  therapist_id: string | null;
  scheduled_at: string;
  duration_min: number;
  status: SessionStatus;
  progress_rating: number | null;
  notes: string | null;
  parent_summary: string | null;
  published: boolean;
  billed: boolean;
  kg_children: ChildLite | null;
  kg_programs: {
    id: string;
    name: string;
    session_type: SessionType;
    sessions_planned: number | null;
    fee_per_session: number | string;
    status: ProgramStatus;
  } | null;
}

export default async function SessionDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const ctx = await requireStaff();
  const t = await getTranslations("sessions");
  const locale = await getLocale();
  const supabase = await createClient();

  const { data: row, error } = await supabase
    .from("kg_sessions")
    .select(
      "id, child_id, program_id, session_type, therapist_id, scheduled_at, duration_min, status, " +
        "progress_rating, notes, parent_summary, published, billed, " +
        "kg_children(id, first_name, last_name, first_name_ar, last_name_ar, kg_classes(name, name_ar)), " +
        "kg_programs(id, name, session_type, sessions_planned, fee_per_session, status)"
    )
    .eq("id", id)
    .eq("tenant_id", ctx.tenant.id)
    .maybeSingle();
  if (error) throw new Error(error.message);

  const session = row as unknown as SessionDetail | null;
  const BackArrow = locale === "ar" ? ArrowRight : ArrowLeft;

  if (!session) {
    return (
      <div>
        <PageHeader title={t("title")} description={t("description")} />
        <EmptyState
          icon={<FileQuestion />}
          title={t("detail.notFound")}
          description={t("detail.notFoundHint")}
          action={
            <Button asChild>
              <Link href="/sessions">{t("detail.back")}</Link>
            </Button>
          }
        />
      </div>
    );
  }

  const child = session.kg_children;
  const childName = child ? childDisplayName(child, locale) : "—";
  const cls = child?.kg_classes;
  const classLabel = cls
    ? locale === "ar" && cls.name_ar
      ? cls.name_ar
      : cls.name
    : t("schedule.noClass");

  let therapistName = t("schedule.noTherapist");
  let therapistLinkId: string | null = null;
  if (session.therapist_id) {
    const { data: membership } = await supabase
      .from("kg_memberships")
      // full_name as well as user_id: a therapist the director typed in has no
      // account and therefore no profile row, and asking only for the profile
      // left both the name and the link below empty.
      .select("user_id, full_name")
      .eq("id", session.therapist_id)
      .eq("tenant_id", ctx.tenant.id)
      .maybeSingle();
    if (membership) {
      const names = await fetchProfileNames(supabase, [membership.user_id]);
      const resolved = memberNameIn(membership, names);
      if (resolved) {
        therapistName = resolved;
        therapistLinkId = session.therapist_id;
      }
    }
  }

  const program = session.kg_programs;
  let goals: ProgramGoalRecord[] = [];
  if (program) {
    const { data: goalRows } = await supabase
      .from("kg_program_goals")
      .select("id, program_id, title, target, progress_pct, achieved, sort_order")
      .eq("tenant_id", ctx.tenant.id)
      .eq("program_id", program.id)
      .order("sort_order");
    goals = (goalRows ?? []) as ProgramGoalRecord[];
  }

  const dayLabel = longDateLabel(algiersDate(session.scheduled_at), locale);
  const timeLabel = `${algiersTime(session.scheduled_at, locale)} – ${algiersEndTime(
    session.scheduled_at,
    session.duration_min,
    locale
  )}`;

  return (
    <div>
      <PageHeader title={t("detail.title", { child: childName })} description={dayLabel}>
        <Button variant="outline" size="sm" asChild>
          <Link href="/sessions">
            <BackArrow data-icon="inline-start" />
            {t("detail.back")}
          </Link>
        </Button>
      </PageHeader>

      <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,1fr)_340px]">
        <SessionOutcomeForm
          sessionId={session.id}
          initial={{
            status: session.status,
            progressRating: session.progress_rating,
            notes: session.notes ?? "",
            parentSummary: session.parent_summary ?? "",
            published: session.published,
          }}
        />

        <div className="grid gap-4">
          <Card className="border border-border py-0 shadow-sm ring-0">
            <CardHeader className="border-b border-border bg-muted/40 pt-4">
              <CardTitle className="text-base font-semibold">{t("detail.facts")}</CardTitle>
            </CardHeader>
            <CardContent className="grid gap-4 p-4">
              <div className="flex items-center gap-3">
                <Monogram name={childName} />
                <div className="min-w-0">
                  <Link
                    href={`/children/${session.child_id}`}
                    className="block truncate text-sm font-semibold text-foreground hover:underline"
                  >
                    {childName}
                  </Link>
                  <span className="block truncate text-xs text-muted-foreground">
                    {classLabel}
                  </span>
                </div>
              </div>

              <Separator />

              <dl className="grid gap-3 text-sm">
                <div className="flex items-center justify-between gap-3">
                  <dt className="text-xs text-muted-foreground">{t("detail.type")}</dt>
                  <dd>
                    <TypeChip
                      type={session.session_type}
                      label={t(`types.${session.session_type}`)}
                    />
                  </dd>
                </div>
                <div className="flex items-center justify-between gap-3">
                  <dt className="text-xs text-muted-foreground">{t("detail.form.status")}</dt>
                  <dd>
                    <StatusPill status={session.status} label={t(`status.${session.status}`)} />
                  </dd>
                </div>
                <div className="flex items-baseline justify-between gap-3">
                  <dt className="text-xs text-muted-foreground">{t("detail.therapist")}</dt>
                  <dd className="truncate text-end font-medium">
                    {therapistLinkId ? (
                      <StaffLink id={therapistLinkId}>{therapistName}</StaffLink>
                    ) : (
                      therapistName
                    )}
                  </dd>
                </div>
                <div className="flex items-baseline justify-between gap-3">
                  <dt className="text-xs text-muted-foreground">{t("detail.scheduled")}</dt>
                  <dd className="text-end font-medium tabular-nums">{timeLabel}</dd>
                </div>
                <div className="flex items-baseline justify-between gap-3">
                  <dt className="text-xs text-muted-foreground">{t("detail.duration")}</dt>
                  <dd className="text-end font-medium tabular-nums">
                    {t("schedule.duration", { count: session.duration_min })}
                  </dd>
                </div>
              </dl>

              <Separator />

              <div className="flex flex-wrap items-center gap-2">
                <Badge
                  className={
                    session.published
                      ? "border-transparent bg-success/10 font-medium text-success"
                      : "border-transparent bg-muted font-medium text-muted-foreground"
                  }
                >
                  {session.published ? (
                    <Eye data-icon="inline-start" />
                  ) : (
                    <EyeOff data-icon="inline-start" />
                  )}
                  {session.published ? t("detail.publishedYes") : t("detail.publishedNo")}
                </Badge>
                <Badge
                  className={
                    session.billed
                      ? "border-transparent bg-primary/10 font-medium text-primary"
                      : "border-transparent bg-muted font-medium text-muted-foreground"
                  }
                >
                  <Receipt data-icon="inline-start" />
                  {session.billed ? t("detail.billedYes") : t("detail.billedNo")}
                </Badge>
              </div>
            </CardContent>
          </Card>

          <Card className="border border-border py-0 shadow-sm ring-0">
            <CardHeader className="border-b border-border bg-muted/40 pt-4">
              <CardTitle className="flex items-center gap-2 text-base font-semibold">
                <Target className="size-4 text-primary" />
                {t("detail.program")}
              </CardTitle>
            </CardHeader>
            <CardContent className="grid gap-4 p-4">
              {!program ? (
                <p className="text-sm leading-relaxed text-muted-foreground">
                  {t("detail.noProgram")}
                </p>
              ) : (
                <>
                  <div className="grid gap-2">
                    <div className="flex flex-wrap items-center gap-2">
                      <Link
                        href={`/sessions/programs/${program.id}`}
                        className="text-sm font-semibold text-foreground hover:underline"
                      >
                        {program.name}
                      </Link>
                      <ProgramStatusPill
                        status={program.status}
                        label={t(`programStatus.${program.status}`)}
                      />
                    </div>
                    <div className="flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
                      <span className="inline-flex items-center gap-1">
                        <CalendarClock className="size-3.5" />
                        {program.sessions_planned ?? "—"}
                      </span>
                      <span className="tabular-nums">
                        {formatDZD(program.fee_per_session, locale)}
                      </span>
                    </div>
                  </div>

                  <Separator />

                  <div className="grid gap-3">
                    <span className="text-xs font-semibold text-foreground">
                      {t("detail.goals")}
                    </span>
                    {goals.length === 0 ? (
                      <p className="text-xs text-muted-foreground">{t("detail.noGoals")}</p>
                    ) : (
                      goals.map((g) => (
                        <MeterRow
                          key={g.id}
                          label={g.title}
                          value={`${g.progress_pct}%`}
                          pct={g.progress_pct}
                          tone={g.achieved ? "success" : "primary"}
                        />
                      ))
                    )}
                  </div>

                  <Button variant="outline" size="sm" asChild className="w-full">
                    <Link href={`/sessions/programs/${program.id}`}>
                      {t("detail.openProgram")}
                    </Link>
                  </Button>
                </>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
