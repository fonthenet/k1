import Link from "next/link";
import { getLocale, getTranslations } from "next-intl/server";
import {
  Baby,
  CalendarDays,
  ChevronLeft,
  ChevronRight,
  FileWarning,
  Pin,
  ShieldAlert,
  Wallet,
} from "lucide-react";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Card, CardContent } from "@/components/ui/card";
import { EmptyState } from "@/components/shared/empty-state";
import { SectionCard } from "@/components/shared/section-card";
import { StatusPill, type StatusTone } from "@/components/shared/status-pill";
import { createClient } from "@/lib/supabase/server";
import { getTenantContext, signedMediaUrl } from "@/lib/tenant";
import { isOpenDayStr, toOpeningHours, type OpeningHours } from "@/lib/week";
import type { Locale } from "@/i18n/locales";
import { EstablishmentCard } from "@/components/shared/establishment-card";
import { childDisplayName, formatDZD, formatDate, formatTime, initials, listFormat } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { AttendanceStatus, Audience, ChildStatus, IncidentSeverity } from "@/lib/types";
import { readCalendar } from "@/lib/calendar";
import { algiersInstant } from "@/lib/algiers";
import { closureOn, holidayLabel, readClosures } from "@/lib/closures";
import { addDaysStr } from "@/components/modules/comms/dates";
import {
  algiersToday,
  classLabel,
  getDossierGaps,
  getMyChildren,
  getMyGuardianBadge,
  getStructures,
} from "@/components/modules/portal/data";
import { familyItemsFor, UPCOMING_DAYS } from "@/components/modules/portal/calendar-data";
import { FamilyAgenda } from "@/components/modules/portal/family-agenda";
import { StructureMark } from "@/components/shared/structure-mark";
import { FactsLine } from "@/components/modules/portal/facts-line";
import { structureName } from "@/components/modules/classes/class-types";
import {
  attendanceChipTone,
  eatenKey,
  MOOD_EMOJI,
  parseMeals,
  parseNap,
} from "@/components/modules/portal/portal-types";
import { isAway } from "@/components/modules/attendance/status-config";
import { IncidentRow } from "@/components/modules/portal/incident-row";
import {
  CheckinDialog,
  type CheckinDialogChildStatus,
} from "@/components/modules/portal/checkin-dialog";
import { ReportAbsenceDialog } from "@/components/modules/portal/report-absence-dialog";
import { PortalHomeRefresh } from "@/components/modules/portal/portal-home-refresh";
import { displayIdentity } from "@/lib/auth-identifier";
import { MEAL_SLOTS } from "@/lib/journal";
import { kioskSettings } from "@/lib/kiosk-settings";

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
  nap: unknown;
  activities_text: string | null;
};

/**
 * Statuses that mean "this child comes through the door". Anything else — on
 * the waiting list, still under review, withdrawn, alumni — gets no live chip,
 * no absence button and no door badge on the home: the kiosk refuses their
 * tag anyway (0069), and a live "not yet arrived" on a child who left in June
 * is a lie the family reads every morning.
 */
const ATTENDING: ReadonlySet<ChildStatus> = new Set<ChildStatus>(["enrolled"]);

type DueRow = {
  id: string;
  child_id: string;
  total: number | string;
  paid_amount: number | string;
  due_date: string | null;
  status: string;
};

type IncidentRecord = {
  id: string;
  child_id: string;
  occurred_at: string;
  severity: IncidentSeverity;
  description: string;
  action_taken: string | null;
  location: string | null;
};

/**
 * `structure` joined the audience enum in 0138 (a notice for the families of
 * one side of the building). `@/lib/types` has not caught up, so the widening
 * is local; drop it once `Audience` carries the value.
 */
type PortalAudience = Audience | "structure";

type AnnouncementRow = {
  id: string;
  title: string;
  body: string;
  publish_at: string;
  audience: PortalAudience;
  class_id: string | null;
};

/** How many rows "À venir" shows before handing over to the calendar. */
const UPCOMING_LIMIT = 6;

export default async function PortalHomePage() {
  const ctx = await getTenantContext();
  const tenantLogoUrl = await signedMediaUrl(ctx.tenant.logo_url);
  const t = await getTranslations("portal");
  const tCommon = await getTranslations("common");
  const locale = (await getLocale()) as Locale;
  const supabase = await createClient();

  const today = algiersToday();
  const openingHours = toOpeningHours((ctx.tenant as { opening_hours?: unknown }).opening_hours);
  const nowIso = new Date().toISOString();

  // The door badge belongs to the guardian, not to a child: fetched once here
  // and raised by the one trigger above the children, never per card.
  const [children, badge, structures] = await Promise.all([
    getMyChildren(supabase, ctx),
    getMyGuardianBadge(supabase, ctx, locale),
    getStructures(supabase, ctx),
  ]);
  // Which side of the building each child is on — said only when the
  // building has two sides. See the children list for the same rule.
  const multiStructure = structures.length > 1;
  const structureById = new Map(structures.map((s) => [s.id, s]));
  const childIds = children.map((c) => c.id);
  // Today's attendance, journals and incidents are only asked about children
  // who attend. Dues are NOT filtered: a withdrawn child's last invoice is
  // still owed, and hiding it is how a balance is discovered at re-enrolment.
  const attendingIds = children.filter((c) => ATTENDING.has(c.status)).map((c) => c.id);
  const myClassIds = new Set(children.map((c) => c.class_id).filter((id): id is string => !!id));

  // The week each child's structure keeps — its own if it set one, the
  // building's otherwise (kg_structure_hours). One RPC per distinct
  // structure, not per child: two siblings in the crèche share one read, and
  // a jardin closed on Thursday must not close the crèche's band next to it.
  // A child with no structure is on the building's week.
  const structureIds = [...new Set(children.map((c) => c.structure_id))];
  const hoursByStructure = new Map<string | null, OpeningHours>();
  await Promise.all(
    structureIds.map(async (sid) => {
      if (sid === null) {
        hoursByStructure.set(null, openingHours);
        return;
      }
      const { data } = await supabase.rpc("kg_structure_hours", { p_structure: sid, p_tenant: ctx.tenant.id });
      hoursByStructure.set(sid, data ? toOpeningHours(data) : openingHours);
    })
  );
  const [
    { data: profile },
    attendanceRes,
    latestReportRows,
    todayReportsRes,
    duesRes,
    incidentsRes,
    pinnedRes,
    upcomingRead,
    todayClosures,
    dossierGaps,
  ] =
    await Promise.all([
      supabase.from("kg_profiles").select("full_name").eq("id", ctx.user.id).maybeSingle(),
      attendingIds.length
        ? supabase
            .from("kg_attendance")
            .select("child_id, status, check_in_at, check_out_at, picked_up_by, absence_reason")
            .in("child_id", attendingIds)
            .eq("date", today)
        : Promise.resolve({ data: [] }),
      // One query PER child, each capped at one row. This was a single query
      // over every child with `.limit(children × 5)`, ordered by date — and a
      // shared cap is unfair by construction: with two siblings and an
      // educator who writes one child's journal daily and the other's twice a
      // week, the newest ten rows were all the elder's within a fortnight and
      // the younger simply had "no report". A family has at most a handful
      // of children, so this is a handful of tiny indexed reads.
      Promise.all(
        attendingIds.map((id) =>
          supabase
            .from("kg_daily_reports")
            .select("child_id, date, mood, meals, nap, activities_text")
            .eq("child_id", id)
            .eq("published", true)
            .order("date", { ascending: false })
            .limit(1)
            .maybeSingle()
        )
      ),
      // Today's journal, for the band under the child's name (nap, lunch).
      // Separate from the "latest" read above: the latest may be yesterday's,
      // and yesterday's nap must not be printed as today's.
      attendingIds.length
        ? supabase
            .from("kg_daily_reports")
            .select("child_id, date, mood, meals, nap, activities_text")
            .in("child_id", attendingIds)
            .eq("date", today)
            .eq("published", true)
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
      attendingIds.length
        ? supabase
            .from("kg_incidents")
            .select("id, child_id, occurred_at, severity, description, action_taken, location")
            .in("child_id", attendingIds)
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
      // "À venir" is the calendar's own read (kg_calendar, 0158), under the
      // family's RLS: the next fortnight of events, closures, appointments
      // and exam dates, in one date-ordered list — the same rows, the same
      // words, as the Calendrier tab, which is one tap away for the rest.
      // The home is the portal's front door: a composer that cannot answer
      // costs this one section (logged, drawn as nothing), never the
      // greeting, the children and the dues above it. The Calendrier tab
      // shows the failure in full.
      readCalendar(supabase, {
        tenantId: ctx.tenant.id,
        from: today,
        to: addDaysStr(today, UPCOMING_DAYS),
        structureId: null,
        scope: "all",
        kinds: ["holiday", "event", "session", "assessment"],
        audience: "family",
        locale,
      }).catch((e: unknown) => {
        console.error("[portal/home] upcoming read failed:", e);
        return null;
      }),
      // Today's closures, for the line under a child whose day is shut;
      // unreadable, the weekly hours alone decide and no closure is named.
      readClosures(supabase, ctx.tenant.id, today, today).catch((e: unknown) => {
        console.error("[portal/home] closures read failed:", e);
        return [];
      }),
      // The enrolment file (0164): which children still owe the office a
      // paper. Same front-door rule as the calendar — a read that fails
      // costs the one row it feeds, nothing above it. Empty until the
      // establishment activates its list (D14).
      getDossierGaps(supabase, ctx.tenant.id).catch((e: unknown) => {
        console.error("[portal/home] dossier summary failed:", e);
        return [];
      }),
    ]);

  // On a day the child's structure does not open there is no door to watch:
  // the live chip and the arrival · nap · lunch · departure band say nothing
  // true, so a closed day gets one muted line instead — named after the
  // closure when a CONFIRMED one shut the day (the one rule of lib/closures:
  // a tentative Aïd closes nothing here, exactly as it refuses no write). A
  // row written anyway (an exceptional opening) reopens the day for that child.
  const closedTodayFor = (
    child: { structure_id: string | null }
  ): { closed: boolean; name: string | null } => {
    if (!isOpenDayStr(hoursByStructure.get(child.structure_id) ?? openingHours, today)) {
      return { closed: true, name: null };
    }
    const { confirmed } = closureOn(todayClosures, today, child.structure_id);
    return confirmed ? { closed: true, name: holidayLabel(confirmed, locale) } : { closed: false, name: null };
  };

  const attendanceByChild = new Map<string, AttendanceRow>();
  for (const row of (attendanceRes.data ?? []) as AttendanceRow[]) {
    attendanceByChild.set(row.child_id, row);
  }

  const latestReportByChild = new Map<string, ReportRow>();
  for (const res of latestReportRows) {
    const row = res.data as ReportRow | null;
    if (row) latestReportByChild.set(row.child_id, row);
  }
  const todayReportByChild = new Map<string, ReportRow>();
  for (const row of (todayReportsRes.data ?? []) as ReportRow[]) {
    todayReportByChild.set(row.child_id, row);
  }

  const incidents = (incidentsRes.data ?? []) as IncidentRecord[];

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

  // The children with a paper still to hand in, in the order the list shows
  // them; the row's count is every missing paper across them. Applications
  // (child_id null) belong to the children list's pending rows, not here.
  const dossierChildren = children.filter((c) =>
    dossierGaps.some((row) => row.child_id === c.id)
  );
  const dossierMissing = dossierGaps
    .filter((row) => row.child_id && dossierChildren.some((c) => c.id === row.child_id))
    .reduce((sum, row) => sum + row.missing, 0);

  // `structure` rows pass on trust: RLS (0138) already hands a family only
  // the notices of a structure one of its children is on, and the page has
  // no cheaper way to re-check that than the database just did.
  const pinned = ((pinnedRes.data ?? []) as AnnouncementRow[]).filter(
    (a) =>
      a.audience === "all" ||
      a.audience === "parents" ||
      a.audience === "structure" ||
      (a.audience === "class" && !!a.class_id && myClassIds.has(a.class_id))
  );

  // "Coming up" starts from NOW, not from midnight — an event is judged by
  // when it ENDS, not when it starts. A trip running 09:00–13:15 is still the
  // thing happening to your child at noon; one that finished at 10:00 is not,
  // and a closure that ends today is still today's. The composer already
  // scoped the rows to the family; the same per-child filter as the calendar
  // (which closure concerns which side of the building) is applied here so
  // the two lists never disagree.
  const nowMs = Date.parse(nowIso);
  const upcoming = familyItemsFor(upcomingRead?.items ?? [], children, structures, null).filter((it) => {
    if (it.lastDate > today) return true;
    if (!it.end && !it.start) return true;
    return Date.parse(algiersInstant(it.lastDate, it.end ?? it.start ?? "00:00")) >= nowMs;
  });

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

  /**
   * The one pill on a child card, or nothing: "not yet arrived" is how every
   * morning starts and is said by the empty band under the name, not by a
   * chip on each card.
   */
  function todayStatus(childId: string): { label: string; tone: StatusTone } | null {
    const status = todayCheckin(childId);
    const tone = attendanceChipTone(status.kind);
    if (!tone) return null;
    switch (status.kind) {
      case "absent":
        return {
          label: status.reason
            ? t("home.status.absentReason", { reason: status.reason })
            : t("home.status.absent"),
          tone,
        };
      case "left":
        return {
          label: status.collectedBy
            ? t("home.status.leftWith", {
                time: status.time ?? "",
                name: status.collectedBy,
              })
            : t("home.status.left", { time: status.time ?? "" }),
          tone,
        };
      default:
        return { label: t("home.status.arrived", { time: status.time ?? "" }), tone };
    }
  }

  /**
   * A meal line for the today band: "lunch — ate half". The educator's
   * vocabulary is French ("tout", "moitié"); `eatenKey` maps it to the
   * reader's language and falls back to the raw word for anything unknown.
   */
  function eatenLabel(eaten: string | null): string | null {
    if (!eaten) return null;
    const key = eatenKey(eaten);
    return key ? t(`child.journal.eaten.${key}`) : eaten;
  }

  /**
   * The slot in the reader's language when the journal line names one of the
   * three the write contract knows ("lunch" is a key, never a word a family
   * should read); an educator's free-typed meal passes through as typed.
   */
  function slotLabel(meal: string): string {
    return (MEAL_SLOTS as readonly string[]).includes(meal) ? t(`day.meals.${meal as (typeof MEAL_SLOTS)[number]}`) : meal;
  }

  /** Nap in one short phrase, whichever of the two stored shapes it came in. */
  function napLabel(nap: unknown): string | null {
    const parsed = parseNap(nap);
    if (!parsed) return null;
    if (parsed.start && parsed.end) {
      return t("child.journal.napRange", {
        start: parsed.start.slice(0, 5),
        end: parsed.end.slice(0, 5),
      });
    }
    if (parsed.slept === false) return t("child.journal.napNone");
    if (parsed.minutes && parsed.minutes > 0) {
      return t("child.journal.napMinutes", { minutes: parsed.minutes });
    }
    if (parsed.slept) return t("child.journal.napSlept");
    return null;
  }

  /**
   * The four moments of a crèche day, filled in as the day goes: arrived ·
   * nap · lunch · left. Read off today's attendance row and today's journal,
   * so it moves on the same refresh the chip does. Segments the day has not
   * reached yet show their label alone, muted — the shape of the day is
   * visible at 08:00, and what is still to come is obvious without a dash.
   */
  function todayBand(childId: string): { label: string; value: string | null }[] {
    const row = attendanceByChild.get(childId);
    const report = todayReportByChild.get(childId);
    const meals = report ? parseMeals(report.meals) : [];
    const lunch = meals.find((m) => m.eaten) ?? meals[0];
    return [
      {
        label: t("home.today.arrival"),
        value: row?.check_in_at ? formatTime(row.check_in_at, locale) : null,
      },
      { label: t("home.today.nap"), value: report ? napLabel(report.nap) : null },
      {
        label: t("home.today.lunch"),
        value: lunch ? (eatenLabel(lunch.eaten) ?? slotLabel(lunch.meal)) : null,
      },
      {
        label: t("home.today.departure"),
        value: row?.check_out_at ? formatTime(row.check_out_at, locale) : null,
      },
    ];
  }

  // The badge is one code for the whole family, so it is raised once, in the
  // children section's header, exactly as the children page does — a button
  // per card was the same QR printed twice. It is put away for the day once
  // every attending child has been collected: "check in" after check-out is
  // a control with nothing left to do, and at the gate it invites a second
  // scan the kiosk would refuse. Still offered while a child is absent — an
  // absence reported in the morning is often undone by a late drop-off.
  const badgeWanted = children.some(
    (c) => ATTENDING.has(c.status) && todayCheckin(c.id).kind !== "left"
  );
  // Whether the door itself can be scanned (0168) — one line in the badge
  // dialog, only where the crèche has switched it on.
  const { selfCheckin } = kioskSettings(ctx.tenant.settings);

  const greetingName =
    profile?.full_name?.split(" ")[0] || profile?.full_name || displayIdentity(ctx.user.email) || "";
  const ForwardIcon = locale === "ar" ? ChevronLeft : ChevronRight;

  return (
    <div className="grid gap-6">
      {/* Re-renders this page when the door tablet writes, and once a minute
          while the tab is visible — see the component for why both. */}
      <PortalHomeRefresh userId={ctx.user.id} />

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
           taps away under Payments. One plain row card, not a tinted band —
           an unpaid invoice inside its terms is a thing to do, not an alarm —
           and red only once it is genuinely past its date. */}
      {totalDue > 0 && (
        <Link
          href="/portal/payments"
          className="flex min-h-14 items-center gap-3 rounded-xl border border-border bg-card px-4 py-3 shadow-sm transition-colors hover:bg-primary/5 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
        >
          <span
            aria-hidden
            className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-muted text-muted-foreground"
          >
            <Wallet className="size-4" />
          </span>
          <span className="min-w-0 flex-1">
            <span
              className={cn(
                "block text-sm font-medium tabular-nums",
                anyOverdue ? "text-destructive" : "text-foreground"
              )}
            >
              {t("home.due.title", { amount: formatDZD(totalDue, locale) })}
            </span>
            <span className="block text-xs text-muted-foreground">
              {anyOverdue
                ? t("home.due.overdue")
                : earliestDue
                  ? t("home.due.by", { date: formatDate(earliestDue, locale) })
                  : t("home.due.pending")}
            </span>
          </span>
          <ForwardIcon className="size-4 shrink-0 text-muted-foreground" aria-hidden />
        </Link>
      )}

      {/* ===== A file to complete =====
           Directly under the money, in the same anatomy — a plain row card,
           a muted tile, two lines, a chevron — because it is the same kind
           of thing: something the office will ask for at the gate, not an
           alarm. One row for the whole family; a single child's row opens
           their file, more than one opens the list. */}
      {dossierChildren.length > 0 && (
        <Link
          href={
            dossierChildren.length === 1
              ? `/portal/children/${dossierChildren[0].id}?tab=permissions`
              : "/portal/children"
          }
          className="flex min-h-14 items-center gap-3 rounded-xl border border-border bg-card px-4 py-3 shadow-sm transition-colors hover:bg-primary/5 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
        >
          <span
            aria-hidden
            className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-muted text-muted-foreground"
          >
            <FileWarning className="size-4" />
          </span>
          <span className="min-w-0 flex-1">
            <span className="block text-sm font-medium">{t("home.dossier.title")}</span>
            {/* The names are person-typed text and get their own bdi so a
                 Latin name never flips the Arabic sentence around it; the
                 count reuses the file's own "# pièces à fournir" line. */}
            <span className="block truncate text-xs text-muted-foreground">
              <bdi dir="auto">
                {listFormat(locale).format(dossierChildren.map((c) => childDisplayName(c, locale)))}
              </bdi>
              {" · "}
              {t("dossier.missingLine", { count: dossierMissing })}
            </span>
          </span>
          <ForwardIcon className="size-4 shrink-0 text-muted-foreground" aria-hidden />
        </Link>
      )}

      {/* ===== Unacknowledged incidents =====
           A section card with a row per incident, never a red card holding
           red boxes: the severity pill beside the child's name is the row's
           one red, and it only appears when the incident is serious. The
           card is not drawn at all when there is nothing to acknowledge. */}
      {incidents.length > 0 && (
        <SectionCard
          icon={ShieldAlert}
          tone={3}
          title={t("home.incidents.title")}
          contentClassName="px-0"
        >
          <ul className="divide-y divide-border">
            {incidents.map((incident) => (
              // The query above keeps only rows awaiting the family's
              // acknowledgement, so the row is told that plainly.
              <IncidentRow
                key={incident.id}
                incident={{ ...incident, parent_ack_at: null }}
                childName={childName(incident.child_id)}
                childId={incident.child_id}
                locale={locale}
              />
            ))}
          </ul>
        </SectionCard>
      )}

      {/* ===== My children =====
           A plain header line, not a section card: what sits under it is a
           card per child, and a card around cards is a box in a box. */}
      <section>
        <div className="mb-3 flex items-center justify-between">
          <h3 className="text-base font-semibold">{t("home.childrenTitle")}</h3>
          {/* The family's report card lives one tap from the children, where a
              parent looks for it — not as a card above the greeting. The
              door badge is the row's one button, beside the link. */}
          {children.length > 0 && (
            <div className="flex shrink-0 items-center gap-1.5">
              <Link
                href="/portal/learning"
                className="inline-flex min-h-11 items-center gap-1 text-sm text-primary hover:underline hover:underline-offset-4"
              >
                {t("learning.title")}
                <ForwardIcon className="size-4" aria-hidden />
              </Link>
              {badgeWanted && <CheckinDialog badge={badge} selfCheckin={selfCheckin} className="px-2.5" />}
            </div>
          )}
        </div>
        {children.length === 0 ? (
          <EmptyState
            icon={<Baby />}
            title={t("home.emptyChildren")}
            description={t("home.emptyChildrenDescription")}
          />
        ) : (
          <div className="grid gap-3">
            {children.map((child) => {
              const name = childDisplayName(child, locale);
              const secondaryName =
                locale === "ar"
                  ? `${child.first_name} ${child.last_name}`
                  : child.first_name_ar && child.last_name_ar
                    ? `${child.first_name_ar} ${child.last_name_ar}`
                    : null;
              const attending = ATTENDING.has(child.status);
              const checkin = attending ? todayCheckin(child.id) : null;
              const closedToday = closedTodayFor(child);
              const quietDay = closedToday.closed && checkin?.kind === "notYet";
              const status = attending && !quietDay ? todayStatus(child.id) : null;
              const report = attending ? latestReportByChild.get(child.id) : undefined;
              const meals = report ? parseMeals(report.meals) : [];
              const band = attending ? todayBand(child.id) : [];
              const cls = classLabel(child, locale);
              const structure =
                multiStructure && child.structure_id ? structureById.get(child.structure_id) : undefined;
              return (
                <Card key={child.id} className="border border-border shadow-sm ring-0">
                  <CardContent className="grid gap-3.5">
                    {/* The whole header is the tap target — a parent reaches
                        for the child's face and name; there is no separate
                        "details" link because the name IS the door. */}
                    <Link
                      href={`/portal/children/${child.id}`}
                      className="-m-1 flex items-center gap-3 rounded-xl p-1 transition-colors hover:bg-muted/60 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
                    >
                      <Avatar className="size-12">
                        {photoUrls.get(child.id) && (
                          <AvatarImage src={photoUrls.get(child.id)!} alt={name} />
                        )}
                        <AvatarFallback className="bg-primary/10 text-sm font-semibold text-primary">
                          {initials(child.first_name, child.last_name)}
                        </AvatarFallback>
                      </Avatar>
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-baseline gap-x-2">
                          <bdi dir="auto" className="font-semibold">{name}</bdi>
                          {secondaryName && (
                            <bdi dir="auto" className="text-sm text-muted-foreground text-start">
                              {secondaryName}
                            </bdi>
                          )}
                        </div>
                        {/* Where the child is, said once: the class as plain
                            text, the structure as the one coloured mark — a
                            second dot on the class read as a second fact. */}
                        <FactsLine
                          className="mt-1"
                          facts={[
                            cls && <span key="class">{cls}</span>,
                            structure && (
                              <StructureMark
                                key="structure"
                                structure={{ name: structureName(structure, locale), color: structure.color }}
                                className="text-xs"
                              />
                            ),
                          ]}
                        />
                      </div>
                      {/* One chip: the live door status for a child who
                          attends, the file status for one who does not. Never
                          both, and never a live chip on a withdrawn child. */}
                      {status ? (
                        <StatusPill tone={status.tone}>{status.label}</StatusPill>
                      ) : attending ? null : (
                        <StatusPill tone={child.status === "withdrawn" ? "danger" : "muted"}>
                          {t(`children.status.${child.status}`)}
                        </StatusPill>
                      )}
                    </Link>

                    {!attending && (
                      <p className="text-sm leading-relaxed text-muted-foreground">
                        {t(`home.inactive.${child.status}`)}
                      </p>
                    )}

                    {quietDay && (
                      <p className="text-xs text-muted-foreground">
                        {closedToday.name
                          ? t("home.closedTodayNamed", { name: closedToday.name })
                          : tCommon("establishment.closedToday")}
                      </p>
                    )}

                    {attending && !quietDay && (
                      <dl
                        aria-label={t("home.today.label")}
                        className="flex flex-wrap items-baseline gap-x-2 gap-y-1 text-xs"
                      >
                        {band.map((segment, i) => (
                          <div key={segment.label} className="flex items-baseline gap-x-2">
                            {i > 0 && (
                              <span aria-hidden className="text-muted-foreground/60">
                                ·
                              </span>
                            )}
                            <div
                              className={cn(
                                "flex items-baseline gap-1",
                                segment.value ? "text-foreground" : "text-muted-foreground"
                              )}
                            >
                              <dt>{segment.label}</dt>
                              {segment.value && (
                                <dd className="font-semibold tabular-nums">{segment.value}</dd>
                              )}
                            </div>
                          </div>
                        ))}
                      </dl>
                    )}

                    {/* The one thing a parent does about today from this
                        card. The door badge is not here: it is issued per
                        guardian and raised once in the section header. */}
                    {attending && (
                      <div className="flex flex-wrap items-center gap-2">
                        <ReportAbsenceDialog childId={child.id} childName={name} defaultDate={today} />
                      </div>
                    )}

                    {/* The last journal as the card's bottom row, under a
                        hairline — not a tinted box inside the card. */}
                    {report && (
                      <Link
                        href={`/portal/children/${child.id}/day/${report.date}`}
                        className="-mx-4 -mb-4 flex min-h-14 items-center gap-3 border-t border-border px-4 py-3 transition-colors hover:bg-primary/5 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
                      >
                        <span className="w-6 shrink-0 text-center text-xl leading-none" aria-hidden>
                          {MOOD_EMOJI[report.mood ?? ""] ?? "🙂"}
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="block text-sm font-medium">
                            {t("home.lastReport", { date: formatDate(report.date, locale) })}
                          </span>
                          <span className="block truncate text-xs text-muted-foreground">
                            {meals.length > 0
                              ? meals
                                  .map((m) => {
                                    const eaten = eatenLabel(m.eaten);
                                    return eaten ? `${slotLabel(m.meal)} — ${eaten}` : slotLabel(m.meal);
                                  })
                                  .join(" · ")
                              : (report.activities_text ?? "")}
                          </span>
                        </span>
                        <ForwardIcon className="size-4 shrink-0 text-muted-foreground" aria-hidden />
                      </Link>
                    )}
                  </CardContent>
                </Card>
              );
            })}
          </div>
        )}
      </section>

      {/* ===== Pinned announcements =====
           A plain header line over one card of rows. The pin tile is the
           page's one gold — "keep this in mind" — said once per row and
           never as a gold border around the card. Always drawn: with the
           announcements gone from the tab bar (decision 12) this header's
           "Tout voir" is the family's door to them, so an empty week keeps
           the door and says so in one muted line. */}
      <section>
        <div className="mb-3 flex items-center justify-between">
          <h3 className="text-base font-semibold">{t("home.pinnedTitle")}</h3>
          <Link
            href="/portal/announcements"
            className="inline-flex items-center gap-1 text-sm text-primary hover:underline hover:underline-offset-4"
          >
            {t("home.seeAll")}
            <ForwardIcon className="size-4" aria-hidden />
          </Link>
        </div>
        <Card className="border border-border py-0 shadow-sm ring-0">
          <CardContent className="px-0">
            {pinned.length === 0 ? (
              <p className="px-5 py-4 text-sm text-muted-foreground">{t("home.pinnedEmpty")}</p>
            ) : (
              <ul className="divide-y divide-border">
                {pinned.map((a) => (
                  <li key={a.id}>
                    <Link
                      href="/portal/announcements"
                      className="flex gap-3 px-5 py-3 transition-colors hover:bg-primary/5 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
                    >
                      <span
                        aria-hidden
                        className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-tile-3 text-gold-ink"
                      >
                        <Pin className="size-4" />
                      </span>
                      <span className="grid min-w-0 flex-1 gap-0.5">
                        <span className="flex items-baseline gap-2">
                          <bdi dir="auto" className="min-w-0 flex-1 truncate text-sm font-medium text-start">
                            {a.title}
                          </bdi>
                          <span className="shrink-0 text-xs text-muted-foreground tabular-nums">
                            {formatDate(a.publish_at, locale)}
                          </span>
                        </span>
                        <span className="line-clamp-2 whitespace-pre-wrap text-xs leading-relaxed text-muted-foreground">
                          <bdi dir="auto" className="text-start">{a.body}</bdi>
                        </span>
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      </section>

      {/* ===== À venir =====
           One date-ordered list of the next fortnight — events, closures,
           appointments, exam dates — in the calendar's own rows, six at
           most, and the calendar as the tertiary door for the rest. Absent,
           not "nothing planned", when the read failed: the tab bar still
           leads to the calendar, which says what went wrong. */}
      {upcomingRead && (
        <SectionCard
          icon={CalendarDays}
          tone={0}
          title={t("home.upcomingTitle")}
          contentClassName="gap-0"
          action={
            <Link
              href="/portal/calendar"
              className="inline-flex min-h-9 items-center gap-1 text-sm text-primary hover:underline hover:underline-offset-4"
            >
              {t("home.seeCalendar")}
              <ForwardIcon className="size-4" aria-hidden />
            </Link>
          }
        >
          <FamilyAgenda
            items={upcoming}
            from={today}
            today={today}
            locale={locale}
            household={children.map((c) => ({ id: c.id, name: childDisplayName(c, locale) }))}
            structures={structures.map((s) => ({ id: s.id, name: structureName(s, locale) }))}
            showChildNames={children.length > 1}
            emptyLabel={t("home.upcomingEmpty")}
            limit={UPCOMING_LIMIT}
          />
        </SectionCard>
      )}

      {/* Where the crèche is. A parent looking this up is usually already on
          their way, so the pin and the directions button come first — the
          address line is what they read out to a taxi driver. */}
      <section>
        <div className="mb-3 flex items-center justify-between">
          <h3 className="text-base font-semibold">{tCommon("establishment.title")}</h3>
        </div>
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
            openingHours,
          }}
        />
      </section>
    </div>
  );
}
