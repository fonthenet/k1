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

export interface IssuedPin {
  pinCode: string;
  /** The code printed on the person's badge — a guardian's tag, a colleague's staff code. */
  code: string | null;
}

/**
 * The one and only time a PIN is ever rendered.
 *
 * It comes straight from the action's result held in memory — it is never
 * re-fetched, so closing this dialog really does lose it, and the copy says
 * so plainly. The guardian's dialog on the child record and the register's
 * staff dialog are both this component; only the words around the number
 * change, so the number always looks the same wherever it is handed over.
 */
export function IssuedPinDialog({
  issued,
  onClose,
  title,
  description,
  warning,
  codeLabel,
  printHref,
}: {
  /** Null closes the dialog; the PIN lives in this prop and nowhere else. */
  issued: IssuedPin | null;
  onClose: () => void;
  title: string;
  description: React.ReactNode;
  /** The line under the PIN saying it will not be shown again, and what to do if it is lost. */
  warning: string;
  /** "Code badge" for a parent, "Code personnel" for a colleague. */
  codeLabel: string;
  /** The badge page, opened in a new tab; null when there is nothing to print. */
  printHref: string | null;
}) {
  const t = useTranslations("children");
  const tc = useTranslations("common");
  const [copied, setCopied] = useState(false);

  async function copyPin() {
    if (!issued) return;
    try {
      await navigator.clipboard.writeText(issued.pinCode);
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
    <Dialog open={issued !== null} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>

        {issued && (
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
                {issued.pinCode}
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
              {warning}
            </p>

            {issued.code && (
              <div className="flex items-center justify-between gap-3 rounded-lg bg-muted/50 px-3 py-2">
                <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  {codeLabel}
                </span>
                <span dir="ltr" className="font-mono text-sm font-semibold tracking-wider">
                  {issued.code}
                </span>
              </div>
            )}
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" className="min-h-11" onClick={() => handleOpenChange(false)}>
            {tc("actions.close")}
          </Button>
          {printHref && (
            <Button asChild className="min-h-11">
              <Link href={printHref} target="_blank" rel="noopener noreferrer">
                <Printer data-icon="inline-start" />
                {t("guardians.credentials.printBadge")}
              </Link>
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
