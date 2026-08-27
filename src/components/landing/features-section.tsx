import Link from "next/link";
import {
  ArrowRightIcon,
  CalculatorIcon,
  ClipboardListIcon,
  ReceiptTextIcon,
  ScanLineIcon,
  ShieldCheckIcon,
  SmartphoneIcon,
  TrendingUpIcon,
  UsersRoundIcon,
} from "lucide-react";
import { getTranslations } from "next-intl/server";
import { cn } from "@/lib/utils";
import {
  CARD_HOVER,
  CTA_SECONDARY,
  EYEBROW,
  SECTION,
  SECTION_SUBTITLE,
  SECTION_TITLE,
  TILE,
} from "./styles";
import {
  AccountingPreview,
  CheckinPreview,
  CompliancePreview,
  EnrollmentPreview,
  InvoicingPreview,
  ParentAppPreview,
  SessionsPreview,
  TeamPreview,
} from "./feature-previews";

// The signature of the page: eight cards, each carrying a working miniature of
// the real screen rather than a decorative icon. Tile tones rotate
// sky → mint → amber → pink so the grid stays bright instead of eight teal
// squares in a row.
const FEATURES = [
  { key: "enrollment", icon: ClipboardListIcon, tone: "sky", Preview: EnrollmentPreview },
  { key: "checkin", icon: ScanLineIcon, tone: "mint", Preview: CheckinPreview },
  { key: "parentApp", icon: SmartphoneIcon, tone: "amber", Preview: ParentAppPreview },
  { key: "sessions", icon: TrendingUpIcon, tone: "pink", Preview: SessionsPreview },
  { key: "invoicing", icon: ReceiptTextIcon, tone: "mint", Preview: InvoicingPreview },
  { key: "accounting", icon: CalculatorIcon, tone: "sky", Preview: AccountingPreview },
  { key: "team", icon: UsersRoundIcon, tone: "pink", Preview: TeamPreview },
  { key: "compliance", icon: ShieldCheckIcon, tone: "amber", Preview: CompliancePreview },
] as const;

export async function FeaturesSection() {
  const t = await getTranslations("landingFeatures");

  return (
    <section id="features" className="scroll-mt-20 py-20 sm:py-24 lg:py-28">
      <div className={SECTION}>
        <div className="mx-auto max-w-3xl text-center">
          <span className={EYEBROW}>{t("eyebrow")}</span>
          <h2 className={cn(SECTION_TITLE, "mt-5")}>{t("title")}</h2>
          <p className={cn(SECTION_SUBTITLE, "mx-auto")}>{t("subtitle")}</p>
        </div>

        <div className="mt-14 grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
          {FEATURES.map((f) => (
            <article key={f.key} className={cn(CARD_HOVER, "group flex flex-col p-5")}>
              <span
                className={cn(
                  "flex size-11 shrink-0 items-center justify-center rounded-xl transition-transform group-hover:scale-105",
                  TILE[f.tone]
                )}
              >
                <f.icon className="size-5.5" aria-hidden />
              </span>

              <h3 className="mt-4 text-base leading-snug font-bold text-pretty">
                {t(`items.${f.key}.title`)}
              </h3>
              <p className="mt-1.5 flex-1 text-sm leading-relaxed text-pretty text-muted-foreground">
                {t(`items.${f.key}.desc`)}
              </p>

              <f.Preview />
            </article>
          ))}
        </div>

        <div className="mt-14 flex flex-col items-center gap-3.5">
          <Link
            href="/signup"
            className={cn(CTA_SECONDARY, "focus-visible:ring-3 focus-visible:ring-ring/50")}
          >
            {t("cta")}
            <ArrowRightIcon className="size-4 shrink-0 rtl:rotate-180" aria-hidden />
          </Link>
          <p className="max-w-md text-center text-sm text-pretty text-muted-foreground">
            {t("ctaNote")}
          </p>
        </div>
      </div>
    </section>
  );
}
