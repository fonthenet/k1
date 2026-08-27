"use client";

import Image from "next/image";
import Link from "next/link";
import { ArrowLeft, Printer } from "lucide-react";
import { QRCodeSVG } from "qrcode.react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";

export interface PosterData {
  url: string;
  kindergartenName: string;
  logoUrl: string | null;
}

/**
 * A4 portrait poster with a big QR code; everything but the sheet is hidden
 * when printing.
 *
 * DELIBERATE THEME EXCEPTION: the sheet is painted in literal ink-on-paper
 * (`bg-white` / `text-black` + black alpha tints), not theme tokens. It is a
 * printed artefact — it must stay black on white whether the operator has the
 * app in light or dark mode, and a token-driven sheet would print unreadable
 * pale text off a dark surface. No Tailwind palette colours are used.
 */
export function EnrollPoster({ data }: { data: PosterData }) {
  const t = useTranslations("settings");
  const tc = useTranslations("common");

  return (
    <div>
      <style>{`
        #poster-sheet {
          -webkit-print-color-adjust: exact;
          print-color-adjust: exact;
        }
        @media print {
          @page { size: A4 portrait; margin: 0; }
          body * { visibility: hidden !important; }
          #poster-sheet, #poster-sheet * { visibility: visible !important; }
          #poster-sheet {
            position: fixed !important;
            top: 0 !important;
            inset-inline-start: 0 !important;
            width: 210mm !important;
            height: 297mm !important;
            max-width: none !important;
            margin: 0 !important;
            border: 0 !important;
            border-radius: 0 !important;
            box-shadow: none !important;
          }
        }
      `}</style>

      <div className="mb-6 flex flex-wrap items-center justify-between gap-2 print:hidden">
        <Button asChild variant="ghost">
          <Link href="/settings/enrollment">
            <ArrowLeft data-icon="inline-start" className="rtl:rotate-180" />
            {t("poster.back")}
          </Link>
        </Button>
        <Button onClick={() => window.print()}>
          <Printer data-icon="inline-start" />
          {tc("actions.print")}
        </Button>
      </div>

      <div
        id="poster-sheet"
        className="mx-auto flex aspect-[210/297] w-full max-w-[210mm] flex-col items-center justify-between rounded-xl border border-border bg-white p-[12mm] text-center text-black shadow-sm"
      >
        <div className="flex flex-col items-center gap-4">
          {data.logoUrl && (
            <Image
              src={data.logoUrl}
              alt=""
              width={120}
              height={120}
              unoptimized
              className="size-24 object-contain"
            />
          )}
          <h1 className="text-3xl font-bold tracking-tight">{data.kindergartenName}</h1>
          <div className="h-1 w-24 rounded-full bg-black/80" />
          <p className="text-2xl leading-snug font-bold" dir="rtl" lang="ar">
            {t("poster.heading.ar")}
          </p>
          <p className="text-xl font-semibold" dir="ltr" lang="en">
            {t("poster.heading.en")}
          </p>
          <p className="text-xl font-semibold" dir="ltr" lang="fr">
            {t("poster.heading.fr")}
          </p>
        </div>

        <div className="rounded-2xl border-4 border-black p-5">
          <QRCodeSVG value={data.url} size={300} marginSize={0} level="M" />
        </div>

        <div className="flex w-full flex-col items-center gap-3">
          <p className="text-lg font-semibold" dir="rtl" lang="ar">
            {t("poster.instruction.ar")}
          </p>
          <p className="text-base" dir="ltr" lang="en">
            {t("poster.instruction.en")}
          </p>
          <p className="text-base" dir="ltr" lang="fr">
            {t("poster.instruction.fr")}
          </p>
          <p className="mt-2 text-xs tracking-widest text-black/55 uppercase">
            <span dir="rtl" lang="ar">
              {t("poster.orVisit.ar")}
            </span>
            {" · "}
            <span dir="ltr" lang="fr">
              {t("poster.orVisit.fr")}
            </span>
          </p>
          <p
            dir="ltr"
            className="w-full rounded-lg bg-black/5 px-4 py-2 font-mono text-sm font-medium break-all"
          >
            {data.url}
          </p>
        </div>
      </div>
    </div>
  );
}
