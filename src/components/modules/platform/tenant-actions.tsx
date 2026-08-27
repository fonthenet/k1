"use client";

import { useTransition } from "react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { setTenantStatus } from "./actions";

/**
 * Suspending a crèche locks a paying customer out of their own records mid-day,
 * so it sits behind a confirmation that names them. Re-activating does not —
 * restoring access is never the dangerous direction.
 */
export function TenantStatusAction({
  tenantId,
  name,
  status,
}: {
  tenantId: string;
  name: string;
  status: string;
}) {
  const t = useTranslations("platform");
  const [pending, startTransition] = useTransition();
  const suspended = status === "suspended";

  function apply(next: "active" | "suspended") {
    startTransition(async () => {
      const res = await setTenantStatus({ tenantId, status: next });
      if (res.ok) toast.success(next === "active" ? t("tenants.resumed") : t("tenants.suspended"));
      else toast.error(t("errors.generic"));
    });
  }

  if (suspended) {
    return (
      <Button variant="outline" size="sm" disabled={pending} onClick={() => apply("active")}>
        {t("tenants.resume")}
      </Button>
    );
  }

  return (
    <AlertDialog>
      <AlertDialogTrigger asChild>
        <Button variant="ghost" size="sm" disabled={pending} className="text-destructive-solid">
          {t("tenants.suspend")}
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{t("tenants.suspendTitle", { name })}</AlertDialogTitle>
          <AlertDialogDescription>{t("tenants.suspendBody")}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>{t("tenants.cancel")}</AlertDialogCancel>
          <AlertDialogAction onClick={() => apply("suspended")}>
            {t("tenants.suspendConfirm")}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
