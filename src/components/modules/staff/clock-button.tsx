"use client";

import { useTransition } from "react";
import { LogIn, LogOut } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { formatTime } from "@/lib/format";
import { clockSelf } from "./actions";

export function ClockButton({ direction }: { direction: "in" | "out" }) {
  const t = useTranslations("staff");
  const locale = useLocale();
  const [pending, startTransition] = useTransition();

  function onClick() {
    startTransition(async () => {
      const res = await clockSelf(direction);
      if (res.ok) {
        const time = res.data.at ? formatTime(res.data.at, locale) : "";
        toast.success(direction === "in" ? t("clock.clockedIn", { time }) : t("clock.clockedOut", { time }));
      } else {
        toast.error(t(`errors.${res.error}`));
      }
    });
  }

  return (
    <Button onClick={onClick} disabled={pending} variant={direction === "in" ? "default" : "outline"}>
      {direction === "in" ? <LogIn data-icon="inline-start" /> : <LogOut data-icon="inline-start" />}
      {direction === "in" ? t("clock.in") : t("clock.out")}
    </Button>
  );
}
