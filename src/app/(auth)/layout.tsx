import { getTranslations } from "next-intl/server";
import {
  CalendarCheckIcon,
  ClipboardListIcon,
  HeartHandshakeIcon,
  WalletIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { LocaleToggle } from "./_components/locale-toggle";
import { Zellige } from "./_components/zellige";
import { Wordmark } from "@/components/landing/wordmark";

/**
 * One surface, not two.
 *
 * This page used to be a saturated dark-teal slab against a white form — a hard
 * vertical seam straight down the middle, which is what made it read as two
 * unrelated things stapled together. Now the whole page is a single pale field:
 * soft overlapping washes of the brand teal and gold, with the zellige tilework
 * faint underneath all of it, and the form floating on top in a quiet card.
 *
 * Every wash is a wide, low-opacity radial. The point is that no edge anywhere
 * on this page is a hard one — light should arrive gradually or not at all.
 */
export default async function AuthLayout({ children }: { children: React.ReactNode }) {
  const t = await getTranslations("auth");

  const features = [
    { icon: ClipboardListIcon, key: "enrollment", accent: false },
    { icon: CalendarCheckIcon, key: "attendance", accent: false },
    { icon: WalletIcon, key: "billing", accent: true },
    { icon: HeartHandshakeIcon, key: "parents", accent: false },
  ] as const;

  return (
    <div className="relative min-h-dvh overflow-hidden bg-background">
      {/* ── The light. Three wide washes, none of them reaching full strength,
             overlapping so the eye never finds where one ends. ───────────── */}
      <div
        className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_90%_70%_at_12%_0%,var(--primary),transparent_62%)] opacity-[0.13]"
        aria-hidden
      />
      <div
        className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_80%_60%_at_92%_8%,var(--gold),transparent_58%)] opacity-[0.16]"
        aria-hidden
      />
      <div
        className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_100%_65%_at_50%_108%,var(--primary),transparent_66%)] opacity-[0.10]"
        aria-hidden
      />

      {/* ── The tilework, faint, under everything and across the whole page. ── */}
      <Zellige className="pointer-events-none absolute inset-0 size-full text-primary opacity-[0.055]" />

      {/* ── Content ──────────────────────────────────────────────────────── */}
      <div className="relative flex min-h-dvh flex-col">
        <header className="flex items-center justify-between gap-3 px-5 py-5 sm:px-8">
          {/* The landing page's own lockup — seedling mark, Arabic name, Latin
              transliteration beneath. Sign-in used to fall back to a stock baby
              icon and the Latin name, so the first screen after the marketing
              site showed a different brand than the one that sold it. */}
          <Wordmark className="min-w-0" />
          <LocaleToggle />
        </header>

        <main className="flex flex-1 items-center px-5 pb-14 sm:px-8">
          <div className="mx-auto grid w-full max-w-6xl items-center gap-12 lg:grid-cols-[1.05fr_auto] lg:gap-16">
            {/* Brand story — dark type on the pale field now, so there is no
                slab and no seam. Hidden on small screens: a phone should get
                the form, not a pitch. */}
            <section className="hidden max-w-xl lg:block">
              <span className="mb-6 block h-1 w-14 rounded-full bg-gold" aria-hidden />
              <h1 className="text-4xl leading-tight font-bold tracking-tight text-balance text-foreground">
                {t("brand.tagline")}
              </h1>
              <p className="mt-4 text-base leading-relaxed text-pretty text-muted-foreground">
                {t("brand.pitch")}
              </p>

              <ul className="mt-9 grid gap-2">
                {features.map(({ icon: Icon, key, accent }) => (
                  <li key={key} className="flex items-start gap-3.5">
                    <span
                      className={cn(
                        "mt-0.5 flex size-9 shrink-0 items-center justify-center rounded-xl ring-1",
                        accent
                          ? "bg-gold-muted text-gold-ink ring-gold/25"
                          : "bg-primary/8 text-primary ring-primary/15"
                      )}
                      aria-hidden
                    >
                      <Icon className="size-4.5" />
                    </span>
                    <span className="min-w-0">
                      <span className="block text-sm font-semibold text-foreground">
                        {t(`brand.features.${key}.title`)}
                      </span>
                      <span className="mt-0.5 block text-sm leading-snug text-pretty text-muted-foreground">
                        {t(`brand.features.${key}.desc`)}
                      </span>
                    </span>
                  </li>
                ))}
              </ul>
            </section>

            {/* The form, floating. Soft ring and a wide, low shadow rather than
                a hard border — the card should settle onto the field, not sit
                on it in a box. */}
            <section className="mx-auto w-full max-w-md lg:w-[26rem]">
              <div className="rounded-3xl bg-card/80 p-6 shadow-[0_1px_2px_rgba(16,54,66,0.04),0_12px_40px_-12px_rgba(16,54,66,0.16)] ring-1 ring-border/50 backdrop-blur-sm sm:p-8">
                {children}
              </div>
              <p className="mt-6 text-center text-xs text-muted-foreground">
                © {new Date().getFullYear()} {t("brand.name")}
              </p>
            </section>
          </div>
        </main>
      </div>
    </div>
  );
}
