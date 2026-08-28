"use client";

import { useMemo, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import { toast } from "sonner";
import {
  CalendarDays,
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
import { childDisplayName, formatTime, initials } from "@/lib/format";
import { cn } from "@/lib/utils";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
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
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { EmptyState } from "@/components/shared/empty-state";
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
  activeClass,
  rows,
}: {
  date: string;
  isClosedDay: boolean;
  dayLabel: string;
  classes: RegisterClassTab[];
  activeClass: string;
  rows: RegisterRow[];
}) {
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
        <div className="flex items-center gap-2">
          <div className="flex items-center gap-1 rounded-xl border border-border bg-card p-1 shadow-sm">
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
              className="h-8 w-36 text-center font-medium tabular-nums"
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
          </div>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => navigate(toDateStr(new Date()), activeClass)}
          >
            <CalendarDays data-icon="inline-start" />
            {t("nav.today")}
          </Button>
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

      {/* Class filter */}
      <Tabs value={activeClass} onValueChange={(v) => navigate(date, v)}>
        <TabsList className="flex-wrap">
          <TabsTrigger value="all">{t("tabs.all")}</TabsTrigger>
          {classes.map((c) => (
            <TabsTrigger key={c.id} value={c.id}>
              {locale === "ar" && c.name_ar ? c.name_ar : c.name}
            </TabsTrigger>
          ))}
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
                <TableRow className="bg-muted/50 hover:bg-muted/50">
                  <TableHead className="min-w-52 text-xs font-semibold tracking-wide text-muted-foreground uppercase">
                    {t("table.child")}
                  </TableHead>
                  <TableHead className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">
                    {t("table.status")}
                  </TableHead>
                  <TableHead className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">
                    {t("table.checkIn")}
                  </TableHead>
                  <TableHead className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">
                    {t("table.checkOut")}
                  </TableHead>
                  <TableHead className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">
                    {t("table.details")}
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((row) => {
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
