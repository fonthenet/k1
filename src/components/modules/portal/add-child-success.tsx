"use client";

// The end of the sibling flow. It promises exactly what happened — a REQUEST
// was sent, not a place granted — and points the family at the one screen
// where they can watch it move: /portal/children, where the request now sits
// as a muted card until the office answers.

import Link from "next/link";
import { useTranslations } from "next-intl";
import { ArrowRight, Check } from "lucide-react";
import { Button } from "@/components/ui/button";

export function AddChildSuccess({
  tenantName,
  childName,
}: {
  tenantName: string;
  childName: string;
}) {
  const t = useTranslations("portal.addChild");

  return (
    <div className="flex flex-col items-center pt-8 text-center">
      <div
        className="mb-5 flex size-20 items-center justify-center rounded-full bg-primary/10 text-primary shadow-sm"
        aria-hidden
      >
        <Check className="size-9" strokeWidth={2.5} />
      </div>

      <h2 className="text-2xl font-bold tracking-tight">{t("success.title")}</h2>
      <p className="mt-3 max-w-sm text-sm leading-relaxed text-muted-foreground">
        {t("success.message", { name: tenantName, child: childName })}
      </p>
      <p className="mt-2 text-xs text-muted-foreground">{t("success.hint")}</p>

      <Button asChild size="lg" className="mt-8 h-12 w-full text-base">
        <Link href="/portal/children">
          {t("success.back")}
          <ArrowRight className="size-4 rtl:rotate-180" data-icon="inline-end" />
        </Link>
      </Button>
    </div>
  );
}
