import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { SearchX } from "lucide-react";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/shared/empty-state";

/**
 * Unknown URL, or a notFound() thrown outside the dashboard shell. Rendered in
 * the viewer's locale instead of Next's English "404 — This page could not be
 * found". Public: no auth, no tenant.
 */
export default async function RootNotFound() {
  const t = await getTranslations("landing.errors");
  return (
    <div className="mx-auto flex min-h-dvh w-full max-w-lg items-center px-4 py-10">
      <div className="w-full">
        <EmptyState
          icon={<SearchX />}
          title={t("notFoundTitle")}
          description={t("notFoundDescription")}
          action={
            <Button asChild variant="outline">
              <Link href="/">{t("home")}</Link>
            </Button>
          }
        />
      </div>
    </div>
  );
}
