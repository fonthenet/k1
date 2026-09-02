import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { SearchX } from "lucide-react";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/shared/empty-state";

/**
 * notFound() from a dashboard page — a badge for a member that does not exist,
 * a print register with an unknown kind, a payslip id that is not ours — keeps
 * the shell around it instead of dropping to Next's bare 404.
 */
export default async function DashboardNotFound() {
  const t = await getTranslations("landing.errors");
  return (
    <div className="py-6">
      <EmptyState
        icon={<SearchX />}
        title={t("notFoundTitle")}
        description={t("notFoundDescription")}
        action={
          <Button asChild variant="outline">
            <Link href="/dashboard">{t("dashboard")}</Link>
          </Button>
        }
      />
    </div>
  );
}
