import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { getLocale, getTranslations } from "next-intl/server";
import { PrintButton } from "@/components/modules/dashboard/print-button";
import { loadBadgesData } from "@/components/modules/settings/badges-data";
import { formatDate, listFormat } from "@/lib/format";
import { badgeSettings, type TagType } from "@/lib/badge-settings";
import { requireAdmin } from "@/lib/tenant";
import { cn } from "@/lib/utils";

/**
 * The print rules of the dossier sheets (enroll/print-sheets.tsx), copied
 * rather than imported because that module keeps them private: only the
 * sheet prints, at A4 with the sheet's own margins, whatever else the
 * settings shell draws around it on screen.
 */
const PRINT_CSS = `
@page { size: A4 portrait; margin: 12mm; }
@media print {
  body * { visibility: hidden !important; }
  #print-area, #print-area * { visibility: visible !important; }
  #print-area {
    position: absolute; top: 0; left: 0; right: 0;
    margin: 0 !important; border: none !important; box-shadow: none !important;
    border-radius: 0 !important; padding: 0 !important; max-width: none !important;
  }
}
#print-area section { break-inside: avoid; }
`;

/** The steps of the guide, in the order a director meets them. */
const STEPS = ["buy", "plug", "test", "assign", "kiosk", "office", "lost"] as const;

/**
 * The three moves of the office step, numbered inside its section: the
 * reader switched to its serial mode, the kiosk connected to that port, the
 * kiosk window kept above the spreadsheet. They are a list of their own
 * because each is done once, in this order, on the office PC.
 */
const OFFICE_MOVES = ["serial", "connect", "pip"] as const;

/** The badge kinds a "what to buy" paragraph exists for; "any" describes both. */
const TAG_PARAGRAPHS: Record<TagType, readonly ("em125" | "nfc")[]> = {
  em125: ["em125"],
  nfc: ["nfc"],
  any: ["em125", "nfc"],
};

/**
 * The setup guide: one printable A4 sheet, in the reader's language, that
 * takes an establishment from "we have no badges" to a parent passing a
 * card at the door. It reads the same settings key as the card that links
 * here, so the shopping list names the frequency the director chose and the
 * count of people still without a card is today's, not an example.
 *
 * Ink on paper like the dossier sheets: black on white in both themes,
 * Cairo for Arabic, dates through formatDate, so the page a director pins
 * beside the kiosk prints at full contrast.
 */
export default async function BadgesGuidePage() {
  const ctx = await requireAdmin();
  const [locale, t, tb, tc] = await Promise.all([
    getLocale(),
    getTranslations("settings.badges.guide"),
    getTranslations("settings.badges"),
    getTranslations("common"),
  ]);
  const settings = badgeSettings(ctx.tenant.settings);
  const { stats } = await loadBadgesData(ctx, locale);
  const arabic = locale === "ar";

  // "12 enfants, 30 parents et 4 membres de l'équipe" — only the groups that
  // still have someone to equip, joined the way the language joins a list.
  const without = [
    { key: "children", n: stats.children.total - stats.children.withCard },
    { key: "guardians", n: stats.guardians.total - stats.guardians.withCard },
    { key: "staff", n: stats.staff.total - stats.staff.withCard },
  ].filter((g) => g.n > 0);
  const withoutList = listFormat(locale).format(
    without.map((g) => t(`counts.${g.key}`, { count: g.n }))
  );

  /** The step's paragraphs; the shopping step is assembled from the settings. */
  function paragraphs(step: (typeof STEPS)[number]): React.ReactNode[] {
    if (step === "buy") {
      return [
        ...TAG_PARAGRAPHS[settings.tagType].map((kind) => t(`buy.tags.${kind}`)),
        ...(settings.tagType === "any" ? [t("buy.tags.chooseOne")] : []),
        t("buy.reader"),
        without.length > 0 ? t("counts.sentence", { list: withoutList }) : t("counts.none"),
      ];
    }
    return [t(`${step}.p1`), ...(t.has(`${step}.p2`) ? [t(`${step}.p2`)] : [])];
  }

  return (
    <div className="space-y-4">
      <style>{PRINT_CSS}</style>

      {/* Screen-only toolbar: back to the badges page, and the page's one
          primary — print. */}
      <div className="mx-auto flex max-w-[210mm] items-center justify-between gap-3 print:hidden">
        <Link
          href="/settings/badges"
          className="inline-flex items-center gap-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground"
        >
          <ArrowLeft className="size-4 rtl:rotate-180" aria-hidden />
          {tb("title")}
        </Link>
        <PrintButton label={tc("actions.print")} />
      </div>

      <div
        id="print-area"
        dir={arabic ? "rtl" : "ltr"}
        lang={locale}
        className={cn(
          "mx-auto max-w-[210mm] rounded-xl border border-border bg-white p-8 text-black shadow-sm md:p-10 print:shadow-none",
          arabic && "font-[family-name:var(--font-cairo)]"
        )}
      >
        <header className="border-b-2 border-black/80 pb-4">
          <p className="text-xs text-black/60">
            <bdi dir="auto">{ctx.tenant.name}</bdi>
          </p>
          <h1 className="mt-1 text-2xl font-bold">{t("title")}</h1>
          <p className="mt-1 text-sm text-black/70">{t("subtitle")}</p>
        </header>

        <ol className="mt-6 grid gap-6">
          {STEPS.map((step, i) => (
            <li key={step}>
              <section className="grid grid-cols-[2rem_1fr] gap-x-3">
                {/* The step number: an ltr island, so "1" stays "1" in Arabic
                    and the circle sits at the inline start of the row. */}
                <span
                  dir="ltr"
                  className="flex size-8 items-center justify-center rounded-full border border-black/70 text-sm font-semibold tabular-nums"
                  aria-hidden
                >
                  {i + 1}
                </span>
                <div className="min-w-0 pt-1">
                  <h2 className="text-base font-bold">{t(`${step}.title`)}</h2>
                  <div className="mt-1.5 grid gap-1.5 text-sm leading-relaxed text-black/85">
                    {paragraphs(step).map((p, j) => (
                      <p key={j}>{p}</p>
                    ))}
                    {/* The office step alone carries a numbered list after its
                        opening paragraph, then what to do when the browser
                        cannot keep a window on top, and the plain limit of a
                        keyboard-only reader. Decimal markers keep Western
                        digits in Arabic, like the step circles. */}
                    {step === "office" && (
                      <>
                        <ol className="grid list-decimal gap-1.5 ps-5 marker:tabular-nums">
                          {OFFICE_MOVES.map((move) => (
                            <li key={move}>{t(`office.moves.${move}`)}</li>
                          ))}
                        </ol>
                        <p>{t("office.fallback")}</p>
                        <p>{t("office.limit")}</p>
                      </>
                    )}
                  </div>
                </div>
              </section>
            </li>
          ))}
        </ol>

        <footer className="mt-8 border-t border-black/25 pt-3 text-xs text-black/60">
          {t("printed", { date: formatDate(new Date(), locale) })}
        </footer>
      </div>
    </div>
  );
}
