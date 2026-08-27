"use client";

import Link from "next/link";
import { QRCodeSVG } from "qrcode.react";
import { useLocale, useTranslations } from "next-intl";
import { ArrowLeft, Printer } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ChildAvatar } from "./child-avatar";

export interface BadgeCardData {
  childId: string;
  firstName: string;
  lastName: string;
  firstNameAr: string | null;
  lastNameAr: string | null;
  tagCode: string;
  className: string | null;
  classNameAr: string | null;
  classColor: string | null;
  kindergartenName: string;
  photoUrl: string | null;
}

export function BadgeCard({ data }: { data: BadgeCardData }) {
  const t = useTranslations("children");
  const tc = useTranslations("common");
  const locale = useLocale();

  const nameFr = `${data.firstName} ${data.lastName}`;
  const nameAr =
    data.firstNameAr && data.lastNameAr ? `${data.firstNameAr} ${data.lastNameAr}` : null;
  const klass =
    locale === "ar" && data.classNameAr ? data.classNameAr : (data.className ?? null);

  return (
    <div className="mx-auto max-w-md">
      <style>{`
        @media print {
          body * { visibility: hidden !important; }
          #print-badge, #print-badge * { visibility: visible !important; }
          #print-badge {
            position: fixed !important;
            inset-inline-start: 0 !important;
            top: 0 !important;
            margin: 1cm !important;
            box-shadow: none !important;
          }
          /* The class colour band and QR must survive the printer's
             background-graphics stripping, or the badge is unusable. */
          #print-badge, #print-badge * {
            -webkit-print-color-adjust: exact !important;
            print-color-adjust: exact !important;
          }
        }
      `}</style>

      <div className="mb-4 flex items-center justify-between gap-2 print:hidden">
        <Button variant="outline" asChild>
          <Link href={`/children/${data.childId}`}>
            <ArrowLeft data-icon="inline-start" className="rtl:rotate-180" />
            {t("card.backToProfile")}
          </Link>
        </Button>
        <Button onClick={() => window.print()}>
          <Printer data-icon="inline-start" />
          {tc("actions.print")}
        </Button>
      </div>

      <div
        id="print-badge"
        className="overflow-hidden rounded-2xl border border-border bg-card text-card-foreground shadow-lg print:border-black/20 print:bg-white print:text-black print:shadow-none"
      >
        {/* Band uses the class colour from kg_classes.color (user data). */}
        <div
          className="px-5 py-3.5 text-center text-sm font-semibold uppercase tracking-wide text-white"
          style={{ backgroundColor: data.classColor ?? "var(--primary)" }}
        >
          {data.kindergartenName}
        </div>
        <div className="flex flex-col items-center gap-3 px-6 py-7">
          <ChildAvatar
            firstName={data.firstName}
            lastName={data.lastName}
            photoUrl={data.photoUrl}
            className="size-24 text-2xl ring-2 ring-primary/20"
          />
          <div className="text-center">
            <div className="text-xl font-bold tracking-tight">{nameFr}</div>
            {nameAr && (
              <div className="text-base font-semibold" dir="rtl">
                {nameAr}
              </div>
            )}
            {klass && (
              <div className="mt-2 inline-flex items-center gap-1.5 rounded-full border border-border px-2.5 py-0.5 text-xs font-medium print:border-black/20">
                <span
                  className="size-2 rounded-full"
                  style={{ backgroundColor: data.classColor ?? "var(--primary)" }}
                  aria-hidden
                />
                {klass}
              </div>
            )}
          </div>
          {/* QR stays literal black-on-white: scanners need the contrast, and it
              must print correctly whatever the on-screen theme is. */}
          <div className="rounded-xl border border-border bg-white p-3 print:border-black/20">
            <QRCodeSVG value={data.tagCode} size={160} marginSize={0} />
          </div>
          <div className="rounded-md bg-muted px-3 py-1 font-mono text-sm font-semibold tracking-widest print:bg-transparent">
            {data.tagCode}
          </div>
          <p className="text-center text-xs text-muted-foreground print:text-black/60">
            {t("card.scanHint")}
          </p>
        </div>
      </div>
    </div>
  );
}
