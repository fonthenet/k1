import { getLocale, getTranslations } from "next-intl/server";
import { CalendarClock, CalendarX2, CheckCircle2, Target } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { requireStaff } from "@/lib/tenant";
import { childDisplayName } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { Membership } from "@/lib/types";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { EmptyState } from "@/components/shared/empty-state";
import { PageHeader } from "@/components/shared/page-header";
import { StatCard } from "@/components/shared/stat-card";
import { NewSessionDialog } from "@/components/modules/sessions/new-session-dialog";
import { ScheduleToolbar } from "@/components/modules/sessions/schedule-toolbar";
import { SessionRow } from "@/components/modules/sessions/session-row";
import { SessionsTabs } from "@/components/modules/sessions/sessions-tabs";
import {
  algiersDate,
  algiersRange,
  algiersToday,
  isValidDateStr,
  isWeekendStr,
  longDateLabel,
  shortDayLabel,
  weekDays,
  weekRangeLabel,
  weekStartStr,
} from "@/components/modules/sessions/dates";
import {
  isSessionType,
  type ChildLite,
  type ChildOption,
  type ProgramOption,
  type SessionStatus,
  type SessionType,
  type TherapistOption,
} from "@/components/modules/sessions/session-types";

export const dynamic = "force-dynamic";

interface ScheduleSession {
  id: string;
  child_id: string;
  program_id: string | null;
  session_type: SessionType;
  therapist_id: string | null;
  scheduled_at: string;
  duration_min: number;
  status: SessionStatus;
  progress_rating: number | null;
  published: boolean;
  kg_children: ChildLite | null;
}

const SESSION_SELECT =
  "id, child_id, program_id, session_type, therapist_id, scheduled_at, duration_min, status, progress_rating, published, " +
  "kg_children(id, first_name, last_name, first_name_ar, last_name_ar, kg_classes(name, name_ar))";

export default async function SessionsPage({
  searchParams,
}: {
  searchParams: Promise<{ view?: string; date?: string; therapist?: string; type?: string }>;
}) {
  const ctx = await requireStaff();
  const t = await getTranslations("sessions");
  const locale = await getLocale();
  const sp = await searchParams;
  const supabase = await createClient();

  const today = algiersToday();
  const view: "day" | "week" = sp.view === "week" ? "week" : "day";
  const date = isValidDateStr(sp.date) ? sp.date : today;
  const therapistFilter = sp.therapist && sp.therapist !== "all" ? sp.therapist : "all";
  const typeFilter = isSessionType(sp.type) ? sp.type : "all";

  const rangeStart = view === "week" ? weekStartStr(date) : date;
  const rangeDays = view === "week" ? 7 : 1;
  const range = algiersRange(rangeStart, rangeDays);

  let scheduleQuery = supabase
    .from("kg_sessions")
    .select(SESSION_SELECT)
    .eq("tenant_id", ctx.tenant.id)
    .gte("scheduled_at", range.from)
    .lt("scheduled_at", range.to)
    .order("scheduled_at");
  if (therapistFilter === "none") scheduleQuery = scheduleQuery.is("therapist_id", null);
  else if (therapistFilter !== "all")
    scheduleQuery = scheduleQuery.eq("therapist_id", therapistFilter);
  if (typeFilter !== "all") scheduleQuery = scheduleQuery.eq("session_type", typeFilter);

  const todayRange = algiersRange(today, 1);
  const currentWeek = algiersRange(weekStartStr(today), 7);

  const [
    scheduleRes,
    membersRes,
    childrenRes,
    programsRes,
    todayCountRes,
    completedRes,
    noShowRes,
    activeProgramsRes,
  ] = await Promise.all([
    scheduleQuery,
    supabase
      .from("kg_memberships")
      .select("id, user_id")
      .eq("tenant_id", ctx.tenant.id)
      .eq("status", "active")
      .neq("role", "parent"),
    supabase
      .from("kg_children")
      .select("id, first_name, last_name, first_name_ar, last_name_ar")
      .eq("tenant_id", ctx.tenant.id)
      .eq("status", "enrolled")
      .order("first_name")
      .order("last_name"),
    supabase
      .from("kg_programs")
      .select("id, name, child_id, session_type, therapist_id")
      .eq("tenant_id", ctx.tenant.id)
      .eq("status", "active")
      .order("name"),
    supabase
      .from("kg_sessions")
      .select("id", { count: "exact", head: true })
      .eq("tenant_id", ctx.tenant.id)
      .gte("scheduled_at", todayRange.from)
      .lt("scheduled_at", todayRange.to),
    supabase
      .from("kg_sessions")
      .select("id", { count: "exact", head: true })
      .eq("tenant_id", ctx.tenant.id)
      .eq("status", "completed")
      .gte("scheduled_at", currentWeek.from)
      .lt("scheduled_at", currentWeek.to),
    supabase
      .from("kg_sessions")
      .select("id", { count: "exact", head: true })
      .eq("tenant_id", ctx.tenant.id)
      .eq("status", "no_show")
      .gte("scheduled_at", currentWeek.from)
      .lt("scheduled_at", currentWeek.to),
    supabase
      .from("kg_programs")
      .select("id", { count: "exact", head: true })
      .eq("tenant_id", ctx.tenant.id)
      .eq("status", "active"),
  ]);

  if (scheduleRes.error) throw new Error(scheduleRes.error.message);

  const sessions = (scheduleRes.data ?? []) as unknown as ScheduleSession[];

  // kg_memberships points at auth.users, not kg_profiles — resolve names separately.
  const members = (membersRes.data ?? []) as Pick<Membership, "id" | "user_id">[];
  const userIds = members.map((m) => m.user_id);
  const { data: profiles } = userIds.length
    ? await supabase.from("kg_profiles").select("id, full_name").in("id", userIds)
    : { data: [] as { id: string; full_name: string }[] };
  const nameByUser = new Map((profiles ?? []).map((p) => [p.id, p.full_name]));
  const therapists: TherapistOption[] = members
    .map((m) => ({ id: m.id, name: nameByUser.get(m.user_id) || "—" }))
    .sort((a, b) => a.name.localeCompare(b.name, locale));
  const therapistById = new Map(therapists.map((th) => [th.id, th.name]));

  const childrenOptions: ChildOption[] = (childrenRes.data ?? []).map((c) => ({
    id: c.id,
    name: childDisplayName(c, locale),
  }));
  const programs = (programsRes.data ?? []) as ProgramOption[];

  const days = view === "week" ? weekDays(rangeStart) : [rangeStart];
  const byDay = new Map<string, ScheduleSession[]>(days.map((d) => [d, []]));
  for (const s of sessions) {
    const key = algiersDate(s.scheduled_at);
    byDay.get(key)?.push(s);
  }

  const label = view === "week" ? weekRangeLabel(rangeStart, locale) : longDateLabel(date, locale);

  const renderRow = (s: ScheduleSession, muted: boolean) => {
    const cls = s.kg_children?.kg_classes;
    return (
      <SessionRow
        key={s.id}
        session={s}
        childName={s.kg_children ? childDisplayName(s.kg_children, locale) : "—"}
        classLabel={
          cls ? (locale === "ar" && cls.name_ar ? cls.name_ar : cls.name) : t("schedule.noClass")
        }
        therapistName={
          (s.therapist_id && therapistById.get(s.therapist_id)) || t("schedule.noTherapist")
        }
        muted={muted}
      />
    );
  };

  return (
    <div>
      <PageHeader title={t("title")} description={t("description")}>
        <SessionsTabs active="schedule" />
        <NewSessionDialog
          childrenOptions={childrenOptions}
          therapists={therapists}
          programs={programs}
          defaultDate={date}
        />
      </PageHeader>

      <div className="mb-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          label={t("stats.today")}
          value={todayCountRes.count ?? 0}
          hint={t("stats.todayHint")}
          icon={<CalendarClock className="size-5" />}
        />
        <StatCard
          label={t("stats.completed")}
          value={completedRes.count ?? 0}
          hint={t("stats.completedHint")}
          icon={<CheckCircle2 className="size-5" />}
          tone="success"
        />
        <StatCard
          label={t("stats.noShows")}
          value={noShowRes.count ?? 0}
          hint={t("stats.noShowsHint")}
          icon={<CalendarX2 className="size-5" />}
          tone="danger"
        />
        <StatCard
          label={t("stats.programs")}
          value={activeProgramsRes.count ?? 0}
          hint={t("stats.programsHint")}
          icon={<Target className="size-5" />}
          tone="gold"
        />
      </div>

      <ScheduleToolbar
        view={view}
        date={date}
        label={label}
        today={today}
        therapists={therapists}
        therapist={therapistFilter}
        type={typeFilter}
      />

      {sessions.length === 0 ? (
        <EmptyState
          icon={<CalendarClock />}
          title={t("schedule.emptyTitle")}
          description={t("schedule.emptyDescription")}
        />
      ) : view === "day" ? (
        <Card className="border border-border py-0 shadow-sm ring-0">
          <CardContent className="grid gap-2 p-3">
            {(byDay.get(rangeStart) ?? []).map((s) => renderRow(s, false))}
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-4">
          {days.map((day) => {
            const rows = byDay.get(day) ?? [];
            const weekend = isWeekendStr(day);
            return (
              <section
                key={day}
                className={cn(
                  "overflow-hidden rounded-2xl border",
                  weekend ? "border-dashed border-border bg-muted/20" : "border-border bg-card"
                )}
              >
                <header
                  className={cn(
                    "flex flex-wrap items-center gap-2 border-b border-border px-4 py-2.5",
                    weekend ? "bg-transparent" : "bg-muted/40"
                  )}
                >
                  <h3
                    className={cn(
                      "text-sm font-semibold",
                      weekend ? "text-muted-foreground" : "text-foreground"
                    )}
                  >
                    {shortDayLabel(day, locale)}
                  </h3>
                  {day === today && (
                    <Badge className="border-transparent bg-primary/10 font-medium text-primary">
                      {t("dates.today")}
                    </Badge>
                  )}
                  {weekend && (
                    <Badge className="border-transparent bg-muted font-medium text-muted-foreground">
                      {t("dates.weekend")}
                    </Badge>
                  )}
                  {rows.length > 0 && (
                    <span className="ms-auto rounded-4xl bg-muted px-2 py-0.5 text-xs font-semibold tabular-nums text-foreground">
                      {rows.length}
                    </span>
                  )}
                </header>
                <div className="grid gap-2 p-3">
                  {rows.length === 0 ? (
                    <p className="px-1 py-2 text-xs text-muted-foreground">
                      {t("schedule.noSessions")}
                    </p>
                  ) : (
                    rows.map((s) => renderRow(s, weekend))
                  )}
                </div>
              </section>
            );
          })}
        </div>
      )}
    </div>
  );
}
