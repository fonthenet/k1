"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { CopyPlus } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { copyPreviousWeekMenus } from "./actions";

/** Copies last week's Sun–Thu menus onto the displayed week. */
export function CopyPreviousWeekButton({ weekStart }: { weekStart: string }) {
  const t = useTranslations("comms");
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  function run() {
    startTransition(async () => {
      const res = await copyPreviousWeekMenus(weekStart);
      if (res.ok) {
        toast.success(t("menus.toasts.copied", { count: res.count ?? 0 }));
        router.refresh();
      } else {
        toast.error(t("menus.toasts.error"));
      }
    });
  }

  return (
    <Button variant="outline" onClick={run} disabled={pending}>
      <CopyPlus data-icon="inline-start" />
      {t("menus.copyLastWeek")}
    </Button>
  );
}
