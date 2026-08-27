"use client";

import { useTransition } from "react";
import { Pencil, Trash2 } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
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
import { formatDZD } from "@/lib/format";
import { deleteTransaction } from "./actions";
import { TxnDialog } from "./txn-dialog";
import type { LedgerRow } from "./types";

/** Edit + delete controls for an editable ledger row (admin, current month). */
export function TxnRowActions({
  txn,
  categories,
}: {
  txn: LedgerRow;
  categories: { id: string; name: string; color: string }[];
}) {
  const t = useTranslations("accounting");
  const tc = useTranslations("common");
  const locale = useLocale();
  const [pending, startTransition] = useTransition();

  function remove() {
    startTransition(async () => {
      const res = await deleteTransaction(txn.id);
      if (res.ok) toast.success(t("txn.deleted"));
      else toast.error(t(`errors.${res.error}`));
    });
  }

  return (
    <div className="flex items-center justify-end gap-1">
      <TxnDialog
        kind={txn.kind}
        categories={categories}
        txn={txn}
        trigger={
          <Button variant="ghost" size="icon-sm" aria-label={tc("actions.edit")}>
            <Pencil />
          </Button>
        }
      />
      <AlertDialog>
        <AlertDialogTrigger asChild>
          <Button
            variant="ghost"
            size="icon-sm"
            className="text-muted-foreground hover:text-destructive"
            aria-label={tc("actions.delete")}
          >
            <Trash2 />
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
    </div>
  );
}
