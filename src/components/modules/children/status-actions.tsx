"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { LogOut, RotateCcw } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import type { ChildStatus } from "@/lib/types";
import { setChildStatus } from "./actions";

export function StatusActions({ childId, status }: { childId: string; status: ChildStatus }) {
  const t = useTranslations("children");
  const tc = useTranslations("common");
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  const isWithdrawn = status === "withdrawn";
  const action = isWithdrawn ? "reenroll" : "withdraw";

  function run() {
    startTransition(async () => {
      const res = await setChildStatus(childId, action);
      if (res.ok) {
        toast.success(t(isWithdrawn ? "toasts.reenrolled" : "toasts.withdrawn"));
        router.refresh();
      } else {
        toast.error(t("toasts.error"));
      }
    });
  }

  return (
    <AlertDialog>
      <AlertDialogTrigger asChild>
        {isWithdrawn ? (
          <Button variant="outline" disabled={pending}>
            <RotateCcw data-icon="inline-start" />
            {t("statusActions.reenroll")}
          </Button>
        ) : (
          <Button variant="destructive" disabled={pending}>
            <LogOut data-icon="inline-start" />
            {t("statusActions.withdraw")}
          </Button>
        )}
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>
            {t(isWithdrawn ? "statusActions.reenrollTitle" : "statusActions.withdrawTitle")}
          </AlertDialogTitle>
          <AlertDialogDescription>
            {t(
              isWithdrawn
                ? "statusActions.reenrollDescription"
                : "statusActions.withdrawDescription"
            )}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>{tc("actions.cancel")}</AlertDialogCancel>
          <AlertDialogAction onClick={run}>{tc("actions.confirm")}</AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
