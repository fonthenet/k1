"use client";

import Link from "next/link";
import { useTranslations } from "next-intl";
import { ArrowLeft, Printer } from "lucide-react";
import { Button } from "@/components/ui/button";
import { initials } from "@/lib/format";
import { BadgeFace } from "@/components/modules/children/badge-face";

export interface StaffBadgeData {
  membershipId: string;
  name: string;
  jobTitle: string | null;
  roleLabel: string;
  staffCode: string;
  tenantName: string;
}

/**
 * The staff door badge. Same face as the child card (badge-face.tsx) so a
 * crèche prints one kind of thing, and the QR carries the staff code — the
 * value the kiosk already resolves through kg_credentials.
 *
 * The PIN is deliberately absent. It is the second factor: printing it on the
 * badge would mean a dropped badge carries both halves.
 */
export function StaffBadgeCard({ data }: { data: StaffBadgeData }) {
  const t = useTranslations("staff");
  const tc = useTranslations("common");
  const [first = "", last = ""] = data.name.split(" ");

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
          #print-badge, #print-badge * {
            -webkit-print-color-adjust: exact !important;
            print-color-adjust: exact !important;
          }
        }
      `}</style>

      <div className="mb-4 flex items-center justify-between gap-2 print:hidden">
        <Button variant="outline" asChild>
          <Link href={`/staff/${data.membershipId}`}>
            <ArrowLeft data-icon="inline-start" className="rtl:rotate-180" />
            {t("badge.back")}
          </Link>
        </Button>
        <Button onClick={() => window.print()}>
          <Printer data-icon="inline-start" />
          {tc("actions.print")}
        </Button>
      </div>

      <BadgeFace
        id="print-badge"
        hint={t("badge.scanHint")}
        data={{
          name: data.name,
          altName: null,
          initials: initials(first, last),
          photoUrl: null,
          code: data.staffCode,
          establishment: data.tenantName,
          klass: null,
          line: data.jobTitle || data.roleLabel,
        }}
      />
    </div>
  );
}
