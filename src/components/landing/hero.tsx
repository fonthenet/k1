import type { CSSProperties } from "react";
import Link from "next/link";
import { ArrowRightIcon } from "lucide-react";
import { getLocale, getTranslations } from "next-intl/server";
import { cn } from "@/lib/utils";
import { CTA_PRIMARY, CTA_SECONDARY, SECTION, SKY_BAND } from "./styles";
import { DashboardMockup } from "./dashboard-mockup";

const SERVES = [
  { id: "creche", emoji: "🍼" },
  { id: "kindergarten", emoji: "🧸" },
  { id: "preschool", emoji: "🎒" },
] as const;

/** Soft token-built glows over the sky band. Mirrored in RTL so the warm
 *  corner always sits behind the mockup rather than behind the headline. */
function glowLayer(rtl: boolean): CSSProperties {
  const cool = rtl ? "88%" : "12%";
  const warm = rtl ? "10%" : "90%";
  return {
    background: [
      `radial-gradient(58rem 34rem at ${cool} -12%, color-mix(in oklch, var(--primary) 18%, transparent), transparent 62%)`,
      `radial-gradient(44rem 30rem at ${warm} 4%, color-mix(in oklch, var(--gold) 22%, transparent), transparent 60%)`,
      `radial-gradient(46rem 30rem at 50% 112%, color-mix(in oklch, var(--cyan) 16%, transparent), transparent 66%)`,
    ].join(", "),
  };
}

/** Fine dot texture, faded out toward the band's edges. */
const DOTS: CSSProperties = {
  backgroundImage:
    "radial-gradient(color-mix(in oklch, var(--foreground) 12%, transparent) 1px, transparent 1px)",
  backgroundSize: "26px 26px",
  maskImage: "radial-gradient(ellipse 70% 62% at 50% 34%, black, transparent)",
  WebkitMaskImage: "radial-gradient(ellipse 70% 62% at 50% 34%, black, transparent)",
};

/** The band settles into the white trust strip instead of cutting against it. */
const BAND_FADE: CSSProperties = {
  background: "linear-gradient(to bottom, transparent, var(--card))",
};

export async function Hero() {
  const t = await getTranslations("landing");
  const rtl = (await getLocale()) === "ar";

  return (
    <section className={cn("relative isolate overflow-hidden", SKY_BAND)}>
      <div aria-hidden className="pointer-events-none absolute inset-0" style={glowLayer(rtl)} />
      <div aria-hidden className="pointer-events-none absolute inset-0" style={DOTS} />
      <div
        aria-hidden
        className="pointer-events-none absolute inset-x-0 bottom-0 h-28"
        style={BAND_FADE}
      />

      <div className={cn(SECTION, "relative pt-12 pb-24 sm:pt-16 sm:pb-28 lg:pt-22 lg:pb-32")}>
        <div className="grid items-center gap-16 lg:grid-cols-[minmax(0,1.08fr)_minmax(0,1fr)] lg:gap-12 xl:gap-16">
          {/* ── Copy ─────────────────────────────────────────────────────── */}
          <div className="text-start">
            <h1
              className={cn(
                "font-extrabold text-balance text-foreground",
                // Sized to hold two lines in all three languages — Arabic is the
                // most compact, French the longest, so the ceiling follows French.
                "text-[2.35rem] sm:text-[2.9rem] lg:text-[3.1rem] xl:text-[3.6rem]",
                rtl ? "leading-[1.26]" : "leading-[1.06] tracking-tight"
              )}
            >
              {t.rich("hero.headline", {
                br: () => <br />,
                // The headline carries itself; the phrase stays a <span> only
                // so the translations keep their <mark> tag.
                mark: (chunks) => <span>{chunks}</span>,
              })}
            </h1>

            <p className="mt-6 max-w-xl text-base leading-relaxed text-pretty text-sky-foreground/80 sm:text-lg">
              {t("hero.subtext")}
            </p>

            <div className="mt-9 flex flex-col gap-3 sm:flex-row sm:items-center">
              <Link
                href="/signup"
                className={cn(CTA_PRIMARY, "focus-visible:ring-3 focus-visible:ring-ring/50")}
              >
                {t("hero.ctaPrimary")}
                <ArrowRightIcon className="size-4 shrink-0 rtl:rotate-180" aria-hidden />
              </Link>
              <a
                href="#features"
                className={cn(CTA_SECONDARY, "focus-visible:ring-3 focus-visible:ring-ring/50")}
              >
                {t("hero.ctaSecondary")}
              </a>
            </div>

            <p className="mt-8 flex flex-wrap items-center gap-x-3 gap-y-1.5 text-sm text-pretty text-sky-foreground/70">
              {SERVES.map((s, i) => (
                <span key={s.id} className="inline-flex items-center gap-3">
                  {i > 0 && (
                    <span className="text-sky-foreground/30" aria-hidden>
                      •
                    </span>
                  )}
                  <span className="inline-flex items-center gap-1.5">
                    <span className="text-base leading-none" aria-hidden>
                      {s.emoji}
                    </span>
                    {t(`hero.serves.${s.id}`)}
                  </span>
                </span>
              ))}
            </p>
          </div>

          {/* ── Product ──────────────────────────────────────────────────── */}
          <div className="relative">
            <div
              aria-hidden
              className="pointer-events-none absolute -inset-8 rounded-[3rem] bg-gradient-to-br from-primary/20 via-cyan/10 to-gold/20 blur-3xl"
            />
            <div className="relative mx-auto w-full max-w-xl lg:max-w-none">
              <DashboardMockup />
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
