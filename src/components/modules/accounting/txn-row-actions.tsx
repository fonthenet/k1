"use client";

import { Pencil } from "lucide-react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { TxnDialog } from "./txn-dialog";
import type { Structure } from "@/components/modules/classes/class-types";
import type { CategoryOption, LedgerRow } from "./types";

/**
 * The one control on an editable ledger row: a ghost pencil that opens the
 * entry for editing. Deleting is inside that dialog's footer, so the row
 * itself carries nothing red.
 */
export function TxnRowActions({
  txn,
  categories,
  structures = [],
}: {
  txn: LedgerRow;
  categories: { income: CategoryOption[]; expense: CategoryOption[] };
  structures?: Structure[];
}) {
  const tc = useTranslations("common");

  return (
    <TxnDialog
      kind={txn.kind}
      categories={categories}
      structures={structures}
      txn={txn}
      trigger={
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label={tc("actions.edit")}
          title={tc("actions.edit")}
        >
          <Pencil />
        </Button>
      }
    />
  );
}
