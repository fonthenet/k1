"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Check, X } from "lucide-react";
import { toast } from "sonner";
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { endActivityEnrollment, resolveActivityRequest } from "./actions";

/** End an active enrollment (status → ended, end date today). */
export function EndEnrollmentButton({
  activityId,
  enrollmentId,
  childName,
}: {
  activityId: string;
  enrollmentId: string;
  childName: string;
}) {
  const t = useTranslations("activities");
  const tc = useTranslations("common");
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();

  function confirm() {
    startTransition(async () => {
      const res = await endActivityEnrollment(activityId, enrollmentId);
      if (res.ok) {
        setOpen(false);
        toast.success(t("toasts.ended"));
        router.refresh();
      } else {
        toast.error(res.error === "forbidden" ? t("toasts.forbidden") : t("toasts.error"));
      }
    });
  }

  return (
    <AlertDialog open={open} onOpenChange={setOpen}>
      <AlertDialogTrigger asChild>
        <Button variant="ghost" size="sm">
          {t("detail.enrollments.end")}
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{t("detail.enrollments.endTitle")}</AlertDialogTitle>
          <AlertDialogDescription>
            {t("detail.enrollments.endDescription", { name: childName })}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={pending}>{tc("actions.cancel")}</AlertDialogCancel>
          <Button variant="destructive" onClick={confirm} disabled={pending}>
            {t("detail.enrollments.end")}
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

/** Approve / decline buttons for a parent's 'requested' enrollment row. */
export function RequestActions({
  activityId,
  enrollmentId,
}: {
  activityId: string;
  enrollmentId: string;
}) {
  const t = useTranslations("activities");
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  function resolve(approve: boolean) {
    startTransition(async () => {
      const res = await resolveActivityRequest(activityId, enrollmentId, approve);
      if (res.ok) {
        toast.success(approve ? t("toasts.approved") : t("toasts.declined"));
        router.refresh();
      } else {
        toast.error(res.error === "forbidden" ? t("toasts.forbidden") : t("toasts.error"));
      }
    });
  }

  return (
    <div className="flex items-center gap-2">
      <Button size="sm" onClick={() => resolve(true)} disabled={pending}>
        <Check data-icon="inline-start" />
        {t("detail.pending.approve")}
      </Button>
      <Button size="sm" variant="outline" onClick={() => resolve(false)} disabled={pending}>
        <X data-icon="inline-start" />
        {t("detail.pending.decline")}
      </Button>
    </div>
  );
}
