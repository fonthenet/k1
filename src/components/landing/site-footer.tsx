import { MailIcon } from "lucide-react";
import { getTranslations } from "next-intl/server";
import { SECTION } from "./styles";
import { Wordmark } from "./wordmark";

const LINK =
  "rounded-sm underline-offset-4 transition-colors outline-none hover:text-primary hover:underline focus-visible:ring-3 focus-visible:ring-ring/50";

// Every link points at a real section of the page; only the legal pages, which
// don't exist yet, fall back to a plain anchor.
const COLUMNS = [
  {
    key: "features",
    links: [
      { key: "enrollment", href: "#features" },
      { key: "attendance", href: "#features" },
      { key: "billing", href: "#features" },
      { key: "accounting", href: "#features" },
      { key: "parents", href: "#features" },
    ],
  },
  {
    key: "solutions",
    links: [
      { key: "nurseries", href: "#quiz" },
      { key: "kindergartens", href: "#quiz" },
      { key: "therapy", href: "#quiz" },
      { key: "activities", href: "#quiz" },
    ],
  },
  {
    key: "why",
    links: [
      { key: "owners", href: "#pricing" },
      { key: "educators", href: "#features" },
      { key: "families", href: "#faq" },
    ],
  },
] as const;

export async function SiteFooter() {
  const t = await getTranslations("landingCta.footer");

  return (
    <footer aria-label={t("label")} className="border-t border-border bg-secondary/40">
      <div className={`${SECTION} py-14 sm:py-16`}>
        <div className="grid gap-10 sm:grid-cols-2 lg:grid-cols-[1.7fr_1fr_1fr_1fr] lg:gap-10">
          {/* Brand */}
          <div className="sm:col-span-2 lg:col-span-1">
            <Wordmark />
            <p className="mt-5 max-w-sm text-sm leading-relaxed whitespace-pre-line text-pretty text-muted-foreground">
              {t("blurb")}
            </p>
            <p className="mt-5 inline-flex items-center gap-2 rounded-full border border-border bg-card px-3 py-1.5 text-xs font-semibold text-muted-foreground shadow-xs">
              {t("languageNote")}
            </p>
          </div>

          {/* Link columns */}
          {COLUMNS.map((col) => (
            <nav key={col.key} aria-labelledby={`footer-${col.key}`}>
              <h2 id={`footer-${col.key}`} className="text-sm font-bold">
                {t(`columns.${col.key}`)}
              </h2>
              <ul className="mt-4 flex flex-col gap-2.5 text-sm text-muted-foreground">
                {col.links.map((link) => (
                  <li key={link.key}>
                    <a href={link.href} className={LINK}>
                      {t(`links.${link.key}`)}
                    </a>
                  </li>
                ))}
              </ul>
            </nav>
          ))}
        </div>

        {/* Bottom bar */}
        <div className="mt-12 flex flex-col gap-4 border-t border-border pt-7 text-sm text-muted-foreground sm:flex-row sm:items-center sm:justify-between">
          <ul className="flex flex-wrap items-center gap-x-5 gap-y-2">
            <li>
              <a
                href={`mailto:${t("email")}`}
                className={`flex items-center gap-2 font-medium ${LINK}`}
              >
                <MailIcon className="size-4 shrink-0 text-primary" aria-hidden />
                {t("contact")}
              </a>
            </li>
            <li>
              <a href="#" className={LINK}>
                {t("terms")}
              </a>
            </li>
            <li>
              <a href="#" className={LINK}>
                {t("privacy")}
              </a>
            </li>
          </ul>
          <p className="text-pretty">{t("copyright")}</p>
        </div>
      </div>
    </footer>
  );
}
