"use client";

import { useTranslations } from "next-intl";
import { LayoutDashboard } from "lucide-react";
import { SectionCard } from "@/components/shared/section-card";
import { cn } from "@/lib/utils";
import type { CenterType } from "./center-types";
import { centerTypeOption } from "./center-types";

/**
 * What the wizard's ticked types will open onto, shown while they tick.
 *
 * A plain section card, the same one as everywhere else: it used to be a
 * primary-tinted box with a primary border, which made a preview look like a
 * warning. One row per type, in the standalone structure form — a 28px
 * tinted tile with the type's glyph, the name, one muted line. The structures
 * do not exist yet, so there is no structure colour to tint the tile with;
 * the rows borrow the type's token tone from the picker instead of inventing
 * a colour the settings page will later contradict.
 */
export function WorkspacePreview({ types }: { types: CenterType[] }) {
  const t = useTranslations("dashboard.workspace");
  return (
    <SectionCard
      icon={LayoutDashboard}
      title={t("preview")}
      hint={t("local")}
      contentClassName="gap-0"
    >
      {/* Announced as it changes, so a screen reader hears what a tick did. */}
      <div aria-live="polite" className="divide-y divide-border">
        {types.map((type) => {
          const { Icon, tile } = centerTypeOption(type);
          return (
            <div
              key={type}
              className="flex items-start gap-3 py-3 first:pt-0 last:pb-0"
            >
              <span
                className={cn(
                  "flex size-7 shrink-0 items-center justify-center rounded-lg",
                  tile,
                )}
                aria-hidden
              >
                <Icon className="size-4" />
              </span>
              <div className="min-w-0">
                <p className="text-sm font-medium">{t(`${type}.title`)}</p>
                <p className="mt-0.5 text-xs leading-relaxed text-muted-foreground">
                  {t(`${type}.description`)}
                </p>
              </div>
            </div>
          );
        })}
      </div>
    </SectionCard>
  );
}
