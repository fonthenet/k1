"use client";

import Link from "next/link";
import { useTranslations } from "next-intl";
import { TriangleAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/shared/empty-state";

/**
 * The boundary under the root layout.
 *
 * Until this existed, a failed await in (dashboard)/layout.tsx, the portal or
 * platform layouts, or any page without a module error.tsx of its own fell
 * through to Next's stock English "Application error" screen — in an app whose
 * default language is Arabic. The copy is the product's own EmptyState in the
 * viewer's locale, with the two things a person can actually do: try again,
 * or go somewhere that works.
 *
 * The strings live in the `landing` namespace rather than `common` because the
 * latter is a lead-owned file; every namespace is loaded on every request, so
 * this works everywhere.
 */
export default function RootError({ reset }: { error: Error; reset: () => void }) {
  const t = useTranslations("landing.errors");
  return (
    <div className="mx-auto flex min-h-dvh w-full max-w-lg items-center px-4 py-10">
      <div className="w-full">
        <EmptyState
          icon={<TriangleAlert />}
          title={t("title")}
          description={t("description")}
          action={
            <div className="flex flex-wrap items-center justify-center gap-2">
              <Button onClick={reset}>{t("retry")}</Button>
              <Button asChild variant="outline">
                <Link href="/">{t("home")}</Link>
              </Button>
            </div>
          }
        />
      </div>
    </div>
  );
}
