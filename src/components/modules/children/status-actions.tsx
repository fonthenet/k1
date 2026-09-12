"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Archive, Ellipsis, IdCard, LogOut, RotateCcw } from "lucide-react";
import Link from "next/link";
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
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import type { ChildStatus } from "@/lib/types";
import { setChildStatus } from "./actions";

type StatusAction = "withdraw" | "reenroll" | "archive";

/**
 * The "…" menu of the child's identity band.
 *
 * Withdrawing and archiving are the rarest things done to a record, and as
 * two buttons of their own — one of them red — they were the loudest thing
 * above the fold. They live here, behind the overflow, with the badge card
 * beside them; the band keeps one primary (Déplacer) and one outline
 * (Modifier), the way every record page reads.
 */
export function StatusActions({ childId, status }: { childId: string; status: ChildStatus }) {
  const t = useTranslations("children");
  const tc = useTranslations("common");
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [confirming, setConfirming] = useState<StatusAction | null>(null);

  // Enrolled: offer both ways out. Otherwise: offer the way back.
  const isActive = status === "enrolled";

  function run(action: StatusAction, okKey: string) {
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

  const COPY: Record<StatusAction, { title: string; description: string; ok: string }> = {
    withdraw: {
      title: t("statusActions.withdrawTitle"),
      description: t("statusActions.withdrawDescription"),
      ok: "toasts.withdrawn",
    },
    archive: {
      title: t("statusActions.archiveTitle"),
      description: t("statusActions.archiveDescription"),
      ok: "toasts.archived",
    },
    reenroll: {
      title: t("statusActions.reenrollTitle"),
      description: t("statusActions.reenrollDescription"),
      ok: "toasts.reenrolled",
    },
  };

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="icon" aria-label={t("profile.more")} disabled={pending}>
            <Ellipsis />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem asChild>
            <Link href={`/children/${childId}/card`}>
              <IdCard />
              {t("profile.badgeCard")}
            </Link>
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          {isActive ? (
            <>
              <DropdownMenuItem onSelect={() => setConfirming("archive")}>
                <Archive />
                {t("statusActions.archive")}
              </DropdownMenuItem>
              <DropdownMenuItem variant="destructive" onSelect={() => setConfirming("withdraw")}>
                <LogOut />
                {t("statusActions.withdraw")}
              </DropdownMenuItem>
            </>
          ) : (
            <DropdownMenuItem onSelect={() => setConfirming("reenroll")}>
              <RotateCcw />
              {t("statusActions.reenroll")}
            </DropdownMenuItem>
          )}
        </DropdownMenuContent>
      </DropdownMenu>

      <AlertDialog open={confirming !== null} onOpenChange={(o) => !o && setConfirming(null)}>
        {confirming && (
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>{COPY[confirming].title}</AlertDialogTitle>
              <AlertDialogDescription>{COPY[confirming].description}</AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>{tc("actions.cancel")}</AlertDialogCancel>
              <AlertDialogAction
                onClick={() => {
                  const action = confirming;
                  setConfirming(null);
                  run(action, COPY[action].ok);
                }}
              >
                {tc("actions.confirm")}
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        )}
      </AlertDialog>
    </>
  );
}
