"use client";

import { useState, useTransition } from "react";
import { useLocale, useTranslations } from "next-intl";
import { CreditCard, ScanLine, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { formatDate } from "@/lib/format";
import { revokeCard } from "./actions";
import { IssueCardDialog } from "./issue-card-dialog";
import type { CredentialRow, CredentialSubject } from "./types";

/**
 * Proximity cards for one person, on their record page: the live cards as a
 * list, a revoke on each, and the shared enrolment dialog behind one button
 * — "Scanner une carte", the same words as the record page's band shortcut
 * and the register's row menu, because it is the same act. A guardian row
 * on a child's file keeps that verb in its own overflow instead and mounts
 * this list without the button.
 */
export function CredentialCards({
  subjectType,
  subjectId,
  cards,
  path,
  withAddButton = true,
}: {
  subjectType: CredentialSubject;
  subjectId: string;
  /** Only `rfid` rows — QR and PIN are shown by their own components. */
  cards: CredentialRow[];
  path: string;
  /** False when the page around the list offers the enrolment verb itself. */
  withAddButton?: boolean;
}) {
  const t = useTranslations("credentials");
  const locale = useLocale();
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();

  function remove(id: string) {
    startTransition(async () => {
      const res = await revokeCard({ id, path });
      if (res.ok) toast.success(t("toasts.revoked"));
      else toast.error(t("errors.generic"));
    });
  }

  const live = cards.filter((c) => c.active);

  return (
    <div className="grid gap-2">
      {live.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t("empty")}</p>
      ) : (
        <ul className="grid gap-2">
          {live.map((card) => (
            <li
              key={card.id}
              className="flex items-center gap-3 rounded-xl border border-border bg-card px-3 py-2"
            >
              <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
                <CreditCard className="size-4" />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-semibold">
                  {card.label || t("unnamed")}
                </span>
                {/* A card number is a code: it never reorders in Arabic. */}
                <span
                  className="block truncate font-mono text-xs text-muted-foreground"
                  dir="ltr"
                >
                  {card.value}
                </span>
              </span>
              <span className="hidden shrink-0 text-xs text-muted-foreground sm:block">
                {card.last_used_at
                  ? t("lastUsed", { date: formatDate(card.last_used_at, locale) })
                  : t("neverUsed")}
              </span>
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label={t("revoke")}
                disabled={pending}
                onClick={() => remove(card.id)}
              >
                <Trash2 className="size-4 text-destructive-solid" />
              </Button>
            </li>
          ))}
        </ul>
      )}

      {withAddButton && (
        <>
          <Button variant="outline" size="sm" className="justify-self-start" onClick={() => setOpen(true)}>
            <ScanLine data-icon="inline-start" />
            {t("scan.title")}
          </Button>

          <IssueCardDialog
            subjectType={subjectType}
            subjectId={subjectId}
            open={open}
            onOpenChange={setOpen}
            path={path}
          />
        </>
      )}
    </div>
  );
}
