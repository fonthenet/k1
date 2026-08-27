"use client";

import { useTransition } from "react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { CircleCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ackIncident } from "./actions";

export function AckIncidentButton({ incidentId }: { incidentId: string }) {
  const t = useTranslations("portal.home.incidents");
  const tc = useTranslations("common");
  const [pending, startTransition] = useTransition();

  function acknowledge() {
    startTransition(async () => {
      const res = await ackIncident(incidentId);
      if (res.ok) {
        toast.success(t("acked"));
      } else {
        toast.error(tc("toasts.error"));
      }
    });
  }

  return (
    <Button
      size="sm"
      variant="outline"
      onClick={acknowledge}
      disabled={pending}
      className="h-9 rounded-lg border-destructive/30 px-3 text-destructive hover:bg-destructive/10 hover:text-destructive"
    >
      <CircleCheck data-icon="inline-start" />
      {t("ack")}
    </Button>
  );
}
