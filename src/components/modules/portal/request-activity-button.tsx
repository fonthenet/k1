"use client";

import { useTransition } from "react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { requestActivityEnrollment } from "./actions";

export function RequestActivityButton({
  childId,
  activityId,
}: {
  childId: string;
  activityId: string;
}) {
  const t = useTranslations("portal.child.activities");
  const tc = useTranslations("common");
  const [pending, startTransition] = useTransition();

  function request() {
    startTransition(async () => {
      const res = await requestActivityEnrollment({ childId, activityId });
      if (res.ok) {
        toast.success(t("requestSuccess"));
      } else if (res.error === "duplicate") {
        toast.error(t("requestDuplicate"));
      } else {
        toast.error(tc("toasts.error"));
      }
    });
  }

  return (
    <Button
      size="sm"
      variant="outline"
      onClick={request}
      disabled={pending}
      className="h-9 rounded-lg px-3"
    >
      <Sparkles data-icon="inline-start" />
      {t("request")}
    </Button>
  );
}
