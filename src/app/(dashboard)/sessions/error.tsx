"use client";

import { useTranslations } from "next-intl";
import { TriangleAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/shared/empty-state";

export default function SessionsError({ reset }: { error: Error; reset: () => void }) {
  const t = useTranslations("sessions");
  return (
    <EmptyState
      icon={<TriangleAlert />}
      title={t("errors.title")}
      description={t("errors.description")}
      action={<Button onClick={reset}>{t("errors.retry")}</Button>}
    />
  );
}
