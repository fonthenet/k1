import { fetchProfileNames, memberNameIn } from "@/lib/member-names";
import Link from "next/link";
import { getLocale, getTranslations } from "next-intl/server";
import { Target } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { requireStaff } from "@/lib/tenant";
import { childDisplayName, formatDZD } from "@/lib/format";
import type { Membership } from "@/lib/types";
import { Card, CardContent } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { EmptyState } from "@/components/shared/empty-state";
import { StaffLink } from "@/components/shared/entity-link";
import { PageHeader } from "@/components/shared/page-header";
import { StatusPill as Pill, type StatusTone } from "@/components/shared/status-pill";
import { ProgramDialog } from "@/components/modules/sessions/program-dialog";
import { ProgramStatusFilter } from "@/components/modules/sessions/program-status-filter";
import { SessionsTabs } from "@/components/modules/sessions/sessions-tabs";
import { Monogram, TypeChip } from "@/components/modules/sessions/session-ui";
import { algiersToday } from "@/components/modules/sessions/dates";
import {
  isProgramStatus,
  type ChildLite,
  type ChildOption,
  type ProgramRecord,
  type ProgramStatus,
  type TherapistOption,
} from "@/components/modules/sessions/session-types";

export const dynamic = "force-dynamic";

interface ProgramRow extends ProgramRecord {
  kg_children: ChildLite | null;
}

/**
 * The shared pill's tone for a programme in the register. Active is the
 * expected state and renders nothing — the list is mostly active programmes,
 * and a green pill on each would say nothing. The three exceptions get one
 * pill each, by meaning: done, waiting on someone, or dropped.
 */
const PROGRAM_PILL_TONE: Record<ProgramStatus, StatusTone | null> = {
  active: null,
  completed: "success",
  paused: "attention",
  cancelled: "muted",
};

/**
 * Active programmes first — the ones being worked on are read first. Within a
 * rank the query's order holds (newest first): the sort is stable, and no
 * second key is given, so a programme opened this week stays at the top of
 * its group instead of sinking to wherever its name falls in the alphabet.
 */
const PROGRAM_RANK: Record<ProgramStatus, number> = {
  active: 0,
  paused: 1,
  completed: 2,
  cancelled: 3,
};

export default async function ProgramsPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string }>;
}) {
  const ctx = await requireStaff();
  const t = await getTranslations("sessions");
  const locale = await getLocale();
  const sp = await searchParams;
  const supabase = await createClient();

  const statusFilter = isProgramStatus(sp.status) ? sp.status : "all";

  const [programsRes, sessionsRes, goalsRes, membersRes, childrenRes] = await Promise.all([
    supabase
      .from("kg_programs")
      .select(
        "id, child_id, name, session_type, therapist_id, sessions_planned, fee_per_session, " +
          "start_date, end_date, status, notes, " +
          "kg_children(id, first_name, last_name, first_name_ar, last_name_ar, kg_classes(name, name_ar))"
      )
      .eq("tenant_id", ctx.tenant.id)
      .order("created_at", { ascending: false }),
    supabase
      .from("kg_sessions")
      .select("program_id, status")
      .eq("tenant_id", ctx.tenant.id)
      .not("program_id", "is", null),
    supabase
      .from("kg_program_goals")
      .select("program_id, achieved, progress_pct")
      .eq("tenant_id", ctx.tenant.id),
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
  ]);

  if (programsRes.error) throw new Error(programsRes.error.message);

  const programs = (programsRes.data ?? []) as unknown as ProgramRow[];

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

  const doneByProgram = new Map<string, number>();
  for (const s of sessionsRes.data ?? []) {
    if (!s.program_id || s.status !== "completed") continue;
    doneByProgram.set(s.program_id, (doneByProgram.get(s.program_id) ?? 0) + 1);
  }

  const goalsByProgram = new Map<string, { total: number; achieved: number; sum: number }>();
  for (const g of goalsRes.data ?? []) {
    const agg = goalsByProgram.get(g.program_id) ?? { total: 0, achieved: 0, sum: 0 };
    agg.total += 1;
    if (g.achieved) agg.achieved += 1;
    agg.sum += g.progress_pct ?? 0;
    goalsByProgram.set(g.program_id, agg);
  }

  const visible = (
    statusFilter === "all" ? programs : programs.filter((p) => p.status === statusFilter)
  ).sort((a, b) => PROGRAM_RANK[a.status] - PROGRAM_RANK[b.status]);

  return (
    <div>
      {/* One primary per page: the thing this tab creates. */}
      <PageHeader title={t("programs.title")} description={t("programs.description")}>
        <ProgramDialog
          childrenOptions={childrenOptions}
          therapists={therapists}
          defaultDate={algiersToday()}
        />
      </PageHeader>

      <SessionsTabs />

      {programs.length === 0 ? (
        <EmptyState
          icon={<Target />}
          title={t("programs.emptyTitle")}
          description={t("programs.emptyDescription")}
        />
      ) : (
        <>
          <div className="mb-6 flex flex-wrap items-center gap-2 rounded-xl border border-border bg-card p-2.5 shadow-sm">
            <ProgramStatusFilter value={statusFilter} />
            <span className="ms-auto rounded-full bg-primary/10 px-3 py-1 text-sm font-medium tabular-nums text-primary">
              {t("programs.count", { count: visible.length })}
            </span>
          </div>

          {/* One register: the child is the door, the facts are columns.
              The status chips above used to be a row of pill buttons with a
              solid active one; a select and a count say the same thing. */}
          <Card className="border border-border py-0 shadow-sm ring-0">
            <CardContent className="px-0">
              {visible.length === 0 ? (
                <p className="px-5 py-4 text-sm text-muted-foreground">{t("programs.noMatch")}</p>
              ) : (
                <Table className="[&_td]:px-3 [&_th]:px-3 [&_td:first-child]:ps-5 [&_th:first-child]:ps-5 [&_td:last-child]:pe-5 [&_th:last-child]:pe-5">
                  <TableHeader>
                    <TableRow className="[&>th]:font-semibold">
                      <TableHead>{t("programs.table.child")}</TableHead>
                      <TableHead>{t("programs.table.program")}</TableHead>
                      <TableHead>{t("programs.table.therapist")}</TableHead>
                      <TableHead className="w-36">{t("programs.table.progress")}</TableHead>
                      <TableHead>{t("programs.table.goals")}</TableHead>
                      <TableHead className="text-end">{t("programs.table.fee")}</TableHead>
                      <TableHead>{t("programs.table.status")}</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {visible.map((p) => {
                      const childName = p.kg_children
                        ? childDisplayName(p.kg_children, locale)
                        : "—";
                      const therapistName = p.therapist_id
                        ? therapistById.get(p.therapist_id)
                        : undefined;
                      const done = doneByProgram.get(p.id) ?? 0;
                      const planned = p.sessions_planned;
                      const pct = planned && planned > 0 ? Math.min((done / planned) * 100, 100) : 0;
                      const goals = goalsByProgram.get(p.id);
                      const tone = PROGRAM_PILL_TONE[p.status];
                      return (
                        <TableRow key={p.id} className="relative h-14 transition-colors hover:bg-primary/5">
                          <TableCell>
                            <Link
                              href={`/sessions/programs/${p.id}`}
                              className="flex items-center gap-2.5 font-semibold after:absolute after:inset-0"
                            >
                              <Monogram name={childName} className="size-8" />
                              <bdi dir="auto" className="truncate">{childName}</bdi>
                            </Link>
                          </TableCell>
                          <TableCell>
                            <span className="grid justify-items-start gap-1">
                              <bdi dir="auto" className="truncate font-medium">{p.name}</bdi>
                              <TypeChip type={p.session_type} label={t(`types.${p.session_type}`)} />
                            </span>
                          </TableCell>
                          <TableCell className="text-muted-foreground">
                            {/* The second door in an overlaid row: the child's
                                cell covers the row, so the colleague's name is
                                lifted above it to reach their file. */}
                            {p.therapist_id && therapistName ? (
                              <StaffLink id={p.therapist_id} className="relative z-10">
                                <bdi dir="auto">{therapistName}</bdi>
                              </StaffLink>
                            ) : (
                              t("schedule.noTherapist")
                            )}
                          </TableCell>
                          <TableCell>
                            {/* Sessions done against the plan, in the fill bar's
                                shape: the pair as one ltr island over a 4px track
                                filled from the inline start. Always primary — a
                                programme running late is not a class running full,
                                and the number already says how far along it is. */}
                            {planned ? (
                              <span className="grid min-w-24 gap-1.5">
                                <span
                                  dir="ltr"
                                  className="justify-self-start text-sm font-semibold tabular-nums"
                                >
                                  {done}
                                  <span className="font-normal text-muted-foreground"> / {planned}</span>
                                </span>
                                <span className="block h-1 w-full overflow-hidden rounded-full bg-muted" aria-hidden>
                                  <span
                                    className="block h-full rounded-full bg-primary"
                                    style={{ width: `${pct}%` }}
                                  />
                                </span>
                              </span>
                            ) : (
                              <span className="text-muted-foreground tabular-nums">
                                {t("programs.sessionsOpen", { done })}
                              </span>
                            )}
                          </TableCell>
                          <TableCell className="whitespace-nowrap">
                            {goals && goals.total > 0 ? (
                              <>
                                <span dir="ltr" className="tabular-nums">
                                  {goals.achieved} / {goals.total}
                                </span>
                                <span className="text-muted-foreground tabular-nums">
                                  {" · "}
                                  <span dir="ltr">{Math.round(goals.sum / goals.total)} %</span>
                                </span>
                              </>
                            ) : (
                              <span className="text-muted-foreground">—</span>
                            )}
                          </TableCell>
                          <TableCell className="text-end tabular-nums">
                            {formatDZD(p.fee_per_session, locale)}
                          </TableCell>
                          <TableCell>
                            {tone && <Pill tone={tone}>{t(`programStatus.${p.status}`)}</Pill>}
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}
