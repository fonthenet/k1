"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import { CalendarDays, ChevronLeft, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { addDaysStr } from "./dates";
import { SESSION_TYPES, type TherapistOption } from "./session-types";

/**
 * Day/week toggle, date stepper and the two filters — all mirrored in the URL so
 * the schedule itself stays a server component.
 */
export function ScheduleToolbar({
  view,
  date,
  label,
  today,
  therapists,
  therapist,
  type,
}: {
  view: "day" | "week";
  date: string;
  label: string;
  today: string;
  therapists: TherapistOption[];
  therapist: string;
  type: string;
}) {
  const t = useTranslations("sessions");
  const locale = useLocale();
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const isRtl = locale === "ar";
  const PrevIcon = isRtl ? ChevronRight : ChevronLeft;
  const NextIcon = isRtl ? ChevronLeft : ChevronRight;
  const step = view === "week" ? 7 : 1;

  function push(next: Record<string, string | null>) {
    const params = new URLSearchParams(searchParams.toString());
    for (const [key, value] of Object.entries(next)) {
      if (value === null) params.delete(key);
      else params.set(key, value);
    }
    const qs = params.toString();
    router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
  }

  return (
    <div className="mb-5 flex flex-wrap items-center gap-2">
      <div className="inline-flex items-center rounded-lg border border-border bg-card p-0.5">
        {(["day", "week"] as const).map((v) => (
          <button
            key={v}
            type="button"
            aria-pressed={view === v}
            onClick={() => push({ view: v })}
            className={cn(
              "rounded-md px-3 py-1.5 text-xs font-semibold transition-colors outline-none focus-visible:ring-2 focus-visible:ring-ring",
              view === v
                ? "bg-primary text-primary-foreground shadow-sm"
                : "text-muted-foreground hover:text-foreground"
            )}
          >
            {t(`views.${v}`)}
          </button>
        ))}
      </div>

      <div className="inline-flex items-center gap-1">
        <Button
          variant="outline"
          size="icon-sm"
          aria-label={t("dates.previous")}
          onClick={() => push({ date: addDaysStr(date, -step) })}
        >
          <PrevIcon />
        </Button>
        <span className="min-w-40 px-2 text-center text-sm font-semibold whitespace-nowrap text-foreground">
          {label}
        </span>
        <Button
          variant="outline"
          size="icon-sm"
          aria-label={t("dates.next")}
          onClick={() => push({ date: addDaysStr(date, step) })}
        >
          <NextIcon />
        </Button>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => push({ date: today })}
          disabled={date === today && view === "day"}
        >
          <CalendarDays data-icon="inline-start" />
          {t("dates.today")}
        </Button>
      </div>

      <div className="flex flex-wrap items-center gap-2 sm:ms-auto">
        <Select
          value={therapist}
          onValueChange={(v) => push({ therapist: v === "all" ? null : v })}
        >
          <SelectTrigger className="w-44" aria-label={t("filters.therapist")}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">{t("filters.allTherapists")}</SelectItem>
            <SelectItem value="none">{t("filters.unassigned")}</SelectItem>
            {therapists.map((th) => (
              <SelectItem key={th.id} value={th.id}>
                {th.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Select value={type} onValueChange={(v) => push({ type: v === "all" ? null : v })}>
          <SelectTrigger className="w-44" aria-label={t("filters.type")}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">{t("filters.allTypes")}</SelectItem>
            {SESSION_TYPES.map((st) => (
              <SelectItem key={st} value={st}>
                {t(`types.${st}`)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
    </div>
  );
}
