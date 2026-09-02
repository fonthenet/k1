"use client";

import Link from "next/link";
import { useTranslations } from "next-intl";
import { TriangleAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/shared/empty-state";

/**
 * Catch-all for the dashboard pages that have no module boundary of their own
 * (children, staff, settings, reports, my-pay, notifications, dashboard…).
 * Rendered INSIDE the shell — sidebar and topbar survive — so the person keeps
 * their bearings and a way out. Modules with their own error.tsx (classes,
 * billing, attendance…) keep theirs; this one only catches what they miss.
 */
export default function DashboardError({ reset }: { error: Error; reset: () => void }) {
  const t = useTranslations("landing.errors");
  return (
    <div className="py-6">
      <EmptyState
        icon={<TriangleAlert />}
        title={t("title")}
        description={t("description")}
        action={
          <div className="flex flex-wrap items-center justify-center gap-2">
            <Button onClick={reset}>{t("retry")}</Button>
            <Button asChild variant="outline">
              <Link href="/dashboard">{t("dashboard")}</Link>
            </Button>
          </div>
        }
      />
    </div>
  );
}
