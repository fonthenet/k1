import Link from "next/link";
import { getLocale, getTranslations } from "next-intl/server";
import { ChevronLeft, ChevronRight, Eye } from "lucide-react";
import { cn } from "@/lib/utils";
import { algiersEndTime, algiersTime } from "./dates";
import type { SessionStatus, SessionType } from "./session-types";
import { Monogram, RatingStars, StatusPill, TypeChip } from "./session-ui";

export interface SessionRowData {
  id: string;
  scheduled_at: string;
  duration_min: number;
  session_type: SessionType;
  status: SessionStatus;
  progress_rating: number | null;
  published: boolean;
}

/** One line of the schedule: when, who, with whom, what kind, where it stands. */
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
  muted?: boolean;
}) {
  const t = await getTranslations("sessions");
  const locale = await getLocale();
  const Chevron = locale === "ar" ? ChevronLeft : ChevronRight;

  return (
    <Link
      href={`/sessions/${session.id}`}
      className={cn(
        "group flex flex-wrap items-center gap-3 rounded-xl border border-border bg-card p-3 transition-colors hover:border-primary/35 hover:bg-primary/5",
        muted && "opacity-80"
      )}
    >
      <div className="flex w-14 shrink-0 flex-col text-start">
        <span className="text-sm font-bold tabular-nums text-foreground">
          {algiersTime(session.scheduled_at, locale)}
        </span>
        <span className="text-[11px] tabular-nums text-muted-foreground">
          {algiersEndTime(session.scheduled_at, session.duration_min, locale)}
        </span>
      </div>

      <Monogram name={childName} />

      <div className="min-w-0 flex-1">
        <div className="truncate text-sm font-semibold text-foreground">{childName}</div>
        <div className="truncate text-xs text-muted-foreground">
          {classLabel} · {therapistName} · {t("schedule.duration", { count: session.duration_min })}
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <TypeChip type={session.session_type} label={t(`types.${session.session_type}`)} />
        {session.progress_rating !== null && (
          <RatingStars
            value={session.progress_rating}
            srLabel={t("schedule.rating", { value: session.progress_rating })}
          />
        )}
        {session.published && (
          <span title={t("schedule.published")} className="text-success">
            <Eye className="size-3.5" />
            <span className="sr-only">{t("schedule.published")}</span>
          </span>
        )}
        <StatusPill status={session.status} label={t(`status.${session.status}`)} />
        <Chevron className="size-4 shrink-0 text-muted-foreground transition-colors group-hover:text-primary" />
      </div>
    </Link>
  );
}
