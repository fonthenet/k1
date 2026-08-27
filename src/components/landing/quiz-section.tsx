import { ClockIcon, HandshakeIcon, ShieldCheckIcon } from "lucide-react";
import { getTranslations } from "next-intl/server";
import { EYEBROW, SECTION, SECTION_SUBTITLE, SECTION_TITLE, TILE } from "./styles";
import { QuizWizard } from "./quiz-wizard";

const TRUST = [
  { key: "commitment", icon: ShieldCheckIcon, tone: "mint" },
  { key: "consult", icon: HandshakeIcon, tone: "amber" },
] as const;

export async function QuizSection() {
  const t = await getTranslations("landingCta.quiz");

  return (
    <section id="quiz" className="scroll-mt-20 border-y border-border bg-sky py-20 sm:py-24 lg:py-28">
      <div className={SECTION}>
        <div className="grid gap-12 lg:grid-cols-[minmax(0,0.95fr)_minmax(0,1.05fr)] lg:items-center lg:gap-16">
          {/* Copy */}
          <div>
            <span className={EYEBROW}>{t("eyebrow")}</span>
            <h2 className={SECTION_TITLE}>{t("title")}</h2>
            <p className={SECTION_SUBTITLE}>{t("subtitle")}</p>

            <ul className="mt-9 grid gap-3 sm:grid-cols-2">
              {TRUST.map((item) => (
                <li
                  key={item.key}
                  className="flex items-start gap-3 rounded-2xl border border-border bg-card p-4 shadow-sm"
                >
                  <span
                    className={`grid size-10 shrink-0 place-items-center rounded-xl ${TILE[item.tone]}`}
                  >
                    <item.icon className="size-5" aria-hidden />
                  </span>
                  <span className="min-w-0">
                    <span className="block text-sm leading-snug font-semibold">
                      {t(`trust.${item.key}.title`)}
                    </span>
                    <span className="mt-1 block text-xs leading-relaxed text-pretty text-muted-foreground">
                      {t(`trust.${item.key}.desc`)}
                    </span>
                  </span>
                </li>
              ))}
            </ul>

            <p className="mt-6 inline-flex items-center gap-2 rounded-full border border-border bg-card/80 px-3.5 py-1.5 text-xs font-semibold text-muted-foreground shadow-xs">
              <ClockIcon className="size-3.5 shrink-0 text-primary" aria-hidden />
              {t("timeBadge")}
            </p>
          </div>

          {/* Wizard */}
          <QuizWizard />
        </div>
      </div>
    </section>
  );
}
