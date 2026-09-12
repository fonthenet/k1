"use client";

import { useRef, useState, useTransition } from "react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { MoreHorizontal } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { StatusPill } from "@/components/shared/status-pill";
import { ValueRange } from "@/components/shared/value-range";
import { algiersClock, algiersDate } from "@/lib/algiers";
import { formatDate } from "@/lib/format";
import type { RoomChoice } from "@/components/modules/classes/class-types";
import { cn } from "@/lib/utils";
import {
  learningProfile,
  lessonNounProfile,
  type Lesson,
  type LessonActionError,
  type LessonActionResult,
  type LessonClash,
  type LessonStatus,
  type Program,
  type TimetableClass,
  type TimetableStructure,
} from "./domain";
import type { StaffChoice } from "./forms";
import { LessonFacts } from "./lesson-facts";
import { setLessonStatus } from "./timetable-actions";

/**
 * One cours, in full, with its actions — the click surface of a block.
 *
 * The hover card and this dialog render the same LessonFacts, so a reader
 * never finds a fact in one that the other lacks; what the dialog adds is
 * the state changes. Those go through setLessonStatus here rather than in
 * the view because their failures belong next to the buttons that caused
 * them: a restore refused because the slot was taken in the meantime is a
 * sentence under the footer, not a silently unchanged sheet.
 */
export interface LessonDetailProps {
  /** null = closed. */
  lesson: Lesson | null;
  cls?: TimetableClass;
  structure?: TimetableStructure | null;
  /** structures.length > 1 — the hover and the dialog show the structure alike. */
  showStructure: boolean;
  teacher?: StaffChoice;
  program?: Program;
  /** The room and whether it is inherited, resolved by the view for LessonFacts. */
  room?: RoomChoice | null;
  roomInherited?: boolean;
  locale: string;
  onClose: () => void;
  /** The view closes the detail and opens SessionEditor with this row. */
  onEdit: (lesson: Lesson) => void;
  /** After any successful status change; the view refreshes inside a transition. */
  onChanged: () => void;
}

interface StatusError {
  error: LessonActionError;
  at?: LessonClash;
}

export function LessonDetail({
  lesson,
  cls,
  structure,
  showStructure,
  teacher,
  program,
  room,
  roomInherited,
  locale,
  onClose,
  onEdit,
  onChanged,
}: LessonDetailProps) {
  const t = useTranslations("learning.timetable");
  const tc = useTranslations("common");
  const [isPending, startTransition] = useTransition();
  const [statusError, setStatusError] = useState<StatusError | null>(null);
  // The row is named by its own class: a crèche block is an activité even on
  // a building-wide sheet whose header says cours (spec D12).
  const profile = lessonNounProfile(learningProfile(cls?.type ?? ""));

  // A refusal belongs to the lesson it was refused for. Opening the dialog
  // on another row — or on the same row again — starts clean; adjusted
  // during render rather than in an effect so a stale line never flashes.
  const [seenId, setSeenId] = useState<string | null>(lesson?.id ?? null);
  if ((lesson?.id ?? null) !== seenId) {
    setSeenId(lesson?.id ?? null);
    setStatusError(null);
  }

  function close() {
    setStatusError(null);
    onClose();
  }

  // The dialog has no DialogTrigger — a block on the sheet opens it — and a
  // modal Radix dialog moves focus to its trigger on close, so without help
  // every Escape dropped the keyboard on <body> and the person lost their
  // place on the sheet. The element focused at open (the block) is recorded
  // and given the focus back; not when Modifier hands over to the editor,
  // whose own first field takes it.
  const openerRef = useRef<HTMLElement | null>(null);
  const handingOver = useRef(false);

  function edit(row: Lesson) {
    handingOver.current = true;
    onEdit(row);
  }

  // A restore that the ledger refuses (the slot was taken in the meantime,
  // the programme was archived since) is said in a toast: the dialog that
  // offered the undo is long closed, and a silent no-op would leave the
  // director believing the cours is back on the sheet.
  function undo(id: string) {
    setLessonStatus(id, "scheduled")
      .then((result) => (result.ok ? onChanged() : toast.error(t(`lessonErrors.${result.error}`, { profile }))))
      .catch(() => toast.error(t("lessonErrors.failed")));
  }

  function change(status: LessonStatus) {
    if (!lesson) return;
    const { id } = lesson;
    setStatusError(null);
    startTransition(async () => {
      // A request that never reaches the server (the connection dropped, the
      // tab went to sleep) rejects instead of answering; that is "failed",
      // said under the footer like every other refusal, not a crashed page.
      const result = await setLessonStatus(id, status).catch(
        (): LessonActionResult => ({ ok: false, error: "failed" }),
      );
      if (!result.ok) {
        setStatusError({ error: result.error, at: result.at });
        return;
      }
      onChanged();
      close();
      if (status === "cancelled") {
        toast(t("detail.cancelledToast", { profile }), {
          action: { label: t("detail.undo"), onClick: () => undo(id) },
        });
      }
    });
  }

  // A programme is no longer required to edit (0153); only an archived one
  // stands in the way, since the editor could not save the row back.
  const canEdit = !program?.archived;

  return (
    <Dialog open={!!lesson} onOpenChange={(open) => !open && close()}>
      <DialogContent
        dir={locale === "ar" ? "rtl" : "ltr"}
        className="sm:max-w-lg motion-reduce:animate-none"
        onOpenAutoFocus={() => {
          openerRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
        }}
        onCloseAutoFocus={(event) => {
          event.preventDefault();
          const opener = openerRef.current;
          openerRef.current = null;
          if (!handingOver.current && opener?.isConnected) opener.focus({ preventScroll: true });
          handingOver.current = false;
        }}
      >
        {lesson && (
          <>
            <DialogHeader>
              {/* pe-8 keeps the pill clear of the dialog's absolute close
                  button, which sits top-2 end-2 over this row. */}
              <div className="flex items-start justify-between gap-3 pe-8">
                <DialogTitle asChild>
                  <h2 className={cn("text-base font-semibold", lesson.status === "cancelled" && "text-muted-foreground line-through")}>
                    <bdi dir="auto" className="text-start">{lesson.title}</bdi>
                  </h2>
                </DialogTitle>
                {lesson.status === "completed" && <StatusPill tone="success">{t("detail.completed")}</StatusPill>}
                {lesson.status === "cancelled" && <StatusPill tone="muted">{t("detail.cancelled")}</StatusPill>}
              </div>
              <DialogDescription asChild>
                <p className="text-sm text-muted-foreground">
                  {formatDate(lesson.starts_at, locale, { weekday: "short", year: undefined })}
                  <span aria-hidden> · </span>
                  <ValueRange from={algiersClock(lesson.starts_at)} to={algiersClock(lesson.ends_at)} separator="–" className="tabular-nums" />
                </p>
              </DialogDescription>
            </DialogHeader>

            <LessonFacts
              variant="dialog"
              lesson={lesson}
              cls={cls}
              structure={structure}
              showStructure={showStructure}
              teacher={teacher}
              program={program}
              room={room}
              roomInherited={roomInherited}
            />

            {statusError && (
              <div className="space-y-1">
                <p role="alert" className="text-sm text-destructive">
                  {t(`lessonErrors.${statusError.error}`, { profile })}
                </p>
                {statusError.at && (
                  <p className="text-xs text-muted-foreground">
                    {/* The day is only worth a word when the clash is not on this cours's own day. */}
                    {statusError.at.date !== algiersDate(lesson.starts_at) && (
                      <>
                        {formatDate(statusError.at.date, locale, { weekday: "short", year: undefined })}
                        <span aria-hidden> · </span>
                      </>
                    )}
                    <ValueRange from={statusError.at.start} to={statusError.at.end} separator="–" className="tabular-nums" />
                  </p>
                )}
              </div>
            )}

            {/* Below sm the footer stacks (actions first, nearest the thumb)
                and stretches, so the link keeps the start edge it has on a
                desk instead of floating centred under the buttons. */}
            <DialogFooter className="sm:items-center sm:justify-between">
              <Link href={`/classes/${lesson.class_id}`} className="shrink-0 whitespace-nowrap text-sm text-primary">
                {t("detail.openClass")} <span aria-hidden className="inline-block rtl:rotate-180">›</span>
              </Link>
              {cls?.canTeach && (
                <div className="flex flex-wrap items-center justify-end gap-2">
                  {lesson.status === "scheduled" && (
                    <>
                      {/* An archived programme cannot be saved back by the
                          editor, so Modifier would only open a form that
                          refuses; the guidance is the editor's own copy. */}
                      {canEdit && (
                        <Button type="button" variant="outline" disabled={isPending} onClick={() => edit(lesson)}>
                          {tc("actions.edit")}
                        </Button>
                      )}
                      <Button type="button" variant="outline" disabled={isPending} onClick={() => change("completed")}>
                        {t("detail.complete")}
                      </Button>
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button type="button" variant="ghost" size="icon-sm" disabled={isPending} aria-label={t("detail.more")}>
                            <MoreHorizontal />
                          </Button>
                        </DropdownMenuTrigger>
                        {/* The trigger is an icon button, so the menu's
                            default trigger-width would fold "Annuler ce
                            cours" onto two lines; the item deserves one. */}
                        <DropdownMenuContent align="end" className="w-48">
                          <DropdownMenuItem variant="destructive" onSelect={() => change("cancelled")}>
                            {t("detail.cancel", { profile })}
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </>
                  )}
                  {lesson.status === "completed" && (
                    <Button type="button" variant="outline" disabled={isPending} onClick={() => change("scheduled")}>
                      {t("detail.reopen")}
                    </Button>
                  )}
                  {lesson.status === "cancelled" && (
                    <Button type="button" variant="outline" disabled={isPending} onClick={() => change("scheduled")}>
                      {t("detail.restore", { profile })}
                    </Button>
                  )}
                </div>
              )}
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
