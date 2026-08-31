"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Archive, LogOut, RotateCcw } from "lucide-react";
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

  // Enrolled: offer both ways out. Otherwise: offer the way back.
  const isActive = status === "enrolled";

  function run(action: "withdraw" | "reenroll" | "archive", okKey: string) {
    startTransition(async () => {
      const res = await setChildStatus(childId, action);
      if (res.ok) {
        toast.success(t(okKey));
        router.refresh();
      } else {
        toast.error(t("toasts.error"));
      }
    });
  }

  // A fragment, not a wrapper div. These buttons are siblings of "Badge card"
  // and "Edit" in the page header's action row; boxing them in their own flex
  // container made the group a second grid item that aligned on its own centre
  // instead of on the row.
  return (
    <>
      {isActive ? (
        <>
          <Confirm
            trigger={
              <Button variant="destructive" disabled={pending}>
                <LogOut data-icon="inline-start" />
                {t("statusActions.withdraw")}
              </Button>
            }
            title={t("statusActions.withdrawTitle")}
            description={t("statusActions.withdrawDescription")}
            cancel={tc("actions.cancel")}
            confirm={tc("actions.confirm")}
            onConfirm={() => run("withdraw", "toasts.withdrawn")}
          />
          <Confirm
            trigger={
              <Button variant="outline" disabled={pending}>
                <Archive data-icon="inline-start" />
                {t("statusActions.archive")}
              </Button>
            }
            title={t("statusActions.archiveTitle")}
            description={t("statusActions.archiveDescription")}
            cancel={tc("actions.cancel")}
            confirm={tc("actions.confirm")}
            onConfirm={() => run("archive", "toasts.archived")}
          />
        </>
      ) : (
        <Confirm
          trigger={
            <Button variant="outline" disabled={pending}>
              <RotateCcw data-icon="inline-start" />
              {t("statusActions.reenroll")}
            </Button>
          }
          title={t("statusActions.reenrollTitle")}
          description={t("statusActions.reenrollDescription")}
          cancel={tc("actions.cancel")}
          confirm={tc("actions.confirm")}
          onConfirm={() => run("reenroll", "toasts.reenrolled")}
        />
      )}
    </>
  );
}

/** One destructive-ish button behind a confirmation. */
function Confirm({
  trigger,
  title,
  description,
  cancel,
  confirm,
  onConfirm,
}: {
  trigger: React.ReactNode;
  title: string;
  description: string;
  cancel: string;
  confirm: string;
  onConfirm: () => void;
}) {
  return (
    <AlertDialog>
      <AlertDialogTrigger asChild>{trigger}</AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{title}</AlertDialogTitle>
          <AlertDialogDescription>{description}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>{cancel}</AlertDialogCancel>
          <AlertDialogAction onClick={onConfirm}>{confirm}</AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
