"use client";

import { useMemo, useRef, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import { toast } from "sonner";
import { CalendarOff, ChevronLeft, ChevronRight, Loader2, Send, Users, UtensilsCrossed } from "lucide-react";
import { algiersInstant, algiersToday } from "@/lib/algiers";
import { childDisplayName, formatDate, formatTime, intlLocale } from "@/lib/format";
import type { EatenValue, JournalNap } from "@/lib/journal";
import type { LedgerStatus } from "@/lib/journal-ledger";
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
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ClassChip } from "@/components/shared/class-chip";
import { DatePicker } from "@/components/shared/date-picker";
import { EmptyState } from "@/components/shared/empty-state";
import { StatusPill } from "@/components/shared/status-pill";
import { ChildAvatar } from "@/components/modules/children/child-avatar";
import { structureName, type Structure } from "@/components/modules/classes/class-types";
import type { RegisterClassTab } from "./register-client";
import { addDaysStr } from "./dates";
import {
  MealCell,
  MoodCell,
  NapCell,
  NoteCell,
  PhotosCell,
  type JournalCellProps,
  type JournalField,
  type JournalFieldValue,
} from "./journal-cells";
import { bulkJournal, publishJournal, setJournalField } from "./journal-actions";

/*
 * Présences › Journal — one row per present child: mood, meal, nap, one
 * note, photos. Two lines per child on a desk, four on a phone or a tablet
 * in the room; the same five cells in both (journal-cells.tsx). Every cell
 * saves on change, optimistically; nothing reaches a family until Publier —
 * or until the evening send publishes the day itself (spec D4), which is why
 * the confirm sentence states both facts.
 */

export interface JournalRow {
  child: {
    id: string;
    first_name: string;
    last_name: string;
    first_name_ar: string | null;
    last_name_ar: string | null;
    photoUrl: string | null;
    className: string | null;
    classNameAr: string | null;
    classColor: string | null;
  };
  checkInAt: string | null;
  photoConsent: "granted" | "refused" | "unanswered";
  report: {
    id: string;
    mood: string | null;
    meal: EatenValue | null;
    /** The write shapes, plus the mobile app's historical `{slept: true, minutes}`. */
    nap: JournalNap | { slept: true; minutes: number } | null;
    notes: string | null;
    photos: { path: string; url: string | null }[];
    published: boolean;
  } | null;
  /** What the evening sender decided for this child today, when it has. */
  ledger: { status: LedgerStatus; decidedAt: string } | null;
}

type Report = NonNullable<JournalRow["report"]>;
type ReportPatch = Partial<Pick<Report, "mood" | "meal" | "nap" | "notes">>;

/** A row with nothing saved yet, for the optimistic value of its first cell. */
const EMPTY_REPORT: Report = {
  id: "",
  mood: null,
  meal: null,
  nap: null,
  notes: null,
  photos: [],
  published: false,
};

const KNOWN_ERRORS = new Set(["future", "closed", "absent", "profile", "consent", "forbidden", "invalid"]);

export function JournalClient({
  date,
  isClosedDay,
  closedHoliday,
  isFuture,
  classes,
  activeClass,
  structures,
  activeStructure,
  menuLunch,
  digest,
  canWrite,
  rows,
}: {
  date: string;
  isClosedDay: boolean;
  /** The confirmed holiday closing this date, when the closure is not the weekly pattern. */
  closedHoliday: { name: string; name_ar: string | null } | null;
  /** After today in Algiers — nothing is written about a day that has not come. */
  isFuture: boolean;
  /** The journal classes of the scope, `present` = rows on this screen. */
  classes: RegisterClassTab[];
  activeClass: string;
  /** The structures of the establishment; the picker hides itself under two. */
  structures: Structure[];
  /** A structure id, or "all" — the whole building. */
  activeStructure: string;
  /** The day's published lunch, printed once above the list. */
  menuLunch: string | null;
  /** The automatic send: on, still to come today, and around when ("HH:MM"). */
  digest: { enabled: boolean; dueToday: boolean; moment: string | null };
  /** False for an accountant: every control disabled, the day still readable. */
  canWrite: boolean;
  rows: JournalRow[];
}) {
  const t = useTranslations("attendance");
  const tj = useTranslations("attendance.journal");
  const tc = useTranslations("common");
  const locale = useLocale();
  const router = useRouter();
  const [, startTransition] = useTransition();

  const isToday = date === algiersToday();
  const disabled = !canWrite || isFuture || isClosedDay;

  const [optim, setOptim] = useState<Record<string, ReportPatch>>({});
  const [saving, setSaving] = useState<Record<string, boolean>>({});
  const [bulkPending, setBulkPending] = useState(false);
  const [publishOpen, setPublishOpen] = useState(false);
  const [publishing, setPublishing] = useState(false);
  // Where focus goes when the publish dialog closes on success: the Publier
  // trigger it would return to is disabled by the refresh that follows, and
  // focus on a disabled button falls to the document. The date picker in the
  // toolbar is the one control that is always there.
  const toolbarRef = useRef<HTMLDivElement>(null);
  const publishedRef = useRef(false);

  // Server data arrived — drop optimistic overrides.
  const [prevRows, setPrevRows] = useState(rows);
  if (prevRows !== rows) {
    setPrevRows(rows);
    setOptim({});
  }

  // The structure stays in the URL unless the caller is the one changing it,
  // so paging through days never quietly widens the journal to the building.
  const navigate = (d: string, c: string, s: string = activeStructure) =>
    router.push(
      `/attendance/journal?date=${d}&class=${encodeURIComponent(c)}` +
        (s === "all" ? "" : `&structure=${encodeURIComponent(s)}`)
    );

  const errorToast = (error: string) =>
    toast.error(KNOWN_ERRORS.has(error) ? tj(`errors.${error}`) : t("toasts.error"));

  /** The row as the screen shows it: the server's report under this session's
   *  unsaved taps. */
  const shown = useMemo(
    () =>
      rows.map((row) => {
        const patch = optim[row.child.id];
        if (!patch) return row;
        return { ...row, report: { ...(row.report ?? EMPTY_REPORT), ...patch } };
      }),
    [rows, optim]
  );

  const savingKey = (id: string, field: JournalField) => `${id}:${field}`;

  const handleChange = (row: JournalRow, field: JournalField, value: JournalFieldValue) => {
    // A nap that ends before it starts is a typo, refused here so the row
    // never shows a value the server is about to reject.
    if (field === "nap" && value !== null && typeof value === "object" && "start" in value && value.end <= value.start) {
      errorToast("invalid");
      return;
    }
    const id = row.child.id;
    const key = savingKey(id, field);
    const before = optim[id];
    setOptim((o) => ({ ...o, [id]: { ...o[id], [field]: value } }));
    setSaving((s) => ({ ...s, [key]: true }));
    startTransition(async () => {
      const res = await setJournalField({ childId: id, date, field, value });
      setSaving((s) => {
        const next = { ...s };
        delete next[key];
        return next;
      });
      if (!res.ok) {
        setOptim((o) => {
          const next = { ...o };
          if (before) next[id] = before;
          else delete next[id];
          return next;
        });
        errorToast(res.error);
      } else {
        router.refresh();
      }
    });
  };

  // "Tout le monde a bien mangé" fills the blanks of the rows on screen —
  // this structure, this class tab — and never rewrites a meal already said.
  const unfed = shown.filter((r) => !r.report?.meal).map((r) => r.child.id);
  const handleBulkMeal = () => {
    if (unfed.length === 0) return;
    setBulkPending(true);
    startTransition(async () => {
      const res = await bulkJournal({ date, childIds: unfed, patch: { meal: "all" } });
      setBulkPending(false);
      if (!res.ok) errorToast(res.error);
      else {
        toast.success(tj("saved"));
        router.refresh();
      }
    });
  };

  const drafts = shown.filter((r) => r.report && !r.report.published).map((r) => r.child.id);
  const handlePublish = () => {
    if (drafts.length === 0) return;
    setPublishing(true);
    startTransition(async () => {
      const res = await publishJournal({ date, childIds: drafts });
      setPublishing(false);
      if (!res.ok) errorToast(res.error);
      else {
        toast.success(tj("toasts.published", { count: res.count ?? drafts.length }));
        publishedRef.current = true;
        setPublishOpen(false);
        router.refresh();
      }
    });
  };

  const classLabel = (c: RegisterClassTab) => (locale === "ar" && c.name_ar ? c.name_ar : c.name);
  const dayLabel = new Intl.DateTimeFormat(intlLocale(locale), {
    weekday: "long",
    timeZone: "Africa/Algiers",
  }).format(new Date(algiersInstant(date, "12:00")));
  const registerHref =
    `/attendance?date=${date}` +
    (activeStructure === "all" ? "" : `&structure=${encodeURIComponent(activeStructure)}`);
  // The moment the family's phone rings, said in the reader's clock.
  const momentLabel = digest.moment ? formatTime(algiersInstant(date, digest.moment), locale) : null;
  // The one sentence for a day nothing can be written about.
  const dayNotice = isFuture
    ? t("nav.futureNotice")
    : closedHoliday
      ? t("nav.holidayNotice", {
          name: locale === "ar" && closedHoliday.name_ar ? closedHoliday.name_ar : closedHoliday.name,
        })
      : t("nav.closedNotice", { day: dayLabel });

  // Photos have no in-flight state of their own (the dialog shows its own
  // progress), so they take no field.
  const cellProps = (row: JournalRow, field?: JournalField): JournalCellProps => ({
    row,
    date,
    disabled,
    saving: field ? !!saving[savingKey(row.child.id, field)] : false,
    menuLunch,
    onChange: (f, v) => handleChange(row, f, v),
  });

  return (
    <div className="space-y-4">
      {/* The register's filter card: the day, the structure, and at the end
          the two actions of the screen — the blanks filled in one tap, and
          the one primary. */}
      <div
        ref={toolbarRef}
        className="flex flex-wrap items-center gap-2 rounded-xl border border-border bg-card p-2.5 shadow-sm"
      >
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
          <Label htmlFor="journal-date" className="sr-only">
            {tc("labels.date")}
          </Label>
          <DatePicker
            id="journal-date"
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
              onClick={() => navigate(algiersToday(), activeClass)}
            >
              {t("nav.today")}
            </Button>
          )}
        </div>

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

        <div className="ms-auto flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={handleBulkMeal}
            disabled={disabled || bulkPending || unfed.length === 0}
          >
            {bulkPending ? (
              <Loader2 data-icon="inline-start" className="animate-spin" />
            ) : (
              <UtensilsCrossed data-icon="inline-start" />
            )}
            {tj("bulkMeal")}
          </Button>
          <Button size="sm" onClick={() => setPublishOpen(true)} disabled={disabled || drafts.length === 0}>
            <Send data-icon="inline-start" className="rtl:-scale-x-100" />
            {tj("publish")}
          </Button>
        </div>
      </div>

      {/* The register's own sentence for a shut or unborn day, in the same
          gold line as the register's; the controls below are disabled rather
          than the card repainted. When such a day
          holds no row the sentence IS the empty state — a second one asking
          to point arrivals would contradict it. */}
      {(isClosedDay || isFuture) && rows.length > 0 && (
        <p
          role="status"
          className="flex items-center gap-2 rounded-lg bg-gold/10 px-3 py-2 text-sm font-medium text-gold-ink"
        >
          <CalendarOff className="size-4 shrink-0" aria-hidden />
          {dayNotice}
        </p>
      )}

      {rows.length === 0 ? (
        isClosedDay || isFuture ? (
          <EmptyState icon={<CalendarOff />} title={dayNotice} />
        ) : (
          <EmptyState
            icon={<Users />}
            title={tj("empty")}
            description={tj("emptyDescription")}
            action={
              <Button variant="outline" asChild>
                <Link href={registerHref}>{tj("openRegister")}</Link>
              </Button>
            }
          />
        )
      ) : (
        <Card className="border border-border py-0 shadow-sm ring-0">
          <CardContent className="px-0">
            {/* The card's head: the class tabs, when there is a choice to
                make, and the day's menu once — the fact every meal track
                answers "how much of" without printing it on every row. */}
            {(classes.length > 1 || menuLunch) && (
              <div className="flex min-h-12 flex-wrap items-center gap-x-4 gap-y-2 border-b border-border px-4 py-2">
                {/* Activation is manual: each tab is a page navigation, and
                    an arrow key alone must move between them without loading
                    a class. Below lg the track scrolls on one line, the
                    timetable's day strip; on a tablet or a desk it wraps, so
                    seven class chips all stay in view. */}
                {classes.length > 1 && (
                  <Tabs
                    value={activeClass}
                    activationMode="manual"
                    onValueChange={(v) => navigate(date, v)}
                    className="min-w-0 max-w-full gap-0"
                  >
                    <TabsList className="h-auto! max-w-full flex-nowrap justify-start overflow-x-auto snap-x snap-mandatory lg:flex-wrap lg:overflow-visible">
                      <TabsTrigger value="all" className="h-7 shrink-0 snap-start gap-1.5 px-3">
                        {t("tabs.all")}
                        <span dir="ltr" className="text-xs tabular-nums text-muted-foreground">
                          {classes.reduce((n, c) => n + c.present, 0)}
                        </span>
                      </TabsTrigger>
                      {classes.map((c) => (
                        <TabsTrigger key={c.id} value={c.id} className="h-7 shrink-0 snap-start gap-1.5 px-3">
                          {classLabel(c)}
                          <span dir="ltr" className="text-xs tabular-nums text-muted-foreground">
                            {c.present}
                          </span>
                        </TabsTrigger>
                      ))}
                    </TabsList>
                  </Tabs>
                )}
                {menuLunch && (
                  <p
                    // Takes the rest of the tab row when a readable width is
                    // left, otherwise its own line under the chips — a menu cut
                    // to three words would say less than the hover title.
                    className="min-w-0 basis-full truncate text-xs text-muted-foreground lg:ms-auto lg:min-w-80 lg:flex-1 lg:basis-0 lg:text-end"
                    title={menuLunch}
                  >
                    <UtensilsCrossed className="me-1.5 inline size-3.5 align-[-2px]" aria-hidden />
                    <bdi dir="auto">{menuLunch}</bdi>
                  </p>
                )}
              </div>
            )}

            {/* One divide-y list, one block per child, the same five cells at
                every width. On a desk a block is two lines beside the name:
                mood, meal and the sent state, then nap, note and photos. A
                single-line table was the first draft, and its seven cells —
                four icon toggles, a four-word track, two clock pickers and a
                toggle, a 192px note — measure ~1400px against the ~1030px the
                content column has at 1360 beside the sidebar: the state cell,
                the one that says whether the family got the day, would have
                scrolled off the card. Below lg — a phone, or a tablet in the
                room beside the sidebar — the same block stacks into the four
                lines a finger works through. */}
            <ul className="divide-y divide-border" aria-label={tj("columns.child")}>
              {shown.map((row) => (
                <li
                  key={row.child.id}
                  className="grid gap-3 px-4 py-3 transition-colors hover:bg-primary/5 lg:grid-cols-[minmax(13rem,16rem)_1fr] lg:items-start lg:px-5"
                >
                  <div className="flex min-w-0 items-center gap-3">
                    <div className="min-w-0 flex-1">
                      <ChildCell row={row} showClass={activeClass === "all"} />
                    </div>
                    {/* On a phone the state takes at most half the line and
                        wraps inside it: the name is the fact the eye lands on,
                        and "Non envoyé · pas de compte famille" must never
                        squeeze it down to one letter. */}
                    <div className="ms-auto max-w-[50%] shrink-0 lg:hidden">
                      <SentState row={row} />
                    </div>
                  </div>
                  {/* `min-w-0` on every grid child: a grid track otherwise
                      grows to its widest content, and one long note or name
                      would push the whole block past the card's edge. */}
                  <div className="grid min-w-0 gap-2">
                    <div className="flex min-w-0 flex-wrap items-center gap-3">
                      <MoodCell {...cellProps(row, "mood")} />
                      <MealCell {...cellProps(row, "meal")} />
                      <div className="ms-auto hidden lg:block">
                        <SentState row={row} />
                      </div>
                    </div>
                    <div className="flex min-w-0 flex-wrap items-center gap-3">
                      <NapCell {...cellProps(row, "nap")} />
                      {/* The note takes its own line under the nap on a phone,
                          the rest of the nap's line on a desk. */}
                      <div className="flex min-w-0 basis-full items-center gap-2 lg:flex-1 lg:basis-auto">
                        <NoteCell {...cellProps(row, "notes")} />
                        <PhotosCell {...cellProps(row)} />
                      </div>
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}

      {/* Publier: one sentence that says both facts — visible now, and when
          the phone rings — so the mother who opens the portal at 14:00 sees
          the nap, and nobody is told twice. */}
      <Dialog open={publishOpen} onOpenChange={(open) => !open && setPublishOpen(false)}>
        <DialogContent
          className="sm:max-w-md"
          onCloseAutoFocus={(e) => {
            if (!publishedRef.current) return;
            publishedRef.current = false;
            e.preventDefault();
            toolbarRef.current?.querySelector<HTMLElement>("#journal-date")?.focus();
          }}
        >
          <DialogHeader>
            <DialogTitle>{tj("publishTitle", { date: formatDate(date, locale) })}</DialogTitle>
            <DialogDescription>
              {digest.enabled && digest.dueToday && momentLabel
                ? tj.rich("publishDigest", {
                    time: momentLabel,
                    ltr: (c) => <span dir="ltr" className="tabular-nums">{c}</span>,
                  })
                : tj("publishNow")}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setPublishOpen(false)}>
              {tc("actions.cancel")}
            </Button>
            <Button onClick={handlePublish} disabled={publishing || drafts.length === 0}>
              {publishing && <Loader2 data-icon="inline-start" className="animate-spin" />}
              {tj("publishConfirm")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

/** Avatar, name as the door to the child's file, the other script muted
 *  under it, the class chip only when the screen mixes classes. */
function ChildCell({ row, showClass }: { row: JournalRow; showClass: boolean }) {
  const locale = useLocale();
  const c = row.child;
  const name = childDisplayName(c, locale);
  const other =
    locale === "ar"
      ? `${c.first_name} ${c.last_name}`
      : c.first_name_ar && c.last_name_ar
        ? `${c.first_name_ar} ${c.last_name_ar}`
        : null;
  const className = locale === "ar" && c.classNameAr ? c.classNameAr : c.className;
  return (
    <div className="flex min-w-0 items-center gap-3">
      <ChildAvatar firstName={c.first_name} lastName={c.last_name} photoUrl={c.photoUrl} className="size-10" />
      <div className="min-w-0">
        <Link
          href={`/children/${c.id}`}
          className="block truncate font-semibold hover:underline focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none rounded"
        >
          <bdi dir="auto">{name}</bdi>
        </Link>
        {/* The other script and, when the screen mixes classes, the class —
            on the second line, so the name never yields its width to a chip. */}
        {((other && other !== name) || (showClass && className)) && (
          <div className="mt-0.5 flex min-w-0 flex-wrap items-center gap-x-2 gap-y-0.5">
            {showClass && className && <ClassChip name={className} color={c.classColor} />}
            {other && other !== name && (
              <p className="truncate text-xs text-muted-foreground">
                <bdi dir="auto">{other}</bdi>
              </p>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

/**
 * One mark per row for what the family got. The success pill is spent only
 * on the fact worth a colour — the family was told, at that time. Any other
 * ledger decision is its one muted reason (a decided row is a published
 * row, so "Publié" beside it would say the same thing twice); published
 * with no decision yet is the muted word alone; a draft shows nothing — the
 * absence is the signal.
 */
function SentState({ row }: { row: JournalRow }) {
  const tj = useTranslations("attendance.journal");
  const locale = useLocale();
  const { report, ledger } = row;
  if (ledger?.status === "sent") {
    return (
      <StatusPill tone="success" className="whitespace-nowrap">
        {tj.rich("sentAt", {
          time: formatTime(ledger.decidedAt, locale),
          ltr: (c) => <span dir="ltr" className="tabular-nums">{c}</span>,
        })}
      </StatusPill>
    );
  }
  if (ledger) {
    return <span className="block text-end text-xs text-muted-foreground">{tj(`ledger.${ledger.status}`)}</span>;
  }
  if (report?.published) {
    return <span className="block text-end text-xs text-muted-foreground">{tj("published")}</span>;
  }
  return null;
}
