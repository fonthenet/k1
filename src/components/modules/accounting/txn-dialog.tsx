"use client";

import { useState, useTransition } from "react";
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { DatePicker } from "@/components/shared/date-picker";
import type { PaymentMethod, TxnKind } from "@/lib/types";
import { saveTransaction } from "./actions";
import { PAYMENT_METHODS, isoDate, type LedgerRow } from "./types";

const NONE = "none";

/** Add or edit a ledger entry. `kind` is fixed per dialog; pass `txn` to edit. */
export function TxnDialog({
  kind,
  categories,
  txn,
  trigger,
}: {
  kind: TxnKind;
  categories: { id: string; name: string; color: string }[];
  txn?: LedgerRow;
  trigger: React.ReactNode;
}) {
  const t = useTranslations("accounting");
  const tc = useTranslations("common");
  const [open, setOpen] = useState(false);
  const [amount, setAmount] = useState("");
  const [categoryId, setCategoryId] = useState<string>(NONE);
  const [date, setDate] = useState("");
  const [method, setMethod] = useState<PaymentMethod>("cash");
  const [description, setDescription] = useState("");
  const [reference, setReference] = useState("");
  const [pending, startTransition] = useTransition();

  function onOpenChange(next: boolean) {
    setOpen(next);
    if (next) {
      setAmount(txn ? String(txn.amount) : "");
      setCategoryId(txn?.category?.id ?? NONE);
      setDate(txn?.date ?? isoDate(new Date()));
      setMethod(txn?.method ?? "cash");
      setDescription(txn?.description ?? "");
      setReference(txn?.reference ?? "");
    }
  }

  const parsedAmount = Number(amount);
  const valid =
    Number.isFinite(parsedAmount) && parsedAmount > 0 && description.trim().length > 0 && date;

  function submit() {
    if (!valid) return;
    startTransition(async () => {
      const res = await saveTransaction({
        id: txn?.id,
        kind,
        categoryId: categoryId === NONE ? null : categoryId,
        amount: parsedAmount,
        date,
        method,
        description: description.trim(),
        reference: reference.trim() || undefined,
      });
      if (res.ok) {
        toast.success(t(txn ? "txn.updated" : "txn.added"));
        setOpen(false);
      } else {
        toast.error(t(`errors.${res.error}`));
      }
    });
  }

  const title = txn ? t("txn.editTitle") : t(kind === "expense" ? "txn.addExpense" : "txn.addIncome");

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>
            {t(kind === "expense" ? "txn.expenseDesc" : "txn.incomeDesc")}
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="grid gap-2">
              <Label htmlFor="txn-amount">{t("txn.amount")}</Label>
              <Input
                id="txn-amount"
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
              <Label htmlFor="txn-date">{t("txn.date")}</Label>
              <DatePicker id="txn-date" value={date} onChange={setDate} />
            </div>
          </div>

          <div className="grid gap-2">
            <Label htmlFor="txn-description">{t("txn.description")}</Label>
            <Input
              id="txn-description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder={t("txn.descriptionPlaceholder")}
            />
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="grid gap-2">
              <Label>{t("txn.category")}</Label>
              <Select value={categoryId} onValueChange={setCategoryId}>
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={NONE}>
                    <span className="text-muted-foreground">{t("txn.noCategory")}</span>
                  </SelectItem>
                  {categories.map((c) => (
                    <SelectItem key={c.id} value={c.id}>
                      <span className="flex items-center gap-2">
                        <span
                          className="size-2.5 rounded-full"
                          style={{ backgroundColor: c.color }}
                        />
                        {c.name}
                      </span>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-2">
              <Label>{t("txn.method")}</Label>
              <Select value={method} onValueChange={(v) => setMethod(v as PaymentMethod)}>
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {PAYMENT_METHODS.map((m) => (
                    <SelectItem key={m} value={m}>
                      {t(`methods.${m}`)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="grid gap-2">
            <Label htmlFor="txn-reference">
              {t("txn.reference")}{" "}
              <span className="font-normal text-muted-foreground">({tc("labels.optional")})</span>
            </Label>
            <Input
              id="txn-reference"
              value={reference}
              onChange={(e) => setReference(e.target.value)}
              placeholder={t("txn.referencePlaceholder")}
            />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)}>
            {tc("actions.cancel")}
          </Button>
          <Button onClick={submit} disabled={pending || !valid}>
            {tc("actions.save")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
