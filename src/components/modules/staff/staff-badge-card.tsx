"use client";

import Link from "next/link";
import { QRCodeSVG } from "qrcode.react";
import { useTranslations } from "next-intl";
import { ArrowLeft, Printer } from "lucide-react";
import { Button } from "@/components/ui/button";
import { initials } from "@/lib/format";

export interface StaffBadgeData {
  membershipId: string;
  name: string;
  jobTitle: string | null;
  roleLabel: string;
  staffCode: string;
  tenantName: string;
}

/**
 * The staff door badge. Same shape as the child card so a crèche prints one
 * kind of thing, and the QR carries the staff code — the value the kiosk
 * already resolves through kg_credentials.
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

      <div
        id="print-badge"
        className="overflow-hidden rounded-2xl border border-border bg-card text-card-foreground shadow-lg print:border-black/20 print:bg-white print:text-black print:shadow-none"
      >
        <div className="bg-primary px-5 py-3.5 text-center text-sm font-semibold tracking-wide text-primary-foreground uppercase">
          {data.tenantName}
        </div>
        <div className="flex flex-col items-center gap-3 px-6 py-7">
          <span className="flex size-24 items-center justify-center rounded-full bg-primary/10 text-2xl font-bold text-primary ring-2 ring-primary/20 print:bg-transparent print:text-black">
            {initials(first, last)}
          </span>
          <div className="text-center">
            <div className="text-xl font-bold tracking-tight">{data.name}</div>
            <div className="text-sm text-muted-foreground print:text-black/70">
              {data.jobTitle || data.roleLabel}
            </div>
          </div>
          {/* Literal black-on-white: scanners need the contrast, and it has to
              print correctly whatever the on-screen theme is. */}
          <div className="rounded-xl border border-border bg-white p-3 print:border-black/20">
            <QRCodeSVG value={data.staffCode} size={160} marginSize={0} />
          </div>
          <div
            className="rounded-md bg-muted px-3 py-1 font-mono text-sm font-semibold tracking-widest print:bg-transparent"
            dir="ltr"
          >
            {data.staffCode}
          </div>
          <p className="text-center text-xs text-muted-foreground print:text-black/60">
            {t("badge.scanHint")}
          </p>
        </div>
      </div>
    </div>
  );
}
