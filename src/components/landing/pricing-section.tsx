import Link from "next/link";
import { CheckIcon, InfinityIcon, StarIcon } from "lucide-react";
import { getLocale, getTranslations } from "next-intl/server";
import { Button } from "@/components/ui/button";
import { formatDZD } from "@/lib/format";
import { cn } from "@/lib/utils";
import {
  CARD,
  CTA_PRIMARY,
  CTA_SECONDARY,
  EYEBROW,
  SECTION,
  SECTION_SUBTITLE,
  SECTION_TITLE,
} from "./styles";

// Flat price per centre, per month, in DZD. No per-child or per-seat billing.
const TIERS = [
  { key: "essential", price: 4900, popular: false },
  { key: "pro", price: 9900, popular: true },
  { key: "network", price: 19900, popular: false },
] as const;

export async function PricingSection() {
  const t = await getTranslations("landingCta.pricing");
  const locale = await getLocale();

  return (
    <section id="pricing" className="scroll-mt-20 py-20 sm:py-24 lg:py-28">
      <div className={SECTION}>
        <div className="mx-auto max-w-2xl text-center">
          <span className={EYEBROW}>{t("eyebrow")}</span>
          <h2 className={SECTION_TITLE}>{t("title")}</h2>
          <p className={`${SECTION_SUBTITLE} mx-auto`}>{t("subtitle")}</p>
        </div>

        <div className="mt-14 grid items-start gap-6 lg:grid-cols-3 lg:gap-7">
          {TIERS.map((tier) => {
            const features = t.raw(`tiers.${tier.key}.features`) as string[];

            return (
              <div
                key={tier.key}
                className={cn(
                  "relative flex h-full flex-col overflow-hidden p-7 sm:p-8",
                  tier.popular
                    ? "rounded-2xl border border-gold/50 bg-card shadow-xl shadow-gold/15 ring-1 ring-gold/25 lg:-mt-5"
                    : CARD
                )}
              >
                {/* Gold top wash on the lifted tier */}
                {tier.popular && (
                  <span
                    aria-hidden
                    className="pointer-events-none absolute inset-x-0 top-0 h-40 bg-gradient-to-b from-gold/14 via-gold/5 to-transparent"
                  />
                )}

                <div className="relative flex flex-wrap items-center gap-2">
                  <h3 className="text-lg font-bold tracking-tight">{t(`tiers.${tier.key}.name`)}</h3>
                  {tier.popular && (
                    <span className="inline-flex items-center gap-1 rounded-full bg-gold px-2.5 py-1 text-[11px] font-bold text-gold-foreground shadow-sm">
                      <StarIcon className="size-3 fill-current" aria-hidden />
                      {t("popular")}
                    </span>
                  )}
                </div>
                <p className="relative mt-2 text-sm leading-relaxed text-pretty text-muted-foreground">
                  {t(`tiers.${tier.key}.tagline`)}
                </p>

                <div className="relative mt-7">
                  <div className="flex flex-wrap items-baseline gap-x-2">
                    <span className="text-3xl font-extrabold tracking-tight tabular-nums sm:text-4xl">
                      {formatDZD(tier.price, locale)}
                    </span>
                    <span className="text-sm font-semibold text-muted-foreground">
                      {t("perMonth")}
                    </span>
                  </div>
                  <p className="mt-1.5 text-xs text-muted-foreground">{t("perCentre")}</p>
                </div>

                <Button
                  asChild
                  variant={tier.popular ? "default" : "outline"}
                  className={cn("relative mt-7 w-full", tier.popular ? CTA_PRIMARY : CTA_SECONDARY)}
                >
                  <Link href="/signup">{tier.popular ? t("ctaPopular") : t("cta")}</Link>
                </Button>

                <ul className="relative mt-7 flex flex-1 flex-col gap-3 border-t border-border pt-6">
                  {features.map((f) => (
                    <li key={f} className="flex items-start gap-2.5 text-sm">
                      <span
                        className={cn(
                          "mt-0.5 grid size-4.5 shrink-0 place-items-center rounded-full",
                          tier.popular
                            ? "bg-primary text-primary-foreground"
                            : "bg-success/12 text-success"
                        )}
                      >
                        <CheckIcon className="size-3" aria-hidden />
                      </span>
                      <span className="leading-snug text-pretty text-muted-foreground">{f}</span>
                    </li>
                  ))}
                </ul>
              </div>
            );
          })}
        </div>

        <p className="mx-auto mt-10 flex w-fit items-center gap-2 rounded-full border border-border bg-card px-4 py-2 text-sm font-medium text-pretty text-muted-foreground shadow-sm">
          <InfinityIcon className="size-4 shrink-0 text-primary" aria-hidden />
          {t("footnote")}
        </p>
      </div>
    </section>
  );
}
