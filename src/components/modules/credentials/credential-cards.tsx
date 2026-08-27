"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useLocale, useTranslations } from "next-intl";
import { CreditCard, Plus, ScanLine, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { formatDate } from "@/lib/format";
import { issueCard, revokeCard } from "./actions";
import type { CredentialRow, CredentialSubject } from "./types";

/**
 * Proximity cards for one person.
 *
 * Enrolment is a scan, not a transcription: a USB reader is a keyboard that
 * types the card's number and presses Enter, so the dialog just needs a focused
 * field. Typing the number by hand still works for a card read elsewhere.
 */
export function CredentialCards({
  subjectType,
  subjectId,
  cards,
  path,
}: {
  subjectType: CredentialSubject;
  subjectId: string;
  /** Only `rfid` rows — QR and PIN are shown by their own components. */
  cards: CredentialRow[];
  path: string;
}) {
  const t = useTranslations("credentials");
  const tc = useTranslations("common");
  const locale = useLocale();
  const [open, setOpen] = useState(false);
  const [value, setValue] = useState("");
  const [label, setLabel] = useState("");
  const [pending, startTransition] = useTransition();
  const inputRef = useRef<HTMLInputElement>(null);

  // The reader fires the instant the card touches it, so the field has to be
  // focused before anyone reaches for a card.
  useEffect(() => {
    if (!open) return;
    const id = setTimeout(() => inputRef.current?.focus(), 80);
    return () => clearTimeout(id);
  }, [open]);

  function submit() {
    const card = value.trim();
    if (!card || pending) return;
    startTransition(async () => {
      const res = await issueCard({
        subjectType,
        subjectId,
        value: card,
        label: label.trim() || undefined,
        path,
      });
      if (res.ok) {
        toast.success(t("toasts.issued"));
        setOpen(false);
        setValue("");
        setLabel("");
      } else {
        toast.error(t(`errors.${res.error}`));
      }
    });
  }

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

      <Button variant="outline" size="sm" className="justify-self-start" onClick={() => setOpen(true)}>
        <Plus data-icon="inline-start" />
        {t("addCard")}
      </Button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{t("dialog.title")}</DialogTitle>
            <DialogDescription>{t("dialog.description")}</DialogDescription>
          </DialogHeader>
          <div className="grid gap-4">
            <div className="grid gap-1.5">
              <Label htmlFor="cred-value">{t("dialog.value")}</Label>
              <div className="relative">
                <ScanLine className="pointer-events-none absolute inset-y-0 start-3 my-auto size-4 text-muted-foreground" />
                <Input
                  id="cred-value"
                  ref={inputRef}
                  dir="ltr"
                  autoComplete="off"
                  className="ps-9 font-mono"
                  placeholder={t("dialog.valueHint")}
                  value={value}
                  onChange={(e) => setValue(e.target.value)}
                  onKeyDown={(e) => {
                    // The reader ends its burst with Enter — that is the whole
                    // interaction, so treat it as the submit.
                    if (e.key === "Enter") {
                      e.preventDefault();
                      submit();
                    }
                  }}
                />
              </div>
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="cred-label">{t("dialog.label")}</Label>
              <Input
                id="cred-label"
                placeholder={t("dialog.labelHint")}
                value={label}
                onChange={(e) => setLabel(e.target.value)}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)} disabled={pending}>
              {tc("actions.cancel")}
            </Button>
            <Button onClick={submit} disabled={pending || !value.trim()}>
              {t("dialog.submit")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
