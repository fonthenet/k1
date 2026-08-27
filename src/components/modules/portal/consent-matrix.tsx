"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import { Check, Minus, X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { formatDate } from "@/lib/format";
import { cn } from "@/lib/utils";
// Same three consent_type strings the staff dashboard reads and writes — one
// definition, so a parent's answer and the office's register can never diverge.
import { CONSENT_TYPES, type ConsentType } from "@/components/modules/children/types";
import { setConsent } from "./actions";

/** One row of kg_consents, as the child page hands it to the client. */
export interface PortalConsent {
  consent_type: ConsentType;
  granted: boolean | null;
  decided_at: string | null;
}

/**
 * The three answers, in the order they are offered. `null` = not yet answered.
 * `on` is the filled look of the chosen answer: the parent has to be able to
 * tell at a glance which one is on file, so selection carries weight and colour,
 * never colour alone.
 */
const ANSWERS = [
  {
    value: true,
    key: "granted",
    icon: Check,
    on: "bg-success text-success-foreground hover:bg-success/90",
  },
  {
    value: false,
    key: "refused",
    icon: X,
    on: "bg-destructive text-destructive-foreground hover:bg-destructive/90",
  },
  {
    value: null,
    key: "unanswered",
    icon: Minus,
    on: "bg-secondary text-secondary-foreground hover:bg-secondary/80",
  },
] as const;

/**
 * The family's consent register: one three-state control per consent type.
 *
 * A parent may answer and re-answer, never delete — an unanswered consent stays
 * in the register as "not yet answered" rather than disappearing, which is why
 * the third state is offered explicitly instead of being an absence.
 */
export function ConsentMatrix({
  childId,
  consents,
}: {
  childId: string;
  consents: PortalConsent[];
}) {
  const t = useTranslations("portal.child.consents");
  const tc = useTranslations("common");
  const locale = useLocale();
  const router = useRouter();

  const [pendingType, setPendingType] = useState<ConsentType | null>(null);
  const [isPending, startTransition] = useTransition();

  const byType = new Map(consents.map((c) => [c.consent_type, c]));

  function answer(type: ConsentType, granted: boolean | null) {
    setPendingType(type);
    startTransition(async () => {
      const res = await setConsent({ childId, consentType: type, granted });
      setPendingType(null);
      if (res.ok) {
        toast.success(t("saved"));
        router.refresh();
      } else if (res.error === "forbidden") {
        toast.error(t("forbidden"));
      } else {
        toast.error(tc("toasts.error"));
      }
    });
  }

  return (
    <div className="grid gap-3">
      {CONSENT_TYPES.map((type) => {
        const state = byType.get(type);
        const granted = state?.granted ?? null;
        const busy = isPending && pendingType === type;

        return (
          <div
            key={type}
            className={cn(
              "grid gap-3 rounded-xl border p-3.5 transition-colors",
              granted === true && "border-success/30 bg-success/5",
              granted === false && "border-destructive/30 bg-destructive/5",
              granted === null && "border-dashed border-border bg-muted/40"
            )}
          >
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-semibold">{t(`types.${type}`)}</span>
                {granted === null && (
                  <span className="rounded-full border border-warning/40 bg-warning/15 px-2 py-0.5 text-[11px] font-semibold text-foreground">
                    {t("needsAnswer")}
                  </span>
                )}
              </div>
              <p className="mt-1 text-sm leading-relaxed text-muted-foreground">
                {t(`typeHints.${type}`)}
              </p>
              {granted !== null && state?.decided_at && (
                <p className="mt-1 text-xs text-muted-foreground">
                  {t("decidedAt", { date: formatDate(state.decided_at, locale) })}
                </p>
              )}
            </div>

            <div
              className="grid grid-cols-3 gap-1.5"
              role="group"
              aria-label={t(`types.${type}`)}
              aria-busy={busy || undefined}
            >
              {ANSWERS.map(({ value, key, icon: Icon, on }) => {
                const selected = granted === value;
                return (
                  <Button
                    key={key}
                    type="button"
                    variant={selected ? "default" : "outline"}
                    aria-pressed={selected}
                    disabled={isPending}
                    // Re-picking the answer already on file writes nothing.
                    onClick={() => (selected ? undefined : answer(type, value))}
                    className={cn(
                      "h-auto min-h-11 flex-col gap-1 rounded-xl px-1 py-2 text-[11px] leading-tight whitespace-normal",
                      selected ? cn("font-semibold", on) : "text-muted-foreground"
                    )}
                  >
                    <Icon className="size-4 shrink-0" />
                    <span className="text-center">{t(key)}</span>
                  </Button>
                );
              })}
            </div>
          </div>
        );
      })}
    </div>
  );
}
