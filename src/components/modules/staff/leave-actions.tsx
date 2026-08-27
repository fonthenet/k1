"use client";

import { useTransition } from "react";
import { Check, Undo2, X } from "lucide-react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { cancelLeave, decideLeave } from "./actions";

/** Approve / reject buttons for admins on a pending request. */
export function LeaveDecisionButtons({ id }: { id: string }) {
  const t = useTranslations("staff");
  const [pending, startTransition] = useTransition();

  function decide(decision: "approved" | "rejected") {
    startTransition(async () => {
      const res = await decideLeave(id, decision);
      if (res.ok) {
        toast.success(decision === "approved" ? t("leaves.approvedToast") : t("leaves.rejectedToast"));
      } else {
        toast.error(t(`errors.${res.error}`));
      }
    });
  }

  return (
    <div className="flex items-center justify-end gap-1.5">
      <Button
        size="sm"
        variant="outline"
        disabled={pending}
        className="border-success/40 text-success hover:bg-success/10 hover:text-success"
        onClick={() => decide("approved")}
      >
        <Check data-icon="inline-start" />
        {t("leaves.approve")}
      </Button>
      <Button size="sm" variant="destructive" disabled={pending} onClick={() => decide("rejected")}>
        <X data-icon="inline-start" />
        {t("leaves.reject")}
      </Button>
    </div>
  );
}

/** Cancel button for one's own pending request. */
export function LeaveCancelButton({ id }: { id: string }) {
  const t = useTranslations("staff");
  const [pending, startTransition] = useTransition();

  return (
    <Button
      size="sm"
      variant="ghost"
      disabled={pending}
      onClick={() =>
        startTransition(async () => {
          const res = await cancelLeave(id);
          if (res.ok) toast.success(t("leaves.cancelledToast"));
          else toast.error(t(`errors.${res.error}`));
        })
      }
    >
      <Undo2 data-icon="inline-start" />
      {t("leaves.cancel")}
    </Button>
  );
}
