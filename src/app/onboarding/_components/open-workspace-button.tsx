"use client";

import { useFormStatus } from "react-dom";
import { useTranslations } from "next-intl";
import { ArrowRightIcon, Loader2Icon } from "lucide-react";
import { Button } from "@/components/ui/button";

export function OpenWorkspaceButton() {
  const { pending } = useFormStatus();
  const t = useTranslations("auth");

  return (
    <Button type="submit" size="lg" className="h-10 w-full" disabled={pending}>
      {pending ? (
        <Loader2Icon className="animate-spin" data-icon="inline-start" />
      ) : (
        <ArrowRightIcon className="rtl:rotate-180" data-icon="inline-start" />
      )}
      {pending ? t("onboarding.opening") : t("onboarding.open")}
    </Button>
  );
}
