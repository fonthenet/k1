"use client";

import Link from "next/link";
import { QRCodeSVG } from "qrcode.react";
import { useLocale, useTranslations } from "next-intl";
import { ArrowLeft, Printer } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { Relationship } from "@/lib/types";
import { ChildAvatar } from "./child-avatar";

export interface GuardianBadgeData {
  childId: string;
  guardianId: string;
  firstName: string;
  lastName: string;
  firstNameAr: string | null;
  lastNameAr: string | null;
  relationship: Relationship;
  /** Encoded verbatim in the QR — the kiosk looks this exact string up. */
  tagCode: string;
  kindergartenName: string;
  photoUrl: string | null;
  /** Names already localised server-side. */
  childrenNames: string[];
}

/**
 * Printable A6 door badge for a guardian.
 *
 * Deliberately carries only ONE factor: the tag QR. The PIN is never printed —
 * a card that fell out of a pocket would otherwise carry both halves of the
 * credential. At the door the second factor is the human check: the kiosk puts
 * this photo next to the child's for staff to compare.
 */
export function GuardianBadgeCard({ data }: { data: GuardianBadgeData }) {
  const t = useTranslations("children");
  const tc = useTranslations("common");
  const locale = useLocale();

  const nameLatin = `${data.firstName} ${data.lastName}`;
  const nameAr =
    data.firstNameAr && data.lastNameAr ? `${data.firstNameAr} ${data.lastNameAr}` : null;
  // In Arabic the Arabic spelling leads; elsewhere the Latin one does. The
  // other script still prints underneath — the door staff may read either.
  const primaryName = locale === "ar" && nameAr ? nameAr : nameLatin;
  const secondaryName = locale === "ar" && nameAr ? nameLatin : nameAr;

  return (
    <div className="mx-auto max-w-md">
      <style>{`
        @page { size: A6 portrait; margin: 6mm; }
        @media print {
          body * { visibility: hidden !important; }
          #print-guardian-badge, #print-guardian-badge * { visibility: visible !important; }
          #print-guardian-badge {
            position: fixed !important;
            inset-inline-start: 0 !important;
            top: 0 !important;
            width: 93mm !important;
            margin: 0 !important;
            border-radius: 0 !important;
            box-shadow: none !important;
            break-inside: avoid;
          }
          /* The header band and the QR must survive the printer's
             background-graphics stripping, or the badge is unusable. */
          #print-guardian-badge, #print-guardian-badge * {
            -webkit-print-color-adjust: exact !important;
            print-color-adjust: exact !important;
          }
        }
      `}</style>

      <div className="mb-4 flex items-center justify-between gap-2 print:hidden">
        <Button variant="outline" className="min-h-11" asChild>
          <Link href={`/children/${data.childId}`}>
            <ArrowLeft data-icon="inline-start" className="rtl:rotate-180" />
            {t("guardianCard.backToChild")}
          </Link>
        </Button>
        <Button className="min-h-11" onClick={() => window.print()}>
          <Printer data-icon="inline-start" />
          {tc("actions.print")}
        </Button>
      </div>

      <div
        id="print-guardian-badge"
        className="overflow-hidden rounded-2xl border border-border bg-card text-card-foreground shadow-lg print:border-black/20 print:bg-white print:text-black print:shadow-none"
      >
        <div
          className="px-5 py-3 text-center text-sm font-semibold uppercase tracking-wide text-primary-foreground"
          style={{ backgroundColor: "var(--primary)" }}
        >
          {data.kindergartenName}
        </div>

        <div className="flex flex-col items-center gap-3 px-6 py-5">
          <span className="rounded-full bg-primary/10 px-2.5 py-0.5 text-[0.7rem] font-semibold uppercase tracking-wide text-primary print:border print:border-black/20">
            {t("guardianCard.title")}
          </span>

          {/* The photo is the point of the badge: staff compare this face with
              the person in front of them before the child is handed over. */}
          <ChildAvatar
            firstName={data.firstName}
            lastName={data.lastName}
            photoUrl={data.photoUrl}
            className="size-24 text-2xl ring-2 ring-primary/20"
          />

          <div className="text-center">
            <div className="text-xl font-bold leading-tight tracking-tight">{primaryName}</div>
            {secondaryName && (
              <div
                className="text-base font-semibold text-muted-foreground print:text-black/70"
                dir={secondaryName === nameAr ? "rtl" : "ltr"}
              >
                {secondaryName}
              </div>
            )}
            <div className="mt-1 text-sm text-muted-foreground print:text-black/70">
              {t(`guardians.relationships.${data.relationship}`)}
            </div>
          </div>

          {/* QR stays literal black-on-white: scanners need the contrast, and it
              must print correctly whatever the on-screen theme is. */}
          <div className="rounded-xl border border-border bg-white p-3 print:border-black/20">
            <QRCodeSVG value={data.tagCode} size={150} marginSize={0} />
          </div>
          <div
            dir="ltr"
            className="rounded-md bg-muted px-3 py-1 font-mono text-sm font-semibold tracking-widest print:bg-transparent"
          >
            {data.tagCode}
          </div>

          <div className="w-full border-t border-border pt-3 text-center print:border-black/20">
            <div className="text-[0.7rem] font-semibold uppercase tracking-wide text-muted-foreground print:text-black/60">
              {t("guardianCard.childrenLabel")}
            </div>
            <div className="mt-1 text-sm font-medium leading-snug">
              {data.childrenNames.length > 0
                ? data.childrenNames.join(" · ")
                : t("guardianCard.noChildren")}
            </div>
          </div>

          <p className="text-center text-xs text-muted-foreground print:text-black/60">
            {t("guardianCard.footer")}
          </p>
        </div>
      </div>
    </div>
  );
}
