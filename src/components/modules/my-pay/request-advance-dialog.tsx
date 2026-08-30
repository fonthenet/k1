"use client";

import { useState, useTransition } from "react";
import { HandCoins } from "lucide-react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { requestAdvance } from "./actions";

/**
 * Ask for an advance on my salary — the only write on /my-pay.
 *
 * There is no employee field and no date field. Who is asking is the signed-in
 * person, decided on the server; the date is the day finance approves, which
 * has not happened yet. Leaving either on the form would suggest an employee
 * could file on someone else's behalf or backdate money.
 */
export function RequestAdvanceDialog({ variant = "default" }: { variant?: "default" | "outline" }) {
  const t = useTranslations("accounting");
  const tc = useTranslations("common");
  const [open, setOpen] = useState(false);
  const [amount, setAmount] = useState("");
  const [note, setNote] = useState("");
  const [pending, startTransition] = useTransition();

  function onOpenChange(next: boolean) {
    setOpen(next);
    if (next) {
      setAmount("");
      setNote("");
    }
  }

  const parsedAmount = Number(amount);
  const valid = Number.isFinite(parsedAmount) && parsedAmount > 0;

  function submit() {
    if (!valid) return;
    startTransition(async () => {
      const res = await requestAdvance({
        amount: parsedAmount,
        note: note.trim() || undefined,
      });
      if (res.ok) {
        toast.success(t("advances.requestSent"));
        setOpen(false);
      } else {
        toast.error(t(`errors.${res.error}`));
      }
    });
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogTrigger asChild>
        <Button variant={variant}>
          <HandCoins data-icon="inline-start" />
          {t("advances.request")}
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{t("advances.requestTitle")}</DialogTitle>
          {/* Says out loud that nothing is paid until finance answers. Without
              it a filed request reads like money already on its way. */}
          <DialogDescription>{t("advances.requestDesc")}</DialogDescription>
        </DialogHeader>

        <div className="grid gap-4">
          <div className="grid gap-2">
            <Label htmlFor="my-advance-amount">{t("advances.amount")}</Label>
            <Input
              id="my-advance-amount"
              type="number"
              inputMode="decimal"
              min="0"
              step="0.01"
              dir="ltr"
              className="tabular-nums"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              placeholder="0"
            />
          </div>

          <div className="grid gap-2">
            <Label htmlFor="my-advance-note">
              {t("advances.reason")}{" "}
              <span className="font-normal text-muted-foreground">({tc("labels.optional")})</span>
            </Label>
            <Textarea
              id="my-advance-note"
              rows={3}
              maxLength={300}
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder={t("advances.reasonPlaceholder")}
            />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)}>
            {tc("actions.cancel")}
          </Button>
          <Button onClick={submit} disabled={pending || !valid}>
            {tc("actions.submit")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
