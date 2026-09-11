import Link from "next/link";
import { LearningDateField } from "@/components/modules/learning/date-field";
import { FormSelect } from "@/components/shared/form-select";
import { SessionEditor } from "@/components/modules/learning/session-editor";
import { getTranslations } from "next-intl/server";
import { PageHeader } from "@/components/shared/page-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ValueRange } from "@/components/shared/value-range";
import { learningContext } from "@/components/modules/learning/data";
import {
  ProgramForm,
  AssessmentForm,
  StateButton,
} from "@/components/modules/learning/forms";
import {
  date,
  algiersToday,
  weekStart,
  addDays,
  learningProfile,
  type Program,
  type Lesson,
  type Assessment,
} from "@/components/modules/learning/domain";
import { workspaceType } from "@/components/modules/settings/workspace-profile";

export default async function LearningPage({
  searchParams,
}: {
  searchParams: Promise<{ week?: string; class?: string; tab?: string }>;
}) {
  const { ctx, db, locale, classes, staff } = await learningContext();
  const t = await getTranslations("learning");
  const params = await searchParams;
  const start = weekStart(
    date.safeParse(params.week).success ? params.week! : algiersToday(),
  );
  const selected = classes.find((c) => c.id === params.class);
  const ids = selected ? [selected.id] : classes.map((c) => c.id);
  const tab = ["programs", "assessments"].includes(params.tab ?? "")
    ? params.tab!
    : "week";
  const profile = learningProfile(
    selected?.type ?? workspaceType(ctx.structures, ctx.structureId),
  );
  const canTeach = classes.some((c) => c.canTeach);
  const [programRead, lessonRead, assessmentRead] = ids.length
    ? await Promise.all([
        db
          .from("kg_learning_programs")
          .select("*")
          .eq("tenant_id", ctx.tenant.id)
          .in("class_id", ids)
          .order("starts_on", { ascending: false }),
        db
          .from("kg_learning_lessons")
          .select("*")
          .eq("tenant_id", ctx.tenant.id)
          .in("class_id", ids)
          .gte("starts_at", `${start}T00:00:00+01:00`)
          .lt("starts_at", `${addDays(start, 7)}T00:00:00+01:00`)
          .order("starts_at"),
        db
          .from("kg_learning_assessments")
          .select("*")
          .eq("tenant_id", ctx.tenant.id)
          .in("class_id", ids)
          .order("scheduled_on", { ascending: false }),
      ])
    : [
        { data: [], error: null },
        { data: [], error: null },
        { data: [], error: null },
      ];
  if (programRead.error || lessonRead.error || assessmentRead.error)
    throw new Error("Learning records unavailable");
  const programs = programRead.data as Program[];
  const lessons = lessonRead.data as Lesson[];
  const assessments = assessmentRead.data as Assessment[];
  const href = (week: string, nextTab = tab) =>
    `/learning?${new URLSearchParams({ week, tab: nextTab, ...(selected ? { class: selected.id } : {}) })}`;
  const dateLabel = (day: string) =>
    new Intl.DateTimeFormat(locale, {
      weekday: "long",
      day: "numeric",
      month: "short",
      timeZone: "Africa/Algiers",
    }).format(new Date(`${day}T12:00:00Z`));
  const timeLabel = (instant: string) =>
    new Intl.DateTimeFormat(locale, {
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
      timeZone: "Africa/Algiers",
    }).format(new Date(instant));
  return (
    <div className="space-y-6">
      <PageHeader title={t("title")} description={t("description")} />
      <section className="rounded-2xl border border-primary/20 bg-gradient-to-br from-primary/10 via-card to-background p-5">
        <h2 className="text-xl font-semibold">{t(`profiles.${profile}`)}</h2>
        <p className="mt-2 max-w-3xl text-sm text-muted-foreground">
          {t(`profileHints.${profile}`)}
        </p>
        <nav className="mt-4 flex flex-wrap gap-3 text-sm font-medium">
          {[
            "classes",
            "children",
            ...(ctx.isFinance ? ["staff"] : []),
            "activities",
            ...(profile === "therapy" ? ["sessions"] : []),
          ].map((path) => (
            <Link
              className="rounded-lg border bg-background px-3 py-2 hover:border-primary"
              href={`/${path}`}
              key={path}
            >
              {t(path === "children" ? "students" : path)}
            </Link>
          ))}
        </nav>
      </section>
      <form className="flex flex-wrap items-end gap-3">
        <input type="hidden" name="tab" value={tab} />
        <label className="space-y-1 text-sm">
          <span className="block">{t("fields.class")}</span>
          <FormSelect
            key={selected?.id ?? "all"}
            name="class"
            defaultValue={selected?.id ?? ""}
            options={[
              { value: "", label: t("allClasses") },
              ...classes.map((c) => ({ value: c.id, label: c.name })),
            ]}
          />
        </label>
        <label className="space-y-1 text-sm">
          <span className="block">{t("week")}</span>
          <LearningDateField key={start} name="week" defaultValue={start} />
        </label>
        <button className="h-10 rounded-md bg-primary px-4 text-sm text-primary-foreground">
          {t("filter")}
        </button>
      </form>
      <nav
        className="flex flex-wrap gap-2 border-b pb-3"
        aria-label={t("title")}
      >
        {["week", "programs", "assessments"].map((key) => (
          <Link
            aria-current={tab === key ? "page" : undefined}
            className={`rounded-lg px-4 py-2 text-sm font-medium ${tab === key ? "bg-primary text-primary-foreground" : "bg-muted"}`}
            href={href(start, key)}
            key={key}
          >
            {t(key)}
          </Link>
        ))}
      </nav>
      <div
        className={`grid items-start gap-6 ${canTeach && tab === "assessments" ? "xl:grid-cols-[minmax(0,1fr)_420px]" : ""}`}
      >
        <div className="space-y-4">
          {tab === "week" && (
            <>
              <div className="flex justify-between text-sm font-medium">
                <Link href={href(addDays(start, -7))}>{t("previous")}</Link>
                <Link href={href(addDays(start, 7))}>{t("next")}</Link>
              </div>
              {Array.from({ length: 7 }, (_, i) => addDays(start, i)).map(
                (day) => (
                  <Card key={day}>
                    <CardHeader className="flex flex-wrap items-center justify-between gap-3">
                      <CardTitle className="text-base">
                        {dateLabel(day)}
                      </CardTitle>
                      {canTeach && (
                        <SessionEditor
                          key={day}
                          date={day}
                          programs={programs}
                          classes={selected ? [selected] : classes}
                          staff={staff}
                        />
                      )}
                    </CardHeader>
                    <CardContent className="space-y-3">
                      {!lessons.some(
                        (l) =>
                          new Date(l.starts_at).toLocaleDateString("en-CA", {
                            timeZone: "Africa/Algiers",
                          }) === day,
                      ) && (
                        <p className="text-sm text-muted-foreground">
                          {t("empty")}
                        </p>
                      )}
                      {lessons
                        .filter(
                          (l) =>
                            new Date(l.starts_at).toLocaleDateString("en-CA", {
                              timeZone: "Africa/Algiers",
                            }) === day,
                        )
                        .map((l) => (
                          <article
                            key={l.id}
                            className={`rounded-xl border p-4 ${l.status === "cancelled" ? "opacity-60" : "border-s-4 border-s-primary"}`}
                          >
                            <div className="flex flex-wrap justify-between gap-2">
                              <h3
                                dir="auto"
                                className="text-start font-semibold"
                              >
                                {l.title}
                              </h3>
                              <Badge variant="secondary">{t(l.status)}</Badge>
                            </div>
                            <div className="mt-2 text-sm">
                              <ValueRange
                                from={timeLabel(l.starts_at)}
                                to={timeLabel(l.ends_at)}
                              />
                            </div>
                            <p className="mt-2 text-sm">
                              <Link
                                className="underline"
                                href={`/classes/${l.class_id}`}
                              >
                                {classes.find((c) => c.id === l.class_id)?.name}
                              </Link>{" "}
                              ·{" "}
                              {
                                staff.find((s) => s.id === l.membership_id)
                                  ?.name
                              }{" "}
                              · {t(`kinds.${l.kind}`)}
                            </p>
                            {classes.find((c) => c.id === l.class_id)
                              ?.canTeach && (
                              <div className="mt-3 flex flex-wrap gap-2">
                                {l.status === "scheduled" && (
                                  <StateButton
                                    entity="lesson"
                                    id={l.id}
                                    value="completed"
                                    label={t("complete")}
                                  />
                                )}
                                <StateButton
                                  entity="lesson"
                                  id={l.id}
                                  value={
                                    l.status === "cancelled"
                                      ? "scheduled"
                                      : "cancelled"
                                  }
                                  label={t(
                                    l.status === "cancelled"
                                      ? "reschedule"
                                      : "cancel",
                                  )}
                                />
                              </div>
                            )}
                          </article>
                        ))}
                    </CardContent>
                  </Card>
                ),
              )}
            </>
          )}
          {tab === "programs" && (
            <>
              {!programs.length && <p>{t("empty")}</p>}
              {programs.map((p) => (
                <Card key={p.id}>
                  <CardHeader>
                    <CardTitle dir="auto" className="text-start">
                      {p.title}
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-3">
                    <Link
                      className="text-sm underline"
                      href={`/classes/${p.class_id}`}
                    >
                      {classes.find((c) => c.id === p.class_id)?.name}
                    </Link>
                    <p
                      dir="auto"
                      className="whitespace-pre-wrap text-start text-sm"
                    >
                      {p.objectives}
                    </p>
                    <div className="text-sm">
                      <ValueRange
                        from={p.starts_on}
                        to={p.ends_on}
                        separator="–"
                      />
                    </div>
                    {p.archived && <Badge>{t("archived")}</Badge>}
                    {classes.find((c) => c.id === p.class_id)?.canTeach && (
                      <StateButton
                        entity="program"
                        id={p.id}
                        value={String(!p.archived)}
                        label={t(p.archived ? "restore" : "archive")}
                      />
                    )}
                  </CardContent>
                </Card>
              ))}
            </>
          )}
          {tab === "assessments" && (
            <>
              {!assessments.length && <p>{t("empty")}</p>}
              {assessments.map((a) => (
                <Link
                  href={`/learning/assessments/${a.id}`}
                  key={a.id}
                  className="block rounded-xl border bg-card p-5 hover:border-primary"
                >
                  <div className="flex flex-wrap justify-between gap-3">
                    <h3 dir="auto" className="text-start font-semibold">
                      {a.title}
                    </h3>
                    <Badge variant="secondary">
                      {t(a.published ? "published" : "draft")}
                    </Badge>
                  </div>
                  <p className="mt-2 text-sm text-muted-foreground">
                    {classes.find((c) => c.id === a.class_id)?.name} ·{" "}
                    {t(`kinds.${a.kind}`)} · {dateLabel(a.scheduled_on)}
                  </p>
                </Link>
              ))}
            </>
          )}
        </div>
        {canTeach && tab !== "week" && (
          <Card className={tab === "programs" ? "order-first" : undefined}>
            <CardHeader>
              <CardTitle className="text-base">
                {t(
                  tab === "programs"
                    ? "newProgram"
                    : tab === "week"
                      ? "newLesson"
                      : "newAssessment",
                )}
              </CardTitle>
            </CardHeader>
            <CardContent>
              {tab === "programs" ? (
                <ProgramForm
                  key={selected?.id ?? "all"}
                  classes={selected ? [selected] : classes}
                  programs={programs}
                />
              ) : (
                <AssessmentForm
                  key={`${tab}:${selected?.id ?? "all"}`}
                  programs={programs}
                  classes={classes}
                />
              )}
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}
