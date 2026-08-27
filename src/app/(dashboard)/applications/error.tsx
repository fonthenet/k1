"use client";

import { useTranslations } from "next-intl";
import { TriangleAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/shared/empty-state";

export default function ApplicationsError({ reset }: { error: Error; reset: () => void }) {
  const t = useTranslations("enroll");
  return (
    <EmptyState
      icon={<TriangleAlert />}
      title={t("admin.errorTitle")}
      description={t("admin.error")}
      action={<Button onClick={reset}>{t("admin.retry")}</Button>}
    />
  );
}
