"use client";

import { useState, useTransition } from "react";
import { MoreHorizontal } from "lucide-react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription,
  AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { revokeInvite } from "./actions";

/**
 * The confirm behind "revoke". Given `open`/`onOpenChange` it is controlled
 * and renders no trigger of its own — the row's overflow menu opens it — so
 * the words, the pending state and the toasts live in one place whichever
 * way it is reached. Left uncontrolled it carries its own labelled trigger.
 */
export function RevokeInviteButton({
  id,
  email,
  open,
  onOpenChange,
}: {
  id: string;
  email: string;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
}) {
  const t = useTranslations("staff");
  const tc = useTranslations("common");
  const [pending, startTransition] = useTransition();
  const controlled = open !== undefined;

  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      {!controlled && (
        <AlertDialogTrigger asChild>
          <Button variant="ghost" size="sm" className="text-destructive hover:text-destructive" disabled={pending}>
            {t("invites.revoke")}
          </Button>
        </AlertDialogTrigger>
      )}
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{t("invites.revokeTitle")}</AlertDialogTitle>
          <AlertDialogDescription>{t("invites.revokeDescription", { email })}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>{tc("actions.cancel")}</AlertDialogCancel>
          {/* The only red on the invitations page: the word that ends one. */}
          <AlertDialogAction
            variant="destructive"
            disabled={pending}
            onClick={() =>
              startTransition(async () => {
                const res = await revokeInvite(id);
                if (res.ok) toast.success(t("invites.revoked"));
                else toast.error(t(`errors.${res.error}`));
              })
            }
          >
            {t("invites.revoke")}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

/**
 * The row's overflow: revoking is its only item, and the only destructive
 * thing on the page — inside a menu, never a red bin on every row. The
 * confirm is mounted beside the menu, not inside it, so closing the menu
 * does not unmount the dialog it just opened.
 */
export function InviteRowMenu({ id, email }: { id: string; email: string }) {
  const t = useTranslations("staff");
  const [revoking, setRevoking] = useState(false);

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="icon-sm" aria-label={t("invites.more")} title={t("invites.more")}>
            <MoreHorizontal />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem variant="destructive" onSelect={() => setRevoking(true)}>
            {t("invites.revoke")}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <RevokeInviteButton id={id} email={email} open={revoking} onOpenChange={setRevoking} />
    </>
  );
}
