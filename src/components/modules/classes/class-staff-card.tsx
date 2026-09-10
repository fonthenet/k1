"use client";

import Link from "next/link";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Star, UserRoundPlus, X } from "lucide-react";
import { toast } from "sonner";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardAction, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { initialsFromName } from "@/lib/format";
import { cn } from "@/lib/utils";
import { removeClassStaff, setMainClassStaff } from "./actions";
import { AssignStaffDialog, type AssignableStaff } from "./assign-staff-dialog";
import type { AssignedStaff } from "./class-types";

/**
 * The team on a class: who is on it, who leads it, and one button to change
 * both. The row buttons (star, remove) stay for the quick single change; the
 * dialog is for composing the team, and is the only place that shows where
 * each person already works.
 */
export function ClassStaffCard({
  classId,
  className,
  assigned,
  staff,
  canManage,
}: {
  classId: string;
  /** Locale-resolved class name, for the dialog title. */
  className: string;
  assigned: AssignedStaff[];
  /** Every active member, each with the other classes they are already on. */
  staff: AssignableStaff[];
  canManage: boolean;
}) {
  const t = useTranslations("classes");
  const router = useRouter();
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

  return (
    <Card className="shadow-sm">
      <CardHeader>
        <CardTitle className="flex items-center gap-2.5 text-base">
          <span className="flex size-8 items-center justify-center rounded-lg bg-primary/10 text-primary">
            <UserRoundPlus className="size-4" />
          </span>
          {t("detail.staff.title")}
        </CardTitle>
        {canManage && (
          // In the header, not under the list: this card is full width and
          // sits right under the class name, so the button is where the eye
          // lands — the old one was the last control on the page.
          <CardAction>
            <AssignStaffDialog
              classId={classId}
              className={className}
              staff={staff}
              assigned={assigned}
            />
          </CardAction>
        )}
      </CardHeader>
      <CardContent>
        {assigned.length === 0 && (
          <div className="flex flex-col items-center gap-2 py-4 text-center">
            <span className="flex size-11 items-center justify-center rounded-2xl bg-muted text-muted-foreground">
              <UserRoundPlus className="size-5" />
            </span>
            <p className="text-sm text-muted-foreground">{t("detail.staff.empty")}</p>
          </div>
        )}
        {/* One row per person, side by side once there is room: the card is
            as wide as the page now, and a single column of three people
            would leave most of it empty. */}
        <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
        {assigned.map((s) => (
          <div
            key={s.membershipId}
            className={cn(
              "flex flex-wrap items-center gap-x-3 gap-y-1.5 rounded-xl border p-2.5 transition-colors",
              s.isMain ? "border-gold/40 bg-gold/5" : "border-border hover:bg-muted/40"
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
                  dir="auto"
                  className="text-start text-sm font-semibold text-pretty hover:underline"
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
                <div dir="auto" className="truncate text-start text-xs text-muted-foreground">{s.subtitle}</div>
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
        </div>
      </CardContent>
    </Card>
  );
}
