import Link from "next/link";
import { ArrowLeftIcon, ArrowRightIcon } from "lucide-react";
import { getLocale, getTranslations } from "next-intl/server";
import { cn } from "@/lib/utils";
import { LanguageSwitcher } from "./language-switcher";
import { Wordmark } from "./wordmark";
import { SECTION } from "./styles";

export type LegalKind = "privacy" | "terms";

interface LegalSection {
  title: string;
  body: string;
  items?: string[];
}

/**
 * The shell shared by /privacy and /terms.
 *
 * Not the landing header and footer: their links are in-page anchors
 * (#features, #pricing) that go nowhere from another route. A wordmark that
 * returns home, the language switcher, and the sibling legal page are all the
 * navigation these two pages need.
 *
 * The text is prose in messages/{locale}/landing.json under `legal`, read with
 * t.raw so the sections can be an array and the copy can be edited without
 * touching this file.
 */
export async function LegalPage({ kind }: { kind: LegalKind }) {
  const [t, locale] = await Promise.all([getTranslations("landing.legal"), getLocale()]);
  const tFooter = await getTranslations("landingCta.footer");
  const sections = t.raw(`${kind}.sections`) as LegalSection[];
  const other: LegalKind = kind === "privacy" ? "terms" : "privacy";
  const BackIcon = locale === "ar" ? ArrowRightIcon : ArrowLeftIcon;

  return (
    <div className="flex min-h-dvh flex-col bg-background">
      <header className="border-b border-border/70 bg-card/85">
        <div className={cn(SECTION, "flex h-16 items-center justify-between gap-3")}>
          <Link href="/" className="rounded-xl outline-none focus-visible:ring-3 focus-visible:ring-ring/50">
            <Wordmark />
          </Link>
          <LanguageSwitcher />
        </div>
      </header>

      <main className={cn(SECTION, "flex-1 py-12 sm:py-16")}>
        <article className="mx-auto max-w-3xl">
          <Link
            href="/"
            className="inline-flex items-center gap-1.5 text-sm font-semibold text-muted-foreground transition-colors hover:text-primary"
          >
            <BackIcon className="size-4" aria-hidden />
            {t("backHome")}
          </Link>
          <h1 className="mt-6 text-3xl font-extrabold tracking-tight text-balance sm:text-4xl">
            {t(`${kind}.title`)}
          </h1>
          <p className="mt-2 text-sm text-muted-foreground">{t("lastUpdated")}</p>
          <p className="mt-6 text-base leading-relaxed text-pretty text-muted-foreground sm:text-lg">
            {t(`${kind}.intro`)}
          </p>

          <div className="mt-10 space-y-8">
            {sections.map((s, i) => (
              <section key={i}>
                <h2 className="text-lg font-bold tracking-tight">{s.title}</h2>
                <p className="mt-2 leading-relaxed text-pretty text-muted-foreground">{s.body}</p>
                {s.items && (
                  <ul className="mt-3 list-disc space-y-2 ps-6 leading-relaxed text-muted-foreground">
                    {s.items.map((item, j) => (
                      <li key={j}>{item}</li>
                    ))}
                  </ul>
                )}
              </section>
            ))}
          </div>

          <p className="mt-12 border-t border-border pt-6 text-sm text-muted-foreground">
            {t.rich("contact", {
              email: () => (
                <a
                  dir="ltr"
                  href={`mailto:${tFooter("email")}`}
                  className="font-medium text-primary underline-offset-4 hover:underline"
                >
                  {tFooter("email")}
                </a>
              ),
            })}
          </p>
        </article>
      </main>

      <footer className="border-t border-border bg-secondary/40">
        <div
          className={cn(
            SECTION,
            "flex flex-col gap-3 py-7 text-sm text-muted-foreground sm:flex-row sm:items-center sm:justify-between"
          )}
        >
          <Link href={`/${other}`} className="font-medium underline-offset-4 hover:text-primary hover:underline">
            {tFooter(other)}
          </Link>
          <p>{tFooter("copyright")}</p>
        </div>
      </footer>
    </div>
  );
}
