"use client";

import { useTranslations } from "next-intl";
import { TriangleAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/shared/empty-state";

export default function AttendanceError({ reset }: { error: Error; reset: () => void }) {
  const t = useTranslations("attendance");
  return (
    <EmptyState
      icon={<TriangleAlert />}
      title={t("error.title")}
      description={t("error.description")}
      action={<Button onClick={reset}>{t("error.retry")}</Button>}
    />
  );
}
