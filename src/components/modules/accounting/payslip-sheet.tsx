// The bilingual (FR/AR) payslip itself, with no opinion about who is reading it.
//
// Two routes render this sheet: finance opening a line of a payroll run, and a
// member of staff opening their own payslip from /my-pay. Algerian payslips are
// bilingual administrative documents, and an employee handing one to a bank or a
// landlord must get exactly the sheet finance sees — so it is one component,
// not two that drift. What differs between the two routes is the way back and
// the permission check, and those stay on the pages.

import { getTranslations } from "next-intl/server";
import { formatDate, formatDZD } from "@/lib/format";
import type { PaymentMethod, Tenant } from "@/lib/types";

export interface PayslipAmounts {
  base: number;
  bonuses: number;
  deductions: number;
  /** Advances already taken this period and withheld from the net. */
  advances: number;
  net: number;
}

const LINES: { key: "base" | "bonuses" | "deductions" | "advances"; negative: boolean }[] = [
  { key: "base", negative: false },
  { key: "bonuses", negative: false },
  { key: "deductions", negative: true },
  { key: "advances", negative: true },
];

export async function PayslipSheet({
  tenant,
  employeeName,
  jobTitle,
  hireDate,
  month,
  amounts,
  paidAt,
  method,
  locale,
}: {
  tenant: Tenant;
  employeeName: string;
  jobTitle: string | null;
  hireDate: string | null;
  /** The run's month, "YYYY-MM-01". */
  month: string;
  amounts: PayslipAmounts;
  paidAt: string | null;
  method: PaymentMethod | null;
  locale: string;
}) {
  // Both languages on the same sheet — Algerian administrative documents are bilingual.
  const [tFr, tAr] = await Promise.all([
    getTranslations({ locale: "fr", namespace: "accounting" }),
    getTranslations({ locale: "ar", namespace: "accounting" }),
  ]);

  const monthDate = new Date(`${month}T00:00:00`);
  const monthFr = new Intl.DateTimeFormat("fr-DZ", { month: "long", year: "numeric" }).format(monthDate);
  const monthAr = new Intl.DateTimeFormat("ar-DZ", { month: "long", year: "numeric" }).format(monthDate);

  const dz = (n: number) => formatDZD(n, "fr");

  return (
    <>
      {/* Hide the app shell when printing — the sheet below is the whole page. */}
      <style>{`@media print {
        aside, header { display: none !important; }
        main { overflow: visible !important; padding: 0 !important; background: white !important; }
        .payslip-sheet { border: none !important; box-shadow: none !important; border-radius: 0 !important; }
      }`}</style>

      <div className="payslip-sheet rounded-xl bg-white p-8 text-sm text-black shadow-md ring-1 ring-black/10 print:rounded-none print:shadow-none print:ring-0">
        {/* Letterhead */}
        <div className="flex items-start justify-between gap-4 border-b border-black/15 pb-4">
          <div>
            <div className="text-lg font-bold">{tenant.name}</div>
            {tenant.address && <div className="text-xs text-black/55">{tenant.address}</div>}
            {(tenant.wilaya || tenant.commune) && (
              <div className="text-xs text-black/55">
                {[tenant.commune, tenant.wilaya].filter(Boolean).join(", ")}
              </div>
            )}
            {tenant.phone && (
              <div className="text-xs text-black/55" dir="ltr">
                {tenant.phone}
              </div>
            )}
          </div>
          <div className="text-end">
            <div className="text-base font-bold">{tFr("payslip.title")}</div>
            <div className="text-base font-bold" dir="rtl">
              {tAr("payslip.title")}
            </div>
          </div>
        </div>

        {/* Period + employee */}
        <div className="mt-4 grid grid-cols-2 gap-x-6 gap-y-2">
          <BiRow fr={tFr("payslip.period")} ar={tAr("payslip.period")} value={`${monthFr} — ${monthAr}`} />
          <BiRow fr={tFr("payslip.employer")} ar={tAr("payslip.employer")} value={tenant.name} />
          <BiRow fr={tFr("payslip.employee")} ar={tAr("payslip.employee")} value={employeeName} />
          <BiRow fr={tFr("payslip.jobTitle")} ar={tAr("payslip.jobTitle")} value={jobTitle ?? "—"} />
          {hireDate && (
            <BiRow
              fr={tFr("payslip.hireDate")}
              ar={tAr("payslip.hireDate")}
              value={formatDate(hireDate, "fr")}
            />
          )}
        </div>

        {/* Amounts */}
        <table className="mt-6 w-full border-collapse">
          <thead>
            <tr className="border-y border-black/20 bg-black/[0.04] text-xs font-semibold text-black/55">
              <th className="py-2 text-start font-medium">{tFr("payslip.item")}</th>
              <th className="py-2 text-end font-medium" dir="rtl">
                {tAr("payslip.item")}
              </th>
              <th className="w-36 py-2 text-end font-medium">
                {tFr("payslip.amount")} / {tAr("payslip.amount")}
              </th>
            </tr>
          </thead>
          <tbody>
            {LINES.map((line) => (
              <tr key={line.key} className="border-b border-black/10">
                <td className="py-2">{tFr(`payslip.${line.key}`)}</td>
                <td className="py-2 text-end" dir="rtl">
                  {tAr(`payslip.${line.key}`)}
                </td>
                <td className="py-2 text-end tabular-nums">
                  {line.negative && amounts[line.key] > 0 ? "−" : ""}
                  {dz(amounts[line.key])}
                </td>
              </tr>
            ))}
            <tr className="border-b-2 border-black text-base font-bold">
              <td className="py-3">{tFr("payslip.net")}</td>
              <td className="py-3 text-end" dir="rtl">
                {tAr("payslip.net")}
              </td>
              <td className="py-3 text-end tabular-nums">{dz(amounts.net)}</td>
            </tr>
          </tbody>
        </table>

        {/* Payment info */}
        {paidAt && (
          <div className="mt-4 grid grid-cols-2 gap-x-6 gap-y-2">
            <BiRow
              fr={tFr("payslip.method")}
              ar={tAr("payslip.method")}
              value={method ? `${tFr(`methods.${method}`)} — ${tAr(`methods.${method}`)}` : "—"}
            />
            <BiRow
              fr={tFr("payslip.paidOn")}
              ar={tAr("payslip.paidOn")}
              value={formatDate(paidAt, "fr")}
            />
          </div>
        )}

        {/* Signatures */}
        <div className="mt-10 grid grid-cols-2 gap-8">
          <div className="text-center">
            <div className="text-xs text-black/55">
              {tFr("payslip.signatureEmployer")}
              <span className="mx-1">/</span>
              <span dir="rtl">{tAr("payslip.signatureEmployer")}</span>
            </div>
            <div className="mt-16 border-t border-dashed border-black/40" />
          </div>
          <div className="text-center">
            <div className="text-xs text-black/55">
              {tFr("payslip.signatureEmployee")}
              <span className="mx-1">/</span>
              <span dir="rtl">{tAr("payslip.signatureEmployee")}</span>
            </div>
            <div className="mt-16 border-t border-dashed border-black/40" />
          </div>
        </div>

        <p className="mt-8 text-center text-xs text-black/45">
          {tFr("payslip.generated", { date: formatDate(new Date(), "fr") })} —{" "}
          <span dir="rtl">
            {tAr("payslip.generated", {
              date: formatDate(new Date(), locale === "ar" ? "ar" : "fr"),
            })}
          </span>
        </p>
      </div>
    </>
  );
}

/** A "Label fr / label ar : value" row of the payslip info grid. */
function BiRow({ fr, ar, value }: { fr: string; ar: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3 border-b border-dotted border-black/20 pb-1">
      <span className="text-xs text-black/55">
        {fr} <span dir="rtl">/ {ar}</span>
      </span>
      <span className="text-end font-medium">{value}</span>
    </div>
  );
}
