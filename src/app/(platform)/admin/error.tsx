"use client";

import { useTranslations } from "next-intl";
import { TriangleAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/shared/empty-state";

/**
 * Error boundary for the operator panel. Without one, a failed RPC (the
 * platform functions raise 'forbidden' the moment kg_platform_admins stops
 * listing you) fell through to Next's bare error screen with no way back.
 */
export default function PlatformError({ reset }: { error: Error; reset: () => void }) {
  const t = useTranslations("platform");
  return (
    <EmptyState
      icon={<TriangleAlert />}
      title={t("error.title")}
      description={t("error.description")}
      action={<Button onClick={reset}>{t("error.retry")}</Button>}
    />
  );
}
