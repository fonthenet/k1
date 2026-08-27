"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { BellRing } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { notifyIncidentParent } from "./actions";

/** Stamps parent_notified_at = now for an incident that was reported without notifying. */
export function NotifyParentButton({ incidentId }: { incidentId: string }) {
  const t = useTranslations("comms");
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  function run() {
    startTransition(async () => {
      const res = await notifyIncidentParent(incidentId);
      if (res.ok) {
        toast.success(t("incidents.toasts.notified"));
        router.refresh();
      } else {
        toast.error(t("incidents.toasts.error"));
      }
    });
  }

  return (
    <Button size="sm" onClick={run} disabled={pending}>
      <BellRing data-icon="inline-start" />
      {t("incidents.detail.notifyNow")}
    </Button>
  );
}
