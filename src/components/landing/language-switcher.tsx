"use client";

import { useTransition } from "react";
import { useLocale, useTranslations } from "next-intl";
import { CheckIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { setLocale } from "@/app/actions/locale";

const LANGUAGES = [
  { code: "ar", label: "العربية" },
  { code: "en", label: "English" },
  { code: "fr", label: "Français" },
] as const;

export function LanguageSwitcher() {
  const locale = useLocale();
  const t = useTranslations("landing");
  const [isPending, startTransition] = useTransition();

  const current = LANGUAGES.find((l) => l.code === locale) ?? LANGUAGES[0];

  function switchTo(next: (typeof LANGUAGES)[number]["code"]) {
    if (next === locale) return;
    startTransition(() => setLocale(next));
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="sm"
          disabled={isPending}
          aria-label={t("nav.language")}
          className="h-10 gap-1.5 rounded-full px-3 font-semibold text-muted-foreground hover:text-foreground"
        >
          {/* No glyph: the language's own name in its own script IS the icon,
              and it is the only label that reads to every visitor. */}
          <span className="text-sm">{current.label}</span>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" sideOffset={10} className="w-44 rounded-2xl p-1.5">
        <DropdownMenuLabel className="text-xs text-muted-foreground">
          {t("nav.language")}
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        {LANGUAGES.map((l) => (
          <DropdownMenuItem
            key={l.code}
            onClick={() => switchTo(l.code)}
            className="justify-between rounded-xl px-2.5 py-2 font-medium"
          >
            <span lang={l.code}>{l.label}</span>
            {l.code === locale && <CheckIcon className="size-4 text-primary" aria-hidden />}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
