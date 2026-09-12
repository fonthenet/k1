"use client";

import Link from "next/link";
import { useLocale, useTranslations } from "next-intl";
import { ClassChip } from "@/components/shared/class-chip";
import { StatusPill } from "@/components/shared/status-pill";
import { StructureMark } from "@/components/shared/structure-mark";
import { ValueRange } from "@/components/shared/value-range";
import { roomName, type RoomChoice } from "@/components/modules/classes/class-types";
import { formatDate, initialsFromName } from "@/lib/format";
import { cn } from "@/lib/utils";
import {
  learningProfile,
  type Lesson,
  type Program,
  type TimetableClass,
  type TimetableStructure,
} from "./domain";
import type { StaffChoice } from "./forms";

/**
 * The facts of one cours, drawn once and shared by every surface that says
 * them: the hover card a person reads before clicking a block, and the detail
 * dialog they click into. Two surfaces with two copies of these rows drifted
 * the first time — the dialog learnt the programme dates and the hover did
 * not — so both now render this one list and differ only by `variant`.
 *
 * No buttons live here. The dialog owns its actions in its footer; the hover
 * is read-only by design (a pointer that rests on a block must never change
 * anything).
 */

/**
 * The type a new entry takes and the one the facts leave unsaid (spec D11):
 * an école teaches cours, a therapy centre runs ateliers, everybody else —
 * crèche, préscolaire, camp — adds activités. A crèche's default is the
 * activity, not the care routine: Éveil sensoriel is what the day is planned
 * around, and Accueil · Repas · Sieste take kind "care" from the title chips
 * in the editor rather than from the default.
 */
export function defaultKind(type: string): string {
  const profile = learningProfile(type);
  if (profile === "academic") return "lesson";
  if (profile === "therapy") return "therapy";
  return "activity";
}

/**
 * The first paragraph of a programme's objectives, CRLF-safe.
 *
 * Objectives are typed in a textarea and one demo programme arrived with
 * Windows line endings; splitting on "\n\n" alone then returned the whole
 * text as one paragraph and the hover card grew to the bottom of the screen.
 */
export function firstParagraph(objectives: string): string {
  const paragraphs = objectives
    .split(/\r?\n[ \t]*\r?\n/)
    .map((paragraph) =>
      paragraph
        .replace(/\r/g, "")
        .split("\n")
        .map((line) => line.trim())
        .filter(Boolean)
        .join("\n"),
    )
    .filter(Boolean);
  return paragraphs[0] ?? "";
}

export interface LessonFactsProps {
  lesson: Lesson;
  cls?: TimetableClass;
  structure?: TimetableStructure | null;
  /** structures.length > 1 — the hover and the dialog alike. */
  showStructure: boolean;
  /** undefined → "—" (a departed member). */
  teacher?: StaffChoice;
  /** undefined (archived / outside the team) → the Programme block is omitted. */
  program?: Program;
  /** The room the cours happens in — its own, or its class's home room —
   *  resolved by the view; null or undefined → the Salle row is omitted. */
  room?: RoomChoice | null;
  /** true when the cours inherits its class's home room (room_id NULL, D2):
   *  the row says so in a muted tail, since that is the arrangement that
   *  moves with the class rather than a choice made for this cours. */
  roomInherited?: boolean;
  variant: "hover" | "dialog";
}

function Row({
  label,
  children,
  className,
}: {
  label: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("flex items-center justify-between gap-3 py-2", className)}>
      <dt className="shrink-0 text-muted-foreground">{label}</dt>
      <dd className="flex min-w-0 items-center justify-end gap-2">{children}</dd>
    </div>
  );
}

export function LessonFacts({
  lesson,
  cls,
  structure,
  showStructure,
  teacher,
  program,
  room,
  roomInherited,
  variant,
}: LessonFactsProps) {
  const t = useTranslations("learning.timetable");
  const tl = useTranslations("learning");
  const tc = useTranslations("common.rooms");
  const locale = useLocale();
  const dialog = variant === "dialog";
  const objectives = program ? firstParagraph(program.objectives) : "";

  return (
    <dl className="divide-y divide-border text-sm">
      <Row label={t("detail.class")}>
        {cls ? <ClassChip name={cls.name} color={cls.color} /> : "—"}
      </Row>
      {showStructure && (
        <Row label={t("detail.structure")}>
          <StructureMark structure={structure ?? null} />
        </Row>
      )}
      <Row label={t("detail.teacher")}>
        {teacher ? (
          <>
            <span
              className="inline-flex size-6 shrink-0 items-center justify-center rounded-full bg-primary/10 text-[10px] font-semibold text-primary"
              aria-hidden
            >
              {initialsFromName(teacher.name)}
            </span>
            <bdi dir="auto" className="truncate">{teacher.name}</bdi>
          </>
        ) : (
          "—"
        )}
      </Row>
      {/* The room is a fact of the cours, printed where it is one (D8): the
          block face only names it when the cours is elsewhere than its
          class's room, so this row is where "Salle 6 · salle de la classe"
          is read. The name is the stored one, once, never prefixed. */}
      {room && (
        <Row label={tc("room")}>
          {/* The same anatomy as the picker's option, so the fact reads as
              the option did: name, then the muted tail at the same gap. */}
          <span className="flex min-w-0 items-center gap-1.5">
            <bdi dir="auto" className="min-w-0 truncate">{roomName(room, locale)}</bdi>
            {roomInherited && (
              <span className="shrink-0 text-xs text-muted-foreground">
                <span aria-hidden>· </span>
                {tc("classRoom")}
              </span>
            )}
          </span>
        </Row>
      )}
      {program && (
        <div className="grid grid-cols-[auto_minmax(0,1fr)] items-center gap-x-3 py-2">
          <dt className="text-muted-foreground">{t("detail.program")}</dt>
          {/* The bdi truncates, not the cell: an ellipsis lands at the inline
              end of the element that clips, so a Latin title in an Arabic
              sheet lost its first word ("…atiques — nombres jusqu'à 100")
              while the cell was the one clipping in the page's direction. */}
          <dd className="min-w-0 text-end">
            <bdi dir="auto" className="inline-block max-w-full truncate align-top">
              {program.title}
            </bdi>
          </dd>
          {/* The objectives and the dates sit under the row, full width: a
              programme title already fills the value end, and a paragraph
              squeezed beside a label reads as a column of six-letter lines. */}
          {objectives && (
            <dd className="col-span-2 mt-1.5">
              {dialog && (
                <span className="block text-[11px] text-muted-foreground">{t("objectives")}</span>
              )}
              <bdi
                dir="auto"
                className={cn(
                  "block text-start text-xs whitespace-pre-line text-muted-foreground",
                  dialog ? "line-clamp-4" : "line-clamp-3",
                )}
              >
                {objectives}
              </bdi>
            </dd>
          )}
          <dd className="col-span-2 mt-1 flex flex-wrap items-center justify-between gap-x-3 gap-y-1 text-[11px] text-muted-foreground">
            <ValueRange
              from={formatDate(program.starts_on, locale, { year: undefined })}
              to={formatDate(program.ends_on, locale)}
              separator="–"
            />
            {dialog && (
              <Link
                href={`/learning?class=${encodeURIComponent(lesson.class_id)}`}
                className="whitespace-nowrap text-sm text-primary"
              >
                {t("detail.openProgram")}{" "}
                <span aria-hidden className="inline-block rtl:rotate-180">›</span>
              </Link>
            )}
          </dd>
        </div>
      )}
      {cls && lesson.kind !== defaultKind(cls.type) && (
        <Row label={t("detail.type")}>{tl(`kinds.${lesson.kind}`)}</Row>
      )}
    </dl>
  );
}

/**
 * The hover card's body. It is `aria-hidden` because the block underneath
 * already carries the same facts in its accessible name and the dialog is
 * the surface a screen reader lands on; announcing a floating card that opens
 * and closes with the pointer would read every fact twice.
 */
export function LessonPreview({
  start,
  end,
  ...facts
}: Omit<LessonFactsProps, "variant"> & { start: string; end: string }) {
  const t = useTranslations("learning.timetable");
  const { lesson } = facts;
  const cancelled = lesson.status === "cancelled";
  const completed = lesson.status === "completed";

  return (
    <div aria-hidden className="max-w-72">
      <div className="flex items-start justify-between gap-2">
        <bdi
          dir="auto"
          className={cn(
            "block min-w-0 text-start text-sm font-medium",
            cancelled && "line-through text-muted-foreground",
          )}
        >
          {lesson.title}
        </bdi>
        {completed && <StatusPill tone="success">{t("detail.completed")}</StatusPill>}
        {cancelled && <StatusPill tone="muted">{t("detail.cancelled")}</StatusPill>}
      </div>
      {/* The column already names the day; only the clock is worth repeating. */}
      <p className="mt-0.5 text-xs text-muted-foreground">
        <ValueRange from={start} to={end} separator="–" className="tabular-nums" />
      </p>
      <div className="mt-2 border-t border-border">
        <LessonFacts {...facts} variant="hover" />
      </div>
    </div>
  );
}
