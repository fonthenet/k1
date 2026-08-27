"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { updateProgramStatus } from "./actions";
import { PROGRAM_STATUSES, type ProgramStatus } from "./session-types";

/** Move a programme through active → paused → completed without leaving the page. */
export function ProgramStatusSelect({
  programId,
  status,
}: {
  programId: string;
  status: ProgramStatus;
}) {
  const t = useTranslations("sessions");
  const router = useRouter();
  const [value, setValue] = useState<ProgramStatus>(status);
  const [pending, startTransition] = useTransition();

  function change(next: string) {
    const previous = value;
    setValue(next as ProgramStatus);
    startTransition(async () => {
      const res = await updateProgramStatus(programId, next);
      if (res.ok) {
        toast.success(t("toasts.statusSaved"));
        router.refresh();
      } else {
        setValue(previous);
        toast.error(t("toasts.error"));
      }
    });
  }

  return (
    <Select value={value} onValueChange={change} disabled={pending}>
      <SelectTrigger className="w-44" aria-label={t("programDetail.statusLabel")}>
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {PROGRAM_STATUSES.map((s) => (
          <SelectItem key={s} value={s}>
            {t(`programStatus.${s}`)}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
