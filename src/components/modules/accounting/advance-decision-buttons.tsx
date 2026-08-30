"use client";

import { useState, useTransition } from "react";
import { Check, X } from "lucide-react";
import { useTranslations } from "next-intl";
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
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { approveAdvance, rejectAdvance } from "./actions";

/**
 * Decide a pending advance request.
 *
 * Approving is a money action — it books the expense the moment it lands — so it
 * goes behind a confirmation that says the amount and the name out loud.
 * Rejecting moves nothing, but it is the answer the employee reads on their
 * phone, so it offers a note to say why.
 */
export function AdvanceDecisionButtons({
  advanceId,
  memberName,
  amountLabel,
}: {
  advanceId: string;
  memberName: string;
  /** Already formatted with `formatDZD` by the server component. */
  amountLabel: string;
}) {
  const t = useTranslations("accounting");
  const tc = useTranslations("common");
  const [pending, startTransition] = useTransition();
  const [rejectOpen, setRejectOpen] = useState(false);
  const [note, setNote] = useState("");

  function approve() {
    startTransition(async () => {
      const res = await approveAdvance({ id: advanceId });
      if (res.ok) toast.success(t("advances.decisionSaved"));
      else toast.error(t(`errors.${res.error}`));
    });
  }

  function openReject() {
    setNote("");
    setRejectOpen(true);
  }

  function reject() {
    startTransition(async () => {
      const res = await rejectAdvance({ id: advanceId, note: note.trim() || undefined });
      if (res.ok) {
        toast.success(t("advances.decisionSaved"));
        setRejectOpen(false);
      } else {
        toast.error(t(`errors.${res.error}`));
      }
    });
  }

  return (
    <div className="flex items-center gap-2">
      <Button variant="outline" size="sm" disabled={pending} onClick={openReject}>
        <X data-icon="inline-start" />
        {t("advances.reject")}
      </Button>

      <AlertDialog>
        <AlertDialogTrigger asChild>
          <Button size="sm" disabled={pending}>
            <Check data-icon="inline-start" />
            {t("advances.approve")}
          </Button>
        </AlertDialogTrigger>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("advances.approveTitle")}</AlertDialogTitle>
            <AlertDialogDescription>
              {t("advances.approveDesc", { amount: amountLabel, name: memberName })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{tc("actions.cancel")}</AlertDialogCancel>
            <AlertDialogAction disabled={pending} onClick={approve}>
              {t("advances.approve")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* A plain Dialog, not an AlertDialog: the note is a field, and an alert
          dialog traps focus around its two buttons. */}
      <Dialog open={rejectOpen} onOpenChange={setRejectOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{t("advances.rejectTitle")}</DialogTitle>
            <DialogDescription>{t("advances.rejectDesc")}</DialogDescription>
          </DialogHeader>

          <div className="grid gap-2">
            <Label htmlFor={`adv-reject-note-${advanceId}`}>
              {t("advances.decisionNote")}{" "}
              <span className="font-normal text-muted-foreground">({tc("labels.optional")})</span>
            </Label>
            <Textarea
              id={`adv-reject-note-${advanceId}`}
              rows={2}
              maxLength={300}
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder={t("advances.decisionNotePlaceholder")}
            />
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setRejectOpen(false)}>
              {tc("actions.cancel")}
            </Button>
            {/* Not `destructive`: the description promises no money moves and the
                employee can ask again. Red here would contradict the copy, and the
                page spends its one warm accent on money that is actually out. */}
            <Button disabled={pending} onClick={reject}>
              {t("advances.reject")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
