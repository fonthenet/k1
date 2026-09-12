import { fetchProfileNames, memberNameIn } from "@/lib/member-names";
import { Fragment } from "react";
import { getLocale, getTranslations } from "next-intl/server";
import { CalendarClock, CalendarX2, CheckCircle2, Target } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { requireStaff } from "@/lib/tenant";
import { isOpenDayStr, toOpeningHours } from "@/lib/week";
import { childDisplayName } from "@/lib/format";
import type { Membership } from "@/lib/types";
import { Card, CardContent } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { EmptyState } from "@/components/shared/empty-state";
import { PageHeader } from "@/components/shared/page-header";
import { StatCard } from "@/components/shared/stat-card";
import { NewSessionDialog } from "@/components/modules/sessions/new-session-dialog";
import { roomName } from "@/components/modules/classes/class-types";
import { readRoomChoices } from "@/components/modules/rooms/occupancy-data";
import { ScheduleToolbar } from "@/components/modules/sessions/schedule-toolbar";
import { SessionRow } from "@/components/modules/sessions/session-row";
import { SessionsTabs } from "@/components/modules/sessions/sessions-tabs";
import {
  algiersDate,
  algiersRange,
  algiersToday,
  isValidDateStr,
  shortDayLabel,
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
  room_id: string | null;
  kg_children: ChildLite | null;
  kg_rooms: { name: string; name_ar: string | null } | null;
}

const SESSION_SELECT =
  "id, child_id, program_id, session_type, therapist_id, scheduled_at, duration_min, status, progress_rating, published, room_id, " +
  "kg_children(id, first_name, last_name, first_name_ar, last_name_ar, kg_classes(name, name_ar)), " +
  "kg_rooms(name, name_ar)";

export default async function SessionsPage({
  searchParams,
}: {
  searchParams: Promise<{ view?: string; date?: string; therapist?: string; type?: string }>;
}) {
  const ctx = await requireStaff();
  const openingHours = toOpeningHours(
    (ctx.tenant as { opening_hours?: unknown }).opening_hours
  );
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
    roomChoices,
  ] = await Promise.all([
    scheduleQuery,
    supabase
      .from("kg_memberships")
      .select("id, user_id, full_name")
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
    // The building's rooms for the dialog, which reads the ledger for its
    // own day once it opens. Never narrowed by the rail: a room is the same
    // room to every structure.
    readRoomChoices(supabase, ctx, locale),
  ]);

  if (scheduleRes.error) throw new Error(scheduleRes.error.message);

  const sessions = (scheduleRes.data ?? []) as unknown as ScheduleSession[];

  const members = (membersRes.data ?? []) as Pick<
    Membership,
    "id" | "user_id" | "full_name"
  >[];
  const nameByUser = await fetchProfileNames(supabase, members.map((m) => m.user_id));
  const therapists: TherapistOption[] = members
    .map((m) => ({ id: m.id, name: memberNameIn(m, nameByUser) ?? "—" }))
    .sort((a, b) => a.name.localeCompare(b.name, locale));
  const therapistById = new Map(therapists.map((th) => [th.id, th.name]));

  const childrenOptions: ChildOption[] = (childrenRes.data ?? []).map((c) => ({
    id: c.id,
    name: childDisplayName(c, locale),
  }));
  const programs = (programsRes.data ?? []) as ProgramOption[];

  // The sessions of the range under their day, in order. Only days that
  // hold a session are kept: a week is drawn as group rows inside one table,
  // and an empty day — a weekend or a quiet Tuesday — is not a row worth
  // reading. Today gets its word next to the date, not an empty group.
  const byDay = new Map<string, ScheduleSession[]>();
  for (const s of sessions) {
    const key = algiersDate(s.scheduled_at);
    const list = byDay.get(key) ?? [];
    list.push(s);
    byDay.set(key, list);
  }
  const days = [...byDay.keys()].sort();

  const renderRow = (s: ScheduleSession, muted: boolean) => {
    const cls = s.kg_children?.kg_classes;
    return (
      <SessionRow
        key={s.id}
        session={{ ...s, room: s.kg_rooms ? roomName(s.kg_rooms, locale) : null }}
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
      {/* One primary per page: the thing this tab creates. */}
      <PageHeader title={t("title")} description={t("description")}>
        <NewSessionDialog
          childrenOptions={childrenOptions}
          therapists={therapists}
          programs={programs}
          defaultDate={date}
          rooms={roomChoices.rooms}
          homeClasses={roomChoices.homeClasses}
        />
      </PageHeader>

      <SessionsTabs />

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
        today={today}
        therapists={therapists}
        therapist={therapistFilter}
        type={typeFilter}
        count={sessions.length}
      />

      {sessions.length === 0 ? (
        <EmptyState
          icon={<CalendarClock />}
          title={t("schedule.emptyTitle")}
          description={t("schedule.emptyDescription")}
        />
      ) : (
        // One register for both views. A day is the rows alone — the date
        // is already said once, in the filter card. A week adds a group row
        // per day, inside the same table, where a card per day used to leave
        // five empty frames around two sessions.
        <Card className="border border-border py-0 shadow-sm ring-0">
          <CardContent className="px-0">
            <Table className="[&_td]:px-3 [&_th]:px-3 [&_td:first-child]:ps-5 [&_th:first-child]:ps-5 [&_td:last-child]:pe-5 [&_th:last-child]:pe-5">
              <TableHeader>
                <TableRow className="[&>th]:font-semibold">
                  <TableHead className="w-28">{t("schedule.columns.time")}</TableHead>
                  <TableHead>{t("programs.table.child")}</TableHead>
                  <TableHead>{t("programs.table.therapist")}</TableHead>
                  <TableHead>{t("detail.type")}</TableHead>
                  <TableHead>{t("detail.duration")}</TableHead>
                  <TableHead>{t("programs.table.status")}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {days.map((day) => {
                  const rows = byDay.get(day) ?? [];
                  const closed = !isOpenDayStr(openingHours, day);
                  return (
                    <Fragment key={day}>
                      {view === "week" && (
                        <TableRow className="bg-muted/30 hover:bg-muted/30">
                          <TableCell colSpan={6} className="py-1.5 text-xs">
                            <span className="flex items-center gap-2">
                              <span className="font-semibold">{shortDayLabel(day, locale)}</span>
                              {day === today && (
                                <span className="text-muted-foreground">· {t("dates.today")}</span>
                              )}
                              <span className="text-muted-foreground tabular-nums">
                                {t("filters.count", { count: rows.length })}
                              </span>
                            </span>
                          </TableCell>
                        </TableRow>
                      )}
                      {rows.map((s) => renderRow(s, closed))}
                    </Fragment>
                  );
                })}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
