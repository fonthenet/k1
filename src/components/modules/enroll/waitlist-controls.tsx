"use client";

// Waitlist ranking. The lane is renumbered 1…n server-side on every move, so
// the arrows stay honest even if positions were never set.

import { useTransition } from "react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { ArrowDown, ArrowUp } from "lucide-react";
import { Button } from "@/components/ui/button";
import { reorderWaitlist } from "@/app/(dashboard)/applications/actions";

export function WaitlistControls({
  appId,
  isFirst,
  isLast,
}: {
  appId: string;
  isFirst: boolean;
  isLast: boolean;
}) {
  const t = useTranslations("enroll");
  const [pending, startTransition] = useTransition();

  function move(direction: "up" | "down") {
    startTransition(async () => {
      const res = await reorderWaitlist({ appId, direction });
      if (res.error) toast.error(t("reviewActions.error"));
      else toast.success(t("pipeline.waitlistMoved"));
    });
  }

  return (
    <div className="flex shrink-0 items-center gap-0.5">
      <Button
        variant="ghost"
        size="icon-sm"
        disabled={pending || isFirst}
        onClick={() => move("up")}
        aria-label={t("pipeline.moveUp")}
        title={t("pipeline.moveUp")}
        className="text-muted-foreground"
      >
        <ArrowUp />
      </Button>
      <Button
        variant="ghost"
        size="icon-sm"
        disabled={pending || isLast}
        onClick={() => move("down")}
        aria-label={t("pipeline.moveDown")}
        title={t("pipeline.moveDown")}
        className="text-muted-foreground"
      >
        <ArrowDown />
      </Button>
    </div>
  );
}
