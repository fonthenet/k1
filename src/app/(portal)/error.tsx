"use client";

import { useTranslations } from "next-intl";
import { TriangleAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/shared/empty-state";

export default function PortalError({ reset }: { error: Error; reset: () => void }) {
  const t = useTranslations("portal.error");
  return (
    <div className="py-10">
      <EmptyState
        icon={<TriangleAlert />}
        title={t("title")}
        description={t("description")}
        action={<Button onClick={reset}>{t("retry")}</Button>}
      />
    </div>
  );
}
