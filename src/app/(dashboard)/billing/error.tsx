"use client";

import { useTranslations } from "next-intl";
import { TriangleAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/shared/empty-state";
import { EmptyIcon } from "@/components/modules/billing/finance-ui";

export default function BillingError({ reset }: { error: Error; reset: () => void }) {
  const t = useTranslations("billing");
  return (
    <EmptyState
      icon={
        <EmptyIcon tone="destructive">
          <TriangleAlert />
        </EmptyIcon>
      }
      title={t("error.title")}
      description={t("error.description")}
      action={<Button onClick={reset}>{t("error.retry")}</Button>}
    />
  );
}
