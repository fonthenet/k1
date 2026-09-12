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
    // Ghost, not red: the severity pill beside the child's name is the row's
    // one red, and a second red control read as a second alarm. The label
    // keeps the button honest as the one thing a parent can do on the row.
    <Button
      type="button"
      size="sm"
      variant="ghost"
      onClick={acknowledge}
      disabled={pending}
      className="h-9 rounded-lg px-3"
    >
      <CircleCheck data-icon="inline-start" />
      {t("ack")}
    </Button>
  );
}
