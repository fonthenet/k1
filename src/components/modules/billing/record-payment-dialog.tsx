"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useLocale, useTranslations } from "next-intl";
import { Banknote, CheckCircle2, CreditCard, FileText, HandCoins, Landmark, Wallet } from "lucide-react";
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
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Textarea } from "@/components/ui/textarea";
import { formatDZD } from "@/lib/format";
import { IconTile } from "./finance-ui";
import { recordPayment } from "./actions";
import { PAYMENT_METHODS } from "./maps";
import type { PayableInvoice } from "./billing-types";

type Method = (typeof PAYMENT_METHODS)[number];

const METHOD_ICON: Record<Method, React.ComponentType<{ className?: string }>> = {
  cash: Banknote,
  cib: CreditCard,
  edahabia: Wallet,
  bank_transfer: Landmark,
  cheque: FileText,
};

/** Cash-first payment dialog. On success shows the receipt number + a link to print it. */
export function RecordPaymentDialog({
  invoice,
  size = "default",
  payable = true,
}: {
  invoice: PayableInvoice;
  size?: "default" | "sm";
  /**
   * Whether there is still a balance to take. Hides the trigger — it must NOT
   * unmount this component.
   *
   * Callers used to write `{payable && <RecordPaymentDialog/>}`. Recording a
   * payment revalidates /billing from the server action, so the moment the last
   * dinar landed the route re-rendered, `payable` turned false, and React tore
   * this component out of the tree — with the confirmation still open on top of
   * it. The receipt number and its print link appeared for about a second and
   * then vanished, and the only way back to the receipt was the invoice page.
   * Kept mounted, the same element stays in the same position and React keeps
   * its state, so the confirmation survives the refresh underneath it.
   */
  payable?: boolean;
}) {
  const t = useTranslations("billing");
  const tc = useTranslations("common");
  const locale = useLocale();
  const [open, setOpen] = useState(false);
  const [amount, setAmount] = useState(String(invoice.balance));
  const [method, setMethod] = useState<Method>("cash");
  const [reference, setReference] = useState("");
  const [note, setNote] = useState("");
  const [done, setDone] = useState<{ paymentId: string; receiptNumber: string | null } | null>(null);
  const [pending, startTransition] = useTransition();

  const parsedAmount = Number(amount);
  const amountValid = Number.isFinite(parsedAmount) && parsedAmount > 0;
  const canSubmit = amountValid && !pending;

  function onOpenChange(next: boolean) {
    setOpen(next);
    if (next) {
      setAmount(String(invoice.balance));
      setMethod("cash");
      setReference("");
      setNote("");
      setDone(null);
    }
  }

  function submit() {
    if (!canSubmit) return;
    startTransition(async () => {
      const res = await recordPayment({
        invoiceId: invoice.id,
        amount: parsedAmount,
        method,
        reference: reference || undefined,
        note: note || undefined,
      });
      if (res.ok) {
        setDone({ paymentId: res.paymentId, receiptNumber: res.receiptNumber });
        toast.success(t("payment.success"));
      } else {
        toast.error(t("toasts.error"));
      }
    });
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      {payable && (
        <DialogTrigger asChild>
          <Button
            variant={size === "sm" ? "outline" : "default"}
            size={size === "sm" ? "sm" : "default"}
          >
            <HandCoins data-icon="inline-start" />
            {t("payment.button")}
          </Button>
        </DialogTrigger>
      )}
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{t("payment.title")}</DialogTitle>
          <DialogDescription>
            {t("payment.description", { number: invoice.numberLabel, child: invoice.childName })}
          </DialogDescription>
        </DialogHeader>

        {done ? (
          <div className="flex flex-col items-center gap-3 py-4 text-center">
            <IconTile tone="success" size="lg">
              <CheckCircle2 />
            </IconTile>
            <div className="text-base font-semibold">{t("payment.success")}</div>
            {done.receiptNumber && (
              <div className="text-sm text-muted-foreground">
                {t("payment.receipt", { number: done.receiptNumber })}
              </div>
            )}
            <div className="mt-2 flex gap-2">
              <Button variant="outline" onClick={() => setOpen(false)}>
                {tc("actions.close")}
              </Button>
              <Button asChild>
                <Link href={`/billing/receipts/${done.paymentId}`}>{t("payment.viewReceipt")}</Link>
              </Button>
            </div>
          </div>
        ) : (
          <>
            <div className="grid gap-4">
              <div className="grid gap-1.5">
                <Label htmlFor={`pay-amount-${invoice.id}`}>{t("payment.amount")}</Label>
                <Input
                  id={`pay-amount-${invoice.id}`}
                  type="number"
                  min="0"
                  step="100"
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                  className="tabular-nums"
                />
                <p className="text-xs text-muted-foreground">
                  {t("payment.balance", { amount: formatDZD(invoice.balance, locale) })}
                </p>
              </div>

              <div className="grid gap-1.5">
                <Label>{t("payment.method")}</Label>
                <RadioGroup
                  value={method}
                  onValueChange={(v) => setMethod(v as Method)}
                  className="grid grid-cols-2 gap-2 sm:grid-cols-3"
                >
                  {PAYMENT_METHODS.map((m) => {
                    const Icon = METHOD_ICON[m];
                    return (
                      <Label
                        key={m}
                        className="flex cursor-pointer items-center gap-2 rounded-lg border p-3 text-sm font-medium transition-colors hover:bg-muted/50 has-data-checked:border-primary has-data-checked:bg-primary/5 has-data-[state=checked]:border-primary has-data-[state=checked]:bg-primary/5"
                      >
                        <RadioGroupItem value={m} />
                        <Icon className="size-4 text-muted-foreground" />
                        <span>{t(`methods.${m}`)}</span>
                      </Label>
                    );
                  })}
                </RadioGroup>
              </div>

              <div className="grid gap-3 sm:grid-cols-2">
                <div className="grid gap-1.5">
                  <Label htmlFor={`pay-ref-${invoice.id}`}>{t("payment.reference")}</Label>
                  <Input
                    id={`pay-ref-${invoice.id}`}
                    value={reference}
                    onChange={(e) => setReference(e.target.value)}
                    placeholder={t("payment.referencePlaceholder")}
                  />
                </div>
                <div className="grid gap-1.5">
                  <Label htmlFor={`pay-note-${invoice.id}`}>{t("payment.note")}</Label>
                  <Textarea
                    id={`pay-note-${invoice.id}`}
                    value={note}
                    onChange={(e) => setNote(e.target.value)}
                    rows={1}
                  />
                </div>
              </div>
            </div>

            <DialogFooter>
              <Button variant="outline" onClick={() => setOpen(false)} disabled={pending}>
                {tc("actions.cancel")}
              </Button>
              <Button onClick={submit} disabled={!canSubmit}>
                {t("payment.submit")}
              </Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
