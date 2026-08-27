"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import { Check, Minus, ShieldCheck, X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
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

  return (
    <Card className="shadow-sm">
      <CardHeader>
        <CardTitle className="flex items-center gap-2.5 text-base">
          <span className="flex size-8 items-center justify-center rounded-lg bg-primary/10 text-primary">
            <ShieldCheck className="size-4" />
          </span>
          {t("consents.title")}
        </CardTitle>
        <CardDescription>{t("consents.description")}</CardDescription>
      </CardHeader>
      <CardContent className="grid gap-3">
        {CONSENT_TYPES.map((type) => {
          const state = byType.get(type);
          const granted = state?.granted ?? null;
          return (
            <div
              key={type}
              className={cn(
                "flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border p-3.5 transition-colors",
                granted === true && "border-success/30 bg-success/5",
                granted === false && "border-destructive/30 bg-destructive/5",
                granted === null && "bg-muted/30"
              )}
            >
              <div className="min-w-0">
                <div className="font-semibold">{t(`consents.types.${type}`)}</div>
                <div className="text-xs text-muted-foreground">
                  {t(`consents.typeHints.${type}`)}
                  {state?.decided_at && (
                    <span className="ms-2">
                      · {t("consents.decidedAt", { date: formatDate(state.decided_at, locale) })}
                    </span>
                  )}
                </div>
              </div>
              <div className="flex gap-1" role="group" aria-label={t(`consents.types.${type}`)}>
                <Button
                  size="sm"
                  variant={granted === true ? "default" : "outline"}
                  className={cn(
                    granted === true && "bg-success text-success-foreground hover:bg-success/90"
                  )}
                  disabled={pending}
                  onClick={() => update(type, true)}
                >
                  <Check data-icon="inline-start" />
                  {t("consents.granted")}
                </Button>
                <Button
                  size="sm"
                  variant={granted === false ? "destructive" : "outline"}
                  disabled={pending}
                  onClick={() => update(type, false)}
                >
                  <X data-icon="inline-start" />
                  {t("consents.refused")}
                </Button>
                <Button
                  size="sm"
                  variant={granted === null ? "secondary" : "outline"}
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
      </CardContent>
    </Card>
  );
}
