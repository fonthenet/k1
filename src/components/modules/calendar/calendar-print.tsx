"use client";

import type { ReactNode } from "react";
import { Printer } from "lucide-react";
import { Button } from "@/components/ui/button";

/**
 * The month on paper. The sheet is the same grid the screen shows, wrapped
 * in the one element the print stylesheet leaves visible — the /reports
 * print pattern — under a heading that says whose month it is and a line
 * that says what was ticked, because a printed page has no filter bar to
 * read that from. Landscape A4: seven columns of a school month do not fit
 * a portrait page at a legible size.
 *
 * Inside the grid, the month draws every folded line for print
 * (`hidden print:block`) and hides its "+N" doors; tints become hairlines
 * and today's circle a ring, so a monochrome printer still tells them apart.
 */
export function CalendarPrint({
  title,
  legend,
  scope,
  children,
}: {
  /** "{establishment} · {month}". */
  title: string;
  /** The legend's words, joined by the caller. */
  legend: string;
  /** "{structure} · {kinds}". */
  scope: string;
  children: ReactNode;
}) {
  return (
    <>
      <style>{`
        @page { size: A4 landscape; margin: 12mm; }
        @media print {
          body * { visibility: hidden !important; }
          #kg-calendar-print, #kg-calendar-print * { visibility: visible !important; }
          #kg-calendar-print {
            position: absolute; top: 0; left: 0; right: 0;
            margin: 0 !important; padding: 0 !important; max-width: none !important;
          }
        }
      `}</style>
      <div id="kg-calendar-print">
        <div className="mb-2 hidden print:block">
          <h2 className="text-base font-semibold">
            <bdi dir="auto">{title}</bdi>
          </h2>
          <p className="text-xs text-muted-foreground">
            {legend}
            <span aria-hidden> · </span>
            <bdi dir="auto">{scope}</bdi>
          </p>
        </div>
        {children}
      </div>
    </>
  );
}

/** The outline "Imprimer" of the toolbar: the browser's own dialog, nothing else. */
export function PrintButton({ label }: { label: string }) {
  return (
    <Button type="button" variant="outline" size="sm" onClick={() => window.print()} className="print:hidden">
      <Printer data-icon="inline-start" />
      {label}
    </Button>
  );
}
