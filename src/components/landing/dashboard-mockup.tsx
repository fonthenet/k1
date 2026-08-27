import {
  BellIcon,
  CalendarDaysIcon,
  CheckCheckIcon,
  CheckIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  MessagesSquareIcon,
  UsersRoundIcon,
} from "lucide-react";
import { getLocale, getTranslations } from "next-intl/server";
import { formatDZD } from "@/lib/format";
import { cn } from "@/lib/utils";
import { TILE, type TileTone } from "./styles";

/* ── The card's fictional-but-plausible October ─────────────────────────────
   Algeria's week is Sunday-first with Friday/Saturday as the weekend, so the
   grid starts on Sunday and dims the last two columns. The month is laid out
   from a fixed offset rather than `new Date()` so a prerendered page never ends
   up showing a calendar that quietly went stale.                            */
const WEEKDAYS = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"] as const;
const WEEKEND_COLS = new Set([5, 6]); // Friday, Saturday
const LEADING_BLANKS = 4; // October 2026 opens on a Thursday
const DAYS_IN_MONTH = 31;
const TODAY = 18; // a Sunday — the solid primary pill
const EVENT_DAYS = new Set([12, 22]);

const STATS = [
  { id: "children", icon: UsersRoundIcon, tone: "sky" },
  { id: "attendance", icon: CheckCheckIcon, tone: "mint" },
  { id: "sessions", icon: CalendarDaysIcon, tone: "amber" },
  { id: "messages", icon: MessagesSquareIcon, tone: "pink" },
] as const satisfies readonly { id: string; icon: typeof BellIcon; tone: TileTone }[];

const SESSIONS = [
  { id: "one", tone: "sky" },
  { id: "two", tone: "mint" },
  { id: "three", tone: "amber" },
] as const satisfies readonly { id: string; tone: TileTone }[];

/** Chip drift. Scoped keyframes, hoisted by React; motion-safe by construction. */
const FLOAT_CSS = `
@keyframes rw-float-a{0%,100%{transform:translate3d(0,0,0)}50%{transform:translate3d(0,-9px,0)}}
@keyframes rw-float-b{0%,100%{transform:translate3d(0,0,0)}50%{transform:translate3d(0,8px,0)}}
@media (prefers-reduced-motion:reduce){.rw-float{animation:none!important}}
`;

const CHIP =
  "rw-float absolute z-10 flex max-w-[15rem] items-center gap-2.5 rounded-2xl border border-border/70 bg-card px-3 py-2 shadow-xl shadow-primary/10";

const PANEL = "rounded-xl border border-border/70 bg-card p-3";

/**
 * The floating hero card: a believable slice of the real Rawdati dashboard,
 * built entirely from tokens — no screenshots, and it flips cleanly in RTL.
 */
export async function DashboardMockup() {
  const t = await getTranslations("landing.mockup");
  const locale = await getLocale();

  // Rotation is mirrored rather than repeated in RTL, so the tilt always leans
  // away from the copy column instead of into it.
  const tilt = locale === "ar" ? "lg:-rotate-[1.5deg]" : "lg:rotate-[1.5deg]";

  return (
    <div role="img" aria-label={t("label")} className="relative">
      <style href="rw-hero-float" precedence="default">
        {FLOAT_CSS}
      </style>

      <div
        className={cn(
          "relative rounded-2xl bg-card p-4 ring-1 ring-border/70 shadow-2xl shadow-primary/20 transition-transform duration-500 ease-out select-none sm:p-5",
          tilt,
          "lg:hover:rotate-0"
        )}
      >
        {/* Greeting */}
        <div className="flex items-center gap-3">
          <span className="grid size-10 shrink-0 place-items-center rounded-full bg-primary/12 text-sm font-bold text-primary">
            {t("monogram")}
          </span>
          <div className="min-w-0 flex-1">
            <p className="truncate text-[13px] font-bold text-foreground">{t("greeting")}</p>
            <p className="truncate text-[11px] text-muted-foreground">{t("date")}</p>
          </div>
          <span className="relative grid size-8 shrink-0 place-items-center rounded-full border border-border/70 text-muted-foreground">
            <BellIcon className="size-4" aria-hidden />
            <span className="absolute end-1.5 top-1.5 size-1.5 rounded-full bg-gold" aria-hidden />
          </span>
        </div>

        {/* Stat tiles */}
        <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
          {STATS.map((s) => (
            <div key={s.id} className={cn("rounded-xl p-2.5", TILE[s.tone])}>
              <s.icon className="size-4" aria-hidden />
              <p className="mt-2 text-lg leading-none font-extrabold text-foreground tabular-nums">
                {t(`stats.${s.id}.value`)}
              </p>
              <p className="mt-1.5 text-[10px] leading-tight font-medium text-muted-foreground">
                {t(`stats.${s.id}.label`)}
              </p>
            </div>
          ))}
        </div>

        <div className="mt-3 grid gap-2.5 sm:grid-cols-[auto_minmax(0,1fr)]">
          {/* Month calendar — Sunday first, weekend dimmed */}
          <div className={PANEL}>
            <div className="flex items-center justify-between gap-3">
              <span className="text-[11px] font-bold text-foreground">{t("calendar.title")}</span>
              <span className="flex items-center gap-1 text-muted-foreground" aria-hidden>
                <ChevronLeftIcon className="size-3.5 rtl:rotate-180" />
                <ChevronRightIcon className="size-3.5 rtl:rotate-180" />
              </span>
            </div>

            <div className="mt-2.5 grid grid-cols-7 gap-x-0.5 gap-y-1 text-center">
              {WEEKDAYS.map((d, i) => (
                <span
                  key={d}
                  className={cn(
                    "text-[9px] font-bold",
                    WEEKEND_COLS.has(i) ? "text-muted-foreground/45" : "text-muted-foreground"
                  )}
                >
                  {t(`calendar.weekdays.${d}`)}
                </span>
              ))}

              {Array.from({ length: LEADING_BLANKS }, (_, i) => (
                <span key={`blank-${i}`} className="size-6" />
              ))}

              {Array.from({ length: DAYS_IN_MONTH }, (_, i) => {
                const day = i + 1;
                const col = (LEADING_BLANKS + i) % 7;
                const weekend = WEEKEND_COLS.has(col);
                return (
                  <span
                    key={day}
                    className={cn(
                      "grid size-6 place-items-center rounded-full text-[10px] tabular-nums",
                      day === TODAY
                        ? "bg-primary font-bold text-primary-foreground shadow-sm shadow-primary/40"
                        : EVENT_DAYS.has(day)
                          ? "bg-primary/10 font-semibold text-primary"
                          : weekend
                            ? "text-muted-foreground/40"
                            : "text-foreground/75"
                    )}
                  >
                    {day}
                  </span>
                );
              })}
            </div>
          </div>

          {/* Upcoming sessions */}
          <div className={PANEL}>
            <div className="flex items-center justify-between gap-3">
              <span className="text-[11px] font-bold text-foreground">{t("sessions.title")}</span>
              <span className="text-[10px] font-semibold text-primary">{t("sessions.more")}</span>
            </div>
            <ul className="mt-2.5 space-y-1.5">
              {SESSIONS.map((s) => (
                <li key={s.id} className="flex items-center gap-2.5 rounded-lg bg-muted/50 p-1.5">
                  <span
                    className={cn(
                      "shrink-0 rounded-md px-1.5 py-1 text-[10px] font-bold tabular-nums",
                      TILE[s.tone]
                    )}
                  >
                    {t(`sessions.items.${s.id}.time`)}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[11px] font-semibold text-foreground">
                      {t(`sessions.items.${s.id}.title`)}
                    </span>
                    <span className="block truncate text-[10px] text-muted-foreground">
                      {t(`sessions.items.${s.id}.room`)}
                    </span>
                  </span>
                  <span className="flex shrink-0 items-center gap-1 text-[10px] font-semibold text-muted-foreground tabular-nums">
                    <UsersRoundIcon className="size-3" aria-hidden />
                    {t(`sessions.items.${s.id}.count`)}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        </div>
      </div>

      {/* Floating notifications, overlapping the card's outer corners */}
      <div
        className={cn(CHIP, "-top-8 -start-2 sm:-top-7 sm:-start-6 lg:-start-10")}
        style={{ animation: "rw-float-a 6.5s ease-in-out infinite" }}
      >
        <span className="grid size-8 shrink-0 place-items-center rounded-full bg-success/12 text-success">
          <BellIcon className="size-4" aria-hidden />
        </span>
        <span className="min-w-0">
          <span className="block truncate text-[11px] font-bold text-foreground">
            {t("chips.enrollment.title")}
          </span>
          <span className="block truncate text-[10px] text-muted-foreground">
            {t("chips.enrollment.sub")}
          </span>
        </span>
      </div>

      <div
        className={cn(CHIP, "-bottom-8 -end-2 sm:-bottom-7 sm:-end-6 lg:-end-10")}
        style={{ animation: "rw-float-b 7.5s ease-in-out infinite 0.6s" }}
      >
        <span className="grid size-8 shrink-0 place-items-center rounded-full bg-primary/12 text-primary">
          <CheckIcon className="size-4" aria-hidden />
        </span>
        <span className="min-w-0">
          <span className="block truncate text-[11px] font-bold text-foreground">
            {t("chips.payment.title")}
          </span>
          <span className="block truncate text-[10px] font-semibold text-income tabular-nums">
            {formatDZD(8100, locale)} · {t("chips.payment.sub")}
          </span>
        </span>
      </div>
    </div>
  );
}
