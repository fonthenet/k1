import Link from "next/link";
import { getLocale, getTranslations } from "next-intl/server";
import { TableCell, TableRow } from "@/components/ui/table";
import { StatusPill as Pill } from "@/components/shared/status-pill";
import { ValueRange } from "@/components/shared/value-range";
import { cn } from "@/lib/utils";
import { algiersEndTime, algiersTime } from "./dates";
import { SCHEDULE_PILL_TONE, type SessionStatus, type SessionType } from "./session-types";
import { Monogram, RatingStars, TypeChip } from "./session-ui";

export interface SessionRowData {
  id: string;
  scheduled_at: string;
  duration_min: number;
  session_type: SessionType;
  status: SessionStatus;
  progress_rating: number | null;
  published: boolean;
  /** Where it takes place, locale-resolved; null when the follow-up has no room. */
  room: string | null;
}

/**
 * One line of the schedule register: when, who, with whom, what kind, how
 * long, where it stands. The child's name is the door — its overlay reaches
 * every cell, so the whole row opens the session and no chevron is needed.
 */
export async function SessionRow({
  session,
  childName,
  classLabel,
  therapistName,
  muted = false,
}: {
  session: SessionRowData;
  childName: string;
  classLabel: string;
  therapistName: string;
  /** A session on a day the establishment is closed reads quieter. */
  muted?: boolean;
}) {
  const t = await getTranslations("sessions");
  const locale = await getLocale();
  const tone = SCHEDULE_PILL_TONE[session.status];
  const rating = session.status === "completed" ? session.progress_rating : null;

  return (
    <TableRow
      className={cn(
        "relative transition-colors hover:bg-primary/5",
        muted && "text-muted-foreground"
      )}
    >
      <TableCell className="w-28 whitespace-nowrap tabular-nums">
        <ValueRange
          separator="–"
          from={algiersTime(session.scheduled_at, locale)}
          to={algiersEndTime(session.scheduled_at, session.duration_min, locale)}
        />
        {/* The room is the séance's own fact, so it sits under its hour —
            the way the calendar and the portal pair a time with a place.
            Under the child's name it would read as the class's home room. */}
        {session.room && (
          <bdi dir="auto" className="block text-xs text-muted-foreground">
            {session.room}
          </bdi>
        )}
      </TableCell>
      <TableCell>
        <Link
          href={`/sessions/${session.id}`}
          className="flex items-center gap-2.5 after:absolute after:inset-0"
        >
          <Monogram name={childName} className="size-8" />
          <span className="min-w-0">
            <bdi dir="auto" className="block truncate font-semibold">
              {childName}
            </bdi>
            <bdi dir="auto" className="block truncate text-xs text-muted-foreground">
              {classLabel}
            </bdi>
          </span>
        </Link>
      </TableCell>
      <TableCell className="text-muted-foreground">
        <bdi dir="auto">{therapistName}</bdi>
      </TableCell>
      <TableCell>
        <TypeChip type={session.session_type} label={t(`types.${session.session_type}`)} />
      </TableCell>
      <TableCell className="whitespace-nowrap text-muted-foreground tabular-nums">
        {t("schedule.duration", { count: session.duration_min })}
      </TableCell>
      <TableCell>
        {/* One pill, and after it the stars — the row's one gold — then the
            muted word for a session already shared with the family. A
            scheduled session shows nothing here: that is the expected state. */}
        <span className="flex flex-wrap items-center gap-2">
          {tone && <Pill tone={tone}>{t(`status.${session.status}`)}</Pill>}
          {rating !== null && (
            <RatingStars
              value={rating}
              srLabel={t("schedule.rating", { value: rating })}
              size="sm"
            />
          )}
          {session.published && (
            <span className="text-xs text-muted-foreground">{t("schedule.published")}</span>
          )}
        </span>
      </TableCell>
    </TableRow>
  );
}
