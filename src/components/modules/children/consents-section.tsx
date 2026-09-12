"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import { Check, Minus, ShieldCheck, X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { SectionCard } from "@/components/shared/section-card";
import { formatDate } from "@/lib/format";
import { cn } from "@/lib/utils";
import { setConsent } from "./actions";
import { CONSENT_TYPES, type ConsentState, type ConsentType } from "./types";

export function ConsentsSection({
  childId,
  consents,
}: {
  childId: string;
  consents: ConsentState[];
}) {
  const t = useTranslations("children");
  const locale = useLocale();
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  const byType = new Map(consents.map((c) => [c.consent_type, c]));

  function update(type: ConsentType, granted: boolean | null) {
    startTransition(async () => {
      const res = await setConsent(childId, type, granted);
      if (res.ok) {
        toast.success(t("toasts.saved"));
        router.refresh();
      } else {
        toast.error(t("toasts.error"));
      }
    });
  }

  // The answer is carried by the one pressed button — a primary border on
  // it and nothing else. The row used to be washed green or red as well,
  // two marks for one fact.
  const choice = (selected: boolean) =>
    cn(selected && "border-primary text-primary");

  return (
    <SectionCard
      icon={ShieldCheck}
      tone={2}
      title={t("consents.title")}
      hint={t("consents.description")}
      contentClassName="gap-0"
    >
      <div className="divide-y divide-border">
        {CONSENT_TYPES.map((type) => {
          const state = byType.get(type);
          const granted = state?.granted ?? null;
          return (
            <div
              key={type}
              className="flex flex-wrap items-center justify-between gap-3 py-3 first:pt-0 last:pb-0"
            >
              <div className="min-w-0">
                <div className="font-semibold">
                  {t(`consents.types.${type}`)}
                </div>
                <div className="text-xs text-muted-foreground">
                  {t(`consents.typeHints.${type}`)}
                  {state?.decided_at && (
                    <span className="ms-2">
                      ·{" "}
                      {t("consents.decidedAt", {
                        date: formatDate(state.decided_at, locale),
                      })}
                    </span>
                  )}
                </div>
              </div>
              <div
                className="flex gap-1"
                role="group"
                aria-label={t(`consents.types.${type}`)}
              >
                <Button
                  size="sm"
                  variant="outline"
                  className={choice(granted === true)}
                  disabled={pending}
                  onClick={() => update(type, true)}
                >
                  <Check data-icon="inline-start" />
                  {t("consents.granted")}
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  className={choice(granted === false)}
                  disabled={pending}
                  onClick={() => update(type, false)}
                >
                  <X data-icon="inline-start" />
                  {t("consents.refused")}
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  className={choice(granted === null)}
                  disabled={pending}
                  onClick={() => update(type, null)}
                >
                  <Minus data-icon="inline-start" />
                  {t("consents.pending")}
                </Button>
              </div>
            </div>
          );
        })}
      </div>
    </SectionCard>
  );
}
