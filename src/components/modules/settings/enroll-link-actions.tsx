"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Check, Copy, MessageCircle, MoreHorizontal, QrCode } from "lucide-react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription,
  AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Switch } from "@/components/ui/switch";
import {
  Tooltip, TooltipContent, TooltipProvider, TooltipTrigger,
} from "@/components/ui/tooltip";
import { deleteEnrollLink, setEnrollLinkActive } from "./actions";

export function LinkActiveSwitch({ id, active }: { id: string; active: boolean }) {
  const t = useTranslations("settings");
  const router = useRouter();
  const [checked, setChecked] = useState(active);
  const [pending, startTransition] = useTransition();

  function toggle(next: boolean) {
    setChecked(next);
    startTransition(async () => {
      const res = await setEnrollLinkActive(id, next);
      if (!res.ok) {
        setChecked(!next);
        toast.error(t(`errors.${res.error}`));
        return;
      }
      router.refresh();
    });
  }

  return (
    <Switch
      checked={checked}
      disabled={pending}
      onCheckedChange={toggle}
      aria-label={t("enrollment.activeLabel")}
    />
  );
}

/**
 * What a director does with a link, in the row: copy it and send it on
 * WhatsApp — the two things this page exists for — as ghost icons, and the
 * rest behind one overflow. Deleting is the only destructive item and lives
 * inside the menu; a red bin on every row would be the loudest thing on the
 * page for its rarest action.
 */
export function LinkRowActions({
  id,
  label,
  url,
  waText,
}: {
  id: string;
  label: string;
  url: string;
  waText: string;
}) {
  const t = useTranslations("settings");
  const tc = useTranslations("common");
  const router = useRouter();
  const [copied, setCopied] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [pending, startTransition] = useTransition();

  async function copy() {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      toast.success(t("enrollment.copied"));
      setTimeout(() => setCopied(false), 2000);
    } catch {
      toast.error(t("errors.generic"));
    }
  }

  function remove() {
    startTransition(async () => {
      const res = await deleteEnrollLink(id);
      if (res.ok) {
        toast.success(tc("toasts.deleted"));
        router.refresh();
      } else {
        toast.error(t(`errors.${res.error}`));
      }
    });
  }

  return (
    <TooltipProvider>
      <div className="flex items-center justify-end gap-0.5">
        <Tooltip>
          <TooltipTrigger asChild>
            <Button variant="ghost" size="icon-sm" onClick={copy} aria-label={t("enrollment.copy")}>
              {copied ? <Check /> : <Copy />}
            </Button>
          </TooltipTrigger>
          <TooltipContent>{t("enrollment.copy")}</TooltipContent>
        </Tooltip>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button variant="ghost" size="icon-sm" asChild>
              <a
                href={`https://wa.me/?text=${encodeURIComponent(waText)}`}
                target="_blank"
                rel="noopener noreferrer"
                aria-label={t("enrollment.whatsapp")}
              >
                <MessageCircle />
              </a>
            </Button>
          </TooltipTrigger>
          <TooltipContent>{t("enrollment.whatsapp")}</TooltipContent>
        </Tooltip>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon-sm" aria-label={t("enrollment.more")}>
              <MoreHorizontal />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem asChild>
              <Link href={`/settings/enrollment/${id}/poster`}>
                <QrCode />
                {t("enrollment.poster")}
              </Link>
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem variant="destructive" onSelect={() => setDeleting(true)}>
              {tc("actions.delete")}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
      <AlertDialog open={deleting} onOpenChange={setDeleting}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("enrollment.deleteTitle")}</AlertDialogTitle>
            <AlertDialogDescription>
              {t("enrollment.deleteDescription", { label })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{tc("actions.cancel")}</AlertDialogCancel>
            <AlertDialogAction
              disabled={pending}
              onClick={remove}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {tc("actions.delete")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </TooltipProvider>
  );
}
