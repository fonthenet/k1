"use client";

import { useTranslations } from "next-intl";
import { TriangleAlert } from "lucide-react";

// Rendered inside the dark fullscreen kiosk layout — keep the same look.
export default function KioskError({ reset }: { error: Error; reset: () => void }) {
  const t = useTranslations("kiosk");
  return (
    <div className="flex h-full flex-1 flex-col items-center justify-center gap-4 p-8 text-center">
      <span className="flex size-20 items-center justify-center rounded-3xl bg-destructive/15 ring-4 ring-destructive/20">
        <TriangleAlert className="size-10 text-destructive" />
      </span>
      <h1 className="text-2xl font-bold">{t("errors.loadTitle")}</h1>
      <p className="max-w-sm text-base text-muted-foreground">{t("errors.loadDescription")}</p>
      <button
        type="button"
        onClick={reset}
        className="mt-2 flex h-14 items-center justify-center rounded-2xl bg-primary px-8 text-lg font-bold text-primary-foreground shadow-lg shadow-primary/20 transition-transform active:scale-95"
      >
        {t("actions.retry")}
      </button>
    </div>
  );
}
