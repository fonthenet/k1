"use client";

import { useMemo, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import { toast } from "sonner";
import {
  ChevronLeft,
  ChevronRight,
  CircleDashed,
  History,
  Loader2,
  LogOut,
  Pencil,
  TriangleAlert,
  UserCheck,
  UserX,
  Users,
  type LucideIcon,
} from "lucide-react";
import type { AttendanceStatus } from "@/lib/types";
import { childDisplayName, formatDate, formatTime, initials } from "@/lib/format";
import { cn } from "@/lib/utils";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
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
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { EmptyState } from "@/components/shared/empty-state";
import {
  SortableHeader,
  compareValues,
  nextSort,
  type SortState,
} from "@/components/shared/sortable-header";
import { DatePicker } from "@/components/shared/date-picker";
import { TimePicker } from "@/components/shared/time-picker";
import { ATTENDANCE_STATUSES, STATUS_STYLES, isPresentish } from "./status-config";
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
  allergies: string[];
  attendance: {
    status: AttendanceStatus;
    check_in_at: string | null;
    check_out_at: string | null;
    picked_up_by: string | null;
    absence_reason: string | null;
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

function isoToTimeInput(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  return `${`${d.getHours()}`.padStart(2, "0")}:${`${d.getMinutes()}`.padStart(2, "0")}`;
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
  date,
  isClosedDay,
  dayLabel,
  classes,
  totals,
  activeClass,
  rows,
}: {
  date: string;
  isClosedDay: boolean;
  dayLabel: string;
  classes: RegisterClassTab[];
  /** Presence across every enrolled child, for the "all classes" tab. */
  totals: { present: number; total: number };
  activeClass: string;
  rows: RegisterRow[];
}) {
  const isToday = date === toDateStr(new Date());
  const t = useTranslations("attendance");
  const tc = useTranslations("common");
  const locale = useLocale();
  const router = useRouter();
  const [, startTransition] = useTransition();

  const [optimStatus, setOptimStatus] = useState<Record<string, AttendanceStatus>>({});
  const [savingIds, setSavingIds] = useState<Record<string, boolean>>({});
  const [bulkPending, setBulkPending] = useState(false);
  const [timeDialog, setTimeDialog] = useState<TimeDialogState | null>(null);
  const [timeSaving, setTimeSaving] = useState(false);
  const [sort, setSort] = useState<SortState<RegisterSortKey>>({ key: "none", dir: "asc" });

  // Server data arrived — drop optimistic overrides.
  const [prevRows, setPrevRows] = useState(rows);
  if (prevRows !== rows) {
    setPrevRows(rows);
    setOptimStatus({});
  }

  const navigate = (d: string, c: string) =>
    router.push(`/attendance?date=${d}&class=${encodeURIComponent(c)}`);

  const displayStatus = (row: RegisterRow): AttendanceStatus | null =>
    optimStatus[row.child.id] ?? row.attendance?.status ?? null;

  const counters = useMemo(() => {
    let present = 0;
    let absent = 0;
    let notMarked = 0;
    let checkedOut = 0;
    for (const row of rows) {
      const s = displayStatus(row);
      if (s === null) notMarked++;
      else if (isPresentish(s)) present++;
      else absent++;
      if (row.attendance?.check_out_at) checkedOut++;
    }
    return { present, absent, notMarked, checkedOut };
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
        toast.error(t("toasts.error"));
      } else {
        router.refresh();
      }
    });
  };

  const handleCheckOut = (row: RegisterRow) => {
    const id = row.child.id;
    setSaving(id, true);
    startTransition(async () => {
      const res = await checkOutNow({ childId: id, date });
      setSaving(id, false);
      if (!res.ok) toast.error(t("toasts.error"));
      else {
        toast.success(t("toasts.checkedOut"));
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
      const res = await markAllPresent({ date, childIds: unmarked });
      setBulkPending(false);
      if (!res.ok) toast.error(t("toasts.error"));
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
      if (!res.ok) toast.error(t("toasts.error"));
      else {
        toast.success(t("toasts.timesSaved"));
        setTimeDialog(null);
        router.refresh();
      }
    });
  };

  // Headline counters — the gold tile keeps the strip from reading all-green.
  const counterCards: {
    key: "present" | "absent" | "notMarked" | "checkedOut";
    label: string;
    value: number;
    icon: LucideIcon;
    tile: string;
  }[] = [
    {
      key: "present",
      label: t("status.present"),
      value: counters.present,
      icon: UserCheck,
      tile: "bg-success/10 text-success",
    },
    {
      key: "absent",
      label: t("status.absent"),
      value: counters.absent,
      icon: UserX,
      tile: "bg-destructive/10 text-destructive",
    },
    {
      key: "notMarked",
      label: t("status.notMarked"),
      value: counters.notMarked,
      icon: CircleDashed,
      tile: "bg-muted text-muted-foreground",
    },
    {
      key: "checkedOut",
      label: t("table.checkOut"),
      value: counters.checkedOut,
      icon: LogOut,
      tile: "bg-gold text-gold-foreground",
    },
  ];

  return (
    <div className="space-y-6">
      {/* Toolbar: date navigation + actions */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        {/* One segmented control: ‹ date › [Today].
            The picker is ghost — it used to be an outlined button inside this
            outlined group, a box drawn twice, with its calendar icon sitting
            right next to the Today button's calendar icon. The date is now
            "aujourd'hui" when it is today, because the person opening the
            register mostly wants to know they are on the right day, not to
            parse a date; and Today only appears once it would do something. */}
        <div className="flex items-center gap-2">
          <div className="flex items-center gap-0.5 rounded-xl border border-border bg-card p-1 shadow-sm">
            <Button
              variant="ghost"
              size="icon"
              aria-label={t("nav.prevDay")}
              title={t("nav.prevDay")}
              onClick={() => navigate(addDaysStr(date, -1), activeClass)}
            >
              <ChevronLeft className="rtl:-scale-x-100" />
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
              size="icon"
              aria-label={t("nav.nextDay")}
              title={t("nav.nextDay")}
              onClick={() => navigate(addDaysStr(date, 1), activeClass)}
            >
              <ChevronRight className="rtl:-scale-x-100" />
            </Button>
            {!isToday && (
              <>
                <Separator orientation="vertical" className="mx-0.5 !h-5" />
                <Button
                  variant="ghost"
                  size="sm"
                  className="text-primary hover:text-primary"
                  onClick={() => navigate(toDateStr(new Date()), activeClass)}
                >
                  {t("nav.today")}
                </Button>
              </>
            )}
          </div>
        </div>

        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" asChild>
            <Link href="/attendance/history">
              <History data-icon="inline-start" />
              {t("nav.history")}
            </Link>
          </Button>
          <Button size="sm" onClick={handleBulk} disabled={bulkPending || rows.length === 0}>
            {bulkPending ? (
              <Loader2 data-icon="inline-start" className="animate-spin" />
            ) : (
              <UserCheck data-icon="inline-start" />
            )}
            {t("actions.markAllPresent")}
          </Button>
        </div>
      </div>

      {isClosedDay && (
        <div className="flex items-center gap-3 rounded-xl border border-gold/25 bg-gold-muted px-4 py-3 text-sm font-medium text-foreground">
          <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-gold text-gold-foreground">
            <TriangleAlert className="size-4" />
          </span>
          {t("nav.closedNotice", { day: dayLabel })}
        </div>
      )}

      {/* Counters */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {counterCards.map((c) => (
          <div
            key={c.key}
            className="flex items-center gap-3 rounded-xl border border-border bg-card p-3 shadow-sm"
          >
            <span
              className={cn(
                "flex size-10 shrink-0 items-center justify-center rounded-lg",
                c.tile
              )}
            >
              <c.icon className="size-5" />
            </span>
            <div className="min-w-0">
              <div className="text-2xl leading-none font-bold tabular-nums">{c.value}</div>
              <div className="mt-1 truncate text-xs text-muted-foreground">{c.label}</div>
            </div>
          </div>
        ))}
      </div>

      {/* Class filter. Every tab carries its class's presence count ("3/5")
          in the same label-plus-count vocabulary the billing chips taught the
          office, so an educator sees whether her room is complete before she
          taps anything. The counts stay neutral on purpose — five coloured
          badges would turn one row of tabs into an alarm panel, and the number
          itself is the signal. The open tab shows the live client-side counter
          so it can never disagree with the tiles above it while a tap is still
          saving; the other tabs show the server's numbers, which every
          mutation refreshes. Taller triggers than the default because this is
          a tablet screen worked with a thumb, not a pointer. */}
      <Tabs value={activeClass} onValueChange={(v) => navigate(date, v)}>
        <TabsList className="flex-wrap gap-1 group-data-horizontal/tabs:h-auto">
          {[
            { value: "all", label: t("tabs.all"), ...totals },
            ...classes.map((c) => ({
              value: c.id,
              label: locale === "ar" && c.name_ar ? c.name_ar : c.name,
              present: c.present,
              total: c.total,
            })),
          ].map((tab) => {
            const active = activeClass === tab.value;
            const present = active ? counters.present : tab.present;
            return (
              <TabsTrigger key={tab.value} value={tab.value} className="h-10 px-3">
                {tab.label}
                {/* A class with no children has no presence question to answer. */}
                {tab.total > 0 && (
                  <>
                    <span
                      aria-hidden
                      className={cn(
                        "rounded-4xl px-1.5 py-0.5 text-xs font-medium tabular-nums",
                        active ? "bg-muted text-muted-foreground" : "bg-background/60"
                      )}
                    >
                      {present}/{tab.total}
                    </span>
                    <span className="sr-only">
                      {t("tabs.presence", { present, total: tab.total })}
                    </span>
                  </>
                )}
              </TabsTrigger>
            );
          })}
        </TabsList>
      </Tabs>

      {/* Register table */}
      {rows.length === 0 ? (
        <EmptyState
          icon={
            <span className="flex size-14 items-center justify-center rounded-2xl bg-primary/10 text-primary">
              <Users className="size-7" />
            </span>
          }
          title={t("empty.title")}
          description={t("empty.description")}
        />
      ) : (
        <Card className={cn("py-0 shadow-sm", isClosedDay && "bg-muted")}>
          <CardContent className="overflow-x-auto p-0">
            <Table>
              <TableHeader>
                {/* Child, status and check-in sort; check-out and details do
                    not — a column of buttons and free-text inputs has no order
                    worth offering. The [&>button] override keeps the sortable
                    headers at the same weight as the plain ones beside them. */}
                <TableRow>
                  <SortableHeader
                    columnKey="child"
                    sort={sort}
                    onSort={onSort}
                    className="min-w-52 text-xs tracking-wide uppercase [&>button]:font-semibold"
                  >
                    {t("table.child")}
                  </SortableHeader>
                  <SortableHeader
                    columnKey="status"
                    sort={sort}
                    onSort={onSort}
                    className="text-xs tracking-wide uppercase [&>button]:font-semibold"
                  >
                    {t("table.status")}
                  </SortableHeader>
                  <SortableHeader
                    columnKey="checkIn"
                    sort={sort}
                    onSort={onSort}
                    className="text-xs tracking-wide uppercase [&>button]:font-semibold"
                  >
                    {t("table.checkIn")}
                  </SortableHeader>
                  <TableHead className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">
                    {t("table.checkOut")}
                  </TableHead>
                  <TableHead className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">
                    {t("table.details")}
                  </TableHead>
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
                    <TableRow key={row.child.id}>
                      <TableCell className="py-3">
                        <div className="flex items-center gap-3">
                          {/* Status rail — lets staff scan the whole register at a glance. */}
                          <span
                            aria-hidden
                            className={cn(
                              "h-10 w-1 shrink-0 rounded-full",
                              status ? STATUS_STYLES[status].cellClass : "bg-border"
                            )}
                          />
                          <Avatar className="size-10 ring-2 ring-border">
                            {row.child.photoUrl && (
                              <AvatarImage src={row.child.photoUrl} alt={name} />
                            )}
                            <AvatarFallback className="bg-primary/10 text-xs font-semibold text-primary">
                              {initials(row.child.first_name, row.child.last_name)}
                            </AvatarFallback>
                          </Avatar>
                          <div className="min-w-0">
                            <div className="flex items-center gap-2">
                              <Link
                                href={`/children/${row.child.id}`}
                                className="truncate font-semibold hover:text-primary hover:underline focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
                              >
                                {name}
                              </Link>
                              {row.allergies.length > 0 && (
                                <Badge
                                  variant="destructive"
                                  title={t("allergy.list", {
                                    list: row.allergies.join(", "),
                                  })}
                                >
                                  <TriangleAlert />
                                  {t("allergy.badge")}
                                </Badge>
                              )}
                            </div>
                            {row.child.className && (
                              <p className="truncate text-xs text-muted-foreground">
                                {locale === "ar" && row.child.classNameAr
                                  ? row.child.classNameAr
                                  : row.child.className}
                              </p>
                            )}
                          </div>
                        </div>
                      </TableCell>

                      <TableCell>
                        <div className="inline-flex items-center gap-0.5 rounded-xl border border-border bg-muted/60 p-1">
                          {ATTENDANCE_STATUSES.map((s) => {
                            const style = STATUS_STYLES[s];
                            const Icon = style.icon;
                            const active = status === s;
                            return (
                              <button
                                key={s}
                                type="button"
                                aria-pressed={active}
                                aria-label={t(`status.${s}`)}
                                title={t(`status.${s}`)}
                                disabled={saving}
                                onClick={() => handleStatus(row, s)}
                                className={cn(
                                  "inline-flex h-7 items-center gap-1 rounded-lg px-2 text-xs font-medium transition-colors disabled:opacity-60",
                                  active ? style.activeClass : style.idleClass
                                )}
                              >
                                <Icon className="size-3.5" />
                                <span className="hidden xl:inline">{t(`status.${s}`)}</span>
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
                            <span className="font-semibold tabular-nums">
                              {formatTime(att.check_in_at, locale)}
                            </span>
                          ) : (
                            <span className="text-muted-foreground">—</span>
                          )}
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
                          <span className="inline-flex items-center gap-1.5 rounded-full bg-gold/15 px-2.5 py-1 text-xs font-semibold tabular-nums text-foreground">
                            <LogOut className="size-3.5 text-gold rtl:-scale-x-100" />
                            {formatTime(att.check_out_at, locale)}
                          </span>
                        ) : canCheckOut ? (
                          <Button
                            variant="outline"
                            size="sm"
                            className="border-gold/40 hover:bg-gold/10"
                            disabled={saving}
                            onClick={() => handleCheckOut(row)}
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
                          <InlineText
                            defaultValue={att?.absence_reason ?? ""}
                            placeholder={t("fields.absenceReasonPlaceholder")}
                            ariaLabel={t("fields.absenceReason")}
                            onSave={(v) => handleText(row, "absence_reason", v)}
                          />
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
    </div>
  );
}
