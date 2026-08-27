import Link from "next/link";
import { getLocale, getTranslations } from "next-intl/server";
import { ChevronLeft, ChevronRight, Target } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { requireStaff } from "@/lib/tenant";
import { childDisplayName, formatDZD } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { Membership } from "@/lib/types";
import { Badge } from "@/components/ui/badge";
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
import { PageHeader } from "@/components/shared/page-header";
import { ProgramDialog } from "@/components/modules/sessions/program-dialog";
import { SessionsTabs } from "@/components/modules/sessions/sessions-tabs";
import {
  MeterRow,
  Monogram,
  ProgramStatusPill,
  TypeChip,
} from "@/components/modules/sessions/session-ui";
import { algiersToday } from "@/components/modules/sessions/dates";
import {
  PROGRAM_STATUSES,
  isProgramStatus,
  type ChildLite,
  type ChildOption,
  type ProgramRecord,
  type TherapistOption,
} from "@/components/modules/sessions/session-types";

export const dynamic = "force-dynamic";

interface ProgramRow extends ProgramRecord {
  kg_children: ChildLite | null;
}

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
  ]);

  if (programsRes.error) throw new Error(programsRes.error.message);

  const programs = (programsRes.data ?? []) as unknown as ProgramRow[];

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

  const counts = new Map<string, number>();
  for (const p of programs) counts.set(p.status, (counts.get(p.status) ?? 0) + 1);

  const visible =
    statusFilter === "all" ? programs : programs.filter((p) => p.status === statusFilter);

  const Chevron = locale === "ar" ? ChevronLeft : ChevronRight;

  const chips: { value: string; label: string; count: number }[] = [
    { value: "all", label: t("programs.all"), count: programs.length },
    ...PROGRAM_STATUSES.map((s) => ({
      value: s,
      label: t(`programStatus.${s}`),
      count: counts.get(s) ?? 0,
    })),
  ];

  return (
    <div>
      <PageHeader title={t("programs.title")} description={t("programs.description")}>
        <SessionsTabs active="programs" />
        <ProgramDialog
          childrenOptions={childrenOptions}
          therapists={therapists}
          defaultDate={algiersToday()}
        />
      </PageHeader>

      {programs.length === 0 ? (
        <EmptyState
          icon={<Target />}
          title={t("programs.emptyTitle")}
          description={t("programs.emptyDescription")}
        />
      ) : (
        <>
          <div className="mb-4 flex flex-wrap items-center gap-1.5">
            {chips.map((c) => {
              const active = statusFilter === c.value;
              return (
                <Link
                  key={c.value}
                  href={c.value === "all" ? "/sessions/programs" : `/sessions/programs?status=${c.value}`}
                  scroll={false}
                  className="rounded-4xl outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
                >
                  <Badge
                    variant={active ? "default" : "outline"}
                    className={cn(
                      "h-7 gap-1.5 px-3 text-xs font-medium transition-colors",
                      active
                        ? "shadow-sm"
                        : "bg-card text-muted-foreground hover:border-primary/30 hover:bg-primary/5 hover:text-foreground"
                    )}
                  >
                    {c.label}
                    <span
                      className={cn(
                        "rounded-4xl px-1.5 tabular-nums",
                        active ? "bg-primary-foreground/20" : "bg-muted"
                      )}
                    >
                      {c.count}
                    </span>
                  </Badge>
                </Link>
              );
            })}
          </div>

          <Card className="border border-border py-0 shadow-sm ring-0">
            <CardContent className="p-0">
              {visible.length === 0 ? (
                <p className="px-5 py-10 text-center text-sm text-muted-foreground">
                  {t("programs.noMatch")}
                </p>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow className="bg-muted/40 hover:bg-muted/40">
                      <TableHead className="text-start">{t("programs.table.child")}</TableHead>
                      <TableHead className="text-start">{t("programs.table.program")}</TableHead>
                      <TableHead className="text-start">{t("programs.table.therapist")}</TableHead>
                      <TableHead className="w-44 text-start">
                        {t("programs.table.progress")}
                      </TableHead>
                      <TableHead className="w-44 text-start">{t("programs.table.goals")}</TableHead>
                      <TableHead className="text-end">{t("programs.table.fee")}</TableHead>
                      <TableHead className="text-start">{t("programs.table.status")}</TableHead>
                      <TableHead className="w-10" />
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {visible.map((p) => {
                      const childName = p.kg_children
                        ? childDisplayName(p.kg_children, locale)
                        : "—";
                      const done = doneByProgram.get(p.id) ?? 0;
                      const planned = p.sessions_planned;
                      const pct = planned && planned > 0 ? (done / planned) * 100 : 0;
                      const goals = goalsByProgram.get(p.id);
                      return (
                        <TableRow key={p.id} className="hover:bg-primary/5">
                          <TableCell>
                            <Link
                              href={`/sessions/programs/${p.id}`}
                              className="flex items-center gap-2.5"
                            >
                              <Monogram name={childName} className="size-8" />
                              <span className="truncate font-medium text-foreground">
                                {childName}
                              </span>
                            </Link>
                          </TableCell>
                          <TableCell>
                            <Link href={`/sessions/programs/${p.id}`} className="grid gap-1.5">
                              <span className="truncate font-medium text-foreground">
                                {p.name}
                              </span>
                              <TypeChip
                                type={p.session_type}
                                label={t(`types.${p.session_type}`)}
                                className="w-fit"
                              />
                            </Link>
                          </TableCell>
                          <TableCell className="text-muted-foreground">
                            {(p.therapist_id && therapistById.get(p.therapist_id)) ||
                              t("schedule.noTherapist")}
                          </TableCell>
                          <TableCell>
                            <MeterRow
                              label={t("programs.table.progress")}
                              value={
                                planned
                                  ? t("programs.sessionsDone", { done, planned })
                                  : t("programs.sessionsOpen", { done })
                              }
                              pct={pct}
                            />
                          </TableCell>
                          <TableCell>
                            {goals && goals.total > 0 ? (
                              <MeterRow
                                label={t("programs.goalsDone", {
                                  done: goals.achieved,
                                  total: goals.total,
                                })}
                                value={`${Math.round(goals.sum / goals.total)}%`}
                                pct={goals.sum / goals.total}
                                tone="success"
                              />
                            ) : (
                              <span className="text-xs text-muted-foreground">
                                {t("programs.noGoals")}
                              </span>
                            )}
                          </TableCell>
                          <TableCell className="text-end font-medium tabular-nums">
                            {formatDZD(p.fee_per_session, locale)}
                          </TableCell>
                          <TableCell>
                            <ProgramStatusPill
                              status={p.status}
                              label={t(`programStatus.${p.status}`)}
                            />
                          </TableCell>
                          <TableCell>
                            <Link
                              href={`/sessions/programs/${p.id}`}
                              className="grid place-items-center text-muted-foreground hover:text-primary"
                              aria-label={p.name}
                            >
                              <Chevron className="size-4" />
                            </Link>
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
