"use client";

// "Which kind of centre are you?" — the solutions section.
//
// Real interactivity, not decoration: the chips are a proper tab list
// (arrow keys, Home/End, RTL-aware) and selecting one swaps the panel
// beneath for a setup tailored to that kind of centre.
//
// Exported as `HowItWorks` so page.tsx keeps compiling unchanged.

import { useRef, useState } from "react";
import {
  BabyIcon,
  BlocksIcon,
  BookOpenIcon,
  CheckIcon,
  HeartHandshakeIcon,
  PaletteIcon,
  ShapesIcon,
  TentIcon,
} from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { cn } from "@/lib/utils";
import { CARD, EYEBROW, SECTION, SECTION_SUBTITLE, SECTION_TITLE, TILE } from "./styles";

const CENTRES = [
  { key: "nursery", icon: BabyIcon, tone: "pink", modules: ["attendance", "meals", "portal"] },
  { key: "kindergarten", icon: BlocksIcon, tone: "sky", modules: ["enrollment", "billing", "activities"] },
  { key: "montessori", icon: ShapesIcon, tone: "mint", modules: ["sessions", "reports", "portal"] },
  { key: "educational", icon: BookOpenIcon, tone: "amber", modules: ["sessions", "billing", "attendance"] },
  { key: "therapy", icon: HeartHandshakeIcon, tone: "pink", modules: ["sessions", "reports", "staff"] },
  { key: "activity", icon: PaletteIcon, tone: "sky", modules: ["activities", "enrollment", "billing"] },
  { key: "camps", icon: TentIcon, tone: "amber", modules: ["enrollment", "attendance", "activities"] },
] as const;

type CentreKey = (typeof CENTRES)[number]["key"];

const BULLETS = ["b1", "b2", "b3"] as const;
const PANEL_ID = "centre-panel";

const CHIP_BASE =
  "inline-flex items-center gap-2 rounded-full border px-4 py-2.5 text-sm font-semibold transition-all outline-none focus-visible:ring-3 focus-visible:ring-ring/50";

export function HowItWorks() {
  const t = useTranslations("landingFeatures.centres");
  const isRtl = useLocale() === "ar";
  const [active, setActive] = useState<CentreKey>("kindergarten");
  const chipRefs = useRef<(HTMLButtonElement | null)[]>([]);

  const current = CENTRES.find((c) => c.key === active) ?? CENTRES[1];

  function onKeyDown(event: React.KeyboardEvent<HTMLDivElement>) {
    const last = CENTRES.length - 1;
    const index = CENTRES.findIndex((c) => c.key === active);
    // In RTL the visual "next" chip lives to the left, so the arrows swap.
    const forward = isRtl ? "ArrowLeft" : "ArrowRight";
    const backward = isRtl ? "ArrowRight" : "ArrowLeft";

    let next: number;
    if (event.key === forward) next = index === last ? 0 : index + 1;
    else if (event.key === backward) next = index === 0 ? last : index - 1;
    else if (event.key === "Home") next = 0;
    else if (event.key === "End") next = last;
    else return;

    event.preventDefault();
    setActive(CENTRES[next].key);
    chipRefs.current[next]?.focus();
  }

  return (
    <section
      id="solutions"
      className="scroll-mt-20 border-y border-border bg-secondary/40 py-20 sm:py-24 lg:py-28"
    >
      <div className={SECTION}>
        <div className="mx-auto max-w-3xl text-center">
          <span className={EYEBROW}>{t("eyebrow")}</span>
          <h2 className={cn(SECTION_TITLE, "mt-5")}>{t("title")}</h2>
          <p className={cn(SECTION_SUBTITLE, "mx-auto")}>{t("subtitle")}</p>
        </div>

        {/* Chips = tab list */}
        <div
          role="tablist"
          aria-label={t("tabsLabel")}
          onKeyDown={onKeyDown}
          className="mt-10 flex flex-wrap justify-center gap-2 sm:gap-2.5"
        >
          {CENTRES.map((centre, i) => {
            const selected = centre.key === active;
            return (
              <button
                key={centre.key}
                ref={(el) => {
                  chipRefs.current[i] = el;
                }}
                type="button"
                role="tab"
                id={`centre-tab-${centre.key}`}
                aria-selected={selected}
                aria-controls={PANEL_ID}
                tabIndex={selected ? 0 : -1}
                onClick={() => setActive(centre.key)}
                className={cn(
                  CHIP_BASE,
                  selected
                    ? "border-primary bg-primary text-primary-foreground shadow-md shadow-primary/25"
                    : "border-border bg-card text-muted-foreground hover:border-primary/40 hover:bg-card hover:text-foreground hover:shadow-sm"
                )}
              >
                <centre.icon className="size-4 shrink-0" aria-hidden />
                {t(`types.${centre.key}.label`)}
              </button>
            );
          })}
        </div>

        {/* Panel */}
        <div
          role="tabpanel"
          id={PANEL_ID}
          aria-labelledby={`centre-tab-${active}`}
          tabIndex={0}
          className={cn(CARD, "mt-8 overflow-hidden outline-none focus-visible:ring-3 focus-visible:ring-ring/50")}
        >
          <div className="grid gap-8 p-6 sm:p-8 md:grid-cols-[1.15fr_minmax(0,0.85fr)] md:gap-10">
            <div>
              <div className="flex items-start gap-3.5">
                <span
                  className={cn(
                    "flex size-12 shrink-0 items-center justify-center rounded-2xl",
                    TILE[current.tone]
                  )}
                >
                  <current.icon className="size-6" aria-hidden />
                </span>
                <div className="min-w-0">
                  <h3 className="text-xl leading-snug font-bold text-pretty">
                    {t(`types.${active}.title`)}
                  </h3>
                  <p className="mt-1 text-xs font-semibold text-muted-foreground">
                    {t("ageLabel")} · {t(`types.${active}.age`)}
                  </p>
                </div>
              </div>

              <p className="mt-5 text-base leading-relaxed text-pretty text-muted-foreground">
                {t(`types.${active}.line`)}
              </p>

              <ul className="mt-6 space-y-3">
                {BULLETS.map((b) => (
                  <li key={b} className="flex items-start gap-3 text-sm leading-relaxed">
                    <span
                      className="mt-0.5 grid size-5 shrink-0 place-items-center rounded-full bg-success/12 text-success"
                      aria-hidden
                    >
                      <CheckIcon className="size-3" />
                    </span>
                    <span className="text-pretty">{t(`types.${active}.${b}`)}</span>
                  </li>
                ))}
              </ul>
            </div>

            <div className="rounded-xl border border-border/70 bg-muted/40 p-4 sm:p-5">
              <p className="text-xs font-bold text-muted-foreground">{t("modulesTitle")}</p>
              <ul className="mt-3 space-y-2">
                {current.modules.map((m, i) => (
                  <li
                    key={m}
                    className="flex items-center gap-3 rounded-lg bg-card px-3 py-2.5 shadow-xs"
                  >
                    <span className="grid size-6 shrink-0 place-items-center rounded-full bg-primary/10 text-[10px] font-bold text-primary tabular-nums">
                      {i + 1}
                    </span>
                    <span className="min-w-0 truncate text-sm font-semibold">{t(`modules.${m}`)}</span>
                  </li>
                ))}
              </ul>
              <p className="mt-3.5 text-xs leading-relaxed text-pretty text-muted-foreground">
                {t("modulesNote")}
              </p>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
