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
import { Plus, X } from "lucide-react";
import type { PaymentMethod, TxnKind } from "@/lib/types";
import { saveTransaction } from "./actions";
import { PAYMENT_METHODS, isoDate, type LedgerRow } from "./types";

const NONE = "none";

/** A line being typed. Strings, because a half-typed number is not a number. */
interface ItemDraft {
  name: string;
  qty: string;
  unit: string;
}

const blankItem = (): ItemDraft => ({ name: "", qty: "1", unit: "" });

const lineTotal = (i: ItemDraft) => {
  const q = Number(i.qty.replace(",", "."));
  const u = Number(i.unit.replace(",", "."));
  return Number.isFinite(q) && Number.isFinite(u) ? q * u : 0;
};

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
  const [items, setItems] = useState<ItemDraft[]>([]);
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
      setItems(
        (txn?.items ?? []).map((i) => ({
          name: i.name,
          qty: String(i.qty),
          unit: String(i.unit_amount),
        }))
      );
    }
  }

  const parsedAmount = Number(amount);
  // Itemised or not — never both. When there are lines, they own the total, so
  // the amount box is replaced by their sum rather than left to disagree.
  const filled = items.filter((i) => i.name.trim().length > 0);
  const itemised = filled.length > 0;
  const itemsTotal = filled.reduce((n, i) => n + lineTotal(i), 0);
  const valid =
    description.trim().length > 0 &&
    Boolean(date) &&
    (itemised
      ? filled.every((i) => lineTotal(i) >= 0 && Number(i.qty.replace(",", ".")) > 0)
      : Number.isFinite(parsedAmount) && parsedAmount > 0);

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
        items: itemised
          ? filled.map((i) => ({
              name: i.name.trim(),
              qty: Number(i.qty.replace(",", ".")),
              unitAmount: Number(i.unit.replace(",", ".")),
            }))
          : [],
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
              <Label htmlFor="txn-amount">
                {itemised ? t("txn.items.total") : t("txn.amount")}
              </Label>
              {itemised ? (
                <output
                  className="flex h-9 items-center rounded-md border border-input bg-muted/40 px-3 text-sm font-semibold tabular-nums"
                  dir="ltr"
                >
                  {itemsTotal.toLocaleString("fr-DZ", { maximumFractionDigits: 2 })}
                </output>
              ) : (
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
              )}
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

          {/* The shopping list. Optional on purpose: an electricity bill is one
              number and forcing it into a line item is ceremony. */}
          <div className="grid gap-2 rounded-lg border p-3">
            <div className="flex items-center justify-between gap-2">
              <Label>{t("txn.items.title")}</Label>
              <Button
                type="button"
                size="sm"
                variant="ghost"
                onClick={() => setItems((prev) => [...prev, blankItem()])}
              >
                <Plus className="size-4" />
                {t("txn.items.add")}
              </Button>
            </div>

            {items.length === 0 ? (
              <p className="text-sm text-muted-foreground">{t("txn.items.hint")}</p>
            ) : (
              <div className="grid gap-2">
                {items.map((item, i) => (
                  <div key={i} className="flex items-end gap-2">
                    <div className="grid flex-[3] gap-1">
                      {i === 0 ? (
                        <Label className="text-xs font-normal text-muted-foreground">
                          {t("txn.items.name")}
                        </Label>
                      ) : null}
                      <Input
                        value={item.name}
                        placeholder={t("txn.items.namePlaceholder")}
                        onChange={(e) =>
                          setItems((prev) =>
                            prev.map((x, n) => (n === i ? { ...x, name: e.target.value } : x))
                          )
                        }
                      />
                    </div>
                    <div className="grid flex-1 gap-1">
                      {i === 0 ? (
                        <Label className="text-xs font-normal text-muted-foreground">
                          {t("txn.items.qty")}
                        </Label>
                      ) : null}
                      <Input
                        dir="ltr"
                        inputMode="decimal"
                        className="tabular-nums"
                        value={item.qty}
                        onChange={(e) =>
                          setItems((prev) =>
                            prev.map((x, n) => (n === i ? { ...x, qty: e.target.value } : x))
                          )
                        }
                      />
                    </div>
                    <div className="grid flex-[1.4] gap-1">
                      {i === 0 ? (
                        <Label className="text-xs font-normal text-muted-foreground">
                          {t("txn.items.unit")}
                        </Label>
                      ) : null}
                      <Input
                        dir="ltr"
                        inputMode="decimal"
                        className="tabular-nums"
                        value={item.unit}
                        onChange={(e) =>
                          setItems((prev) =>
                            prev.map((x, n) => (n === i ? { ...x, unit: e.target.value } : x))
                          )
                        }
                      />
                    </div>
                    <Button
                      type="button"
                      size="icon"
                      variant="ghost"
                      aria-label={t("txn.items.remove")}
                      onClick={() => setItems((prev) => prev.filter((_, n) => n !== i))}
                    >
                      <X className="size-4" />
                    </Button>
                  </div>
                ))}
              </div>
            )}
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
