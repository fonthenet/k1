"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import { Plus, Trash2 } from "lucide-react";
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
import { childDisplayName, formatDZD } from "@/lib/format";
import { createManualInvoice } from "./actions";
import { ITEM_KINDS } from "./maps";
import type { ChildOption } from "./billing-types";

type ItemKind = (typeof ITEM_KINDS)[number];

interface ItemRow {
  kind: ItemKind;
  description: string;
  qty: string;
  unit: string;
}

const EMPTY_ITEM: ItemRow = { kind: "tuition", description: "", qty: "1", unit: "" };

function lineTotal(it: ItemRow): number {
  const qty = Number(it.qty);
  const unit = Number(it.unit);
  if (!Number.isFinite(qty) || !Number.isFinite(unit)) return 0;
  return Math.round(qty * unit * 100) / 100;
}

/** Manual invoice dialog: child select + line-item repeater + due date. */
export function NewInvoiceDialog({ childOptions }: { childOptions: ChildOption[] }) {
  const t = useTranslations("billing");
  const tc = useTranslations("common");
  const locale = useLocale();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [childId, setChildId] = useState("");
  const [dueDate, setDueDate] = useState("");
  const [items, setItems] = useState<ItemRow[]>([{ ...EMPTY_ITEM }]);
  const [pending, startTransition] = useTransition();

  const total = items.reduce((sum, it) => sum + lineTotal(it), 0);
  const itemsValid =
    items.length > 0 &&
    items.every((it) => it.description.trim() && Number(it.qty) > 0 && Number(it.unit) >= 0);
  const canSubmit = Boolean(childId && dueDate && itemsValid && !pending);

  function patchItem(index: number, patch: Partial<ItemRow>) {
    setItems((rows) => rows.map((r, i) => (i === index ? { ...r, ...patch } : r)));
  }

  function reset() {
    setChildId("");
    setDueDate("");
    setItems([{ ...EMPTY_ITEM }]);
  }

  function submit() {
    if (!canSubmit) return;
    startTransition(async () => {
      const res = await createManualInvoice({
        childId,
        dueDate,
        notes: undefined,
        items: items.map((it) => ({
          kind: it.kind,
          description: it.description.trim(),
          qty: Number(it.qty),
          unit: Number(it.unit),
        })),
      });
      if (res.ok) {
        toast.success(t("newInvoice.success"));
        setOpen(false);
        reset();
        if (res.id) router.push(`/billing/invoices/${res.id}`);
        else router.refresh();
      } else {
        toast.error(t("toasts.error"));
      }
    });
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline">
          <Plus data-icon="inline-start" />
          {t("newInvoice.button")}
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{t("newInvoice.title")}</DialogTitle>
          <DialogDescription>{t("newInvoice.description")}</DialogDescription>
        </DialogHeader>

        <div className="grid gap-4">
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="grid gap-1.5">
              <Label>{t("newInvoice.child")}</Label>
              <Select value={childId} onValueChange={setChildId}>
                <SelectTrigger>
                  <SelectValue placeholder={t("newInvoice.childPlaceholder")} />
                </SelectTrigger>
                <SelectContent>
                  {childOptions.map((c) => (
                    <SelectItem key={c.id} value={c.id}>
                      {childDisplayName(c, locale)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="inv-due">{t("newInvoice.dueDate")}</Label>
              <DatePicker id="inv-due" value={dueDate} onChange={setDueDate} />
            </div>
          </div>

          <div className="grid gap-2">
            <Label>{t("newInvoice.items")}</Label>
            {items.map((it, i) => (
              <div key={i} className="grid grid-cols-[1fr_1.6fr_4rem_6rem_auto] items-center gap-2">
                <Select value={it.kind} onValueChange={(v) => patchItem(i, { kind: v as ItemKind })}>
                  <SelectTrigger aria-label={t("newInvoice.itemKind")}>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {ITEM_KINDS.map((k) => (
                      <SelectItem key={k} value={k}>
                        {t(`kinds.${k}`)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Input
                  value={it.description}
                  onChange={(e) => patchItem(i, { description: e.target.value })}
                  placeholder={t("newInvoice.itemDescription")}
                  aria-label={t("newInvoice.itemDescription")}
                />
                <Input
                  type="number"
                  min="1"
                  value={it.qty}
                  onChange={(e) => patchItem(i, { qty: e.target.value })}
                  className="tabular-nums"
                  aria-label={t("newInvoice.itemQty")}
                />
                <Input
                  type="number"
                  min="0"
                  step="100"
                  value={it.unit}
                  onChange={(e) => patchItem(i, { unit: e.target.value })}
                  placeholder={t("newInvoice.itemUnit")}
                  className="tabular-nums"
                  aria-label={t("newInvoice.itemUnit")}
                />
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={() => setItems((rows) => rows.filter((_, j) => j !== i))}
                  disabled={items.length === 1}
                  aria-label={t("newInvoice.removeItem")}
                >
                  <Trash2 />
                </Button>
              </div>
            ))}
            <div className="flex items-center justify-between">
              <Button
                variant="outline"
                size="sm"
                onClick={() => setItems((rows) => [...rows, { ...EMPTY_ITEM }])}
              >
                <Plus data-icon="inline-start" />
                {t("newInvoice.addItem")}
              </Button>
              <div className="text-sm">
                {tc("labels.total")}:{" "}
                <span className="font-semibold tabular-nums">{formatDZD(total, locale)}</span>
              </div>
            </div>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)} disabled={pending}>
            {tc("actions.cancel")}
          </Button>
          <Button onClick={submit} disabled={!canSubmit}>
            {t("newInvoice.submit")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
