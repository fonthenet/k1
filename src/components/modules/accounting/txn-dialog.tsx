"use client";

import { useState, useTransition } from "react";
import { useLocale, useTranslations } from "next-intl";
import { structureName, type Structure } from "@/components/modules/classes/class-types";
import { centerTypeOption } from "@/components/modules/settings/center-types";
import { toast } from "sonner";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
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
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { DatePicker } from "@/components/shared/date-picker";
import { Plus, X } from "lucide-react";
import { formatDZD } from "@/lib/format";
import type { PaymentMethod, TxnKind } from "@/lib/types";
import { deleteTransaction, saveTransaction } from "./actions";
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

type CategoryChoice = { id: string; name: string; color: string };

/**
 * Add or edit a ledger entry. Pass `txn` to edit.
 *
 * One dialog for both kinds. A new entry starts on `kind` and the first row
 * is a Recette | Dépense track, so the page needs one primary rather than an
 * income button beside an expense button. An existing entry keeps the kind
 * it was written with — the track is not drawn — because a receipt turned
 * into a bill is a different transaction, not an edit of this one.
 */
export function TxnDialog({
  kind: initialKind,
  categories,
  txn,
  trigger,
  structures = [],
  defaultStructureId = null,
}: {
  /** The kind to open on; fixed when editing. */
  kind: TxnKind;
  /** Both lists, because the track swaps between them. */
  categories: { income: CategoryChoice[]; expense: CategoryChoice[] };
  txn?: LedgerRow;
  trigger: React.ReactNode;
  /** The building's active structures; the picker hides itself under two. */
  structures?: Structure[];
  /**
   * Pre-filled for a NEW entry: the structure the rail is reading, if any.
   * A default, not a restriction — the picker is right there — and a director
   * who has narrowed the rail to the école is entering the école's bills.
   */
  defaultStructureId?: string | null;
}) {
  const t = useTranslations("accounting");
  const tc = useTranslations("common");
  const locale = useLocale();
  const [open, setOpen] = useState(false);
  const [kind, setKind] = useState<TxnKind>(txn?.kind ?? initialKind);
  const [structureId, setStructureId] = useState<string>(NONE);
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
      setKind(txn?.kind ?? initialKind);
      setAmount(txn ? String(txn.amount) : "");
      setCategoryId(txn?.category?.id ?? NONE);
      setDate(txn?.date ?? isoDate(new Date()));
      setMethod(txn?.method ?? "cash");
      setStructureId(txn ? (txn.structure_id ?? NONE) : (defaultStructureId ?? NONE));
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

  const kindCategories = categories[kind];

  // Switching the kind drops a category chosen under the other one: an
  // "Alimentation" bill cannot be a receipt, and leaving it selected would
  // save a pairing the categories page never offers.
  function switchKind(next: TxnKind) {
    setKind(next);
    if (categoryId !== NONE && !categories[next].some((c) => c.id === categoryId)) {
      setCategoryId(NONE);
    }
  }

  // Deleting lives here, in the footer of the entry being edited, rather than
  // as a trash icon in every row: the row is for reading the ledger, and the
  // one destructive action belongs next to the record it destroys.
  function remove() {
    if (!txn) return;
    startTransition(async () => {
      const res = await deleteTransaction(txn.id);
      if (res.ok) {
        toast.success(t("txn.deleted"));
        setOpen(false);
      } else {
        toast.error(t(`errors.${res.error}`));
      }
    });
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
        // Only sent when the building has structures to choose from, so an
        // ordinary crèche never writes the column at all.
        structureId: structures.length > 1 ? (structureId === NONE ? null : structureId) : undefined,
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

  const title = txn ? t("txn.editTitle") : t("txn.add");

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
          {!txn && (
            <Tabs value={kind} onValueChange={(v) => switchKind(v as TxnKind)}>
              <TabsList className="w-full" aria-label={t("txn.filters.kind")}>
                <TabsTrigger value="income">{t("kinds.income")}</TabsTrigger>
                <TabsTrigger value="expense">{t("kinds.expense")}</TabsTrigger>
              </TabsList>
            </Tabs>
          )}

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
                  {kindCategories.map((c) => (
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

          {/* Whose money it is. Income linked to a child's payment already knows
              (the trigger reads the child's structure); a bill typed in here
              has nobody to ask, so it asks the office. The whole building is a
              real answer — the rent — not a missing one. */}
          {structures.length > 1 && (
            <div className="grid gap-2">
              <Label>{t("txn.structure")}</Label>
              <Select value={structureId} onValueChange={setStructureId}>
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={NONE}>{t("txn.structureAll")}</SelectItem>
                  {structures.map((s) => {
                    const { Icon } = centerTypeOption(s.center_type);
                    return (
                      <SelectItem key={s.id} value={s.id}>
                        <Icon className="size-4" style={{ color: s.color }} aria-hidden />
                        {structureName(s, locale)}
                      </SelectItem>
                    );
                  })}
                </SelectContent>
              </Select>
              <p className="text-xs text-pretty text-muted-foreground">{t("txn.structureHint")}</p>
            </div>
          )}

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
          {txn && (
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button
                  type="button"
                  variant="ghost"
                  disabled={pending}
                  className="text-destructive hover:text-destructive sm:me-auto"
                >
                  {tc("actions.delete")}
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>{t("txn.deleteTitle")}</AlertDialogTitle>
                  <AlertDialogDescription>
                    {t("txn.deleteDesc", {
                      description: txn.description,
                      amount: formatDZD(txn.amount, locale),
                    })}
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
          )}
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
