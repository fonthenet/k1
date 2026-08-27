"use client";

import { useTransition } from "react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { Undo2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cancelActivityRequest } from "./actions";

/** Lets a family take back an activity request while it is still pending. */
export function CancelActivityRequestButton({
  childId,
  activityId,
}: {
  childId: string;
  activityId: string;
}) {
  const t = useTranslations("portal.child.activities");
  const tc = useTranslations("common");
  const [pending, startTransition] = useTransition();

  function cancel() {
    startTransition(async () => {
      const res = await cancelActivityRequest({ childId, activityId });
      if (res.ok) toast.success(t("cancelSuccess"));
      else if (res.error === "forbidden") toast.error(t("cancelTooLate"));
      else toast.error(tc("toasts.error"));
    });
  }

  return (
    <Button
      size="sm"
      variant="ghost"
      onClick={cancel}
      disabled={pending}
      className="h-8 rounded-lg px-2 text-muted-foreground hover:text-destructive"
    >
      <Undo2 data-icon="inline-start" />
      {t("cancelRequest")}
    </Button>
  );
}
