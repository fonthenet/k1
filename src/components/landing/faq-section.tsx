import { ClockIcon, MailIcon, MessageCircleQuestionMarkIcon } from "lucide-react";
import { getTranslations } from "next-intl/server";
import { CARD, EYEBROW, SECTION, SECTION_SUBTITLE, SECTION_TITLE, TILE } from "./styles";
import { FaqAccordion } from "./cta-faq-accordion";

// The six questions owners actually ask before signing up, in the order they
// ask them. Order is deliberate: trust first, then money, then language.
const ITEMS = ["security", "cash", "arabic", "multi", "mobile", "migrate"] as const;

export async function FaqSection() {
  const t = await getTranslations("landingCta.faq");
  const items = ITEMS.map((key) => ({
    key,
    q: t(`items.${key}.q`),
    a: t(`items.${key}.a`),
  }));

  return (
    <section
      id="faq"
      className="scroll-mt-20 border-t border-border bg-secondary/40 py-20 sm:py-24 lg:py-28"
    >
      <div className={SECTION}>
        <div className="grid gap-10 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.45fr)] lg:gap-16">
          {/* Sticky leading column: heading + a way out to a human */}
          <div className="lg:sticky lg:top-24 lg:self-start">
            <span className={`mb-6 grid size-12 place-items-center rounded-2xl ${TILE.amber}`}>
              <MessageCircleQuestionMarkIcon className="size-6" aria-hidden />
            </span>
            <span className={EYEBROW}>{t("eyebrow")}</span>
            <h2 className={SECTION_TITLE}>{t("title")}</h2>
            <p className={SECTION_SUBTITLE}>{t("subtitle")}</p>

            <div className={`${CARD} mt-8 p-5`}>
              <p className="text-sm font-bold">{t("contact.title")}</p>
              <p className="mt-1.5 text-sm leading-relaxed text-pretty text-muted-foreground">
                {t("contact.desc")}
              </p>
              <a
                href={`mailto:${t("contact.email")}`}
                className="mt-4 inline-flex h-10 items-center gap-2 rounded-full bg-primary px-4 text-sm font-semibold text-primary-foreground shadow-sm transition-colors outline-none hover:bg-primary/90 focus-visible:ring-3 focus-visible:ring-ring/50"
              >
                <MailIcon className="size-4 shrink-0" aria-hidden />
                {t("contact.cta")}
              </a>
              <p className="mt-4 flex items-center gap-2 text-xs text-muted-foreground">
                <ClockIcon className="size-3.5 shrink-0" aria-hidden />
                {t("contact.hours")}
              </p>
            </div>
          </div>

          {/* Trailing column: the accordion (the page's only client island here) */}
          <div className={`${CARD} px-5 py-2 sm:px-7`}>
            <FaqAccordion items={items} />
          </div>
        </div>
      </div>
    </section>
  );
}
