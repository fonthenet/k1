import Link from "next/link";
import { getLocale, getTranslations } from "next-intl/server";
import {
  Baby,
  CalendarDays,
  CalendarHeart,
  ChevronLeft,
  ChevronRight,
  Pin,
  ShieldAlert,
  TreePalm,
  Wallet,
} from "lucide-react";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { EmptyState } from "@/components/shared/empty-state";
import { ValueRange } from "@/components/shared/value-range";
import { PortalChildLink } from "@/components/shared/entity-link";
import { createClient } from "@/lib/supabase/server";
import { getTenantContext, signedMediaUrl } from "@/lib/tenant";
import { toOpeningHours } from "@/lib/week";
import { EstablishmentCard } from "@/components/shared/establishment-card";
import { childDisplayName, formatDZD, formatDate, formatTime, initials } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { AttendanceStatus, Audience, IncidentSeverity } from "@/lib/types";
import {
  algiersMonth,
  algiersToday,
  classLabel,
  getMyChildren,
  getMyGuardianBadge,
  monthRange,
  toCheckinDialogChildren,
} from "@/components/modules/portal/data";
import {
  attendanceChipClasses,
  MOOD_EMOJI,
  parseMeals,
  severityClasses,
} from "@/components/modules/portal/portal-types";
import { isAway } from "@/components/modules/attendance/status-config";
import { AckIncidentButton } from "@/components/modules/portal/ack-incident-button";
import {
  CheckinDialog,
  type CheckinDialogChildStatus,
} from "@/components/modules/portal/checkin-dialog";
import { ReportAbsenceDialog } from "@/components/modules/portal/report-absence-dialog";
import { displayIdentity } from "@/lib/auth-identifier";

type AttendanceRow = {
  child_id: string;
  status: AttendanceStatus;
  check_in_at: string | null;
  check_out_at: string | null;
  picked_up_by: string | null;
  absence_reason: string | null;
};

type ReportRow = {
  child_id: string;
  date: string;
  mood: string | null;
  meals: unknown;
  activities_text: string | null;
};

type DueRow = {
  id: string;
  child_id: string;
  total: number | string;
  paid_amount: number | string;
  due_date: string | null;
  status: string;
};

type IncidentRow = {
  id: string;
  child_id: string;
  occurred_at: string;
  severity: IncidentSeverity;
  description: string;
  action_taken: string | null;
  location: string | null;
};

type AnnouncementRow = {
  id: string;
  title: string;
  body: string;
  publish_at: string;
  audience: Audience;
  class_id: string | null;
};

type EventRow = {
  id: string;
  title: string;
  description: string | null;
  start_at: string;
  end_at: string | null;
  audience: Audience;
  class_id: string | null;
};

type HolidayRow = {
  id: string;
  date: string;
  end_date: string | null;
  name: string;
  name_ar: string | null;
  tentative: boolean;
};

export default async function PortalHomePage() {
  const ctx = await getTenantContext();
  const tenantLogoUrl = await signedMediaUrl(ctx.tenant.logo_url);
  const t = await getTranslations("portal");
  const tCommon = await getTranslations("common");
  const locale = await getLocale();
  const supabase = await createClient();

  const today = algiersToday();
  const { start: monthStart, end: monthEnd } = monthRange(algiersMonth());
  const nowIso = new Date().toISOString();

  // The door badge belongs to the guardian, not to a child: fetched once here
  // and handed to every child card, never re-queried per card.
  const [children, badge] = await Promise.all([
    getMyChildren(supabase, ctx),
    getMyGuardianBadge(supabase, ctx, locale),
  ]);
  const childIds = children.map((c) => c.id);
  const myClassIds = new Set(children.map((c) => c.class_id).filter((id): id is string => !!id));

  const [{ data: profile }, attendanceRes, reportsRes, duesRes, incidentsRes, pinnedRes, eventsRes, holidaysRes] =
    await Promise.all([
      supabase.from("kg_profiles").select("full_name").eq("id", ctx.user.id).maybeSingle(),
      childIds.length
        ? supabase
            .from("kg_attendance")
            .select("child_id, status, check_in_at, check_out_at, picked_up_by, absence_reason")
            .in("child_id", childIds)
            .eq("date", today)
        : Promise.resolve({ data: [] }),
      childIds.length
        ? supabase
            .from("kg_daily_reports")
            .select("child_id, date, mood, meals, activities_text")
            .in("child_id", childIds)
            .eq("published", true)
            .order("date", { ascending: false })
            .limit(childIds.length * 5)
        : Promise.resolve({ data: [] }),
      // What the family owes. The home said nothing about money at all, so a
      // parent whose child had just been approved — and who had an invoice
      // waiting — saw a normal day and no bill. Only open invoices: a draft is
      // the office still working, and a void one is not owed.
      childIds.length
        ? supabase
            .from("kg_invoices")
            .select("id, child_id, total, paid_amount, due_date, status")
            .in("child_id", childIds)
            .in("status", ["sent", "unpaid", "partial", "overdue"])
            .order("due_date", { ascending: true })
        : Promise.resolve({ data: [] }),
      childIds.length
        ? supabase
            .from("kg_incidents")
            .select("id, child_id, occurred_at, severity, description, action_taken, location")
            .in("child_id", childIds)
            .is("parent_ack_at", null)
            .order("occurred_at", { ascending: false })
        : Promise.resolve({ data: [] }),
      supabase
        .from("kg_announcements")
        .select("id, title, body, publish_at, audience, class_id")
        .eq("tenant_id", ctx.tenant.id)
        .eq("pinned", true)
        .lte("publish_at", nowIso)
        .order("publish_at", { ascending: false })
        .limit(5),
      // Class events were dropped here by `.in("audience", ["all","parents"])`,
      // so a trip organised for a child's own class was invisible to their
      // parent — the opposite failure to the RLS one, and it hid exactly the
      // events that matter most. The audience filter now happens below, against
      // the parent's own classes, the same way `pinned` already does it.
      // Limit raised because class rows now compete for the same slots.
      supabase
        .from("kg_events")
        .select("id, title, description, start_at, end_at, audience, class_id")
        .eq("tenant_id", ctx.tenant.id)
        .gte("start_at", `${today}T00:00:00+01:00`)
        .order("start_at")
        .limit(12),
      supabase
        .from("kg_holidays")
        .select("id, date, end_date, name, name_ar, tentative")
        .eq("tenant_id", ctx.tenant.id)
        .gte("date", monthStart)
        .lt("date", monthEnd)
        .order("date"),
    ]);

  const attendanceByChild = new Map<string, AttendanceRow>();
  for (const row of (attendanceRes.data ?? []) as AttendanceRow[]) {
    attendanceByChild.set(row.child_id, row);
  }

  const latestReportByChild = new Map<string, ReportRow>();
  for (const row of (reportsRes.data ?? []) as ReportRow[]) {
    if (!latestReportByChild.has(row.child_id)) latestReportByChild.set(row.child_id, row);
  }

  const incidents = (incidentsRes.data ?? []) as IncidentRow[];

  // What is still owed, and by when. `balance` rather than `status`: a partly
  // paid invoice is still money the family owes, and saying "unpaid" about one
  // they have already paid half of is how a crèche gets an angry phone call.
  const dues = ((duesRes.data ?? []) as DueRow[])
    .map((d) => ({ ...d, balance: Number(d.total) - Number(d.paid_amount) }))
    .filter((d) => d.balance > 0.005);
  const totalDue = dues.reduce((sum, d) => sum + d.balance, 0);
  const dueByChild = new Map<string, number>();
  for (const d of dues) {
    dueByChild.set(d.child_id, (dueByChild.get(d.child_id) ?? 0) + d.balance);
  }
  const earliestDue = dues.find((d) => d.due_date)?.due_date ?? null;
  const anyOverdue = dues.some((d) => d.due_date && d.due_date < today);

  const pinned = ((pinnedRes.data ?? []) as AnnouncementRow[]).filter(
    (a) =>
      a.audience === "all" ||
      a.audience === "parents" ||
      (a.audience === "class" && !!a.class_id && myClassIds.has(a.class_id))
  );

  // RLS already refuses another class's events (0089); this keeps the page
  // honest on its own terms rather than trusting the database to have been
  // migrated, and drops staff-audience rows for a parent who is also staff.
  // Which class an event belongs to, in the reader's language. Built from the
  // children already loaded — a parent only ever sees their own classes' events,
  // so their own children are a complete source and this costs no query.
  const classLabelById = new Map<string, string>();
  for (const c of children) {
    const label = classLabel(c, locale);
    if (c.class_id && label) classLabelById.set(c.class_id, label);
  }

  // "Coming up" starts from NOW, not from midnight — but an event is judged by
  // when it ENDS, not when it starts. A trip running 09:00–13:15 is still the
  // thing happening to your child at noon; one that finished at 10:00 is not.
  //
  // Filtering on start_at alone gave both wrong answers at once: this morning's
  // finished visits sat under "Coming up" hours after they were over, while an
  // all-day outing would have vanished the moment it began. The finished ones
  // were also, confusingly, events that had notified nobody precisely BECAUSE
  // they had already started.
  // Reuses the timestamp this render already took for the announcements query,
  // rather than reading the clock a second time — one render, one "now".
  const nowMs = Date.parse(nowIso);
  const stillRelevant = (e: EventRow) => Date.parse(e.end_at ?? e.start_at) >= nowMs;

  const events = ((eventsRes.data ?? []) as EventRow[])
    .filter(
      (e) =>
        e.audience === "all" ||
        e.audience === "parents" ||
        (e.audience === "class" && !!e.class_id && myClassIds.has(e.class_id))
    )
    .filter(stillRelevant)
    .slice(0, 5);
  const holidays = (holidaysRes.data ?? []) as HolidayRow[];

  const childName = (id: string): string => {
    const child = children.find((c) => c.id === id);
    return child ? childDisplayName(child, locale) : "";
  };

  const photoUrls = new Map<string, string | null>();
  await Promise.all(
    children.map(async (c) => {
      photoUrls.set(c.id, await signedMediaUrl(c.photo_path));
    })
  );

  /**
   * Today reduced to the four states the portal speaks in. Split out of
   * `todayStatus` so the chip on a child card and the status line inside the
   * check-in dialog are read off one computation and can never disagree.
   */
  function todayCheckin(childId: string): CheckinDialogChildStatus {
    const row = attendanceByChild.get(childId);
    if (!row) return { kind: "notYet", time: null, reason: null };
    if (isAway(row.status)) {
      return {
        kind: "absent",
        time: null,
        reason: row.absence_reason ?? (row.status === "sick" ? t("home.status.sickReason") : null),
      };
    }
    if (row.check_out_at) {
      // A parent reading "Left at 16:00" still has to ask the one question the
      // register already knows the answer to.
      return {
        kind: "left",
        time: formatTime(row.check_out_at, locale),
        reason: null,
        collectedBy: row.picked_up_by,
      };
    }
    if (row.check_in_at) {
      return { kind: "arrived", time: formatTime(row.check_in_at, locale), reason: null };
    }
    return { kind: "notYet", time: null, reason: null };
  }

  function todayStatus(childId: string): { label: string; classes: string } {
    const status = todayCheckin(childId);
    switch (status.kind) {
      case "absent":
        return {
          label: status.reason
            ? t("home.status.absentReason", { reason: status.reason })
            : t("home.status.absent"),
          classes: attendanceChipClasses("absent"),
        };
      case "left":
        return {
          label: status.collectedBy
            ? t("home.status.leftWith", {
                time: status.time ?? "",
                name: status.collectedBy,
              })
            : t("home.status.left", { time: status.time ?? "" }),
          classes: attendanceChipClasses("left"),
        };
      case "arrived":
        return {
          label: t("home.status.arrived", { time: status.time ?? "" }),
          classes: attendanceChipClasses("arrived"),
        };
      default:
        return { label: t("home.status.notYet"), classes: attendanceChipClasses("notYet") };
    }
  }

  // The badge is one code for the whole family, so the whole family travels
  // with every trigger on this page: a parent who opened it from Ali's card
  // can switch to Lina without closing it. Built from rows already in hand —
  // the children, their signed photos and today's attendance — so no card
  // costs an extra query. This page is the one surface that already knows
  // today's status, so it is the one that can label the tabs with it.
  const checkinChildren = toCheckinDialogChildren(
    children,
    locale,
    photoUrls,
    new Map(children.map((c) => [c.id, todayCheckin(c.id)]))
  );

  const greetingName =
    profile?.full_name?.split(" ")[0] || profile?.full_name || displayIdentity(ctx.user.email) || "";
  const ForwardIcon = locale === "ar" ? ChevronLeft : ChevronRight;

  return (
    <div className="grid gap-6">
      {/* ===== Greeting — the anchor of the page: full brand gradient, white ink. ===== */}
      <div className="rounded-2xl bg-gradient-to-br from-brand-from via-brand-via to-brand-to p-5 text-primary-foreground shadow-lg">
        <p className="text-xs font-semibold uppercase tracking-wider text-primary-foreground/75">
          {formatDate(today, locale, { weekday: "long" })}
        </p>
        <h2 className="mt-1.5 text-2xl font-bold leading-tight tracking-tight text-primary-foreground">
          {t("home.greeting", { name: greetingName })}
        </h2>
      </div>

      {/* ===== What the family owes =====
           A parent whose child had just been approved saw a normal day and no
           bill: the home carried no mention of money, and the invoice sat two
           taps away under Payments. Gold, not red — an unpaid invoice inside
           its terms is a thing to do, not an emergency — and red only once it
           is genuinely past its date. */}
      {totalDue > 0 && (
        <Link
          href="/portal/payments"
          className={cn(
            "flex items-center gap-3.5 rounded-2xl p-4 ring-1 transition-colors",
            "focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none",
            anyOverdue
              ? "bg-destructive/5 ring-destructive/25 hover:bg-destructive/10"
              : "bg-gold-muted/50 ring-gold/30 hover:bg-gold-muted/70"
          )}
        >
          <span
            aria-hidden
            className={cn(
              "flex size-10 shrink-0 items-center justify-center rounded-xl",
              anyOverdue ? "text-destructive" : "text-gold-ink"
            )}
          >
            <Wallet className="size-5" />
          </span>
          <div className="min-w-0 flex-1">
            <p className="text-sm font-semibold text-foreground">
              {t("home.due.title", { amount: formatDZD(totalDue, locale) })}
            </p>
            <p className="mt-0.5 text-xs leading-relaxed text-muted-foreground">
              {anyOverdue
                ? t("home.due.overdue")
                : earliestDue
                  ? t("home.due.by", { date: formatDate(earliestDue, locale) })
                  : t("home.due.pending")}
            </p>
          </div>
          <ForwardIcon className="size-4 shrink-0 text-muted-foreground" aria-hidden />
        </Link>
      )}

      {/* ===== Unacknowledged incidents ===== */}
      {incidents.length > 0 && (
        <Card className="bg-destructive/5 shadow-sm ring-destructive/25">
          <CardHeader className="flex flex-row items-center gap-2.5">
            <span className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-destructive/10 text-destructive">
              <ShieldAlert className="size-5" />
            </span>
            <CardTitle className="text-base font-semibold text-destructive">
              {t("home.incidents.title")}
            </CardTitle>
          </CardHeader>
          <CardContent className="grid gap-3">
            {incidents.map((incident) => (
              <div
                key={incident.id}
                className="grid gap-2 rounded-xl bg-card p-3.5 ring-1 ring-destructive/15"
              >
                <div className="flex flex-wrap items-center gap-2 text-sm">
                  <span className="font-semibold"><PortalChildLink id={incident.child_id}>{childName(incident.child_id)}</PortalChildLink></span>
                  <Badge className={severityClasses(incident.severity)}>
                    {t(`home.incidents.severity.${incident.severity}`)}
                  </Badge>
                  <span className="text-xs text-muted-foreground tabular-nums">
                    {formatDate(incident.occurred_at, locale)} · {formatTime(incident.occurred_at, locale)}
                  </span>
                </div>
                <p className="text-sm leading-relaxed text-start" dir="auto">{incident.description}</p>
                {incident.action_taken && (
                  <p className="text-sm leading-relaxed text-muted-foreground">
                    {t("home.incidents.actionTaken")} : {incident.action_taken}
                  </p>
                )}
                <div className="pt-0.5">
                  <AckIncidentButton incidentId={incident.id} />
                </div>
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      {/* ===== My children ===== */}
      <section className="grid gap-3">
        <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          {t("home.childrenTitle")}
        </h3>
        {children.length === 0 ? (
          <EmptyState
            icon={<Baby />}
            title={t("home.emptyChildren")}
            description={t("home.emptyChildrenDescription")}
          />
        ) : (
          children.map((child, index) => {
            const name = childDisplayName(child, locale);
            const secondaryName =
              locale === "ar"
                ? `${child.first_name} ${child.last_name}`
                : child.first_name_ar && child.last_name_ar
                  ? `${child.first_name_ar} ${child.last_name_ar}`
                  : null;
            const status = todayStatus(child.id);
            const report = latestReportByChild.get(child.id);
            const meals = report ? parseMeals(report.meals) : [];
            const cls = classLabel(child, locale);
            return (
              <Card key={child.id} className="shadow-sm">
                <CardContent className="grid gap-3.5">
                  {/* The whole header is the tap target — a parent reaches for
                      the child's face and name, not the small "details" link. */}
                  <Link
                    href={`/portal/children/${child.id}`}
                    className="-m-1 flex items-center gap-3 rounded-xl p-1 transition-colors hover:bg-muted/60 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
                  >
                    <Avatar className="size-12 ring-1 ring-primary/15">
                      {photoUrls.get(child.id) && (
                        <AvatarImage src={photoUrls.get(child.id)!} alt={name} />
                      )}
                      <AvatarFallback className="bg-primary/10 text-sm font-semibold text-primary">
                        {initials(child.first_name, child.last_name)}
                      </AvatarFallback>
                    </Avatar>
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-baseline gap-x-2">
                        <span className="font-semibold">{name}</span>
                        {secondaryName && (
                          <span className="text-sm text-muted-foreground text-start" dir="auto">
                            {secondaryName}
                          </span>
                        )}
                      </div>
                      {cls && (
                        <div className="mt-1 flex items-center gap-1.5 text-xs text-muted-foreground">
                          <span
                            className="size-2 rounded-full"
                            style={{ backgroundColor: child.kg_classes?.color ?? "var(--gold)" }}
                            aria-hidden
                          />
                          {cls}
                        </div>
                      )}
                    </div>
                    <Badge className={status.classes}>{status.label}</Badge>
                  </Link>

                  {report && (
                    <Link
                      href={`/portal/children/${child.id}?tab=journal`}
                      className="flex items-center gap-3 rounded-xl border border-border bg-muted/50 px-3 py-2.5 transition-colors hover:bg-muted"
                    >
                      <span
                        className="flex size-9 shrink-0 items-center justify-center rounded-full bg-card text-xl ring-1 ring-border"
                        aria-hidden
                      >
                        {MOOD_EMOJI[report.mood ?? ""] ?? "🙂"}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block text-xs font-semibold text-foreground">
                          {t("home.lastReport", { date: formatDate(report.date, locale) })}
                        </span>
                        <span className="block truncate text-xs text-muted-foreground">
                          {meals.length > 0
                            ? meals.map((m) => (m.eaten ? `${m.meal} — ${m.eaten}` : m.meal)).join(" · ")
                            : (report.activities_text ?? "")}
                        </span>
                      </span>
                      <ForwardIcon className="size-4 shrink-0 text-gold" />
                    </Link>
                  )}

                  {/* Absence and the door badge sit side by side because both
                      are things a parent does *about today*; "details" is only
                      the way into the file. The row wraps instead of shrinking —
                      no target here goes under 44px. The badge itself is per
                      guardian; opening it from this card only tells the QR which
                      child to name underneath, so staff know who is being handed
                      over without the parent navigating away. */}
                  <div className="flex flex-wrap items-center gap-2">
                    <ReportAbsenceDialog childId={child.id} childName={name} defaultDate={today} />
                    <CheckinDialog
                      badge={badge}
                      child={checkinChildren[index]}
                    />
                    <Button
                      asChild
                      variant="ghost"
                      size="sm"
                      className="ms-auto h-11 px-3 text-primary hover:text-primary"
                    >
                      <Link href={`/portal/children/${child.id}`}>
                        {t("home.details")}
                        <ForwardIcon data-icon="inline-end" />
                      </Link>
                    </Button>
                  </div>
                </CardContent>
              </Card>
            );
          })
        )}
      </section>

      {/* ===== Pinned announcements — gold, so they read as "keep this in mind" ===== */}
      {pinned.length > 0 && (
        <section className="grid gap-3">
          <div className="flex items-center justify-between gap-2">
            <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              {t("home.pinnedTitle")}
            </h3>
            <Button asChild variant="ghost" size="sm" className="text-primary hover:text-primary">
              <Link href="/portal/announcements">{t("home.seeAll")}</Link>
            </Button>
          </div>
          {pinned.map((a) => (
            <Card key={a.id} className="border-gold/40 bg-card shadow-sm">
              <CardContent className="flex gap-3">
                <span className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-gold text-gold-foreground">
                  <Pin className="size-4" />
                </span>
                <div className="grid min-w-0 flex-1 gap-1">
                  <div className="flex items-baseline gap-2">
                    <span className="min-w-0 flex-1 truncate font-semibold text-start" dir="auto">{a.title}</span>
                    <span className="shrink-0 text-xs text-muted-foreground tabular-nums">
                      {formatDate(a.publish_at, locale)}
                    </span>
                  </div>
                  <p className="line-clamp-2 whitespace-pre-wrap text-sm leading-relaxed text-muted-foreground text-start" dir="auto">
                    {a.body}
                  </p>
                </div>
              </CardContent>
            </Card>
          ))}
        </section>
      )}

      {/* ===== Upcoming events + holidays ===== */}
      <section className="grid gap-3">
        <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          {t("home.upcomingTitle")}
        </h3>
        {events.length === 0 && holidays.length === 0 ? (
          <Card className="shadow-sm">
            <CardContent className="flex flex-col items-center gap-3 py-8 text-center">
              <span className="flex size-12 items-center justify-center rounded-2xl bg-primary/10 text-primary">
                <CalendarHeart className="size-6" />
              </span>
              <p className="text-sm text-muted-foreground">{t("home.upcomingEmpty")}</p>
            </CardContent>
          </Card>
        ) : (
          <Card className="shadow-sm">
            <CardContent className="grid gap-3">
              {events.map((event) => (
                <div key={event.id} className="flex items-center gap-3 text-sm">
                  <span className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
                    <CalendarDays className="size-4" />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-medium text-start" dir="auto">{event.title}</span>
                    {/* Which child this concerns. A guardian with children in two
                        classes cannot tell two trips apart without it. */}
                    {event.audience === "class" && event.class_id && (
                      <span className="block truncate text-xs text-muted-foreground">
                        {classLabelById.get(event.class_id) ?? ""}
                      </span>
                    )}
                    {/* What it actually is. Staff type this into the event and
                        it reached the family nowhere at all. */}
                    {event.description && (
                      <span className="mt-0.5 block text-xs leading-relaxed text-pretty text-muted-foreground text-start" dir="auto">
                        {event.description}
                      </span>
                    )}
                  </span>
                  <span className="shrink-0 text-xs text-muted-foreground tabular-nums">
                    {formatDate(event.start_at, locale, { weekday: "short" })}
                    {" · "}
                    {/* Both ends when the event has one: "drop off at 09:00" and
                        "collect at 13:15" are two different questions. */}
                    {event.end_at
                      ? `${formatTime(event.start_at, locale)} – ${formatTime(event.end_at, locale)}`
                      : formatTime(event.start_at, locale)}
                  </span>
                </div>
              ))}
              {holidays.map((holiday) => (
                <div key={holiday.id} className="flex items-center gap-3 text-sm">
                  <span className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-gold text-gold-foreground">
                    <TreePalm className="size-4" />
                  </span>
                  <span className="min-w-0 flex-1 truncate font-medium">
                    {locale === "ar" && holiday.name_ar ? holiday.name_ar : holiday.name}
                  </span>
                  <span className="flex shrink-0 items-center gap-1.5 text-xs text-muted-foreground tabular-nums">
                    {/* A span of dates reorders in Arabic exactly the way a
                        pair of clock times does, so the two ends are isolated
                        together. An en dash, not an arrow: a holiday runs from
                        one date to another, it does not flow anywhere. */}
                    {holiday.end_date ? (
                      <ValueRange
                        from={formatDate(holiday.date, locale, { weekday: "short" })}
                        to={formatDate(holiday.end_date, locale)}
                        separator="–"
                      />
                    ) : (
                      formatDate(holiday.date, locale, { weekday: "short" })
                    )}
                    {holiday.tentative && (
                      <Badge className="border-warning/40 bg-warning/15 text-[10px] font-semibold text-foreground">
                        {t("home.tentative")}
                      </Badge>
                    )}
                  </span>
                </div>
              ))}
            </CardContent>
          </Card>
        )}
      </section>

      {/* Where the crèche is. A parent looking this up is usually already on
          their way, so the pin and the directions button come first — the
          address line is what they read out to a taxi driver. */}
      <section className="grid gap-3">
        <h3 className="text-sm font-semibold text-foreground">
          {tCommon("establishment.title")}
        </h3>
        <EstablishmentCard
          info={{
            name: ctx.tenant.name,
            logoUrl: tenantLogoUrl,
            phone: ctx.tenant.phone,
            email: ctx.tenant.email,
            address: ctx.tenant.address,
            commune: ctx.tenant.commune,
            wilaya: ctx.tenant.wilaya,
            latitude: ctx.tenant.latitude,
            longitude: ctx.tenant.longitude,
            openingHours: toOpeningHours(
              (ctx.tenant as { opening_hours?: unknown }).opening_hours
            ),
          }}
        />
      </section>
    </div>
  );
}
