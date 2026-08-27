"use client";

import { useFormStatus } from "react-dom";
import { useTranslations } from "next-intl";
import { CheckIcon, Loader2Icon } from "lucide-react";
import { Button } from "@/components/ui/button";

export function AcceptInviteButton() {
  const { pending } = useFormStatus();
  const t = useTranslations("auth");

  return (
    <Button type="submit" size="lg" className="h-11 w-full text-sm" disabled={pending}>
      {pending ? (
        <Loader2Icon className="animate-spin" data-icon="inline-start" />
      ) : (
        <CheckIcon data-icon="inline-start" />
      )}
      {pending ? t("join.accepting") : t("join.accept")}
    </Button>
  );
}
