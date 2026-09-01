"use client";

import { useEffect, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Skeleton } from "@/components/ui/skeleton";
import { intlLocale } from "@/lib/format";
import { WeatherGlyph, weatherGroup } from "./weather-glyph";

interface Day {
  date: string;
  symbol: string;
  max: number | null;
  min: number | null;
  precipitation: number;
}
interface Weather {
  now: { temperature: number; symbol: string; windSpeed: number; humidity: number; uvClearSky: number | null };
  days: Day[];
  point: { lat: number; lon: number; exact: boolean };
  fetchedAt: string;
}

/**
 * Weather in the topbar: a glyph and a temperature, opening a week.
 *
 * WHY IT IS HERE AT ALL. In a crèche this is operational, not ornamental —
 * it decides whether the yard is usable this morning and what to tell parents
 * to send the child in. That is why the panel leads with an advisory rather
 * than with numbers, and why the week is a row of days rather than a chart.
 *
 * It fetches AFTER paint from our own route. Doing it in the layout would put
 * MET Norway on the critical path of every page in the product.
 */
export function WeatherChip({ className }: { className?: string }) {
  const t = useTranslations("weather");
  const locale = useLocale();
  const [data, setData] = useState<Weather | "loading" | "error">("loading");

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetch("/api/weather");
        const json = (await res.json()) as { weather: Weather | null };
        if (!cancelled) setData(json.weather ?? "error");
      } catch {
        if (!cancelled) setData("error");
      }
    })();
    return () => { cancelled = true; };
  }, []);

  // No pin, no known wilaya, or the provider is down. The chip disappears
  // rather than showing a guess — a header is not the place to explain a
  // data gap, and a wrong temperature is worse than none.
  if (data === "error") return null;
  if (data === "loading") return <Skeleton className="h-8 w-[66px] rounded-lg" />;

  // TWO CONDITIONS, NOT ONE. `now.symbol` is the current hour; `days[0].symbol`
  // is how the day reads as a whole (MET's 06:00Z block — the school morning).
  // They legitimately disagree: overcast at 08:00 on a day that clears by ten.
  //
  // The header carries the DAY. It is glanced at once, and the question behind
  // the glance is "is the yard usable today", not "what is the sky doing this
  // minute" — the window answers that. It also makes the chip agree with the
  // "today" row inside the panel, which is where the mismatch showed.
  const nowGroup = weatherGroup(data.now.symbol);
  const dayGroup = weatherGroup(data.days[0]?.symbol ?? data.now.symbol);
  const fmtDay = (iso: string) =>
    new Intl.DateTimeFormat(intlLocale(locale), { weekday: "short" }).format(new Date(`${iso}T12:00:00`));

  // The one line a director acts on. Thresholds are deliberately blunt: this
  // is a nudge about the yard, not a forecast discussion.
  const d0 = data.days[0];
  const advice =
    (d0?.max ?? 0) >= 34 ? t("advice.heat")
    : (d0?.precipitation ?? 0) >= 2 ? t("advice.rain")
    : data.now.windSpeed >= 12 ? t("advice.wind")
    : (d0?.min ?? 99) <= 6 ? t("advice.cold")
    : null;

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button variant="ghost" size="sm" className={`gap-1.5 px-2 ${className ?? ""}`}>
          {/* A step larger than the header's line icons on purpose: this is a
              filled illustration with internal parts — a sun behind a cloud —
              so at the bell's 16px the sun shrinks to a speck. 20px is where
              the two-object conditions stay readable. */}
          <WeatherGlyph group={dayGroup} className="size-5" />
          {/* dir=ltr: "27°" in an RTL line is a number run followed by a
              neutral, so the degree sign flips to the paragraph side and it
              renders "°27". tabular-nums so 9°→10° does not shift the bell. */}
          <span dir="ltr" className="text-sm font-semibold tabular-nums">
            {data.now.temperature}°
          </span>
        </Button>
      </PopoverTrigger>

      <PopoverContent align="end" className="w-[min(360px,calc(100vw-2rem))] gap-0 p-0">
        <div className="flex items-start justify-between gap-3 border-b border-border/60 p-4">
          <div className="min-w-0">
            <div className="text-[0.7rem] font-semibold tracking-wide text-muted-foreground uppercase">
              {t("now")}
            </div>
            <div className="mt-0.5 flex items-baseline gap-2">
              <span dir="ltr" className="font-heading text-3xl font-bold tabular-nums text-foreground">
                {data.now.temperature}°
              </span>
              <span className="truncate text-sm text-muted-foreground">
                {t(`conditions.${nowGroup}`)}
              </span>
            </div>
            <div className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5 text-xs text-muted-foreground">
              <span>{t("feelsWind")} <span dir="ltr" className="tabular-nums">{data.now.windSpeed} m/s</span></span>
              <span>{t("humidity")} <span dir="ltr" className="tabular-nums">{data.now.humidity}%</span></span>
              {data.now.uvClearSky !== null && data.now.uvClearSky > 0 && (
                <span>{t("uv")} <span dir="ltr" className="tabular-nums">{data.now.uvClearSky}</span></span>
              )}
            </div>
          </div>
          <WeatherGlyph group={nowGroup} className="size-10 shrink-0" />
        </div>

        {advice && (
          <p className="border-b border-border/60 bg-gold-veil px-4 py-2.5 text-xs leading-relaxed text-gold-ink">
            {advice}
          </p>
        )}

        <div className="p-2">
          <div className="px-2 pb-1.5 text-[0.7rem] font-semibold tracking-wide text-muted-foreground uppercase">
            {t("week")}
          </div>
          <ul className="grid gap-0.5">
            {data.days.map((d, i) => (
              <li key={d.date} className="grid grid-cols-[4.7rem_1.5rem_1fr_auto] items-center gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-muted/60">
                <span className="truncate text-xs text-muted-foreground">
                  {i === 0 ? t("today") : fmtDay(d.date)}
                </span>
                <WeatherGlyph group={weatherGroup(d.symbol)} className="size-5" />
                <span className="truncate text-xs text-muted-foreground">
                  {d.precipitation >= 0.5 && (
                    <span dir="ltr" className="tabular-nums">{d.precipitation} mm</span>
                  )}
                </span>
                <span dir="ltr" className="tabular-nums text-xs">
                  <span className="font-semibold text-foreground">{d.max}°</span>
                  <span className="ms-1.5 text-muted-foreground">{d.min}°</span>
                </span>
              </li>
            ))}
          </ul>
        </div>

        <div className="border-t border-border/60 px-4 py-2 text-[0.68rem] leading-relaxed text-muted-foreground">
          {!data.point.exact && <span className="block">{t("approx")} · {t("pinHint")}</span>}
          {/* CC BY 4.0 obliges the credit and the link. It is the price of a
              keyless, commercially usable provider — not optional politeness. */}
          <a
            href="https://api.met.no/"
            target="_blank"
            rel="noreferrer"
            className="rounded hover:text-foreground hover:underline hover:underline-offset-2"
          >
            {t("credit")}
          </a>
        </div>
      </PopoverContent>
    </Popover>
  );
}
