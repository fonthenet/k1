"use client";

import { useTransition } from "react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { Checkbox } from "@/components/ui/checkbox";
import { setTimesheetApproved } from "./actions";

export function TimesheetApprove({
  id,
  membershipId,
  approved,
}: {
  id: string;
  membershipId: string;
  approved: boolean;
}) {
  const t = useTranslations("staff");
  const [pending, startTransition] = useTransition();

  return (
    <Checkbox
      checked={approved}
      disabled={pending}
      aria-label={t("timesheets.columns.approved")}
      onCheckedChange={(next) => {
        startTransition(async () => {
          const res = await setTimesheetApproved(id, membershipId, next === true);
          if (res.ok) {
            toast.success(next === true ? t("timesheets.approvedToast") : t("timesheets.unapprovedToast"));
          } else {
            toast.error(t(`errors.${res.error}`));
          }
        });
      }}
    />
  );
}
