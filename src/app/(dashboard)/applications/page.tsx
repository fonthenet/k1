// Admissions: every family from first enquiry to enrolment, as ONE table
// grouped by stage. Enrolment itself runs through the record page
// (kg_approve_and_bill); the board only moves files between stages.

import Link from "next/link";
import { getLocale, getTranslations } from "next-intl/server";
import { ChevronRight, Inbox, TriangleAlert } from "lucide-react";
import { requireStaff, scoped } from "@/lib/tenant";
import { createClient } from "@/lib/supabase/server";
import { indexDossierSummary, loadDossierSummary } from "@/lib/dossier-server";
import { ageFromDob, childDisplayName, formatDate, formatTime, initials } from "@/lib/format";
import { cn } from "@/lib/utils";
import { PageHeader } from "@/components/shared/page-header";
import { EmptyState } from "@/components/shared/empty-state";
import { ClassChip } from "@/components/shared/class-chip";
import { StatusPill } from "@/components/shared/status-pill";
import { StructureMark } from "@/components/shared/structure-mark";
import { ChildLink } from "@/components/shared/entity-link";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Card } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { StageMenu } from "@/components/modules/enroll/stage-menu";
import { WaitlistControls } from "@/components/modules/enroll/waitlist-controls";
import { SIBLING_SOURCE, structureRefName } from "@/components/modules/enroll/application-card";
import { byWaitlistOrder, type PipelineStatus } from "@/components/modules/enroll/types";
import {
  isTransferApplication,
  type ReviewApplication,
} from "@/components/modules/enroll/review-types";

/**
 * The groups of the board, in the order a family moves through them. The
 * waitlist is a stage like the others — a parked file is still a file to
 * call back — and refused files close the table, shown only when there are
 * any. Approved files are not on the board at all: they are children now,
 * and the roster is where children live.
 */
const BOARD_STAGES = ["submitted", "under_review", "interview", "offered", "waitlist"] as const;
type BoardStage = (typeof BOARD_STAGES)[number] | "rejected";

export default async function ApplicationsPage() {
  const ctx = await requireStaff();
  const [t, tc, locale] = await Promise.all([
    getTranslations("enroll"),
    getTranslations("common.labels"),
    getLocale(),
  ]);
  const supabase = await createClient();

  // A family applies to a structure, not to the building — the link they were
  // given carries it (0136). Narrowing here is what lets the école's
  // registrar work through their own queue without reading the crèche's.
  // The structure and the requested class come embedded so each row can say
  // which side of the building it is for, by colour and name, without a
  // second read per row. A transfer request (0140) is scoped by the structure
  // the family wants to move TO — the one whose registrar needs to see it.
  // The enrolment file rides along as one grouped read (0164): accepted
  // papers over required ones per open application, and how many wait on a
  // human. Unscoped on purpose — the rows below decide what is shown.
  const [{ data, error }, summaryRows] = await Promise.all([
    scoped(
      supabase
        .from("kg_applications")
        .select(
          "*, kg_structures(id, name, name_ar, color, center_type), kg_classes(id, name, name_ar, structure_id, color)"
        )
        .eq("tenant_id", ctx.tenant.id)
        .order("created_at", { ascending: false }),
      ctx
    ),
    loadDossierSummary(supabase, ctx.tenant.id),
  ]);

  if (error) {
    return (
      <div className="space-y-6">
        <PageHeader title={t("admin.title")} description={t("admin.description")} />
        <Alert variant="destructive">
          <TriangleAlert />
          <AlertTitle>{t("admin.errorTitle")}</AlertTitle>
          <AlertDescription>{t("admin.error")}</AlertDescription>
        </Alert>
      </div>
    );
  }

  const { byApplication } = indexDossierSummary(summaryRows);
  const apps = ((data ?? []) as unknown as ReviewApplication[]).map((app) => ({
    ...app,
    dossier: byApplication.get(app.id) ?? null,
  }));
  const canManage = ctx.isAdmin;
  // The structure column only means something when there is a choice of
  // structure; on a single-structure crèche every row would carry the same word.
  const showStructure = ctx.isMultiStructure;
  // The Dossier column exists only once the register is switched on: the
  // summary scores a file only for a kind with an active required paper, so
  // a tenant that never activated its list sees no column at all (D14).
  const showDossier = apps.some((app) => app.dossier !== null);

  const byStage = new Map<BoardStage, ReviewApplication[]>(
    [...BOARD_STAGES, "rejected" as const].map((s) => [s, apps.filter((a) => a.status === s)])
  );
  byStage.get("waitlist")!.sort(byWaitlistOrder);
  const approved = apps.filter((a) => a.status === "approved");
  const onBoard = apps.length - approved.length;

  const groups: BoardStage[] = [
    ...BOARD_STAGES,
    ...(byStage.get("rejected")!.length > 0 ? (["rejected"] as const) : []),
  ];
  // Enfant · âge · structure · classe · dossier · origine · reçue · suivi · menu
  const columns = 6 + (showStructure ? 1 : 0) + (showDossier ? 1 : 0) + (canManage ? 1 : 0);
  // With the Dossier column in, the table no longer fits 1024 without
  // clipping its last column; the origin word is the one the reviewer can
  // do without at that width, so it steps aside until xl.
  const sourceClass = showDossier ? "hidden xl:table-cell" : undefined;

  /** The one word that says where a file came from, when it changes what
   *  approval does or how the family was met. The public link is the default
   *  channel and says nothing. */
  const sourceWord = (app: ReviewApplication): React.ReactNode => {
    if (isTransferApplication(app) && app.existing_child_id) {
      return (
        <ChildLink id={app.existing_child_id} className="relative z-10">
          {t("admin.sourceTransfer")}
        </ChildLink>
      );
    }
    if (app.source === SIBLING_SOURCE) return t("admin.sourceSibling");
    if (!app.source || app.source === "link" || app.source === "online") return null;
    return t.has(`source.${app.source}`) ? t(`source.${app.source}`) : app.source;
  };

  /** What the reviewer has to do next with this file, if the stage alone does not say. */
  const followUp = (app: ReviewApplication, rank: number): React.ReactNode => {
    if (app.status === "interview") {
      return app.interview_at ? (
        <span className="text-muted-foreground">
          {formatDate(app.interview_at, locale)} · {formatTime(app.interview_at, locale)}
        </span>
      ) : (
        <StatusPill tone="attention">{t("admin.interviewToSchedule")}</StatusPill>
      );
    }
    if (app.status === "waitlist") {
      return <span className="text-muted-foreground">{t("admin.waitlistRank", { rank })}</span>;
    }
    // A paper the family sent and nobody has looked at. After the stage's
    // own follow-up, so a row never carries two pills.
    if (app.dossier && app.dossier.pending > 0) {
      return <StatusPill tone="attention">{t("admin.documentsToReview")}</StatusPill>;
    }
    return null;
  };

  return (
    <div className="space-y-6">
      <PageHeader title={t("admin.title")} description={t("admin.description")} />

      {onBoard === 0 ? (
        <EmptyState icon={<Inbox />} title={t("admin.emptyTitle")} description={t("admin.emptyDesc")} />
      ) : (
        <Card className="overflow-hidden py-0 shadow-sm">
          <Table>
            <TableHeader>
              <TableRow className="[&>th]:font-medium [&>th]:text-muted-foreground">
                <TableHead>{t("admin.columns.child")}</TableHead>
                <TableHead>{t("admin.columns.age")}</TableHead>
                {showStructure && <TableHead>{t("admin.columns.structure")}</TableHead>}
                <TableHead>{t("admin.columns.requestedClass")}</TableHead>
                {showDossier && <TableHead>{t("admin.columns.dossier")}</TableHead>}
                <TableHead className={sourceClass}>{t("admin.columns.source")}</TableHead>
                <TableHead>{t("admin.columns.received")}</TableHead>
                <TableHead>{t("admin.columns.followUp")}</TableHead>
                {canManage && (
                  <TableHead className="w-20">
                    <span className="sr-only">{t("admin.rowActions")}</span>
                  </TableHead>
                )}
              </TableRow>
            </TableHeader>
            <TableBody>
              {groups.map((stage) => {
                const rows = byStage.get(stage)!;
                return [
                  // The stage is said once, here, in a group row — never as
                  // a pill on every row beneath it. An empty stage stays as
                  // one quiet line so the process still reads top to bottom.
                  <TableRow
                    key={`group:${stage}`}
                    className={cn("bg-muted/30 hover:bg-muted/30", rows.length === 0 && "opacity-60")}
                  >
                    <TableCell
                      colSpan={columns}
                      className="h-9 py-0 text-xs font-semibold tracking-wide text-muted-foreground"
                    >
                      {t(`admin.stages.${stage}`)}
                      <span className="ms-2 font-normal tabular-nums" dir="ltr">
                        {rows.length}
                      </span>
                      {stage === "waitlist" && rows.length > 1 && (
                        <span className="ms-2 font-normal tracking-normal">
                          · {t("pipeline.waitlistHint")}
                        </span>
                      )}
                    </TableCell>
                  </TableRow>,
                  ...rows.map((app, i) => {
                    const child = app.child;
                    const name = childDisplayName(
                      {
                        first_name: child.first_name ?? "",
                        last_name: child.last_name ?? "",
                        first_name_ar: child.first_name_ar,
                        last_name_ar: child.last_name_ar,
                      },
                      locale
                    );
                    // The name in the other script, only when it is a
                    // different string — the seed's Latin names are often
                    // already Arabic, and printing them twice says nothing.
                    const other =
                      locale === "ar"
                        ? `${child.first_name ?? ""} ${child.last_name ?? ""}`.trim()
                        : `${child.first_name_ar ?? ""} ${child.last_name_ar ?? ""}`.trim();
                    const secondary = other && other !== name ? other : null;
                    const structure = showStructure ? (app.kg_structures ?? null) : null;
                    const cls = app.kg_classes ?? null;
                    const source = sourceWord(app);
                    const note = stage === "rejected" ? app.review_note : null;
                    return (
                      <TableRow key={app.id} className="relative h-14 hover:bg-primary/5">
                        <TableCell>
                          <Link
                            href={`/applications/${app.id}`}
                            className="flex items-center gap-3 after:absolute after:inset-0"
                          >
                            <Avatar className="size-10 ring-1 ring-border">
                              <AvatarFallback className="bg-primary/10 font-semibold text-primary">
                                {initials(child.first_name ?? "", child.last_name ?? "")}
                              </AvatarFallback>
                            </Avatar>
                            <span className="min-w-0">
                              <span className="block truncate font-semibold">{name}</span>
                              {(secondary || note) && (
                                <bdi
                                  dir="auto"
                                  className="block max-w-72 truncate text-xs text-muted-foreground text-start"
                                >
                                  {note ?? secondary}
                                </bdi>
                              )}
                            </span>
                          </Link>
                        </TableCell>
                        <TableCell className="text-muted-foreground">
                          {child.dob ? ageFromDob(child.dob, tc) : "—"}
                        </TableCell>
                        {showStructure && (
                          <TableCell>
                            <StructureMark
                              structure={
                                structure
                                  ? { name: structureRefName(structure, locale), color: structure.color }
                                  : null
                              }
                            />
                          </TableCell>
                        )}
                        <TableCell>
                          {cls ? (
                            <ClassChip name={structureRefName(cls, locale)} color={cls.color} />
                          ) : (
                            <span className="text-muted-foreground">—</span>
                          )}
                        </TableCell>
                        {showDossier && (
                          <TableCell>
                            {/* Accepted over required, as an ltr island so
                                "3 / 7" never reads "7 / 3". A file without a
                                score — its kind asks for nothing, or the
                                file is closed — shows a dash. */}
                            {app.dossier ? (
                              <span dir="ltr" className="tabular-nums text-muted-foreground">
                                {app.dossier.accepted} / {app.dossier.required}
                              </span>
                            ) : (
                              <span className="text-muted-foreground">—</span>
                            )}
                          </TableCell>
                        )}
                        <TableCell className={cn("text-muted-foreground", sourceClass)}>{source}</TableCell>
                        <TableCell className="tabular-nums text-muted-foreground">
                          {formatDate(app.created_at, locale)}
                        </TableCell>
                        <TableCell>{followUp(app, i + 1)}</TableCell>
                        {canManage && (
                          <TableCell className="text-end">
                            {/* Lifted above the row-wide link overlay, or
                                every click on the menu would open the file. */}
                            <span className="relative z-10 inline-flex items-center justify-end gap-0.5">
                              {stage === "waitlist" && (
                                <WaitlistControls
                                  appId={app.id}
                                  isFirst={i === 0}
                                  isLast={i === rows.length - 1}
                                />
                              )}
                              <StageMenu
                                appId={app.id}
                                status={app.status as PipelineStatus}
                                interviewAt={app.interview_at}
                                trigger="overflow"
                              />
                            </span>
                          </TableCell>
                        )}
                      </TableRow>
                    );
                  }),
                ];
              })}
            </TableBody>
          </Table>
          {/* Approved files have left the board — they are children now. One
              line says how many, and where they went. */}
          {approved.length > 0 && (
            <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border px-4 py-3 text-sm text-muted-foreground">
              <span>{t("admin.approvedCount", { count: approved.length })}</span>
              <Link
                href="/children"
                className="inline-flex items-center gap-1 text-sm text-primary hover:underline"
              >
                {t("admin.seeChildren")}
                <ChevronRight className="size-4 rtl:rotate-180" aria-hidden />
              </Link>
            </div>
          )}
        </Card>
      )}

      {onBoard === 0 && approved.length > 0 && (
        <p className="text-sm text-muted-foreground">
          {t("admin.approvedCount", { count: approved.length })}{" "}
          <Link href="/children" className="text-primary hover:underline">
            {t("admin.seeChildren")}
          </Link>
        </p>
      )}
    </div>
  );
}
