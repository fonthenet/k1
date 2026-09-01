"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { CopyPlus, Send } from "lucide-react";
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
} from "@/components/ui/alert-dialog";
import { copyPreviousWeekMenus, publishWeekMenus } from "./actions";

/**
 * Copies last week's open days onto the displayed week.
 *
 * The confirmation is not ceremony. The action is an upsert, so running it over
 * a week somebody has already filled in replaces what they typed, with no undo
 * and nothing on screen to say it happened — the toast reports a count either
 * way. It therefore asks only when there is something to lose: on an empty
 * week the dialog would be pure friction and the button acts immediately.
 */
export function CopyPreviousWeekButton({
  weekStart,
  hasExisting,
}: {
  weekStart: string;
  /** Does the displayed week already have menu content to overwrite? */
  hasExisting: boolean;
}) {
  const t = useTranslations("comms");
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [asking, setAsking] = useState(false);

  function run() {
    setAsking(false);
    startTransition(async () => {
      const res = await copyPreviousWeekMenus(weekStart);
      if (res.ok) {
        toast.success(t("menus.toasts.copied", { count: res.count ?? 0 }));
        router.refresh();
      } else {
        toast.error(t("menus.toasts.error"));
      }
    });
  }

  return (
    <>
      <Button
        variant="outline"
        onClick={() => (hasExisting ? setAsking(true) : run())}
        disabled={pending}
      >
        <CopyPlus data-icon="inline-start" />
        {t("menus.copyLastWeek")}
      </Button>

      <AlertDialog open={asking} onOpenChange={setAsking}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("menus.copyConfirm.title")}</AlertDialogTitle>
            <AlertDialogDescription>{t("menus.copyConfirm.body")}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("menus.copyConfirm.cancel")}</AlertDialogCancel>
            <AlertDialogAction onClick={run}>{t("menus.copyConfirm.confirm")}</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

/**
 * Publish every day of the displayed week that has something on it.
 *
 * Exists because copying now lands as drafts. Without one button for the week,
 * planning a fortnight ahead would mean opening ten dialogs and flipping ten
 * switches, and the safe default would be the annoying one — which is how safe
 * defaults get removed.
 *
 * Rendered only when there is an unpublished day with content, so it is absent
 * on a week that is already live rather than present and inert.
 */
export function PublishWeekButton({ weekStart }: { weekStart: string }) {
  const t = useTranslations("comms");
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  return (
    <Button
      variant="outline"
      disabled={pending}
      onClick={() =>
        startTransition(async () => {
          const res = await publishWeekMenus(weekStart);
          if (res.ok) {
            toast.success(t("menus.toasts.publishedWeek", { count: res.count ?? 0 }));
            router.refresh();
          } else {
            toast.error(t("menus.toasts.error"));
          }
        })
      }
    >
      <Send data-icon="inline-start" />
      {t("menus.publishWeek")}
    </Button>
  );
}
