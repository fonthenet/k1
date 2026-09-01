import { fetchProfileNames, memberNameIn } from "@/lib/member-names";
import Link from "next/link";
import { getLocale, getTranslations } from "next-intl/server";
import {
  ArrowLeft,
  ArrowRight,
  CalendarClock,
  Eye,
  FileQuestion,
  Target,
} from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { requireStaff } from "@/lib/tenant";
import { childDisplayName, formatDZD } from "@/lib/format";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { EmptyState } from "@/components/shared/empty-state";
import { PageHeader } from "@/components/shared/page-header";
import { StaffLink } from "@/components/shared/entity-link";
import { ProgramGoalsEditor } from "@/components/modules/sessions/program-goals-editor";
import { ProgramStatusSelect } from "@/components/modules/sessions/program-status-select";
import {
  MeterRow,
  Monogram,
  RatingStars,
  StatusPill,
  TypeChip,
} from "@/components/modules/sessions/session-ui";
import {
  algiersDate,
  algiersTime,
  longDateLabel,
} from "@/components/modules/sessions/dates";
import type {
  ChildLite,
  ProgramGoalRecord,
  ProgramRecord,
  SessionStatus,
} from "@/components/modules/sessions/session-types";

export const dynamic = "force-dynamic";

interface ProgramDetail extends ProgramRecord {
  kg_children: ChildLite | null;
}

interface HistorySession {
  id: string;
  scheduled_at: string;
  duration_min: number;
  status: SessionStatus;
  progress_rating: number | null;
  published: boolean;
}

export default async function ProgramDetailPage({
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
    .from("kg_programs")
    .select(
      "id, child_id, name, session_type, therapist_id, sessions_planned, fee_per_session, " +
        "start_date, end_date, status, notes, " +
        "kg_children(id, first_name, last_name, first_name_ar, last_name_ar, kg_classes(name, name_ar))"
    )
    .eq("id", id)
    .eq("tenant_id", ctx.tenant.id)
    .maybeSingle();
  if (error) throw new Error(error.message);

  const program = row as unknown as ProgramDetail | null;
  const BackArrow = locale === "ar" ? ArrowRight : ArrowLeft;

  if (!program) {
    return (
      <div>
        <PageHeader title={t("programs.title")} description={t("programs.description")} />
        <EmptyState
          icon={<FileQuestion />}
          title={t("programDetail.notFound")}
          description={t("programDetail.notFoundHint")}
          action={
            <Button asChild>
              <Link href="/sessions/programs">{t("programDetail.back")}</Link>
            </Button>
          }
        />
      </div>
    );
  }

  const [goalsRes, historyRes] = await Promise.all([
    supabase
      .from("kg_program_goals")
      .select("id, program_id, title, target, progress_pct, achieved, sort_order")
      .eq("tenant_id", ctx.tenant.id)
      .eq("program_id", program.id)
      .order("sort_order"),
    supabase
      .from("kg_sessions")
      .select("id, scheduled_at, duration_min, status, progress_rating, published")
      .eq("tenant_id", ctx.tenant.id)
      .eq("program_id", program.id)
      .order("scheduled_at", { ascending: false }),
  ]);

  const goals = (goalsRes.data ?? []) as ProgramGoalRecord[];
  const history = (historyRes.data ?? []) as HistorySession[];

  let therapistName = t("schedule.noTherapist");
  // Only set once a real name resolves — it is what gates the link below.
  let therapistLinkId: string | null = null;
  if (program.therapist_id) {
    const { data: membership } = await supabase
      .from("kg_memberships")
      // full_name as well as user_id: a therapist the director typed in has no
      // account and therefore no profile row, and asking only for the profile
      // left both the name and the link below empty.
      .select("user_id, full_name")
      .eq("id", program.therapist_id)
      .eq("tenant_id", ctx.tenant.id)
      .maybeSingle();
    if (membership) {
      const names = await fetchProfileNames(supabase, [membership.user_id]);
      const resolved = memberNameIn(membership, names);
      if (resolved) {
        therapistName = resolved;
        therapistLinkId = program.therapist_id;
      }
    }
  }

  const childName = program.kg_children ? childDisplayName(program.kg_children, locale) : "—";
  const done = history.filter((s) => s.status === "completed").length;
  const planned = program.sessions_planned;
  const sessionsPct = planned && planned > 0 ? (done / planned) * 100 : 0;
  const goalsAvg =
    goals.length > 0
      ? Math.round(goals.reduce((sum, g) => sum + g.progress_pct, 0) / goals.length)
      : 0;
  const fee = Number(program.fee_per_session);
  const plannedTotal = planned ? fee * planned : null;

  const periodLabel = `${longDateLabel(program.start_date, locale)} — ${
    program.end_date ? longDateLabel(program.end_date, locale) : t("programDetail.openEnded")
  }`;

  return (
    <div>
      <PageHeader title={program.name} description={periodLabel}>
        <ProgramStatusSelect programId={program.id} status={program.status} />
        <Button variant="outline" size="sm" asChild>
          <Link href="/sessions/programs">
            <BackArrow data-icon="inline-start" />
            {t("programDetail.back")}
          </Link>
        </Button>
      </PageHeader>

      <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,1fr)_320px]">
        <div className="grid gap-4">
          <Card className="border border-border py-0 shadow-sm ring-0">
            <CardHeader className="border-b border-border bg-muted/40 pt-4">
              <CardTitle className="flex items-center gap-2 text-base font-semibold">
                <Target className="size-4 text-primary" />
                {t("programDetail.goals")}
              </CardTitle>
              <p className="text-sm leading-relaxed text-muted-foreground">
                {t("programDetail.goalsHint")}
              </p>
            </CardHeader>
            <CardContent className="p-4">
              <ProgramGoalsEditor programId={program.id} goals={goals} />
            </CardContent>
          </Card>

          <Card className="border border-border py-0 shadow-sm ring-0">
            <CardHeader className="border-b border-border bg-muted/40 pt-4">
              <CardTitle className="flex items-center gap-2 text-base font-semibold">
                <CalendarClock className="size-4 text-primary" />
                {t("programDetail.history")}
              </CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              {history.length === 0 ? (
                <p className="px-5 py-10 text-center text-sm text-muted-foreground">
                  {t("programDetail.historyEmpty")}
                </p>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="text-start">
                        {t("programDetail.historyDate")}
                      </TableHead>
                      <TableHead className="text-start">
                        {t("programDetail.historyStatus")}
                      </TableHead>
                      <TableHead className="text-start">
                        {t("programDetail.historyRating")}
                      </TableHead>
                      <TableHead className="w-10" />
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {history.map((s) => (
                      <TableRow key={s.id} className="hover:bg-primary/5">
                        <TableCell>
                          <Link href={`/sessions/${s.id}`} className="grid gap-0.5">
                            <span className="font-medium text-foreground">
                              {longDateLabel(algiersDate(s.scheduled_at), locale)}
                            </span>
                            <span className="text-xs tabular-nums text-muted-foreground">
                              {algiersTime(s.scheduled_at, locale)} ·{" "}
                              {t("schedule.duration", { count: s.duration_min })}
                            </span>
                          </Link>
                        </TableCell>
                        <TableCell>
                          <StatusPill status={s.status} label={t(`status.${s.status}`)} />
                        </TableCell>
                        <TableCell>
                          {s.progress_rating !== null ? (
                            <RatingStars
                              value={s.progress_rating}
                              srLabel={t("schedule.rating", { value: s.progress_rating })}
                            />
                          ) : (
                            <span className="text-xs text-muted-foreground">
                              {t("programDetail.noRating")}
                            </span>
                          )}
                        </TableCell>
                        <TableCell>
                          {s.published && (
                            <span className="text-success" title={t("schedule.published")}>
                              <Eye className="size-4" />
                              <span className="sr-only">{t("schedule.published")}</span>
                            </span>
                          )}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </div>

        <Card className="border border-border py-0 shadow-sm ring-0">
          <CardHeader className="border-b border-border bg-muted/40 pt-4">
            <CardTitle className="text-base font-semibold">
              {t("programDetail.overview")}
            </CardTitle>
          </CardHeader>
          <CardContent className="grid gap-4 p-4">
            <div className="flex items-center gap-3">
              <Monogram name={childName} />
              <div className="min-w-0">
                <Link
                  href={`/children/${program.child_id}`}
                  className="block truncate text-sm font-semibold text-foreground hover:underline"
                >
                  {childName}
                </Link>
                <span className="block truncate text-xs text-muted-foreground">
                  {therapistLinkId ? (
                    <StaffLink id={therapistLinkId}>{therapistName}</StaffLink>
                  ) : (
                    therapistName
                  )}
                </span>
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <TypeChip
                type={program.session_type}
                label={t(`types.${program.session_type}`)}
              />
              <Badge className="border-transparent bg-muted font-medium text-muted-foreground">
                {t(`programStatus.${program.status}`)}
              </Badge>
            </div>

            <Separator />

            <MeterRow
              label={t("programDetail.sessionsProgress")}
              value={
                planned
                  ? t("programs.sessionsDone", { done, planned })
                  : t("programs.sessionsOpen", { done })
              }
              pct={sessionsPct}
            />
            <MeterRow
              label={t("programDetail.goalsProgress")}
              value={`${goalsAvg}%`}
              pct={goalsAvg}
              tone="success"
            />

            <Separator />

            <dl className="grid gap-3 text-sm">
              <div className="flex items-baseline justify-between gap-3">
                <dt className="text-xs text-muted-foreground">{t("programDetail.fee")}</dt>
                <dd className="text-end font-medium tabular-nums">
                  {formatDZD(fee, locale)}
                </dd>
              </div>
              {plannedTotal !== null && (
                <div className="flex items-baseline justify-between gap-3">
                  <dt className="text-xs text-muted-foreground">
                    {t("programDetail.plannedTotal")}
                  </dt>
                  <dd className="text-end font-semibold tabular-nums text-foreground">
                    {formatDZD(plannedTotal, locale)}
                  </dd>
                </div>
              )}
              <div className="flex items-baseline justify-between gap-3">
                <dt className="text-xs text-muted-foreground">{t("programDetail.period")}</dt>
                <dd className="text-end text-xs font-medium">{periodLabel}</dd>
              </div>
            </dl>

            {program.notes && (
              <>
                <Separator />
                <div className="grid gap-1.5">
                  <span className="text-xs text-muted-foreground">
                    {t("programDetail.notes")}
                  </span>
                  <p className="text-sm leading-relaxed text-foreground">{program.notes}</p>
                </div>
              </>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
