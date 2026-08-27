import Link from "next/link";
import { ArrowRightIcon, CircleCheckIcon } from "lucide-react";
import { getTranslations } from "next-intl/server";
import { Button } from "@/components/ui/button";
import { BRAND_GRADIENT, CTA_ON_BRAND, SECTION } from "./styles";

export async function FinalCta() {
  const t = await getTranslations("landingCta.final");

  return (
    <section className={`relative overflow-hidden ${BRAND_GRADIENT}`}>
      {/* Scrim: keeps white type readable over the light end of the gradient */}
      <span aria-hidden className="pointer-events-none absolute inset-0 bg-brand-from/55" />
      <span
        aria-hidden
        className="pointer-events-none absolute -top-32 start-1/4 size-[30rem] rounded-full bg-primary-foreground/12 blur-3xl"
      />
      <span
        aria-hidden
        className="pointer-events-none absolute -bottom-40 -end-16 size-[28rem] rounded-full bg-gold/25 blur-3xl"
      />

      <div className={`${SECTION} relative py-20 text-center text-primary-foreground sm:py-24 lg:py-28`}>
        <div className="mx-auto max-w-2xl">
          <span className="inline-flex items-center gap-1.5 rounded-full border border-primary-foreground/30 bg-primary-foreground/12 px-3.5 py-1.5 text-xs font-bold tracking-wide uppercase">
            {t("eyebrow")}
          </span>

          <h2 className="mt-6 text-3xl leading-[1.15] font-extrabold tracking-tight text-balance sm:text-4xl lg:text-[2.75rem]">
            {t("title")}
          </h2>
          <p className="mx-auto mt-5 max-w-xl text-base text-pretty text-primary-foreground/90 sm:text-lg">
            {t("subtitle")}
          </p>

          <div className="mt-9 flex flex-col items-stretch justify-center gap-3 sm:flex-row sm:items-center">
            <Button asChild className={CTA_ON_BRAND}>
              <Link href="/signup">
                {t("primary")}
                <ArrowRightIcon className="size-4 rtl:rotate-180" aria-hidden />
              </Link>
            </Button>
            <Button
              asChild
              variant="ghost"
              className="inline-flex h-12 items-center justify-center gap-2 rounded-full border border-primary-foreground/40 px-7 text-sm font-semibold text-primary-foreground transition-colors hover:bg-primary-foreground/15 hover:text-primary-foreground sm:text-base"
            >
              <a href="#quiz">{t("secondary")}</a>
            </Button>
          </div>

          <p className="mt-6 flex items-center justify-center gap-2 text-sm font-medium text-pretty text-primary-foreground/90">
            <CircleCheckIcon className="size-4 shrink-0" aria-hidden />
            {t("note")}
          </p>
        </div>
      </div>
    </section>
  );
}
