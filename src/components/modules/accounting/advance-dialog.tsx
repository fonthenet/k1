"use client";

import { useState, useTransition } from "react";
import { Plus } from "lucide-react";
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
import { Textarea } from "@/components/ui/textarea";
import { DatePicker } from "@/components/shared/date-picker";
import { addAdvance } from "./actions";
import { isoDate, type MemberOption } from "./types";

/** Grant a salary advance to a staff member. */
export function AdvanceDialog({ members }: { members: MemberOption[] }) {
  const t = useTranslations("accounting");
  const tc = useTranslations("common");
  const [open, setOpen] = useState(false);
  const [membershipId, setMembershipId] = useState("");
  const [amount, setAmount] = useState("");
  const [date, setDate] = useState("");
  const [note, setNote] = useState("");
  const [pending, startTransition] = useTransition();

  function onOpenChange(next: boolean) {
    setOpen(next);
    if (next) {
      setMembershipId("");
      setAmount("");
      setDate(isoDate(new Date()));
      setNote("");
    }
  }

  const parsedAmount = Number(amount);
  const valid = membershipId && Number.isFinite(parsedAmount) && parsedAmount > 0 && date;

  function submit() {
    if (!valid) return;
    startTransition(async () => {
      const res = await addAdvance({
        membershipId,
        amount: parsedAmount,
        date,
        note: note.trim() || undefined,
      });
      if (res.ok) {
        toast.success(t("advances.added"));
        setOpen(false);
      } else {
        toast.error(t(`errors.${res.error}`));
      }
    });
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogTrigger asChild>
        <Button>
          <Plus data-icon="inline-start" />
          {t("advances.add")}
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{t("advances.addTitle")}</DialogTitle>
          <DialogDescription>{t("advances.addDesc")}</DialogDescription>
        </DialogHeader>

        <div className="grid gap-4">
          <div className="grid gap-2">
            <Label>{t("advances.member")}</Label>
            <Select value={membershipId} onValueChange={setMembershipId}>
              <SelectTrigger className="w-full">
                <SelectValue placeholder={t("advances.memberPlaceholder")}>
                  {members.find((m) => m.id === membershipId)?.name}
                </SelectValue>
              </SelectTrigger>
              <SelectContent>
                {members.map((m) => (
                  <SelectItem key={m.id} value={m.id}>
                    <div className="flex flex-col items-start gap-0.5 text-start">
                      <span>{m.name}</span>
                      {m.jobTitle && (
                        <span className="text-xs text-muted-foreground">{m.jobTitle}</span>
                      )}
                    </div>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="grid gap-2">
              <Label htmlFor="adv-amount">{t("advances.amount")}</Label>
              <Input
                id="adv-amount"
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
              <Label htmlFor="adv-date">{t("advances.date")}</Label>
              <DatePicker id="adv-date" value={date} onChange={setDate} />
            </div>
          </div>

          <div className="grid gap-2">
            <Label htmlFor="adv-note">
              {t("advances.note")}{" "}
              <span className="font-normal text-muted-foreground">({tc("labels.optional")})</span>
            </Label>
            <Textarea
              id="adv-note"
              rows={2}
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder={t("advances.notePlaceholder")}
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
