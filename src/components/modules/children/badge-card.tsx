"use client";

import Link from "next/link";
import { useLocale, useTranslations } from "next-intl";
import { ArrowLeft, Printer } from "lucide-react";
import { Button } from "@/components/ui/button";
import { initials } from "@/lib/format";
import { BadgeFace } from "./badge-face";

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

/**
 * A child's door badge on its own page: the face, a way back to the file and
 * a print button. The face itself is shared with the register's print sheet
 * (badge-face.tsx) so a badge printed one at a time and a badge cut from a
 * sheet are the same object.
 */
export function BadgeCard({ data }: { data: BadgeCardData }) {
  const t = useTranslations("children");
  const tc = useTranslations("common");
  const locale = useLocale();

  const nameLatin = `${data.firstName} ${data.lastName}`;
  const nameAr =
    data.firstNameAr && data.lastNameAr ? `${data.firstNameAr} ${data.lastNameAr}` : null;
  // The reader's script leads; the other still prints underneath, since the
  // door staff may read either.
  const primaryName = locale === "ar" && nameAr ? nameAr : nameLatin;
  const secondaryName = primaryName === nameAr ? nameLatin : nameAr;
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

      <BadgeFace
        id="print-badge"
        hint={t("card.scanHint")}
        data={{
          name: primaryName,
          altName: secondaryName,
          initials: initials(data.firstName, data.lastName),
          photoUrl: data.photoUrl,
          code: data.tagCode,
          establishment: data.kindergartenName,
          klass: klass ? { name: klass, color: data.classColor } : null,
          line: null,
        }}
      />
    </div>
  );
}
