"use client";

import { Download } from "lucide-react";
import { Button } from "@/components/ui/button";

/** Client-side CSV download (UTF-8 BOM + ";" separator so Excel fr/ar opens it cleanly). */
export function ExportCsvButton({
  filename,
  headers,
  rows,
  label,
}: {
  filename: string;
  headers: string[];
  rows: (string | number | null)[][];
  label: string;
}) {
  const handleExport = () => {
    const esc = (v: string | number | null) => `"${String(v ?? "").replaceAll('"', '""')}"`;
    const csv =
      "\uFEFF" + [headers, ...rows].map((r) => r.map(esc).join(";")).join("\r\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <Button variant="outline" size="sm" onClick={handleExport} disabled={rows.length === 0}>
      <Download data-icon="inline-start" />
      {label}
    </Button>
  );
}
