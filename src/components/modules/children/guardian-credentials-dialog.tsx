"use client";

import { useState } from "react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { Check, Copy, Printer, TriangleAlert } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import type { IssuedCredentials } from "./guardian-credentials-actions";

/**
 * The one and only time the PIN is ever rendered. It comes straight from the
 * RPC result held in memory — it is never re-fetched, so closing this dialog
 * really does lose it, and the copy says so plainly.
 */
export function GuardianCredentialsDialog({
  childId,
  guardianId,
  credentials,
  onClose,
}: {
  childId: string;
  guardianId: string;
  credentials: IssuedCredentials | null;
  onClose: () => void;
}) {
  const t = useTranslations("children");
  const tc = useTranslations("common");
  const [copied, setCopied] = useState(false);

  async function copyPin() {
    if (!credentials) return;
    try {
      await navigator.clipboard.writeText(credentials.pinCode);
      setCopied(true);
      toast.success(t("guardians.credentials.pinCopied"));
      setTimeout(() => setCopied(false), 2000);
    } catch {
      toast.error(t("toasts.error"));
    }
  }

  function handleOpenChange(next: boolean) {
    if (!next) {
      setCopied(false);
      onClose();
    }
  }

  return (
    <Dialog open={credentials !== null} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{t("guardians.credentials.issuedTitle")}</DialogTitle>
          <DialogDescription>
            {t("guardians.credentials.issuedDescription", {
              name: credentials?.guardianName ?? "",
            })}
          </DialogDescription>
        </DialogHeader>

        {credentials && (
          <div className="grid gap-4">
            <div className="grid gap-2 rounded-xl border border-primary/20 bg-primary/5 p-4 text-center">
              <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                {t("guardians.credentials.pinLabel")}
              </span>
              {/* dir=ltr: the code is read left-to-right even in Arabic. */}
              <span
                dir="ltr"
                className="font-mono text-4xl font-bold tabular-nums tracking-[0.35em] text-foreground"
              >
                {credentials.pinCode}
              </span>
              <div>
                <Button variant="outline" size="sm" onClick={copyPin}>
                  {copied ? (
                    <Check data-icon="inline-start" />
                  ) : (
                    <Copy data-icon="inline-start" />
                  )}
                  {t("guardians.credentials.copyPin")}
                </Button>
              </div>
            </div>

            <p className="flex items-start gap-2 rounded-lg border border-warning/40 bg-warning/15 px-3 py-2.5 text-sm leading-relaxed text-foreground">
              <TriangleAlert className="mt-0.5 size-4 shrink-0 text-warning" aria-hidden />
              {t("guardians.credentials.pinWarning")}
            </p>

            <div className="flex items-center justify-between gap-3 rounded-lg bg-muted/50 px-3 py-2">
              <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                {t("guardians.credentials.tagLabel")}
              </span>
              <span dir="ltr" className="font-mono text-sm font-semibold tracking-wider">
                {credentials.tagCode}
              </span>
            </div>
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" className="min-h-11" onClick={() => handleOpenChange(false)}>
            {tc("actions.close")}
          </Button>
          <Button asChild className="min-h-11">
            <Link
              href={`/children/${childId}/guardian/${guardianId}/badge`}
              target="_blank"
              rel="noopener noreferrer"
            >
              <Printer data-icon="inline-start" />
              {t("guardians.credentials.printBadge")}
            </Link>
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
