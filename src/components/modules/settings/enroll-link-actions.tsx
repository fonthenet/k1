"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Check, Copy, MessageCircle, QrCode, Trash2 } from "lucide-react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription,
  AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
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
    <div className="flex items-center justify-end gap-1">
      <Tooltip>
        <TooltipTrigger asChild>
          <Button variant="ghost" size="icon" onClick={copy} aria-label={t("enrollment.copy")}>
            {copied ? <Check /> : <Copy />}
          </Button>
        </TooltipTrigger>
        <TooltipContent>{t("enrollment.copy")}</TooltipContent>
      </Tooltip>
      <Tooltip>
        <TooltipTrigger asChild>
          <Button variant="ghost" size="icon" asChild>
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
      <Tooltip>
        <TooltipTrigger asChild>
          <Button variant="ghost" size="icon" asChild>
            <Link
              href={`/settings/enrollment/${id}/poster`}
              aria-label={t("enrollment.poster")}
            >
              <QrCode />
            </Link>
          </Button>
        </TooltipTrigger>
        <TooltipContent>{t("enrollment.poster")}</TooltipContent>
      </Tooltip>
      <AlertDialog>
        <AlertDialogTrigger asChild>
          <Button
            variant="ghost"
            size="icon"
            className="text-destructive hover:text-destructive"
            aria-label={tc("actions.delete")}
          >
            <Trash2 />
          </Button>
        </AlertDialogTrigger>
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
    </div>
    </TooltipProvider>
  );
}
