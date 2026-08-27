"use client";

import { useTransition } from "react";
import { useLocale, useTranslations } from "next-intl";

import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { setLocale } from "@/app/actions/locale";

export function LocaleToggle() {
  const locale = useLocale();
  const t = useTranslations("common");
  const [isPending, startTransition] = useTransition();

  function switchTo(next: "ar" | "en" | "fr") {
    if (next === locale) return;
    startTransition(() => setLocale(next));
  }

  return (
    <div className="inline-flex items-center gap-0.5 rounded-full border border-border bg-card p-1 shadow-sm">
      {(["ar", "en", "fr"] as const).map((l) => {
        const active = locale === l;
        return (
          <Button
            key={l}
            type="button"
            variant="ghost"
            size="xs"
            aria-pressed={active}
            className={cn(
              "rounded-full px-2.5 font-medium",
              active
                ? "bg-primary/10 text-primary hover:bg-primary/15 hover:text-primary"
                : "text-muted-foreground hover:text-foreground",
            )}
            disabled={isPending}
            onClick={() => switchTo(l)}
          >
            {l === "ar" ? t("arabic") : l === "en" ? t("english") : t("french")}
          </Button>
        );
      })}
    </div>
  );
}
