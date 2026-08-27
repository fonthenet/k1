"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { Switch } from "@/components/ui/switch";
import { setActivityActive } from "./actions";

/** Toggle an activity's `active` flag from a card or the detail header. */
export function ActivityActiveToggle({
  activityId,
  active,
}: {
  activityId: string;
  active: boolean;
}) {
  const t = useTranslations("activities");
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  function toggle(next: boolean) {
    startTransition(async () => {
      const res = await setActivityActive(activityId, next);
      if (res.ok) {
        toast.success(next ? t("toasts.activated") : t("toasts.deactivated"));
        router.refresh();
      } else {
        toast.error(res.error === "forbidden" ? t("toasts.forbidden") : t("toasts.error"));
      }
    });
  }

  return (
    <Switch
      checked={active}
      onCheckedChange={toggle}
      disabled={pending}
      aria-label={t("list.activeToggle")}
    />
  );
}
