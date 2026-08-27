"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { UserPlus } from "lucide-react";
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
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { addActivityEnrollment } from "./actions";
import type { EnrollCandidate } from "./class-types";

/** Enroll a child in an activity (re-activates an ended/cancelled enrollment). */
export function AddEnrollmentDialog({
  activityId,
  candidates,
}: {
  activityId: string;
  candidates: EnrollCandidate[];
}) {
  const t = useTranslations("activities");
  const tc = useTranslations("common");
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [childId, setChildId] = useState("");
  const [pending, startTransition] = useTransition();

  function submit() {
    if (!childId || pending) return;
    startTransition(async () => {
      const res = await addActivityEnrollment(activityId, childId);
      if (res.ok) {
        toast.success(t("toasts.enrolled"));
        setOpen(false);
        setChildId("");
        router.refresh();
      } else {
        toast.error(res.error === "forbidden" ? t("toasts.forbidden") : t("toasts.error"));
      }
    });
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button>
          <UserPlus data-icon="inline-start" />
          {t("detail.enrollments.addChild")}
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>{t("addDialog.title")}</DialogTitle>
          <DialogDescription>{t("addDialog.description")}</DialogDescription>
        </DialogHeader>
        {candidates.length === 0 ? (
          <p className="py-4 text-center text-sm text-muted-foreground">
            {t("addDialog.noneAvailable")}
          </p>
        ) : (
          <div className="grid gap-1.5">
            <Label>{t("addDialog.selectChild")}</Label>
            <Select value={childId} onValueChange={setChildId}>
              <SelectTrigger>
                <SelectValue placeholder={t("addDialog.placeholder")} />
              </SelectTrigger>
              <SelectContent>
                {candidates.map((c) => (
                  <SelectItem key={c.id} value={c.id}>
                    {c.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)} disabled={pending}>
            {tc("actions.cancel")}
          </Button>
          <Button onClick={submit} disabled={!childId || pending}>
            {t("addDialog.submit")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
