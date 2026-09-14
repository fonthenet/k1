"use client";

import { useMemo, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import { toast } from "sonner";
import {
  CalendarOff,
  ChevronLeft,
  ChevronRight,
  CircleDashed,
  Loader2,
  LogOut,
  Undo2,
  Pencil,
  UserCheck,
  UserX,
  Users,
} from "lucide-react";
import type { AttendanceStatus } from "@/lib/types";
import { childDisplayName, formatDate, formatTime, initials } from "@/lib/format";
import { algiersClock } from "@/lib/algiers";
import { cn } from "@/lib/utils";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
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
import { StatCard } from "@/components/shared/stat-card";
import {
  SortableHeader,
  compareValues,
  nextSort,
  type SortState,
} from "@/components/shared/sortable-header";
import { DatePicker } from "@/components/shared/date-picker";
import { TimePicker } from "@/components/shared/time-picker";
import { AllergyBadge } from "@/components/modules/children/allergy-badge";
import type { AllergyItem } from "@/components/modules/children/types";
import { structureName, type Structure } from "@/components/modules/classes/class-types";
import { ATTENDANCE_STATUSES, STATUS_STYLES, isPresentish, stillHere } from "./status-config";
import { HandoverStrip } from "./handover-cards";
import { AttendanceTabs } from "./attendance-tabs";
import { addDaysStr, toDateStr } from "./dates";
import {
  checkOutNow,
  markAllPresent,
  setAttendanceStatus,
  setAttendanceText,
  setAttendanceTimes,
} from "./actions";

export interface RegisterClassTab {
  id: string;
  name: string;
  name_ar: string | null;
  /** Children of this class marked present or late today — the tab's "3/5". */
  present: number;
  /** Enrolled children in this class, marked or not. */
  total: number;
}

/**
 * Someone the office already knows may collect this child: a linked guardian,
 * or a name a parent added to `kg_authorized_pickups`. Resolved on the server
 * with the rest of the register, so choosing one costs no round-trip.
 */
export interface RegisterCollector {
  /** null for an authorized pickup — there is no guardian record to point at. */
  guardianId: string | null;
  name: string;
  /** Already translated server-side. */
  relationship: string | null;
  /** `can_pickup`, or any authorized pickup: shown first and seeded by default. */
  preferred: boolean;
}

export interface RegisterRow {
  child: {
    id: string;
    first_name: string;
    last_name: string;
    first_name_ar: string | null;
    last_name_ar: string | null;
    photoUrl: string | null;
    className: string | null;
    classNameAr: string | null;
  };
  /** Translated allergen label plus severity — what the shared AllergyBadge draws. */
  allergies: AllergyItem[];
  collectors: RegisterCollector[];
  /** The day's moves in order (0170) — more than two means the child came back. */
  passes: { direction: "in" | "out"; at: string }[];
  attendance: {
    status: AttendanceStatus;
    check_in_at: string | null;
    check_out_at: string | null;
    picked_up_by: string | null;
    absence_reason: string | null;
    /** The family reported this absence from the portal (kg_report_absence). */
    reported_by_parent: boolean;
  } | null;
}

// "none" is a real member of the sort state, not the absence of one: the
// register must open in exactly the order the office has always seen (the
// server's first-name order), and only a tap on a header starts re-cutting it.
type RegisterSortKey = "none" | "child" | "status" | "checkIn";

interface TimeDialogState {
  childId: string;
  name: string;
  checkIn: string;
  checkOut: string;
}

interface CheckOutDialogState {
  childId: string;
  name: string;
  collectors: RegisterCollector[];
  pickedUpBy: string;
  guardianId: string | null;
}

/**
 * The stored instant as the HH:mm the dialog should show — in Algiers.
 * getHours() read the browser's zone, so a director checking the register
 * from abroad saw a shifted time and, on save, wrote the shift back. Reading
 * and writing (algiersInstant, in the action) now share one anchor.
 */
function isoToTimeInput(iso: string | null): string {
  return iso ? algiersClock(iso) : "";
}

function InlineText({
  defaultValue,
  placeholder,
  ariaLabel,
  onSave,
}: {
  defaultValue: string;
  placeholder: string;
  ariaLabel: string;
  onSave: (value: string) => void;
}) {
  const [value, setValue] = useState(defaultValue);
  const [prevDefault, setPrevDefault] = useState(defaultValue);
  if (prevDefault !== defaultValue) {
    setPrevDefault(defaultValue);
    setValue(defaultValue);
  }
  return (
    <Input
      value={value}
      placeholder={placeholder}
      aria-label={ariaLabel}
      onChange={(e) => setValue(e.target.value)}
      onBlur={() => {
        if (value.trim() !== defaultValue.trim()) onSave(value.trim());
      }}
      onKeyDown={(e) => {
        if (e.key === "Enter") (e.target as HTMLInputElement).blur();
      }}
      className="h-8 w-40"
    />
  );
}

export function RegisterClient({
  title,
  description,
  date,
  isClosedDay,
  closedHoliday,
  isFuture,
  dayLabel,
  classes,
  totals,
  activeClass,
  structures,
  activeStructure,
  showJournal,
  rows,
  handovers,
}: {
  /** The PageHeader is drawn here, not in page.tsx, because its one primary
   *  button (mark everyone present) is client state — pending, disabled on a
   *  future day — and a header cannot hold a button it cannot drive. */
  title: string;
  description: string;
  date: string;
  isClosedDay: boolean;
  /** The confirmed holiday closing this date, when the closure is not the weekly pattern. */
  closedHoliday: { name: string; name_ar: string | null } | null;
  /** After today in Algiers — the register is read-only there. */
  isFuture: boolean;
  dayLabel: string;
  /** Already narrowed to `activeStructure` by the server. */
  classes: RegisterClassTab[];
  /** Presence across every child the register is showing, for the "all classes" tab. */
  totals: { present: number; total: number };
  activeClass: string;
  /** The structures of the establishment (0127); the picker hides itself under two. */
  structures: Structure[];
  /** A structure id, or "all" — the whole building. */
  activeStructure: string;
  /** Whether a scoped class keeps a journal, so the tab bar offers the Journal tab. */
  showJournal: boolean;
  rows: RegisterRow[];
  /** Something the page wants read before the roster — the hand-overs parents
   *  asked for at the door (0168). Drawn under the header and the tabs, above
   *  the filter card, because the header lives here and page.tsx cannot
   *  follow it otherwise. */
  /**
   * Departures parents asked for at the door (0168), waiting on a member of
   * the team: the tenant to poll, or null where self check-in is off. Data,
   * not an element — a server page handing a client component a ready-made
   * element leaves React without a key for it and the register warned on
   * every load.
   */
  handovers?: { tenantId: string } | null;
}) {
  const isToday = date === toDateStr(new Date());
  const t = useTranslations("attendance");
  const tc = useTranslations("common");
  // The class filter's label is the roster's: one word for one control.
  const tch = useTranslations("children");
  const locale = useLocale();
  const router = useRouter();
  const [, startTransition] = useTransition();

  const [optimStatus, setOptimStatus] = useState<Record<string, AttendanceStatus>>({});
  const [savingIds, setSavingIds] = useState<Record<string, boolean>>({});
  const [bulkPending, setBulkPending] = useState(false);
  const [timeDialog, setTimeDialog] = useState<TimeDialogState | null>(null);
  const [timeSaving, setTimeSaving] = useState(false);
  const [checkOutDialog, setCheckOutDialog] = useState<CheckOutDialogState | null>(null);
  const [sort, setSort] = useState<SortState<RegisterSortKey>>({ key: "none", dir: "asc" });

  // Server data arrived — drop optimistic overrides.
  const [prevRows, setPrevRows] = useState(rows);
  if (prevRows !== rows) {
    setPrevRows(rows);
    setOptimStatus({});
  }

  // The structure stays in the URL unless the caller is the one changing it,
  // so paging through days never quietly widens the register back to the
  // whole building.
  const navigate = (d: string, c: string, s: string = activeStructure) =>
    router.push(
      `/attendance?date=${d}&class=${encodeURIComponent(c)}` +
        (s === "all" ? "" : `&structure=${encodeURIComponent(s)}`)
    );

  const displayStatus = (row: RegisterRow): AttendanceStatus | null =>
    optimStatus[row.child.id] ?? row.attendance?.status ?? null;

  // The server refuses two things by name — a day that has not come, and a
  // bulk stamp on a closed day — and each deserves its own sentence rather
  // than the generic "something went wrong".
  const errorToast = (error: string) => {
    if (error === "future") toast.error(t("toasts.future"));
    else if (error === "closed") toast.error(t("toasts.closed"));
    else toast.error(t("toasts.error"));
  };

  const counters = useMemo(() => {
    let present = 0;
    let absent = 0;
    let notMarked = 0;
    let checkedOut = 0;
    let reportedByParents = 0;
    let stillIn = 0;
    let lastOut: string | null = null;
    for (const row of rows) {
      const s = displayStatus(row);
      if (s === null) notMarked++;
      else if (isPresentish(s)) present++;
      else {
        absent++;
        if (row.attendance?.reported_by_parent) reportedByParents++;
      }
      if (row.attendance?.check_out_at) {
        checkedOut++;
        if (lastOut === null || row.attendance.check_out_at > lastOut) lastOut = row.attendance.check_out_at;
      }
      if (row.attendance && stillHere(row.attendance)) stillIn++;
    }
    return { present, absent, notMarked, checkedOut, reportedByParents, stillIn, lastOut };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows, optimStatus]);

  const onSort = (key: RegisterSortKey) => setSort((s) => nextSort(s, key));

  // A sorted VIEW of the rows — the row objects themselves are untouched, so
  // every status handler keeps working on the same data it always did.
  const sortedRows = useMemo(() => {
    if (sort.key === "none") return rows;
    const valueOf = (row: RegisterRow): string | number | null => {
      switch (sort.key) {
        case "child":
          // The displayed name, so Arabic sorts by the Arabic name the staff
          // actually read, not by a Latin field they cannot see on screen.
          return childDisplayName(row.child, locale);
        case "status": {
          // The segmented control's own order (present → excused), so sorted
          // groups appear in the same sequence as the buttons that set them.
          const s = displayStatus(row);
          return s === null ? null : ATTENDANCE_STATUSES.indexOf(s);
        }
        case "checkIn":
          // ISO timestamps compare correctly as plain strings; children who
          // never checked in have no value and sink, as nulls always do here.
          return row.attendance?.check_in_at ?? null;
        default:
          return null;
      }
    };
    return [...rows].sort((a, b) => compareValues(valueOf(a), valueOf(b), sort.dir, locale));
    // displayStatus reads optimStatus, so a status tap re-sorts immediately
    // instead of waiting out the server round-trip.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows, sort, locale, optimStatus]);

  const setSaving = (id: string, on: boolean) =>
    setSavingIds((s) => ({ ...s, [id]: on }));

  const handleStatus = (row: RegisterRow, status: AttendanceStatus) => {
    const id = row.child.id;
    setOptimStatus((o) => ({ ...o, [id]: status }));
    setSaving(id, true);
    startTransition(async () => {
      const res = await setAttendanceStatus({ childId: id, date, status });
      setSaving(id, false);
      if (!res.ok) {
        setOptimStatus((o) => {
          const next = { ...o };
          delete next[id];
          return next;
        });
        errorToast(res.error);
      } else {
        router.refresh();
      }
    });
  };

  /**
   * The departure is asked for, not just stamped. The button used to write the
   * row with nobody attached, leaving the one safeguarding fact of the day to a
   * free-text box in another column that staff had to notice afterwards.
   */
  const openCheckOut = (row: RegisterRow, name: string) => {
    // Seed the first preferred collector: the common case is the mother at the
    // gate, and it should cost one confirm, not a choice.
    const seed = row.collectors.find((c) => c.preferred) ?? null;
    setCheckOutDialog({
      childId: row.child.id,
      name,
      collectors: row.collectors,
      pickedUpBy: seed?.name ?? "",
      guardianId: seed?.guardianId ?? null,
    });
  };

  const handleCheckOut = () => {
    if (!checkOutDialog) return;
    const { childId: id, pickedUpBy, guardianId } = checkOutDialog;
    setSaving(id, true);
    startTransition(async () => {
      const res = await checkOutNow({
        childId: id,
        date,
        pickedUpBy: pickedUpBy.trim() || undefined,
        // The id only describes the name it was chosen with — see the typing
        // handler below, which drops it.
        guardianId: guardianId ?? undefined,
      });
      setSaving(id, false);
      if (!res.ok) toast.error(t("toasts.error"));
      else {
        toast.success(t("toasts.checkedOut"));
        setCheckOutDialog(null);
        router.refresh();
      }
    });
  };

  const handleText = (
    row: RegisterRow,
    field: "picked_up_by" | "absence_reason",
    value: string
  ) => {
    startTransition(async () => {
      const res = await setAttendanceText({ childId: row.child.id, date, field, value });
      if (!res.ok) toast.error(t("toasts.error"));
      else {
        toast.success(t("toasts.saved"));
        router.refresh();
      }
    });
  };

  /**
   * The stamp reaches exactly the children on screen and no further.
   *
   * `rows` is what the server sent for this structure and this class tab, so
   * an educator looking at the jardin cannot mark the crèche's babies present
   * by tapping a button whose label says "all". The structure travels with the
   * call too: the day it is checked against is the jardin's calendar, not the
   * building's.
   */
  const handleBulk = () => {
    const unmarked = rows
      .filter((r) => displayStatus(r) === null)
      .map((r) => r.child.id);
    if (unmarked.length === 0) {
      toast.info(t("toasts.bulkNone"));
      return;
    }
    setBulkPending(true);
    startTransition(async () => {
      const res = await markAllPresent({
        date,
        childIds: unmarked,
        structureId: activeStructure === "all" ? undefined : activeStructure,
      });
      setBulkPending(false);
      if (!res.ok) errorToast(res.error);
      else {
        toast.success(t("toasts.bulkDone", { count: res.count ?? unmarked.length }));
        router.refresh();
      }
    });
  };

  const handleTimeSave = () => {
    if (!timeDialog) return;
    setTimeSaving(true);
    startTransition(async () => {
      const res = await setAttendanceTimes({
        childId: timeDialog.childId,
        date,
        checkIn: timeDialog.checkIn,
        checkOut: timeDialog.checkOut,
      });
      setTimeSaving(false);
      if (!res.ok) errorToast(res.error);
      else {
        toast.success(t("toasts.timesSaved"));
        setTimeDialog(null);
        router.refresh();
      }
    });
  };

  const dateLabel = isToday ? t("nav.todayLabel") : formatDate(date, locale);
  const classLabel = (c: RegisterClassTab) => (locale === "ar" && c.name_ar ? c.name_ar : c.name);

  return (
    <div>
      {/* One primary per page: the stamp that fills the register. The
          journal and the history are sibling routes, so they are tabs under
          the header rather than buttons beside it. */}
      <PageHeader title={title} description={description}>
        <Button
          size="sm"
          onClick={handleBulk}
          disabled={bulkPending || rows.length === 0 || isFuture}
        >
          {bulkPending ? (
            <Loader2 data-icon="inline-start" className="animate-spin" />
          ) : (
            <UserCheck data-icon="inline-start" />
          )}
          {t("actions.markAllPresent")}
        </Button>
      </PageHeader>

      <AttendanceTabs
        active="register"
        date={date}
        structure={activeStructure === "all" ? null : activeStructure}
        showJournal={showJournal}
      />

      {/* Under the header and the tabs, above the roster: a class of
          twenty-five fills several screens, and the ten minutes a request
          lives are not spent scrolling to the last row. The strip collapses
          to nothing while nobody is waiting. */}
      {handovers ? <HandoverStrip tenantId={handovers.tenantId} enabled className="mb-4" /> : null}

      <div className="space-y-4">
        {/* The roster's filter card: the day, the structure, the class, and
            the live count last. The date is "aujourd'hui" when it is today,
            because the person opening the register mostly wants to know they
            are on the right day, not to parse a date; Today only appears once
            it would do something. */}
        <div className="flex flex-wrap items-center gap-2 rounded-xl border border-border bg-card p-2.5 shadow-sm">
          <div className="flex items-center gap-0.5">
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label={t("nav.prevDay")}
              title={t("nav.prevDay")}
              onClick={() => navigate(addDaysStr(date, -1), activeClass)}
            >
              <ChevronLeft className="rtl:rotate-180" />
            </Button>
            <Label htmlFor="register-date" className="sr-only">
              {tc("labels.date")}
            </Label>
            <DatePicker
              id="register-date"
              value={date}
              onChange={(v) => {
                if (v) navigate(v, activeClass);
              }}
              variant="ghost"
              label={
                isToday ? (
                  t("nav.todayLabel")
                ) : (
                  <span className="tabular-nums">{formatDate(date, locale)}</span>
                )
              }
              className="h-8 w-40 justify-center font-medium"
            />
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label={t("nav.nextDay")}
              title={t("nav.nextDay")}
              onClick={() => navigate(addDaysStr(date, 1), activeClass)}
            >
              <ChevronRight className="rtl:rotate-180" />
            </Button>
            {!isToday && (
              <Button
                variant="ghost"
                size="sm"
                className="text-primary hover:text-primary"
                onClick={() => navigate(toDateStr(new Date()), activeClass)}
              >
                {t("nav.today")}
              </Button>
            )}
          </div>

          {/* Which activity of the establishment, beside which day — the two
              questions that decide whose register this is. Only once there is
              more than one: a crèche running a single structure must never be
              asked to choose between one thing. Changing it drops back to all
              classes, because the classes below belong to the structure and a
              class from the other one is not among them. */}
          {structures.length > 1 && (
            <Select value={activeStructure} onValueChange={(v) => navigate(date, "all", v)}>
              <SelectTrigger className="w-52" aria-label={t("structures.filter")}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">{t("structures.all")}</SelectItem>
                {structures.map((s) => (
                  <SelectItem key={s.id} value={s.id}>
                    {structureName(s, locale)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}

          {/* Every class carries its presence count ("3/5") so an educator
              sees whether her room is complete before she opens it. The open
              class shows the live client-side counter so it can never
              disagree with the tiles while a tap is still saving; the others
              show the server's numbers, which every mutation refreshes. */}
          <Select value={activeClass} onValueChange={(v) => navigate(date, v)}>
            <SelectTrigger className="w-56" aria-label={tch("roster.filterClass")}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {[
                { value: "all", label: t("tabs.all"), ...totals },
                ...classes.map((c) => ({
                  value: c.id,
                  label: classLabel(c),
                  present: c.present,
                  total: c.total,
                })),
              ].map((item) => {
                const present = activeClass === item.value ? counters.stillIn : item.present;
                return (
                  <SelectItem key={item.value} value={item.value}>
                    <span className="flex items-center gap-1.5">
                      {item.label}
                      {/* A class with no children has no presence question to answer. */}
                      {item.total > 0 && (
                        <>
                          <span aria-hidden className="text-muted-foreground">
                            ·
                          </span>
                          <span
                            dir="ltr"
                            aria-hidden
                            className="text-xs tabular-nums text-muted-foreground"
                          >
                            {present}/{item.total}
                          </span>
                          <span className="sr-only">
                            {t("tabs.presence", { present, total: item.total })}
                          </span>
                        </>
                      )}
                    </span>
                  </SelectItem>
                );
              })}
            </SelectContent>
          </Select>

          <span className="rounded-full bg-primary/10 px-3 py-1 text-sm font-medium tabular-nums text-primary">
            {t("tabs.presence", { present: counters.stillIn, total: rows.length })}
          </span>
        </div>

        {/* One sentence, whichever rule closed the day: the weekly pattern or
            a confirmed holiday. The holiday variant names it (in Arabic when
            the office typed an Arabic name), because "closed on Sunday" is not
            the answer when the question is "why is 1 November empty". A
            future day gets the same line with a different sentence. Gold,
            the colour of "a person should look": the owner read the muted
            line as a footnote and missed that the whole register was shut.
            A tinted line with the closed-calendar glyph, not a band across
            the page — the register below still says whether the day
            happened; this only explains why it is empty. */}
        {(isClosedDay || isFuture) && (
          <p
            role="status"
            className="flex items-center gap-2 rounded-lg bg-gold/10 px-3 py-2 text-sm font-medium text-gold-ink"
          >
            <CalendarOff className="size-4 shrink-0" aria-hidden />
            {/* A closure names itself even on a day still ahead: "not yet
                arrived" is true of every future day and says nothing, while
                "closed — travaux" is why next Monday's register will stay
                empty. */}
            {closedHoliday
              ? t("nav.holidayNotice", {
                  name:
                    locale === "ar" && closedHoliday.name_ar
                      ? closedHoliday.name_ar
                      : closedHoliday.name,
                })
              : isFuture
                ? t("nav.futureNotice")
                : t("nav.closedNotice", { day: dayLabel })}
          </p>
        )}

        {/* Headline counters. Each hint says something the label did not:
            the denominator, who reported the absence, how many are still in
            the building. The one gold on the page is the sorties tile. */}
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          {/* "Present" used to sit here and read as "in the building" — a
              child who arrived at 08:29 and left at 08:34 counted as present
              all day. The green tile now answers the question the hall is
              asking: who is here NOW; the day's classification (came at all)
              is the hint under it. */}
          <StatCard
            label={t("status.here")}
            value={counters.stillIn}
            hint={t("counters.cameOfTotal", { came: counters.present, total: rows.length })}
            icon={<UserCheck className="size-5" />}
            tone="success"
          />
          <StatCard
            label={t("status.absent")}
            value={counters.absent}
            hint={t("counters.reportedByParents", { count: counters.reportedByParents })}
            icon={<UserX className="size-5" />}
            tone="danger"
          />
          <StatCard
            label={t("status.notMarked")}
            value={counters.notMarked}
            hint={dateLabel}
            icon={<CircleDashed className="size-5" />}
          />
          <StatCard
            label={t("table.checkOut")}
            value={counters.checkedOut}
            hint={
              counters.lastOut
                ? t("counters.lastDeparture", { time: formatTime(counters.lastOut, locale) })
                : t("counters.noDeparture")
            }
            icon={<LogOut className="size-5 rtl:-scale-x-100" />}
            tone="gold"
          />
        </div>

        {/* Register table */}
        {rows.length === 0 ? (
          <EmptyState
            icon={<Users />}
            title={t("empty.title")}
            description={t("empty.description")}
          />
        ) : (
          // A closed day does not repaint the table: the line above already
          // says the door is shut, and greying the card would say it twice.
          <Card className="border border-border py-0 shadow-sm ring-0">
            <CardContent className="px-0">
              <Table className="[&_td]:px-3 [&_th]:px-3 [&_td:first-child]:ps-5 [&_th:first-child]:ps-5 [&_td:last-child]:pe-5 [&_th:last-child]:pe-5">
                <TableHeader>
                  {/* Child, status and check-in sort; check-out and details do
                      not — a column of buttons and free-text inputs has no
                      order worth offering. The sortable heads drop their own
                      inner padding so they line up with the plain ones, and
                      the plain ones take the sortable heads' muted ink so the
                      row is one weight and one colour. */}
                  <TableRow className="[&>th]:font-semibold [&>th]:text-muted-foreground">
                    <SortableHeader
                      columnKey="child"
                      sort={sort}
                      onSort={onSort}
                      className="min-w-52 [&>button]:px-0 [&>button]:font-semibold"
                    >
                      {t("table.child")}
                    </SortableHeader>
                    <SortableHeader
                      columnKey="status"
                      sort={sort}
                      onSort={onSort}
                      className="[&>button]:px-0 [&>button]:font-semibold"
                    >
                      {t("table.status")}
                    </SortableHeader>
                    <SortableHeader
                      columnKey="checkIn"
                      sort={sort}
                      onSort={onSort}
                      className="[&>button]:px-0 [&>button]:font-semibold"
                    >
                      {t("table.checkIn")}
                    </SortableHeader>
                    <TableHead>{t("table.checkOut")}</TableHead>
                    <TableHead>{t("table.details")}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {sortedRows.map((row) => {
                    const status = displayStatus(row);
                    const att = row.attendance;
                    const name = childDisplayName(row.child, locale);
                    const saving = savingIds[row.child.id];
                    const canCheckOut = !!att?.check_in_at && !att?.check_out_at;
                    const absentish = status !== null && !isPresentish(status);
                    const checkedOut = !!att?.check_out_at;
                    return (
                      <TableRow key={row.child.id} className="transition-colors hover:bg-primary/5">
                        <TableCell className="py-3">
                          {/* The pressed segmented button is the status mark;
                              the row carries no rail or ring to repeat it.
                              The allergy badge is the one red in the cell. */}
                          <div className="flex items-center gap-3">
                            <Avatar className="size-8">
                              {row.child.photoUrl && (
                                <AvatarImage src={row.child.photoUrl} alt={name} />
                              )}
                              <AvatarFallback className="bg-primary/10 text-[11px] font-semibold text-primary">
                                {initials(row.child.first_name, row.child.last_name)}
                              </AvatarFallback>
                            </Avatar>
                            <div className="min-w-0">
                              <div className="flex items-center gap-2">
                                <Link
                                  href={`/children/${row.child.id}`}
                                  className="truncate font-semibold hover:underline focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none rounded"
                                >
                                  <bdi dir="auto">{name}</bdi>
                                </Link>
                                <AllergyBadge
                                  allergens={row.allergies}
                                  href={`/children/${row.child.id}?tab=health`}
                                />
                              </div>
                              {row.child.className && (
                                <p className="truncate text-xs text-muted-foreground">
                                  <bdi dir="auto">
                                    {locale === "ar" && row.child.classNameAr
                                      ? row.child.classNameAr
                                      : row.child.className}
                                  </bdi>
                                </p>
                              )}
                            </div>
                          </div>
                        </TableCell>

                        <TableCell>
                          <div className="inline-flex items-center gap-0.5 rounded-xl border border-border bg-muted/60 p-1">
                            {ATTENDANCE_STATUSES.map((s) => {
                              const style = STATUS_STYLES[s];
                              const active = status === s;
                              // A child who came and has gone home is still
                              // "present" in the day's ledger, but a green
                              // "Présent" on their row reads as "in class".
                              // The selected chip says what is true now —
                              // "Parti" — in the neutral tone of a day that
                              // is over; the word behind it (present or late)
                              // is unchanged and one tap away.
                              const gone = active && checkedOut && isPresentish(s);
                              const Icon = gone ? LogOut : style.icon;
                              const label = gone ? t("status.gone") : t(`status.${s}`);
                              return (
                                <button
                                  key={s}
                                  type="button"
                                  aria-pressed={active}
                                  aria-label={label}
                                  title={label}
                                  disabled={saving || isFuture}
                                  onClick={() => handleStatus(row, s)}
                                  className={cn(
                                    "inline-flex h-7 items-center gap-1 rounded-lg px-2 text-xs font-medium transition-colors disabled:opacity-60",
                                    gone
                                      ? "border border-border bg-background text-foreground shadow-sm"
                                      : active
                                        ? style.activeClass
                                        : style.idleClass
                                  )}
                                >
                                  <Icon className={cn("size-3.5", gone && "rtl:-scale-x-100")} />
                                  <span className="hidden xl:inline">{label}</span>
                                </button>
                              );
                            })}
                            {saving && (
                              <Loader2 className="ms-1 size-3.5 animate-spin text-muted-foreground" />
                            )}
                          </div>
                        </TableCell>

                        <TableCell className="whitespace-nowrap">
                          <div className="flex items-center gap-1">
                            {att?.check_in_at ? (
                              <span className="tabular-nums">
                                {formatTime(att.check_in_at, locale)}
                              </span>
                            ) : status !== null && isPresentish(status) && !isToday ? (
                              // A past day marked present from memory carries no
                              // arrival time on purpose (see setAttendanceStatus);
                              // say so, and leave the pencil to enter a real one.
                              <span className="text-xs text-muted-foreground">
                                {t("table.timeNotRecorded")}
                              </span>
                            ) : (
                              <span className="text-muted-foreground">—</span>
                            )}
                            {/* A child who left and came back: the row keeps the
                                morning's arrival; the return is said here so
                                nobody reads a single pass into a day of three. */}
                            {(() => {
                              const back = [...row.passes].reverse().find((p, i, arr) => p.direction === "in" && arr.slice(i + 1).some((q) => q.direction === "out"));
                              return back ? (
                                <span className="inline-flex items-center gap-1 text-xs text-muted-foreground" title={t("table.returnedAt", { time: formatTime(back.at, locale) })}>
                                  <Undo2 className="size-3.5 rtl:-scale-x-100" aria-hidden />
                                  <span dir="ltr" className="tabular-nums">{formatTime(back.at, locale)}</span>
                                </span>
                              ) : null;
                            })()}
                            <Button
                              variant="ghost"
                              size="icon-sm"
                              aria-label={t("actions.editTimes")}
                              title={t("actions.editTimes")}
                              onClick={() =>
                                setTimeDialog({
                                  childId: row.child.id,
                                  name,
                                  checkIn: isoToTimeInput(att?.check_in_at ?? null),
                                  checkOut: isoToTimeInput(att?.check_out_at ?? null),
                                })
                              }
                            >
                              <Pencil />
                            </Button>
                          </div>
                        </TableCell>

                        <TableCell className="whitespace-nowrap">
                          {att?.check_out_at ? (
                            <span className="inline-flex max-w-60 items-center gap-1.5">
                              {/* The clock sits beside a name that may be
                                  Arabic or Latin. Two neutral runs either side
                                  of a separator get reordered by an RTL
                                  paragraph, so the time keeps its own isolate. */}
                              <span dir="ltr" className="tabular-nums">
                                {formatTime(att.check_out_at, locale)}
                              </span>
                              {att.picked_up_by && (
                                <>
                                  <span aria-hidden className="text-muted-foreground">
                                    ·
                                  </span>
                                  <bdi
                                    dir="auto"
                                    className="min-w-0 truncate text-muted-foreground"
                                    title={att.picked_up_by}
                                  >
                                    {att.picked_up_by}
                                  </bdi>
                                </>
                              )}
                            </span>
                          ) : canCheckOut ? (
                            <Button
                              variant="outline"
                              size="sm"
                              disabled={saving}
                              onClick={() => openCheckOut(row, name)}
                            >
                              <LogOut data-icon="inline-start" className="rtl:-scale-x-100" />
                              {t("actions.checkOutNow")}
                            </Button>
                          ) : (
                            <span className="text-muted-foreground">—</span>
                          )}
                        </TableCell>

                        <TableCell>
                          {absentish ? (
                            <div>
                              <InlineText
                                defaultValue={att?.absence_reason ?? ""}
                                placeholder={t("fields.absenceReasonPlaceholder")}
                                ariaLabel={t("fields.absenceReason")}
                                onSave={(v) => handleText(row, "absence_reason", v)}
                              />
                              {/* Provenance, in words and nothing else: the
                                  family said so from the portal, the office did
                                  not type it. One muted line — no tint, no icon. */}
                              {att?.reported_by_parent && (
                                <p className="mt-1 text-xs text-muted-foreground">
                                  {t("fields.reportedByParent")}
                                </p>
                              )}
                            </div>
                          ) : checkedOut ? (
                            <InlineText
                              defaultValue={att?.picked_up_by ?? ""}
                              placeholder={t("fields.pickedUpByPlaceholder")}
                              ariaLabel={t("fields.pickedUpBy")}
                              onSave={(v) => handleText(row, "picked_up_by", v)}
                            />
                          ) : (
                            <span className="text-muted-foreground">—</span>
                          )}
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        )}
      </div>
      {/* Manual time dialog */}
      <Dialog open={timeDialog !== null} onOpenChange={(open) => !open && setTimeDialog(null)}>
        <DialogContent className="sm:max-w-sm">
          {timeDialog && (
            <>
              <DialogHeader>
                <DialogTitle>{t("timeDialog.title", { name: timeDialog.name })}</DialogTitle>
                <DialogDescription>
                  {t("timeDialog.description", { date })}
                </DialogDescription>
              </DialogHeader>
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="att-time-in">{t("timeDialog.checkIn")}</Label>
                  <TimePicker
                    id="att-time-in"
                    value={timeDialog.checkIn}
                    onChange={(v) =>
                      setTimeDialog((d) => (d ? { ...d, checkIn: v } : d))
                    }
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="att-time-out">{t("timeDialog.checkOut")}</Label>
                  <TimePicker
                    id="att-time-out"
                    value={timeDialog.checkOut}
                    onChange={(v) =>
                      setTimeDialog((d) => (d ? { ...d, checkOut: v } : d))
                    }
                  />
                </div>
              </div>
              <p className="text-xs text-muted-foreground">{t("timeDialog.hint")}</p>
              <DialogFooter>
                <Button variant="outline" onClick={() => setTimeDialog(null)}>
                  {tc("actions.cancel")}
                </Button>
                <Button onClick={handleTimeSave} disabled={timeSaving}>
                  {timeSaving && <Loader2 data-icon="inline-start" className="animate-spin" />}
                  {tc("actions.save")}
                </Button>
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>

      {/* Check-out dialog — who took the child, asked while it can still be
          answered. Free text stays for the grandmother nobody has added yet:
          refusing the unusual case would just mean nothing gets recorded. */}
      <Dialog
        open={checkOutDialog !== null}
        onOpenChange={(open) => !open && setCheckOutDialog(null)}
      >
        <DialogContent className="sm:max-w-sm">
          {checkOutDialog && (
            <>
              <DialogHeader>
                <DialogTitle>
                  {t("checkOutDialog.title", { name: checkOutDialog.name })}
                </DialogTitle>
                {/* The sentence promises a list only when there is one. A
                    child nobody has been linked to yet gets the reason and
                    the door to fix it — the office types the name today and
                    adds the family to the record so tomorrow costs one tap. */}
                <DialogDescription>
                  {checkOutDialog.collectors.length > 0
                    ? t("checkOutDialog.description")
                    : t("checkOutDialog.noCollectors")}
                </DialogDescription>
              </DialogHeader>
              {checkOutDialog.collectors.length === 0 && (
                <Link
                  href={`/children/${checkOutDialog.childId}`}
                  className="inline-flex items-center gap-1 text-sm font-medium text-primary hover:underline"
                >
                  {t("checkOutDialog.addInRecord")}
                  <ChevronRight className="size-4 rtl:-scale-x-100" aria-hidden />
                </Link>
              )}
              {checkOutDialog.collectors.length > 0 && (
                <div className="flex flex-wrap gap-2">
                  {checkOutDialog.collectors.map((c) => {
                    const active = checkOutDialog.pickedUpBy === c.name;
                    return (
                      <button
                        key={c.guardianId ?? `pickup:${c.name}`}
                        type="button"
                        aria-pressed={active}
                        onClick={() =>
                          setCheckOutDialog((d) =>
                            d ? { ...d, pickedUpBy: c.name, guardianId: c.guardianId } : d
                          )
                        }
                        className={cn(
                          "inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-xs font-medium transition-colors",
                          active
                            ? "border-primary/30 bg-primary/10 text-primary"
                            : "border-border bg-muted/60 text-muted-foreground hover:text-foreground"
                        )}
                      >
                        {c.name}
                        {c.relationship && (
                          <span className="opacity-70">· {c.relationship}</span>
                        )}
                      </button>
                    );
                  })}
                </div>
              )}
              <div className="space-y-2">
                <Label htmlFor="att-picked-up-by">
                  {checkOutDialog.collectors.length > 0
                    ? t("checkOutDialog.orType")
                    : t("fields.pickedUpBy")}
                </Label>
                <Input
                  id="att-picked-up-by"
                  value={checkOutDialog.pickedUpBy}
                  placeholder={t("fields.pickedUpByPlaceholder")}
                  maxLength={120}
                  onChange={(e) =>
                    setCheckOutDialog((d) =>
                      // Typed over a chosen guardian: the id no longer
                      // describes what the name says.
                      d ? { ...d, pickedUpBy: e.target.value, guardianId: null } : d
                    )
                  }
                />
              </div>
              <DialogFooter>
                <Button variant="outline" onClick={() => setCheckOutDialog(null)}>
                  {tc("actions.cancel")}
                </Button>
                <Button
                  onClick={handleCheckOut}
                  disabled={!!savingIds[checkOutDialog.childId]}
                >
                  {savingIds[checkOutDialog.childId] ? (
                    <Loader2 data-icon="inline-start" className="animate-spin" />
                  ) : (
                    <LogOut data-icon="inline-start" className="rtl:-scale-x-100" />
                  )}
                  {t("actions.checkOutNow")}
                </Button>
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
