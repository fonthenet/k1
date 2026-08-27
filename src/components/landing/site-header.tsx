import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { cn } from "@/lib/utils";
import { CTA_PRIMARY, SECTION } from "./styles";
import { HeaderMobileNav, HeaderNav, type NavEntry } from "./hero-nav";
import { LanguageSwitcher } from "./language-switcher";
import { Wordmark } from "./wordmark";

const FEATURE_ITEMS = ["admissions", "attendance", "billing", "parents"] as const;
const SOLUTION_ITEMS = ["creche", "kindergarten", "preschool", "network"] as const;

/** The header pill is the hero's recipe, one notch smaller — and smaller again
 *  on phones, where the wordmark, language button and menu share the row. */
const HEADER_CTA = cn(
  CTA_PRIMARY,
  "h-9 px-3.5 text-[13px] shadow-md shadow-primary/20 hover:shadow-lg",
  "sm:h-10 sm:px-5 sm:text-sm",
  "focus-visible:ring-3 focus-visible:ring-ring/50"
);

const GHOST_LINK =
  "hidden rounded-full px-3.5 py-2 text-sm font-semibold text-muted-foreground outline-none transition-colors hover:bg-muted hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50 md:inline-flex";

export async function SiteHeader() {
  const t = await getTranslations("landing");

  const entries: NavEntry[] = [
    {
      kind: "menu",
      id: "features",
      href: "#features",
      label: t("nav.features"),
      items: FEATURE_ITEMS.map((id) => ({
        id,
        href: "#features",
        title: t(`nav.featuresMenu.${id}.title`),
        desc: t(`nav.featuresMenu.${id}.desc`),
      })),
      footer: { href: "#features", label: t("nav.menuFooter.features") },
    },
    {
      kind: "menu",
      id: "solutions",
      href: "#solutions",
      label: t("nav.solutions"),
      items: SOLUTION_ITEMS.map((id) => ({
        id,
        href: "#solutions",
        title: t(`nav.solutionsMenu.${id}.title`),
        desc: t(`nav.solutionsMenu.${id}.desc`),
      })),
      footer: { href: "#solutions", label: t("nav.menuFooter.solutions") },
    },
    { kind: "link", id: "pricing", href: "#pricing", label: t("nav.pricing") },
    { kind: "link", id: "faq", href: "#faq", label: t("nav.faq") },
  ];

  return (
    <header className="sticky top-0 z-50 border-b border-border/70 bg-card/85 backdrop-blur-xl supports-[backdrop-filter]:bg-card/70">
      <div className={cn(SECTION, "flex h-16 items-center gap-1 sm:gap-2 lg:h-18")}>
        <div className="flex min-w-0 flex-1 items-center">
          <Link
            href="/"
            aria-label={t("brand.nameLatin")}
            className="rounded-xl outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
          >
            <Wordmark />
          </Link>
        </div>

        <HeaderNav entries={entries} label={t("nav.primaryLabel")} />

        <div className="flex min-w-0 flex-1 items-center justify-end gap-0.5 sm:gap-1.5">
          <LanguageSwitcher />
          <Link href="/login" className={GHOST_LINK}>
            {t("nav.login")}
          </Link>
          <Link href="/signup" className={HEADER_CTA}>
            {t("nav.signup")}
          </Link>
          <HeaderMobileNav
            entries={entries}
            brand={<Wordmark />}
            labels={{
              nav: t("nav.primaryLabel"),
              menu: t("nav.menu"),
              login: t("nav.login"),
              signup: t("nav.signup"),
            }}
          />
        </div>
      </div>
    </header>
  );
}
