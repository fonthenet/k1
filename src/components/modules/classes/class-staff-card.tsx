"use client";

import Link from "next/link";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Star, UserRoundPlus, X } from "lucide-react";
import { toast } from "sonner";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { initialsFromName } from "@/lib/format";
import { cn } from "@/lib/utils";
import { addClassStaff, removeClassStaff, setMainClassStaff } from "./actions";
import type { AssignedStaff, StaffOption } from "./class-types";

/** Staff assignment card for a class: list, add, remove, mark main educator. */
export function ClassStaffCard({
  classId,
  assigned,
  available,
  canManage,
}: {
  classId: string;
  assigned: AssignedStaff[];
  available: StaffOption[];
  canManage: boolean;
}) {
  const t = useTranslations("classes");
  const router = useRouter();
  const [picked, setPicked] = useState("");
  const [pending, startTransition] = useTransition();

  function run(fn: () => Promise<{ ok: boolean }>, successMsg: string) {
    startTransition(async () => {
      const res = await fn();
      if (res.ok) {
        toast.success(successMsg);
        router.refresh();
      } else {
        toast.error(t("toasts.error"));
      }
    });
  }

  function add() {
    if (!picked) return;
    const membershipId = picked;
    setPicked("");
    run(
      () => addClassStaff(classId, membershipId, assigned.length === 0),
      t("toasts.staffAdded")
    );
  }

  return (
    <Card className="shadow-sm">
      <CardHeader>
        <CardTitle className="flex items-center gap-2.5 text-base">
          <span className="flex size-8 items-center justify-center rounded-lg bg-primary/10 text-primary">
            <UserRoundPlus className="size-4" />
          </span>
          {t("detail.staff.title")}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {assigned.length === 0 && (
          <div className="flex flex-col items-center gap-2 py-4 text-center">
            <span className="flex size-11 items-center justify-center rounded-2xl bg-muted text-muted-foreground">
              <UserRoundPlus className="size-5" />
            </span>
            <p className="text-sm text-muted-foreground">{t("detail.staff.empty")}</p>
          </div>
        )}
        {assigned.map((s) => (
          <div
            key={s.membershipId}
            className={cn(
              "flex flex-wrap items-center gap-x-3 gap-y-1.5 rounded-xl border p-2.5 transition-colors",
              s.isMain ? "border-gold/40 bg-gold/5" : "border-transparent hover:bg-muted/40"
            )}
          >
            <Avatar className="size-9 ring-1 ring-border">
              <AvatarFallback className="bg-primary/10 text-xs font-semibold text-primary">
                {initialsFromName(s.name) || "?"}
              </AvatarFallback>
            </Avatar>
            <div className="min-w-0 flex-1 basis-24">
              {/* The badge is shrink-0 and the name wraps instead of truncating:
                  a staff member squeezed to "Nadia B…" so a label can sit beside
                  them is the wrong thing to sacrifice. */}
              <div className="flex flex-wrap items-center gap-x-1.5 gap-y-1">
                <Link
                  href={`/staff/${s.membershipId}`}
                  className="text-sm font-semibold text-pretty hover:underline"
                >
                  {s.name}
                </Link>
                {s.isMain && (
                  <Badge className="shrink-0 border-transparent bg-gold font-medium text-gold-foreground">
                    <Star aria-hidden />
                    {t("detail.staff.main")}
                  </Badge>
                )}
              </div>
              {s.subtitle && (
                <div className="truncate text-xs text-muted-foreground">{s.subtitle}</div>
              )}
            </div>
            {canManage && (
              <div className="flex items-center">
                {!s.isMain && (
                  <Button
                    variant="ghost"
                    size="icon"
                    className="size-7 text-muted-foreground hover:text-foreground"
                    aria-label={t("detail.staff.makeMain")}
                    title={t("detail.staff.makeMain")}
                    disabled={pending}
                    onClick={() =>
                      run(() => setMainClassStaff(classId, s.membershipId), t("toasts.mainSet"))
                    }
                  >
                    <Star />
                  </Button>
                )}
                <Button
                  variant="ghost"
                  size="icon"
                  className="size-7 text-muted-foreground hover:text-destructive"
                  aria-label={t("detail.staff.remove")}
                  title={t("detail.staff.remove")}
                  disabled={pending}
                  onClick={() =>
                    run(() => removeClassStaff(classId, s.membershipId), t("toasts.staffRemoved"))
                  }
                >
                  <X />
                </Button>
              </div>
            )}
          </div>
        ))}

        {canManage && (
          // Stacked, not side by side: this card sits in a one-third column and
          // Card is overflow-hidden, so a row that does not fit is not wrapped —
          // it is cut off. At sm and up there is room to sit them on one line.
          <div className="flex flex-col gap-2 pt-1 sm:flex-row sm:items-center">
            <Select value={picked} onValueChange={setPicked}>
              <SelectTrigger className="w-full min-w-0 sm:flex-1">
                <SelectValue placeholder={t("detail.staff.selectPlaceholder")} />
              </SelectTrigger>
              <SelectContent>
                {available.length === 0 ? (
                  <div className="px-2 py-1.5 text-sm text-muted-foreground">
                    {t("detail.staff.noneAvailable")}
                  </div>
                ) : (
                  available.map((s) => (
                    <SelectItem key={s.membershipId} value={s.membershipId}>
                      {s.name}
                    </SelectItem>
                  ))
                )}
              </SelectContent>
            </Select>
            <Button
              variant="outline"
              className="w-full shrink-0 sm:w-auto"
              onClick={add}
              disabled={!picked || pending}
            >
              <UserRoundPlus data-icon="inline-start" />
              {t("detail.staff.add")}
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
